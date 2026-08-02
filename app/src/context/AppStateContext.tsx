import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { mockClassInsights, mockEssays, mockGradingResults, mockTasks } from '../data/mockData'
import { confirmOcrAudit } from '../services/ocr/audit/transcriptAudit'
import { adaptAiGradingResult } from '../services/grading/adaptAiGradingResult'
import { buildGradingRequest } from '../services/grading/buildGradingRequest'
import { buildMultimodalGradingRequest } from '../services/grading/buildMultimodalGradingRequest'
import { createConfiguredGradingClient } from '../services/grading/gradingClient'
import { createMockGradingClient } from '../services/grading/mockGradingClient'
import type { GradingClient, GradingFailureV1 } from '../services/grading/types'
import type {
  ClassInsight,
  ClassReviewMaterial,
  ClassReviewMaterialInput,
  CreateTaskInput,
  Essay,
  GradingResult,
  Task,
  TaskStatus,
} from '../types'
import { getClassReviewMaterialKey } from '../utils/classReviewMaterials'
import { AppStateContext, type ConfirmMockOcrEssayInput, type EnqueueImageEssaysInput } from './appStateContextValue'
import {
  beginGradingAttempt,
  confirmGradingTransition,
  invalidateGradingAfterTranscriptEdit,
  markEssayManualTransition,
  recordGradingPreflightFailure,
  settleGradingFailure,
  settleGradingSuccess,
  type EssayTransition,
} from './gradingStateTransitions'

const terminalEssayStatuses = new Set<Essay['status']>(['completed', 'manual'])
const activeEssayStatuses = new Set<Essay['status']>([
  'pending_ocr', 'ocr_running', 'pending_grading', 'grading', 'grading_ready',
])
const localMockGradingClient = createMockGradingClient()

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
  return tasks.map((task) => task.id === taskId
    ? {
        ...task,
        status: getTaskStatusFromEssays(taskEssays),
        totalEssayCount: taskEssays.length,
        completedEssayCount,
        exceptionEssayCount,
        updatedAt: timestamp,
      }
    : task)
}

interface AppStateProviderProps {
  children: ReactNode
  gradingClient?: GradingClient
}

