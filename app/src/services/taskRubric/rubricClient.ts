import type {
  GeneratedRubricDimension,
  GeneratedTaskRubric,
  RubricClient,
  RubricClientFailure,
  RubricClientRequest,
  RubricClientResponse,
  RubricClientSuccess,
  RubricFailureCode,
} from './types'

interface RemoteRubricClientOptions {
  apiBase?: string
  fetchImpl?: typeof fetch
}

const safeFailureCodes = new Set<RubricFailureCode>([
  'invalid_request', 'request_too_large', 'provider_not_configured', 'provider_request_rejected',
  'provider_auth_failed', 'provider_balance_unavailable', 'provider_rate_limited', 'provider_timeout',
  'provider_unavailable', 'provider_content_filtered', 'provider_invalid_response',
  'gateway_invalid_response', 'gateway_unavailable',
])

function gatewayFailure(
  requestId: string,
  code: 'gateway_invalid_response' | 'gateway_unavailable',
  retryable: boolean,
): RubricClientFailure {
  return {
    requestId,
    status: 'failed',
    error: {
      code,
      message: code === 'gateway_unavailable'
        ? '评分标准服务暂时不可用，请稍后重试。'
        : '评分标准服务返回了无法安全使用的响应，请重试。',
      retryable,
    },
  }
}

