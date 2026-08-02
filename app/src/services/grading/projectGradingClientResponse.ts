import type { FullTextChangeType } from '../../types'
import type {
  AiGradingResultV1,
  GradingClientResponse,
  GradingErrorCode,
  GradingFailureV1,
} from './types'

interface ExpectedGradingResponse {
  httpOk: boolean
  requestId: string
  essayId: string
  requireMultimodal?: boolean
}

const safeMessages: Record<GradingErrorCode, string> = {
  invalid_request: '批改请求无效。', confirmed_transcript_required: '请先确认作文文本。', unsupported_genre: '当前任务类型暂不支持。', provider_not_configured: '批改服务尚未配置。', provider_request_rejected: '批改请求未被服务接受。', provider_auth_failed: '批改服务认证失败。', provider_balance_unavailable: '批改服务额度暂不可用。', provider_rate_limited: '批改服务繁忙，请稍后重试。', provider_timeout: '批改服务响应超时，请重试。', provider_unavailable: '批改服务暂时不可用，请重试。', provider_content_filtered: '内容暂时无法处理。', provider_unexpected_tool_call: '批改服务返回了无法使用的结果。', provider_invalid_response: '批改服务返回了无法使用的结果。', request_too_large: '上传内容超过允许限制。', gateway_invalid_response: '批改服务返回了无法安全使用的响应，请重试或使用 mock 回退。', gateway_unavailable: '批改服务暂时不可用，请重试或使用 mock 回退。',
}

