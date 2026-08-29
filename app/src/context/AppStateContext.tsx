import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { mockClassInsights, mockEssays, mockGradingResults, mockTasks } from '../data/mockData'
import { confirmOcrAudit } from '../services/ocr/audit/transcriptAudit'
import { adaptAiGradingResult } from '../services/grading/adaptAiGradingResult'
import { buildMultimodalGradingRequest } from '../services/grading/buildMultimodalGradingRequest'
import { createConfiguredGradingClient } from '../services/grading/gradingClient'
import { createGradingJobIdentityStore } from '../services/grading/gradingJobIdentity'
import { parseGradingRuntimeConfig } from '../services/grading/gradingRuntimeConfig'
import {
  createTaskGradingScheduler,
  type GradingJob,
  type TaskGradingSchedulerOptions,
  type TaskQueueSnapshot,
} from '../services/grading/taskGradingScheduler'
import type {
  GradingClient,
  GradingClientResponse,
  GradingFailureV1,
  MultimodalGradingRequestV2,
} from '../services/grading/types'
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
  captureGradingQueueJob,
  incrementGeneration,
  isCapturedGradingQueueJobCurrent,
  selectActionableTaskEssays,
  type CapturedGradingQueueJob,
} from './gradingQueueTransitions'
import {
  beginGradingAttempt,
  confirmGradingTransition,
  invalidateGradingAfterTranscriptEdit,
  markEssayManualTransition,
  recordGradingPreflightFailure,
  settleGradingFailure,
  settleGradingSuccess,
  type GradingAttemptVersion,
  type EssayTransition,
} from './gradingStateTransitions'

const terminalEssayStatuses = new Set<Essay['status']>(['completed', 'manual'])
const activeEssayStatuses = new Set<Essay['status']>([
  'pending_ocr', 'ocr_running', 'pending_grading', 'grading', 'grading_ready',
])
const STABLE_SUCCESS_WINDOW = 8

interface AppGradingJobRecord {
  captured: CapturedGradingQueueJob
  request: MultimodalGradingRequestV2
  job: GradingJob
  currentRun?: Promise<GradingClientResponse>
}

function staleJobFailure(requestId: string): GradingFailureV1 {
  return {
    requestId,
    status: 'failed',
    error: {
      code: 'invalid_request',
      message: '作文或评分标准已更新，本次旧版本结果不会写入。',
      retryable: false,
    },
  }
}

function unavailableFailure(requestId: string): GradingFailureV1 {
  return {
    requestId,
    status: 'failed',
    error: {
      code: 'gateway_unavailable',
      message: '批改服务暂时不可用，请重试。',
      retryable: true,
    },
  }
}

function configuredSchedulerOptions(): TaskGradingSchedulerOptions {
  const config = parseGradingRuntimeConfig({
    VITE_GRADING_MODE: import.meta.env.VITE_GRADING_MODE,
    VITE_GRADING_API_BASE: import.meta.env.VITE_GRADING_API_BASE,
    VITE_GRADING_QUEUE_MODE: import.meta.env.VITE_GRADING_QUEUE_MODE,
    VITE_GRADING_MAX_IN_FLIGHT: import.meta.env.VITE_GRADING_MAX_IN_FLIGHT,
  })
  return config.ok
    ? {
        mode: config.value.queueMode,
        hardLimit: config.value.maxInFlight,
        stableSuccessWindow: STABLE_SUCCESS_WINDOW,
      }
    : { mode: 'single-legacy', hardLimit: 1, stableSuccessWindow: STABLE_SUCCESS_WINDOW }
}

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

export interface AppStateProviderProps {
  children: ReactNode
  gradingClient?: GradingClient
  gradingSchedulerOptions?: TaskGradingSchedulerOptions
}

