import { randomUUID } from 'node:crypto'
import {
  GradingProviderError,
  type ObservedTokenCount,
  type ProviderAttemptObservation,
  type ProviderCallStage,
  type ProviderCompletion,
  type ProviderDiagnosticCode,
  type ProviderErrorDetails,
  type ProviderUsageSnapshot,
} from './providerTypes.js'

export type KimiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface KimiMessage {
  role: 'system' | 'user'
  content: string | KimiContentPart[]
}

export interface KimiCompletionInput {
  messages: KimiMessage[]
  schemaName: string
  schema: Record<string, unknown>
  signal: AbortSignal
  stage: ProviderCallStage
  maxCompletionTokens: number
  promptCacheKey?: string
  attempt: number
  diagnosticContext: string
}

export interface KimiTransport {
  readonly maxCompletionTokens?: number
  complete(input: KimiCompletionInput): Promise<ProviderCompletion<unknown>>
}

export interface KimiTransportOptions {
  apiKey?: string
  apiBase: string
  model: string
  reasoningEffort: 'low' | 'high' | 'max'
  maxCompletionTokens: number
  fetchImpl?: typeof fetch
  monotonicNow?: () => number
  diagnosticIdFactory?: () => string
  wallClockNow?: () => number
}

function unknownUsage(reason: 'absent' | 'invalid' | 'inconsistent'): ObservedTokenCount {
  return { status: 'unknown', reason }
}

function observedInteger(value: unknown): ObservedTokenCount {
  if (value === undefined) return unknownUsage('absent')
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) return unknownUsage('invalid')
  return { status: 'known', value }
}

