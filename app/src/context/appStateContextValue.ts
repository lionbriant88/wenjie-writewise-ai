import { createContext } from 'react'
import type { LocalGenerationRecord } from '../services/classReview/classReviewRegistry'
import type { AiSummaryV1, ClassReviewReportV1, Severity } from '../services/classReview/types'
import type { OcrTranscriptAudit } from '../services/ocr/audit/types'
import type { TaskQueueSnapshot } from '../services/grading/taskGradingScheduler'
import type {
  ClassInsight,
  ClassReviewMaterial,
  ClassReviewMaterialInput,
  CreateTaskInput,
  Essay,
  EssayPage,
  GradingResult,
  Task,
} from '../types'

export interface ConfirmMockOcrEssayGroup {
  pages: EssayPage[]
  ocrText: string
  ocrAudit: OcrTranscriptAudit
}

export interface ConfirmMockOcrEssayInput {
  taskId: string
  essayGroups: ConfirmMockOcrEssayGroup[]
}

export interface EnqueueImageEssaysInput {
  submissionId: string
  taskId: string
  className: string
  essayGroups: Array<{ studentName?: string; pages: EssayPage[] }>
}

export interface ClassReviewAppSnapshot {
  report: ClassReviewReportV1
  generation: LocalGenerationRecord | null
  candidate: { readonly available: true; readonly generationId: string } | null
  requestId: string | null
  boundedRequeueCount: number
  providerSettlementKnown: boolean
  sourceReady: boolean
  taskDeleted: boolean
  sourceRevisionEpoch: number
  canGenerate: boolean
  isSettled: boolean
}

export interface AddClassReviewIssueInput {
  taskId: string
  essayId: string
  sourceLocator: string
  sourceResultRevision: number
  title: string
  diagnosis: string
  teachingAction: string
  severity: Severity
  anonymousExample: string | null
  occurrenceCount?: number
}

export interface ClassReviewAppCommands {
  getSnapshot: (taskId: string) => ClassReviewAppSnapshot
  generate: (taskId: string, intent?: 'initial' | 'regenerate') => Promise<LocalGenerationRecord>
  checkGeneration: (taskId: string) => ClassReviewAppSnapshot
  applyCandidate: (taskId: string, generationId?: string) => void
  discardCandidate: (taskId: string, generationId?: string) => void
  beginAiTextEdit: (taskId: string) => void
  saveAiTextEdit: (taskId: string, summary: AiSummaryV1) => void
  cancelAiTextEdit: (taskId: string) => void
  addIssue: (input: AddClassReviewIssueInput) => void
  removeIssue: (taskId: string, evidenceId: string) => void
  undoIssueRemoval: (taskId: string) => void
  moveIssue: (taskId: string, blockId: string, toIndex: number) => void
  deleteSource: (taskId: string, removedTeacherEvidenceIds?: readonly string[]) => void
}

export interface AppState {
  tasks: Task[]
  essays: Essay[]
  taskGradingQueues: Readonly<Record<string, TaskQueueSnapshot>>
  /** @deprecated The queue snapshot should be used for per-task/per-essay state. */
  isGradingInFlight: boolean
  gradingResults: GradingResult[]
  classInsights: ClassInsight[]
  classReviewMaterials: ClassReviewMaterial[]
  classReview: ClassReviewAppCommands
  createTask: (input: CreateTaskInput) => string
  assignTaskClass: (taskId: string, className: string) => void
  confirmMockOcrEssay: (input: ConfirmMockOcrEssayInput) => void
  enqueueImageEssays: (input: EnqueueImageEssaysInput) => void
  updateEssayOcrText: (essayId: string, text: string, confirmedAt?: string) => void
  markEssayManual: (essayId: string) => void
  startTaskGrading: (taskId: string) => void
  retryTaskEssay: (essayId: string) => void
  checkUnknownTaskEssay: (essayId: string) => void
  resumeTaskGrading: (taskId: string) => void
  /** @deprecated Compatibility wrapper; use startTaskGrading. */
  gradeEssay: (essayId: string) => Promise<void>
  /** @deprecated Compatibility wrapper; use retryTaskEssay. */
  retryGradeEssay: (essayId: string) => Promise<void>
  confirmGradingResult: (essayId: string) => void
  updateGradingResult: (essayId: string, patch: Partial<GradingResult>) => void
  addClassReviewMaterial: (input: ClassReviewMaterialInput) => ClassReviewMaterial
  removeClassReviewMaterial: (materialId: string) => void
  isClassReviewMaterialAdded: (input: ClassReviewMaterialInput) => boolean
}

export const AppStateContext = createContext<AppState | undefined>(undefined)
