import { describe, expect, it } from 'vitest'
import { GatewayRuntimeConfigError, parseGatewayRuntimeConfig } from './gatewayRuntimeConfig.js'

function validEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    GRADING_PROVIDER: 'kimi',
    GRADING_RUBRIC_STRATEGY: 'two-pass-legacy',
    GRADING_ESSAY_PROMPT_PROFILE: 'legacy',
    GRADING_EXECUTION_REGISTRY: 'direct-legacy',
    GRADING_MAX_CONCURRENT_PROVIDER_CALLS: '4',
    GRADING_HTTP_DEADLINE_MS: '360000',
    GRADING_PROVIDER_FINAL_DEADLINE_MS: '420000',
    GRADING_PROVIDER_SETTLEMENT_GRACE_MS: '30000',
    GRADING_REGISTRY_TERMINAL_TTL_MS: '86400000',
    GRADING_REGISTRY_MAX_ENTRIES: '2000',
    GRADING_PROVIDER_MAX_ATTEMPTS: '2',
    GRADING_RATE_LIMIT_MAX_REQUEUES: '5',
    GRADING_RETRY_BASE_MS: '2000',
    GRADING_RETRY_CAP_MS: '60000',
    GRADING_RETRY_AFTER_PAUSE_MS: '900000',
    GRADING_PROMPT_CACHE_HMAC_SECRET: '',
    KIMI_API_BASE: 'https://api.moonshot.cn/v1',
    KIMI_MODEL: 'kimi-k3',
    KIMI_REASONING_EFFORT: 'low',
    KIMI_MAX_COMPLETION_TOKENS_MATERIAL_CONTEXT: '16384',
    KIMI_MAX_COMPLETION_TOKENS_RUBRIC_GENERATION: '12000',
    KIMI_MAX_COMPLETION_TOKENS_ESSAY_GRADING_IMAGES: '14000',
    KIMI_MAX_COMPLETION_TOKENS_ESSAY_REGRADING_TEXT: '8000',
    ...overrides,
  }
}

