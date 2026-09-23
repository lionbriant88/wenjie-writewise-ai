import { GradingProviderError } from './providerTypes.js'
import { createStructuredTransport, type StructuredTransportOptions } from './structuredCompletionTransport.js'

export const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1'

export function isFreeOpenRouterModel(model: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*:free$/.test(model)
}

export type OpenRouterTransportOptions = Omit<StructuredTransportOptions, 'apiBase' | 'requestParameters' | 'redirect'>

export function createOpenRouterTransport(options: OpenRouterTransportOptions) {
  if (!isFreeOpenRouterModel(options.model)
    || !options.apiKey?.trim() || !/^[\x21-\x7e]{1,512}$/.test(options.apiKey.trim())) {
    throw new GradingProviderError('provider_not_configured', 'OpenRouter configuration is invalid.', false)
  }
  return createStructuredTransport({
    ...options,
    apiKey: options.apiKey.trim(),
    apiBase: OPENROUTER_API_BASE,
    redirect: 'error',
    requestParameters: (input) => ({
      max_tokens: input.maxCompletionTokens,
      stream: false,
      provider: {
        allow_fallbacks: false,
        require_parameters: true,
        data_collection: 'deny',
        max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
      },
    }),
  })
}
