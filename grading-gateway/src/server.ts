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
import { GRADING_POLICY_VERSION } from './multimodal/gradingPolicy.js'
import { createCanonicalGradeIdentity } from './multimodal/logicalRequestIdentity.js'
import {
  ESSAY_PROVIDER_SCHEMA_VERSION,
  LEGACY_ESSAY_PROVIDER_SCHEMA_VERSION,
} from './multimodal/modelTaskContext.js'
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
import { EssayGradingRegistry, type RegistryAttachResult, type RegistryTimers } from './essayGradingRegistry.js'
import { OneShotProviderExecutionTracker, type OneShotExecutionOutcome } from './oneShotProviderExecution.js'
import { ProviderAdmissionController } from './providerAdmissionController.js'
import type { ClassReviewSynthesisProvider } from './providers/classReviewSynthesisProviderTypes.js'
import {
  parseClassReviewFramingCalibration,
  type ClassReviewFramingCalibration,
} from './classReviewSynthesis/framingCalibrations.js'
import { authorizeClassReviewServiceRequest } from './classReviewSynthesis/serviceAuth.js'
import { ClassReviewRuntimeInvariant } from './classReviewSynthesis/runtimeInvariant.js'
import { ClassReviewSynthesisService } from './classReviewSynthesis/service.js'
import type { ClassReviewPromptTokenizer } from './classReviewSynthesis/promptBudget.js'
import { validateClassReviewSynthesisRequest } from './classReviewSynthesis/validateRequest.js'

export interface GatewayExecutionTimers extends RegistryTimers {}

export interface GatewayExecutionServices {
  admission: ProviderAdmissionController
  registry: EssayGradingRegistry
  oneShot: OneShotProviderExecutionTracker
}

export interface GatewayExecutionServiceOptions {
  now?: () => number
  random?: () => number
  timers?: GatewayExecutionTimers
}

export function createGatewayExecutionServices(
  runtimeConfig: GatewayRuntimeConfig,
  options: GatewayExecutionServiceOptions = {},
): GatewayExecutionServices {
  const sharedNow = options.now ?? performance.now.bind(performance)
  const admission = new ProviderAdmissionController({
    hardLimit: runtimeConfig.admission.hardLimit,
    now: sharedNow,
  })
  const shared = {
    admission,
    providerFinalDeadlineMs: runtimeConfig.deadlines.providerFinalMs,
    settlementGraceMs: runtimeConfig.deadlines.settlementGraceMs,
    retryAfterPauseMs: runtimeConfig.retry.pauseAfterMs,
    now: sharedNow,
    ...(options.timers ? { timers: options.timers } : {}),
  }
  return {
    admission,
    registry: new EssayGradingRegistry({
      ...shared,
      terminalTtlMs: runtimeConfig.registry.terminalTtlMs,
      maxEntries: runtimeConfig.registry.maxEntries,
      maxProviderAttempts: runtimeConfig.retry.maxProviderAttempts,
      maxRateLimitRequeues: runtimeConfig.retry.maxRateLimitRequeues,
      retryBaseMs: runtimeConfig.retry.baseMs,
      retryCapMs: runtimeConfig.retry.capMs,
      ...(options.random ? { random: options.random } : {}),
    }),
    oneShot: new OneShotProviderExecutionTracker(shared),
  }
}

