import type { GatewayRecognizeInput, OcrEssayResult, OcrPageResult } from './types.js'

interface NormalizeProviderResultInput {
  input: GatewayRecognizeInput
  providerPages: OcrPageResult[]
}

function normalizeText(text: string | undefined) {
  return (text ?? '').trim()
}

function hasPageFailure(page: OcrPageResult) {
  return page.warnings?.some((warning) => warning === 'page_not_recognized' || warning === 'paddle_page_failed') ?? false
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

  const failedPageCount = pages.filter(hasPageFailure).length
  const status = failedPageCount === 0 ? 'success' : failedPageCount === pages.length ? 'failed' : 'partial'

  return {
    essayGroupId: input.essayGroupId,
    text: pages.map((page) => page.text).filter(Boolean).join('\n\n'),
    pages,
    provider: 'remote',
    status,
    error: status === 'failed' ? 'OCR 识别失败，请使用 mock 草稿或手动输入。' : undefined,
  }
}
