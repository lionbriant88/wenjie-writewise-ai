import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  mkdir,
  open as openFile,
  realpath as resolveRealPath,
  rename,
  stat as statFile,
} from 'node:fs/promises'
import { resolve } from 'node:path'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadDotenv } from 'dotenv'
import {
  createGatewayExecutionServices,
  createServer as createGatewayServer,
  type GatewayExecutionServices,
} from '../../src/server.js'
import {
  parseGatewayRuntimeConfig,
  type GatewayRuntimeConfig,
} from '../../src/gatewayRuntimeConfig.js'
import { GRADING_POLICY_VERSION } from '../../src/multimodal/gradingPolicy.js'
import {
  ESSAY_PROVIDER_SCHEMA_VERSION,
  LEGACY_ESSAY_PROVIDER_SCHEMA_VERSION,
} from '../../src/multimodal/modelTaskContext.js'
import { validateConfirmedRubric } from '../../src/multimodal/validateRubric.js'
import type { ConfirmedTaskPackageV2 } from '../../src/multimodal/types.js'
import type { MultimodalProvider } from '../../src/providers/multimodalProviderTypes.js'
import type { GatewayImageInput } from '../../src/providers/multimodalProviderTypes.js'
import { getMultimodalProvider } from '../../src/providers/index.js'
import {
  createProviderTelemetryRecorder,
  type ProviderTelemetryRecorder,
} from '../../src/providerTelemetry.js'
import {
  validateDatasetComposition,
  validateDatasetManifest,
} from './manifest.js'
import {
  calculateMean,
  calculateMedian,
  pairedBootstrap95,
} from './metrics.js'
import {
  evaluateQualityGates,
  type BlindReviewInput,
  type QualityGateName,
  type QualityGateResult,
} from './qualityGates.js'
import {
  runGradingBenchmark,
  isBenchmarkAggregateReport,
  isBenchmarkProvenance,
  type BenchmarkAggregateReport,
  type BenchmarkProvenance,
  type BenchmarkRunnerDependencies,
  type BenchmarkSampleMetricObservation,
  GRADING_BENCHMARK_VERSION,
  GRADING_BENCHMARK_REPORT_VERSION,
} from './runner.js'
import type {
  GradingBenchmarkManifest,
  ValidatedDatasetManifest,
} from './types.js'

export type BenchmarkCliRequest =
  | { mode: 'quality'; variant: 'baseline' | 'candidate' }
  | { mode: 'soak'; calls: 100 }
  | { mode: 'throughput'; essays: 30 }
  | { mode: 'image-variants' }

export type BenchmarkCliOutcome =
  | { status: 'complete'; gatesPassed: boolean }
  | { status: 'inconclusive' }
  | { status: 'fatal' }

export interface BenchmarkCliDependencies {
  /** @deprecated Use authorizationEnv and runtimeEnv to preserve the shell-only authorization boundary. */
  env?: NodeJS.ProcessEnv
  authorizationEnv?: NodeJS.ProcessEnv
  runtimeEnv?: NodeJS.ProcessEnv
  output?: (line: string) => void
  createProvider?: (input: { apiKey: string; env: NodeJS.ProcessEnv }) => unknown
  runBenchmark?: (
    request: BenchmarkCliRequest,
    provider: unknown,
  ) => Promise<BenchmarkCliOutcome>
  createCommand?: (
    context: BenchmarkCliCommandContext,
  ) => BenchmarkCliCommand
}

export interface BenchmarkCliCommandContext {
  request: BenchmarkCliRequest
  apiKey: string
  runtimeEnv: NodeJS.ProcessEnv
  profile: BenchmarkExecutionProfile
  paths: BenchmarkPrivatePaths
}

export interface BenchmarkCliCommand {
  execute(): Promise<BenchmarkCliOutcome>
}

export type SafeBenchmarkReportFilename =
  | 'quality-baseline.json'
  | 'quality-candidate.json'
  | 'soak.json'
  | 'throughput.json'
  | 'image-variants.json'

export interface SafeBenchmarkCommandReport {
  reportVersion: 'grading-benchmark-command-report-v1'
  request: BenchmarkExecutionProfile['request']
  conclusion: 'pass' | 'fail' | 'inconclusive' | 'fatal'
  reason:
    | null
    | 'explicit_image_transformer_required'
    | 'baseline_state_required'
    | 'benchmark_identity_mismatch'
    | 'external_human_review_evidence_required'
    | 'external_candidate_state_or_bound_evidence_required'
    | 'external_candidate_run_and_human_review_required'
    | 'external_candidate_evidence_unverified'
    | 'external_soak_audit_adapter_required'
  invocationBudget: InvocationBudgetSnapshot
  quality: unknown | null
  qualityGates: unknown | null
  soak: unknown | null
  throughput: unknown | null
}

export interface QualityBaselineState {
  stateVersion: 'grading-benchmark-quality-state-v1'
  manifestSha256: string
  datasetSha256: string
  taskSha256: string
  provenance: BenchmarkProvenance
  quality: BenchmarkAggregateReport
  sampleMetrics: BenchmarkSampleMetricObservation[]
}

export interface QualityCandidateState {
  stateVersion: 'grading-benchmark-quality-candidate-state-v1'
  manifestSha256: string
  datasetSha256: string
  taskSha256: string
  runIdentitySha256: string
  candidateRunSha256: string
  provenance: BenchmarkProvenance
  quality: BenchmarkAggregateReport
  sampleMetrics: BenchmarkSampleMetricObservation[]
}

export interface PairedHumanQualityEvidence {
  importantIssueRecall: {
    baseline: { matched: number; total: number }
    candidate: { matched: number; total: number }
  }
  importantLegibilityRecall: {
    baseline: { matched: number; total: number }
    candidate: { matched: number; total: number }
  }
  hardRisks: {
    studentMix: number
    wrongTaskContext: number
    highRiskLegibilityMiss: number
    piiLeakage: number
  }
  blindReview: BlindReviewInput
}

export interface HumanReviewEvidence extends PairedHumanQualityEvidence {
  evidenceVersion: 'grading-benchmark-human-evidence-v1'
  protocolRevision: 'grading-benchmark-human-review-protocol-v1'
  datasetSha256: string
  taskSha256: string
  baselineProvenance: BenchmarkProvenance
  candidateProvenance: BenchmarkProvenance
  candidateRunSha256: string
}

export interface HumanReviewExecutionPlan {
  planVersion: 'grading-benchmark-human-review-plan-v1'
  protocolRevision: 'grading-benchmark-human-review-protocol-v1'
  datasetSha256: string
  taskSha256: string
  gitCommit: string
  benchmarkVersion: typeof GRADING_BENCHMARK_VERSION
  policyVersion: typeof GRADING_POLICY_VERSION
  randomizedAB: true
  secondaryReviewerStrategy: 'independent_teacher' | 'same_teacher_delayed'
  sameTeacherReviewIntervalDays: number | null
}

export interface ExternalHumanReviewAdapter {
  plan: HumanReviewExecutionPlan
  runIdentitySha256: string
  assessAndPresentResult: NonNullable<BenchmarkRunnerDependencies['assessResult']>
  createHumanEvidence(input: {
    baselineState: Readonly<QualityBaselineState>
    candidateState: Readonly<QualityCandidateState>
  }): HumanReviewEvidence | Promise<HumanReviewEvidence>
}

type PairedQualityGateName = Exclude<QualityGateName, 'soak' | 'throughput'>

export interface PairedQualityGateReport {
  status: 'pass' | 'fail' | 'inconclusive'
  gates: Record<PairedQualityGateName, QualityGateResult>
}

function completeObservationField(
  observations: readonly BenchmarkSampleMetricObservation[],
  field: 'cer' | 'normalizedScoreError' | 'totalTokens',
): number[] | null {
  if (observations.length !== 40) return null
  const values: number[] = []
  for (let index = 0; index < observations.length; index += 1) {
    const observation = observations[index]
    if (observation.sampleIndex !== index) return null
    const value = observation[field]
    if (value === null || !Number.isFinite(value) || value < 0) return null
    values.push(value)
  }
  return values
}

export function evaluatePairedQualityGates(
  baseline: BenchmarkAggregateReport,
  baselineObservations: readonly BenchmarkSampleMetricObservation[],
  candidate: BenchmarkAggregateReport,
  candidateObservations: readonly BenchmarkSampleMetricObservation[],
  humanEvidence: PairedHumanQualityEvidence | undefined,
): PairedQualityGateReport {
  const baselineCer = completeObservationField(baselineObservations, 'cer')
  const candidateCer = completeObservationField(candidateObservations, 'cer')
  const baselineScore = completeObservationField(baselineObservations, 'normalizedScoreError')
  const candidateScore = completeObservationField(candidateObservations, 'normalizedScoreError')
  const baselineTokens = completeObservationField(baselineObservations, 'totalTokens')
  const candidateTokens = completeObservationField(candidateObservations, 'totalTokens')
  const cerInterval = baselineCer && candidateCer
    ? pairedBootstrap95(baselineCer, candidateCer)
    : null
  const scoreInterval = baselineScore && candidateScore
    ? pairedBootstrap95(baselineScore, candidateScore)
    : null
  const baselineTokenMedian = baselineTokens ? calculateMedian(baselineTokens) : null
  const candidateTokenMedian = candidateTokens ? calculateMedian(candidateTokens) : null
  const candidateEvidence = candidate.evidenceLocation
  const recallRate = (counts: { matched: number; total: number } | undefined) => (
    counts && counts.total > 0 ? counts.matched / counts.total : null
  )
  const all = evaluateQualityGates({
    structuredSuccess: {
      baseline: {
        accepted: baseline.sampleCounts.accepted,
        total: baseline.sampleCounts.requested,
      },
      candidate: {
        accepted: candidate.sampleCounts.accepted,
        total: candidate.sampleCounts.requested,
      },
    },
    tokenMedians: {
      baseline: baselineTokenMedian?.status === 'measured' ? baselineTokenMedian.value : null,
      candidate: candidateTokenMedian?.status === 'measured' ? candidateTokenMedian.value : null,
    },
    ...(cerInterval?.status === 'measured'
      ? { cerDegradation95: cerInterval.value }
      : {}),
    ...(scoreInterval?.status === 'measured'
      ? { scoreErrorDegradation95: scoreInterval.value }
      : {}),
    importantIssueRecall: {
      baseline: recallRate(humanEvidence?.importantIssueRecall.baseline),
      candidate: recallRate(humanEvidence?.importantIssueRecall.candidate),
    },
    importantLegibilityRecall: {
      baseline: recallRate(humanEvidence?.importantLegibilityRecall.baseline),
      candidate: recallRate(humanEvidence?.importantLegibilityRecall.candidate),
    },
    ...(candidateEvidence.status === 'measured'
      ? {
          evidence: {
            uniquelyLocated: candidateEvidence.uniquelyLocated,
            total: candidateEvidence.total,
          },
        }
      : {}),
    ...(humanEvidence ? { hardRisks: humanEvidence.hardRisks } : {}),
    blindReview: humanEvidence?.blindReview,
  })
  const names: PairedQualityGateName[] = [
    'structuredSuccess',
    'tokenReduction',
    'cerDegradation',
    'scoreErrorDegradation',
    'importantIssueRecall',
    'importantLegibilityRecall',
    'evidenceLocation',
    'hardRisks',
    'blindReview',
  ]
  const gates = Object.fromEntries(names.map((name) => [name, all.gates[name]])) as
    Record<PairedQualityGateName, QualityGateResult>
  const statuses = Object.values(gates).map(({ status }) => status)
  return {
    status: statuses.includes('fail')
      ? 'fail'
      : statuses.includes('not_measurable')
        ? 'inconclusive'
        : 'pass',
    gates,
  }
}

const SAFE_REPORT_FILENAMES = new Set<SafeBenchmarkReportFilename>([
  'quality-baseline.json',
  'quality-candidate.json',
  'soak.json',
  'throughput.json',
  'image-variants.json',
])
const SAFE_REPORT_KEYS = [
  'reportVersion',
  'request',
  'conclusion',
  'reason',
  'invocationBudget',
  'quality',
  'qualityGates',
  'soak',
  'throughput',
] as const

const SAFE_COMMAND_REASONS = new Set<SafeBenchmarkCommandReport['reason']>([
  null,
  'explicit_image_transformer_required',
  'baseline_state_required',
  'benchmark_identity_mismatch',
  'external_human_review_evidence_required',
  'external_candidate_state_or_bound_evidence_required',
  'external_candidate_run_and_human_review_required',
  'external_candidate_evidence_unverified',
  'external_soak_audit_adapter_required',
])

const SAFE_GATE_REASONS = new Set([
  'missing_or_invalid_structured_success',
  'unknown_or_invalid_token_median',
  'missing_or_invalid_cer_confidence_interval',
  'missing_or_invalid_score_confidence_interval',
  'unknown_or_zero_denominator_recall',
  'no_or_invalid_accepted_evidence',
  'missing_hard_risk_audit',
  'invalid_hard_risk_audit',
  'requires_exactly_100_valid_calls',
  'requires_30_essays_and_effective_concurrency_at_least_4',
  'missing_or_invalid_blind_review',
  'requires_exactly_40_samples',
  'requires_complete_review',
  'requires_20_percent_secondary_review',
  'requires_zero_unresolved_arbitrations',
  'systematic_degradation_detected',
  'requires_randomized_ab',
  'requires_independent_or_seven_day_review',
  'throughput_hard_limit_exceeded',
  'candidate_first_success_slower',
  'throughput_rounds_not_isolated_or_unsettled',
  'missing_or_invalid_soak_assessment',
])