export interface CreateServerOptions {
  allowedOrigin?: string
  multimodalProvider?: MultimodalProvider
  runtimeConfig?: GatewayRuntimeConfig
  timeoutMs?: number
  now?: () => string
  onDiagnostic?: SafeGradingDiagnosticSink
  providerTelemetry?: ProviderTelemetryRecorder
  executionServices?: GatewayExecutionServices
  monotonicNow?: () => number
  executionTimers?: GatewayExecutionTimers
  classReviewProvider?: ClassReviewSynthesisProvider
  classReviewFramingCalibration?: ClassReviewFramingCalibration | null
  classReviewRuntimeInvariant?: ClassReviewRuntimeInvariant
  classReviewTokenizer?: ClassReviewPromptTokenizer
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
export const MAX_CLASS_REVIEW_JSON_BYTES = 64 * 1024
const CLASS_REVIEW_SYNTHESIS_PATH = '/grading/class-review-syntheses'
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

function safeRuntimeSnapshot(
  config: GatewayRuntimeConfig | undefined,
  admission: ProviderAdmissionController | undefined,
  classReviewInvariant?: ClassReviewRuntimeInvariant,
) {
  if (!config) return { status: 'unconfigured' as const }
  const admissionSnapshot = admission?.snapshot()
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
    classReviewSynthesis: config.classReviewSynthesis.mode === 'disabled'
      ? { mode: 'disabled' as const }
      : {
          mode: config.classReviewSynthesis.mode,
          maxCompletionTokens: config.classReviewSynthesis.maxCompletionTokens,
          promptInvariant: config.classReviewSynthesis.mode === 'fake'
            ? 'not_applicable' as const
            : classReviewInvariant?.snapshot().promptContract ?? 'ready',
        },
    admission: admissionSnapshot
      ? {
          managed: true,
          paused: admissionSnapshot.pauseReason !== null || admissionSnapshot.rateLimitNotBeforeMs !== null,
          pauseReason: admissionSnapshot.pauseReason
            ?? (admissionSnapshot.rateLimitNotBeforeMs === null ? null : 'rate_limited'),
          rateLimited: admissionSnapshot.rateLimitNotBeforeMs !== null,
          hardLimit: admissionSnapshot.hardLimit,
          target: admissionSnapshot.target,
          active: admissionSnapshot.activeLeases,
          stableSuccesses: admissionSnapshot.stableSuccesses,
        }
      : { managed: false },
  }
}

function providerFor(options: CreateServerOptions): MultimodalProvider {
  if (options.multimodalProvider) return options.multimodalProvider
  throw new GradingProviderError('provider_not_configured', 'AI Provider is not configured.', false, undefined, {
    termination: 'confirmed',
  })
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
    return runObservedProvider(telemetry, options, stage, runProvider)
  })
}

async function runObservedProvider<T>(
  telemetry: ProviderTelemetryRecorder,
  options: CreateServerOptions,
  stage: ProviderCallStage,
  runProvider: () => Promise<ProviderCallResult<T>>,
): Promise<ProviderCallResult<T>> {
  try {
    const result = await runProvider()
    recordUniqueProviderAttempts(telemetry, telemetryContext(options, stage, 'success'), result.attempts)
    return result
  } catch (error) {
    recordErrorAttempts(telemetry, options, stage, error)
    throw error
  }
}

const RESULT_UNKNOWN_MESSAGE = '批改结果状态暂时未知，请稍后检查同一任务。'
const PROVIDER_TIMEOUT_MESSAGE = 'AI grading timed out.'
const defaultGatewayExecutionTimers: GatewayExecutionTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

function validMonotonicNow(now: () => number): number {
  const value = now()
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid injected monotonic clock.')
  return value
}

function setTruthfulRetryAfter(response: Response, retryAfterMs: number | undefined): void {
  if (retryAfterMs === undefined || !Number.isFinite(retryAfterMs) || retryAfterMs < 0) return
  const seconds = Math.ceil(retryAfterMs / 1_000)
  if (!Number.isSafeInteger(seconds)) return
  response.setHeader('Retry-After', String(seconds))
}

function sendRegistryResult(response: Response, result: RegistryAttachResult): void {
  if (result.response.status !== 'failed') {
    response.json(result.response)
    return
  }
  const code = result.response.error.code
  const status = result.disposition === 'identity_conflict'
    ? 409
    : code === 'provider_rate_limited'
      ? 429
      : 503
  if (status === 429 || result.response.error.retryable) setTruthfulRetryAfter(response, result.retryAfterMs)
  response.status(status).json(result.response)
}

