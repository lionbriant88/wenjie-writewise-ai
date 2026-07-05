import type { GatewayRecognizeInput, OcrEssayResult, OcrPageResult } from './types.js'

interface NormalizeProviderResultInput {
  input: GatewayRecognizeInput
  providerPages: OcrPageResult[]
}

function normalizeText(text: string | undefined) {
  return (text ?? '').trim()
}

export function normalizeProviderResult({ input, providerPages }: NormalizeProviderResultInput): OcrEssayResult {
  const pagesById = new Map(providerPages.map((page) => [page.pageId, page]))

  const pages = input.pages.map((requestPage): OcrPageResult => {
    const providerPage = pagesById.get(requestPage.pageId)
    const text = normalizeText(providerPage?.text)
    const warnings = [...(providerPage?.warnings ?? [])]

    if (!providerPage) warnings.push('page_not_recognized')
    if (text.length === 0) warnings.push('empty_text')

    return {
      pageId: requestPage.pageId,
      text,
      confidence: providerPage?.confidence,
      warnings: warnings.length > 0 ? warnings : undefined,
    }
  })

  const missingPageCount = pages.filter((page) => page.warnings?.includes('page_not_recognized')).length
  const status = missingPageCount === 0 ? 'success' : missingPageCount === pages.length ? 'failed' : 'partial'

  return {
    essayGroupId: input.essayGroupId,
    text: pages.map((page) => page.text).filter(Boolean).join('\n\n'),
    pages,
    provider: 'remote',
    status,
    error: status === 'failed' ? 'OCR 识别失败，请使用 mock 草稿或手动输入。' : undefined,
  }
}
