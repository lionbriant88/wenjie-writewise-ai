import type { AiGradingResultV1 } from './types.js'
import {
  createProviderTelemetryRecorder,
  recordUniqueProviderAttempts,
  type ProviderAttemptMetricContext,
  type ProviderTelemetryRecorder,
  type SafeProviderMetricSink,
} from './providerTelemetry.js'
import {
  ProviderAdmissionController,
  type AdmissionDecision,
  type AdmissionLease,
  type AdmissionPauseReason,
} from './providerAdmissionController.js'
import { GradingProviderError, type ProviderAttemptObservation, type ProviderErrorCode } from './providers/providerTypes.js'

export type RegistryState =
  | 'in_flight'
  | 'succeeded'
  | 'failed_retryable'
  | 'failed_final'
  | 'orphaned_unknown'

export interface RegistryTimers {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export interface EssayGradingRegistryOptions {
  admission: ProviderAdmissionController
  providerFinalDeadlineMs: number
  settlementGraceMs: number
  terminalTtlMs: number
  maxEntries: number
  maxProviderAttempts: 2
  maxRateLimitRequeues: 5
  retryBaseMs: 2000 | number
  retryCapMs: 60000 | number
  retryAfterPauseMs: 900000 | number
  now?: () => number
  random?: () => number
  timers?: RegistryTimers
  onMetric?: SafeProviderMetricSink
}

export interface RegistryExecutionContext {
  signal: AbortSignal
  attemptOrdinal: number
  nonRateLimitedProviderAttempts: number
  rateLimitRequeues: number
}

export interface RegistryExecutionResult {
  result: Omit<AiGradingResultV1, 'requestId'>
  attempts: readonly ProviderAttemptObservation[]
}

export type RegistryExecutor = (context: RegistryExecutionContext) => Promise<RegistryExecutionResult>

export type RegistryMetricContext = Omit<ProviderAttemptMetricContext, 'outcome'>

export interface RegistryAttachInput {
  logicalRequestId: string
  payloadHash: string
  callerRequestId: string
  execute: RegistryExecutor
  metricContext?: RegistryMetricContext
}

export interface RegistryFailureV1 {
  requestId: string
  status: 'failed'
  error: { code: string; message: string; retryable: boolean }
}

export type RegistryResponse = AiGradingResultV1 | RegistryFailureV1

export type RegistryAttachDisposition =
  | 'executed'
  | 'attached'
  | 'cached'
  | 'retry_wait'
  | 'admission_rejected'
  | 'identity_conflict'
  | 'capacity_rejected'

export interface RegistryAttachResult {
  disposition: RegistryAttachDisposition
  state: RegistryState | null
  response: RegistryResponse
  retryAfterMs?: number
}

export interface RegistryEntrySnapshot {
  state: RegistryState
  nonRateLimitedProviderAttempts: number
  rateLimitRequeues: number
  retryAt: number | null
  hasActiveLease: boolean
  hasRetainedExecutor: boolean
}

export interface RegistrySnapshot {
  entries: number
  states: Record<RegistryState, number>
}

interface AttemptCounters {
  nonRateLimitedProviderAttempts: number
  rateLimitRequeues: number
}

type SuccessTemplate = Omit<AiGradingResultV1, 'requestId'>
type FailureTemplate = Omit<RegistryFailureV1, 'requestId'>

interface Deferred {
  promise: Promise<void>
  resolve(): void
  reject(reason: unknown): void
}

interface RegistryEntry {
  logicalRequestId: string
  payloadHash: string
  state: RegistryState
  counters: AttemptCounters
  dispatchOrdinal: number
  execute?: RegistryExecutor
  metricContext?: RegistryMetricContext
  observations: ProviderAttemptObservation[]
  lease?: AdmissionLease
  attemptToken?: symbol
  abortController?: AbortController
  providerPromise?: Promise<RegistryExecutionResult>
  deadlineTimer?: unknown
  graceTimer?: unknown
  transition?: Deferred
  retryAt?: number
  terminalAt?: number
  successTemplate?: SuccessTemplate
  failureTemplate?: FailureTemplate
}

const INVALID_CONFIG_MESSAGE = 'Invalid essay grading registry configuration.'
const INVALID_INPUT_MESSAGE = 'Invalid essay grading registry input.'
const SAFE_PROVIDER_MESSAGES: Record<ProviderErrorCode, string> = {
  unsupported_genre: '当前任务类型暂不支持。',
  provider_not_configured: 'AI 批改服务尚未配置。',
  provider_request_rejected: 'AI 批改请求未被服务接受。',
  provider_auth_failed: 'AI 批改服务认证失败。',
  provider_balance_unavailable: 'AI 批改服务额度暂不可用。',
  provider_rate_limited: 'AI 批改服务繁忙，请稍后重试。',
  provider_timeout: 'AI 批改服务响应超时，请重试。',
  provider_unavailable: 'AI 批改服务暂时不可用。',
  provider_content_filtered: '当前内容暂时无法处理。',
  provider_unexpected_tool_call: 'AI 批改服务返回了无法使用的结果。',
  provider_invalid_response: 'AI 批改服务返回了无法使用的结果。',
}
const FAILURE_MESSAGES = {
  conflict: '批改任务内容与已存在的逻辑任务不一致。',
  capacity: '批改服务当前已达到安全容量上限。',
  rateLimited: SAFE_PROVIDER_MESSAGES.provider_rate_limited,
  resultUnknown: '批改结果状态暂时未知，请稍后检查同一任务。',
  invalidResult: SAFE_PROVIDER_MESSAGES.provider_invalid_response,
} as const

const defaultTimers: RegistryTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

function deferred(): Deferred {
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function validFinite(value: number, minimum: number, integer = false): boolean {
  return Number.isFinite(value) && value >= minimum && (!integer || Number.isInteger(value))
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function failureTemplate(code: string, message: string, retryable: boolean): FailureTemplate {
  return { status: 'failed', error: { code, message, retryable } }
}

function providerFailureTemplate(error: GradingProviderError, retryable = error.retryable): FailureTemplate {
  return failureTemplate(error.code, SAFE_PROVIDER_MESSAGES[error.code], retryable)
}

function unknownFailureTemplate(): FailureTemplate {
  return failureTemplate('provider_result_unknown', FAILURE_MESSAGES.resultUnknown, false)
}

function bindFailure(template: FailureTemplate, requestId: string): RegistryFailureV1 {
  return { requestId, ...clone(template) }
}

function bindSuccess(template: SuccessTemplate, requestId: string): AiGradingResultV1 {
  return { requestId, ...clone(template) }
}

function termination(error: unknown): 'confirmed' | 'unknown' {
  return error instanceof GradingProviderError && error.details?.termination === 'confirmed'
    ? 'confirmed'
    : 'unknown'
}

function observationsFromError(error: unknown): readonly ProviderAttemptObservation[] {
  if (!(error instanceof GradingProviderError)) return []
  return error.details?.attemptObservations ?? []
}

function admissionPauseReason(error: GradingProviderError): AdmissionPauseReason | null {
  if (error.details?.pauseAdmission === true) return 'provider_access_denied'
  if (error.code === 'provider_auth_failed') return 'provider_auth_failed'
  if (error.code === 'provider_balance_unavailable') return 'provider_balance_unavailable'
  if (error.code === 'provider_not_configured') return 'provider_not_configured'
  return null
}

export class EssayGradingRegistry {
  readonly #options: Required<Omit<EssayGradingRegistryOptions, 'onMetric'>>
  readonly #telemetry: ProviderTelemetryRecorder
  readonly #entries = new Map<string, RegistryEntry>()

  constructor(options: EssayGradingRegistryOptions) {
    if (!(options.admission instanceof ProviderAdmissionController)
      || !validFinite(options.providerFinalDeadlineMs, 1)
      || !validFinite(options.settlementGraceMs, 0)
      || !validFinite(options.terminalTtlMs, 1)
      || options.terminalTtlMs <= options.providerFinalDeadlineMs + options.settlementGraceMs
      || !validFinite(options.maxEntries, 1, true)
      || options.maxProviderAttempts !== 2
      || options.maxRateLimitRequeues !== 5
      || !validFinite(options.retryBaseMs, 1)
      || !validFinite(options.retryCapMs, options.retryBaseMs)
      || !validFinite(options.retryAfterPauseMs, 1)) {
      throw new TypeError(INVALID_CONFIG_MESSAGE)
    }
    this.#options = {
      admission: options.admission,
      providerFinalDeadlineMs: options.providerFinalDeadlineMs,
      settlementGraceMs: options.settlementGraceMs,
      terminalTtlMs: options.terminalTtlMs,
      maxEntries: options.maxEntries,
      maxProviderAttempts: options.maxProviderAttempts,
      maxRateLimitRequeues: options.maxRateLimitRequeues,
      retryBaseMs: options.retryBaseMs,
      retryCapMs: options.retryCapMs,
      retryAfterPauseMs: options.retryAfterPauseMs,
      now: options.now ?? Date.now,
      random: options.random ?? Math.random,
      timers: options.timers ?? defaultTimers,
    }
    this.#telemetry = createProviderTelemetryRecorder({ emit: options.onMetric })
  }

  async attach(input: RegistryAttachInput): Promise<RegistryAttachResult> {
    this.#validateAttachInput(input)
    const now = this.#now()
    this.#evictExpiredTerminals(now)
    const existing = this.#entries.get(input.logicalRequestId)
    if (existing) {
      if (existing.payloadHash !== input.payloadHash) {
        return {
          disposition: 'identity_conflict', state: existing.state,
          response: bindFailure(failureTemplate('invalid_request', FAILURE_MESSAGES.conflict, false), input.callerRequestId),
        }
      }
      return this.#attachExisting(existing, input, now)
    }

    if (this.#entries.size >= this.#options.maxEntries) {
      return {
        disposition: 'capacity_rejected', state: null,
        response: bindFailure(failureTemplate('provider_rate_limited', FAILURE_MESSAGES.capacity, true), input.callerRequestId),
      }
    }
    const admission = this.#options.admission.tryAcquire(now)
    if (!admission.accepted) return this.#admissionRejected(admission, input.callerRequestId, null)

    const entry: RegistryEntry = {
      logicalRequestId: input.logicalRequestId,
      payloadHash: input.payloadHash,
      state: 'in_flight',
      counters: { nonRateLimitedProviderAttempts: 0, rateLimitRequeues: 0 },
      dispatchOrdinal: 0,
      execute: input.execute,
      metricContext: input.metricContext,
      observations: [],
    }
    this.#entries.set(input.logicalRequestId, entry)
    const transition = this.#startAttempt(entry, admission.lease)
    await transition
    return this.#renderEntry(entry, input.callerRequestId, 'executed')
  }

  inspect(logicalRequestId: string): RegistryEntrySnapshot | null {
    this.#evictExpiredTerminals(this.#now())
    const entry = this.#entries.get(logicalRequestId)
    return entry ? {
      state: entry.state,
      nonRateLimitedProviderAttempts: entry.counters.nonRateLimitedProviderAttempts,
      rateLimitRequeues: entry.counters.rateLimitRequeues,
      retryAt: entry.retryAt ?? null,
      hasActiveLease: entry.lease !== undefined,
      hasRetainedExecutor: entry.execute !== undefined,
    } : null
  }

  snapshot(): RegistrySnapshot {
    this.#evictExpiredTerminals(this.#now())
    const states: Record<RegistryState, number> = {
      in_flight: 0, succeeded: 0, failed_retryable: 0, failed_final: 0, orphaned_unknown: 0,
    }
    for (const entry of this.#entries.values()) states[entry.state] += 1
    return { entries: this.#entries.size, states }
  }

  async #attachExisting(entry: RegistryEntry, input: RegistryAttachInput, now: number): Promise<RegistryAttachResult> {
    const requestId = input.callerRequestId
    if (entry.state === 'in_flight') {
      const transition = entry.transition
      if (!transition) throw new Error(INVALID_CONFIG_MESSAGE)
      await transition.promise
      return this.#renderEntry(entry, requestId, 'attached')
    }
    if (entry.state === 'succeeded' || entry.state === 'failed_final' || entry.state === 'orphaned_unknown') {
      return this.#renderEntry(entry, requestId, 'cached')
    }

    const retryAt = entry.retryAt ?? now
    if (now < retryAt) {
      return this.#renderEntry(entry, requestId, 'retry_wait', Math.max(1, Math.ceil(retryAt - now)))
    }
    const admission = this.#options.admission.tryAcquire(now)
    if (!admission.accepted) return this.#admissionRejected(admission, requestId, entry.state)
    entry.execute = input.execute
    const transition = this.#startAttempt(entry, admission.lease)
    await transition
    return this.#renderEntry(entry, requestId, 'executed')
  }

  #startAttempt(entry: RegistryEntry, lease: AdmissionLease): Promise<void> {
    if (!entry.execute) throw new Error(INVALID_CONFIG_MESSAGE)
    entry.state = 'in_flight'
    entry.retryAt = undefined
    entry.lease = lease
    entry.dispatchOrdinal += 1
    const attemptToken = Symbol(`attempt-${entry.dispatchOrdinal}`)
    entry.attemptToken = attemptToken
    entry.abortController = new AbortController()
    entry.transition = deferred()

    let providerPromise: Promise<RegistryExecutionResult>
    try {
      providerPromise = Promise.resolve(entry.execute({
        signal: entry.abortController.signal,
        attemptOrdinal: entry.dispatchOrdinal,
        nonRateLimitedProviderAttempts: entry.counters.nonRateLimitedProviderAttempts,
        rateLimitRequeues: entry.counters.rateLimitRequeues,
      }))
    } catch (error) {
      providerPromise = Promise.reject(error)
    }
    entry.providerPromise = providerPromise
    entry.deadlineTimer = this.#options.timers.setTimeout(() => {
      if (!this.#isCurrentAttempt(entry, attemptToken) || entry.state !== 'in_flight') return
      entry.deadlineTimer = undefined
      entry.abortController?.abort()
      entry.graceTimer = this.#options.timers.setTimeout(() => {
        if (!this.#isCurrentAttempt(entry, attemptToken) || entry.state !== 'in_flight') return
        entry.graceTimer = undefined
        this.#transitionOrphaned(entry)
      }, this.#options.settlementGraceMs)
    }, this.#options.providerFinalDeadlineMs)

    void providerPromise.then(
      (result) => this.#settleSuccess(entry, attemptToken, result),
      (error) => this.#settleFailure(entry, attemptToken, error),
    )
    return entry.transition.promise
  }

  #settleSuccess(entry: RegistryEntry, token: symbol, output: RegistryExecutionResult): void {
    if (!this.#isCurrentAttempt(entry, token) || (entry.state !== 'in_flight' && entry.state !== 'orphaned_unknown')) return
    try {
      if (!output || typeof output !== 'object' || !Array.isArray(output.attempts)
        || typeof output.result !== 'object' || output.result === null) {
        this.#settleFailure(entry, token, new GradingProviderError(
          'provider_invalid_response', FAILURE_MESSAGES.invalidResult, false, undefined, {
            termination: 'confirmed',
            attemptObservations: output && typeof output === 'object' && Array.isArray(output.attempts)
              ? output.attempts
              : [],
          },
        ))
        return
      }
      const templateRecord = clone(output.result) as unknown as Record<string, unknown>
      delete templateRecord.requestId
      const template = templateRecord as unknown as SuccessTemplate
      this.#recordAttempts(entry, output.attempts, 'success')
      entry.counters.nonRateLimitedProviderAttempts += 1
      const wasInFlight = entry.state === 'in_flight'
      this.#clearAttemptTimers(entry)
      this.#releaseLease(entry, { kind: 'success' })
      entry.state = 'succeeded'
      entry.successTemplate = template
      entry.failureTemplate = undefined
      entry.terminalAt = this.#now()
      entry.execute = undefined
      this.#clearAttemptRuntime(entry, false)
      if (wasInFlight) this.#resolveTransition(entry)
    } catch (error) {
      this.#failInternalTransition(entry, error)
    }
  }

