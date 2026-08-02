import cors from 'cors'
import express from 'express'
import type { ErrorRequestHandler, Request } from 'express'
import multer from 'multer'
import { MAX_RUBRIC_IMAGE_BYTES, MAX_RUBRIC_PAGES, requestIdFromMultipartBody, validateRubricMultipart } from './multipartImages.js'
import { normalizeGradingResult } from './normalizeGradingResult.js'
import { normalizeMultimodalResult } from './multimodal/normalizeMultimodalResult.js'
import { validateGeneratedRubric } from './multimodal/validateRubric.js'
import { buildGradingPrompt } from './promptBuilder.js'
import { getMultimodalProvider, getProvider } from './providers/index.js'
import type { MultimodalProvider } from './providers/multimodalProviderTypes.js'
import { GradingProviderError, type GradingProvider } from './providers/providerTypes.js'
import { validateGradingRequest } from './validateGradingRequest.js'
import type { ConfirmedTaskPackageV2 } from './multimodal/types.js'

export interface CreateServerOptions {
  allowedOrigin?: string
  provider?: GradingProvider
  multimodalProvider?: MultimodalProvider
  providerName?: string
  timeoutMs?: number
  now?: () => string
}

const rubricUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RUBRIC_IMAGE_BYTES + 1, files: MAX_RUBRIC_PAGES, fields: 3, fieldSize: 16 * 1024, parts: 20 },
})

export const MAX_IMAGE_GRADING_METADATA_BYTES = 32 * 1024 * 1024
const imageGradeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RUBRIC_IMAGE_BYTES + 1, files: MAX_RUBRIC_PAGES, fields: 1, fieldSize: MAX_IMAGE_GRADING_METADATA_BYTES, parts: MAX_RUBRIC_PAGES + 2 },
})

function errorRecord(error: unknown): Record<string, unknown> | null {
  return typeof error === 'object' && error !== null
    ? error as Record<string, unknown>
    : null
}

function parserErrorRequestId(request: Request) {
  const value = request.get('X-Grading-Request-Id')?.trim()
  return value && value.length <= 128 ? value : 'unavailable'
}

function requestIdFrom(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'unavailable'
  const requestId = (value as Record<string, unknown>).requestId
  return typeof requestId === 'string' && requestId.trim() && requestId.trim().length <= 128
    ? requestId.trim()
    : 'unavailable'
}

function failure(
  requestId: string,
  error: { code: string; message: string },
  retryable: boolean,
) {
  return { requestId, status: 'failed' as const, error: { code: error.code, message: error.message, retryable } }
}

function toSafeFailure(requestId: string, error: unknown) {
  if (error instanceof GradingProviderError) return failure(requestId, error, error.retryable)
  return failure(requestId, { code: 'provider_unavailable', message: 'AI 批改服务暂时不可用。' }, true)
}

function rubricUploadFailure(requestId: string, error: unknown) {
  if (error instanceof multer.MulterError && (
    error.code === 'LIMIT_FILE_SIZE' || error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_PART_COUNT' || error.code === 'LIMIT_FIELD_VALUE'
  )) {
    return { status: 413, body: failure(requestId, { code: 'request_too_large', message: 'Rubric upload exceeds the allowed limit.' }, false) }
  }
  return { status: 400, body: failure(requestId, { code: 'invalid_request', message: 'Rubric request is invalid.' }, false) }
}

interface ImageGradeMetadata {
  requestId: string
  essayId: string
  pageIds: string[]
  task: ConfirmedTaskPackageV2
  confirmedTranscript?: string
}

function readMetadataString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= maxLength ? trimmed : null
}

function readConfirmedTranscript(value: unknown): string | null {
  return typeof value === 'string' && value.trim() && value.length <= 50_000 ? value : null
}

