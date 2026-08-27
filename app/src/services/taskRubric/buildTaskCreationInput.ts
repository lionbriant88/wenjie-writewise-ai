import type {
  CreateTaskInput,
  RubricDimension,
  TaskMaterialContext,
  TaskMaterialProcessingStatus,
} from '../../types'
import {
  DEFAULT_TASK_NAME,
  type RubricValidity,
  validateRubricForm,
} from './rubricForm'

export interface BuildTaskCreationInputOptions {
  taskName: string
  fullScore: number
  writingRequirement: string
  dimensions: readonly RubricDimension[]
  source: 'teacher' | 'ai'
  analyzedMaterialContext?: TaskMaterialContext
  materialProcessingStatus: TaskMaterialProcessingStatus
}

export type BuildTaskCreationInputResult =
  | { ok: true; value: CreateTaskInput }
  | { ok: false; validity: RubricValidity; taskNameError?: string }

function trimUnique(values: readonly string[]): string[] {
  const seen = new Set<string>()
  return values.reduce<string[]>((items, value) => {
    const trimmed = value.trim()
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      items.push(trimmed)
    }
    return items
  }, [])
}

export function buildTaskMaterialContext(
  teacherWritingRequirement: string,
  analyzedMaterialContext?: TaskMaterialContext,
): TaskMaterialContext {
  const teacherRequirement = teacherWritingRequirement.trim()
  const analyzed = analyzedMaterialContext
  return {
    materialSummary: analyzed?.materialSummary.trim() || `教师确认的写作要求：${teacherRequirement}`,
    writingRequirements: trimUnique([teacherRequirement, ...(analyzed?.writingRequirements ?? [])]),
    constraints: trimUnique(analyzed?.constraints ?? []),
    reviewWarnings: [...(analyzed?.reviewWarnings ?? [])],
  }
}

export function buildTaskCreationInput(options: BuildTaskCreationInputOptions): BuildTaskCreationInputResult {
  const validity = validateRubricForm(options)
  const taskName = options.taskName.trim()
  const taskNameError = taskName.length > 2_000 ? '任务名称不能超过 2000 个字符。' : undefined

  if (!validity.valid || taskNameError) {
    return { ok: false, validity, taskNameError }
  }

  const writingGoal = options.writingRequirement.trim()
  return {
    ok: true,
    value: {
      taskName: taskName || DEFAULT_TASK_NAME,
      fullScore: options.fullScore,
      materialProcessingStatus: options.materialProcessingStatus,
      rubricDraft: {
        source: options.source,
        writingGoal,
        offTopicCriteria: [],
        dimensions: options.dimensions.map((dimension) => ({
          id: dimension.id.trim(),
          name: dimension.name.trim(),
          weight: dimension.weight,
          description: dimension.description.trim(),
          deductionFocus: [],
          sourceEvidence: [],
        })),
        excellentFeatures: [],
        reviewTriggers: [],
        status: 'confirmed',
      },
      materialContext: buildTaskMaterialContext(writingGoal, options.analyzedMaterialContext),
    },
  }
}
