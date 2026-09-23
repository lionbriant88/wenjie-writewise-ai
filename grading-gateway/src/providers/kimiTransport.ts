import { createStructuredTransport, type StructuredTransportOptions } from './structuredCompletionTransport.js'

export type {
  StructuredContentPart as KimiContentPart,
  StructuredMessage as KimiMessage,
  StructuredCompletionInput as KimiCompletionInput,
  StructuredTransport as KimiTransport,
} from './structuredCompletionTransport.js'

export interface KimiTransportOptions extends Omit<StructuredTransportOptions, 'requestParameters' | 'redirect'> {
  reasoningEffort: 'low' | 'high' | 'max'
}

export function createKimiTransport(options: KimiTransportOptions) {
  return createStructuredTransport({
    ...options,
    requestParameters: (input) => ({
      reasoning_effort: options.reasoningEffort,
      max_completion_tokens: input.maxCompletionTokens,
      ...(input.promptCacheKey ? { prompt_cache_key: input.promptCacheKey } : {}),
    }),
  })
}
