import { describe, expect, it } from 'vitest'
import { GradingProviderError } from './providerTypes.js'
import type { MultimodalProvider } from './multimodalProviderTypes.js'
import { KimiMultimodalProvider } from './kimiMultimodalProvider.js'
import { getMultimodalProvider, getProvider, parseGradingTimeoutMs, parseKimiConfig } from './index.js'

describe('getProvider', () => {
  it('selects only the explicit mock and failure providers', () => {
    expect(getProvider('mock').publicName).toBe('mock')
    expect(getProvider('mock_failure').publicName).toBe('remote')
  })

  it.each(['unknown', ''])('fails closed for unavailable provider %s', (name) => {
    expect(() => getProvider(name)).toThrow(GradingProviderError)
    try {
      getProvider(name)
    } catch (error) {
      expect(error).toMatchObject({ code: 'provider_not_configured', retryable: false })
    }
  })

  it('registers kimi and no longer registers deepseek', () => {
    const fakeProvider = {} as MultimodalProvider
    expect(getMultimodalProvider('kimi', { kimiFactory: () => fakeProvider })).toBe(fakeProvider)
    expect(() => getMultimodalProvider('deepseek')).toThrowError(/涓嶅彈鏀寔/)
  })

  it('constructs the Kimi multimodal provider from an explicit test API key', () => {
    const previousKey = process.env.KIMI_API_KEY
    process.env.KIMI_API_KEY = 'test-kimi-api-key-not-real'
    try {
      expect(getMultimodalProvider('kimi')).toBeInstanceOf(KimiMultimodalProvider)
    } finally {
      if (previousKey === undefined) delete process.env.KIMI_API_KEY
      else process.env.KIMI_API_KEY = previousKey
    }
  })

  it('parses supported Kimi settings and rejects invalid reasoning effort', () => {
    expect(parseKimiConfig({
      KIMI_API_BASE: 'https://api.moonshot.ai/v1',
      KIMI_MODEL: 'kimi-k3',
      KIMI_REASONING_EFFORT: 'high',
      KIMI_MAX_COMPLETION_TOKENS: '8192',
    })).toEqual({
      apiBase: 'https://api.moonshot.ai/v1', model: 'kimi-k3', reasoningEffort: 'high', maxCompletionTokens: 8192,
    })
    expect(() => parseKimiConfig({ KIMI_REASONING_EFFORT: 'auto' })).toThrowError(/閰嶇疆鏃犳晥/)
  })

  it('accepts max reasoning effort', () => {
    expect(parseKimiConfig({ KIMI_REASONING_EFFORT: 'max' }).reasoningEffort).toBe('max')
  })

  it('rejects medium reasoning effort', () => {
    expect(() => parseKimiConfig({ KIMI_REASONING_EFFORT: 'medium' })).toThrow(GradingProviderError)
  })

  it('validates the Gateway timeout with a 60-second fallback', () => {
    expect(parseGradingTimeoutMs(undefined)).toBe(60_000)
    expect(parseGradingTimeoutMs('1500')).toBe(1500)
    expect(parseGradingTimeoutMs('0')).toBe(60_000)
    expect(parseGradingTimeoutMs('1.5')).toBe(60_000)
    expect(parseGradingTimeoutMs('invalid')).toBe(60_000)
  })
})
