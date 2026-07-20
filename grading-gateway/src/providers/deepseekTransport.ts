import { GradingProviderError } from './providerTypes.js'

const DEFAULT_BASE_URL = 'https://api.deepseek.com'

export interface DeepSeekRequestBody {
  model: string
  stream: false
  thinking: { type: 'disabled' | 'enabled' }
  temperature?: number
  max_tokens: number
  response_format: { type: 'json_object' }
  messages: Array<{ role: 'system' | 'user'; content: string }>
}

export interface DeepSeekTransport {
  complete(body: DeepSeekRequestBody, signal: AbortSignal): Promise<unknown>
}

interface DeepSeekTransportOptions {
  apiKey?: string
  fetchImpl?: typeof fetch
  baseUrl?: string
}

function mapDeepSeekHttpStatus(status: number) {
  if (status === 401 || status === 403) {
    return new GradingProviderError('provider_auth_failed', '真实 AI Provider 认证失败。', false)
  }
  if (status === 402) {
    return new GradingProviderError('provider_balance_unavailable', '真实 AI Provider 额度不可用。', false)
  }
  if (status === 429) {
    return new GradingProviderError('provider_rate_limited', '真实 AI Provider 请求过于频繁。', true)
  }
  if (status === 400 || status === 422) {
    return new GradingProviderError('provider_request_rejected', '真实 AI Provider 拒绝了请求。', false)
  }
  return new GradingProviderError('provider_unavailable', '真实 AI 服务暂时不可用。', true)
}

export function createDeepSeekTransport(options: DeepSeekTransportOptions): DeepSeekTransport {
  return {
    async complete(body, signal) {
      if (!options.apiKey?.trim()) {
        throw new GradingProviderError('provider_not_configured', '真实 AI Provider 尚未配置。', false)
      }
      let response: Response
      try {
        response = await (options.fetchImpl ?? fetch)(
          `${(options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')}/chat/completions`,
          {
            method: 'POST',
            signal,
            headers: {
              Authorization: `Bearer ${options.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          },
        )
      } catch {
        if (signal.aborted) {
          throw new GradingProviderError('provider_timeout', '真实 AI 批改超时。', true)
        }
        throw new GradingProviderError('provider_unavailable', '真实 AI 服务暂时不可用。', true)
      }
      if (!response.ok) throw mapDeepSeekHttpStatus(response.status)
      try {
        return await response.json()
      } catch {
        throw new GradingProviderError('provider_invalid_response', '真实 AI 返回了无法解析的响应。', true)
      }
    },
  }
}
