import type { SafeFailureCode } from './types'

const KEYS = [
  'stage',
  'lifecycle',
  'outcome',
  'safeFailureCode',
  'includedEssayCount',
  'excludedEssayCount',
  'eligibleGroupCount',
  'projectedGroupCount',
  'eligibleDistinctEssaySupportSum',
  'projectedDistinctEssaySupportSum',
  'eligibleOccurrenceSum',
  'projectedOccurrenceSum',
  'queueMs',
  'providerMs',
  'validationMs',
  'totalMs',
] as const
type ClassReviewTelemetryLifecycle = 'reserved' | 'running' | 'completed' | 'invalidated'
type ClassReviewTelemetryOutcome = 'succeeded' | 'failed' | 'result_unknown' | 'succeeded_unapplied' | 'discarded'
const LIFECYCLES = new Set<ClassReviewTelemetryLifecycle>([
  'reserved',
  'running',
  'completed',
  'invalidated',
])
const OUTCOMES = new Set<ClassReviewTelemetryOutcome>([
  'succeeded',
  'failed',
  'result_unknown',
  'succeeded_unapplied',
  'discarded',
])
const FAILURES = new Set<SafeFailureCode>([
  'class_review_not_eligible',
  'active_generation_conflict',
  'class_review_candidate_conflict',
  'class_review_source_invalidated',
  'class_review_task_invalidated',
  'class_review_projection_too_large',
  'class_review_prompt_too_large',
  'class_review_prompt_calibration_missing',
  'class_review_prompt_contract_drift',
  'provider_not_configured',
  'provider_request_rejected',
  'provider_auth_failed',
  'provider_balance_unavailable',
  'provider_rate_limited',
  'provider_timeout',
  'provider_result_unknown',
  'provider_unavailable',
  'provider_content_filtered',
  'provider_unexpected_tool_call',
  'provider_invalid_response',
])

export interface ClassReviewTelemetryEvent {
  stage: 'class_review_generation'
  lifecycle: ClassReviewTelemetryLifecycle
  outcome: ClassReviewTelemetryOutcome
  safeFailureCode: SafeFailureCode | null
  includedEssayCount: number
  excludedEssayCount: number
  eligibleGroupCount: number
  projectedGroupCount: number
  eligibleDistinctEssaySupportSum: number
  projectedDistinctEssaySupportSum: number
  eligibleOccurrenceSum: number
  projectedOccurrenceSum: number
  queueMs: number
  providerMs: number
  validationMs: number
  totalMs: number
}

export function createClassReviewTelemetry(emit: (event: ClassReviewTelemetryEvent) => void) {
  return {
    record(input: ClassReviewTelemetryEvent) {
      const descriptors = new Map<PropertyKey, PropertyDescriptor>()
      let suppliedKeys: PropertyKey[]
      try {
        suppliedKeys = Reflect.ownKeys(input)
        for (const key of suppliedKeys) {
          const descriptor = Object.getOwnPropertyDescriptor(input, key)
          if (!descriptor) throw new Error('class_review_telemetry_invalid')
          descriptors.set(key, descriptor)
        }
      } catch {
        throw new Error('class_review_telemetry_invalid')
      }
      const hasExactKeys = suppliedKeys.length === KEYS.length
        && suppliedKeys.every((key) => typeof key === 'string' && (KEYS as readonly string[]).includes(key))
        && KEYS.every((key) => {
          const descriptor = descriptors.get(key)
          return descriptor !== undefined && descriptor.enumerable === true
            && 'value' in descriptor && descriptor.get === undefined && descriptor.set === undefined
        })
      if (!hasExactKeys) throw new Error('class_review_telemetry_invalid')
      const value = Object.fromEntries(KEYS.map((key) => [key, descriptors.get(key)!.value])) as ClassReviewTelemetryEvent
      const hasValidEnums = value.stage === 'class_review_generation'
        && LIFECYCLES.has(value.lifecycle)
        && OUTCOMES.has(value.outcome)
        && (value.safeFailureCode === null || FAILURES.has(value.safeFailureCode))
      if (!hasValidEnums) throw new Error('class_review_telemetry_invalid')

      const countsAndDurations = [
        value.includedEssayCount, value.excludedEssayCount,
        value.eligibleGroupCount, value.projectedGroupCount,
        value.eligibleDistinctEssaySupportSum, value.projectedDistinctEssaySupportSum,
        value.eligibleOccurrenceSum, value.projectedOccurrenceSum,
        value.queueMs, value.providerMs, value.validationMs, value.totalMs,
      ]
      const durations = [value.queueMs, value.providerMs, value.validationMs, value.totalMs]
      const hasInvalidInteger = countsAndDurations.some(
        (value) => !Number.isSafeInteger(value) || value < 0,
      )
      const hasExcessiveDuration = durations.some((value) => value > 86_400_000)
      const hasInvalidCoverage = value.projectedGroupCount > value.eligibleGroupCount
        || value.projectedDistinctEssaySupportSum > value.eligibleDistinctEssaySupportSum
        || value.projectedOccurrenceSum > value.eligibleOccurrenceSum
      const hasInvalidStageDuration = value.queueMs > value.totalMs
        || value.providerMs > value.totalMs
        || value.validationMs > value.totalMs
      const successfulOutcome = value.outcome === 'succeeded'
        || value.outcome === 'succeeded_unapplied'
        || value.outcome === 'discarded'
      const hasInvalidFailure = successfulOutcome
        ? value.safeFailureCode !== null
        : value.outcome === 'result_unknown'
          ? value.safeFailureCode !== 'provider_result_unknown'
          : value.safeFailureCode === null
      const isInvalidationFailure = value.safeFailureCode === 'class_review_source_invalidated'
        || value.safeFailureCode === 'class_review_task_invalidated'
      const legalLifecycle = value.lifecycle === 'reserved'
        ? value.outcome === 'failed' && !isInvalidationFailure
        : value.lifecycle === 'running'
          ? (value.outcome === 'failed' || value.outcome === 'result_unknown')
            && !isInvalidationFailure
          : value.lifecycle === 'completed'
            ? (value.outcome === 'succeeded'
              || value.outcome === 'succeeded_unapplied'
              || value.outcome === 'discarded'
              || value.outcome === 'failed')
              && !isInvalidationFailure
            : value.outcome === 'failed' && isInvalidationFailure
      if (
        hasInvalidInteger
        || hasExcessiveDuration
        || hasInvalidCoverage
        || hasInvalidStageDuration
        || hasInvalidFailure
        || !legalLifecycle
      ) {
        throw new Error('class_review_telemetry_invalid')
      }

      emit(Object.freeze({ ...value }))
    },
  }
}
