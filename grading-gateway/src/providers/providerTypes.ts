import type { GradingPromptV1 } from '../promptBuilder.js'
import type { GradingRequestV1 } from '../types.js'

export type ProviderErrorCode =
  | 'unsupported_genre'
  | 'provider_not_configured'
  | 'provider_request_rejected'
  | 'provider_auth_failed'
  | 'provider_balance_unavailable'
  | 'provider_rate_limited'
  | 'provider_timeout'
  | 'provider_unavailable'
  | 'provider_content_filtered'
  | 'provider_unexpected_tool_call'
  | 'provider_invalid_response'

export class GradingProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'GradingProviderError'
  }
}

export interface GradingProviderInput {
  request: GradingRequestV1
  prompt: GradingPromptV1
  signal: AbortSignal
}

export interface GradingProvider {
  readonly publicName: 'mock' | 'remote'
  grade(input: GradingProviderInput): Promise<unknown>
}
