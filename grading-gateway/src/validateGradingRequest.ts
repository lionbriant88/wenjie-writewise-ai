import { isValidRubricWeight } from '../../app/src/services/grading/scoringRules.js'
import type { GradingRequestV1, ValidationResult, WritingGenre } from './types.js'

type InternalResult<T> = { ok: true; value: T } | { ok: false; message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(record).every((key) => allowed.includes(key))
}

function readBoundedString(value: unknown, min: number, max: number) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length >= min && trimmed.length <= max ? trimmed : null
}

function readOptionalString(value: unknown, max: number): string | undefined | null {
  return value === undefined ? undefined : readBoundedString(value, 1, max)
}

function readStringArray(value: unknown, maxItems: number, maxItemLength: number) {
  if (!Array.isArray(value) || value.length > maxItems) return null
  const items = value.map((item) => readBoundedString(item, 1, maxItemLength))
  return items.every((item): item is string => item !== null) ? items : null
}

function fail<T>(message: string): InternalResult<T> {
  return { ok: false, message }
}

function optionalFields(values: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined))
}

function validatePrompt(value: unknown, writingGenre: WritingGenre): InternalResult<GradingRequestV1['task']['prompt']> {
  if (!isRecord(value)) return fail('题目要求无效。')
  const commonAllowed = ['writingGenre', 'teacherRequirements', 'deductionFocus', 'excellentFocus']
  const teacherRequirements = readOptionalString(value.teacherRequirements, 5_000)
  const deductionFocus = readOptionalString(value.deductionFocus, 5_000)
  const excellentFocus = readOptionalString(value.excellentFocus, 5_000)
  if (teacherRequirements === null || deductionFocus === null || excellentFocus === null) return fail('题目要求无效。')

  if (writingGenre === 'practical_writing') {
    if (!hasOnlyKeys(value, [...commonAllowed, 'taskRequirement', 'practicalWritingType'])) return fail('题目要求包含不允许的字段。')
    if (value.writingGenre !== writingGenre) return fail('题目类型不一致。')
    const taskRequirement = readBoundedString(value.taskRequirement, 1, 20_000)
    const practicalWritingType = readOptionalString(value.practicalWritingType, 256)
    if (!taskRequirement || practicalWritingType === null) return fail('应用文题目要求不完整。')
    return {
      ok: true,
      value: {
        writingGenre,
        taskRequirement,
        ...optionalFields({ practicalWritingType, teacherRequirements, deductionFocus, excellentFocus }),
      },
    }
  }

  if (!hasOnlyKeys(value, [...commonAllowed, 'sourceText', 'paragraph1Opening', 'paragraph2Opening'])) {
    return fail('题目要求包含不允许的字段。')
  }
  if (value.writingGenre !== writingGenre) return fail('题目类型不一致。')
  const sourceText = readBoundedString(value.sourceText, 1, 50_000)
  const paragraph1Opening = readBoundedString(value.paragraph1Opening, 1, 5_000)
  const paragraph2Opening = readBoundedString(value.paragraph2Opening, 1, 5_000)
  if (!sourceText || !paragraph1Opening || !paragraph2Opening) return fail('读后续写题目信息不完整。')
  return {
    ok: true,
    value: {
      writingGenre,
      sourceText,
      paragraph1Opening,
      paragraph2Opening,
      ...optionalFields({ teacherRequirements, deductionFocus, excellentFocus }),
    },
  }
}

function validateDimension(value: unknown): InternalResult<GradingRequestV1['task']['rubric']['dimensions'][number]> {
  if (!isRecord(value) || !hasOnlyKeys(value, ['id', 'name', 'weight', 'description', 'deductionFocus'])) {
    return fail('评分维度包含不允许的字段。')
  }
  const id = readBoundedString(value.id, 1, 128)
  const name = readBoundedString(value.name, 1, 256)
  const description = readBoundedString(value.description, 1, 2_000)
  const deductionFocus = readStringArray(value.deductionFocus, 50, 1_000)
  if (!id || !name || !description || !deductionFocus || typeof value.weight !== 'number' || !isValidRubricWeight(value.weight)) {
    return fail('评分维度无效。')
  }
  return { ok: true, value: { id, name, weight: value.weight, description, deductionFocus } }
}

