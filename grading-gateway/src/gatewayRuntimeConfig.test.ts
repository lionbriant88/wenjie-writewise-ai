import { describe, expect, it } from 'vitest'
import type { ClassReviewFramingCalibration } from './classReviewSynthesis/framingCalibrations.js'
import { GatewayRuntimeConfigError, parseGatewayRuntimeConfig } from './gatewayRuntimeConfig.js'

const syntheticClassReviewCalibration: ClassReviewFramingCalibration = {
  apiBase: 'https://api.moonshot.cn/v1',
  model: 'kimi-k3',
  reasoningEffort: 'low',
  policyVersion: 'class-review-policy-v1',
  schemaVersion: 'kimi-class-review-output-v1',
  projectionVersion: 'class-review-projection-v1',
  budgetVersion: 'class-review-prompt-budget-v1',
  wireSerializationVersion: 'class-review-wire-serialization-v1',
  framingTokens: 512,
}

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
    CLASS_REVIEW_SYNTHESIS_MODE: 'disabled',
    CLASS_REVIEW_SERVICE_TOKEN: '',
    KIMI_API_BASE: 'https://api.moonshot.cn/v1',
    KIMI_MODEL: 'kimi-k3',
    KIMI_REASONING_EFFORT: 'low',
    KIMI_API_KEY: '',
    KIMI_MAX_COMPLETION_TOKENS_CLASS_REVIEW: '3072',
    KIMI_MAX_COMPLETION_TOKENS_MATERIAL_CONTEXT: '16384',
    KIMI_MAX_COMPLETION_TOKENS_RUBRIC_GENERATION: '12000',
    KIMI_MAX_COMPLETION_TOKENS_ESSAY_GRADING_IMAGES: '14000',
    KIMI_MAX_COMPLETION_TOKENS_ESSAY_REGRADING_TEXT: '8000',
    ...overrides,
  }
}