function isStrictInvocationBudget(value: unknown, expectedBudget: number): boolean {
  return isRecord(value) && hasExactKeys(value, ['budget', 'invoked', 'remaining']) &&
    value.budget === expectedBudget &&
    Number.isSafeInteger(value.invoked) && (value.invoked as number) >= 0 &&
    (value.invoked as number) <= expectedBudget &&
    value.remaining === expectedBudget - (value.invoked as number)
}

function isStrictQualityGateResult(value: unknown): value is QualityGateResult {
  if (!isRecord(value)) return false
  const hasReason = Object.prototype.hasOwnProperty.call(value, 'reason')
  if (!hasExactKeys(value, hasReason
    ? ['status', 'actual', 'threshold', 'reason']
    : ['status', 'actual', 'threshold'])) return false
  if (value.status !== 'pass' && value.status !== 'fail' && value.status !== 'not_measurable') {
    return false
  }
  if (!(
    value.actual === null || (typeof value.actual === 'number' && Number.isFinite(value.actual))
  ) || !(
    value.threshold === null ||
    (typeof value.threshold === 'number' && Number.isFinite(value.threshold))
  )) return false
  if (hasReason) {
    return typeof value.reason === 'string' && SAFE_GATE_REASONS.has(value.reason)
  }
  return value.status === 'pass' || value.status === 'fail'
}

const PAIRED_GATE_NAMES: readonly PairedQualityGateName[] = [
  'structuredSuccess',
  'tokenReduction',
  'cerDegradation',
  'scoreErrorDegradation',
  'importantIssueRecall',
  'importantLegibilityRecall',
  'evidenceLocation',
  'hardRisks',
  'blindReview',
]

function isStrictPairedQualityGates(value: unknown): value is PairedQualityGateReport {
  if (!isRecord(value) || !hasExactKeys(value, ['status', 'gates']) ||
    (value.status !== 'pass' && value.status !== 'fail' && value.status !== 'inconclusive') ||
    !isRecord(value.gates) || !hasExactKeys(value.gates, PAIRED_GATE_NAMES) ||
    !Object.values(value.gates).every(isStrictQualityGateResult)) return false
  const gates = value.gates as Record<string, QualityGateResult>
  const statuses = Object.values(gates).map((gate) => gate.status)
  const expected = statuses.includes('fail')
    ? 'fail'
    : statuses.includes('not_measurable') ? 'inconclusive' : 'pass'
  return value.status === expected
}

function isStrictSoakConclusion(value: unknown): value is {
  status: 'pass' | 'fail' | 'inconclusive'
  gates: {
    soak: QualityGateResult
    evidenceLocation: QualityGateResult
    assessmentCoverage: QualityGateResult
    hardRisks: QualityGateResult
  }
} {
  if (!isRecord(value) || !hasExactKeys(value, ['status', 'gates']) ||
    (value.status !== 'pass' && value.status !== 'fail' && value.status !== 'inconclusive') ||
    !isRecord(value.gates) || !hasExactKeys(value.gates, [
      'soak',
      'evidenceLocation',
      'assessmentCoverage',
      'hardRisks',
    ])) return false
  const gates = Object.values(value.gates)
  if (!gates.every(isStrictQualityGateResult)) return false
  const statuses = gates.map((gate) => gate.status)
  return value.status === (statuses.includes('fail')
    ? 'fail'
    : statuses.includes('not_measurable') ? 'inconclusive' : 'pass')
}

function isStrictThroughputRunEvidence(value: unknown): value is ThroughputRunEvidence {
  if (!isRecord(value) || !hasExactKeys(value, [
    'requested',
    'completed',
    'uniqueEssays',
    'attachmentRequests',
    'httpCompletedAttachments',
    'providerInvocations',
    'providerCompletions',
    'uniqueAttempts',
    'usageKnownAttempts',
    'wallMs',
    'firstSuccessMs',
    'hardLimit',
    'clientConcurrency',
    'maxActiveLeases',
    'maxActiveProviderCalls',
    'unsettledProviderCalls',
    'settlementTimedOut',
  ])) return false
  const countsAreSafe = [
    value.requested,
    value.completed,
    value.uniqueEssays,
    value.attachmentRequests,
    value.httpCompletedAttachments,
    value.providerInvocations,
    value.providerCompletions,
    value.uniqueAttempts,
    value.usageKnownAttempts,
    value.hardLimit,
    value.clientConcurrency,
    value.maxActiveLeases,
    value.maxActiveProviderCalls,
    value.unsettledProviderCalls,
  ].every((item) => Number.isSafeInteger(item) && (item as number) >= 0)
  if (!countsAreSafe || typeof value.settlementTimedOut !== 'boolean') return false
  const evidence = value as unknown as ThroughputRunEvidence
  return evidence.requested === 30 && evidence.uniqueEssays === 30 &&
    evidence.completed <= evidence.uniqueEssays &&
    evidence.httpCompletedAttachments <= evidence.attachmentRequests &&
    evidence.providerInvocations <= 30 &&
    evidence.providerCompletions <= evidence.providerInvocations &&
    evidence.usageKnownAttempts <= evidence.uniqueAttempts &&
    evidence.unsettledProviderCalls <= evidence.providerInvocations &&
    evidence.maxActiveProviderCalls <= evidence.providerInvocations &&
    evidence.hardLimit >= 1 &&
    (evidence.settlementTimedOut || evidence.unsettledProviderCalls === 0) &&
    (evidence.wallMs === null || (typeof evidence.wallMs === 'number' && Number.isFinite(evidence.wallMs) && evidence.wallMs > 0)) &&
    (evidence.firstSuccessMs === null || (
      typeof evidence.firstSuccessMs === 'number' && Number.isFinite(evidence.firstSuccessMs) && evidence.firstSuccessMs >= 0
    ))
}

function isStrictThroughputConclusion(value: unknown): value is ThroughputReportPayload {
  if (!isRecord(value) || !hasExactKeys(value, [
    'status',
    'gate',
    'baseline',
    'candidate',
    'roundIsolation',
    'provenance',
  ]) ||
    (value.status !== 'pass' && value.status !== 'fail' && value.status !== 'inconclusive') ||
    !isStrictQualityGateResult(value.gate) ||
    !isStrictThroughputRunEvidence(value.baseline) ||
    !isStrictThroughputRunEvidence(value.candidate) ||
    !isRecord(value.roundIsolation) ||
    !hasExactKeys(value.roundIsolation, [
      'baselineSettledBeforeCandidate',
      'candidateStarted',
      'roundsOverlapped',
    ]) ||
    typeof value.roundIsolation.baselineSettledBeforeCandidate !== 'boolean' ||
    typeof value.roundIsolation.candidateStarted !== 'boolean' ||
    typeof value.roundIsolation.roundsOverlapped !== 'boolean' ||
    !isRecord(value.provenance) ||
    !hasExactKeys(value.provenance, ['baseline', 'candidate']) ||
    !isStrictBenchmarkProvenance(value.provenance.baseline, 'baseline') ||
    !isStrictBenchmarkProvenance(value.provenance.candidate, 'candidate') ||
    !commonProvenanceMatches(value.provenance.baseline, value.provenance.candidate)) return false
  const expected = evaluateThroughputConclusion({
    baseline: value.baseline,
    candidate: value.candidate,
    roundIsolation: value.roundIsolation as unknown as ThroughputRoundIsolationEvidence,
  })
  return value.status === expected.status &&
    value.gate.status === expected.gate.status &&
    value.gate.actual === expected.gate.actual &&
    value.gate.threshold === expected.gate.threshold &&
    value.gate.reason === expected.gate.reason
}

function validateSafeReport(
  filename: SafeBenchmarkReportFilename,
  report: SafeBenchmarkCommandReport,
): void {
  if (
    !SAFE_REPORT_FILENAMES.has(filename) ||
    !isRecord(report) ||
    Object.keys(report).length !== SAFE_REPORT_KEYS.length ||
    Object.keys(report).some((key) => !SAFE_REPORT_KEYS.includes(
      key as (typeof SAFE_REPORT_KEYS)[number],
    )) ||
    report.reportVersion !== 'grading-benchmark-command-report-v1' ||
    !SAFE_COMMAND_REASONS.has(report.reason) ||
    (report.conclusion !== 'pass' && report.conclusion !== 'fail' &&
      report.conclusion !== 'inconclusive' && report.conclusion !== 'fatal')
  ) {
    throw new Error('invalid_safe_benchmark_report')
  }
  const expectedRequest = filename === 'quality-baseline.json'
    ? 'quality-baseline'
    : filename === 'quality-candidate.json'
      ? 'quality-candidate'
      : filename.slice(0, -'.json'.length)
  if (report.request !== expectedRequest) {
    throw new Error('invalid_safe_benchmark_report')
  }
  const expectedVariant = report.request === 'quality-baseline'
    ? 'baseline'
    : report.request === 'quality-candidate' || report.request === 'soak'
      ? 'candidate'
      : undefined
  if (
    report.quality !== null &&
    (expectedVariant === undefined ||
      !isBenchmarkAggregateReport(report.quality, expectedVariant))
  ) {
    throw new Error('invalid_safe_benchmark_report')
  }
  const valid = report.request === 'quality-baseline'
    ? isStrictInvocationBudget(report.invocationBudget, 40) &&
      report.reason === 'external_candidate_run_and_human_review_required' &&
      report.conclusion === 'inconclusive' &&
      report.qualityGates === null && report.soak === null && report.throughput === null
    : report.request === 'quality-candidate'
      ? isStrictInvocationBudget(report.invocationBudget, 40) &&
        report.soak === null && report.throughput === null &&
        ((report.quality === null && report.qualityGates === null &&
          report.conclusion === 'inconclusive' && report.reason !== null) ||
          (report.quality !== null && isStrictPairedQualityGates(report.qualityGates) &&
            (report.qualityGates.status === 'pass'
              ? report.conclusion === 'inconclusive' &&
                report.reason === 'external_candidate_evidence_unverified'
              : report.conclusion === report.qualityGates.status && report.reason === null)))
      : report.request === 'soak'
        ? isStrictInvocationBudget(report.invocationBudget, 100) &&
          report.qualityGates === null && report.throughput === null && (
            (report.reason === 'external_soak_audit_adapter_required' &&
              report.conclusion === 'inconclusive' &&
              report.invocationBudget.invoked === 0 && report.quality === null &&
              report.soak === null) ||
            (report.reason === null && report.quality !== null &&
              isStrictSoakConclusion(report.soak) &&
              report.conclusion === report.soak.status)
          )
        : report.request === 'throughput'
          ? isStrictInvocationBudget(report.invocationBudget, 60) &&
            report.reason === null && report.quality === null && report.qualityGates === null &&
            report.soak === null && isStrictThroughputConclusion(report.throughput) &&
            report.conclusion === report.throughput.status &&
            report.invocationBudget.invoked ===
              report.throughput.baseline.providerInvocations +
              report.throughput.candidate.providerInvocations
          : isStrictInvocationBudget(report.invocationBudget, 0) &&
            report.reason === 'explicit_image_transformer_required' &&
            report.conclusion === 'inconclusive' && report.quality === null &&
            report.qualityGates === null && report.soak === null && report.throughput === null
  if (!valid) throw new Error('invalid_safe_benchmark_report')
}

