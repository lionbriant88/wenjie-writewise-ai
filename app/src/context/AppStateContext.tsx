import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { mockClassInsights, mockEssays, mockGradingResults, mockTasks } from '../data/mockData'
import type {
  ClassInsight,
  CreateTaskInput,
  Essay,
  GradingResult,
  Task,
} from '../types'
import { AppStateContext } from './appStateContextValue'

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>(mockTasks)
  const [essays, setEssays] = useState<Essay[]>(mockEssays)
  const [gradingResults, setGradingResults] = useState<GradingResult[]>(mockGradingResults)
  const [classInsights] = useState<ClassInsight[]>(mockClassInsights)

  const createTask = useCallback((input: CreateTaskInput) => {
    const id = `task-${Date.now()}`
    const timestamp = new Date().toISOString()
    const nextTask: Task = {
      id,
      taskName: input.taskName,
      className: input.className,
      essayType: input.essayType,
      fullScore: input.fullScore,
      scoringTemplateId: input.scoringTemplateId,
      status: 'draft',
      totalEssayCount: 0,
      completedEssayCount: 0,
      exceptionEssayCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      generateClassReview: input.generateClassReview,
    }

    setTasks((current) => [nextTask, ...current])
    return id
  }, [])

  const updateEssayOcrText = useCallback((essayId: string, text: string) => {
    setEssays((current) =>
      current.map((essay) =>
        essay.id === essayId
          ? { ...essay, ocrText: text, updatedAt: new Date().toISOString() }
          : essay,
      ),
    )
  }, [])

  const markEssayManual = useCallback((essayId: string) => {
    setEssays((current) =>
      current.map((essay) =>
        essay.id === essayId
          ? {
              ...essay,
              status: 'manual',
              teacherReviewed: true,
              updatedAt: new Date().toISOString(),
            }
          : essay,
      ),
    )
  }, [])

  const updateGradingResult = useCallback(
    (essayId: string, patch: Partial<GradingResult>) => {
      setGradingResults((current) =>
        current.map((result) =>
          result.essayId === essayId
            ? {
                ...result,
                ...patch,
                teacherAdjusted: true,
                updatedAt: new Date().toISOString(),
              }
            : result,
        ),
      )
    },
    [],
  )

  const value = useMemo(
    () => ({
      tasks,
      essays,
      gradingResults,
      classInsights,
      createTask,
      updateEssayOcrText,
      markEssayManual,
      updateGradingResult,
    }),
    [
      tasks,
      essays,
      gradingResults,
      classInsights,
      createTask,
      updateEssayOcrText,
      markEssayManual,
      updateGradingResult,
    ],
  )

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}
