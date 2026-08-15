import { describe, expect, it } from 'vitest'
import type { GradingRequestV1 } from '../types.js'
import { buildGradingPrompt } from '../promptBuilder.js'
import { normalizeGradingResult } from '../normalizeGradingResult.js'
import { MockGradingProvider } from './mockGradingProvider.js'

const request: GradingRequestV1 = {
  requestVersion: 'grading-request-v1', requestId: 'request-mock-provider',
  task: {
    taskId: 'task-mock-provider', writingGenre: 'practical_writing', fullScore: 15,
    prompt: { writingGenre: 'practical_writing', taskRequirement: 'Synthetic.' },
    rubric: {
      status: 'confirmed', writingGoal: 'Synthetic.', offTopicCriteria: [],
      dimensions: [
        { id: 'content', name: 'Content', weight: 40, description: 'Relevant', deductionFocus: [] },
        { id: 'language', name: 'Language', weight: 60, description: 'Accurate', deductionFocus: [] },
      ],
      excellentFeatures: [], reviewTriggers: [],
    },
  },
  essay: {
    essayId: 'essay-mock-provider', confirmedTranscript: 'First synthetic sentence. Second synthetic sentence.',
    ocrContext: { sourceKind: 'manual', hasKnownOcrRisk: false, riskCodes: [] },
  },
}

describe('MockGradingProvider', () => {
  it('returns a Provider payload derived from the request and shared scoring rules', async () => {
    const provider = new MockGradingProvider()
    const payload = await provider.grade({
      request, prompt: buildGradingPrompt(request), signal: new AbortController().signal,
    })
    expect(provider.publicName).toBe('mock')
    expect(payload).toMatchObject({ reportedTotalScore: 12, overallComment: expect.any(String) })
    const dimensions = (payload as { dimensionScores: Array<{ dimensionId: string }> }).dimensionScores
    expect(dimensions.map(({ dimensionId }) => dimensionId)).toEqual(['content', 'language'])
    expect(JSON.stringify(payload)).toContain('First synthetic sentence.')
    expect(JSON.stringify(payload)).not.toContain('I suggest you joins')
  })

  it('does not attach a deduction key when production rounding makes a tiny dimension full score', async () => {
    const tinyRequest: GradingRequestV1 = {
      ...request,
      task: {
        ...request.task, fullScore: 1,
        rubric: {
          ...request.task.rubric,
          dimensions: [
            { id: 'tiny', name: 'Tiny', weight: 1, description: 'Tiny weight', deductionFocus: [] },
            { id: 'rest', name: 'Rest', weight: 99, description: 'Remaining weight', deductionFocus: [] },
          ],
        },
      },
    }
    const provider = new MockGradingProvider()
    const payload = await provider.grade({ request: tinyRequest, prompt: buildGradingPrompt(tinyRequest), signal: new AbortController().signal })
    expect(payload.dimensionScores[0]).toMatchObject({ dimensionId: 'tiny', score: 0.01, relatedIssueKeys: [] })
    expect(payload.dimensionScores[1]).toMatchObject({ dimensionId: 'rest', relatedIssueKeys: ['mock-structure'] })
    expect(normalizeGradingResult(payload, tinyRequest, { provider: 'mock', createdAt: '2026-08-15T00:00:00.000Z' })).toMatchObject({ ok: true })
  })
})
