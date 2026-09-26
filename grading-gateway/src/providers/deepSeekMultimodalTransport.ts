import { GradingProviderError } from './providerTypes.js'
import { createStructuredTransport, type StructuredTransportOptions } from './structuredCompletionTransport.js'

export const DEEPSEEK_API_BASE = 'https://api.deepseek.com'
export const DEEPSEEK_MODEL = 'deepseek-flash'

type DeepSeekTransportOptions = Omit<StructuredTransportOptions, 'apiBase' | 'requestParameters' | 'redirect' | 'jsonSchemaMode'>

export function createDeepSeekTransport(options: DeepSeekTransportOptions) {
  if (options.model !== DEEPSEEK_MODEL || !options.apiKey?.trim()
    || !/^[\x21-\x7e]{1,512}$/.test(options.apiKey.trim())) {
    throw new GradingProviderError('provider_not_configured', 'DeepSeek configuration is invalid.', false)
  }
  return createStructuredTransport({
    ...options, apiKey: options.apiKey.trim(), apiBase: DEEPSEEK_API_BASE,
    redirect: 'error', jsonSchemaMode: 'prompt',
    requestParameters: (input) => ({ max_tokens: input.maxCompletionTokens, stream: false, thinking: { type: 'disabled' } }),
  })
}
