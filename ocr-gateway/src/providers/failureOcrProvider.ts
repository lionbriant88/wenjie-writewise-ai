import type { GatewayRecognizeInput, OcrEssayResult } from '../types.js'
import type { OcrProvider } from './providerTypes.js'

export class FailureOcrProvider implements OcrProvider {
  async recognize(input: GatewayRecognizeInput): Promise<OcrEssayResult> {
    return {
      essayGroupId: input.essayGroupId,
      text: '',
      pages: input.pages.map((page) => ({
        pageId: page.pageId,
        text: '',
        warnings: ['mock_failure'],
      })),
      provider: 'remote',
      status: 'failed',
      error: 'OCR Gateway mock failure: 请使用 mock 草稿或手动输入。',
    }
  }
}