export async function writeSafeBenchmarkReport(
  paths: BenchmarkPrivatePaths,
  filename: SafeBenchmarkReportFilename,
  report: SafeBenchmarkCommandReport,
): Promise<void> {
  validateSafeReport(filename, report)
  if (!path.isAbsolute(paths.resultRoot)) {
    throw new Error('invalid_safe_benchmark_report')
  }
  await mkdir(paths.resultRoot, { recursive: true })
  const realRoot = path.resolve(await resolveRealPath(paths.resultRoot))
  const destination = path.resolve(realRoot, filename)
  if (!isWithinRoot(realRoot, destination)) {
    throw new Error('invalid_safe_benchmark_report')
  }
  const temporary = path.resolve(realRoot, `.${filename}.${randomUUID()}.tmp`)
  const handle = await openFile(temporary, 'wx')
  try {
    await handle.writeFile(`${JSON.stringify(report)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, destination)
}

const BENCHMARK_PROVENANCE_KEYS = [
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
function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function isStrictBenchmarkProvenance(
  value: unknown,
  expectedProfile: 'baseline' | 'candidate',
): value is BenchmarkProvenance {
  return isBenchmarkProvenance(value, expectedProfile)
}

function sameBenchmarkProvenance(
  left: BenchmarkProvenance,
  right: BenchmarkProvenance,
): boolean {
  return BENCHMARK_PROVENANCE_KEYS.every((key) => (
    key === 'phaseBudgets' || key === 'featureProfiles'
      ? JSON.stringify(left[key]) === JSON.stringify(right[key])
      : left[key] === right[key]
  ))
}

function validateQualityBaselineState(value: unknown): value is QualityBaselineState {
  if (!isRecord(value)) return false
  const keys = [
    'stateVersion',
    'manifestSha256',
    'datasetSha256',
    'taskSha256',
    'provenance',
    'quality',
    'sampleMetrics',
  ]
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    value.stateVersion !== 'grading-benchmark-quality-state-v1' ||
    typeof value.manifestSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.manifestSha256) ||
    typeof value.datasetSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.datasetSha256) ||
    typeof value.taskSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.taskSha256) ||
    !Array.isArray(value.sampleMetrics) ||
    value.sampleMetrics.length !== 40 ||
    !isStrictBenchmarkProvenance(value.provenance, 'baseline') ||
    value.provenance.manifestSha256 !== value.manifestSha256 ||
    value.provenance.datasetSha256 !== value.datasetSha256 ||
    !isRecord(value.quality) ||
    value.quality.reportVersion !== GRADING_BENCHMARK_REPORT_VERSION ||
    value.quality.variant !== 'baseline' ||
    !isStrictBenchmarkProvenance(value.quality.provenance, 'baseline') ||
    !sameBenchmarkProvenance(value.provenance, value.quality.provenance) ||
    !isBenchmarkAggregateReport(value.quality, 'baseline', value.provenance)
  ) return false
  return sampleMetricsMatchAggregate(
    value.sampleMetrics,
    value.quality as unknown as BenchmarkAggregateReport,
  )
}

function isStrictSampleMetrics(value: unknown): value is BenchmarkSampleMetricObservation[] {
  if (!Array.isArray(value) || value.length !== 40) return false
  return value.every((metric, index) => {
    if (!isRecord(metric) || !hasExactKeys(metric, [
      'sampleIndex',
      'cer',
      'normalizedScoreError',
      'totalTokens',
    ])) return false
    if (metric.sampleIndex !== index) return false
    const cer = metric.cer
    const scoreError = metric.normalizedScoreError
    const totalTokens = metric.totalTokens
    return (cer === null || (
      typeof cer === 'number' && Number.isFinite(cer) && cer >= 0
    )) && (scoreError === null || (
      typeof scoreError === 'number' && Number.isFinite(scoreError) &&
      scoreError >= 0 && scoreError <= 1
    )) && (totalTokens === null || (
      Number.isSafeInteger(totalTokens) && (totalTokens as number) >= 0
    ))
  })
}

function sampleMetricsMatchAggregate(
  value: unknown,
  quality: BenchmarkAggregateReport,
): value is BenchmarkSampleMetricObservation[] {
  if (!isStrictSampleMetrics(value)) return false
  if (quality.sampleCounts.requested !== value.length) return false
  if (value.some((metric) => metric.totalTokens !== null && (
    metric.cer === null || metric.normalizedScoreError === null
  ))) return false
  const accepted = quality.sampleCounts.accepted
  const cerValues = value.flatMap((metric) => metric.cer === null ? [] : [metric.cer])
  const scoreValues = value.flatMap((metric) => (
    metric.normalizedScoreError === null ? [] : [metric.normalizedScoreError]
  ))
  if (cerValues.length !== accepted || scoreValues.length !== accepted) return false

  if (accepted > 0) {
    const cerMean = calculateMean(cerValues)
    const scoreMean = calculateMean(scoreValues)
    const scoreMedian = calculateMedian(scoreValues)
    if (
      cerMean.status !== 'measured' || quality.cer.macro.status !== 'measured' ||
      cerMean.value !== quality.cer.macro.value ||
      scoreMean.status !== 'measured' || quality.normalizedScoreError.mean.status !== 'measured' ||
      scoreMean.value !== quality.normalizedScoreError.mean.value ||
      scoreMedian.status !== 'measured' || quality.normalizedScoreError.median.status !== 'measured' ||
      scoreMedian.value !== quality.normalizedScoreError.median.value
    ) return false
  }

  const tokenValues = value.map((metric) => metric.totalTokens)
  if (tokenValues.every((tokens): tokens is number => tokens !== null)) {
    let tokenSum = 0
    for (const tokens of tokenValues) {
      tokenSum += tokens
      if (!Number.isSafeInteger(tokenSum)) return false
    }
    const aggregateTotal = quality.completionMetrics.tokens.totalTokens
    if (
      quality.completionMetrics.unobservedProviderCallCount !== 0 ||
      aggregateTotal.status !== 'measured' ||
      aggregateTotal.value !== tokenSum
    ) return false
  }
  return true
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('invalid_benchmark_state')
    return JSON.stringify(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (!isRecord(value)) throw new Error('invalid_benchmark_state')
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`
}

type CandidateRunIdentityInput = Pick<QualityCandidateState,
  | 'manifestSha256'
  | 'datasetSha256'
  | 'taskSha256'
  | 'runIdentitySha256'
  | 'provenance'
  | 'quality'
  | 'sampleMetrics'>

export function computeQualityCandidateRunSha256(
  state: CandidateRunIdentityInput,
): string {
  const hash = createHash('sha256')
  updateFramedHash(hash, Buffer.from('grading-benchmark-candidate-run-v1', 'utf8'))
  updateFramedHash(hash, Buffer.from(canonicalJson({
    manifestSha256: state.manifestSha256,
    datasetSha256: state.datasetSha256,
    taskSha256: state.taskSha256,
    runIdentitySha256: state.runIdentitySha256,
    provenance: state.provenance,
    quality: state.quality,
    sampleMetrics: state.sampleMetrics,
  }), 'utf8'))
  return hash.digest('hex')
}

function validateQualityCandidateState(value: unknown): value is QualityCandidateState {
  if (!isRecord(value) || !hasExactKeys(value, [
    'stateVersion',
    'manifestSha256',
    'datasetSha256',
    'taskSha256',
    'runIdentitySha256',
    'candidateRunSha256',
    'provenance',
    'quality',
    'sampleMetrics',
  ])) return false
  if (
    value.stateVersion !== 'grading-benchmark-quality-candidate-state-v1' ||
    typeof value.manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.manifestSha256) ||
    typeof value.datasetSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.datasetSha256) ||
    typeof value.taskSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.taskSha256) ||
    typeof value.runIdentitySha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.runIdentitySha256) ||
    typeof value.candidateRunSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.candidateRunSha256) ||
    !isStrictBenchmarkProvenance(value.provenance, 'candidate') ||
    value.provenance.manifestSha256 !== value.manifestSha256 ||
    value.provenance.datasetSha256 !== value.datasetSha256 ||
    !isBenchmarkAggregateReport(value.quality, 'candidate', value.provenance) ||
    !sampleMetricsMatchAggregate(
      value.sampleMetrics,
      value.quality as unknown as BenchmarkAggregateReport,
    )
  ) return false
  return value.candidateRunSha256 === computeQualityCandidateRunSha256(
    value as unknown as CandidateRunIdentityInput,
  )
}

export async function writeQualityCandidateState(
  paths: BenchmarkPrivatePaths,
  state: QualityCandidateState,
): Promise<void> {
  if (!validateQualityCandidateState(state)) {
    throw new Error('invalid_quality_candidate_state')
  }
  await writeAtomicResultJson(paths, 'quality-candidate-state.json', state)
}

export async function readQualityCandidateState(
  paths: BenchmarkPrivatePaths,
): Promise<QualityCandidateState | null> {
  let bytes: Buffer
  try {
    bytes = await readVerifiedPrivateFile(
      path.resolve(paths.resultRoot, 'quality-candidate-state.json'),
      paths.resultRoot,
      16 * 1024 * 1024,
    )
  } catch (error) {
    if (error instanceof PrivateBenchmarkBundleError && error.code === 'private_file_unavailable') {
      return null
    }
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new Error('invalid_quality_candidate_state')
  }
  if (!validateQualityCandidateState(parsed)) {
    throw new Error('invalid_quality_candidate_state')
  }
  return parsed
}

function isStrictRecallCounts(value: unknown): value is { matched: number; total: number } {
  return isRecord(value) && hasExactKeys(value, ['matched', 'total']) &&
    Number.isSafeInteger(value.matched) && (value.matched as number) >= 0 &&
    Number.isSafeInteger(value.total) && (value.total as number) >= 0 &&
    (value.matched as number) <= (value.total as number)
}

function isStrictRecallComparison(value: unknown): value is {
  baseline: { matched: number; total: number }
  candidate: { matched: number; total: number }
} {
  return isRecord(value) && hasExactKeys(value, ['baseline', 'candidate']) &&
    isStrictRecallCounts(value.baseline) && isStrictRecallCounts(value.candidate)
}

function isStrictBlindReview(value: unknown): value is BlindReviewInput {
  return isRecord(value) && hasExactKeys(value, [
    'sampleCount',
    'reviewedSampleCount',
    'randomizedAB',
    'secondaryReviewSampleCount',
    'reviewerRelationship',
    'sameTeacherReviewIntervalDays',
    'unresolvedArbitrations',
    'systematicDegradation',
  ]) &&
    Number.isSafeInteger(value.sampleCount) && (value.sampleCount as number) >= 0 &&
    Number.isSafeInteger(value.reviewedSampleCount) && (value.reviewedSampleCount as number) >= 0 &&
    typeof value.randomizedAB === 'boolean' &&
    Number.isSafeInteger(value.secondaryReviewSampleCount) &&
    (value.secondaryReviewSampleCount as number) >= 0 &&
    (value.reviewerRelationship === 'independent_teacher' ||
      value.reviewerRelationship === 'same_teacher_delayed') &&
    (value.sameTeacherReviewIntervalDays === null || (
      Number.isSafeInteger(value.sameTeacherReviewIntervalDays) &&
      (value.sameTeacherReviewIntervalDays as number) >= 0
    )) &&
    Number.isSafeInteger(value.unresolvedArbitrations) &&
    (value.unresolvedArbitrations as number) >= 0 &&
    typeof value.systematicDegradation === 'boolean'
}

function validateHumanReviewEvidence(value: unknown): value is HumanReviewEvidence {
  if (!isRecord(value) || !hasExactKeys(value, [
    'evidenceVersion',
    'protocolRevision',
    'datasetSha256',
    'taskSha256',
    'baselineProvenance',
    'candidateProvenance',
    'candidateRunSha256',
    'importantIssueRecall',
    'importantLegibilityRecall',
    'hardRisks',
    'blindReview',
  ])) return false
  return value.evidenceVersion === 'grading-benchmark-human-evidence-v1' &&
    value.protocolRevision === 'grading-benchmark-human-review-protocol-v1' &&
    typeof value.datasetSha256 === 'string' && /^[a-f0-9]{64}$/u.test(value.datasetSha256) &&
    typeof value.taskSha256 === 'string' && /^[a-f0-9]{64}$/u.test(value.taskSha256) &&
    isStrictBenchmarkProvenance(value.baselineProvenance, 'baseline') &&
    isStrictBenchmarkProvenance(value.candidateProvenance, 'candidate') &&
    typeof value.candidateRunSha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(value.candidateRunSha256) &&
    isStrictRecallComparison(value.importantIssueRecall) &&
    isStrictRecallComparison(value.importantLegibilityRecall) &&
    isRecord(value.hardRisks) && hasExactKeys(value.hardRisks, [
      'studentMix',
      'wrongTaskContext',
      'highRiskLegibilityMiss',
      'piiLeakage',
    ]) && Object.values(value.hardRisks).every((count) => (
      Number.isSafeInteger(count) && (count as number) >= 0
    )) &&
    isStrictBlindReview(value.blindReview)
}

export async function readHumanReviewEvidence(
  paths: BenchmarkPrivatePaths,
): Promise<HumanReviewEvidence | null> {
  let bytes: Buffer
  try {
    bytes = await readVerifiedPrivateFile(
      path.resolve(paths.resultRoot, 'human-evidence.json'),
      paths.resultRoot,
      1024 * 1024,
    )
  } catch (error) {
    if (error instanceof PrivateBenchmarkBundleError && error.code === 'private_file_unavailable') {
      return null
    }
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new Error('invalid_human_review_evidence')
  }
  if (!validateHumanReviewEvidence(parsed)) {
    throw new Error('invalid_human_review_evidence')
  }
  return parsed
}

export async function writeHumanReviewEvidence(
  paths: BenchmarkPrivatePaths,
  evidence: HumanReviewEvidence,
): Promise<void> {
  if (!validateHumanReviewEvidence(evidence)) {
    throw new Error('invalid_human_review_evidence')
  }
  await writeAtomicResultJson(paths, 'human-evidence.json', evidence)
}

async function writeAtomicResultJson(
  paths: BenchmarkPrivatePaths,
  filename: string,
  value: unknown,
): Promise<void> {
  if (!path.isAbsolute(paths.resultRoot) || !/^[a-z0-9][a-z0-9.-]{0,127}$/u.test(filename)) {
    throw new Error('invalid_safe_benchmark_report')
  }
  await mkdir(paths.resultRoot, { recursive: true })
  const realRoot = path.resolve(await resolveRealPath(paths.resultRoot))
  const destination = path.resolve(realRoot, filename)
  if (!isWithinRoot(realRoot, destination)) throw new Error('invalid_safe_benchmark_report')
  const temporary = path.resolve(realRoot, `.${filename}.${randomUUID()}.tmp`)
  const handle = await openFile(temporary, 'wx')
  let renamed = false
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    await rename(temporary, destination)
    renamed = true
  } finally {
    if (!renamed) {
      try { await handle.close() } catch { /* The safe primary error wins. */ }
    }
  }
}

export async function writeQualityBaselineState(
  paths: BenchmarkPrivatePaths,
  state: QualityBaselineState,
): Promise<void> {
  if (!validateQualityBaselineState(state)) {
    throw new Error('invalid_quality_baseline_state')
  }
  await writeAtomicResultJson(paths, 'quality-baseline-state.json', state)
}

export async function readQualityBaselineState(
  paths: BenchmarkPrivatePaths,
): Promise<QualityBaselineState | null> {
  let bytes: Buffer
  try {
    bytes = await readVerifiedPrivateFile(
      path.resolve(paths.resultRoot, 'quality-baseline-state.json'),
      paths.resultRoot,
      16 * 1024 * 1024,
    )
  } catch (error) {
    if (
      error instanceof PrivateBenchmarkBundleError &&
      error.code === 'private_file_unavailable'
    ) return null
    throw error
  }
  const parsed = parsePrivateJson(bytes)
  if (!validateQualityBaselineState(parsed)) {
    throw new Error('invalid_quality_baseline_state')
  }
  return parsed
}

