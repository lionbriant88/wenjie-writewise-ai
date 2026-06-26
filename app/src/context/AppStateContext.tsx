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

function createMockResultForEssay(essayId: string): GradingResult {
  const timestamp = new Date().toISOString()

  return {
    id: `${essayId}-result`,
    essayId,
    totalScore: 12.4,
    dimensionScores: [
      {
        id: 'content',
        name: '内容完成度',
        score: 3.4,
        maxScore: 3.75,
        weight: 25,
        reason: '主要信息点完整，细节仍可补充。',
        evidence: 'The student gives a clear suggestion and one reason.',
      },
      {
        id: 'accuracy',
        name: '语言准确性',
        score: 3,
        maxScore: 3.75,
        weight: 25,
        reason: '有少量基础语法错误。',
        evidence: 'I suggest you joins the club.',
      },
      {
        id: 'clarity',
        name: '表达清晰度',
        score: 2.1,
        maxScore: 2.25,
        weight: 15,
        reason: '文章结构清楚，衔接可更自然。',
        evidence: 'The paragraph order is easy to follow.',
      },
      {
        id: 'vocabulary',
        name: '词汇句式',
        score: 1.9,
        maxScore: 2.25,
        weight: 15,
        reason: '词汇准确，但高级表达较少。',
        evidence: 'Uses good and important repeatedly.',
      },
      {
        id: 'intention',
        name: '意图表达清晰度',
        score: 1.4,
        maxScore: 1.5,
        weight: 10,
        reason: '读者能理解学生的建议意图。',
        evidence: 'The recommendation is direct.',
      },
      {
        id: 'handwriting',
        name: '卷面/字迹',
        score: 0.9,
        maxScore: 1.5,
        weight: 10,
        reason: '个别单词连写影响识别。',
        evidence: 'Several words need manual OCR confirmation.',
      },
    ],
    errorAnnotations: [
      {
        id: `${essayId}-err-1`,
        type: 'grammar',
        original: 'I suggest you joins the club.',
        suggestion: 'I suggest you join the club.',
        explanation: 'suggest 后的宾语从句使用动词原形。',
        severity: 'high',
      },
    ],
    sentenceRevisions: [
      {
        id: `${essayId}-rev-1`,
        relatedErrorId: `${essayId}-err-1`,
        original: 'I suggest you joins the club.',
        revised: 'I suggest you join the club.',
        note: '修正 suggest 后的动词形式。',
      },
    ],
    upgradedExpressions: [
      {
        id: `${essayId}-up-1`,
        original: 'very important',
        upgraded: 'of great importance',
        note: '适合正式建议信表达。',
      },
    ],
    overallComment: '文章结构完整，建议继续减少基础语法错误，并补充更具体的行动细节。',
    aiConfidence: 0.84,
    teacherAdjusted: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

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

  const completeEssayWithMockResult = useCallback(
    (essayId: string) => {
      const targetEssay = essays.find((essay) => essay.id === essayId)
      if (!targetEssay) return

      const existingResult = gradingResults.find((result) => result.essayId === essayId)
      const resultId = existingResult?.id ?? `${essayId}-result`
      const timestamp = new Date().toISOString()

      setEssays((current) =>
        current.map((essay) =>
          essay.id === essayId
            ? {
                ...essay,
                status: 'completed',
                aiResultId: resultId,
                teacherReviewed: true,
                updatedAt: timestamp,
              }
            : essay,
        ),
      )

      setGradingResults((current) =>
        current.some((result) => result.essayId === essayId)
          ? current
          : [createMockResultForEssay(essayId), ...current],
      )
    },
    [essays, gradingResults],
  )

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
      completeEssayWithMockResult,
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
      completeEssayWithMockResult,
      updateGradingResult,
    ],
  )

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}
