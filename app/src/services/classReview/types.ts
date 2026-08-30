export type Revision = number
export type NonNegativeSafeInteger = number
export type Ratio = number
export type Rfc3339Timestamp = string
export type OpaqueId = string
export type OpaqueKey = string

export type Severity = 'low' | 'medium' | 'high'
export type SafeUnappliedReason = 'ai_text_changed' | 'merge_conflict'

export type SafeFailureCode =
  | 'class_review_not_eligible'
  | 'active_generation_conflict'
  | 'class_review_candidate_conflict'
  | 'class_review_source_invalidated'
  | 'class_review_task_invalidated'
  | 'class_review_projection_too_large'
  | 'class_review_prompt_too_large'
  | 'class_review_prompt_calibration_missing'
  | 'class_review_prompt_contract_drift'
  | 'provider_not_configured'
  | 'provider_auth_failed'
  | 'provider_balance_unavailable'
  | 'provider_rate_limited'
  | 'provider_timeout'
  | 'provider_result_unknown'
  | 'provider_unavailable'
  | 'provider_content_filtered'
  | 'provider_unexpected_tool_call'
  | 'provider_invalid_response'

export type ParseErrorCode =
  | 'not_object'
  | 'missing_key'
  | 'unknown_key'
  | 'invalid_type'
  | 'invalid_value'
  | 'limit_exceeded'
  | 'duplicate_value'
  | 'unknown_reference'

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: ParseErrorCode; path: string } }

export interface SemanticCoverageV1 {
  projectedGroupCount: NonNegativeSafeInteger
  eligibleGroupCount: NonNegativeSafeInteger
  groupCoverage: Ratio
  projectedDistinctEssaySupportSum: NonNegativeSafeInteger
  eligibleDistinctEssaySupportSum: NonNegativeSafeInteger
  supportWeightedCoverage: Ratio
  projectedOccurrenceSum: NonNegativeSafeInteger
  eligibleOccurrenceSum: NonNegativeSafeInteger
  occurrenceWeightedCoverage: Ratio
}

export interface ClassReviewScoreSummaryV1 {
  averageScore: number
  highestScore: number
  lowestScore: number
}

export interface ClassReviewScoreBandV1 {
  bandId: OpaqueKey
  lowerInclusive: number
  upperInclusive: number
  essayCount: NonNegativeSafeInteger
}

export interface ClassReviewDimensionStatisticsV1 {
  dimensionId: OpaqueKey
  name: string
  averageScore: number
  maxScore: number
  normalizedPerformance: Ratio
}

export interface ClassReviewStatisticsV1 {
  totalEssayCount: NonNegativeSafeInteger
  includedEssayCount: NonNegativeSafeInteger
  issueEligibleEssayCount: NonNegativeSafeInteger
  excludedEssayCount: NonNegativeSafeInteger
  issueCoverageRate: Ratio
  fullScore: number
  scoreSummary: ClassReviewScoreSummaryV1 | null
  scoreBands: ClassReviewScoreBandV1[]
  dimensions: ClassReviewDimensionStatisticsV1[]
}

export interface AiSummaryStrengthV1 {
  title: string
  detail: string
  dimensionIds: OpaqueKey[]
}

export interface AiSummaryLearningRecommendationV1 {
  title: string
  action: string
}

export interface AiSummaryV1 {
  overallComment: string
  strengths: AiSummaryStrengthV1[]
  learningRecommendations: AiSummaryLearningRecommendationV1[]
}

export interface EvidenceRefV1 {
  evidenceId: OpaqueId
  selectionOrigin: 'teacher_selected' | 'system_generation'
  sourceLocator: OpaqueId
  sourceResultRevision: Revision
  anonymousExample: string | null
}

export interface ClassReviewIssueBlockV1 {
  blockId: OpaqueId
  topicKey: OpaqueKey
  origin: 'ai' | 'teacher'
  title: string
  diagnosis: string
  teachingAction: string
  severity: Severity
  teacherStudentCount: NonNegativeSafeInteger
  systemStudentCount: NonNegativeSafeInteger
  combinedStudentCount: NonNegativeSafeInteger
  occurrenceCount: NonNegativeSafeInteger
  supportDenominator: NonNegativeSafeInteger | null
  anonymousExamples: string[]
  evidenceRefs: EvidenceRefV1[]
}

