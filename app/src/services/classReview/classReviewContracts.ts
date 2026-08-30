import {
  arrayAt,
  booleanAt,
  enumAt,
  fail,
  finiteAt,
  hasOnlyKeys,
  nullableStringAt,
  opaqueAt,
  parseSemanticCoverage,
  pass,
  pointer,
  ratioAt,
  safeIntegerAt,
  stringAt,
  timestampAt,
  uniqueStringsAt,
  type ActionableGenerationSummaryV1,
  type AiSummaryV1,
  type ClassReviewGenerationCommandV1,
  type ClassReviewGenerationStatusV1,
  type ClassReviewIssueBlockV1,
  type ClassReviewReportV1,
  type ClassReviewStatisticsV1,
  type ClearSpellingItemV1,
  type EvidenceRefV1,
  type ParseResult,
  type SafeFailureCode,
  type SafeUnappliedReason,
  type SelectedMaterialV1,
  type Severity,
  type SnapshotMetadataV1,
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

const SEVERITIES: readonly Severity[] = ['low', 'medium', 'high']
const UNAPPLIED_REASONS: readonly SafeUnappliedReason[] = ['ai_text_changed', 'merge_conflict']

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

export function parseClassReviewGenerationCommand(
  value: unknown,
): ParseResult<ClassReviewGenerationCommandV1> {
  const baseKeys = ['contractVersion', 'intent', 'generationId']
  const record = hasOnlyKeys(value, '', baseKeys, [
    'expectedTaskRevision',
    'expectedReportRevision',
    'expectedGenerationRevision',
    'expectedAiTextEditRevision',
  ])
  if (!record.ok) return record
  if (record.value.contractVersion !== 'class-review-generation-command-v1') {
    return fail('invalid_value', '/contractVersion')
  }
  const intent = enumAt(record.value.intent, '/intent', [
    'initial',
    'regenerate',
    'apply_candidate',
    'discard_candidate',
  ])
  if (!intent.ok) return intent

  if (intent.value === 'discard_candidate') {
    const exact = hasOnlyKeys(value, '', [...baseKeys, 'expectedGenerationRevision'])
    if (!exact.ok) return exact
    const generationId = opaqueAt(record.value.generationId, '/generationId')
    if (!generationId.ok) return generationId
    const expectedGenerationRevision = safeIntegerAt(
      record.value.expectedGenerationRevision,
      '/expectedGenerationRevision',
    )
    if (!expectedGenerationRevision.ok) return expectedGenerationRevision
    return pass({
      contractVersion: 'class-review-generation-command-v1',
      intent: 'discard_candidate',
      generationId: generationId.value,
      expectedGenerationRevision: expectedGenerationRevision.value,
    })
  }

  const requiredKeys = [...baseKeys, 'expectedTaskRevision', 'expectedReportRevision']
  const exact = hasOnlyKeys(
    value,
    '',
    intent.value === 'apply_candidate'
      ? [...requiredKeys, 'expectedGenerationRevision', 'expectedAiTextEditRevision']
      : requiredKeys,
  )
  if (!exact.ok) return exact
  const generationId = opaqueAt(record.value.generationId, '/generationId')
  if (!generationId.ok) return generationId
  const expectedTaskRevision = safeIntegerAt(
    record.value.expectedTaskRevision,
    '/expectedTaskRevision',
  )
  if (!expectedTaskRevision.ok) return expectedTaskRevision

  if (intent.value === 'initial') {
    if (record.value.expectedReportRevision === null) {
      return pass({
        contractVersion: 'class-review-generation-command-v1',
        intent: 'initial',
        generationId: generationId.value,
        expectedTaskRevision: expectedTaskRevision.value,
        expectedReportRevision: null,
      })
    }
    const expectedReportRevision = safeIntegerAt(
      record.value.expectedReportRevision,
      '/expectedReportRevision',
    )
    if (!expectedReportRevision.ok) return expectedReportRevision
    return pass({
      contractVersion: 'class-review-generation-command-v1',
      intent: 'initial',
      generationId: generationId.value,
      expectedTaskRevision: expectedTaskRevision.value,
      expectedReportRevision: expectedReportRevision.value,
    })
  }

  const expectedReportRevision = safeIntegerAt(
    record.value.expectedReportRevision,
    '/expectedReportRevision',
  )
  if (!expectedReportRevision.ok) return expectedReportRevision
  if (intent.value === 'regenerate') {
    return pass({
      contractVersion: 'class-review-generation-command-v1',
      intent: 'regenerate',
      generationId: generationId.value,
      expectedTaskRevision: expectedTaskRevision.value,
      expectedReportRevision: expectedReportRevision.value,
    })
  }

  const expectedGenerationRevision = safeIntegerAt(
    record.value.expectedGenerationRevision,
    '/expectedGenerationRevision',
  )
  if (!expectedGenerationRevision.ok) return expectedGenerationRevision
  const expectedAiTextEditRevision = safeIntegerAt(
    record.value.expectedAiTextEditRevision,
    '/expectedAiTextEditRevision',
  )
  if (!expectedAiTextEditRevision.ok) return expectedAiTextEditRevision
  return pass({
    contractVersion: 'class-review-generation-command-v1',
    intent: 'apply_candidate',
    generationId: generationId.value,
    expectedTaskRevision: expectedTaskRevision.value,
    expectedReportRevision: expectedReportRevision.value,
    expectedGenerationRevision: expectedGenerationRevision.value,
    expectedAiTextEditRevision: expectedAiTextEditRevision.value,
  })
}

function parseGenerationStatusBase(
  record: Record<string, unknown>,
): ParseResult<Omit<ClassReviewGenerationStatusV1, 'state'>> {
  const generationId = opaqueAt(record.generationId, '/generationId')
  if (!generationId.ok) return generationId
  const generationRevision = safeIntegerAt(record.generationRevision, '/generationRevision')
  if (!generationRevision.ok) return generationRevision
  const counts = parseEssayCounts(record, '')
  if (!counts.ok) return counts
  const createdAt = timestampAt(record.createdAt, '/createdAt')
  if (!createdAt.ok) return createdAt
  return pass({
    contractVersion: 'class-review-generation-status-v1',
    generationId: generationId.value,
    generationRevision: generationRevision.value,
    ...counts.value,
    createdAt: createdAt.value,
  })
}

export function parseClassReviewGenerationStatus(
  value: unknown,
): ParseResult<ClassReviewGenerationStatusV1> {
  const baseKeys = [
    'contractVersion',
    'generationId',
    'generationRevision',
    'includedEssayCount',
    'issueEligibleEssayCount',
    'totalEssayCount',
    'createdAt',
    'state',
  ]
  const record = hasOnlyKeys(value, '', baseKeys, [
    'safeFailureCode',
    'semanticCoverage',
    'safeUnappliedReason',
    'completedAt',
  ])
  if (!record.ok) return record
  if (record.value.contractVersion !== 'class-review-generation-status-v1') {
    return fail('invalid_value', '/contractVersion')
  }
  const state = enumAt(record.value.state, '/state', [
    'queued',
    'running',
    'result_unknown',
    'succeeded',
    'succeeded_unapplied',
    'failed',
    'discarded',
    'invalidated',
  ])
  if (!state.ok) return state

  let variantKeys: string[]
  if (state.value === 'queued' || state.value === 'running') variantKeys = baseKeys
  else if (state.value === 'result_unknown') variantKeys = [...baseKeys, 'safeFailureCode']
  else if (state.value === 'succeeded') {
    variantKeys = [...baseKeys, 'semanticCoverage', 'completedAt']
  } else if (state.value === 'succeeded_unapplied') {
    variantKeys = [...baseKeys, 'semanticCoverage', 'safeUnappliedReason', 'completedAt']
  } else if (state.value === 'failed' || state.value === 'invalidated') {
    variantKeys = [...baseKeys, 'safeFailureCode', 'completedAt']
  } else variantKeys = [...baseKeys, 'completedAt']
  const exact = hasOnlyKeys(value, '', variantKeys)
  if (!exact.ok) return exact

  const common = parseGenerationStatusBase(record.value)
  if (!common.ok) return common
  if (state.value === 'queued' || state.value === 'running') {
    return pass({ ...common.value, state: state.value })
  }
  if (state.value === 'result_unknown') {
    if (record.value.safeFailureCode !== 'provider_result_unknown') {
      return fail('invalid_value', '/safeFailureCode')
    }
    return pass({ ...common.value, state: 'result_unknown', safeFailureCode: 'provider_result_unknown' })
  }

  const completedAt = timestampAt(record.value.completedAt, '/completedAt')
  if (!completedAt.ok) return completedAt
  if (state.value === 'discarded') {
    return pass({ ...common.value, state: 'discarded', completedAt: completedAt.value })
  }
  if (state.value === 'failed') {
    const safeFailureCode = enumAt(
      record.value.safeFailureCode,
      '/safeFailureCode',
      SAFE_FAILURE_CODES,
    )
    if (!safeFailureCode.ok) return safeFailureCode
    return pass({
      ...common.value,
      state: 'failed',
      safeFailureCode: safeFailureCode.value,
      completedAt: completedAt.value,
    })
  }
  if (state.value === 'invalidated') {
    const safeFailureCode = enumAt(record.value.safeFailureCode, '/safeFailureCode', [
      'class_review_source_invalidated',
      'class_review_task_invalidated',
    ])
    if (!safeFailureCode.ok) return safeFailureCode
    return pass({
      ...common.value,
      state: 'invalidated',
      safeFailureCode: safeFailureCode.value,
      completedAt: completedAt.value,
    })
  }

  const semanticCoverage = parseSemanticCoverage(
    record.value.semanticCoverage,
    '/semanticCoverage',
  )
  if (!semanticCoverage.ok) return semanticCoverage
  if (state.value === 'succeeded') {
    return pass({
      ...common.value,
      state: 'succeeded',
      semanticCoverage: semanticCoverage.value,
      completedAt: completedAt.value,
    })
  }
  const safeUnappliedReason = enumAt(
    record.value.safeUnappliedReason,
    '/safeUnappliedReason',
    UNAPPLIED_REASONS,
  )
  if (!safeUnappliedReason.ok) return safeUnappliedReason
  return pass({
    ...common.value,
    state: 'succeeded_unapplied',
    semanticCoverage: semanticCoverage.value,
    safeUnappliedReason: safeUnappliedReason.value,
    completedAt: completedAt.value,
  })
}

export function parseActionableGenerationSummary(
  value: unknown,
  path = '/currentGeneration',
): ParseResult<ActionableGenerationSummaryV1> {
  const baseKeys = ['generationId', 'generationRevision', 'state', 'createdAt']
  const record = hasOnlyKeys(value, path, baseKeys, [
    'safeFailureCode',
    'safeUnappliedReason',
    'completedAt',
  ])
  if (!record.ok) return record
  const state = enumAt(record.value.state, pointer(path, 'state'), [
    'queued',
    'running',
    'result_unknown',
    'succeeded_unapplied',
  ])
  if (!state.ok) return state
  let variantKeys = baseKeys
  if (state.value === 'result_unknown') variantKeys = [...baseKeys, 'safeFailureCode']
  if (state.value === 'succeeded_unapplied') {
    variantKeys = [...baseKeys, 'safeUnappliedReason', 'completedAt']
  }
  const exact = hasOnlyKeys(value, path, variantKeys)
  if (!exact.ok) return exact
  const generationId = opaqueAt(record.value.generationId, pointer(path, 'generationId'))
  if (!generationId.ok) return generationId
  const generationRevision = safeIntegerAt(
    record.value.generationRevision,
    pointer(path, 'generationRevision'),
  )
  if (!generationRevision.ok) return generationRevision
  const createdAt = timestampAt(record.value.createdAt, pointer(path, 'createdAt'))
  if (!createdAt.ok) return createdAt
  if (state.value === 'queued' || state.value === 'running') {
    return pass({
      generationId: generationId.value,
      generationRevision: generationRevision.value,
      state: state.value,
      createdAt: createdAt.value,
    })
  }
  if (state.value === 'result_unknown') {
    if (record.value.safeFailureCode !== 'provider_result_unknown') {
      return fail('invalid_value', pointer(path, 'safeFailureCode'))
    }
    return pass({
      generationId: generationId.value,
      generationRevision: generationRevision.value,
      state: 'result_unknown',
      safeFailureCode: 'provider_result_unknown',
      createdAt: createdAt.value,
    })
  }
  const safeUnappliedReason = enumAt(
    record.value.safeUnappliedReason,
    pointer(path, 'safeUnappliedReason'),
    UNAPPLIED_REASONS,
  )
  if (!safeUnappliedReason.ok) return safeUnappliedReason
  const completedAt = timestampAt(record.value.completedAt, pointer(path, 'completedAt'))
  if (!completedAt.ok) return completedAt
  return pass({
    generationId: generationId.value,
    generationRevision: generationRevision.value,
    state: 'succeeded_unapplied',
    safeUnappliedReason: safeUnappliedReason.value,
    createdAt: createdAt.value,
    completedAt: completedAt.value,
  })
}

function parseClassReviewStatistics(value: unknown): ParseResult<ClassReviewStatisticsV1> {
  const path = '/statistics'
  const record = hasOnlyKeys(value, path, [
    'totalEssayCount',
    'includedEssayCount',
    'issueEligibleEssayCount',
    'excludedEssayCount',
    'issueCoverageRate',
    'fullScore',
    'scoreSummary',
    'scoreBands',
    'dimensions',
  ])
  if (!record.ok) return record
  const totalEssayCount = safeIntegerAt(record.value.totalEssayCount, `${path}/totalEssayCount`)
  if (!totalEssayCount.ok) return totalEssayCount
  const counts = parseEssayCounts(record.value, path)
  if (!counts.ok) return counts
  const excludedEssayCount = safeIntegerAt(
    record.value.excludedEssayCount,
    `${path}/excludedEssayCount`,
  )
  if (!excludedEssayCount.ok) return excludedEssayCount
  if (excludedEssayCount.value !== counts.value.totalEssayCount - counts.value.includedEssayCount) {
    return fail('invalid_value', `${path}/excludedEssayCount`)
  }
  const issueCoverageRate = ratioAt(record.value.issueCoverageRate, `${path}/issueCoverageRate`)
  if (!issueCoverageRate.ok) return issueCoverageRate
  const expectedCoverage =
    counts.value.includedEssayCount === 0
      ? 1
      : counts.value.issueEligibleEssayCount / counts.value.includedEssayCount
  if (Math.abs(issueCoverageRate.value - expectedCoverage) > 1e-12) {
    return fail('invalid_value', `${path}/issueCoverageRate`)
  }
  const fullScore = finiteAt(record.value.fullScore, `${path}/fullScore`, true)
  if (!fullScore.ok) return fullScore

  let scoreSummary: ClassReviewStatisticsV1['scoreSummary']
  if (record.value.scoreSummary === null) {
    if (counts.value.includedEssayCount !== 0) {
      return fail('invalid_value', `${path}/scoreSummary`)
    }
    scoreSummary = null
  } else {
    if (counts.value.includedEssayCount === 0) {
      return fail('invalid_value', `${path}/scoreSummary`)
    }
    const summaryPath = `${path}/scoreSummary`
    const summary = hasOnlyKeys(record.value.scoreSummary, summaryPath, [
      'averageScore',
      'highestScore',
      'lowestScore',
    ])
    if (!summary.ok) return summary
    const averageScore = finiteAt(summary.value.averageScore, `${summaryPath}/averageScore`)
    if (!averageScore.ok) return averageScore
    const highestScore = finiteAt(summary.value.highestScore, `${summaryPath}/highestScore`)
    if (!highestScore.ok) return highestScore
    const lowestScore = finiteAt(summary.value.lowestScore, `${summaryPath}/lowestScore`)
    if (!lowestScore.ok) return lowestScore
    for (const [score, scorePath] of [
      [averageScore.value, `${summaryPath}/averageScore`],
      [highestScore.value, `${summaryPath}/highestScore`],
      [lowestScore.value, `${summaryPath}/lowestScore`],
    ] satisfies Array<[number, string]>) {
      if (score < 0 || score > fullScore.value) return fail('invalid_value', scorePath)
    }
    if (lowestScore.value > averageScore.value) {
      return fail('invalid_value', `${summaryPath}/lowestScore`)
    }
    if (averageScore.value > highestScore.value) {
      return fail('invalid_value', `${summaryPath}/highestScore`)
    }
    scoreSummary = {
      averageScore: averageScore.value,
      highestScore: highestScore.value,
      lowestScore: lowestScore.value,
    }
  }

  const scoreBands = arrayAt(record.value.scoreBands, `${path}/scoreBands`, 20, (item, itemPath) => {
    const band = hasOnlyKeys(item, itemPath, [
      'bandId',
      'lowerInclusive',
      'upperInclusive',
      'essayCount',
    ])
    if (!band.ok) return band
    const bandId = opaqueAt(band.value.bandId, `${itemPath}/bandId`)
    if (!bandId.ok) return bandId
    const lowerInclusive = finiteAt(band.value.lowerInclusive, `${itemPath}/lowerInclusive`)
    if (!lowerInclusive.ok) return lowerInclusive
    const upperInclusive = finiteAt(band.value.upperInclusive, `${itemPath}/upperInclusive`)
    if (!upperInclusive.ok) return upperInclusive
    const essayCount = safeIntegerAt(band.value.essayCount, `${itemPath}/essayCount`)
    if (!essayCount.ok) return essayCount
    if (lowerInclusive.value < 0 || lowerInclusive.value > fullScore.value) {
      return fail('invalid_value', `${itemPath}/lowerInclusive`)
    }
    if (
      upperInclusive.value < lowerInclusive.value ||
      upperInclusive.value > fullScore.value
    ) {
      return fail('invalid_value', `${itemPath}/upperInclusive`)
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
    (index) => `${path}/scoreBands/${index}/bandId`,
  )
  if (!uniqueBandIds.ok) return uniqueBandIds

  const dimensions = arrayAt(record.value.dimensions, `${path}/dimensions`, 10, (item, itemPath) => {
    const dimension = hasOnlyKeys(item, itemPath, [
      'dimensionId',
      'name',
      'averageScore',
      'maxScore',
      'normalizedPerformance',
    ])
    if (!dimension.ok) return dimension
    const dimensionId = opaqueAt(dimension.value.dimensionId, `${itemPath}/dimensionId`)
    if (!dimensionId.ok) return dimensionId
    const name = stringAt(dimension.value.name, `${itemPath}/name`, 120)
    if (!name.ok) return name
    const averageScore = finiteAt(dimension.value.averageScore, `${itemPath}/averageScore`)
    if (!averageScore.ok) return averageScore
    const maxScore = finiteAt(dimension.value.maxScore, `${itemPath}/maxScore`, true)
    if (!maxScore.ok) return maxScore
    if (averageScore.value < 0 || averageScore.value > maxScore.value) {
      return fail('invalid_value', `${itemPath}/averageScore`)
    }
    const normalizedPerformance = ratioAt(
      dimension.value.normalizedPerformance,
      `${itemPath}/normalizedPerformance`,
    )
    if (!normalizedPerformance.ok) return normalizedPerformance
    return pass({
      dimensionId: dimensionId.value,
      name: name.value,
      averageScore: averageScore.value,
      maxScore: maxScore.value,
      normalizedPerformance: normalizedPerformance.value,
    })
  })
  if (!dimensions.ok) return dimensions
  const uniqueDimensionIds = uniqueStringsAt(
    dimensions.value.map((dimension) => dimension.dimensionId),
    (index) => `${path}/dimensions/${index}/dimensionId`,
  )
  if (!uniqueDimensionIds.ok) return uniqueDimensionIds

  return pass({
    totalEssayCount: totalEssayCount.value,
    includedEssayCount: counts.value.includedEssayCount,
    issueEligibleEssayCount: counts.value.issueEligibleEssayCount,
    excludedEssayCount: excludedEssayCount.value,
    issueCoverageRate: issueCoverageRate.value,
    fullScore: fullScore.value,
    scoreSummary,
    scoreBands: scoreBands.value,
    dimensions: dimensions.value,
  })
}

function parseEvidenceRef(value: unknown, path: string): ParseResult<EvidenceRefV1> {
  const record = hasOnlyKeys(value, path, [
    'evidenceId',
    'selectionOrigin',
    'sourceLocator',
    'sourceResultRevision',
    'anonymousExample',
  ])
  if (!record.ok) return record
  const evidenceId = opaqueAt(record.value.evidenceId, `${path}/evidenceId`)
  if (!evidenceId.ok) return evidenceId
  const selectionOrigin = enumAt(record.value.selectionOrigin, `${path}/selectionOrigin`, [
    'teacher_selected',
    'system_generation',
  ])
  if (!selectionOrigin.ok) return selectionOrigin
  const sourceLocator = opaqueAt(record.value.sourceLocator, `${path}/sourceLocator`)
  if (!sourceLocator.ok) return sourceLocator
  const sourceResultRevision = safeIntegerAt(
    record.value.sourceResultRevision,
    `${path}/sourceResultRevision`,
  )
  if (!sourceResultRevision.ok) return sourceResultRevision
  const anonymousExample = nullableStringAt(
    record.value.anonymousExample,
    `${path}/anonymousExample`,
    2000,
  )
  if (!anonymousExample.ok) return anonymousExample
  return pass({
    evidenceId: evidenceId.value,
    selectionOrigin: selectionOrigin.value,
    sourceLocator: sourceLocator.value,
    sourceResultRevision: sourceResultRevision.value,
    anonymousExample: anonymousExample.value,
  })
}

function parseIssueBlock(value: unknown, path: string): ParseResult<ClassReviewIssueBlockV1> {
  const record = hasOnlyKeys(value, path, [
    'blockId',
    'topicKey',
    'origin',
    'title',
    'diagnosis',
    'teachingAction',
    'severity',
    'teacherStudentCount',
    'systemStudentCount',
    'combinedStudentCount',
    'occurrenceCount',
    'supportDenominator',
    'anonymousExamples',
    'evidenceRefs',
  ])
  if (!record.ok) return record
  const blockId = opaqueAt(record.value.blockId, `${path}/blockId`)
  if (!blockId.ok) return blockId
  const topicKey = opaqueAt(record.value.topicKey, `${path}/topicKey`)
  if (!topicKey.ok) return topicKey
  const origin = enumAt(record.value.origin, `${path}/origin`, ['ai', 'teacher'])
  if (!origin.ok) return origin
  const title = stringAt(record.value.title, `${path}/title`, 120)
  if (!title.ok) return title
  const diagnosis = stringAt(record.value.diagnosis, `${path}/diagnosis`, 1000)
  if (!diagnosis.ok) return diagnosis
  const teachingAction = stringAt(record.value.teachingAction, `${path}/teachingAction`, 1000)
  if (!teachingAction.ok) return teachingAction
  const severity = enumAt(record.value.severity, `${path}/severity`, SEVERITIES)
  if (!severity.ok) return severity
  const teacherStudentCount = safeIntegerAt(
    record.value.teacherStudentCount,
    `${path}/teacherStudentCount`,
  )
  if (!teacherStudentCount.ok) return teacherStudentCount
  const systemStudentCount = safeIntegerAt(
    record.value.systemStudentCount,
    `${path}/systemStudentCount`,
  )
  if (!systemStudentCount.ok) return systemStudentCount
  const combinedStudentCount = safeIntegerAt(
    record.value.combinedStudentCount,
    `${path}/combinedStudentCount`,
  )
  if (!combinedStudentCount.ok) return combinedStudentCount
  const occurrenceCount = safeIntegerAt(record.value.occurrenceCount, `${path}/occurrenceCount`)
  if (!occurrenceCount.ok) return occurrenceCount
  let supportDenominator: number | null
  if (record.value.supportDenominator === null) supportDenominator = null
  else {
    const parsedDenominator = safeIntegerAt(
      record.value.supportDenominator,
      `${path}/supportDenominator`,
    )
    if (!parsedDenominator.ok) return parsedDenominator
    supportDenominator = parsedDenominator.value
  }
  const anonymousExamples = arrayAt(
    record.value.anonymousExamples,
    `${path}/anonymousExamples`,
    3,
    (item, itemPath) => stringAt(item, itemPath, 2000),
  )
  if (!anonymousExamples.ok) return anonymousExamples
  const evidenceRefs = arrayAt(
    record.value.evidenceRefs,
    `${path}/evidenceRefs`,
    512,
    parseEvidenceRef,
  )
  if (!evidenceRefs.ok) return evidenceRefs
  const uniqueEvidenceIds = uniqueStringsAt(
    evidenceRefs.value.map((evidence) => evidence.evidenceId),
    (index) => `${path}/evidenceRefs/${index}/evidenceId`,
  )
  if (!uniqueEvidenceIds.ok) return uniqueEvidenceIds
  return pass({
    blockId: blockId.value,
    topicKey: topicKey.value,
    origin: origin.value,
    title: title.value,
    diagnosis: diagnosis.value,
    teachingAction: teachingAction.value,
    severity: severity.value,
    teacherStudentCount: teacherStudentCount.value,
    systemStudentCount: systemStudentCount.value,
    combinedStudentCount: combinedStudentCount.value,
    occurrenceCount: occurrenceCount.value,
    supportDenominator,
    anonymousExamples: anonymousExamples.value,
    evidenceRefs: evidenceRefs.value,
  })
}

function parseClearSpellingItem(value: unknown, path: string): ParseResult<ClearSpellingItemV1> {
  const record = hasOnlyKeys(value, path, [
    'itemId',
    'topicKey',
    'sourceSubtype',
    'originalWord',
    'correctedWord',
    'studentCount',
    'occurrenceCount',
    'anonymousExample',
  ])
  if (!record.ok) return record
  const itemId = opaqueAt(record.value.itemId, `${path}/itemId`)
  if (!itemId.ok) return itemId
  const topicKey = opaqueAt(record.value.topicKey, `${path}/topicKey`)
  if (!topicKey.ok) return topicKey
  const sourceSubtype = enumAt(record.value.sourceSubtype, `${path}/sourceSubtype`, [
    'spelling',
    'word_choice',
  ])
  if (!sourceSubtype.ok) return sourceSubtype
  const originalWord = stringAt(record.value.originalWord, `${path}/originalWord`, 120)
  if (!originalWord.ok) return originalWord
  const correctedWord = stringAt(record.value.correctedWord, `${path}/correctedWord`, 120)
  if (!correctedWord.ok) return correctedWord
  const studentCount = safeIntegerAt(record.value.studentCount, `${path}/studentCount`)
  if (!studentCount.ok) return studentCount
  const occurrenceCount = safeIntegerAt(record.value.occurrenceCount, `${path}/occurrenceCount`)
  if (!occurrenceCount.ok) return occurrenceCount
  const anonymousExample = nullableStringAt(
    record.value.anonymousExample,
    `${path}/anonymousExample`,
    2000,
  )
  if (!anonymousExample.ok) return anonymousExample
  return pass({
    itemId: itemId.value,
    topicKey: topicKey.value,
    sourceSubtype: sourceSubtype.value,
    originalWord: originalWord.value,
    correctedWord: correctedWord.value,
    studentCount: studentCount.value,
    occurrenceCount: occurrenceCount.value,
    anonymousExample: anonymousExample.value,
  })
}

function parseSelectedMaterial(value: unknown, path: string): ParseResult<SelectedMaterialV1> {
  const record = hasOnlyKeys(value, path, [
    'materialId',
    'type',
    'categoryLabel',
    'severity',
    'needsTeacherReview',
    'originalText',
    'revisedText',
    'diagnosis',
    'teachingSuggestion',
    'sourceLocator',
  ])
  if (!record.ok) return record
  const materialId = opaqueAt(record.value.materialId, `${path}/materialId`)
  if (!materialId.ok) return materialId
  const type = enumAt(record.value.type, `${path}/type`, [
    'typical_error',
    'logic_issue',
    'expression_upgrade',
    'excellent_expression',
    'teacher_note',
  ])
  if (!type.ok) return type
  const categoryLabel = stringAt(record.value.categoryLabel, `${path}/categoryLabel`, 120)
  if (!categoryLabel.ok) return categoryLabel
  let severity: Severity | null
  if (record.value.severity === null) severity = null
  else {
    const parsedSeverity = enumAt(record.value.severity, `${path}/severity`, SEVERITIES)
    if (!parsedSeverity.ok) return parsedSeverity
    severity = parsedSeverity.value
  }
  const needsTeacherReview = booleanAt(
    record.value.needsTeacherReview,
    `${path}/needsTeacherReview`,
  )
  if (!needsTeacherReview.ok) return needsTeacherReview
  const originalText = stringAt(record.value.originalText, `${path}/originalText`, 2000)
  if (!originalText.ok) return originalText
  const revisedText = nullableStringAt(record.value.revisedText, `${path}/revisedText`, 2000)
  if (!revisedText.ok) return revisedText
  const diagnosis = nullableStringAt(record.value.diagnosis, `${path}/diagnosis`, 2000)
  if (!diagnosis.ok) return diagnosis
  const teachingSuggestion = nullableStringAt(
    record.value.teachingSuggestion,
    `${path}/teachingSuggestion`,
    2000,
  )
  if (!teachingSuggestion.ok) return teachingSuggestion
  const sourceLocator = opaqueAt(record.value.sourceLocator, `${path}/sourceLocator`)
  if (!sourceLocator.ok) return sourceLocator
  return pass({
    materialId: materialId.value,
    type: type.value,
    categoryLabel: categoryLabel.value,
    severity,
    needsTeacherReview: needsTeacherReview.value,
    originalText: originalText.value,
    revisedText: revisedText.value,
    diagnosis: diagnosis.value,
    teachingSuggestion: teachingSuggestion.value,
    sourceLocator: sourceLocator.value,
  })
}

function parseSnapshotMetadata(value: unknown): ParseResult<SnapshotMetadataV1> {
  const path = '/snapshotMetadata'
  const record = hasOnlyKeys(value, path, [
    'includedEssayCount',
    'issueEligibleEssayCount',
    'totalEssayCount',
    'semanticCoverage',
  ])
  if (!record.ok) return record
  const counts = parseEssayCounts(record.value, path)
  if (!counts.ok) return counts
  const semanticCoverage = parseSemanticCoverage(
    record.value.semanticCoverage,
    `${path}/semanticCoverage`,
  )
  if (!semanticCoverage.ok) return semanticCoverage
  return pass({ ...counts.value, semanticCoverage: semanticCoverage.value })
}

function parseAiSummary(
  value: unknown,
  knownDimensionIds: ReadonlySet<string>,
): ParseResult<AiSummaryV1> {
  const path = '/aiSummary'
  const record = hasOnlyKeys(value, path, [
    'overallComment',
    'strengths',
    'learningRecommendations',
  ])
  if (!record.ok) return record
  const overallComment = stringAt(record.value.overallComment, `${path}/overallComment`, 2000)
  if (!overallComment.ok) return overallComment
  const strengths = arrayAt(record.value.strengths, `${path}/strengths`, 512, (item, itemPath) => {
    const strength = hasOnlyKeys(item, itemPath, ['title', 'detail', 'dimensionIds'])
    if (!strength.ok) return strength
    const title = stringAt(strength.value.title, `${itemPath}/title`, 120)
    if (!title.ok) return title
    const detail = stringAt(strength.value.detail, `${itemPath}/detail`, 1000)
    if (!detail.ok) return detail
    const dimensionIds = arrayAt(
      strength.value.dimensionIds,
      `${itemPath}/dimensionIds`,
      10,
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
    return pass({ title: title.value, detail: detail.value, dimensionIds: dimensionIds.value })
  })
  if (!strengths.ok) return strengths
  const learningRecommendations = arrayAt(
    record.value.learningRecommendations,
    `${path}/learningRecommendations`,
    512,
    (item, itemPath) => {
      const recommendation = hasOnlyKeys(item, itemPath, ['title', 'action'])
      if (!recommendation.ok) return recommendation
      const title = stringAt(recommendation.value.title, `${itemPath}/title`, 120)
      if (!title.ok) return title
      const action = stringAt(recommendation.value.action, `${itemPath}/action`, 1000)
      if (!action.ok) return action
      return pass({ title: title.value, action: action.value })
    },
  )
  if (!learningRecommendations.ok) return learningRecommendations
  return pass({
    overallComment: overallComment.value,
    strengths: strengths.value,
    learningRecommendations: learningRecommendations.value,
  })
}

export function parseClassReviewReport(value: unknown): ParseResult<ClassReviewReportV1> {
  const baseKeys = [
    'contractVersion',
    'taskRevision',
    'reportRevision',
    'aiTextEditRevision',
    'currentGeneration',
    'statistics',
    'issueBlocks',
    'issueOrder',
    'clearSpellingItems',
    'selectedMaterials',
    'workspaceState',
  ]
  const record = hasOnlyKeys(value, '', baseKeys, [
    'appliedGenerationId',
    'generatedAt',
    'snapshotMetadata',
    'aiSummary',
  ])
  if (!record.ok) return record
  if (record.value.contractVersion !== 'class-review-report-v1') {
    return fail('invalid_value', '/contractVersion')
  }
  const workspaceState = enumAt(record.value.workspaceState, '/workspaceState', [
    'none',
    'draft',
    'ai_available',
    'ai_removed',
  ])
  if (!workspaceState.ok) return workspaceState
  const exact = hasOnlyKeys(
    value,
    '',
    workspaceState.value === 'ai_available'
      ? [...baseKeys, 'appliedGenerationId', 'generatedAt', 'snapshotMetadata', 'aiSummary']
      : baseKeys,
  )
  if (!exact.ok) return exact

  const taskRevision = safeIntegerAt(record.value.taskRevision, '/taskRevision')
  if (!taskRevision.ok) return taskRevision
  const aiTextEditRevision = safeIntegerAt(record.value.aiTextEditRevision, '/aiTextEditRevision')
  if (!aiTextEditRevision.ok) return aiTextEditRevision
  let currentGeneration: ActionableGenerationSummaryV1 | null
  if (record.value.currentGeneration === null) currentGeneration = null
  else {
    const parsedGeneration = parseActionableGenerationSummary(record.value.currentGeneration)
    if (!parsedGeneration.ok) return parsedGeneration
    currentGeneration = parsedGeneration.value
  }
  const statistics = parseClassReviewStatistics(record.value.statistics)
  if (!statistics.ok) return statistics
  const issueBlocks = arrayAt(record.value.issueBlocks, '/issueBlocks', 512, parseIssueBlock)
  if (!issueBlocks.ok) return issueBlocks
  const uniqueBlockIds = uniqueStringsAt(
    issueBlocks.value.map((block) => block.blockId),
    (index) => `/issueBlocks/${index}/blockId`,
  )
  if (!uniqueBlockIds.ok) return uniqueBlockIds
  const uniqueTopicKeys = uniqueStringsAt(
    issueBlocks.value.map((block) => block.topicKey),
    (index) => `/issueBlocks/${index}/topicKey`,
  )
  if (!uniqueTopicKeys.ok) return uniqueTopicKeys
  const evidenceIds = new Set<string>()
  for (let blockIndex = 0; blockIndex < issueBlocks.value.length; blockIndex += 1) {
    const evidenceRefs = issueBlocks.value[blockIndex].evidenceRefs
    for (let evidenceIndex = 0; evidenceIndex < evidenceRefs.length; evidenceIndex += 1) {
      const evidenceId = evidenceRefs[evidenceIndex].evidenceId
      if (evidenceIds.has(evidenceId)) {
        return fail(
          'duplicate_value',
          `/issueBlocks/${blockIndex}/evidenceRefs/${evidenceIndex}/evidenceId`,
        )
      }
      evidenceIds.add(evidenceId)
    }
  }
  const issueOrder = arrayAt(record.value.issueOrder, '/issueOrder', 512, opaqueAt)
  if (!issueOrder.ok) return issueOrder
  const uniqueIssueOrder = uniqueStringsAt(issueOrder.value, (index) => `/issueOrder/${index}`)
  if (!uniqueIssueOrder.ok) return uniqueIssueOrder
  const knownBlockIds = new Set(issueBlocks.value.map((block) => block.blockId))
  for (let index = 0; index < issueOrder.value.length; index += 1) {
    if (!knownBlockIds.has(issueOrder.value[index])) {
      return fail('unknown_reference', `/issueOrder/${index}`)
    }
  }
  if (issueOrder.value.length !== issueBlocks.value.length) {
    return fail('invalid_value', '/issueOrder')
  }
  const clearSpellingItems = arrayAt(
    record.value.clearSpellingItems,
    '/clearSpellingItems',
    512,
    parseClearSpellingItem,
  )
  if (!clearSpellingItems.ok) return clearSpellingItems
  const uniqueSpellingIds = uniqueStringsAt(
    clearSpellingItems.value.map((item) => item.itemId),
    (index) => `/clearSpellingItems/${index}/itemId`,
  )
  if (!uniqueSpellingIds.ok) return uniqueSpellingIds
  const uniqueSpellingTopics = uniqueStringsAt(
    clearSpellingItems.value.map((item) => item.topicKey),
    (index) => `/clearSpellingItems/${index}/topicKey`,
  )
  if (!uniqueSpellingTopics.ok) return uniqueSpellingTopics
  const selectedMaterials = arrayAt(
    record.value.selectedMaterials,
    '/selectedMaterials',
    512,
    parseSelectedMaterial,
  )
  if (!selectedMaterials.ok) return selectedMaterials
  const uniqueMaterialIds = uniqueStringsAt(
    selectedMaterials.value.map((material) => material.materialId),
    (index) => `/selectedMaterials/${index}/materialId`,
  )
  if (!uniqueMaterialIds.ok) return uniqueMaterialIds

  if (workspaceState.value === 'none') {
    if (record.value.reportRevision !== null) return fail('invalid_value', '/reportRevision')
    if (aiTextEditRevision.value !== 0) return fail('invalid_value', '/aiTextEditRevision')
    if (issueBlocks.value.length !== 0) return fail('invalid_value', '/issueBlocks')
    if (issueOrder.value.length !== 0) return fail('invalid_value', '/issueOrder')
    if (selectedMaterials.value.length !== 0) return fail('invalid_value', '/selectedMaterials')
    return pass({
      contractVersion: 'class-review-report-v1',
      taskRevision: taskRevision.value,
      reportRevision: null,
      aiTextEditRevision: 0,
      currentGeneration,
      statistics: statistics.value,
      issueBlocks: [],
      issueOrder: [],
      clearSpellingItems: clearSpellingItems.value,
      selectedMaterials: [],
      workspaceState: 'none',
    })
  }

  const reportRevision = safeIntegerAt(record.value.reportRevision, '/reportRevision')
  if (!reportRevision.ok) return reportRevision
  if (workspaceState.value === 'draft' || workspaceState.value === 'ai_removed') {
    for (let index = 0; index < issueBlocks.value.length; index += 1) {
      if (issueBlocks.value[index].origin !== 'teacher') {
        return fail('invalid_value', `/issueBlocks/${index}/origin`)
      }
    }
    return pass({
      contractVersion: 'class-review-report-v1',
      taskRevision: taskRevision.value,
      reportRevision: reportRevision.value,
      aiTextEditRevision: aiTextEditRevision.value,
      currentGeneration,
      statistics: statistics.value,
      issueBlocks: issueBlocks.value,
      issueOrder: issueOrder.value,
      clearSpellingItems: clearSpellingItems.value,
      selectedMaterials: selectedMaterials.value,
      workspaceState: workspaceState.value,
    })
  }

  const appliedGenerationId = opaqueAt(record.value.appliedGenerationId, '/appliedGenerationId')
  if (!appliedGenerationId.ok) return appliedGenerationId
  const generatedAt = timestampAt(record.value.generatedAt, '/generatedAt')
  if (!generatedAt.ok) return generatedAt
  const snapshotMetadata = parseSnapshotMetadata(record.value.snapshotMetadata)
  if (!snapshotMetadata.ok) return snapshotMetadata
  const aiSummary = parseAiSummary(
    record.value.aiSummary,
    new Set(statistics.value.dimensions.map((dimension) => dimension.dimensionId)),
  )
  if (!aiSummary.ok) return aiSummary
  return pass({
    contractVersion: 'class-review-report-v1',
    taskRevision: taskRevision.value,
    reportRevision: reportRevision.value,
    aiTextEditRevision: aiTextEditRevision.value,
    currentGeneration,
    statistics: statistics.value,
    issueBlocks: issueBlocks.value,
    issueOrder: issueOrder.value,
    clearSpellingItems: clearSpellingItems.value,
    selectedMaterials: selectedMaterials.value,
    workspaceState: 'ai_available',
    appliedGenerationId: appliedGenerationId.value,
    generatedAt: generatedAt.value,
    snapshotMetadata: snapshotMetadata.value,
    aiSummary: aiSummary.value,
  })
}
