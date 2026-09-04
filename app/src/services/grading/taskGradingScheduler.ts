import type { AiGradingResultV1, GradingClientResponse } from './types'

export type QueueItemPhase =
  | 'queued'
  | 'running'
  | 'rate_limit_wait'
  | 'result_unknown'
  | 'retryable_failure'
  | 'final_failure'
  | 'succeeded'

export interface QueueItemSnapshot {
  essayId: string
  phase: QueueItemPhase
  requestId: string
  sourceGeneration: number
  rubricGeneration: number
  retryAt?: number
  retryable: boolean
  reattachOnly: boolean
  errorCode?: string
  errorMessage?: string
}

export interface TaskQueueSnapshot {
  taskId: string
  status: 'idle' | 'running' | 'paused' | 'settled'
  pauseReason?: 'auth' | 'balance' | 'configuration' | 'long_retry_after'
  targetConcurrency: number
  activeCount: number
  queuedCount: number
  items: Readonly<Record<string, QueueItemSnapshot>>
}

export interface GradingJob {
  taskId: string
  essayId: string
  requestId: string
  sourceGeneration: number
  rubricGeneration: number
  run(): Promise<GradingClientResponse>
}

export interface SchedulerTimers {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export interface TaskGradingSchedulerOptions {
  mode: 'adaptive-v1' | 'single-legacy'
  hardLimit: number
  stableSuccessWindow: number
  now?: () => number
  random?: () => number
  timers?: SchedulerTimers
}

export interface TaskGradingScheduler {
  startTask(taskId: string, jobs: readonly GradingJob[]): void
  retryEssay(taskId: string, essayId: string): void
  checkUnknownEssay(taskId: string, essayId: string): void
  resumeTask(taskId: string): void
  getSnapshot(taskId: string): TaskQueueSnapshot
  subscribe(listener: (snapshot: TaskQueueSnapshot) => void): () => void
  dispose(): void
}

interface QueueItemState extends QueueItemSnapshot {
  job: GradingJob
  automaticReattachReady: boolean
  runningAnnouncementTimer?: unknown
}

interface TaskQueueState {
  taskId: string
  started: boolean
  order: string[]
  items: Map<string, QueueItemState>
  activeCount: number
  pauseReason?: TaskQueueSnapshot['pauseReason']
  pausedFailureEssayIds: Set<string>
}

const LONG_RETRY_AFTER_MS = 15 * 60 * 1_000
const AUTO_REATTACH_RUNNING_ANNOUNCEMENT_DELAY_MS = 250
const MAX_TIMER_DELAY_MS = 2_147_483_647
const INVALID_CONFIG_MESSAGE = 'Invalid task grading scheduler configuration.'

const defaultTimers: SchedulerTimers = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function isSuccess(response: GradingClientResponse): response is AiGradingResultV1 {
  return response.status === 'success' || response.status === 'partial'
}

function rejectedJobFailure(requestId: string): GradingClientResponse {
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

function invalidJobResponse(requestId: string): GradingClientResponse {
  return {
    requestId,
    status: 'failed',
    error: {
      code: 'gateway_invalid_response',
      message: '批改服务返回了无法安全使用的响应，请重试。',
      retryable: true,
    },
  }
}

function sameJobVersion(left: QueueItemState, right: GradingJob): boolean {
  return left.requestId === right.requestId
    && left.sourceGeneration === right.sourceGeneration
    && left.rubricGeneration === right.rubricGeneration
}

function queuedItem(job: GradingJob): QueueItemState {
  return {
    job,
    essayId: job.essayId,
    phase: 'queued',
    requestId: job.requestId,
    sourceGeneration: job.sourceGeneration,
    rubricGeneration: job.rubricGeneration,
    retryable: false,
    reattachOnly: false,
    automaticReattachReady: false,
  }
}

function resetToQueued(item: QueueItemState): void {
  item.phase = 'queued'
  item.automaticReattachReady = false
  item.retryable = false
  item.reattachOnly = false
  delete item.retryAt
  delete item.errorCode
  delete item.errorMessage
}

function pauseReasonFor(errorCode: string): TaskQueueSnapshot['pauseReason'] | undefined {
  if (errorCode === 'provider_auth_failed') return 'auth'
  if (errorCode === 'provider_balance_unavailable') return 'balance'
  if (errorCode === 'provider_not_configured') return 'configuration'
  return undefined
}

export function createTaskGradingScheduler(
  options: TaskGradingSchedulerOptions,
): TaskGradingScheduler {
  if ((options.mode !== 'adaptive-v1' && options.mode !== 'single-legacy')
    || !isPositiveSafeInteger(options.hardLimit)
    || !isPositiveSafeInteger(options.stableSuccessWindow)) {
    throw new Error(INVALID_CONFIG_MESSAGE)
  }

  const hardLimit = options.mode === 'single-legacy' ? 1 : options.hardLimit
  const now = options.now ?? Date.now
  const timers = options.timers ?? defaultTimers
  const tasks = new Map<string, TaskQueueState>()
  const activeEssayKeys = new Set<string>()
  const listeners = new Set<(snapshot: TaskQueueSnapshot) => void>()
  let safeTarget = 1
  let stableSuccesses = 0
  let globalActiveCount = 0
  let disposed = false
  let pumping = false
  let gateTimer: unknown
  let dispatchNotBefore: number | undefined

  function essayKey(taskId: string, essayId: string): string {
    return `${taskId}\u0000${essayId}`
  }

  function currentTime(): number {
    const value = now()
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(INVALID_CONFIG_MESSAGE)
    return value
  }

  function taskStatus(task: TaskQueueState): TaskQueueSnapshot['status'] {
    if (!task.started) return 'idle'
    if (task.pauseReason) return 'paused'
    if (task.activeCount > 0) return 'running'
    for (const item of task.items.values()) {
      if (item.phase === 'queued' || item.phase === 'rate_limit_wait') return 'running'
    }
    return 'settled'
  }

  function snapshotFor(taskId: string): TaskQueueSnapshot {
    const task = tasks.get(taskId)
    if (!task) {
      return {
        taskId,
        status: 'idle',
        targetConcurrency: safeTarget,
        activeCount: 0,
        queuedCount: 0,
        items: {},
      }
    }
    const entries = task.order.flatMap((essayId) => {
      const item = task.items.get(essayId)
      if (!item) return []
      const {
        job: _job,
        automaticReattachReady: _automaticReattachReady,
        runningAnnouncementTimer: _runningAnnouncementTimer,
        ...itemSnapshot
      } = item
      return [[essayId, { ...itemSnapshot }] as const]
    })
    let queuedCount = 0
    for (const item of task.items.values()) {
      if (item.phase === 'queued'
        || (item.phase === 'rate_limit_wait'
          && !activeEssayKeys.has(essayKey(task.taskId, item.essayId)))) queuedCount += 1
    }
    return {
      taskId,
      status: taskStatus(task),
      ...(task.pauseReason ? { pauseReason: task.pauseReason } : {}),
      targetConcurrency: safeTarget,
      activeCount: task.activeCount,
      queuedCount,
      items: Object.fromEntries(entries),
    }
  }

  function emitAll(): void {
    if (disposed) return
    for (const taskId of tasks.keys()) {
      const snapshot = snapshotFor(taskId)
      for (const listener of [...listeners]) listener(snapshot)
    }
  }

  function safeRetryAt(delayMs: number): number | undefined {
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) return undefined
    const retryAt = currentTime() + delayMs
    return Number.isSafeInteger(retryAt) ? retryAt : undefined
  }

  function activeDispatchGate(referenceTime: number): number | undefined {
    if (dispatchNotBefore !== undefined && dispatchNotBefore <= referenceTime) dispatchNotBefore = undefined
    return dispatchNotBefore
  }

  function extendDispatchGate(retryAt: number): void {
    dispatchNotBefore = dispatchNotBefore === undefined
      ? retryAt
      : Math.max(dispatchNotBefore, retryAt)
  }

  function promoteEligibleWaits(referenceTime: number): void {
    for (const task of tasks.values()) {
      if (task.pauseReason) continue
      for (const item of task.items.values()) {
        if (item.phase === 'rate_limit_wait' && item.retryAt !== undefined && item.retryAt <= referenceTime) {
          item.automaticReattachReady = true
          delete item.retryAt
        }
      }
    }
  }

  function scheduleGateWake(): void {
    if (gateTimer !== undefined) {
      timers.clearTimeout(gateTimer)
      gateTimer = undefined
    }
    if (disposed) return
    const referenceTime = currentTime()
    const retryAt = activeDispatchGate(referenceTime)
    if (retryAt === undefined) return
    gateTimer = timers.setTimeout(() => {
      gateTimer = undefined
      if (disposed) return
      const wakeTime = currentTime()
      activeDispatchGate(wakeTime)
      promoteEligibleWaits(wakeTime)
      scheduleGateWake()
      emitAll()
      pump()
    }, Math.min(retryAt - referenceTime, MAX_TIMER_DELAY_MS))
  }

  function nextDispatchable(): { task: TaskQueueState; item: QueueItemState } | undefined {
    for (const task of tasks.values()) {
      if (task.pauseReason) continue
      for (const essayId of task.order) {
        const item = task.items.get(essayId)
        if ((item?.phase === 'queued' || item?.automaticReattachReady === true)
          && !activeEssayKeys.has(essayKey(task.taskId, essayId))) {
          return { task, item }
        }
      }
    }
    return undefined
  }

  function setFailureItem(
    item: QueueItemState,
    phase: QueueItemPhase,
    response: Extract<GradingClientResponse, { status: 'failed' }>,
  ): void {
    item.phase = phase
    item.automaticReattachReady = false
    item.retryable = phase === 'retryable_failure' || phase === 'rate_limit_wait'
    item.reattachOnly = phase === 'result_unknown'
    item.errorCode = response.error.code
    item.errorMessage = response.error.message
    if (phase !== 'rate_limit_wait') delete item.retryAt
  }

  function settle(task: TaskQueueState, item: QueueItemState, response: GradingClientResponse): void {
    if (item.runningAnnouncementTimer !== undefined) {
      timers.clearTimeout(item.runningAnnouncementTimer)
      item.runningAnnouncementTimer = undefined
    }
    globalActiveCount = Math.max(0, globalActiveCount - 1)
    task.activeCount = Math.max(0, task.activeCount - 1)
    activeEssayKeys.delete(essayKey(task.taskId, item.essayId))
    if (disposed) return

    const currentItem = task.items.get(item.essayId)
    if (currentItem !== item) {
      emitAll()
      pump()
      return
    }

    const safeResponse = response.requestId === item.requestId
      ? response
      : invalidJobResponse(item.requestId)
    if (isSuccess(safeResponse)) {
      item.phase = 'succeeded'
      item.retryable = false
      item.reattachOnly = false
      delete item.retryAt
      delete item.errorCode
      delete item.errorMessage
      if (!task.pauseReason) {
        stableSuccesses += 1
        if (stableSuccesses >= options.stableSuccessWindow) {
          if (options.mode === 'adaptive-v1' && safeTarget < hardLimit) safeTarget += 1
          stableSuccesses = 0
        }
      }
    } else {
      stableSuccesses = 0
      const clientFailure = safeResponse
      const code = clientFailure.error.code
      const reattachOnly = clientFailure.clientMeta?.reattachOnly === true || code === 'provider_result_unknown'
      const retryAfterMs = clientFailure.clientMeta?.retryAfterMs
      const retryAt = retryAfterMs === undefined ? undefined : safeRetryAt(retryAfterMs)
      const pauseReason = pauseReasonFor(code)

      if (code === 'provider_rate_limited') {
        safeTarget = Math.max(1, Math.floor(safeTarget / 2))
      }
      if (reattachOnly) {
        setFailureItem(item, 'result_unknown', clientFailure)
      } else if (pauseReason) {
        setFailureItem(item, 'final_failure', clientFailure)
        task.pauseReason ??= pauseReason
        task.pausedFailureEssayIds.add(item.essayId)
      } else if (clientFailure.error.retryable && retryAt !== undefined) {
        setFailureItem(item, 'rate_limit_wait', clientFailure)
        item.retryAt = retryAt
      } else if (clientFailure.error.retryable) {
        setFailureItem(item, 'retryable_failure', clientFailure)
      } else {
        setFailureItem(item, 'final_failure', clientFailure)
      }
      if (retryAt !== undefined) {
        extendDispatchGate(retryAt)
        if (retryAfterMs !== undefined && retryAfterMs > LONG_RETRY_AFTER_MS) task.pauseReason ??= 'long_retry_after'
        scheduleGateWake()
      }
    }

    emitAll()
    pump()
  }

  function dispatch(task: TaskQueueState, item: QueueItemState): void {
    const automaticReattach = item.automaticReattachReady
    item.automaticReattachReady = false
    item.retryable = false
    item.reattachOnly = false
    delete item.retryAt
    if (!automaticReattach) {
      item.phase = 'running'
      delete item.errorCode
      delete item.errorMessage
    }
    task.activeCount += 1
    globalActiveCount += 1
    activeEssayKeys.add(essayKey(task.taskId, item.essayId))
    emitAll()

    if (automaticReattach && !disposed) {
      item.runningAnnouncementTimer = timers.setTimeout(() => {
        item.runningAnnouncementTimer = undefined
        if (disposed
          || task.items.get(item.essayId) !== item
          || !activeEssayKeys.has(essayKey(task.taskId, item.essayId))) return
        item.phase = 'running'
        delete item.errorCode
        delete item.errorMessage
        emitAll()
      }, AUTO_REATTACH_RUNNING_ANNOUNCEMENT_DELAY_MS)
    }

    let execution: Promise<GradingClientResponse>
    try {
      execution = Promise.resolve(item.job.run())
    } catch {
      execution = Promise.reject(new Error('grading_job_rejected'))
    }
    void execution.then(
      (response) => settle(task, item, response),
      () => settle(task, item, rejectedJobFailure(item.requestId)),
    )
  }

  function pump(): void {
    if (disposed || pumping) return
    pumping = true
    try {
      const referenceTime = currentTime()
      promoteEligibleWaits(referenceTime)
      if (activeDispatchGate(referenceTime) !== undefined) {
        scheduleGateWake()
        return
      }
      const concurrencyLimit = Math.min(safeTarget, hardLimit)
      while (globalActiveCount < concurrencyLimit) {
        const candidate = nextDispatchable()
        if (!candidate) break
        dispatch(candidate.task, candidate.item)
      }
    } finally {
      pumping = false
    }
  }

  return {
    startTask(taskId, jobs) {
      if (disposed) return
      if (!taskId || jobs.some((entry) => entry.taskId !== taskId)) throw new Error(INVALID_CONFIG_MESSAGE)
      let task = tasks.get(taskId)
      if (!task) {
        task = {
          taskId,
          started: true,
          order: [],
          items: new Map(),
          activeCount: 0,
          pausedFailureEssayIds: new Set(),
        }
        tasks.set(taskId, task)
      }
      task.started = true
      for (const entry of jobs) {
        const existing = task.items.get(entry.essayId)
        if (existing && sameJobVersion(existing, entry)) continue
        if (existing?.runningAnnouncementTimer !== undefined) {
          timers.clearTimeout(existing.runningAnnouncementTimer)
        }
        if (!existing) task.order.push(entry.essayId)
        task.items.set(entry.essayId, queuedItem(entry))
      }
      emitAll()
      pump()
    },

    retryEssay(taskId, essayId) {
      if (disposed) return
      const item = tasks.get(taskId)?.items.get(essayId)
      if (item?.phase !== 'retryable_failure') return
      resetToQueued(item)
      emitAll()
      pump()
    },

    checkUnknownEssay(taskId, essayId) {
      if (disposed) return
      const item = tasks.get(taskId)?.items.get(essayId)
      if (item?.phase !== 'result_unknown') return
      resetToQueued(item)
      emitAll()
      pump()
    },

    resumeTask(taskId) {
      if (disposed) return
      const task = tasks.get(taskId)
      if (!task?.pauseReason) return
      task.pauseReason = undefined
      for (const essayId of task.pausedFailureEssayIds) {
        const item = task.items.get(essayId)
        if (item?.phase === 'final_failure' && item.errorCode && pauseReasonFor(item.errorCode)) {
          resetToQueued(item)
        }
      }
      task.pausedFailureEssayIds.clear()
      promoteEligibleWaits(currentTime())
      scheduleGateWake()
      emitAll()
      pump()
    },

    getSnapshot(taskId) {
      return snapshotFor(taskId)
    },

    subscribe(listener) {
      if (disposed) return () => undefined
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },

    dispose() {
      if (disposed) return
      disposed = true
      if (gateTimer !== undefined) timers.clearTimeout(gateTimer)
      gateTimer = undefined
      for (const task of tasks.values()) {
        for (const item of task.items.values()) {
          if (item.runningAnnouncementTimer !== undefined) timers.clearTimeout(item.runningAnnouncementTimer)
          item.runningAnnouncementTimer = undefined
        }
      }
      listeners.clear()
    },
  }
}
