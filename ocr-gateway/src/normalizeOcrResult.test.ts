import { describe, expect, it } from 'vitest'
import { normalizeProviderResult } from './normalizeOcrResult.js'
import type { GatewayRecognizeInput, OcrPageResult } from './types.js'

function inputWithPages(pageIds: string[]): GatewayRecognizeInput {
  return {
    essayGroupId: 'group-1',
    pages: pageIds.map((pageId) => ({
      pageId,
      originalName: `${pageId}.png`,
      mimeType: 'image/png',
      size: 12,
      buffer: Buffer.from('fake-image'),
    })),
  }
}

describe('normalizeProviderResult', () => {
  it('merges text by request page order instead of provider result order', () => {
    const result = normalizeProviderResult({
      input: inputWithPages(['page-b', 'page-a']),
      providerPages: [
        { pageId: 'page-a', text: 'Second page text' },
        { pageId: 'page-b', text: 'First page text' },
      ],
    })

    expect(result.text).toBe('First page text\n\nSecond page text')
    expect(result.pages.map((page) => page.pageId)).toEqual(['page-b', 'page-a'])
  })

  it('adds an empty-text warning without failing the whole result', () => {
    const result = normalizeProviderResult({
      input: inputWithPages(['page-1']),
      providerPages: [{ pageId: 'page-1', text: '   ' }],
    })

    expect(result.status).toBe('success')
    expect(result.text).toBe('')
    expect(result.pages[0].warnings).toContain('empty_text')
  })

  it('returns partial when one requested page is missing', () => {
    const result = normalizeProviderResult({
      input: inputWithPages(['page-1', 'page-2']),
      providerPages: [{ pageId: 'page-1', text: 'Recognized text' }],
    })

    expect(result.status).toBe('partial')
    expect(result.pages[1]).toEqual({
      pageId: 'page-2',
      text: '',
      warnings: ['page_not_recognized', 'empty_text'],
    } satisfies OcrPageResult)
  })
})
