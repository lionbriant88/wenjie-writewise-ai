import { randomUUID } from 'node:crypto'
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { isWellFormedUnicode } from '../../app/src/services/grading/gradingResultSemantics.js'
import { validateMultimodalGradingRequestMode } from '../../app/src/services/grading/validateMultimodalGradingRequestMode.js'
import { MAX_RUBRIC_IMAGE_BYTES, MAX_RUBRIC_PAGES, requestIdFromMultipartBody, validateRubricMultipart } from './multipartImages.js'
import {
  MAX_TASK_MATERIAL_IMAGE_BYTES,
  MAX_TASK_MATERIAL_TEXT_FIELD_BYTES,
  MAX_TASK_MATERIAL_UNITS,
  validateTaskMaterialMultipart,
} from './multipartTaskMaterials.js'
import { validateTaskMaterialContext } from './multimodal/materialContextContract.js'
import { normalizeMultimodalResult } from './multimodal/normalizeMultimodalResult.js'
import { validateConfirmedRubric, validateGeneratedRubric } from './multimodal/validateRubric.js'
import type { GatewayImageInput, MultimodalProvider } from './providers/multimodalProviderTypes.js'
import { GradingProviderError, type ProviderCallResult, type ProviderCallStage, type ProviderErrorCode } from './providers/providerTypes.js'
import type { ConfirmedTaskPackageV2 } from './multimodal/types.js'
import { emitSafeGradingDiagnostic } from './safeDiagnostics.js'
import type { SafeGradingDiagnosticSink } from './safeDiagnostics.js'
import type { GatewayRuntimeConfig } from './gatewayRuntimeConfig.js'
import { readSafeImageDimensions } from './imageMetadata.js'
import {
  createProviderTelemetryRecorder,
  recordProviderOperation,
  recordUniqueProviderAttempts,
  type ProviderTelemetryRecorder,
} from './providerTelemetry.js'

export interface CreateServerOptions {
  allowedOrigin?: string
  multimodalProvider?: MultimodalProvider
  runtimeConfig?: GatewayRuntimeConfig
  timeoutMs?: number
  now?: () => string
  onDiagnostic?: SafeGradingDiagnosticSink
  providerTelemetry?: ProviderTelemetryRecorder
}

const taskMaterialUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_TASK_MATERIAL_IMAGE_BYTES + 1,
    files: MAX_TASK_MATERIAL_UNITS,
    fields: 5,
    fieldSize: MAX_TASK_MATERIAL_TEXT_FIELD_BYTES,
    parts: MAX_TASK_MATERIAL_UNITS + 7,
  },
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

const PROVIDER_SAFE_MESSAGES: Record<ProviderErrorCode, string> = {
  unsupported_genre: '当前任务类型暂不支持。',
  provider_not_configured: 'AI 批改服务尚未配置。',
  provider_request_rejected: 'AI 批改请求未被服务接受。',
  provider_auth_failed: 'AI 批改服务认证失败。',
  provider_balance_unavailable: 'AI 批改服务额度暂不可用。',
  provider_rate_limited: 'AI 批改服务繁忙，请稍后重试。',
  provider_timeout: 'AI 批改服务响应超时，请重试。',
  provider_unavailable: 'AI 批改服务暂时不可用。',
  provider_content_filtered: '当前内容暂时无法处理。',
  provider_unexpected_tool_call: 'AI 批改服务返回了无法使用的结果。',
  provider_invalid_response: 'AI 批改服务返回了无法使用的结果。',
}

function toSafeFailure(requestId: string, error: unknown) {
  if (error instanceof GradingProviderError) {
    return failure(requestId, { code: error.code, message: PROVIDER_SAFE_MESSAGES[error.code] }, error.retryable)
  }
  return failure(requestId, { code: 'provider_unavailable', message: 'AI 批改服务暂时不可用。' }, true)
}

function multipartUploadFailure(requestId: string, error: unknown, route: 'task-material' | 'image-grading') {
  if (error instanceof multer.MulterError && (
    error.code === 'LIMIT_FILE_SIZE' || error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_PART_COUNT' || error.code === 'LIMIT_FIELD_VALUE'
  )) {
    return {
      status: 413,
      body: failure(requestId, {
        code: 'request_too_large',
        message: route === 'task-material'
          ? 'Task material upload exceeds the allowed limit.'
          : 'Rubric upload exceeds the allowed limit.',
      }, false),
    }
  }
  return {
    status: 400,
    body: failure(requestId, {
      code: 'invalid_request',
      message: route === 'task-material'
        ? 'Task material request is invalid.'
        : 'Rubric request is invalid.',
    }, false),
  }
}