export interface DefaultBenchmarkCommandDependencies {
  loadBundle?: typeof loadPrivateBenchmarkBundle
  createProvider?: (
    context: BenchmarkCliCommandContext,
    run: BenchmarkExecutionRun,
  ) => MultimodalProvider
  writeReport?: typeof writeSafeBenchmarkReport
  createProvenance?: (
    context: BenchmarkCliCommandContext,
    bundle: LoadedPrivateBenchmarkBundle,
    run: BenchmarkExecutionRun,
  ) => BenchmarkProvenance
  runBenchmark?: typeof runGradingBenchmark
  assessResult?: BenchmarkRunnerDependencies['assessResult']
  readBaselineState?: typeof readQualityBaselineState
  writeBaselineState?: typeof writeQualityBaselineState
  readCandidateState?: typeof readQualityCandidateState
  writeCandidateState?: typeof writeQualityCandidateState
  readHumanEvidence?: typeof readHumanReviewEvidence
  writeHumanEvidence?: typeof writeHumanReviewEvidence
  humanReviewAdapter?: ExternalHumanReviewAdapter
  runThroughput?: typeof runGatewayThroughputBenchmark
  resolveGitCommit?: (gatewayRoot: string) => string
}

function taskSha256(task: ConfirmedTaskPackageV2): string {
  return createHash('sha256').update(JSON.stringify(task), 'utf8').digest('hex')
}

function commonProvenanceMatches(
  baseline: BenchmarkProvenance,
  candidate: BenchmarkProvenance,
): boolean {
  return baseline.benchmarkVersion === candidate.benchmarkVersion &&
    baseline.gitCommit === candidate.gitCommit &&
    baseline.model === candidate.model &&
    baseline.reasoningEffort === candidate.reasoningEffort &&
    baseline.policyVersion === candidate.policyVersion &&
    JSON.stringify(baseline.phaseBudgets) === JSON.stringify(candidate.phaseBudgets) &&
    baseline.manifestSha256 === candidate.manifestSha256 &&
    baseline.datasetSha256 === candidate.datasetSha256 &&
    baseline.featureProfiles.image === candidate.featureProfiles.image
}

function isBoundHumanReviewAdapter(
  adapter: ExternalHumanReviewAdapter | undefined,
  bundle: LoadedPrivateBenchmarkBundle,
  provenance: BenchmarkProvenance,
): adapter is ExternalHumanReviewAdapter {
  if (!adapter || typeof adapter.assessAndPresentResult !== 'function' ||
    typeof adapter.createHumanEvidence !== 'function' ||
    typeof adapter.runIdentitySha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(adapter.runIdentitySha256) ||
    !isRecord(adapter.plan) || !hasExactKeys(adapter.plan, [
      'planVersion',
      'protocolRevision',
      'datasetSha256',
      'taskSha256',
      'gitCommit',
      'benchmarkVersion',
      'policyVersion',
      'randomizedAB',
      'secondaryReviewerStrategy',
      'sameTeacherReviewIntervalDays',
    ])) return false
  const plan = adapter.plan
  const validReviewerSeparation = plan.secondaryReviewerStrategy === 'independent_teacher'
    ? plan.sameTeacherReviewIntervalDays === null
    : plan.secondaryReviewerStrategy === 'same_teacher_delayed' &&
      Number.isSafeInteger(plan.sameTeacherReviewIntervalDays) &&
      (plan.sameTeacherReviewIntervalDays as number) >= 7
  return plan.planVersion === 'grading-benchmark-human-review-plan-v1' &&
    plan.protocolRevision === 'grading-benchmark-human-review-protocol-v1' &&
    plan.datasetSha256 === bundle.datasetSha256 &&
    plan.taskSha256 === taskSha256(bundle.task) &&
    plan.gitCommit === provenance.gitCommit &&
    plan.benchmarkVersion === provenance.benchmarkVersion &&
    plan.policyVersion === provenance.policyVersion &&
    plan.randomizedAB === true && validReviewerSeparation
}

function humanEvidenceMatchesRun(
  evidence: HumanReviewEvidence,
  baselineState: QualityBaselineState,
  candidateState: QualityCandidateState,
  bundle: LoadedPrivateBenchmarkBundle,
  candidateProvenance: BenchmarkProvenance,
): boolean {
  const importantIssueTotal = bundle.manifest.samples.reduce(
    (total, sample) => total + sample.importantIssueLabels.length,
    0,
  )
  const importantLegibilityTotal = bundle.manifest.samples.reduce(
    (total, sample) => total + sample.importantLegibilityLabels.length,
    0,
  )
  return evidence.datasetSha256 === bundle.datasetSha256 &&
    evidence.taskSha256 === taskSha256(bundle.task) &&
    sameBenchmarkProvenance(evidence.baselineProvenance, baselineState.provenance) &&
    sameBenchmarkProvenance(evidence.candidateProvenance, candidateProvenance) &&
    evidence.candidateRunSha256 === candidateState.candidateRunSha256 &&
    evidence.importantIssueRecall.baseline.total === importantIssueTotal &&
    evidence.importantIssueRecall.candidate.total === importantIssueTotal &&
    evidence.importantLegibilityRecall.baseline.total === importantLegibilityTotal &&
    evidence.importantLegibilityRecall.candidate.total === importantLegibilityTotal &&
    evidence.hardRisks.studentMix <= 40 &&
    evidence.hardRisks.wrongTaskContext <= 40 &&
    evidence.hardRisks.piiLeakage <= 40 &&
    evidence.hardRisks.highRiskLegibilityMiss <= importantLegibilityTotal
}

export interface SoakAuditInput {
  requested: number
  accepted: number
  assessmentCoverage: number | null
  assessmentFailures: number | null
  evidenceLocation: { uniquelyLocated: number; total: number } | null
  hardRisks: {
    studentMix: number
    wrongTaskContext: number
    highRiskLegibilityMiss: number
    piiLeakage: number
  } | null
}

export function evaluateSoakConclusion(input: SoakAuditInput) {
  const all = evaluateQualityGates({
    soak: {
      totalCalls: input.requested,
      contractFailures: input.requested - input.accepted,
    },
    ...(input.evidenceLocation ? { evidence: input.evidenceLocation } : {}),
    ...(input.hardRisks ? { hardRisks: input.hardRisks } : {}),
  })
  const assessmentCoverage: QualityGateResult =
    !Number.isSafeInteger(input.requested) || input.requested < 1 ||
    !Number.isSafeInteger(input.accepted) || input.accepted < 0 ||
    input.accepted > input.requested ||
    !Number.isSafeInteger(input.assessmentCoverage) ||
    (input.assessmentCoverage as number) < 0 ||
    (input.assessmentCoverage as number) > input.accepted ||
    !Number.isSafeInteger(input.assessmentFailures) ||
    (input.assessmentFailures as number) < 0 ||
    (input.assessmentFailures as number) > input.accepted
      ? {
          status: 'not_measurable',
          actual: null,
          threshold: input.accepted,
          reason: 'missing_or_invalid_soak_assessment',
        }
      : input.assessmentCoverage === input.accepted && input.assessmentFailures === 0
        ? { status: 'pass', actual: input.assessmentCoverage, threshold: input.accepted }
        : {
            status: 'fail',
            actual: Math.max(
              0,
              (input.assessmentCoverage as number) - (input.assessmentFailures as number),
            ),
            threshold: input.accepted,
          }
  const gates = {
    soak: all.gates.soak,
    evidenceLocation: all.gates.evidenceLocation,
    assessmentCoverage,
    hardRisks: all.gates.hardRisks,
  }
  const statuses = Object.values(gates).map(({ status }) => status)
  return {
    status: statuses.includes('fail')
      ? 'fail' as const
      : statuses.includes('not_measurable')
        ? 'inconclusive' as const
        : 'pass' as const,
    gates,
  }
}

function evaluateSoakAggregate(quality: BenchmarkAggregateReport) {
  const evidenceLocation = quality.evidenceLocation.status === 'measured'
    ? {
        uniquelyLocated: quality.evidenceLocation.uniquelyLocated,
        total: quality.evidenceLocation.total,
      }
    : null
  const hardRiskEntries = Object.entries(quality.hardRisks)
  const hardRisks = hardRiskEntries.every(([, metric]) =>
    metric.status === 'measured' && Number.isSafeInteger(metric.value) && metric.value >= 0)
    ? Object.fromEntries(hardRiskEntries.map(([name, metric]) => [
        name,
        metric.status === 'measured' ? metric.value : 0,
      ])) as SoakAuditInput['hardRisks']
    : null
  return evaluateSoakConclusion({
    requested: quality.sampleCounts.requested,
    accepted: quality.sampleCounts.accepted,
    assessmentCoverage: quality.sampleCounts.assessmentCoverage,
    assessmentFailures: quality.sampleCounts.assessmentFailures,
    evidenceLocation,
    hardRisks,
  })
}

export interface ThroughputRunEvidence {
  requested: number
  completed: number
  uniqueEssays: number
  attachmentRequests: number
  httpCompletedAttachments: number
  providerInvocations: number
  providerCompletions: number
  uniqueAttempts: number
  usageKnownAttempts: number
  wallMs: number | null
  firstSuccessMs: number | null
  hardLimit: number
  clientConcurrency: number
  maxActiveLeases: number
  maxActiveProviderCalls: number
  unsettledProviderCalls: number
  settlementTimedOut: boolean
}

export interface ThroughputRoundIsolationEvidence {
  baselineSettledBeforeCandidate: boolean
  candidateStarted: boolean
  roundsOverlapped: boolean
}

export interface ThroughputConclusion {
  status: 'pass' | 'fail' | 'inconclusive'
  gate: QualityGateResult
  baseline: ThroughputRunEvidence
  candidate: ThroughputRunEvidence
  roundIsolation: ThroughputRoundIsolationEvidence
}

export interface ThroughputReportPayload extends ThroughputConclusion {
  provenance: {
    baseline: BenchmarkProvenance
    candidate: BenchmarkProvenance
  }
}

function completeThroughputEvidence(value: ThroughputRunEvidence): boolean {
  return value.requested === 30 &&
    value.completed === 30 &&
    value.uniqueEssays === 30 &&
    value.providerInvocations === 30 &&
    value.providerCompletions === 30 &&
    value.uniqueAttempts === 30 &&
    value.usageKnownAttempts === 30 &&
    value.unsettledProviderCalls === 0 &&
    value.settlementTimedOut === false &&
    typeof value.wallMs === 'number' &&
    Number.isFinite(value.wallMs) &&
    value.wallMs > 0 &&
    typeof value.firstSuccessMs === 'number' &&
    Number.isFinite(value.firstSuccessMs) &&
    value.firstSuccessMs >= 0
}

export function evaluateThroughputConclusion(input: {
  baseline: ThroughputRunEvidence
  candidate: ThroughputRunEvidence
  roundIsolation: ThroughputRoundIsolationEvidence
}): ThroughputConclusion {
  const complete = completeThroughputEvidence(input.baseline) &&
    completeThroughputEvidence(input.candidate) &&
    input.baseline.hardLimit === 1 &&
    input.baseline.clientConcurrency === 1 &&
    input.baseline.attachmentRequests === 30 &&
    input.baseline.httpCompletedAttachments === 30 &&
    input.baseline.maxActiveLeases === 0 &&
    input.baseline.maxActiveProviderCalls === 1 &&
    input.candidate.hardLimit >= 4 &&
    input.candidate.clientConcurrency > input.candidate.hardLimit &&
    input.candidate.attachmentRequests > input.candidate.uniqueEssays &&
    input.candidate.httpCompletedAttachments > input.candidate.uniqueEssays
  const candidateHardLimitExceeded = Number.isSafeInteger(input.candidate.hardLimit) &&
    input.candidate.hardLimit > 0 &&
    Number.isSafeInteger(input.candidate.maxActiveLeases) &&
    Number.isSafeInteger(input.candidate.maxActiveProviderCalls) && (
      input.candidate.maxActiveLeases > input.candidate.hardLimit ||
      input.candidate.maxActiveProviderCalls > input.candidate.hardLimit
    )
  const baselineHardLimitExceeded = Number.isSafeInteger(input.baseline.hardLimit) &&
    input.baseline.hardLimit > 0 &&
    Number.isSafeInteger(input.baseline.maxActiveProviderCalls) &&
    input.baseline.maxActiveProviderCalls > input.baseline.hardLimit
  const hardLimitExceeded = candidateHardLimitExceeded || baselineHardLimitExceeded
  const firstSuccessSlower = complete &&
    (input.candidate.firstSuccessMs as number) > (input.baseline.firstSuccessMs as number)
  if (hardLimitExceeded) {
    return {
      status: 'fail',
      gate: {
        status: 'fail',
        actual: Math.max(
          candidateHardLimitExceeded ? input.candidate.maxActiveLeases : 0,
          candidateHardLimitExceeded ? input.candidate.maxActiveProviderCalls : 0,
          baselineHardLimitExceeded ? input.baseline.maxActiveProviderCalls : 0,
        ),
        threshold: candidateHardLimitExceeded
          ? input.candidate.hardLimit
          : input.baseline.hardLimit,
        reason: 'throughput_hard_limit_exceeded',
      },
      baseline: input.baseline,
      candidate: input.candidate,
      roundIsolation: input.roundIsolation,
    }
  }
  const roundsIsolated = input.roundIsolation.baselineSettledBeforeCandidate &&
    input.roundIsolation.candidateStarted &&
    !input.roundIsolation.roundsOverlapped &&
    !input.baseline.settlementTimedOut && input.baseline.unsettledProviderCalls === 0 &&
    !input.candidate.settlementTimedOut && input.candidate.unsettledProviderCalls === 0
  if (!roundsIsolated) {
    return {
      status: 'inconclusive',
      gate: {
        status: 'not_measurable',
        actual: null,
        threshold: 0,
        reason: 'throughput_rounds_not_isolated_or_unsettled',
      },
      baseline: input.baseline,
      candidate: input.candidate,
      roundIsolation: input.roundIsolation,
    }
  }
  if (firstSuccessSlower) {
    return {
      status: 'fail',
      gate: {
        status: 'fail',
        actual: input.candidate.firstSuccessMs,
        threshold: input.baseline.firstSuccessMs,
        reason: 'candidate_first_success_slower',
      },
      baseline: input.baseline,
      candidate: input.candidate,
      roundIsolation: input.roundIsolation,
    }
  }
  const effective = complete &&
    input.candidate.maxActiveLeases >= 4 &&
    input.candidate.maxActiveProviderCalls >= 4
  const all = evaluateQualityGates(effective
    ? {
        throughput: {
          essayCount: 30,
          baselineElapsedMs: input.baseline.wallMs as number,
          candidateElapsedMs: input.candidate.wallMs as number,
          effectiveConcurrency: Math.min(
            input.candidate.maxActiveLeases,
            input.candidate.maxActiveProviderCalls,
          ),
        },
      }
    : {})
  const gate = all.gates.throughput
  return {
    status: gate.status === 'pass'
      ? 'pass'
      : gate.status === 'fail'
        ? 'fail'
        : 'inconclusive',
    gate,
    baseline: input.baseline,
    candidate: input.candidate,
    roundIsolation: input.roundIsolation,
  }
}

