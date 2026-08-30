import type { ErrorAnnotation, Essay, GradingResult, LogicIssue, Task } from '../../types'
import { getDynamicScoreBands } from '../../utils/gradingDiagnostics'
import { getClassOverviewStatsFromScores } from '../../utils/classOverview'
import { classifyDefiniteSpellingCandidate } from './classReviewSpelling'

export type ClassReviewExclusionReason =
  | 'manual'
  | 'grading_not_successful'
  | 'missing_result'
  | 'ambiguous_result'
  | 'stale_generation'
  | 'invalid_result'

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
  'distinctEssaySupport' | 'essayIds' | 'mustCover'
> & { essayIds: Set<string> }

type MutableSpellingAggregate = Omit<
  ClassReviewClearSpellingAggregate,
  'studentCount' | 'essayIds'
> & { essayIds: Set<string> }

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function normalizeFingerprintText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US')
}

function isUsableResult(result: GradingResult, fullScore: number): boolean {
  if (!Number.isFinite(result.totalScore) || result.totalScore < 0 || result.totalScore > fullScore) {
    return false
  }
  return result.dimensionScores.every((dimension) => (
    Number.isFinite(dimension.score)
    && Number.isFinite(dimension.maxScore)
    && dimension.maxScore > 0
    && dimension.score >= 0
    && dimension.score <= dimension.maxScore
  ))
}

