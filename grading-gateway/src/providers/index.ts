import { FailureGradingProvider } from './failureGradingProvider.js'
import { KimiMultimodalProvider } from './kimiMultimodalProvider.js'
import { createKimiTransport } from './kimiTransport.js'
import { MockGradingProvider } from './mockGradingProvider.js'
import type { MultimodalProvider } from './multimodalProviderTypes.js'
import { GradingProviderError, type GradingProvider } from './providerTypes.js'

type KimiEnvironment = Partial<Record<
  | 'KIMI_API_KEY'
  | 'KIMI_API_BASE'
  | 'KIMI_MODEL'
  | 'KIMI_REASONING_EFFORT'
  | 'KIMI_MAX_COMPLETION_TOKENS',
  string | undefined
>>

type KimiReasoningEffort = 'low' | 'high' | 'max'

export interface MultimodalProviderDependencies {
  kimiFactory?: () => MultimodalProvider
}

function kimiConfigurationError() {
  return new GradingProviderError('provider_not_configured', 'Kimi 閰嶇疆鏃犳晥。', false)
}

export function parseKimiConfig(env: KimiEnvironment): {
  apiBase: string
  model: string
  reasoningEffort: KimiReasoningEffort
  maxCompletionTokens: number
} {
  const reasoningEffort = env.KIMI_REASONING_EFFORT?.trim() || 'max'
  if (reasoningEffort !== 'low' && reasoningEffort !== 'high' && reasoningEffort !== 'max') throw kimiConfigurationError()

  const maxCompletionTokens = env.KIMI_MAX_COMPLETION_TOKENS === undefined || env.KIMI_MAX_COMPLETION_TOKENS.trim() === ''
    ? 8192
    : Number(env.KIMI_MAX_COMPLETION_TOKENS)
  if (!Number.isInteger(maxCompletionTokens) || maxCompletionTokens <= 0) throw kimiConfigurationError()
  return {
    apiBase: env.KIMI_API_BASE?.trim() || 'https://api.kimi.com/coding/v1',
    model: env.KIMI_MODEL?.trim() || 'k3',
    reasoningEffort,
    maxCompletionTokens,
  }
}

export function parseGradingTimeoutMs(value: string | undefined) {
  if (value === undefined || value.trim() === '') return 60_000
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 60_000
}

export function getProvider(name: string | undefined): GradingProvider {
  if (name === 'mock') return new MockGradingProvider()
  if (name === 'mock_failure') return new FailureGradingProvider()
  throw new GradingProviderError('provider_not_configured', '批改 Provider 未配置或不受支持。', false)
}

export function getMultimodalProvider(
  name: string | undefined,
  dependencies: MultimodalProviderDependencies = {},
): MultimodalProvider {
  if (name === 'kimi' && dependencies.kimiFactory) return dependencies.kimiFactory()
  if (name === 'kimi') {
    const config = parseKimiConfig(process.env)
    return new KimiMultimodalProvider(createKimiTransport({ ...config, apiKey: process.env.KIMI_API_KEY }))
  }
  throw new GradingProviderError('provider_not_configured', 'Kimi Provider 涓嶅彈鏀寔。', false)
}
