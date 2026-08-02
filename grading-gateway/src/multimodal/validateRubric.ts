import type { ValidationResult } from '../types.js'
import type { GeneratedRubricDimensionV1, GeneratedRubricV1 } from './types.js'

const INVALID_RUBRIC_MESSAGE = '璇勫垎鏍囧噯鏃犳晥銆?'
const INVALID_WEIGHT_TOTAL_MESSAGE = '璇勫垎鏍囧噯鏉冮噸蹇呴』鍚堣 100%銆?'
const TOTAL_WEIGHT_TOLERANCE = 0.001

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function readString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null
}

function readStringArray(value: unknown, maxItems: number, maxItemLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null
  const items = value.map((item) => readString(item, maxItemLength))
  return items.every((item): item is string => item !== null) ? items : null
}

function readDimension(value: unknown): GeneratedRubricDimensionV1 | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['id', 'name', 'weight', 'description', 'deductionFocus', 'sourceEvidence'])) {
    return null
  }
  const id = readString(value.id, 128)
  const name = readString(value.name, 256)
  const description = readString(value.description, 2_000)
  const deductionFocus = readStringArray(value.deductionFocus, 50, 1_000)
  const sourceEvidence = readStringArray(value.sourceEvidence, 50, 5_000)
  if (!id || !name || !description || !deductionFocus || !sourceEvidence || typeof value.weight !== 'number' || !Number.isFinite(value.weight) || value.weight <= 0) {
    return null
  }
  return { id, name, weight: value.weight, description, deductionFocus, sourceEvidence }
}

function invalid<T>(message = INVALID_RUBRIC_MESSAGE): ValidationResult<T> {
  return { ok: false, error: { code: 'provider_invalid_response', message } }
}

export function validateGeneratedRubric(value: unknown): ValidationResult<GeneratedRubricV1> {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'taskName', 'materialSummary', 'writingRequirements', 'constraints', 'dimensions', 'reviewWarnings',
  ])) return invalid()

  const taskName = readString(value.taskName, 2_000)
  const materialSummary = readString(value.materialSummary, 20_000)
  const writingRequirements = readStringArray(value.writingRequirements, 50, 5_000)
  const constraints = readStringArray(value.constraints, 50, 5_000)
  const reviewWarnings = readStringArray(value.reviewWarnings, 50, 5_000)
  if (!taskName || !materialSummary || !writingRequirements || !constraints || !reviewWarnings || !Array.isArray(value.dimensions) || value.dimensions.length < 1 || value.dimensions.length > 10) {
    return invalid()
  }

  const dimensions = value.dimensions.map(readDimension)
  if (!dimensions.every((dimension): dimension is GeneratedRubricDimensionV1 => dimension !== null)) return invalid()
  if (new Set(dimensions.map((dimension) => dimension.id)).size !== dimensions.length) return invalid()
  if (Math.abs(dimensions.reduce((sum, dimension) => sum + dimension.weight, 0) - 100) > TOTAL_WEIGHT_TOLERANCE) {
    return invalid(INVALID_WEIGHT_TOTAL_MESSAGE)
  }

  return { ok: true, value: { taskName, materialSummary, writingRequirements, constraints, dimensions, reviewWarnings } }
}
