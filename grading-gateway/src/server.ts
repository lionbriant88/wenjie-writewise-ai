import cors from 'cors'
import express from 'express'
import multer from 'multer'
import { MAX_RUBRIC_IMAGE_BYTES, MAX_RUBRIC_PAGES, requestIdFromMultipartBody, validateRubricMultipart } from './multipartImages.js'
import { normalizeMultimodalResult } from './multimodal/normalizeMultimodalResult.js'
import { validateConfirmedRubric, validateGeneratedRubric } from './multimodal/validateRubric.js'
import { getMultimodalProvider } from './providers/index.js'
import type { GatewayImageInput, MultimodalProvider } from './providers/multimodalProviderTypes.js'
import { GradingProviderError } from './providers/providerTypes.js'
import type { ConfirmedTaskPackageV2 } from './multimodal/types.js'

export interface CreateServerOptions {
  allowedOrigin?: string
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
  requestVersion: 'multimodal-grading-request-v2'
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

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key))
}

function parseImageGradeMetadata(value: unknown): ImageGradeMetadata | null {
  if (typeof value !== 'string') return null
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return null }
  const parsedRecord = errorRecord(parsed)
  if (!parsedRecord) return null
  const hasConfirmedTranscript = Object.prototype.hasOwnProperty.call(parsedRecord, 'confirmedTranscript')
  const allowedKeys = ['requestVersion', 'requestId', 'essayId', 'pageIds', 'task', ...(hasConfirmedTranscript ? ['confirmedTranscript'] : [])]
  if (!hasOnlyKeys(parsedRecord, allowedKeys) || parsedRecord.requestVersion !== 'multimodal-grading-request-v2') return null
  const requestId = readMetadataString(parsedRecord.requestId, 128)
  const essayId = readMetadataString(parsedRecord.essayId, 128)
  const confirmedTranscript = hasConfirmedTranscript ? readConfirmedTranscript(parsedRecord.confirmedTranscript) : undefined
  if (hasConfirmedTranscript && confirmedTranscript === null) return null
  if (!requestId || !essayId || !Array.isArray(parsedRecord.pageIds) || parsedRecord.pageIds.length > MAX_RUBRIC_PAGES) return null
  if (hasConfirmedTranscript ? parsedRecord.pageIds.length !== 0 : parsedRecord.pageIds.length < 1) return null
  const pageIds = parsedRecord.pageIds.map((pageId: unknown) => readMetadataString(pageId, 128))
  const taskRecord = errorRecord(parsedRecord.task)
  if (!pageIds.every((pageId): pageId is string => pageId !== null) || new Set(pageIds).size !== pageIds.length || !taskRecord) return null
  if (!hasOnlyKeys(taskRecord, ['taskId', 'fullScore', 'materialSummary', 'writingRequirements', 'constraints', 'rubric'])) return null
  const taskId = readMetadataString(taskRecord.taskId, 128)
  const fullScore = taskRecord.fullScore
  const materialSummary = readMetadataString(taskRecord.materialSummary, 20_000)
  const rubric = validateConfirmedRubric(taskRecord.rubric)
  if (!taskId || !materialSummary || typeof fullScore !== 'number' || !Number.isInteger(fullScore) || fullScore < 1 || fullScore > 100 || !rubric.ok
    || !Array.isArray(taskRecord.writingRequirements) || !Array.isArray(taskRecord.constraints)
    || JSON.stringify(taskRecord.writingRequirements) !== JSON.stringify(rubric.value.writingRequirements)
    || JSON.stringify(taskRecord.constraints) !== JSON.stringify(rubric.value.constraints)
    || materialSummary !== rubric.value.materialSummary) return null
  return {
    requestVersion: 'multimodal-grading-request-v2', requestId, essayId, pageIds,
    task: {
      taskId, fullScore, materialSummary, writingRequirements: rubric.value.writingRequirements,
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

export function createServer(options: CreateServerOptions = {}) {
  const app = express()
  app.use(cors({
    origin: options.allowedOrigin ?? 'http://127.0.0.1:5173',
    allowedHeaders: ['Content-Type', 'X-Grading-Request-Id'],
  }))
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
      const providerRubric = await provider.generateRubric({ ...validated.value, signal: controller.signal })
      const rubric = validateGeneratedRubric(providerRubric)
      if (!rubric.ok) {
        response.status(503).json(failure(validated.value.requestId, rubric.error, true))
        return
      }
      response.json({ requestId: validated.value.requestId, status: 'success', rubric: rubric.value })
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
    let pages: GatewayImageInput[] = []
    if (metadata.confirmedTranscript !== undefined) {
      if (files?.length) {
        response.status(400).json(failure(metadata.requestId, { code: 'invalid_request', message: 'Confirmed-text regrade must not include images.' }, false))
        return
      }
    } else {
      const images = validateRubricMultipart({ requestId: metadata.requestId, fullScore: String(metadata.task.fullScore), pageIds: JSON.stringify(metadata.pageIds) }, files)
      if (!images.ok) {
        response.status(images.error.code === 'request_too_large' ? 413 : 400).json(failure(metadata.requestId, images.error, false))
        return
      }
      pages = images.value.pages
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000)
    try {
      const provider = options.multimodalProvider ?? getMultimodalProvider(options.providerName ?? 'mock')
      const payload = await provider.gradeEssay({ requestId: metadata.requestId, task: metadata.task, essayId: metadata.essayId, pages, confirmedTranscript: metadata.confirmedTranscript, signal: controller.signal })
      const normalized = normalizeMultimodalResult(payload, { requestId: metadata.requestId, essayId: metadata.essayId, task: metadata.task, provider: 'remote', pageCount: pages.length, confirmedTranscript: metadata.confirmedTranscript, createdAt: (options.now ?? (() => new Date().toISOString()))() })
      if (!normalized.ok) { response.status(503).json(failure(metadata.requestId, normalized.error, true)); return }
      response.json(normalized.result)
    } catch (error) {
      const safe = controller.signal.aborted
        ? failure(metadata.requestId, { code: 'provider_timeout', message: 'AI grading timed out.' }, true)
        : toSafeFailure(metadata.requestId, error)
      response.status(503).json(safe)
    } finally { clearTimeout(timeout) }
  })
  return app
}
