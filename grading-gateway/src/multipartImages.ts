import type { GatewayImageInput } from './providers/multimodalProviderTypes.js'

const SUPPORTED_IMAGE_TYPES = new Set<GatewayImageInput['mimeType']>(['image/png', 'image/jpeg', 'image/webp'])

export const MAX_RUBRIC_PAGES = 10
export const MAX_RUBRIC_IMAGE_BYTES = 8 * 1024 * 1024

export type MultipartValidationResult =
  | { ok: true, value: { requestId: string; fullScore: number; pages: GatewayImageInput[] } }
  | { ok: false, error: { code: 'invalid_request' | 'request_too_large'; message: string } }

function invalid(message: string): MultipartValidationResult {
  return { ok: false, error: { code: 'invalid_request', message } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null
}

function readPageIds(value: unknown): string[] | null {
  if (typeof value !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_RUBRIC_PAGES) return null
    const pageIds = parsed.map((pageId) => readString(pageId, 128))
    if (!pageIds.every((pageId): pageId is string => pageId !== null)) return null
    return new Set(pageIds).size === pageIds.length ? pageIds : null
  } catch {
    return null
  }
}

export function requestIdFromMultipartBody(value: unknown): string {
  if (!isRecord(value)) return 'unavailable'
  return readString(value.requestId, 128) ?? 'unavailable'
}

export function validateRubricMultipart(
  body: unknown,
  files: readonly globalThis.Express.Multer.File[] | undefined,
): MultipartValidationResult {
  if (!isRecord(body)) return invalid('Rubric request is invalid.')
  const requestId = readString(body.requestId, 128)
  const fullScore = typeof body.fullScore === 'string' ? Number(body.fullScore) : Number.NaN
  const pageIds = readPageIds(body.pageIds)
  if (!requestId || !Number.isInteger(fullScore) || fullScore < 1 || fullScore > 100 || !pageIds || !files || files.length !== pageIds.length) {
    return invalid('Rubric request is invalid.')
  }
  if (files.some((file) => file.size > MAX_RUBRIC_IMAGE_BYTES)) {
    return { ok: false, error: { code: 'request_too_large', message: 'Rubric upload exceeds the allowed limit.' } }
  }
  if (files.some((file) => !SUPPORTED_IMAGE_TYPES.has(file.mimetype as GatewayImageInput['mimeType']))) {
    return invalid('Rubric images must be PNG, JPEG, or WebP files within the size limit.')
  }
  return {
    ok: true,
    value: {
      requestId,
      fullScore,
      pages: files.map((file, index) => ({
        pageId: pageIds[index]!,
        mimeType: file.mimetype as GatewayImageInput['mimeType'],
        buffer: file.buffer,
      })),
    },
  }
}
