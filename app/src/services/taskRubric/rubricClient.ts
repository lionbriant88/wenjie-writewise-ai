import { createTaskMaterialFormData } from '../taskMaterial/materialFormData'
import { readStrictResponseArray, readStrictResponseRecord } from '../taskMaterial/materialClient'
import { normalizeGradingApiBase, parseGradingRuntimeConfig, type GradingRuntimeEnvironment } from '../grading/gradingRuntimeConfig'
import { MAX_WRITING_REQUIREMENT_CODE_POINTS } from './rubricForm'
import type {
  GeneratedRubricDimension,
  GeneratedTaskRubric,
  RubricClient,
  RubricClientFailure,
  RubricClientResponse,
  RubricClientSuccess,
  RubricFailureCode,
} from './types'

interface RemoteRubricClientOptions {
  apiBase?: string
  fetchImpl?: typeof fetch
}

const TOTAL_WEIGHT_TOLERANCE = 0.001

const safeFailureCodes = new Set<RubricFailureCode>([
  'invalid_request', 'request_too_large', 'provider_not_configured', 'provider_request_rejected',
  'provider_auth_failed', 'provider_balance_unavailable', 'provider_rate_limited', 'provider_timeout',
  'provider_result_unknown', 'provider_unavailable', 'provider_content_filtered', 'provider_invalid_response',
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
    case 'provider_result_unknown': return '评分结果状态暂时未知，请稍后检查。'
    case 'provider_unavailable': return '评分服务暂时不可用，请稍后重试。'
    case 'provider_content_filtered': return '材料无法由评分服务处理，请检查后重试。'
    case 'provider_invalid_response': return '评分服务返回结果无效，请稍后重试。'
    case 'gateway_invalid_response': return '评分标准服务返回了无法安全使用的响应，请重试。'
    case 'gateway_unavailable': return '评分标准服务暂时不可用，请稍后重试。'
  }
}

function readString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || Array.from(value).length > maxLength) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readStringArray(value: unknown, maxItems: number, maxItemLength: number): string[] | null {
  const strictArray = readStrictResponseArray(value, 0, maxItems)
  if (!strictArray) return null
  const values = strictArray.map((item) => readString(item, maxItemLength))
  return values.every((item): item is string => item !== null) ? values : null
}

function projectDimension(value: unknown): GeneratedRubricDimension | null {
  const dimension = readStrictResponseRecord(value, [
    'id', 'name', 'weight', 'description', 'deductionFocus', 'sourceEvidence',
  ])
  if (!dimension) return null
  const id = readString(dimension.id, 128)
  const name = readString(dimension.name, 256)
  const description = readString(dimension.description, 2_000)
  const weight = typeof dimension.weight === 'number' && Number.isFinite(dimension.weight) ? dimension.weight : null
  const deductionFocus = readStringArray(dimension.deductionFocus, 50, 1_000)
  const sourceEvidence = readStringArray(dimension.sourceEvidence, 50, 5_000)
  if (!id || !name || !description || weight === null || weight <= 0 || !deductionFocus || !sourceEvidence) return null
  return { id, name, weight, description, deductionFocus, sourceEvidence }
}

function projectRubric(value: unknown): GeneratedTaskRubric | null {
  const rubric = readStrictResponseRecord(value, [
    'taskName', 'materialSummary', 'writingRequirements', 'constraints', 'dimensions', 'reviewWarnings',
  ])
  if (!rubric) return null
  const taskName = readString(rubric.taskName, 2_000)
  const materialSummary = readString(rubric.materialSummary, 20_000)
  const writingRequirements = readStringArray(
    rubric.writingRequirements,
    50,
    MAX_WRITING_REQUIREMENT_CODE_POINTS,
  )
  const constraints = readStringArray(rubric.constraints, 50, 5_000)
  const reviewWarnings = readStringArray(rubric.reviewWarnings, 50, 5_000)
  const rawDimensions = readStrictResponseArray(rubric.dimensions, 1, 10)
  if (!rawDimensions) return null
  const dimensions = rawDimensions.map(projectDimension)
  if (
    !taskName || !materialSummary || !writingRequirements || writingRequirements.length < 1
    || !constraints || !reviewWarnings
    || !dimensions.every((item): item is GeneratedRubricDimension => item !== null)
    || new Set(dimensions.map(({ id }) => id)).size !== dimensions.length
    || dimensions.filter(({ id }) => id === 'legibility').length !== 1
    || dimensions.find(({ id }) => id === 'legibility')?.weight !== 5
  ) return null
  const totalWeight = dimensions.reduce((total, dimension) => total + dimension.weight, 0)
  const roundingAllowance = Number.EPSILON * Math.max(1, Math.abs(totalWeight), 100)
  if (Math.abs(totalWeight - 100) > TOTAL_WEIGHT_TOLERANCE + roundingAllowance) return null
  return { taskName, materialSummary, writingRequirements, constraints, dimensions, reviewWarnings }
}

