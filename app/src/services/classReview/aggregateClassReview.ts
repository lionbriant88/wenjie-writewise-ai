import type {
  ErrorAnnotation,
  Essay,
  FullTextSentencePair,
  GradingResult,
  LegibilityIssue,
  LogicIssue,
  SentenceRevision,
  Task,
  UpgradedExpression,
} from '../../types'
import { getDynamicScoreBands } from '../../utils/gradingDiagnostics'
import {
  getClassOverviewStatsFromScores,
  selectCurrentClassReviewResults,
  type CurrentClassReviewExclusionReason,
} from '../../utils/classOverview'
import { classifyDefiniteSpellingCandidate } from './classReviewSpelling'
import type { IssueCounterIdV1, SynthesisIssueCounterV1 } from './types'

export type ClassReviewExclusionReason = CurrentClassReviewExclusionReason

export interface ClassReviewEssayExclusion {
  essayId: string
  reason: ClassReviewExclusionReason
}

export interface ClassReviewDimensionAggregate {
  dimensionId: string
  name: string
  averageScore: number
  medianScore: number
  maxScore: number
  normalizedPerformance: number
}

export interface ClassReviewScoreBandAggregate {
  bandId: string
  lowerInclusive: number
  upperInclusive: number
  essayCount: number
}

export interface ClassReviewIssueAggregate {
  fingerprint: string
  type: ErrorAnnotation['type'] | 'logic'
  subtype: LogicIssue['subType'] | null
  severity: 'low' | 'medium' | 'high'
  title: string
  originalText: string
  suggestionOrDiagnosis: string
  changeTypes: string[]
  distinctEssaySupport: number
  occurrenceCount: number
  essayIds: string[]
  mustCover: boolean
}

export interface ClassReviewClearSpellingAggregate {
  fingerprint: string
  sourceSubtype: 'spelling' | 'word_choice'
  originalWord: string
  correctedWord: string
  studentCount: number
  occurrenceCount: number
  essayIds: string[]
  anonymousExample: string | null
}

export interface ClassReviewAggregate {
  totalEssayCount: number
  includedEssayCount: number
  issueEligibleEssayCount: number
  excludedEssayCount: number
  partialIssueChannelCount: number
  exclusions: ClassReviewEssayExclusion[]
  fullScore: number
  scoreMedian: number | null
  scoreSummary: {
    averageScore: number
    highestScore: number
    lowestScore: number
  } | null
  scoreBands: ClassReviewScoreBandAggregate[]
  dimensions: ClassReviewDimensionAggregate[]
  fixedIssueCounters: SynthesisIssueCounterV1[]
  issueGroups: ClassReviewIssueAggregate[]
  commonIssueGroups: ClassReviewIssueAggregate[]
  clearSpellingItems: ClassReviewClearSpellingAggregate[]
}

type MutableIssueAggregate = Omit<
  ClassReviewIssueAggregate,
  'changeTypes' | 'distinctEssaySupport' | 'essayIds' | 'mustCover'
> & {
  changeTypes: Set<string>
  essayIds: Set<string>
  representativeKey: string
}

type MutableSpellingAggregate = Omit<
  ClassReviewClearSpellingAggregate,
  'studentCount' | 'essayIds'
> & {
  essayIds: Set<string>
  representativeKey: string
}

type IssueEligibleResult = {
  essay: Essay
  result: GradingResult & {
    errorAnnotations: ErrorAnnotation[]
    sentenceRevisions: SentenceRevision[]
    recognitionWarnings: string[]
    legibilityIssues: LegibilityIssue[]
  }
}