export interface ClearSpellingItemV1 {
  itemId: OpaqueId
  topicKey: OpaqueKey
  sourceSubtype: 'spelling' | 'word_choice'
  originalWord: string
  correctedWord: string
  studentCount: NonNegativeSafeInteger
  occurrenceCount: NonNegativeSafeInteger
  anonymousExample: string | null
}

export interface SelectedMaterialV1 {
  materialId: OpaqueId
  type:
    | 'typical_error'
    | 'logic_issue'
    | 'expression_upgrade'
    | 'excellent_expression'
    | 'teacher_note'
  categoryLabel: string
  severity: Severity | null
  needsTeacherReview: boolean
  originalText: string
  revisedText: string | null
  diagnosis: string | null
  teachingSuggestion: string | null
  sourceLocator: OpaqueId
}

export interface SnapshotMetadataV1 {
  includedEssayCount: NonNegativeSafeInteger
  issueEligibleEssayCount: NonNegativeSafeInteger
  totalEssayCount: NonNegativeSafeInteger
  semanticCoverage: SemanticCoverageV1
}

export type ClassReviewGenerationCommandV1 =
  | {
      contractVersion: 'class-review-generation-command-v1'
      intent: 'initial'
      generationId: OpaqueId
      expectedTaskRevision: Revision
      expectedReportRevision: Revision | null
    }
  | {
      contractVersion: 'class-review-generation-command-v1'
      intent: 'regenerate'
      generationId: OpaqueId
      expectedTaskRevision: Revision
      expectedReportRevision: Revision
    }
  | {
      contractVersion: 'class-review-generation-command-v1'
      intent: 'apply_candidate'
      generationId: OpaqueId
      expectedTaskRevision: Revision
      expectedReportRevision: Revision
      expectedGenerationRevision: Revision
      expectedAiTextEditRevision: Revision
    }
  | {
      contractVersion: 'class-review-generation-command-v1'
      intent: 'discard_candidate'
      generationId: OpaqueId
      expectedGenerationRevision: Revision
    }

export interface GenerationStatusBaseV1 {
  contractVersion: 'class-review-generation-status-v1'
  generationId: OpaqueId
  generationRevision: Revision
  includedEssayCount: NonNegativeSafeInteger
  issueEligibleEssayCount: NonNegativeSafeInteger
  totalEssayCount: NonNegativeSafeInteger
  createdAt: Rfc3339Timestamp
}

export type ClassReviewGenerationStatusV1 =
  | (GenerationStatusBaseV1 & { state: 'queued' })
  | (GenerationStatusBaseV1 & { state: 'running' })
  | (GenerationStatusBaseV1 & {
      state: 'result_unknown'
      safeFailureCode: 'provider_result_unknown'
    })
  | (GenerationStatusBaseV1 & {
      state: 'succeeded'
      semanticCoverage: SemanticCoverageV1
      completedAt: Rfc3339Timestamp
    })
  | (GenerationStatusBaseV1 & {
      state: 'succeeded_unapplied'
      semanticCoverage: SemanticCoverageV1
      safeUnappliedReason: SafeUnappliedReason
      completedAt: Rfc3339Timestamp
    })
  | (GenerationStatusBaseV1 & {
      state: 'failed'
      safeFailureCode: SafeFailureCode
      completedAt: Rfc3339Timestamp
    })
  | (GenerationStatusBaseV1 & {
      state: 'discarded'
      completedAt: Rfc3339Timestamp
    })
  | (GenerationStatusBaseV1 & {
      state: 'invalidated'
      safeFailureCode: 'class_review_source_invalidated' | 'class_review_task_invalidated'
      completedAt: Rfc3339Timestamp
    })

export type ActionableGenerationSummaryV1 =
  | {
      generationId: OpaqueId
      generationRevision: Revision
      state: 'queued' | 'running'
      createdAt: Rfc3339Timestamp
    }
  | {
      generationId: OpaqueId
      generationRevision: Revision
      state: 'result_unknown'
      safeFailureCode: 'provider_result_unknown'
      createdAt: Rfc3339Timestamp
    }
  | {
      generationId: OpaqueId
      generationRevision: Revision
      state: 'succeeded_unapplied'
      safeUnappliedReason: SafeUnappliedReason
      createdAt: Rfc3339Timestamp
      completedAt: Rfc3339Timestamp
    }

