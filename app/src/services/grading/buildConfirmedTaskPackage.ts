import type { RubricDimension, Task } from '../../types'
import {
  countUnicodeCodePoints,
  MAX_WRITING_REQUIREMENT_CODE_POINTS,
  validateRubricForm,
} from '../taskRubric/rubricForm'
import type { ConfirmedTaskPackageV2 } from './types'

const TOTAL_WEIGHT_TOLERANCE = 0.001
const LEGIBILITY_WEIGHT = 5

const validText = (value: unknown, max = 10_000) => typeof value === 'string'
  && value === value.trim()
  && value.length > 0
  && countUnicodeCodePoints(value) <= max
const validTextArray = (value: unknown, maxItems = 100, maxItemLength = 5_000) => Array.isArray(value) && value.length <= maxItems && value.every((item) => validText(item, maxItemLength))
const validWeights = (weights: number[]) => weights.length > 0
  && weights.every((weight) => Number.isFinite(weight) && weight > 0 && weight <= 100)
  && Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 100) <= TOTAL_WEIGHT_TOLERANCE

function trimUnique(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const trimmed = value?.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }

  return result
}

/**
 * Stable legacy-to-v2 map: prompt/type/source/openings plus writingGoal become materialSummary;
 * teacher requirements (or the manual-prompt fallback), excellentFocus, and excellentFeatures
 * become writingRequirements; deductionFocus and offTopicCriteria become constraints; review
 * triggers and teacher notes become reviewWarnings. All entries are trimmed and deduplicated.
 */
function legacyTaskText(task: Task) {
  const prompt = task.promptInfo
  if (!prompt) return null
  const rubric = task.rubricDraft
  const genreMaterial = prompt.writingGenre === 'continuation_writing'
    ? [
        prompt.continuationPrompt?.sourceText,
        prompt.continuationPrompt?.paragraph1Opening,
        prompt.continuationPrompt?.paragraph2Opening,
      ]
    : [prompt.practicalWritingType]
  const materialSummary = trimUnique([
    prompt.manualPromptText,
    ...genreMaterial,
    rubric?.writingGoal,
  ]).join('\n')
  const teacherRequirement = prompt.teacherRequirements?.trim() || prompt.manualPromptText
  const writingRequirements = trimUnique([
    teacherRequirement,
    prompt.excellentFocus,
    ...(rubric?.excellentFeatures ?? []),
  ])
  const constraints = trimUnique([
    prompt.deductionFocus,
    ...(rubric?.offTopicCriteria ?? []),
  ])
  const reviewWarnings = trimUnique([
    ...(rubric?.reviewTriggers ?? []),
    rubric?.teacherEditableNotes,
  ])

  return { materialSummary, writingRequirements, constraints, reviewWarnings }
}

function withLegibilityDimension(dimensions: RubricDimension[]): RubricDimension[] | null {
  const legibility = dimensions.filter(({ id }) => id === 'legibility')
  if (legibility.length > 1) return null
  if (legibility.length === 1) return dimensions.map((dimension) => ({ ...dimension }))
  return [
    ...dimensions.map((dimension) => ({ ...dimension, weight: dimension.weight * (100 - LEGIBILITY_WEIGHT) / 100 })),
    {
      id: 'legibility', name: 'Legibility', weight: LEGIBILITY_WEIGHT,
      description: 'Important handwriting ambiguity and readability.',
      deductionFocus: ['Important handwriting ambiguity that changes meaning or scoring.'],
      sourceEvidence: [],
    },
  ]
}

export function buildConfirmedTaskPackage(task: Task): ConfirmedTaskPackageV2 | null {
  const rubric = task.rubricDraft
  const source = task.materialContext ?? legacyTaskText(task)
  if (!validText(task.id, 128) || !validText(task.taskName, 2_000) || !Number.isInteger(task.fullScore) || task.fullScore < 1 || task.fullScore > 100 || rubric?.status !== 'confirmed' || !source) return null
  if (!validText(source.materialSummary, 20_000) || !validTextArray(source.writingRequirements, 50, MAX_WRITING_REQUIREMENT_CODE_POINTS) || source.writingRequirements.length < 1 || !validTextArray(source.constraints, 50) || !validTextArray(source.reviewWarnings, 50)) return null
  const dimensions = task.materialContext
    ? rubric.dimensions.map((dimension) => ({ ...dimension }))
    : withLegibilityDimension(rubric.dimensions)
  if (!dimensions) return null
  if (task.materialContext) {
    const validity = validateRubricForm({
      fullScore: task.fullScore,
      writingRequirement: source.writingRequirements[0] ?? '',
      dimensions,
    })
    if (!validity.valid) return null
  } else if (rubric.dimensions.length < 1 || rubric.dimensions.length > 10 || !validWeights(rubric.dimensions.map(({ weight }) => weight)) || dimensions.length > 10 || !validWeights(dimensions.map(({ weight }) => weight)) || new Set(dimensions.map(({ id }) => id)).size !== dimensions.length) {
    return null
  }
  if (dimensions.some((dimension) => !validText(dimension.id, 128) || !validText(dimension.name, 256) || !validText(dimension.description, 2_000) || !validTextArray(dimension.deductionFocus, 50, 1_000) || !validTextArray(dimension.sourceEvidence ?? [], 50, 5_000))) return null

  return {
    taskId: task.id,
    fullScore: task.fullScore,
    materialSummary: source.materialSummary,
    writingRequirements: [...source.writingRequirements],
    constraints: [...source.constraints],
    rubric: {
      taskName: task.taskName,
      materialSummary: source.materialSummary,
      writingRequirements: [...source.writingRequirements],
      constraints: [...source.constraints],
      dimensions: dimensions.map((dimension) => ({
        id: dimension.id, name: dimension.name, weight: dimension.weight, description: dimension.description,
        deductionFocus: [...dimension.deductionFocus], sourceEvidence: [...(dimension.sourceEvidence ?? [])],
      })),
      reviewWarnings: [...source.reviewWarnings],
    },
  }
}
