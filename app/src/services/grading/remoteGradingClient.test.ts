import { describe, expect, it, vi } from 'vitest'
import { createRemoteGradingClient } from './remoteGradingClient'
import type { GradingRequestV1 } from './types'

const request: GradingRequestV1 = {
  requestVersion: 'grading-request-v1', requestId: 'request-1',
  task: {
    taskId: 'task-1', writingGenre: 'practical_writing', fullScore: 15,
    prompt: { writingGenre: 'practical_writing', taskRequirement: 'Synthetic prompt.' },
    rubric: {
      status: 'confirmed', writingGoal: 'Synthetic goal.', offTopicCriteria: [],
      dimensions: [{ id: 'language', name: 'Language', weight: 100, description: 'Accuracy', deductionFocus: [] }],
      excellentFeatures: [], reviewTriggers: [],
    },
  },
  essay: {
    essayId: 'essay-1', confirmedTranscript: 'Synthetic transcript.',
    ocrContext: { sourceKind: 'manual', hasKnownOcrRisk: false, riskCodes: [] },
  },
}

function successBody() {
  return {
    resultVersion: 'grading-result-v1', requestId: 'request-1', essayId: 'essay-1',
    provider: 'remote', status: 'success', totalScore: 12, maxScore: 15,
    dimensionScores: [{
      dimensionId: 'language', name: 'Language', score: 12, maxScore: 15, weight: 100,
      reason: 'Accurate.', evidence: 'Synthetic evidence.',
    }],
    issues: [], sentenceRevisions: [], expressionUpgrades: [], overallComment: 'Synthetic.',
    reviewReasons: [], createdAt: '2026-07-20T00:00:00.000Z',
  }
}

describe('createRemoteGradingClient', () => {
  it('posts once with a trace header and projects a valid 2xx success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(successBody()), { status: 200 }))
    const client = createRemoteGradingClient({ apiBase: 'http://127.0.0.1:8790/', fetchImpl })
    await expect(client.grade(request)).resolves.toMatchObject({ status: 'success', essayId: 'essay-1' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:8790/grading/grade', expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Grading-Request-Id': request.requestId,
      },
      body: JSON.stringify(request),
    }))
  })

  it('projects a valid non-2xx failure', async () => {
    const body = {
      requestId: request.requestId, status: 'failed',
      error: { code: 'provider_timeout', message: 'Timed out.', retryable: true },
    }
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 504 }))
    await expect(createRemoteGradingClient({ apiBase: 'http://gateway', fetchImpl }).grade(request))
      .resolves.toEqual(body)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['non-2xx success', successBody(), 500],
    ['2xx failure', {
      requestId: request.requestId, status: 'failed',
      error: { code: 'provider_timeout', message: 'Timed out.', retryable: true },
    }, 200],
    ['mismatched request', { ...successBody(), requestId: 'old-request' }, 200],
    ['mismatched essay', { ...successBody(), essayId: 'old-essay' }, 200],
    ['missing nested field', { ...successBody(), issues: [{ id: 'incomplete' }] }, 200],
  ] as const)('fails closed for %s', async (_label, body, status) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))
    const result = await createRemoteGradingClient({ apiBase: 'http://gateway', fetchImpl }).grade(request)
    expect(result).toMatchObject({ status: 'failed', error: { code: 'gateway_invalid_response' } })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('maps invalid JSON to a safe invalid-response failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>SECRET</html>', { status: 502 }))
    await expect(createRemoteGradingClient({ apiBase: 'http://gateway', fetchImpl }).grade(request))
      .resolves.toMatchObject({ status: 'failed', error: { code: 'gateway_invalid_response' } })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('converts a network rejection into a safe failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('SECRET upstream body'))
    const client = createRemoteGradingClient({ apiBase: 'http://127.0.0.1:8790', fetchImpl })
    await expect(client.grade(request)).resolves.toEqual({
      requestId: request.requestId,
      status: 'failed',
      error: {
        code: 'gateway_unavailable',
        message: '批改服务暂时不可用，请重试或使用 mock 回退。',
        retryable: true,
      },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('fails without attempting fetch when the base URL is missing', async () => {
    const fetchImpl = vi.fn()
    await expect(createRemoteGradingClient({ fetchImpl }).grade(request)).resolves.toMatchObject({
      requestId: request.requestId, status: 'failed', error: { code: 'gateway_unavailable', retryable: false },
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
