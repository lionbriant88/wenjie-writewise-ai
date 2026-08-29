import { randomUUID } from 'node:crypto'

export type AdmissionPauseReason =
  | 'provider_auth_failed'
  | 'provider_balance_unavailable'
  | 'provider_not_configured'
  | 'provider_access_denied'
  | 'long_retry_after'

export type AdmissionReleaseOutcome =
  | { kind: 'success' }
  | { kind: 'rate_limited'; notBeforeMs: number }
  | { kind: 'confirmed_failure' }

export interface AdmissionLease {
  readonly id: string
  release(outcome: AdmissionReleaseOutcome): void
}

export type AdmissionDecision =
  | { accepted: true; lease: AdmissionLease; queueWaitMs: 0 }
  | { accepted: false; reason: 'target_busy' | 'hard_limit' | 'paused'; retryAfterMs?: number }

export interface AdmissionSnapshot {
  hardLimit: number
  target: number
  activeLeases: number
  stableSuccesses: number
  pauseReason: AdmissionPauseReason | null
  rateLimitNotBeforeMs: number | null
}

export interface ProviderAdmissionControllerOptions {
  hardLimit: number
  stableSuccessWindow?: number
  now?: () => number
  idFactory?: () => string
}

const DEFAULT_STABLE_SUCCESS_WINDOW = 8
const TARGET_BUSY_RETRY_AFTER_MS = 1_000
const PAUSE_REASONS = new Set<AdmissionPauseReason>([
  'provider_auth_failed',
  'provider_balance_unavailable',
  'provider_not_configured',
  'provider_access_denied',
  'long_retry_after',
])
const INVALID_CONFIG_MESSAGE = 'Invalid provider admission configuration.'
const INVALID_LEASE_MESSAGE = 'Invalid admission lease release.'

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function validNow(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(INVALID_CONFIG_MESSAGE)
  return value
}

export class ProviderAdmissionController {
  readonly #hardLimit: number
  readonly #stableSuccessWindow: number
  readonly #now: () => number
  readonly #idFactory: () => string
  readonly #activeLeases = new Map<string, symbol>()
  #target = 1
  #stableSuccesses = 0
  #pauseReason: AdmissionPauseReason | null = null
  #rateLimitNotBeforeMs: number | null = null

  constructor(options: ProviderAdmissionControllerOptions) {
    const stableSuccessWindow = options.stableSuccessWindow ?? DEFAULT_STABLE_SUCCESS_WINDOW
    if (!isPositiveInteger(options.hardLimit) || !isPositiveInteger(stableSuccessWindow)) {
      throw new TypeError(INVALID_CONFIG_MESSAGE)
    }
    this.#hardLimit = options.hardLimit
    this.#stableSuccessWindow = stableSuccessWindow
    this.#now = options.now ?? Date.now
    this.#idFactory = options.idFactory ?? randomUUID
  }

  tryAcquire(now: number = this.#now()): AdmissionDecision {
    const currentTime = validNow(now)
    this.#clearExpiredRateLimitGate(currentTime)
    if (this.#pauseReason !== null) return { accepted: false, reason: 'paused' }
    if (this.#rateLimitNotBeforeMs !== null) {
      return {
        accepted: false,
        reason: 'paused',
        retryAfterMs: Math.max(1, Math.ceil(this.#rateLimitNotBeforeMs - currentTime)),
      }
    }
    if (this.#activeLeases.size >= this.#hardLimit) {
      return { accepted: false, reason: 'hard_limit' }
    }
    if (this.#activeLeases.size >= this.#target) {
      return { accepted: false, reason: 'target_busy', retryAfterMs: TARGET_BUSY_RETRY_AFTER_MS }
    }

    const id = this.#idFactory()
    if (typeof id !== 'string' || id.trim().length === 0 || this.#activeLeases.has(id)) {
      throw new TypeError(INVALID_CONFIG_MESSAGE)
    }
    const token = Symbol(id)
    this.#activeLeases.set(id, token)
    const lease: AdmissionLease = Object.freeze({
      id,
      release: (outcome: AdmissionReleaseOutcome) => this.releaseLease(id, outcome, token),
    })
    return { accepted: true, lease, queueWaitMs: 0 }
  }

  pause(reason: AdmissionPauseReason): void {
    if (!PAUSE_REASONS.has(reason)) throw new TypeError(INVALID_CONFIG_MESSAGE)
    this.#pauseReason = reason
  }

  resume(): void {
    this.#pauseReason = null
  }

  snapshot(): AdmissionSnapshot {
    this.#clearExpiredRateLimitGate(validNow(this.#now()))
    return {
      hardLimit: this.#hardLimit,
      target: this.#target,
      activeLeases: this.#activeLeases.size,
      stableSuccesses: this.#stableSuccesses,
      pauseReason: this.#pauseReason,
      rateLimitNotBeforeMs: this.#rateLimitNotBeforeMs,
    }
  }

  private releaseLease(id: string, outcome: AdmissionReleaseOutcome, token?: symbol): void {
    const activeToken = this.#activeLeases.get(id)
    if (activeToken === undefined || activeToken !== token) throw new Error(INVALID_LEASE_MESSAGE)
    if (!outcome || typeof outcome !== 'object') throw new Error(INVALID_LEASE_MESSAGE)
    if (outcome.kind === 'rate_limited') {
      if (!Number.isFinite(outcome.notBeforeMs) || outcome.notBeforeMs < 0) throw new Error(INVALID_LEASE_MESSAGE)
    } else if (outcome.kind !== 'success' && outcome.kind !== 'confirmed_failure') {
      throw new Error(INVALID_LEASE_MESSAGE)
    }

    this.#activeLeases.delete(id)
    if (outcome.kind === 'success') {
      this.#stableSuccesses += 1
      if (this.#stableSuccesses >= this.#stableSuccessWindow) {
        if (this.#target < this.#hardLimit) this.#target += 1
        this.#stableSuccesses = 0
      }
      return
    }

    if (outcome.kind === 'rate_limited') {
      this.#stableSuccesses = 0
      this.#target = Math.max(1, Math.floor(this.#target / 2))
      this.#rateLimitNotBeforeMs = Math.max(this.#rateLimitNotBeforeMs ?? 0, outcome.notBeforeMs)
    }
  }

  #clearExpiredRateLimitGate(now: number): void {
    if (this.#rateLimitNotBeforeMs !== null && now >= this.#rateLimitNotBeforeMs) {
      this.#rateLimitNotBeforeMs = null
    }
  }
}