  #settleFailure(entry: RegistryEntry, token: symbol, error: unknown): void {
    if (!this.#isCurrentAttempt(entry, token) || (entry.state !== 'in_flight' && entry.state !== 'orphaned_unknown')) return
    try {
      const confirmed = termination(error) === 'confirmed'
      this.#recordAttempts(entry, observationsFromError(error), confirmed ? 'failed' : 'result_unknown')
      this.#clearAttemptTimers(entry)
      if (!confirmed) {
        if (entry.state === 'in_flight') this.#transitionOrphaned(entry, true)
        else this.#clearAttemptRuntime(entry, false)
        return
      }
      const providerError = error instanceof GradingProviderError
        ? error
        : new GradingProviderError('provider_unavailable', SAFE_PROVIDER_MESSAGES.provider_unavailable, true, undefined, { termination: 'confirmed' })
      if (entry.state === 'orphaned_unknown') {
        if (providerError.code === 'provider_rate_limited') {
          const now = this.#now()
          const retryAfterMs = this.#validRetryAfter(providerError.details?.retryAfterMs)
          const retryAt = retryAfterMs === undefined ? undefined : this.#safeFuture(now, retryAfterMs)
          this.#releaseLease(entry, { kind: 'rate_limited', notBeforeMs: retryAt ?? now })
          if (retryAfterMs !== undefined && retryAfterMs > this.#options.retryAfterPauseMs) {
            this.#options.admission.pause('long_retry_after')
          }
          this.#transitionFinal(entry, providerFailureTemplate(providerError, false), false, retryAt)
        } else {
          this.#releaseLease(entry, { kind: 'confirmed_failure' })
          const pauseReason = admissionPauseReason(providerError)
          if (pauseReason) this.#options.admission.pause(pauseReason)
          this.#transitionFinal(entry, providerFailureTemplate(providerError, false), false)
        }
        return
      }
      this.#handleConfirmedFailure(entry, providerError)
    } catch (transitionError) {
      this.#failInternalTransition(entry, transitionError)
    }
  }

