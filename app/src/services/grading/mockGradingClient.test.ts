import { describe, expect, it } from 'vitest'
import type { Essay, Task } from '../../types'
import { buildMultimodalGradingRequest } from './buildMultimodalGradingRequest'
import { createMockGradingClient } from './mockGradingClient'
import type { MultimodalGradingRequestV2 } from './types'

describe('createMockGradingClient', () => {
  it('grades an image request locally without network access and returns a transcript', async () => {
    const request: MultimodalGradingRequestV2 = {
      requestVersion: 'multimodal-grading-request-v2', requestId: 'image-request', essayId: 'image-essay', pageIds: ['page-1'],
      task: { taskId: 'task-image', fullScore: 15, materialSummary: 'Material.', writingRequirements: ['Write.'], constraints: [], rubric: { taskName: 'Task', materialSummary: 'Material.', writingRequirements: ['Write.'], constraints: [], reviewWarnings: [], dimensions: [{ id: 'all', name: 'All', weight: 100, description: 'All', deductionFocus: [], sourceEvidence: ['Material.'] }] } },
      pages: [{ pageId: 'page-1', file: new File(['image'], 'page.png', { type: 'image/png' }) }],
    }
    await expect(createMockGradingClient().gradeImages!(request)).resolves.toMatchObject({
      status: 'partial', provider: 'mock', transcript: expect.any(String), printedTextExcluded: true,
      reviewReasons: ['local_mock'],
    })
  })

  it('uses the same request-mode and UTF-16 preflight for local grading', async () => {
    const imageRequest: MultimodalGradingRequestV2 = {
      requestVersion: 'multimodal-grading-request-v2', requestId: 'preflight-request', essayId: 'preflight-essay', pageIds: ['page-1'],
      task: { taskId: 'task-image', fullScore: 15, materialSummary: 'Material.', writingRequirements: ['Write.'], constraints: [], rubric: { taskName: 'Task', materialSummary: 'Material.', writingRequirements: ['Write.'], constraints: [], reviewWarnings: [], dimensions: [{ id: 'all', name: 'All', weight: 100, description: 'All', deductionFocus: [], sourceEvidence: ['Material.'] }] } },
      pages: [{ pageId: 'page-1', file: new File(['image'], 'page.png', { type: 'image/png' }) }],
    }
    const client = createMockGradingClient()

    await expect(client.gradeImages({ ...imageRequest, confirmedTranscript: 'Teacher-confirmed text.' })).resolves.toMatchObject({
      status: 'failed', error: { code: 'invalid_request', retryable: false },
    })
    for (const confirmedTranscript of [`Teacher ${'\uD800'} text.`, `Teacher ${'\uDC00'} text.`]) {
      await expect(client.gradeImages({ ...imageRequest, pageIds: [], pages: [], confirmedTranscript })).resolves.toMatchObject({
        status: 'failed', error: { code: 'invalid_request', retryable: false },
      })
    }
    await expect(client.gradeImages({
      ...imageRequest, pageIds: [], pages: [], confirmedTranscript: 'Teacher \u{1F600} text.',
    })).resolves.toMatchObject({
      status: 'partial', transcript: 'Teacher \u{1F600} text.', reviewReasons: ['local_mock'],
    })
  })

  it('accepts the real zero-page confirmed request and rejects zero-page image mode', async () => {
    const task: Task = {
      id: 'task-image', taskName: 'Task', className: 'Class', essayType: 'material', fullScore: 15,
      scoringTemplateId: 'teacher', status: 'processing', totalEssayCount: 1, completedEssayCount: 0, exceptionEssayCount: 0,
      createdAt: '2026-08-16T00:00:00.000Z', updatedAt: '2026-08-16T00:00:00.000Z', generateClassReview: true,
      materialContext: { materialSummary: 'Material.', writingRequirements: ['Write.'], constraints: [], reviewWarnings: [] },
      rubricDraft: { source: 'teacher', status: 'confirmed', writingGoal: 'Write.', offTopicCriteria: [], excellentFeatures: [], reviewTriggers: [], dimensions: [
        { id: 'content', name: 'Content', weight: 95, description: 'Relevant.', deductionFocus: [], sourceEvidence: [] },
        { id: 'legibility', name: 'Legibility', weight: 5, description: 'Readable.', deductionFocus: [], sourceEvidence: [] },
      ] },
    }
    const essay: Essay = {
      id: 'image-essay', taskId: task.id, essayNumber: 'Essay', pages: [], pageCount: 0, pageOrder: [],
      ocrText: 'Teacher corrected transcript.', transcriptSource: 'teacher_confirmed', ocrConfidence: 1,
      status: 'pending_grading', exceptionReasons: [], teacherReviewed: false,
      createdAt: '2026-08-16T00:00:00.000Z', updatedAt: '2026-08-16T00:00:00.000Z',
    }
    const built = buildMultimodalGradingRequest(task, essay, 'image-request-confirmed')
    expect(built).toMatchObject({ ok: true, request: { pageIds: [], pages: [], confirmedTranscript: essay.ocrText } })
    if (!built.ok) throw new Error(built.error.message)
    const confirmedResult = await createMockGradingClient().gradeImages(built.request)
    expect(confirmedResult).toMatchObject({
      transcript: essay.ocrText,
      fullTextRevision: {
        originalText: essay.ocrText,
        correctedText: essay.ocrText,
        improvedText: essay.ocrText,
        sentencePairs: [], logicNotes: [], logicIssues: [],
      },
    })
    if (confirmedResult.status === 'failed') throw new Error(confirmedResult.error.message)
    expect(confirmedResult.dimensionScores.every(({ evidence }) => evidence === essay.ocrText)).toBe(true)
    expect(JSON.stringify(confirmedResult)).not.toContain('本地 mock 图片文本')

    const imageMode = { ...built.request, confirmedTranscript: undefined }
    await expect(createMockGradingClient().gradeImages!(imageMode)).resolves.toMatchObject({ status: 'failed', error: { code: 'invalid_request' } })
  })
})
