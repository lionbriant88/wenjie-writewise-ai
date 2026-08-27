import type { TaskMaterialContextV1 } from './types.js'

export type { TaskMaterialContextV1 } from './types.js'

const CONTEXT_KEYS = ['materialSummary', 'writingRequirements', 'constraints', 'reviewWarnings'] as const
const INVALID_CONTEXT_MESSAGE = 'Task material context is invalid.'
const MAX_CONTEXT_ITEMS = 50
const MAX_CONTEXT_ITEM_LENGTH = 5_000
const MAX_WRITING_REQUIREMENT_LENGTH = 10_000

const contextItemSchema = {
  type: 'string',
  minLength: 1,
  maxLength: MAX_CONTEXT_ITEM_LENGTH,
  pattern: '\\S',
} as const

const writingRequirementSchema = {
  type: 'string',
  minLength: 1,
  maxLength: MAX_WRITING_REQUIREMENT_LENGTH,
  pattern: '\\S',
} as const

export const taskMaterialContextSchema = {
  type: 'object',
  additionalProperties: false,
  required: CONTEXT_KEYS,
  properties: {
    materialSummary: { type: 'string', minLength: 1, maxLength: 20_000, pattern: '\\S' },
    writingRequirements: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_CONTEXT_ITEMS,
      items: writingRequirementSchema,
    },
    constraints: {
      type: 'array',
      minItems: 0,
      maxItems: MAX_CONTEXT_ITEMS,
      items: contextItemSchema,
    },
    reviewWarnings: {
      type: 'array',
      minItems: 0,
      maxItems: MAX_CONTEXT_ITEMS,
      items: contextItemSchema,
    },
  },
} as const

export type TaskMaterialContextValidationResult =
  | { ok: true; value: TaskMaterialContextV1 }
  | {
      ok: false
      error: { code: 'provider_invalid_response'; message: string }
    }

function invalid(): TaskMaterialContextValidationResult {
  return {
    ok: false,
    error: { code: 'provider_invalid_response', message: INVALID_CONTEXT_MESSAGE },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value)
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key))
}

function readString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const rawLength = Array.from(value).length
  if (rawLength < 1 || rawLength > maxLength) return null
  const trimmed = value.trim()
  return trimmed.length >= 1 ? trimmed : null
}

function readStringArray(value: unknown, minimumItems: number, maxItemLength: number): string[] | null {
  if (!Array.isArray(value) || value.length < minimumItems || value.length > MAX_CONTEXT_ITEMS) return null
  const values = value.map((item) => readString(item, maxItemLength))
  return values.every((item): item is string => item !== null) ? values : null
}

export function validateTaskMaterialContext(value: unknown): TaskMaterialContextValidationResult {
  if (!isRecord(value) || !hasExactlyKeys(value, CONTEXT_KEYS)) return invalid()
  const materialSummary = readString(value.materialSummary, 20_000)
  const writingRequirements = readStringArray(value.writingRequirements, 1, MAX_WRITING_REQUIREMENT_LENGTH)
  const constraints = readStringArray(value.constraints, 0, MAX_CONTEXT_ITEM_LENGTH)
  const reviewWarnings = readStringArray(value.reviewWarnings, 0, MAX_CONTEXT_ITEM_LENGTH)
  if (!materialSummary || !writingRequirements || !constraints || !reviewWarnings) return invalid()

  return {
    ok: true,
    value: { materialSummary, writingRequirements, constraints, reviewWarnings },
  }
}

export function prioritizeTeacherWritingRequirement(
  context: TaskMaterialContextV1,
  teacherRequirement: string | undefined,
): TaskMaterialContextV1 {
  const prioritized: string[] = []
  const seen = new Set<string>()
  const teacher = teacherRequirement?.trim()
  if (teacher) {
    prioritized.push(teacher)
    seen.add(teacher)
  }
  for (const requirement of context.writingRequirements) {
    if (seen.has(requirement)) continue
    prioritized.push(requirement)
    seen.add(requirement)
    if (prioritized.length === MAX_CONTEXT_ITEMS) break
  }
  return {
    ...context,
    writingRequirements: prioritized,
    constraints: [...context.constraints],
    reviewWarnings: [...context.reviewWarnings],
  }
}
