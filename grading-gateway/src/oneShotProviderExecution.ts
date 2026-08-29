import { ProviderAdmissionController, type AdmissionDecision, type AdmissionLease } from './providerAdmissionController.js'
import { GradingProviderError } from './providers/providerTypes.js'

export interface OneShotTimers {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export interface OneShotProviderExecutionOptions {
  admission: ProviderAdmissionController
  providerFinalDeadlineMs: number
  settlementGraceMs: number
  retryAfterPauseMs: number
  now?: () => number
  timers?: OneShotTimers
}

export interface OneShotExecutionInput<T> {
  receivedAt: number
  httpDeadlineMs: number
  execute(context: { signal: AbortSignal }): Promise<T>
}

export type OneShotExecutionOutcome<T> =
  | { kind: 'success'; value: T }
  | { kind: 'failure'; error: unknown }
  | { kind: 'result_unknown' }
  | { kind: 'caller_timeout_before_dispatch' }
  | { kind: 'admission_rejected'; decision: Extract<AdmissionDecision, { accepted: false }> }

export interface OneShotExecutionSnapshot {
  inFlight: number
  orphanedUnknown: number
}

type OperationState = 'in_flight' | 'orphaned_unknown'

interface TrackedOperation<T> {
  state: OperationState
  lease: AdmissionLease
  controller: AbortController
  callerSettled: boolean
  callerPromise: Promise<OneShotExecutionOutcome<T>>
  resolveCaller(outcome: OneShotExecutionOutcome<T>): void
  providerPromise?: Promise<T>
  callerTimer?: unknown
  providerDeadlineTimer?: unknown
  graceTimer?: unknown
}

const INVALID_CONFIG_MESSAGE = 'Invalid one-shot Provider execution configuration.'
const defaultTimers: OneShotTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

function validFinite(value: number, minimum: number): boolean {
  return Number.isFinite(value) && value >= minimum
}

function providerTermination(error: unknown): 'confirmed' | 'unknown' {
  return error instanceof GradingProviderError && error.details?.termination === 'confirmed'
    ? 'confirmed'
    : 'unknown'
}

export class OneShotProviderExecutionTracker {
  readonly #admission: ProviderAdmissionController
  readonly #providerFinalDeadlineMs: number
  readonly #settlementGraceMs: number
  readonly #retryAfterPauseMs: number
  readonly #nowSource: () => number
  readonly #timers: OneShotTimers
  readonly #operations = new Set<TrackedOperation<unknown>>()

  constructor(options: OneShotProviderExecutionOptions) {
    if (!(options.admission instanceof ProviderAdmissionController)
      || !validFinite(options.providerFinalDeadlineMs, 1)
      || !validFinite(options.settlementGraceMs, 0)
      || !validFinite(options.retryAfterPauseMs, 1)) {
      throw new TypeError(INVALID_CONFIG_MESSAGE)
    }
    this.#admission = options.admission
    this.#providerFinalDeadlineMs = options.providerFinalDeadlineMs
    this.#settlementGraceMs = options.settlementGraceMs
    this.#retryAfterPauseMs = options.retryAfterPauseMs
    this.#nowSource = options.now ?? Date.now
    this.#timers = options.timers ?? defaultTimers
  }

  run<T>(input: OneShotExecutionInput<T>): Promise<OneShotExecutionOutcome<T>> {
    const now = this.#now()
    if (!validFinite(input.receivedAt, 0) || input.receivedAt > now
      || !validFinite(input.httpDeadlineMs, 1) || typeof input.execute !== 'function') {
      return Promise.reject(new TypeError(INVALID_CONFIG_MESSAGE))
    }
    const callerDeadlineAt = input.receivedAt + input.httpDeadlineMs
    if (!Number.isFinite(callerDeadlineAt)) return Promise.reject(new TypeError(INVALID_CONFIG_MESSAGE))
    if (now >= callerDeadlineAt) return Promise.resolve({ kind: 'caller_timeout_before_dispatch' })

    const admission = this.#admission.tryAcquire(now)
    if (!admission.accepted) return Promise.resolve({ kind: 'admission_rejected', decision: admission })

    const controller = new AbortController()
    let resolveCaller!: (outcome: OneShotExecutionOutcome<T>) => void
    const callerPromise = new Promise<OneShotExecutionOutcome<T>>((resolve) => { resolveCaller = resolve })
    const operation: TrackedOperation<T> = {
      state: 'in_flight', lease: admission.lease, controller, callerSettled: false,
      callerPromise, resolveCaller,
    }
    this.#operations.add(operation as TrackedOperation<unknown>)
    operation.callerTimer = this.#timers.setTimeout(() => {
      operation.callerTimer = undefined
      this.#settleCaller(operation, { kind: 'result_unknown' })
    }, callerDeadlineAt - now)

