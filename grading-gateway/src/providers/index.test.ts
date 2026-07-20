import { describe, expect, it } from 'vitest'
import { GradingProviderError } from './providerTypes.js'
import { getProvider, parseDeepSeekGenerationConfig, parseGradingTimeoutMs } from './index.js'

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

  it('constructs the DeepSeek Provider from server-only environment values', () => {
    expect(getProvider('deepseek', {
      env: {
        DEEPSEEK_API_KEY: 'test-only-not-a-real-key',
        DEEPSEEK_MODEL: 'deepseek-v4-flash',
        DEEPSEEK_THINKING_MODE: 'disabled',
        DEEPSEEK_TEMPERATURE: '0',
        DEEPSEEK_MAX_TOKENS: '8192',
      },
    }).publicName).toBe('remote')
  })

  it('parses explicit generation settings and safe defaults', () => {
    expect(parseDeepSeekGenerationConfig({})).toEqual({
      thinkingMode: 'disabled', temperature: 0, maxTokens: 8192,
    })
    expect(parseDeepSeekGenerationConfig({
      DEEPSEEK_THINKING_MODE: 'enabled', DEEPSEEK_TEMPERATURE: '0.7', DEEPSEEK_MAX_TOKENS: '4096',
    })).toEqual({ thinkingMode: 'enabled', temperature: 0.7, maxTokens: 4096 })
  })

  it.each([
    [{ DEEPSEEK_THINKING_MODE: 'auto' }],
    [{ DEEPSEEK_TEMPERATURE: '-1' }],
    [{ DEEPSEEK_TEMPERATURE: '3' }],
    [{ DEEPSEEK_MAX_TOKENS: '1.5' }],
    [{ DEEPSEEK_MAX_TOKENS: '0' }],
  ])('rejects invalid DeepSeek generation configuration %#', (env) => {
    expect(() => parseDeepSeekGenerationConfig(env)).toThrow(GradingProviderError)
  })

  it('validates the Gateway timeout with a 60-second fallback', () => {
    expect(parseGradingTimeoutMs(undefined)).toBe(60_000)
    expect(parseGradingTimeoutMs('1500')).toBe(1500)
    expect(parseGradingTimeoutMs('0')).toBe(60_000)
    expect(parseGradingTimeoutMs('1.5')).toBe(60_000)
    expect(parseGradingTimeoutMs('invalid')).toBe(60_000)
  })
})
