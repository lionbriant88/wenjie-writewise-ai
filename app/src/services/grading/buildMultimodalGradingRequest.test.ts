import { describe, expect, it } from 'vitest'
import type { Essay, Task } from '../../types'
import { createConfiguredRubricClient } from '../taskRubric/rubricClient'
import { buildMultimodalGradingRequest } from './buildMultimodalGradingRequest'

const task: Task = {
  id: 'task-material', taskName: 'Material writing', className: 'Class 1', essayType: 'material', fullScore: 15,
  scoringTemplateId: 'kimi-generated-v1', status: 'processing', totalEssayCount: 1, completedEssayCount: 0,
  exceptionEssayCount: 0, createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z', generateClassReview: true,
  materialContext: { materialSummary: 'A short material.', writingRequirements: ['Respond clearly.'], constraints: [], reviewWarnings: [] },
  rubricDraft: { source: 'ai', status: 'confirmed', writingGoal: 'Respond.', offTopicCriteria: [], excellentFeatures: [], reviewTriggers: [],
    dimensions: [
      { id: 'content', name: 'Content', weight: 95, description: 'Relevant response.', deductionFocus: [], sourceEvidence: [] },
      { id: 'legibility', name: 'Legibility', weight: 5, description: 'Readable.', deductionFocus: [], sourceEvidence: [] },
    ] },
}

