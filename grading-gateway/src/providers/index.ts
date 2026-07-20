import { FailureGradingProvider } from './failureGradingProvider.js'
import { MockGradingProvider } from './mockGradingProvider.js'
import { GradingProviderError, type GradingProvider } from './providerTypes.js'
import { DeepSeekGradingProvider, type DeepSeekGenerationConfig } from './deepseekGradingProvider.js'
import { createDeepSeekTransport } from './deepseekTransport.js'

type ProviderEnvironment = Partial<Record<
  | 'DEEPSEEK_API_KEY'
  | 'DEEPSEEK_MODEL'
  | 'DEEPSEEK_THINKING_MODE'
  | 'DEEPSEEK_TEMPERATURE'
  | 'DEEPSEEK_MAX_TOKENS',
  string | undefined
>>

export interface ProviderDependencies {
  deepseekFactory?: () => GradingProvider
  env?: ProviderEnvironment
  fetchImpl?: typeof fetch
}

function configurationError() {
  return new GradingProviderError('provider_not_configured', 'DeepSeek 生成参数配置无效。', false)
}

export function parseDeepSeekGenerationConfig(env: ProviderEnvironment): DeepSeekGenerationConfig {
  const thinkingMode = env.DEEPSEEK_THINKING_MODE === undefined
    ? 'disabled'
    : env.DEEPSEEK_THINKING_MODE
  if (thinkingMode !== 'disabled' && thinkingMode !== 'enabled') throw configurationError()

  const temperature = env.DEEPSEEK_TEMPERATURE === undefined || env.DEEPSEEK_TEMPERATURE.trim() === ''
    ? 0
    : Number(env.DEEPSEEK_TEMPERATURE)
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw configurationError()

  const maxTokens = env.DEEPSEEK_MAX_TOKENS === undefined || env.DEEPSEEK_MAX_TOKENS.trim() === ''
    ? 8192
    : Number(env.DEEPSEEK_MAX_TOKENS)
  if (!Number.isInteger(maxTokens) || maxTokens <= 0) throw configurationError()
  return { thinkingMode, temperature, maxTokens }
}

export function parseGradingTimeoutMs(value: string | undefined) {
  if (value === undefined || value.trim() === '') return 60_000
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 60_000
}

export function getProvider(name: string | undefined, dependencies: ProviderDependencies = {}): GradingProvider {
  if (name === 'mock') return new MockGradingProvider()
  if (name === 'mock_failure') return new FailureGradingProvider()
  if (name === 'deepseek') {
    if (dependencies.deepseekFactory) return dependencies.deepseekFactory()
    const env = dependencies.env ?? process.env
    return new DeepSeekGradingProvider(
      createDeepSeekTransport({ apiKey: env.DEEPSEEK_API_KEY, fetchImpl: dependencies.fetchImpl }),
      env.DEEPSEEK_MODEL?.trim() || 'deepseek-v4-flash',
      parseDeepSeekGenerationConfig(env),
    )
  }
  throw new GradingProviderError('provider_not_configured', '批改 Provider 未配置或不受支持。', false)
}
