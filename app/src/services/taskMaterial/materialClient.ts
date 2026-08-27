import type { TaskMaterialContext } from '../../types'
import type { RubricClientFailure, RubricFailureCode } from '../taskRubric/types'
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
    case 'provider_unavailable': return '评分服务暂时不可用，请稍后重试。'
    case 'provider_content_filtered': return '材料无法由评分服务处理，请检查后重试。'
    case 'provider_invalid_response': return '评分服务返回结果无效，请稍后重试。'
    case 'gateway_invalid_response': return '材料分析服务返回了无法安全使用的响应，请重试。'
    case 'gateway_unavailable': return '材料分析服务暂时不可用，请稍后重试。'
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
  if (typeof value !== 'string' || Array.from(value).length > maxLength) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readStringArray(value: unknown, minimumItems: number, maxItemLength: number): string[] | null {
  if (!Array.isArray(value) || value.length < minimumItems || value.length > 50) return null
  const items = value.map((item) => readString(item, maxItemLength))
  return items.every((item): item is string => item !== null) ? items : null
}

function projectMaterialContext(value: unknown): TaskMaterialContext | null {
  if (!isRecord(value) || !hasExactlyKeys(value, [
    'materialSummary', 'writingRequirements', 'constraints', 'reviewWarnings',
  ])) return null
  const materialSummary = readString(value.materialSummary, 20_000)
  const writingRequirements = readStringArray(value.writingRequirements, 1, 10_000)
  const constraints = readStringArray(value.constraints, 0, 5_000)
  const reviewWarnings = readStringArray(value.reviewWarnings, 0, 5_000)
  return materialSummary && writingRequirements && constraints && reviewWarnings
    ? { materialSummary, writingRequirements, constraints, reviewWarnings }
    : null
}

function projectResponse(
  value: unknown,
  requestId: string,
  httpOk: boolean,
): MaterialContextClientResponse {
  if (!isRecord(value) || value.requestId !== requestId) {
    return gatewayFailure(requestId, 'gateway_invalid_response', true)
  }
  if (httpOk && value.status === 'success' && hasExactlyKeys(value, [
    'requestId', 'status', 'materialContext',
  ])) {
    const materialContext = projectMaterialContext(value.materialContext)
    return materialContext
      ? { requestId, status: 'success', materialContext }
      : gatewayFailure(requestId, 'gateway_invalid_response', true)
  }
  if (!httpOk && value.status === 'failed' && hasExactlyKeys(value, [
    'requestId', 'status', 'error',
  ]) && isRecord(value.error) && hasExactlyKeys(value.error, [
    'code', 'message', 'retryable',
  ])) {
    const code = readString(value.error.code, 128)
    const message = readString(value.error.message, 2_000)
    if (code && message && safeFailureCodes.has(code as RubricFailureCode) && typeof value.error.retryable === 'boolean') {
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

export function createRemoteMaterialContextClient({
  apiBase,
  fetchImpl = fetch,
}: RemoteMaterialContextClientOptions): MaterialContextClient {
  return {
    async analyze(request) {
      if (!apiBase) return gatewayFailure(request.requestId, 'gateway_unavailable', false)

      let response: Response
      try {
        response = await fetchImpl(`${apiBase.replace(/\/$/, '')}/tasks/material-context`, {
          method: 'POST',
          body: createTaskMaterialFormData(request),
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
  env: { VITE_GRADING_MODE?: string; VITE_GRADING_API_BASE?: string } = {
    VITE_GRADING_MODE: import.meta.env.VITE_GRADING_MODE,
    VITE_GRADING_API_BASE: import.meta.env.VITE_GRADING_API_BASE,
  },
): MaterialContextClient {
  return env.VITE_GRADING_MODE === 'real'
    ? createRemoteMaterialContextClient({ apiBase: env.VITE_GRADING_API_BASE })
    : createMockMaterialContextClient()
}

export type { MaterialContextClientRequest } from './types'
