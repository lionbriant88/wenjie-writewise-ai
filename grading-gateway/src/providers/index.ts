import type { GatewayRuntimeConfig } from '../gatewayRuntimeConfig.js'
import { FailureGradingProvider } from './failureGradingProvider.js'
import { KimiMultimodalProvider } from './kimiMultimodalProvider.js'
import { createKimiTransport, type KimiTransport, type KimiTransportOptions } from './kimiTransport.js'
import { MockGradingProvider } from './mockGradingProvider.js'
import type { MultimodalProvider } from './multimodalProviderTypes.js'
import { GradingProviderError, type GradingProvider, type ProviderCallStage } from './providerTypes.js'

export interface MultimodalProviderDependencies {
  apiKey?: string
  mockFactory?: () => MultimodalProvider
  kimiTransportFactory?: (options: KimiTransportOptions) => KimiTransport
}

function providerConfigurationError() {
  return new GradingProviderError('provider_not_configured', 'AI Provider configuration is invalid.', false)
}

export function getProvider(name: string | undefined): GradingProvider {
  if (name === 'mock') return new MockGradingProvider()
  if (name === 'mock_failure') return new FailureGradingProvider()
  throw providerConfigurationError()
}

export function createStageBudgetedTransport(
  transport: KimiTransport,
  budgets: Record<ProviderCallStage, number>,
): KimiTransport {
  return {
    maxCompletionTokens: Math.max(...Object.values(budgets)),
    complete(input) {
      return transport.complete({ ...input, maxCompletionTokens: budgets[input.stage] })
    },
  }
}

export function getMultimodalProvider(
  runtimeConfig: GatewayRuntimeConfig,
  dependencies?: MultimodalProviderDependencies,
): MultimodalProvider
export function getMultimodalProvider(
  config: GatewayRuntimeConfig,
  dependencies: MultimodalProviderDependencies = {},
): MultimodalProvider {
  if (config.provider === 'mock') {
    if (dependencies.mockFactory) return dependencies.mockFactory()
    throw providerConfigurationError()
  }
  const apiKey = dependencies.apiKey
  if (!apiKey?.trim()) throw providerConfigurationError()
  const transportFactory = dependencies.kimiTransportFactory ?? createKimiTransport
  const transport = transportFactory({
    apiKey,
    apiBase: config.kimi.apiBase,
    model: config.kimi.model,
    reasoningEffort: config.kimi.reasoningEffort,
    maxCompletionTokens: Math.max(...Object.values(config.kimi.stageBudgets)),
  })
  return new KimiMultimodalProvider(createStageBudgetedTransport(transport, config.kimi.stageBudgets))
}
