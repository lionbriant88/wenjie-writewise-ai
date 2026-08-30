import {
  arrayAt,
  booleanAt,
  codePointLengthAt,
  enumAt,
  fail,
  finiteAt,
  hasOnlyKeys,
  jsonUtf8ByteLength,
  opaqueAt,
  parseSemanticCoverage,
  pass,
  pointer,
  ratioAt,
  safeIntegerAt,
  stringAt,
  uniqueStringsAt,
  type ClassReviewProviderOutputV1,
  type ClassReviewSynthesisRequestV1,
  type ClassReviewSynthesisResultV1,
  type IssueCounterIdV1,
  type ParseResult,
  type ProviderUsageV1,
  type SafeFailureCode,
  type SafeFinishReasonV1,
  type Severity,
  type SynthesisGroupV1,
  type SynthesisIssueCounterV1,
  type SynthesisStatisticsV1,
  type SynthesisTimingsV1,
} from './types'

const SAFE_FAILURE_CODES: readonly SafeFailureCode[] = [
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
  'provider_auth_failed',
  'provider_balance_unavailable',
  'provider_rate_limited',
  'provider_timeout',
  'provider_result_unknown',
  'provider_unavailable',
  'provider_content_filtered',
  'provider_unexpected_tool_call',
  'provider_invalid_response',
]

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
const FINISH_REASONS: readonly SafeFinishReasonV1[] = [
  'stop',
  'length',
  'content_filter',
  'tool_calls',
  'unknown',
]

interface EssayCounts {
  includedEssayCount: number
  issueEligibleEssayCount: number
  totalEssayCount: number
}

function parseEssayCounts(
  record: Record<string, unknown>,
  path: string,
): ParseResult<EssayCounts> {
  const includedEssayCount = safeIntegerAt(
    record.includedEssayCount,
    pointer(path, 'includedEssayCount'),
  )
  if (!includedEssayCount.ok) return includedEssayCount
  const issueEligibleEssayCount = safeIntegerAt(
    record.issueEligibleEssayCount,
    pointer(path, 'issueEligibleEssayCount'),
  )
  if (!issueEligibleEssayCount.ok) return issueEligibleEssayCount
  const totalEssayCount = safeIntegerAt(
    record.totalEssayCount,
    pointer(path, 'totalEssayCount'),
  )
  if (!totalEssayCount.ok) return totalEssayCount
  if (issueEligibleEssayCount.value > includedEssayCount.value) {
    return fail('invalid_value', pointer(path, 'issueEligibleEssayCount'))
  }
  if (includedEssayCount.value > totalEssayCount.value) {
    return fail('invalid_value', pointer(path, 'includedEssayCount'))
  }
  return pass({
    includedEssayCount: includedEssayCount.value,
    issueEligibleEssayCount: issueEligibleEssayCount.value,
    totalEssayCount: totalEssayCount.value,
  })
}

