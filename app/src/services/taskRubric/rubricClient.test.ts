import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConfiguredRubricClient, createRemoteRubricClient } from './rubricClient'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

const pages = [
  { id: 'material-2', file: new File(['second page'], 'second.png', { type: 'image/png' }) },
  { id: 'material-1', file: new File(['first page'], 'first.jpg', { type: 'image/jpeg' }) },
]

const request = { requestId: 'rubric-request-1', fullScore: 15, pages }

const rubric = {
  taskName: 'Generated material task',
  materialSummary: 'A source material summary.',
  writingRequirements: ['Respond to the material.'],
  constraints: ['Write in English.'],
  dimensions: [
    { id: 'content', name: 'Content', weight: 60, description: 'Address the material.', deductionFocus: [], sourceEvidence: [] },
    { id: 'language', name: 'Language', weight: 40, description: 'Use accurate language.', deductionFocus: [], sourceEvidence: [] },
  ],
  reviewWarnings: [],
}

describe('rubric client', () => {
  it('sends ordered material page IDs and their original File objects to the rubric endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId: request.requestId, status: 'success', rubric,
    }), { status: 200 }))
    const client = createRemoteRubricClient({ apiBase: 'http://127.0.0.1:8790/', fetchImpl })

    await expect(client.generate(request)).resolves.toMatchObject({ status: 'success', rubric: { taskName: rubric.taskName } })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:8790/tasks/rubric', expect.objectContaining({ method: 'POST' }))
    const form = fetchImpl.mock.calls[0]?.[1]?.body as FormData
    expect(form.get('requestId')).toBe(request.requestId)
    expect(form.get('fullScore')).toBe('15')
    expect(form.get('pageIds')).toBe(JSON.stringify(['material-2', 'material-1']))
    const uploadedPages = form.getAll('pages')
    expect(uploadedPages).toHaveLength(2)
    expect(uploadedPages[0]).toBe(pages[0]?.file)
    expect(uploadedPages[1]).toBe(pages[1]?.file)
  })

  it.each([
    ['network rejection', vi.fn().mockRejectedValue(new Error('PRIVATE upstream response'))],
    ['non-JSON response', vi.fn().mockResolvedValue(new Response('<html>PRIVATE</html>', { status: 502 }))],
  ])('maps %s to a safe stable gateway failure', async (_label, fetchImpl) => {
    const client = createRemoteRubricClient({ apiBase: 'http://gateway', fetchImpl })
    await expect(client.generate(request)).resolves.toMatchObject({
      requestId: request.requestId,
      status: 'failed',
      error: { code: _label === 'network rejection' ? 'gateway_unavailable' : 'gateway_invalid_response' },
    })
  })

  it('maps a valid Gateway failure code and rejects malformed failures', async () => {
    const safeFailure = {
      requestId: request.requestId, status: 'failed',
      error: { code: 'provider_timeout', message: 'AI grading timed out.', retryable: true },
    }
    await expect(createRemoteRubricClient({
      apiBase: 'http://gateway', fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify(safeFailure), { status: 503 })),
    }).generate(request)).resolves.toEqual({
      requestId: request.requestId,
      status: 'failed',
      error: { code: 'provider_timeout', message: '评分服务响应超时，请稍后重试。', retryable: true },
    })
    await expect(createRemoteRubricClient({
      apiBase: 'http://gateway', fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'failed' }), { status: 503 })),
    }).generate(request)).resolves.toMatchObject({ status: 'failed', error: { code: 'gateway_invalid_response' } })
  })

  it('rejects a Provider-success rubric that would later fail grading preflight for missing writing requirements', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId: request.requestId,
      status: 'success',
      rubric: { ...rubric, writingRequirements: [] },
    }), { status: 200 }))

    await expect(createRemoteRubricClient({ apiBase: 'http://gateway', fetchImpl }).generate(request)).resolves.toMatchObject({
      status: 'failed', error: { code: 'gateway_invalid_response' },
    })
  })

  it('maps a safe Gateway failure code to local text without returning raw Gateway content', async () => {
    const rawGatewayMessage = 'provider response included sk-test-not-a-real-key and <html>upstream details</html>'
    const response = await createRemoteRubricClient({
      apiBase: 'http://gateway',
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        requestId: request.requestId,
        status: 'failed',
        error: { code: 'provider_timeout', message: rawGatewayMessage, retryable: true },
      }), { status: 503 })),
    }).generate(request)

    expect(response).toEqual({
      requestId: request.requestId,
      status: 'failed',
      error: { code: 'provider_timeout', message: '评分服务响应超时，请稍后重试。', retryable: true },
    })
    expect(JSON.stringify(response)).not.toContain(rawGatewayMessage)
    expect(JSON.stringify(response)).not.toContain('sk-test-not-a-real-key')
  })

  it('uses a legal local rubric in mock mode without calling fetch', async () => {
    const fetchImpl = vi.fn()
    globalThis.fetch = fetchImpl
    const response = await createConfiguredRubricClient({ VITE_GRADING_MODE: 'mock' }).generate(request)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(response).toMatchObject({ requestId: request.requestId, status: 'success' })
    if (response.status === 'success') {
      expect(response.rubric.dimensions.reduce((total, dimension) => total + dimension.weight, 0)).toBe(100)
    }
  })
})
