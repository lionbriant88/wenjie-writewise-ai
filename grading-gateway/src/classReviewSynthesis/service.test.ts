import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { ClassReviewFramingCalibration } from './framingCalibrations.js'
import type { ClassReviewProviderOutputV1, ClassReviewSynthesisRequestV1 } from './types.js'
import { validateClassReviewSynthesisRequest } from './validateRequest.js'
import { OneShotProviderExecutionTracker } from '../oneShotProviderExecution.js'
import { ProviderAdmissionController } from '../providerAdmissionController.js'
import type { ClassReviewSynthesisProvider } from '../providers/classReviewSynthesisProviderTypes.js'
import {
  ClassReviewProviderError,
  GradingProviderError,
  type ProviderAttemptObservation,
  type ProviderUsageSnapshot,
} from '../providers/providerTypes.js'
import { createProviderTelemetryRecorder } from '../providerTelemetry.js'
import { parseGatewayRuntimeConfig } from '../gatewayRuntimeConfig.js'
import { ClassReviewRuntimeInvariant } from './runtimeInvariant.js'
import {
  ClassReviewSynthesisService,
  createClassReviewSynthesisProviderForRuntime,
} from './service.js'

const fixture = JSON.parse(readFileSync(
  new URL('../../../test-fixtures/class-review/synthesis-contracts.json', import.meta.url),
  'utf8',
)) as {
  requests: { withGroups: unknown }
  results: {
    succeeded: Record<string, unknown> & { output: ClassReviewProviderOutputV1 }
    rateLimited: Record<string, unknown>
    completedFailure: Record<string, unknown>
    resultUnknown: Record<string, unknown>
  }
}

const calibration: ClassReviewFramingCalibration = {
  apiBase: 'https://api.moonshot.cn/v1', model: 'kimi-k3', reasoningEffort: 'low',
  policyVersion: 'class-review-policy-v1', schemaVersion: 'kimi-class-review-output-v1',
  projectionVersion: 'class-review-projection-v1', budgetVersion: 'class-review-prompt-budget-v1',
  wireSerializationVersion: 'class-review-wire-serialization-v1', framingTokens: 512,
}
const hmacSecret = '0123456789abcdef0123456789abcdef'

function requestFixture(): ClassReviewSynthesisRequestV1 {
  const parsed = validateClassReviewSynthesisRequest(structuredClone(fixture.requests.withGroups))
  if (!parsed.ok) throw new Error(`invalid request fixture ${parsed.error.path}`)
  return parsed.value
}

function usage(overrides: Partial<ProviderUsageSnapshot> = {}): ProviderUsageSnapshot {
  return {
    promptTokens: { status: 'known', value: 100 },
    completionTokens: { status: 'known', value: 50 },
    totalTokens: { status: 'known', value: 150 },
    cachedTokens: { status: 'unknown', reason: 'absent' },
    ...overrides,
  }
}

function observation(
  id = '11111111-1111-4111-8111-111111111111',
  overrides: Partial<ProviderAttemptObservation> = {},
): ProviderAttemptObservation {
  return {
    attemptDiagnosticId: id,
    finishReason: 'stop',
    usage: usage(),
    providerElapsedMs: 2,
    ...overrides,
  }
}

function provider(
  run: ClassReviewSynthesisProvider['synthesize'],
): ClassReviewSynthesisProvider {
  return { synthesize: run }
}

function harness(options: {
  mode?: 'fake' | 'kimi'
  provider: ClassReviewSynthesisProvider
  admission?: ProviderAdmissionController
  now?: () => number
  tokenizer?: { count(value: string): number }
  calibration?: ClassReviewFramingCalibration | null
  hmacSecret?: string
  telemetry?: ReturnType<typeof createProviderTelemetryRecorder>
  invariant?: ClassReviewRuntimeInvariant
}) {
  const now = options.now ?? (() => 0)
  const admission = options.admission ?? new ProviderAdmissionController({
    hardLimit: 4,
    now,
    idFactory: (() => {
      let id = 0
      return () => `class-review-lease-${++id}`
    })(),
  })
  const oneShot = new OneShotProviderExecutionTracker({
    admission,
    providerFinalDeadlineMs: 200,
    settlementGraceMs: 20,
    retryAfterPauseMs: 900_000,
    now,
  })
  const service = new ClassReviewSynthesisService({
    mode: options.mode ?? 'fake',
    provider: options.provider,
    admission,
    oneShot,
    calibration: options.calibration === undefined ? calibration : options.calibration,
    ...(options.tokenizer ? { tokenizer: options.tokenizer } : {}),
    ...(options.hmacSecret === undefined ? { hmacSecret } : { hmacSecret: options.hmacSecret }),
    runtimeInvariant: options.invariant ?? new ClassReviewRuntimeInvariant(),
    providerTelemetry: options.telemetry ?? createProviderTelemetryRecorder(),
    monotonicNow: now,
    diagnosticIdFactory: () => '22222222-2222-4222-8222-222222222222',
  })
  return { service, admission, oneShot }
}