function scoreDimensions(results: readonly GradingResult[]): ClassReviewDimensionAggregate[] {
  const dimensions = new Map<string, {
    name: string
    scoreTotal: number
    maxScore: number
    count: number
  }>()
  for (const result of results) {
    for (const dimension of result.dimensionScores) {
      const current = dimensions.get(dimension.id)
      if (current) {
        current.scoreTotal += dimension.score
        current.count += 1
      } else {
        dimensions.set(dimension.id, {
          name: dimension.name,
          scoreTotal: dimension.score,
          maxScore: dimension.maxScore,
          count: 1,
        })
      }
    }
  }
  return Array.from(dimensions.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dimensionId, dimension]) => {
      const averageScore = roundToOneDecimal(dimension.scoreTotal / dimension.count)
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

function addIssueOccurrence(
  groups: Map<string, MutableIssueAggregate>,
  essayId: string,
  value: Omit<MutableIssueAggregate, 'essayIds' | 'occurrenceCount'>,
): void {
  const current = groups.get(value.fingerprint)
  if (current) {
    current.occurrenceCount += 1
    current.essayIds.add(essayId)
    return
  }
  groups.set(value.fingerprint, {
    ...value,
    occurrenceCount: 1,
    essayIds: new Set([essayId]),
  })
}

function severityRank(value: ClassReviewIssueAggregate['severity']): number {
  return value === 'high' ? 0 : value === 'medium' ? 1 : 2
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
  const resultsByEssayId = new Map<string, GradingResult[]>()
  for (const result of input.results) {
    const indexed = resultsByEssayId.get(result.essayId)
    if (indexed) indexed.push(result)
    else resultsByEssayId.set(result.essayId, [result])
  }

  const includedResults: GradingResult[] = []
  const issueEligible: Array<{ essay: Essay; result: GradingResult }> = []
  const exclusions: ClassReviewEssayExclusion[] = []
  let partialIssueChannelCount = 0

  for (const essay of taskEssays) {
    if (essay.status === 'manual') {
      exclusions.push({ essayId: essay.id, reason: 'manual' })
      continue
    }
    if (essay.status !== 'grading_ready' && essay.status !== 'completed') {
      exclusions.push({ essayId: essay.id, reason: 'grading_not_successful' })
      continue
    }
    if (essay.gradingRun && essay.gradingRun.status !== 'success' && essay.gradingRun.status !== 'partial') {
      exclusions.push({ essayId: essay.id, reason: 'grading_not_successful' })
      continue
    }

    const candidates = resultsByEssayId.get(essay.id) ?? []
    const matching = essay.aiResultId
      ? candidates.filter((result) => result.id === essay.aiResultId)
      : candidates
    if (matching.length === 0) {
      exclusions.push({ essayId: essay.id, reason: 'missing_result' })
      continue
    }
    if (matching.length !== 1) {
      exclusions.push({ essayId: essay.id, reason: 'ambiguous_result' })
      continue
    }

    const sourceGeneration = essay.sourceGeneration ?? 0
    const rubricGeneration = input.task.rubricGeneration ?? 0
    const capturedSourceGeneration = essay.gradingRun && 'sourceGeneration' in essay.gradingRun
      ? essay.gradingRun.sourceGeneration ?? 0
      : 0
    const capturedRubricGeneration = essay.gradingRun && 'rubricGeneration' in essay.gradingRun
      ? essay.gradingRun.rubricGeneration ?? 0
      : 0
    if (
      capturedSourceGeneration !== sourceGeneration
      || capturedRubricGeneration !== rubricGeneration
    ) {
      exclusions.push({ essayId: essay.id, reason: 'stale_generation' })
      continue
    }

    const currentResult = matching[0]
    if (!isUsableResult(currentResult, input.task.fullScore)) {
      exclusions.push({ essayId: essay.id, reason: 'invalid_result' })
      continue
    }
    includedResults.push(currentResult)
    if (essay.gradingRun?.status === 'success') {
      issueEligible.push({ essay, result: currentResult })
    } else {
      partialIssueChannelCount += 1
    }
  }

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
        const current = spellingGroups.get(definiteSpelling.fingerprint)
        if (current) {
          current.occurrenceCount += 1
          current.essayIds.add(essay.id)
        } else {
          spellingGroups.set(definiteSpelling.fingerprint, {
            fingerprint: definiteSpelling.fingerprint,
            sourceSubtype: definiteSpelling.sourceSubtype,
            originalWord: definiteSpelling.originalWord,
            correctedWord: definiteSpelling.correctedWord,
            occurrenceCount: 1,
            essayIds: new Set([essay.id]),
            anonymousExample: issue.original,
          })
        }
        continue
      }
      const fingerprint = issueFingerprint(issue)
      addIssueOccurrence(issueGroups, essay.id, {
        fingerprint,
        type: issue.type,
        subtype: null,
        severity: issue.severity,
        title: issue.explanation,
        originalText: issue.original,
        suggestionOrDiagnosis: issue.suggestion,
        changeTypes: [issue.type],
      })
    }
    for (const logicIssue of logicIssues) {
      const fingerprint = logicFingerprint(logicIssue)
      addIssueOccurrence(issueGroups, essay.id, {
        fingerprint,
        type: 'logic',
        subtype: logicIssue.subType,
        severity: logicIssue.severity,
        title: logicIssue.diagnosis,
        originalText: logicIssue.original,
        suggestionOrDiagnosis: logicIssue.conservativeSuggestion,
        changeTypes: [],
      })
    }
  }

  const requiredSupport = classReviewSupportThreshold(issueEligible.length)
  const finalizedIssueGroups = Array.from(issueGroups.values())
    .map<ClassReviewIssueAggregate>((group) => ({
      ...group,
      distinctEssaySupport: group.essayIds.size,
      essayIds: Array.from(group.essayIds).sort(),
      mustCover: group.essayIds.size >= requiredSupport,
    }))
    .sort((left, right) => (
      severityRank(left.severity) - severityRank(right.severity)
      || right.distinctEssaySupport - left.distinctEssaySupport
      || right.occurrenceCount - left.occurrenceCount
      || left.fingerprint.localeCompare(right.fingerprint)
    ))

  const clearSpellingItems = Array.from(spellingGroups.values())
    .map<ClassReviewClearSpellingAggregate>((item) => ({
      ...item,
      studentCount: item.essayIds.size,
      essayIds: Array.from(item.essayIds).sort(),
    }))
    .sort((left, right) => (
      right.studentCount - left.studentCount
      || right.occurrenceCount - left.occurrenceCount
      || normalizeFingerprintText(left.originalWord).localeCompare(
        normalizeFingerprintText(right.originalWord),
      )
      || left.fingerprint.localeCompare(right.fingerprint)
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
