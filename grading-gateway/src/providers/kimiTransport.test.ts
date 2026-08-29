import { describe, expect, it, vi } from 'vitest'
import { createKimiTransport, type KimiCompletionInput, type KimiTransportOptions } from './kimiTransport.js'

const maxReasoningOptions: KimiTransportOptions = {
  apiKey: 'test-only-not-a-real-key', apiBase: 'https://example.invalid/v1', model: 'kimi-k3',
  reasoningEffort: 'max', maxCompletionTokens: 8192,
}

// @ts-expect-error Kimi does not support medium reasoning effort.
const mediumReasoningOptions: KimiTransportOptions = { ...maxReasoningOptions, reasoningEffort: 'medium' }

const imageUrl = 'data:image/jpeg;base64,SGVsbG8='
const input: KimiCompletionInput = {
  schemaName: 'generated-rubric', schema: { type: 'object', additionalProperties: false },
  signal: new AbortController().signal,
  stage: 'rubric_generation', maxCompletionTokens: 4096, attempt: 3, diagnosticContext: 'random-content-free-context',
  messages: [
    { role: 'system', content: 'Return structured JSON.' },
    { role: 'user', content: [{ type: 'text', text: 'Generate a rubric.' }, { type: 'image_url', image_url: { url: imageUrl } }] },
  ],
}

const observedInput = {
  ...input, promptCacheKey: 'opaque-cache-key',
}

function responseFetch(status: number, body: string, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue(new Response(body, { status, headers: { 'Content-Type': 'application/json', ...headers } }))
}

function controlledOptions(fetchImpl: typeof fetch, times: number[] = [100, 117]) {
  return {
    ...maxReasoningOptions, fetchImpl,
    monotonicNow: () => times.shift() ?? 117,
    diagnosticIdFactory: () => 'attempt-42',
    wallClockNow: () => Date.UTC(2030, 0, 1, 0, 0, 0),
  } as unknown as KimiTransportOptions
}

async function caughtError(promise: Promise<unknown>) {
  try { await promise } catch (error) { return error }
  throw new Error('Expected promise to reject')
}

