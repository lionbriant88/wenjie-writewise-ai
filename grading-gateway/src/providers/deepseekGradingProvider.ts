import type { DeepSeekTransport } from './deepseekTransport.js'
import {
  GradingProviderError,
  type GradingProvider,
  type GradingProviderInput,
} from './providerTypes.js'

export interface DeepSeekGenerationConfig {
  thinkingMode: 'disabled' | 'enabled'
  temperature: number
  maxTokens: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractCompletedContent(response: unknown) {
  if (!isRecord(response) || !Array.isArray(response.choices) || response.choices.length === 0) {
    throw new GradingProviderError('provider_invalid_response', '真实 AI 返回结果不完整。', true)
  }
  const choice = response.choices[0]
  if (!isRecord(choice)) {
    throw new GradingProviderError('provider_invalid_response', '真实 AI 返回结果不完整。', true)
  }
  const finishReason = choice.finish_reason
  if (finishReason === 'content_filter') {
    throw new GradingProviderError('provider_content_filtered', '真实 AI 拒绝处理该内容。', false)
  }
  if (finishReason === 'insufficient_system_resource') {
    throw new GradingProviderError('provider_unavailable', '真实 AI 系统资源暂时不足。', true)
  }
  if (finishReason === 'tool_calls') {
    throw new GradingProviderError('provider_unexpected_tool_call', '真实 AI 返回了不允许的工具调用。', false)
  }
  if (finishReason !== 'stop') {
    throw new GradingProviderError('provider_invalid_response', '真实 AI 未完整返回可用结果。', true)
  }
  if (!isRecord(choice.message)) {
    throw new GradingProviderError('provider_invalid_response', '真实 AI 返回结果不完整。', true)
  }
  if (Array.isArray(choice.message.tool_calls) && choice.message.tool_calls.length > 0) {
    throw new GradingProviderError('provider_unexpected_tool_call', '真实 AI 返回了不允许的工具调用。', false)
  }
  if (typeof choice.message.content !== 'string' || !choice.message.content.trim()) {
    throw new GradingProviderError('provider_invalid_response', '真实 AI 返回内容为空。', true)
  }
  return choice.message.content
}

export class DeepSeekGradingProvider implements GradingProvider {
  readonly publicName = 'remote' as const

  constructor(
    private readonly transport: DeepSeekTransport,
    private readonly model = 'deepseek-v4-flash',
    private readonly generation: DeepSeekGenerationConfig = {
      thinkingMode: 'disabled', temperature: 0, maxTokens: 8192,
    },
  ) {}

  async grade({ request, prompt, signal }: GradingProviderInput): Promise<unknown> {
    if (request.task.writingGenre !== 'practical_writing') {
      throw new GradingProviderError('unsupported_genre', '真实 AI MVP 暂只支持应用文。', false)
    }
    const response = await this.transport.complete({
      model: this.model,
      stream: false,
      thinking: { type: this.generation.thinkingMode },
      ...(this.generation.thinkingMode === 'disabled' ? { temperature: this.generation.temperature } : {}),
      max_tokens: this.generation.maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }, signal)
    const content = extractCompletedContent(response)
    try {
      return JSON.parse(content) as unknown
    } catch {
      throw new GradingProviderError('provider_invalid_response', '真实 AI 返回了无效 JSON。', true)
    }
  }
}
