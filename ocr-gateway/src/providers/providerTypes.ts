import type { GatewayRecognizeInput, OcrEssayResult } from '../types.js'

export interface OcrProvider {
  recognize(input: GatewayRecognizeInput): Promise<OcrEssayResult>
}