function safeFailureMessage(code: RubricFailureCode): string {
  switch (code) {
    case 'invalid_request': return '评分标准请求无效，请检查材料后重试。'
    case 'request_too_large': return '上传的材料超过限制，请减少页数或图片大小后重试。'
    case 'provider_not_configured': return '评分服务尚未配置，请联系管理员。'
    case 'provider_request_rejected': return '评分服务拒绝了本次请求，请检查材料后重试。'
    case 'provider_auth_failed': return '评分服务认证失败，请联系管理员。'
    case 'provider_balance_unavailable': return '评分服务暂时不可用，请联系管理员。'
    case 'provider_rate_limited': return '请求过于频繁，请稍后重试。'
    case 'provider_timeout': return '评分服务响应超时，请稍后重试。'
    case 'provider_unavailable': return '评分服务暂时不可用，请稍后重试。'
    case 'provider_content_filtered': return '材料无法由评分服务处理，请检查后重试。'
    case 'provider_invalid_response': return '评分服务返回结果无效，请稍后重试。'
    case 'gateway_invalid_response': return '评分标准服务返回了无法安全使用的响应，请重试。'
    case 'gateway_unavailable': return '评分标准服务暂时不可用，请稍后重试。'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const values = value.map(readString)
  return values.every((item): item is string => item !== null) ? values : null
}

function projectDimension(value: unknown): GeneratedRubricDimension | null {
  if (!isRecord(value)) return null
  const id = readString(value.id)
  const name = readString(value.name)
  const description = readString(value.description)
  const weight = typeof value.weight === 'number' && Number.isFinite(value.weight) ? value.weight : null
  const deductionFocus = readStringArray(value.deductionFocus)
  const sourceEvidence = readStringArray(value.sourceEvidence)
  if (!id || !name || !description || weight === null || weight <= 0 || !deductionFocus || !sourceEvidence) return null
  return { id, name, weight, description, deductionFocus, sourceEvidence }
}

function projectRubric(value: unknown): GeneratedTaskRubric | null {
  if (!isRecord(value)) return null
  const taskName = readString(value.taskName)
  const materialSummary = readString(value.materialSummary)
  const writingRequirements = readStringArray(value.writingRequirements)
  const constraints = readStringArray(value.constraints)
  const reviewWarnings = readStringArray(value.reviewWarnings)
  if (!Array.isArray(value.dimensions)) return null
  const dimensions = value.dimensions.map(projectDimension)
  if (
    !taskName || !materialSummary || !writingRequirements || !constraints || !reviewWarnings
    || !dimensions.every((item): item is GeneratedRubricDimension => item !== null)
    || dimensions.length === 0
    || Math.abs(dimensions.reduce((total, dimension) => total + dimension.weight, 0) - 100) > 0.001
  ) return null
  return { taskName, materialSummary, writingRequirements, constraints, dimensions, reviewWarnings }
}

function projectResponse(value: unknown, requestId: string, httpOk: boolean): RubricClientResponse {
  if (!isRecord(value) || value.requestId !== requestId) return gatewayFailure(requestId, 'gateway_invalid_response', true)
  if (httpOk && value.status === 'success') {
    const rubric = projectRubric(value.rubric)
    return rubric ? { requestId, status: 'success', rubric } : gatewayFailure(requestId, 'gateway_invalid_response', true)
  }
  if (!httpOk && value.status === 'failed' && isRecord(value.error)) {
    const code = readString(value.error.code)
    if (code && safeFailureCodes.has(code as RubricFailureCode) && typeof value.error.retryable === 'boolean') {
      const safeCode = code as RubricFailureCode
      return {
        requestId,
        status: 'failed',
        error: { code: safeCode, message: safeFailureMessage(safeCode), retryable: value.error.retryable },
      }
    }
  }
  return gatewayFailure(requestId, 'gateway_invalid_response', true)
}

export function createRemoteRubricClient({ apiBase, fetchImpl = fetch }: RemoteRubricClientOptions): RubricClient {
  return {
    async generate(request: RubricClientRequest) {
      if (!apiBase) return gatewayFailure(request.requestId, 'gateway_unavailable', false)
      const formData = new FormData()
      formData.append('requestId', request.requestId)
      formData.append('fullScore', String(request.fullScore))
      formData.append('pageIds', JSON.stringify(request.pages.map((page) => page.id)))
      request.pages.forEach((page) => formData.append('pages', page.file))

      let response: Response
      try {
        response = await fetchImpl(`${apiBase.replace(/\/$/, '')}/tasks/rubric`, { method: 'POST', body: formData })
      } catch {
        return gatewayFailure(request.requestId, 'gateway_unavailable', true)
      }
      let body: unknown
      try {
        body = await response.json()
      } catch {
        return gatewayFailure(request.requestId, 'gateway_invalid_response', true)
      }
      return projectResponse(body, request.requestId, response.ok)
    },
  }
}

export function createMockRubricClient(): RubricClient {
  return {
    async generate(request): Promise<RubricClientSuccess> {
      return {
        requestId: request.requestId,
        status: 'success',
        rubric: {
          taskName: '材料写作任务',
          materialSummary: '请根据上传的写作材料完成作文。',
          writingRequirements: ['回应材料要求', '表达清晰完整'],
          constraints: [],
          dimensions: [
            { id: 'content', name: '内容', weight: 57, description: '回应材料并完成写作任务。', deductionFocus: [], sourceEvidence: [] },
            { id: 'language', name: '语言', weight: 38, description: '语言表达准确、连贯。', deductionFocus: [], sourceEvidence: [] },
            { id: 'legibility', name: '卷面与可读性', weight: 5, description: '只评价影响理解或评分的重要字迹歧义。', deductionFocus: ['重要字迹歧义'], sourceEvidence: [] },
          ],
          reviewWarnings: [],
        },
      }
    },
  }
}

export function createConfiguredRubricClient(
  env: { VITE_GRADING_MODE?: string; VITE_GRADING_API_BASE?: string } = {
    VITE_GRADING_MODE: import.meta.env.VITE_GRADING_MODE,
    VITE_GRADING_API_BASE: import.meta.env.VITE_GRADING_API_BASE,
  },
): RubricClient {
  return env.VITE_GRADING_MODE === 'real'
    ? createRemoteRubricClient({ apiBase: env.VITE_GRADING_API_BASE })
    : createMockRubricClient()
}

export type { RubricClient, RubricClientRequest, RubricClientResponse } from './types'
