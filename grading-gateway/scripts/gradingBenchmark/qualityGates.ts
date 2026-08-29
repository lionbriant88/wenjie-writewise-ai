export type QualityGateStatus = 'pass' | 'fail' | 'not_measurable'
export type QualityConclusion = 'pass' | 'fail' | 'inconclusive'

export interface QualityGateResult {
  status: QualityGateStatus
  actual: number | null
  threshold: number | null
  reason?: string
}

export interface DegradationIntervalInput {
  lower: number
  upper: number
}

export interface RecallComparisonInput {
  baseline: number | null
  candidate: number | null
}

export interface StructuredSuccessCounts {
  accepted: number
  total: number
}

export interface StructuredSuccessInput {
  baseline: StructuredSuccessCounts
  candidate: StructuredSuccessCounts
}

export interface BlindReviewInput {
  sampleCount: number
  reviewedSampleCount: number
  randomizedAB: boolean
  secondaryReviewSampleCount: number
  reviewerRelationship: 'independent_teacher' | 'same_teacher_delayed'
  sameTeacherReviewIntervalDays: number | null
  unresolvedArbitrations: number
  systematicDegradation: boolean
}

export interface QualityGateInput {
  structuredSuccess?: StructuredSuccessInput
  tokenMedians?: {
    baseline: number | null
    candidate: number | null
  }
  cerDegradation95?: DegradationIntervalInput
  scoreErrorDegradation95?: DegradationIntervalInput
  importantIssueRecall?: RecallComparisonInput
  importantLegibilityRecall?: RecallComparisonInput
  evidence?: {
    uniquelyLocated: number
    total: number
  }
  hardRisks?: {
    studentMix: number
    wrongTaskContext: number
    highRiskLegibilityMiss: number
    piiLeakage: number
  }
  soak?: {
    totalCalls: number
    contractFailures: number
  }
  throughput?: {
    essayCount: number
    baselineElapsedMs: number
    candidateElapsedMs: number
    effectiveConcurrency: number
  }
  blindReview?: BlindReviewInput
}

export type QualityGateName =
  | 'structuredSuccess'
  | 'tokenReduction'
  | 'cerDegradation'
  | 'scoreErrorDegradation'
  | 'importantIssueRecall'
  | 'importantLegibilityRecall'
  | 'evidenceLocation'
  | 'hardRisks'
  | 'soak'
  | 'throughput'
  | 'blindReview'

export interface QualityGateReport {
  status: QualityConclusion
  gates: Record<QualityGateName, QualityGateResult>
}

const TOKEN_REDUCTION_THRESHOLD = 0.25
const STRUCTURED_SUCCESS_THRESHOLD = 0.99
const CER_DEGRADATION_THRESHOLD = 0.005
const SCORE_ERROR_DEGRADATION_THRESHOLD = 0.01
const RECALL_DROP_THRESHOLD = 0.05
const EVIDENCE_LOCATION_THRESHOLD = 1
const HARD_RISK_THRESHOLD = 0
const SOAK_CONTRACT_FAILURE_THRESHOLD = 1
const REQUIRED_SOAK_CALLS = 100
const THROUGHPUT_IMPROVEMENT_THRESHOLD = 0.6
const REQUIRED_THROUGHPUT_ESSAYS = 30
const REQUIRED_EFFECTIVE_CONCURRENCY = 4
const COMPARISON_EPSILON = Number.EPSILON * 8

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function isStructuredSuccessCounts(value: unknown): value is StructuredSuccessCounts {
  if (!isRecord(value) || !hasExactKeys(value, ['accepted', 'total'])) return false
  return Number.isInteger(value.accepted)
    && Number.isInteger(value.total)
    && (value.accepted as number) >= 0
    && (value.total as number) > 0
    && (value.accepted as number) <= (value.total as number)
}

function passOrFail(actual: number, threshold: number, passes: boolean): QualityGateResult {
  return { status: passes ? 'pass' : 'fail', actual, threshold }
}

function notMeasurable(reason: string, threshold: number | null): QualityGateResult {
  return { status: 'not_measurable', actual: null, threshold, reason }
}

function atLeast(actual: number, threshold: number): boolean {
  return actual + COMPARISON_EPSILON >= threshold
}

function atMost(actual: number, threshold: number): boolean {
  return actual <= threshold + COMPARISON_EPSILON
}

export function evaluateStructuredSuccessGate(
  input: QualityGateInput['structuredSuccess'],
): QualityGateResult {
  if (
    !isRecord(input)
    || !hasExactKeys(input, ['baseline', 'candidate'])
    || !isStructuredSuccessCounts(input.baseline)
    || !isStructuredSuccessCounts(input.candidate)
  ) {
    return notMeasurable('missing_or_invalid_structured_success', STRUCTURED_SUCCESS_THRESHOLD)
  }
  const baselineRate = input.baseline.accepted / input.baseline.total
  const candidateRate = input.candidate.accepted / input.candidate.total
  const threshold = Math.max(STRUCTURED_SUCCESS_THRESHOLD, baselineRate)
  return passOrFail(candidateRate, threshold, atLeast(candidateRate, threshold))
}

