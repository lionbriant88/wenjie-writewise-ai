import { normalizeProviderResult } from '../normalizeOcrResult.js'
import type { GatewayRecognizeInput } from '../types.js'
import type { OcrProvider } from './providerTypes.js'

export class MockOcrProvider implements OcrProvider {
  async recognize(input: GatewayRecognizeInput) {
    return normalizeProviderResult({
      input,
      providerPages: input.pages.map((page, index) => ({
        pageId: page.pageId,
        text: [
          `作文图片 ${index + 1}：${page.originalName}`,
          'Dear Sir or Madam,',
          'I am writing to share my suggestion for this activity.',
          'I believe it will help students improve their English writing.',
        ].join('\n'),
        confidence: 0.88,
      })),
    })
  }
}
