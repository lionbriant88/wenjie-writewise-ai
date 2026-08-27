import { describe, expect, it } from 'vitest'
import { mockTasks } from '../../data/mockData'
import type { RubricDimension, Task } from '../../types'
import { createDefaultRubricDimensions } from '../taskRubric/rubricForm'
import { buildConfirmedTaskPackage } from './buildConfirmedTaskPackage'

function newTaskWith({
  dimensions = createDefaultRubricDimensions(),
  materialContext = {
    materialSummary: '教师确认的写作要求：Write an email.',
    writingRequirements: ['Write an email.'],
    constraints: [],
    reviewWarnings: [],
  },
}: {
  dimensions?: RubricDimension[]
  materialContext?: Task['materialContext']
} = {}): Task {
  return {
    id: 'new-task', taskName: 'New task', className: '', essayType: 'material', fullScore: 15,
    scoringTemplateId: 'teacher-rubric-v1', status: 'processing', totalEssayCount: 0, completedEssayCount: 0,
    exceptionEssayCount: 0, createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z', generateClassReview: false,
    materialContext,
    rubricDraft: {
      source: 'teacher', status: 'confirmed', writingGoal: 'Write an email.', offTopicCriteria: [], excellentFeatures: [], reviewTriggers: [],
      dimensions,
    },
  }
}

function withWeights(weights: readonly number[]): RubricDimension[] {
  return createDefaultRubricDimensions().slice(0, weights.length).map((dimension, index) => ({
    ...dimension,
    weight: weights[index]!,
  }))
}

function withLegibilityWeights(weights: readonly [number, number, number]): RubricDimension[] {
  const defaults = createDefaultRubricDimensions()
  return [
    { ...defaults[0]!, weight: weights[0] },
    { ...defaults[1]!, weight: weights[1] },
    { ...defaults[3]!, weight: weights[2] },
  ]
}

describe('buildConfirmedTaskPackage new-task rubric validation', () => {
  it('preserves the confirmed dimensions and empty nested arrays without adding hidden material', () => {
    const dimensions = createDefaultRubricDimensions()
    const packageV2 = buildConfirmedTaskPackage(newTaskWith({ dimensions }))

    expect(packageV2).toMatchObject({ fullScore: 15, writingRequirements: ['Write an email.'] })
    expect(packageV2?.rubric.dimensions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'legibility', weight: 5 }),
    ]))
    expect(packageV2?.rubric.dimensions).toEqual(dimensions)
    expect(packageV2?.rubric.dimensions.every((dimension) => (
      dimension.deductionFocus.length === 0 && dimension.sourceEvidence.length === 0
    ))).toBe(true)
  })

  it.each([
    ['99.999', [47.499, 47.5, 5]],
    ['100.001', [47.501, 47.5, 5]],
  ] as const)('accepts a confirmed decimal rubric totaling %s', (_label, weights) => {
    const packageV2 = buildConfirmedTaskPackage(newTaskWith({ dimensions: withLegibilityWeights(weights) }))

    expect(packageV2?.rubric.dimensions.map(({ weight }) => weight)).toEqual(weights)
  })

  it.each([
    ['99.9989', [47.4989, 47.5, 5]],
    ['100.0011', [47.5011, 47.5, 5]],
  ] as const)('rejects a confirmed decimal rubric outside the tolerance at %s', (_label, weights) => {
    expect(buildConfirmedTaskPackage(newTaskWith({ dimensions: withLegibilityWeights(weights) }))).toBeNull()
  })

  it('rejects a new task that omits legibility instead of adding it', () => {
    const dimensionsWithoutLegibility = withWeights([42, 42, 16])

    expect(buildConfirmedTaskPackage(newTaskWith({ dimensions: dimensionsWithoutLegibility }))).toBeNull()
  })

  it('rejects a new task with two legibility dimensions', () => {
    const dimensionsWithTwoLegibility = [
      ...withWeights([47.5, 47.5]),
      { ...createDefaultRubricDimensions()[3]!, weight: 2.5 },
      { ...createDefaultRubricDimensions()[3]!, id: 'legibility-copy', weight: 2.5 },
    ]

    expect(buildConfirmedTaskPackage(newTaskWith({
      dimensions: dimensionsWithTwoLegibility.map((dimension) => dimension.id === 'legibility-copy' ? { ...dimension, id: 'legibility' } : dimension),
    }))).toBeNull()
  })

  it('rejects a one-dimension new task even when its weight is 100', () => {
    expect(buildConfirmedTaskPackage(newTaskWith({ dimensions: withWeights([100]) }))).toBeNull()
  })
})

