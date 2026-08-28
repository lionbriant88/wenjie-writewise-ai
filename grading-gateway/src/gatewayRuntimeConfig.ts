import type { ProviderCallStage } from './providers/providerTypes.js'

export interface GatewayRuntimeConfig {
  provider: 'kimi' | 'mock'
  rubricStrategy: 'single-pass-v1' | 'two-pass-legacy'
  essayPromptProfile: 'optimized-v1' | 'legacy'
  executionRegistry: 'memory-v1' | 'direct-legacy'
  deadlines: { httpMs: number; providerFinalMs: number; settlementGraceMs: number }
  admission: { hardLimit: number }
  registry: { terminalTtlMs: number; maxEntries: number }
  retry: {
    maxProviderAttempts: 2
    maxRateLimitRequeues: 5
    baseMs: 2000
    capMs: 60000
    pauseAfterMs: 900000
  }
  kimi: {
    apiBase: string
    model: string
    reasoningEffort: 'low'
    stageBudgets: Record<ProviderCallStage, number>
    promptCacheSecret: string
  }
}

export class GatewayRuntimeConfigError extends Error {
  constructor() {
    super('Invalid grading gateway runtime configuration.')
    this.name = 'GatewayRuntimeConfigError'
  }
}

type GatewayEnvironment = Record<string, string | undefined>

function invalidConfig(): never {
  throw new GatewayRuntimeConfigError()
}

function exactValue<T extends string>(value: string | undefined, allowed: readonly T[]): T {
  const normalized = value?.trim()
  if (!normalized || !allowed.includes(normalized as T)) return invalidConfig()
  return normalized as T
}

function positiveInteger(value: string | undefined, maximum = Number.MAX_SAFE_INTEGER): number {
  if (value === undefined || value.trim() === '') return invalidConfig()
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) return invalidConfig()
  return parsed
}

function exactInteger(value: string | undefined, expected: number): number {
  const parsed = positiveInteger(value)
  if (parsed !== expected) return invalidConfig()
  return parsed
}

export function parseGatewayRuntimeConfig(env: GatewayEnvironment): GatewayRuntimeConfig {
  const provider = exactValue(env.GRADING_PROVIDER, ['kimi', 'mock'] as const)
  const rubricStrategy = exactValue(env.GRADING_RUBRIC_STRATEGY, ['single-pass-v1', 'two-pass-legacy'] as const)
  const essayPromptProfile = exactValue(env.GRADING_ESSAY_PROMPT_PROFILE, ['optimized-v1', 'legacy'] as const)
  const executionRegistry = exactValue(env.GRADING_EXECUTION_REGISTRY, ['memory-v1', 'direct-legacy'] as const)
  const httpMs = positiveInteger(env.GRADING_HTTP_DEADLINE_MS)
  const providerFinalMs = positiveInteger(env.GRADING_PROVIDER_FINAL_DEADLINE_MS)
  const settlementGraceMs = positiveInteger(env.GRADING_PROVIDER_SETTLEMENT_GRACE_MS)
  const terminalTtlMs = positiveInteger(env.GRADING_REGISTRY_TERMINAL_TTL_MS)
  if (httpMs > Number.MAX_SAFE_INTEGER - 30_000 || providerFinalMs < httpMs + 30_000) return invalidConfig()
  if (providerFinalMs > Number.MAX_SAFE_INTEGER - settlementGraceMs || terminalTtlMs < providerFinalMs + settlementGraceMs) return invalidConfig()

  const apiBase = env.KIMI_API_BASE?.trim()
  const model = env.KIMI_MODEL?.trim()
  const reasoningEffort = env.KIMI_REASONING_EFFORT?.trim()
  if (apiBase !== 'https://api.moonshot.cn/v1' || model !== 'kimi-k3' || reasoningEffort !== 'low') return invalidConfig()

  const promptCacheSecret = env.GRADING_PROMPT_CACHE_HMAC_SECRET ?? ''
  if (provider === 'kimi' && essayPromptProfile === 'optimized-v1' && Buffer.byteLength(promptCacheSecret.trim(), 'utf8') < 32) return invalidConfig()

  return {
    provider,
    rubricStrategy,
    essayPromptProfile,
    executionRegistry,
    deadlines: { httpMs, providerFinalMs, settlementGraceMs },
    admission: { hardLimit: positiveInteger(env.GRADING_MAX_CONCURRENT_PROVIDER_CALLS) },
    registry: { terminalTtlMs, maxEntries: positiveInteger(env.GRADING_REGISTRY_MAX_ENTRIES) },
    retry: {
      maxProviderAttempts: exactInteger(env.GRADING_PROVIDER_MAX_ATTEMPTS, 2) as 2,
      maxRateLimitRequeues: exactInteger(env.GRADING_RATE_LIMIT_MAX_REQUEUES, 5) as 5,
      baseMs: exactInteger(env.GRADING_RETRY_BASE_MS, 2_000) as 2000,
      capMs: exactInteger(env.GRADING_RETRY_CAP_MS, 60_000) as 60000,
      pauseAfterMs: exactInteger(env.GRADING_RETRY_AFTER_PAUSE_MS, 900_000) as 900000,
    },
    kimi: {
      apiBase,
      model,
      reasoningEffort,
      stageBudgets: {
        material_context: positiveInteger(env.KIMI_MAX_COMPLETION_TOKENS_MATERIAL_CONTEXT, 16_384),
        rubric_generation: positiveInteger(env.KIMI_MAX_COMPLETION_TOKENS_RUBRIC_GENERATION, 16_384),
        essay_grading_images: positiveInteger(env.KIMI_MAX_COMPLETION_TOKENS_ESSAY_GRADING_IMAGES, 16_384),
        essay_regrading_text: positiveInteger(env.KIMI_MAX_COMPLETION_TOKENS_ESSAY_REGRADING_TEXT, 16_384),
      },
      promptCacheSecret,
    },
  }
}
