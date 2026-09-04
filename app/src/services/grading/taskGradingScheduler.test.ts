import { describe, expect, it, vi } from 'vitest'
import type { GradingClientResponse, MultimodalGradingRequestV2 } from './types'
import { createRemoteGradingClient } from './remoteGradingClient'
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

async function flushUntil(predicate: () => boolean) {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return
    await Promise.resolve()
  }
  throw new Error('Timed out while flushing scheduler microtasks.')
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

function remoteRequest(requestId: string, essayId: string): MultimodalGradingRequestV2 {
  return {
    requestVersion: 'multimodal-grading-request-v2',
    requestId,
    essayId,
    pageIds: [`${essayId}-page-1`],
    task: {
      taskId: 'task-remote-vertical',
      fullScore: 15,
      materialSummary: 'Synthetic material.',
      writingRequirements: ['Write a synthetic response.'],
      constraints: [],
      rubric: {
        taskName: 'Synthetic remote vertical task',
        materialSummary: 'Synthetic material.',
        writingRequirements: ['Write a synthetic response.'],
        constraints: [],
        reviewWarnings: [],
        dimensions: [{
          id: 'content',
          name: 'Content',
          weight: 100,
          description: 'Complete the task.',
          deductionFocus: [],
          sourceEvidence: [],
        }],
      },
    },
    pages: [{
      pageId: `${essayId}-page-1`,
      file: new File(['synthetic'], `${essayId}.png`, { type: 'image/png' }),
    }],
  }
}

