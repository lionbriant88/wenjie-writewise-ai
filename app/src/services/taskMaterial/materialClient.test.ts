import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createConfiguredMaterialContextClient,
  createMockMaterialContextClient,
  createRemoteMaterialContextClient,
} from './materialClient'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

const request = {
  requestId: 'context-request-1', fullScore: 15, writingRequirement: 'Write an email.',
  materials: [
    { id: 'image-1', kind: 'image' as const, file: new File(['image'], 'private.png', { type: 'image/png' }) },
    { id: 'text-1', kind: 'text' as const, displayName: 'prompt.docx', text: 'Prompt body.' },
  ],
}

const materialContext = {
  materialSummary: 'A source material summary.',
  writingRequirements: ['Write an email.'],
  constraints: ['Write in English.'],
  reviewWarnings: [],
}

function responseWithRawBody(body: unknown): Response {
  return { ok: true, json: async () => body } as Response
}

function withOwnSymbol<T extends object>(value: T): T {
  Object.defineProperty(value, Symbol('private'), { value: 'PRIVATE' })
  return value
}

function withNonEnumerableExtra<T extends object>(value: T): T {
  Object.defineProperty(value, 'privateValue', { value: 'PRIVATE', enumerable: false })
  return value
}

describe('material context client', () => {
  it('posts the shared exact material body to /tasks/material-context and forwards the AbortSignal once', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId: request.requestId, status: 'success', materialContext,
    }), { status: 200 }))

    const response = await createRemoteMaterialContextClient({ apiBase: 'http://gateway/', fetchImpl }).analyze({
      ...request, signal: controller.signal,
    })

    expect(response).toEqual({ requestId: request.requestId, status: 'success', materialContext })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith('http://gateway/tasks/material-context', {
      method: 'POST', body: expect.any(FormData), signal: controller.signal,
    })
    const form = fetchImpl.mock.calls[0]?.[1]?.body as FormData
    expect([...form.keys()]).toEqual([
      'requestId', 'fullScore', 'writingRequirement', 'materialManifest', 'images', 'textMaterials',
    ])
    expect(form.get('writingRequirement')).toBe(request.writingRequirement)
    expect(form.get('materialManifest')).toBe('[{"id":"image-1","kind":"image","imageIndex":0},{"id":"text-1","kind":"text","textIndex":0}]')
  })

  it.each([
    ['request ID mismatch', { requestId: 'wrong', status: 'success', materialContext }],
    ['extra response field', { requestId: request.requestId, status: 'success', materialContext, privateValue: 'PRIVATE' }],
    ['extra context field', { requestId: request.requestId, status: 'success', materialContext: { ...materialContext, privateValue: 'PRIVATE' } }],
    ['blank context item', { requestId: request.requestId, status: 'success', materialContext: { ...materialContext, constraints: [' '] } }],
  ])('fails closed for %s', async (_label, body) => {
    const response = await createRemoteMaterialContextClient({
      apiBase: 'http://gateway', fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })),
    }).analyze(request)

    expect(response).toEqual({
      requestId: request.requestId, status: 'failed',
      error: { code: 'gateway_invalid_response', message: '材料分析服务返回了无法安全使用的响应，请重试。', retryable: true },
    })
    expect(JSON.stringify(response)).not.toContain('PRIVATE')
  })

  it.each([
    ['malformed JSON', vi.fn().mockResolvedValue(new Response('<html>PRIVATE</html>', { status: 502 })), 'gateway_invalid_response'],
    ['network rejection', vi.fn().mockRejectedValue(new Error('PRIVATE upstream response')), 'gateway_unavailable'],
  ] as const)('projects %s to one safe stable failure without retry', async (_label, fetchImpl, code) => {
    const response = await createRemoteMaterialContextClient({ apiBase: 'http://gateway', fetchImpl }).analyze(request)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(response).toMatchObject({ requestId: request.requestId, status: 'failed', error: { code } })
    expect(JSON.stringify(response)).not.toContain('PRIVATE')
  })

  it('maps a safe HTTP failure code locally without returning the upstream message or retrying', async () => {
    const rawMessage = 'PRIVATE sk-test-not-real <html>details</html>'
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId: request.requestId, status: 'failed',
      error: { code: 'provider_timeout', message: rawMessage, retryable: true },
    }), { status: 503 }))

    const response = await createRemoteMaterialContextClient({ apiBase: 'http://gateway', fetchImpl }).analyze(request)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(response).toEqual({
      requestId: request.requestId, status: 'failed',
      error: { code: 'provider_timeout', message: '评分服务响应超时，请稍后重试。', retryable: true },
    })
    expect(JSON.stringify(response)).not.toContain(rawMessage)
  })

  it.each([
    [false, 'provider_result_unknown'],
    [true, 'gateway_invalid_response'],
  ] as const)('accepts provider_result_unknown only as a non-retryable one-shot result (retryable=%s)', async (retryable, code) => {
    const response = await createRemoteMaterialContextClient({
      apiBase: 'http://gateway',
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        requestId: request.requestId,
        status: 'failed',
        error: { code: 'provider_result_unknown', message: 'PRIVATE upstream state', retryable },
      }), { status: 503 })),
    }).analyze(request)

    expect(response).toMatchObject({
      requestId: request.requestId,
      status: 'failed',
      error: { code },
    })
    expect(JSON.stringify(response)).not.toContain('PRIVATE')
  })

  it.each([
    ['sparse writingRequirements', () => ({
      requestId: request.requestId, status: 'success',
      materialContext: { ...materialContext, writingRequirements: new Array(1) },
    })],
    ['custom-prototype context', () => ({
      requestId: request.requestId, status: 'success',
      materialContext: Object.assign(Object.create({ inherited: 'PRIVATE' }) as object, materialContext),
    })],
    ['own-symbol response', () => withOwnSymbol({
      requestId: request.requestId, status: 'success', materialContext,
    })],
    ['non-enumerable extra context field', () => ({
      requestId: request.requestId, status: 'success',
      materialContext: withNonEnumerableExtra({ ...materialContext }),
    })],
    ['custom-prototype constraints array', () => {
      const constraints = ['Write in English.']
      Object.setPrototypeOf(constraints, Object.create(Array.prototype))
      return { requestId: request.requestId, status: 'success', materialContext: { ...materialContext, constraints } }
    }],
    ['own-symbol constraints array', () => ({
      requestId: request.requestId, status: 'success',
      materialContext: { ...materialContext, constraints: withOwnSymbol(['Write in English.']) },
    })],
    ['throwing context getter', () => {
      const body = { requestId: request.requestId, status: 'success' } as Record<string, unknown>
      Object.defineProperty(body, 'materialContext', {
        enumerable: true,
        get() { throw new Error('PRIVATE getter failure') },
      })
      return body
    }],
  ] as const)('fails closed without throwing for non-JSON response shape: %s', async (_label, bodyFactory) => {
    const response = await createRemoteMaterialContextClient({
      apiBase: 'http://gateway',
      fetchImpl: vi.fn().mockResolvedValue(responseWithRawBody(bodyFactory())),
    }).analyze(request)

    expect(response).toEqual({
      requestId: request.requestId, status: 'failed',
      error: { code: 'gateway_invalid_response', message: '材料分析服务返回了无法安全使用的响应，请重试。', retryable: true },
    })
  })

  it('throws locally for an unsupported image MIME before fetch', async () => {
    const fetchImpl = vi.fn()
    const client = createRemoteMaterialContextClient({ apiBase: 'http://gateway', fetchImpl })

    await expect(client.analyze({
      ...request,
      materials: [{
        id: 'invalid-gif', kind: 'image',
        file: new File(['GIF89a'], 'student-private.gif', { type: 'image/gif' }),
      }],
    })).rejects.toThrow('Unsupported ready task material image MIME type.')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses a deterministic non-mutating local mock and configured mock mode never fetches', async () => {
    const snapshot = [...request.materials]
    const fetchImpl = vi.fn()
    globalThis.fetch = fetchImpl

    const direct = await createMockMaterialContextClient().analyze(request)
    const configured = await createConfiguredMaterialContextClient({ VITE_GRADING_MODE: 'mock' }).analyze(request)

    expect(configured).toEqual(direct)
    expect(direct).toEqual(await createMockMaterialContextClient().analyze(request))
    expect(request.materials).toEqual(snapshot)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    ['missing mode', {}],
    ['invalid mode', { VITE_GRADING_MODE: 'automatic' }],
    ['incomplete real mode', { VITE_GRADING_MODE: 'real' }],
  ])('fails closed without network or mock fallback for %s', async (_label, env) => {
    const fetchImpl = vi.fn()
    globalThis.fetch = fetchImpl
    const response = await createConfiguredMaterialContextClient(env).analyze(request)
    expect(response).toMatchObject({
      requestId: request.requestId, status: 'failed',
      error: { code: 'provider_not_configured', retryable: false },
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses the remote material client for a complete explicit real profile', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('synthetic unavailable'))
    globalThis.fetch = fetchImpl
    const response = await createConfiguredMaterialContextClient({
      VITE_GRADING_MODE: 'real',
      VITE_GRADING_API_BASE: 'http://gateway.test',
      VITE_GRADING_QUEUE_MODE: 'adaptive-v1',
      VITE_GRADING_MAX_IN_FLIGHT: '4',
    }).analyze(request)
    expect(response).toMatchObject({ status: 'failed', error: { code: 'gateway_unavailable' } })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})