export interface ReportCommonV1 {
  contractVersion: 'class-review-report-v1'
  taskRevision: Revision
  reportRevision: Revision | null
  aiTextEditRevision: Revision
  currentGeneration: ActionableGenerationSummaryV1 | null
  statistics: ClassReviewStatisticsV1
  issueBlocks: ClassReviewIssueBlockV1[]
  issueOrder: OpaqueId[]
  clearSpellingItems: ClearSpellingItemV1[]
  selectedMaterials: SelectedMaterialV1[]
}

export interface ClassReviewReportNoneV1 extends ReportCommonV1 {
  workspaceState: 'none'
  reportRevision: null
  aiTextEditRevision: 0
  issueBlocks: []
  issueOrder: []
  selectedMaterials: []
}

export interface ClassReviewReportDraftV1 extends ReportCommonV1 {
  workspaceState: 'draft' | 'ai_removed'
  reportRevision: Revision
}

export interface ClassReviewReportAiAvailableV1 extends ReportCommonV1 {
  workspaceState: 'ai_available'
  reportRevision: Revision
  appliedGenerationId: OpaqueId
  generatedAt: Rfc3339Timestamp
  snapshotMetadata: SnapshotMetadataV1
  aiSummary: AiSummaryV1
}

export type ClassReviewReportV1 =
  | ClassReviewReportNoneV1
  | ClassReviewReportDraftV1
  | ClassReviewReportAiAvailableV1

export type IssueCounterIdV1 =
  | 'grammar'
  | 'spelling'
  | 'word_choice'
  | 'structure'
  | 'legibility'
  | 'logic_weak_connection'
  | 'logic_unclear_logic'
  | 'logic_missing_cause_effect'
  | 'logic_unclear_transition'
  | 'logic_topic_drift'
  | 'logic_irrelevant_sentence'
  | 'logic_unclear_reference'
  | 'logic_missing_motivation'
  | 'logic_plot_gap'
  | 'severity_low'
  | 'severity_medium'
  | 'severity_high'
  | 'other'

export interface SynthesisScoreV1 {
  fullScore: number
  averageScore: number
  medianScore: number
  lowestScore: number
  highestScore: number
}

export interface SynthesisScoreBandV1 {
  bandId: OpaqueKey
  lowerInclusive: number
  upperInclusive: number
  essayCount: NonNegativeSafeInteger
}

export interface SynthesisDimensionV1 {
  dimensionId: OpaqueKey
  label: string
  averageScore: number
  medianScore: number
  maxScore: number
  normalizedPerformance: Ratio
}

export interface SynthesisIssueCounterV1 {
  counterId: IssueCounterIdV1
  count: NonNegativeSafeInteger
}

export interface SynthesisStatisticsV1 {
  includedEssayCount: NonNegativeSafeInteger
  issueEligibleEssayCount: NonNegativeSafeInteger
  totalEssayCount: NonNegativeSafeInteger
  excludedEssayCount: NonNegativeSafeInteger
  score: SynthesisScoreV1
  scoreBands: SynthesisScoreBandV1[]
  dimensions: SynthesisDimensionV1[]
  issueCounters: SynthesisIssueCounterV1[]
}

export interface ClassReviewSynthesisProjectionV1 {
  statistics: SynthesisStatisticsV1
  groups: SynthesisGroupV1[]
  semanticCoverage: SemanticCoverageV1
}

export type SynthesisGroupTypeV1 =
  | 'grammar'
  | 'spelling'
  | 'word_choice'
  | 'structure'
  | 'logic'
  | 'legibility'

export type SynthesisLogicSubtypeV1 =
  | 'weak_connection'
  | 'unclear_logic'
  | 'missing_cause_effect'
  | 'unclear_transition'
  | 'topic_drift'
  | 'irrelevant_sentence'
  | 'unclear_reference'
  | 'missing_motivation'
  | 'plot_gap'

export interface SynthesisGroupExcerptV1 {
  originalText: string
  suggestionOrDiagnosis: string
}

export interface SynthesisGroupV1 {
  groupId: OpaqueKey
  type: SynthesisGroupTypeV1
  subtype: SynthesisLogicSubtypeV1 | null
  severity: Severity
  title: string
  mustCover: boolean
  distinctEssaySupport: NonNegativeSafeInteger
  occurrenceCount: NonNegativeSafeInteger
  excerpt: SynthesisGroupExcerptV1 | null
}

