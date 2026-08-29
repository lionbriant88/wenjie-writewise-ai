import { describe, expect, it } from 'vitest'
import {
  ProviderAdmissionController,
  type AdmissionDecision,
  type AdmissionLease,
  type AdmissionPauseReason,
} from './providerAdmissionController.js'

function accepted(decision: AdmissionDecision): AdmissionLease {
  expect(decision).toMatchObject({ accepted: true, queueWaitMs: 0 })
  if (!decision.accepted) throw new Error('Expected admission')
  return decision.lease
}

function createController(options: {
  hardLimit?: number
  stableSuccessWindow?: number
  now?: () => number
} = {}) {
  let nextId = 0
  return new ProviderAdmissionController({
    hardLimit: options.hardLimit ?? 4,
    stableSuccessWindow: options.stableSuccessWindow ?? 3,
    now: options.now,
    idFactory: () => `lease-${++nextId}`,
  })
}

function growTarget(controller: ProviderAdmissionController, target: number, window = 3) {
  while (controller.snapshot().target < target) {
    for (let index = 0; index < window; index += 1) {
      accepted(controller.tryAcquire()).release({ kind: 'success' })
    }
  }
}

describe('ProviderAdmissionController', () => {
  it('starts at one, additively increases by one stable window, and never exceeds the hard limit', () => {
    const controller = createController({ hardLimit: 3, stableSuccessWindow: 2 })
    expect(controller.snapshot()).toMatchObject({ hardLimit: 3, target: 1, activeLeases: 0, stableSuccesses: 0 })

    const first = accepted(controller.tryAcquire())
    expect(controller.tryAcquire()).toEqual({ accepted: false, reason: 'target_busy', retryAfterMs: 1_000 })
    first.release({ kind: 'success' })
    expect(controller.snapshot().target).toBe(1)
    accepted(controller.tryAcquire()).release({ kind: 'success' })
    expect(controller.snapshot().target).toBe(2)

    for (let index = 0; index < 20; index += 1) {
      accepted(controller.tryAcquire()).release({ kind: 'success' })
    }
    expect(controller.snapshot().target).toBe(3)
  })

  it('halves the target on a confirmed 429 and gates every caller until the exact supplied absolute time', () => {
    let now = 1_000
    const controller = createController({ hardLimit: 4, stableSuccessWindow: 1, now: () => now })
    growTarget(controller, 4, 1)
    const first = accepted(controller.tryAcquire())
    const second = accepted(controller.tryAcquire())

    first.release({ kind: 'rate_limited', notBeforeMs: 5_000 })
    expect(controller.snapshot()).toMatchObject({ target: 2, activeLeases: 1, rateLimitNotBeforeMs: 5_000 })
    expect(controller.tryAcquire()).toEqual({ accepted: false, reason: 'paused', retryAfterMs: 4_000 })
    now = 4_999.25
    expect(controller.tryAcquire()).toEqual({ accepted: false, reason: 'paused', retryAfterMs: 1 })

    now = 5_000
    const atBoundary = accepted(controller.tryAcquire())
    expect(controller.snapshot().rateLimitNotBeforeMs).toBeNull()
    second.release({ kind: 'confirmed_failure' })
    atBoundary.release({ kind: 'confirmed_failure' })
  })

  it('never shortens an existing absolute 429 gate and does not compute retry jitter itself', () => {
    let now = 100
    const controller = createController({ hardLimit: 2, stableSuccessWindow: 1, now: () => now })
    growTarget(controller, 2, 1)
    const first = accepted(controller.tryAcquire())
    const second = accepted(controller.tryAcquire())
    first.release({ kind: 'rate_limited', notBeforeMs: 10_000 })
    second.release({ kind: 'rate_limited', notBeforeMs: 8_000 })
    expect(controller.snapshot().rateLimitNotBeforeMs).toBe(10_000)
    expect(controller.tryAcquire()).toEqual({ accepted: false, reason: 'paused', retryAfterMs: 9_900 })
    now = 10_000
    expect(accepted(controller.tryAcquire()).id).toMatch(/^lease-/)
  })

  it.each([
    'provider_auth_failed',
    'provider_balance_unavailable',
    'provider_not_configured',
    'provider_access_denied',
    'long_retry_after',
  ] as const)('holds %s until explicit resume', (reason: AdmissionPauseReason) => {
    const controller = createController()
    controller.pause(reason)
    expect(controller.snapshot()).toMatchObject({ pauseReason: reason, activeLeases: 0 })
    expect(controller.tryAcquire()).toEqual({ accepted: false, reason: 'paused' })
    controller.resume()
    expect(controller.snapshot().pauseReason).toBeNull()
    expect(accepted(controller.tryAcquire()).id).toBe('lease-1')
  })

  it('preserves a timed global gate when an unrelated explicit pause is resumed', () => {
    let now = 0
    const controller = createController({ now: () => now })
    accepted(controller.tryAcquire()).release({ kind: 'rate_limited', notBeforeMs: 1_000 })
    controller.pause('provider_auth_failed')
    now = 500
    controller.resume()
    expect(controller.tryAcquire()).toEqual({ accepted: false, reason: 'paused', retryAfterMs: 500 })
    now = 1_000
    expect(accepted(controller.tryAcquire()).id).toBe('lease-2')
  })

  it('releases only the failing item for an unrelated confirmed failure without global backoff', () => {
    const controller = createController({ hardLimit: 2, stableSuccessWindow: 1 })
    growTarget(controller, 2, 1)
    const first = accepted(controller.tryAcquire())
    const second = accepted(controller.tryAcquire())
    first.release({ kind: 'confirmed_failure' })
    expect(controller.snapshot()).toMatchObject({ target: 2, activeLeases: 1, pauseReason: null, rateLimitNotBeforeMs: null })
    const replacement = accepted(controller.tryAcquire())
    second.release({ kind: 'confirmed_failure' })
    replacement.release({ kind: 'confirmed_failure' })
  })

  it('does not erase unrelated stable-success evidence on a confirmed single-item failure', () => {
    const controller = createController({ hardLimit: 3, stableSuccessWindow: 3 })
    accepted(controller.tryAcquire()).release({ kind: 'success' })
    expect(controller.snapshot().stableSuccesses).toBe(1)
    accepted(controller.tryAcquire()).release({ kind: 'confirmed_failure' })
    expect(controller.snapshot()).toMatchObject({ target: 1, stableSuccesses: 1, pauseReason: null })
  })

  it('retains orphan leases indefinitely and rejects at real hard-limit exhaustion', () => {
    const controller = createController({ hardLimit: 2, stableSuccessWindow: 1 })
    growTarget(controller, 2, 1)
    const orphanA = accepted(controller.tryAcquire())
    const orphanB = accepted(controller.tryAcquire())

    expect(controller.tryAcquire()).toEqual({ accepted: false, reason: 'hard_limit' })
    expect(controller.snapshot()).toMatchObject({ target: 2, activeLeases: 2 })
    expect(orphanA.id).not.toBe(orphanB.id)
  })

  it('fails closed on double release and an unknown lease ID without changing counters', () => {
    const controller = createController()
    const lease = accepted(controller.tryAcquire())
    lease.release({ kind: 'success' })
    const settled = controller.snapshot()
    expect(() => lease.release({ kind: 'success' })).toThrow(/invalid admission lease/i)
    expect(controller.snapshot()).toEqual(settled)

    const unsafeController = controller as unknown as {
      releaseLease(id: string, outcome: { kind: 'success' }): void
    }
    expect(() => unsafeController.releaseLease('unknown-lease', { kind: 'success' }))
      .toThrow(/invalid admission lease/i)
    expect(controller.snapshot()).toEqual(settled)
  })

  it('shares one target and active count across otherwise unrelated tasks and callers', () => {
    const shared = createController()
    const taskACaller1 = accepted(shared.tryAcquire())
    expect(shared.tryAcquire()).toEqual({ accepted: false, reason: 'target_busy', retryAfterMs: 1_000 })
    taskACaller1.release({ kind: 'confirmed_failure' })
    const taskBCaller9 = accepted(shared.tryAcquire())
    expect(shared.snapshot().activeLeases).toBe(1)
    taskBCaller9.release({ kind: 'success' })
  })

  it.each([
    () => new ProviderAdmissionController({ hardLimit: 0 }),
    () => new ProviderAdmissionController({ hardLimit: 2, stableSuccessWindow: 0 }),
    () => new ProviderAdmissionController({ hardLimit: 2, now: () => Number.NaN }).tryAcquire(),
  ])('rejects invalid configuration or clock values with content-free errors', (run) => {
    expect(run).toThrow(/invalid provider admission configuration/i)
  })
})