  #handleConfirmedFailure(entry: RegistryEntry, error: GradingProviderError): void {
    const now = this.#now()
    if (error.code === 'provider_rate_limited') {
      const retryAfterMs = this.#validRetryAfter(error.details?.retryAfterMs)
      if (entry.counters.rateLimitRequeues >= this.#options.maxRateLimitRequeues) {
        const retryAt = retryAfterMs === undefined ? undefined : this.#safeFuture(now, retryAfterMs)
        this.#releaseLease(entry, { kind: 'rate_limited', notBeforeMs: retryAt ?? now })
        if (retryAfterMs !== undefined && retryAfterMs > this.#options.retryAfterPauseMs) {
          this.#options.admission.pause('long_retry_after')
        }
        this.#transitionFinal(entry, providerFailureTemplate(error, false), true, retryAt)
        return
      }
      if (retryAfterMs !== undefined && retryAfterMs > this.#options.retryAfterPauseMs) {
        if (entry.counters.rateLimitRequeues < this.#options.maxRateLimitRequeues) entry.counters.rateLimitRequeues += 1
        this.#releaseLease(entry, { kind: 'rate_limited', notBeforeMs: now })
        this.#options.admission.pause('long_retry_after')
        this.#transitionRetryable(entry, providerFailureTemplate(error, true), now)
        return
      }
      entry.counters.rateLimitRequeues += 1
      const exponentialCap = Math.min(
        this.#options.retryCapMs,
        this.#options.retryBaseMs * 2 ** entry.counters.rateLimitRequeues,
      )
      const fullJitterMs = Math.floor(this.#random() * exponentialCap)
      const retryDelayMs = Math.max(retryAfterMs ?? 0, fullJitterMs)
      const notBeforeMs = this.#safeFuture(now, retryDelayMs)
      this.#releaseLease(entry, { kind: 'rate_limited', notBeforeMs })
      this.#transitionRetryable(entry, providerFailureTemplate(error, true), notBeforeMs)
      return
    }

    entry.counters.nonRateLimitedProviderAttempts += 1
    const pauseReason = admissionPauseReason(error)
    this.#releaseLease(entry, { kind: 'confirmed_failure' })
    if (pauseReason) {
      this.#options.admission.pause(pauseReason)
      this.#transitionFinal(entry, providerFailureTemplate(error, false), true)
      return
    }
    if (error.retryable && entry.counters.nonRateLimitedProviderAttempts < this.#options.maxProviderAttempts) {
      const exponentialCap = Math.min(
        this.#options.retryCapMs,
        this.#options.retryBaseMs * 2 ** (entry.counters.nonRateLimitedProviderAttempts - 1),
      )
      const retryAt = this.#safeFuture(now, Math.floor(this.#random() * exponentialCap))
      this.#transitionRetryable(entry, providerFailureTemplate(error, true), retryAt)
      return
    }
    this.#transitionFinal(entry, providerFailureTemplate(error, false), true)
  }

  #transitionRetryable(entry: RegistryEntry, failure: FailureTemplate, retryAt: number): void {
    entry.state = 'failed_retryable'
    entry.failureTemplate = failure
    entry.successTemplate = undefined
    entry.retryAt = retryAt
    entry.terminalAt = undefined
    entry.execute = undefined
    this.#clearAttemptRuntime(entry, false)
    this.#resolveTransition(entry)
  }

