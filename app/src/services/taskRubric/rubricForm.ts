import type { RubricDimension } from '../../types'

export const DEFAULT_TASK_NAME = '作文批改任务'
export const LEGIBILITY_DIMENSION_ID = 'legibility'
export const TOTAL_WEIGHT_TOLERANCE = 0.001

export interface RubricFormValue {
  fullScore: number
  writingRequirement: string
  dimensions: readonly RubricDimension[]
}

export interface RubricDimensionErrors {
  id?: string
  name?: string
  description?: string
  weight?: string
}

export interface RubricValidity {
  valid: boolean
  totalWeight: number
  differenceFromHundred: number
  errors: {
    fullScore?: string
    writingRequirement?: string
    dimensions?: string
    dimensionItems: RubricDimensionErrors[]
  }
}

export function createDefaultRubricDimensions(): RubricDimension[] {
  return [
    { id: 'content', name: '内容与任务完成', weight: 40, description: '是否完整回应写作任务，内容是否切题、充分且有依据', deductionFocus: [], sourceEvidence: [] },
    { id: 'language', name: '语言质量', weight: 40, description: '语法、词汇、句式和表达是否准确、恰当且有变化', deductionFocus: [], sourceEvidence: [] },
    { id: 'structure', name: '结构与连贯', weight: 15, description: '文章组织、段落衔接和逻辑推进是否清楚自然', deductionFocus: [], sourceEvidence: [] },
    { id: LEGIBILITY_DIMENSION_ID, name: '卷面与可读性', weight: 5, description: '书写是否清楚，是否存在会改变语义或影响评分的重要字迹问题', deductionFocus: [], sourceEvidence: [] },
  ]
}

export function createOrdinaryRubricDimension(id: string): RubricDimension {
  return { id, name: '', description: '', weight: 1, deductionFocus: [], sourceEvidence: [] }
}

export function validateRubricForm({ fullScore, writingRequirement, dimensions }: RubricFormValue): RubricValidity {
  const dimensionItems: RubricDimensionErrors[] = dimensions.map(() => ({}))
  const errors: RubricValidity['errors'] = { dimensionItems }

  if (!Number.isInteger(fullScore) || fullScore < 1 || fullScore > 100) {
    errors.fullScore = '满分必须是 1 到 100 之间的整数。'
  }

  const trimmedRequirement = writingRequirement.trim()
  if (!trimmedRequirement) {
    errors.writingRequirement = '请填写写作要求。'
  } else if (trimmedRequirement.length > 10_000) {
    errors.writingRequirement = '写作要求不能超过 10000 个字符。'
  }

  if (dimensions.length < 2 || dimensions.length > 10) {
    errors.dimensions = '评分维度数量必须在 2 到 10 个之间。'
  }

  const ids = dimensions.map(({ id }) => id.trim())
  const idCounts = new Map<string, number>()
  ids.forEach((id) => idCounts.set(id, (idCounts.get(id) ?? 0) + 1))

  dimensions.forEach((dimension, index) => {
    const itemErrors = dimensionItems[index]!
    const id = dimension.id.trim()
    const name = dimension.name.trim()
    const description = dimension.description.trim()

    if (!id) {
      itemErrors.id = '维度 ID 不能为空。'
    } else if (id.length > 128) {
      itemErrors.id = '维度 ID 不能超过 128 个字符。'
    } else if ((idCounts.get(id) ?? 0) > 1) {
      itemErrors.id = '维度 ID 不能重复。'
    }

    if (!name) {
      itemErrors.name = '请填写维度名称。'
    } else if (name.length > 256) {
      itemErrors.name = '维度名称不能超过 256 个字符。'
    }

    if (!description) {
      itemErrors.description = '请填写维度说明。'
    } else if (description.length > 2_000) {
      itemErrors.description = '维度说明不能超过 2000 个字符。'
    }

    if (!Number.isFinite(dimension.weight) || dimension.weight <= 0 || dimension.weight > 100) {
      itemErrors.weight = '权重必须是大于 0 且不超过 100 的有限数字。'
    }
  })

  const legibilityCount = ids.filter((id) => id === LEGIBILITY_DIMENSION_ID).length
  if (legibilityCount !== 1) {
    errors.dimensions = '必须且只能保留一个卷面与可读性维度。'
  }
  if (ids.some((id) => id !== LEGIBILITY_DIMENSION_ID) === false) {
    errors.dimensions = '至少需要一个普通评分维度。'
  }

  const totalWeight = dimensions.reduce((total, { weight }) => total + weight, 0)
  // Keep the inclusive 0.001 rule stable at decimal boundaries without altering user-entered weights.
  const differenceFromHundred = Number(Math.abs(totalWeight - 100).toFixed(12))
  if (!Number.isFinite(totalWeight) || differenceFromHundred > TOTAL_WEIGHT_TOLERANCE) {
    errors.dimensions = '评分维度权重合计必须为 100%。'
  }

  const hasDimensionItemErrors = dimensionItems.some((item) => Object.keys(item).length > 0)
  return {
    valid: !errors.fullScore && !errors.writingRequirement && !errors.dimensions && !hasDimensionItemErrors,
    totalWeight,
    differenceFromHundred,
    errors,
  }
}