function validateRubric(value: unknown): InternalResult<GradingRequestV1['task']['rubric']> {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'status', 'writingGoal', 'offTopicCriteria', 'dimensions', 'excellentFeatures',
    'reviewTriggers', 'teacherEditableNotes',
  ])) return fail('评分标准包含不允许的字段。')
  if (value.status !== 'confirmed') return fail('评分标准尚未确认。')
  const writingGoal = readBoundedString(value.writingGoal, 1, 2_000)
  const offTopicCriteria = readStringArray(value.offTopicCriteria, 50, 1_000)
  const excellentFeatures = readStringArray(value.excellentFeatures, 50, 1_000)
  const reviewTriggers = readStringArray(value.reviewTriggers, 50, 1_000)
  const teacherEditableNotes = readOptionalString(value.teacherEditableNotes, 5_000)
  if (
    !writingGoal || !offTopicCriteria || !excellentFeatures || !reviewTriggers
    || teacherEditableNotes === null || !Array.isArray(value.dimensions)
    || value.dimensions.length < 1 || value.dimensions.length > 20
  ) return fail('评分标准无效。')
  const dimensions: GradingRequestV1['task']['rubric']['dimensions'] = []
  for (const item of value.dimensions) {
    const result = validateDimension(item)
    if (!result.ok) return result
    dimensions.push(result.value)
  }
  const ids = dimensions.map(({ id }) => id)
  if (new Set(ids).size !== ids.length) return fail('评分维度 ID 不可重复。')
  if (dimensions.reduce((sum, { weight }) => sum + weight, 0) !== 100) return fail('评分维度权重合计必须为 100。')
  return {
    ok: true,
    value: {
      status: 'confirmed', writingGoal, offTopicCriteria, dimensions, excellentFeatures, reviewTriggers,
      ...(teacherEditableNotes === undefined ? {} : { teacherEditableNotes }),
    },
  }
}

function validateTask(value: unknown): InternalResult<GradingRequestV1['task']> {
  if (!isRecord(value) || !hasOnlyKeys(value, ['taskId', 'writingGenre', 'fullScore', 'prompt', 'rubric'])) {
    return fail('题目信息包含不允许的字段。')
  }
  const taskId = readBoundedString(value.taskId, 1, 128)
  const writingGenre = value.writingGenre === 'practical_writing' || value.writingGenre === 'continuation_writing'
    ? value.writingGenre
    : null
  if (!taskId || !writingGenre || !Number.isInteger(value.fullScore) || typeof value.fullScore !== 'number' || value.fullScore < 1 || value.fullScore > 100) {
    return fail('题目信息无效。')
  }
  const prompt = validatePrompt(value.prompt, writingGenre)
  const rubric = validateRubric(value.rubric)
  if (!prompt.ok) return prompt
  if (!rubric.ok) return rubric
  return { ok: true, value: { taskId, writingGenre, fullScore: value.fullScore, prompt: prompt.value, rubric: rubric.value } }
}

function validateOcrContext(value: unknown): InternalResult<GradingRequestV1['essay']['ocrContext']> {
  if (!isRecord(value) || !hasOnlyKeys(value, ['sourceKind', 'hasKnownOcrRisk', 'riskCodes'])) {
    return fail('OCR 上下文包含不允许的字段。')
  }
  const sourceKind = value.sourceKind === 'mock' || value.sourceKind === 'remote' || value.sourceKind === 'manual'
    ? value.sourceKind
    : null
  const riskCodes = readStringArray(value.riskCodes, 50, 128)
  if (!sourceKind || typeof value.hasKnownOcrRisk !== 'boolean' || !riskCodes) return fail('OCR 上下文无效。')
  return { ok: true, value: { sourceKind, hasKnownOcrRisk: value.hasKnownOcrRisk, riskCodes } }
}

function validateEssay(value: unknown): InternalResult<GradingRequestV1['essay']> {
  if (!isRecord(value) || !hasOnlyKeys(value, ['essayId', 'confirmedTranscript', 'ocrContext'])) {
    return fail('作文信息包含不允许的字段。')
  }
  const essayId = readBoundedString(value.essayId, 1, 128)
  const confirmedTranscript = readBoundedString(value.confirmedTranscript, 1, 20_000)
  const ocrContext = validateOcrContext(value.ocrContext)
  if (!essayId || !confirmedTranscript || !ocrContext.ok) return fail(ocrContext.ok ? '作文信息无效。' : ocrContext.message)
  return { ok: true, value: { essayId, confirmedTranscript, ocrContext: ocrContext.value } }
}

function invalid(message: string): ValidationResult<GradingRequestV1> {
  return { ok: false, error: { code: 'invalid_request', message } }
}

export function validateGradingRequest(value: unknown): ValidationResult<GradingRequestV1> {
  if (!isRecord(value) || !hasOnlyKeys(value, ['requestVersion', 'requestId', 'task', 'essay'])) {
    return invalid('批改请求包含不允许的字段。')
  }
  if (value.requestVersion !== 'grading-request-v1') return invalid('批改请求版本不受支持。')
  const requestId = readBoundedString(value.requestId, 1, 128)
  const task = validateTask(value.task)
  const essay = validateEssay(value.essay)
  if (!requestId || !task.ok || !essay.ok) {
    return invalid(!task.ok ? task.message : !essay.ok ? essay.message : '批改请求无效。')
  }
  return {
    ok: true,
    value: { requestVersion: 'grading-request-v1', requestId, task: task.value, essay: essay.value },
  }
}