describe('parseGatewayRuntimeConfig', () => {
  it('parses an explicit Phase 0 China K3 runtime without enabling later optimizations', () => {
    expect(parseGatewayRuntimeConfig(validEnvironment())).toEqual({
      provider: 'kimi',
      rubricStrategy: 'two-pass-legacy',
      essayPromptProfile: 'legacy',
      executionRegistry: 'direct-legacy',
      deadlines: { httpMs: 360_000, providerFinalMs: 420_000, settlementGraceMs: 30_000 },
      admission: { hardLimit: 4 },
      registry: { terminalTtlMs: 86_400_000, maxEntries: 2_000 },
      retry: { maxProviderAttempts: 2, maxRateLimitRequeues: 5, baseMs: 2_000, capMs: 60_000, pauseAfterMs: 900_000 },
      kimi: {
        apiBase: 'https://api.moonshot.cn/v1',
        model: 'kimi-k3',
        reasoningEffort: 'low',
        stageBudgets: {
          material_context: 16_384,
          rubric_generation: 12_000,
          essay_grading_images: 14_000,
          essay_regrading_text: 8_000,
        },
        promptCacheSecret: '',
      },
    })
  })

  it('allows explicit mock without a cache secret while retaining bounded runtime settings', () => {
    expect(parseGatewayRuntimeConfig(validEnvironment({ GRADING_PROVIDER: 'mock' })).provider).toBe('mock')
  })

  it.each([
    ['missing provider', { GRADING_PROVIDER: undefined }],
    ['unsupported provider', { GRADING_PROVIDER: 'mock_failure' }],
    ['unsupported rubric strategy', { GRADING_RUBRIC_STRATEGY: 'single-pass-v2' }],
    ['unsupported essay profile', { GRADING_ESSAY_PROMPT_PROFILE: 'compressed' }],
    ['unsupported registry', { GRADING_EXECUTION_REGISTRY: 'database-v1' }],
    ['wrong API base', { KIMI_API_BASE: 'https://example.invalid/v1' }],
    ['wrong model', { KIMI_MODEL: 'kimi-k2' }],
    ['wrong reasoning effort', { KIMI_REASONING_EFFORT: 'high' }],
    ['zero stage budget', { KIMI_MAX_COMPLETION_TOKENS_MATERIAL_CONTEXT: '0' }],
    ['oversized stage budget', { KIMI_MAX_COMPLETION_TOKENS_RUBRIC_GENERATION: '16385' }],
    ['fractional stage budget', { KIMI_MAX_COMPLETION_TOKENS_ESSAY_GRADING_IMAGES: '1.5' }],
    ['missing stage budget', { KIMI_MAX_COMPLETION_TOKENS_ESSAY_REGRADING_TEXT: undefined }],
    ['zero hard limit', { GRADING_MAX_CONCURRENT_PROVIDER_CALLS: '0' }],
    ['zero registry capacity', { GRADING_REGISTRY_MAX_ENTRIES: '0' }],
    ['provider deadline too close', { GRADING_PROVIDER_FINAL_DEADLINE_MS: '389999' }],
    ['zero settlement grace', { GRADING_PROVIDER_SETTLEMENT_GRACE_MS: '0' }],
    ['TTL shorter than final tracking and settlement', { GRADING_REGISTRY_TERMINAL_TTL_MS: '449999' }],
    ['changed provider attempt limit', { GRADING_PROVIDER_MAX_ATTEMPTS: '3' }],
    ['changed rate limit requeues', { GRADING_RATE_LIMIT_MAX_REQUEUES: '4' }],
    ['changed retry base', { GRADING_RETRY_BASE_MS: '1000' }],
    ['changed retry cap', { GRADING_RETRY_CAP_MS: '60001' }],
    ['changed pause threshold', { GRADING_RETRY_AFTER_PAUSE_MS: '899999' }],
  ])('fails closed for %s', (_name, overrides) => {
    expect(() => parseGatewayRuntimeConfig(validEnvironment(overrides))).toThrow(GatewayRuntimeConfigError)
  })

  it('requires at least 32 UTF-8 secret bytes only for optimized Kimi', () => {
    expect(() => parseGatewayRuntimeConfig(validEnvironment({
      GRADING_ESSAY_PROMPT_PROFILE: 'optimized-v1',
      GRADING_PROMPT_CACHE_HMAC_SECRET: '界'.repeat(10),
    }))).toThrow(GatewayRuntimeConfigError)
    expect(() => parseGatewayRuntimeConfig(validEnvironment({
      GRADING_ESSAY_PROMPT_PROFILE: 'optimized-v1',
      GRADING_PROMPT_CACHE_HMAC_SECRET: ' '.repeat(32),
    }))).toThrow(GatewayRuntimeConfigError)
    expect(parseGatewayRuntimeConfig(validEnvironment({
      GRADING_ESSAY_PROMPT_PROFILE: 'optimized-v1',
      GRADING_PROMPT_CACHE_HMAC_SECRET: '界'.repeat(11),
    })).kimi.promptCacheSecret).toBe('界'.repeat(11))
    expect(parseGatewayRuntimeConfig(validEnvironment({
      GRADING_PROVIDER: 'mock',
      GRADING_ESSAY_PROMPT_PROFILE: 'optimized-v1',
      GRADING_PROMPT_CACHE_HMAC_SECRET: '',
    })).kimi.promptCacheSecret).toBe('')
  })

  it('throws one content-free error instead of echoing invalid fields or values', () => {
    const privateMarker = 'PRIVATE-CONFIG-MARKER'
    let thrown: unknown
    try {
      parseGatewayRuntimeConfig(validEnvironment({ KIMI_MODEL: privateMarker }))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(GatewayRuntimeConfigError)
    expect(String(thrown)).toBe('GatewayRuntimeConfigError: Invalid grading gateway runtime configuration.')
    expect(JSON.stringify(thrown)).not.toMatch(/PRIVATE|KIMI_MODEL|CONFIG-MARKER/)
  })
})
