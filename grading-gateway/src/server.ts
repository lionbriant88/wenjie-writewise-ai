import cors from 'cors'
import express from 'express'
import type { ErrorRequestHandler, Request } from 'express'
import { normalizeGradingResult } from './normalizeGradingResult.js'
import { buildGradingPrompt } from './promptBuilder.js'
import { getProvider } from './providers/index.js'
import { GradingProviderError, type GradingProvider } from './providers/providerTypes.js'
import { validateGradingRequest } from './validateGradingRequest.js'

export interface CreateServerOptions {
  allowedOrigin?: string
  provider?: GradingProvider
  providerName?: string
  timeoutMs?: number
  now?: () => string
}

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
