import {
  arrayAt,
  booleanAt,
  codePointLengthAt,
  enumAt,
  fail,
  finiteAt,
  hasOnlyKeys,
  jsonUtf8ByteLength,
  literalAt,
  opaqueAt,
  parseSemanticCoverage,
  pass,
  pointer,
  ratioAt,
  safeIntegerAt,
  stringAt,
  uniqueStringsAt,
  type ClassReviewSynthesisRequestV1,
  type IssueCounterIdV1,
  type Severity,
  type SynthesisDimensionV1,
  type SynthesisGroupV1,
  type SynthesisIssueCounterV1,
  type SynthesisScoreBandV1,
  type SynthesisStatisticsV1,
  type ValidationResult,
} from './types.js'

const ISSUE_COUNTER_IDS: readonly IssueCounterIdV1[] = [
  'grammar',
  'spelling',
  'word_choice',
  'structure',
  'legibility',
  'logic_weak_connection',
  'logic_unclear_logic',
  'logic_missing_cause_effect',
  'logic_unclear_transition',
  'logic_topic_drift',
  'logic_irrelevant_sentence',
  'logic_unclear_reference',
  'logic_missing_motivation',
  'logic_plot_gap',
  'severity_low',
  'severity_medium',
  'severity_high',
  'other',
]
const SEVERITIES: readonly Severity[] = ['low', 'medium', 'high']
const MAX_ISSUE_COUNTERS_V1 = 32

export interface ClassReviewSynthesisRequestValidationLimits {
  maxIssueCounters: number
}

export const DEFAULT_CLASS_REVIEW_SYNTHESIS_REQUEST_VALIDATION_LIMITS:
Readonly<ClassReviewSynthesisRequestValidationLimits> = Object.freeze({
  maxIssueCounters: MAX_ISSUE_COUNTERS_V1,
})

function limitsAreValid(value: ClassReviewSynthesisRequestValidationLimits): boolean {
  return typeof value === 'object'
    && value !== null
    && Object.keys(value).length === 1
    && Object.prototype.hasOwnProperty.call(value, 'maxIssueCounters')
    && Number.isSafeInteger(value.maxIssueCounters)
    && value.maxIssueCounters >= 0
    && value.maxIssueCounters <= MAX_ISSUE_COUNTERS_V1
}

interface EssayCounts {
  includedEssayCount: number
  issueEligibleEssayCount: number
  totalEssayCount: number
}

function parseEssayCounts(
  record: Record<string, unknown>,
  path: string,
): ValidationResult<EssayCounts> {
  const included = safeIntegerAt(record.includedEssayCount, pointer(path, 'includedEssayCount'))
  if (!included.ok) return included
  const issueEligible = safeIntegerAt(record.issueEligibleEssayCount, pointer(path, 'issueEligibleEssayCount'))
  if (!issueEligible.ok) return issueEligible
  const total = safeIntegerAt(record.totalEssayCount, pointer(path, 'totalEssayCount'))
  if (!total.ok) return total
  if (issueEligible.value > included.value) return fail('invalid_value', pointer(path, 'issueEligibleEssayCount'))
  if (included.value > total.value) return fail('invalid_value', pointer(path, 'includedEssayCount'))
  return pass({
    includedEssayCount: included.value,
    issueEligibleEssayCount: issueEligible.value,
    totalEssayCount: total.value,
  })
}

