import { readFileSync } from 'node:fs'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { ClassReviewFramingCalibration } from '../classReviewSynthesis/framingCalibrations.js'
import { classReviewProviderOutputSchema } from '../classReviewSynthesis/providerContract.js'
import { deriveClassReviewPromptCacheKey } from '../classReviewSynthesis/promptCacheKey.js'
import type {
  ClassReviewProviderOutputV1,
  ClassReviewSynthesisRequestV1,
} from '../classReviewSynthesis/types.js'
import { validateClassReviewSynthesisRequest } from '../classReviewSynthesis/validateRequest.js'
import type { ClassReviewSynthesisProvider } from './classReviewSynthesisProviderTypes.js'
import { KimiClassReviewProvider } from './kimiClassReviewProvider.js'
import type { KimiCompletionInput, KimiTransport } from './kimiTransport.js'
import {
  GradingProviderError,
  type AnyProviderErrorCode,
  type ProviderAttemptObservation,
  type ProviderDiagnosticCode,
} from './providerTypes.js'

const fixture = JSON.parse(readFileSync(
  new URL('../../../test-fixtures/class-review/synthesis-contracts.json', import.meta.url), 'utf8',
)) as {
  requests: { withGroups: unknown }
  results: { succeeded: { output: ClassReviewProviderOutputV1 } }
}

function request(): ClassReviewSynthesisRequestV1 {
  const parsed = validateClassReviewSynthesisRequest(fixture.requests.withGroups)
  if (!parsed.ok) throw new Error(`invalid fixture ${parsed.error.path}`)
  return parsed.value
}

const secret = '0123456789abcdef0123456789abcdef'
const calibration: ClassReviewFramingCalibration = {
  apiBase: 'https://api.moonshot.cn/v1', model: 'kimi-k3', reasoningEffort: 'low',
  policyVersion: 'class-review-policy-v1', schemaVersion: 'kimi-class-review-output-v1',
  projectionVersion: 'class-review-projection-v1', budgetVersion: 'class-review-prompt-budget-v1',
  wireSerializationVersion: 'class-review-wire-serialization-v1', framingTokens: 512,
}

function observation(id = 'class-review-attempt-1'): ProviderAttemptObservation {
  return {
    attemptDiagnosticId: id,
    finishReason: 'stop',
    usage: {
      promptTokens: { status: 'known', value: 100 },
      completionTokens: { status: 'known', value: 50 },
      totalTokens: { status: 'known', value: 150 },
      cachedTokens: { status: 'known', value: 20 },
    },
    providerElapsedMs: 4,
  }
}

function provider(transport: KimiTransport, overrides: {
  hmacSecret?: string
  calibration?: ClassReviewFramingCalibration | null
  tokenizer?: { count(value: string): number }
} = {}) {
  return new KimiClassReviewProvider({
    transport,
    hmacSecret: overrides.hmacSecret ?? secret,
    calibration: overrides.calibration === undefined ? calibration : overrides.calibration,
    tokenizer: overrides.tokenizer,
  })
}

async function expectProviderError(
  run: Promise<unknown>,
  expected: Partial<{ code: AnyProviderErrorCode; retryable: boolean; diagnosticCode: ProviderDiagnosticCode }>,
) {
  try {
    await run
    throw new Error('expected provider error')
  } catch (error) {
    expect(error).toBeInstanceOf(GradingProviderError)
    expect(error).toMatchObject(expected)
    return error as GradingProviderError
  }
}

