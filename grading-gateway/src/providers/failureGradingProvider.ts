import { GradingProviderError, type GradingProvider } from './providerTypes.js'

export class FailureGradingProvider implements GradingProvider {
  readonly publicName = 'remote' as const

  async grade(): Promise<never> {
    throw new GradingProviderError('provider_unavailable', 'AI 批改服务暂时不可用。', true)
  }
}
