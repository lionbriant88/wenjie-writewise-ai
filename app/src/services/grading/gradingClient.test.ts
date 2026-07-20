import { describe, expect, it } from 'vitest'
import { createConfiguredGradingClient } from './gradingClient'
import type { GradingRequestV1 } from './types'

const request = {
  requestVersion: 'grading-request-v1', requestId: 'request-mode',
  task: {
    taskId: 'task-mode', writingGenre: 'practical_writing', fullScore: 15,
    prompt: { writingGenre: 'practical_writing', taskRequirement: 'Synthetic.' },
    rubric: {
      status: 'confirmed', writingGoal: 'Synthetic.', offTopicCriteria: [],
      dimensions: [{ id: 'all', name: 'All', weight: 100, description: 'All', deductionFocus: [] }],
      excellentFeatures: [], reviewTriggers: [],
    },
  },
  essay: {
    essayId: 'essay-mode', confirmedTranscript: 'Synthetic transcript.',
    ocrContext: { sourceKind: 'manual', hasKnownOcrRisk: false, riskCodes: [] },
  },
} satisfies GradingRequestV1

describe('createConfiguredGradingClient', () => {
  it.each([undefined, 'mock', 'invalid'])('uses local mock for mode %s', async (mode) => {
    const response = await createConfiguredGradingClient({ VITE_GRADING_MODE: mode }).grade(request)
    expect(response.status).toBe('success')
    if (response.status !== 'failed') expect(response.provider).toBe('mock')
  })

  it('uses the remote client for real mode', async () => {
    const response = await createConfiguredGradingClient({ VITE_GRADING_MODE: 'real' }).grade(request)
    expect(response).toMatchObject({ status: 'failed', error: { code: 'gateway_unavailable' } })
  })
})