export function evaluateTokenReductionGate(
  input: QualityGateInput['tokenMedians'],
): QualityGateResult {
  if (
    input === undefined ||
    !isFiniteNonNegative(input.baseline) ||
    input.baseline === 0 ||
    !isFiniteNonNegative(input.candidate)
  ) {
    return notMeasurable('unknown_or_invalid_token_median', TOKEN_REDUCTION_THRESHOLD)
  }
  const reduction = (input.baseline - input.candidate) / input.baseline
  return passOrFail(reduction, TOKEN_REDUCTION_THRESHOLD, atLeast(reduction, TOKEN_REDUCTION_THRESHOLD))
}

function evaluateUpperBoundGate(
  input: DegradationIntervalInput | undefined,
  threshold: number,
  reason: string,
): QualityGateResult {
  if (
    input === undefined ||
    !Number.isFinite(input.lower) ||
    !Number.isFinite(input.upper) ||
    input.lower > input.upper
  ) {
    return notMeasurable(reason, threshold)
  }
  return passOrFail(input.upper, threshold, atMost(input.upper, threshold))
}

export function evaluateRecallDropGate(
  input: RecallComparisonInput | undefined,
): QualityGateResult {
  if (input === undefined || !isProbability(input.baseline) || !isProbability(input.candidate)) {
    return notMeasurable('unknown_or_zero_denominator_recall', RECALL_DROP_THRESHOLD)
  }
  const drop = input.baseline - input.candidate
  return passOrFail(drop, RECALL_DROP_THRESHOLD, atMost(drop, RECALL_DROP_THRESHOLD))
}

export function evaluateEvidenceLocationGate(
  input: QualityGateInput['evidence'],
): QualityGateResult {
  if (
    input === undefined ||
    !Number.isInteger(input.total) ||
    input.total <= 0 ||
    !Number.isInteger(input.uniquelyLocated) ||
    input.uniquelyLocated < 0 ||
    input.uniquelyLocated > input.total
  ) {
    return notMeasurable('no_or_invalid_accepted_evidence', EVIDENCE_LOCATION_THRESHOLD)
  }
  const rate = input.uniquelyLocated / input.total
  return passOrFail(rate, EVIDENCE_LOCATION_THRESHOLD, rate === EVIDENCE_LOCATION_THRESHOLD)
}

export function evaluateHardRiskGate(input: QualityGateInput['hardRisks']): QualityGateResult {
  if (input === undefined) return notMeasurable('missing_hard_risk_audit', HARD_RISK_THRESHOLD)
  const values = [
    input.studentMix,
    input.wrongTaskContext,
    input.highRiskLegibilityMiss,
    input.piiLeakage,
  ]
  if (values.some((value) => !Number.isInteger(value) || value < 0)) {
    return notMeasurable('invalid_hard_risk_audit', HARD_RISK_THRESHOLD)
  }
  const total = values.reduce((sum, value) => sum + value, 0)
  return passOrFail(total, HARD_RISK_THRESHOLD, total === 0)
}

export function evaluateSoakGate(input: QualityGateInput['soak']): QualityGateResult {
  if (
    input === undefined ||
    input.totalCalls !== REQUIRED_SOAK_CALLS ||
    !Number.isInteger(input.contractFailures) ||
    input.contractFailures < 0 ||
    input.contractFailures > input.totalCalls
  ) {
    return notMeasurable('requires_exactly_100_valid_calls', SOAK_CONTRACT_FAILURE_THRESHOLD)
  }
  return passOrFail(
    input.contractFailures,
    SOAK_CONTRACT_FAILURE_THRESHOLD,
    input.contractFailures <= SOAK_CONTRACT_FAILURE_THRESHOLD,
  )
}

export function evaluateThroughputGate(input: QualityGateInput['throughput']): QualityGateResult {
  if (
    input === undefined ||
    input.essayCount !== REQUIRED_THROUGHPUT_ESSAYS ||
    !Number.isFinite(input.effectiveConcurrency) ||
    input.effectiveConcurrency < REQUIRED_EFFECTIVE_CONCURRENCY ||
    !Number.isFinite(input.baselineElapsedMs) ||
    input.baselineElapsedMs <= 0 ||
    !isFiniteNonNegative(input.candidateElapsedMs)
  ) {
    return notMeasurable(
      'requires_30_essays_and_effective_concurrency_at_least_4',
      THROUGHPUT_IMPROVEMENT_THRESHOLD,
    )
  }
  const improvement = (input.baselineElapsedMs - input.candidateElapsedMs) / input.baselineElapsedMs
  return passOrFail(
    improvement,
    THROUGHPUT_IMPROVEMENT_THRESHOLD,
    atLeast(improvement, THROUGHPUT_IMPROVEMENT_THRESHOLD),
  )
}

