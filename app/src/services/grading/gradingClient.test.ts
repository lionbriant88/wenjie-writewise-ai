import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConfiguredGradingClient } from './gradingClient'
import type { MultimodalGradingRequestV2 } from './types'

const request = {
  requestVersion: 'multimodal-grading-request-v2', requestId: 'request-mode', essayId: 'essay-mode', pageIds: [], pages: [], confirmedTranscript: 'Synthetic transcript.',
  task: { taskId: 'task-mode', fullScore: 15, materialSummary: 'Synthetic.', writingRequirements: ['Write.'], constraints: [], rubric: { taskName: 'Task', materialSummary: 'Synthetic.', writingRequirements: ['Write.'], constraints: [], reviewWarnings: [], dimensions: [
    { id: 'content', name: 'Content', weight: 95, description: 'Relevant.', deductionFocus: [], sourceEvidence: [] },
    { id: 'legibility', name: 'Legibility', weight: 5, description: 'Readable.', deductionFocus: [], sourceEvidence: [] },
  ] } },
} satisfies MultimodalGradingRequestV2

describe('createConfiguredGradingClient', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('uses local mock only for the exact explicit mock mode', async () => {
    const fetchImpl = vi.fn()
    globalThis.fetch = fetchImpl
    const response = await createConfiguredGradingClient({ VITE_GRADING_MODE: 'mock' }).gradeImages(request)
    expect(response).toMatchObject({ status: 'partial', provider: 'mock', reviewReasons: ['local_mock'] })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([undefined, 'invalid', 'REAL'])('fails closed without network access for mode %s', async (mode) => {
    const fetchImpl = vi.fn()
    globalThis.fetch = fetchImpl
    const response = await createConfiguredGradingClient({ VITE_GRADING_MODE: mode }).gradeImages(request)
    expect(response).toEqual({
      requestId: request.requestId, status: 'failed',
      error: { code: 'provider_not_configured', message: '批改服务尚未配置。', retryable: false },
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fails closed when real mode is missing API or queue configuration', async () => {
    const fetchImpl = vi.fn()
    globalThis.fetch = fetchImpl
    const response = await createConfiguredGradingClient({ VITE_GRADING_MODE: 'real' }).gradeImages(request)
    expect(response).toMatchObject({ status: 'failed', error: { code: 'provider_not_configured', retryable: false } })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses the remote client only for a complete explicit real profile', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('synthetic unavailable'))
    globalThis.fetch = fetchImpl
    const response = await createConfiguredGradingClient({
      VITE_GRADING_MODE: 'real',
      VITE_GRADING_API_BASE: 'http://gateway.test',
      VITE_GRADING_QUEUE_MODE: 'adaptive-v1',
      VITE_GRADING_MAX_IN_FLIGHT: '4',
    }).gradeImages(request)
    expect(response).toMatchObject({ status: 'failed', error: { code: 'gateway_unavailable' } })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})