describe('buildConfirmedTaskPackage legacy mapping', () => {
  it.each(mockTasks.map((task) => [task.id, task] as const))('preserves the current legacy mock task %s', (_taskId, task) => {
    const packageV2 = buildConfirmedTaskPackage(task)

    expect(packageV2).not.toBeNull()
    if (!packageV2) throw new Error('Expected a confirmed task package.')

    expect({
      materialSummary: packageV2.materialSummary,
      writingRequirements: packageV2.writingRequirements,
      constraints: packageV2.constraints,
      reviewWarnings: packageV2.rubric.reviewWarnings,
    }).toEqual({
      materialSummary: [
        'Write a letter giving practical advice.',
        'letter',
        'Complete the practical-writing task clearly and accurately.',
      ].join('\n'),
      writingRequirements: [
        'Use a clear structure and appropriate tone.',
        'Specific and useful details',
      ],
      constraints: ['Does not address the practical-writing task'],
      reviewWarnings: ['Possible topic drift or invented information'],
    })
    expect(packageV2.rubric).toMatchObject({
      materialSummary: packageV2.materialSummary,
      writingRequirements: packageV2.writingRequirements,
      constraints: packageV2.constraints,
    })
    expect(packageV2.rubric.dimensions.map(({ id, weight }) => ({ id, weight }))).toEqual([
      { id: 'content', weight: 38 },
      { id: 'language', weight: 33.25 },
      { id: 'structure', weight: 23.75 },
      { id: 'legibility', weight: 5 },
    ])
  })

  it('falls back from a blank teacher requirement and trim-deduplicates every mapped list', () => {
    const task: Task = {
      ...mockTasks[0],
      id: 'legacy-practical',
      promptInfo: {
        writingGenre: 'practical_writing',
        practicalWritingType: '  letter  ',
        manualPromptText: '  Manual prompt.  ',
        teacherRequirements: '   ',
        deductionFocus: '  Avoid drift.  ',
        excellentFocus: '  Specific details.  ',
      },
      rubricDraft: {
        ...mockTasks[0].rubricDraft!,
        writingGoal: '  Writing goal.  ',
        offTopicCriteria: [' Avoid drift. ', '  Off topic.  ', 'Off topic.'],
        excellentFeatures: ['Specific details.', ' Strong ending. ', 'Strong ending.'],
        reviewTriggers: [' Review trigger. ', 'Review trigger.'],
        teacherEditableNotes: '  Review trigger.  ',
      },
    }

    const packageV2 = buildConfirmedTaskPackage(task)

    expect(packageV2).not.toBeNull()
    if (!packageV2) throw new Error('Expected a confirmed task package.')
    expect(packageV2.materialSummary).toBe('Manual prompt.\nletter\nWriting goal.')
    expect(packageV2.writingRequirements).toEqual(['Manual prompt.', 'Specific details.', 'Strong ending.'])
    expect(packageV2.constraints).toEqual(['Avoid drift.', 'Off topic.'])
    expect(packageV2.rubric.reviewWarnings).toEqual(['Review trigger.'])
  })

  it('preserves every continuation legacy field while preferring a nonblank teacher requirement', () => {
    const task: Task = {
      ...mockTasks[0],
      id: 'legacy-continuation',
      promptInfo: {
        writingGenre: 'continuation_writing',
        manualPromptText: '  Continue the story.  ',
        teacherRequirements: '  Keep the two openings unchanged.  ',
        deductionFocus: '  Do not contradict the source.  ',
        excellentFocus: '  Use vivid but grounded detail.  ',
        continuationPrompt: {
          sourceText: '  The rain finally stopped.  ',
          paragraph1Opening: '  Paragraph one began at the gate.  ',
          paragraph2Opening: '  Paragraph two began the next morning.  ',
        },
      },
      rubricDraft: {
        ...mockTasks[0].rubricDraft!,
        writingGoal: '  Finish the story coherently.  ',
        offTopicCriteria: ['  Introduces an unrelated plot.  '],
        excellentFeatures: ['  Natural transitions.  '],
        reviewTriggers: ['  Possible invented event.  '],
        teacherEditableNotes: '  Check the ending against the source.  ',
      },
    }

    const packageV2 = buildConfirmedTaskPackage(task)

    expect(packageV2).not.toBeNull()
    if (!packageV2) throw new Error('Expected a confirmed task package.')
    expect(packageV2.materialSummary).toBe([
      'Continue the story.',
      'The rain finally stopped.',
      'Paragraph one began at the gate.',
      'Paragraph two began the next morning.',
      'Finish the story coherently.',
    ].join('\n'))
    expect(packageV2.writingRequirements).toEqual([
      'Keep the two openings unchanged.',
      'Use vivid but grounded detail.',
      'Natural transitions.',
    ])
    expect(packageV2.constraints).toEqual([
      'Do not contradict the source.',
      'Introduces an unrelated plot.',
    ])
    expect(packageV2.rubric.reviewWarnings).toEqual([
      'Possible invented event.',
      'Check the ending against the source.',
    ])
  })

  it('adds the legacy 5% legibility dimension only for a promptInfo-only task', () => {
    const legacyTask: Task = {
      ...mockTasks[0],
      id: 'legacy-without-legibility',
      materialContext: undefined,
      rubricDraft: {
        ...mockTasks[0].rubricDraft!,
        dimensions: withWeights([40, 35, 25]),
      },
    }

    expect(buildConfirmedTaskPackage(legacyTask)?.rubric.dimensions.map(({ id, weight }) => ({ id, weight }))).toEqual([
      { id: 'content', weight: 38 },
      { id: 'language', weight: 33.25 },
      { id: 'structure', weight: 23.75 },
      { id: 'legibility', weight: 5 },
    ])
  })
})