const providers = new Set(['mock', 'remote'])
const successStatuses = new Set(['success', 'partial'])
const issueTypes = new Set(['grammar', 'spelling', 'word_choice', 'structure'])
const severities = new Set(['low', 'medium', 'high'])
const changeTypes = new Set<FullTextChangeType>([
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
const errorCodes = new Set<GradingErrorCode>([
  'invalid_request',
  'confirmed_transcript_required',
  'unsupported_genre',
  'provider_not_configured',
  'provider_request_rejected',
  'provider_auth_failed',
  'provider_balance_unavailable',
  'provider_rate_limited',
  'provider_timeout',
  'provider_unavailable',
  'provider_content_filtered',
  'provider_unexpected_tool_call',
  'provider_invalid_response',
  'request_too_large',
  'gateway_invalid_response',
  'gateway_unavailable',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function readFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : null
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return null
  const strings = value.map(readString)
  return strings.every((item): item is string => item !== null) ? strings : null
}

function projectArray<T>(value: unknown, projector: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null
  const projected = value.map(projector)
  return projected.every((item): item is T => item !== null) ? projected : null
}

function projectDimensionScore(value: unknown): AiGradingResultV1['dimensionScores'][number] | null {
  if (!isRecord(value)) return null
  const dimensionId = readString(value.dimensionId)
  const name = readString(value.name)
  const score = readFiniteNumber(value.score)
  const maxScore = readFiniteNumber(value.maxScore)
  const weight = readFiniteNumber(value.weight)
  const reason = readString(value.reason)
  const evidence = readString(value.evidence)
  if (!dimensionId || !name || score === null || maxScore === null || weight === null || !reason || !evidence) return null
  if ('requiresTeacherReview' in value && typeof value.requiresTeacherReview !== 'boolean') return null
  return { dimensionId, name, score, maxScore, weight, reason, evidence, ...('requiresTeacherReview' in value ? { requiresTeacherReview: value.requiresTeacherReview as boolean } : {}) }
}

function projectIssue(value: unknown): AiGradingResultV1['issues'][number] | null {
  if (!isRecord(value)) return null
  const id = readString(value.id)
  const type = readString(value.type)
  const severity = readString(value.severity)
  const originalText = readString(value.originalText)
  const suggestion = readString(value.suggestion)
  const explanation = readString(value.explanation)
  const requiresTeacherReview = readBoolean(value.requiresTeacherReview)
  if (
    !id || !type || !issueTypes.has(type) || !severity || !severities.has(severity)
    || !originalText || !suggestion || !explanation || requiresTeacherReview === null
  ) return null
  return {
    id,
    type: type as AiGradingResultV1['issues'][number]['type'],
    severity: severity as AiGradingResultV1['issues'][number]['severity'],
    originalText,
    suggestion,
    explanation,
    requiresTeacherReview,
  }
}

function projectSentenceRevision(value: unknown): AiGradingResultV1['sentenceRevisions'][number] | null {
  if (!isRecord(value)) return null
  const id = readString(value.id)
  const originalText = readString(value.originalText)
  const revisedText = readString(value.revisedText)
  const note = readString(value.note)
  if (!id || !originalText || !revisedText || !note) return null
  if ('requiresTeacherReview' in value && typeof value.requiresTeacherReview !== 'boolean') return null
  const review = 'requiresTeacherReview' in value ? { requiresTeacherReview: value.requiresTeacherReview as boolean } : {}
  if ('relatedIssueId' in value) {
    const relatedIssueId = readString(value.relatedIssueId)
    return relatedIssueId ? { id, relatedIssueId, originalText, revisedText, note, ...review } : null
  }
  return { id, originalText, revisedText, note, ...review }
}

function projectExpressionUpgrade(value: unknown): AiGradingResultV1['expressionUpgrades'][number] | null {
  if (!isRecord(value)) return null
  const id = readString(value.id)
  const originalText = readString(value.originalText)
  const upgradedText = readString(value.upgradedText)
  const note = readString(value.note)
  if ('requiresTeacherReview' in value && typeof value.requiresTeacherReview !== 'boolean') return null
  return id && originalText && upgradedText && note ? { id, originalText, upgradedText, note, ...('requiresTeacherReview' in value ? { requiresTeacherReview: value.requiresTeacherReview as boolean } : {}) } : null
}

function projectSentencePair(
  value: unknown,
): NonNullable<AiGradingResultV1['fullTextRevision']>['sentencePairs'][number] | null {
  if (!isRecord(value)) return null
  const id = readString(value.id)
  const originalText = readString(value.originalText)
  const correctedText = readString(value.correctedText)
  const improvedText = readString(value.improvedText)
  const explanation = readString(value.explanation)
  const requiresTeacherReview = readBoolean(value.requiresTeacherReview)
  if (!Array.isArray(value.changeTypes)) return null
  const projectedChangeTypes: FullTextChangeType[] = []
  for (const item of value.changeTypes) {
    if (typeof item !== 'string' || !changeTypes.has(item as FullTextChangeType)) return null
    projectedChangeTypes.push(item as FullTextChangeType)
  }
  if (!id || !originalText || !correctedText || !improvedText || !explanation || requiresTeacherReview === null) return null
  return {
    id,
    originalText,
    correctedText,
    improvedText,
    changeTypes: projectedChangeTypes,
    explanation,
    requiresTeacherReview,
  }
}

function projectFullTextRevision(value: unknown): NonNullable<AiGradingResultV1['fullTextRevision']> | null {
  if (!isRecord(value)) return null
  const originalText = readString(value.originalText)
  const correctedText = readString(value.correctedText)
  const improvedText = readString(value.improvedText)
  const sentencePairs = projectArray(value.sentencePairs, projectSentencePair)
  const logicNotes = readStringArray(value.logicNotes)
  if (!originalText || !correctedText || !improvedText || !sentencePairs || !logicNotes) return null
  return { originalText, correctedText, improvedText, sentencePairs, logicNotes }
}

function projectSuccess(value: unknown, expected: ExpectedGradingResponse): AiGradingResultV1 | null {
  if (!isRecord(value)) return null
  const requestId = readString(value.requestId)
  const essayId = readString(value.essayId)
  const provider = readString(value.provider)
  const status = readString(value.status)
  const totalScore = readFiniteNumber(value.totalScore)
  const maxScore = readFiniteNumber(value.maxScore)
  const dimensionScores = projectArray(value.dimensionScores, projectDimensionScore)
  const issues = projectArray(value.issues, projectIssue)
  const sentenceRevisions = projectArray(value.sentenceRevisions, projectSentenceRevision)
  const expressionUpgrades = projectArray(value.expressionUpgrades, projectExpressionUpgrade)
  const overallComment = readString(value.overallComment)
  const reviewReasons = readStringArray(value.reviewReasons)
  const createdAt = readString(value.createdAt)
  if (
    value.resultVersion !== 'grading-result-v1'
    || requestId !== expected.requestId
    || essayId !== expected.essayId
    || !provider || !providers.has(provider)
    || !status || !successStatuses.has(status)
    || totalScore === null || maxScore === null
    || !dimensionScores || !issues || !sentenceRevisions || !expressionUpgrades
    || !overallComment || !reviewReasons || !createdAt || !Number.isFinite(Date.parse(createdAt))
  ) return null

  let fullTextRevision: AiGradingResultV1['fullTextRevision']
  if ('fullTextRevision' in value) {
    const projected = projectFullTextRevision(value.fullTextRevision)
    if (!projected) return null
    fullTextRevision = projected
  }

  let modelSelfConfidence: number | undefined
  if ('modelSelfConfidence' in value) {
    const projected = readFiniteNumber(value.modelSelfConfidence)
    if (projected === null || projected < 0 || projected > 1) return null
    modelSelfConfidence = projected
  }

  let transcript: string | undefined
  let transcriptionWarnings: string[] | undefined
  let printedTextExcluded: boolean | undefined
  const hasMultimodalFields = expected.requireMultimodal || 'transcript' in value || 'transcriptionWarnings' in value || 'printedTextExcluded' in value
  if (hasMultimodalFields) {
    transcript = readString(value.transcript) ?? undefined
    transcriptionWarnings = readStringArray(value.transcriptionWarnings) ?? undefined
    printedTextExcluded = readBoolean(value.printedTextExcluded) ?? undefined
    if (!transcript || !transcriptionWarnings || printedTextExcluded === undefined) return null
  }

  return {
    resultVersion: 'grading-result-v1',
    requestId,
    essayId,
    provider: provider as AiGradingResultV1['provider'],
    status: status as AiGradingResultV1['status'],
    totalScore,
    maxScore,
    dimensionScores,
    issues,
    sentenceRevisions,
    expressionUpgrades,
    ...(fullTextRevision ? { fullTextRevision } : {}),
    overallComment,
    ...(modelSelfConfidence === undefined ? {} : { modelSelfConfidence }),
    ...(transcript === undefined ? {} : { transcript, transcriptionWarnings, printedTextExcluded }),
    reviewReasons,
    createdAt,
  }
}

function projectFailure(value: unknown, expected: ExpectedGradingResponse): GradingFailureV1 | null {
  if (!isRecord(value) || !isRecord(value.error)) return null
  const requestId = readString(value.requestId)
  const code = readString(value.error.code)
  const retryable = readBoolean(value.error.retryable)
  if (
    requestId !== expected.requestId
    || value.status !== 'failed'
    || !code || !errorCodes.has(code as GradingErrorCode)
    || retryable === null
  ) return null
  return { requestId, status: 'failed', error: { code: code as GradingErrorCode, message: safeMessages[code as GradingErrorCode], retryable } }
}

export function gatewayInvalidResponse(requestId: string): GradingFailureV1 {
  return {
    requestId,
    status: 'failed',
    error: {
      code: 'gateway_invalid_response',
      message: '批改服务返回了无法安全使用的响应，请重试或使用 mock 回退。',
      retryable: true,
    },
  }
}

export function projectGradingClientResponse(
  value: unknown,
  expected: ExpectedGradingResponse,
): GradingClientResponse {
  const projected = expected.httpOk
    ? projectSuccess(value, expected)
    : projectFailure(value, expected)
  return projected ?? gatewayInvalidResponse(expected.requestId)
}