function essay(file?: File): Essay {
  return { id: 'essay-1', taskId: task.id, essayNumber: 'Essay 1', pages: [{ id: 'page-1', label: 'essay.png', pageNumber: 1, quality: 'clear', accent: '#000', sourceFile: file }], pageCount: 1, pageOrder: ['page-1'], ocrText: '', ocrConfidence: 0, status: 'pending_grading', exceptionReasons: [], teacherReviewed: false, createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z' }
}

describe('buildMultimodalGradingRequest', () => {
  it('builds an ordered confirmed task package without OCR transcript', () => {
    const result = buildMultimodalGradingRequest(task, essay(new File(['image'], 'essay.png', { type: 'image/png' })), 'request-1')
    expect(result).toMatchObject({ ok: true, request: { requestVersion: 'multimodal-grading-request-v2', requestId: 'request-1', essayId: 'essay-1', pageIds: ['page-1'], task: { taskId: task.id, fullScore: 15, materialSummary: 'A short material.', rubric: { taskName: 'Material writing', dimensions: [{ id: 'content', sourceEvidence: [] }, { id: 'legibility', weight: 5 }] } } } })
    if (result.ok) {
      expect(result.request.pages[0].file.name).toBe('essay.png')
      expect(result.request.confirmedTranscript).toBeUndefined()
    }
  })

  it('accepts the actual configured mock rubric at grading preflight', async () => {
    const response = await createConfiguredRubricClient({ VITE_GRADING_MODE: 'mock' }).generate({
      requestId: 'mock-rubric', fullScore: 15,
      pages: [{ id: 'material-1', file: new File(['material'], 'material.png', { type: 'image/png' }) }],
    })
    expect(response.status).toBe('success')
    if (response.status !== 'success') return
    const mockTask: Task = {
      ...task,
      taskName: response.rubric.taskName,
      materialContext: {
        materialSummary: response.rubric.materialSummary,
        writingRequirements: response.rubric.writingRequirements,
        constraints: response.rubric.constraints,
        reviewWarnings: response.rubric.reviewWarnings,
      },
      rubricDraft: {
        ...task.rubricDraft!,
        dimensions: response.rubric.dimensions,
      },
    }
    expect(buildMultimodalGradingRequest(
      mockTask,
      essay(new File(['image'], 'essay.png', { type: 'image/png' })),
      'mock-grading',
    )).toMatchObject({ ok: true })
  })

  it('passes the exact nonempty teacher-confirmed transcript without normalizing it', () => {
    const teacherText = ' Teacher corrected transcript. '
    const result = buildMultimodalGradingRequest(task, {
      ...essay(),
      ocrText: teacherText,
      transcriptSource: 'teacher_confirmed',
    }, 'request-1')
    expect(result).toMatchObject({ ok: true, request: { confirmedTranscript: teacherText, pageIds: [], pages: [] } })
  })

  it('accepts a saved teacher edit with decimal weights even when the rubric originated from AI', () => {
    const editedTask: Task = {
      ...task,
      rubricDraft: {
        ...task.rubricDraft!,
        dimensions: task.rubricDraft!.dimensions.map((dimension) => dimension.id === 'legibility'
          ? { ...dimension, weight: 5.5 }
          : { ...dimension, weight: 94.5 }),
      },
    }
    expect(buildMultimodalGradingRequest(
      editedTask,
      essay(new File(['image'], 'essay.png', { type: 'image/png' })),
      'teacher-edited-decimals',
    )).toMatchObject({ ok: true, request: { task: { rubric: { dimensions: [{ weight: 94.5 }, { id: 'legibility', weight: 5.5 }] } } } })
  })

  it('accepts exactly 50,000 UTF-16 code units and rejects 50,001 without trimming teacher text', () => {
    const exactly50k = `\n${'x'.repeat(49_997)} \n`
    expect(exactly50k).toHaveLength(50_000)
    const accepted = buildMultimodalGradingRequest(task, {
      ...essay(), ocrText: exactly50k, transcriptSource: 'teacher_confirmed',
    }, 'request-1')
    expect(accepted).toMatchObject({ ok: true, request: { confirmedTranscript: exactly50k } })

    const rejected = buildMultimodalGradingRequest(task, {
      ...essay(), ocrText: `${exactly50k}x`, transcriptSource: 'teacher_confirmed',
    }, 'request-1')
    expect(rejected).toMatchObject({ ok: false, error: { code: 'invalid_request' } })
  })

  it.each([
    ['missing image', essay(), task, 'request-1'],
    ['unconfirmed rubric', essay(new File([], 'a.png')), { ...task, rubricDraft: { ...task.rubricDraft!, status: 'draft' as const } }, 'request-1'],
    ['invalid weights', essay(new File([], 'a.png')), { ...task, rubricDraft: { ...task.rubricDraft!, dimensions: [{ ...task.rubricDraft!.dimensions[0], weight: 99 }] } }, 'request-1'],
    ['missing material context', essay(new File([], 'a.png')), { ...task, materialContext: undefined }, 'request-1'],
    ['empty request id', essay(new File([], 'a.png')), task, ''],
  ] as const)('rejects %s safely', (_label, targetEssay, targetTask, requestId) => {
    const result = buildMultimodalGradingRequest(targetTask as Task, targetEssay, requestId)
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_request' } })
  })

  it.each([
    ['trim-colliding pages', { essay: { ...essay(new File(['x'], 'essay.png', { type: 'image/png' })), pages: [{ ...essay(new File(['x'], 'essay.png', { type: 'image/png' })).pages[0], id: 'page-1' }, { ...essay(new File(['x'], 'essay.png', { type: 'image/png' })).pages[0], id: ' page-1' }], pageOrder: ['page-1', ' page-1'] } }],
    ['trim-colliding dimensions', { task: { ...task, rubricDraft: { ...task.rubricDraft!, dimensions: [{ ...task.rubricDraft!.dimensions[0], id: 'content', weight: 50 }, { ...task.rubricDraft!.dimensions[0], id: ' content', weight: 50 }] } } }],
    ['eleven dimensions', { task: { ...task, rubricDraft: { ...task.rubricDraft!, dimensions: Array.from({ length: 11 }, (_, index) => ({ ...task.rubricDraft!.dimensions[0], id: `d${index}`, weight: 100 / 11 })) } } }],
    ['empty requirements', { task: { ...task, materialContext: { ...task.materialContext!, writingRequirements: [] } } }],
    ['oversized constraint item', { task: { ...task, materialContext: { ...task.materialContext!, constraints: ['x'.repeat(5_001)] } } }],
    ['HEIC file', { essay: essay(new File(['x'], 'essay.heic', { type: 'image/heic' })) }],
    ['over 8 MiB', { essay: essay(new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'essay.png', { type: 'image/png' })) }],
  ] as const)('rejects isolated strict boundary: %s', (_label, mutation) => {
    const targetTask = 'task' in mutation ? mutation.task : task
    const targetEssay = 'essay' in mutation ? mutation.essay : essay(new File(['x'], 'essay.png', { type: 'image/png' }))
    expect(buildMultimodalGradingRequest(targetTask as Task, targetEssay as Essay, 'request-1')).toMatchObject({ ok: false })
  })

  it.each([
    ['wrong task relation', (target: Essay) => ({ ...target, taskId: 'other' })],
    ['duplicate page id', (target: Essay) => ({ ...target, pageOrder: ['page-1', 'page-1'] })],
    ['unsupported image', (target: Essay) => ({ ...target, pages: [{ ...target.pages[0], sourceFile: new File(['x'], 'essay.gif', { type: 'image/gif' }) }] })],
    ['too many pages', (target: Essay) => ({ ...target, pages: Array.from({ length: 11 }, (_, index) => ({ ...target.pages[0], id: `page-${index}`, sourceFile: new File(['x'], `${index}.png`, { type: 'image/png' }) })), pageOrder: Array.from({ length: 11 }, (_, index) => `page-${index}`) })],
    ['empty evidence item', (target: Essay) => target],
  ] as const)('rejects strict image or identity violation: %s', (_label, makeEssay) => {
    const targetTask = _label === 'empty evidence item' ? { ...task, rubricDraft: { ...task.rubricDraft!, dimensions: [{ ...task.rubricDraft!.dimensions[0], sourceEvidence: [''] }] } } : task
    const result = buildMultimodalGradingRequest(targetTask as Task, makeEssay(essay(new File(['x'], 'essay.png', { type: 'image/png' }))), 'request-1')
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_request' } })
  })
})