describe('parseGatewayRuntimeConfig', () => {
  it('parses an explicit Phase 0 China K3 runtime without enabling later optimizations', () => {
    const config = parseGatewayRuntimeConfig(validEnvironment())
    expect(config).toEqual({
      provider: 'kimi',
      rubricStrategy: 'two-pass-legacy',
      essayPromptProfile: 'legacy',
      executionRegistry: 'direct-legacy',
      deadlines: { httpMs: 360_000, providerFinalMs: 420_000, settlementGraceMs: 30_000 },
      admission: { hardLimit: 4 },
      registry: { terminalTtlMs: 86_400_000, maxEntries: 2_000 },
      retry: { maxProviderAttempts: 2, maxRateLimitRequeues: 5, baseMs: 2_000, capMs: 60_000, pauseAfterMs: 900_000 },
      classReviewSynthesis: { mode: 'disabled' },
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
      },
    })
    expect(config.kimi.promptCacheSecret).toBe('')
  })

  it('allows explicit mock without a cache secret while retaining bounded runtime settings', () => {
    expect(parseGatewayRuntimeConfig(validEnvironment({ GRADING_PROVIDER: 'mock' })).provider).toBe('mock')
  })

  it('accepts each explicit class-review mode without inferring it from the essay Provider', () => {
    const rawToken = `  ${'s'.repeat(32)}  `
    const fake = parseGatewayRuntimeConfig(validEnvironment({
      GRADING_PROVIDER: 'mock',
      GRADING_EXECUTION_REGISTRY: 'memory-v1',
      CLASS_REVIEW_SYNTHESIS_MODE: 'fake',
      CLASS_REVIEW_SERVICE_TOKEN: rawToken,
    }))
    expect(fake.classReviewSynthesis).toEqual({
      mode: 'fake',
      maxCompletionTokens: 3_072,
    })
    expect(fake.classReviewSynthesis.mode).toBe('fake')
    if (fake.classReviewSynthesis.mode !== 'fake') throw new Error('Expected fake class-review runtime.')
    expect(fake.classReviewSynthesis.serviceToken).toBe('s'.repeat(32))
    expect(Object.getOwnPropertyDescriptor(fake.classReviewSynthesis, 'serviceToken')).toMatchObject({
      enumerable: false,
      value: 's'.repeat(32),
    })
    const punctuationTokenConfig = parseGatewayRuntimeConfig(validEnvironment({
      GRADING_PROVIDER: 'mock',
      GRADING_EXECUTION_REGISTRY: 'memory-v1',
      CLASS_REVIEW_SYNTHESIS_MODE: 'fake',
      CLASS_REVIEW_SERVICE_TOKEN: 'A._~-z09'.repeat(32),
    }))
    expect(punctuationTokenConfig.classReviewSynthesis.mode).toBe('fake')
    if (punctuationTokenConfig.classReviewSynthesis.mode !== 'fake') throw new Error('Expected fake class-review runtime.')
    expect(punctuationTokenConfig.classReviewSynthesis.serviceToken).toBe('A._~-z09'.repeat(32))

    const kimi = parseGatewayRuntimeConfig(validEnvironment({
      GRADING_PROVIDER: 'mock',
      GRADING_EXECUTION_REGISTRY: 'memory-v1',
      CLASS_REVIEW_SYNTHESIS_MODE: 'kimi',
      CLASS_REVIEW_SERVICE_TOKEN: 's'.repeat(32),
      KIMI_API_KEY: '  synthetic-not-a-real-key  ',
      GRADING_PROMPT_CACHE_HMAC_SECRET: 'c'.repeat(32),
    }), { classReviewFramingCalibration: syntheticClassReviewCalibration })
    expect(kimi.classReviewSynthesis).toEqual({
      mode: 'kimi',
      maxCompletionTokens: 3_072,
      framingCalibration: syntheticClassReviewCalibration,
    })
    expect(kimi.classReviewSynthesis.mode).toBe('kimi')
    if (kimi.classReviewSynthesis.mode !== 'kimi') throw new Error('Expected Kimi class-review runtime.')
    expect(kimi.classReviewSynthesis.serviceToken).toBe('s'.repeat(32))
    expect(kimi.classReviewSynthesis.apiKey).toBe('synthetic-not-a-real-key')
    expect(kimi.provider).toBe('mock')
    const maximumKey = parseGatewayRuntimeConfig(validEnvironment({
      GRADING_PROVIDER: 'mock',
      GRADING_EXECUTION_REGISTRY: 'memory-v1',
      CLASS_REVIEW_SYNTHESIS_MODE: 'kimi',
      CLASS_REVIEW_SERVICE_TOKEN: 's'.repeat(32),
      KIMI_API_KEY: 'K'.repeat(512),
      GRADING_PROMPT_CACHE_HMAC_SECRET: 'c'.repeat(32),
    }), { classReviewFramingCalibration: syntheticClassReviewCalibration })
    expect(maximumKey.classReviewSynthesis.mode).toBe('kimi')
    if (maximumKey.classReviewSynthesis.mode !== 'kimi') throw new Error('Expected Kimi class-review runtime.')
    expect(maximumKey.classReviewSynthesis.apiKey).toBe('K'.repeat(512))
  })

  it('keeps normalized runtime secrets directly accessible but omits them from whole-config serialization', () => {
    const serviceToken = `SERVICE_TOKEN_SENTINEL.${'s'.repeat(32)}`
    const apiKey = `KIMI_API_KEY_SENTINEL-${'k'.repeat(32)}`
    const promptCacheSecret = `CACHE_SECRET_SENTINEL.${'c'.repeat(32)}`
    const config = parseGatewayRuntimeConfig(validEnvironment({
      GRADING_PROVIDER: 'mock',
      GRADING_EXECUTION_REGISTRY: 'memory-v1',
      CLASS_REVIEW_SYNTHESIS_MODE: 'kimi',
      CLASS_REVIEW_SERVICE_TOKEN: `  ${serviceToken}  `,
      KIMI_API_KEY: `  ${apiKey}  `,
      GRADING_PROMPT_CACHE_HMAC_SECRET: `  ${promptCacheSecret}  `,
    }), { classReviewFramingCalibration: syntheticClassReviewCalibration })

    expect(config.classReviewSynthesis.mode).toBe('kimi')
    if (config.classReviewSynthesis.mode !== 'kimi') throw new Error('Expected Kimi class-review runtime.')
    expect(config.classReviewSynthesis.serviceToken).toBe(serviceToken)
    expect(config.classReviewSynthesis.apiKey).toBe(apiKey)
    expect(config.kimi.promptCacheSecret).toBe(promptCacheSecret)

    for (const [owner, key, value] of [
      [config.classReviewSynthesis, 'serviceToken', serviceToken],
      [config.classReviewSynthesis, 'apiKey', apiKey],
      [config.kimi, 'promptCacheSecret', promptCacheSecret],
    ] as const) {
      expect(Object.hasOwn(owner, key)).toBe(true)
      const descriptor = Object.getOwnPropertyDescriptor(owner, key)
      expect(descriptor).toMatchObject({ enumerable: false, value })
      expect(descriptor).not.toHaveProperty('get')
    }

    const serialized = JSON.stringify(config)
    expect(serialized).not.toContain(serviceToken)
    expect(serialized).not.toContain(apiKey)
    expect(serialized).not.toContain(promptCacheSecret)
  })

  it('keeps disabled class synthesis independent from its optional token and real Kimi prerequisites', () => {
    const config = parseGatewayRuntimeConfig(validEnvironment({
      GRADING_PROVIDER: 'mock',
      CLASS_REVIEW_SYNTHESIS_MODE: 'disabled',
      CLASS_REVIEW_SERVICE_TOKEN: undefined,
      KIMI_MAX_COMPLETION_TOKENS_CLASS_REVIEW: undefined,
      KIMI_API_KEY: undefined,
      GRADING_PROMPT_CACHE_HMAC_SECRET: '',
    }))
    expect(config.classReviewSynthesis).toEqual({ mode: 'disabled' })
    const ignored = parseGatewayRuntimeConfig(validEnvironment({
      CLASS_REVIEW_SYNTHESIS_MODE: 'disabled',
      CLASS_REVIEW_SERVICE_TOKEN: 'PRIVATE-DISABLED-TOKEN',
      KIMI_MAX_COMPLETION_TOKENS_CLASS_REVIEW: '3073',
      KIMI_API_KEY: 'PRIVATE-DISABLED-KEY',
      GRADING_PROMPT_CACHE_HMAC_SECRET: '',
    }), { classReviewFramingCalibration: { private: 'PRIVATE-CALIBRATION' } })
    expect(ignored.classReviewSynthesis).toEqual({ mode: 'disabled' })
    expect(JSON.stringify(ignored.classReviewSynthesis)).not.toMatch(/PRIVATE|token|key|calibration/i)
  })

  it.each([
    ['missing mode', { CLASS_REVIEW_SYNTHESIS_MODE: undefined }],
    ['unknown mode', { CLASS_REVIEW_SYNTHESIS_MODE: 'mock' }],
    ['blank enabled token', { CLASS_REVIEW_SYNTHESIS_MODE: 'fake', CLASS_REVIEW_SERVICE_TOKEN: ' '.repeat(40), GRADING_EXECUTION_REGISTRY: 'memory-v1' }],
    ['short enabled token', { CLASS_REVIEW_SYNTHESIS_MODE: 'fake', CLASS_REVIEW_SERVICE_TOKEN: 'a'.repeat(31), GRADING_EXECUTION_REGISTRY: 'memory-v1' }],
    ['Unicode enabled token', { CLASS_REVIEW_SYNTHESIS_MODE: 'fake', CLASS_REVIEW_SERVICE_TOKEN: '界'.repeat(32), GRADING_EXECUTION_REGISTRY: 'memory-v1' }],
    ['whitespace-bearing enabled token', { CLASS_REVIEW_SYNTHESIS_MODE: 'fake', CLASS_REVIEW_SERVICE_TOKEN: `${'a'.repeat(32)} b`, GRADING_EXECUTION_REGISTRY: 'memory-v1' }],
    ['control-bearing enabled token', { CLASS_REVIEW_SYNTHESIS_MODE: 'fake', CLASS_REVIEW_SERVICE_TOKEN: `${'a'.repeat(32)}\u0000`, GRADING_EXECUTION_REGISTRY: 'memory-v1' }],
    ['padded enabled token', { CLASS_REVIEW_SYNTHESIS_MODE: 'fake', CLASS_REVIEW_SERVICE_TOKEN: `${'a'.repeat(32)}=`, GRADING_EXECUTION_REGISTRY: 'memory-v1' }],
    ['oversized enabled token', { CLASS_REVIEW_SYNTHESIS_MODE: 'fake', CLASS_REVIEW_SERVICE_TOKEN: 'a'.repeat(257), GRADING_EXECUTION_REGISTRY: 'memory-v1' }],
    ['enabled direct execution', { CLASS_REVIEW_SYNTHESIS_MODE: 'fake', CLASS_REVIEW_SERVICE_TOKEN: 's'.repeat(32), GRADING_EXECUTION_REGISTRY: 'direct-legacy' }],
    ['class completion budget -1', { CLASS_REVIEW_SYNTHESIS_MODE: 'fake', CLASS_REVIEW_SERVICE_TOKEN: 's'.repeat(32), GRADING_EXECUTION_REGISTRY: 'memory-v1', KIMI_MAX_COMPLETION_TOKENS_CLASS_REVIEW: '3071' }],
    ['class completion budget +1', { CLASS_REVIEW_SYNTHESIS_MODE: 'fake', CLASS_REVIEW_SERVICE_TOKEN: 's'.repeat(32), GRADING_EXECUTION_REGISTRY: 'memory-v1', KIMI_MAX_COMPLETION_TOKENS_CLASS_REVIEW: '3073' }],
    ['class completion budget fractional', { CLASS_REVIEW_SYNTHESIS_MODE: 'fake', CLASS_REVIEW_SERVICE_TOKEN: 's'.repeat(32), GRADING_EXECUTION_REGISTRY: 'memory-v1', KIMI_MAX_COMPLETION_TOKENS_CLASS_REVIEW: '3072.5' }],
    ['class completion budget missing', { CLASS_REVIEW_SYNTHESIS_MODE: 'fake', CLASS_REVIEW_SERVICE_TOKEN: 's'.repeat(32), GRADING_EXECUTION_REGISTRY: 'memory-v1', KIMI_MAX_COMPLETION_TOKENS_CLASS_REVIEW: undefined }],
  ])('fails closed for class config: %s', (_name, overrides) => {
    expect(() => parseGatewayRuntimeConfig(validEnvironment(overrides))).toThrow(GatewayRuntimeConfigError)
  })

  it.each([
    ['missing Kimi API key', { KIMI_API_KEY: undefined, GRADING_PROMPT_CACHE_HMAC_SECRET: 'c'.repeat(32) }],
    ['blank Kimi API key', { KIMI_API_KEY: '   ', GRADING_PROMPT_CACHE_HMAC_SECRET: 'c'.repeat(32) }],
    ['missing cache secret', { KIMI_API_KEY: 'synthetic-not-a-real-key', GRADING_PROMPT_CACHE_HMAC_SECRET: undefined }],
    ['short cache secret', { KIMI_API_KEY: 'synthetic-not-a-real-key', GRADING_PROMPT_CACHE_HMAC_SECRET: 'c'.repeat(31) }],
    ['Unicode Kimi API key', { KIMI_API_KEY: '界'.repeat(32), GRADING_PROMPT_CACHE_HMAC_SECRET: 'c'.repeat(32) }],
    ['whitespace-bearing Kimi API key', { KIMI_API_KEY: 'synthetic key', GRADING_PROMPT_CACHE_HMAC_SECRET: 'c'.repeat(32) }],
    ['control-bearing Kimi API key', { KIMI_API_KEY: `synthetic\u0000key`, GRADING_PROMPT_CACHE_HMAC_SECRET: 'c'.repeat(32) }],
    ['oversized Kimi API key', { KIMI_API_KEY: 'K'.repeat(513), GRADING_PROMPT_CACHE_HMAC_SECRET: 'c'.repeat(32) }],
  ])('fails closed for Kimi class synthesis with %s', (_name, overrides) => {
    expect(() => parseGatewayRuntimeConfig(validEnvironment({
      GRADING_PROVIDER: 'mock',
      GRADING_EXECUTION_REGISTRY: 'memory-v1',
      CLASS_REVIEW_SYNTHESIS_MODE: 'kimi',
      CLASS_REVIEW_SERVICE_TOKEN: 's'.repeat(32),
      ...overrides,
    }), { classReviewFramingCalibration: syntheticClassReviewCalibration })).toThrow(GatewayRuntimeConfigError)
  })

  it('fails Kimi class synthesis closed when production framing calibration is absent or inexact', () => {
    const environment = validEnvironment({
      GRADING_PROVIDER: 'mock',
      GRADING_EXECUTION_REGISTRY: 'memory-v1',
      CLASS_REVIEW_SYNTHESIS_MODE: 'kimi',
      CLASS_REVIEW_SERVICE_TOKEN: 's'.repeat(32),
      KIMI_API_KEY: 'synthetic-not-a-real-key',
      GRADING_PROMPT_CACHE_HMAC_SECRET: 'c'.repeat(32),
    })
    expect(() => parseGatewayRuntimeConfig(environment)).toThrow(GatewayRuntimeConfigError)
    expect(() => parseGatewayRuntimeConfig(environment, {
      classReviewFramingCalibration: null,
    })).toThrow(GatewayRuntimeConfigError)
    expect(() => parseGatewayRuntimeConfig(environment, {
      classReviewFramingCalibration: { ...syntheticClassReviewCalibration, framingTokens: 513 },
    })).toThrow(GatewayRuntimeConfigError)
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