function taskMaterialUploadBoundary(request: Request, response: Response, next: NextFunction) {
  taskMaterialUpload.array('images', MAX_TASK_MATERIAL_UNITS)(request, response, (error) => {
    if (!error) {
      next()
      return
    }
    const safe = multipartUploadFailure(requestIdFromMultipartBody(request.body), error, 'task-material')
    response.status(safe.status).json(safe.body)
  })
}

async function runProviderWithDeadline<T>(
  controller: AbortController,
  timeoutMs: number,
  runProvider: () => Promise<T>,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort()
      reject(new Error('Provider deadline exceeded.'))
    }, timeoutMs)
  })
  const providerResult = Promise.resolve().then(runProvider)
  try {
    return await Promise.race([providerResult, deadline])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

interface ImageGradeMetadata {
  requestVersion: 'multimodal-grading-request-v2'
  requestId: string
  essayId: string
  pageIds: string[]
  task: ConfirmedTaskPackageV2
  confirmedTranscript?: string
}

function hasAtMostCodePoints(value: string, maxLength: number): boolean {
  let codePointCount = 0
  for (const _codePoint of value) {
    codePointCount += 1
    if (codePointCount > maxLength) return false
  }
  return true
}

function readMetadataString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && hasAtMostCodePoints(trimmed, maxLength) ? trimmed : null
}

