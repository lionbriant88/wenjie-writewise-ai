import { describe, expect, it, vi } from 'vitest'
import { createKimiTransport, type KimiCompletionInput, type KimiTransportOptions } from './kimiTransport.js'

const maxReasoningOptions: KimiTransportOptions = {
  apiKey: 'test-only-not-a-real-key',
  apiBase: 'https://example.invalid/v1',
  model: 'kimi-k3',
  reasoningEffort: 'max',
  maxCompletionTokens: 8192,
}

// @ts-expect-error Kimi does not support medium reasoning effort.
const mediumReasoningOptions: KimiTransportOptions = { ...maxReasoningOptions, reasoningEffort: 'medium' }

const imageUrl = 'data:image/jpeg;base64,SGVsbG8='
const input: KimiCompletionInput = {
  schemaName: 'generated-rubric',
  schema: { type: 'object', additionalProperties: false },
  signal: new AbortController().signal,
  messages: [
    { role: 'system', content: 'Return structured JSON.' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Generate a rubric.' },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    },
  ],
}

function responseFetch(status: number, body: string) {
  return vi.fn().mockResolvedValue(new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  }))
}

describe('createKimiTransport', () => {
  it('can observe a secret stored only in Error.message', () => {
    const leakyError = new Error('SECRET message-only value')
    expect(JSON.stringify(leakyError)).not.toContain('SECRET message-only value')
    expect(leakyError.message).toContain('SECRET message-only value')
  })

  it('posts Kimi K3 JSON-schema messages with Base64 image parts only', async () => {
    const fetchImpl = responseFetch(200, JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: '{"taskName":"Synthetic"}', reasoning_content: 'do not parse this' } }],
    }))
    const log = vi.spyOn(console, 'log')
    const transport = createKimiTransport({
      apiKey: 'test-only-not-a-real-key',
      apiBase: 'https://example.invalid/v1/',
      model: 'kimi-k3',
      reasoningEffort: 'high',
      maxCompletionTokens: 8192,
      fetchImpl,
    })

    await expect(transport.complete(input)).resolves.toEqual({ taskName: 'Synthetic' })
    expect(fetchImpl).toHaveBeenCalledWith('https://example.invalid/v1/chat/completions', expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer test-only-not-a-real-key', 'Content-Type': 'application/json' },
    }))
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'kimi-k3',
      reasoning_effort: 'high',
      max_completion_tokens: 8192,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'generated-rubric', strict: true,
          schema: { type: 'object', additionalProperties: false },
        },
      },
      messages: input.messages,
    })
    const body = JSON.stringify(init.body)
    expect(body).not.toMatch(/temperature|top_p|thinking|max_tokens|reasoning_content/i)
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it.each([
    ['a single JSON markdown fence', '```json\n{"taskName":"Synthetic"}\n```'],
    ['a leading byte-order mark', '\ufeff{"taskName":"Synthetic"}'],
  ])('accepts %s before applying the strict result normalizer', async (_caseName, content) => {
    const transport = createKimiTransport({
      ...maxReasoningOptions,
      fetchImpl: responseFetch(200, JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] })),
    })

    await expect(transport.complete(input)).resolves.toEqual({ taskName: 'Synthetic' })
  })

  it.each([
    [401, 'provider_auth_failed', false],
    [402, 'provider_balance_unavailable', false],
    [403, 'provider_request_rejected', false],
    [429, 'provider_rate_limited', true],
  ] as const)('maps HTTP %s without exposing upstream data', async (status, code, retryable) => {
    const transport = createKimiTransport({
      apiKey: 'test-only-not-a-real-key',
      apiBase: 'https://example.invalid/v1',
      model: 'kimi-k3', reasoningEffort: 'high', maxCompletionTokens: 8192,
      fetchImpl: responseFetch(status, '{"error":"SECRET upstream body"}'),
    })

    await expect(transport.complete(input)).rejects.toMatchObject({ code, retryable })
    try {
      await transport.complete(input)
    } catch (error) {
      expect(error).toMatchObject({ code, retryable })
      const message = (error as Error).message
      expect(message).not.toContain('SECRET upstream body')
      expect(message).not.toContain('test-only-not-a-real-key')
      expect(message).not.toContain(imageUrl)
    }
  })

  it('maps an aborted request without returning the network error', async () => {
    const controller = new AbortController()
    controller.abort()
    const transport = createKimiTransport({
      apiKey: 'test-only-not-a-real-key', apiBase: 'https://example.invalid/v1', model: 'kimi-k3',
      reasoningEffort: 'high', maxCompletionTokens: 8192,
      fetchImpl: vi.fn().mockRejectedValue(new Error('SECRET network body')),
    })
    await expect(transport.complete({ ...input, signal: controller.signal }))
      .rejects.toMatchObject({ code: 'provider_timeout', retryable: true })
  })

  it.each([
    ['response_json', '<html>SECRET upstream body</html>'],
    ['completion_envelope', JSON.stringify({ choices: [] })],
    ['completion_tool_calls', JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: '{"taskName":"Synthetic"}', tool_calls: [{ secret: 'SECRET tool' }] } }] })],
    ['completion_finish_reason', JSON.stringify({ choices: [{ finish_reason: 'content_filter', message: { content: '{"taskName":"Synthetic"}' } }] })],
    ['completion_finish_reason', JSON.stringify({ choices: [{ finish_reason: 'unknown', message: { content: '{"taskName":"Synthetic"}' } }] })],
    ['completion_finish_reason', JSON.stringify({ choices: [{ message: { content: '{"taskName":"Synthetic"}' } }] })],
    ['completion_content_json_incomplete', JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{SECRET truncated json' } }] })],
    ['completion_content_json_malformed', JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"taskName": SECRET}' } }] })],
    ['completion_content', JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '' } }] })],
    ['completion_content', JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: { secret: 'SECRET non-string content' } } }] })],
    ['completion_truncated', JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{SECRET truncated json' } }], usage: { completion_tokens: 16384 } })],
  ] as const)('rejects malformed Kimi output with safe diagnostic %s', async (diagnosticCode, body) => {
      const transport = createKimiTransport({
        apiKey: 'test-only-not-a-real-key', apiBase: 'https://example.invalid/v1', model: 'kimi-k3',
        reasoningEffort: 'high', maxCompletionTokens: 8192, fetchImpl: responseFetch(200, body),
      })
      let caught: unknown
      try {
        await transport.complete(input)
      } catch (error) {
        caught = error
      }

      expect(caught).toMatchObject({ code: 'provider_invalid_response', retryable: true, diagnosticCode })
      const serialized = JSON.stringify(caught)
      expect(serialized).not.toMatch(/SECRET|test-only-not-a-real-key|SGVsbG8/)
  })
})