  #transitionFinal(
    entry: RegistryEntry,
    failure: FailureTemplate,
    resolveCurrent: boolean,
    retryAt?: number,
  ): void {
    entry.state = 'failed_final'
    entry.failureTemplate = failure
    entry.successTemplate = undefined
    entry.retryAt = retryAt
    entry.terminalAt = this.#now()
    entry.execute = undefined
    this.#clearAttemptRuntime(entry, false)
    if (resolveCurrent) this.#resolveTransition(entry)
  }

  #transitionOrphaned(entry: RegistryEntry, underlyingSettled = false): void {
    entry.state = 'orphaned_unknown'
    entry.failureTemplate = unknownFailureTemplate()
    entry.successTemplate = undefined
    entry.retryAt = undefined
    entry.terminalAt = undefined
    entry.execute = undefined
    if (underlyingSettled) this.#clearAttemptRuntime(entry, false)
    this.#resolveTransition(entry)
  }

  #failInternalTransition(entry: RegistryEntry, error: unknown): void {
    this.#clearAttemptTimers(entry)
    try { entry.lease?.release({ kind: 'confirmed_failure' }) } catch { /* Preserve the original invariant failure. */ }
    entry.lease = undefined
    entry.state = 'failed_final'
    entry.failureTemplate = failureTemplate('provider_not_configured', SAFE_PROVIDER_MESSAGES.provider_not_configured, false)
    entry.successTemplate = undefined
    entry.terminalAt = this.#now()
    entry.execute = undefined
    this.#clearAttemptRuntime(entry, false)
    const transition = entry.transition
    entry.transition = undefined
    transition?.reject(error instanceof Error ? error : new Error(INVALID_CONFIG_MESSAGE))
  }

  #renderEntry(
    entry: RegistryEntry,
    requestId: string,
    disposition: RegistryAttachDisposition,
    retryAfterMs?: number,
  ): RegistryAttachResult {
    if (entry.state === 'succeeded' && entry.successTemplate) {
      return { disposition, state: entry.state, response: bindSuccess(entry.successTemplate, requestId) }
    }
    if (!entry.failureTemplate || entry.state === 'in_flight') throw new Error(INVALID_CONFIG_MESSAGE)
    const remaining = retryAfterMs ?? ((entry.state === 'failed_retryable' || entry.state === 'failed_final') && entry.retryAt !== undefined
      ? Math.max(0, Math.ceil(entry.retryAt - this.#now()))
      : 0)
    return {
      disposition,
      state: entry.state,
      response: bindFailure(entry.failureTemplate, requestId),
      ...(remaining > 0 ? { retryAfterMs: remaining } : {}),
    }
  }

  #admissionRejected(
    decision: Extract<AdmissionDecision, { accepted: false }>,
    requestId: string,
    state: RegistryState | null,
  ): RegistryAttachResult {
    const pauseReason = this.#options.admission.snapshot().pauseReason
    const providerCode = pauseReason === 'provider_auth_failed'
      ? 'provider_auth_failed'
      : pauseReason === 'provider_balance_unavailable'
        ? 'provider_balance_unavailable'
        : pauseReason === 'provider_not_configured'
          ? 'provider_not_configured'
          : pauseReason === 'provider_access_denied'
            ? 'provider_request_rejected'
          : 'provider_rate_limited'
    const message = providerCode === 'provider_rate_limited'
      ? FAILURE_MESSAGES.rateLimited
      : SAFE_PROVIDER_MESSAGES[providerCode]
    return {
      disposition: 'admission_rejected', state,
      response: bindFailure(failureTemplate(providerCode, message, providerCode === 'provider_rate_limited'), requestId),
      ...(decision.retryAfterMs === undefined ? {} : { retryAfterMs: decision.retryAfterMs }),
    }
  }

  #recordAttempts(
    entry: RegistryEntry,
    attempts: readonly ProviderAttemptObservation[],
    outcome: ProviderAttemptMetricContext['outcome'],
  ): void {
    if (!entry.metricContext || !Array.isArray(attempts)) return
    const knownIds = new Set(entry.observations.map(({ attemptDiagnosticId }) => attemptDiagnosticId))
    for (const attempt of attempts) {
      if (!knownIds.has(attempt.attemptDiagnosticId)) {
        entry.observations.push(attempt)
        knownIds.add(attempt.attemptDiagnosticId)
      }
    }
    recordUniqueProviderAttempts(this.#telemetry, { ...entry.metricContext, outcome }, entry.observations)
  }

  #resolveTransition(entry: RegistryEntry): void {
    const transition = entry.transition
    entry.transition = undefined
    transition?.resolve()
  }

  #releaseLease(entry: RegistryEntry, outcome: Parameters<AdmissionLease['release']>[0]): void {
    const lease = entry.lease
    if (!lease) throw new Error(INVALID_CONFIG_MESSAGE)
    lease.release(outcome)
    entry.lease = undefined
  }

  #clearAttemptTimers(entry: RegistryEntry): void {
    if (entry.deadlineTimer !== undefined) this.#options.timers.clearTimeout(entry.deadlineTimer)
    if (entry.graceTimer !== undefined) this.#options.timers.clearTimeout(entry.graceTimer)
    entry.deadlineTimer = undefined
    entry.graceTimer = undefined
  }

  #clearAttemptRuntime(entry: RegistryEntry, preserveToken: boolean): void {
    entry.providerPromise = undefined
    entry.abortController = undefined
    if (!preserveToken) entry.attemptToken = undefined
  }

  #isCurrentAttempt(entry: RegistryEntry, token: symbol): boolean {
    return entry.attemptToken === token
  }

  #evictExpiredTerminals(now: number): void {
    for (const [id, entry] of this.#entries) {
      if ((entry.state === 'succeeded' || entry.state === 'failed_final')
        && entry.terminalAt !== undefined
        && now - entry.terminalAt >= this.#options.terminalTtlMs) {
        this.#entries.delete(id)
      }
    }
  }

  #validateAttachInput(input: RegistryAttachInput): void {
    if (!input || typeof input !== 'object'
      || typeof input.logicalRequestId !== 'string' || input.logicalRequestId.length === 0
      || typeof input.payloadHash !== 'string' || input.payloadHash.length === 0
      || typeof input.callerRequestId !== 'string' || input.callerRequestId.length === 0
      || typeof input.execute !== 'function') {
      throw new TypeError(INVALID_INPUT_MESSAGE)
    }
  }

  #now(): number {
    const value = this.#options.now()
    if (!validFinite(value, 0)) throw new TypeError(INVALID_CONFIG_MESSAGE)
    return value
  }

  #random(): number {
    const value = this.#options.random()
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new TypeError(INVALID_CONFIG_MESSAGE)
    return value
  }

  #validRetryAfter(value: unknown): number | undefined {
    return typeof value === 'number' && validFinite(value, 0) ? value : undefined
  }

  #safeFuture(now: number, delay: number): number {
    const future = now + delay
    if (!validFinite(future, now)) throw new TypeError(INVALID_CONFIG_MESSAGE)
    return future
  }
}
