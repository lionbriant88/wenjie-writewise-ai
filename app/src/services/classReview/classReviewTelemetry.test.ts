import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createClassReviewTelemetry, type ClassReviewTelemetryEvent } from './classReviewTelemetry'

describe('class review telemetry', () => {
  it('emits exactly fixed aggregate lifecycle fields and bounded integer durations', () => {
    const emit = vi.fn()
    const telemetry = createClassReviewTelemetry(emit)
    const event = { stage: 'class_review_generation', lifecycle: 'completed', outcome: 'succeeded', safeFailureCode: null, includedEssayCount: 4, excludedEssayCount: 1, eligibleGroupCount: 3, projectedGroupCount: 2, eligibleDistinctEssaySupportSum: 6, projectedDistinctEssaySupportSum: 4, eligibleOccurrenceSum: 9, projectedOccurrenceSum: 7, queueMs: 1, providerMs: 2, validationMs: 3, totalMs: 6 } as const
    telemetry.record(event)
    expect(emit).toHaveBeenCalledWith(event)
  })

  it('rejects unknown enums, unbounded durations and any content/identity aliases', () => {
    const telemetry = createClassReviewTelemetry(() => undefined)
    expect(() => telemetry.record({ lifecycle: 'secret' } as never)).toThrow('class_review_telemetry_invalid')
    const safe = { stage: 'class_review_generation', lifecycle: 'completed', outcome: 'failed', safeFailureCode: 'provider_auth_failed', includedEssayCount: 1, excludedEssayCount: 0, eligibleGroupCount: 1, projectedGroupCount: 1, eligibleDistinctEssaySupportSum: 1, projectedDistinctEssaySupportSum: 1, eligibleOccurrenceSum: 1, projectedOccurrenceSum: 1, queueMs: 0, providerMs: 1, validationMs: 0, totalMs: 1 }
    expect(() => telemetry.record({ ...safe, providerMs: Number.MAX_SAFE_INTEGER, totalMs: Number.MAX_SAFE_INTEGER } as never)).toThrow('class_review_telemetry_invalid')
    expect(() => telemetry.record({ ...safe, taskId: 'task', studentName: 'name', generationId: 'g', groupAlias: 'alias', excerpt: 'text', prompt: 'secret', rawError: new Error('secret'), apiKey: 'secret' } as never)).toThrow('class_review_telemetry_invalid')
  })

  it('uses literal lifecycle/outcome unions and rejects impossible coverage, timing and outcome/failure combinations', () => {
    expectTypeOf<ClassReviewTelemetryEvent['lifecycle']>().toEqualTypeOf<'reserved' | 'running' | 'completed' | 'invalidated'>()
    expectTypeOf<ClassReviewTelemetryEvent['outcome']>().toEqualTypeOf<'succeeded' | 'failed' | 'result_unknown' | 'succeeded_unapplied' | 'discarded'>()
    const telemetry = createClassReviewTelemetry(() => undefined)
    const safe = { stage: 'class_review_generation', lifecycle: 'completed', outcome: 'succeeded', safeFailureCode: null, includedEssayCount: 4, excludedEssayCount: 0, eligibleGroupCount: 2, projectedGroupCount: 2, eligibleDistinctEssaySupportSum: 4, projectedDistinctEssaySupportSum: 4, eligibleOccurrenceSum: 5, projectedOccurrenceSum: 5, queueMs: 1, providerMs: 2, validationMs: 1, totalMs: 4 } as const
    expect(() => telemetry.record({ ...safe, projectedGroupCount: 3 } as ClassReviewTelemetryEvent)).toThrow('class_review_telemetry_invalid')
    expect(() => telemetry.record({ ...safe, projectedDistinctEssaySupportSum: 5 } as ClassReviewTelemetryEvent)).toThrow('class_review_telemetry_invalid')
    expect(() => telemetry.record({ ...safe, projectedOccurrenceSum: 6 } as ClassReviewTelemetryEvent)).toThrow('class_review_telemetry_invalid')
    expect(() => telemetry.record({ ...safe, providerMs: 5 } as ClassReviewTelemetryEvent)).toThrow('class_review_telemetry_invalid')
    expect(() => telemetry.record({ ...safe, safeFailureCode: 'provider_invalid_response' } as ClassReviewTelemetryEvent)).toThrow('class_review_telemetry_invalid')
    expect(() => telemetry.record({ ...safe, outcome: 'failed', safeFailureCode: null } as ClassReviewTelemetryEvent)).toThrow('class_review_telemetry_invalid')
    expect(() => telemetry.record({ ...safe, outcome: 'result_unknown', safeFailureCode: 'provider_auth_failed' } as ClassReviewTelemetryEvent)).toThrow('class_review_telemetry_invalid')
  })
})
