import { createContext } from 'react'
import type { ClassInsight, CreateTaskInput, Essay, GradingResult, Task } from '../types'

export interface AppState {
  tasks: Task[]
  essays: Essay[]
  gradingResults: GradingResult[]
  classInsights: ClassInsight[]
  createTask: (input: CreateTaskInput) => string
  updateEssayOcrText: (essayId: string, text: string) => void
  markEssayManual: (essayId: string) => void
  completeEssayWithMockResult: (essayId: string) => void
  updateGradingResult: (essayId: string, patch: Partial<GradingResult>) => void
}

export const AppStateContext = createContext<AppState | undefined>(undefined)