function parseStatistics(
  value: unknown,
  path: string,
  limits: ClassReviewSynthesisRequestValidationLimits,
): ValidationResult<SynthesisStatisticsV1> {
  const record = hasOnlyKeys(value, path, [
    'includedEssayCount',
    'issueEligibleEssayCount',
    'totalEssayCount',
    'excludedEssayCount',
    'score',
    'scoreBands',
    'dimensions',
    'issueCounters',
  ])
  if (!record.ok) return record
  const counts = parseEssayCounts(record.value, path)
  if (!counts.ok) return counts
  const excluded = safeIntegerAt(record.value.excludedEssayCount, pointer(path, 'excludedEssayCount'))
  if (!excluded.ok) return excluded
  if (excluded.value !== counts.value.totalEssayCount - counts.value.includedEssayCount) {
    return fail('invalid_value', pointer(path, 'excludedEssayCount'))
  }

  const scorePath = pointer(path, 'score')
  const scoreRecord = hasOnlyKeys(record.value.score, scorePath, [
    'fullScore',
    'averageScore',
    'medianScore',
    'lowestScore',
    'highestScore',
  ])
  if (!scoreRecord.ok) return scoreRecord
  const fullScore = finiteAt(scoreRecord.value.fullScore, pointer(scorePath, 'fullScore'), true)
  if (!fullScore.ok) return fullScore
  const averageScore = finiteAt(scoreRecord.value.averageScore, pointer(scorePath, 'averageScore'))
  if (!averageScore.ok) return averageScore
  const medianScore = finiteAt(scoreRecord.value.medianScore, pointer(scorePath, 'medianScore'))
  if (!medianScore.ok) return medianScore
  const lowestScore = finiteAt(scoreRecord.value.lowestScore, pointer(scorePath, 'lowestScore'))
  if (!lowestScore.ok) return lowestScore
  const highestScore = finiteAt(scoreRecord.value.highestScore, pointer(scorePath, 'highestScore'))
  if (!highestScore.ok) return highestScore
  for (const [score, scoreValuePath] of [
    [averageScore.value, pointer(scorePath, 'averageScore')],
    [medianScore.value, pointer(scorePath, 'medianScore')],
    [lowestScore.value, pointer(scorePath, 'lowestScore')],
    [highestScore.value, pointer(scorePath, 'highestScore')],
  ] satisfies Array<[number, string]>) {
    if (score < 0 || score > fullScore.value) return fail('invalid_value', scoreValuePath)
  }
  if (lowestScore.value > averageScore.value || lowestScore.value > medianScore.value) {
    return fail('invalid_value', pointer(scorePath, 'lowestScore'))
  }
  if (averageScore.value > highestScore.value || medianScore.value > highestScore.value) {
    return fail('invalid_value', pointer(scorePath, 'highestScore'))
  }
  const score = {
    fullScore: fullScore.value,
    averageScore: averageScore.value,
    medianScore: medianScore.value,
    lowestScore: lowestScore.value,
    highestScore: highestScore.value,
  }

  const bandsPath = pointer(path, 'scoreBands')
  const scoreBands = arrayAt<SynthesisScoreBandV1>(record.value.scoreBands, bandsPath, 20, (item, itemPath) => {
    const band = hasOnlyKeys(item, itemPath, ['bandId', 'lowerInclusive', 'upperInclusive', 'essayCount'])
    if (!band.ok) return band
    const bandId = opaqueAt(band.value.bandId, pointer(itemPath, 'bandId'))
    if (!bandId.ok) return bandId
    const lower = finiteAt(band.value.lowerInclusive, pointer(itemPath, 'lowerInclusive'))
    if (!lower.ok) return lower
    const upper = finiteAt(band.value.upperInclusive, pointer(itemPath, 'upperInclusive'))
    if (!upper.ok) return upper
    const essayCount = safeIntegerAt(band.value.essayCount, pointer(itemPath, 'essayCount'))
    if (!essayCount.ok) return essayCount
    if (lower.value < 0 || lower.value > fullScore.value) return fail('invalid_value', pointer(itemPath, 'lowerInclusive'))
    if (upper.value < lower.value || upper.value > fullScore.value) return fail('invalid_value', pointer(itemPath, 'upperInclusive'))
    return pass({ bandId: bandId.value, lowerInclusive: lower.value, upperInclusive: upper.value, essayCount: essayCount.value })
  })
  if (!scoreBands.ok) return scoreBands
  const uniqueBands = uniqueStringsAt(scoreBands.value.map(({ bandId }) => bandId), (index) => `${bandsPath}/${index}/bandId`)
  if (!uniqueBands.ok) return uniqueBands

  const dimensionsPath = pointer(path, 'dimensions')
  const dimensions = arrayAt<SynthesisDimensionV1>(record.value.dimensions, dimensionsPath, 10, (item, itemPath) => {
    const dimension = hasOnlyKeys(item, itemPath, [
      'dimensionId',
      'label',
      'averageScore',
      'medianScore',
      'maxScore',
      'normalizedPerformance',
    ])
    if (!dimension.ok) return dimension
    const dimensionId = opaqueAt(dimension.value.dimensionId, pointer(itemPath, 'dimensionId'))
    if (!dimensionId.ok) return dimensionId
    const label = stringAt(dimension.value.label, pointer(itemPath, 'label'), 120)
    if (!label.ok) return label
    const average = finiteAt(dimension.value.averageScore, pointer(itemPath, 'averageScore'))
    if (!average.ok) return average
    const median = finiteAt(dimension.value.medianScore, pointer(itemPath, 'medianScore'))
    if (!median.ok) return median
    const maximum = finiteAt(dimension.value.maxScore, pointer(itemPath, 'maxScore'), true)
    if (!maximum.ok) return maximum
    if (average.value < 0 || average.value > maximum.value) return fail('invalid_value', pointer(itemPath, 'averageScore'))
    if (median.value < 0 || median.value > maximum.value) return fail('invalid_value', pointer(itemPath, 'medianScore'))
    const normalized = ratioAt(dimension.value.normalizedPerformance, pointer(itemPath, 'normalizedPerformance'))
    if (!normalized.ok) return normalized
    return pass({
      dimensionId: dimensionId.value,
      label: label.value,
      averageScore: average.value,
      medianScore: median.value,
      maxScore: maximum.value,
      normalizedPerformance: normalized.value,
    })
  })
  if (!dimensions.ok) return dimensions
  const uniqueDimensions = uniqueStringsAt(dimensions.value.map(({ dimensionId }) => dimensionId), (index) => `${dimensionsPath}/${index}/dimensionId`)
  if (!uniqueDimensions.ok) return uniqueDimensions

  const countersPath = pointer(path, 'issueCounters')
  const issueCounters = arrayAt(
    record.value.issueCounters,
    countersPath,
    limits.maxIssueCounters,
    (item, itemPath): ValidationResult<SynthesisIssueCounterV1> => {
      const counter = hasOnlyKeys(item, itemPath, ['counterId', 'count'])
      if (!counter.ok) return counter
      const counterId = enumAt(counter.value.counterId, pointer(itemPath, 'counterId'), ISSUE_COUNTER_IDS)
      if (!counterId.ok) return counterId
      const count = safeIntegerAt(counter.value.count, pointer(itemPath, 'count'))
      if (!count.ok) return count
      return pass({ counterId: counterId.value, count: count.value })
    },
  )
  if (!issueCounters.ok) return issueCounters
  const uniqueCounters = uniqueStringsAt(issueCounters.value.map(({ counterId }) => counterId), (index) => `${countersPath}/${index}/counterId`)
  if (!uniqueCounters.ok) return uniqueCounters

  return pass({
    ...counts.value,
    excludedEssayCount: excluded.value,
    score,
    scoreBands: scoreBands.value,
    dimensions: dimensions.value,
    issueCounters: issueCounters.value,
  })
}