function parseImageGradeMetadata(value: unknown): ImageGradeMetadata | null {
  if (typeof value !== 'string') return null
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return null }
  const parsedRecord = errorRecord(parsed)
  if (!parsedRecord) return null
  const requestId = readMetadataString(parsedRecord.requestId, 128)
  const essayId = readMetadataString(parsedRecord.essayId, 128)
  if (!requestId || !essayId || !Array.isArray(parsedRecord.pageIds) || parsedRecord.pageIds.length < 1 || parsedRecord.pageIds.length > MAX_RUBRIC_PAGES) return null
  const pageIds = parsedRecord.pageIds.map((pageId: unknown) => readMetadataString(pageId, 128))
  const taskRecord = errorRecord(parsedRecord.task)
  if (!pageIds.every((pageId): pageId is string => pageId !== null) || new Set(pageIds).size !== pageIds.length || !taskRecord) return null
  const taskId = readMetadataString(taskRecord.taskId, 128)
  const fullScore = taskRecord.fullScore
  const rubric = validateGeneratedRubric(taskRecord.rubric)
  if (!taskId || typeof fullScore !== 'number' || !Number.isInteger(fullScore) || fullScore < 1 || fullScore > 100 || !rubric.ok) return null
  const hasConfirmedTranscript = Object.prototype.hasOwnProperty.call(parsedRecord, 'confirmedTranscript')
  const confirmedTranscript = hasConfirmedTranscript ? readConfirmedTranscript(parsedRecord.confirmedTranscript) : undefined
  if (hasConfirmedTranscript && confirmedTranscript === null) return null
  return {
    requestId, essayId, pageIds,
    task: {
      taskId, fullScore, materialSummary: rubric.value.materialSummary, writingRequirements: rubric.value.writingRequirements,
      constraints: rubric.value.constraints, rubric: rubric.value,
    },
    ...(typeof confirmedTranscript === 'string' ? { confirmedTranscript } : {}),
  }
}

function imageGradeRequestId(value: unknown) {
  const record = errorRecord(value)
  if (!record) return 'unavailable'
  return typeof record.metadata === 'string' ? parseImageGradeMetadata(record.metadata)?.requestId ?? 'unavailable' : 'unavailable'
}

export const jsonParserErrorHandler: ErrorRequestHandler = (error, request, response, next) => {
  const record = errorRecord(error)
  const status = record?.status
  const type = record?.type
  const requestId = parserErrorRequestId(request)

  if (status === 413 || type === 'entity.too.large') {
    response.status(413).json({
      requestId,
      status: 'failed',
      error: { code: 'request_too_large', message: '批改请求超过 256 KB 限制。', retryable: false },
    })
    return
  }

  if (error instanceof SyntaxError && status === 400 && record && 'body' in record) {
    response.status(400).json({
      requestId,
      status: 'failed',
      error: { code: 'invalid_request', message: '批改请求 JSON 无效。', retryable: false },
    })
    return
  }

  next(error)
}

