import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConfiguredRubricClient, createMockRubricClient, createRemoteRubricClient } from './rubricClient'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

const materials = [
  { id: 'material-2', kind: 'image' as const, file: new File(['second page'], 'private-second.png', { type: 'image/png' }) },
  { id: 'material-text', kind: 'text' as const, displayName: 'prompt.docx', text: 'Extracted prompt.' },
  { id: 'material-1', kind: 'image' as const, file: new File(['first page'], 'private-first.jpg', { type: 'image/jpeg' }) },
]

const request = {
  requestId: 'rubric-request-1', fullScore: 15, writingRequirement: '', materials,
}

const rubric = {
  taskName: 'Generated material task',
  materialSummary: 'A source material summary.',
  writingRequirements: ['Respond to the material.'],
  constraints: ['Write in English.'],
  dimensions: [
    { id: 'content', name: 'Content', weight: 55, description: 'Address the material.', deductionFocus: [], sourceEvidence: [] },
    { id: 'language', name: 'Language', weight: 40, description: 'Use accurate language.', deductionFocus: [], sourceEvidence: [] },
    { id: 'legibility', name: 'Legibility', weight: 5, description: 'Keep writing readable.', deductionFocus: [], sourceEvidence: [] },
  ],
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

describe('rubric client', () => {
  it('uses the shared serializer for /tasks/rubric, preserves empty requirement, order, signal, and neutral filenames', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId: request.requestId, status: 'success', rubric,
    }), { status: 200 }))

    const response = await createRemoteRubricClient({ apiBase: 'http://gateway/', fetchImpl }).generate({
      ...request, signal: controller.signal,
    })

    expect(response).toEqual({ requestId: request.requestId, status: 'success', rubric })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith('http://gateway/tasks/rubric', {
      method: 'POST', body: expect.any(FormData), signal: controller.signal,
    })
    const form = fetchImpl.mock.calls[0]?.[1]?.body as FormData
    expect(form.get('writingRequirement')).toBe('')
    expect(form.get('materialManifest')).toBe('[{"id":"material-2","kind":"image","imageIndex":0},{"id":"material-text","kind":"text","textIndex":0},{"id":"material-1","kind":"image","imageIndex":1}]')
    expect((form.getAll('images') as File[]).map(({ name }) => name)).toEqual([
      'material-image-1.png', 'material-image-2.jpeg',
    ])
  })

  it.each([
    ['request ID mismatch', { requestId: 'wrong', status: 'success', rubric }],
    ['extra response field', { requestId: request.requestId, status: 'success', rubric, privateValue: 'PRIVATE' }],
    ['extra rubric field', { requestId: request.requestId, status: 'success', rubric: { ...rubric, privateValue: 'PRIVATE' } }],
    ['missing legibility dimension', { requestId: request.requestId, status: 'success', rubric: { ...rubric, dimensions: rubric.dimensions.slice(0, 2) } }],
    ['duplicate legibility dimension', { requestId: request.requestId, status: 'success', rubric: { ...rubric, dimensions: [...rubric.dimensions, { ...rubric.dimensions[2], id: 'legibility', weight: 0.001 }] } }],
    ['duplicate dimension IDs', { requestId: request.requestId, status: 'success', rubric: { ...rubric, dimensions: [{ ...rubric.dimensions[0], weight: 27.5 }, { ...rubric.dimensions[0], weight: 27.5 }, ...rubric.dimensions.slice(1) ] } }],
    ['weight outside tolerance', { requestId: request.requestId, status: 'success', rubric: { ...rubric, dimensions: rubric.dimensions.map((dimension, index) => index === 0 ? { ...dimension, weight: 55.0011 } : dimension) } }],
  ])('rejects a malformed strict rubric: %s', async (_label, body) => {
    const response = await createRemoteRubricClient({
      apiBase: 'http://gateway',
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })),
    }).generate(request)

    expect(response).toMatchObject({ status: 'failed', error: { code: 'gateway_invalid_response' } })
    expect(JSON.stringify(response)).not.toContain('PRIVATE')
  })

  it('accepts a weight total at the 0.001 tolerance boundary', async () => {
    const withinTolerance = {
      ...rubric,
      dimensions: rubric.dimensions.map((dimension, index) => index === 0 ? { ...dimension, weight: 55.001 } : dimension),
    }
    const response = await createRemoteRubricClient({
      apiBase: 'http://gateway',
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        requestId: request.requestId, status: 'success', rubric: withinTolerance,
      }), { status: 200 })),
    }).generate(request)

    expect(response).toMatchObject({ status: 'success' })
  })

  it.each([
    ['network rejection', vi.fn().mockRejectedValue(new Error('PRIVATE upstream response')), 'gateway_unavailable'],
    ['non-JSON response', vi.fn().mockResolvedValue(new Response('<html>PRIVATE</html>', { status: 502 })), 'gateway_invalid_response'],
  ] as const)('maps %s to one safe stable failure without retry', async (_label, fetchImpl, code) => {
    const response = await createRemoteRubricClient({ apiBase: 'http://gateway', fetchImpl }).generate(request)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(response).toMatchObject({ requestId: request.requestId, status: 'failed', error: { code } })
    expect(JSON.stringify(response)).not.toContain('PRIVATE')
  })

  it('maps an HTTP failure to safe local text without exposing upstream details', async () => {
    const rawGatewayMessage = 'PRIVATE sk-test-not-real <html>upstream details</html>'
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId: request.requestId, status: 'failed',
      error: { code: 'provider_timeout', message: rawGatewayMessage, retryable: true },
    }), { status: 503 }))

    const response = await createRemoteRubricClient({ apiBase: 'http://gateway', fetchImpl }).generate(request)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(response).toEqual({
      requestId: request.requestId, status: 'failed',
      error: { code: 'provider_timeout', message: '评分服务响应超时，请稍后重试。', retryable: true },
    })
    expect(JSON.stringify(response)).not.toContain(rawGatewayMessage)
  })

  it.each([
    [false, 'provider_result_unknown'],
    [true, 'gateway_invalid_response'],
  ] as const)('accepts provider_result_unknown only as a non-retryable one-shot result (retryable=%s)', async (retryable, code) => {
    const response = await createRemoteRubricClient({
      apiBase: 'http://gateway',
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        requestId: request.requestId,
        status: 'failed',
        error: { code: 'provider_result_unknown', message: 'PRIVATE upstream state', retryable },
      }), { status: 503 })),
    }).generate(request)

    expect(response).toMatchObject({
      requestId: request.requestId,
      status: 'failed',
      error: { code },
    })
    expect(JSON.stringify(response)).not.toContain('PRIVATE')
  })

  it.each([
    ['sparse dimensions', () => {
      const dimensions = new Array(3)
      dimensions[0] = { ...rubric.dimensions[0], weight: 95 }
      dimensions[1] = rubric.dimensions[2]
      return {
        requestId: request.requestId, status: 'success', rubric: { ...rubric, dimensions },
      }
    }],
    ['custom-prototype rubric', () => ({
      requestId: request.requestId, status: 'success',
      rubric: Object.assign(Object.create({ inherited: 'PRIVATE' }) as object, rubric),
    })],
    ['own-symbol dimension', () => ({
      requestId: request.requestId, status: 'success',
      rubric: { ...rubric, dimensions: [withOwnSymbol({ ...rubric.dimensions[0] }), ...rubric.dimensions.slice(1)] },
    })],
    ['own-symbol dimensions array', () => ({
      requestId: request.requestId, status: 'success',
      rubric: { ...rubric, dimensions: withOwnSymbol([...rubric.dimensions]) },
    })],
    ['non-enumerable extra response field', () => withNonEnumerableExtra({
      requestId: request.requestId, status: 'success', rubric,
    })],
    ['custom-prototype dimensions array', () => {
      const dimensions = [...rubric.dimensions]
      Object.setPrototypeOf(dimensions, Object.create(Array.prototype))
      return { requestId: request.requestId, status: 'success', rubric: { ...rubric, dimensions } }
    }],
    ['throwing rubric getter', () => {
      const body = { requestId: request.requestId, status: 'success' } as Record<string, unknown>
      Object.defineProperty(body, 'rubric', {
        enumerable: true,
        get() { throw new Error('PRIVATE getter failure') },
      })
      return body
    }],
  ] as const)('fails closed without throwing for non-JSON rubric shape: %s', async (_label, bodyFactory) => {
    const response = await createRemoteRubricClient({
      apiBase: 'http://gateway',
      fetchImpl: vi.fn().mockResolvedValue(responseWithRawBody(bodyFactory())),
    }).generate(request)

    expect(response).toEqual({
      requestId: request.requestId, status: 'failed',
      error: { code: 'gateway_invalid_response', message: '评分标准服务返回了无法安全使用的响应，请重试。', retryable: true },
    })
  })

  it('throws locally for an empty image MIME before fetch', async () => {
    const fetchImpl = vi.fn()
    const client = createRemoteRubricClient({ apiBase: 'http://gateway', fetchImpl })

    await expect(client.generate({
      ...request,
      materials: [{
        id: 'invalid-empty-mime', kind: 'image',
        file: new File(['private'], 'student-private-file', { type: '' }),
      }],
    })).rejects.toThrow('Unsupported ready task material image MIME type.')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('keeps mock output deterministic without mutating the request or calling fetch', async () => {
    const before = [...request.materials]
    const fetchImpl = vi.fn()
    globalThis.fetch = fetchImpl

    const direct = await createMockRubricClient().generate(request)
    const configured = await createConfiguredRubricClient({ VITE_GRADING_MODE: 'mock' }).generate(request)

    expect(configured).toEqual(direct)
    expect(direct).toEqual(await createMockRubricClient().generate(request))
    expect(request.materials).toEqual(before)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    ['missing mode', {}],
    ['invalid mode', { VITE_GRADING_MODE: 'automatic' }],
    ['incomplete real mode', { VITE_GRADING_MODE: 'real' }],
  ])('fails closed without network or mock fallback for %s', async (_label, env) => {
    const fetchImpl = vi.fn()
    globalThis.fetch = fetchImpl
    const response = await createConfiguredRubricClient(env).generate(request)
    expect(response).toMatchObject({
      requestId: request.requestId, status: 'failed',
      error: { code: 'provider_not_configured', retryable: false },
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses the remote rubric client for a complete explicit real profile', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('synthetic unavailable'))
    globalThis.fetch = fetchImpl
    const response = await createConfiguredRubricClient({
      VITE_GRADING_MODE: 'real',
      VITE_GRADING_API_BASE: 'http://gateway.test',
      VITE_GRADING_QUEUE_MODE: 'adaptive-v1',
      VITE_GRADING_MAX_IN_FLIGHT: '4',
    }).generate(request)
    expect(response).toMatchObject({ status: 'failed', error: { code: 'gateway_unavailable' } })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})
