import { createHash } from 'node:crypto'

import { normalizeMultimodalResult } from '../../src/multimodal/normalizeMultimodalResult.js'
import type {
  MultimodalGradingResult,
} from '../../src/multimodal/normalizeMultimodalResult.js'
import { GRADING_POLICY_VERSION } from '../../src/multimodal/gradingPolicy.js'
import {
  ESSAY_PROVIDER_SCHEMA_VERSION,
  LEGACY_ESSAY_PROVIDER_SCHEMA_VERSION,
} from '../../src/multimodal/modelTaskContext.js'
import type { ConfirmedTaskPackageV2 } from '../../src/multimodal/types.js'
import { validateConfirmedRubric } from '../../src/multimodal/validateRubric.js'
import type {
  GatewayImageInput,
  MultimodalProvider,
} from '../../src/providers/multimodalProviderTypes.js'
import {
  GradingProviderError,
  type ProviderAttemptObservation,
} from '../../src/providers/providerTypes.js'
import {
  aggregateUniqueCompletionMetrics,
  calculateCer,
  calculateEvidenceLocationRate,
  calculateImportantRecall,
  calculateMean,
  calculateMedian,
  normalizedScoreError,
  summarizeCer,
  type CerSummary,
  type CompletionUsageObservation,
  type EvidenceLocationMetric,
  type ImportantLabelObservation,
  type Metric,
  type RecallMetric,
  type UniqueCompletionAggregate,
} from './metrics.js'
import {
  computeDatasetSha256,
  computeManifestSha256,
  validateBenchmarkSampleReference,
} from './manifest.js'
import {
  GRADING_BENCHMARK_MANIFEST_VERSION,
  type GradingBenchmarkSample,
} from './types.js'

export const GRADING_BENCHMARK_REPORT_VERSION = 'grading-benchmark-report-v1' as const
export const GRADING_BENCHMARK_VERSION = 'grading-benchmark-v1' as const

export type BenchmarkVariant = 'baseline' | 'candidate'

export interface BenchmarkPhaseBudgets {
  material_context: number
  rubric_generation: number
  essay_grading_images: number
  essay_regrading_text: number
}

export interface BenchmarkFeatureProfiles {
  image: 'original-v1'
  output: 'legacy-v1' | 'deduplicated-v1'
  prompt: 'legacy' | 'optimized-v1'
}

export interface BenchmarkProvenance {
  benchmarkVersion: typeof GRADING_BENCHMARK_VERSION
  gitCommit: string
  model: 'kimi-k3'
  reasoningEffort: 'low'
  policyVersion: typeof GRADING_POLICY_VERSION
  providerSchemaVersion:
    | typeof ESSAY_PROVIDER_SCHEMA_VERSION
    | typeof LEGACY_ESSAY_PROVIDER_SCHEMA_VERSION
  phaseBudgets: BenchmarkPhaseBudgets
  featureProfiles: BenchmarkFeatureProfiles
  manifestSha256: string
  datasetSha256: string
}

export interface BenchmarkRunnerSample {
  reference: GradingBenchmarkSample
  pages: readonly GatewayImageInput[]
}

export interface BenchmarkSampleAssessment {
  detectedImportantIssueLabels: readonly string[]
  detectedImportantLegibilityLabels: readonly string[]
  hardRisks: {
    studentMix: boolean
    wrongTaskContext: boolean
    piiLeakage: boolean
  }
}

export interface BenchmarkAssessmentInput {
  sampleId: string
  expectedImportantIssueLabels: readonly string[]
  expectedImportantLegibilityLabels: readonly string[]
  result: MultimodalGradingResult
}

export interface BenchmarkRunnerInput {
  variant: BenchmarkVariant
  provenance: BenchmarkProvenance
  task: ConfirmedTaskPackageV2
  samples: readonly BenchmarkRunnerSample[]
}

export interface BenchmarkRunnerDependencies {
  provider: MultimodalProvider
  assessResult?: (
    input: BenchmarkAssessmentInput,
  ) => BenchmarkSampleAssessment | Promise<BenchmarkSampleAssessment>
  monotonicNow?: () => number
  signal?: AbortSignal
  observeSampleMetrics?: (
    observation: BenchmarkSampleMetricObservation,
  ) => void | Promise<void>
}

export interface BenchmarkSampleMetricObservation {
  /** Zero-based anonymous manifest ordinal; no sample ID or source metadata is exposed. */
  sampleIndex: number
  cer: number | null
  normalizedScoreError: number | null
  totalTokens: number | null
}

export type BenchmarkFailureCode =
  | 'provider_failure'
  | 'normalization_rejected'
  | 'assessment_failure'

export interface BenchmarkSampleCounts {
  requested: number
  providerSucceeded: number
  accepted: number
  providerFailures: number
  normalizationFailures: number
  assessmentFailures: number
  assessmentCoverage: number
}

export interface ScalarMetricSummary {
  mean: Metric<number>
  median: Metric<number>
  measurableSampleCount: number
}

export interface NumericDistribution {
  sampleCount: number
  min: number | null
  max: number | null
  median: Metric<number>
}

export type BenchmarkFieldName =
  | 'issues'
  | 'sentenceRevisions'
  | 'expressionUpgrades'
  | 'sentencePairs'
  | 'logicNotes'
  | 'logicIssues'
  | 'legibilityIssues'

export interface BenchmarkAggregateReport {
  reportVersion: typeof GRADING_BENCHMARK_REPORT_VERSION
  variant: BenchmarkVariant
  provenance: Readonly<BenchmarkProvenance>
  sampleCounts: BenchmarkSampleCounts
  failureCounts: Record<BenchmarkFailureCode, number>
  structuredSuccessRate: Metric<number>
  cer: CerSummary
  normalizedScoreError: ScalarMetricSummary
  importantIssueRecall: RecallMetric
  importantLegibilityRecall: RecallMetric
  evidenceLocation: EvidenceLocationMetric
  hardRisks: {
    studentMix: Metric<number>
    wrongTaskContext: Metric<number>
    highRiskLegibilityMiss: Metric<number>
    piiLeakage: Metric<number>
  }
  blindReview: Metric<never>
  completionMetrics: BenchmarkCompletionMetrics
  fieldCounts: Record<BenchmarkFieldName, NumericDistribution>
}

export interface BenchmarkCompletionMetrics extends UniqueCompletionAggregate {
  unobservedProviderCallCount: number
}