type BenchmarkProviderFactory = (
  context: BenchmarkCliCommandContext,
  run: BenchmarkExecutionRun,
) => MultimodalProvider

interface ThroughputHarnessOptions {
  admissionRetryDelayMs?: number
  maximumAdmissionRetries?: number
  settlementWaitMs?: number
}

interface ThroughputRoundActivity {
  baselineActiveProviderCalls: number
  candidateActiveProviderCalls: number
  roundsOverlapped: boolean
}

interface ProviderSettlement {
  promise: Promise<void>
  settled: boolean
}

function waitMilliseconds(milliseconds: number): Promise<void> {
  return new Promise((done) => setTimeout(done, milliseconds))
}

async function waitForProviderSettlements(
  settlements: readonly ProviderSettlement[],
  timeoutMs: number,
): Promise<boolean> {
  if (settlements.every((settlement) => settlement.settled)) return true
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.all(settlements.map((settlement) => settlement.promise)).then(() => true),
      new Promise<false>((done) => {
        timeout = setTimeout(() => done(false), timeoutMs)
      }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

async function closeHttpServer(server: ReturnType<ReturnType<typeof createGatewayServer>['listen']>): Promise<void> {
  await new Promise<void>((done, reject) => {
    server.close((error) => error ? reject(error) : done())
  })
}

async function runThroughputVariant(
  context: BenchmarkCliCommandContext,
  bundle: LoadedPrivateBenchmarkBundle,
  run: BenchmarkExecutionRun,
  createProvider: BenchmarkProviderFactory,
  options: ThroughputHarnessOptions,
  roundActivity: ThroughputRoundActivity,
): Promise<ThroughputRunEvidence> {
  if (run.calls !== 30) throw new Error('invalid_benchmark_profile')
  const runtimeConfig = createBenchmarkRuntimeConfig(context.runtimeEnv, run)
  const retryDelayMs = options.admissionRetryDelayMs ?? 250
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 1 || retryDelayMs > 10_000) {
    throw new Error('invalid_throughput_harness')
  }
  const maximumAdmissionRetries = options.maximumAdmissionRetries ?? Math.max(
    1,
    Math.ceil(runtimeConfig.deadlines.httpMs / retryDelayMs),
  )
  if (!Number.isSafeInteger(maximumAdmissionRetries) || maximumAdmissionRetries < 1) {
    throw new Error('invalid_throughput_harness')
  }
  const defaultSettlementWaitMs = Math.min(
    600_000,
    runtimeConfig.deadlines.providerFinalMs + runtimeConfig.deadlines.settlementGraceMs -
      runtimeConfig.deadlines.httpMs,
  )
  const settlementWaitMs = options.settlementWaitMs ?? defaultSettlementWaitMs
  if (!Number.isSafeInteger(settlementWaitMs) || settlementWaitMs < 1 || settlementWaitMs > 600_000) {
    throw new Error('invalid_throughput_harness')
  }

  const budgeted = createInvocationBudgetedProvider(
    createProvider(context, run),
    30,
  )
  const telemetry: ProviderTelemetryRecorder = createProviderTelemetryRecorder()
  const executionServices: GatewayExecutionServices | undefined =
    run.executionRegistry === 'memory-v1'
      ? createGatewayExecutionServices(runtimeConfig)
      : undefined
  let activeProviderCalls = 0
  let maxActiveProviderCalls = 0
  let providerCompletions = 0
  let maxActiveLeases = 0
  let settlementTimedOut = false
  let stopScheduling = false
  const pendingSettlements = new Set<ProviderSettlement>()
  const settlementByOrdinal = new Map<number, ProviderSettlement>()
  const invokedOrdinals = new Set<number>()
  const essayOrdinalById = new Map<string, number>()
  const trackedProvider: MultimodalProvider = {
    generateMaterialContext: (input) => budgeted.provider.generateMaterialContext(input),
    generateRubric: (input) => budgeted.provider.generateRubric(input),
    async gradeEssay(input) {
      const ordinal = essayOrdinalById.get(input.essayId)
      if (ordinal !== undefined) invokedOrdinals.add(ordinal)
      let settleProvider!: () => void
      const settlement: ProviderSettlement = {
        promise: new Promise<void>((done) => { settleProvider = done }),
        settled: false,
      }
      pendingSettlements.add(settlement)
      if (ordinal !== undefined) settlementByOrdinal.set(ordinal, settlement)
      activeProviderCalls += 1
      if (run.variant === 'baseline') {
        roundActivity.baselineActiveProviderCalls += 1
      } else {
        if (roundActivity.baselineActiveProviderCalls > 0) {
          roundActivity.roundsOverlapped = true
        }
        roundActivity.candidateActiveProviderCalls += 1
      }
      maxActiveProviderCalls = Math.max(maxActiveProviderCalls, activeProviderCalls)
      if (executionServices) {
        maxActiveLeases = Math.max(
          maxActiveLeases,
          executionServices.admission.snapshot().activeLeases,
        )
      }
      try {
        const result = await budgeted.provider.gradeEssay(input)
        providerCompletions += 1
        return result
      } finally {
        activeProviderCalls -= 1
        if (run.variant === 'baseline') {
          roundActivity.baselineActiveProviderCalls -= 1
        } else {
          roundActivity.candidateActiveProviderCalls -= 1
        }
        settlement.settled = true
        pendingSettlements.delete(settlement)
        settleProvider()
      }
    },
  }
  const app = createGatewayServer({
    multimodalProvider: trackedProvider,
    runtimeConfig,
    providerTelemetry: telemetry,
    ...(executionServices ? { executionServices } : {}),
  })
  const server = await new Promise<ReturnType<typeof app.listen>>((done, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => done(listening))
    listening.once('error', reject)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeHttpServer(server)
    throw new Error('throughput_gateway_unavailable')
  }
  const endpoint = `http://127.0.0.1:${address.port}/grading/grade-images`
  const samples = bundle.samples.slice(0, 30)
  if (samples.length !== 30) {
    await closeHttpServer(server)
    throw new Error('invalid_benchmark_profile')
  }

  const startedAt = performance.now()
  let firstSuccessMs: number | null = null
  let attachmentRequests = 0
  let httpCompletedAttachments = 0
  const completedOrdinals = new Set<number>()
  const jobs = run.executionRegistry === 'memory-v1'
    ? [
        { ordinal: 0, attachmentIndex: 0 },
        { ordinal: 0, attachmentIndex: 1 },
        ...Array.from({ length: 29 }, (_, index) => ({
          ordinal: index + 1,
          attachmentIndex: index + 2,
        })),
      ]
    : Array.from({ length: 30 }, (_, ordinal) => ({ ordinal, attachmentIndex: ordinal }))
  let nextJobIndex = 0
  const submit = async (ordinal: number, attachmentIndex: number): Promise<void> => {
    const sample = samples[ordinal]
    if (!sample) return
    const essayId = `benchmark-throughput-${run.variant}-${String(ordinal + 1).padStart(2, '0')}`
    essayOrdinalById.set(essayId, ordinal)
    try {
      for (let attempt = 0; attempt <= maximumAdmissionRetries; attempt += 1) {
        const pageIds = sample.pages.map((_, pageIndex) => (
          `benchmark-throughput-page-${pageIndex + 1}`
        ))
        const metadata = {
          requestVersion: 'multimodal-grading-request-v2',
          requestId: `benchmark-throughput-${run.variant}-${attachmentIndex + 1}-${attempt + 1}`,
          essayId,
          pageIds,
          task: bundle.task,
        }
        const body = new FormData()
        body.append('metadata', JSON.stringify(metadata))
        sample.pages.forEach((page, pageIndex) => {
          body.append(
            'pages',
            new Blob([Uint8Array.from(page.buffer)], { type: page.mimeType }),
            `page-${pageIndex + 1}.${page.mimeType === 'image/png' ? 'png' : page.mimeType === 'image/jpeg' ? 'jpg' : 'webp'}`,
          )
        })
        let response: globalThis.Response
        try {
          attachmentRequests += 1
          response = await fetch(endpoint, { method: 'POST', body })
          await response.arrayBuffer()
        } catch {
          return
        }
        if (response.status === 200) {
          httpCompletedAttachments += 1
          completedOrdinals.add(ordinal)
          const elapsed = performance.now() - startedAt
          firstSuccessMs = firstSuccessMs === null ? elapsed : Math.min(firstSuccessMs, elapsed)
          return
        }
        if (response.status !== 429 || invokedOrdinals.has(ordinal)) return
        if (attempt === maximumAdmissionRetries) return
        await waitMilliseconds(retryDelayMs)
      }
    } finally {
      if (run.variant === 'baseline') {
        const settlement = settlementByOrdinal.get(ordinal)
        if (settlement && !await waitForProviderSettlements([settlement], settlementWaitMs)) {
          settlementTimedOut = true
          stopScheduling = true
        }
      }
    }
  }
  const workerCount = run.hardLimit === 1
    ? 1
    : Math.min(runtimeConfig.admission.hardLimit * 2, jobs.length)
  try {
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (true) {
        if (stopScheduling) return
        const job = jobs[nextJobIndex]
        nextJobIndex += 1
        if (!job) return
        await submit(job.ordinal, job.attachmentIndex)
      }
    }))
    if (!settlementTimedOut && !await waitForProviderSettlements(
      [...pendingSettlements],
      settlementWaitMs,
    )) {
      settlementTimedOut = true
    }
  } finally {
    await closeHttpServer(server)
  }
  const wallMs = performance.now() - startedAt
  const budget = budgeted.snapshot()
  const provider = telemetry.snapshot()
  return {
    requested: 30,
    completed: completedOrdinals.size,
    uniqueEssays: 30,
    attachmentRequests,
    httpCompletedAttachments,
    providerInvocations: budget.invoked,
    providerCompletions,
    uniqueAttempts: provider.uniqueAttempts,
    usageKnownAttempts: provider.usageCoverage.knownAttempts,
    wallMs: Number.isFinite(wallMs) && wallMs > 0 ? wallMs : null,
    firstSuccessMs,
    hardLimit: run.hardLimit === 1 ? 1 : runtimeConfig.admission.hardLimit,
    clientConcurrency: workerCount,
    maxActiveLeases,
    maxActiveProviderCalls,
    unsettledProviderCalls: pendingSettlements.size,
    settlementTimedOut,
  }
}

export async function runGatewayThroughputBenchmark(
  context: BenchmarkCliCommandContext,
  bundle: LoadedPrivateBenchmarkBundle,
  createProvider: BenchmarkProviderFactory,
  options: ThroughputHarnessOptions = {},
): Promise<ThroughputConclusion> {
  if (context.request.mode !== 'throughput') throw new Error('invalid_benchmark_profile')
  const [baselineRun, candidateRun] = context.profile.runs
  if (
    !baselineRun ||
    baselineRun.variant !== 'baseline' ||
    baselineRun.executionRegistry !== 'direct-legacy' ||
    baselineRun.hardLimit !== 1 ||
    !candidateRun ||
    candidateRun.variant !== 'candidate' ||
    candidateRun.executionRegistry !== 'memory-v1' ||
    candidateRun.hardLimit !== 'runtime-bounded'
  ) throw new Error('invalid_benchmark_profile')
  const roundActivity: ThroughputRoundActivity = {
    baselineActiveProviderCalls: 0,
    candidateActiveProviderCalls: 0,
    roundsOverlapped: false,
  }
  const baseline = await runThroughputVariant(
    context,
    bundle,
    baselineRun,
    createProvider,
    options,
    roundActivity,
  )
  const baselineReadyForCandidate = completeThroughputEvidence(baseline) &&
    baseline.hardLimit === 1 && baseline.clientConcurrency === 1 &&
    baseline.attachmentRequests === 30 && baseline.httpCompletedAttachments === 30 &&
    baseline.maxActiveLeases === 0 && baseline.maxActiveProviderCalls <= baseline.hardLimit &&
    roundActivity.baselineActiveProviderCalls === 0
  if (!baselineReadyForCandidate) {
    const candidateHardLimit = createBenchmarkRuntimeConfig(
      context.runtimeEnv,
      candidateRun,
    ).admission.hardLimit
    const candidate: ThroughputRunEvidence = {
      requested: 30,
      completed: 0,
      uniqueEssays: 30,
      attachmentRequests: 0,
      httpCompletedAttachments: 0,
      providerInvocations: 0,
      providerCompletions: 0,
      uniqueAttempts: 0,
      usageKnownAttempts: 0,
      wallMs: null,
      firstSuccessMs: null,
      hardLimit: candidateHardLimit,
      clientConcurrency: 0,
      maxActiveLeases: 0,
      maxActiveProviderCalls: 0,
      unsettledProviderCalls: 0,
      settlementTimedOut: false,
    }
    return evaluateThroughputConclusion({
      baseline,
      candidate,
      roundIsolation: {
        baselineSettledBeforeCandidate: false,
        candidateStarted: false,
        roundsOverlapped: roundActivity.roundsOverlapped,
      },
    })
  }
  const candidate = await runThroughputVariant(
    context,
    bundle,
    candidateRun,
    createProvider,
    options,
    roundActivity,
  )
  return evaluateThroughputConclusion({
    baseline,
    candidate,
    roundIsolation: {
      baselineSettledBeforeCandidate: true,
      candidateStarted: true,
      roundsOverlapped: roundActivity.roundsOverlapped,
    },
  })
}

