import { describe, expect, it, vi } from 'vitest'
import type { GatewayRuntimeConfig } from '../gatewayRuntimeConfig.js'
import { KimiMultimodalProvider } from './kimiMultimodalProvider.js'
import type { MultimodalProvider } from './multimodalProviderTypes.js'
import type { KimiCompletionInput, KimiTransport } from './kimiTransport.js'
import { createStageBudgetedTransport, getMultimodalProvider, getProvider } from './index.js'
import { GradingProviderError } from './providerTypes.js'

function runtimeConfig(provider: 'kimi' | 'mock' = 'kimi'): GatewayRuntimeConfig {
  return {
    provider,
    rubricStrategy: 'two-pass-legacy',
    essayPromptProfile: 'legacy',
    executionRegistry: 'direct-legacy',
    deadlines: { httpMs: 360_000, providerFinalMs: 420_000, settlementGraceMs: 30_000 },
    admission: { hardLimit: 4 },
    registry: { terminalTtlMs: 86_400_000, maxEntries: 2_000 },
    retry: { maxProviderAttempts: 2, maxRateLimitRequeues: 5, baseMs: 2_000, capMs: 60_000, pauseAfterMs: 900_000 },
    kimi: {
      apiBase: 'https://api.moonshot.cn/v1', model: 'kimi-k3', reasoningEffort: 'low', promptCacheSecret: '',
      stageBudgets: { material_context: 1_001, rubric_generation: 2_002, essay_grading_images: 3_003, essay_regrading_text: 4_004 },
    },
  }
}

describe('provider selection', () => {
  it('selects only the explicit legacy mock and failure providers', () => {
    expect(getProvider('mock').publicName).toBe('mock')
    expect(getProvider('mock_failure').publicName).toBe('remote')
    expect(() => getProvider(undefined)).toThrow(GradingProviderError)
  })

  it('constructs Kimi only from typed runtime config and an explicit secret dependency', () => {
    expect(getMultimodalProvider(runtimeConfig(), { apiKey: 'test-kimi-api-key-not-real' })).toBeInstanceOf(KimiMultimodalProvider)
    expect(() => getMultimodalProvider(runtimeConfig(), { apiKey: '' })).toThrowError(GradingProviderError)
    expect(() => getMultimodalProvider(runtimeConfig(), {})).toThrowError(GradingProviderError)
  })

  it('allows explicit mock only through an injected multimodal factory and requires no Kimi key', () => {
    const fakeProvider = {} as MultimodalProvider
    expect(getMultimodalProvider(runtimeConfig('mock'), { mockFactory: () => fakeProvider })).toBe(fakeProvider)
    expect(() => getMultimodalProvider(runtimeConfig('mock'))).toThrowError(GradingProviderError)
  })

  it('overrides every Provider call with the independent budget for its actual stage', async () => {
    const complete = vi.fn(async (input: KimiCompletionInput) => ({
      value: { stage: input.stage },
      observation: {
        attemptDiagnosticId: '11111111-1111-4111-8111-111111111111',
        finishReason: 'stop' as const,
        usage: {
          promptTokens: { status: 'unknown' as const, reason: 'absent' as const },
          completionTokens: { status: 'unknown' as const, reason: 'absent' as const },
          totalTokens: { status: 'unknown' as const, reason: 'absent' as const },
          cachedTokens: { status: 'unknown' as const, reason: 'absent' as const },
        },
        providerElapsedMs: 1,
      },
    }))
    const base: KimiTransport = { maxCompletionTokens: 777, complete }
    const config = runtimeConfig()
    const transport = createStageBudgetedTransport(base, config.kimi.stageBudgets)

    for (const stage of ['material_context', 'rubric_generation', 'essay_grading_images', 'essay_regrading_text'] as const) {
      await transport.complete({
        messages: [], schemaName: 'test', schema: {}, signal: new AbortController().signal,
        stage, maxCompletionTokens: 1, attempt: 1, diagnosticContext: '22222222-2222-4222-8222-222222222222',
      })
    }

    expect(complete.mock.calls.map(([input]) => [input.stage, input.maxCompletionTokens])).toEqual([
      ['material_context', 1_001],
      ['rubric_generation', 2_002],
      ['essay_grading_images', 3_003],
      ['essay_regrading_text', 4_004],
    ])
  })
})
