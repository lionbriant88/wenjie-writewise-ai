import { describe, expect, it } from 'vitest'
import { validateGradingRequest } from './validateGradingRequest.js'

function validRequest(): Record<string, unknown> {
  return {
    requestVersion: 'grading-request-v1',
    requestId: 'request-synthetic',
    task: {
      taskId: 'task-synthetic',
      writingGenre: 'practical_writing',
      fullScore: 15,
      prompt: {
        writingGenre: 'practical_writing',
        taskRequirement: 'Write a synthetic letter.',
        practicalWritingType: 'letter',
      },
      rubric: {
        status: 'confirmed',
        writingGoal: 'Complete the synthetic task.',
        offTopicCriteria: ['No relevant response'],
        dimensions: [
          { id: 'content', name: 'Content', weight: 40, description: 'Relevant ideas', deductionFocus: [] },
          { id: 'language', name: 'Language', weight: 60, description: 'Accurate language', deductionFocus: [] },
        ],
        excellentFeatures: ['Specific details'],
        reviewTriggers: ['Possible topic drift'],
      },
    },
    essay: {
      essayId: 'essay-synthetic',
      confirmedTranscript: 'Teacher-confirmed synthetic text.',
      ocrContext: { sourceKind: 'manual', hasKnownOcrRisk: false, riskCodes: [] },
    },
  }
}

function taskOf(raw: Record<string, unknown>) {
  return raw.task as Record<string, unknown>
}

function rubricOf(raw: Record<string, unknown>) {
  return taskOf(raw).rubric as Record<string, unknown>
}

describe('validateGradingRequest', () => {
  it('projects a valid practical-writing request without copying unknown references', () => {
    const raw = validRequest()
    const result = validateGradingRequest(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value).not.toBe(raw)
    expect(result.value.essay.confirmedTranscript).toBe('Teacher-confirmed synthetic text.')
  })

  it.each([
    ['wrong request version', (raw: Record<string, unknown>) => { raw.requestVersion = 'grading-request-v2' }],
    ['empty transcript', (raw: Record<string, unknown>) => {
      (raw.essay as Record<string, unknown>).confirmedTranscript = '  '
    }],
    ['transcript over 20,000 characters', (raw: Record<string, unknown>) => {
      (raw.essay as Record<string, unknown>).confirmedTranscript = 'x'.repeat(20_001)
    }],
    ['unconfirmed rubric', (raw: Record<string, unknown>) => { rubricOf(raw).status = 'draft' }],
    ['missing practical requirement', (raw: Record<string, unknown>) => {
      (taskOf(raw).prompt as Record<string, unknown>).taskRequirement = ''
    }],
    ['invalid full score', (raw: Record<string, unknown>) => { taskOf(raw).fullScore = 15.5 }],
    ['negative weight', (raw: Record<string, unknown>) => {
      (rubricOf(raw).dimensions as Array<Record<string, unknown>>)[0].weight = -1
    }],
    ['decimal weight', (raw: Record<string, unknown>) => {
      (rubricOf(raw).dimensions as Array<Record<string, unknown>>)[0].weight = 40.5
    }],
    ['weights not totaling 100', (raw: Record<string, unknown>) => {
      (rubricOf(raw).dimensions as Array<Record<string, unknown>>)[0].weight = 39
    }],
    ['duplicate dimension ids', (raw: Record<string, unknown>) => {
      const dimensions = rubricOf(raw).dimensions as Array<Record<string, unknown>>
      dimensions[1].id = dimensions[0].id
    }],
  ] as const)('rejects %s', (_label, mutate) => {
    const raw = validRequest()
    mutate(raw)
    expect(validateGradingRequest(raw).ok).toBe(false)
  })

  it('rejects continuation writing when either paragraph opening is missing', () => {
    const raw = validRequest()
    taskOf(raw).writingGenre = 'continuation_writing'
    taskOf(raw).prompt = {
      writingGenre: 'continuation_writing',
      sourceText: 'Synthetic source.',
      paragraph1Opening: '',
      paragraph2Opening: 'Finally,',
    }
    expect(validateGradingRequest(raw).ok).toBe(false)
  })

  it('rejects unexpected identity-bearing fields', () => {
    const result = validateGradingRequest({
      ...validRequest(),
      studentName: 'Synthetic Student',
    })
    expect(result).toEqual({
      ok: false,
      error: { code: 'invalid_request', message: '批改请求包含不允许的字段。' },
    })
  })

  it('rejects unknown nested fields instead of spreading them', () => {
    const raw = validRequest()
    ;(raw.essay as Record<string, unknown>).previewUrl = 'https://private.invalid/image'
    expect(validateGradingRequest(raw).ok).toBe(false)
  })
})
