import cors from 'cors'
import express from 'express'
import multer from 'multer'
import { getProvider } from './providers/index.js'
import {
  allowedImageMimeTypes,
  MAX_IMAGE_SIZE_BYTES,
  MAX_PAGES_PER_REQUEST,
  type GatewayPageInput,
  type OcrEssayResult,
} from './types.js'

interface CreateServerOptions {
  providerName?: string
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_SIZE_BYTES + 1,
    files: MAX_PAGES_PER_REQUEST + 1,
  },
})

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

function getMulterErrorMessage(error: multer.MulterError) {
  if (error.code === 'LIMIT_FILE_SIZE') return '单张图片不能超过 8MB。'
  if (error.code === 'LIMIT_FILE_COUNT') return '单次 OCR 最多支持 10 页图片。'
  return 'OCR Gateway 请求处理失败。'
}

function parsePageIds(rawPageIds: unknown) {
  if (typeof rawPageIds !== 'string') return []

  try {
    const parsed = JSON.parse(rawPageIds) as unknown
    return Array.isArray(parsed) ? parsed.filter((pageId): pageId is string => typeof pageId === 'string') : []
  } catch {
    return []
  }
}

function validateFiles(files: Express.Multer.File[], essayGroupId: string): OcrEssayResult | null {
  if (files.length > MAX_PAGES_PER_REQUEST) {
    return failedResult(essayGroupId, '单次 OCR 最多支持 10 页图片。')
  }

  const unsupportedFile = files.find((file) => !allowedImageMimeTypes.includes(file.mimetype as never))
  if (unsupportedFile) {
    return failedResult(essayGroupId, '仅支持 PNG、JPEG 或 WebP 图片。')
  }

  const oversizedFile = files.find((file) => file.size > MAX_IMAGE_SIZE_BYTES)
  if (oversizedFile) {
    return failedResult(essayGroupId, '单张图片不能超过 8MB。')
  }

  return null
}

export function createServer(options: CreateServerOptions = {}) {
  const app = express()

  app.use(cors())

  app.get('/health', (_request, response) => {
    response.json({ ok: true, service: 'ocr-gateway' })
  })

  app.post('/ocr/recognize', upload.array('pages', MAX_PAGES_PER_REQUEST + 1), async (request, response) => {
    const essayGroupId = typeof request.body.essayGroupId === 'string' ? request.body.essayGroupId : 'unknown-group'
    const files = (request.files ?? []) as Express.Multer.File[]
    const pageIds = parsePageIds(request.body.pageIds)

    const validationError = validateFiles(files, essayGroupId)
    if (validationError) {
      response.status(400).json({ results: [validationError] })
      return
    }

    if (files.length === 0 || files.length !== pageIds.length) {
      response.status(400).json({ results: [failedResult(essayGroupId, '图片数量与页面 ID 数量不一致。')] })
      return
    }

    const pages: GatewayPageInput[] = files.map((file, index) => ({
      pageId: pageIds[index],
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    }))

    try {
      const provider = getProvider(options.providerName)
      if (options.providerName === 'throws_for_test') {
        throw new Error('provider stack with SECRET_SHOULD_NOT_LEAK')
      }
      const result = await provider.recognize({ essayGroupId, pages })
      response.json({ results: [result] })
    } catch {
      response.json({
        results: [failedResult(essayGroupId, 'OCR 识别服务暂时不可用，请使用 mock 草稿或手动输入。')],
      })
    }
  })

  app.use((error: unknown, request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const essayGroupId = typeof request.body?.essayGroupId === 'string' ? request.body.essayGroupId : 'unknown-group'
    const message = error instanceof multer.MulterError ? getMulterErrorMessage(error) : 'OCR Gateway 请求处理失败。'
    response.status(400).json({ results: [failedResult(essayGroupId, message)] })
  })

  return app
}
