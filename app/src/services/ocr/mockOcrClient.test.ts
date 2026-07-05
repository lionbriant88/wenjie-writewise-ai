import { describe, expect, it } from 'vitest'
import type { EssayPage } from '../../types'
import type { UploadEssayGroup } from '../../utils/essayGrouping'
import { mockOcrClient } from './mockOcrClient'

const pages: EssayPage[] = [
  { id: 'page-2', label: 'Second.png', pageNumber: 2, quality: 'clear', accent: '#2563eb' },
  { id: 'page-1', label: 'First.png', pageNumber: 1, quality: 'clear', accent: '#2563eb' },
]

const groups: UploadEssayGroup[] = [{ id: 'group-1', pageIds: ['page-1', 'page-2'] }]

describe('mockOcrClient', () => {
  it('returns unified OCR results in group page order', async () => {
    const pageMap = new Map(pages.map((page) => [page.id, page]))
    const result = await mockOcrClient.recognize({
      groups,
      getGroupPages: (group) =>
        group.pageIds.map((pageId) => pageMap.get(pageId)).filter((page): page is EssayPage => Boolean(page)),
      getPageFile: () => undefined,
      pageOrderIndex: new Map([
        ['page-2', 0],
        ['page-1', 1],
      ]),
    })

    expect(result[0].provider).toBe('mock')
    expect(result[0].text).toContain('作文图片 1：First.png')
    expect(result[0].text).toContain('作文图片 2：Second.png')
    expect(result[0].pages.map((page) => page.pageId)).toEqual(['page-1', 'page-2'])
  })
})
