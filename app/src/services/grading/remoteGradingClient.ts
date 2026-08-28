import {
  gatewayInvalidResponse,
  projectGradingClientResponse,
  projectGradingFailureResponse,
  type ExpectedGradingResponse,
} from './projectGradingClientResponse'
import { normalizeGradingApiBase } from './gradingRuntimeConfig'
import type { GradingClient, GradingClientFailure, GradingFailureV1 } from './types'
import { validateMultimodalGradingRequestMode } from './validateMultimodalGradingRequestMode'

interface RemoteClientOptions {
  apiBase?: string
  fetchImpl?: typeof fetch
  now?: () => number
}

const monthNumbers: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
}
const weekdayNumbers: Record<string, number> = {
  Sun: 0, Sunday: 0, Mon: 1, Monday: 1, Tue: 2, Tuesday: 2, Wed: 3, Wednesday: 3,
  Thu: 4, Thursday: 4, Fri: 5, Friday: 5, Sat: 6, Saturday: 6,
}

function utcTimestamp(year: number, monthName: string, day: number, hour: number, minute: number, second: number) {
  const month = monthNumbers[monthName]
  if (month === undefined || day < 1 || hour > 23 || minute > 59 || second > 59) return undefined
  const timestamp = Date.UTC(year, month, day, hour, minute, second)
  if (!Number.isSafeInteger(timestamp)) return undefined
  const date = new Date(timestamp)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day
    && date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second
    ? timestamp
    : undefined
}

function utcHttpDate(
  weekday: string,
  year: number,
  monthName: string,
  day: number,
  hour: number,
  minute: number,
  second: number,
) {
  const expectedWeekday = weekdayNumbers[weekday]
  const timestamp = utcTimestamp(year, monthName, day, hour, minute, second)
  if (expectedWeekday === undefined || timestamp === undefined) return undefined
  return new Date(timestamp).getUTCDay() === expectedWeekday ? timestamp : undefined
}

function fiftyUtcYearsAfter(nowMs: number) {
  const boundary = new Date(nowMs)
  if (!Number.isFinite(boundary.getTime())) return undefined
  boundary.setUTCFullYear(boundary.getUTCFullYear() + 50)
  const timestamp = boundary.getTime()
  return Number.isSafeInteger(timestamp) ? timestamp : undefined
}

function parseHttpDate(value: string, nowMs: number) {
  const imfFixdate = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(value)
  if (imfFixdate) return utcHttpDate(imfFixdate[1], Number(imfFixdate[4]), imfFixdate[3], Number(imfFixdate[2]), Number(imfFixdate[5]), Number(imfFixdate[6]), Number(imfFixdate[7]))

  const rfc850 = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(value)
  if (rfc850) {
    const currentYear = new Date(nowMs).getUTCFullYear()
    const apparentYear = Math.floor(currentYear / 100) * 100 + Number(rfc850[4])
    const apparentTimestamp = utcTimestamp(apparentYear, rfc850[3], Number(rfc850[2]), Number(rfc850[5]), Number(rfc850[6]), Number(rfc850[7]))
    const futureBoundary = fiftyUtcYearsAfter(nowMs)
    if (apparentTimestamp === undefined || futureBoundary === undefined) return undefined
    const year = apparentTimestamp > futureBoundary ? apparentYear - 100 : apparentYear
    return utcHttpDate(rfc850[1], year, rfc850[3], Number(rfc850[2]), Number(rfc850[5]), Number(rfc850[6]), Number(rfc850[7]))
  }

  const asctime = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ( [1-9]|0[1-9]|[12]\d|3[01]) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(value)
  if (asctime) return utcHttpDate(asctime[1], Number(asctime[7]), asctime[2], Number(asctime[3]), Number(asctime[4]), Number(asctime[5]), Number(asctime[6]))
  return undefined
}