    let providerPromise: Promise<T>
    try { providerPromise = Promise.resolve(input.execute({ signal: controller.signal })) }
    catch (error) { providerPromise = Promise.reject(error) }
    operation.providerPromise = providerPromise
    operation.providerDeadlineTimer = this.#timers.setTimeout(() => {
      if (operation.state !== 'in_flight') return
      operation.providerDeadlineTimer = undefined
      operation.controller.abort()
      operation.graceTimer = this.#timers.setTimeout(() => {
        if (operation.state !== 'in_flight') return
        operation.graceTimer = undefined
        operation.state = 'orphaned_unknown'
        this.#settleCaller(operation, { kind: 'result_unknown' })
      }, this.#settlementGraceMs)
    }, this.#providerFinalDeadlineMs)

    void providerPromise.then(
      (value) => this.#settleSuccess(operation, value),
      (error) => this.#settleFailure(operation, error),
    )
    return callerPromise
  }

  snapshot(): OneShotExecutionSnapshot {
    let inFlight = 0
    let orphanedUnknown = 0
    for (const operation of this.#operations) {
      if (operation.state === 'in_flight') inFlight += 1
      else orphanedUnknown += 1
    }
    return { inFlight, orphanedUnknown }
  }

  #settleSuccess<T>(operation: TrackedOperation<T>, value: T): void {
    if (!this.#operations.has(operation as TrackedOperation<unknown>)) return
    this.#clearProviderTimers(operation)
    operation.lease.release({ kind: 'success' })
    this.#operations.delete(operation as TrackedOperation<unknown>)
    this.#settleCaller(operation, { kind: 'success', value })
  }

  #settleFailure<T>(operation: TrackedOperation<T>, error: unknown): void {
    if (!this.#operations.has(operation as TrackedOperation<unknown>)) return
    this.#clearProviderTimers(operation)
    if (providerTermination(error) === 'unknown') {
      operation.state = 'orphaned_unknown'
      this.#settleCaller(operation, { kind: 'result_unknown' })
      return
    }

    const now = this.#now()
    if (error instanceof GradingProviderError && error.code === 'provider_rate_limited') {
      const retryAfterMs = typeof error.details?.retryAfterMs === 'number'
        && validFinite(error.details.retryAfterMs, 0)
        ? error.details.retryAfterMs
        : 0
      if (retryAfterMs > this.#retryAfterPauseMs) {
        operation.lease.release({ kind: 'rate_limited', notBeforeMs: now })
        this.#admission.pause('long_retry_after')
      } else {
        const notBeforeMs = now + retryAfterMs
        if (!Number.isFinite(notBeforeMs)) throw new TypeError(INVALID_CONFIG_MESSAGE)
        operation.lease.release({ kind: 'rate_limited', notBeforeMs })
      }
    } else {
      operation.lease.release({ kind: 'confirmed_failure' })
      if (error instanceof GradingProviderError) {
        if (error.details?.pauseAdmission === true) this.#admission.pause('provider_access_denied')
        else if (error.code === 'provider_auth_failed') this.#admission.pause('provider_auth_failed')
        else if (error.code === 'provider_balance_unavailable') this.#admission.pause('provider_balance_unavailable')
        else if (error.code === 'provider_not_configured') this.#admission.pause('provider_not_configured')
      }
    }
    this.#operations.delete(operation as TrackedOperation<unknown>)
    this.#settleCaller(operation, { kind: 'failure', error })
  }

  #settleCaller<T>(operation: TrackedOperation<T>, outcome: OneShotExecutionOutcome<T>): void {
    if (operation.callerSettled) return
    operation.callerSettled = true
    if (operation.callerTimer !== undefined) this.#timers.clearTimeout(operation.callerTimer)
    operation.callerTimer = undefined
    operation.resolveCaller(outcome)
  }

  #clearProviderTimers<T>(operation: TrackedOperation<T>): void {
    if (operation.providerDeadlineTimer !== undefined) this.#timers.clearTimeout(operation.providerDeadlineTimer)
    if (operation.graceTimer !== undefined) this.#timers.clearTimeout(operation.graceTimer)
    operation.providerDeadlineTimer = undefined
    operation.graceTimer = undefined
  }

  #now(): number {
    const value = this.#nowSource()
    if (!validFinite(value, 0)) throw new TypeError(INVALID_CONFIG_MESSAGE)
    return value
  }
}
