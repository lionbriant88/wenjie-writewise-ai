import { createContext } from 'react'
import type { OcrTranscriptAudit } from '../services/ocr/audit/types'
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
  essayGroups: Array<{ pages: EssayPage[] }>
}

export interface AppState {
  tasks: Task[]
  essays: Essay[]
  isGradingInFlight: boolean
  gradingResults: GradingResult[]
  classInsights: ClassInsight[]
  classReviewMaterials: ClassReviewMaterial[]
  createTask: (input: CreateTaskInput) => string
  assignTaskClass: (taskId: string, className: string) => void
  confirmMockOcrEssay: (input: ConfirmMockOcrEssayInput) => void
  enqueueImageEssays: (input: EnqueueImageEssaysInput) => void
  updateEssayOcrText: (essayId: string, text: string, confirmedAt?: string) => void
  markEssayManual: (essayId: string) => void
  gradeEssay: (essayId: string) => Promise<void>
  retryGradeEssay: (essayId: string) => Promise<void>
  fallbackToMockGrading: (essayId: string) => Promise<void>
  confirmGradingResult: (essayId: string) => void
  updateGradingResult: (essayId: string, patch: Partial<GradingResult>) => void
  addClassReviewMaterial: (input: ClassReviewMaterialInput) => ClassReviewMaterial
  removeClassReviewMaterial: (materialId: string) => void
  isClassReviewMaterialAdded: (input: ClassReviewMaterialInput) => boolean
}

export const AppStateContext = createContext<AppState | undefined>(undefined)