function readConfirmedTranscript(value: unknown): string | null {
  return typeof value === 'string' && value.trim() && value.length <= 50_000 && isWellFormedUnicode(value) ? value : null
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

function safeRuntimeSnapshot(config: GatewayRuntimeConfig | undefined) {
  if (!config) return { status: 'unconfigured' as const }
  return {
    provider: config.provider,
    model: config.kimi.model,
    reasoningEffort: config.kimi.reasoningEffort,
    deadlines: {
      httpMs: config.deadlines.httpMs,
      providerFinalMs: config.deadlines.providerFinalMs,
      settlementGraceMs: config.deadlines.settlementGraceMs,
    },
    stageBudgets: {
      material_context: config.kimi.stageBudgets.material_context,
      rubric_generation: config.kimi.stageBudgets.rubric_generation,
      essay_grading_images: config.kimi.stageBudgets.essay_grading_images,
      essay_regrading_text: config.kimi.stageBudgets.essay_regrading_text,
    },
    hardLimit: config.admission.hardLimit,
    modes: {
      rubricStrategy: config.rubricStrategy,
      essayPromptProfile: config.essayPromptProfile,
      executionRegistry: config.executionRegistry,
    },
    admission: { paused: false },
  }
}

function providerFor(options: CreateServerOptions): MultimodalProvider {
  if (options.multimodalProvider) return options.multimodalProvider
  throw new GradingProviderError('provider_not_configured', 'AI Provider is not configured.', false)
}

function telemetryContext(
  options: CreateServerOptions,
  stage: ProviderCallStage,
  outcome: 'success' | 'failed' | 'result_unknown',
) {
  return {
    stage,
    model: options.runtimeConfig?.kimi.model ?? 'unconfigured',
    reasoningEffort: 'low' as const,
    outcome,
  }
}

function recordErrorAttempts(
  telemetry: ProviderTelemetryRecorder,
  options: CreateServerOptions,
  stage: ProviderCallStage,
  error: unknown,
) {
  if (!(error instanceof GradingProviderError)) return
  recordUniqueProviderAttempts(
    telemetry,
    telemetryContext(options, stage, error.details?.termination === 'unknown' ? 'result_unknown' : 'failed'),
    error.details?.attemptObservations ?? [],
  )
}

function runObservedProviderWithDeadline<T>(
  controller: AbortController,
  timeoutMs: number,
  telemetry: ProviderTelemetryRecorder,
  options: CreateServerOptions,
  stage: ProviderCallStage,
  runProvider: () => Promise<ProviderCallResult<T>>,
): Promise<ProviderCallResult<T>> {
  return runProviderWithDeadline(controller, timeoutMs, async () => {
    try {
      const result = await runProvider()
      recordUniqueProviderAttempts(telemetry, telemetryContext(options, stage, 'success'), result.attempts)
      return result
    } catch (error) {
      recordErrorAttempts(telemetry, options, stage, error)
      throw error
    }
  })
}

function safeImageOperationMetadata(pages: readonly GatewayImageInput[]) {
  const dimensions = pages.flatMap((page, index) => {
    const dimension = readSafeImageDimensions(page.buffer, page.mimeType)
    return dimension.status === 'known' ? [{ page: index + 1, width: dimension.width, height: dimension.height }] : []
  })
  return {
    pageCount: pages.length,
    totalBytes: pages.reduce((total, page) => total + page.buffer.length, 0),
    ...(dimensions.length ? { dimensions } : {}),
  }
}

export function createServer(options: CreateServerOptions = {}) {
  const timeoutMs = options.timeoutMs ?? options.runtimeConfig?.deadlines.httpMs ?? 60_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Invalid injected server deadline.')
  const telemetry = options.providerTelemetry ?? createProviderTelemetryRecorder()
  const app = express()
  app.use(cors({
    origin: options.allowedOrigin ?? 'http://127.0.0.1:5173',
    allowedHeaders: ['Content-Type', 'X-Grading-Request-Id'],
  }))
  app.get('/health', (_request, response) => {
    response.json({ ok: true, service: 'grading-gateway', runtime: safeRuntimeSnapshot(options.runtimeConfig) })
  })
  app.post('/tasks/material-context', taskMaterialUploadBoundary, async (request, response) => {
    const files = Array.isArray(request.files) ? request.files : undefined
    const validated = validateTaskMaterialMultipart(request.body, files, 'required')
    if (!validated.ok) {
      response.status(validated.error.code === 'request_too_large' ? 413 : 400)
        .json(failure(requestIdFromMultipartBody(request.body), validated.error, false))
      return
    }
    const writingRequirement = validated.value.writingRequirement
    if (!writingRequirement) {
      response.status(400).json(failure(validated.value.requestId, { code: 'invalid_request', message: 'Task material request is invalid.' }, false))
      return
    }

    const controller = new AbortController()
    try {
      const provider = providerFor(options)
      const providerContext = await runObservedProviderWithDeadline(
        controller,
        timeoutMs,
        telemetry,
        options,
        'material_context',
        () => provider.generateMaterialContext({
          requestId: validated.value.requestId,
          fullScore: validated.value.fullScore,
          writingRequirement,
          materials: validated.value.materials,
          signal: controller.signal,
        }),
      )
      const context = validateTaskMaterialContext(providerContext.value)
      if (!context.ok) {
        emitSafeGradingDiagnostic(options.onDiagnostic, { stage: 'normalization', diagnosticCode: 'material_context_validation' })
        response.status(503).json(failure(validated.value.requestId, context.error, true))
        return
      }
      response.json({ requestId: validated.value.requestId, status: 'success', materialContext: context.value })
    } catch (error) {
      const safe = controller.signal.aborted
        ? failure(validated.value.requestId, { code: 'provider_timeout', message: 'AI grading timed out.' }, true)
        : toSafeFailure(validated.value.requestId, error)
      emitSafeGradingDiagnostic(options.onDiagnostic, {
        stage: 'provider',
        diagnosticCode: controller.signal.aborted
          ? 'provider_timeout'
          : error instanceof GradingProviderError
            ? error.diagnosticCode ?? error.code
            : 'provider_unavailable',
      })
      response.status(503).json(safe)
    }
  })

  app.post('/tasks/rubric', taskMaterialUploadBoundary, async (request, response) => {
    const files = Array.isArray(request.files) ? request.files : undefined
    const validated = validateTaskMaterialMultipart(request.body, files, 'optional')
    if (!validated.ok) {
      response.status(validated.error.code === 'request_too_large' ? 413 : 400)
        .json(failure(requestIdFromMultipartBody(request.body), validated.error, false))
      return
    }

    const controller = new AbortController()
    try {
      const provider = providerFor(options)
      const providerRubric = await runObservedProviderWithDeadline(
        controller,
        timeoutMs,
        telemetry,
        options,
        'rubric_generation',
        () => provider.generateRubric({ ...validated.value, signal: controller.signal }),
      )
      const rubric = validateGeneratedRubric(providerRubric.value)
      if (!rubric.ok) {
        emitSafeGradingDiagnostic(options.onDiagnostic, { stage: 'normalization', diagnosticCode: 'rubric_validation' })
        response.status(503).json(failure(validated.value.requestId, rubric.error, true))
        return
      }
      response.json({ requestId: validated.value.requestId, status: 'success', rubric: rubric.value })
    } catch (error) {
      const safe = controller.signal.aborted
        ? failure(validated.value.requestId, { code: 'provider_timeout', message: 'AI grading timed out.' }, true)
        : toSafeFailure(validated.value.requestId, error)
      emitSafeGradingDiagnostic(options.onDiagnostic, {
        stage: 'provider',
        diagnosticCode: controller.signal.aborted
          ? 'provider_timeout'
          : error instanceof GradingProviderError
            ? error.diagnosticCode ?? error.code
            : 'provider_unavailable',
      })
      response.status(503).json(safe)
    }
  })
  app.post('/grading/grade-images', (request, response, next) => {
    imageGradeUpload.array('pages', MAX_RUBRIC_PAGES)(request, response, (error) => {
      if (!error) { next(); return }
      const safe = multipartUploadFailure(imageGradeRequestId(request.body), error, 'image-grading')
      response.status(safe.status).json(safe.body)
    })
  }, async (request, response) => {
    const metadata = parseImageGradeMetadata(request.body?.metadata)
    const files = Array.isArray(request.files) ? request.files : undefined
    if (!metadata) {
      response.status(400).json(failure('unavailable', { code: 'invalid_request', message: 'Image grading request is invalid.' }, false))
      return
    }
    const requestMode = validateMultimodalGradingRequestMode({
      confirmedTranscript: metadata.confirmedTranscript,
      pageIds: metadata.pageIds,
      pages: files ?? [],
    })
    if (!requestMode.ok) {
      response.status(400).json(failure(metadata.requestId, { code: 'invalid_request', message: 'Image grading request is invalid.' }, false))
      return
    }
    let pages: GatewayImageInput[] = []
    if (requestMode.mode === 'images') {
      const images = validateRubricMultipart({ requestId: metadata.requestId, fullScore: String(metadata.task.fullScore), pageIds: JSON.stringify(metadata.pageIds) }, files)
      if (!images.ok) {
        response.status(images.error.code === 'request_too_large' ? 413 : 400).json(failure(metadata.requestId, images.error, false))
        return
      }
      pages = images.value.pages
    }
    const controller = new AbortController()
    const stage: ProviderCallStage = metadata.confirmedTranscript === undefined ? 'essay_grading_images' : 'essay_regrading_text'
    const operationDiagnosticId = randomUUID()
    const operationStartedAt = performance.now()
    const operationMedia = safeImageOperationMetadata(pages)
    try {
      const provider = providerFor(options)
      const payload = await runObservedProviderWithDeadline(
        controller,
        timeoutMs,
        telemetry,
        options,
        stage,
        () => provider.gradeEssay({
          requestId: metadata.requestId,
          task: metadata.task,
          essayId: metadata.essayId,
          pages,
          confirmedTranscript: metadata.confirmedTranscript,
          signal: controller.signal,
        }),
      )
      const normalizeStartedAt = performance.now()
      const normalized = normalizeMultimodalResult(payload.value, { requestId: metadata.requestId, essayId: metadata.essayId, task: metadata.task, provider: 'remote', pageCount: pages.length, confirmedTranscript: metadata.confirmedTranscript, createdAt: (options.now ?? (() => new Date().toISOString()))() })
      const normalizeMs = performance.now() - normalizeStartedAt
      if (!normalized.ok) {
        recordProviderOperation(telemetry, {
          ...telemetryContext(options, stage, 'failed'), operationDiagnosticId,
          normalizeMs, totalMs: performance.now() - operationStartedAt, ...operationMedia,
          ...(metadata.confirmedTranscript === undefined ? {} : { confirmedTextCodeUnits: metadata.confirmedTranscript.length }),
        })
        emitSafeGradingDiagnostic(options.onDiagnostic, { stage: 'normalization', diagnosticCode: normalized.error.diagnosticCode })
        response.status(503).json(failure(metadata.requestId, normalized.error, true))
        return
      }
      recordProviderOperation(telemetry, {
        ...telemetryContext(options, stage, 'success'), operationDiagnosticId,
        normalizeMs, totalMs: performance.now() - operationStartedAt, ...operationMedia,
        ...(metadata.confirmedTranscript === undefined ? {} : { confirmedTextCodeUnits: metadata.confirmedTranscript.length }),
      })
      response.json(normalized.result)
    } catch (error) {
      recordProviderOperation(telemetry, {
        ...telemetryContext(options, stage, controller.signal.aborted || (error instanceof GradingProviderError && error.details?.termination === 'unknown') ? 'result_unknown' : 'failed'),
        operationDiagnosticId, totalMs: performance.now() - operationStartedAt, ...operationMedia,
        ...(metadata.confirmedTranscript === undefined ? {} : { confirmedTextCodeUnits: metadata.confirmedTranscript.length }),
      })
      const safe = controller.signal.aborted
        ? failure(metadata.requestId, { code: 'provider_timeout', message: 'AI grading timed out.' }, true)
        : toSafeFailure(metadata.requestId, error)
      emitSafeGradingDiagnostic(options.onDiagnostic, {
        stage: 'provider',
        diagnosticCode: controller.signal.aborted
          ? 'provider_timeout'
          : error instanceof GradingProviderError
            ? error.diagnosticCode ?? error.code
            : 'provider_unavailable',
      })
      response.status(503).json(safe)
    }
  })
  return app
}