export function createServer(options: CreateServerOptions = {}) {
  const app = express()
  app.use(cors({
    origin: options.allowedOrigin ?? 'http://127.0.0.1:5173',
    allowedHeaders: ['Content-Type', 'X-Grading-Request-Id'],
  }))
  app.use(express.json({ limit: '256kb' }))
  app.use(jsonParserErrorHandler)
  app.get('/health', (_request, response) => {
    response.json({ ok: true, service: 'grading-gateway' })
  })
  app.post('/tasks/rubric', (request, response, next) => {
    rubricUpload.array('pages', MAX_RUBRIC_PAGES)(request, response, (error) => {
      if (!error) {
        next()
        return
      }
      const safe = rubricUploadFailure(requestIdFromMultipartBody(request.body), error)
      response.status(safe.status).json(safe.body)
    })
  }, async (request, response) => {
    const files = Array.isArray(request.files) ? request.files : undefined
    const validated = validateRubricMultipart(request.body, files)
    if (!validated.ok) {
      response.status(validated.error.code === 'request_too_large' ? 413 : 400)
        .json(failure(requestIdFromMultipartBody(request.body), validated.error, false))
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000)
    try {
      const provider = options.multimodalProvider ?? getMultimodalProvider(options.providerName ?? 'mock')
      const rubric = await provider.generateRubric({ ...validated.value, signal: controller.signal })
      response.json({ requestId: validated.value.requestId, status: 'success', rubric })
    } catch (error) {
      const safe = controller.signal.aborted
        ? failure(validated.value.requestId, { code: 'provider_timeout', message: 'AI grading timed out.' }, true)
        : toSafeFailure(validated.value.requestId, error)
      response.status(503).json(safe)
    } finally {
      clearTimeout(timeout)
    }
  })
  app.post('/grading/grade-images', (request, response, next) => {
    imageGradeUpload.array('pages', MAX_RUBRIC_PAGES)(request, response, (error) => {
      if (!error) { next(); return }
      const safe = rubricUploadFailure(imageGradeRequestId(request.body), error)
      response.status(safe.status).json(safe.body)
    })
  }, async (request, response) => {
    const metadata = parseImageGradeMetadata(request.body?.metadata)
    const files = Array.isArray(request.files) ? request.files : undefined
    if (!metadata) {
      response.status(400).json(failure(imageGradeRequestId(request.body), { code: 'invalid_request', message: 'Image grading request is invalid.' }, false))
      return
    }
    const images = validateRubricMultipart({ requestId: metadata.requestId, fullScore: String(metadata.task.fullScore), pageIds: JSON.stringify(metadata.pageIds) }, files)
    if (!images.ok) {
      response.status(images.error.code === 'request_too_large' ? 413 : 400).json(failure(metadata.requestId, images.error, false))
      return
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000)
    try {
      const provider = options.multimodalProvider ?? getMultimodalProvider(options.providerName ?? 'mock')
      const payload = await provider.gradeEssay({ requestId: metadata.requestId, task: metadata.task, essayId: metadata.essayId, pages: images.value.pages, confirmedTranscript: metadata.confirmedTranscript, signal: controller.signal })
      const normalized = normalizeMultimodalResult(payload, { requestId: metadata.requestId, essayId: metadata.essayId, task: metadata.task, provider: 'remote', confirmedTranscript: metadata.confirmedTranscript, createdAt: (options.now ?? (() => new Date().toISOString()))() })
      if (!normalized.ok) { response.status(503).json(failure(metadata.requestId, normalized.error, true)); return }
      response.json(normalized.result)
    } catch (error) {
      const safe = controller.signal.aborted
        ? failure(metadata.requestId, { code: 'provider_timeout', message: 'AI grading timed out.' }, true)
        : toSafeFailure(metadata.requestId, error)
      response.status(503).json(safe)
    } finally { clearTimeout(timeout) }
  })
  app.post('/grading/grade', async (request, response) => {
    const validated = validateGradingRequest(request.body)
    if (!validated.ok) {
      response.status(400).json(failure(requestIdFrom(request.body), validated.error, false))
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000)
    try {
      const provider = options.provider ?? getProvider(options.providerName ?? 'mock')
      const prompt = buildGradingPrompt(validated.value)
      const payload = await provider.grade({ request: validated.value, prompt, signal: controller.signal })
      const normalized = normalizeGradingResult(payload, validated.value, {
        provider: provider.publicName,
        createdAt: (options.now ?? (() => new Date().toISOString()))(),
      })
      if (!normalized.ok) {
        response.status(503).json(failure(validated.value.requestId, normalized.error, true))
        return
      }
      response.json(normalized.result)
    } catch (error) {
      const safe = controller.signal.aborted
        ? failure(validated.value.requestId, { code: 'provider_timeout', message: 'AI 批改超时。' }, true)
        : toSafeFailure(validated.value.requestId, error)
      response.status(503).json(safe)
    } finally {
      clearTimeout(timeout)
    }
  })
  return app
}
