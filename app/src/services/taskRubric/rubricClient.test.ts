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

  it('temporarily translates legacy pages to the new image-only manifest with explicit empty writingRequirement', async () => {
    const legacyPages = [
      { id: 'legacy-2', file: new File(['two'], 'private-two.webp', { type: 'image/webp' }) },
      { id: 'legacy-1', file: new File(['one'], 'private-one.png', { type: 'image/png' }) },
    ]
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId: 'legacy-request', status: 'success', rubric,
    }), { status: 200 }))

    await createRemoteRubricClient({ apiBase: 'http://gateway', fetchImpl }).generate({
      requestId: 'legacy-request', fullScore: 15, pages: legacyPages,
    })

    const form = fetchImpl.mock.calls[0]?.[1]?.body as FormData
    expect(form.get('writingRequirement')).toBe('')
    expect(form.get('materialManifest')).toBe('[{"id":"legacy-2","kind":"image","imageIndex":0},{"id":"legacy-1","kind":"image","imageIndex":1}]')
    expect(form.get('textMaterials')).toBe('[]')
    expect(form.getAll('images')).toHaveLength(2)
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
})
