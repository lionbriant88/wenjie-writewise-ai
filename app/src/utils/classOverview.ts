import type { Essay, GradingResult, Task } from '../types'
import {
  calculateDimensionMaxScore,
  calculateTotalScore,
  capTotalScoreForVisibleLegibilityDeduction,
  hasValidRubricWeights,
} from '../services/grading/scoringRules'
import { validateRubricForm } from '../services/taskRubric/rubricForm'
import { getDynamicScoreBands } from './gradingDiagnostics'

export interface ClassOverviewBand {
  label: string
  count: number
  percent: number
}

export interface ClassOverviewStats {
  totalEssayCount: number
  scoredEssayCount: number
  averageScore: number | null
  highestScore: number | null
  lowestScore: number | null
  bands: ClassOverviewBand[]
}

export type CurrentClassReviewExclusionReason =
  | 'manual'
  | 'grading_not_successful'
  | 'missing_result'
  | 'ambiguous_result'
  | 'stale_generation'
  | 'invalid_result'

export interface CurrentClassReviewResult {
  essay: Essay
  result: GradingResult
}

export interface CurrentClassReviewSelection {
  included: CurrentClassReviewResult[]
  exclusions: Array<{ essayId: string; reason: CurrentClassReviewExclusionReason }>
}

type ClassOverviewTask = Pick<Task, 'fullScore' | 'rubricGeneration' | 'rubricDraft'>

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isBoundedText(value: unknown, maximumLength: number): value is string {
  return isNonEmptyString(value) && value.length <= maximumLength
}

export function hasUsableClassReviewScoreChannel(
  value: unknown,
  task: ClassOverviewTask,
  requireRubricCorrespondence = true,
): value is GradingResult {
  if (!isRecord(value)) return false
  if (!Number.isFinite(task.fullScore) || task.fullScore <= 0) return false
  if (!isBoundedText(value.id, 200) || !isBoundedText(value.essayId, 200)) return false
  if (
    typeof value.totalScore !== 'number'
    || !Number.isFinite(value.totalScore)
    || value.totalScore < 0
    || value.totalScore > task.fullScore
  ) return false
  if (!Array.isArray(value.dimensionScores) || value.dimensionScores.length === 0) return false

  const dimensionIds = new Set<string>()
  const dimensionWeights: number[] = []
  const dimensionScores: number[] = []
  for (const dimension of value.dimensionScores) {
    if (!isRecord(dimension)) return false
    if (!isBoundedText(dimension.id, 200) || dimensionIds.has(dimension.id)) return false
    dimensionIds.add(dimension.id)
    if (!isBoundedText(dimension.name, 200)) return false
    if (
      typeof dimension.score !== 'number'
      || !Number.isFinite(dimension.score)
      || typeof dimension.maxScore !== 'number'
      || !Number.isFinite(dimension.maxScore)
      || dimension.maxScore <= 0
      || dimension.maxScore > task.fullScore
      || dimension.score < 0
      || dimension.score > dimension.maxScore
      || typeof dimension.weight !== 'number'
      || !Number.isFinite(dimension.weight)
      || dimension.maxScore !== calculateDimensionMaxScore(task.fullScore, dimension.weight)
      || !isBoundedText(dimension.reason, 50_000)
      || !isBoundedText(dimension.evidence, 50_000)
      || (dimension.needsTeacherReview !== undefined
        && typeof dimension.needsTeacherReview !== 'boolean')
    ) return false
    dimensionWeights.push(dimension.weight)
    dimensionScores.push(dimension.score)
  }
  if (!hasValidRubricWeights(dimensionWeights)) return false

  const roundedTotal = calculateTotalScore(dimensionScores, task.fullScore)
  const legibilityDimension = value.dimensionScores.find((dimension) => (
    isRecord(dimension) && dimension.id === 'legibility'
  )) as Record<string, unknown> | undefined
  const expectedTotal = legibilityDimension
    ? capTotalScoreForVisibleLegibilityDeduction(
        roundedTotal,
        task.fullScore,
        legibilityDimension.score as number,
        legibilityDimension.maxScore as number,
        Array.isArray(value.legibilityIssues) && value.legibilityIssues.length > 0,
      )
    : roundedTotal
  if (value.totalScore !== expectedTotal) return false

  if (
    requireRubricCorrespondence
    && (
      !task.rubricDraft
      || task.rubricDraft.status !== 'confirmed'
      || !Array.isArray(task.rubricDraft.dimensions)
      || !validateRubricForm({
        fullScore: task.fullScore,
        writingRequirement: task.rubricDraft.writingGoal,
        dimensions: task.rubricDraft.dimensions,
      }).valid
    )
  ) return false
  const rubricDimensions = requireRubricCorrespondence
    ? task.rubricDraft!.dimensions
    : null
  if (rubricDimensions) {
    if (
      !hasValidRubricWeights(rubricDimensions.map(({ weight }) => weight))
      || rubricDimensions.length !== value.dimensionScores.length
    ) return false
    for (const [index, rubricDimension] of rubricDimensions.entries()) {
      const dimension = value.dimensionScores[index] as Record<string, unknown>
      if (
        dimension.id !== rubricDimension.id
        || dimension.name !== rubricDimension.name
        || dimension.weight !== rubricDimension.weight
        || dimension.maxScore !== calculateDimensionMaxScore(task.fullScore, rubricDimension.weight)
      ) return false
    }
  }
  return true
}

