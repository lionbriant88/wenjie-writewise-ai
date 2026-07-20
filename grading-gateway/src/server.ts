import cors from 'cors'
import express from 'express'
import type { ErrorRequestHandler, Request } from 'express'

export interface CreateServerOptions {
  allowedOrigin?: string
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
  return app
}