function parseSynthesisStatistics(
  value: unknown,
  path: string,
): ParseResult<SynthesisStatisticsV1> {
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
  const excludedEssayCount = safeIntegerAt(
    record.value.excludedEssayCount,
    pointer(path, 'excludedEssayCount'),
  )
  if (!excludedEssayCount.ok) return excludedEssayCount
  if (
    excludedEssayCount.value !==
    counts.value.totalEssayCount - counts.value.includedEssayCount
  ) {
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
  const averageScore = finiteAt(
    scoreRecord.value.averageScore,
    pointer(scorePath, 'averageScore'),
  )
  if (!averageScore.ok) return averageScore
  const medianScore = finiteAt(
    scoreRecord.value.medianScore,
    pointer(scorePath, 'medianScore'),
  )
  if (!medianScore.ok) return medianScore
  const lowestScore = finiteAt(
    scoreRecord.value.lowestScore,
    pointer(scorePath, 'lowestScore'),
  )
  if (!lowestScore.ok) return lowestScore
  const highestScore = finiteAt(
    scoreRecord.value.highestScore,
    pointer(scorePath, 'highestScore'),
  )
  if (!highestScore.ok) return highestScore
  for (const [score, scorePathForValue] of [
    [averageScore.value, pointer(scorePath, 'averageScore')],
    [medianScore.value, pointer(scorePath, 'medianScore')],
    [lowestScore.value, pointer(scorePath, 'lowestScore')],
    [highestScore.value, pointer(scorePath, 'highestScore')],
  ] satisfies Array<[number, string]>) {
    if (score < 0 || score > fullScore.value) {
      return fail('invalid_value', scorePathForValue)
    }
  }
  if (lowestScore.value > averageScore.value) {
    return fail('invalid_value', pointer(scorePath, 'lowestScore'))
  }
  if (lowestScore.value > medianScore.value) {
    return fail('invalid_value', pointer(scorePath, 'lowestScore'))
  }
  if (averageScore.value > highestScore.value) {
    return fail('invalid_value', pointer(scorePath, 'highestScore'))
  }
  if (medianScore.value > highestScore.value) {
    return fail('invalid_value', pointer(scorePath, 'highestScore'))
  }
  const score = {
    fullScore: fullScore.value,
    averageScore: averageScore.value,
    medianScore: medianScore.value,
    lowestScore: lowestScore.value,
    highestScore: highestScore.value,
  }

  const scoreBandsPath = pointer(path, 'scoreBands')
  const scoreBands = arrayAt(record.value.scoreBands, scoreBandsPath, 20, (item, itemPath) => {
    const band = hasOnlyKeys(item, itemPath, [
      'bandId',
      'lowerInclusive',
      'upperInclusive',
      'essayCount',
    ])
    if (!band.ok) return band
    const bandId = opaqueAt(band.value.bandId, pointer(itemPath, 'bandId'))
    if (!bandId.ok) return bandId
    const lowerInclusive = finiteAt(
      band.value.lowerInclusive,
      pointer(itemPath, 'lowerInclusive'),
    )
    if (!lowerInclusive.ok) return lowerInclusive
    const upperInclusive = finiteAt(
      band.value.upperInclusive,
      pointer(itemPath, 'upperInclusive'),
    )
    if (!upperInclusive.ok) return upperInclusive
    const essayCount = safeIntegerAt(band.value.essayCount, pointer(itemPath, 'essayCount'))
    if (!essayCount.ok) return essayCount
    if (lowerInclusive.value < 0 || lowerInclusive.value > fullScore.value) {
      return fail('invalid_value', pointer(itemPath, 'lowerInclusive'))
    }
    if (
      upperInclusive.value < lowerInclusive.value ||
      upperInclusive.value > fullScore.value
    ) {
      return fail('invalid_value', pointer(itemPath, 'upperInclusive'))
    }
    return pass({
      bandId: bandId.value,
      lowerInclusive: lowerInclusive.value,
      upperInclusive: upperInclusive.value,
      essayCount: essayCount.value,
    })
  })
  if (!scoreBands.ok) return scoreBands
  const uniqueBandIds = uniqueStringsAt(
    scoreBands.value.map((band) => band.bandId),
    (index) => `${scoreBandsPath}/${index}/bandId`,
  )
  if (!uniqueBandIds.ok) return uniqueBandIds

  const dimensionsPath = pointer(path, 'dimensions')
  const dimensions = arrayAt(record.value.dimensions, dimensionsPath, 10, (item, itemPath) => {
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
    const dimensionAverage = finiteAt(
      dimension.value.averageScore,
      pointer(itemPath, 'averageScore'),
    )
    if (!dimensionAverage.ok) return dimensionAverage
    const dimensionMedian = finiteAt(
      dimension.value.medianScore,
      pointer(itemPath, 'medianScore'),
    )
    if (!dimensionMedian.ok) return dimensionMedian
    const maxScore = finiteAt(dimension.value.maxScore, pointer(itemPath, 'maxScore'), true)
    if (!maxScore.ok) return maxScore
    if (dimensionAverage.value < 0 || dimensionAverage.value > maxScore.value) {
      return fail('invalid_value', pointer(itemPath, 'averageScore'))
    }
    if (dimensionMedian.value < 0 || dimensionMedian.value > maxScore.value) {
      return fail('invalid_value', pointer(itemPath, 'medianScore'))
    }
    const normalizedPerformance = ratioAt(
      dimension.value.normalizedPerformance,
      pointer(itemPath, 'normalizedPerformance'),
    )
    if (!normalizedPerformance.ok) return normalizedPerformance
    return pass({
      dimensionId: dimensionId.value,
      label: label.value,
      averageScore: dimensionAverage.value,
      medianScore: dimensionMedian.value,
      maxScore: maxScore.value,
      normalizedPerformance: normalizedPerformance.value,
    })
  })
  if (!dimensions.ok) return dimensions
  const uniqueDimensionIds = uniqueStringsAt(
    dimensions.value.map((dimension) => dimension.dimensionId),
    (index) => `${dimensionsPath}/${index}/dimensionId`,
  )
  if (!uniqueDimensionIds.ok) return uniqueDimensionIds

  const countersPath = pointer(path, 'issueCounters')
  const issueCounters = arrayAt(
    record.value.issueCounters,
    countersPath,
    32,
    (item, itemPath): ParseResult<SynthesisIssueCounterV1> => {
      const counter = hasOnlyKeys(item, itemPath, ['counterId', 'count'])
      if (!counter.ok) return counter
      const counterId = enumAt(
        counter.value.counterId,
        pointer(itemPath, 'counterId'),
        ISSUE_COUNTER_IDS,
      )
      if (!counterId.ok) return counterId
      const count = safeIntegerAt(counter.value.count, pointer(itemPath, 'count'))
      if (!count.ok) return count
      return pass({ counterId: counterId.value, count: count.value })
    },
  )
  if (!issueCounters.ok) return issueCounters
  const uniqueCounterIds = uniqueStringsAt(
    issueCounters.value.map((counter) => counter.counterId),
    (index) => `${countersPath}/${index}/counterId`,
  )
  if (!uniqueCounterIds.ok) return uniqueCounterIds

  return pass({
    ...counts.value,
    excludedEssayCount: excludedEssayCount.value,
    score,
    scoreBands: scoreBands.value,
    dimensions: dimensions.value,
    issueCounters: issueCounters.value,
  })
}

function parseSynthesisGroup(
  value: unknown,
  path: string,
  issueEligibleEssayCount: number,
): ParseResult<SynthesisGroupV1> {
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
    'grammar',
    'spelling',
    'word_choice',
    'structure',
    'logic',
    'legibility',
  ])
  if (!type.ok) return type
  let subtype: SynthesisGroupV1['subtype']
  if (record.value.subtype === null) subtype = null
  else {
    const parsedSubtype = enumAt(record.value.subtype, pointer(path, 'subtype'), [
      'weak_connection',
      'unclear_logic',
      'missing_cause_effect',
      'unclear_transition',
      'topic_drift',
      'irrelevant_sentence',
      'unclear_reference',
      'missing_motivation',
      'plot_gap',
    ])
    if (!parsedSubtype.ok) return parsedSubtype
    subtype = parsedSubtype.value
  }
  if ((type.value === 'logic') !== (subtype !== null)) {
    return fail('invalid_value', pointer(path, 'subtype'))
  }
  const severity = enumAt(record.value.severity, pointer(path, 'severity'), SEVERITIES)
  if (!severity.ok) return severity
  const title = stringAt(record.value.title, pointer(path, 'title'), 48)
  if (!title.ok) return title
  const mustCover = booleanAt(record.value.mustCover, pointer(path, 'mustCover'))
  if (!mustCover.ok) return mustCover
  const distinctEssaySupport = safeIntegerAt(
    record.value.distinctEssaySupport,
    pointer(path, 'distinctEssaySupport'),
  )
  if (!distinctEssaySupport.ok) return distinctEssaySupport
  if (distinctEssaySupport.value > issueEligibleEssayCount) {
    return fail('invalid_value', pointer(path, 'distinctEssaySupport'))
  }
  const occurrenceCount = safeIntegerAt(
    record.value.occurrenceCount,
    pointer(path, 'occurrenceCount'),
  )
  if (!occurrenceCount.ok) return occurrenceCount

  let excerpt: SynthesisGroupV1['excerpt']
  if (record.value.excerpt === null) excerpt = null
  else {
    const excerptPath = pointer(path, 'excerpt')
    const excerptRecord = hasOnlyKeys(record.value.excerpt, excerptPath, [
      'originalText',
      'suggestionOrDiagnosis',
    ])
    if (!excerptRecord.ok) return excerptRecord
    const originalText = stringAt(
      excerptRecord.value.originalText,
      pointer(excerptPath, 'originalText'),
      160,
    )
    if (!originalText.ok) return originalText
    const suggestionOrDiagnosis = stringAt(
      excerptRecord.value.suggestionOrDiagnosis,
      pointer(excerptPath, 'suggestionOrDiagnosis'),
      160,
    )
    if (!suggestionOrDiagnosis.ok) return suggestionOrDiagnosis
    excerpt = {
      originalText: originalText.value,
      suggestionOrDiagnosis: suggestionOrDiagnosis.value,
    }
  }

  const titleLength = codePointLengthAt(title.value, pointer(path, 'title'), 360)
  if (!titleLength.ok) return titleLength
  let visibleCodePoints = titleLength.value
  if (excerpt !== null) {
    const originalLength = codePointLengthAt(
      excerpt.originalText,
      pointer(pointer(path, 'excerpt'), 'originalText'),
      360,
    )
    if (!originalLength.ok) return originalLength
    const guidanceLength = codePointLengthAt(
      excerpt.suggestionOrDiagnosis,
      pointer(pointer(path, 'excerpt'), 'suggestionOrDiagnosis'),
      360,
    )
    if (!guidanceLength.ok) return guidanceLength
    visibleCodePoints += originalLength.value + guidanceLength.value
  }
  if (visibleCodePoints > 360) return fail('limit_exceeded', path)

  return pass({
    groupId: groupId.value,
    type: type.value,
    subtype,
    severity: severity.value,
    title: title.value,
    mustCover: mustCover.value,
    distinctEssaySupport: distinctEssaySupport.value,
    occurrenceCount: occurrenceCount.value,
    excerpt,
  })
}

