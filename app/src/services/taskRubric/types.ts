export interface GeneratedRubricDimension {
  id: string
  name: string
  weight: number
  description: string
  deductionFocus: string[]
  sourceEvidence: string[]
}

export interface GeneratedTaskRubric {
  taskName: string
  materialSummary: string
  writingRequirements: string[]
  constraints: string[]
  dimensions: GeneratedRubricDimension[]
  reviewWarnings: string[]
}

export interface RubricClientPage {
  id: string
  file: File
}

export interface RubricClientRequest {
  requestId: string
  fullScore: number
  pages: RubricClientPage[]
}

export type RubricFailureCode =
  | 'invalid_request'
  | 'request_too_large'
  | 'provider_not_configured'
  | 'provider_request_rejected'
  | 'provider_auth_failed'
  | 'provider_balance_unavailable'
  | 'provider_rate_limited'
  | 'provider_timeout'
  | 'provider_unavailable'
  | 'provider_content_filtered'
  | 'provider_invalid_response'
  | 'gateway_invalid_response'
  | 'gateway_unavailable'

export interface RubricClientSuccess {
  requestId: string
  status: 'success'
  rubric: GeneratedTaskRubric
}

export interface RubricClientFailure {
  requestId: string
  status: 'failed'
  error: { code: RubricFailureCode; message: string; retryable: boolean }
}

export type RubricClientResponse = RubricClientSuccess | RubricClientFailure

export interface RubricClient {
  generate(request: RubricClientRequest): Promise<RubricClientResponse>
}
