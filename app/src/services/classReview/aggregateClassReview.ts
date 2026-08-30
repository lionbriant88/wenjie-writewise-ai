import type {
  ErrorAnnotation,
  Essay,
  FullTextSentencePair,
  GradingResult,
  LegibilityIssue,
  LogicIssue,
  SentenceRevision,
  Task,
} from '../../types'
import { getDynamicScoreBands } from '../../utils/gradingDiagnostics'
import {
  getClassOverviewStatsFromScores,
  selectCurrentClassReviewResults,
  type CurrentClassReviewExclusionReason,
} from '../../utils/classOverview'
import { classifyDefiniteSpellingCandidate } from './classReviewSpelling'

export type ClassReviewExclusionReason = CurrentClassReviewExclusionReason

export interface ClassReviewEssayExclusion {
  essayId: string
  reason: ClassReviewExclusionReason
}

export interface ClassReviewDimensionAggregate {
  dimensionId: string
  name: string
  averageScore: number
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
  scoreSummary: {
    averageScore: number
    highestScore: number
    lowestScore: number
  } | null
  scoreBands: ClassReviewScoreBandAggregate[]
  dimensions: ClassReviewDimensionAggregate[]
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

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean'
}

function isErrorAnnotation(value: unknown): value is ErrorAnnotation {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.type === 'string'
    && ERROR_TYPES.has(value.type)
    && typeof value.original === 'string'
    && typeof value.suggestion === 'string'
    && typeof value.explanation === 'string'
    && typeof value.severity === 'string'
    && SEVERITIES.has(value.severity)
    && typeof value.evidenceCertainty === 'string'
    && EVIDENCE_CERTAINTIES.has(value.evidenceCertainty)
    && isOptionalBoolean(value.needsTeacherReview)
}

function isSentenceRevision(value: unknown): value is SentenceRevision {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && isStringArray(value.relatedErrorIds)
    && typeof value.original === 'string'
    && typeof value.revised === 'string'
    && typeof value.note === 'string'
    && isStringArray(value.changeTypes)
    && value.changeTypes.every((item) => FULL_TEXT_CHANGE_TYPES.has(item))
    && isOptionalBoolean(value.needsTeacherReview)
}

function isSentencePair(value: unknown): value is FullTextSentencePair {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.original === 'string'
    && typeof value.corrected === 'string'
    && typeof value.polished === 'string'
    && isStringArray(value.relatedErrorIds)
    && isStringArray(value.changeTypes)
    && value.changeTypes.every((item) => FULL_TEXT_CHANGE_TYPES.has(item))
    && typeof value.explanation === 'string'
    && isOptionalBoolean(value.needsTeacherReview)
}

function isLogicIssue(value: unknown): value is LogicIssue {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && (value.sentenceId === undefined || typeof value.sentenceId === 'string')
    && typeof value.original === 'string'
    && typeof value.contextBefore === 'string'
    && typeof value.contextAfter === 'string'
    && typeof value.subType === 'string'
    && LOGIC_SUBTYPES.has(value.subType)
    && typeof value.severity === 'string'
    && SEVERITIES.has(value.severity)
    && typeof value.diagnosis === 'string'
    && typeof value.suggestedAction === 'string'
    && LOGIC_ACTIONS.has(value.suggestedAction)
    && typeof value.conservativeSuggestion === 'string'
    && typeof value.polishedSuggestion === 'string'
    && typeof value.needsTeacherReview === 'boolean'
}

function isLegibilityIssue(value: unknown): value is LegibilityIssue {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.transcriptText === 'string'
    && isStringArray(value.possibleReadings)
    && typeof value.pageNumber === 'number'
    && Number.isFinite(value.pageNumber)
    && typeof value.regionDescription === 'string'
    && typeof value.explanation === 'string'
    && value.defaultOutcome === 'count_as_legibility_error'
}

function hasCompleteIssueChannel(result: GradingResult): boolean {
  const value = result as unknown as Record<string, unknown>
  if (!Array.isArray(value.errorAnnotations) || !value.errorAnnotations.every(isErrorAnnotation)) {
    return false
  }
  if (new Set(value.errorAnnotations.map((item) => item.id)).size !== value.errorAnnotations.length) {
    return false
  }
  if (!Array.isArray(value.sentenceRevisions) || !value.sentenceRevisions.every(isSentenceRevision)) {
    return false
  }
  if (!Array.isArray(value.upgradedExpressions)) return false
  if (!isStringArray(value.recognitionWarnings)) return false
  if (!Array.isArray(value.legibilityIssues) || !value.legibilityIssues.every(isLegibilityIssue)) {
    return false
  }
  if (value.fullTextRevision !== undefined) {
    if (!isRecord(value.fullTextRevision)) return false
    if (
      typeof value.fullTextRevision.originalText !== 'string'
      || typeof value.fullTextRevision.correctedText !== 'string'
      || typeof value.fullTextRevision.polishedText !== 'string'
      || !Array.isArray(value.fullTextRevision.sentencePairs)
      || !value.fullTextRevision.sentencePairs.every(isSentencePair)
      || !Array.isArray(value.fullTextRevision.logicIssues)
      || !value.fullTextRevision.logicIssues.every(isLogicIssue)
      || !isStringArray(value.fullTextRevision.logicNotes)
    ) return false
  }
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
    ({ essay, result }) => essay.gradingRun?.status === 'success' && hasCompleteIssueChannel(result),
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
  for (const { essay, result } of issueEligible) {
    const sentencePairs = result.fullTextRevision?.sentencePairs ?? []
    const logicIssues = result.fullTextRevision?.logicIssues ?? []
    for (const issue of result.errorAnnotations) {
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
    scoreSummary: overview.averageScore === null
      ? null
      : {
          averageScore: overview.averageScore,
          highestScore: overview.highestScore as number,
          lowestScore: overview.lowestScore as number,
        },
    scoreBands,
    dimensions: scoreDimensions(includedResults),
    issueGroups: finalizedIssueGroups,
    commonIssueGroups: finalizedIssueGroups.filter((group) => group.mustCover),
    clearSpellingItems,
  }
}
