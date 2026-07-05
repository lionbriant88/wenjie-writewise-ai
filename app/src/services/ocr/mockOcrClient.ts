import type { EssayPage } from '../../types'
import type { OcrClient, OcrEssayResult } from './types'

function buildPageOcrDraft(page: EssayPage, index: number) {
  return [
    `作文图片 ${index + 1}：${page.label}`,
    'Dear Sir or Madam,',
    'I am writing to share my suggestion for this activity.',
    'I believe it will help students improve their English writing.',
  ].join('\n')
}

export const mockOcrClient: OcrClient = {
  async recognize(input) {
    return input.groups.map((group): OcrEssayResult => {
      const pages = input.getGroupPages(group)
      const pageResults = pages.map((page, index) => ({
        pageId: page.id,
        text: buildPageOcrDraft(page, index),
        confidence: 0.88,
      }))

      return {
        essayGroupId: group.id,
        text: pageResults.map((page) => page.text).join('\n\n'),
        pages: pageResults,
        provider: 'mock',
        status: 'success',
      }
    })
  },
}
