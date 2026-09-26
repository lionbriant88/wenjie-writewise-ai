import type { MultimodalProviderCallStage } from './providers/providerTypes.js'
import { isFreeOpenRouterModel, OPENROUTER_API_BASE } from './providers/openRouterTransport.js'
import { DEEPSEEK_API_BASE, DEEPSEEK_MODEL } from './providers/deepSeekMultimodalTransport.js'
import {
  PRODUCTION_CLASS_REVIEW_FRAMING_CALIBRATION,
  parseClassReviewFramingCalibration,
  type ClassReviewFramingCalibration,
} from './classReviewSynthesis/framingCalibrations.js'

export type ClassReviewSynthesisRuntimeConfig =
  | { mode: 'disabled' }
  | { mode: 'fake'; serviceToken: string; maxCompletionTokens: 3072 }
  | {
    mode: 'kimi'
    serviceToken: string
    maxCompletionTokens: 3072
    apiKey: string
    framingCalibration: ClassReviewFramingCalibration
  }

export interface GatewayRuntimeConfig {
  provider: 'kimi' | 'mock' | 'openrouter' | 'deepseek'
  deepseek?: {
    apiBase: string
    model: string
    stageBudgets: Record<MultimodalProviderCallStage, number>
  }
  openrouter?: {
    apiBase: string
    model: string
    stageBudgets: Record<MultimodalProviderCallStage, number>
  }
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
  classReviewSynthesis: ClassReviewSynthesisRuntimeConfig
  kimi: {
    apiBase: string
    model: string
    reasoningEffort: 'low'
    stageBudgets: Record<MultimodalProviderCallStage, number>
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

export interface GatewayRuntimeConfigDependencies {
  classReviewFramingCalibration?: unknown
}

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

function canonicalServiceToken(value: string | undefined): string {
  const normalized = value?.trim() ?? ''
  if (normalized.length < 32 || normalized.length > 256
    || !/^[A-Za-z0-9._~-]+$/.test(normalized)) return invalidConfig()
  return normalized
}

function canonicalKimiApiKey(value: string | undefined): string {
  const normalized = value?.trim() ?? ''
  if (normalized.length < 1 || normalized.length > 512
    || !/^[\x21-\x7e]+$/.test(normalized)) return invalidConfig()
  return normalized
}

function defineRuntimeSecret<T extends object, K extends string>(
  target: T,
  key: K,
  value: string,
): T & Record<K, string> {
  Object.defineProperty(target, key, {
    value,
    enumerable: false,
    writable: false,
    configurable: false,
  })
  return target as T & Record<K, string>
}

export function parseGatewayRuntimeConfig(
  env: GatewayEnvironment,
  dependencies: GatewayRuntimeConfigDependencies = {},
): GatewayRuntimeConfig {
  const provider = exactValue(env.GRADING_PROVIDER, ['kimi', 'mock', 'openrouter', 'deepseek'] as const)
  const rubricStrategy = exactValue(env.GRADING_RUBRIC_STRATEGY, ['single-pass-v1', 'two-pass-legacy'] as const)
  const essayPromptProfile = exactValue(env.GRADING_ESSAY_PROMPT_PROFILE, ['optimized-v1', 'legacy'] as const)
  const executionRegistry = exactValue(env.GRADING_EXECUTION_REGISTRY, ['memory-v1', 'direct-legacy'] as const)
  const httpMs = positiveInteger(env.GRADING_HTTP_DEADLINE_MS)
  const providerFinalMs = positiveInteger(env.GRADING_PROVIDER_FINAL_DEADLINE_MS)
  const settlementGraceMs = positiveInteger(env.GRADING_PROVIDER_SETTLEMENT_GRACE_MS)
  const terminalTtlMs = positiveInteger(env.GRADING_REGISTRY_TERMINAL_TTL_MS)
  if (httpMs > Number.MAX_SAFE_INTEGER - 30_000 || providerFinalMs < httpMs + 30_000) return invalidConfig()
  if (providerFinalMs > Number.MAX_SAFE_INTEGER - settlementGraceMs || terminalTtlMs < providerFinalMs + settlementGraceMs) return invalidConfig()

  let openrouter: GatewayRuntimeConfig['openrouter']
  if (provider === 'openrouter') {
    const model = env.OPENROUTER_MODEL?.trim() ?? ''
    if (!isFreeOpenRouterModel(model)
      || (env.OPENROUTER_API_BASE !== undefined && env.OPENROUTER_API_BASE.trim() !== OPENROUTER_API_BASE)
      || rubricStrategy !== 'single-pass-v1' || essayPromptProfile !== 'optimized-v1'
      || executionRegistry !== 'memory-v1' || env.CLASS_REVIEW_SYNTHESIS_MODE?.trim() !== 'disabled') return invalidConfig()
    const budget = positiveInteger(env.OPENROUTER_MAX_COMPLETION_TOKENS, 16_384)
    openrouter = {
      apiBase: OPENROUTER_API_BASE, model,
      stageBudgets: { material_context: budget, rubric_generation: budget, essay_grading_images: budget, essay_regrading_text: budget },
    }
  }

  let deepseek: GatewayRuntimeConfig['deepseek']
  if (provider === 'deepseek') {
    if (env.DEEPSEEK_MODEL?.trim() !== DEEPSEEK_MODEL
      || (env.DEEPSEEK_API_BASE !== undefined && env.DEEPSEEK_API_BASE.trim() !== DEEPSEEK_API_BASE)
      || rubricStrategy !== 'single-pass-v1' || essayPromptProfile !== 'optimized-v1'
      || executionRegistry !== 'memory-v1' || env.CLASS_REVIEW_SYNTHESIS_MODE?.trim() !== 'disabled') return invalidConfig()
    const budget = positiveInteger(env.DEEPSEEK_MAX_COMPLETION_TOKENS, 16_384)
    deepseek = { apiBase: DEEPSEEK_API_BASE, model: DEEPSEEK_MODEL,
      stageBudgets: { material_context: budget, rubric_generation: budget, essay_grading_images: budget, essay_regrading_text: budget } }
  }
  // Retain the legacy shape without requiring or using credentials for other providers.
  const remote = openrouter ?? deepseek
  const apiBase = remote ? 'https://api.moonshot.cn/v1' : env.KIMI_API_BASE?.trim()
  const model = remote ? 'kimi-k3' : env.KIMI_MODEL?.trim()
  const reasoningEffort = remote ? 'low' : env.KIMI_REASONING_EFFORT?.trim()
  if (apiBase !== 'https://api.moonshot.cn/v1' || model !== 'kimi-k3' || reasoningEffort !== 'low') return invalidConfig()

  const promptCacheSecret = env.GRADING_PROMPT_CACHE_HMAC_SECRET ?? ''
  if (provider === 'kimi' && essayPromptProfile === 'optimized-v1' && Buffer.byteLength(promptCacheSecret.trim(), 'utf8') < 32) return invalidConfig()

  const classMode = exactValue(env.CLASS_REVIEW_SYNTHESIS_MODE, ['disabled', 'fake', 'kimi'] as const)
  let classReviewSynthesis: ClassReviewSynthesisRuntimeConfig
  if (classMode === 'disabled') {
    classReviewSynthesis = { mode: 'disabled' }
  } else {
    if (executionRegistry !== 'memory-v1') return invalidConfig()
    const serviceToken = canonicalServiceToken(env.CLASS_REVIEW_SERVICE_TOKEN)
    const maxCompletionTokens = exactInteger(
      env.KIMI_MAX_COMPLETION_TOKENS_CLASS_REVIEW,
      3_072,
    ) as 3072
    if (classMode === 'fake') {
      classReviewSynthesis = defineRuntimeSecret(
        { mode: 'fake' as const, maxCompletionTokens },
        'serviceToken',
        serviceToken,
      )
    } else {
      const apiKey = canonicalKimiApiKey(env.KIMI_API_KEY)
      const normalizedCacheSecret = promptCacheSecret.trim()
      const framingCalibration = parseClassReviewFramingCalibration(
        Object.prototype.hasOwnProperty.call(dependencies, 'classReviewFramingCalibration')
          ? dependencies.classReviewFramingCalibration
          : PRODUCTION_CLASS_REVIEW_FRAMING_CALIBRATION,
      )
      if (Buffer.byteLength(normalizedCacheSecret, 'utf8') < 32
        || framingCalibration === null) return invalidConfig()
      classReviewSynthesis = defineRuntimeSecret(
        defineRuntimeSecret(
          { mode: 'kimi' as const, maxCompletionTokens, framingCalibration },
          'serviceToken',
          serviceToken,
        ),
        'apiKey',
        apiKey,
      )
    }
  }

  const kimiRuntime: Omit<GatewayRuntimeConfig['kimi'], 'promptCacheSecret'> = {
    apiBase,
    model,
    reasoningEffort,
    stageBudgets: {
      material_context: remote?.stageBudgets.material_context ?? positiveInteger(env.KIMI_MAX_COMPLETION_TOKENS_MATERIAL_CONTEXT, 16_384),
      rubric_generation: remote?.stageBudgets.rubric_generation ?? positiveInteger(env.KIMI_MAX_COMPLETION_TOKENS_RUBRIC_GENERATION, 16_384),
      essay_grading_images: remote?.stageBudgets.essay_grading_images ?? positiveInteger(env.KIMI_MAX_COMPLETION_TOKENS_ESSAY_GRADING_IMAGES, 16_384),
      essay_regrading_text: remote?.stageBudgets.essay_regrading_text ?? positiveInteger(env.KIMI_MAX_COMPLETION_TOKENS_ESSAY_REGRADING_TEXT, 16_384),
    },
  }
  const kimi = defineRuntimeSecret(kimiRuntime, 'promptCacheSecret', classReviewSynthesis.mode === 'kimi'
    ? promptCacheSecret.trim()
    : promptCacheSecret)

  return {
    provider,
    ...(openrouter ? { openrouter } : {}),
    ...(deepseek ? { deepseek } : {}),
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
    classReviewSynthesis,
    kimi,
  }
}
