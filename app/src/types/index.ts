export type TaskStatus = 'draft' | 'processing' | 'ready' | 'needs_review'

export type EssayStatus =
  | 'pending_ocr'
  | 'ocr_running'
  | 'pending_grading'
  | 'grading'
  | 'completed'
  | 'needs_review'
  | 'manual'

export type ExceptionReason =
  | 'low_ocr_confidence'
  | 'blurry_image'
  | 'messy_handwriting'

export interface Task {
  id: string
  taskName: string
  className: string
  essayType: string
  fullScore: number
  scoringTemplateId: string
  status: TaskStatus
  totalEssayCount: number
  completedEssayCount: number
  exceptionEssayCount: number
  createdAt: string
  updatedAt: string
  generateClassReview: boolean
}

export interface EssayPage {
  id: string
  label: string
  pageNumber: number
  quality: 'clear' | 'blurred' | 'dark' | 'tilted' | 'messy'
  accent: string
  previewUrl?: string
}

export interface Essay {
  id: string
  taskId: string
  essayNumber: string
  pages: EssayPage[]
  pageCount: number
  pageOrder: string[]
  ocrText: string
  ocrConfidence: number
  status: EssayStatus
  exceptionReasons: ExceptionReason[]
  aiResultId?: string
  teacherReviewed: boolean
  createdAt: string
  updatedAt: string
}

export interface ScoreDimension {
  id: string
  name: string
  score: number
  maxScore: number
  weight: number
  reason: string
  evidence: string
}

export interface ErrorAnnotation {
  id: string
  type: 'grammar' | 'spelling' | 'word_choice' | 'structure'
  original: string
  suggestion: string
  explanation: string
  severity: 'low' | 'medium' | 'high'
}

export interface SentenceRevision {
  id: string
  relatedErrorId: string
  original: string
  revised: string
  note: string
}

export interface UpgradedExpression {
  id: string
  original: string
  upgraded: string
  note: string
}

export type FullTextChangeType =
  | 'grammar'
  | 'spelling'
  | 'word_choice'
  | 'sentence_upgrade'
  | 'coherence'
  | 'logic_bridge'
  | 'delete_suggestion'
  | 'replace_sentence'
  | 'reference_clarification'

export type LogicIssueSubType =
  | 'weak_connection'
  | 'unclear_logic'
  | 'missing_cause_effect'
  | 'unclear_transition'
  | 'topic_drift'
  | 'irrelevant_sentence'
  | 'unclear_reference'
  | 'missing_motivation'
  | 'plot_gap'

export type LogicSuggestionAction =
  | 'add_connector'
  | 'add_bridge_sentence'
  | 'delete_sentence'
  | 'replace_sentence'
  | 'clarify_reference'
  | 'ask_student_to_explain'

export interface LogicIssue {
  id: string
  sentenceId?: string
  original: string
  contextBefore?: string
  contextAfter?: string
  subType: LogicIssueSubType
  severity: 'low' | 'medium' | 'high'
  diagnosis: string
  suggestedAction: LogicSuggestionAction
  conservativeSuggestion?: string
  polishedSuggestion?: string
  needsTeacherReview?: boolean
}

export interface FullTextSentencePair {
  id: string
  original: string
  corrected: string
  polished: string
  changeTypes: FullTextChangeType[]
  explanation: string
  preservesOriginalIntent: boolean
  needsTeacherReview?: boolean
}

export interface FullTextRevision {
  originalText: string
  correctedText: string
  polishedText: string
  sentencePairs: FullTextSentencePair[]
  logicIssues: LogicIssue[]
  logicNotes: string[]
}

export interface GradingResult {
  id: string
  essayId: string
  totalScore: number
  dimensionScores: ScoreDimension[]
  errorAnnotations: ErrorAnnotation[]
  sentenceRevisions: SentenceRevision[]
  upgradedExpressions: UpgradedExpression[]
  fullTextRevision?: FullTextRevision
  overallComment: string
  teacherSuggestion?: string
  aiConfidence: number
  teacherAdjusted: boolean
  createdAt: string
  updatedAt: string
}

export interface ClassInsightItem {
  id: string
  title: string
  detail: string
  count?: number
  examples: string[]
}

export interface ClassInsight {
  id: string
  taskId: string
  grammarErrors: ClassInsightItem[]
  spellingErrors: ClassInsightItem[]
  typicalSentences: ClassInsightItem[]
  rewriteExercises: ClassInsightItem[]
}

export interface CreateTaskInput {
  taskName: string
  className: string
  essayType: string
  fullScore: number
  scoringTemplateId: string
  generateClassReview: boolean
}
