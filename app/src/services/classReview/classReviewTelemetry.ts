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
      const suppliedKeys = Object.keys(input)
      const hasExactKeys = suppliedKeys.length === KEYS.length
        && suppliedKeys.every((key) => (KEYS as readonly string[]).includes(key))
      const hasValidEnums = input.stage === 'class_review_generation'
        && LIFECYCLES.has(input.lifecycle)
        && OUTCOMES.has(input.outcome)
        && (input.safeFailureCode === null || FAILURES.has(input.safeFailureCode))
      if (!hasExactKeys || !hasValidEnums) throw new Error('class_review_telemetry_invalid')

      const countsAndDurations = [
        input.includedEssayCount,
        input.excludedEssayCount,
        input.eligibleGroupCount,
        input.projectedGroupCount,
        input.eligibleDistinctEssaySupportSum,
        input.projectedDistinctEssaySupportSum,
        input.eligibleOccurrenceSum,
        input.projectedOccurrenceSum,
        input.queueMs,
        input.providerMs,
        input.validationMs,
        input.totalMs,
      ]
      const durations = [input.queueMs, input.providerMs, input.validationMs, input.totalMs]
      const hasInvalidInteger = countsAndDurations.some(
        (value) => !Number.isSafeInteger(value) || value < 0,
      )
      const hasExcessiveDuration = durations.some((value) => value > 86_400_000)
      const hasInvalidCoverage = input.projectedGroupCount > input.eligibleGroupCount
        || input.projectedDistinctEssaySupportSum > input.eligibleDistinctEssaySupportSum
        || input.projectedOccurrenceSum > input.eligibleOccurrenceSum
      const hasInvalidStageDuration = input.queueMs > input.totalMs
        || input.providerMs > input.totalMs
        || input.validationMs > input.totalMs
      const successfulOutcome = input.outcome === 'succeeded'
        || input.outcome === 'succeeded_unapplied'
        || input.outcome === 'discarded'
      const hasInvalidFailure = successfulOutcome
        ? input.safeFailureCode !== null
        : input.outcome === 'result_unknown'
          ? input.safeFailureCode !== 'provider_result_unknown'
          : input.safeFailureCode === null
      if (
        hasInvalidInteger
        || hasExcessiveDuration
        || hasInvalidCoverage
        || hasInvalidStageDuration
        || hasInvalidFailure
      ) {
        throw new Error('class_review_telemetry_invalid')
      }

      emit({
        stage: input.stage,
        lifecycle: input.lifecycle,
        outcome: input.outcome,
        safeFailureCode: input.safeFailureCode,
        includedEssayCount: input.includedEssayCount,
        excludedEssayCount: input.excludedEssayCount,
        eligibleGroupCount: input.eligibleGroupCount,
        projectedGroupCount: input.projectedGroupCount,
        eligibleDistinctEssaySupportSum: input.eligibleDistinctEssaySupportSum,
        projectedDistinctEssaySupportSum: input.projectedDistinctEssaySupportSum,
        eligibleOccurrenceSum: input.eligibleOccurrenceSum,
        projectedOccurrenceSum: input.projectedOccurrenceSum,
        queueMs: input.queueMs,
        providerMs: input.providerMs,
        validationMs: input.validationMs,
        totalMs: input.totalMs,
      })
    },
  }
}