describe('createKimiTransport', () => {
  it('returns parsed value with allowlisted Kimi usage, finish reason, fresh diagnostic ID, and elapsed time', async () => {
    const fetchImpl = responseFetch(200, JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: '{"taskName":"Synthetic"}', reasoning_content: 'do not parse this' } }],
      usage: {
        prompt_tokens: 120, completion_tokens: 45, total_tokens: 165,
        prompt_tokens_details: { cached_tokens: 90, secret: 'do not retain' }, secret: 'do not retain',
      }, secret: 'do not retain',
    }))
    const log = vi.spyOn(console, 'log')
    const transport = createKimiTransport(controlledOptions(fetchImpl))

    await expect(transport.complete(observedInput)).resolves.toEqual({
      value: { taskName: 'Synthetic' },
      observation: {
        attemptDiagnosticId: 'attempt-42', finishReason: 'stop', providerElapsedMs: 17,
        usage: {
          promptTokens: { status: 'known', value: 120 }, completionTokens: { status: 'known', value: 45 },
          totalTokens: { status: 'known', value: 165 }, cachedTokens: { status: 'known', value: 90 },
        },
      },
    })
    expect(fetchImpl).toHaveBeenCalledWith('https://example.invalid/v1/chat/completions', expect.objectContaining({
      method: 'POST', headers: { Authorization: 'Bearer test-only-not-a-real-key', 'Content-Type': 'application/json' },
    }))
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'kimi-k3', reasoning_effort: 'max', max_completion_tokens: 4096, prompt_cache_key: 'opaque-cache-key',
      response_format: { type: 'json_schema', json_schema: { name: 'generated-rubric', strict: true, schema: { type: 'object', additionalProperties: false } } },
      messages: input.messages,
    })
    expect(JSON.stringify(init.body)).not.toMatch(/temperature|top_p|thinking|max_tokens|reasoning_content|random-content-free-context/i)
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('measures elapsed time through the delayed completion body read', async () => {
    let now = 100
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        now = 144
        return { choices: [{ finish_reason: 'stop', message: { content: '{"taskName":"Synthetic"}' } }] }
      },
    } as unknown as Response)
    const transport = createKimiTransport({
      ...maxReasoningOptions, fetchImpl, monotonicNow: () => now, diagnosticIdFactory: () => 'attempt-delayed',
    })

    await expect(transport.complete(observedInput)).resolves.toMatchObject({
      observation: { attemptDiagnosticId: 'attempt-delayed', providerElapsedMs: 44 },
    })
  })

  it('recaptures elapsed time when a delayed completion body fails to parse', async () => {
    let now = 100
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        now = 144
        throw new Error('SECRET delayed body failure')
      },
    } as unknown as Response)
    const transport = createKimiTransport({
      ...maxReasoningOptions, fetchImpl, monotonicNow: () => now, diagnosticIdFactory: () => 'attempt-delayed',
    })

    await expect(transport.complete(observedInput)).rejects.toMatchObject({
      diagnosticCode: 'response_json', details: {
        termination: 'confirmed', providerElapsedMs: 44,
        attemptObservations: [{
          attemptDiagnosticId: 'attempt-delayed', finishReason: 'unknown', providerElapsedMs: 44,
          usage: {
            promptTokens: { status: 'unknown', reason: 'absent' },
            completionTokens: { status: 'unknown', reason: 'absent' },
            totalTokens: { status: 'unknown', reason: 'absent' },
            cachedTokens: { status: 'unknown', reason: 'absent' },
          },
        }],
      },
    })
  })

  it('marks every absent usage field as unknown instead of inventing zero tokens', async () => {
    const transport = createKimiTransport(controlledOptions(responseFetch(200, JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: '{"taskName":"Synthetic"}' } }],
    }))))

    await expect(transport.complete(observedInput)).resolves.toMatchObject({ observation: { usage: {
      promptTokens: { status: 'unknown', reason: 'absent' }, completionTokens: { status: 'unknown', reason: 'absent' },
      totalTokens: { status: 'unknown', reason: 'absent' }, cachedTokens: { status: 'unknown', reason: 'absent' },
    } } })
  })

  it.each([
    ['negative', { prompt_tokens: -1, completion_tokens: 2, total_tokens: 1 }, 'promptTokens', 'invalid'],
    ['fractional', { prompt_tokens: 1.5, completion_tokens: 2, total_tokens: 3.5 }, 'promptTokens', 'invalid'],
    ['non-finite', { prompt_tokens: 'Infinity', completion_tokens: 2, total_tokens: 2 }, 'promptTokens', 'invalid'],
    ['unsafe integer', { prompt_tokens: Number.MAX_SAFE_INTEGER + 1, completion_tokens: 0, total_tokens: Number.MAX_SAFE_INTEGER + 1 }, 'promptTokens', 'invalid'],
    ['cached exceeds prompt', { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6, prompt_tokens_details: { cached_tokens: 5 } }, 'cachedTokens', 'inconsistent'],
    ['contradictory total', { prompt_tokens: 4, completion_tokens: 2, total_tokens: 7 }, 'totalTokens', 'inconsistent'],
  ] as const)('does not trust %s Kimi usage values', async (_caseName, usage, field, reason) => {
    const transport = createKimiTransport(controlledOptions(responseFetch(200, JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: '{"taskName":"Synthetic"}' } }], usage,
    }))))
    const result = await transport.complete(observedInput)
    expect(result).toMatchObject({ observation: { usage: { [field]: { status: 'unknown', reason } } } })
    expect(JSON.stringify(result)).not.toContain('Infinity')
  })

  it('preserves legitimate zero token observations as known', async () => {
    const transport = createKimiTransport(controlledOptions(responseFetch(200, JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: '{"taskName":"Synthetic"}' } }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } },
    }))))

    await expect(transport.complete(observedInput)).resolves.toMatchObject({ observation: { usage: {
      promptTokens: { status: 'known', value: 0 }, completionTokens: { status: 'known', value: 0 },
      totalTokens: { status: 'known', value: 0 }, cachedTokens: { status: 'known', value: 0 },
    } } })
  })

  it.each([
    ['completion_tool_calls', 'tool_calls', { tool_calls: [{ secret: 'SECRET tool' }] }],
    ['completion_finish_reason', 'content_filter', {}],
    ['completion_truncated', 'length', {}],
    ['completion_content_json_incomplete', 'stop', {}],
  ] as const)('fails closed for %s while retaining only safe terminal telemetry', async (diagnosticCode, finishReason, messageExtras) => {
    const content = diagnosticCode === 'completion_content_json_incomplete' ? '{SECRET malformed json' : '{"taskName":"Synthetic"}'
    const transport = createKimiTransport(controlledOptions(responseFetch(200, JSON.stringify({
      choices: [{ finish_reason: finishReason, message: { content, ...messageExtras } }],
      usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 }, secret: 'SECRET upstream body',
    }))))

    const error = await caughtError(transport.complete(observedInput))
    expect(error).toMatchObject({ code: 'provider_invalid_response', diagnosticCode, details: {
      diagnosticCode, termination: 'confirmed', providerElapsedMs: 17, ...(finishReason === 'stop' ? {} : { finishReason }),
      usage: {
        promptTokens: { status: 'known', value: 9 }, completionTokens: { status: 'known', value: 4 },
        totalTokens: { status: 'known', value: 13 }, cachedTokens: { status: 'unknown', reason: 'absent' },
      },
    } })
    expect(JSON.stringify(error)).not.toMatch(/SECRET|test-only-not-a-real-key|SGVsbG8/)
  })

  it.each([
    [403, 'provider_auth_failed'],
    [400, 'provider_request_rejected'],
    [422, 'provider_request_rejected'],
  ] as const)('maps HTTP %s to the safe queue-level failure %s', async (status, expectedCode) => {
    const transport = createKimiTransport(controlledOptions(responseFetch(status, '{"error":"SECRET upstream body"}')))
    const error = await caughtError(transport.complete(observedInput))

    expect(error).toMatchObject({
      code: expectedCode, retryable: false,
      details: { termination: 'confirmed', providerElapsedMs: 17 },
    })
    expect((error as { details?: { pauseAdmission?: unknown } }).details?.pauseAdmission).toBeUndefined()
    expect(JSON.stringify(error)).not.toMatch(/SECRET|test-only-not-a-real-key|SGVsbG8/)
  })

  it.each([
    ['whole seconds', '7', 7000],
    ['IMF-fixdate', 'Tue, 01 Jan 2030 08:00:05 GMT', 28_805_000],
    ['obsolete RFC850', 'Tuesday, 01-Jan-30 08:00:05 GMT', 28_805_000],
    ['asctime', 'Tue Jan  1 08:00:05 2030', 28_805_000],
  ])('preserves the valid 429 Retry-After %s without shortening it', async (_caseName, retryAfter, expectedMs) => {
    const transport = createKimiTransport(controlledOptions(responseFetch(429, '{"error":"SECRET upstream body"}', { 'Retry-After': retryAfter })))
    await expect(transport.complete(observedInput)).rejects.toMatchObject({
      code: 'provider_rate_limited', details: {
        termination: 'confirmed', providerElapsedMs: 17, retryAfterMs: expectedMs,
        attemptObservations: [{
          attemptDiagnosticId: 'attempt-42', finishReason: 'unknown', providerElapsedMs: 17,
        }],
      },
    })
  })

  it.each([
    ['at the 50-year UTC boundary', 'Monday, 01-Jan-80 00:00:00 GMT', Date.UTC(2080, 0, 1) - Date.UTC(2030, 0, 1)],
    ['one second after the 50-year UTC boundary', 'Monday, 01-Jan-80 00:00:01 GMT', undefined],
    ['later in the 50th calendar year', 'Tuesday, 31-Dec-80 08:00:05 GMT', undefined],
  ])('applies the RFC850 50-year rule to the complete timestamp: %s', async (_caseName, retryAfter, expectedMs) => {
    const transport = createKimiTransport(controlledOptions(responseFetch(429, '{"error":"SECRET upstream body"}', { 'Retry-After': retryAfter })))
    const error = await caughtError(transport.complete(observedInput))
    expect(error).toMatchObject({ code: 'provider_rate_limited', details: { termination: 'confirmed', providerElapsedMs: 17 } })
    expect((error as { details?: { retryAfterMs?: unknown } }).details?.retryAfterMs).toBe(expectedMs)
  })

  it.each(['-1', '1.5', 'Infinity', '9999999999999999999999999999999999999999999', 'not-a-date', '2030-01-01T00:00:05.000Z'])('ignores invalid 429 Retry-After %s', async (retryAfter) => {
    const transport = createKimiTransport(controlledOptions(responseFetch(429, '{"error":"SECRET upstream body"}', { 'Retry-After': retryAfter })))
    const error = await caughtError(transport.complete(observedInput))
    expect(error).toMatchObject({ code: 'provider_rate_limited', details: { termination: 'confirmed', providerElapsedMs: 17 } })
    expect((error as { details?: { retryAfterMs?: unknown } }).details?.retryAfterMs).toBeUndefined()
  })

  it.each([
    ['abort', true, 'provider_timeout'],
    ['network rejection', false, 'provider_unavailable'],
  ] as const)('marks %s as termination unknown while preserving one content-free attempt', async (_label, aborted, code) => {
    const controller = new AbortController()
    if (aborted) controller.abort()
    const transport = createKimiTransport(controlledOptions(vi.fn().mockRejectedValue(new Error('SECRET network body'))))
    const error = await caughtError(transport.complete({ ...observedInput, signal: controller.signal }))
    expect(error).toMatchObject({
      code, retryable: true, details: {
        termination: 'unknown', providerElapsedMs: 17,
        attemptObservations: [{
          attemptDiagnosticId: 'attempt-42', finishReason: 'unknown', providerElapsedMs: 17,
          usage: {
            promptTokens: { status: 'unknown', reason: 'absent' },
            completionTokens: { status: 'unknown', reason: 'absent' },
            totalTokens: { status: 'unknown', reason: 'absent' },
            cachedTokens: { status: 'unknown', reason: 'absent' },
          },
        }],
      },
    })
    expect(JSON.stringify(error)).not.toMatch(/SECRET|test-only-not-a-real-key|SGVsbG8/)
  })
})
