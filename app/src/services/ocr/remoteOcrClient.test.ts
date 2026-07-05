import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EssayPage } from '../../types'
import type { UploadEssayGroup } from '../../utils/essayGrouping'
import { createRemoteOcrClient } from './remoteOcrClient'

const page: EssayPage = {
  id: 'page-1',
  label: 'essay.png',
  pageNumber: 1,
  quality: 'clear',
  accent: '#2563eb',
}

const file = new File(['image'], 'essay.png', { type: 'image/png' })
const groups: UploadEssayGroup[] = [{ id: 'group-1', pageIds: ['page-1'] }]

function input() {
  return {
    groups,
    getGroupPages: () => [page],
    getPageFile: () => file,
    pageOrderIndex: new Map([['page-1', 0]]),
  }
}

describe('remote OCR client', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns normalized Gateway results on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            results: [
              {
                essayGroupId: 'group-1',
                text: 'Recognized text',
                pages: [{ pageId: 'page-1', text: 'Recognized text' }],
                provider: 'remote',
                status: 'success',
              },
            ],
          }),
      })),
    )

    const result = await createRemoteOcrClient('http://localhost:8787').recognize(input())

    expect(result[0].text).toBe('Recognized text')
    expect(fetch).toHaveBeenCalledWith('http://localhost:8787/ocr/recognize', expect.objectContaining({ method: 'POST' }))
  })

  it('returns a failed result when Gateway base URL is missing', async () => {
    const result = await createRemoteOcrClient('').recognize(input())

    expect(result[0]).toMatchObject({
      essayGroupId: 'group-1',
      status: 'failed',
      error: '当前 real OCR 未配置 Gateway。请配置 VITE_OCR_API_BASE，或使用 mock 草稿 / 手动输入。',
    })
  })

  it('returns a failed result when a page has no File object', async () => {
    const result = await createRemoteOcrClient('http://localhost:8787').recognize({
      ...input(),
      getPageFile: () => undefined,
    })

    expect(result[0].status).toBe('failed')
    expect(result[0].error).toBe('当前图片缺少可上传文件，请使用 mock 草稿或手动输入。')
  })

  it('returns a failed result when Gateway responds with non-JSON content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        text: async () => '<html>bad gateway</html>',
      })),
    )

    const result = await createRemoteOcrClient('http://localhost:8787').recognize(input())

    expect(result[0]).toMatchObject({
      essayGroupId: 'group-1',
      status: 'failed',
      error: 'OCR Gateway 返回异常响应。',
    })
  })
})
