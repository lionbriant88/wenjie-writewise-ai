import { describe, expect, it } from 'vitest'
import { FailureOcrProvider } from './failureOcrProvider.js'
import { getProvider } from './index.js'
import { MockOcrProvider } from './mockOcrProvider.js'
import { PaddleLocalOcrProvider } from './paddleLocalOcrProvider.js'

describe('getProvider', () => {
  it('defaults to the mock provider', () => {
    expect(getProvider(undefined)).toBeInstanceOf(MockOcrProvider)
  })

  it('selects the controlled failure provider', () => {
    expect(getProvider('mock_failure')).toBeInstanceOf(FailureOcrProvider)
  })

  it('selects the local PaddleOCR provider', () => {
    expect(getProvider('paddle_local')).toBeInstanceOf(PaddleLocalOcrProvider)
  })
})