function parseRetryAfterMs(value: string | null, now: number): number | undefined {
  if (value === null) return undefined
  const normalized = value.trim()
  if (/^\d+$/.test(normalized)) {
    const seconds = Number(normalized)
    const milliseconds = seconds * 1_000
    return Number.isSafeInteger(seconds) && Number.isSafeInteger(milliseconds)
      ? milliseconds
      : undefined
  }
  if (!Number.isFinite(now) || now < 0) return undefined
  const retryAt = parseHttpDate(normalized, now)
  if (retryAt === undefined) return undefined
  const delay = retryAt - now
  return Number.isSafeInteger(delay) && delay >= 0 ? delay : undefined
}

export function attachSafeFailureMetadata(
  failure: GradingFailureV1,
  headers: Headers,
  now: number,
): GradingClientFailure {
  let retryAfterMs: number | undefined
  try { retryAfterMs = parseRetryAfterMs(headers.get('Retry-After'), now) } catch { /* Ignore hostile headers. */ }
  const reattachOnly = failure.error.code === 'provider_result_unknown' ? true : undefined
  return retryAfterMs === undefined && reattachOnly === undefined
    ? failure
    : {
        ...failure,
        clientMeta: {
          ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
          ...(reattachOnly === undefined ? {} : { reattachOnly }),
        },
      }
}

function providerNotConfigured(requestId: string): GradingFailureV1 {
  return {
    requestId, status: 'failed',
    error: { code: 'provider_not_configured', message: '批改服务尚未配置。', retryable: false },
  }
}

export function createRemoteGradingClient({
  apiBase,
  fetchImpl = fetch,
  now = Date.now,
}: RemoteClientOptions): GradingClient {
  const normalizedApiBase = normalizeGradingApiBase(apiBase)
  return {
    async gradeImages(request) {
      const requestMode = validateMultimodalGradingRequestMode(request)
      if (!requestMode.ok) {
        return { requestId: request.requestId, status: 'failed', error: { code: 'invalid_request', message: 'Grading request is invalid.', retryable: false } }
      }
      if (!normalizedApiBase) return providerNotConfigured(request.requestId)
      const form = new FormData()
      const isConfirmedTextRegrade = requestMode.mode === 'confirmed_text'
      form.append('metadata', JSON.stringify({
        requestVersion: request.requestVersion,
        requestId: request.requestId, essayId: request.essayId, pageIds: isConfirmedTextRegrade ? [] : request.pageIds, task: request.task,
        ...(request.confirmedTranscript !== undefined ? { confirmedTranscript: request.confirmedTranscript } : {}),
      }))
      if (!isConfirmedTextRegrade) request.pages.forEach(({ file }) => form.append('pages', file, file.name))
      let response: Response
      try {
        response = await fetchImpl(`${normalizedApiBase}/grading/grade-images`, {
          method: 'POST', headers: { 'X-Grading-Request-Id': request.requestId }, body: form,
        })
      } catch {
        return { requestId: request.requestId, status: 'failed', error: { code: 'gateway_unavailable', message: '批改服务暂时不可用，请重试。', retryable: true } }
      }
      let body: unknown
      try { body = await response.json() } catch { return gatewayInvalidResponse(request.requestId) }
      const expected: ExpectedGradingResponse = {
        httpOk: response.ok,
        requestId: request.requestId,
        essayId: request.essayId,
        task: request.task,
        requireMultimodal: true,
        inputMode: isConfirmedTextRegrade ? 'confirmed_text' : 'images',
        ...(request.confirmedTranscript !== undefined ? { confirmedTranscript: request.confirmedTranscript } : {}),
        pageCount: request.pages.length,
        fullScore: request.task.fullScore,
      }
      const projected = projectGradingClientResponse(body, expected)
      if (response.ok || projected.status !== 'failed') return projected
      const bodyFailure = projectGradingFailureResponse(body, expected)
      if (!bodyFailure) return projected
      let wallClockNow: number
      try { wallClockNow = now() } catch { return bodyFailure }
      return attachSafeFailureMetadata(bodyFailure, response.headers, wallClockNow)
    },
  }
}