export class BenchmarkRunnerError extends Error {
  constructor(
    readonly code:
      | 'invalid_benchmark_input'
      | 'invalid_benchmark_provenance'
      | 'sample_metric_observer_failed',
  ) {
    super(code)
    this.name = 'BenchmarkRunnerError'
  }
}

const SAMPLE_ID = /^sample-[0-9]{3}$/u
const HEX_COMMIT = /^[a-f0-9]{40}$/u
const SHA256 = /^[a-f0-9]{64}$/u
const ATTEMPT_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

const FIELD_NAMES: readonly BenchmarkFieldName[] = [
  'issues',
  'sentenceRevisions',
  'expressionUpgrades',
  'sentencePairs',
  'logicNotes',
  'logicIssues',
  'legibilityIssues',
]

function failInput(): never {
  throw new BenchmarkRunnerError('invalid_benchmark_input')
}

function failProvenance(): never {
  throw new BenchmarkRunnerError('invalid_benchmark_provenance')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function measured(value: number): Metric<number> {
  return { status: 'measured', value }
}

function notMeasurable(reason: string): { status: 'not_measurable'; reason: string } {
  return { status: 'not_measurable', reason }
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  )
}

function validPhaseBudget(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 16_384
}

const PROVENANCE_KEYS = [
  'benchmarkVersion',
  'gitCommit',
  'model',
  'reasoningEffort',
  'policyVersion',
  'providerSchemaVersion',
  'phaseBudgets',
  'featureProfiles',
  'manifestSha256',
  'datasetSha256',
] as const

export function isBenchmarkProvenance(
  value: unknown,
  expectedVariant?: BenchmarkVariant,
): value is BenchmarkProvenance {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, PROVENANCE_KEYS) ||
    value.benchmarkVersion !== GRADING_BENCHMARK_VERSION ||
    typeof value.gitCommit !== 'string' ||
    !HEX_COMMIT.test(value.gitCommit) ||
    value.model !== 'kimi-k3' ||
    value.reasoningEffort !== 'low' ||
    value.policyVersion !== GRADING_POLICY_VERSION ||
    (value.providerSchemaVersion !== ESSAY_PROVIDER_SCHEMA_VERSION &&
      value.providerSchemaVersion !== LEGACY_ESSAY_PROVIDER_SCHEMA_VERSION) ||
    typeof value.manifestSha256 !== 'string' ||
    !SHA256.test(value.manifestSha256) ||
    typeof value.datasetSha256 !== 'string' ||
    !SHA256.test(value.datasetSha256) ||
    !isRecord(value.phaseBudgets) ||
    !hasExactKeys(value.phaseBudgets, [
      'material_context',
      'rubric_generation',
      'essay_grading_images',
      'essay_regrading_text',
    ]) ||
    !validPhaseBudget(value.phaseBudgets.material_context) ||
    !validPhaseBudget(value.phaseBudgets.rubric_generation) ||
    !validPhaseBudget(value.phaseBudgets.essay_grading_images) ||
    !validPhaseBudget(value.phaseBudgets.essay_regrading_text) ||
    !isRecord(value.featureProfiles) ||
    !hasExactKeys(value.featureProfiles, ['image', 'output', 'prompt']) ||
    value.featureProfiles.image !== 'original-v1'
  ) return false

  const inferredVariant = value.providerSchemaVersion === LEGACY_ESSAY_PROVIDER_SCHEMA_VERSION &&
    value.featureProfiles.output === 'legacy-v1' &&
    value.featureProfiles.prompt === 'legacy'
    ? 'baseline'
    : value.providerSchemaVersion === ESSAY_PROVIDER_SCHEMA_VERSION &&
      value.featureProfiles.output === 'deduplicated-v1' &&
      value.featureProfiles.prompt === 'optimized-v1'
      ? 'candidate'
      : null
  return inferredVariant !== null && (expectedVariant === undefined || inferredVariant === expectedVariant)
}

const METRIC_REASONS = new Set([
  'no_non_empty_references',
  'no_reference_code_points',
  'no_accepted_results',
  'unknown_or_invalid_value',
  'no_important_labels',
  'incomplete_sample_assessment',
  'no_accepted_evidence',
  'human_blind_review_required',
  'no_provider_attempts',
  'unknown_or_partial_usage',
  'unknown_or_partial_phase_timing',
  'incomplete_provider_attempt_telemetry',
])

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isStrictMetric(value: unknown, probability = false): boolean {
  if (!isRecord(value)) return false
  if (value.status === 'measured') {
    return hasExactKeys(value, ['status', 'value']) &&
      isNonNegativeFinite(value.value) &&
      (!probability || (value.value as number) <= 1)
  }
  return value.status === 'not_measurable' &&
    hasExactKeys(value, ['status', 'reason']) &&
    typeof value.reason === 'string' &&
    METRIC_REASONS.has(value.reason)
}

function isStrictTokenMetric(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.status === 'measured') {
    return hasExactKeys(value, ['status', 'value']) &&
      Number.isSafeInteger(value.value) && (value.value as number) >= 0
  }
  return isStrictMetric(value)
}

function measuredTokenValue(value: unknown): number | null {
  return isRecord(value) && value.status === 'measured' && Number.isSafeInteger(value.value)
    ? value.value as number
    : null
}

function safeIntegerSum(values: readonly number[]): number | null {
  let total = 0
  for (const value of values) {
    total += value
    if (!Number.isSafeInteger(total)) return null
  }
  return total
}

function isStrictRecallMetric(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.status === 'not_measurable') return isStrictMetric(value)
  return value.status === 'measured' &&
    hasExactKeys(value, ['status', 'value', 'matched', 'total']) &&
    isNonNegativeFinite(value.value) && (value.value as number) <= 1 &&
    isNonNegativeInteger(value.matched) &&
    Number.isSafeInteger(value.total) && (value.total as number) > 0 &&
    (value.matched as number) <= (value.total as number) &&
    Math.abs((value.matched as number) / (value.total as number) - (value.value as number)) <= Number.EPSILON * 8
}

function isStrictEvidenceMetric(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.status === 'not_measurable') return isStrictMetric(value)
  return value.status === 'measured' &&
    hasExactKeys(value, ['status', 'value', 'uniquelyLocated', 'total']) &&
    isNonNegativeFinite(value.value) && (value.value as number) <= 1 &&
    isNonNegativeInteger(value.uniquelyLocated) &&
    Number.isSafeInteger(value.total) && (value.total as number) > 0 &&
    (value.uniquelyLocated as number) <= (value.total as number) &&
    Math.abs((value.uniquelyLocated as number) / (value.total as number) - (value.value as number)) <= Number.EPSILON * 8
}