function isKnown(observation: ObservedTokenCount): observation is { status: 'known'; value: number } {
  return observation.status === 'known'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function usageSnapshot(value: unknown): ProviderUsageSnapshot {
  if (!isRecord(value)) {
    return {
      promptTokens: unknownUsage('absent'), completionTokens: unknownUsage('absent'),
      totalTokens: unknownUsage('absent'), cachedTokens: unknownUsage('absent'),
    }
  }
  const promptTokens = observedInteger(value.prompt_tokens)
  const completionTokens = observedInteger(value.completion_tokens)
  let totalTokens = observedInteger(value.total_tokens)
  const details = value.prompt_tokens_details
  let cachedTokens = details === undefined
    ? unknownUsage('absent')
    : isRecord(details) ? observedInteger(details.cached_tokens) : unknownUsage('invalid')

  if (isKnown(cachedTokens) && isKnown(promptTokens) && cachedTokens.value > promptTokens.value) {
    cachedTokens = unknownUsage('inconsistent')
  }
  if (isKnown(totalTokens) && isKnown(promptTokens) && isKnown(completionTokens)
    && totalTokens.value !== promptTokens.value + completionTokens.value) {
    totalTokens = unknownUsage('inconsistent')
  }
  return { promptTokens, completionTokens, totalTokens, cachedTokens }
}

function elapsedSince(startedAt: number, now: () => number) {
  const elapsed = now() - startedAt
  return Number.isFinite(elapsed) && elapsed >= 0 ? Math.floor(elapsed) : 0
}

function unknownAttemptObservation(
  attemptDiagnosticId: string,
  providerElapsedMs: number,
): ProviderAttemptObservation {
  return {
    attemptDiagnosticId,
    finishReason: 'unknown',
    usage: usageSnapshot(undefined),
    providerElapsedMs,
  }
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
  const date = new Date(timestamp)
  return date.getUTCDay() === expectedWeekday ? timestamp : undefined
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

function parseRetryAfterMs(value: string | null, wallClockNow: () => number) {
  if (value === null) return undefined
  const normalized = value.trim()
  if (/^(?:0|[1-9]\d*)$/.test(normalized)) {
    const seconds = Number(normalized)
    const milliseconds = seconds * 1_000
    return Number.isSafeInteger(seconds) && Number.isSafeInteger(milliseconds) ? milliseconds : undefined
  }
  const nowMs = wallClockNow()
  const retryAt = parseHttpDate(normalized, nowMs)
  if (retryAt === undefined) return undefined
  const delay = retryAt - nowMs
  return Number.isSafeInteger(delay) && delay >= 0 ? delay : undefined
}

function errorDetails(
  termination: 'confirmed' | 'unknown',
  providerElapsedMs: number,
  options: Omit<ProviderErrorDetails, 'termination' | 'providerElapsedMs'> = {},
): ProviderErrorDetails {
  return { termination, providerElapsedMs, ...options }
}

function unavailableError(details?: ProviderErrorDetails) {
  return new GradingProviderError('provider_unavailable', '真实 AI 服务暂时不可用。', true, undefined, details)
}

function invalidResponseError(diagnosticCode: ProviderDiagnosticCode, details?: ProviderErrorDetails) {
  const safeDetails: ProviderErrorDetails = details ?? { termination: 'confirmed' }
  return new GradingProviderError('provider_invalid_response', '真实 AI 返回了无法解析的响应。', true, diagnosticCode, {
    ...safeDetails, diagnosticCode,
  })
}

function mapKimiHttpStatus(status: number, details: ProviderErrorDetails) {
  if (status === 401) return new GradingProviderError('provider_auth_failed', '真实 AI Provider 认证失败。', false, undefined, details)
  if (status === 402) return new GradingProviderError('provider_balance_unavailable', '真实 AI Provider 额度不可用。', false, undefined, details)
  if (status === 403) return new GradingProviderError('provider_request_rejected', '真实 AI Provider 拒绝了当前模型或接口访问。', false, undefined, details)
  if (status === 429) return new GradingProviderError('provider_rate_limited', '真实 AI Provider 请求过于频繁。', true, undefined, details)
  if (status === 400 || status === 422) return new GradingProviderError('provider_request_rejected', '真实 AI Provider 拒绝了请求。', false, undefined, details)
  return unavailableError(details)
}

function unwrapJsonContent(content: string) {
  const trimmed = content.trim().replace(/^\uFEFF/, '').trim()
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed)
  return (fenced?.[1] ?? trimmed).trim()
}

function invalidJsonDiagnostic(content: string): ProviderDiagnosticCode {
  const first = content[0]
  const last = content.at(-1)
  if ((first === '{' && last !== '}') || (first === '[' && last !== ']')) {
    return 'completion_content_json_incomplete'
  }
  return 'completion_content_json_malformed'
}

function parseKimiCompletion(value: unknown, observation: ProviderAttemptObservation): ProviderCompletion<unknown> {
  const failed = (diagnosticCode: ProviderDiagnosticCode, finishReason?: ProviderErrorDetails['finishReason']): never => {
    throw invalidResponseError(diagnosticCode, errorDetails('confirmed', observation.providerElapsedMs, {
      ...(finishReason ? { finishReason } : {}), usage: observation.usage, attemptObservations: [observation],
    }))
  }
  if (!isRecord(value)) return failed('completion_envelope', 'unknown')
  const choices = value.choices
  if (!Array.isArray(choices) || choices.length === 0) return failed('completion_envelope', 'unknown')
  const choice = choices[0]
  if (!isRecord(choice)) return failed('completion_envelope', 'unknown')
  const message = choice.message
  if (!isRecord(message)) return failed('completion_envelope', 'unknown')
  if (choice.finish_reason === 'length') failed('completion_truncated', 'length')
  if (choice.finish_reason === 'tool_calls') failed('completion_tool_calls', 'tool_calls')
  if (choice.finish_reason === 'content_filter') failed('completion_finish_reason', 'content_filter')
  if (choice.finish_reason !== 'stop') failed('completion_finish_reason', 'unknown')
  if ((Array.isArray(message.tool_calls) && message.tool_calls.length > 0) || typeof message.content !== 'string' || !message.content.trim()) {
    return failed(Array.isArray(message.tool_calls) && message.tool_calls.length > 0 ? 'completion_tool_calls' : 'completion_content',
      Array.isArray(message.tool_calls) && message.tool_calls.length > 0 ? 'tool_calls' : undefined)
  }
  const jsonContent = unwrapJsonContent(message.content)
  try {
    return { value: JSON.parse(jsonContent) as unknown, observation }
  } catch {
    return failed(invalidJsonDiagnostic(jsonContent))
  }
}

export function createKimiTransport(options: KimiTransportOptions): KimiTransport {
  return {
    maxCompletionTokens: options.maxCompletionTokens,
    async complete(input) {
      if (!options.apiKey?.trim()) {
        throw new GradingProviderError('provider_not_configured', '真实 AI Provider 尚未配置。', false, undefined, {
          termination: 'confirmed',
        })
      }
      const now = options.monotonicNow ?? performance.now.bind(performance)
      const startedAt = now()
      const attemptDiagnosticId = (options.diagnosticIdFactory ?? randomUUID)()
      let response: Response
      try {
        response = await (options.fetchImpl ?? fetch)(
          `${options.apiBase.replace(/\/$/, '')}/chat/completions`,
          {
            method: 'POST',
            signal: input.signal,
            headers: {
              Authorization: `Bearer ${options.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: options.model,
              reasoning_effort: options.reasoningEffort,
              max_completion_tokens: input.maxCompletionTokens,
              ...(input.promptCacheKey ? { prompt_cache_key: input.promptCacheKey } : {}),
              response_format: {
                type: 'json_schema',
                json_schema: { name: input.schemaName, strict: true, schema: input.schema },
              },
              messages: input.messages,
            }),
          },
        )
      } catch {
        const providerElapsedMs = elapsedSince(startedAt, now)
        const details = errorDetails('unknown', providerElapsedMs, {
          attemptObservations: [unknownAttemptObservation(attemptDiagnosticId, providerElapsedMs)],
        })
        if (input.signal.aborted) throw new GradingProviderError('provider_timeout', '真实 AI 批改超时。', true, undefined, details)
        throw unavailableError(details)
      }
      if (!response.ok) {
        const providerElapsedMs = elapsedSince(startedAt, now)
        const retryAfterMs = response.status === 429
          ? parseRetryAfterMs(response.headers.get('retry-after'), options.wallClockNow ?? Date.now)
          : undefined
        throw mapKimiHttpStatus(response.status, errorDetails('confirmed', providerElapsedMs, {
          ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
          attemptObservations: [unknownAttemptObservation(attemptDiagnosticId, providerElapsedMs)],
        }))
      }
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        const providerElapsedMs = elapsedSince(startedAt, now)
        throw invalidResponseError('response_json', errorDetails('confirmed', providerElapsedMs, {
          finishReason: 'unknown',
          attemptObservations: [unknownAttemptObservation(attemptDiagnosticId, providerElapsedMs)],
        }))
      }
      const providerElapsedMs = elapsedSince(startedAt, now)
      const choice = isRecord(payload) && Array.isArray(payload.choices) ? payload.choices[0] : undefined
      const rawFinishReason = isRecord(choice) ? choice.finish_reason : undefined
      const message = isRecord(choice) && isRecord(choice.message) ? choice.message : undefined
      const finishReason = (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0)
        ? 'tool_calls'
        : rawFinishReason === 'stop' || rawFinishReason === 'length' || rawFinishReason === 'content_filter' || rawFinishReason === 'tool_calls'
          ? rawFinishReason
          : 'unknown'
      return parseKimiCompletion(payload, {
        attemptDiagnosticId, finishReason, usage: usageSnapshot(isRecord(payload) ? payload.usage : undefined), providerElapsedMs,
      })
    },
  }
}
