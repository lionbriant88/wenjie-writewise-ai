import { FailureGradingProvider } from './failureGradingProvider.js'
import { MockGradingProvider } from './mockGradingProvider.js'
import { GradingProviderError, type GradingProvider } from './providerTypes.js'

export interface ProviderDependencies {
  deepseekFactory?: () => GradingProvider
}

export function getProvider(name: string | undefined, dependencies: ProviderDependencies = {}): GradingProvider {
  if (name === 'mock') return new MockGradingProvider()
  if (name === 'mock_failure') return new FailureGradingProvider()
  if (name === 'deepseek' && dependencies.deepseekFactory) return dependencies.deepseekFactory()
  throw new GradingProviderError('provider_not_configured', '批改 Provider 未配置或不受支持。', false)
}
