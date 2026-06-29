import { createContext } from 'react'
import type { ClassInsight, CreateTaskInput, Essay, EssayPage, GradingResult, Task } from '../types'

export interface ConfirmMockOcrEssayInput {
  taskId: string
  pages: EssayPage[]
  ocrText: string
}

export interface AppState {
  tasks: Task[]
  essays: Essay[]
  gradingResults: GradingResult[]
  classInsights: ClassInsight[]
  createTask: (input: CreateTaskInput) => string
  confirmMockOcrEssay: (input: ConfirmMockOcrEssayInput) => string
  updateEssayOcrText: (essayId: string, text: string) => void
  markEssayManual: (essayId: string) => void
  completeEssayWithMockResult: (essayId: string) => void
  updateGradingResult: (essayId: string, patch: Partial<GradingResult>) => void
}

export const AppStateContext = createContext<AppState | undefined>(undefined)