export function parseClassReviewSynthesisRequest(
  value: unknown,
): ParseResult<ClassReviewSynthesisRequestV1> {
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
  if (record.value.contractVersion !== 'class-review-synthesis-request-v1') {
    return fail('invalid_value', '/contractVersion')
  }
  const requestId = opaqueAt(record.value.requestId, '/requestId')
  if (!requestId.ok) return requestId
  const rubricRevisionDigest = stringAt(
    record.value.rubricRevisionDigest,
    '/rubricRevisionDigest',
    43,
  )
  if (!rubricRevisionDigest.ok) return rubricRevisionDigest
  if (!/^[A-Za-z0-9_-]{43}$/.test(rubricRevisionDigest.value)) {
    return fail('invalid_value', '/rubricRevisionDigest')
  }
  if (record.value.policyVersion !== 'class-review-policy-v1') {
    return fail('invalid_value', '/policyVersion')
  }
  if (record.value.schemaVersion !== 'kimi-class-review-output-v1') {
    return fail('invalid_value', '/schemaVersion')
  }
  if (record.value.projectionVersion !== 'class-review-projection-v1') {
    return fail('invalid_value', '/projectionVersion')
  }
  if (record.value.budgetVersion !== 'class-review-prompt-budget-v1') {
    return fail('invalid_value', '/budgetVersion')
  }

  const statistics = parseSynthesisStatistics(record.value.statistics, '/statistics')
  if (!statistics.ok) return statistics
  if (jsonUtf8ByteLength(statistics.value) > 8 * 1024) {
    return fail('limit_exceeded', '/statistics')
  }
  const groups = arrayAt(record.value.groups, '/groups', 64, (item, itemPath) =>
    parseSynthesisGroup(item, itemPath, statistics.value.issueEligibleEssayCount),
  )
  if (!groups.ok) return groups
  const uniqueGroupIds = uniqueStringsAt(
    groups.value.map((group) => group.groupId),
    (index) => `/groups/${index}/groupId`,
  )
  if (!uniqueGroupIds.ok) return uniqueGroupIds
  if (jsonUtf8ByteLength(groups.value) > 32 * 1024) {
    return fail('limit_exceeded', '/groups')
  }
  const semanticCoverage = parseSemanticCoverage(
    record.value.semanticCoverage,
    '/semanticCoverage',
  )
  if (!semanticCoverage.ok) return semanticCoverage

  const limits = hasOnlyKeys(record.value.outputLimits, '/outputLimits', [
    'maxCompletionTokens',
    'maxVisibleCodePoints',
    'maxJsonUtf8Bytes',
  ])
  if (!limits.ok) return limits
  const maxCompletionTokens = safeIntegerAt(
    limits.value.maxCompletionTokens,
    '/outputLimits/maxCompletionTokens',
  )
  if (!maxCompletionTokens.ok) return maxCompletionTokens
  if (maxCompletionTokens.value !== 3072) {
    return fail('invalid_value', '/outputLimits/maxCompletionTokens')
  }
  const maxVisibleCodePoints = safeIntegerAt(
    limits.value.maxVisibleCodePoints,
    '/outputLimits/maxVisibleCodePoints',
  )
  if (!maxVisibleCodePoints.ok) return maxVisibleCodePoints
  if (maxVisibleCodePoints.value !== 2200) {
    return fail('invalid_value', '/outputLimits/maxVisibleCodePoints')
  }
  const maxJsonUtf8Bytes = safeIntegerAt(
    limits.value.maxJsonUtf8Bytes,
    '/outputLimits/maxJsonUtf8Bytes',
  )
  if (!maxJsonUtf8Bytes.ok) return maxJsonUtf8Bytes
  if (maxJsonUtf8Bytes.value !== 16384) {
    return fail('invalid_value', '/outputLimits/maxJsonUtf8Bytes')
  }

  return pass({
    contractVersion: 'class-review-synthesis-request-v1',
    requestId: requestId.value,
    rubricRevisionDigest: rubricRevisionDigest.value,
    policyVersion: 'class-review-policy-v1',
    schemaVersion: 'kimi-class-review-output-v1',
    projectionVersion: 'class-review-projection-v1',
    budgetVersion: 'class-review-prompt-budget-v1',
    statistics: statistics.value,
    groups: groups.value,
    semanticCoverage: semanticCoverage.value,
    outputLimits: {
      maxCompletionTokens: 3072,
      maxVisibleCodePoints: 2200,
      maxJsonUtf8Bytes: 16384,
    },
  })
}

