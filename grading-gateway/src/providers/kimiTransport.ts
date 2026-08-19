import { GradingProviderError, type ProviderDiagnosticCode } from './providerTypes.js'

export type KimiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface KimiMessage {
  role: 'system' | 'user'
  content: string | KimiContentPart[]
}

export interface KimiCompletionInput {
  messages: KimiMessage[]
  schemaName: string
  schema: Record<string, unknown>
  signal: AbortSignal
}

export interface KimiTransport {
  complete(input: KimiCompletionInput): Promise<unknown>
}

export interface KimiTransportOptions {
  apiKey?: string
  apiBase: string
  model: string
  reasoningEffort: 'low' | 'high' | 'max'
  maxCompletionTokens: number
  fetchImpl?: typeof fetch
}

function unavailableError() {
  return new GradingProviderError('provider_unavailable', '真实 AI 服务暂时不可用。', true)
}

function invalidResponseError(diagnosticCode: ProviderDiagnosticCode) {
  return new GradingProviderError('provider_invalid_response', '真实 AI 返回了无法解析的响应。', true, diagnosticCode)
}

function mapKimiHttpStatus(status: number) {
  if (status === 401) return new GradingProviderError('provider_auth_failed', '真实 AI Provider 认证失败。', false)
  if (status === 402) return new GradingProviderError('provider_balance_unavailable', '真实 AI Provider 额度不可用。', false)
  if (status === 403) return new GradingProviderError('provider_request_rejected', '真实 AI Provider 拒绝了当前模型或接口访问。', false)
  if (status === 429) return new GradingProviderError('provider_rate_limited', '真实 AI Provider 请求过于频繁。', true)
  if (status === 400 || status === 422) return new GradingProviderError('provider_request_rejected', '真实 AI Provider 拒绝了请求。', false)
  return unavailableError()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unwrapJsonContent(content: string) {
  const trimmed = content.trim().replace(/^\uFEFF/, '').trim()
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed)
  return (fenced?.[1] ?? trimmed).trim()
}

function invalidJsonDiagnostic(content: string): ProviderDiagnosticCode {
  const first = content[0]
  const last = content.at(-1)
  if ((first === '{' && last !== '}') || (first === '[' && last !== ']')) {
    return 'completion_content_json_incomplete'
  }
  return 'completion_content_json_malformed'
}

function parseKimiCompletion(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.choices) || value.choices.length === 0) throw invalidResponseError('completion_envelope')
  const choice = value.choices[0]
  if (!isRecord(choice) || !isRecord(choice.message)) throw invalidResponseError('completion_envelope')
  if (choice.finish_reason === 'length') throw invalidResponseError('completion_truncated')
  if (choice.finish_reason === 'tool_calls') throw invalidResponseError('completion_tool_calls')
  if (choice.finish_reason !== 'stop') throw invalidResponseError('completion_finish_reason')
  const message = choice.message
  if ((Array.isArray(message.tool_calls) && message.tool_calls.length > 0) || typeof message.content !== 'string' || !message.content.trim()) {
    throw invalidResponseError(Array.isArray(message.tool_calls) && message.tool_calls.length > 0
      ? 'completion_tool_calls'
      : 'completion_content')
  }
  const jsonContent = unwrapJsonContent(message.content)
  try {
    return JSON.parse(jsonContent) as unknown
  } catch {
    throw invalidResponseError(invalidJsonDiagnostic(jsonContent))
  }
}

export function createKimiTransport(options: KimiTransportOptions): KimiTransport {
  return {
    async complete(input) {
      if (!options.apiKey?.trim()) {
        throw new GradingProviderError('provider_not_configured', '真实 AI Provider 尚未配置。', false)
      }
      let response: Response
      try {
        response = await (options.fetchImpl ?? fetch)(
          `${options.apiBase.replace(/\/$/, '')}/chat/completions`,
          {
            method: 'POST',
            signal: input.signal,
            headers: {
              Authorization: `Bearer ${options.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: options.model,
              reasoning_effort: options.reasoningEffort,
              max_completion_tokens: options.maxCompletionTokens,
              response_format: {
                type: 'json_schema',
                json_schema: { name: input.schemaName, strict: true, schema: input.schema },
              },
              messages: input.messages,
            }),
          },
        )
      } catch {
        if (input.signal.aborted) throw new GradingProviderError('provider_timeout', '真实 AI 批改超时。', true)
        throw unavailableError()
      }
      if (!response.ok) throw mapKimiHttpStatus(response.status)
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        throw invalidResponseError('response_json')
      }
      return parseKimiCompletion(payload)
    },
  }
}
