import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { OneShotProviderExecutionTracker } from '../oneShotProviderExecution.js'
import { ProviderAdmissionController } from '../providerAdmissionController.js'
import type { ProviderAttemptObservation, ProviderUsageSnapshot } from '../providers/providerTypes.js'
import { validateClassReviewSynthesisRequest } from './validateRequest.js'
import { createProviderTelemetryRecorder } from '../providerTelemetry.js'
import type { ClassReviewFramingCalibration } from './framingCalibrations.js'
import { ClassReviewSynthesisService } from './service.js'
import {
  ClassReviewPromptContractDriftError,
  ClassReviewRuntimeInvariant,
} from './runtimeInvariant.js'

function usage(promptTokens: ProviderUsageSnapshot['promptTokens']): ProviderUsageSnapshot {
  return {
    promptTokens,
    completionTokens: { status: 'known', value: 10 },
    totalTokens: promptTokens.status === 'known'
      ? { status: 'known', value: promptTokens.value + 10 }
      : { status: 'unknown', reason: 'inconsistent' },
    cachedTokens: { status: 'unknown', reason: 'absent' },
  }
}

function observation(
  id: string,
  promptTokens: ProviderUsageSnapshot['promptTokens'],
): ProviderAttemptObservation {
  return {
    attemptDiagnosticId: id,
    finishReason: 'stop',
    usage: usage(promptTokens),
    providerElapsedMs: 2,
  }
}