export function selectCurrentClassReviewResults(input: {
  essays: readonly Essay[]
  results: readonly GradingResult[]
  task: ClassOverviewTask
}): CurrentClassReviewSelection {
  const resultsByEssayId = new Map<string, GradingResult[]>()
  for (const result of input.results) {
    if (!isRecord(result) || typeof result.essayId !== 'string') continue
    const current = resultsByEssayId.get(result.essayId)
    if (current) current.push(result)
    else resultsByEssayId.set(result.essayId, [result])
  }

  const included: CurrentClassReviewResult[] = []
  const exclusions: CurrentClassReviewSelection['exclusions'] = []
  for (const essay of input.essays) {
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

    const capturedSourceGeneration = essay.gradingRun && 'sourceGeneration' in essay.gradingRun
      ? essay.gradingRun.sourceGeneration ?? 0
      : 0
    const capturedRubricGeneration = essay.gradingRun && 'rubricGeneration' in essay.gradingRun
      ? essay.gradingRun.rubricGeneration ?? 0
      : 0
    if (
      capturedSourceGeneration !== (essay.sourceGeneration ?? 0)
      || capturedRubricGeneration !== (input.task.rubricGeneration ?? 0)
    ) {
      exclusions.push({ essayId: essay.id, reason: 'stale_generation' })
      continue
    }

    if (!hasUsableClassReviewScoreChannel(matching[0], input.task, essay.gradingRun !== undefined)) {
      exclusions.push({ essayId: essay.id, reason: 'invalid_result' })
      continue
    }
    included.push({ essay, result: matching[0] })
  }
  return { included, exclusions }
}

export function getClassOverviewStats(
  essays: readonly Essay[],
  gradingResults: readonly GradingResult[],
  task: ClassOverviewTask,
): ClassOverviewStats {
  const selection = selectCurrentClassReviewResults({ essays, results: gradingResults, task })
  return getClassOverviewStatsFromScores(
    essays.length,
    selection.included.map(({ result }) => result.totalScore),
    task.fullScore,
  )
}

export function getClassOverviewStatsFromScores(
  totalEssayCount: number,
  scores: readonly number[],
  fullScore: number,
): ClassOverviewStats {
  const stableScores = [...scores].sort((left, right) => left - right)
  const bands = getDynamicScoreBands(fullScore).map<ClassOverviewBand>((band) => {
    const count = stableScores.filter((score) => {
      const roundedScore = Math.round(score)
      return roundedScore >= band.min && roundedScore <= band.max
    }).length

    return {
      label: band.label,
      count,
      percent: stableScores.length > 0 ? Math.round((count / stableScores.length) * 100) : 0,
    }
  })

  if (stableScores.length === 0) {
    return {
      totalEssayCount,
      scoredEssayCount: 0,
      averageScore: null,
      highestScore: null,
      lowestScore: null,
      bands,
    }
  }

  return {
    totalEssayCount,
    scoredEssayCount: stableScores.length,
    averageScore: roundToOneDecimal(
      stableScores.reduce((sum, score) => sum + score, 0) / stableScores.length,
    ),
    highestScore: roundToOneDecimal(Math.max(...stableScores)),
    lowestScore: roundToOneDecimal(Math.min(...stableScores)),
    bands,
  }
}