function parseGroup(
  value: unknown,
  path: string,
  issueEligibleEssayCount: number,
): ValidationResult<SynthesisGroupV1> {
  const record = hasOnlyKeys(value, path, [
    'groupId',
    'type',
    'subtype',
    'severity',
    'title',
    'mustCover',
    'distinctEssaySupport',
    'occurrenceCount',
    'excerpt',
  ])
  if (!record.ok) return record
  const groupId = opaqueAt(record.value.groupId, pointer(path, 'groupId'))
  if (!groupId.ok) return groupId
  const type = enumAt(record.value.type, pointer(path, 'type'), [
    'grammar', 'spelling', 'word_choice', 'structure', 'logic', 'legibility',
  ] as const)
  if (!type.ok) return type
  let subtype: SynthesisGroupV1['subtype']
  if (record.value.subtype === null) subtype = null
  else {
    const parsed = enumAt(record.value.subtype, pointer(path, 'subtype'), [
      'weak_connection',
      'unclear_logic',
      'missing_cause_effect',
      'unclear_transition',
      'topic_drift',
      'irrelevant_sentence',
      'unclear_reference',
      'missing_motivation',
      'plot_gap',
    ] as const)
    if (!parsed.ok) return parsed
    subtype = parsed.value
  }
  if ((type.value === 'logic') !== (subtype !== null)) return fail('invalid_value', pointer(path, 'subtype'))
  const severity = enumAt(record.value.severity, pointer(path, 'severity'), SEVERITIES)
  if (!severity.ok) return severity
  const title = stringAt(record.value.title, pointer(path, 'title'), 48)
  if (!title.ok) return title
  const mustCover = booleanAt(record.value.mustCover, pointer(path, 'mustCover'))
  if (!mustCover.ok) return mustCover
  const distinctSupport = safeIntegerAt(record.value.distinctEssaySupport, pointer(path, 'distinctEssaySupport'))
  if (!distinctSupport.ok) return distinctSupport
  if (distinctSupport.value > issueEligibleEssayCount) return fail('invalid_value', pointer(path, 'distinctEssaySupport'))
  const occurrenceCount = safeIntegerAt(record.value.occurrenceCount, pointer(path, 'occurrenceCount'))
  if (!occurrenceCount.ok) return occurrenceCount

  let excerpt: SynthesisGroupV1['excerpt']
  if (record.value.excerpt === null) excerpt = null
  else {
    const excerptPath = pointer(path, 'excerpt')
    const excerptRecord = hasOnlyKeys(record.value.excerpt, excerptPath, ['originalText', 'suggestionOrDiagnosis'])
    if (!excerptRecord.ok) return excerptRecord
    const original = stringAt(excerptRecord.value.originalText, pointer(excerptPath, 'originalText'), 160)
    if (!original.ok) return original
    const suggestion = stringAt(excerptRecord.value.suggestionOrDiagnosis, pointer(excerptPath, 'suggestionOrDiagnosis'), 160)
    if (!suggestion.ok) return suggestion
    excerpt = { originalText: original.value, suggestionOrDiagnosis: suggestion.value }
  }

  const titleLength = codePointLengthAt(title.value, pointer(path, 'title'), 360)
  if (!titleLength.ok) return titleLength
  let visibleCodePoints = titleLength.value
  if (excerpt !== null) {
    const originalLength = codePointLengthAt(excerpt.originalText, pointer(pointer(path, 'excerpt'), 'originalText'), 360)
    if (!originalLength.ok) return originalLength
    const suggestionLength = codePointLengthAt(excerpt.suggestionOrDiagnosis, pointer(pointer(path, 'excerpt'), 'suggestionOrDiagnosis'), 360)
    if (!suggestionLength.ok) return suggestionLength
    visibleCodePoints += originalLength.value + suggestionLength.value
  }
  if (visibleCodePoints > 360) return fail('limit_exceeded', path)
  return pass({
    groupId: groupId.value,
    type: type.value,
    subtype,
    severity: severity.value,
    title: title.value,
    mustCover: mustCover.value,
    distinctEssaySupport: distinctSupport.value,
    occurrenceCount: occurrenceCount.value,
    excerpt,
  })
}

