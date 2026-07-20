import { describe, expect, it, vi } from 'vitest'
import { createDeepSeekTransport, type DeepSeekRequestBody } from './deepseekTransport.js'

const validBody: DeepSeekRequestBody = {
  model: 'deepseek-v4-flash', stream: false, thinking: { type: 'disabled' }, temperature: 0,
  max_tokens: 8192, response_format: { type: 'json_object' },
  messages: [{ role: 'system', content: 'Return json.' }, { role: 'user', content: 'Synthetic.' }],
}

function responseFetch(status: number, body: string) {
  return vi.fn().mockResolvedValue(new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  }))
}

describe('createDeepSeekTransport', () => {
  it.each([
    [400, 'provider_request_rejected', false],
    [401, 'provider_auth_failed', false],
    [402, 'provider_balance_unavailable', false],
    [422, 'provider_request_rejected', false],
    [429, 'provider_rate_limited', true],
    [500, 'provider_unavailable', true],
    [503, 'provider_unavailable', true],
  ] as const)('maps HTTP %s safely', async (status, code, retryable) => {
    const fetchImpl = responseFetch(status, '{"error":"SECRET upstream body"}')
    const transport = createDeepSeekTransport({ apiKey: 'test-only-not-a-real-key', fetchImpl })
    let caught: unknown
    try {
      await transport.complete(validBody, new AbortController().signal)
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({ code, retryable })
    const serialized = JSON.stringify(caught)
    expect(serialized).not.toMatch(/test-only-not-a-real-key|SECRET upstream body|Authorization/i)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('posts once to the fixed completion endpoint and returns parsed JSON', async () => {
    const fetchImpl = responseFetch(200, '{"choices":[]}')
    const transport = createDeepSeekTransport({
      apiKey: 'test-only-not-a-real-key', fetchImpl, baseUrl: 'https://example.invalid/',
    })
    await expect(transport.complete(validBody, new AbortController().signal)).resolves.toEqual({ choices: [] })
    expect(fetchImpl).toHaveBeenCalledWith('https://example.invalid/chat/completions', expect.objectContaining({
      method: 'POST', body: JSON.stringify(validBody),
      headers: { Authorization: 'Bearer test-only-not-a-real-key', 'Content-Type': 'application/json' },
    }))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects missing configuration before fetch', async () => {
    const fetchImpl = vi.fn()
    await expect(createDeepSeekTransport({ apiKey: '', fetchImpl }).complete(validBody, new AbortController().signal))
      .rejects.toMatchObject({ code: 'provider_not_configured', retryable: false })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('maps network rejection and abort without leaking the thrown error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('SECRET network body'))
    const transport = createDeepSeekTransport({ apiKey: 'test-only-not-a-real-key', fetchImpl })
    await expect(transport.complete(validBody, new AbortController().signal))
      .rejects.toMatchObject({ code: 'provider_unavailable', retryable: true })

    const controller = new AbortController()
    controller.abort()
    await expect(transport.complete(validBody, controller.signal))
      .rejects.toMatchObject({ code: 'provider_timeout', retryable: true })
  })

  it('maps a non-JSON success body to an invalid response', async () => {
    const transport = createDeepSeekTransport({
      apiKey: 'test-only-not-a-real-key', fetchImpl: responseFetch(200, '<html>SECRET</html>'),
    })
    await expect(transport.complete(validBody, new AbortController().signal))
      .rejects.toMatchObject({ code: 'provider_invalid_response', retryable: true })
  })
})
