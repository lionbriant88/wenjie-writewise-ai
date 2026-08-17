import type { EvidenceCertainty, RawLogicIssueV1, RawMultimodalIssueV1, RawRecognitionWarningV1, RawSentencePairV1, RawSentenceRevisionV1 } from './multimodal/types.js'

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
  | { ok: false; error: { code: GradingErrorCode; message: string } }

export type {
  ConfirmedTaskPackageV2,
  EvidenceCertainty,
  GeneratedRubricDimensionV1,
  GeneratedRubricV1,
  MultimodalGradeInputV2,
  ProviderMultimodalPayloadV1,
  RawLegibilityIssueV1,
  RawDimensionScoreV1,
  RawExpressionUpgradeV1,
  RawLogicIssueV1,
  RawMultimodalIssueV1,
  RawRecognitionWarningScopeV1,
  RawRecognitionWarningV1,
  RawSentencePairV1,
  RawSentenceRevisionV1,
} from './multimodal/types.js'

export type GradingChangeType =
  | 'grammar'
  | 'spelling'
  | 'word_choice'
  | 'sentence_upgrade'
  | 'coherence'
  | 'logic_bridge'
  | 'delete_suggestion'
  | 'replace_sentence'
  | 'reference_clarification'

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

export interface ProviderGradingPayloadV1 {
  reportedTotalScore?: number
  dimensionScores: Array<{ dimensionId: string; score: number; reason: string; evidence: string; relatedIssueKeys: string[] }>
  recognitionWarnings: RawRecognitionWarningV1[]
  legibilityIssues: []
  issues: RawMultimodalIssueV1[]
  sentenceRevisions: RawSentenceRevisionV1[]
  expressionUpgrades: Array<{ originalText: string; upgradedText: string; note: string }>
  fullTextRevision: {
    correctedText: string
    improvedText: string
    sentencePairs: RawSentencePairV1[]
    logicNotes: Array<{ quote: string; note: string }>
    logicIssues: RawLogicIssueV1[]
  }
  overallComment: string
  modelSelfConfidence?: number
}

export interface AiGradingResultV1 {
  resultVersion: 'grading-result-v2'
  requestId: string
  essayId: string
  provider: GradingProviderName
  status: 'success' | 'partial'
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
    changeTypes: GradingChangeType[]
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
      changeTypes: GradingChangeType[]
      explanation: string
      requiresTeacherReview: boolean
    }>
    logicNotes: string[]
    logicIssues: LogicIssueV1[]
  }
  legibilityIssues: LegibilityIssueV1[]
  recognitionWarnings: string[]
  overallComment: string
  modelSelfConfidence?: number
  reviewReasons: string[]
  createdAt: string
}