describe('class-review real-Kimi prompt invariant', () => {
  it('accepts the exact 16,384 boundary and latches only a known safe-integer excess', () => {
    const invariant = new ClassReviewRuntimeInvariant()
    expect(invariant.inspectAttempts('kimi', [
      observation('11111111-1111-4111-8111-111111111111', { status: 'known', value: 16_384 }),
    ])).toBe(true)
    expect(invariant.snapshot()).toEqual({ promptContract: 'ready' })

    expect(() => invariant.inspectAttempts('kimi', [
      observation('22222222-2222-4222-8222-222222222222', { status: 'known', value: 16_385 }),
    ])).toThrowError(ClassReviewPromptContractDriftError)
    expect(invariant.snapshot()).toEqual({ promptContract: 'drifted' })
    expect(() => invariant.assertCanDispatch('kimi')).toThrowError(
      ClassReviewPromptContractDriftError,
    )
  })

  it('does not treat unknown or forged invalid counts as proof of compliance or as drift', () => {
    const invariant = new ClassReviewRuntimeInvariant()
    expect(invariant.inspectAttempts('kimi', [
      observation('33333333-3333-4333-8333-333333333333', { status: 'unknown', reason: 'absent' }),
      observation('44444444-4444-4444-8444-444444444444', {
        status: 'known', value: 16_385.5,
      } as ProviderUsageSnapshot['promptTokens']),
    ])).toBe(false)
    expect(invariant.snapshot()).toEqual({ promptContract: 'ready' })
  })

  it('makes fake observations a no-op that cannot trigger or clear the process latch', () => {
    const invariant = new ClassReviewRuntimeInvariant()
    expect(invariant.inspectAttempts('fake', [
      observation('55555555-5555-4555-8555-555555555555', { status: 'known', value: 16_385 }),
    ])).toBeUndefined()
    expect(invariant.snapshot()).toEqual({ promptContract: 'ready' })

    expect(() => invariant.inspectAttempts('kimi', [
      observation('66666666-6666-4666-8666-666666666666', { status: 'known', value: 16_385 }),
    ])).toThrowError(ClassReviewPromptContractDriftError)
    expect(invariant.inspectAttempts('fake', [
      observation('77777777-7777-4777-8777-777777777777', { status: 'known', value: 10 }),
    ])).toBeUndefined()
    expect(() => invariant.assertCanDispatch('fake')).not.toThrow()
    expect(invariant.snapshot()).toEqual({ promptContract: 'drifted' })
  })

  it('deduplicates attempt IDs before evaluating observations', () => {
    const invariant = new ClassReviewRuntimeInvariant()
    const id = '88888888-8888-4888-8888-888888888888'
    expect(invariant.inspectAttempts('kimi', [
      observation(id, { status: 'known', value: 16_384 }),
      observation(id, { status: 'known', value: 16_385 }),
    ])).toBe(true)
    expect(invariant.snapshot()).toEqual({ promptContract: 'ready' })
  })

  it('converts an invalid-schema over-budget real attempt to drift and stops the next call before shared admission', async () => {
    const fixture = JSON.parse(readFileSync(
      new URL('../../../test-fixtures/class-review/synthesis-contracts.json', import.meta.url),
      'utf8',
    )) as { requests: { withGroups: unknown }; results: { succeeded: { output: Record<string, unknown> } } }
    const parsed = validateClassReviewSynthesisRequest(fixture.requests.withGroups)
    if (!parsed.ok) throw new Error(`invalid fixture ${parsed.error.path}`)
    const calibration: ClassReviewFramingCalibration = {
      apiBase: 'https://api.moonshot.cn/v1', model: 'kimi-k3', reasoningEffort: 'low',
      policyVersion: 'class-review-policy-v1', schemaVersion: 'kimi-class-review-output-v1',
      projectionVersion: 'class-review-projection-v1', budgetVersion: 'class-review-prompt-budget-v1',
      wireSerializationVersion: 'class-review-wire-serialization-v1', framingTokens: 512,
    }
    let leaseIds = 0
    const admission = new ProviderAdmissionController({
      hardLimit: 1, now: () => 0, idFactory: () => `drift-lease-${++leaseIds}`,
    })
    const oneShot = new OneShotProviderExecutionTracker({
      admission, providerFinalDeadlineMs: 200, settlementGraceMs: 20,
      retryAfterPauseMs: 900_000, now: () => 0,
    })
    let providerCalls = 0
    let tokenizerCalls = 0
    const metrics: unknown[] = []
    const invalidOutput = { ...fixture.results.succeeded.output, unexpected: true }
    const invariant = new ClassReviewRuntimeInvariant()
    const service = new ClassReviewSynthesisService({
      mode: 'kimi',
      provider: {
        async synthesize() {
          providerCalls += 1
          return {
            value: invalidOutput as never,
            attempts: [observation(
              '99999999-9999-4999-8999-999999999999',
              { status: 'known', value: 16_385 },
            )],
          }
        },
      },
      admission,
      oneShot,
      calibration,
      tokenizer: { count: () => { tokenizerCalls += 1; return 100 } },
      hmacSecret: '0123456789abcdef0123456789abcdef',
      runtimeInvariant: invariant,
      providerTelemetry: createProviderTelemetryRecorder({
        emit: (metric) => metrics.push(metric),
        processDiagnosticIdFactory: () => 'abababab-abab-4bab-8bab-abababababab',
      }),
      monotonicNow: () => 0,
      diagnosticIdFactory: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })

    const first = await service.synthesize({
      request: parsed.value, receivedAt: 0, httpDeadlineMs: 100,
    })
    expect(first).toMatchObject({
      httpStatus: 503,
      result: {
        status: 'failed', safeFailureCode: 'class_review_prompt_contract_drift',
        retryable: false, completionDisposition: 'completed', finishReason: 'stop',
        usage: {
          promptTokens: 16_385, completionTokens: 10, totalTokens: 16_395,
          cachedTokens: null,
        },
      },
    })
    expect(admission.snapshot()).toMatchObject({ activeLeases: 0, pauseReason: null })

    const tokenizerCallsAfterFirst = tokenizerCalls
    const second = await service.synthesize({
      request: parsed.value, receivedAt: 0, httpDeadlineMs: 100,
    })
    expect(second).toMatchObject({
      httpStatus: 503,
      result: {
        status: 'failed', safeFailureCode: 'class_review_prompt_contract_drift',
        retryable: false, completionDisposition: 'not_started',
      },
    })
    expect(providerCalls).toBe(1)
    expect(leaseIds).toBe(1)
    expect(tokenizerCalls).toBe(tokenizerCallsAfterFirst)
    expect(metrics.filter((metric) => (
      (metric as { event?: string }).event === 'provider_attempt'
    ))).toHaveLength(1)

    const essayLease = admission.tryAcquire()
    expect(essayLease.accepted).toBe(true)
    if (essayLease.accepted) essayLease.lease.release({ kind: 'confirmed_failure' })
  })
})