describe('KimiClassReviewProvider', () => {
  it('implements the separate interface and makes exactly one bounded generation call', async () => {
    const complete = vi.fn(async (_input: KimiCompletionInput) => ({
      value: fixture.results.succeeded.output,
      observation: observation(),
    }))
    const implementation: ClassReviewSynthesisProvider = provider({ complete })
    expectTypeOf(implementation).toMatchTypeOf<ClassReviewSynthesisProvider>()

    const result = await implementation.synthesize({ request: request(), signal: new AbortController().signal })

    expect(complete).toHaveBeenCalledTimes(1)
    const call = complete.mock.calls[0][0]
    expect(call).toMatchObject({
      stage: 'class_review_generation',
      schemaName: 'kimi-class-review-output-v1',
      schema: classReviewProviderOutputSchema,
      maxCompletionTokens: 3_072,
      attempt: 1,
    })
    expect(call.messages).toHaveLength(3)
    expect(call.diagnosticContext).toMatch(/^[0-9a-f-]{36}$/i)
    expect(call.promptCacheKey).toBe(deriveClassReviewPromptCacheKey({
      hmacSecret: secret,
      rubricRevisionDigest: request().rubricRevisionDigest,
      policyVersion: request().policyVersion,
      schemaVersion: request().schemaVersion,
      projectionVersion: request().projectionVersion,
    }))
    expect(calibration.reasoningEffort).toBe('low')
    expect(result).toEqual({ value: fixture.results.succeeded.output, attempts: [observation()] })
  })

  it('does not treat the cache key as execution idempotency', async () => {
    const complete = vi.fn(async (_input: KimiCompletionInput) => ({
      value: fixture.results.succeeded.output,
      observation: observation(),
    }))
    const implementation = provider({ complete })
    const input = { request: request(), signal: new AbortController().signal }

    await implementation.synthesize(input)
    await implementation.synthesize(input)

    expect(complete).toHaveBeenCalledTimes(2)
    expect(complete.mock.calls[0][0].promptCacheKey).toBe(complete.mock.calls[1][0].promptCacheKey)
  })

  it.each(['', ' '.repeat(40), 'x'.repeat(31)])('fails closed for invalid cache secret before transport', async (hmacSecret) => {
    const complete = vi.fn()
    await expectProviderError(
      provider({ complete }, { hmacSecret }).synthesize({ request: request(), signal: new AbortController().signal }),
      { code: 'provider_not_configured', retryable: false },
    )
    expect(complete).not.toHaveBeenCalled()
  })

  it('fails closed for missing framing calibration before transport', async () => {
    const complete = vi.fn()
    await expectProviderError(
      provider({ complete }, { calibration: null }).synthesize({ request: request(), signal: new AbortController().signal }),
      { code: 'class_review_prompt_calibration_missing', retryable: false },
    )
    expect(complete).not.toHaveBeenCalled()
  })

  it.each([
    ['completion_truncated', 'length'],
    ['completion_finish_reason', 'unknown'],
    ['completion_tool_calls', 'tool_calls'],
    ['completion_finish_reason', 'content_filter'],
    ['completion_content', undefined],
    ['completion_content_json_malformed', undefined],
  ] as const)('normalizes billed %s failure to nonretryable without a repair call', async (diagnosticCode, finishReason) => {
    const attempt = { ...observation(`attempt-${diagnosticCode}`), finishReason: finishReason ?? 'stop' } as ProviderAttemptObservation
    const details = {
      termination: 'confirmed' as const,
      ...(finishReason ? { finishReason } : {}),
      usage: attempt.usage,
      attemptObservations: [attempt, attempt],
    }
    const complete = vi.fn(async () => {
      throw new GradingProviderError(
        'provider_invalid_response', 'safe transport response error', true,
        diagnosticCode as ProviderDiagnosticCode, details,
      )
    })

    const error = await expectProviderError(
      provider({ complete }).synthesize({ request: request(), signal: new AbortController().signal }),
      { code: 'provider_invalid_response', retryable: false, diagnosticCode },
    )
    expect(complete).toHaveBeenCalledTimes(1)
    expect(error.details).toMatchObject({ termination: 'confirmed', attemptObservations: [attempt] })
  })

  it('rejects strict-contract and illegal admitted-alias output after one completion', async () => {
    const invalid = structuredClone(fixture.results.succeeded.output)
    invalid.patterns[0].groupIds = ['unknown-group']
    const complete = vi.fn(async () => ({ value: invalid, observation: observation() }))

    const error = await expectProviderError(
      provider({ complete }).synthesize({ request: request(), signal: new AbortController().signal }),
      { code: 'provider_invalid_response', retryable: false, diagnosticCode: 'completion_content' },
    )
    expect(complete).toHaveBeenCalledTimes(1)
    expect(error.details?.attemptObservations).toEqual([observation()])
  })

  it('validates aliases against the admitted longest prefix', async () => {
    const invalidForAdmitted = structuredClone(fixture.results.succeeded.output)
    invalidForAdmitted.patterns = [invalidForAdmitted.patterns[1]]
    const complete = vi.fn(async (_input: KimiCompletionInput) => ({
      value: invalidForAdmitted,
      observation: observation(),
    }))
    const tokenizer = { count: (wire: string) => wire.includes('logic.bridge') ? 20_000 : 100 }

    await expectProviderError(
      provider({ complete }, { tokenizer }).synthesize({ request: request(), signal: new AbortController().signal }),
      { code: 'provider_invalid_response', retryable: false },
    )
    expect(complete).toHaveBeenCalledTimes(1)
    expect(String(complete.mock.calls[0][0].messages[2]?.content)).not.toContain('logic.bridge')
  })

  it('preserves confirmed-zero rate-limit retryability and unknown termination ownership', async () => {
    const rateLimited = vi.fn(async () => {
      throw new GradingProviderError('provider_rate_limited', 'safe rate limit', true, undefined, {
        termination: 'confirmed', retryAfterMs: 1_000, attemptObservations: [observation('rate')],
      })
    })
    await expectProviderError(
      provider({ complete: rateLimited }).synthesize({ request: request(), signal: new AbortController().signal }),
      { code: 'provider_rate_limited', retryable: true },
    )
    expect(rateLimited).toHaveBeenCalledTimes(1)

    const unknown = vi.fn(async () => {
      throw new GradingProviderError('provider_unavailable', 'safe unavailable', true, undefined, {
        termination: 'unknown', attemptObservations: [observation('unknown')],
      })
    })
    const error = await expectProviderError(
      provider({ complete: unknown }).synthesize({ request: request(), signal: new AbortController().signal }),
      { code: 'provider_unavailable', retryable: true },
    )
    expect(error.details?.termination).toBe('unknown')
    expect(unknown).toHaveBeenCalledTimes(1)
  })
})