function projectResponse(value: unknown, requestId: string, httpOk: boolean): RubricClientResponse {
  const success = readStrictResponseRecord(value, [
    'requestId', 'status', 'rubric',
  ])
  if (httpOk && success?.requestId === requestId && success.status === 'success') {
    const rubric = projectRubric(success.rubric)
    return rubric
      ? { requestId, status: 'success', rubric }
      : gatewayFailure(requestId, 'gateway_invalid_response', true)
  }
  const failure = readStrictResponseRecord(value, [
    'requestId', 'status', 'error',
  ])
  const error = failure ? readStrictResponseRecord(failure.error, [
    'code', 'message', 'retryable',
  ]) : null
  if (!httpOk && failure?.requestId === requestId && failure.status === 'failed' && error) {
    const code = readString(error.code, 128)
    const message = readString(error.message, 2_000)
    if (code && message && safeFailureCodes.has(code as RubricFailureCode) && typeof error.retryable === 'boolean') {
      const safeCode = code as RubricFailureCode
      if (safeCode === 'provider_result_unknown' && error.retryable !== false) {
        return gatewayFailure(requestId, 'gateway_invalid_response', true)
      }
      return {
        requestId,
        status: 'failed',
        error: { code: safeCode, message: safeFailureMessage(safeCode), retryable: error.retryable },
      }
    }
  }
  return gatewayFailure(requestId, 'gateway_invalid_response', true)
}

export function createRemoteRubricClient({ apiBase, fetchImpl = fetch }: RemoteRubricClientOptions): RubricClient {
  const normalizedApiBase = normalizeGradingApiBase(apiBase)
  return {
    async generate(request) {
      if (!normalizedApiBase) {
        return {
          requestId: request.requestId, status: 'failed',
          error: {
            code: 'provider_not_configured',
            message: safeFailureMessage('provider_not_configured'),
            retryable: false,
          },
        }
      }
      const formData = createTaskMaterialFormData(request)

      let response: Response
      try {
        response = await fetchImpl(`${normalizedApiBase}/tasks/rubric`, {
          method: 'POST',
          body: formData,
          signal: request.signal,
        })
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
  env: GradingRuntimeEnvironment = {
    VITE_GRADING_MODE: import.meta.env.VITE_GRADING_MODE,
    VITE_GRADING_API_BASE: import.meta.env.VITE_GRADING_API_BASE,
    VITE_GRADING_QUEUE_MODE: import.meta.env.VITE_GRADING_QUEUE_MODE,
    VITE_GRADING_MAX_IN_FLIGHT: import.meta.env.VITE_GRADING_MAX_IN_FLIGHT,
  },
): RubricClient {
  const config = parseGradingRuntimeConfig(env)
  if (!config.ok) {
    return {
      async generate(request) {
        return {
          requestId: request.requestId, status: 'failed',
          error: {
            code: 'provider_not_configured',
            message: safeFailureMessage('provider_not_configured'),
            retryable: false,
          },
        }
      },
    }
  }
  return config.value.mode === 'real'
    ? createRemoteRubricClient({ apiBase: config.value.apiBase })
    : createMockRubricClient()
}

export type { RubricClient, RubricClientRequest, RubricClientResponse } from './types'
