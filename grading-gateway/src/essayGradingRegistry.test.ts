import { describe, expect, it } from 'vitest'
import type { AiGradingResultV1 } from './types.js'
import { GradingProviderError, type ProviderAttemptObservation } from './providers/providerTypes.js'
import { ProviderAdmissionController } from './providerAdmissionController.js'
import {
  EssayGradingRegistry,
  type EssayGradingRegistryOptions,
  type RegistryAttachInput,
  type RegistryExecutionResult,
  type RegistryTimers,
} from './essayGradingRegistry.js'

class ManualClock implements RegistryTimers {
  now = 0
  #nextId = 0
  #timers = new Map<number, { at: number; callback: () => void }>()

  setTimeout(callback: () => void, delayMs: number): number {
    const id = ++this.#nextId
    this.#timers.set(id, { at: this.now + delayMs, callback })
    return id
  }

  clearTimeout(handle: unknown): void {
    this.#timers.delete(handle as number)
  }

  advanceBy(milliseconds: number): void {
    const target = this.now + milliseconds
    while (true) {
      const next = [...this.#timers.entries()]
        .filter(([, timer]) => timer.at <= target)
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

function resultTemplate(label = 'A'): Omit<AiGradingResultV1, 'requestId'> {
  return {
    resultVersion: 'grading-result-v2', essayId: `essay-${label}`, provider: 'remote', status: 'success',
    totalScore: 10, maxScore: 10,
    dimensionScores: [{ dimensionId: 'content', name: 'Content', score: 10, maxScore: 10, weight: 100, reason: 'Complete.', evidence: 'Text.' }],
    issues: [], sentenceRevisions: [], expressionUpgrades: [],
    fullTextRevision: { originalText: 'Text.', correctedText: 'Text.', improvedText: 'Text.', sentencePairs: [], logicNotes: [], logicIssues: [] },
    legibilityIssues: [], recognitionWarnings: [], overallComment: `Result ${label}.`, reviewReasons: [],
    createdAt: '2026-08-28T00:00:00.000Z',
  }
}

function success(label = 'A', attempts: readonly ProviderAttemptObservation[] = []): RegistryExecutionResult {
  return { result: resultTemplate(label), attempts }
}

function confirmedError(
  code: ConstructorParameters<typeof GradingProviderError>[0] = 'provider_unavailable',
  retryable = true,
  retryAfterMs?: number,
) {
  return new GradingProviderError(code, 'SAFE EXECUTOR MESSAGE', retryable, undefined, {
    termination: 'confirmed',
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  })
}

function unknownError() {
  return new GradingProviderError('provider_unavailable', 'SAFE UNKNOWN', true, undefined, { termination: 'unknown' })
}

function controller(clock: ManualClock, hardLimit = 2) {
  let lease = 0
  return new ProviderAdmissionController({
    hardLimit, stableSuccessWindow: 100, now: () => clock.now, idFactory: () => `registry-lease-${++lease}`,
  })
}

function registryOptions(
  clock: ManualClock,
  overrides: Partial<EssayGradingRegistryOptions> = {},
): EssayGradingRegistryOptions {
  return {
    admission: controller(clock),
    providerFinalDeadlineMs: 100,
    settlementGraceMs: 20,
    terminalTtlMs: 1_000,
    maxEntries: 4,
    maxProviderAttempts: 2,
    maxRateLimitRequeues: 5,
    retryBaseMs: 10,
    retryCapMs: 100,
    retryAfterPauseMs: 1_000,
    now: () => clock.now,
    random: () => 0.5,
    timers: clock,
    ...overrides,
  }
}

function attachInput(
  execute: RegistryAttachInput['execute'],
  overrides: Partial<RegistryAttachInput> = {},
): RegistryAttachInput {
  return {
    logicalRequestId: 'logical-grade-v1:opaque-a',
    payloadHash: 'payload-opaque-a',
    callerRequestId: 'caller-a',
    execute,
    ...overrides,
  }
}

describe('EssayGradingRegistry idempotency and cache', () => {
  it('executes concurrent identical content once, rebinds caller IDs, and returns isolated clones', async () => {
    const clock = new ManualClock()
    const registry = new EssayGradingRegistry(registryOptions(clock))
    const completion = deferred<RegistryExecutionResult>()
    let calls = 0
    const execute: RegistryAttachInput['execute'] = () => { calls += 1; return completion.promise }

    const firstPromise = registry.attach(attachInput(execute, { callerRequestId: 'caller-one' }))
    const secondPromise = registry.attach(attachInput(execute, { callerRequestId: 'caller-two' }))
    expect(calls).toBe(1)
    completion.resolve(success())
    const [first, second] = await Promise.all([firstPromise, secondPromise])

    expect(first).toMatchObject({ disposition: 'executed', state: 'succeeded', response: { requestId: 'caller-one', status: 'success' } })
    expect(second).toMatchObject({ disposition: 'attached', state: 'succeeded', response: { requestId: 'caller-two', status: 'success' } })
    ;(first.response as AiGradingResultV1).overallComment = 'CALLER-LOCAL-MUTATION'
    expect((second.response as AiGradingResultV1).overallComment).toBe('Result A.')

    const cached = await registry.attach(attachInput(execute, { callerRequestId: 'caller-three' }))
    expect(cached).toMatchObject({ disposition: 'cached', response: { requestId: 'caller-three', overallComment: 'Result A.' } })
    expect(calls).toBe(1)
  })

  it('returns a content-free conflict for one logical ID with a different complete payload', async () => {
    const clock = new ManualClock()
    const registry = new EssayGradingRegistry(registryOptions(clock))
    const completion = deferred<RegistryExecutionResult>()
    let calls = 0
    const execute: RegistryAttachInput['execute'] = () => { calls += 1; return completion.promise }
    const original = registry.attach(attachInput(execute))

    const conflict = await registry.attach(attachInput(execute, {
      payloadHash: 'PRIVATE-DIFFERENT-PAYLOAD-HASH', callerRequestId: 'caller-conflict',
    }))
    expect(conflict).toMatchObject({
      disposition: 'identity_conflict', state: 'in_flight',
      response: { requestId: 'caller-conflict', status: 'failed', error: { code: 'invalid_request', retryable: false } },
    })
    expect(JSON.stringify(conflict)).not.toContain('PRIVATE-DIFFERENT-PAYLOAD-HASH')
    expect(calls).toBe(1)
    completion.resolve(success())
    await original
  })

  it('evicts only expired terminal entries and rejects capacity when no safe victim exists', async () => {
    const clock = new ManualClock()
    const registry = new EssayGradingRegistry(registryOptions(clock, { maxEntries: 1, terminalTtlMs: 500 }))
    let calls = 0
    const execute: RegistryAttachInput['execute'] = async () => { calls += 1; return success(String(calls)) }
    await registry.attach(attachInput(execute))

    const blocked = await registry.attach(attachInput(execute, {
      logicalRequestId: 'logical-grade-v1:opaque-b', payloadHash: 'payload-b', callerRequestId: 'caller-b',
    }))
    expect(blocked).toMatchObject({ disposition: 'capacity_rejected', state: null, response: { error: { code: 'provider_rate_limited' } } })
    expect(calls).toBe(1)

    clock.advanceBy(500)
    const accepted = await registry.attach(attachInput(execute, {
      logicalRequestId: 'logical-grade-v1:opaque-b', payloadHash: 'payload-b', callerRequestId: 'caller-b',
    }))
    expect(accepted).toMatchObject({ disposition: 'executed', state: 'succeeded', response: { requestId: 'caller-b' } })
    expect(calls).toBe(2)
  })

  it('does not create an entry when global target admission is busy', async () => {
    const clock = new ManualClock()
    const admission = controller(clock, 2)
    const registry = new EssayGradingRegistry(registryOptions(clock, { admission }))
    const firstCompletion = deferred<RegistryExecutionResult>()
    let calls = 0
    const execute: RegistryAttachInput['execute'] = () => { calls += 1; return firstCompletion.promise }
    const first = registry.attach(attachInput(execute))

    const blocked = await registry.attach(attachInput(execute, {
      logicalRequestId: 'logical-grade-v1:opaque-b', payloadHash: 'payload-b', callerRequestId: 'caller-b',
    }))
    expect(blocked).toMatchObject({ disposition: 'admission_rejected', state: null, response: { error: { code: 'provider_rate_limited' } } })
    expect(registry.snapshot()).toMatchObject({ entries: 1, states: { in_flight: 1 } })
    expect(calls).toBe(1)
    firstCompletion.resolve(success())
    await first
  })

  it('never evicts a retryable nonterminal entry merely because terminal TTL elapsed', async () => {
    const clock = new ManualClock()
    const registry = new EssayGradingRegistry(registryOptions(clock, { maxEntries: 1, terminalTtlMs: 500 }))
    await registry.attach(attachInput(async () => { throw confirmedError() }))
    expect(registry.inspect('logical-grade-v1:opaque-a')?.state).toBe('failed_retryable')
    clock.advanceBy(10_000)

    const blocked = await registry.attach(attachInput(async () => success(), {
      logicalRequestId: 'logical-grade-v1:new', payloadHash: 'new-payload', callerRequestId: 'new-caller',
    }))
    expect(blocked.disposition).toBe('capacity_rejected')
    expect(registry.inspect('logical-grade-v1:opaque-a')?.state).toBe('failed_retryable')
  })
})

describe('EssayGradingRegistry deadlines and orphan lifecycle', () => {
  it('starts the Provider deadline after dispatch, aborts, waits grace, retains the orphan lease, and accepts late success', async () => {
    const clock = new ManualClock()
    const admission = controller(clock, 1)
    const registry = new EssayGradingRegistry(registryOptions(clock, { admission }))
    const completion = deferred<RegistryExecutionResult>()
    let providerSignal: AbortSignal | undefined
    const pending = registry.attach(attachInput(({ signal }) => { providerSignal = signal; return completion.promise }))
    expect(providerSignal?.aborted).toBe(false)
    expect(admission.snapshot().activeLeases).toBe(1)

    clock.advanceBy(99)
    expect(registry.inspect('logical-grade-v1:opaque-a')?.state).toBe('in_flight')
    clock.advanceBy(1)
    expect(providerSignal?.aborted).toBe(true)
    expect(registry.inspect('logical-grade-v1:opaque-a')?.state).toBe('in_flight')
    clock.advanceBy(19)
    expect(registry.inspect('logical-grade-v1:opaque-a')?.state).toBe('in_flight')
    clock.advanceBy(1)

    const unknown = await pending
    expect(unknown).toMatchObject({
      disposition: 'executed', state: 'orphaned_unknown',
      response: { status: 'failed', error: { code: 'provider_result_unknown', retryable: false } },
    })
    expect(admission.snapshot().activeLeases).toBe(1)

    completion.resolve(success('late'))
    await flushMicrotasks()
    expect(registry.inspect('logical-grade-v1:opaque-a')?.state).toBe('succeeded')
    expect(admission.snapshot().activeLeases).toBe(0)
    const cached = await registry.attach(attachInput(() => { throw new Error('must not run') }, { callerRequestId: 'caller-late' }))
    expect(cached).toMatchObject({ disposition: 'cached', response: { requestId: 'caller-late', overallComment: 'Result late.' } })
  })

  it('turns a late confirmed failure into terminal cached failure and releases exactly once', async () => {
    const clock = new ManualClock()
    const admission = controller(clock, 1)
    const registry = new EssayGradingRegistry(registryOptions(clock, { admission }))
    const completion = deferred<RegistryExecutionResult>()
    const pending = registry.attach(attachInput(() => completion.promise))
    clock.advanceBy(120)
    await pending
    expect(admission.snapshot().activeLeases).toBe(1)

    completion.reject(confirmedError('provider_content_filtered', false))
    await flushMicrotasks()
    expect(registry.inspect('logical-grade-v1:opaque-a')?.state).toBe('failed_final')
    expect(admission.snapshot().activeLeases).toBe(0)
    const cached = await registry.attach(attachInput(() => Promise.resolve(success()), { callerRequestId: 'caller-after' }))
    expect(cached).toMatchObject({
      disposition: 'cached', response: { requestId: 'caller-after', error: { code: 'provider_content_filtered', retryable: false } },
    })
  })

  it('preserves a truthful late 429 gate and header delay after the entry became orphaned', async () => {
    const clock = new ManualClock()
    const admission = controller(clock, 1)
    const registry = new EssayGradingRegistry(registryOptions(clock, { admission }))
    const completion = deferred<RegistryExecutionResult>()
    const pending = registry.attach(attachInput(() => completion.promise))
    clock.advanceBy(120)
    await expect(pending).resolves.toMatchObject({ state: 'orphaned_unknown' })

    completion.reject(confirmedError('provider_rate_limited', true, 400))
    await flushMicrotasks()
    expect(registry.inspect('logical-grade-v1:opaque-a')).toMatchObject({
      state: 'failed_final', retryAt: 520, hasActiveLease: false,
    })
    expect(admission.snapshot()).toMatchObject({ activeLeases: 0, rateLimitNotBeforeMs: 520 })
    expect(await registry.attach(attachInput(() => { throw new Error('must not run') }, {
      callerRequestId: 'caller-after-late-429',
    }))).toMatchObject({
      disposition: 'cached', retryAfterMs: 400,
      response: { requestId: 'caller-after-late-429', error: { code: 'provider_rate_limited', retryable: false } },
    })
  })

  it('immediately orphans termination-unknown rejection, increments neither retry counter, and never releases or retries', async () => {
    const clock = new ManualClock()
    const admission = controller(clock, 1)
    const registry = new EssayGradingRegistry(registryOptions(clock, { admission }))
    let calls = 0
    const execute: RegistryAttachInput['execute'] = async () => { calls += 1; throw unknownError() }

    const first = await registry.attach(attachInput(execute))
    expect(first).toMatchObject({ state: 'orphaned_unknown', response: { error: { code: 'provider_result_unknown' } } })
    expect(registry.inspect('logical-grade-v1:opaque-a')).toMatchObject({
      state: 'orphaned_unknown', nonRateLimitedProviderAttempts: 0, rateLimitRequeues: 0, hasActiveLease: true,
    })
    clock.advanceBy(1_000_000)
    const reattached = await registry.attach(attachInput(execute, { callerRequestId: 'caller-reattach' }))
    expect(reattached).toMatchObject({ disposition: 'cached', state: 'orphaned_unknown', response: { requestId: 'caller-reattach' } })
    expect(admission.snapshot().activeLeases).toBe(1)
    expect(calls).toBe(1)

    const other = await registry.attach(attachInput(execute, {
      logicalRequestId: 'logical-grade-v1:other', payloadHash: 'other-payload', callerRequestId: 'other-caller',
    }))
    expect(other).toMatchObject({ disposition: 'admission_rejected', response: { error: { code: 'provider_rate_limited' } } })
  })

  it('does not let an unrelated caller abort signal cancel shared Provider work', async () => {
    const clock = new ManualClock()
    const registry = new EssayGradingRegistry(registryOptions(clock))
    const completion = deferred<RegistryExecutionResult>()
    const caller = new AbortController()
    let providerSignal: AbortSignal | undefined
    const input = {
      ...attachInput(({ signal }) => { providerSignal = signal; return completion.promise }),
      callerSignal: caller.signal,
    } as RegistryAttachInput
    const pending = registry.attach(input)
    caller.abort()
    expect(providerSignal?.aborted).toBe(false)
    completion.resolve(success())
    await expect(pending).resolves.toMatchObject({ state: 'succeeded' })
  })

  it('keeps in-flight and orphan entries through TTL and capacity pressure', async () => {
    const clock = new ManualClock()
    const admission = controller(clock, 1)
    const registry = new EssayGradingRegistry(registryOptions(clock, { admission, maxEntries: 1, terminalTtlMs: 500 }))
    const completion = deferred<RegistryExecutionResult>()
    const pending = registry.attach(attachInput(() => completion.promise))
    clock.advanceBy(10_000)
    await pending
    expect(registry.inspect('logical-grade-v1:opaque-a')?.state).toBe('orphaned_unknown')

    const blocked = await registry.attach(attachInput(async () => success(), {
      logicalRequestId: 'logical-grade-v1:new', payloadHash: 'new-payload', callerRequestId: 'new-caller',
    }))
    expect(blocked.disposition).toBe('capacity_rejected')
    expect(registry.inspect('logical-grade-v1:opaque-a')?.state).toBe('orphaned_unknown')
    expect(admission.snapshot().activeLeases).toBe(1)
  })
})

describe('EssayGradingRegistry bounded retry state machine', () => {
  it('allows one attach-driven confirmed transient retry with full jitter and atomically shares it', async () => {
    const clock = new ManualClock()
    const registry = new EssayGradingRegistry(registryOptions(clock))
    const secondCompletion = deferred<RegistryExecutionResult>()
    let calls = 0
    const execute: RegistryAttachInput['execute'] = () => {
      calls += 1
      return calls === 1 ? Promise.reject(confirmedError()) : secondCompletion.promise
    }

    const first = await registry.attach(attachInput(execute))
    expect(first).toMatchObject({
      state: 'failed_retryable', retryAfterMs: 5,
      response: { error: { code: 'provider_unavailable', retryable: true } },
    })
    expect(registry.inspect('logical-grade-v1:opaque-a')).toMatchObject({
      nonRateLimitedProviderAttempts: 1, rateLimitRequeues: 0, retryAt: 5,
    })
    const waiting = await registry.attach(attachInput(execute, { callerRequestId: 'caller-waiting' }))
    expect(waiting).toMatchObject({ disposition: 'retry_wait', retryAfterMs: 5, response: { requestId: 'caller-waiting' } })
    expect(calls).toBe(1)

    clock.advanceBy(5)
    const retry = registry.attach(attachInput(execute, { callerRequestId: 'caller-retry' }))
    const attached = registry.attach(attachInput(execute, { callerRequestId: 'caller-attached' }))
    expect(calls).toBe(2)
    secondCompletion.resolve(success('retry'))
    const [retried, shared] = await Promise.all([retry, attached])
    expect(retried).toMatchObject({ disposition: 'executed', response: { requestId: 'caller-retry' } })
    expect(shared).toMatchObject({ disposition: 'attached', response: { requestId: 'caller-attached' } })
    expect(registry.inspect('logical-grade-v1:opaque-a')?.nonRateLimitedProviderAttempts).toBe(2)
  })

  it('allows at most two confirmed non-rate-limited Provider attempts', async () => {
    const clock = new ManualClock()
    const registry = new EssayGradingRegistry(registryOptions(clock))
    let calls = 0
    const execute: RegistryAttachInput['execute'] = async () => { calls += 1; throw confirmedError() }
    await registry.attach(attachInput(execute))
    clock.advanceBy(5)
    const exhausted = await registry.attach(attachInput(execute, { callerRequestId: 'caller-second' }))
    expect(exhausted).toMatchObject({ state: 'failed_final', response: { error: { code: 'provider_unavailable', retryable: false } } })
    expect(registry.inspect('logical-grade-v1:opaque-a')?.nonRateLimitedProviderAttempts).toBe(2)
    const cached = await registry.attach(attachInput(execute, { callerRequestId: 'caller-third' }))
    expect(cached).toMatchObject({ disposition: 'cached', state: 'failed_final', response: { requestId: 'caller-third' } })
    expect(calls).toBe(2)
  })

  it('uses the exact 429 retry formula, preserves Retry-After as a lower bound, and does not consume normal attempts', async () => {
    const clock = new ManualClock()
    const registry = new EssayGradingRegistry(registryOptions(clock))
    let calls = 0
    const execute: RegistryAttachInput['execute'] = async () => {
      calls += 1
      if (calls === 1) throw confirmedError('provider_rate_limited', true, 15)
      return success('after-429')
    }
    const first = await registry.attach(attachInput(execute))
    expect(first).toMatchObject({ state: 'failed_retryable', retryAfterMs: 15 })
    expect(registry.inspect('logical-grade-v1:opaque-a')).toMatchObject({
      nonRateLimitedProviderAttempts: 0, rateLimitRequeues: 1, retryAt: 15,
    })
    clock.advanceBy(14)
    expect(await registry.attach(attachInput(execute))).toMatchObject({ disposition: 'retry_wait', retryAfterMs: 1 })
    clock.advanceBy(1)
    expect(await registry.attach(attachInput(execute))).toMatchObject({ state: 'succeeded' })
    expect(calls).toBe(2)
  })

  it('permits five 429 requeues followed by one first non-429 success', async () => {
    const clock = new ManualClock()
    const registry = new EssayGradingRegistry(registryOptions(clock, { random: () => 0 }))
    let calls = 0
    const execute: RegistryAttachInput['execute'] = async () => {
      calls += 1
      if (calls <= 5) throw confirmedError('provider_rate_limited', true)
      return success('sixth-success')
    }
    let outcome = await registry.attach(attachInput(execute))
    while (outcome.state === 'failed_retryable') outcome = await registry.attach(attachInput(execute))
    expect(outcome).toMatchObject({ state: 'succeeded', response: { overallComment: 'Result sixth-success.' } })
    expect(calls).toBe(6)
    expect(registry.inspect('logical-grade-v1:opaque-a')).toMatchObject({
      rateLimitRequeues: 5, nonRateLimitedProviderAttempts: 1,
    })
  })

  it('turns a sixth consecutive 429 final and never schedules a seventh call', async () => {
    const clock = new ManualClock()
    const registry = new EssayGradingRegistry(registryOptions(clock, { random: () => 0 }))
    let calls = 0
    const execute: RegistryAttachInput['execute'] = async () => { calls += 1; throw confirmedError('provider_rate_limited', true) }
    let outcome = await registry.attach(attachInput(execute))
    while (outcome.state === 'failed_retryable') outcome = await registry.attach(attachInput(execute))
    expect(outcome).toMatchObject({ state: 'failed_final', response: { error: { code: 'provider_rate_limited', retryable: false } } })
    expect(outcome).not.toHaveProperty('retryAfterMs')
    expect(registry.inspect('logical-grade-v1:opaque-a')?.rateLimitRequeues).toBe(5)
    expect((await registry.attach(attachInput(execute))).disposition).toBe('cached')
    expect(calls).toBe(6)
  })

  it('never permits a seventh call when the exhausted sixth 429 also carries a long Retry-After', async () => {
    const clock = new ManualClock()
    const admission = controller(clock)
    const registry = new EssayGradingRegistry(registryOptions(clock, { admission, random: () => 0 }))
    let calls = 0
    const execute: RegistryAttachInput['execute'] = async () => {
      calls += 1
      throw confirmedError('provider_rate_limited', true, calls === 6 ? 1_001 : undefined)
    }
    let outcome = await registry.attach(attachInput(execute))
    for (let requeue = 0; requeue < 5; requeue += 1) {
      expect(outcome.state).toBe('failed_retryable')
      outcome = await registry.attach(attachInput(execute))
    }
    expect(outcome).toMatchObject({
      state: 'failed_final', retryAfterMs: 1_001,
      response: { error: { code: 'provider_rate_limited', retryable: false } },
    })
    expect(calls).toBe(6)
    expect(admission.snapshot().pauseReason).toBe('long_retry_after')
    admission.resume()
    expect(await registry.attach(attachInput(execute))).toMatchObject({
      disposition: 'cached', retryAfterMs: 1_001,
    })
    expect(calls).toBe(6)
  })

  it('pauses rather than scheduling a long Retry-After and resumes only explicitly', async () => {
    const clock = new ManualClock()
    const admission = controller(clock)
    const registry = new EssayGradingRegistry(registryOptions(clock, { admission }))
    let calls = 0
    const execute: RegistryAttachInput['execute'] = async () => {
      calls += 1
      if (calls === 1) throw confirmedError('provider_rate_limited', true, 1_001)
      return success('resumed')
    }
    const first = await registry.attach(attachInput(execute))
    expect(first).toMatchObject({ state: 'failed_retryable', response: { error: { code: 'provider_rate_limited' } } })
    expect(first).not.toHaveProperty('retryAfterMs')
    expect(admission.snapshot().pauseReason).toBe('long_retry_after')
    expect((await registry.attach(attachInput(execute))).disposition).toBe('admission_rejected')
    expect(calls).toBe(1)
    admission.resume()
    expect(await registry.attach(attachInput(execute))).toMatchObject({ state: 'succeeded' })
    expect(calls).toBe(2)
  })

  it.each([
    ['provider_auth_failed', 'provider_auth_failed'],
    ['provider_balance_unavailable', 'provider_balance_unavailable'],
    ['provider_not_configured', 'provider_not_configured'],
  ] as const)('pauses globally on confirmed %s and never retries that final entry', async (code, pauseReason) => {
    const clock = new ManualClock()
    const admission = controller(clock)
    const registry = new EssayGradingRegistry(registryOptions(clock, { admission }))
    let calls = 0
    const execute: RegistryAttachInput['execute'] = async () => { calls += 1; throw confirmedError(code, false) }
    const failed = await registry.attach(attachInput(execute))
    expect(failed).toMatchObject({ state: 'failed_final', response: { error: { code, retryable: false } } })
    expect(admission.snapshot().pauseReason).toBe(pauseReason)
    expect((await registry.attach(attachInput(execute, { callerRequestId: 'same-entry' }))).disposition).toBe('cached')

    const blocked = await registry.attach(attachInput(async () => success(), {
      logicalRequestId: 'logical-grade-v1:new', payloadHash: 'new-payload', callerRequestId: 'new-caller',
    }))
    expect(blocked).toMatchObject({ disposition: 'admission_rejected', response: { error: { code } } })
    admission.resume()
    expect(await registry.attach(attachInput(async () => success('new'), {
      logicalRequestId: 'logical-grade-v1:new', payloadHash: 'new-payload', callerRequestId: 'new-caller',
    }))).toMatchObject({ state: 'succeeded' })
    expect(calls).toBe(1)
  })
})

describe('EssayGradingRegistry telemetry and validation', () => {
  it('records one safe metric per unique actual Provider attempt and none for attachments', async () => {
    const clock = new ManualClock()
    const metrics: unknown[] = []
    const registry = new EssayGradingRegistry(registryOptions(clock, { onMetric: (metric) => metrics.push(metric) }))
    const observation: ProviderAttemptObservation = {
      attemptDiagnosticId: '00000000-0000-4000-8000-000000000001', finishReason: 'stop', providerElapsedMs: 12,
      usage: {
        promptTokens: { status: 'known', value: 10 }, completionTokens: { status: 'known', value: 5 },
        totalTokens: { status: 'known', value: 15 }, cachedTokens: { status: 'known', value: 2 },
      },
    }
    const input = attachInput(async () => success('metric', [observation, observation]), {
      metricContext: { stage: 'essay_grading_images', model: 'kimi-k3', reasoningEffort: 'low' },
    })
    await registry.attach(input)
    await registry.attach({ ...input, callerRequestId: 'caller-cached' })
    expect(metrics).toHaveLength(1)
    expect(metrics[0]).toMatchObject({ event: 'provider_attempt', attemptDiagnosticId: observation.attemptDiagnosticId, attempt: 1, outcome: 'success' })
    expect(JSON.stringify(metrics)).not.toMatch(/logical-grade|payload|caller|essay-/)
  })

  it('numbers a legal second actual attempt separately while deduplicating completed observations', async () => {
    const clock = new ManualClock()
    const metrics: Array<{ event?: string; attempt?: number; outcome?: string }> = []
    const registry = new EssayGradingRegistry(registryOptions(clock, { onMetric: (metric) => metrics.push(metric) }))
    const makeObservation = (suffix: string): ProviderAttemptObservation => ({
      attemptDiagnosticId: `00000000-0000-4000-8000-00000000000${suffix}`,
      finishReason: 'stop', providerElapsedMs: 10,
      usage: {
        promptTokens: { status: 'known', value: 10 }, completionTokens: { status: 'known', value: 5 },
        totalTokens: { status: 'known', value: 15 }, cachedTokens: { status: 'known', value: 0 },
      },
    })
    const firstObservation = makeObservation('1')
    const secondObservation = makeObservation('2')
    let calls = 0
    const execute: RegistryAttachInput['execute'] = async () => {
      calls += 1
      if (calls === 1) throw new GradingProviderError('provider_unavailable', 'SAFE', true, undefined, {
        termination: 'confirmed', attemptObservations: [firstObservation, firstObservation],
      })
      return success('second-metric', [secondObservation])
    }
    const input = attachInput(execute, {
      metricContext: { stage: 'essay_grading_images', model: 'kimi-k3', reasoningEffort: 'low' },
    })

    await registry.attach(input)
    clock.advanceBy(5)
    await registry.attach({ ...input, callerRequestId: 'caller-retry' })
    expect(metrics).toMatchObject([
      { event: 'provider_attempt', attempt: 1, outcome: 'failed' },
      { event: 'provider_attempt', attempt: 2, outcome: 'success' },
    ])
  })

  it('discards any executor-supplied caller request ID before caching or responding', async () => {
    const clock = new ManualClock()
    const registry = new EssayGradingRegistry(registryOptions(clock))
    const unsafe = { ...resultTemplate(), requestId: 'PRIVATE-EXECUTOR-CALLER' } as Omit<AiGradingResultV1, 'requestId'>
    const response = await registry.attach(attachInput(async () => ({ result: unsafe, attempts: [] }), {
      callerRequestId: 'trusted-caller',
    }))
    expect(response.response.requestId).toBe('trusted-caller')
    expect(JSON.stringify(response)).not.toContain('PRIVATE-EXECUTOR-CALLER')
  })

  it.each([
    (clock: ManualClock) => ({ ...registryOptions(clock), providerFinalDeadlineMs: 0 }),
    (clock: ManualClock) => ({ ...registryOptions(clock), terminalTtlMs: 120 }),
    (clock: ManualClock) => ({ ...registryOptions(clock), maxEntries: 0 }),
    (clock: ManualClock) => ({ ...registryOptions(clock), random: () => Number.NaN }),
  ])('fails closed on invalid configuration or runtime randomness', async (makeOptions) => {
    const clock = new ManualClock()
    const options = makeOptions(clock)
    if (Number.isNaN(options.random?.())) {
      const registry = new EssayGradingRegistry(options)
      const execute: RegistryAttachInput['execute'] = async () => { throw confirmedError() }
      await expect(registry.attach(attachInput(execute))).rejects.toThrow(/invalid essay grading registry configuration/i)
    } else {
      expect(() => new EssayGradingRegistry(options)).toThrow(/invalid essay grading registry configuration/i)
    }
  })
})
