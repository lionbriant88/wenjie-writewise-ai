import { describe, expect, it } from 'vitest'
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
  it.each([undefined, 'mock', 'invalid'])('uses local mock for mode %s', async (mode) => {
    const response = await createConfiguredGradingClient({ VITE_GRADING_MODE: mode }).gradeImages(request)
    expect(response).toMatchObject({ status: 'partial', provider: 'mock', reviewReasons: ['local_mock'] })
  })

  it('uses the remote client for real mode', async () => {
    const response = await createConfiguredGradingClient({ VITE_GRADING_MODE: 'real' }).gradeImages(request)
    expect(response).toMatchObject({ status: 'failed', error: { code: 'gateway_unavailable' } })
  })
})