function isStrictDistribution(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ['sampleCount', 'min', 'max', 'median'])) return false
  if (!isNonNegativeInteger(value.sampleCount) || !isStrictMetric(value.median)) return false
  if (value.sampleCount === 0) {
    return value.min === null && value.max === null &&
      isRecord(value.median) && value.median.status === 'not_measurable'
  }
  return isNonNegativeInteger(value.min) && isNonNegativeInteger(value.max) &&
    (value.min as number) <= (value.max as number) &&
    isRecord(value.median) && value.median.status === 'measured' &&
    (value.median.value as number) >= (value.min as number) &&
    (value.median.value as number) <= (value.max as number)
}

function isExactNotMeasurableReason(value: unknown, reason: string): boolean {
  return isRecord(value) &&
    hasExactKeys(value, ['status', 'reason']) &&
    value.status === 'not_measurable' &&
    value.reason === reason
}

function isMeasuredNonNegativeIntegerMetric(value: unknown): boolean {
  return isRecord(value) &&
    hasExactKeys(value, ['status', 'value']) &&
    value.status === 'measured' &&
    isNonNegativeInteger(value.value)
}

function isStrictCompletionMetrics(
  value: unknown,
  requestedSampleCount: number,
  essayCompletionBudget: number,
): boolean {
  if (!isRecord(value) || !hasExactKeys(value, [
    'uniqueAttemptCount',
    'duplicateObservationCount',
    'tokens',
    'finishReasons',
    'phaseTimingsMs',
    'unobservedProviderCallCount',
  ])) return false
  if (
    !isNonNegativeInteger(value.uniqueAttemptCount) ||
    !isNonNegativeInteger(value.duplicateObservationCount) ||
    !isNonNegativeInteger(value.unobservedProviderCallCount) ||
    !isRecord(value.tokens) ||
    !hasExactKeys(value.tokens, ['promptTokens', 'completionTokens', 'totalTokens', 'cachedTokens']) ||
    !Object.values(value.tokens).every((metric) => isStrictTokenMetric(metric)) ||
    !isRecord(value.phaseTimingsMs) ||
    !hasExactKeys(value.phaseTimingsMs, ['queue', 'provider', 'parse', 'normalize', 'total']) ||
    !Object.values(value.phaseTimingsMs).every((metric) => isStrictMetric(metric)) ||
    !isRecord(value.finishReasons) ||
    !hasExactKeys(value.finishReasons, ['counts', 'unknownCount']) ||
    !isNonNegativeInteger(value.finishReasons.unknownCount) ||
    !isRecord(value.finishReasons.counts) ||
    !hasExactKeys(value.finishReasons.counts, ['stop', 'length', 'content_filter', 'tool_calls']) ||
    !Object.values(value.finishReasons.counts).every(isNonNegativeInteger)
  ) return false
  const promptTokens = measuredTokenValue(value.tokens.promptTokens)
  const completionTokens = measuredTokenValue(value.tokens.completionTokens)
  const totalTokens = measuredTokenValue(value.tokens.totalTokens)
  const cachedTokens = measuredTokenValue(value.tokens.cachedTokens)
  if (promptTokens !== null && completionTokens !== null && totalTokens !== null) {
    const expectedTotalTokens = safeIntegerSum([promptTokens, completionTokens])
    if (expectedTotalTokens === null || totalTokens !== expectedTotalTokens) return false
  }
  if (promptTokens !== null && totalTokens !== null && totalTokens < promptTokens) return false
  if (completionTokens !== null && totalTokens !== null && totalTokens < completionTokens) return false
  if (promptTokens !== null && cachedTokens !== null && cachedTokens > promptTokens) return false

  const uniqueAttemptCount = value.uniqueAttemptCount as number
  const unobservedProviderCallCount = value.unobservedProviderCallCount as number
  if (unobservedProviderCallCount > requestedSampleCount) return false
  const observedSampleCount = requestedSampleCount - unobservedProviderCallCount
  const maximumUniqueAttempts = safeIntegerSum([observedSampleCount, observedSampleCount])
  if (
    maximumUniqueAttempts === null ||
    uniqueAttemptCount < observedSampleCount ||
    uniqueAttemptCount > maximumUniqueAttempts
  ) return false
  const completionBudgetTotal = uniqueAttemptCount * essayCompletionBudget
  if (!Number.isSafeInteger(completionBudgetTotal)) return false
  if (completionTokens !== null && completionTokens > completionBudgetTotal) return false

  if (unobservedProviderCallCount > 0) {
    if (
      !Object.values(value.tokens).every((metric) =>
        isExactNotMeasurableReason(metric, 'incomplete_provider_attempt_telemetry'),
      ) ||
      !Object.values(value.phaseTimingsMs).every((metric) =>
        isExactNotMeasurableReason(metric, 'incomplete_provider_attempt_telemetry'),
      ) ||
      (value.finishReasons.unknownCount as number) < unobservedProviderCallCount
    ) return false
  } else if (
    !Object.values(value.tokens).every((metric) =>
      isRecord(metric) && (
        metric.status === 'measured' ||
        isExactNotMeasurableReason(metric, 'unknown_or_partial_usage')
      ),
    ) ||
    !Object.values(value.phaseTimingsMs).every((metric) =>
      isRecord(metric) && (
        metric.status === 'measured' ||
        isExactNotMeasurableReason(metric, 'unknown_or_partial_phase_timing')
      ),
    )
  ) {
    return false
  }

  const observedFinishReasons = safeIntegerSum([
    ...(Object.values(value.finishReasons.counts) as number[]),
    value.finishReasons.unknownCount as number,
  ])
  const expectedFinishReasons = safeIntegerSum([
    uniqueAttemptCount,
    unobservedProviderCallCount,
  ])
  return observedFinishReasons !== null && expectedFinishReasons !== null &&
    observedFinishReasons === expectedFinishReasons
}

const AGGREGATE_REPORT_KEYS = [
  'reportVersion',
  'variant',
  'provenance',
  'sampleCounts',
  'failureCounts',
  'structuredSuccessRate',
  'cer',
  'normalizedScoreError',
  'importantIssueRecall',
  'importantLegibilityRecall',
  'evidenceLocation',
  'hardRisks',
  'blindReview',
  'completionMetrics',
  'fieldCounts',
] as const

