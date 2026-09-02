import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { mockEssays, mockGradingResults, mockTasks } from '../data/mockData'
import { aggregateClassReviewSnapshot, type ClassReviewAggregate } from '../services/classReview/aggregateClassReview'
import { parseClassReviewReport } from '../services/classReview/classReviewContracts'
import {
  createLocalClassReviewCoordinator,
  type ClassReviewSynthesisClient,
} from '../services/classReview/classReviewCoordinator'
import {
  buildClassReviewProjection,
  DEFAULT_CLASS_REVIEW_PROJECTION_LIMITS,
  type ClassReviewProjectionResult,
  type PreparedGroupProjectionIdentityV1,
  type RedactionContext,
} from '../services/classReview/classReviewProjection'
import { redactClassReviewExcerpt, type PersonEntityDetector } from '../services/classReview/classReviewRedaction'
import { createFakeClassReviewSynthesisClient } from '../services/classReview/fakeClassReviewSynthesisClient'
import type {
  AiSummaryV1,
  ClassReviewReportV1,
  ClassReviewStatisticsV1,
  ClearSpellingItemV1,
} from '../services/classReview/types'
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
import {
  AppStateContext,
  type AddClassReviewIssueInput,
  type ClassReviewAppSnapshot,
  type ConfirmMockOcrEssayInput,
  type EnqueueImageEssaysInput,
} from './appStateContextValue'
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
const CLASS_REVIEW_TOPIC_SECRET = new Uint8Array([
  0x73, 0x79, 0x6e, 0x74, 0x68, 0x65, 0x74, 0x69,
  0x63, 0x2d, 0x63, 0x6c, 0x61, 0x73, 0x73, 0x2d,
  0x72, 0x65, 0x76, 0x69, 0x65, 0x77, 0x2d, 0x76,
  0x31, 0x2d, 0x6c, 0x6f, 0x63, 0x61, 0x6c, 0x21,
])
const CLASS_REVIEW_ENTITY_DETECTOR: PersonEntityDetector = Object.freeze({
  detectorVersion: 'person-entity-detector-v1',
  detect: () => [],
})

type ReadyClassReviewProjection = Extract<ClassReviewProjectionResult, { status: 'ready' }>

interface ClassReviewSourceState {
  signature: string
  taskRevision: number
}

interface BuiltClassReviewSource {
  signature: string
  aggregate: ClassReviewAggregate
  projection: ReadyClassReviewProjection
  replacement: {
    taskRevision: number
    rubricRevisionDigest: string
    statistics: ClassReviewStatisticsV1
    projection: ReadyClassReviewProjection
  }
  initialReport: ClassReviewReportV1
}

function hashHex(value: string): string {
  let a = 0x811c9dc5
  let b = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    a ^= code
    a = Math.imul(a, 0x01000193) >>> 0
    b ^= code + index
    b = Math.imul(b, 0x85ebca6b) >>> 0
  }
  const parts: string[] = []
  for (let index = 0; index < 8; index += 1) {
    a = Math.imul(a ^ (b >>> 13), 0x01000193) >>> 0
    b = Math.imul(b ^ (a >>> 16), 0xc2b2ae35) >>> 0
    parts.push((a ^ b).toString(16).padStart(8, '0'))
  }
  return parts.join('')
}

function opaqueFrom(prefix: string, seed: string, length = 32): string {
  return `${prefix}.${hashHex(seed).slice(0, length)}`
}

function classReviewTaskScope(taskId: string): string {
  return `scope_v1_${hashHex(`class-review-task:${taskId}`).slice(0, 64)}`
}

function classReviewRubricDigest(task: Task): string {
  return hashHex(
    JSON.stringify({
      taskId: task.id,
      rubricGeneration: task.rubricGeneration ?? 0,
      scoringTemplateId: task.scoringTemplateId,
      fullScore: task.fullScore,
      dimensions: task.rubricDraft?.dimensions.map((dimension) => ({
        id: dimension.id,
        weight: dimension.weight,
      })) ?? [],
    }),
  ).slice(0, 43)
}

