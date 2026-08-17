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
    await expect(createMockGradingClient().gradeImages!(request)).resolves.toMatchObject({ status: 'success', provider: 'mock', transcript: expect.any(String), printedTextExcluded: true })
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
    await expect(createMockGradingClient().gradeImages!(built.request)).resolves.toMatchObject({ transcript: essay.ocrText })

    const imageMode = { ...built.request, confirmedTranscript: undefined }
    await expect(createMockGradingClient().gradeImages!(imageMode)).resolves.toMatchObject({ status: 'failed', error: { code: 'invalid_request' } })
  })
})
