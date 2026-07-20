import { gatewayInvalidResponse, projectGradingClientResponse } from './projectGradingClientResponse'
import type { GradingClient } from './types'

interface RemoteClientOptions {
  apiBase?: string
  fetchImpl?: typeof fetch
}

export function createRemoteGradingClient({
  apiBase,
  fetchImpl = fetch,
}: RemoteClientOptions): GradingClient {
  return {
    async grade(request) {
      if (!apiBase) {
        return {
          requestId: request.requestId,
          status: 'failed',
          error: {
            code: 'gateway_unavailable',
            message: '未配置批改服务地址，请使用 mock 回退。',
            retryable: false,
          },
        }
      }

      let response: Response
      try {
        response = await fetchImpl(`${apiBase.replace(/\/$/, '')}/grading/grade`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Grading-Request-Id': request.requestId,
          },
          body: JSON.stringify(request),
        })
      } catch {
        return {
          requestId: request.requestId,
          status: 'failed',
          error: {
            code: 'gateway_unavailable',
            message: '批改服务暂时不可用，请重试或使用 mock 回退。',
            retryable: true,
          },
        }
      }

      let body: unknown
      try {
        body = await response.json()
      } catch {
        return gatewayInvalidResponse(request.requestId)
      }
      return projectGradingClientResponse(body, {
        httpOk: response.ok,
        requestId: request.requestId,
        essayId: request.essay.essayId,
      })
    },
  }
}