export function isBenchmarkAggregateReport(
  value: unknown,
  expectedVariant?: BenchmarkVariant,
  expectedProvenance?: BenchmarkProvenance,
): value is BenchmarkAggregateReport {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, AGGREGATE_REPORT_KEYS) ||
    value.reportVersion !== GRADING_BENCHMARK_REPORT_VERSION ||
    (value.variant !== 'baseline' && value.variant !== 'candidate') ||
    (expectedVariant !== undefined && value.variant !== expectedVariant) ||
    !isBenchmarkProvenance(value.provenance, value.variant) ||
    (expectedProvenance !== undefined && JSON.stringify(value.provenance) !== JSON.stringify(expectedProvenance)) ||
    !isRecord(value.sampleCounts) ||
    !hasExactKeys(value.sampleCounts, [
      'requested',
      'providerSucceeded',
      'accepted',
      'providerFailures',
      'normalizationFailures',
      'assessmentFailures',
      'assessmentCoverage',
    ]) ||
    !Object.values(value.sampleCounts).every(isNonNegativeInteger) ||
    (value.sampleCounts.requested as number) < 1 ||
    (value.sampleCounts.providerSucceeded as number) + (value.sampleCounts.providerFailures as number) !== value.sampleCounts.requested ||
    (value.sampleCounts.accepted as number) + (value.sampleCounts.normalizationFailures as number) !== value.sampleCounts.providerSucceeded ||
    (value.sampleCounts.assessmentCoverage as number) +
      (value.sampleCounts.assessmentFailures as number) >
      (value.sampleCounts.accepted as number) ||
    !isRecord(value.failureCounts) ||
    !hasExactKeys(value.failureCounts, ['provider_failure', 'normalization_rejected', 'assessment_failure']) ||
    !Object.values(value.failureCounts).every(isNonNegativeInteger) ||
    value.failureCounts.provider_failure !== value.sampleCounts.providerFailures ||
    value.failureCounts.normalization_rejected !== value.sampleCounts.normalizationFailures ||
    value.failureCounts.assessment_failure !== value.sampleCounts.assessmentFailures ||
    !isStrictMetric(value.structuredSuccessRate, true) ||
    !isRecord(value.cer) ||
    !hasExactKeys(value.cer, [
      'macro',
      'micro',
      'measurableSampleCount',
      'excludedSampleCount',
      'totalEditDistance',
      'totalReferenceCodePoints',
    ]) ||
    !isStrictMetric(value.cer.macro) ||
    !isStrictMetric(value.cer.micro) ||
    !isNonNegativeInteger(value.cer.measurableSampleCount) ||
    !isNonNegativeInteger(value.cer.excludedSampleCount) ||
    !isNonNegativeInteger(value.cer.totalEditDistance) ||
    !isNonNegativeInteger(value.cer.totalReferenceCodePoints) ||
    !isRecord(value.normalizedScoreError) ||
    !hasExactKeys(value.normalizedScoreError, ['mean', 'median', 'measurableSampleCount']) ||
    !isStrictMetric(value.normalizedScoreError.mean) ||
    !isStrictMetric(value.normalizedScoreError.median) ||
    !isNonNegativeInteger(value.normalizedScoreError.measurableSampleCount) ||
    !isStrictRecallMetric(value.importantIssueRecall) ||
    !isStrictRecallMetric(value.importantLegibilityRecall) ||
    !isStrictEvidenceMetric(value.evidenceLocation) ||
    !isRecord(value.hardRisks) ||
    !hasExactKeys(value.hardRisks, [
      'studentMix',
      'wrongTaskContext',
      'highRiskLegibilityMiss',
      'piiLeakage',
    ]) ||
    !Object.values(value.hardRisks).every((metric) => isStrictMetric(metric)) ||
    !isRecord(value.blindReview) ||
    !hasExactKeys(value.blindReview, ['status', 'reason']) ||
    value.blindReview.status !== 'not_measurable' ||
    value.blindReview.reason !== 'human_blind_review_required' ||
    !isStrictCompletionMetrics(
      value.completionMetrics,
      value.sampleCounts.requested as number,
      (value.provenance as BenchmarkProvenance).phaseBudgets.essay_grading_images,
    ) ||
    !isRecord(value.fieldCounts) ||
    !hasExactKeys(value.fieldCounts, FIELD_NAMES) ||
    !Object.values(value.fieldCounts).every(isStrictDistribution)
  ) return false

  const sampleCounts = value.sampleCounts as unknown as BenchmarkSampleCounts
  if (
    !isRecord(value.structuredSuccessRate) ||
    value.structuredSuccessRate.status !== 'measured' ||
    value.structuredSuccessRate.value !== sampleCounts.accepted / sampleCounts.requested
  ) return false

  const cer = value.cer as Record<string, unknown>
  const cerCoverage = safeIntegerSum([
    cer.measurableSampleCount as number,
    cer.excludedSampleCount as number,
  ])
  if (
    cerCoverage === null ||
    cerCoverage !== sampleCounts.requested ||
    cer.measurableSampleCount !== sampleCounts.accepted
  ) return false
  if (sampleCounts.accepted === 0) {
    if (
      cer.totalEditDistance !== 0 ||
      cer.totalReferenceCodePoints !== 0 ||
      !isExactNotMeasurableReason(cer.macro, 'no_non_empty_references') ||
      !isExactNotMeasurableReason(cer.micro, 'no_reference_code_points')
    ) return false
  } else {
    if (
      (cer.totalReferenceCodePoints as number) <= 0 ||
      !isRecord(cer.macro) || cer.macro.status !== 'measured' ||
      !isRecord(cer.micro) || cer.micro.status !== 'measured' ||
      cer.micro.value !==
        (cer.totalEditDistance as number) / (cer.totalReferenceCodePoints as number)
    ) return false
    if (sampleCounts.accepted === 1 && cer.macro.value !== cer.micro.value) return false
  }

  const scoreSummary = value.normalizedScoreError as Record<string, unknown>
  if (scoreSummary.measurableSampleCount !== sampleCounts.accepted) return false
  if (sampleCounts.accepted === 0) {
    if (
      !isExactNotMeasurableReason(scoreSummary.mean, 'no_accepted_results') ||
      !isExactNotMeasurableReason(scoreSummary.median, 'unknown_or_invalid_value')
    ) return false
  } else if (
    !isRecord(scoreSummary.mean) || scoreSummary.mean.status !== 'measured' ||
    !isRecord(scoreSummary.median) || scoreSummary.median.status !== 'measured'
  ) return false
  else if (
    (scoreSummary.mean.value as number) > 1 ||
    (scoreSummary.median.value as number) > 1 ||
    (sampleCounts.accepted <= 2 && scoreSummary.mean.value !== scoreSummary.median.value)
  ) return false

  const assessmentComplete = sampleCounts.accepted > 0 &&
    sampleCounts.assessmentCoverage === sampleCounts.accepted
  const recalls = [value.importantIssueRecall, value.importantLegibilityRecall]
  const hardRiskMetrics = Object.values(value.hardRisks as Record<string, unknown>)
  if (assessmentComplete) {
    if (
      recalls.some((metric) =>
        !(
          isRecord(metric) && metric.status === 'measured'
        ) && !isExactNotMeasurableReason(metric, 'no_important_labels'),
      ) ||
      !hardRiskMetrics.every(isMeasuredNonNegativeIntegerMetric)
    ) return false
  } else if (
    !recalls.every((metric) =>
      isExactNotMeasurableReason(metric, 'incomplete_sample_assessment'),
    ) ||
    !hardRiskMetrics.every((metric) =>
      isExactNotMeasurableReason(metric, 'incomplete_sample_assessment'),
    )
  ) {
    return false
  }

  if (Object.values(value.fieldCounts as Record<string, unknown>).some((distributionValue) =>
    !isRecord(distributionValue) || distributionValue.sampleCount !== sampleCounts.accepted,
  )) return false
  return true
}