export function evaluateBlindReviewGate(
  input: QualityGateInput['blindReview'],
): QualityGateResult {
  if (
    !isRecord(input)
    || !hasExactKeys(input, [
      'sampleCount',
      'reviewedSampleCount',
      'randomizedAB',
      'secondaryReviewSampleCount',
      'reviewerRelationship',
      'sameTeacherReviewIntervalDays',
      'unresolvedArbitrations',
      'systematicDegradation',
    ])
    || !Number.isInteger(input.sampleCount)
    || !Number.isInteger(input.reviewedSampleCount)
    || !Number.isInteger(input.secondaryReviewSampleCount)
    || !Number.isInteger(input.unresolvedArbitrations)
    || typeof input.randomizedAB !== 'boolean'
    || (input.reviewerRelationship !== 'independent_teacher' &&
      input.reviewerRelationship !== 'same_teacher_delayed')
    || (input.sameTeacherReviewIntervalDays !== null && (
      !Number.isInteger(input.sameTeacherReviewIntervalDays) ||
      (input.sameTeacherReviewIntervalDays as number) < 0
    ))
    || (input.sampleCount as number) < 0
    || (input.reviewedSampleCount as number) < 0
    || (input.secondaryReviewSampleCount as number) < 0
    || (input.unresolvedArbitrations as number) < 0
    || (input.reviewedSampleCount as number) > (input.sampleCount as number)
    || (input.secondaryReviewSampleCount as number) > (input.reviewedSampleCount as number)
    || (input.unresolvedArbitrations as number) > (input.secondaryReviewSampleCount as number)
    || typeof input.systematicDegradation !== 'boolean'
  ) {
    return notMeasurable('missing_or_invalid_blind_review', null)
  }

  const sampleCount = input.sampleCount as number
  const reviewedSampleCount = input.reviewedSampleCount as number
  const secondaryReviewSampleCount = input.secondaryReviewSampleCount as number
  const unresolvedArbitrations = input.unresolvedArbitrations as number
  const systematicDegradation = input.systematicDegradation as boolean
  const requiredSecondaryReviews = 8
  if (sampleCount !== 40) {
    return { status: 'fail', actual: sampleCount, threshold: 40, reason: 'requires_exactly_40_samples' }
  }
  if (reviewedSampleCount !== 40) {
    return {
      status: 'fail',
      actual: reviewedSampleCount,
      threshold: sampleCount,
      reason: 'requires_complete_review',
    }
  }
  if (!input.randomizedAB) {
    return { status: 'fail', actual: 0, threshold: 1, reason: 'requires_randomized_ab' }
  }
  const validReviewerSeparation = input.reviewerRelationship === 'independent_teacher'
    ? input.sameTeacherReviewIntervalDays === null
    : typeof input.sameTeacherReviewIntervalDays === 'number' &&
      input.sameTeacherReviewIntervalDays >= 7
  if (!validReviewerSeparation) {
    return {
      status: 'fail',
      actual: input.sameTeacherReviewIntervalDays,
      threshold: 7,
      reason: 'requires_independent_or_seven_day_review',
    }
  }
  if (secondaryReviewSampleCount < requiredSecondaryReviews) {
    return {
      status: 'fail',
      actual: secondaryReviewSampleCount,
      threshold: requiredSecondaryReviews,
      reason: 'requires_20_percent_secondary_review',
    }
  }
  if (unresolvedArbitrations !== 0) {
    return {
      status: 'fail',
      actual: unresolvedArbitrations,
      threshold: 0,
      reason: 'requires_zero_unresolved_arbitrations',
    }
  }
  if (systematicDegradation) {
    return {
      status: 'fail',
      actual: 1,
      threshold: 0,
      reason: 'systematic_degradation_detected',
    }
  }
  return passOrFail(
    secondaryReviewSampleCount,
    requiredSecondaryReviews,
    true,
  )
}

export function evaluateQualityGates(input: QualityGateInput): QualityGateReport {
  const gates: QualityGateReport['gates'] = {
    structuredSuccess: evaluateStructuredSuccessGate(input.structuredSuccess),
    tokenReduction: evaluateTokenReductionGate(input.tokenMedians),
    cerDegradation: evaluateUpperBoundGate(
      input.cerDegradation95,
      CER_DEGRADATION_THRESHOLD,
      'missing_or_invalid_cer_confidence_interval',
    ),
    scoreErrorDegradation: evaluateUpperBoundGate(
      input.scoreErrorDegradation95,
      SCORE_ERROR_DEGRADATION_THRESHOLD,
      'missing_or_invalid_score_confidence_interval',
    ),
    importantIssueRecall: evaluateRecallDropGate(input.importantIssueRecall),
    importantLegibilityRecall: evaluateRecallDropGate(input.importantLegibilityRecall),
    evidenceLocation: evaluateEvidenceLocationGate(input.evidence),
    hardRisks: evaluateHardRiskGate(input.hardRisks),
    soak: evaluateSoakGate(input.soak),
    throughput: evaluateThroughputGate(input.throughput),
    blindReview: evaluateBlindReviewGate(input.blindReview),
  }

  const statuses = Object.values(gates).map((gate) => gate.status)
  const status: QualityConclusion = statuses.includes('fail')
    ? 'fail'
    : statuses.includes('not_measurable')
      ? 'inconclusive'
      : 'pass'

  return { status, gates }
}
