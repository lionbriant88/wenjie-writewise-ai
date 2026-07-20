import { describe, expect, it } from 'vitest'
import type { Essay, Task } from '../../types'
import { buildGradingRequest } from './buildGradingRequest'

const practicalTask: Task = {
  id: 'task-synthetic',
  taskName: 'Synthetic practical-writing task',
  className: 'Private class value',
  essayType: 'Practical writing',
  fullScore: 15,
  scoringTemplateId: 'template-1',
  writingGenre: 'practical_writing',
  promptInfo: {
    writingGenre: 'practical_writing',
    practicalWritingType: 'letter',
    manualPromptText: 'Write a letter giving reading advice.',
    teacherRequirements: 'Use a clear structure.',
  },
  rubricDraft: {
    source: 'teacher',
    writingGoal: 'Give useful reading advice.',
    offTopicCriteria: ['No reading advice'],
    dimensions: [
      { id: 'content', name: 'Content', weight: 40, description: 'Relevant ideas', deductionFocus: [] },
      { id: 'language', name: 'Language', weight: 35, description: 'Accurate language', deductionFocus: [] },
      { id: 'structure', name: 'Structure', weight: 25, description: 'Clear structure', deductionFocus: [] },
    ],
    excellentFeatures: ['Specific advice'],
    reviewTriggers: ['Possible topic drift'],
    status: 'confirmed',
  },
  status: 'ready',
  totalEssayCount: 1,
  completedEssayCount: 0,
  exceptionEssayCount: 0,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
  generateClassReview: true,
}

const essayBase: Essay = {
  id: 'essay-synthetic',
  taskId: practicalTask.id,
  essayNumber: 'Private essay label',
  pages: [{
    id: 'page-private',
    label: 'Private page label',
    pageNumber: 1,
    quality: 'clear',
    accent: 'blue',
    previewUrl: 'https://private.invalid/image.png',
  }],
  pageCount: 1,
  pageOrder: ['page-private'],
  ocrText: 'Unconfirmed OCR source',
  ocrConfidence: 0.9,
  status: 'pending_grading',
  exceptionReasons: [],
  teacherReviewed: false,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
}

const confirmedEssay: Essay = {
  ...essayBase,
  ocrAudit: {
    auditVersion: 'ocr-audit-v1',
    sourceKind: 'remote',
    sourceText: 'Unconfirmed OCR source',
    confirmedTranscript: 'Teacher confirmed essay text.',
    shadowAssessment: {
      assessmentVersion: 'ocr-shadow-v1',
      outcome: 'review_recommended',
      reasons: [{ code: 'confidence_observed', severity: 'warning', value: 0.9 }],
      assessedAt: '2026-07-20T00:00:00.000Z',
    },
    reviewOutcome: {
      metricsVersion: 'ocr-text-metrics-v1',
      actualTeacherAction: 'confirmed_after_edit',
      editDistance: 4,
      changedCharacterCount: 4,
      confirmedAt: '2026-07-20T00:00:00.000Z',
    },
  },
}

const legacyEssayWithoutAudit: Essay = { ...essayBase }

describe('buildGradingRequest', () => {
  it('uses only the teacher-confirmed transcript for a practical-writing request', () => {
    const result = buildGradingRequest(practicalTask, confirmedEssay, 'request-1')

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.request.essay.confirmedTranscript).toBe('Teacher confirmed essay text.')
    expect(JSON.stringify(result.request)).not.toContain('Unconfirmed OCR source')
    expect(result.request.task.prompt).toMatchObject({
      writingGenre: 'practical_writing',
      taskRequirement: 'Write a letter giving reading advice.',
    })
  })

  it('fails closed when the audit has no confirmed transcript', () => {
    const result = buildGradingRequest(practicalTask, legacyEssayWithoutAudit, 'request-2', 'confirmed_only')
    expect(result).toEqual({
      ok: false,
      error: { code: 'confirmed_transcript_required', message: '请先确认忠实 OCR 文本。' },
    })
  })

  it('allows the compatibility OCR field only for a local mock request', () => {
    const result = buildGradingRequest(
      practicalTask,
      legacyEssayWithoutAudit,
      'request-mock',
      'allow_legacy_mock',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.request.essay.confirmedTranscript).toBe(legacyEssayWithoutAudit.ocrText)
  })

  it('does not serialize class, essay label, pages, preview URLs, or identity fields', () => {
    const result = buildGradingRequest(practicalTask, confirmedEssay, 'request-3')
    if (!result.ok) throw new Error(result.error.message)
    const json = JSON.stringify(result.request)
    expect(json).not.toContain(practicalTask.className)
    expect(json).not.toContain(confirmedEssay.essayNumber)
    expect(json).not.toContain('previewUrl')
    expect(json).not.toContain('pages')
    expect(Object.keys(result.request.essay).sort()).toEqual([
      'confirmedTranscript',
      'essayId',
      'ocrContext',
    ])
  })

  it('rejects an unconfirmed rubric', () => {
    const result = buildGradingRequest(
      { ...practicalTask, rubricDraft: { ...practicalTask.rubricDraft!, status: 'draft' } },
      confirmedEssay,
      'request-4',
    )
    expect(result.ok).toBe(false)
  })

  it('rejects fractional weights and a dimension total other than 100', () => {
    const invalidTask: Task = {
      ...practicalTask,
      rubricDraft: {
        ...practicalTask.rubricDraft!,
        dimensions: practicalTask.rubricDraft!.dimensions.map((dimension, index) => (
          index === 0 ? { ...dimension, weight: 40.5 } : dimension
        )),
      },
    }
    expect(buildGradingRequest(invalidTask, confirmedEssay, 'request-5').ok).toBe(false)

    const wrongTotal: Task = {
      ...practicalTask,
      rubricDraft: {
        ...practicalTask.rubricDraft!,
        dimensions: practicalTask.rubricDraft!.dimensions.map((dimension, index) => (
          index === 0 ? { ...dimension, weight: 39 } : dimension
        )),
      },
    }
    expect(buildGradingRequest(wrongTotal, confirmedEssay, 'request-6').ok).toBe(false)
  })

  it('requires all continuation-writing prompt fields', () => {
    const task: Task = {
      ...practicalTask,
      writingGenre: 'continuation_writing',
      promptInfo: {
        writingGenre: 'continuation_writing',
        manualPromptText: '',
        continuationPrompt: { sourceText: 'Source', paragraph1Opening: '', paragraph2Opening: 'Later' },
      },
    }
    expect(buildGradingRequest(task, confirmedEssay, 'request-7').ok).toBe(false)
  })
})