export function validateClassReviewSynthesisRequest(
  value: unknown,
  limits: ClassReviewSynthesisRequestValidationLimits = DEFAULT_CLASS_REVIEW_SYNTHESIS_REQUEST_VALIDATION_LIMITS,
): ValidationResult<ClassReviewSynthesisRequestV1> {
  if (!limitsAreValid(limits)) return fail('invalid_value', '/limits/maxIssueCounters')
  const record = hasOnlyKeys(value, '', [
    'contractVersion',
    'requestId',
    'rubricRevisionDigest',
    'policyVersion',
    'schemaVersion',
    'projectionVersion',
    'budgetVersion',
    'statistics',
    'groups',
    'semanticCoverage',
    'outputLimits',
  ])
  if (!record.ok) return record
  const contractVersion = literalAt(record.value.contractVersion, '/contractVersion', 'class-review-synthesis-request-v1')
  if (!contractVersion.ok) return contractVersion
  const requestId = opaqueAt(record.value.requestId, '/requestId')
  if (!requestId.ok) return requestId
  const digest = stringAt(record.value.rubricRevisionDigest, '/rubricRevisionDigest', 43)
  if (!digest.ok) return digest
  if (!/^[A-Za-z0-9_-]{43}$/.test(digest.value)) return fail('invalid_value', '/rubricRevisionDigest')
  const policyVersion = literalAt(record.value.policyVersion, '/policyVersion', 'class-review-policy-v1')
  if (!policyVersion.ok) return policyVersion
  const schemaVersion = literalAt(record.value.schemaVersion, '/schemaVersion', 'kimi-class-review-output-v1')
  if (!schemaVersion.ok) return schemaVersion
  const projectionVersion = literalAt(record.value.projectionVersion, '/projectionVersion', 'class-review-projection-v1')
  if (!projectionVersion.ok) return projectionVersion
  const budgetVersion = literalAt(record.value.budgetVersion, '/budgetVersion', 'class-review-prompt-budget-v1')
  if (!budgetVersion.ok) return budgetVersion

  const statistics = parseStatistics(record.value.statistics, '/statistics', limits)
  if (!statistics.ok) return statistics
  if (jsonUtf8ByteLength(statistics.value) > 8 * 1024) return fail('limit_exceeded', '/statistics')
  const groups = arrayAt(record.value.groups, '/groups', 64, (item, path) =>
    parseGroup(item, path, statistics.value.issueEligibleEssayCount),
  )
  if (!groups.ok) return groups
  const uniqueGroups = uniqueStringsAt(groups.value.map(({ groupId }) => groupId), (index) => `/groups/${index}/groupId`)
  if (!uniqueGroups.ok) return uniqueGroups
  if (jsonUtf8ByteLength(groups.value) > 32 * 1024) return fail('limit_exceeded', '/groups')
  const semanticCoverage = parseSemanticCoverage(record.value.semanticCoverage, '/semanticCoverage')
  if (!semanticCoverage.ok) return semanticCoverage

  const outputLimits = hasOnlyKeys(record.value.outputLimits, '/outputLimits', [
    'maxCompletionTokens', 'maxVisibleCodePoints', 'maxJsonUtf8Bytes',
  ])
  if (!outputLimits.ok) return outputLimits
  const maxCompletionTokens = safeIntegerAt(outputLimits.value.maxCompletionTokens, '/outputLimits/maxCompletionTokens')
  if (!maxCompletionTokens.ok) return maxCompletionTokens
  if (maxCompletionTokens.value !== 3072) return fail('invalid_value', '/outputLimits/maxCompletionTokens')
  const maxVisibleCodePoints = safeIntegerAt(outputLimits.value.maxVisibleCodePoints, '/outputLimits/maxVisibleCodePoints')
  if (!maxVisibleCodePoints.ok) return maxVisibleCodePoints
  if (maxVisibleCodePoints.value !== 2200) return fail('invalid_value', '/outputLimits/maxVisibleCodePoints')
  const maxJsonUtf8Bytes = safeIntegerAt(outputLimits.value.maxJsonUtf8Bytes, '/outputLimits/maxJsonUtf8Bytes')
  if (!maxJsonUtf8Bytes.ok) return maxJsonUtf8Bytes
  if (maxJsonUtf8Bytes.value !== 16384) return fail('invalid_value', '/outputLimits/maxJsonUtf8Bytes')

  return pass({
    contractVersion: 'class-review-synthesis-request-v1',
    requestId: requestId.value,
    rubricRevisionDigest: digest.value,
    policyVersion: 'class-review-policy-v1',
    schemaVersion: 'kimi-class-review-output-v1',
    projectionVersion: 'class-review-projection-v1',
    budgetVersion: 'class-review-prompt-budget-v1',
    statistics: statistics.value,
    groups: groups.value,
    semanticCoverage: semanticCoverage.value,
    outputLimits: { maxCompletionTokens: 3072, maxVisibleCodePoints: 2200, maxJsonUtf8Bytes: 16384 },
  })
}