const ERROR_TYPES = new Set(['grammar', 'spelling', 'word_choice', 'structure'])
const SEVERITIES = new Set(['low', 'medium', 'high'])
const EVIDENCE_CERTAINTIES = new Set(['certain', 'uncertain'])
const FULL_TEXT_CHANGE_TYPES = new Set([
  'grammar',
  'spelling',
  'word_choice',
  'sentence_upgrade',
  'coherence',
  'logic_bridge',
  'delete_suggestion',
  'replace_sentence',
  'reference_clarification',
])
const LOGIC_SUBTYPES = new Set([
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
const LOGIC_ACTIONS = new Set([
  'add_connector',
  'add_bridge_sentence',
  'delete_sentence',
  'replace_sentence',
  'clarify_reference',
  'ask_student_to_explain',
])
const ISSUE_COUNTER_ORDER: readonly IssueCounterIdV1[] = [
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

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function compareCodePoints(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1
}

function normalizeVisible(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

function normalizeFingerprintText(value: string): string {
  return normalizeVisible(value).toLocaleLowerCase('en-US')
}

function stableTextKey(...parts: string[]): string {
  const visible = parts.map(normalizeVisible)
  return JSON.stringify([
    ...visible.map((part) => part.toLocaleLowerCase('en-US')),
    ...visible,
  ])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedText(value: unknown, maximumLength = 50_000): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximumLength
}

function isBoundedOptionalText(value: unknown, maximumLength = 50_000): value is string {
  return typeof value === 'string' && value.length <= maximumLength
}

function isBoundedStringArray(
  value: unknown,
  options: {
    maximumItems: number
    maximumLength: number
    minimumItems?: number
    unique?: boolean
  },
): value is string[] {
  if (
    !Array.isArray(value)
    || value.length < (options.minimumItems ?? 0)
    || value.length > options.maximumItems
    || !value.every((item) => isBoundedText(item, options.maximumLength))
  ) return false
  return options.unique !== true || new Set(value).size === value.length
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean'
}

function hasUniqueIds(items: readonly { id: string }[]): boolean {
  return new Set(items.map(({ id }) => id)).size === items.length
}

function isErrorAnnotation(value: unknown): value is ErrorAnnotation {
  return isRecord(value)
    && isBoundedText(value.id, 200)
    && typeof value.type === 'string'
    && ERROR_TYPES.has(value.type)
    && isBoundedText(value.original)
    && isBoundedText(value.suggestion)
    && isBoundedText(value.explanation)
    && typeof value.severity === 'string'
    && SEVERITIES.has(value.severity)
    && typeof value.evidenceCertainty === 'string'
    && EVIDENCE_CERTAINTIES.has(value.evidenceCertainty)
    && typeof value.needsTeacherReview === 'boolean'
}

function hasValidRelationAndChangeArrays(value: Record<string, unknown>): boolean {
  return isBoundedStringArray(value.relatedErrorIds, {
    maximumItems: 100,
    maximumLength: 200,
    unique: true,
  })
    && isBoundedStringArray(value.changeTypes, {
      maximumItems: 20,
      maximumLength: 64,
      minimumItems: 1,
      unique: true,
    })
    && value.changeTypes.every((item) => FULL_TEXT_CHANGE_TYPES.has(item))
}

function isSentenceRevision(value: unknown): value is SentenceRevision {
  return isRecord(value)
    && isBoundedText(value.id, 200)
    && hasValidRelationAndChangeArrays(value)
    && isBoundedText(value.original)
    && isBoundedText(value.revised)
    && isBoundedText(value.note)
    && isOptionalBoolean(value.needsTeacherReview)
}

function isSentencePair(value: unknown): value is FullTextSentencePair {
  return isRecord(value)
    && isBoundedText(value.id, 200)
    && hasValidRelationAndChangeArrays(value)
    && isBoundedText(value.original)
    && isBoundedText(value.corrected)
    && isBoundedText(value.polished)
    && isBoundedText(value.explanation)
    && typeof value.needsTeacherReview === 'boolean'
}

function isLogicIssue(value: unknown): value is LogicIssue {
  return isRecord(value)
    && isBoundedText(value.id, 200)
    && (value.sentenceId === undefined || isBoundedText(value.sentenceId, 200))
    && isBoundedText(value.original)
    && isBoundedOptionalText(value.contextBefore)
    && isBoundedOptionalText(value.contextAfter)
    && typeof value.subType === 'string'
    && LOGIC_SUBTYPES.has(value.subType)
    && typeof value.severity === 'string'
    && SEVERITIES.has(value.severity)
    && isBoundedText(value.diagnosis)
    && typeof value.suggestedAction === 'string'
    && LOGIC_ACTIONS.has(value.suggestedAction)
    && isBoundedText(value.conservativeSuggestion)
    && isBoundedText(value.polishedSuggestion)
    && typeof value.needsTeacherReview === 'boolean'
}

function isUpgradedExpression(value: unknown): value is UpgradedExpression {
  return isRecord(value)
    && isBoundedText(value.id, 200)
    && isBoundedText(value.original)
    && isBoundedText(value.upgraded)
    && isBoundedText(value.note)
    && isOptionalBoolean(value.needsTeacherReview)
}

function isLegibilityIssue(value: unknown, pageCount: number): value is LegibilityIssue {
  return isRecord(value)
    && isBoundedText(value.id, 200)
    && isBoundedText(value.transcriptText)
    && isBoundedStringArray(value.possibleReadings, {
      maximumItems: 4,
      maximumLength: 1_000,
      minimumItems: 2,
      unique: true,
    })
    && new Set(value.possibleReadings.map(normalizeFingerprintText)).size === value.possibleReadings.length
    && Number.isInteger(value.pageNumber)
    && (value.pageNumber as number) >= 1
    && (value.pageNumber as number) <= pageCount
    && isBoundedText(value.regionDescription)
    && isBoundedText(value.explanation)
    && value.defaultOutcome === 'count_as_legibility_error'
}

function hasCompleteIssueChannel(result: GradingResult, essay: Essay): boolean {
  const value = result as unknown as Record<string, unknown>
  if (
    value.resultVersion !== 'grading-result-v2'
    || (value.source !== 'mock' && value.source !== 'remote')
    || !isBoundedStringArray(value.reviewReasons, {
      maximumItems: 100,
      maximumLength: 50_000,
      unique: true,
    })
    || value.reviewReasons.length !== 0
    || !isBoundedText(value.transcript)
    || typeof value.printedTextExcluded !== 'boolean'
    || !isBoundedText(value.overallComment)
    || typeof value.teacherAdjusted !== 'boolean'
    || (value.aiConfidence !== undefined && (
      typeof value.aiConfidence !== 'number'
      || !Number.isFinite(value.aiConfidence)
      || value.aiConfidence < 0
      || value.aiConfidence > 1
    ))
    || (value.resultRevision !== undefined && (
      !Number.isSafeInteger(value.resultRevision)
      || (value.resultRevision as number) < 0
    ))
    || !isBoundedText(value.createdAt, 100)
    || !Number.isFinite(Date.parse(value.createdAt))
    || !isBoundedText(value.updatedAt, 100)
    || !Number.isFinite(Date.parse(value.updatedAt))
  ) return false

  if (
    !Array.isArray(value.errorAnnotations)
    || value.errorAnnotations.length > 100
    || !value.errorAnnotations.every(isErrorAnnotation)
    || !Array.isArray(value.sentenceRevisions)
    || value.sentenceRevisions.length > 100
    || !value.sentenceRevisions.every(isSentenceRevision)
    || !Array.isArray(value.upgradedExpressions)
    || value.upgradedExpressions.length > 100
    || !value.upgradedExpressions.every(isUpgradedExpression)
    || !isBoundedStringArray(value.recognitionWarnings, {
      maximumItems: 50,
      maximumLength: 1_000,
      unique: true,
    })
    || value.recognitionWarnings.length !== 0
    || !Array.isArray(value.legibilityIssues)
    || value.legibilityIssues.length > 50
    || !value.legibilityIssues.every((item) => isLegibilityIssue(item, essay.pageCount))
  ) return false

  if (!isRecord(value.fullTextRevision)) return false
  if (
    !isBoundedText(value.fullTextRevision.originalText)
    || value.fullTextRevision.originalText !== value.transcript
    || !isBoundedText(value.fullTextRevision.correctedText)
    || !isBoundedText(value.fullTextRevision.polishedText)
    || !Array.isArray(value.fullTextRevision.sentencePairs)
    || value.fullTextRevision.sentencePairs.length > 100
    || !value.fullTextRevision.sentencePairs.every(isSentencePair)
    || !Array.isArray(value.fullTextRevision.logicIssues)
    || value.fullTextRevision.logicIssues.length > 50
    || !value.fullTextRevision.logicIssues.every(isLogicIssue)
    || !isBoundedStringArray(value.fullTextRevision.logicNotes, {
      maximumItems: 100,
      maximumLength: 50_000,
      unique: true,
    })
  ) return false

  const idCollections = [
    value.errorAnnotations,
    value.sentenceRevisions,
    value.fullTextRevision.sentencePairs,
    value.fullTextRevision.logicIssues,
    value.upgradedExpressions,
    value.legibilityIssues,
  ] as Array<Array<{ id: string }>>
  if (idCollections.some((items) => !hasUniqueIds(items))) return false
  const allIds = idCollections.flatMap((items) => items.map(({ id }) => id))
  if (new Set(allIds).size !== allIds.length) return false

  const knownIssueIds = new Set([
    ...value.errorAnnotations.map(({ id }) => id),
    ...value.fullTextRevision.logicIssues.map(({ id }) => id),
  ])
  const linkedItems = [
    ...value.sentenceRevisions,
    ...value.fullTextRevision.sentencePairs,
  ]
  if (linkedItems.some(({ relatedErrorIds }) => (
    relatedErrorIds.some((id) => !knownIssueIds.has(id))
  ))) return false
  return true
}

function scoreDimensions(results: readonly GradingResult[]): ClassReviewDimensionAggregate[] {
  const dimensions = new Map<string, {
    name: string
    representativeKey: string
    scores: number[]
    maxScore: number
  }>()
  for (const result of results) {
    for (const dimension of result.dimensionScores) {
      const representativeKey = stableTextKey(dimension.name, String(dimension.maxScore))
      const current = dimensions.get(dimension.id)
      if (current) {
        current.scores.push(dimension.score)
        if (compareCodePoints(representativeKey, current.representativeKey) < 0) {
          current.name = normalizeVisible(dimension.name)
          current.maxScore = dimension.maxScore
          current.representativeKey = representativeKey
        }
      } else {
        dimensions.set(dimension.id, {
          name: normalizeVisible(dimension.name),
          representativeKey,
          scores: [dimension.score],
          maxScore: dimension.maxScore,
        })
      }
    }
  }
  return Array.from(dimensions.entries())
    .sort(([left], [right]) => compareCodePoints(left, right))
    .map(([dimensionId, dimension]) => {
      const scores = [...dimension.scores].sort((left, right) => left - right)
      const averageScore = roundToOneDecimal(
        scores.reduce((total, score) => total + score, 0) / scores.length,
      )
      return {
        dimensionId,
        name: dimension.name,
        averageScore,
        medianScore: median(scores) as number,
        maxScore: dimension.maxScore,
        normalizedPerformance: roundRatio(averageScore / dimension.maxScore),
      }
    })
}

function issueFingerprint(issue: ErrorAnnotation): string {
  return JSON.stringify([
    'class-review-issue-v1',
    issue.type,
    normalizeFingerprintText(issue.original),
    normalizeFingerprintText(issue.suggestion),
  ])
}

function logicFingerprint(issue: LogicIssue): string {
  return JSON.stringify([
    'class-review-issue-v1',
    'logic',
    issue.subType,
    normalizeFingerprintText(issue.diagnosis),
    normalizeFingerprintText(issue.conservativeSuggestion),
  ])
}

function severityRank(value: ClassReviewIssueAggregate['severity']): number {
  return value === 'high' ? 0 : value === 'medium' ? 1 : 2
}

function addIssueOccurrence(
  groups: Map<string, MutableIssueAggregate>,
  essayId: string,
  value: Omit<MutableIssueAggregate, 'essayIds' | 'occurrenceCount' | 'changeTypes'> & {
    changeTypes: readonly string[]
  },
): void {
  const current = groups.get(value.fingerprint)
  if (current) {
    current.occurrenceCount += 1
    current.essayIds.add(essayId)
    for (const changeType of value.changeTypes) current.changeTypes.add(changeType)
    if (severityRank(value.severity) < severityRank(current.severity)) {
      current.severity = value.severity
    }
    if (compareCodePoints(value.representativeKey, current.representativeKey) < 0) {
      current.representativeKey = value.representativeKey
      current.title = value.title
      current.originalText = value.originalText
      current.suggestionOrDiagnosis = value.suggestionOrDiagnosis
    }
    return
  }
  groups.set(value.fingerprint, {
    ...value,
    occurrenceCount: 1,
    changeTypes: new Set(value.changeTypes),
    essayIds: new Set([essayId]),
  })
}

export function classReviewSupportThreshold(issueEligibleEssayCount: number): number {
  const normalizedCount = Number.isSafeInteger(issueEligibleEssayCount) && issueEligibleEssayCount >= 0
    ? issueEligibleEssayCount
    : 0
  const minimumStudents = normalizedCount < 10 ? 2 : 3
  return Math.max(minimumStudents, Math.ceil(normalizedCount * 0.2))
}

export function aggregateClassReviewSnapshot(input: {
  task: Task
  essays: readonly Essay[]
  results: readonly GradingResult[]
}): ClassReviewAggregate {
  const taskEssays = input.essays.filter((essay) => essay.taskId === input.task.id)
  const selection = selectCurrentClassReviewResults({
    essays: taskEssays,
    results: input.results,
    task: input.task,
  })
  const includedResults = selection.included.map(({ result }) => result)
  const issueEligible = selection.included.filter(
    ({ essay, result }) => (
      essay.gradingRun?.status === 'success' && hasCompleteIssueChannel(result, essay)
    ),
  ) as IssueEligibleResult[]
  const exclusions = selection.exclusions
    .map<ClassReviewEssayExclusion>((exclusion) => exclusion)
    .sort((left, right) => (
      compareCodePoints(left.essayId, right.essayId)
      || compareCodePoints(left.reason, right.reason)
    ))
  const partialIssueChannelCount = selection.included.length - issueEligible.length

  const overview = getClassOverviewStatsFromScores(
    taskEssays.length,
    includedResults.map((result) => result.totalScore),
    input.task.fullScore,
  )
  const dynamicBands = getDynamicScoreBands(input.task.fullScore)
  const scoreBands = overview.bands.map((band, index) => ({
    bandId: `score-band-${index + 1}`,
    lowerInclusive: dynamicBands[index].min,
    upperInclusive: dynamicBands[index].max,
    essayCount: band.count,
  }))

  const issueGroups = new Map<string, MutableIssueAggregate>()
  const spellingGroups = new Map<string, MutableSpellingAggregate>()
  const issueCounters = new Map<IssueCounterIdV1, number>()
  const incrementCounter = (counterId: IssueCounterIdV1, count = 1): void => {
    issueCounters.set(counterId, (issueCounters.get(counterId) ?? 0) + count)
  }
  for (const { essay, result } of issueEligible) {
    const sentencePairs = result.fullTextRevision?.sentencePairs ?? []
    const logicIssues = result.fullTextRevision?.logicIssues ?? []
    for (const issue of result.errorAnnotations) {
      incrementCounter(issue.type)
      incrementCounter(`severity_${issue.severity}`)
      const definiteSpelling = classifyDefiniteSpellingCandidate({
        candidate: issue,
        errorAnnotations: result.errorAnnotations,
        sentenceRevisions: result.sentenceRevisions,
        sentencePairs,
        logicIssues,
        recognitionWarnings: result.recognitionWarnings,
        legibilityIssues: result.legibilityIssues,
      })
      if (definiteSpelling) {
        const originalWord = normalizeVisible(definiteSpelling.originalWord)
        const correctedWord = normalizeVisible(definiteSpelling.correctedWord)
        const anonymousExample = normalizeVisible(issue.original)
        const representativeKey = stableTextKey(originalWord, correctedWord, anonymousExample)
        const current = spellingGroups.get(definiteSpelling.fingerprint)
        if (current) {
          current.occurrenceCount += 1
          current.essayIds.add(essay.id)
          if (compareCodePoints(representativeKey, current.representativeKey) < 0) {
            current.originalWord = originalWord
            current.correctedWord = correctedWord
            current.anonymousExample = anonymousExample
            current.representativeKey = representativeKey
          }
        } else {
          spellingGroups.set(definiteSpelling.fingerprint, {
            fingerprint: definiteSpelling.fingerprint,
            sourceSubtype: definiteSpelling.sourceSubtype,
            originalWord,
            correctedWord,
            occurrenceCount: 1,
            essayIds: new Set([essay.id]),
            anonymousExample,
            representativeKey,
          })
        }
        continue
      }
      const title = normalizeVisible(issue.explanation)
      const originalText = normalizeVisible(issue.original)
      const suggestionOrDiagnosis = normalizeVisible(issue.suggestion)
      addIssueOccurrence(issueGroups, essay.id, {
        fingerprint: issueFingerprint(issue),
        type: issue.type,
        subtype: null,
        severity: issue.severity,
        title,
        originalText,
        suggestionOrDiagnosis,
        changeTypes: [issue.type],
        representativeKey: stableTextKey(title, originalText, suggestionOrDiagnosis),
      })
    }
    for (const logicIssue of logicIssues) {
      incrementCounter(`logic_${logicIssue.subType}`)
      incrementCounter(`severity_${logicIssue.severity}`)
      const title = normalizeVisible(logicIssue.diagnosis)
      const originalText = normalizeVisible(logicIssue.original)
      const suggestionOrDiagnosis = normalizeVisible(logicIssue.conservativeSuggestion)
      addIssueOccurrence(issueGroups, essay.id, {
        fingerprint: logicFingerprint(logicIssue),
        type: 'logic',
        subtype: logicIssue.subType,
        severity: logicIssue.severity,
        title,
        originalText,
        suggestionOrDiagnosis,
        changeTypes: [],
        representativeKey: stableTextKey(title, originalText, suggestionOrDiagnosis),
      })
    }
    if (result.legibilityIssues.length > 0) {
      incrementCounter('legibility', result.legibilityIssues.length)
    }
  }

  const requiredSupport = classReviewSupportThreshold(issueEligible.length)
  const finalizedIssueGroups = Array.from(issueGroups.values())
    .map<ClassReviewIssueAggregate>(({ essayIds, representativeKey: _representativeKey, changeTypes, ...group }) => ({
      ...group,
      changeTypes: Array.from(changeTypes).sort(compareCodePoints),
      distinctEssaySupport: essayIds.size,
      essayIds: Array.from(essayIds).sort(compareCodePoints),
      mustCover: essayIds.size >= requiredSupport,
    }))
    .sort((left, right) => (
      severityRank(left.severity) - severityRank(right.severity)
      || right.distinctEssaySupport - left.distinctEssaySupport
      || right.occurrenceCount - left.occurrenceCount
      || compareCodePoints(left.fingerprint, right.fingerprint)
    ))

  const clearSpellingItems = Array.from(spellingGroups.values())
    .map<ClassReviewClearSpellingAggregate>(({ essayIds, representativeKey: _representativeKey, ...item }) => ({
      ...item,
      studentCount: essayIds.size,
      essayIds: Array.from(essayIds).sort(compareCodePoints),
    }))
    .sort((left, right) => (
      right.studentCount - left.studentCount
      || right.occurrenceCount - left.occurrenceCount
      || compareCodePoints(left.fingerprint, right.fingerprint)
    ))

  return {
    totalEssayCount: taskEssays.length,
    includedEssayCount: includedResults.length,
    issueEligibleEssayCount: issueEligible.length,
    excludedEssayCount: exclusions.length,
    partialIssueChannelCount,
    exclusions,
    fullScore: input.task.fullScore,
    scoreMedian: median(includedResults.map((result) => result.totalScore)),
    scoreSummary: overview.averageScore === null
      ? null
      : {
          averageScore: overview.averageScore,
          highestScore: overview.highestScore as number,
          lowestScore: overview.lowestScore as number,
        },
    scoreBands,
    dimensions: scoreDimensions(includedResults),
    fixedIssueCounters: ISSUE_COUNTER_ORDER.flatMap((counterId) => {
      const count = issueCounters.get(counterId) ?? 0
      return count > 0 ? [{ counterId, count }] : []
    }),
    issueGroups: finalizedIssueGroups,
    commonIssueGroups: finalizedIssueGroups.filter((group) => group.mustCover),
    clearSpellingItems,
  }
}