export function AppStateProvider({ children, gradingClient }: AppStateProviderProps) {
  const [tasks, setTasks] = useState<Task[]>(mockTasks)
  const [essays, setEssays] = useState<Essay[]>(mockEssays)
  const [isGradingInFlight, setIsGradingInFlight] = useState(false)
  const [gradingResults, setGradingResults] = useState<GradingResult[]>(mockGradingResults)
  const [classInsights] = useState<ClassInsight[]>(mockClassInsights)
  const [classReviewMaterials, setClassReviewMaterials] = useState<ClassReviewMaterial[]>([])
  const tasksRef = useRef(tasks)
  const essaysRef = useRef(essays)
  const gradingInFlightRef = useRef(new Map<string, string>())
  const gradingSequenceRef = useRef(0)
  const imageSubmissionIdsRef = useRef(new Set<string>())
  const gradingClientRef = useRef<GradingClient | null>(null)
  if (!gradingClientRef.current) {
    gradingClientRef.current = gradingClient ?? createConfiguredGradingClient()
  }

  useEffect(() => { tasksRef.current = tasks }, [tasks])
  useEffect(() => { essaysRef.current = essays }, [essays])

  const commitEssayTransition = useCallback((transition: EssayTransition, timestamp: string) => {
    if (!transition.applied || !transition.taskId) return false
    essaysRef.current = transition.essays
    setEssays(transition.essays)
    setTasks((currentTasks) => {
      const updated = updateTasksFromEssays(currentTasks, transition.taskId!, transition.essays, timestamp)
      tasksRef.current = updated
      return updated
    })
    return true
  }, [])

  const createTask = useCallback((input: CreateTaskInput) => {
    const id = `task-${Date.now()}`
    const timestamp = new Date().toISOString()
    const nextTask: Task = {
      id,
      taskName: input.taskName,
      className: input.className ?? (input.materialContext ? '待选择班级' : ''),
      essayType: input.essayType ?? (input.materialContext ? '材料写作' : ''),
      fullScore: input.fullScore,
      scoringTemplateId: input.scoringTemplateId ?? (input.materialContext ? 'kimi-generated-v1' : ''),
      ...(input.writingGenre ? { writingGenre: input.writingGenre } : {}),
      ...(input.promptInfo ? { promptInfo: input.promptInfo } : {}),
      ...(input.rubricDraft ? { rubricDraft: input.rubricDraft } : {}),
      ...(input.materialContext ? { materialContext: input.materialContext } : {}),
      status: 'draft',
      totalEssayCount: 0,
      completedEssayCount: 0,
      exceptionEssayCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      generateClassReview: input.generateClassReview ?? Boolean(input.materialContext),
    }
    const nextTasks = [nextTask, ...tasksRef.current]
    tasksRef.current = nextTasks
    setTasks(nextTasks)
    return id
  }, [])

  const assignTaskClass = useCallback((taskId: string, className: string) => {
    const updatedAt = new Date().toISOString()
    const nextTasks = tasksRef.current.map((task) => task.id === taskId
      ? { ...task, className, updatedAt }
      : task)
    tasksRef.current = nextTasks
    setTasks(nextTasks)
  }, [])

  const confirmMockOcrEssay = useCallback(({ taskId, essayGroups }: ConfirmMockOcrEssayInput) => {
    const timestamp = new Date().toISOString()
    const current = essaysRef.current
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
        ocrAudit: group.ocrAudit,
        ocrConfidence: 0.88,
        status: 'pending_grading',
        exceptionReasons: [],
        teacherReviewed: false,
        gradingRun: { status: 'idle' },
        createdAt: timestamp,
        updatedAt: timestamp,
      }
    })
    const nextEssays = [...current, ...createdEssays]
    essaysRef.current = nextEssays
    setEssays(nextEssays)
    setTasks((currentTasks) => {
      const updated = updateTasksFromEssays(currentTasks, taskId, nextEssays, timestamp)
      tasksRef.current = updated
      return updated
    })
  }, [])

  const enqueueImageEssays = useCallback(({ submissionId, taskId, className, essayGroups }: EnqueueImageEssaysInput) => {
    const timestamp = new Date().toISOString()
    if (!submissionId.trim() || imageSubmissionIdsRef.current.has(submissionId) || !className.trim() || !tasksRef.current.some((task) => task.id === taskId)) return
    imageSubmissionIdsRef.current.add(submissionId)
    const current = essaysRef.current
    const taskEssayCount = current.filter((essay) => essay.taskId === taskId).length
    const createdEssays = essayGroups.map((group, groupIndex): Essay => {
      const id = `${taskId}-uploaded-${submissionId}-${groupIndex + 1}`
      const pages = group.pages.map((page, pageIndex) => ({ ...page, id: `${id}-page-${pageIndex + 1}`, pageNumber: pageIndex + 1 }))
      return {
        id, taskId, essayNumber: `作文 ${taskEssayCount + groupIndex + 1}`, pages, pageCount: pages.length,
        pageOrder: pages.map((page) => page.id), ocrText: '', ocrConfidence: 0, status: 'pending_grading',
        exceptionReasons: [], teacherReviewed: false, gradingRun: { status: 'idle' }, createdAt: timestamp, updatedAt: timestamp,
      }
    })
    const nextEssays = [...current, ...createdEssays]
    essaysRef.current = nextEssays
    setEssays(nextEssays)
    setTasks((currentTasks) => {
      const updated = updateTasksFromEssays(currentTasks.map((task) => task.id === taskId ? { ...task, className: className.trim(), updatedAt: timestamp } : task), taskId, nextEssays, timestamp)
      tasksRef.current = updated
      return updated
    })
  }, [])

  const updateEssayOcrText = useCallback((essayId: string, text: string, confirmedAt?: string) => {
    const timestamp = confirmedAt ?? new Date().toISOString()
    const target = essaysRef.current.find((essay) => essay.id === essayId)
    if (!target || target.ocrText === text || target.status === 'grading' || target.gradingRun?.status === 'running') return

    const invalidated = invalidateGradingAfterTranscriptEdit(essaysRef.current, essayId, timestamp)
    const source = invalidated.applied ? invalidated.essays : essaysRef.current
    const nextEssays = source.map((essay) => essay.id === essayId
      ? {
          ...essay,
          ocrText: text,
          transcriptSource: 'teacher_confirmed' as const,
          ocrAudit: target.ocrAudit ? confirmOcrAudit(target.ocrAudit, text, timestamp) : undefined,
          updatedAt: timestamp,
        }
      : essay)
    essaysRef.current = nextEssays
    setEssays(nextEssays)
    if (invalidated.applied && invalidated.taskId) {
      setGradingResults((current) => current.filter((result) => result.essayId !== essayId))
      setTasks((currentTasks) => {
        const updated = updateTasksFromEssays(currentTasks, invalidated.taskId!, nextEssays, timestamp)
        tasksRef.current = updated
        return updated
      })
    }
  }, [])

  const markEssayManual = useCallback((essayId: string) => {
    const timestamp = new Date().toISOString()
    commitEssayTransition(markEssayManualTransition(essaysRef.current, essayId, timestamp), timestamp)
  }, [commitEssayTransition])

  const runGrading = useCallback(async (
    essayId: string,
    client: GradingClient,
    transcriptPolicy: 'confirmed_only' | 'allow_legacy_mock',
  ) => {
    if (gradingInFlightRef.current.size > 0) return
    const targetEssay = essaysRef.current.find((essay) => essay.id === essayId)
    if (!targetEssay) return
    const task = tasksRef.current.find((item) => item.id === targetEssay.taskId)
    if (!task) return

    gradingSequenceRef.current += 1
    const requestId = `grading-${essayId}-${gradingSequenceRef.current}-${crypto.randomUUID?.() ?? Date.now()}`
    const built = task.materialContext
      ? buildMultimodalGradingRequest(task, targetEssay, requestId)
      : buildGradingRequest(task, targetEssay, requestId, transcriptPolicy)
    if (!built.ok) {
      const completedAt = new Date().toISOString()
      commitEssayTransition(
        recordGradingPreflightFailure(essaysRef.current, essayId, requestId, built.error, completedAt),
        completedAt,
      )
      return
    }

    const startedAt = new Date().toISOString()
    const started = beginGradingAttempt(essaysRef.current, essayId, requestId, startedAt)
    if (!commitEssayTransition(started, startedAt)) return
    gradingInFlightRef.current.set(essayId, requestId)
    setIsGradingInFlight(true)
    try {
      const response = 'requestVersion' in built.request && built.request.requestVersion === 'multimodal-grading-request-v2'
        ? client.gradeImages
          ? await client.gradeImages(built.request)
          : { requestId, status: 'failed' as const, error: { code: 'gateway_unavailable' as const, message: '批改服务暂时不可用，请重试。', retryable: true } }
        : await client.grade(built.request)
      if (response.status === 'failed') {
        const completedAt = new Date().toISOString()
        commitEssayTransition(
          settleGradingFailure(essaysRef.current, essayId, requestId, response, completedAt),
          completedAt,
        )
        return
      }
      const adapted = adaptAiGradingResult(response, built.request)
      const settled = settleGradingSuccess(
        essaysRef.current, essayId, requestId, adapted.id, response,
        'requestVersion' in built.request && built.request.requestVersion === 'multimodal-grading-request-v2'
          ? built.request.confirmedTranscript !== undefined
            ? { transcriptSource: 'teacher_confirmed', confirmedTranscript: built.request.confirmedTranscript }
            : { transcriptSource: 'kimi_vision' }
          : {},
      )
      if (!commitEssayTransition(settled, response.createdAt)) return
      setGradingResults((current) => [adapted, ...current.filter((item) => item.essayId !== essayId)])
    } catch {
      const completedAt = new Date().toISOString()
      const failure: GradingFailureV1 = {
        requestId,
        status: 'failed',
        error: {
          code: 'gateway_unavailable',
          message: '批改服务暂时不可用，请重试或使用 mock 回退。',
          retryable: true,
        },
      }
      commitEssayTransition(
        settleGradingFailure(essaysRef.current, essayId, requestId, failure, completedAt),
        completedAt,
      )
    } finally {
      if (gradingInFlightRef.current.get(essayId) === requestId) {
        gradingInFlightRef.current.delete(essayId)
        setIsGradingInFlight(false)
      }
    }
  }, [commitEssayTransition])

  const gradeEssay = useCallback(
    (essayId: string) => runGrading(essayId, gradingClientRef.current!, 'confirmed_only'),
    [runGrading],
  )
  const retryGradeEssay = useCallback(
    (essayId: string) => runGrading(essayId, gradingClientRef.current!, 'confirmed_only'),
    [runGrading],
  )
  const fallbackToMockGrading = useCallback(
    (essayId: string) => runGrading(essayId, localMockGradingClient, 'allow_legacy_mock'),
    [runGrading],
  )
  const confirmGradingResult = useCallback((essayId: string) => {
    const timestamp = new Date().toISOString()
    commitEssayTransition(confirmGradingTransition(essaysRef.current, essayId, timestamp), timestamp)
  }, [commitEssayTransition])

  const updateGradingResult = useCallback((essayId: string, patch: Partial<GradingResult>) => {
    setGradingResults((current) => current.map((result) => result.essayId === essayId
      ? { ...result, ...patch, teacherAdjusted: true, updatedAt: new Date().toISOString() }
      : result))
  }, [])

  const addClassReviewMaterial = useCallback((input: ClassReviewMaterialInput) => {
    const key = getClassReviewMaterialKey(input)
    const material: ClassReviewMaterial = {
      ...input,
      id: `material-${key}`,
      createdAt: new Date().toISOString(),
    }
    setClassReviewMaterials((current) => current.some((item) => getClassReviewMaterialKey(item) === key)
      ? current
      : [material, ...current])
    return material
  }, [])

  const removeClassReviewMaterial = useCallback((materialId: string) => {
    setClassReviewMaterials((current) => current.filter((material) => material.id !== materialId))
  }, [])

  const isClassReviewMaterialAdded = useCallback((input: ClassReviewMaterialInput) => {
    const key = getClassReviewMaterialKey(input)
    return classReviewMaterials.some((material) => getClassReviewMaterialKey(material) === key)
  }, [classReviewMaterials])

  const value = useMemo(() => ({
    tasks,
    essays,
    isGradingInFlight,
    gradingResults,
    classInsights,
    classReviewMaterials,
    createTask,
    assignTaskClass,
    confirmMockOcrEssay,
    enqueueImageEssays,
    updateEssayOcrText,
    markEssayManual,
    gradeEssay,
    retryGradeEssay,
    fallbackToMockGrading,
    confirmGradingResult,
    updateGradingResult,
    addClassReviewMaterial,
    removeClassReviewMaterial,
    isClassReviewMaterialAdded,
  }), [
    tasks,
    essays,
    isGradingInFlight,
    gradingResults,
    classInsights,
    classReviewMaterials,
    createTask,
    assignTaskClass,
    confirmMockOcrEssay,
    enqueueImageEssays,
    updateEssayOcrText,
    markEssayManual,
    gradeEssay,
    retryGradeEssay,
    fallbackToMockGrading,
    confirmGradingResult,
    updateGradingResult,
    addClassReviewMaterial,
    removeClassReviewMaterial,
    isClassReviewMaterialAdded,
  ])

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}
