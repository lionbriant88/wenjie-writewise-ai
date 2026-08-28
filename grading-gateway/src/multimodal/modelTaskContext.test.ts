import { describe, expect, it } from 'vitest'
import type { ConfirmedTaskPackageV2 } from './types.js'
import {
  MODEL_TASK_CONTEXT_VERSION,
  canonicalTaskContextJson,
  derivePromptCacheKey,
  projectModelTaskContext,
} from './modelTaskContext.js'

function confirmedTask(): ConfirmedTaskPackageV2 {
  const reviewWarnings = [
    '  Verify the source date.  ',
    'Verify the source date.',
    ...Array.from({ length: 51 }, (_, index) => `Warning ${index + 1}`),
  ]
  return {
    taskId: 'internal-task-17',
    fullScore: 20,
    materialSummary: 'A stable material summary.',
    writingRequirements: ['Teacher requirement first.', 'Material-inferred requirement second.'],
    constraints: ['Write in English.', 'Stay within the confirmed topic.'],
    rubric: {
      taskName: 'Private teacher task name',
      materialSummary: 'A stable material summary.',
      writingRequirements: ['Teacher requirement first.', 'Material-inferred requirement second.'],
      constraints: ['Write in English.', 'Stay within the confirmed topic.'],
      dimensions: [
        {
          id: 'structure', name: 'Structure', description: 'Organize ideas clearly.', weight: 35,
          deductionFocus: ['Private duplicate deduction context.'], sourceEvidence: ['Private source evidence.'],
        },
        {
          id: 'content', name: 'Content', description: 'Complete the task.', weight: 65,
          deductionFocus: [], sourceEvidence: ['Another private source citation.'],
        },
      ],
      reviewWarnings,
    },
  }
}

describe('model task context projection', () => {
  it('projects exactly one approved context while preserving dimension identity and business order', () => {
    const context = projectModelTaskContext(confirmedTask())

    expect(Object.keys(context)).toEqual([
      'fullScore', 'materialSummary', 'writingRequirements', 'constraints', 'reviewWarnings', 'dimensions',
    ])
    expect(context).toEqual({
      fullScore: 20,
      materialSummary: 'A stable material summary.',
      writingRequirements: ['Teacher requirement first.', 'Material-inferred requirement second.'],
      constraints: ['Write in English.', 'Stay within the confirmed topic.'],
      reviewWarnings: [
        'Verify the source date.',
        ...Array.from({ length: 49 }, (_, index) => `Warning ${index + 1}`),
      ],
      dimensions: [
        { id: 'structure', name: 'Structure', description: 'Organize ideas clearly.', weight: 35 },
        { id: 'content', name: 'Content', description: 'Complete the task.', weight: 65 },
      ],
    })
    expect(JSON.stringify(context)).not.toContain('Private teacher task name')
    expect(JSON.stringify(context)).not.toContain('sourceEvidence')
    expect(JSON.stringify(context)).not.toContain('deductionFocus')
    expect(JSON.stringify(context)).not.toContain('internal-task-17')
  })

  it('serializes deterministically with fixed object keys without reordering business arrays', () => {
    const context = projectModelTaskContext({
      ...confirmedTask(),
      rubric: { ...confirmedTask().rubric, reviewWarnings: ['Second warning.', 'First warning.'] },
    })

    expect(MODEL_TASK_CONTEXT_VERSION).toBe('model-task-context-v1')
    expect(canonicalTaskContextJson(context)).toBe(
      '{"fullScore":20,"materialSummary":"A stable material summary.","writingRequirements":["Teacher requirement first.","Material-inferred requirement second."],"constraints":["Write in English.","Stay within the confirmed topic."],"reviewWarnings":["Second warning.","First warning."],"dimensions":[{"id":"structure","name":"Structure","description":"Organize ideas clearly.","weight":35},{"id":"content","name":"Content","description":"Complete the task.","weight":65}]}',
    )
  })
})

describe('prompt cache key derivation', () => {
  const baseInput = {
    taskId: 'internal-task-17',
    rubricRevisionDigest: 'rubric-revision-a',
    gradingPolicyVersion: 'grading-policy-v1',
    providerSchemaVersion: 'essay-grading-provider-v2',
    hmacSecret: 'test-only-cache-secret-at-least-32-bytes',
  }

  it('returns a stable opaque base64url HMAC without raw identifiers or context text', () => {
    const first = derivePromptCacheKey(baseInput)
    const equivalent = derivePromptCacheKey({
      hmacSecret: baseInput.hmacSecret,
      providerSchemaVersion: baseInput.providerSchemaVersion,
      gradingPolicyVersion: baseInput.gradingPolicyVersion,
      rubricRevisionDigest: baseInput.rubricRevisionDigest,
      taskId: baseInput.taskId,
    })

    expect(first).toBe(equivalent)
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first).not.toContain(baseInput.taskId)
    expect(first).not.toContain(baseInput.rubricRevisionDigest)
    expect(first).not.toContain('Private teacher task name')
    expect(first).not.toContain('A stable material summary.')
  })

  it.each([
    ['taskId', 'internal-task-18'],
    ['rubricRevisionDigest', 'rubric-revision-b'],
    ['gradingPolicyVersion', 'grading-policy-v2'],
    ['providerSchemaVersion', 'essay-grading-provider-v3'],
  ] as const)('changes when %s changes', (field, value) => {
    expect(derivePromptCacheKey({ ...baseInput, [field]: value })).not.toBe(derivePromptCacheKey(baseInput))
  })
})
