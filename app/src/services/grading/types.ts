import type { FullTextChangeType, WritingGenre } from '../../types'

export type EvidenceCertainty = 'certain' | 'uncertain'

export interface LogicIssueV1 {
  id: string
  originalText: string
  contextBefore: string
  contextAfter: string
  subType: 'weak_connection' | 'unclear_logic' | 'missing_cause_effect' | 'unclear_transition' | 'topic_drift' | 'irrelevant_sentence' | 'unclear_reference' | 'missing_motivation' | 'plot_gap'
  severity: 'low' | 'medium' | 'high'
  diagnosis: string
  suggestedAction: 'add_connector' | 'add_bridge_sentence' | 'delete_sentence' | 'replace_sentence' | 'clarify_reference' | 'ask_student_to_explain'
  conservativeSuggestion: string
  polishedSuggestion: string
  requiresTeacherReview: boolean
}

export interface LegibilityIssueV1 {
  id: string
  transcriptText: string
  possibleReadings: string[]
  pageNumber: number
  regionDescription: string
  explanation: string
  defaultOutcome: 'count_as_legibility_error'
}

export type GradingProviderName = 'mock' | 'remote'
export type GradingStatus = 'success' | 'partial'
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
  | 'provider_result_unknown'
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

export interface ConfirmedTaskPackageV2 {
  taskId: string
  fullScore: number
  materialSummary: string
  writingRequirements: string[]
  constraints: string[]
  rubric: {
    taskName: string
    materialSummary: string
    writingRequirements: string[]
    constraints: string[]
    dimensions: Array<{
      id: string
      name: string
      weight: number
      description: string
      deductionFocus: string[]
      sourceEvidence: string[]
    }>
    reviewWarnings: string[]
  }
}

export interface MultimodalGradingRequestV2 {
  requestVersion: 'multimodal-grading-request-v2'
  requestId: string
  essayId: string
  pageIds: string[]
  task: ConfirmedTaskPackageV2
  pages: Array<{ pageId: string; file: File }>
  /** Exact teacher-confirmed transcript to grade instead of re-transcribing the images. */
  confirmedTranscript?: string
}

export interface AiGradingResultV1 {
  resultVersion: 'grading-result-v2'
  requestId: string
  essayId: string
  provider: GradingProviderName
  status: GradingStatus
  totalScore: number
  maxScore: number
  dimensionScores: Array<{
    dimensionId: string
    name: string
    score: number
    maxScore: number
    weight: number
    reason: string
    evidence: string
    requiresTeacherReview?: boolean
  }>
  issues: Array<{
    id: string
    type: 'grammar' | 'spelling' | 'word_choice' | 'structure'
    severity: 'low' | 'medium' | 'high'
    originalText: string
    suggestion: string
    explanation: string
    evidenceCertainty: EvidenceCertainty
    requiresTeacherReview: boolean
  }>
  sentenceRevisions: Array<{
    id: string
    relatedIssueIds: string[]
    originalText: string
    revisedText: string
    note: string
    changeTypes: FullTextChangeType[]
    requiresTeacherReview?: boolean
  }>
  expressionUpgrades: Array<{
    id: string
    originalText: string
    upgradedText: string
    note: string
    requiresTeacherReview?: boolean
  }>
  fullTextRevision: {
    originalText: string
    correctedText: string
    improvedText: string
    sentencePairs: Array<{
      id: string
      originalText: string
      correctedText: string
      improvedText: string
      relatedIssueIds: string[]
      changeTypes: FullTextChangeType[]
      explanation: string
      requiresTeacherReview: boolean
    }>
    logicNotes: string[]
    logicIssues: LogicIssueV1[]
  }
  legibilityIssues: LegibilityIssueV1[]
  overallComment: string
  modelSelfConfidence?: number
  reviewReasons: string[]
  createdAt: string
  transcript?: string
  recognitionWarnings: string[]
  printedTextExcluded?: boolean
}

export interface GradingFailureV1 {
  requestId: string
  status: 'failed'
  error: { code: GradingErrorCode; message: string; retryable: boolean }
}

export interface GradingClientFailure extends GradingFailureV1 {
  clientMeta?: { retryAfterMs?: number; reattachOnly?: true }
}

export type GradingGatewayResponse = AiGradingResultV1 | GradingFailureV1
export type GradingClientResponse = AiGradingResultV1 | GradingClientFailure

export interface GradingClient {
  gradeImages(request: MultimodalGradingRequestV2): Promise<GradingClientResponse>
}