export function AppStateProvider({ children, gradingClient, gradingSchedulerOptions }: AppStateProviderProps) {
  const [tasks, setTasks] = useState<Task[]>(mockTasks)
  const [essays, setEssays] = useState<Essay[]>(mockEssays)
  const [taskGradingQueues, setTaskGradingQueues] = useState<Readonly<Record<string, TaskQueueSnapshot>>>({})
  const [gradingResults, setGradingResults] = useState<GradingResult[]>(mockGradingResults)
  const [classInsights] = useState<ClassInsight[]>(mockClassInsights)
  const [classReviewMaterials, setClassReviewMaterials] = useState<ClassReviewMaterial[]>([])
  const tasksRef = useRef(tasks)
  const essaysRef = useRef(essays)
  const imageSubmissionIdsRef = useRef(new Set<string>())
  const mountedRef = useRef(true)
  const gradingIdentityStoreRef = useRef<ReturnType<typeof createGradingJobIdentityStore> | null>(null)
  const gradingJobRecordsRef = useRef(new Map<string, AppGradingJobRecord>())
  const gradingClientRef = useRef<GradingClient | null>(null)
  const gradingSchedulerOptionsRef = useRef<TaskGradingSchedulerOptions | null>(null)
  const gradingSchedulerRef = useRef<ReturnType<typeof createTaskGradingScheduler> | null>(null)
  if (!gradingClientRef.current) {
    gradingClientRef.current = gradingClient ?? createConfiguredGradingClient()
  }
  if (!gradingIdentityStoreRef.current) {
    gradingIdentityStoreRef.current = createGradingJobIdentityStore()
  }
  if (!gradingSchedulerOptionsRef.current) {
    gradingSchedulerOptionsRef.current = gradingSchedulerOptions ?? configuredSchedulerOptions()
  }
  if (!gradingSchedulerRef.current) {
    gradingSchedulerRef.current = createTaskGradingScheduler(gradingSchedulerOptionsRef.current)
  }

  useEffect(() => { tasksRef.current = tasks }, [tasks])
  useEffect(() => { essaysRef.current = essays }, [essays])
  useEffect(() => {
    mountedRef.current = true
    if (!gradingSchedulerRef.current) {
      gradingSchedulerRef.current = createTaskGradingScheduler(gradingSchedulerOptionsRef.current!)
    }
    const scheduler = gradingSchedulerRef.current
    const unsubscribe = scheduler.subscribe((snapshot) => {
      setTaskGradingQueues((current) => ({ ...current, [snapshot.taskId]: snapshot }))
    })
    return () => {
      mountedRef.current = false
      unsubscribe()
      scheduler.dispose()
      if (gradingSchedulerRef.current === scheduler) gradingSchedulerRef.current = null
    }
  }, [])

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
      rubricGeneration: 0,
      taskName: input.taskName,
      className: input.className ?? '待选择班级',
      essayType: input.essayType ?? '英语作文',
      fullScore: input.fullScore,
      scoringTemplateId: input.scoringTemplateId ?? 'confirmed-rubric-v1',
      ...(input.writingGenre ? { writingGenre: input.writingGenre } : {}),
      ...(input.promptInfo ? { promptInfo: input.promptInfo } : {}),
      ...(input.rubricDraft ? { rubricDraft: input.rubricDraft } : {}),
      ...(input.materialContext ? { materialContext: input.materialContext } : {}),
      ...(input.materialProcessingStatus ? { materialProcessingStatus: input.materialProcessingStatus } : {}),
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
        sourceGeneration: 0,
        essayNumber: `作文 ${taskEssayCount + groupIndex + 1}`,
        pages: essayPages,
        pageCount: essayPages.length,
        pageOrder: essayPages.map((page) => page.id),
        ocrText: group.ocrText,
        transcriptSource: 'teacher_confirmed',
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
        id, taskId, sourceGeneration: 0, essayNumber: group.studentName?.trim() || `作文 ${taskEssayCount + groupIndex + 1}`, pages, pageCount: pages.length,
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
    if (!target || target.ocrText === text) return
    let nextSourceGeneration: number
    try {
      nextSourceGeneration = incrementGeneration(target.sourceGeneration)
    } catch {
      return
    }

    const changedSource = essaysRef.current.map((essay) => essay.id === essayId
      ? {
          ...essay,
          sourceGeneration: nextSourceGeneration,
          ocrText: text,
          transcriptSource: 'teacher_confirmed' as const,
          ocrAudit: target.ocrAudit ? confirmOcrAudit(target.ocrAudit, text, timestamp) : undefined,
          updatedAt: timestamp,
        }
      : essay)
    const invalidated = invalidateGradingAfterTranscriptEdit(changedSource, essayId, timestamp)
    const nextEssays = invalidated.applied ? invalidated.essays : changedSource
    gradingIdentityStoreRef.current!.invalidateEssay(essayId)
    essaysRef.current = nextEssays
    setEssays(nextEssays)
    setGradingResults((current) => current.filter((result) => result.essayId !== essayId))
    setTasks((currentTasks) => {
      const updated = updateTasksFromEssays(currentTasks, target.taskId, nextEssays, timestamp)
      tasksRef.current = updated
      return updated
    })
  }, [])

  const markEssayManual = useCallback((essayId: string) => {
    const timestamp = new Date().toISOString()
    commitEssayTransition(markEssayManualTransition(essaysRef.current, essayId, timestamp), timestamp)
  }, [commitEssayTransition])

  const getOrCreateGradingJob = useCallback((task: Task, essay: Essay): AppGradingJobRecord | undefined => {
    let requestId: string
    let captured: CapturedGradingQueueJob
    try {
      const version = {
        taskId: task.id,
        essayId: essay.id,
        sourceGeneration: essay.sourceGeneration ?? 0,
        rubricGeneration: task.rubricGeneration ?? 0,
      }
      requestId = gradingIdentityStoreRef.current!.getOrCreate(version)
      captured = captureGradingQueueJob(task, essay, requestId)
    } catch {
      return undefined
    }

    const existing = gradingJobRecordsRef.current.get(requestId)
    if (existing) return existing

    const attempt: GradingAttemptVersion = captured
    const built = buildMultimodalGradingRequest(task, essay, requestId)
    if (!built.ok) {
      const completedAt = new Date().toISOString()
      commitEssayTransition(
        recordGradingPreflightFailure(
          essaysRef.current,
          essay.id,
          attempt,
          captured.rubricGeneration,
          built.error,
          completedAt,
        ),
        completedAt,
      )
      return undefined
    }

    let record!: AppGradingJobRecord
    const execute = async (): Promise<GradingClientResponse> => {
      const currentTask = tasksRef.current.find((item) => item.id === captured.taskId)
      const currentEssay = essaysRef.current.find((item) => item.id === captured.essayId)
      if (!mountedRef.current || !isCapturedGradingQueueJobCurrent(
        captured,
        currentTask,
        currentEssay,
        captured.requestId,
      )) return staleJobFailure(captured.requestId)

      const startedAt = new Date().toISOString()
      const started = beginGradingAttempt(
        essaysRef.current,
        captured.essayId,
        attempt,
        captured.rubricGeneration,
        startedAt,
      )
      if (!commitEssayTransition(started, startedAt)) return staleJobFailure(captured.requestId)

      let response: GradingClientResponse
      try {
        response = await gradingClientRef.current!.gradeImages(built.request)
      } catch {
        response = unavailableFailure(captured.requestId)
      }
      if (!mountedRef.current) return response

      const latestTask = tasksRef.current.find((item) => item.id === captured.taskId)
      const latestEssay = essaysRef.current.find((item) => item.id === captured.essayId)
      const runningRequestId = latestEssay?.gradingRun?.status === 'running'
        ? latestEssay.gradingRun.requestId
        : undefined
      if (!isCapturedGradingQueueJobCurrent(captured, latestTask, latestEssay, runningRequestId)) {
        return staleJobFailure(captured.requestId)
      }

      const safeResponse: GradingClientResponse = response.requestId === captured.requestId
        && (response.status === 'failed' || response.essayId === captured.essayId)
        ? response
        : {
            requestId: captured.requestId,
            status: 'failed',
            error: {
              code: 'gateway_invalid_response',
              message: '批改服务返回了无法安全使用的响应，请重试。',
              retryable: true,
            },
          }

      if (safeResponse.status === 'failed') {
        const completedAt = new Date().toISOString()
        const settled = settleGradingFailure(
          essaysRef.current,
          captured.essayId,
          attempt,
          captured.rubricGeneration,
          safeResponse,
          completedAt,
        )
        return commitEssayTransition(settled, completedAt)
          ? safeResponse
          : staleJobFailure(captured.requestId)
      }

      let adapted: ReturnType<typeof adaptAiGradingResult>
      try {
        adapted = adaptAiGradingResult(safeResponse, built.request)
      } catch {
        const completedAt = new Date().toISOString()
        const invalidResponse: GradingFailureV1 = {
          requestId: captured.requestId,
          status: 'failed',
          error: {
            code: 'gateway_invalid_response',
            message: '批改服务返回了无法安全使用的响应，请重试。',
            retryable: true,
          },
        }
        const failed = settleGradingFailure(
          essaysRef.current,
          captured.essayId,
          attempt,
          captured.rubricGeneration,
          invalidResponse,
          completedAt,
        )
        return commitEssayTransition(failed, completedAt)
          ? invalidResponse
          : staleJobFailure(captured.requestId)
      }
      const settled = settleGradingSuccess(
        essaysRef.current,
        captured.essayId,
        attempt,
        captured.rubricGeneration,
        adapted.id,
        safeResponse,
        built.request.confirmedTranscript !== undefined
          ? { transcriptSource: 'teacher_confirmed', confirmedTranscript: built.request.confirmedTranscript }
          : { transcriptSource: 'kimi_vision' },
      )
      if (!commitEssayTransition(settled, safeResponse.createdAt)) {
        return staleJobFailure(captured.requestId)
      }
      setGradingResults((current) => [
        adapted,
        ...current.filter((item) => item.essayId !== captured.essayId),
      ])
      return safeResponse
    }

    const job: GradingJob = {
      taskId: captured.taskId,
      essayId: captured.essayId,
      requestId: captured.requestId,
      sourceGeneration: captured.sourceGeneration,
      rubricGeneration: captured.rubricGeneration,
      run() {
        const execution = execute()
        record.currentRun = execution
        return execution
      },
    }
    record = { captured, request: built.request, job }
    gradingJobRecordsRef.current.set(requestId, record)
    return record
  }, [commitEssayTransition])

  const startTaskGrading = useCallback((taskId: string) => {
    const task = tasksRef.current.find((item) => item.id === taskId)
    if (!task) return
    const jobs = selectActionableTaskEssays(essaysRef.current, taskId)
      .map((essay) => getOrCreateGradingJob(task, essay)?.job)
      .filter((job): job is GradingJob => job !== undefined)
    if (jobs.length > 0) gradingSchedulerRef.current!.startTask(taskId, jobs)
  }, [getOrCreateGradingJob])

  const retryTaskEssay = useCallback((essayId: string) => {
    const essay = essaysRef.current.find((item) => item.id === essayId)
    const task = essay ? tasksRef.current.find((item) => item.id === essay.taskId) : undefined
    if (!essay || !task) return
    const record = getOrCreateGradingJob(task, essay)
    if (!record) return
    const item = gradingSchedulerRef.current!.getSnapshot(task.id).items[essayId]
    const isSameVersion = item?.requestId === record.captured.requestId
      && item.sourceGeneration === record.captured.sourceGeneration
      && item.rubricGeneration === record.captured.rubricGeneration
    if (!isSameVersion) {
      gradingSchedulerRef.current!.startTask(task.id, [record.job])
      return
    }
    gradingSchedulerRef.current!.retryEssay(task.id, essayId)
  }, [getOrCreateGradingJob])

  const checkUnknownTaskEssay = useCallback((essayId: string) => {
    const essay = essaysRef.current.find((item) => item.id === essayId)
    const task = essay ? tasksRef.current.find((item) => item.id === essay.taskId) : undefined
    if (!essay || !task) return
    const record = getOrCreateGradingJob(task, essay)
    const item = gradingSchedulerRef.current!.getSnapshot(task.id).items[essayId]
    if (!record
      || item?.requestId !== record.captured.requestId
      || item.sourceGeneration !== record.captured.sourceGeneration
      || item.rubricGeneration !== record.captured.rubricGeneration) return
    gradingSchedulerRef.current!.checkUnknownEssay(task.id, essayId)
  }, [getOrCreateGradingJob])

  const resumeTaskGrading = useCallback((taskId: string) => {
    gradingSchedulerRef.current!.resumeTask(taskId)
  }, [])

  const gradeEssay = useCallback((essayId: string) => {
    const essay = essaysRef.current.find((item) => item.id === essayId)
    const task = essay ? tasksRef.current.find((item) => item.id === essay.taskId) : undefined
    if (!essay || !task) return Promise.resolve()
    const record = getOrCreateGradingJob(task, essay)
    if (!record) return Promise.resolve()
    gradingSchedulerRef.current!.startTask(task.id, [record.job])
    return record.currentRun?.then(() => undefined) ?? Promise.resolve()
  }, [getOrCreateGradingJob])

  const retryGradeEssay = useCallback((essayId: string) => {
    retryTaskEssay(essayId)
    const essay = essaysRef.current.find((item) => item.id === essayId)
    const task = essay ? tasksRef.current.find((item) => item.id === essay.taskId) : undefined
    const record = essay && task ? getOrCreateGradingJob(task, essay) : undefined
    return record?.currentRun?.then(() => undefined) ?? Promise.resolve()
  }, [getOrCreateGradingJob, retryTaskEssay])
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

  const isGradingInFlight = Object.values(taskGradingQueues)
    .some((snapshot) => snapshot.activeCount > 0)

  const value = useMemo(() => ({
    tasks,
    essays,
    taskGradingQueues,
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
    startTaskGrading,
    retryTaskEssay,
    checkUnknownTaskEssay,
    resumeTaskGrading,
    gradeEssay,
    retryGradeEssay,
    confirmGradingResult,
    updateGradingResult,
    addClassReviewMaterial,
    removeClassReviewMaterial,
    isClassReviewMaterialAdded,
  }), [
    tasks,
    essays,
    taskGradingQueues,
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
    startTaskGrading,
    retryTaskEssay,
    checkUnknownTaskEssay,
    resumeTaskGrading,
    gradeEssay,
    retryGradeEssay,
    confirmGradingResult,
    updateGradingResult,
    addClassReviewMaterial,
    removeClassReviewMaterial,
    isClassReviewMaterialAdded,
  ])

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}