export interface ClassReviewSynthesisRequestV1 {
  contractVersion: 'class-review-synthesis-request-v1'
  requestId: OpaqueId
  rubricRevisionDigest: string
  policyVersion: 'class-review-policy-v1'
  schemaVersion: 'kimi-class-review-output-v1'
  projectionVersion: 'class-review-projection-v1'
  budgetVersion: 'class-review-prompt-budget-v1'
  statistics: SynthesisStatisticsV1
  groups: SynthesisGroupV1[]
  semanticCoverage: SemanticCoverageV1
  outputLimits: {
    maxCompletionTokens: 3072
    maxVisibleCodePoints: 2200
    maxJsonUtf8Bytes: 16384
  }
}

export interface ClassReviewProviderStrengthV1 {
  title: string
  detail: string
  dimensionIds: OpaqueKey[]
}

export interface ClassReviewProviderPatternV1 {
  groupIds: OpaqueKey[]
  title: string
  diagnosis: string
  teachingAction: string
  severity: Severity
}

export interface ClassReviewProviderLearningRecommendationV1 {
  title: string
  action: string
}

export interface ClassReviewProviderOutputV1 {
  overallComment: string
  strengths: ClassReviewProviderStrengthV1[]
  patterns: ClassReviewProviderPatternV1[]
  learningRecommendations: ClassReviewProviderLearningRecommendationV1[]
}

export interface ProviderUsageV1 {
  promptTokens: NonNegativeSafeInteger
  completionTokens: NonNegativeSafeInteger
  totalTokens: NonNegativeSafeInteger
  cachedTokens: NonNegativeSafeInteger | null
}

export interface SynthesisTimingsV1 {
  queueMs: NonNegativeSafeInteger
  providerMs: NonNegativeSafeInteger
  validationMs: NonNegativeSafeInteger
  totalMs: NonNegativeSafeInteger
}

export type SafeFinishReasonV1 = 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'unknown'

export type ClassReviewSynthesisResultV1 =
  | {
      contractVersion: 'class-review-synthesis-result-v1'
      requestId: OpaqueId
      status: 'succeeded'
      output: ClassReviewProviderOutputV1
      finishReason: 'stop'
      usage: ProviderUsageV1
      timingsMs: SynthesisTimingsV1
    }
  | {
      contractVersion: 'class-review-synthesis-result-v1'
      requestId: OpaqueId
      status: 'failed'
      safeFailureCode: SafeFailureCode
      retryable: boolean
      retryAfterMs: NonNegativeSafeInteger | null
      completionDisposition: 'not_started' | 'confirmed_zero_completion' | 'completed'
      finishReason: SafeFinishReasonV1 | null
      usage: ProviderUsageV1 | null
      timingsMs: SynthesisTimingsV1
    }
  | {
      contractVersion: 'class-review-synthesis-result-v1'
      requestId: OpaqueId
      status: 'result_unknown'
      safeFailureCode: 'provider_result_unknown'
      completionDisposition: 'unknown'
      timingsMs: SynthesisTimingsV1
    }

export function fail(code: ParseErrorCode, path: string): ParseResult<never> {
  return { ok: false, error: { code, path } }
}

export function pass<T>(value: T): ParseResult<T> {
  return { ok: true, value }
}

export function pointer(path: string, token: string | number): string {
  const escaped = String(token).replaceAll('~', '~0').replaceAll('/', '~1')
  return `${path}/${escaped}`
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hasOnlyKeys(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): ParseResult<Record<string, unknown>> {
  if (!isRecord(value)) return fail('not_object', path)
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      return fail('missing_key', pointer(path, key))
    }
  }
  const allowed = new Set([...required, ...optional])
  const unknownKeys = Object.keys(value)
    .filter((key) => !allowed.has(key))
    .sort()
  if (unknownKeys.length > 0) return fail('unknown_key', pointer(path, unknownKeys[0]))
  return pass(value)
}

type CodePointScan =
  | { status: 'ok'; length: number }
  | { status: 'malformed'; length: number }
  | { status: 'too_long'; length: number }

function scanCodePoints(value: string, max: number): CodePointScan {
  let length = 0
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return { status: 'malformed', length }
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return { status: 'malformed', length }
    }
    length += 1
    if (length > max) return { status: 'too_long', length }
  }
  return { status: 'ok', length }
}

