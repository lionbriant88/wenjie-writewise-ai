import { describe, expect, it } from 'vitest'
import { createMockGradingClient } from './mockGradingClient'
import type { GradingRequestV1, MultimodalGradingRequestV2 } from './types'

function requestFor(writingGenre: 'practical_writing' | 'continuation_writing'): GradingRequestV1 {
  return {
    requestVersion: 'grading-request-v1',
    requestId: `request-${writingGenre}`,
    task: {
      taskId: 'task-synthetic',
      writingGenre,
      fullScore: 15,
      prompt: writingGenre === 'practical_writing'
        ? { writingGenre, taskRequirement: 'Write synthetic advice.' }
        : {
            writingGenre,
            sourceText: 'A synthetic source.',
            paragraph1Opening: 'The next day,',
            paragraph2Opening: 'Finally,',
          },
      rubric: {
        status: 'confirmed',
        writingGoal: 'Complete the synthetic task.',
        offTopicCriteria: [],
        dimensions: [
          { id: 'content', name: 'Content', weight: 40, description: 'Relevant', deductionFocus: [] },
          { id: 'language', name: 'Language', weight: 60, description: 'Accurate', deductionFocus: [] },
        ],
        excellentFeatures: [],
        reviewTriggers: [],
      },
    },
    essay: {
      essayId: 'essay-synthetic',
      confirmedTranscript: 'Synthetic sentence one. Synthetic sentence two.',
      ocrContext: { sourceKind: 'manual', hasKnownOcrRisk: false, riskCodes: [] },
    },
  }
}

describe('createMockGradingClient', () => {
  it('grades an image request locally without network access and returns a transcript', async () => {
    const request: MultimodalGradingRequestV2 = {
      requestVersion: 'multimodal-grading-request-v2', requestId: 'image-request', essayId: 'image-essay', pageIds: ['page-1'],
      task: { taskId: 'task-image', fullScore: 15, materialSummary: 'Material.', writingRequirements: ['Write.'], constraints: [], rubric: { taskName: 'Task', materialSummary: 'Material.', writingRequirements: ['Write.'], constraints: [], reviewWarnings: [], dimensions: [{ id: 'all', name: 'All', weight: 100, description: 'All', deductionFocus: [], sourceEvidence: ['Material.'] }] } },
      pages: [{ pageId: 'page-1', file: new File(['image'], 'page.png', { type: 'image/png' }) }],
    }
    await expect(createMockGradingClient().gradeImages!(request)).resolves.toMatchObject({ status: 'success', provider: 'mock', transcript: expect.any(String), printedTextExcluded: true })
  })
  it.each(['practical_writing', 'continuation_writing'] as const)(
    'returns a contract-valid local mock for %s',
    async (writingGenre) => {
      const request = requestFor(writingGenre)
      const response = await createMockGradingClient().grade(request)
      expect(response.status).toBe('success')
      if (response.status === 'failed') throw new Error(response.error.message)
      expect(response).toMatchObject({
        resultVersion: 'grading-result-v1',
        requestId: request.requestId,
        essayId: request.essay.essayId,
        provider: 'mock',
      })
      expect(response.dimensionScores.map((item) => item.dimensionId)).toEqual(
        request.task.rubric.dimensions.map((item) => item.id),
      )
      expect(JSON.stringify(response)).toContain('Synthetic sentence one')
      expect(JSON.stringify(response)).not.toContain('I suggest you joins')
    },
  )

  it('fails safely when the confirmed transcript is empty', async () => {
    const request = requestFor('practical_writing')
    request.essay.confirmedTranscript = '  '
    await expect(createMockGradingClient().grade(request)).resolves.toMatchObject({
      requestId: request.requestId,
      status: 'failed',
      error: { code: 'invalid_request', retryable: false },
    })
  })
})