function admissionFailure(
  requestId: string,
  services: GatewayExecutionServices,
  outcome: Extract<OneShotExecutionOutcome<unknown>, { kind: 'admission_rejected' }>,
) {
  const pauseReason = services.admission.snapshot().pauseReason
  const code = pauseReason === 'provider_auth_failed'
    ? 'provider_auth_failed'
    : pauseReason === 'provider_balance_unavailable'
      ? 'provider_balance_unavailable'
      : pauseReason === 'provider_not_configured'
        ? 'provider_not_configured'
        : pauseReason === 'provider_access_denied'
          ? 'provider_request_rejected'
        : 'provider_rate_limited'
  return {
    status: code === 'provider_rate_limited' ? 429 : 503,
    body: failure(requestId, {
      code,
      message: code === 'provider_rate_limited'
        ? PROVIDER_SAFE_MESSAGES.provider_rate_limited
        : PROVIDER_SAFE_MESSAGES[code],
    }, code === 'provider_rate_limited'),
    retryAfterMs: code === 'provider_rate_limited' ? outcome.decision.retryAfterMs : undefined,
  }
}

function sendOneShotFailure(
  response: Response,
  requestId: string,
  services: GatewayExecutionServices,
  outcome: Exclude<OneShotExecutionOutcome<unknown>, { kind: 'success' }>,
): void {
  if (outcome.kind === 'result_unknown') {
    response.status(503).json(failure(requestId, {
      code: 'provider_result_unknown', message: RESULT_UNKNOWN_MESSAGE,
    }, false))
    return
  }
  if (outcome.kind === 'caller_timeout_before_dispatch') {
    response.status(503).json(failure(requestId, {
      code: 'provider_timeout', message: PROVIDER_TIMEOUT_MESSAGE,
    }, true))
    return
  }
  if (outcome.kind === 'admission_rejected') {
    const safe = admissionFailure(requestId, services, outcome)
    if (safe.status === 429) setTruthfulRetryAfter(response, safe.retryAfterMs)
    response.status(safe.status).json(safe.body)
    return
  }
  const safe = toSafeFailure(requestId, outcome.error)
  const providerError = outcome.error instanceof GradingProviderError ? outcome.error : undefined
  const isRateLimited = providerError?.code === 'provider_rate_limited'
  if (isRateLimited) setTruthfulRetryAfter(response, providerError.details?.retryAfterMs)
  response.status(isRateLimited ? 429 : 503).json(safe)
}

type RegistryCallerOutcome =
  | { kind: 'result'; value: RegistryAttachResult }
  | { kind: 'result_unknown' }
  | { kind: 'caller_timeout_before_dispatch' }

async function attachRegistryUntilCallerDeadline(input: {
  services: GatewayExecutionServices
  receivedAt: number
  httpDeadlineMs: number
  logicalRequestId: string
  timers: GatewayExecutionTimers
  now: () => number
  attach(): Promise<RegistryAttachResult>
}): Promise<RegistryCallerOutcome> {
  const current = validMonotonicNow(input.now)
  const deadlineAt = input.receivedAt + input.httpDeadlineMs
  if (!Number.isFinite(deadlineAt)) throw new Error('Invalid injected server deadline.')
  if (current >= deadlineAt) return { kind: 'caller_timeout_before_dispatch' }

  let timer: unknown
  const deadline = new Promise<RegistryCallerOutcome>((resolve) => {
    timer = input.timers.setTimeout(() => {
      timer = undefined
      const state = input.services.registry.inspect(input.logicalRequestId)?.state
      resolve(state === 'in_flight' || state === 'orphaned_unknown'
        ? { kind: 'result_unknown' }
        : { kind: 'caller_timeout_before_dispatch' })
    }, deadlineAt - current)
  })
  const attachment = Promise.resolve().then(input.attach).then((value): RegistryCallerOutcome => ({ kind: 'result', value }))
  const outcome = await Promise.race([attachment, deadline])
  if (timer !== undefined) input.timers.clearTimeout(timer)
  return outcome
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

const classReviewJsonParser = express.json({
  limit: MAX_CLASS_REVIEW_JSON_BYTES,
  strict: true,
  type: 'application/json',
})

function fixedClassReviewError(response: Response, status: number, code: string, message: string) {
  response.status(status).json({ error: { code, message } })
}

function hasOriginHeader(request: Request): boolean {
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === 'origin') return true
  }
  return Object.prototype.hasOwnProperty.call(request.headers, 'origin')
}