export function codePointLengthAt(value: string, path: string, max: number): ParseResult<number> {
  const scan = scanCodePoints(value, max)
  if (scan.status === 'malformed') return fail('invalid_value', path)
  if (scan.status === 'too_long') return fail('limit_exceeded', path)
  return pass(scan.length)
}

export function stringAt(
  value: unknown,
  path: string,
  max: number,
  required = true,
): ParseResult<string> {
  if (typeof value !== 'string') return fail('invalid_type', path)
  const length = codePointLengthAt(value, path, max)
  if (!length.ok) return length
  if (required && length.value === 0) return fail('invalid_value', path)
  return pass(value)
}

export function nullableStringAt(
  value: unknown,
  path: string,
  max: number,
): ParseResult<string | null> {
  if (value === null) return pass(null)
  return stringAt(value, path, max)
}

export function booleanAt(value: unknown, path: string): ParseResult<boolean> {
  return typeof value === 'boolean' ? pass(value) : fail('invalid_type', path)
}

export function safeIntegerAt(value: unknown, path: string): ParseResult<number> {
  if (typeof value !== 'number') return fail('invalid_type', path)
  if (!Number.isSafeInteger(value) || value < 0) return fail('invalid_value', path)
  return pass(value)
}

export function finiteAt(value: unknown, path: string, positive = false): ParseResult<number> {
  if (typeof value !== 'number') return fail('invalid_type', path)
  if (!Number.isFinite(value) || (positive && value <= 0)) return fail('invalid_value', path)
  return pass(value)
}

export function ratioAt(value: unknown, path: string): ParseResult<number> {
  const parsed = finiteAt(value, path)
  if (!parsed.ok) return parsed
  if (parsed.value < 0 || parsed.value > 1) return fail('invalid_value', path)
  return parsed
}

export function enumAt<T extends string>(
  value: unknown,
  path: string,
  choices: readonly T[],
): ParseResult<T> {
  if (typeof value !== 'string') return fail('invalid_type', path)
  for (const choice of choices) {
    if (value === choice) return pass(choice)
  }
  return fail('invalid_value', path)
}

export function literalAt<T extends string>(
  value: unknown,
  path: string,
  expected: T,
): ParseResult<T> {
  if (typeof value !== 'string') return fail('invalid_type', path)
  return value === expected ? pass(expected) : fail('invalid_value', path)
}

export function opaqueAt(value: unknown, path: string): ParseResult<string> {
  const parsed = stringAt(value, path, 128)
  if (!parsed.ok) return parsed
  return /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(parsed.value)
    ? parsed
    : fail('invalid_value', path)
}

export function timestampAt(value: unknown, path: string): ParseResult<string> {
  const parsed = stringAt(value, path, 40)
  if (!parsed.ok) return parsed
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/.exec(
    parsed.value,
  )
  if (!match) return fail('invalid_value', path)
  const timestamp = Date.parse(parsed.value)
  if (!Number.isFinite(timestamp)) return fail('invalid_value', path)
  const date = new Date(timestamp)
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() + 1 !== Number(match[2]) ||
    date.getUTCDate() !== Number(match[3]) ||
    date.getUTCHours() !== Number(match[4]) ||
    date.getUTCMinutes() !== Number(match[5]) ||
    date.getUTCSeconds() !== Number(match[6])
  ) {
    return fail('invalid_value', path)
  }
  return parsed
}

export function arrayAt<T>(
  value: unknown,
  path: string,
  max: number,
  parseItem: (item: unknown, itemPath: string) => ParseResult<T>,
  min = 0,
): ParseResult<T[]> {
  if (!Array.isArray(value)) return fail('invalid_type', path)
  if (value.length < min) return fail('invalid_value', path)
  if (value.length > max) return fail('limit_exceeded', path)
  const parsed: T[] = []
  for (let index = 0; index < value.length; index += 1) {
    const item = parseItem(value[index], pointer(path, index))
    if (!item.ok) return item
    parsed.push(item.value)
  }
  return pass(parsed)
}

export function uniqueStringsAt(
  values: readonly string[],
  pathForIndex: (index: number) => string,
): ParseResult<undefined> {
  const seen = new Set<string>()
  for (let index = 0; index < values.length; index += 1) {
    if (seen.has(values[index])) return fail('duplicate_value', pathForIndex(index))
    seen.add(values[index])
  }
  return pass(undefined)
}