describe('ClassReviewSynthesisService', () => {
  it('maps the canonical success fixture with immutable prepared semantic coverage', async () => {
    const calls: ClassReviewSynthesisRequestV1[] = []
    const implementation = provider(async (input) => {
      calls.push(input.request)
      return { value: fixture.results.succeeded.output, attempts: [observation()] }
    })
    const input = requestFixture()
    const response = await harness({ provider: implementation }).service.synthesize({
      request: input, receivedAt: 0, httpDeadlineMs: 100,
    })

    expect(response.httpStatus).toBe(200)
    expect(response.result).toEqual({
      ...fixture.results.succeeded,
      timingsMs: response.result.timingsMs,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]).not.toBe(input)
    expect(Object.isFrozen(calls[0])).toBe(true)
    expect(Object.isFrozen(calls[0].groups[0])).toBe(true)
  })

  it('runs cache-key and prompt preparation before attempting shared admission', async () => {
    let nextLease = 0
    const admission = new ProviderAdmissionController({
      hardLimit: 2,
      now: () => 0,
      idFactory: () => `shared-lease-${++nextLease}`,
    })
    const essayLease = admission.tryAcquire()
    if (!essayLease.accepted) throw new Error('essay lease rejected')
    const tokenizer = { count: vi.fn(() => 100) }
    const synthesize = vi.fn(async () => ({
      value: fixture.results.succeeded.output,
      attempts: [observation()],
    }))
    const response = await harness({
      mode: 'kimi', provider: provider(synthesize), admission, tokenizer,
    }).service.synthesize({ request: requestFixture(), receivedAt: 0, httpDeadlineMs: 100 })

    expect(tokenizer.count).toHaveBeenCalled()
    expect(synthesize).not.toHaveBeenCalled()
    expect(nextLease).toBe(1)
    expect(response).toMatchObject({
      httpStatus: 429,
      result: {
        status: 'failed', safeFailureCode: 'provider_rate_limited',
        completionDisposition: 'not_started', retryable: true, retryAfterMs: 1_000,
      },
    })
    essayLease.lease.release({ kind: 'confirmed_failure' })

    const invalidCacheAdmission = new ProviderAdmissionController({
      hardLimit: 1, now: () => 0, idFactory: () => `must-not-acquire-${++nextLease}`,
    })
    const invalidCache = await harness({
      mode: 'kimi', provider: provider(synthesize), admission: invalidCacheAdmission,
      hmacSecret: 'short',
    }).service.synthesize({ request: requestFixture(), receivedAt: 0, httpDeadlineMs: 100 })
    expect(invalidCache).toMatchObject({
      httpStatus: 503,
      result: {
        status: 'failed', safeFailureCode: 'provider_not_configured',
        completionDisposition: 'not_started', retryable: false,
      },
    })
    expect(invalidCacheAdmission.snapshot().activeLeases).toBe(0)

    const missingCalibrationAdmission = new ProviderAdmissionController({
      hardLimit: 1, now: () => 0, idFactory: () => `must-not-acquire-${++nextLease}`,
    })
    const missingCalibration = await harness({
      mode: 'kimi', provider: provider(synthesize), admission: missingCalibrationAdmission,
      calibration: null,
    }).service.synthesize({ request: requestFixture(), receivedAt: 0, httpDeadlineMs: 100 })
    expect(missingCalibration).toMatchObject({
      httpStatus: 503,
      result: {
        status: 'failed', safeFailureCode: 'class_review_prompt_calibration_missing',
        completionDisposition: 'not_started', retryable: false,
      },
    })
    expect(missingCalibrationAdmission.snapshot().activeLeases).toBe(0)
  })

  it('retains and executes only the longest admitted ordered prefix', async () => {
    const seen: ClassReviewSynthesisRequestV1[] = []
    const tokenizer = {
      count: (wire: string) => wire.includes('logic.bridge') ? 20_000 : 100,
    }
    const implementation = provider(async (input) => {
      seen.push(input.request)
      const output = structuredClone(fixture.results.succeeded.output)
      output.patterns = [output.patterns[0]]
      return { value: output, attempts: [observation()] }
    })
    const response = await harness({ provider: implementation, tokenizer }).service.synthesize({
      request: requestFixture(), receivedAt: 0, httpDeadlineMs: 100,
    })

    expect(seen[0].groups.map((group) => group.groupId)).toEqual(['grammar.tense'])
    expect(response.result).toMatchObject({
      status: 'succeeded',
      semanticCoverage: {
        projectedGroupCount: 1, eligibleGroupCount: 3,
        projectedDistinctEssaySupportSum: 2, eligibleDistinctEssaySupportSum: 4,
        projectedOccurrenceSum: 3, eligibleOccurrenceSum: 6,
      },
    })
  })

  it('invalidates nominal success inside the lease when required usage is unknown', async () => {
    const admission = new ProviderAdmissionController({
      hardLimit: 2,
      stableSuccessWindow: 1,
      now: () => 0,
      idFactory: () => 'unknown-usage-lease',
    })
    const unknown = observation(undefined, {
      usage: usage({ promptTokens: { status: 'unknown', reason: 'absent' } }),
    })
    const response = await harness({
      provider: provider(async () => ({
        value: fixture.results.succeeded.output,
        attempts: [unknown],
      })),
      admission,
    }).service.synthesize({ request: requestFixture(), receivedAt: 0, httpDeadlineMs: 100 })

    expect(response).toMatchObject({
      httpStatus: 503,
      result: {
        status: 'failed', safeFailureCode: 'provider_invalid_response', retryable: false,
        completionDisposition: 'completed', usage: null,
      },
    })
    expect(admission.snapshot()).toMatchObject({ target: 1, stableSuccesses: 0, activeLeases: 0 })
  })

  it.each([
    ['missing observation', []],
    ['duplicate observation', [observation(), observation()]],
    ['non-stop observation', [observation(undefined, { finishReason: 'length' })]],
  ] as const)('discards a nominal success with %s as a completed nonretryable failure', async (_name, attempts) => {
    const response = await harness({
      provider: provider(async () => ({
        value: fixture.results.succeeded.output,
        attempts: [...attempts],
      })),
    }).service.synthesize({ request: requestFixture(), receivedAt: 0, httpDeadlineMs: 100 })
    expect(response).toMatchObject({
      httpStatus: 503,
      result: {
        status: 'failed', safeFailureCode: 'provider_invalid_response',
        retryable: false, completionDisposition: 'completed',
      },
    })
  })

  it('revalidates output inside the lease against the admitted request', async () => {
    const invalid = structuredClone(fixture.results.succeeded.output)
    invalid.patterns[0].groupIds = ['unknown.group']
    const synthesize = vi.fn(async () => ({ value: invalid, attempts: [observation()] }))
    const response = await harness({
      provider: provider(synthesize),
    }).service.synthesize({ request: requestFixture(), receivedAt: 0, httpDeadlineMs: 100 })
    expect(response).toMatchObject({
      httpStatus: 503,
      result: {
        status: 'failed', safeFailureCode: 'provider_invalid_response',
        retryable: false, completionDisposition: 'completed',
      },
    })
    expect(synthesize).toHaveBeenCalledTimes(1)
  })

  it('maps the canonical completed-failure fixture and keeps unknown completed usage null', async () => {
    const completedObservation = observation(undefined, {
      finishReason: 'length',
      usage: usage({ cachedTokens: { status: 'known', value: 20 } }),
    })
    const completed = await harness({
      provider: provider(async () => {
        throw new GradingProviderError('provider_invalid_response', 'safe', false, undefined, {
          termination: 'confirmed', finishReason: 'length',
          attemptObservations: [completedObservation],
        })
      }),
    }).service.synthesize({ request: requestFixture(), receivedAt: 0, httpDeadlineMs: 100 })
    expect(completed.result).toEqual({
      ...fixture.results.completedFailure,
      timingsMs: completed.result.timingsMs,
    })

    const unknownObservation = observation('12121212-1212-4212-8212-121212121212', {
      usage: usage({ totalTokens: { status: 'unknown', reason: 'inconsistent' } }),
    })
    const honestNull = await harness({
      provider: provider(async () => {
        throw new GradingProviderError('provider_invalid_response', 'safe', false, undefined, {
          termination: 'confirmed', attemptObservations: [unknownObservation],
        })
      }),
    }).service.synthesize({ request: requestFixture(), receivedAt: 0, httpDeadlineMs: 100 })
    expect(honestNull).toMatchObject({
      httpStatus: 503,
      result: {
        status: 'failed', safeFailureCode: 'provider_invalid_response',
        completionDisposition: 'completed', usage: null,
      },
    })
  })

  it('maps a confirmed-zero 429 truthfully and lowers the shared admission target', async () => {
    let now = 0
    let leaseId = 0
    const admission = new ProviderAdmissionController({
      hardLimit: 4,
      stableSuccessWindow: 1,
      now: () => now,
      idFactory: () => `rate-lease-${++leaseId}`,
    })
    const grow = admission.tryAcquire()
    if (!grow.accepted) throw new Error('growth lease rejected')
    grow.lease.release({ kind: 'success' })
    expect(admission.snapshot().target).toBe(2)

    const providerCall = vi.fn(async () => {
        throw new GradingProviderError('provider_rate_limited', 'safe', true, undefined, {
          termination: 'confirmed', retryAfterMs: 1_000,
        })
      })
    const rateHarness = harness({
      provider: provider(providerCall),
      admission,
      now: () => now,
    })
    const response = await rateHarness.service.synthesize({
      request: requestFixture(), receivedAt: 0, httpDeadlineMs: 100,
    })
    expect(response.result).toEqual({
      ...fixture.results.rateLimited,
      timingsMs: response.result.timingsMs,
    })
    expect(response.httpStatus).toBe(429)
    expect(admission.snapshot()).toMatchObject({ target: 1, rateLimitNotBeforeMs: 1_000 })
    now = 400
    const gated = await rateHarness.service.synthesize({
      request: requestFixture(), receivedAt: 400, httpDeadlineMs: 100,
    })
    expect(gated).toMatchObject({
      httpStatus: 429,
      result: {
        safeFailureCode: 'provider_rate_limited', retryable: true,
        retryAfterMs: 600, completionDisposition: 'not_started',
      },
    })
    expect(providerCall).toHaveBeenCalledTimes(1)
    now = 1_000
  })

  it.each([
    ['provider_auth_failed', 'provider_auth_failed'],
    ['provider_balance_unavailable', 'provider_balance_unavailable'],
    ['provider_not_configured', 'provider_not_configured'],
    ['provider_request_rejected', 'provider_access_denied'],
  ] as const)('preserves the shared %s pause behavior', async (code, pauseReason) => {
    const admission = new ProviderAdmissionController({ hardLimit: 1, now: () => 0 })
    const providerCall = vi.fn(async () => {
        throw new GradingProviderError(code, 'safe', true, undefined, {
          termination: 'confirmed',
          ...(code === 'provider_request_rejected' ? { pauseAdmission: true as const } : {}),
        })
      })
    const pausedHarness = harness({
      provider: provider(providerCall),
      admission,
    })
    const response = await pausedHarness.service.synthesize({
      request: requestFixture(), receivedAt: 0, httpDeadlineMs: 100,
    })
    expect(response.httpStatus).toBe(503)
    expect(response.result).toMatchObject({ retryable: false })
    expect(admission.snapshot()).toMatchObject({ pauseReason, activeLeases: 0 })
    if (code === 'provider_request_rejected') {
      expect(response.result).toMatchObject({ safeFailureCode: 'provider_request_rejected' })
    }
    const blocked = await pausedHarness.service.synthesize({
      request: requestFixture(), receivedAt: 0, httpDeadlineMs: 100,
    })
    expect(blocked).toMatchObject({
      httpStatus: 503,
      result: {
        safeFailureCode: code,
        retryable: false,
        retryAfterMs: null,
        completionDisposition: 'not_started',
      },
    })
    expect(providerCall).toHaveBeenCalledTimes(1)
  })

  it('wraps a defensive post-admission ClassReviewProviderError as confirmed and maps its original local code', async () => {
    const admission = new ProviderAdmissionController({
      hardLimit: 2, stableSuccessWindow: 1, now: () => 0,
    })
    const response = await harness({
      mode: 'kimi',
      provider: provider(async () => {
        throw new ClassReviewProviderError(
          'class_review_prompt_calibration_missing', 'safe', false, undefined,
          { termination: 'confirmed' },
        )
      }),
      admission,
    }).service.synthesize({ request: requestFixture(), receivedAt: 0, httpDeadlineMs: 100 })
    expect(response).toMatchObject({
      httpStatus: 503,
      result: {
        status: 'failed', safeFailureCode: 'class_review_prompt_calibration_missing',
        retryable: false, completionDisposition: 'not_started',
      },
    })
    expect(admission.snapshot()).toMatchObject({
      target: 1, stableSuccesses: 0, activeLeases: 0, pauseReason: null,
    })
  })

  it('maps every admission rejection exactly, including hard limit and operations long-pause', async () => {
    let now = 0
    let leaseId = 0
    const admission = new ProviderAdmissionController({
      hardLimit: 2, stableSuccessWindow: 1, now: () => now,
      idFactory: () => `busy-${++leaseId}`,
    })
    const grow = admission.tryAcquire()
    if (!grow.accepted) throw new Error('growth lease rejected')
    grow.lease.release({ kind: 'success' })
    const first = admission.tryAcquire()
    const second = admission.tryAcquire()
    if (!first.accepted || !second.accepted) throw new Error('hard-limit setup rejected')
    const blocked = await harness({
      provider: provider(async () => { throw new Error('must not execute') }),
      admission,
      now: () => now,
    }).service.synthesize({ request: requestFixture(), receivedAt: 0, httpDeadlineMs: 100 })
    expect(blocked).toMatchObject({
      httpStatus: 429,
      result: {
        safeFailureCode: 'provider_rate_limited', retryable: true,
        retryAfterMs: null, completionDisposition: 'not_started',
      },
    })
    first.lease.release({ kind: 'confirmed_failure' })
    second.lease.release({ kind: 'confirmed_failure' })

    admission.pause('long_retry_after')
    const longPause = await harness({
      provider: provider(async () => { throw new Error('must not execute') }),
      admission,
      now: () => now,
    }).service.synthesize({ request: requestFixture(), receivedAt: 0, httpDeadlineMs: 100 })
    expect(longPause).toMatchObject({
      httpStatus: 503,
      result: {
        safeFailureCode: 'provider_rate_limited', retryable: false,
        retryAfterMs: null, completionDisposition: 'not_started',
      },
    })
    now += 1
  })

  it('distinguishes caller timeout before dispatch from Provider result unknown', async () => {
    const synthesize = vi.fn(async () => ({
      value: fixture.results.succeeded.output,
      attempts: [observation()],
    }))
    const beforeDispatch = await harness({
      provider: provider(synthesize), now: () => 10,
    }).service.synthesize({ request: requestFixture(), receivedAt: 0, httpDeadlineMs: 10 })
    expect(beforeDispatch).toMatchObject({
      httpStatus: 503,
      result: {
        status: 'failed', safeFailureCode: 'provider_timeout', retryable: true,
        completionDisposition: 'not_started',
      },
    })
    expect(synthesize).not.toHaveBeenCalled()

    const unknownHarness = harness({
      provider: provider(async () => {
        throw new GradingProviderError('provider_unavailable', 'safe', true, undefined, {
          termination: 'unknown',
        })
      }),
    })
    const unknown = await unknownHarness.service.synthesize({
      request: requestFixture(), receivedAt: 0, httpDeadlineMs: 100,
    })
    expect(unknown.result).toEqual({
      ...fixture.results.resultUnknown,
      timingsMs: unknown.result.timingsMs,
    })
    expect(unknown.httpStatus).toBe(503)
    expect(unknownHarness.oneShot.snapshot()).toEqual({ inFlight: 0, orphanedUnknown: 1 })
  })

  it('records each actual completion once and one content-free operation metric', async () => {
    const metrics: unknown[] = []
    const telemetry = createProviderTelemetryRecorder({
      emit: (metric) => metrics.push(metric),
      processDiagnosticIdFactory: () => '33333333-3333-4333-8333-333333333333',
    })
    await harness({
      provider: provider(async () => ({
        value: fixture.results.succeeded.output,
        attempts: [observation()],
      })),
      telemetry,
    }).service.synthesize({ request: requestFixture(), receivedAt: 0, httpDeadlineMs: 100 })
    expect(metrics.filter((metric) => (metric as { event?: string }).event === 'provider_attempt')).toHaveLength(1)
    expect(metrics.filter((metric) => (
      (metric as { event?: string; stage?: string }).event === 'provider_operation'
      && (metric as { stage?: string }).stage === 'class_review_generation'
    ))).toHaveLength(1)
  })

  it('measures total time from receipt and accumulates preflight validation before admission', async () => {
    let now = 10
    const response = await harness({
      now: () => now,
      tokenizer: {
        count() {
          now += 3
          return 100
        },
      },
      provider: provider(async () => {
        now += 5
        return {
          value: fixture.results.succeeded.output,
          attempts: [observation(undefined, { providerElapsedMs: 5 })],
        }
      }),
    }).service.synthesize({ request: requestFixture(), receivedAt: 2, httpDeadlineMs: 100 })

    expect(response.result.timingsMs).toEqual({
      queueMs: 0,
      providerMs: 5,
      validationMs: 9,
      totalMs: 22,
    })
  })

  it('rejects invalid receipt/deadline timing before preflight or Provider execution', async () => {
    const synthesize = vi.fn(async () => ({
      value: fixture.results.succeeded.output,
      attempts: [observation()],
    }))
    const service = harness({ provider: provider(synthesize), now: () => 10 }).service
    await expect(service.synthesize({
      request: requestFixture(), receivedAt: 11, httpDeadlineMs: 100,
    })).rejects.toThrow(/timing/i)
    await expect(service.synthesize({
      request: requestFixture(), receivedAt: 10, httpDeadlineMs: 0,
    })).rejects.toThrow(/timing/i)
    expect(synthesize).not.toHaveBeenCalled()
  })

  it('constructs Kimi transport only from the normalized runtime secret snapshot', () => {
    const runtime = parseGatewayRuntimeConfig({
      GRADING_PROVIDER: 'mock',
      GRADING_RUBRIC_STRATEGY: 'two-pass-legacy',
      GRADING_ESSAY_PROMPT_PROFILE: 'legacy',
      GRADING_EXECUTION_REGISTRY: 'memory-v1',
      GRADING_MAX_CONCURRENT_PROVIDER_CALLS: '1',
      GRADING_HTTP_DEADLINE_MS: '360000',
      GRADING_PROVIDER_FINAL_DEADLINE_MS: '420000',
      GRADING_PROVIDER_SETTLEMENT_GRACE_MS: '30000',
      GRADING_REGISTRY_TERMINAL_TTL_MS: '86400000',
      GRADING_REGISTRY_MAX_ENTRIES: '2000',
      GRADING_PROVIDER_MAX_ATTEMPTS: '2',
      GRADING_RATE_LIMIT_MAX_REQUEUES: '5',
      GRADING_RETRY_BASE_MS: '2000',
      GRADING_RETRY_CAP_MS: '60000',
      GRADING_RETRY_AFTER_PAUSE_MS: '900000',
      CLASS_REVIEW_SYNTHESIS_MODE: 'kimi',
      CLASS_REVIEW_SERVICE_TOKEN: 's'.repeat(32),
      GRADING_PROMPT_CACHE_HMAC_SECRET: `  ${'c'.repeat(32)}  `,
      KIMI_API_BASE: 'https://api.moonshot.cn/v1',
      KIMI_MODEL: 'kimi-k3',
      KIMI_REASONING_EFFORT: 'low',
      KIMI_API_KEY: '  synthetic-not-a-real-key  ',
      KIMI_MAX_COMPLETION_TOKENS_CLASS_REVIEW: '3072',
      KIMI_MAX_COMPLETION_TOKENS_MATERIAL_CONTEXT: '16384',
      KIMI_MAX_COMPLETION_TOKENS_RUBRIC_GENERATION: '16384',
      KIMI_MAX_COMPLETION_TOKENS_ESSAY_GRADING_IMAGES: '16384',
      KIMI_MAX_COMPLETION_TOKENS_ESSAY_REGRADING_TEXT: '16384',
    }, { classReviewFramingCalibration: calibration })
    const transportFactory = vi.fn(() => ({ complete: vi.fn() }))

    expect(runtime.kimi.promptCacheSecret).toBe('c'.repeat(32))

    createClassReviewSynthesisProviderForRuntime(runtime, { kimiTransportFactory: transportFactory })

    expect(transportFactory).toHaveBeenCalledWith({
      apiKey: 'synthetic-not-a-real-key',
      apiBase: 'https://api.moonshot.cn/v1',
      model: 'kimi-k3',
      reasoningEffort: 'low',
      maxCompletionTokens: 3_072,
    })
    expect(JSON.stringify(transportFactory.mock.calls)).not.toContain('  synthetic-not-a-real-key  ')
  })
})
