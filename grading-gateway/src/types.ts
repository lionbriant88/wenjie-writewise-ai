export type WritingGenre = 'practical_writing' | 'continuation_writing'
export type GradingProviderName = 'mock' | 'remote'
export type GradingErrorCode =
  | 'invalid_request'
  | 'confirmed_transcript_required'
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
  | 'request_too_large'
  | 'gateway_invalid_response'
  | 'gateway_unavailable'

export interface GradingRequestV1 {
  requestVersion: 'grading-request-v1'
  requestId: string
  task: {
    taskId: string
    writingGenre: WritingGenre
    fullScore: number
    prompt:
      | {
          writingGenre: 'practical_writing'
          taskRequirement: string
          practicalWritingType?: string
          teacherRequirements?: string
          deductionFocus?: string
          excellentFocus?: string
        }
      | {
          writingGenre: 'continuation_writing'
          sourceText: string
          paragraph1Opening: string
          paragraph2Opening: string
          teacherRequirements?: string
          deductionFocus?: string
          excellentFocus?: string
        }
    rubric: {
      status: 'confirmed'
      writingGoal: string
      offTopicCriteria: string[]
      dimensions: Array<{
        id: string
        name: string
        weight: number
        description: string
        deductionFocus: string[]
      }>
      excellentFeatures: string[]
      reviewTriggers: string[]
      teacherEditableNotes?: string
    }
  }
  essay: {
    essayId: string
    confirmedTranscript: string
    ocrContext: {
      sourceKind: 'mock' | 'remote' | 'manual'
      hasKnownOcrRisk: boolean
      riskCodes: string[]
    }
  }
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: 'invalid_request'; message: string } }