export function jsonUtf8ByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function ratioMatches(numerator: number, denominator: number, ratio: number): boolean {
  if (denominator === 0) return ratio === 1
  return Math.abs(ratio - numerator / denominator) <= 1e-12
}

export function parseSemanticCoverage(
  value: unknown,
  path: string,
): ParseResult<SemanticCoverageV1> {
  const record = hasOnlyKeys(value, path, [
    'projectedGroupCount',
    'eligibleGroupCount',
    'groupCoverage',
    'projectedDistinctEssaySupportSum',
    'eligibleDistinctEssaySupportSum',
    'supportWeightedCoverage',
    'projectedOccurrenceSum',
    'eligibleOccurrenceSum',
    'occurrenceWeightedCoverage',
  ])
  if (!record.ok) return record

  const projectedGroups = safeIntegerAt(
    record.value.projectedGroupCount,
    pointer(path, 'projectedGroupCount'),
  )
  if (!projectedGroups.ok) return projectedGroups
  const eligibleGroups = safeIntegerAt(
    record.value.eligibleGroupCount,
    pointer(path, 'eligibleGroupCount'),
  )
  if (!eligibleGroups.ok) return eligibleGroups
  const groupCoverage = ratioAt(record.value.groupCoverage, pointer(path, 'groupCoverage'))
  if (!groupCoverage.ok) return groupCoverage

  const projectedSupport = safeIntegerAt(
    record.value.projectedDistinctEssaySupportSum,
    pointer(path, 'projectedDistinctEssaySupportSum'),
  )
  if (!projectedSupport.ok) return projectedSupport
  const eligibleSupport = safeIntegerAt(
    record.value.eligibleDistinctEssaySupportSum,
    pointer(path, 'eligibleDistinctEssaySupportSum'),
  )
  if (!eligibleSupport.ok) return eligibleSupport
  const supportCoverage = ratioAt(
    record.value.supportWeightedCoverage,
    pointer(path, 'supportWeightedCoverage'),
  )
  if (!supportCoverage.ok) return supportCoverage

  const projectedOccurrences = safeIntegerAt(
    record.value.projectedOccurrenceSum,
    pointer(path, 'projectedOccurrenceSum'),
  )
  if (!projectedOccurrences.ok) return projectedOccurrences
  const eligibleOccurrences = safeIntegerAt(
    record.value.eligibleOccurrenceSum,
    pointer(path, 'eligibleOccurrenceSum'),
  )
  if (!eligibleOccurrences.ok) return eligibleOccurrences
  const occurrenceCoverage = ratioAt(
    record.value.occurrenceWeightedCoverage,
    pointer(path, 'occurrenceWeightedCoverage'),
  )
  if (!occurrenceCoverage.ok) return occurrenceCoverage

  if (projectedGroups.value > eligibleGroups.value) {
    return fail('invalid_value', pointer(path, 'projectedGroupCount'))
  }
  if (!ratioMatches(projectedGroups.value, eligibleGroups.value, groupCoverage.value)) {
    return fail('invalid_value', pointer(path, 'groupCoverage'))
  }
  if (projectedSupport.value > eligibleSupport.value) {
    return fail('invalid_value', pointer(path, 'projectedDistinctEssaySupportSum'))
  }
  if (!ratioMatches(projectedSupport.value, eligibleSupport.value, supportCoverage.value)) {
    return fail('invalid_value', pointer(path, 'supportWeightedCoverage'))
  }
  if (projectedOccurrences.value > eligibleOccurrences.value) {
    return fail('invalid_value', pointer(path, 'projectedOccurrenceSum'))
  }
  if (
    !ratioMatches(
      projectedOccurrences.value,
      eligibleOccurrences.value,
      occurrenceCoverage.value,
    )
  ) {
    return fail('invalid_value', pointer(path, 'occurrenceWeightedCoverage'))
  }

  return pass({
    projectedGroupCount: projectedGroups.value,
    eligibleGroupCount: eligibleGroups.value,
    groupCoverage: groupCoverage.value,
    projectedDistinctEssaySupportSum: projectedSupport.value,
    eligibleDistinctEssaySupportSum: eligibleSupport.value,
    supportWeightedCoverage: supportCoverage.value,
    projectedOccurrenceSum: projectedOccurrences.value,
    eligibleOccurrenceSum: eligibleOccurrences.value,
    occurrenceWeightedCoverage: occurrenceCoverage.value,
  })
}
