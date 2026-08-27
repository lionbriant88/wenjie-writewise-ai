import { describe, expect, it } from 'vitest'
import { buildTaskCreationInput, buildTaskMaterialContext } from './buildTaskCreationInput'
import { createDefaultRubricDimensions, DEFAULT_TASK_NAME } from './rubricForm'

const writingRequirement = '  Write about a memorable day.  '

describe('confirmed task input construction', () => {
  it('uses a truthful teacher-requirement context when no material was analyzed', () => {
    expect(buildTaskCreationInput({
      taskName: '   ', fullScore: 15, writingRequirement, dimensions: createDefaultRubricDimensions(), source: 'teacher', materialProcessingStatus: 'none',
    })).toMatchObject({
      ok: true,
      value: {
        taskName: DEFAULT_TASK_NAME,
        materialProcessingStatus: 'none',
        rubricDraft: {
          source: 'teacher', writingGoal: 'Write about a memorable day.', status: 'confirmed',
          offTopicCriteria: [], excellentFeatures: [], reviewTriggers: [],
          dimensions: [
            { id: 'content', deductionFocus: [], sourceEvidence: [] },
            { id: 'language', deductionFocus: [], sourceEvidence: [] },
            { id: 'structure', deductionFocus: [], sourceEvidence: [] },
            { id: 'legibility', deductionFocus: [], sourceEvidence: [] },
          ],
        },
        materialContext: {
          materialSummary: '教师确认的写作要求：Write about a memorable day.',
          writingRequirements: ['Write about a memorable day.'], constraints: [], reviewWarnings: [],
        },
      },
    })
  })

  it('keeps the teacher requirement first while preserving a sanitized analyzed context', () => {
    const analyzed = {
      materialSummary: '  A source material summary.  ',
      writingRequirements: [' Inferred requirement. ', 'Write about a memorable day.', 'Inferred requirement.'],
      constraints: [' Stay on topic. ', 'Stay on topic.'],
      reviewWarnings: ['Review source context.'],
    }
    const dimensions = createDefaultRubricDimensions()
    dimensions[0]!.deductionFocus.push('Hidden focus')
    dimensions[0]!.sourceEvidence!.push('Hidden evidence')

    const result = buildTaskCreationInput({
      taskName: '  My task  ', fullScore: 15, writingRequirement, dimensions, source: 'ai', analyzedMaterialContext: analyzed, materialProcessingStatus: 'ready',
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        taskName: 'My task', materialProcessingStatus: 'ready',
        rubricDraft: {
          source: 'ai', writingGoal: 'Write about a memorable day.', status: 'confirmed',
          offTopicCriteria: [], excellentFeatures: [], reviewTriggers: [],
          dimensions: expect.any(Array),
        },
        materialContext: {
          materialSummary: 'A source material summary.',
          writingRequirements: ['Write about a memorable day.', 'Inferred requirement.'],
          constraints: ['Stay on topic.'], reviewWarnings: ['Review source context.'],
        },
      },
    })
    if (result.ok) {
      expect(result.value.rubricDraft?.dimensions[0]).toMatchObject({ id: 'content', deductionFocus: [], sourceEvidence: [] })
    }
    expect(dimensions[0]?.deductionFocus).toEqual(['Hidden focus'])
    expect(dimensions[0]?.sourceEvidence).toEqual(['Hidden evidence'])
    expect(analyzed).toEqual({
      materialSummary: '  A source material summary.  ',
      writingRequirements: [' Inferred requirement. ', 'Write about a memorable day.', 'Inferred requirement.'],
      constraints: [' Stay on topic. ', 'Stay on topic.'],
      reviewWarnings: ['Review source context.'],
    })
  })

  it('trims and de-duplicates analyzed material fields without turning them into a fabricated source', () => {
    expect(buildTaskMaterialContext(' Teacher requirement ', {
      materialSummary: '   ', writingRequirements: [' Teacher requirement ', ' Inferred requirement. ', 'Inferred requirement. '],
      constraints: [' Keep English. ', 'Keep English.'], reviewWarnings: ['review', 'review'],
    })).toEqual({
      materialSummary: '教师确认的写作要求：Teacher requirement',
      writingRequirements: ['Teacher requirement', 'Inferred requirement.'], constraints: ['Keep English.'], reviewWarnings: ['review', 'review'],
    })
  })

  it.each([
    ['accepts the maximum task name length', 'a'.repeat(2_000), true],
    ['rejects a task name above the maximum length', 'a'.repeat(2_001), false],
  ])('%s', (_label, taskName, expectedOk) => {
    const result = buildTaskCreationInput({
      taskName, fullScore: 15, writingRequirement, dimensions: createDefaultRubricDimensions(), source: 'teacher', materialProcessingStatus: 'none',
    })
    expect(result.ok).toBe(expectedOk)
    if (!expectedOk) expect(result).toMatchObject({ taskNameError: expect.any(String) })
  })

  it('returns the shared validity instead of building an invalid rubric', () => {
    const dimensions = createDefaultRubricDimensions()
    dimensions[0] = { ...dimensions[0]!, weight: 0 }

    expect(buildTaskCreationInput({
      taskName: 'Task', fullScore: 15, writingRequirement, dimensions, source: 'teacher', materialProcessingStatus: 'none',
    })).toMatchObject({ ok: false, validity: { valid: false } })
  })
})