export function createDefaultBenchmarkCommand(
  context: BenchmarkCliCommandContext,
  dependencies: DefaultBenchmarkCommandDependencies = {},
): BenchmarkCliCommand {
  const loadBundle = dependencies.loadBundle ?? loadPrivateBenchmarkBundle
  const createProvider = dependencies.createProvider ?? createConfiguredBenchmarkProvider
  const createProvenance = dependencies.createProvenance ?? ((commandContext, bundle, run) => (
    createDefaultBenchmarkProvenance(
      commandContext,
      bundle,
      run,
      dependencies.resolveGitCommit ?? resolveBenchmarkGitCommit,
    )
  ))
  const writeReport = dependencies.writeReport ?? writeSafeBenchmarkReport
  const runBenchmark = dependencies.runBenchmark ?? runGradingBenchmark
  const readBaselineState = dependencies.readBaselineState ?? readQualityBaselineState
  const writeBaselineState = dependencies.writeBaselineState ?? writeQualityBaselineState
  const readCandidateState = dependencies.readCandidateState ?? readQualityCandidateState
  const writeCandidateState = dependencies.writeCandidateState ?? writeQualityCandidateState
  const readHumanEvidence = dependencies.readHumanEvidence ?? readHumanReviewEvidence
  const writeHumanEvidence = dependencies.writeHumanEvidence ?? writeHumanReviewEvidence
  const runThroughput = dependencies.runThroughput ?? runGatewayThroughputBenchmark
  return {
    async execute() {
      if (context.request.mode === 'image-variants') {
        const report: SafeBenchmarkCommandReport = {
          reportVersion: 'grading-benchmark-command-report-v1',
          request: 'image-variants',
          conclusion: 'inconclusive',
          reason: 'explicit_image_transformer_required',
          invocationBudget: { budget: 0, invoked: 0, remaining: 0 },
          quality: null,
          qualityGates: null,
          soak: null,
          throughput: null,
        }
        await writeReport(context.paths, 'image-variants.json', report)
        return { status: 'inconclusive' }
      }
      if (context.request.mode === 'soak' && !dependencies.assessResult) {
        await writeReport(context.paths, 'soak.json', {
          reportVersion: 'grading-benchmark-command-report-v1',
          request: 'soak',
          conclusion: 'inconclusive',
          reason: 'external_soak_audit_adapter_required',
          invocationBudget: { budget: 100, invoked: 0, remaining: 100 },
          quality: null,
          qualityGates: null,
          soak: null,
          throughput: null,
        })
        return { status: 'inconclusive' }
      }
      if (context.request.mode === 'quality') {
        let baselineState: QualityBaselineState | null = null
        let candidateState: QualityCandidateState | null = null
        let humanEvidence: HumanReviewEvidence | null = null
        if (context.request.variant === 'candidate') {
          baselineState = await readBaselineState(context.paths)
          if (!baselineState) {
            await writeReport(context.paths, 'quality-candidate.json', {
              reportVersion: 'grading-benchmark-command-report-v1',
              request: 'quality-candidate',
              conclusion: 'inconclusive',
              reason: 'baseline_state_required',
              invocationBudget: { budget: 40, invoked: 0, remaining: 40 },
              quality: null,
              qualityGates: null,
              soak: null,
              throughput: null,
            })
            return { status: 'inconclusive' }
          }
          humanEvidence = await readHumanEvidence(context.paths)
          if (humanEvidence === null && !dependencies.humanReviewAdapter) {
            await writeReport(context.paths, 'quality-candidate.json', {
              reportVersion: 'grading-benchmark-command-report-v1',
              request: 'quality-candidate',
              conclusion: 'inconclusive',
              reason: 'external_human_review_evidence_required',
              invocationBudget: { budget: 40, invoked: 0, remaining: 40 },
              quality: null,
              qualityGates: null,
              soak: null,
              throughput: null,
            })
            return { status: 'inconclusive' }
          }
          candidateState = await readCandidateState(context.paths)
          const hasPersistedPair = candidateState !== null && humanEvidence !== null
          const canGeneratePair = candidateState === null && humanEvidence === null &&
            dependencies.humanReviewAdapter !== undefined
          if (!hasPersistedPair && !canGeneratePair) {
            await writeReport(context.paths, 'quality-candidate.json', {
              reportVersion: 'grading-benchmark-command-report-v1',
              request: 'quality-candidate',
              conclusion: 'inconclusive',
              reason: humanEvidence === null
                ? 'external_human_review_evidence_required'
                : 'external_candidate_state_or_bound_evidence_required',
              invocationBudget: { budget: 40, invoked: 0, remaining: 40 },
              quality: null,
              qualityGates: null,
              soak: null,
              throughput: null,
            })
            return { status: 'inconclusive' }
          }
        }
        const bundle = await loadBundle(context.paths)
        const run = context.profile.runs[0]
        if (!run || run.calls !== 40) throw new Error('invalid_benchmark_profile')
        const sampleMetrics: BenchmarkSampleMetricObservation[] = []
        const provenance = createProvenance(context, bundle, run)
        if (
          baselineState &&
          (
            baselineState.manifestSha256 !== bundle.manifestSha256 ||
            baselineState.datasetSha256 !== bundle.datasetSha256 ||
            baselineState.taskSha256 !== taskSha256(bundle.task) ||
            !commonProvenanceMatches(baselineState.provenance, provenance)
          )
        ) {
          await writeReport(context.paths, 'quality-candidate.json', {
            reportVersion: 'grading-benchmark-command-report-v1',
            request: 'quality-candidate',
            conclusion: 'inconclusive',
            reason: 'benchmark_identity_mismatch',
            invocationBudget: { budget: 40, invoked: 0, remaining: 40 },
            quality: null,
            qualityGates: null,
            soak: null,
            throughput: null,
          })
          return { status: 'inconclusive' }
        }
        if (context.request.variant === 'candidate') {
          if (!baselineState) throw new Error('missing_quality_baseline_state')
          const expectedTaskSha256 = taskSha256(bundle.task)
          const candidateStateMatches = candidateState !== null &&
            candidateState.manifestSha256 === bundle.manifestSha256 &&
            candidateState.datasetSha256 === bundle.datasetSha256 &&
            candidateState.taskSha256 === expectedTaskSha256 &&
            sameBenchmarkProvenance(candidateState.provenance, provenance)
          const existingPairMatches = candidateState !== null && humanEvidence !== null &&
            candidateStateMatches &&
            humanEvidenceMatchesRun(
              humanEvidence,
              baselineState,
              candidateState,
              bundle,
              provenance,
            )

          if (!existingPairMatches) {
            const adapter = dependencies.humanReviewAdapter
            const canGenerate = candidateState === null && humanEvidence === null &&
              isBoundHumanReviewAdapter(adapter, bundle, provenance)
            if (canGenerate) {
              const generatedMetrics: BenchmarkSampleMetricObservation[] = []
              const budgeted = createInvocationBudgetedProvider(
                createProvider(context, run),
                context.profile.callBudget,
              )
              const quality = await runBenchmark({
                variant: 'candidate',
                provenance,
                task: bundle.task,
                samples: bundle.samples,
              }, {
                provider: budgeted.provider,
                assessResult: adapter.assessAndPresentResult,
                observeSampleMetrics: (observation) => { generatedMetrics.push(observation) },
              })
              const snapshot = budgeted.snapshot()
              if (snapshot.invoked !== 40 || generatedMetrics.length !== 40) {
                throw new Error('incomplete_quality_benchmark')
              }
              const identity = {
                manifestSha256: bundle.manifestSha256,
                datasetSha256: bundle.datasetSha256,
                taskSha256: expectedTaskSha256,
                runIdentitySha256: adapter.runIdentitySha256,
                provenance,
                quality,
                sampleMetrics: generatedMetrics,
              }
              candidateState = {
                stateVersion: 'grading-benchmark-quality-candidate-state-v1',
                ...identity,
                candidateRunSha256: computeQualityCandidateRunSha256(identity),
              }
              await writeCandidateState(context.paths, candidateState)
              const generatedEvidence = await adapter.createHumanEvidence({
                baselineState,
                candidateState,
              })
              humanEvidence = validateHumanReviewEvidence(generatedEvidence) &&
                humanEvidenceMatchesRun(
                  generatedEvidence,
                  baselineState,
                  candidateState,
                  bundle,
                  provenance,
                )
                ? generatedEvidence
                : null
              if (humanEvidence) {
                await writeHumanEvidence(context.paths, humanEvidence)
              }
              if (!humanEvidence) {
                await writeReport(context.paths, 'quality-candidate.json', {
                  reportVersion: 'grading-benchmark-command-report-v1',
                  request: 'quality-candidate',
                  conclusion: 'inconclusive',
                  reason: 'external_human_review_evidence_required',
                  invocationBudget: snapshot,
                  quality: null,
                  qualityGates: null,
                  soak: null,
                  throughput: null,
                })
                return { status: 'inconclusive' }
              }
            } else {
              const reason = humanEvidence === null
                ? 'external_human_review_evidence_required' as const
                : 'external_candidate_state_or_bound_evidence_required' as const
              await writeReport(context.paths, 'quality-candidate.json', {
                reportVersion: 'grading-benchmark-command-report-v1',
                request: 'quality-candidate',
                conclusion: 'inconclusive',
                reason,
                invocationBudget: { budget: 40, invoked: 0, remaining: 40 },
                quality: null,
                qualityGates: null,
                soak: null,
                throughput: null,
              })
              return { status: 'inconclusive' }
            }
          }
          if (!candidateState || !humanEvidence) {
            await writeReport(context.paths, 'quality-candidate.json', {
              reportVersion: 'grading-benchmark-command-report-v1',
              request: 'quality-candidate',
              conclusion: 'inconclusive',
              reason: 'external_candidate_state_or_bound_evidence_required',
              invocationBudget: { budget: 40, invoked: 0, remaining: 40 },
              quality: null,
              qualityGates: null,
              soak: null,
              throughput: null,
            })
            return { status: 'inconclusive' }
          }
          const qualityGates = evaluatePairedQualityGates(
            baselineState.quality,
            baselineState.sampleMetrics,
            candidateState.quality,
            candidateState.sampleMetrics,
            humanEvidence,
          )
          const locallyPassing = qualityGates.status === 'pass'
          await writeReport(context.paths, 'quality-candidate.json', {
            reportVersion: 'grading-benchmark-command-report-v1',
            request: 'quality-candidate',
            conclusion: locallyPassing ? 'inconclusive' : qualityGates.status,
            reason: locallyPassing ? 'external_candidate_evidence_unverified' : null,
            invocationBudget: {
              budget: 40,
              invoked: existingPairMatches ? 0 : 40,
              remaining: existingPairMatches ? 40 : 0,
            },
            quality: candidateState.quality,
            qualityGates,
            soak: null,
            throughput: null,
          })
          return qualityGates.status === 'fail'
              ? { status: 'complete', gatesPassed: false }
              : { status: 'inconclusive' }
        }
        const budgeted = createInvocationBudgetedProvider(
          createProvider(context, run),
          context.profile.callBudget,
        )
        const quality = await runBenchmark({
          variant: context.request.variant,
          provenance,
          task: bundle.task,
          samples: bundle.samples,
        }, {
          provider: budgeted.provider,
          ...(dependencies.assessResult ? { assessResult: dependencies.assessResult } : {}),
          observeSampleMetrics: (observation) => { sampleMetrics.push(observation) },
        })
        const snapshot = budgeted.snapshot()
        if (snapshot.invoked !== 40 || sampleMetrics.length !== 40) {
          throw new Error('incomplete_quality_benchmark')
        }
        if (context.request.variant === 'baseline') {
          await writeBaselineState(context.paths, {
            stateVersion: 'grading-benchmark-quality-state-v1',
            manifestSha256: bundle.manifestSha256,
            datasetSha256: bundle.datasetSha256,
            taskSha256: taskSha256(bundle.task),
            provenance,
            quality,
            sampleMetrics,
          })
          await writeReport(context.paths, 'quality-baseline.json', {
            reportVersion: 'grading-benchmark-command-report-v1',
            request: 'quality-baseline',
            conclusion: 'inconclusive',
            reason: 'external_candidate_run_and_human_review_required',
            invocationBudget: snapshot,
            quality,
            qualityGates: null,
            soak: null,
            throughput: null,
          })
          return { status: 'inconclusive' }
        }
        throw new Error('invalid_benchmark_profile')
      }
      if (context.request.mode === 'soak') {
        const bundle = await loadBundle(context.paths)
        const run = context.profile.runs[0]
        if (!run || run.variant !== 'candidate' || run.calls !== 100) {
          throw new Error('invalid_benchmark_profile')
        }
        const samples = Array.from({ length: 100 }, (_, index) => {
          const source = bundle.samples[index % bundle.samples.length]
          return {
            reference: {
              ...source.reference,
              id: `sample-${String(index + 1).padStart(3, '0')}`,
            },
            pages: source.pages,
          }
        })
        const provenance = createProvenance(context, bundle, run)
        const budgeted = createInvocationBudgetedProvider(
          createProvider(context, run),
          context.profile.callBudget,
        )
        const quality = await runBenchmark({
          variant: 'candidate',
          provenance,
          task: bundle.task,
          samples,
        }, {
          provider: budgeted.provider,
          ...(dependencies.assessResult ? { assessResult: dependencies.assessResult } : {}),
        })
        const snapshot = budgeted.snapshot()
        if (snapshot.invoked !== 100) throw new Error('incomplete_soak_benchmark')
        const soak = evaluateSoakAggregate(quality)
        await writeReport(context.paths, 'soak.json', {
          reportVersion: 'grading-benchmark-command-report-v1',
          request: 'soak',
          conclusion: soak.status,
          reason: null,
          invocationBudget: snapshot,
          quality,
          qualityGates: null,
          soak,
          throughput: null,
        })
        return soak.status === 'pass'
          ? { status: 'complete', gatesPassed: true }
          : soak.status === 'fail'
            ? { status: 'complete', gatesPassed: false }
            : { status: 'inconclusive' }
      }
      if (context.request.mode === 'throughput') {
        const bundle = await loadBundle(context.paths)
        const [baselineRun, candidateRun] = context.profile.runs
        if (!baselineRun || !candidateRun) throw new Error('invalid_benchmark_profile')
        const provenance = {
          baseline: createProvenance(context, bundle, baselineRun),
          candidate: createProvenance(context, bundle, candidateRun),
        }
        if (!commonProvenanceMatches(provenance.baseline, provenance.candidate)) {
          throw new Error('invalid_benchmark_provenance')
        }
        const conclusion = await runThroughput(context, bundle, createProvider)
        const throughput: ThroughputReportPayload = { ...conclusion, provenance }
        const invoked = conclusion.baseline.providerInvocations +
          conclusion.candidate.providerInvocations
        await writeReport(context.paths, 'throughput.json', {
          reportVersion: 'grading-benchmark-command-report-v1',
          request: 'throughput',
          conclusion: throughput.status,
          reason: null,
          invocationBudget: {
            budget: 60,
            invoked,
            remaining: 60 - invoked,
          },
          quality: null,
          qualityGates: null,
          soak: null,
          throughput,
        })
        return conclusion.status === 'pass'
          ? { status: 'complete', gatesPassed: true }
          : conclusion.status === 'fail'
            ? { status: 'complete', gatesPassed: false }
            : { status: 'inconclusive' }
      }
      return { status: 'fatal' }
    },
  }
}