function freezeProvenance(
  value: BenchmarkProvenance,
  expectedVariant: BenchmarkVariant,
): Readonly<BenchmarkProvenance> {
  if (!isBenchmarkProvenance(value, expectedVariant)) failProvenance()

  const phaseBudgets: BenchmarkPhaseBudgets = {
    material_context: value.phaseBudgets.material_context,
    rubric_generation: value.phaseBudgets.rubric_generation,
    essay_grading_images: value.phaseBudgets.essay_grading_images,
    essay_regrading_text: value.phaseBudgets.essay_regrading_text,
  }
  const featureProfiles: BenchmarkFeatureProfiles = {
    image: value.featureProfiles.image,
    output: value.featureProfiles.output,
    prompt: value.featureProfiles.prompt,
  }

  Object.freeze(phaseBudgets)
  Object.freeze(featureProfiles)
  return Object.freeze({
    benchmarkVersion: GRADING_BENCHMARK_VERSION,
    gitCommit: value.gitCommit,
    model: 'kimi-k3' as const,
    reasoningEffort: 'low' as const,
    policyVersion: GRADING_POLICY_VERSION,
    providerSchemaVersion: value.providerSchemaVersion,
    phaseBudgets,
    featureProfiles,
    manifestSha256: value.manifestSha256,
    datasetSha256: value.datasetSha256,
  })
}

function deepFreezeJson<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreezeJson(child)
  }
  Object.freeze(value)
  return value
}

function cloneFrozenJson<T>(value: T): T {
  return deepFreezeJson(structuredClone(value))
}

function snapshotRunnerInput(
  input: BenchmarkRunnerInput,
  provenance: Readonly<BenchmarkProvenance>,
): BenchmarkRunnerInput {
  try {
    const samples = input.samples.map((sample) => Object.freeze({
      reference: cloneFrozenJson(sample.reference),
      pages: Object.freeze(sample.pages.map((page) => Object.freeze({
        pageId: page.pageId,
        mimeType: page.mimeType,
        buffer: Buffer.from(page.buffer),
      }))),
    }))
    return Object.freeze({
      variant: input.variant,
      provenance: provenance as BenchmarkProvenance,
      task: cloneFrozenJson(input.task),
      samples: Object.freeze(samples),
    })
  } catch {
    failInput()
  }
}

function snapshotMatchesProvenance(input: BenchmarkRunnerInput): boolean {
  const manifest = {
    manifestVersion: GRADING_BENCHMARK_MANIFEST_VERSION,
    samples: input.samples.map(({ reference }) => reference),
  }
  return computeManifestSha256(manifest) === input.provenance.manifestSha256 &&
    computeDatasetSha256(input.provenance.manifestSha256, input.samples) ===
      input.provenance.datasetSha256
}

function assertSnapshotIntegrity(input: BenchmarkRunnerInput): void {
  if (!snapshotMatchesProvenance(input)) failInput()
}

function sampleIdForIndex(sampleIndex: number): string {
  return `sample-${String(sampleIndex + 1).padStart(3, '0')}`
}

const CONFIRMED_TASK_KEYS = [
  'taskId',
  'fullScore',
  'materialSummary',
  'writingRequirements',
  'constraints',
  'rubric',
] as const

