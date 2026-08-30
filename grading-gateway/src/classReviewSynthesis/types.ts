export type Severity = 'low' | 'medium' | 'high'

export type ContractValidationErrorCode =
  | 'not_object'
  | 'missing_key'
  | 'unknown_key'
  | 'invalid_type'
  | 'invalid_value'
  | 'limit_exceeded'
  | 'duplicate_value'
  | 'unknown_reference'

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: ContractValidationErrorCode; path: string } }

export interface SemanticCoverageV1 {
  projectedGroupCount: number
  eligibleGroupCount: number
  groupCoverage: number
  projectedDistinctEssaySupportSum: number
  eligibleDistinctEssaySupportSum: number
  supportWeightedCoverage: number
  projectedOccurrenceSum: number
  eligibleOccurrenceSum: number
  occurrenceWeightedCoverage: number
}

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
  bandId: string
  lowerInclusive: number
  upperInclusive: number
  essayCount: number
}

export interface SynthesisDimensionV1 {
  dimensionId: string
  label: string
  averageScore: number
  medianScore: number
  maxScore: number
  normalizedPerformance: number
}

export interface SynthesisIssueCounterV1 {
  counterId: IssueCounterIdV1
  count: number
}

export interface SynthesisStatisticsV1 {
  includedEssayCount: number
  issueEligibleEssayCount: number
  totalEssayCount: number
  excludedEssayCount: number
  score: SynthesisScoreV1
  scoreBands: SynthesisScoreBandV1[]
  dimensions: SynthesisDimensionV1[]
  issueCounters: SynthesisIssueCounterV1[]
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

export interface SynthesisGroupV1 {
  groupId: string
  type: SynthesisGroupTypeV1
  subtype: SynthesisLogicSubtypeV1 | null
  severity: Severity
  title: string
  mustCover: boolean
  distinctEssaySupport: number
  occurrenceCount: number
  excerpt: {
    originalText: string
    suggestionOrDiagnosis: string
  } | null
}

export interface ClassReviewSynthesisRequestV1 {
  contractVersion: 'class-review-synthesis-request-v1'
  requestId: string
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

export interface ClassReviewProviderOutputV1 {
  overallComment: string
  strengths: Array<{
    title: string
    detail: string
    dimensionIds: string[]
  }>
  patterns: Array<{
    groupIds: string[]
    title: string
    diagnosis: string
    teachingAction: string
    severity: Severity
  }>
  learningRecommendations: Array<{
    title: string
    action: string
  }>
}

export function fail<T>(
  code: ContractValidationErrorCode,
  path: string,
): ValidationResult<T> {
  return { ok: false, error: { code, path } }
}

export function pass<T>(value: T): ValidationResult<T> {
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
): ValidationResult<Record<string, unknown>> {
  if (!isRecord(value)) return fail('not_object', path)
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      return fail('missing_key', pointer(path, key))
    }
  }
  const allowed = new Set([...required, ...optional])
  const unknown = Object.keys(value).filter((key) => !allowed.has(key)).sort()
  return unknown.length > 0 ? fail('unknown_key', pointer(path, unknown[0])) : pass(value)
}

type CodePointScan =
  | { status: 'ok'; length: number }
  | { status: 'malformed'; length: number }
  | { status: 'too_long'; length: number }

function scanCodePoints(value: string, maximum: number): CodePointScan {
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
    if (length > maximum) return { status: 'too_long', length }
  }
  return { status: 'ok', length }
}

export function codePointLengthAt(
  value: string,
  path: string,
  maximum: number,
): ValidationResult<number> {
  const scan = scanCodePoints(value, maximum)
  if (scan.status === 'malformed') return fail('invalid_value', path)
  if (scan.status === 'too_long') return fail('limit_exceeded', path)
  return pass(scan.length)
}

export function stringAt(
  value: unknown,
  path: string,
  maximum: number,
  required = true,
): ValidationResult<string> {
  if (typeof value !== 'string') return fail('invalid_type', path)
  const length = codePointLengthAt(value, path, maximum)
  if (!length.ok) return length
  if (required && length.value === 0) return fail('invalid_value', path)
  return pass(value)
}

export function booleanAt(value: unknown, path: string): ValidationResult<boolean> {
  return typeof value === 'boolean' ? pass(value) : fail('invalid_type', path)
}

export function safeIntegerAt(value: unknown, path: string): ValidationResult<number> {
  if (typeof value !== 'number') return fail('invalid_type', path)
  return Number.isSafeInteger(value) && value >= 0 ? pass(value) : fail('invalid_value', path)
}

export function finiteAt(
  value: unknown,
  path: string,
  positive = false,
): ValidationResult<number> {
  if (typeof value !== 'number') return fail('invalid_type', path)
  return Number.isFinite(value) && (!positive || value > 0)
    ? pass(value)
    : fail('invalid_value', path)
}

