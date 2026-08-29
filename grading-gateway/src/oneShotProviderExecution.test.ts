import { describe, expect, it } from 'vitest'
import { GradingProviderError } from './providers/providerTypes.js'
import { ProviderAdmissionController } from './providerAdmissionController.js'
import { OneShotProviderExecutionTracker, type OneShotTimers } from './oneShotProviderExecution.js'

class ManualClock implements OneShotTimers {
  now = 0
  #nextId = 0
  #timers = new Map<number, { at: number; callback: () => void }>()
  setTimeout(callback: () => void, delayMs: number) {
    const id = ++this.#nextId
    this.#timers.set(id, { at: this.now + delayMs, callback })
    return id
  }
  clearTimeout(handle: unknown) { this.#timers.delete(handle as number) }
  advanceBy(milliseconds: number) {
    const target = this.now + milliseconds
    while (true) {
      const next = [...this.#timers.entries()].filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0]
      if (!next) break
      this.#timers.delete(next[0])
      this.now = next[1].at
      next[1].callback()
    }
    this.now = target
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function admission(clock: ManualClock, hardLimit = 1) {
  let id = 0
  return new ProviderAdmissionController({
    hardLimit, stableSuccessWindow: 100, now: () => clock.now, idFactory: () => `one-shot-${++id}`,
  })
}

function tracker(clock: ManualClock, controller = admission(clock)) {
  return new OneShotProviderExecutionTracker({
    admission: controller,
    providerFinalDeadlineMs: 100,
    settlementGraceMs: 20,
    retryAfterPauseMs: 1_000,
    now: () => clock.now,
    timers: clock,
  })
}

describe('OneShotProviderExecutionTracker', () => {
  it('releases a successful one-shot lease and returns exactly one caller result', async () => {
    const clock = new ManualClock()
    const controller = admission(clock)
    const executions = tracker(clock, controller)
    let calls = 0
    const result = await executions.run({
      receivedAt: 0, httpDeadlineMs: 200,
      execute: async ({ signal }) => { calls += 1; expect(signal.aborted).toBe(false); return 'rubric' },
    })
    expect(result).toEqual({ kind: 'success', value: 'rubric' })
    expect(calls).toBe(1)
    expect(controller.snapshot().activeLeases).toBe(0)
    expect(executions.snapshot()).toEqual({ inFlight: 0, orphanedUnknown: 0 })
  })

  it('starts caller timing at route receipt and keeps tracking after HTTP timeout without aborting or releasing', async () => {
    const clock = new ManualClock()
    const controller = admission(clock)
    const executions = tracker(clock, controller)
    const provider = deferred<string>()
    let providerSignal: AbortSignal | undefined
    clock.advanceBy(50)
    const caller = executions.run({
      receivedAt: 0, httpDeadlineMs: 60,
      execute: ({ signal }) => { providerSignal = signal; return provider.promise },
    })
    clock.advanceBy(10)
    expect(await caller).toEqual({ kind: 'result_unknown' })
    expect(providerSignal?.aborted).toBe(false)
    expect(controller.snapshot().activeLeases).toBe(1)
    expect(executions.snapshot()).toEqual({ inFlight: 1, orphanedUnknown: 0 })

    provider.resolve('late rubric')
    await flush()
    expect(controller.snapshot().activeLeases).toBe(0)
    expect(executions.snapshot()).toEqual({ inFlight: 0, orphanedUnknown: 0 })
  })

  it('does not extend the absolute caller deadline around synchronous dispatch setup', async () => {
    const clock = new ManualClock()
    const controller = admission(clock)
    const executions = tracker(clock, controller)
    const provider = deferred<string>()
    const caller = executions.run({
      receivedAt: 0,
      httpDeadlineMs: 10,
      execute: () => {
        clock.advanceBy(10)
        return provider.promise
      },
    })
    expect(await caller).toEqual({ kind: 'result_unknown' })
    expect(controller.snapshot().activeLeases).toBe(1)
    provider.resolve('late')
    await flush()
    expect(controller.snapshot().activeLeases).toBe(0)
  })

  it('starts Provider-final timing only after dispatch, aborts, waits grace, and retains unresolved orphan lease', async () => {
    const clock = new ManualClock()
    const controller = admission(clock)
    const executions = tracker(clock, controller)
    const provider = deferred<string>()
    let signal: AbortSignal | undefined
    clock.advanceBy(50)
    const caller = executions.run({
      receivedAt: 0, httpDeadlineMs: 500,
      execute: (context) => { signal = context.signal; return provider.promise },
    })
    clock.advanceBy(99)
    expect(signal?.aborted).toBe(false)
    clock.advanceBy(1)
    expect(signal?.aborted).toBe(true)
    expect(executions.snapshot()).toEqual({ inFlight: 1, orphanedUnknown: 0 })
    clock.advanceBy(19)
    expect(executions.snapshot()).toEqual({ inFlight: 1, orphanedUnknown: 0 })
    clock.advanceBy(1)
    expect(await caller).toEqual({ kind: 'result_unknown' })
    expect(executions.snapshot()).toEqual({ inFlight: 0, orphanedUnknown: 1 })
    expect(controller.snapshot().activeLeases).toBe(1)

    provider.resolve('late')
    await flush()
    expect(controller.snapshot().activeLeases).toBe(0)
    expect(executions.snapshot()).toEqual({ inFlight: 0, orphanedUnknown: 0 })
  })

  it('retains a lease forever for termination-unknown rejection and never creates a hidden retry', async () => {
    const clock = new ManualClock()
    const controller = admission(clock)
    const executions = tracker(clock, controller)
    let calls = 0
    const outcome = await executions.run({
      receivedAt: 0, httpDeadlineMs: 200,
      execute: async () => { calls += 1; throw new GradingProviderError('provider_unavailable', 'SAFE', true, undefined, { termination: 'unknown' }) },
    })
    expect(outcome).toEqual({ kind: 'result_unknown' })
    expect(executions.snapshot()).toEqual({ inFlight: 0, orphanedUnknown: 1 })
    clock.advanceBy(1_000_000)
    expect(controller.snapshot().activeLeases).toBe(1)
    expect(calls).toBe(1)
  })

  it.each([
    ['provider_auth_failed', 'provider_auth_failed'],
    ['provider_balance_unavailable', 'provider_balance_unavailable'],
    ['provider_not_configured', 'provider_not_configured'],
  ] as const)('releases confirmed %s and pauses global admission', async (code, reason) => {
    const clock = new ManualClock()
    const controller = admission(clock)
    const executions = tracker(clock, controller)
    const error = new GradingProviderError(code, 'SAFE', false, undefined, { termination: 'confirmed' })
    const outcome = await executions.run({ receivedAt: 0, httpDeadlineMs: 200, execute: async () => { throw error } })
    expect(outcome).toEqual({ kind: 'failure', error })
    expect(controller.snapshot()).toMatchObject({ activeLeases: 0, pauseReason: reason })
  })

  it('pauses on the internal access-denied signal but not on ordinary request rejection', async () => {
    const clock = new ManualClock()
    const controller = admission(clock)
    const executions = tracker(clock, controller)
    const accessDenied = new GradingProviderError(
      'provider_request_rejected', 'SAFE', false, undefined,
      { termination: 'confirmed', pauseAdmission: true },
    )
    expect(await executions.run({ receivedAt: 0, httpDeadlineMs: 200, execute: async () => { throw accessDenied } }))
      .toEqual({ kind: 'failure', error: accessDenied })
    expect(controller.snapshot()).toMatchObject({ activeLeases: 0, pauseReason: 'provider_access_denied' })
    expect(await executions.run({ receivedAt: 0, httpDeadlineMs: 200, execute: async () => 'must-not-run' }))
      .toMatchObject({ kind: 'admission_rejected', decision: { reason: 'paused' } })

    const separateController = admission(clock)
    const separateExecutions = tracker(clock, separateController)
    const requestRejected = new GradingProviderError(
      'provider_request_rejected', 'SAFE', false, undefined, { termination: 'confirmed' },
    )
    expect(await separateExecutions.run({ receivedAt: 0, httpDeadlineMs: 200, execute: async () => { throw requestRejected } }))
      .toEqual({ kind: 'failure', error: requestRejected })
    expect(separateController.snapshot().pauseReason).toBeNull()
  })

  it('uses Provider Retry-After as the exact one-shot global gate and pauses long delays explicitly', async () => {
    const clock = new ManualClock()
    const controller = admission(clock)
    const executions = tracker(clock, controller)
    const short = new GradingProviderError('provider_rate_limited', 'SAFE', true, undefined, {
      termination: 'confirmed', retryAfterMs: 400,
    })
    expect(await executions.run({ receivedAt: 0, httpDeadlineMs: 200, execute: async () => { throw short } }))
      .toEqual({ kind: 'failure', error: short })
    expect(controller.snapshot()).toMatchObject({ activeLeases: 0, rateLimitNotBeforeMs: 400 })
    expect(controller.tryAcquire()).toEqual({ accepted: false, reason: 'paused', retryAfterMs: 400 })

    clock.advanceBy(400)
    const long = new GradingProviderError('provider_rate_limited', 'SAFE', true, undefined, {
      termination: 'confirmed', retryAfterMs: 1_001,
    })
    expect(await executions.run({ receivedAt: 400, httpDeadlineMs: 200, execute: async () => { throw long } }))
      .toEqual({ kind: 'failure', error: long })
    expect(controller.snapshot()).toMatchObject({ activeLeases: 0, pauseReason: 'long_retry_after' })
  })

  it('never labels work result-unknown when the caller deadline expired before dispatch', async () => {
    const clock = new ManualClock()
    const executions = tracker(clock)
    clock.advanceBy(10)
    let calls = 0
    const outcome = await executions.run({
      receivedAt: 0, httpDeadlineMs: 10,
      execute: async () => { calls += 1; return 'must not run' },
    })
    expect(outcome).toEqual({ kind: 'caller_timeout_before_dispatch' })
    expect(calls).toBe(0)
  })

  it('shares the same hard admission controller across unrelated one-shot routes', async () => {
    const clock = new ManualClock()
    const controller = admission(clock)
    const executions = tracker(clock, controller)
    const first = deferred<string>()
    const firstCaller = executions.run({ receivedAt: 0, httpDeadlineMs: 200, execute: () => first.promise })
    const blocked = await executions.run({ receivedAt: 0, httpDeadlineMs: 200, execute: async () => 'second' })
    expect(blocked).toMatchObject({ kind: 'admission_rejected', decision: { reason: 'hard_limit' } })
    first.resolve('first')
    await firstCaller
  })
})
