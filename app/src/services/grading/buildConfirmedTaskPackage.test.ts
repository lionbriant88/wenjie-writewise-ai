import { describe, expect, it } from 'vitest'
import { mockTasks } from '../../data/mockData'
import type { Task } from '../../types'
import { buildConfirmedTaskPackage } from './buildConfirmedTaskPackage'

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
})