function parseProviderOutput(
  value: unknown,
  request: ClassReviewSynthesisRequestV1,
): ParseResult<ClassReviewProviderOutputV1> {
  const path = '/output'
  const record = hasOnlyKeys(value, path, [
    'overallComment',
    'strengths',
    'patterns',
    'learningRecommendations',
  ])
  if (!record.ok) return record
  const overallComment = stringAt(record.value.overallComment, `${path}/overallComment`, 300)
  if (!overallComment.ok) return overallComment
  let visibleCodePoints = codePointLengthAt(overallComment.value, `${path}/overallComment`, 2200)
  if (!visibleCodePoints.ok) return visibleCodePoints
  let visibleTotal = visibleCodePoints.value
  const knownDimensionIds = new Set(
    request.statistics.dimensions.map((dimension) => dimension.dimensionId),
  )
  const strengths = arrayAt(
    record.value.strengths,
    `${path}/strengths`,
    3,
    (item, itemPath) => {
      const strength = hasOnlyKeys(item, itemPath, ['title', 'detail', 'dimensionIds'])
      if (!strength.ok) return strength
      const title = stringAt(strength.value.title, `${itemPath}/title`, 40)
      if (!title.ok) return title
      const detail = stringAt(strength.value.detail, `${itemPath}/detail`, 120)
      if (!detail.ok) return detail
      const dimensionIds = arrayAt(
        strength.value.dimensionIds,
        `${itemPath}/dimensionIds`,
        3,
        opaqueAt,
      )
      if (!dimensionIds.ok) return dimensionIds
      const uniqueDimensionIds = uniqueStringsAt(
        dimensionIds.value,
        (index) => `${itemPath}/dimensionIds/${index}`,
      )
      if (!uniqueDimensionIds.ok) return uniqueDimensionIds
      for (let index = 0; index < dimensionIds.value.length; index += 1) {
        if (!knownDimensionIds.has(dimensionIds.value[index])) {
          return fail('unknown_reference', `${itemPath}/dimensionIds/${index}`)
        }
      }
      const titleLength = codePointLengthAt(title.value, `${itemPath}/title`, 2200)
      if (!titleLength.ok) return titleLength
      const detailLength = codePointLengthAt(detail.value, `${itemPath}/detail`, 2200)
      if (!detailLength.ok) return detailLength
      visibleTotal += titleLength.value + detailLength.value
      return pass({ title: title.value, detail: detail.value, dimensionIds: dimensionIds.value })
    },
    1,
  )
  if (!strengths.ok) return strengths

  const knownGroupIds = new Set(request.groups.map((group) => group.groupId))
  const ownedGroupIds = new Set<string>()
  const patterns = arrayAt(record.value.patterns, `${path}/patterns`, 8, (item, itemPath) => {
    const pattern = hasOnlyKeys(item, itemPath, [
      'groupIds',
      'title',
      'diagnosis',
      'teachingAction',
      'severity',
    ])
    if (!pattern.ok) return pattern
    const groupIds = arrayAt(pattern.value.groupIds, `${itemPath}/groupIds`, 12, opaqueAt, 1)
    if (!groupIds.ok) return groupIds
    const uniqueGroupIds = uniqueStringsAt(
      groupIds.value,
      (index) => `${itemPath}/groupIds/${index}`,
    )
    if (!uniqueGroupIds.ok) return uniqueGroupIds
    for (let index = 0; index < groupIds.value.length; index += 1) {
      const groupId = groupIds.value[index]
      if (!knownGroupIds.has(groupId)) {
        return fail('unknown_reference', `${itemPath}/groupIds/${index}`)
      }
      if (ownedGroupIds.has(groupId)) {
        return fail('duplicate_value', `${itemPath}/groupIds/${index}`)
      }
      ownedGroupIds.add(groupId)
    }
    const title = stringAt(pattern.value.title, `${itemPath}/title`, 40)
    if (!title.ok) return title
    const diagnosis = stringAt(pattern.value.diagnosis, `${itemPath}/diagnosis`, 100)
    if (!diagnosis.ok) return diagnosis
    const teachingAction = stringAt(
      pattern.value.teachingAction,
      `${itemPath}/teachingAction`,
      100,
    )
    if (!teachingAction.ok) return teachingAction
    const severity = enumAt(pattern.value.severity, `${itemPath}/severity`, SEVERITIES)
    if (!severity.ok) return severity
    const titleLength = codePointLengthAt(title.value, `${itemPath}/title`, 2200)
    if (!titleLength.ok) return titleLength
    const diagnosisLength = codePointLengthAt(diagnosis.value, `${itemPath}/diagnosis`, 2200)
    if (!diagnosisLength.ok) return diagnosisLength
    const actionLength = codePointLengthAt(
      teachingAction.value,
      `${itemPath}/teachingAction`,
      2200,
    )
    if (!actionLength.ok) return actionLength
    visibleTotal += titleLength.value + diagnosisLength.value + actionLength.value
    return pass({
      groupIds: groupIds.value,
      title: title.value,
      diagnosis: diagnosis.value,
      teachingAction: teachingAction.value,
      severity: severity.value,
    })
  })
  if (!patterns.ok) return patterns

  const learningRecommendations = arrayAt(
    record.value.learningRecommendations,
    `${path}/learningRecommendations`,
    3,
    (item, itemPath) => {
      const recommendation = hasOnlyKeys(item, itemPath, ['title', 'action'])
      if (!recommendation.ok) return recommendation
      const title = stringAt(recommendation.value.title, `${itemPath}/title`, 40)
      if (!title.ok) return title
      const action = stringAt(recommendation.value.action, `${itemPath}/action`, 120)
      if (!action.ok) return action
      const titleLength = codePointLengthAt(title.value, `${itemPath}/title`, 2200)
      if (!titleLength.ok) return titleLength
      const actionLength = codePointLengthAt(action.value, `${itemPath}/action`, 2200)
      if (!actionLength.ok) return actionLength
      visibleTotal += titleLength.value + actionLength.value
      return pass({ title: title.value, action: action.value })
    },
    1,
  )
  if (!learningRecommendations.ok) return learningRecommendations
  if (visibleTotal > 2200) return fail('limit_exceeded', path)

  const output = {
    overallComment: overallComment.value,
    strengths: strengths.value,
    patterns: patterns.value,
    learningRecommendations: learningRecommendations.value,
  }
  if (jsonUtf8ByteLength(output) > 16 * 1024) return fail('limit_exceeded', path)
  return pass(output)
}

