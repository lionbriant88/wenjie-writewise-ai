export type GradingQueueMode = 'adaptive-v1' | 'single-legacy'

export interface GradingRuntimeEnvironment {
  VITE_GRADING_MODE?: string
  VITE_GRADING_API_BASE?: string
  VITE_GRADING_QUEUE_MODE?: string
  VITE_GRADING_MAX_IN_FLIGHT?: string
  [key: string]: string | undefined
}

export type GradingRuntimeConfig =
  | {
      mode: 'mock'
      queueMode: GradingQueueMode
      maxInFlight: number
    }
  | {
      mode: 'real'
      apiBase: string
      queueMode: GradingQueueMode
      maxInFlight: number
    }

export type GradingRuntimeConfigResult =
  | { ok: true; value: GradingRuntimeConfig }
  | { ok: false }

const NativeUrl = URL

function positiveInteger(value: string | undefined): number | null {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export function normalizeGradingApiBase(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  try {
    const parsed = new NativeUrl(trimmed)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      || parsed.username || parsed.password || parsed.search || parsed.hash) return null
    return parsed.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

export function parseGradingRuntimeConfig(
  env: GradingRuntimeEnvironment,
): GradingRuntimeConfigResult {
  if (!env || typeof env !== 'object') return { ok: false }
  const mode = env.VITE_GRADING_MODE
  if (mode !== 'mock' && mode !== 'real') return { ok: false }

  const rawQueueMode = env.VITE_GRADING_QUEUE_MODE
  const queueMode = rawQueueMode === undefined && mode === 'mock'
    ? 'single-legacy'
    : rawQueueMode
  if (queueMode !== 'adaptive-v1' && queueMode !== 'single-legacy') return { ok: false }

  const rawMaxInFlight = env.VITE_GRADING_MAX_IN_FLIGHT
  const configuredMax = rawMaxInFlight === undefined ? null : positiveInteger(rawMaxInFlight)
  if (rawMaxInFlight !== undefined && configuredMax === null) return { ok: false }
  if (queueMode === 'adaptive-v1' && configuredMax === null) return { ok: false }
  const maxInFlight = queueMode === 'single-legacy' ? 1 : configuredMax!

  if (mode === 'mock') return { ok: true, value: { mode, queueMode, maxInFlight } }
  const apiBase = normalizeGradingApiBase(env.VITE_GRADING_API_BASE)
  return apiBase
    ? { ok: true, value: { mode, apiBase, queueMode, maxInFlight } }
    : { ok: false }
}
