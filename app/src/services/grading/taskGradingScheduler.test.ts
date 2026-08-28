import { describe, expect, it, vi } from 'vitest'
import type { GradingClientResponse } from './types'
import {
  createTaskGradingScheduler,
  type GradingJob,
  type SchedulerTimers,
  type TaskQueueSnapshot,
} from './taskGradingScheduler'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function success(requestId: string, essayId: string): GradingClientResponse {
  return { requestId, essayId, status: 'success' } as GradingClientResponse
}

function failure(
  requestId: string,
  code: string,
  retryable: boolean,
  clientMeta?: { retryAfterMs?: number; reattachOnly?: true },
): GradingClientResponse {
  return {
    requestId,
    status: 'failed',
    error: { code, message: `safe:${code}`, retryable },
    ...(clientMeta ? { clientMeta } : {}),
  } as GradingClientResponse
}

function job(
  taskId: string,
  essayId: string,
  requestId: string,
  run: () => Promise<GradingClientResponse>,
  sourceGeneration = 0,
  rubricGeneration = 0,
): GradingJob {
  return { taskId, essayId, requestId, sourceGeneration, rubricGeneration, run }
}

class FakeRuntime {
  current = 0
  #nextId = 1
  #entries = new Map<number, { at: number; callback: () => void }>()

  readonly now = () => this.current
  readonly timers: SchedulerTimers = {
    setTimeout: (callback, delayMs) => {
      const id = this.#nextId++
      this.#entries.set(id, { at: this.current + delayMs, callback })
      return id
    },
    clearTimeout: (handle) => {
      this.#entries.delete(handle as number)
    },
  }

