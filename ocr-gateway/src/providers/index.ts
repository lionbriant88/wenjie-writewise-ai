import type { GatewayProviderName } from '../types.js'
import { FailureOcrProvider } from './failureOcrProvider.js'
import { MockOcrProvider } from './mockOcrProvider.js'
import type { OcrProvider } from './providerTypes.js'

export function getProvider(name: string | undefined = process.env.OCR_PROVIDER): OcrProvider {
  const providerName = (name ?? 'mock') as GatewayProviderName

  if (providerName === 'mock_failure') {
    return new FailureOcrProvider()
  }

  return new MockOcrProvider()
}