function classReviewSourceSignature(
  task: Task,
  taskEssays: readonly Essay[],
  taskResults: readonly GradingResult[],
): string {
  const essayState = taskEssays
    .map((essay) => ({
      id: essay.id,
      status: essay.status,
      sourceGeneration: essay.sourceGeneration ?? 0,
      aiResultId: essay.aiResultId ?? null,
      teacherReviewed: essay.teacherReviewed,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const resultState = taskResults
    .map((result) => ({
      essayId: result.essayId,
      resultRevision: result.resultRevision ?? 0,
      totalScore: result.totalScore,
      dimensions: result.dimensionScores.map((dimension) => ({
        id: dimension.id,
        score: dimension.score,
        maxScore: dimension.maxScore,
      })),
      issueIds: result.errorAnnotations.map((issue) => issue.id),
      sentenceRevisionIds: result.sentenceRevisions.map((revision) => revision.id),
    }))
    .sort((left, right) => left.essayId.localeCompare(right.essayId))
  return hashHex(JSON.stringify({
    task: {
      id: task.id,
      rubricGeneration: task.rubricGeneration ?? 0,
      rubricDigest: classReviewRubricDigest(task),
      status: task.status,
      totalEssayCount: task.totalEssayCount,
      completedEssayCount: task.completedEssayCount,
      exceptionEssayCount: task.exceptionEssayCount,
    },
    essays: essayState,
    results: resultState,
  }))
}

function compareOpaque(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1
}

function createClassReviewRedactionContext(task: Task, taskEssays: readonly Essay[]): RedactionContext {
  const taskScope = classReviewTaskScope(task.id)
  const knownNames = {
    students: [],
    defaultStudentLabels: taskEssays.map((essay) => essay.essayNumber),
    teachers: [],
    classNames: [task.className],
    schoolNames: [],
    taskNames: [task.taskName],
  }
  const redact = (sourceText: string, seed: string) => redactClassReviewExcerpt({
    sourceText,
    knownNames,
    entityDetector: CLASS_REVIEW_ENTITY_DETECTOR,
    scrubbedEvidenceKey: `scrub_v1_${hashHex(seed)}`,
  })
  return {
    prepare(group): PreparedGroupProjectionIdentityV1 | null {
      const digest = hashHex(`${task.id}\u0000${group.fingerprint}`)
      return {
        atomicTopic: {
          kind: 'atomic',
          keyVersion: 'topic-key-v1',
          taskScope,
          key: `tk1.${digest.slice(0, 16)}`,
          fingerprintDigest: `fp1.${digest}`,
        },
        title: redact(group.title, `${digest}:title`),
        excerpt: {
          originalText: redact(group.originalText, `${digest}:original`),
          suggestionOrDiagnosis: redact(group.suggestionOrDiagnosis, `${digest}:suggestion`),
        },
      }
    },
  }
}

function clearSpellingItemsFromAggregate(aggregate: ClassReviewAggregate): ClearSpellingItemV1[] {
  return aggregate.clearSpellingItems
    .map((item) => {
      const digest = hashHex(`${item.sourceSubtype}\u0000${item.fingerprint}`)
      return {
        itemId: `spell.${digest.slice(0, 32)}`,
        topicKey: `tk1.${digest.slice(0, 16)}`,
        sourceSubtype: item.sourceSubtype,
        originalWord: item.originalWord,
        correctedWord: item.correctedWord,
        studentCount: item.studentCount,
        occurrenceCount: item.occurrenceCount,
        anonymousExample: item.anonymousExample,
      }
    })
    .sort((left, right) =>
      compareOpaque(left.originalWord, right.originalWord)
      || compareOpaque(left.correctedWord, right.correctedWord)
      || compareOpaque(left.itemId, right.itemId),
    )
}

function classReviewStatisticsFromAggregate(aggregate: ClassReviewAggregate): ClassReviewStatisticsV1 {
  return {
    totalEssayCount: aggregate.totalEssayCount,
    includedEssayCount: aggregate.includedEssayCount,
    issueEligibleEssayCount: aggregate.issueEligibleEssayCount,
    excludedEssayCount: aggregate.excludedEssayCount,
    issueCoverageRate: aggregate.includedEssayCount === 0
      ? 1
      : aggregate.issueEligibleEssayCount / aggregate.includedEssayCount,
    fullScore: aggregate.fullScore,
    scoreSummary: aggregate.scoreSummary,
    scoreBands: aggregate.scoreBands.map((band) => ({
      bandId: band.bandId,
      lowerInclusive: band.lowerInclusive,
      upperInclusive: band.upperInclusive,
      essayCount: band.essayCount,
    })),
    dimensions: aggregate.dimensions.map((dimension) => ({
      dimensionId: dimension.dimensionId,
      name: dimension.name,
      averageScore: dimension.averageScore,
      maxScore: dimension.maxScore,
      normalizedPerformance: dimension.normalizedPerformance,
    })),
  }
}

function parseReportOrThrow(value: unknown): ClassReviewReportV1 {
  const parsed = parseClassReviewReport(value)
  if (!parsed.ok) {
    throw new Error(`class_review_candidate_conflict:${parsed.error.code}:${parsed.error.path}`)
  }
  return parsed.value
}

function buildInitialClassReviewReport(
  taskRevision: number,
  statistics: ClassReviewStatisticsV1,
  aggregate: ClassReviewAggregate,
): ClassReviewReportV1 {
  return parseReportOrThrow({
    contractVersion: 'class-review-report-v1',
    workspaceState: 'draft',
    taskRevision,
    reportRevision: 0,
    aiTextEditRevision: 0,
    currentGeneration: null,
    statistics,
    issueBlocks: [],
    issueOrder: [],
    clearSpellingItems: clearSpellingItemsFromAggregate(aggregate),
    selectedMaterials: [],
  })
}

function taskIsSettledForClassReview(taskEssays: readonly Essay[]): boolean {
  return taskEssays.length > 0
    && taskEssays.every((essay) =>
      essay.status === 'completed' || essay.status === 'manual' || essay.status === 'needs_review')
}

function reportCanGenerate(report: ClassReviewReportV1, sourceReady: boolean, isSettled: boolean): boolean {
  const activeState = report.currentGeneration?.state
  const activeGeneration = activeState === 'queued'
    || activeState === 'running'
    || activeState === 'result_unknown'
    || activeState === 'succeeded_unapplied'
  if (!sourceReady || !isSettled || activeGeneration || report.statistics.includedEssayCount < 2) return false
  return report.workspaceState === 'draft'
    || report.workspaceState === 'none'
    || report.workspaceState === 'ai_removed'
    || report.workspaceState === 'ai_available'
}

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
  classReviewSynthesisClient?: ClassReviewSynthesisClient
}

export function AppStateProvider({
  children,
  gradingClient,
  gradingSchedulerOptions,
  classReviewSynthesisClient,
}: AppStateProviderProps) {
  const [tasks, setTasks] = useState<Task[]>(mockTasks)
  const [essays, setEssays] = useState<Essay[]>(mockEssays)
  const [taskGradingQueues, setTaskGradingQueues] = useState<Readonly<Record<string, TaskQueueSnapshot>>>({})
  const [gradingResults, setGradingResults] = useState<GradingResult[]>(mockGradingResults)
  const [classInsights] = useState<ClassInsight[]>([])
  const [classReviewMaterials, setClassReviewMaterials] = useState<ClassReviewMaterial[]>([])
  const [classReviewVersion, setClassReviewVersion] = useState(0)
  const tasksRef = useRef(tasks)
  const essaysRef = useRef(essays)
  const gradingResultsRef = useRef(gradingResults)
  const imageSubmissionIdsRef = useRef(new Set<string>())
  const mountedRef = useRef(true)
  const gradingIdentityStoreRef = useRef<ReturnType<typeof createGradingJobIdentityStore> | null>(null)
  const gradingJobRecordsRef = useRef(new Map<string, AppGradingJobRecord>())
  const gradingClientRef = useRef<GradingClient | null>(null)
  const gradingSchedulerOptionsRef = useRef<TaskGradingSchedulerOptions | null>(null)
  const gradingSchedulerRef = useRef<ReturnType<typeof createTaskGradingScheduler> | null>(null)
  const classReviewCoordinatorRef = useRef<ReturnType<typeof createLocalClassReviewCoordinator> | null>(null)
  const classReviewSourceStateRef = useRef(new Map<string, ClassReviewSourceState>())
  const classReviewOpaqueCounterRef = useRef(0)
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
  if (!classReviewCoordinatorRef.current) {
    classReviewCoordinatorRef.current = createLocalClassReviewCoordinator({
      synthesisClient: classReviewSynthesisClient ?? createFakeClassReviewSynthesisClient({ scenario: 'success' }),
      topicKeySecret: CLASS_REVIEW_TOPIC_SECRET,
      now: () => new Date().toISOString(),
      createOpaqueId: () => {
        classReviewOpaqueCounterRef.current += 1
        return `crid.${classReviewOpaqueCounterRef.current.toString(36)}.${hashHex(String(classReviewOpaqueCounterRef.current)).slice(0, 20)}`
      },
    })
  }

  useEffect(() => { tasksRef.current = tasks }, [tasks])
  useEffect(() => { essaysRef.current = essays }, [essays])
  useEffect(() => { gradingResultsRef.current = gradingResults }, [gradingResults])
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

  const bumpClassReviewVersion = useCallback(() => {
    if (!mountedRef.current) return
    setClassReviewVersion((current) => current + 1)
  }, [])

  const buildClassReviewSource = useCallback((taskId: string, taskRevision: number): BuiltClassReviewSource => {
    const task = tasksRef.current.find((item) => item.id === taskId)
    if (!task) throw new Error('class_review_task_invalidated')
    const taskEssays = essaysRef.current.filter((essay) => essay.taskId === taskId)
    const essayIds = new Set(taskEssays.map((essay) => essay.id))
    const taskResults = gradingResultsRef.current.filter((result) => essayIds.has(result.essayId))
    const aggregate = aggregateClassReviewSnapshot({ task, essays: taskEssays, results: taskResults })
    const projection = buildClassReviewProjection({
      aggregate,
      redactionContext: createClassReviewRedactionContext(task, taskEssays),
      limits: DEFAULT_CLASS_REVIEW_PROJECTION_LIMITS,
    })
    if (projection.status !== 'ready') {
      throw new Error(projection.status === 'rejected'
        ? projection.safeFailureCode
        : 'class_review_source_invalidated')
    }
    const statistics = classReviewStatisticsFromAggregate(aggregate)
    const signature = classReviewSourceSignature(task, taskEssays, taskResults)
    const replacement = {
      taskRevision,
      rubricRevisionDigest: classReviewRubricDigest(task),
      statistics,
      projection,
    }
    return {
      signature,
      aggregate,
      projection,
      replacement,
      initialReport: buildInitialClassReviewReport(taskRevision, replacement.statistics, aggregate),
    }
  }, [])

  const registerClassReviewWorkspace = useCallback((taskId: string): ClassReviewSourceState => {
    const existing = classReviewSourceStateRef.current.get(taskId)
    if (existing) return existing
    const source = buildClassReviewSource(taskId, 0)
    classReviewCoordinatorRef.current!.registerWorkspace({
      taskKey: taskId,
      taskRevision: 0,
      rubricRevisionDigest: source.replacement.rubricRevisionDigest,
      report: source.initialReport,
      projection: source.projection,
    })
    const state = { signature: source.signature, taskRevision: 0 }
    classReviewSourceStateRef.current.set(taskId, state)
    return state
  }, [buildClassReviewSource])

  const syncClassReviewSource = useCallback((
    taskId: string,
    kind: 'ordinary_revision' | 'source_deleted',
    removedTeacherEvidenceIds: readonly string[] = [],
  ): boolean => {
    const state = registerClassReviewWorkspace(taskId)
    const currentSource = buildClassReviewSource(taskId, state.taskRevision)
    if (kind === 'ordinary_revision' && currentSource.signature === state.signature) return false
    const nextRevision = state.taskRevision + 1
    const nextSource = buildClassReviewSource(taskId, nextRevision)
    const snapshot = classReviewCoordinatorRef.current!.getSnapshot(taskId)
    classReviewCoordinatorRef.current!.syncSources(kind === 'ordinary_revision'
      ? {
          kind,
          taskKey: taskId,
          expectedTaskRevision: state.taskRevision,
          expectedReportRevision: snapshot.report.reportRevision,
          expectedSourceRevisionEpoch: snapshot.sourceRevisionEpoch,
          replacement: nextSource.replacement,
        }
      : {
          kind,
          taskKey: taskId,
          expectedTaskRevision: state.taskRevision,
          expectedReportRevision: snapshot.report.reportRevision,
          expectedSourceRevisionEpoch: snapshot.sourceRevisionEpoch,
          removedTeacherEvidenceIds,
          replacement: nextSource.replacement,
        })
    const nextState = {
      signature: kind === 'ordinary_revision'
        ? nextSource.signature
        : `deleted:${nextRevision}:${nextSource.signature}`,
      taskRevision: nextRevision,
    }
    classReviewSourceStateRef.current.set(taskId, nextState)
    bumpClassReviewVersion()
    return true
  }, [buildClassReviewSource, bumpClassReviewVersion, registerClassReviewWorkspace])

  const ensureClassReviewWorkspace = useCallback((taskId: string): void => {
    registerClassReviewWorkspace(taskId)
    syncClassReviewSource(taskId, 'ordinary_revision')
  }, [registerClassReviewWorkspace, syncClassReviewSource])

  const getClassReviewSnapshot = useCallback((taskId: string): ClassReviewAppSnapshot => {
    ensureClassReviewWorkspace(taskId)
    const snapshot = classReviewCoordinatorRef.current!.getSnapshot(taskId)
    const taskEssays = essaysRef.current.filter((essay) => essay.taskId === taskId)
    const isSettled = taskIsSettledForClassReview(taskEssays)
    return {
      ...snapshot,
      canGenerate: reportCanGenerate(snapshot.report, snapshot.sourceReady, isSettled),
      isSettled,
    }
  }, [ensureClassReviewWorkspace])

  const peekClassReviewSnapshot = useCallback((taskId: string): ClassReviewAppSnapshot | null => {
    if (!classReviewSourceStateRef.current.has(taskId)) return null
    const snapshot = classReviewCoordinatorRef.current!.getSnapshot(taskId)
    const taskEssays = essaysRef.current.filter((essay) => essay.taskId === taskId)
    const isSettled = taskIsSettledForClassReview(taskEssays)
    return {
      ...snapshot,
      canGenerate: reportCanGenerate(snapshot.report, snapshot.sourceReady, isSettled),
      isSettled,
    }
  }, [])

  const findCurrentClassReviewResult = useCallback((essayId: string): GradingResult | undefined =>
    gradingResultsRef.current.find((result) => result.essayId === essayId), [])

  const classReviewIssueCommandFromInput = useCallback((input: AddClassReviewIssueInput) => {
    const task = tasksRef.current.find((item) => item.id === input.taskId)
    const essay = essaysRef.current.find((item) => item.id === input.essayId && item.taskId === input.taskId)
    const result = findCurrentClassReviewResult(input.essayId)
    const currentRevision = result?.resultRevision ?? 0
    if (!task || !essay || !result || currentRevision !== input.sourceResultRevision) {
      throw new Error('class_review_source_invalidated')
    }
    const topicSeed = JSON.stringify([
      input.taskId,
      input.title,
      input.diagnosis,
      input.teachingAction,
      input.severity,
    ])
    const evidenceSeed = JSON.stringify([
      input.taskId,
      input.essayId,
      input.sourceLocator,
      input.sourceResultRevision,
      topicSeed,
    ])
    const occurrenceCount = input.occurrenceCount ?? 1
    return {
      kind: 'add' as const,
      blockId: opaqueFrom('block', topicSeed, 32),
      topicKey: opaqueFrom('teacher', topicSeed, 32),
      title: input.title,
      diagnosis: input.diagnosis,
      teachingAction: input.teachingAction,
      severity: input.severity,
      evidence: [{
        ref: {
          evidenceId: opaqueFrom('evidence', evidenceSeed, 40),
          selectionOrigin: 'teacher_selected' as const,
          sourceLocator: input.sourceLocator,
          sourceResultRevision: input.sourceResultRevision,
          anonymousExample: input.anonymousExample,
        },
        essayIdentity: opaqueFrom('essay', `${task.id}:${essay.id}`, 40),
        occurrenceCount,
      }],
    }
  }, [findCurrentClassReviewResult])

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
    const removedResult = gradingResultsRef.current.some((result) => result.essayId === essayId)
    const nextResults = gradingResultsRef.current.filter((result) => result.essayId !== essayId)
    gradingResultsRef.current = nextResults
    setGradingResults(nextResults)
    if (removedResult && classReviewSourceStateRef.current.has(target.taskId)) {
      syncClassReviewSource(target.taskId, 'source_deleted')
    }
    setTasks((currentTasks) => {
      const updated = updateTasksFromEssays(currentTasks, target.taskId, nextEssays, timestamp)
      tasksRef.current = updated
      return updated
    })
  }, [syncClassReviewSource])

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
      const nextResult: GradingResult = { ...adapted, resultRevision: adapted.resultRevision ?? 0 }
      const nextResults = [
        nextResult,
        ...gradingResultsRef.current.filter((item) => item.essayId !== captured.essayId),
      ]
      gradingResultsRef.current = nextResults
      setGradingResults(nextResults)
      if (classReviewSourceStateRef.current.has(captured.taskId)) {
        syncClassReviewSource(captured.taskId, 'ordinary_revision')
      }
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
  }, [commitEssayTransition, syncClassReviewSource])

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
    const timestamp = new Date().toISOString()
    let changedTaskId: string | null = null
    const nextResults = gradingResultsRef.current.map((result) => {
      if (result.essayId !== essayId) return result
      const essay = essaysRef.current.find((item) => item.id === essayId)
      changedTaskId = essay?.taskId ?? null
      const currentRevision = Number.isSafeInteger(result.resultRevision) && (result.resultRevision ?? 0) >= 0
        ? result.resultRevision ?? 0
        : 0
      return {
        ...result,
        ...patch,
        resultRevision: currentRevision + 1,
        teacherAdjusted: true,
        updatedAt: timestamp,
      }
    })
    gradingResultsRef.current = nextResults
    setGradingResults(nextResults)
    if (changedTaskId && classReviewSourceStateRef.current.has(changedTaskId)) {
      syncClassReviewSource(changedTaskId, 'ordinary_revision')
    }
  }, [syncClassReviewSource])

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

  const classReview = useMemo(() => ({
    getSnapshot: getClassReviewSnapshot,
    peekSnapshot: peekClassReviewSnapshot,
    generate(taskId: string, intent: 'initial' | 'regenerate' = 'initial') {
      const snapshot = getClassReviewSnapshot(taskId)
      const generationId = `gen.${Date.now().toString(36)}.${hashHex(`${taskId}:${intent}:${snapshot.report.taskRevision}:${snapshot.report.reportRevision}:${classReviewOpaqueCounterRef.current}`).slice(0, 24)}`
      const promise = classReviewCoordinatorRef.current!.generate({
        taskKey: taskId,
        generationId,
        intent,
        expectedTaskRevision: snapshot.report.taskRevision,
        expectedReportRevision: snapshot.report.reportRevision,
      })
      bumpClassReviewVersion()
      return promise.then((record) => {
        bumpClassReviewVersion()
        return record
      }, (error) => {
        bumpClassReviewVersion()
        throw error
      })
    },
    checkGeneration(taskId: string) {
      return getClassReviewSnapshot(taskId)
    },
    applyCandidate(taskId: string, generationId?: string) {
      const snapshot = getClassReviewSnapshot(taskId)
      const active = snapshot.generation
      const targetGenerationId = generationId ?? snapshot.candidate?.generationId
      if (!active || !targetGenerationId || snapshot.report.reportRevision === null) {
        throw new Error('class_review_candidate_conflict')
      }
      classReviewCoordinatorRef.current!.applyCandidate({
        taskKey: taskId,
        generationId: targetGenerationId,
        expectedTaskRevision: snapshot.report.taskRevision,
        expectedReportRevision: snapshot.report.reportRevision,
        expectedGenerationRevision: active.generationRevision,
        expectedAiTextEditRevision: snapshot.report.aiTextEditRevision,
      })
      bumpClassReviewVersion()
    },
    discardCandidate(taskId: string, generationId?: string) {
      const snapshot = getClassReviewSnapshot(taskId)
      const active = snapshot.generation
      const targetGenerationId = generationId ?? snapshot.candidate?.generationId ?? active?.generationId
      if (!active || !targetGenerationId) throw new Error('class_review_candidate_conflict')
      classReviewCoordinatorRef.current!.discardCandidate({
        taskKey: taskId,
        generationId: targetGenerationId,
        expectedGenerationRevision: active.generationRevision,
      })
      bumpClassReviewVersion()
    },
    beginAiTextEdit(taskId: string) {
      ensureClassReviewWorkspace(taskId)
      classReviewCoordinatorRef.current!.beginAiTextEdit(taskId)
    },
    saveAiTextEdit(taskId: string, summary: AiSummaryV1) {
      ensureClassReviewWorkspace(taskId)
      classReviewCoordinatorRef.current!.saveAiTextEdit(taskId, summary)
      bumpClassReviewVersion()
    },
    cancelAiTextEdit(taskId: string) {
      ensureClassReviewWorkspace(taskId)
      classReviewCoordinatorRef.current!.cancelAiTextEdit(taskId)
      bumpClassReviewVersion()
    },
    addIssue(input: AddClassReviewIssueInput) {
      ensureClassReviewWorkspace(input.taskId)
      classReviewCoordinatorRef.current!.applyIssueCommand(
        input.taskId,
        classReviewIssueCommandFromInput(input),
      )
      bumpClassReviewVersion()
    },
    removeIssue(taskId: string, evidenceId: string) {
      ensureClassReviewWorkspace(taskId)
      classReviewCoordinatorRef.current!.applyIssueCommand(taskId, { kind: 'remove', evidenceId })
      bumpClassReviewVersion()
    },
    undoIssueRemoval(taskId: string) {
      ensureClassReviewWorkspace(taskId)
      classReviewCoordinatorRef.current!.applyIssueCommand(taskId, { kind: 'undo' })
      bumpClassReviewVersion()
    },
    moveIssue(taskId: string, blockId: string, toIndex: number) {
      ensureClassReviewWorkspace(taskId)
      classReviewCoordinatorRef.current!.applyIssueCommand(taskId, { kind: 'move', blockId, toIndex })
      bumpClassReviewVersion()
    },
    deleteSource(taskId: string, removedTeacherEvidenceIds: readonly string[] = []) {
      syncClassReviewSource(taskId, 'source_deleted', removedTeacherEvidenceIds)
    },
  }), [
    bumpClassReviewVersion,
    classReviewIssueCommandFromInput,
    ensureClassReviewWorkspace,
    getClassReviewSnapshot,
    peekClassReviewSnapshot,
    syncClassReviewSource,
  ])

  const isGradingInFlight = Object.values(taskGradingQueues)
    .some((snapshot) => snapshot.activeCount > 0)

  const value = useMemo(() => {
    void classReviewVersion
    return {
      tasks,
      essays,
      taskGradingQueues,
      isGradingInFlight,
      gradingResults,
      classInsights,
      classReviewMaterials,
      classReview,
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
    }
  }, [
    tasks,
    essays,
    taskGradingQueues,
    isGradingInFlight,
    gradingResults,
    classInsights,
    classReviewMaterials,
    classReview,
    classReviewVersion,
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
