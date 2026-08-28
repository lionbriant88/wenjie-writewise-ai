import type { TaskMaterialContext } from '../../types'
import { MAX_WRITING_REQUIREMENT_CODE_POINTS } from '../taskRubric/rubricForm'
import type { RubricClientFailure, RubricFailureCode } from '../taskRubric/types'
import { normalizeGradingApiBase, parseGradingRuntimeConfig, type GradingRuntimeEnvironment } from '../grading/gradingRuntimeConfig'
import { createTaskMaterialFormData } from './materialFormData'
import type { MaterialContextClientRequest } from './types'

export type MaterialContextClientResponse =
  | { requestId: string; status: 'success'; materialContext: TaskMaterialContext }
  | RubricClientFailure

export interface MaterialContextClient {
  analyze(request: MaterialContextClientRequest): Promise<MaterialContextClientResponse>
}

interface RemoteMaterialContextClientOptions {
  apiBase?: string
  fetchImpl?: typeof fetch
}

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
        ? '材料分析服务暂时不可用，请稍后重试。'
        : '材料分析服务返回了无法安全使用的响应，请重试。',
      retryable,
    },
  }
}

function safeFailureMessage(code: RubricFailureCode): string {
  switch (code) {
    case 'invalid_request': return '材料分析请求无效，请检查材料后重试。'
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
    case 'gateway_invalid_response': return '材料分析服务返回了无法安全使用的响应，请重试。'
    case 'gateway_unavailable': return '材料分析服务暂时不可用，请稍后重试。'
  }
}

/** @internal Shared by the two task-material response projectors. */
export function readStrictResponseRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> | null {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const prototype = Object.getPrototypeOf(value) as unknown
    if (prototype !== Object.prototype && prototype !== null) return null

    const expected = new Set(expectedKeys)
    const ownKeys = Reflect.ownKeys(value)
    if (
      ownKeys.length !== expected.size
      || ownKeys.some((key) => typeof key !== 'string' || !expected.has(key))
    ) return null

    const projected = Object.create(null) as Record<string, unknown>
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        return null
      }
      projected[key] = descriptor.value
    }
    return projected
  } catch {
    return null
  }
}

/** @internal Shared by the two task-material response projectors. */
export function readStrictResponseArray(
  value: unknown,
  minimumItems: number,
  maximumItems: number,
): unknown[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
    if (!lengthDescriptor || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')) return null
    const length = lengthDescriptor.value
    if (!Number.isInteger(length) || length < minimumItems || length > maximumItems) return null

    const expectedKeys = new Set<string>(['length'])
    for (let index = 0; index < length; index += 1) expectedKeys.add(String(index))
    const ownKeys = Reflect.ownKeys(value)
    if (
      ownKeys.length !== expectedKeys.size
      || ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.has(key))
    ) return null

    const projected: unknown[] = []
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        return null
      }
      projected.push(descriptor.value)
    }
    return projected
  } catch {
    return null
  }
}

function readString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || Array.from(value).length > maxLength) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readStringArray(value: unknown, minimumItems: number, maxItemLength: number): string[] | null {
  const strictArray = readStrictResponseArray(value, minimumItems, 50)
  if (!strictArray) return null
  const items = strictArray.map((item) => readString(item, maxItemLength))
  return items.every((item): item is string => item !== null) ? items : null
}

function projectMaterialContext(value: unknown): TaskMaterialContext | null {
  const context = readStrictResponseRecord(value, [
    'materialSummary', 'writingRequirements', 'constraints', 'reviewWarnings',
  ])
  if (!context) return null
  const materialSummary = readString(context.materialSummary, 20_000)
  const writingRequirements = readStringArray(
    context.writingRequirements,
    1,
    MAX_WRITING_REQUIREMENT_CODE_POINTS,
  )
  const constraints = readStringArray(context.constraints, 0, 5_000)
  const reviewWarnings = readStringArray(context.reviewWarnings, 0, 5_000)
  return materialSummary && writingRequirements && constraints && reviewWarnings
    ? { materialSummary, writingRequirements, constraints, reviewWarnings }
    : null
}

function projectResponse(
  value: unknown,
  requestId: string,
  httpOk: boolean,
): MaterialContextClientResponse {
  const success = readStrictResponseRecord(value, [
    'requestId', 'status', 'materialContext',
  ])
  if (httpOk && success?.requestId === requestId && success.status === 'success') {
    const materialContext = projectMaterialContext(success.materialContext)
    return materialContext
      ? { requestId, status: 'success', materialContext }
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

export function createRemoteMaterialContextClient({
  apiBase,
  fetchImpl = fetch,
}: RemoteMaterialContextClientOptions): MaterialContextClient {
  const normalizedApiBase = normalizeGradingApiBase(apiBase)
  return {
    async analyze(request) {
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
        response = await fetchImpl(`${normalizedApiBase}/tasks/material-context`, {
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

export function createMockMaterialContextClient(): MaterialContextClient {
  return {
    async analyze(request) {
      const teacherRequirement = request.writingRequirement.trim() || '请根据原题材料完成写作。'
      return {
        requestId: request.requestId,
        status: 'success',
        materialContext: {
          materialSummary: `已整理 ${request.materials.length} 个作文原材料单元。`,
          writingRequirements: [teacherRequirement],
          constraints: [],
          reviewWarnings: [],
        },
      }
    },
  }
}

export function createConfiguredMaterialContextClient(
  env: GradingRuntimeEnvironment = {
    VITE_GRADING_MODE: import.meta.env.VITE_GRADING_MODE,
    VITE_GRADING_API_BASE: import.meta.env.VITE_GRADING_API_BASE,
    VITE_GRADING_QUEUE_MODE: import.meta.env.VITE_GRADING_QUEUE_MODE,
    VITE_GRADING_MAX_IN_FLIGHT: import.meta.env.VITE_GRADING_MAX_IN_FLIGHT,
  },
): MaterialContextClient {
  const config = parseGradingRuntimeConfig(env)
  if (!config.ok) {
    return {
      async analyze(request) {
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
    ? createRemoteMaterialContextClient({ apiBase: config.value.apiBase })
    : createMockMaterialContextClient()
}

export type { MaterialContextClientRequest } from './types'