  advanceBy(delayMs: number) {
    const target = this.current + delayMs
    while (true) {
      const next = [...this.#entries.entries()]
        .filter(([, entry]) => entry.at <= target)
        .sort(([leftId, left], [rightId, right]) => left.at - right.at || leftId - rightId)[0]
      if (!next) break
      const [id, entry] = next
      this.#entries.delete(id)
      this.current = entry.at
      entry.callback()
    }
    this.current = target
  }
}

describe('createTaskGradingScheduler', () => {
  it('enqueues in stable order, fills slots immediately, grows additively, and retains the safe target for later tasks', async () => {
    const runtime = new FakeRuntime()
    const scheduler = createTaskGradingScheduler({
      mode: 'adaptive-v1', hardLimit: 3, stableSuccessWindow: 2,
      now: runtime.now, random: () => 0, timers: runtime.timers,
    })
    const calls: string[] = []
    const completions = Array.from({ length: 6 }, () => deferred<GradingClientResponse>())
    const jobs = completions.slice(0, 4).map((completion, index) => job(
      'task-1', `essay-${index + 1}`, `request-${index + 1}`,
      vi.fn(() => { calls.push(`essay-${index + 1}`); return completion.promise }),
    ))
    let maxActive = 0
    scheduler.subscribe((snapshot) => { maxActive = Math.max(maxActive, snapshot.activeCount) })

    scheduler.startTask('task-1', jobs)
    await flushMicrotasks()

    expect(Object.keys(scheduler.getSnapshot('task-1').items)).toEqual(['essay-1', 'essay-2', 'essay-3', 'essay-4'])
    expect(calls).toEqual(['essay-1'])
    expect(scheduler.getSnapshot('task-1')).toMatchObject({ targetConcurrency: 1, activeCount: 1, queuedCount: 3 })

    completions[0]!.resolve(success('request-1', 'essay-1'))
    await flushMicrotasks()
    expect(calls).toEqual(['essay-1', 'essay-2'])
    expect(scheduler.getSnapshot('task-1').targetConcurrency).toBe(1)

    completions[1]!.resolve(success('request-2', 'essay-2'))
    await flushMicrotasks()
    expect(calls).toEqual(['essay-1', 'essay-2', 'essay-3', 'essay-4'])
    expect(scheduler.getSnapshot('task-1')).toMatchObject({ targetConcurrency: 2, activeCount: 2 })
    expect(maxActive).toBeLessThanOrEqual(2)

    completions[2]!.resolve(success('request-3', 'essay-3'))
    completions[3]!.resolve(success('request-4', 'essay-4'))
    await flushMicrotasks()
    expect(scheduler.getSnapshot('task-1').status).toBe('settled')

    const laterJobs = [4, 5].map((index) => job(
      'task-2', `essay-${index + 1}`, `request-${index + 1}`,
      vi.fn(() => { calls.push(`essay-${index + 1}`); return completions[index]!.promise }),
    ))
    scheduler.startTask('task-2', laterJobs)
    await flushMicrotasks()
    expect(calls.slice(-2)).toEqual(['essay-5', 'essay-6'])
    expect(scheduler.getSnapshot('task-2')).toMatchObject({ targetConcurrency: 3, activeCount: 2 })
  })

  it('deduplicates repeated start/attach for the same job version and request ID', async () => {
    const completion = deferred<GradingClientResponse>()
    const firstRun = vi.fn(() => completion.promise)
    const duplicateRun = vi.fn(async () => success('request-1', 'essay-1'))
    const scheduler = createTaskGradingScheduler({ mode: 'adaptive-v1', hardLimit: 2, stableSuccessWindow: 2 })

    scheduler.startTask('task-1', [job('task-1', 'essay-1', 'request-1', firstRun)])
    scheduler.startTask('task-1', [job('task-1', 'essay-1', 'request-1', duplicateRun)])
    await flushMicrotasks()
    expect(firstRun).toHaveBeenCalledTimes(1)
    expect(duplicateRun).not.toHaveBeenCalled()

    completion.resolve(success('request-1', 'essay-1'))
    await flushMicrotasks()
    scheduler.startTask('task-1', [job('task-1', 'essay-1', 'request-1', duplicateRun)])
    await flushMicrotasks()
    expect(duplicateRun).not.toHaveBeenCalled()
  })

  it('queues a newer source generation behind its still-running predecessor and ignores the stale settlement', async () => {
    const oldCompletion = deferred<GradingClientResponse>()
    const newCompletion = deferred<GradingClientResponse>()
    const oldRun = vi.fn(() => oldCompletion.promise)
    const newRun = vi.fn(() => newCompletion.promise)
    const scheduler = createTaskGradingScheduler({ mode: 'adaptive-v1', hardLimit: 2, stableSuccessWindow: 2 })

    scheduler.startTask('task-1', [job('task-1', 'essay-1', 'request-old', oldRun, 0)])
    await flushMicrotasks()
    scheduler.startTask('task-1', [job('task-1', 'essay-1', 'request-new', newRun, 1)])
    await flushMicrotasks()
    expect(oldRun).toHaveBeenCalledTimes(1)
    expect(newRun).not.toHaveBeenCalled()
    expect(scheduler.getSnapshot('task-1').items['essay-1']).toMatchObject({
      requestId: 'request-new', sourceGeneration: 1, phase: 'queued',
    })

    oldCompletion.resolve(success('request-old', 'essay-1'))
    await flushMicrotasks()
    expect(newRun).toHaveBeenCalledTimes(1)
    expect(scheduler.getSnapshot('task-1').items['essay-1']).toMatchObject({
      requestId: 'request-new', sourceGeneration: 1, phase: 'running',
    })
  })

  it('halves concurrency on rate limit, observes the complete bounded Retry-After, and reattaches the same job', async () => {
    const runtime = new FakeRuntime()
    const scheduler = createTaskGradingScheduler({
      mode: 'adaptive-v1', hardLimit: 4, stableSuccessWindow: 2,
      now: runtime.now, random: () => 0.75, timers: runtime.timers,
    })

    const warm1 = deferred<GradingClientResponse>()
    const warm2 = deferred<GradingClientResponse>()
    scheduler.startTask('warm', [
      job('warm', 'warm-1', 'warm-request-1', () => warm1.promise),
      job('warm', 'warm-2', 'warm-request-2', () => warm2.promise),
    ])
    await flushMicrotasks()
    warm1.resolve(success('warm-request-1', 'warm-1'))
    await flushMicrotasks()
    warm2.resolve(success('warm-request-2', 'warm-2'))
    await flushMicrotasks()
    expect(scheduler.getSnapshot('warm').targetConcurrency).toBe(2)

    const firstRate = deferred<GradingClientResponse>()
    const retriedRate = deferred<GradingClientResponse>()
    const peer = deferred<GradingClientResponse>()
    const last = deferred<GradingClientResponse>()
    const rateRun = vi.fn()
      .mockImplementationOnce(() => firstRate.promise)
      .mockImplementationOnce(() => retriedRate.promise)
    const peerRun = vi.fn(() => peer.promise)
    const lastRun = vi.fn(() => last.promise)
    scheduler.startTask('task-rate', [
      job('task-rate', 'essay-rate', 'stable-request', rateRun),
      job('task-rate', 'essay-peer', 'peer-request', peerRun),
      job('task-rate', 'essay-last', 'last-request', lastRun),
    ])
    await flushMicrotasks()
    expect(rateRun).toHaveBeenCalledTimes(1)
    expect(peerRun).toHaveBeenCalledTimes(1)

    firstRate.resolve(failure('stable-request', 'provider_rate_limited', true, { retryAfterMs: 1_000 }))
    await flushMicrotasks()
    expect(scheduler.getSnapshot('task-rate')).toMatchObject({ targetConcurrency: 1 })
    expect(scheduler.getSnapshot('task-rate').items['essay-rate']).toMatchObject({
      phase: 'rate_limit_wait', requestId: 'stable-request', retryAt: 1_000,
    })

    peer.resolve(success('peer-request', 'essay-peer'))
    await flushMicrotasks()
    runtime.advanceBy(999)
    await flushMicrotasks()
    expect(rateRun).toHaveBeenCalledTimes(1)
    expect(lastRun).not.toHaveBeenCalled()

    runtime.advanceBy(1)
    await flushMicrotasks()
    expect(rateRun).toHaveBeenCalledTimes(2)
    expect(lastRun).not.toHaveBeenCalled()
    expect(scheduler.getSnapshot('task-rate').items['essay-rate']?.requestId).toBe('stable-request')

    retriedRate.resolve(success('stable-request', 'essay-rate'))
    await flushMicrotasks()
    expect(lastRun).toHaveBeenCalledTimes(1)
  })

  it('pauses a task for a Retry-After over fifteen minutes and still never retries early after resume', async () => {
    const runtime = new FakeRuntime()
    const first = deferred<GradingClientResponse>()
    const retried = deferred<GradingClientResponse>()
    const run = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => retried.promise)
    const queuedRun = vi.fn(async () => success('request-2', 'essay-2'))
    const scheduler = createTaskGradingScheduler({
      mode: 'adaptive-v1', hardLimit: 2, stableSuccessWindow: 2,
      now: runtime.now, timers: runtime.timers,
    })
    scheduler.startTask('task-long', [
      job('task-long', 'essay-1', 'request-1', run),
      job('task-long', 'essay-2', 'request-2', queuedRun),
    ])
    await flushMicrotasks()

    first.resolve(failure('request-1', 'provider_rate_limited', true, { retryAfterMs: 900_001 }))
    await flushMicrotasks()
    expect(scheduler.getSnapshot('task-long')).toMatchObject({ status: 'paused', pauseReason: 'long_retry_after' })
    expect(queuedRun).not.toHaveBeenCalled()

    scheduler.resumeTask('task-long')
    runtime.advanceBy(900_000)
    await flushMicrotasks()
    expect(run).toHaveBeenCalledTimes(1)
    expect(queuedRun).not.toHaveBeenCalled()

    runtime.advanceBy(1)
    await flushMicrotasks()
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('honors a final exhausted rate-limit gate without retrying that final essay', async () => {
    const runtime = new FakeRuntime()
    const exhausted = deferred<GradingClientResponse>()
    const exhaustedRun = vi.fn(() => exhausted.promise)
    const nextRun = vi.fn(async () => success('request-2', 'essay-2'))
    const scheduler = createTaskGradingScheduler({
      mode: 'adaptive-v1', hardLimit: 2, stableSuccessWindow: 2,
      now: runtime.now, timers: runtime.timers,
    })
    scheduler.startTask('task-final-rate', [
      job('task-final-rate', 'essay-1', 'request-1', exhaustedRun),
      job('task-final-rate', 'essay-2', 'request-2', nextRun),
    ])
    await flushMicrotasks()

    exhausted.resolve(failure('request-1', 'provider_rate_limited', false, { retryAfterMs: 1_000 }))
    await flushMicrotasks()
    expect(scheduler.getSnapshot('task-final-rate').items['essay-1']).toMatchObject({
      phase: 'final_failure', retryable: false,
    })
    expect(nextRun).not.toHaveBeenCalled()

    runtime.advanceBy(999)
    await flushMicrotasks()
    expect(nextRun).not.toHaveBeenCalled()
    runtime.advanceBy(1)
    await flushMicrotasks()
    expect(nextRun).toHaveBeenCalledTimes(1)
    expect(exhaustedRun).toHaveBeenCalledTimes(1)
  })

  it('isolates an unscheduled retryable failure, continues other essays, and retries only on teacher action', async () => {
    const firstFailure = deferred<GradingClientResponse>()
    const firstRetry = deferred<GradingClientResponse>()
    const second = deferred<GradingClientResponse>()
    const firstRun = vi.fn().mockImplementationOnce(() => firstFailure.promise).mockImplementationOnce(() => firstRetry.promise)
    const secondRun = vi.fn(() => second.promise)
    const scheduler = createTaskGradingScheduler({ mode: 'adaptive-v1', hardLimit: 2, stableSuccessWindow: 2 })
    scheduler.startTask('task-1', [
      job('task-1', 'essay-1', 'request-1', firstRun),
      job('task-1', 'essay-2', 'request-2', secondRun),
    ])
    await flushMicrotasks()

    firstFailure.resolve(failure('request-1', 'gateway_unavailable', true))
    await flushMicrotasks()
    expect(firstRun).toHaveBeenCalledTimes(1)
    expect(secondRun).toHaveBeenCalledTimes(1)
    expect(scheduler.getSnapshot('task-1').items['essay-1']).toMatchObject({
      phase: 'retryable_failure', retryable: true, reattachOnly: false,
    })

    second.resolve(success('request-2', 'essay-2'))
    await flushMicrotasks()
    expect(firstRun).toHaveBeenCalledTimes(1)
    scheduler.retryEssay('task-1', 'essay-1')
    await flushMicrotasks()
    expect(firstRun).toHaveBeenCalledTimes(2)
    expect(scheduler.getSnapshot('task-1').items['essay-1']?.requestId).toBe('request-1')
  })

  it('pauses new dispatch on auth while already-running work settles, then resumes queued work explicitly', async () => {
    const scheduler = createTaskGradingScheduler({ mode: 'adaptive-v1', hardLimit: 3, stableSuccessWindow: 2 })
    const warm1 = deferred<GradingClientResponse>()
    const warm2 = deferred<GradingClientResponse>()
    scheduler.startTask('warm', [
      job('warm', 'warm-1', 'warm-request-1', () => warm1.promise),
      job('warm', 'warm-2', 'warm-request-2', () => warm2.promise),
    ])
    await flushMicrotasks()
    warm1.resolve(success('warm-request-1', 'warm-1'))
    await flushMicrotasks()
    warm2.resolve(success('warm-request-2', 'warm-2'))
    await flushMicrotasks()

    const auth = deferred<GradingClientResponse>()
    const running = deferred<GradingClientResponse>()
    const authRun = vi.fn(() => auth.promise)
    const runningRun = vi.fn(() => running.promise)
    const queuedRun = vi.fn(async () => success('request-3', 'essay-3'))
    scheduler.startTask('task-auth', [
      job('task-auth', 'essay-1', 'request-1', authRun),
      job('task-auth', 'essay-2', 'request-2', runningRun),
      job('task-auth', 'essay-3', 'request-3', queuedRun),
    ])
    await flushMicrotasks()
    expect(authRun).toHaveBeenCalledTimes(1)
    expect(runningRun).toHaveBeenCalledTimes(1)

    auth.resolve(failure('request-1', 'provider_auth_failed', false))
    await flushMicrotasks()
    expect(scheduler.getSnapshot('task-auth')).toMatchObject({ status: 'paused', pauseReason: 'auth' })
    expect(queuedRun).not.toHaveBeenCalled()

    running.resolve(success('request-2', 'essay-2'))
    await flushMicrotasks()
    expect(scheduler.getSnapshot('task-auth').items['essay-2']?.phase).toBe('succeeded')
    expect(queuedRun).not.toHaveBeenCalled()

    scheduler.resumeTask('task-auth')
    await flushMicrotasks()
    expect(queuedRun).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['provider_balance_unavailable', 'balance'],
    ['provider_not_configured', 'configuration'],
  ] as const)('maps %s to the task pause reason %s', async (code, pauseReason) => {
    const response = deferred<GradingClientResponse>()
    const scheduler = createTaskGradingScheduler({ mode: 'adaptive-v1', hardLimit: 1, stableSuccessWindow: 2 })
    scheduler.startTask('task-pause', [job('task-pause', 'essay-1', 'request-1', () => response.promise)])
    await flushMicrotasks()
    response.resolve(failure('request-1', code, false))
    await flushMicrotasks()
    expect(scheduler.getSnapshot('task-pause')).toMatchObject({ status: 'paused', pauseReason })
  })

  it('treats result-unknown as reattachment-only and checks the same request without fresh retry work', async () => {
    const first = deferred<GradingClientResponse>()
    const checked = deferred<GradingClientResponse>()
    const run = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => checked.promise)
    const scheduler = createTaskGradingScheduler({ mode: 'adaptive-v1', hardLimit: 2, stableSuccessWindow: 2 })
    scheduler.startTask('task-unknown', [job('task-unknown', 'essay-1', 'stable-request', run)])
    await flushMicrotasks()
    first.resolve(failure('stable-request', 'provider_result_unknown', false, { reattachOnly: true }))
    await flushMicrotasks()

    expect(scheduler.getSnapshot('task-unknown').items['essay-1']).toMatchObject({
      phase: 'result_unknown', requestId: 'stable-request', retryable: false, reattachOnly: true,
    })
    scheduler.retryEssay('task-unknown', 'essay-1')
    await flushMicrotasks()
    expect(run).toHaveBeenCalledTimes(1)

    scheduler.checkUnknownEssay('task-unknown', 'essay-1')
    await flushMicrotasks()
    expect(run).toHaveBeenCalledTimes(2)
    checked.resolve(success('stable-request', 'essay-1'))
    await flushMicrotasks()
    expect(scheduler.getSnapshot('task-unknown').items['essay-1']?.phase).toBe('succeeded')
  })

  it('never offers retry for a final failure', async () => {
    const response = deferred<GradingClientResponse>()
    const run = vi.fn(() => response.promise)
    const scheduler = createTaskGradingScheduler({ mode: 'adaptive-v1', hardLimit: 2, stableSuccessWindow: 2 })
    scheduler.startTask('task-final', [job('task-final', 'essay-1', 'request-1', run)])
    await flushMicrotasks()
    response.resolve(failure('request-1', 'provider_invalid_response', false))
    await flushMicrotasks()
    scheduler.retryEssay('task-final', 'essay-1')
    scheduler.checkUnknownEssay('task-final', 'essay-1')
    await flushMicrotasks()
    expect(run).toHaveBeenCalledTimes(1)
    expect(scheduler.getSnapshot('task-final').items['essay-1']).toMatchObject({ phase: 'final_failure', retryable: false })
  })

  it('keeps single-legacy at exactly one worker regardless of successes or the configured hard limit', async () => {
    const first = deferred<GradingClientResponse>()
    const second = deferred<GradingClientResponse>()
    const firstRun = vi.fn(() => first.promise)
    const secondRun = vi.fn(() => second.promise)
    const scheduler = createTaskGradingScheduler({ mode: 'single-legacy', hardLimit: 9, stableSuccessWindow: 1 })
    const snapshots: TaskQueueSnapshot[] = []
    scheduler.subscribe((snapshot) => snapshots.push(snapshot))
    scheduler.startTask('task-legacy', [
      job('task-legacy', 'essay-1', 'request-1', firstRun),
      job('task-legacy', 'essay-2', 'request-2', secondRun),
    ])
    await flushMicrotasks()
    expect(firstRun).toHaveBeenCalledTimes(1)
    expect(secondRun).not.toHaveBeenCalled()
    first.resolve(success('request-1', 'essay-1'))
    await flushMicrotasks()
    expect(secondRun).toHaveBeenCalledTimes(1)
    expect(scheduler.getSnapshot('task-legacy').targetConcurrency).toBe(1)
    expect(Math.max(...snapshots.map(({ activeCount }) => activeCount))).toBe(1)
  })
})