function parseUsage(value: unknown, path: string): ParseResult<ProviderUsageV1> {
  const record = hasOnlyKeys(value, path, [
    'promptTokens',
    'completionTokens',
    'totalTokens',
    'cachedTokens',
  ])
  if (!record.ok) return record
  const promptTokens = safeIntegerAt(record.value.promptTokens, pointer(path, 'promptTokens'))
  if (!promptTokens.ok) return promptTokens
  const completionTokens = safeIntegerAt(
    record.value.completionTokens,
    pointer(path, 'completionTokens'),
  )
  if (!completionTokens.ok) return completionTokens
  const totalTokens = safeIntegerAt(record.value.totalTokens, pointer(path, 'totalTokens'))
  if (!totalTokens.ok) return totalTokens
  let cachedTokens: number | null
  if (record.value.cachedTokens === null) cachedTokens = null
  else {
    const parsedCachedTokens = safeIntegerAt(
      record.value.cachedTokens,
      pointer(path, 'cachedTokens'),
    )
    if (!parsedCachedTokens.ok) return parsedCachedTokens
    cachedTokens = parsedCachedTokens.value
  }
  const summedTokens = promptTokens.value + completionTokens.value
  if (!Number.isSafeInteger(summedTokens) || totalTokens.value !== summedTokens) {
    return fail('invalid_value', pointer(path, 'totalTokens'))
  }
  if (cachedTokens !== null && cachedTokens > promptTokens.value) {
    return fail('invalid_value', pointer(path, 'cachedTokens'))
  }
  return pass({
    promptTokens: promptTokens.value,
    completionTokens: completionTokens.value,
    totalTokens: totalTokens.value,
    cachedTokens,
  })
}

