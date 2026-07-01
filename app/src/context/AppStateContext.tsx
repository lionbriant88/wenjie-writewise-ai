import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { createMockFullTextRevision, mockClassInsights, mockEssays, mockGradingResults, mockTasks } from '../data/mockData'
import type {
  ClassInsight,
  CreateTaskInput,
  Essay,
  GradingResult,
  Task,
  TaskStatus,
} from '../types'
import { AppStateContext, type ConfirmMockOcrEssayInput } from './appStateContextValue'

const terminalEssayStatuses = new Set<Essay['status']>(['completed', 'manual'])
const activeEssayStatuses = new Set<Essay['status']>(['pending_ocr', 'ocr_running', 'pending_grading', 'grading'])

function getTaskStatusFromEssays(essays: Essay[]): TaskStatus {
  const exceptionCount = essays.filter((essay) => essay.status === 'needs_review').length
  const completedCount = essays.filter((essay) => terminalEssayStatuses.has(essay.status)).length
  const activeCount = essays.filter((essay) => activeEssayStatuses.has(essay.status)).length

  if (exceptionCount > 0) return 'needs_review'
  if (essays.length > 0 && completedCount === essays.length) return 'ready'
  if (activeCount > 0 || essays.length > 0) return 'processing'
  return 'draft'
}

function updateTasksFromEssays(tasks: Task[], taskId: string, essays: Essay[], timestamp: string): Task[] {
  const taskEssays = essays.filter((essay) => essay.taskId === taskId)
  const completedEssayCount = taskEssays.filter((essay) => terminalEssayStatuses.has(essay.status)).length
  const exceptionEssayCount = taskEssays.filter((essay) => essay.status === 'needs_review').length

  return tasks.map((task) =>
    task.id === taskId
      ? {
          ...task,
          status: getTaskStatusFromEssays(taskEssays),
          totalEssayCount: taskEssays.length,
          completedEssayCount,
          exceptionEssayCount,
          updatedAt: timestamp,
        }
      : task,
  )
}

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
    fullTextRevision: createMockFullTextRevision(essayId),
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

  const confirmMockOcrEssay = useCallback(({ taskId, essayGroups }: ConfirmMockOcrEssayInput) => {
    const timestamp = new Date().toISOString()

    setEssays((current) => {
      const taskEssayCount = current.filter((essay) => essay.taskId === taskId).length
      const createdEssays = essayGroups.map((group, groupIndex): Essay => {
        const id = `${taskId}-uploaded-${Date.now()}-${groupIndex + 1}`
        const essayPages = group.pages.map((page, pageIndex) => ({
          ...page,
          id: `${id}-page-${pageIndex + 1}`,
          pageNumber: pageIndex + 1,
        }))

        return {
          id,
          taskId,
          essayNumber: `作文 ${taskEssayCount + groupIndex + 1}`,
          pages: essayPages,
          pageCount: essayPages.length,
          pageOrder: essayPages.map((page) => page.id),
          ocrText: group.ocrText,
          ocrConfidence: 0.88,
          status: 'pending_grading',
          exceptionReasons: [],
          teacherReviewed: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
      })
      const nextEssays = [...current, ...createdEssays]
      setTasks((currentTasks) => updateTasksFromEssays(currentTasks, taskId, nextEssays, timestamp))
      return nextEssays
    })
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
    const timestamp = new Date().toISOString()

    setEssays((current) => {
      const targetEssay = current.find((essay) => essay.id === essayId)
      if (!targetEssay) return current

      const nextEssays = current.map((essay): Essay =>
        essay.id === essayId
          ? {
              ...essay,
              status: 'manual',
              teacherReviewed: true,
              updatedAt: timestamp,
            }
          : essay,
      )

      setTasks((currentTasks) => updateTasksFromEssays(currentTasks, targetEssay.taskId, nextEssays, timestamp))
      return nextEssays
    })
  }, [])

  const completeEssayWithMockResult = useCallback(
    (essayId: string) => {
      const targetEssay = essays.find((essay) => essay.id === essayId)
      if (!targetEssay) return

      const existingResult = gradingResults.find((result) => result.essayId === essayId)
      const resultId = existingResult?.id ?? `${essayId}-result`
      const timestamp = new Date().toISOString()

      setEssays((current) => {
        const nextEssays = current.map((essay): Essay =>
          essay.id === essayId
            ? {
                ...essay,
                status: 'completed',
                aiResultId: resultId,
                teacherReviewed: true,
                updatedAt: timestamp,
              }
            : essay,
        )

        setTasks((currentTasks) => updateTasksFromEssays(currentTasks, targetEssay.taskId, nextEssays, timestamp))
        return nextEssays
      })

      setGradingResults((current) =>
        current.some((result) => result.essayId === essayId)
          ? current
          : [createMockResultForEssay(essayId), ...current],
      )
    },
    [essays, gradingResults],
  )

  const updateGradingResult = useCallback((essayId: string, patch: Partial<GradingResult>) => {
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
  }, [])

  const value = useMemo(
    () => ({
      tasks,
      essays,
      gradingResults,
      classInsights,
      createTask,
      confirmMockOcrEssay,
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
      confirmMockOcrEssay,
      updateEssayOcrText,
      markEssayManual,
      completeEssayWithMockResult,
      updateGradingResult,
    ],
  )

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}