function hasAtMostCodePoints(value: string, maximum: number): boolean {
  let count = 0
  for (const _codePoint of value) {
    count += 1
    if (count > maximum) return false
  }
  return true
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function isCanonicalConfirmedTask(value: unknown): value is ConfirmedTaskPackageV2 {
  if (!isRecord(value) || !hasExactKeys(value, CONFIRMED_TASK_KEYS)) return false
  if (
    typeof value.taskId !== 'string' ||
    value.taskId.trim() !== value.taskId ||
    value.taskId.length === 0 ||
    !hasAtMostCodePoints(value.taskId, 128) ||
    !Number.isSafeInteger(value.fullScore) ||
    (value.fullScore as number) < 1 ||
    (value.fullScore as number) > 100
  ) return false
  const rubric = validateConfirmedRubric(value.rubric)
  if (!rubric.ok) return false
  try {
    return value.materialSummary === rubric.value.materialSummary &&
      canonicalJson(value.writingRequirements) === canonicalJson(rubric.value.writingRequirements) &&
      canonicalJson(value.constraints) === canonicalJson(rubric.value.constraints) &&
      canonicalJson(value.rubric) === canonicalJson(rubric.value)
  } catch {
    return false
  }
}

function validateRunnerInput(input: BenchmarkRunnerInput): void {
  if (
    (input.variant !== 'baseline' && input.variant !== 'candidate') ||
    !isCanonicalConfirmedTask(input.task) ||
    !Array.isArray(input.samples) ||
    input.samples.length === 0 ||
    input.samples.length > 999
  ) {
    failInput()
  }

  for (let sampleIndex = 0; sampleIndex < input.samples.length; sampleIndex += 1) {
    const sample = input.samples[sampleIndex]
    const sampleId = sampleIdForIndex(sampleIndex)
    if (
      validateBenchmarkSampleReference(sample.reference, sampleIndex) === null ||
      !SAMPLE_ID.test(sample.reference.id) ||
      sample.reference.id !== sampleId ||
      sample.reference.fullScore !== input.task.fullScore ||
      !Number.isFinite(sample.reference.teacherScore) ||
      sample.reference.teacherScore < 0 ||
      sample.reference.teacherScore > sample.reference.fullScore ||
      sample.reference.pages.length === 0 ||
      sample.reference.pages.length !== sample.pages.length
    ) {
      failInput()
    }

    for (let index = 0; index < sample.pages.length; index += 1) {
      const page = sample.pages[index]
      const referencePage = sample.reference.pages[index]
      if (
        referencePage.pageOrder !== index + 1 ||
        page.mimeType !== referencePage.mimeType ||
        typeof page.pageId !== 'string' ||
        page.pageId.trim().length === 0 ||
        !Buffer.isBuffer(page.buffer) ||
        page.buffer.length === 0
      ) {
        failInput()
      }
    }
  }
}

function elapsed(start: number, end: number): number | undefined {
  const value = end - start
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

function tokenValue(
  value: ProviderAttemptObservation['usage']['promptTokens'],
): number | null {
  return value.status === 'known' ? value.value : null
}

function attemptObservation(
  attempt: ProviderAttemptObservation,
): CompletionUsageObservation {
  return {
    attemptId: attempt.attemptDiagnosticId,
    usage: {
      promptTokens: tokenValue(attempt.usage.promptTokens),
      completionTokens: tokenValue(attempt.usage.completionTokens),
      totalTokens: tokenValue(attempt.usage.totalTokens),
      cachedTokens: tokenValue(attempt.usage.cachedTokens),
    },
    finishReason: attempt.finishReason,
    phaseTimingsMs: {
      provider: attempt.providerElapsedMs,
    },
  }
}

function registerSampleAttempts(
  attempts: readonly ProviderAttemptObservation[],
  sampleIndex: number,
  attemptOwners: Map<string, number>,
  completionBudget: number,
): void {
  const uniqueForSample = new Set<string>()
  for (const attempt of attempts) {
    if (!ATTEMPT_UUID.test(attempt.attemptDiagnosticId)) failInput()
    const attemptId = attempt.attemptDiagnosticId.toLowerCase()
    uniqueForSample.add(attemptId)
    const existingOwner = attemptOwners.get(attemptId)
    if (existingOwner !== undefined && existingOwner !== sampleIndex) failInput()
    attemptOwners.set(attemptId, sampleIndex)

    const completionTokens = attempt.usage.completionTokens
    if (
      completionTokens.status === 'known' &&
      (!Number.isSafeInteger(completionTokens.value) ||
        completionTokens.value < 0 ||
        completionTokens.value > completionBudget)
    ) failInput()
  }
  if (uniqueForSample.size > 2) failInput()
}

function appendAttempts(
  target: CompletionUsageObservation[],
  attempts: readonly ProviderAttemptObservation[],
  timings?: { normalize?: number; total?: number },
): void {
  const observations = attempts.map(attemptObservation)
  const last = observations.at(-1)
  if (last && timings) {
    last.phaseTimingsMs = {
      ...last.phaseTimingsMs,
      ...(timings.normalize === undefined ? {} : { normalize: timings.normalize }),
      ...(timings.total === undefined ? {} : { total: timings.total }),
    }
  }
  target.push(...observations)
}

function incrementFailure(
  failures: Partial<Record<BenchmarkFailureCode, number>>,
  code: BenchmarkFailureCode,
): void {
  failures[code] = (failures[code] ?? 0) + 1
}

function countExactMatches(transcript: string, quote: string): number {
  if (quote.length === 0) return 0
  const firstMatch = transcript.indexOf(quote)
  if (firstMatch < 0) return 0
  return transcript.indexOf(quote, firstMatch + 1) < 0 ? 1 : 2
}

function evidenceQuotes(result: MultimodalGradingResult): string[] {
  return [
    ...result.dimensionScores.map(({ evidence }) => evidence),
    ...result.issues.map(({ originalText }) => originalText),
    ...result.sentenceRevisions.map(({ originalText }) => originalText),
    ...result.expressionUpgrades.map(({ originalText }) => originalText),
    ...result.fullTextRevision.sentencePairs.map(({ originalText }) => originalText),
    ...result.fullTextRevision.logicIssues.flatMap(
      ({ originalText, contextBefore, contextAfter }) => [
        originalText,
        contextBefore,
        contextAfter,
      ].filter((value) => value.length > 0),
    ),
    ...result.legibilityIssues.map(({ transcriptText }) => transcriptText),
  ]
}

function fieldCounts(result: MultimodalGradingResult): Record<BenchmarkFieldName, number> {
  return {
    issues: result.issues.length,
    sentenceRevisions: result.sentenceRevisions.length,
    expressionUpgrades: result.expressionUpgrades.length,
    sentencePairs: result.fullTextRevision.sentencePairs.length,
    logicNotes: result.fullTextRevision.logicNotes.length,
    logicIssues: result.fullTextRevision.logicIssues.length,
    legibilityIssues: result.legibilityIssues.length,
  }
}

function distribution(values: readonly number[]): NumericDistribution {
  return {
    sampleCount: values.length,
    min: values.length === 0 ? null : Math.min(...values),
    max: values.length === 0 ? null : Math.max(...values),
    median: calculateMedian(values),
  }
}

function scoreSummary(values: readonly number[]): ScalarMetricSummary {
  return {
    mean:
      values.length === 0
        ? notMeasurable('no_accepted_results')
        : calculateMean(values),
    median: calculateMedian(values),
    measurableSampleCount: values.length,
  }
}

function completionMetrics(
  observations: readonly CompletionUsageObservation[],
  unobservedProviderCallCount: number,
): BenchmarkCompletionMetrics {
  const aggregate = aggregateUniqueCompletionMetrics(observations)
  const finishReasons: BenchmarkCompletionMetrics['finishReasons'] = {
    counts: {
      stop: 0,
      length: 0,
      content_filter: 0,
      tool_calls: 0,
    },
    unknownCount: aggregate.finishReasons.unknownCount,
  }
  for (const [reason, count] of Object.entries(aggregate.finishReasons.counts)) {
    if (Object.prototype.hasOwnProperty.call(finishReasons.counts, reason)) {
      finishReasons.counts[reason] = count
    } else {
      finishReasons.unknownCount += count
    }
  }
  if (unobservedProviderCallCount === 0) {
    return { ...aggregate, finishReasons, unobservedProviderCallCount }
  }
  const unknown = notMeasurable('incomplete_provider_attempt_telemetry')
  return {
    ...aggregate,
    unobservedProviderCallCount,
    tokens: {
      promptTokens: unknown,
      completionTokens: unknown,
      totalTokens: unknown,
      cachedTokens: unknown,
    },
    finishReasons: {
      ...finishReasons,
      unknownCount: finishReasons.unknownCount + unobservedProviderCallCount,
    },
    phaseTimingsMs: {
      queue: unknown,
      provider: unknown,
      parse: unknown,
      normalize: unknown,
      total: unknown,
    },
  }
}

function validateAssessment(value: unknown): BenchmarkSampleAssessment {
  if (!isRecord(value)) throw new Error('invalid_assessment')
  const issueLabels = value.detectedImportantIssueLabels
  const legibilityLabels = value.detectedImportantLegibilityLabels
  const hardRisks = value.hardRisks
  if (
    !Array.isArray(issueLabels) ||
    issueLabels.some((label) => typeof label !== 'string') ||
    !Array.isArray(legibilityLabels) ||
    legibilityLabels.some((label) => typeof label !== 'string') ||
    !isRecord(hardRisks) ||
    typeof hardRisks.studentMix !== 'boolean' ||
    typeof hardRisks.wrongTaskContext !== 'boolean' ||
    typeof hardRisks.piiLeakage !== 'boolean'
  ) {
    throw new Error('invalid_assessment')
  }
  return {
    detectedImportantIssueLabels: [...issueLabels],
    detectedImportantLegibilityLabels: [...legibilityLabels],
    hardRisks: {
      studentMix: hardRisks.studentMix,
      wrongTaskContext: hardRisks.wrongTaskContext,
      piiLeakage: hardRisks.piiLeakage,
    },
  }
}

async function observeSampleMetrics(
  observer: BenchmarkRunnerDependencies['observeSampleMetrics'],
  observation: BenchmarkSampleMetricObservation,
): Promise<void> {
  if (!observer) return
  try {
    await observer(observation)
  } catch {
    throw new BenchmarkRunnerError('sample_metric_observer_failed')
  }
}

function observedTotalTokens(
  attempts: readonly ProviderAttemptObservation[],
): number | null {
  if (attempts.length === 0) return null
  try {
    const totalTokens = aggregateUniqueCompletionMetrics(
      attempts.map(attemptObservation),
    ).tokens.totalTokens
    return totalTokens.status === 'measured' ? totalTokens.value : null
  } catch {
    return null
  }
}

function providerPageCopies(
  sample: BenchmarkRunnerSample,
  sampleId: string,
): GatewayImageInput[] {
  const pages = sample.pages.map((page, index) => {
    const copy: GatewayImageInput = {
      pageId: `${sampleId}-page-${index + 1}`,
      mimeType: page.mimeType,
      buffer: Buffer.from(page.buffer),
    }
    Object.freeze(copy)
    return copy
  })
  Object.freeze(pages)
  return pages
}

function assertProviderPageCopiesUnchanged(
  copies: readonly GatewayImageInput[],
  snapshotPages: readonly GatewayImageInput[],
): void {
  if (
    copies.length !== snapshotPages.length ||
    copies.some((page, index) =>
      !Buffer.isBuffer(page.buffer) ||
      page.mimeType !== snapshotPages[index].mimeType ||
      createHash('sha256').update(page.buffer).digest('hex') !==
        createHash('sha256').update(snapshotPages[index].buffer).digest('hex'),
    )
  ) failInput()
}

export async function runGradingBenchmark(
  input: BenchmarkRunnerInput,
  dependencies: BenchmarkRunnerDependencies,
): Promise<BenchmarkAggregateReport> {
  if (input.variant !== 'baseline' && input.variant !== 'candidate') failInput()
  const frozenProvenance = freezeProvenance(input.provenance, input.variant)
  const benchmark = snapshotRunnerInput(input, frozenProvenance)
  validateRunnerInput(benchmark)
  if (!snapshotMatchesProvenance(benchmark)) failProvenance()

  const now = dependencies.monotonicNow ?? performance.now.bind(performance)
  const signal = dependencies.signal ?? new AbortController().signal
  const failures: Record<BenchmarkFailureCode, number> = {
    provider_failure: 0,
    normalization_rejected: 0,
    assessment_failure: 0,
  }
  const attempts: CompletionUsageObservation[] = []
  const attemptOwners = new Map<string, number>()
  let unobservedProviderCallCount = 0
  const cerSamples: Array<{ reference: string; hypothesis: string }> = []
  const scoreErrors: number[] = []
  const issueObservations: ImportantLabelObservation[] = []
  const legibilityObservations: ImportantLabelObservation[] = []
  const evidenceObservations: Array<{ accepted: boolean; transcriptMatchCount: number }> = []
  const fieldValues = Object.fromEntries(
    FIELD_NAMES.map((field) => [field, [] as number[]]),
  ) as Record<BenchmarkFieldName, number[]>
  const hardRiskCounts = {
    studentMix: 0,
    wrongTaskContext: 0,
    highRiskLegibilityMiss: 0,
    piiLeakage: 0,
  }
  const sampleCounts: BenchmarkSampleCounts = {
    requested: benchmark.samples.length,
    providerSucceeded: 0,
    accepted: 0,
    providerFailures: 0,
    normalizationFailures: 0,
    assessmentFailures: 0,
    assessmentCoverage: 0,
  }

  for (let sampleIndex = 0; sampleIndex < benchmark.samples.length; sampleIndex += 1) {
    const sample = benchmark.samples[sampleIndex]
    const sampleId = sampleIdForIndex(sampleIndex)
    const totalStarted = now()
    const providerPages = providerPageCopies(sample, sampleId)
    let providerResult
    try {
      providerResult = await dependencies.provider.gradeEssay(Object.freeze({
        requestId: `benchmark-${benchmark.variant}-${sampleId}`,
        task: benchmark.task,
        essayId: sampleId,
        pages: providerPages,
        signal,
      }))
      assertProviderPageCopiesUnchanged(providerPages, sample.pages)
      assertSnapshotIntegrity(benchmark)
      registerSampleAttempts(
        providerResult.attempts,
        sampleIndex,
        attemptOwners,
        frozenProvenance.phaseBudgets.essay_grading_images,
      )
      sampleCounts.providerSucceeded += 1
      if (providerResult.attempts.length === 0) unobservedProviderCallCount += 1
    } catch (error) {
      if (error instanceof BenchmarkRunnerError) throw error
      assertProviderPageCopiesUnchanged(providerPages, sample.pages)
      assertSnapshotIntegrity(benchmark)
      if (error instanceof GradingProviderError) {
        const errorAttempts = error.details?.attemptObservations ?? []
        registerSampleAttempts(
          errorAttempts,
          sampleIndex,
          attemptOwners,
          frozenProvenance.phaseBudgets.essay_grading_images,
        )
        appendAttempts(attempts, errorAttempts)
        if (errorAttempts.length === 0) unobservedProviderCallCount += 1
      } else {
        unobservedProviderCallCount += 1
      }
      sampleCounts.providerFailures += 1
      incrementFailure(failures, 'provider_failure')
      await observeSampleMetrics(dependencies.observeSampleMetrics, {
        sampleIndex,
        cer: null,
        normalizedScoreError: null,
        totalTokens: null,
      })
      continue
    }

    const normalizeStarted = now()
    const normalized = normalizeMultimodalResult(providerResult.value, {
      requestId: `benchmark-${benchmark.variant}-${sampleId}`,
      essayId: sampleId,
      task: benchmark.task,
      provider: 'remote',
      createdAt: new Date(0).toISOString(),
      pageCount: sample.pages.length,
    })
    const normalizedAt = now()
    assertSnapshotIntegrity(benchmark)
    appendAttempts(attempts, providerResult.attempts, {
      normalize: elapsed(normalizeStarted, normalizedAt),
      total: elapsed(totalStarted, normalizedAt),
    })

    if (!normalized.ok) {
      sampleCounts.normalizationFailures += 1
      incrementFailure(failures, 'normalization_rejected')
      await observeSampleMetrics(dependencies.observeSampleMetrics, {
        sampleIndex,
        cer: null,
        normalizedScoreError: null,
        totalTokens: null,
      })
      continue
    }

    sampleCounts.accepted += 1
    const sampleCer = calculateCer(
      sample.reference.teacherTranscript,
      normalized.result.transcript,
    )
    cerSamples.push({
      reference: sample.reference.teacherTranscript,
      hypothesis: normalized.result.transcript,
    })
    const scoreError = normalizedScoreError(
      normalized.result.totalScore,
      sample.reference.teacherScore,
      sample.reference.fullScore,
    )
    if (scoreError.status === 'measured') scoreErrors.push(scoreError.value)
    for (const quote of evidenceQuotes(normalized.result)) {
      evidenceObservations.push({
        accepted: true,
        transcriptMatchCount: countExactMatches(normalized.result.transcript, quote),
      })
    }
    const resultCounts = fieldCounts(normalized.result)
    for (const field of FIELD_NAMES) fieldValues[field].push(resultCounts[field])

    if (dependencies.assessResult) {
      try {
        const assessmentInput = cloneFrozenJson({
          sampleId,
          expectedImportantIssueLabels: sample.reference.importantIssueLabels,
          expectedImportantLegibilityLabels: sample.reference.importantLegibilityLabels,
          result: normalized.result,
        })
        const assessment = validateAssessment(await dependencies.assessResult(assessmentInput))
        assertSnapshotIntegrity(benchmark)
        sampleCounts.assessmentCoverage += 1
        const detectedIssues = new Set(assessment.detectedImportantIssueLabels)
        const detectedLegibility = new Set(assessment.detectedImportantLegibilityLabels)
        for (const label of sample.reference.importantIssueLabels) {
          issueObservations.push({ important: true, detected: detectedIssues.has(label) })
        }
        for (const label of sample.reference.importantLegibilityLabels) {
          const detected = detectedLegibility.has(label)
          legibilityObservations.push({ important: true, detected })
          if (!detected) hardRiskCounts.highRiskLegibilityMiss += 1
        }
        if (assessment.hardRisks.studentMix) hardRiskCounts.studentMix += 1
        if (assessment.hardRisks.wrongTaskContext) hardRiskCounts.wrongTaskContext += 1
        if (assessment.hardRisks.piiLeakage) hardRiskCounts.piiLeakage += 1
      } catch (error) {
        if (error instanceof BenchmarkRunnerError) throw error
        sampleCounts.assessmentFailures += 1
        incrementFailure(failures, 'assessment_failure')
      }
    }

    await observeSampleMetrics(dependencies.observeSampleMetrics, {
      sampleIndex,
      cer: sampleCer.status === 'measured' ? sampleCer.value : null,
      normalizedScoreError:
        scoreError.status === 'measured' ? scoreError.value : null,
      totalTokens: observedTotalTokens(providerResult.attempts),
    })
    assertSnapshotIntegrity(benchmark)
  }

  const assessmentComplete =
    sampleCounts.accepted > 0 && sampleCounts.assessmentCoverage === sampleCounts.accepted
  const incompleteAssessment = notMeasurable('incomplete_sample_assessment')
  const hardRisks = assessmentComplete
    ? {
        studentMix: measured(hardRiskCounts.studentMix),
        wrongTaskContext: measured(hardRiskCounts.wrongTaskContext),
        highRiskLegibilityMiss: measured(hardRiskCounts.highRiskLegibilityMiss),
        piiLeakage: measured(hardRiskCounts.piiLeakage),
      }
    : {
        studentMix: incompleteAssessment,
        wrongTaskContext: incompleteAssessment,
        highRiskLegibilityMiss: incompleteAssessment,
        piiLeakage: incompleteAssessment,
      }

  const report: BenchmarkAggregateReport = {
    reportVersion: GRADING_BENCHMARK_REPORT_VERSION,
    variant: benchmark.variant,
    provenance: frozenProvenance,
    sampleCounts,
    failureCounts: failures,
    structuredSuccessRate: measured(sampleCounts.accepted / sampleCounts.requested),
    cer: (() => {
      const summary = summarizeCer(cerSamples)
      return {
        ...summary,
        excludedSampleCount:
          summary.excludedSampleCount +
          sampleCounts.providerFailures +
          sampleCounts.normalizationFailures,
      }
    })(),
    normalizedScoreError: scoreSummary(scoreErrors),
    importantIssueRecall: assessmentComplete
      ? calculateImportantRecall(issueObservations)
      : incompleteAssessment,
    importantLegibilityRecall: assessmentComplete
      ? calculateImportantRecall(legibilityObservations)
      : incompleteAssessment,
    evidenceLocation: calculateEvidenceLocationRate(evidenceObservations),
    hardRisks,
    blindReview: notMeasurable('human_blind_review_required'),
    completionMetrics: completionMetrics(attempts, unobservedProviderCallCount),
    fieldCounts: Object.fromEntries(
      FIELD_NAMES.map((field) => [field, distribution(fieldValues[field])]),
    ) as Record<BenchmarkFieldName, NumericDistribution>,
  }
  if (!isBenchmarkAggregateReport(report, benchmark.variant, frozenProvenance)) failInput()
  return report
}
