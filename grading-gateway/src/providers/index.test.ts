import { describe, expect, it } from 'vitest'
import { GradingProviderError } from './providerTypes.js'
import { getProvider } from './index.js'

describe('getProvider', () => {
  it('selects only the explicit mock and failure providers', () => {
    expect(getProvider('mock').publicName).toBe('mock')
    expect(getProvider('mock_failure').publicName).toBe('remote')
  })

  it.each(['unknown', '', 'deepseek'])('fails closed for unavailable provider %s', (name) => {
    expect(() => getProvider(name)).toThrow(GradingProviderError)
    try {
      getProvider(name)
    } catch (error) {
      expect(error).toMatchObject({ code: 'provider_not_configured', retryable: false })
    }
  })
})