export interface BenchmarkPrivatePaths {
  privateRoot: string
  manifestPath: string
  taskPath: string
  resultRoot: string
}

type PrivateFileStat = {
  dev: number | bigint
  ino: number | bigint
  size: number
  mtimeMs: number
  ctimeMs: number
  isFile(): boolean
}

type PrivateFileHandle = {
  stat(): Promise<PrivateFileStat>
  readFile(): Promise<Buffer>
  close(): Promise<void>
}

export interface BenchmarkSecureFileSystem {
  realpath(candidate: string): Promise<string>
  open(candidate: string): Promise<PrivateFileHandle>
  stat(candidate: string): Promise<PrivateFileStat>
}

const nodeSecureFileSystem: BenchmarkSecureFileSystem = {
  realpath: resolveRealPath,
  open: async (candidate) => await openFile(candidate, 'r'),
  stat: statFile,
}

export type PrivateBenchmarkBundleErrorCode =
  | 'private_file_outside_root'
  | 'private_file_unavailable'
  | 'private_file_not_regular'
  | 'private_file_too_large'
  | 'private_file_identity_changed'
  | 'invalid_manifest'
  | 'invalid_dataset_composition'
  | 'invalid_task'
  | 'invalid_page_signature'
  | 'duplicate_sample_pages'
  | 'private_bundle_too_large'

export class PrivateBenchmarkBundleError extends Error {
  constructor(readonly code: PrivateBenchmarkBundleErrorCode) {
    super('invalid_private_benchmark_bundle')
    this.name = 'PrivateBenchmarkBundleError'
  }
}

function privateBundleError(code: PrivateBenchmarkBundleErrorCode): never {
  throw new PrivateBenchmarkBundleError(code)
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

function sameFileIdentity(left: PrivateFileStat, right: PrivateFileStat): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    Number.isFinite(left.mtimeMs) &&
    Number.isFinite(left.ctimeMs) &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
}

export async function readVerifiedPrivateFile(
  candidate: string,
  privateRoot: string,
  maximumBytes: number,
  fileSystem: BenchmarkSecureFileSystem = nodeSecureFileSystem,
): Promise<Buffer> {
  if (
    !path.isAbsolute(privateRoot) ||
    !path.isAbsolute(candidate) ||
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1
  ) {
    privateBundleError('private_file_outside_root')
  }
  const lexicalRoot = path.resolve(privateRoot)
  const lexicalCandidate = path.resolve(candidate)
  if (!isWithinRoot(lexicalRoot, lexicalCandidate)) {
    privateBundleError('private_file_outside_root')
  }

  let handle: PrivateFileHandle | undefined
  try {
    const realRoot = path.resolve(await fileSystem.realpath(lexicalRoot))
    handle = await fileSystem.open(lexicalCandidate)
    const openedStat = await handle.stat()
    if (!openedStat.isFile()) privateBundleError('private_file_not_regular')
    if (!Number.isSafeInteger(openedStat.size) || openedStat.size < 1) {
      privateBundleError('private_file_not_regular')
    }
    if (openedStat.size > maximumBytes) privateBundleError('private_file_too_large')

    const realCandidate = path.resolve(await fileSystem.realpath(lexicalCandidate))
    if (!isWithinRoot(realRoot, realCandidate)) {
      privateBundleError('private_file_outside_root')
    }
    const targetStat = await fileSystem.stat(realCandidate)
    if (!sameFileIdentity(openedStat, targetStat)) {
      privateBundleError('private_file_identity_changed')
    }
    const bytes = await handle.readFile()
    // Force a stable content snapshot before the final identity check. The caller's
    // framed dataset digest then binds this exact Buffer, not merely its pathname.
    createHash('sha256').update(bytes).digest()
    const finalStat = await handle.stat()
    if (!sameFileIdentity(openedStat, finalStat) || bytes.byteLength !== openedStat.size) {
      privateBundleError('private_file_identity_changed')
    }
    return bytes
  } catch (error) {
    if (error instanceof PrivateBenchmarkBundleError) throw error
    privateBundleError('private_file_unavailable')
  } finally {
    if (handle) {
      try { await handle.close() } catch { /* Preserve the content-free primary outcome. */ }
    }
  }
  return privateBundleError('private_file_unavailable')
}

export interface LoadedPrivateBenchmarkSample {
  reference: GradingBenchmarkManifest['samples'][number]
  pages: readonly GatewayImageInput[]
}

export interface LoadedPrivateBenchmarkBundle extends ValidatedDatasetManifest {
  datasetSha256: string
  task: ConfirmedTaskPackageV2
  samples: readonly LoadedPrivateBenchmarkSample[]
}

const JSON_FILE_MAX_BYTES = 4 * 1024 * 1024
const TASK_FILE_MAX_BYTES = 1024 * 1024
const PAGE_MAX_BYTES = 8 * 1024 * 1024
const BUNDLE_MAX_BYTES = 512 * 1024 * 1024
const SAFE_TASK_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u

function parsePrivateJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    privateBundleError('invalid_manifest')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseConfirmedTask(value: unknown): ConfirmedTaskPackageV2 {
  const expectedKeys = [
    'taskId',
    'fullScore',
    'materialSummary',
    'writingRequirements',
    'constraints',
    'rubric',
  ]
  if (
    !isRecord(value) ||
    Object.keys(value).length !== expectedKeys.length ||
    Object.keys(value).some((key) => !expectedKeys.includes(key)) ||
    typeof value.taskId !== 'string' ||
    !SAFE_TASK_ID.test(value.taskId) ||
    typeof value.fullScore !== 'number' ||
    !Number.isInteger(value.fullScore) ||
    value.fullScore < 1 ||
    value.fullScore > 100 ||
    typeof value.materialSummary !== 'string' ||
    value.materialSummary.trim().length === 0 ||
    value.materialSummary.length > 20_000 ||
    !Array.isArray(value.writingRequirements) ||
    !Array.isArray(value.constraints)
  ) {
    privateBundleError('invalid_task')
  }
  const rubric = validateConfirmedRubric(value.rubric)
  if (
    !rubric.ok ||
    value.materialSummary !== rubric.value.materialSummary ||
    JSON.stringify(value.writingRequirements) !== JSON.stringify(rubric.value.writingRequirements) ||
    JSON.stringify(value.constraints) !== JSON.stringify(rubric.value.constraints)
  ) {
    privateBundleError('invalid_task')
  }
  return {
    taskId: value.taskId,
    fullScore: value.fullScore,
    materialSummary: value.materialSummary,
    writingRequirements: rubric.value.writingRequirements,
    constraints: rubric.value.constraints,
    rubric: rubric.value,
  }
}

function hasExpectedSignature(bytes: Buffer, mimeType: GatewayImageInput['mimeType']): boolean {
  if (mimeType === 'image/png') {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  }
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  return bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
}

function updateFramedHash(hash: ReturnType<typeof createHash>, value: Uint8Array): void {
  if (!Number.isSafeInteger(value.byteLength) || value.byteLength < 0) {
    privateBundleError('private_bundle_too_large')
  }
  const length = Buffer.allocUnsafe(8)
  length.writeBigUInt64BE(BigInt(value.byteLength))
  hash.update(length)
  hash.update(value)
}

function utf8Frame(value: string): Buffer {
  return Buffer.from(value, 'utf8')
}

export async function loadPrivateBenchmarkBundle(
  paths: BenchmarkPrivatePaths = resolveBenchmarkPrivatePaths(),
  fileSystem: BenchmarkSecureFileSystem = nodeSecureFileSystem,
): Promise<LoadedPrivateBenchmarkBundle> {
  let manifestValue: unknown
  let taskValue: unknown
  try {
    manifestValue = parsePrivateJson(await readVerifiedPrivateFile(
      paths.manifestPath,
      paths.privateRoot,
      JSON_FILE_MAX_BYTES,
      fileSystem,
    ))
    taskValue = parsePrivateJson(await readVerifiedPrivateFile(
      paths.taskPath,
      paths.privateRoot,
      TASK_FILE_MAX_BYTES,
      fileSystem,
    ))
  } catch (error) {
    if (error instanceof PrivateBenchmarkBundleError) throw error
    privateBundleError('invalid_manifest')
  }

  let validated: ValidatedDatasetManifest
  try {
    validated = await validateDatasetManifest(manifestValue, {
      privateRoot: paths.privateRoot,
      fileSystem: { realpath: fileSystem.realpath },
    })
  } catch {
    privateBundleError('invalid_manifest')
  }
  try {
    validateDatasetComposition(validated.manifest)
  } catch {
    privateBundleError('invalid_dataset_composition')
  }
  if (validated.manifest.samples.length !== 40) {
    privateBundleError('invalid_dataset_composition')
  }

  const task = parseConfirmedTask(taskValue)
  if (validated.manifest.samples.some((sample) => sample.fullScore !== task.fullScore)) {
    privateBundleError('invalid_task')
  }

  let totalBytes = 0
  const pageCache = new Map<string, Buffer>()
  const samples: LoadedPrivateBenchmarkSample[] = []
  const datasetHash = createHash('sha256')
  updateFramedHash(datasetHash, utf8Frame('grading-benchmark-dataset-v1'))
  updateFramedHash(datasetHash, utf8Frame(validated.manifestSha256))
  updateFramedHash(datasetHash, utf8Frame(JSON.stringify(validated.manifest)))
  updateFramedHash(datasetHash, utf8Frame(String(validated.manifest.samples.length)))
  const essayPageDigests = new Set<string>()
  for (const sample of validated.manifest.samples) {
    if (sample.pages.length > 10) privateBundleError('invalid_manifest')
    const pages: GatewayImageInput[] = []
    const essayHash = createHash('sha256')
    updateFramedHash(essayHash, utf8Frame('grading-benchmark-essay-pages-v1'))
    updateFramedHash(essayHash, utf8Frame(String(sample.pages.length)))
    updateFramedHash(datasetHash, utf8Frame(sample.id))
    updateFramedHash(datasetHash, utf8Frame(String(sample.pages.length)))
    for (const page of sample.pages) {
      const pagePath = path.resolve(paths.privateRoot, page.path)
      let bytes = pageCache.get(pagePath)
      if (!bytes) {
        bytes = await readVerifiedPrivateFile(
          pagePath,
          paths.privateRoot,
          PAGE_MAX_BYTES,
          fileSystem,
        )
        totalBytes += bytes.byteLength
        if (totalBytes > BUNDLE_MAX_BYTES) privateBundleError('private_bundle_too_large')
        pageCache.set(pagePath, bytes)
      }
      if (!hasExpectedSignature(bytes, page.mimeType)) {
        privateBundleError('invalid_page_signature')
      }
      updateFramedHash(essayHash, utf8Frame(String(page.pageOrder)))
      updateFramedHash(essayHash, utf8Frame(page.mimeType))
      updateFramedHash(essayHash, bytes)
      updateFramedHash(datasetHash, utf8Frame(String(page.pageOrder)))
      updateFramedHash(datasetHash, utf8Frame(page.mimeType))
      updateFramedHash(datasetHash, bytes)
      pages.push({
        pageId: `benchmark-page-${page.pageOrder}`,
        mimeType: page.mimeType,
        buffer: bytes,
      })
    }
    const essayPageDigest = essayHash.digest('hex')
    if (essayPageDigests.has(essayPageDigest)) {
      privateBundleError('duplicate_sample_pages')
    }
    essayPageDigests.add(essayPageDigest)
    samples.push({ reference: sample, pages })
  }

  return { ...validated, datasetSha256: datasetHash.digest('hex'), task, samples }
}

