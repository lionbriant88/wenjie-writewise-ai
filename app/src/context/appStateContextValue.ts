import { createContext } from 'react'
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
}

export interface ConfirmMockOcrEssayInput {
  taskId: string
  essayGroups: ConfirmMockOcrEssayGroup[]
}

export interface AppState {
  tasks: Task[]
  essays: Essay[]
  gradingResults: GradingResult[]
  classInsights: ClassInsight[]
  classReviewMaterials: ClassReviewMaterial[]
  createTask: (input: CreateTaskInput) => string
  confirmMockOcrEssay: (input: ConfirmMockOcrEssayInput) => void
  updateEssayOcrText: (essayId: string, text: string) => void
  markEssayManual: (essayId: string) => void
  completeEssayWithMockResult: (essayId: string) => void
  updateGradingResult: (essayId: string, patch: Partial<GradingResult>) => void
  addClassReviewMaterial: (input: ClassReviewMaterialInput) => ClassReviewMaterial
  removeClassReviewMaterial: (materialId: string) => void
  isClassReviewMaterialAdded: (input: ClassReviewMaterialInput) => boolean
}

export const AppStateContext = createContext<AppState | undefined>(undefined)