export function createServer(options: CreateServerOptions = {}) {
  const timeoutMs = options.timeoutMs ?? options.runtimeConfig?.deadlines.httpMs ?? 60_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Invalid injected server deadline.')
  const monotonicNow = options.monotonicNow ?? performance.now.bind(performance)
  const executionTimers = options.executionTimers ?? defaultGatewayExecutionTimers
  const memoryExecution = options.runtimeConfig?.executionRegistry === 'memory-v1'
    ? options.executionServices ?? createGatewayExecutionServices(options.runtimeConfig, {
        now: monotonicNow,
        timers: executionTimers,
      })
    : undefined
  if (options.executionServices && !memoryExecution) {
    throw new Error('Injected execution services require the memory-v1 execution profile.')
  }
  const telemetry = options.providerTelemetry ?? createProviderTelemetryRecorder()
  const classRuntime = options.runtimeConfig?.classReviewSynthesis ?? { mode: 'disabled' as const }
  const classReviewInvariant = options.classReviewRuntimeInvariant ?? new ClassReviewRuntimeInvariant()
  const calibrationWasInjected = Object.prototype.hasOwnProperty.call(
    options,
    'classReviewFramingCalibration',
  )
  let classReviewService: ClassReviewSynthesisService | undefined
  if (classRuntime.mode === 'disabled') {
    if (options.classReviewProvider !== undefined || calibrationWasInjected) {
      throw new Error('Invalid class review runtime construction.')
    }
  } else {
    if (!memoryExecution || !options.classReviewProvider) {
      throw new Error('Invalid class review runtime construction.')
    }
    const calibration = parseClassReviewFramingCalibration(
      classRuntime.mode === 'fake'
        ? options.classReviewFramingCalibration
        : calibrationWasInjected
          ? options.classReviewFramingCalibration
          : classRuntime.framingCalibration,
    )
    if (calibration === null) throw new Error('Invalid class review runtime construction.')
    if (classRuntime.mode === 'kimi'
      && JSON.stringify(calibration) !== JSON.stringify(classRuntime.framingCalibration)) {
      throw new Error('Invalid class review runtime construction.')
    }
    classReviewService = new ClassReviewSynthesisService({
      mode: classRuntime.mode,
      provider: options.classReviewProvider,
      admission: memoryExecution.admission,
      oneShot: memoryExecution.oneShot,
      calibration,
      ...(options.classReviewTokenizer ? { tokenizer: options.classReviewTokenizer } : {}),
      ...(classRuntime.mode === 'kimi'
        ? { hmacSecret: options.runtimeConfig?.kimi.promptCacheSecret }
        : {}),
      runtimeInvariant: classReviewInvariant,
      providerTelemetry: telemetry,
      monotonicNow,
    })
  }
  const app = express()
  const routeReceiptTimes = new WeakMap<Request, number>()
  const captureRouteReceipt = (request: Request, _response: Response, next: NextFunction) => {
    routeReceiptTimes.set(request, validMonotonicNow(monotonicNow))
    next()
  }
  const receivedAt = (request: Request) => routeReceiptTimes.get(request) ?? validMonotonicNow(monotonicNow)
  app.all(CLASS_REVIEW_SYNTHESIS_PATH, (request, response) => {
    if (request.path !== CLASS_REVIEW_SYNTHESIS_PATH) {
      fixedClassReviewError(response, 404, 'not_found', 'Not found.')
      return
    }
    const routeReceivedAt = validMonotonicNow(monotonicNow)
    if (classRuntime.mode === 'disabled' || !classReviewService) {
      fixedClassReviewError(response, 404, 'not_found', 'Not found.')
      return
    }
    if (hasOriginHeader(request)) {
      fixedClassReviewError(
        response,
        403,
        'browser_origin_forbidden',
        'Browser-origin requests are not allowed.',
      )
      return
    }
    if (request.method !== 'POST') {
      fixedClassReviewError(response, 404, 'not_found', 'Not found.')
      return
    }
    const authorizationHeader = typeof request.headers.authorization === 'string'
      ? request.headers.authorization
      : undefined
    const auth = authorizeClassReviewServiceRequest({
      originPresent: false,
      authorizationHeader,
      expectedToken: classRuntime.serviceToken,
    })
    if (auth !== 'authorized') {
      response.setHeader('WWW-Authenticate', 'Bearer')
      fixedClassReviewError(
        response,
        401,
        'service_auth_required',
        'Internal service authentication failed.',
      )
      return
    }

    classReviewJsonParser(request, response, (error) => {
      if (error) {
        const record = errorRecord(error)
        if (record?.type === 'entity.too.large' || record?.status === 413) {
          fixedClassReviewError(
            response,
            413,
            'request_too_large',
            'Class review synthesis request is too large.',
          )
        } else {
          fixedClassReviewError(
            response,
            400,
            'invalid_json',
            'Request body must be valid JSON.',
          )
        }
        return
      }
      const validated = validateClassReviewSynthesisRequest(request.body)
      if (!validated.ok) {
        fixedClassReviewError(
          response,
          400,
          'invalid_request',
          'Class review synthesis request is invalid.',
        )
        return
      }
      void classReviewService.synthesize({
        request: validated.value,
        receivedAt: routeReceivedAt,
        httpDeadlineMs: timeoutMs,
      }).then((safe) => {
        if (safe.httpStatus === 429 && safe.result.status === 'failed'
          && safe.result.safeFailureCode === 'provider_rate_limited'
          && safe.result.retryAfterMs !== null) {
          setTruthfulRetryAfter(response, safe.result.retryAfterMs)
        }
        response.status(safe.httpStatus).json(safe.result)
      }).catch(() => {
        fixedClassReviewError(
          response,
          503,
          'service_unavailable',
          'Class review synthesis service is unavailable.',
        )
      })
    })
  })
  app.use(cors({
    origin: options.allowedOrigin ?? 'http://127.0.0.1:5173',
    allowedHeaders: ['Content-Type', 'X-Grading-Request-Id'],
    exposedHeaders: ['Retry-After'],
  }))
  app.get('/health', (_request, response) => {
    response.json({
      ok: true,
      service: 'grading-gateway',
      runtime: safeRuntimeSnapshot(
        options.runtimeConfig,
        memoryExecution?.admission,
        classReviewInvariant,
      ),
    })
  })
  app.post('/tasks/material-context', captureRouteReceipt, taskMaterialUploadBoundary, async (request, response) => {
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

    if (memoryExecution) {
      const outcome = await memoryExecution.oneShot.run({
        receivedAt: receivedAt(request),
        httpDeadlineMs: timeoutMs,
        execute: ({ signal }) => {
          const provider = providerFor(options)
          return runObservedProvider(telemetry, options, 'material_context', () => provider.generateMaterialContext({
            requestId: validated.value.requestId,
            fullScore: validated.value.fullScore,
            writingRequirement,
            materials: validated.value.materials,
            signal,
          }))
        },
      })
      if (outcome.kind !== 'success') {
        emitSafeGradingDiagnostic(options.onDiagnostic, {
          stage: 'provider',
          diagnosticCode: outcome.kind === 'failure' && outcome.error instanceof GradingProviderError
            ? outcome.error.diagnosticCode ?? outcome.error.code
            : outcome.kind === 'caller_timeout_before_dispatch'
              ? 'provider_timeout'
              : outcome.kind === 'result_unknown'
                ? 'provider_result_unknown'
                : 'provider_rate_limited',
        })
        sendOneShotFailure(response, validated.value.requestId, memoryExecution, outcome)
        return
      }
      const context = validateTaskMaterialContext(outcome.value.value)
      if (!context.ok) {
        emitSafeGradingDiagnostic(options.onDiagnostic, { stage: 'normalization', diagnosticCode: 'material_context_validation' })
        response.status(503).json(failure(validated.value.requestId, context.error, true))
        return
      }
      response.json({ requestId: validated.value.requestId, status: 'success', materialContext: context.value })
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

  app.post('/tasks/rubric', captureRouteReceipt, taskMaterialUploadBoundary, async (request, response) => {
    const files = Array.isArray(request.files) ? request.files : undefined
    const validated = validateTaskMaterialMultipart(request.body, files, 'optional')
    if (!validated.ok) {
      response.status(validated.error.code === 'request_too_large' ? 413 : 400)
        .json(failure(requestIdFromMultipartBody(request.body), validated.error, false))
      return
    }

    if (memoryExecution) {
      const outcome = await memoryExecution.oneShot.run({
        receivedAt: receivedAt(request),
        httpDeadlineMs: timeoutMs,
        execute: ({ signal }) => {
          const provider = providerFor(options)
          return runObservedProvider(telemetry, options, 'rubric_generation', () => provider.generateRubric({
            ...validated.value,
            signal,
          }))
        },
      })
      if (outcome.kind !== 'success') {
        emitSafeGradingDiagnostic(options.onDiagnostic, {
          stage: 'provider',
          diagnosticCode: outcome.kind === 'failure' && outcome.error instanceof GradingProviderError
            ? outcome.error.diagnosticCode ?? outcome.error.code
            : outcome.kind === 'caller_timeout_before_dispatch'
              ? 'provider_timeout'
              : outcome.kind === 'result_unknown'
                ? 'provider_result_unknown'
                : 'provider_rate_limited',
        })
        sendOneShotFailure(response, validated.value.requestId, memoryExecution, outcome)
        return
      }
      const rubric = validateGeneratedRubric(outcome.value.value)
      if (!rubric.ok) {
        emitSafeGradingDiagnostic(options.onDiagnostic, { stage: 'normalization', diagnosticCode: 'rubric_validation' })
        response.status(503).json(failure(validated.value.requestId, rubric.error, true))
        return
      }
      response.json({ requestId: validated.value.requestId, status: 'success', rubric: rubric.value })
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
  app.post('/grading/grade-images', captureRouteReceipt, (request, response, next) => {
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
    if (memoryExecution && options.runtimeConfig) {
      let identity
      try {
        identity = createCanonicalGradeIdentity({
          task: metadata.task,
          essayId: metadata.essayId,
          pageIds: metadata.pageIds,
          pages,
          confirmedTranscript: metadata.confirmedTranscript,
        }, {
          gradingPolicyVersion: GRADING_POLICY_VERSION,
          providerSchemaVersion: options.runtimeConfig.essayPromptProfile === 'optimized-v1'
            ? ESSAY_PROVIDER_SCHEMA_VERSION
            : LEGACY_ESSAY_PROVIDER_SCHEMA_VERSION,
        })
      } catch {
        response.status(400).json(failure(metadata.requestId, {
          code: 'invalid_request', message: 'Image grading request is invalid.',
        }, false))
        return
      }

      const stage: ProviderCallStage = metadata.confirmedTranscript === undefined
        ? 'essay_grading_images'
        : 'essay_regrading_text'
      const operationMedia = safeImageOperationMetadata(pages)
      const callerOutcome = await attachRegistryUntilCallerDeadline({
        services: memoryExecution,
        receivedAt: receivedAt(request),
        httpDeadlineMs: timeoutMs,
        logicalRequestId: identity.logicalRequestId,
        timers: executionTimers,
        now: monotonicNow,
        attach: () => memoryExecution.registry.attach({
          logicalRequestId: identity.logicalRequestId,
          payloadHash: identity.payloadHash,
          callerRequestId: metadata.requestId,
          execute: async ({ signal }) => {
            const operationDiagnosticId = randomUUID()
            const operationStartedAt = validMonotonicNow(monotonicNow)
            let operationRecorded = false
            try {
              const provider = providerFor(options)
              const payload = await runObservedProvider(telemetry, options, stage, () => provider.gradeEssay({
                requestId: metadata.requestId,
                task: metadata.task,
                essayId: metadata.essayId,
                pages,
                confirmedTranscript: metadata.confirmedTranscript,
                signal,
              }))
              const normalizeStartedAt = validMonotonicNow(monotonicNow)
              const normalized = normalizeMultimodalResult(payload.value, {
                requestId: metadata.requestId,
                essayId: metadata.essayId,
                task: metadata.task,
                provider: 'remote',
                pageCount: pages.length,
                confirmedTranscript: metadata.confirmedTranscript,
                createdAt: (options.now ?? (() => new Date().toISOString()))(),
              })
              const normalizeMs = validMonotonicNow(monotonicNow) - normalizeStartedAt
              if (!normalized.ok) {
                recordProviderOperation(telemetry, {
                  ...telemetryContext(options, stage, 'failed'), operationDiagnosticId,
                  normalizeMs, totalMs: validMonotonicNow(monotonicNow) - operationStartedAt,
                  ...operationMedia,
                  ...(metadata.confirmedTranscript === undefined
                    ? {}
                    : { confirmedTextCodeUnits: metadata.confirmedTranscript.length }),
                })
                operationRecorded = true
                emitSafeGradingDiagnostic(options.onDiagnostic, {
                  stage: 'normalization', diagnosticCode: normalized.error.diagnosticCode,
                })
                throw new GradingProviderError(
                  'provider_invalid_response',
                  PROVIDER_SAFE_MESSAGES.provider_invalid_response,
                  true,
                  undefined,
                  { termination: 'confirmed', attemptObservations: payload.attempts },
                )
              }
              recordProviderOperation(telemetry, {
                ...telemetryContext(options, stage, 'success'), operationDiagnosticId,
                normalizeMs, totalMs: validMonotonicNow(monotonicNow) - operationStartedAt,
                ...operationMedia,
                ...(metadata.confirmedTranscript === undefined
                  ? {}
                  : { confirmedTextCodeUnits: metadata.confirmedTranscript.length }),
              })
              operationRecorded = true
              const { requestId: _requestId, ...resultTemplate } = normalized.result
              return { result: resultTemplate, attempts: payload.attempts }
            } catch (error) {
              if (!operationRecorded) {
                recordProviderOperation(telemetry, {
                  ...telemetryContext(
                    options,
                    stage,
                    error instanceof GradingProviderError && error.details?.termination === 'confirmed'
                      ? 'failed'
                      : 'result_unknown',
                  ),
                  operationDiagnosticId,
                  totalMs: validMonotonicNow(monotonicNow) - operationStartedAt,
                  ...operationMedia,
                  ...(metadata.confirmedTranscript === undefined
                    ? {}
                    : { confirmedTextCodeUnits: metadata.confirmedTranscript.length }),
                })
                emitSafeGradingDiagnostic(options.onDiagnostic, {
                  stage: 'provider',
                  diagnosticCode: error instanceof GradingProviderError
                    ? error.diagnosticCode ?? error.code
                    : 'provider_unavailable',
                })
              }
              throw error
            }
          },
        }),
      })
      if (callerOutcome.kind === 'result') {
        sendRegistryResult(response, callerOutcome.value)
      } else if (callerOutcome.kind === 'result_unknown') {
        response.status(503).json(failure(metadata.requestId, {
          code: 'provider_result_unknown', message: RESULT_UNKNOWN_MESSAGE,
        }, false))
      } else {
        response.status(503).json(failure(metadata.requestId, {
          code: 'provider_timeout', message: PROVIDER_TIMEOUT_MESSAGE,
        }, true))
      }
      return
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