function parseTimings(value: unknown, path: string): ParseResult<SynthesisTimingsV1> {
  const record = hasOnlyKeys(value, path, ['queueMs', 'providerMs', 'validationMs', 'totalMs'])
  if (!record.ok) return record
  const queueMs = safeIntegerAt(record.value.queueMs, pointer(path, 'queueMs'))
  if (!queueMs.ok) return queueMs
  const providerMs = safeIntegerAt(record.value.providerMs, pointer(path, 'providerMs'))
  if (!providerMs.ok) return providerMs
  const validationMs = safeIntegerAt(
    record.value.validationMs,
    pointer(path, 'validationMs'),
  )
  if (!validationMs.ok) return validationMs
  const totalMs = safeIntegerAt(record.value.totalMs, pointer(path, 'totalMs'))
  if (!totalMs.ok) return totalMs
  if (totalMs.value < Math.max(queueMs.value, providerMs.value, validationMs.value)) {
    return fail('invalid_value', pointer(path, 'totalMs'))
  }
  return pass({
    queueMs: queueMs.value,
    providerMs: providerMs.value,
    validationMs: validationMs.value,
    totalMs: totalMs.value,
  })
}

export function parseClassReviewSynthesisResult(
  value: unknown,
  request: ClassReviewSynthesisRequestV1,
): ParseResult<ClassReviewSynthesisResultV1> {
  const baseKeys = ['contractVersion', 'requestId', 'status', 'timingsMs']
  const record = hasOnlyKeys(value, '', baseKeys, [
    'output',
    'finishReason',
    'usage',
    'safeFailureCode',
    'retryable',
    'retryAfterMs',
    'completionDisposition',
  ])
  if (!record.ok) return record
  if (record.value.contractVersion !== 'class-review-synthesis-result-v1') {
    return fail('invalid_value', '/contractVersion')
  }
  const requestId = opaqueAt(record.value.requestId, '/requestId')
  if (!requestId.ok) return requestId
  const status = enumAt(record.value.status, '/status', [
    'succeeded',
    'failed',
    'result_unknown',
  ])
  if (!status.ok) return status

  if (status.value === 'succeeded') {
    const exact = hasOnlyKeys(value, '', [
      'contractVersion',
      'requestId',
      'status',
      'output',
      'finishReason',
      'usage',
      'timingsMs',
    ])
    if (!exact.ok) return exact
    const output = parseProviderOutput(record.value.output, request)
    if (!output.ok) return output
    if (record.value.finishReason !== 'stop') return fail('invalid_value', '/finishReason')
    const usage = parseUsage(record.value.usage, '/usage')
    if (!usage.ok) return usage
    const timingsMs = parseTimings(record.value.timingsMs, '/timingsMs')
    if (!timingsMs.ok) return timingsMs
    return pass({
      contractVersion: 'class-review-synthesis-result-v1',
      requestId: requestId.value,
      status: 'succeeded',
      output: output.value,
      finishReason: 'stop',
      usage: usage.value,
      timingsMs: timingsMs.value,
    })
  }

  if (status.value === 'result_unknown') {
    const exact = hasOnlyKeys(value, '', [
      'contractVersion',
      'requestId',
      'status',
      'safeFailureCode',
      'completionDisposition',
      'timingsMs',
    ])
    if (!exact.ok) return exact
    if (record.value.safeFailureCode !== 'provider_result_unknown') {
      return fail('invalid_value', '/safeFailureCode')
    }
    if (record.value.completionDisposition !== 'unknown') {
      return fail('invalid_value', '/completionDisposition')
    }
    const timingsMs = parseTimings(record.value.timingsMs, '/timingsMs')
    if (!timingsMs.ok) return timingsMs
    return pass({
      contractVersion: 'class-review-synthesis-result-v1',
      requestId: requestId.value,
      status: 'result_unknown',
      safeFailureCode: 'provider_result_unknown',
      completionDisposition: 'unknown',
      timingsMs: timingsMs.value,
    })
  }

  const exact = hasOnlyKeys(value, '', [
    'contractVersion',
    'requestId',
    'status',
    'safeFailureCode',
    'retryable',
    'retryAfterMs',
    'completionDisposition',
    'finishReason',
    'usage',
    'timingsMs',
  ])
  if (!exact.ok) return exact
  const safeFailureCode = enumAt(
    record.value.safeFailureCode,
    '/safeFailureCode',
    SAFE_FAILURE_CODES,
  )
  if (!safeFailureCode.ok) return safeFailureCode
  const retryable = booleanAt(record.value.retryable, '/retryable')
  if (!retryable.ok) return retryable
  let retryAfterMs: number | null
  if (record.value.retryAfterMs === null) retryAfterMs = null
  else {
    const parsedRetryAfterMs = safeIntegerAt(record.value.retryAfterMs, '/retryAfterMs')
    if (!parsedRetryAfterMs.ok) return parsedRetryAfterMs
    retryAfterMs = parsedRetryAfterMs.value
  }
  const completionDisposition = enumAt(record.value.completionDisposition, '/completionDisposition', [
    'not_started',
    'confirmed_zero_completion',
    'completed',
  ])
  if (!completionDisposition.ok) return completionDisposition
  if (
    retryAfterMs !== null &&
    (safeFailureCode.value !== 'provider_rate_limited' ||
      completionDisposition.value !== 'confirmed_zero_completion')
  ) {
    return fail('invalid_value', '/retryAfterMs')
  }

  let finishReason: SafeFinishReasonV1 | null
  let usage: ProviderUsageV1 | null
  if (completionDisposition.value === 'completed') {
    if (record.value.finishReason === null) finishReason = null
    else {
      const parsedFinishReason = enumAt(record.value.finishReason, '/finishReason', FINISH_REASONS)
      if (!parsedFinishReason.ok) return parsedFinishReason
      finishReason = parsedFinishReason.value
    }
    const parsedUsage = parseUsage(record.value.usage, '/usage')
    if (!parsedUsage.ok) return parsedUsage
    usage = parsedUsage.value
  } else {
    if (record.value.finishReason !== null) return fail('invalid_value', '/finishReason')
    if (record.value.usage !== null) return fail('invalid_value', '/usage')
    finishReason = null
    usage = null
  }
  const timingsMs = parseTimings(record.value.timingsMs, '/timingsMs')
  if (!timingsMs.ok) return timingsMs
  return pass({
    contractVersion: 'class-review-synthesis-result-v1',
    requestId: requestId.value,
    status: 'failed',
    safeFailureCode: safeFailureCode.value,
    retryable: retryable.value,
    retryAfterMs,
    completionDisposition: completionDisposition.value,
    finishReason,
    usage,
    timingsMs: timingsMs.value,
  })
}
