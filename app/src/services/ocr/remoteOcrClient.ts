import { normalizeOcrResult } from './normalizeOcrResult'
import type { OcrClient, OcrEssayResult, OcrGatewayResponse, OcrRunInput } from './types'

function failedResult(essayGroupId: string, error: string): OcrEssayResult {
  return {
    essayGroupId,
    text: '',
    pages: [],
    provider: 'remote',
    status: 'failed',
    error,
  }
}

function failedResultsForInput(input: OcrRunInput, error: string) {
  return input.groups.map((group) => failedResult(group.id, error))
}

export function createRemoteOcrClient(apiBase: string): OcrClient {
  return {
    async recognize(input) {
      if (!apiBase) {
        return failedResultsForInput(
          input,
          '当前 real OCR 未配置 Gateway。请配置 VITE_OCR_API_BASE，或使用 mock 草稿 / 手动输入。',
        )
      }

      const results: OcrEssayResult[] = []

      for (const group of input.groups) {
        const pages = input.getGroupPages(group)
        const files = pages.map((page) => input.getPageFile(page.id))

        if (files.some((file) => !file)) {
          results.push(failedResult(group.id, '当前图片缺少可上传文件，请使用 mock 草稿或手动输入。'))
          continue
        }

        const formData = new FormData()
        formData.append('essayGroupId', group.id)
        formData.append('pageIds', JSON.stringify(pages.map((page) => page.id)))
        files.forEach((file) => {
          formData.append('pages', file as File)
        })

        try {
          const response = await fetch(`${apiBase.replace(/\/$/, '')}/ocr/recognize`, {
            method: 'POST',
            body: formData,
          })
          const rawText = await response.text()
          let payload: OcrGatewayResponse

          try {
            payload = JSON.parse(rawText) as OcrGatewayResponse
          } catch {
            results.push(failedResult(group.id, 'OCR Gateway 返回异常响应。'))
            continue
          }

          if (!Array.isArray(payload.results)) {
            results.push(failedResult(group.id, 'OCR Gateway 返回异常响应。'))
            continue
          }

          results.push(...payload.results.map(normalizeOcrResult))
        } catch {
          results.push(failedResult(group.id, `无法连接 OCR Gateway：${apiBase}`))
        }
      }

      return results
    },
  }
}
