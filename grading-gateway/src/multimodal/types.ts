export interface GeneratedRubricDimensionV1 {
  id: string
  name: string
  weight: number
  description: string
  deductionFocus: string[]
  sourceEvidence: string[]
}

export interface GeneratedRubricV1 {
  taskName: string
  materialSummary: string
  writingRequirements: string[]
  constraints: string[]
  dimensions: GeneratedRubricDimensionV1[]
  reviewWarnings: string[]
}

export interface ConfirmedTaskPackageV2 {
  taskId: string
  fullScore: number
  materialSummary: string
  writingRequirements: string[]
  constraints: string[]
  rubric: GeneratedRubricV1
}

export interface MultimodalGradeInputV2 {
  task: ConfirmedTaskPackageV2
  essayId: string
  confirmedTranscript: string
  imageDataUrls: string[]
}

export interface ProviderMultimodalPayloadV1 {
  task: ConfirmedTaskPackageV2
  essay: {
    essayId: string
    confirmedTranscript: string
    imageDataUrls: string[]
  }
}

export type EvidenceCertainty = 'certain' | 'uncertain'

export type RawMultimodalChangeTypeV1 =
  | 'grammar'
  | 'spelling'
  | 'word_choice'
  | 'sentence_upgrade'
  | 'coherence'
  | 'logic_bridge'
  | 'delete_suggestion'
  | 'replace_sentence'
  | 'reference_clarification'

export interface RawMultimodalIssueV1 {
  issueKey: string
  type: 'grammar' | 'spelling' | 'word_choice' | 'structure'
  severity: 'low' | 'medium' | 'high'
  originalText: string
  suggestion: string
  explanation: string
  evidenceCertainty: EvidenceCertainty
  requiresTeacherReview: boolean
}

export interface RawSentenceRevisionV1 {
  originalText: string
  revisedText: string
  note: string
  relatedIssueKeys: string[]
  changeTypes: RawMultimodalChangeTypeV1[]
}

export interface RawSentencePairV1 {
  originalText: string
  correctedText: string
  improvedText: string
  relatedIssueKeys: string[]
  changeTypes: RawMultimodalChangeTypeV1[]
  explanation: string
  requiresTeacherReview: boolean
}

export interface RawLogicIssueV1 {
  issueKey: string
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

export interface RawLegibilityIssueV1 {
  issueKey: string
  transcriptText: string
  possibleReadings: string[]
  pageNumber: number
  regionDescription: string
  explanation: string
  defaultOutcome: 'count_as_legibility_error'
}

export interface RawDimensionScoreV1 {
  dimensionId: string
  score: number
  maxScore: number
  reason: string
  evidence: string
  relatedIssueKeys: string[]
}

export interface RawExpressionUpgradeV1 {
  originalText: string
  upgradedText: string
  note: string
}
