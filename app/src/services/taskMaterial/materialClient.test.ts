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
})
