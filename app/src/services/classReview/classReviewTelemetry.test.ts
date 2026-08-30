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
    expect(() => telemetry.record({ ...safe, lifecycle: 'reserved', outcome: 'succeeded' } as ClassReviewTelemetryEvent)).toThrow('class_review_telemetry_invalid')
    expect(() => telemetry.record({ ...safe, lifecycle: 'invalidated', outcome: 'discarded' } as ClassReviewTelemetryEvent)).toThrow('class_review_telemetry_invalid')
    expect(() => telemetry.record({ ...safe, lifecycle: 'invalidated', outcome: 'failed', safeFailureCode: 'provider_auth_failed' } as ClassReviewTelemetryEvent)).toThrow('class_review_telemetry_invalid')
  })

  it('inspects own data descriptors without invoking accessors and emits one frozen plain snapshot', () => {
    const emit = vi.fn()
    const telemetry = createClassReviewTelemetry(emit)
    let getterCalls = 0
    const accessor = Object.defineProperty({}, 'stage', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'class_review_generation'
      },
    })
    expect(() => telemetry.record(accessor as ClassReviewTelemetryEvent)).toThrow('class_review_telemetry_invalid')
    expect(getterCalls).toBe(0)
    expect(emit).not.toHaveBeenCalled()

    const event: ClassReviewTelemetryEvent = { stage: 'class_review_generation', lifecycle: 'completed', outcome: 'succeeded', safeFailureCode: null, includedEssayCount: 4, excludedEssayCount: 1, eligibleGroupCount: 3, projectedGroupCount: 2, eligibleDistinctEssaySupportSum: 6, projectedDistinctEssaySupportSum: 4, eligibleOccurrenceSum: 9, projectedOccurrenceSum: 7, queueMs: 1, providerMs: 2, validationMs: 3, totalMs: 6 }
    telemetry.record(event)
    const emitted = emit.mock.calls[0][0] as ClassReviewTelemetryEvent
    expect(emitted).toEqual(event)
    expect(emitted).not.toBe(event)
    expect(Object.isFrozen(emitted)).toBe(true)

    const descriptorReads = new Map<PropertyKey, number>()
    let ownKeyReads = 0
    let directReads = 0
    const guarded = new Proxy(event, {
      ownKeys: (target) => {
        ownKeyReads += 1
        return Reflect.ownKeys(target)
      },
      getOwnPropertyDescriptor(target, key) {
        descriptorReads.set(key, (descriptorReads.get(key) ?? 0) + 1)
        return Reflect.getOwnPropertyDescriptor(target, key)
      },
      get(target, key, receiver) {
        directReads += 1
        return Reflect.get(target, key, receiver)
      },
    })
    telemetry.record(guarded)
    expect(ownKeyReads).toBe(1)
    expect([...descriptorReads.values()]).toEqual(Array.from({ length: 16 }, () => 1))
    expect(directReads).toBe(0)
  })

  it.each([
    {
      name: 'completed result-unknown',
      lifecycle: 'completed' as const,
      outcome: 'result_unknown' as const,
      safeFailureCode: 'provider_result_unknown' as const,
    },
    {
      name: 'running source invalidation',
      lifecycle: 'running' as const,
      outcome: 'failed' as const,
      safeFailureCode: 'class_review_source_invalidated' as const,
    },
    {
      name: 'completed task invalidation',
      lifecycle: 'completed' as const,
      outcome: 'failed' as const,
      safeFailureCode: 'class_review_task_invalidated' as const,
    },
  ])('rejects illegal bidirectional lifecycle tuple: $name', (tuple) => {
    const emit = vi.fn()
    const telemetry = createClassReviewTelemetry(emit)
    const event: ClassReviewTelemetryEvent = {
      stage: 'class_review_generation',
      lifecycle: tuple.lifecycle,
      outcome: tuple.outcome,
      safeFailureCode: tuple.safeFailureCode,
      includedEssayCount: 4,
      excludedEssayCount: 0,
      eligibleGroupCount: 2,
      projectedGroupCount: 2,
      eligibleDistinctEssaySupportSum: 4,
      projectedDistinctEssaySupportSum: 4,
      eligibleOccurrenceSum: 5,
      projectedOccurrenceSum: 5,
      queueMs: 1,
      providerMs: 2,
      validationMs: 1,
      totalMs: 4,
    }
    expect(() => telemetry.record(event)).toThrow('class_review_telemetry_invalid')
    expect(emit).not.toHaveBeenCalled()
  })

  it.each(['reserved', 'running', 'completed'] as const)(
    'never accepts provider_result_unknown as a failed code in %s lifecycle',
    (lifecycle) => {
      const emit = vi.fn()
      const telemetry = createClassReviewTelemetry(emit)
      const event: ClassReviewTelemetryEvent = {
        stage: 'class_review_generation',
        lifecycle,
        outcome: 'failed',
        safeFailureCode: 'provider_result_unknown',
        includedEssayCount: 4,
        excludedEssayCount: 0,
        eligibleGroupCount: 2,
        projectedGroupCount: 2,
        eligibleDistinctEssaySupportSum: 4,
        projectedDistinctEssaySupportSum: 4,
        eligibleOccurrenceSum: 5,
        projectedOccurrenceSum: 5,
        queueMs: 1,
        providerMs: 2,
        validationMs: 1,
        totalMs: 4,
      }

      expect(() => telemetry.record(event)).toThrow('class_review_telemetry_invalid')
      expect(emit).not.toHaveBeenCalled()
    },
  )

  it('fails closed on ownKeys or descriptor traps without emitting', () => {
    const emit = vi.fn()
    const telemetry = createClassReviewTelemetry(emit)
    const ownKeysTrap = new Proxy({}, { ownKeys: () => { throw new Error('secret-own-keys') } })
    const descriptorTrap = new Proxy({ stage: 'class_review_generation' }, { getOwnPropertyDescriptor: () => { throw new Error('secret-descriptor') } })
    expect(() => telemetry.record(ownKeysTrap as ClassReviewTelemetryEvent)).toThrow('class_review_telemetry_invalid')
    expect(() => telemetry.record(descriptorTrap as ClassReviewTelemetryEvent)).toThrow('class_review_telemetry_invalid')
    expect(emit).not.toHaveBeenCalled()
  })
})
