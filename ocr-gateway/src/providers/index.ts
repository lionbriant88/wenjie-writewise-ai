import type { GatewayProviderName } from '../types.js'
import { FailureOcrProvider } from './failureOcrProvider.js'
import { MockOcrProvider } from './mockOcrProvider.js'
import { PaddleLocalOcrProvider } from './paddleLocalOcrProvider.js'
import type { OcrProvider } from './providerTypes.js'

export function getProvider(name: string | undefined = process.env.OCR_PROVIDER): OcrProvider {
  const providerName: GatewayProviderName | string = name ?? 'mock'

  switch (providerName) {
    case 'mock':
      return new MockOcrProvider()
    case 'mock_failure':
      return new FailureOcrProvider()
    case 'paddle_local':
      return new PaddleLocalOcrProvider()
    default:
      throw new Error('Unsupported OCR provider.')
  }
}