export function ratioAt(value: unknown, path: string): ValidationResult<number> {
  const parsed = finiteAt(value, path)
  if (!parsed.ok) return parsed
  return parsed.value >= 0 && parsed.value <= 1 ? parsed : fail('invalid_value', path)
}

export function enumAt<T extends string>(
  value: unknown,
  path: string,
  choices: readonly T[],
): ValidationResult<T> {
  if (typeof value !== 'string') return fail('invalid_type', path)
  return choices.includes(value as T) ? pass(value as T) : fail('invalid_value', path)
}

export function literalAt<T extends string>(
  value: unknown,
  path: string,
  expected: T,
): ValidationResult<T> {
  if (typeof value !== 'string') return fail('invalid_type', path)
  return value === expected ? pass(expected) : fail('invalid_value', path)
}

export function opaqueAt(value: unknown, path: string): ValidationResult<string> {
  const parsed = stringAt(value, path, 128)
  if (!parsed.ok) return parsed
  return /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(parsed.value)
    ? parsed
    : fail('invalid_value', path)
}

export function arrayAt<T>(
  value: unknown,
  path: string,
  maximum: number,
  parseItem: (item: unknown, itemPath: string) => ValidationResult<T>,
  minimum = 0,
): ValidationResult<T[]> {
  if (!Array.isArray(value)) return fail('invalid_type', path)
  if (value.length < minimum) return fail('invalid_value', path)
  if (value.length > maximum) return fail('limit_exceeded', path)
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
): ValidationResult<undefined> {
  const seen = new Set<string>()
  for (let index = 0; index < values.length; index += 1) {
    if (seen.has(values[index])) return fail('duplicate_value', pathForIndex(index))
    seen.add(values[index])
  }
  return pass(undefined)
}

export function jsonUtf8ByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function ratioMatches(numerator: number, denominator: number, ratio: number): boolean {
  return denominator === 0
    ? ratio === 1
    : Math.abs(ratio - numerator / denominator) <= 1e-12
}

export function parseSemanticCoverage(
  value: unknown,
  path: string,
): ValidationResult<SemanticCoverageV1> {
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
  const projectedGroups = safeIntegerAt(record.value.projectedGroupCount, pointer(path, 'projectedGroupCount'))
  if (!projectedGroups.ok) return projectedGroups
  const eligibleGroups = safeIntegerAt(record.value.eligibleGroupCount, pointer(path, 'eligibleGroupCount'))
  if (!eligibleGroups.ok) return eligibleGroups
  const groupCoverage = ratioAt(record.value.groupCoverage, pointer(path, 'groupCoverage'))
  if (!groupCoverage.ok) return groupCoverage
  const projectedSupport = safeIntegerAt(record.value.projectedDistinctEssaySupportSum, pointer(path, 'projectedDistinctEssaySupportSum'))
  if (!projectedSupport.ok) return projectedSupport
  const eligibleSupport = safeIntegerAt(record.value.eligibleDistinctEssaySupportSum, pointer(path, 'eligibleDistinctEssaySupportSum'))
  if (!eligibleSupport.ok) return eligibleSupport
  const supportCoverage = ratioAt(record.value.supportWeightedCoverage, pointer(path, 'supportWeightedCoverage'))
  if (!supportCoverage.ok) return supportCoverage
  const projectedOccurrences = safeIntegerAt(record.value.projectedOccurrenceSum, pointer(path, 'projectedOccurrenceSum'))
  if (!projectedOccurrences.ok) return projectedOccurrences
  const eligibleOccurrences = safeIntegerAt(record.value.eligibleOccurrenceSum, pointer(path, 'eligibleOccurrenceSum'))
  if (!eligibleOccurrences.ok) return eligibleOccurrences
  const occurrenceCoverage = ratioAt(record.value.occurrenceWeightedCoverage, pointer(path, 'occurrenceWeightedCoverage'))
  if (!occurrenceCoverage.ok) return occurrenceCoverage

  if (projectedGroups.value > eligibleGroups.value) return fail('invalid_value', pointer(path, 'projectedGroupCount'))
  if (!ratioMatches(projectedGroups.value, eligibleGroups.value, groupCoverage.value)) return fail('invalid_value', pointer(path, 'groupCoverage'))
  if (projectedSupport.value > eligibleSupport.value) return fail('invalid_value', pointer(path, 'projectedDistinctEssaySupportSum'))
  if (!ratioMatches(projectedSupport.value, eligibleSupport.value, supportCoverage.value)) return fail('invalid_value', pointer(path, 'supportWeightedCoverage'))
  if (projectedOccurrences.value > eligibleOccurrences.value) return fail('invalid_value', pointer(path, 'projectedOccurrenceSum'))
  if (!ratioMatches(projectedOccurrences.value, eligibleOccurrences.value, occurrenceCoverage.value)) return fail('invalid_value', pointer(path, 'occurrenceWeightedCoverage'))

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