export interface BenchmarkExecutionRun {
  variant: 'baseline' | 'candidate'
  essayPromptProfile: 'legacy' | 'optimized-v1'
  executionRegistry: 'direct-legacy' | 'memory-v1'
  hardLimit: 1 | 'runtime-bounded'
  calls: number
}

export interface BenchmarkExecutionProfile {
  request:
    | 'quality-baseline'
    | 'quality-candidate'
    | 'soak'
    | 'throughput'
    | 'image-variants'
  callBudget: number
  runs: BenchmarkExecutionRun[]
}

export function benchmarkExecutionProfile(
  request: BenchmarkCliRequest,
): BenchmarkExecutionProfile {
  const baseline: BenchmarkExecutionRun = {
    variant: 'baseline',
    essayPromptProfile: 'legacy',
    executionRegistry: 'direct-legacy',
    hardLimit: 1,
    calls: request.mode === 'throughput' ? 30 : 40,
  }
  const candidate: BenchmarkExecutionRun = {
    variant: 'candidate',
    essayPromptProfile: 'optimized-v1',
    executionRegistry: 'memory-v1',
    hardLimit: 'runtime-bounded',
    calls: request.mode === 'soak' ? 100 : request.mode === 'throughput' ? 30 : 40,
  }
  if (request.mode === 'quality') {
    return {
      request: `quality-${request.variant}`,
      callBudget: 40,
      runs: [request.variant === 'baseline' ? baseline : candidate],
    }
  }
  if (request.mode === 'soak') {
    return { request: 'soak', callBudget: 100, runs: [candidate] }
  }
  if (request.mode === 'throughput') {
    return { request: 'throughput', callBudget: 60, runs: [baseline, candidate] }
  }
  return { request: 'image-variants', callBudget: 0, runs: [] }
}

export interface InvocationBudgetSnapshot {
  budget: number
  invoked: number
  remaining: number
}

export function createInvocationBudgetedProvider(
  delegate: MultimodalProvider,
  budget: number,
): { provider: MultimodalProvider; snapshot: () => InvocationBudgetSnapshot } {
  if (!Number.isSafeInteger(budget) || budget < 0) {
    throw new TypeError('invalid_provider_invocation_budget')
  }
  let invoked = 0
  const provider: MultimodalProvider = {
    generateMaterialContext: (input) => delegate.generateMaterialContext(input),
    generateRubric: (input) => delegate.generateRubric(input),
    gradeEssay: (input) => {
      if (invoked >= budget) {
        return Promise.reject(new Error('provider_invocation_budget_exhausted'))
      }
      invoked += 1
      return delegate.gradeEssay(input)
    },
  }
  return {
    provider,
    snapshot: () => ({ budget, invoked, remaining: budget - invoked }),
  }
}

export function createBenchmarkRuntimeConfig(
  runtimeEnv: NodeJS.ProcessEnv,
  run: BenchmarkExecutionRun,
): GatewayRuntimeConfig {
  const projected: NodeJS.ProcessEnv = {
    ...runtimeEnv,
    GRADING_PROVIDER: 'kimi',
    GRADING_RUBRIC_STRATEGY:
      run.variant === 'baseline' ? 'two-pass-legacy' : 'single-pass-v1',
    GRADING_ESSAY_PROMPT_PROFILE: run.essayPromptProfile,
    GRADING_EXECUTION_REGISTRY: run.executionRegistry,
    ...(run.hardLimit === 1
      ? { GRADING_MAX_CONCURRENT_PROVIDER_CALLS: '1' }
      : {}),
  }
  return parseGatewayRuntimeConfig(projected)
}

function createConfiguredBenchmarkProvider(
  context: BenchmarkCliCommandContext,
  run: BenchmarkExecutionRun,
): MultimodalProvider {
  return getMultimodalProvider(
    createBenchmarkRuntimeConfig(context.runtimeEnv, run),
    { apiKey: context.apiKey },
  )
}

type GitCommitCommandResult = { status: number | null; stdout: string }
type GitCommandRunner = (
  gatewayRoot: string,
  args: readonly string[],
) => GitCommitCommandResult

function runGitCommitCommand(
  gatewayRoot: string,
  args: readonly string[],
): GitCommitCommandResult {
  const result = spawnSync('git', [...args], {
    cwd: gatewayRoot,
    encoding: 'utf8',
    windowsHide: true,
  })
  return { status: result.status, stdout: result.stdout }
}

export function resolveBenchmarkGitCommit(
  gatewayRoot: string,
  runGit: GitCommandRunner = runGitCommitCommand,
): string {
  const result = runGit(gatewayRoot, ['rev-parse', 'HEAD'])
  const commit = result.status === 0 ? result.stdout.trim() : ''
  if (!/^[a-f0-9]{40}$/iu.test(commit)) throw new Error('benchmark_git_commit_unavailable')
  const worktree = runGit(gatewayRoot, ['status', '--porcelain', '--untracked-files=all'])
  if (worktree.status !== 0) throw new Error('benchmark_git_status_unavailable')
  if (worktree.stdout.length !== 0) throw new Error('benchmark_worktree_not_clean')
  return commit.toLowerCase()
}

function createDefaultBenchmarkProvenance(
  context: BenchmarkCliCommandContext,
  bundle: LoadedPrivateBenchmarkBundle,
  run: BenchmarkExecutionRun,
  resolveCommit: (gatewayRoot: string) => string = resolveBenchmarkGitCommit,
): BenchmarkProvenance {
  const config = createBenchmarkRuntimeConfig(context.runtimeEnv, run)
  return {
    benchmarkVersion: GRADING_BENCHMARK_VERSION,
    gitCommit: resolveCommit(path.resolve(context.paths.resultRoot, '..')),
    model: 'kimi-k3',
    reasoningEffort: 'low',
    policyVersion: GRADING_POLICY_VERSION,
    providerSchemaVersion: run.essayPromptProfile === 'legacy'
      ? LEGACY_ESSAY_PROVIDER_SCHEMA_VERSION
      : ESSAY_PROVIDER_SCHEMA_VERSION,
    phaseBudgets: {
      material_context: config.kimi.stageBudgets.material_context,
      rubric_generation: config.kimi.stageBudgets.rubric_generation,
      essay_grading_images: config.kimi.stageBudgets.essay_grading_images,
      essay_regrading_text: config.kimi.stageBudgets.essay_regrading_text,
    },
    featureProfiles: {
      image: 'original-v1',
      output: run.variant === 'baseline' ? 'legacy-v1' : 'deduplicated-v1',
      prompt: run.essayPromptProfile,
    },
    manifestSha256: bundle.manifestSha256,
    datasetSha256: bundle.datasetSha256,
  }
}

export function resolveBenchmarkPrivatePaths(
  moduleLocation: string = import.meta.url,
): BenchmarkPrivatePaths {
  const modulePath = moduleLocation.startsWith('file:')
    ? fileURLToPath(moduleLocation)
    : moduleLocation
  const gatewayRoot = resolve(modulePath, '..', '..', '..')
  const privateRoot = resolve(gatewayRoot, 'local-private-samples')
  return {
    privateRoot,
    manifestPath: resolve(privateRoot, 'manifest.json'),
    taskPath: resolve(privateRoot, 'task.json'),
    resultRoot: resolve(gatewayRoot, 'local-private-results'),
  }
}

function parseRequest(args: readonly string[]): BenchmarkCliRequest | undefined {
  if (!Array.isArray(args)) return undefined
  if (args.length === 2 && args[0] === '--variant') {
    if (args[1] === 'baseline' || args[1] === 'candidate') {
      return { mode: 'quality', variant: args[1] }
    }
    return undefined
  }

  if (args.length === 4 && args[0] === '--mode' && args[1] === 'soak'
    && args[2] === '--calls' && args[3] === '100') {
    return { mode: 'soak', calls: 100 }
  }

  if (args.length === 4 && args[0] === '--mode' && args[1] === 'throughput'
    && args[2] === '--essays' && args[3] === '30') {
    return { mode: 'throughput', essays: 30 }
  }

  if (args.length === 2 && args[0] === '--mode' && args[1] === 'image-variants') {
    return { mode: 'image-variants' }
  }

  return undefined
}

export async function runGradingBenchmarkCli(
  args: readonly string[],
  dependencies: BenchmarkCliDependencies,
): Promise<0 | 1 | 2 | 3> {
  const output = dependencies.output ?? console.log
  const request = parseRequest(args)
  if (!request) {
    output('grading_benchmark:fatal')
    return 1
  }

  const legacyEnv = dependencies.env ?? process.env
  const authorizationEnv = dependencies.authorizationEnv ?? legacyEnv
  const runtimeEnv = dependencies.runtimeEnv ?? legacyEnv
  const apiKey = runtimeEnv.KIMI_API_KEY?.trim()
  if (authorizationEnv.GRADING_BENCHMARK_AUTHORIZATION !== 'approved' || !apiKey) {
    output('grading_benchmark:not_run')
    return 3
  }
  if (
    request.mode === 'image-variants' &&
    authorizationEnv.GRADING_IMAGE_EXPERIMENT !== 'approved'
  ) {
    output('grading_benchmark:not_run')
    return 3
  }

  try {
    const outcome = dependencies.createCommand
      ? await dependencies.createCommand({
          request,
          apiKey,
          runtimeEnv,
          profile: benchmarkExecutionProfile(request),
          paths: resolveBenchmarkPrivatePaths(),
        }).execute()
      : dependencies.runBenchmark && dependencies.createProvider
        ? await dependencies.runBenchmark(
            request,
            dependencies.createProvider({ apiKey, env: runtimeEnv }),
          )
        : { status: 'fatal' as const }
    if (outcome.status === 'fatal') {
      output('grading_benchmark:fatal')
      return 1
    }
    if (outcome.status === 'inconclusive') {
      output('grading_benchmark:inconclusive')
      return 1
    }
    if (!outcome.gatesPassed) {
      output('grading_benchmark:complete:failed')
      return 2
    }
    output('grading_benchmark:complete:passed')
    return 0
  } catch {
    output('grading_benchmark:fatal')
    return 1
  }
}

export function isDirectGradingBenchmarkExecution(
  argvEntry: string | undefined,
  moduleLocation: string,
): boolean {
  if (!argvEntry) return false
  const modulePath = moduleLocation.startsWith('file:')
    ? fileURLToPath(moduleLocation)
    : moduleLocation
  return resolve(argvEntry) === resolve(modulePath)
}

export interface DirectBenchmarkCliDependencies {
  shellEnv?: NodeJS.ProcessEnv
  output?: (line: string) => void
  loadRuntimeEnvironment?: (runtimeEnv: NodeJS.ProcessEnv, envPath: string) => void
  createCommand?: (context: BenchmarkCliCommandContext) => BenchmarkCliCommand
}

function loadFixedDotenv(runtimeEnv: NodeJS.ProcessEnv, envPath: string): void {
  const dotenvEnvironment: Record<string, string> = {}
  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (typeof value === 'string') dotenvEnvironment[key] = value
  }
  loadDotenv({ path: envPath, processEnv: dotenvEnvironment, override: false })
  Object.assign(runtimeEnv, dotenvEnvironment)
}

export async function runDirectGradingBenchmarkCli(
  args: readonly string[],
  dependencies: DirectBenchmarkCliDependencies = {},
): Promise<0 | 1 | 2 | 3> {
  const output = dependencies.output ?? console.log
  const request = parseRequest(args)
  if (!request) {
    output('grading_benchmark:fatal')
    return 1
  }
  const shellEnv = { ...(dependencies.shellEnv ?? process.env) }
  if (
    shellEnv.GRADING_BENCHMARK_AUTHORIZATION !== 'approved' ||
    (
      request.mode === 'image-variants' &&
      shellEnv.GRADING_IMAGE_EXPERIMENT !== 'approved'
    )
  ) {
    output('grading_benchmark:not_run')
    return 3
  }
  const runtimeEnv = { ...shellEnv }
  const paths = resolveBenchmarkPrivatePaths()
  const envPath = path.resolve(paths.resultRoot, '..', '.env')
  try {
    (dependencies.loadRuntimeEnvironment ?? loadFixedDotenv)(runtimeEnv, envPath)
  } catch {
    output('grading_benchmark:fatal')
    return 1
  }
  return await runGradingBenchmarkCli(args, {
    authorizationEnv: shellEnv,
    runtimeEnv,
    output,
    createCommand: dependencies.createCommand ?? createDefaultBenchmarkCommand,
  })
}

if (isDirectGradingBenchmarkExecution(process.argv[1], import.meta.url)) {
  void runDirectGradingBenchmarkCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode
  })
}