function remoteSuccessBody(request: MultimodalGradingRequestV2) {
  const transcript = 'Synthetic transcript.'
  return {
    resultVersion: 'grading-result-v2',
    requestId: request.requestId,
    essayId: request.essayId,
    provider: 'remote',
    status: 'success',
    totalScore: 15,
    maxScore: 15,
    dimensionScores: [{
      dimensionId: 'content',
      name: 'Content',
      score: 15,
      maxScore: 15,
      weight: 100,
      reason: 'Synthetic reason.',
      evidence: transcript,
    }],
    issues: [],
    sentenceRevisions: [],
    expressionUpgrades: [],
    fullTextRevision: {
      originalText: transcript,
      correctedText: transcript,
      improvedText: transcript,
      sentencePairs: [],
      logicNotes: [],
      logicIssues: [],
    },
    overallComment: 'Synthetic result.',
    transcript,
    recognitionWarnings: [],
    legibilityIssues: [],
    printedTextExcluded: true,
    reviewReasons: [],
    createdAt: '2026-08-29T00:00:00.000Z',
  }
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

  get pendingTimerCount() {
    return this.#entries.size
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

  it.each([
    ['target_busy', 'provider_rate_limited', 429],
    ['provider unavailable', 'provider_unavailable', 503],
  ] as const)(
    'reattaches the fifth remote %s response after Retry-After and completes the sixth essay without a manual failure',
    async (_label, code, httpStatus) => {
      const runtime = new FakeRuntime()
      const requests = Array.from({ length: 6 }, (_, index) => remoteRequest(
        `remote-request-${index + 1}`,
        `remote-essay-${index + 1}`,
      ))
      const requestById = new Map(requests.map((request) => [request.requestId, request]))
      const callRequestIds: string[] = []
      let fifthAttempt = 0
      const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const form = init?.body as FormData
        const metadata = JSON.parse(String(form.get('metadata'))) as { requestId: string }
        const request = requestById.get(metadata.requestId)
        if (!request) throw new Error('Unexpected synthetic request ID.')
        callRequestIds.push(metadata.requestId)
        if (metadata.requestId === 'remote-request-5' && fifthAttempt++ === 0) {
          return new Response(JSON.stringify({
            requestId: metadata.requestId,
            status: 'failed',
            error: { code, message: 'PRIVATE-GATEWAY-DETAIL', retryable: true },
          }), { status: httpStatus, headers: { 'Retry-After': '1' } })
        }
        return new Response(JSON.stringify(remoteSuccessBody(request)), { status: 200 })
      })
      const client = createRemoteGradingClient({
        apiBase: 'http://gateway.test',
        fetchImpl,
        now: runtime.now,
      })
      const scheduler = createTaskGradingScheduler({
        mode: 'adaptive-v1',
        hardLimit: 2,
        stableSuccessWindow: 8,
        now: runtime.now,
        timers: runtime.timers,
      })
      scheduler.startTask('task-remote-vertical', requests.map((request) => job(
        'task-remote-vertical',
        request.essayId,
        request.requestId,
        () => client.gradeImages(request),
      )))

      await flushUntil(() => (
        scheduler.getSnapshot('task-remote-vertical').items['remote-essay-5']?.phase === 'rate_limit_wait'
      ))
      expect(callRequestIds).toEqual([
        'remote-request-1',
        'remote-request-2',
        'remote-request-3',
        'remote-request-4',
        'remote-request-5',
      ])
      expect(scheduler.getSnapshot('task-remote-vertical').items['remote-essay-5']).toMatchObject({
        phase: 'rate_limit_wait',
        requestId: 'remote-request-5',
        retryAt: 1_000,
      })
      expect(scheduler.getSnapshot('task-remote-vertical').items['remote-essay-6']?.phase).toBe('queued')
      expect(Object.values(scheduler.getSnapshot('task-remote-vertical').items)
        .some((item) => item.phase === 'retryable_failure')).toBe(false)

      runtime.advanceBy(999)
      await flushMicrotasks()
      expect(callRequestIds).toHaveLength(5)
      runtime.advanceBy(1)
      await flushUntil(() => scheduler.getSnapshot('task-remote-vertical').status === 'settled')

      expect(callRequestIds).toEqual([
        'remote-request-1',
        'remote-request-2',
        'remote-request-3',
        'remote-request-4',
        'remote-request-5',
        'remote-request-5',
        'remote-request-6',
      ])
      expect(scheduler.getSnapshot('task-remote-vertical').items['remote-essay-5']?.phase).toBe('succeeded')
      expect(scheduler.getSnapshot('task-remote-vertical').items['remote-essay-6']?.phase).toBe('succeeded')
    },
  )

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

  it('keeps the visible wait phase through rapid automatic rate-limit reattachments', async () => {
    const runtime = new FakeRuntime()
    const run = vi.fn(async () => failure(
      'stable-request',
      'provider_rate_limited',
      true,
      { retryAfterMs: 100 },
    ))
    const scheduler = createTaskGradingScheduler({
      mode: 'adaptive-v1', hardLimit: 1, stableSuccessWindow: 2,
      now: runtime.now, timers: runtime.timers,
    })
    const phases: string[] = []
    scheduler.subscribe((snapshot) => {
      phases.push(snapshot.items['essay-1']?.phase ?? 'missing')
    })

    scheduler.startTask('task-rate-limit-loop', [
      job('task-rate-limit-loop', 'essay-1', 'stable-request', run),
    ])
    await flushUntil(() => scheduler.getSnapshot('task-rate-limit-loop').items['essay-1']?.phase === 'rate_limit_wait')

    phases.length = 0
    runtime.advanceBy(100)
    await flushUntil(() => run.mock.calls.length === 2
      && scheduler.getSnapshot('task-rate-limit-loop').items['essay-1']?.phase === 'rate_limit_wait')

    expect(phases).not.toContain('queued')
    expect(phases).not.toContain('running')
    expect(scheduler.getSnapshot('task-rate-limit-loop').items['essay-1']?.requestId).toBe('stable-request')

    runtime.advanceBy(250)
    expect(scheduler.getSnapshot('task-rate-limit-loop').items['essay-1']?.phase).toBe('rate_limit_wait')
  })

  it('shows running after an automatic rate-limit reattachment remains active', async () => {
    const runtime = new FakeRuntime()
    const initial = deferred<GradingClientResponse>()
    const reattached = deferred<GradingClientResponse>()
    const run = vi.fn()
      .mockImplementationOnce(() => initial.promise)
      .mockImplementationOnce(() => reattached.promise)
    const scheduler = createTaskGradingScheduler({
      mode: 'adaptive-v1', hardLimit: 1, stableSuccessWindow: 2,
      now: runtime.now, timers: runtime.timers,
    })

    scheduler.startTask('task-running-delay', [
      job('task-running-delay', 'essay-1', 'stable-request', run),
    ])
    await flushMicrotasks()
    initial.resolve(failure('stable-request', 'provider_rate_limited', true, { retryAfterMs: 100 }))
    await flushUntil(() => scheduler.getSnapshot('task-running-delay').items['essay-1']?.phase === 'rate_limit_wait')

    runtime.advanceBy(100)
    await flushUntil(() => run.mock.calls.length === 2)
    expect(scheduler.getSnapshot('task-running-delay')).toMatchObject({
      activeCount: 1,
      queuedCount: 0,
      items: { 'essay-1': { phase: 'rate_limit_wait', requestId: 'stable-request' } },
    })

    runtime.advanceBy(250)
    expect(scheduler.getSnapshot('task-running-delay').items['essay-1']?.phase).toBe('running')

    reattached.resolve(success('stable-request', 'essay-1'))
    await flushMicrotasks()
  })

  it('does not install a delayed running notice after a subscriber disposes during automatic reattachment', async () => {
    const runtime = new FakeRuntime()
    const initial = deferred<GradingClientResponse>()
    const reattached = deferred<GradingClientResponse>()
    const run = vi.fn()
      .mockImplementationOnce(() => initial.promise)
      .mockImplementationOnce(() => reattached.promise)
    const scheduler = createTaskGradingScheduler({
      mode: 'adaptive-v1', hardLimit: 1, stableSuccessWindow: 2,
      now: runtime.now, timers: runtime.timers,
    })
    scheduler.subscribe((snapshot) => {
      if (snapshot.activeCount === 1 && snapshot.items['essay-1']?.phase === 'rate_limit_wait') {
        scheduler.dispose()
      }
    })

    scheduler.startTask('task-dispose-during-emit', [
      job('task-dispose-during-emit', 'essay-1', 'stable-request', run),
    ])
    await flushMicrotasks()
    initial.resolve(failure('stable-request', 'provider_rate_limited', true, { retryAfterMs: 100 }))
    await flushUntil(() => scheduler.getSnapshot('task-dispose-during-emit').items['essay-1']?.phase === 'rate_limit_wait')
    runtime.advanceBy(100)

    expect(runtime.pendingTimerCount).toBe(0)
    expect(run).toHaveBeenCalledTimes(2)

    reattached.resolve(success('stable-request', 'essay-1'))
    await flushMicrotasks()
  })

  it('clears a delayed automatic running notice when disposed', async () => {
    const runtime = new FakeRuntime()
    const initial = deferred<GradingClientResponse>()
    const reattached = deferred<GradingClientResponse>()
    const run = vi.fn()
      .mockImplementationOnce(() => initial.promise)
      .mockImplementationOnce(() => reattached.promise)
    const scheduler = createTaskGradingScheduler({
      mode: 'adaptive-v1', hardLimit: 1, stableSuccessWindow: 2,
      now: runtime.now, timers: runtime.timers,
    })

    scheduler.startTask('task-dispose-delay', [
      job('task-dispose-delay', 'essay-1', 'stable-request', run),
    ])
    initial.resolve(failure('stable-request', 'provider_rate_limited', true, { retryAfterMs: 100 }))
    await flushUntil(() => scheduler.getSnapshot('task-dispose-delay').items['essay-1']?.phase === 'rate_limit_wait')
    runtime.advanceBy(100)
    await flushUntil(() => run.mock.calls.length === 2)

    expect(runtime.pendingTimerCount).toBe(1)
    scheduler.dispose()
    expect(runtime.pendingTimerCount).toBe(0)

    reattached.resolve(success('stable-request', 'essay-1'))
    await flushMicrotasks()
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
    const authRetry = deferred<GradingClientResponse>()
    const authRun = vi.fn()
      .mockImplementationOnce(() => auth.promise)
      .mockImplementationOnce(() => authRetry.promise)
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
    expect(authRun).toHaveBeenCalledTimes(2)
    expect(queuedRun).toHaveBeenCalledTimes(1)
    expect(scheduler.getSnapshot('task-auth').items['essay-1']).toMatchObject({
      phase: 'running',
      requestId: 'request-1',
      sourceGeneration: 0,
      rubricGeneration: 0,
    })

    authRetry.resolve(success('request-1', 'essay-1'))
    await flushMicrotasks()
    expect(scheduler.getSnapshot('task-auth').status).toBe('settled')
  })

  it.each([
    ['provider_balance_unavailable', 'balance'],
    ['provider_not_configured', 'configuration'],
  ] as const)('maps %s to %s and requeues its triggering job on explicit resume', async (code, pauseReason) => {
    const response = deferred<GradingClientResponse>()
    const resumed = deferred<GradingClientResponse>()
    const run = vi.fn()
      .mockImplementationOnce(() => response.promise)
      .mockImplementationOnce(() => resumed.promise)
    const scheduler = createTaskGradingScheduler({ mode: 'adaptive-v1', hardLimit: 1, stableSuccessWindow: 2 })
    scheduler.startTask('task-pause', [job('task-pause', 'essay-1', 'request-1', run)])
    await flushMicrotasks()
    response.resolve(failure('request-1', code, false))
    await flushMicrotasks()
    expect(scheduler.getSnapshot('task-pause')).toMatchObject({ status: 'paused', pauseReason })

    scheduler.resumeTask('task-pause')
    await flushMicrotasks()
    expect(run).toHaveBeenCalledTimes(2)
    expect(scheduler.getSnapshot('task-pause').items['essay-1']).toMatchObject({
      phase: 'running', requestId: 'request-1', sourceGeneration: 0, rubricGeneration: 0,
    })
    resumed.resolve(success('request-1', 'essay-1'))
    await flushMicrotasks()
    expect(scheduler.getSnapshot('task-pause').status).toBe('settled')
  })

  it('pauses again without looping when the resumed auth trigger still fails', async () => {
    const first = deferred<GradingClientResponse>()
    const second = deferred<GradingClientResponse>()
    const run = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const scheduler = createTaskGradingScheduler({ mode: 'adaptive-v1', hardLimit: 1, stableSuccessWindow: 2 })
    scheduler.startTask('task-auth-repeat', [job('task-auth-repeat', 'essay-1', 'stable-request', run)])
    await flushMicrotasks()
    first.resolve(failure('stable-request', 'provider_auth_failed', false))
    await flushMicrotasks()

    scheduler.resumeTask('task-auth-repeat')
    await flushMicrotasks()
    expect(run).toHaveBeenCalledTimes(2)
    second.resolve(failure('stable-request', 'provider_auth_failed', false))
    await flushMicrotasks()

    expect(scheduler.getSnapshot('task-auth-repeat')).toMatchObject({
      status: 'paused',
      pauseReason: 'auth',
      items: { 'essay-1': { phase: 'final_failure', requestId: 'stable-request' } },
    })
    await flushMicrotasks()
    expect(run).toHaveBeenCalledTimes(2)
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
