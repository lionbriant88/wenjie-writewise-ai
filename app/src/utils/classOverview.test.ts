import { describe, expect, it } from 'vitest'
import type { Essay, GradingResult, Task } from '../types'
import { getClassOverviewStats } from './classOverview'

function essay(id: string): Essay {
  return {
    id,
    taskId: 'task-1',
    essayNumber: id,
    pages: [],
    pageCount: 1,
    pageOrder: [],
    ocrText: '',
    ocrConfidence: 0.9,
    status: 'completed',
    exceptionReasons: [],
    teacherReviewed: true,
    createdAt: '2026-06-25T09:00:00.000Z',
    updatedAt: '2026-06-25T09:00:00.000Z',
  }
}

function successfulEssay(id: string, overrides: Partial<Essay> = {}): Essay {
  return {
    ...essay(id),
    status: 'grading_ready',
    teacherReviewed: false,
    sourceGeneration: 2,
    aiResultId: `${id}-result`,
    gradingRun: {
      status: 'success',
      requestId: `request-${id}`,
      source: 'mock',
      reviewReasons: [],
      startedAt: '2026-06-25T08:59:00.000Z',
      completedAt: '2026-06-25T09:00:00.000Z',
      sourceGeneration: 2,
      rubricGeneration: 3,
    },
    ...overrides,
  }
}

function result(essayId: string, totalScore: number, fullScore = 15): GradingResult {
  return {
    id: `${essayId}-result`,
    essayId,
    totalScore,
    dimensionScores: [{
      id: 'language',
      name: 'Language',
      score: Math.min(totalScore, fullScore),
      maxScore: fullScore,
      weight: 100,
      reason: 'Synthetic score reason.',
      evidence: 'Synthetic score evidence.',
    }],
    errorAnnotations: [],
    sentenceRevisions: [],
    upgradedExpressions: [],
    recognitionWarnings: [],
    legibilityIssues: [],
    overallComment: '',
    aiConfidence: 0.9,
    teacherAdjusted: false,
    createdAt: '2026-06-25T09:00:00.000Z',
    updatedAt: '2026-06-25T09:00:00.000Z',
  }
}

function overviewTask(fullScore: number, rubricGeneration = 0): Pick<
  Task,
  'fullScore' | 'rubricGeneration' | 'rubricDraft'
> {
  return {
    fullScore,
    rubricGeneration,
    rubricDraft: {
      source: 'teacher',
      writingGoal: 'Synthetic goal.',
      offTopicCriteria: [],
      dimensions: [{
        id: 'language',
        name: 'Language',
        weight: 100,
        description: 'Language quality.',
        deductionFocus: [],
      }],
      excellentFeatures: [],
      reviewTriggers: [],
      status: 'confirmed',
    },
  }
}

describe('getClassOverviewStats', () => {
  it('summarizes class scores and groups them by exam score bands', () => {
    const essays = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'].map(essay)
    const stats = getClassOverviewStats(essays, [
      result('e1', 2),
      result('e2', 6),
      result('e3', 9),
      result('e4', 12),
      result('e5', 13),
    ], overviewTask(15))

    expect(stats.totalEssayCount).toBe(6)
    expect(stats.scoredEssayCount).toBe(5)
    expect(stats.averageScore).toBe(8.4)
    expect(stats.highestScore).toBe(13)
    expect(stats.lowestScore).toBe(2)
    expect(stats.bands).toEqual([
      { label: '0-3', count: 1, percent: 20 },
      { label: '4-6', count: 1, percent: 20 },
      { label: '7-9', count: 1, percent: 20 },
      { label: '10-12', count: 1, percent: 20 },
      { label: '13-15', count: 1, percent: 20 },
    ])
  })

  it('returns empty score summaries when no essays have scores yet', () => {
    const stats = getClassOverviewStats([essay('e1')], [], overviewTask(15))

    expect(stats.totalEssayCount).toBe(1)
    expect(stats.scoredEssayCount).toBe(0)
    expect(stats.averageScore).toBeNull()
    expect(stats.highestScore).toBeNull()
    expect(stats.lowestScore).toBeNull()
    expect(stats.bands.every((band) => band.count === 0 && band.percent === 0)).toBe(true)
  })

  it('includes current grading-ready results without requiring teacher confirmation', () => {
    const confirmed = essay('confirmed')
    const ready = {
      ...essay('ready'),
      status: 'grading_ready' as const,
      teacherReviewed: false,
    }

    const stats = getClassOverviewStats(
      [confirmed, ready],
      [result('confirmed', 26, 30), result('ready', 30, 30)],
      overviewTask(30),
    )

    expect(stats.scoredEssayCount).toBe(2)
    expect(stats.averageScore).toBe(28)
    expect(stats.bands).toEqual([
      { label: '0-7', count: 0, percent: 0 },
      { label: '8-13', count: 0, percent: 0 },
      { label: '14-19', count: 0, percent: 0 },
      { label: '20-25', count: 0, percent: 0 },
      { label: '26-30', count: 2, percent: 100 },
    ])
  })

  it('excludes manual and in-progress essays even when stale results are present', () => {
    const stats = getClassOverviewStats(
      [
        { ...essay('ready'), status: 'grading_ready', teacherReviewed: false },
        { ...essay('manual'), status: 'manual', teacherReviewed: false },
        { ...essay('grading'), status: 'grading', teacherReviewed: false },
      ],
      [result('ready', 12), result('manual', 15), result('grading', 14)],
      overviewTask(15),
    )

    expect(stats.scoredEssayCount).toBe(1)
    expect(stats.averageScore).toBe(12)
  })

  it('uses the same run and generation eligibility as class-review aggregation', () => {
    const failed = successfulEssay('failed', {
      gradingRun: {
        status: 'failed',
        requestId: 'failed-request',
        errorCode: 'provider_unavailable',
        errorMessage: 'Synthetic failure',
        retryable: false,
        completedAt: '2026-06-25T09:00:00.000Z',
        sourceGeneration: 2,
        rubricGeneration: 3,
      },
    })
    const running = successfulEssay('running', {
      gradingRun: {
        status: 'running',
        requestId: 'running-request',
        startedAt: '2026-06-25T09:00:00.000Z',
        sourceGeneration: 2,
        rubricGeneration: 3,
      },
    })
    const staleSource = successfulEssay('stale-source', {
      gradingRun: {
        status: 'success',
        requestId: 'stale-source-request',
        source: 'mock',
        reviewReasons: [],
        startedAt: '2026-06-25T08:59:00.000Z',
        completedAt: '2026-06-25T09:00:00.000Z',
        sourceGeneration: 1,
        rubricGeneration: 3,
      },
    })
    const staleRubric = successfulEssay('stale-rubric', {
      gradingRun: {
        status: 'success',
        requestId: 'stale-rubric-request',
        source: 'mock',
        reviewReasons: [],
        startedAt: '2026-06-25T08:59:00.000Z',
        completedAt: '2026-06-25T09:00:00.000Z',
        sourceGeneration: 2,
        rubricGeneration: 2,
      },
    })

    const stats = getClassOverviewStats(
      [successfulEssay('current'), failed, running, staleSource, staleRubric],
      ['current', 'failed', 'running', 'stale-source', 'stale-rubric'].map((id) => result(id, 10)),
      overviewTask(15, 3),
    )

    expect(stats.scoredEssayCount).toBe(1)
    expect(stats.averageScore).toBe(10)
  })

  it.each([
    ['missing', undefined],
    ['draft', {
      ...overviewTask(15, 3).rubricDraft!,
      status: 'draft' as const,
    }],
  ])('rejects a modern captured run when the current rubric is %s', (_label, rubricDraft) => {
    const stats = getClassOverviewStats(
      [successfulEssay('modern')],
      [result('modern', 10)],
      { fullScore: 15, rubricGeneration: 3, rubricDraft },
    )

    expect(stats.scoredEssayCount).toBe(0)
    expect(stats.averageScore).toBeNull()
  })

  it('accepts a modern captured run only with a confirmed current rubric', () => {
    const stats = getClassOverviewStats(
      [successfulEssay('modern')],
      [result('modern', 10)],
      overviewTask(15, 3),
    )

    expect(stats.scoredEssayCount).toBe(1)
    expect(stats.averageScore).toBe(10)
  })

  it.each([
    ['score below zero', { totalScore: -1 }],
    ['score above full score', { totalScore: 16 }],
    ['empty dimensions', { dimensionScores: [] }],
    ['duplicate dimension ids', {
      dimensionScores: [
        result('seed', 10).dimensionScores[0],
        result('seed', 10).dimensionScores[0],
      ],
    }],
    ['invalid dimension maximum', {
      dimensionScores: [{ ...result('seed', 10).dimensionScores[0], maxScore: 0 }],
    }],
  ])('rejects a structurally invalid score channel: %s', (_label, overrides) => {
    const invalid = { ...result('invalid', 10), ...overrides } as GradingResult
    const stats = getClassOverviewStats(
      [successfulEssay('invalid')],
      [invalid],
      overviewTask(15, 3),
    )

    expect(stats.scoredEssayCount).toBe(0)
    expect(stats.averageScore).toBeNull()
  })

  it.each([
    ['zero dimension weight', {
      dimensionScores: [{ ...result('seed', 10).dimensionScores[0], weight: 0 }],
    }],
    ['dimension weights not totaling 100', {
      dimensionScores: [
        {
          ...result('seed', 10).dimensionScores[0],
          id: 'content',
          name: 'Content',
          score: 5,
          maxScore: 7.5,
          weight: 50,
        },
        {
          ...result('seed', 10).dimensionScores[0],
          id: 'language',
          score: 5,
          maxScore: 6,
          weight: 40,
        },
      ],
    }],
    ['dimension maximum above task full score', {
      dimensionScores: [{ ...result('seed', 10).dimensionScores[0], maxScore: 16 }],
    }],
    ['dimension maximum inconsistent with its weight', {
      dimensionScores: [{ ...result('seed', 10).dimensionScores[0], maxScore: 14 }],
    }],
    ['reported total inconsistent with dimension scores', { totalScore: 9 }],
    ['invalid dimension review flag', {
      dimensionScores: [{
        ...result('seed', 10).dimensionScores[0],
        needsTeacherReview: 'yes',
      }],
    }],
  ])('rejects an internally incoherent score channel: %s', (_label, overrides) => {
    const incoherent = { ...result('incoherent', 10), ...overrides } as unknown as GradingResult
    const stats = getClassOverviewStats(
      [successfulEssay('incoherent')],
      [incoherent],
      overviewTask(15, 3),
    )

    expect(stats.scoredEssayCount).toBe(0)
    expect(stats.averageScore).toBeNull()
  })

  it('uses the current visible-legibility cap when reconciling the total score', () => {
    const legibilityTask = {
      ...overviewTask(15, 3),
      rubricDraft: {
        ...overviewTask(15, 3).rubricDraft!,
        dimensions: [
          { id: 'content', name: 'Content', weight: 95, description: 'Content.', deductionFocus: [] },
          { id: 'legibility', name: 'Legibility', weight: 5, description: 'Legibility.', deductionFocus: [] },
        ],
      },
    }
    const capped = {
      ...result('legibility', 14),
      dimensionScores: [
        {
          ...result('seed', 10).dimensionScores[0],
          id: 'content',
          name: 'Content',
          score: 14.25,
          maxScore: 14.25,
          weight: 95,
        },
        {
          ...result('seed', 10).dimensionScores[0],
          id: 'legibility',
          name: 'Legibility',
          score: 0.5,
          maxScore: 0.75,
          weight: 5,
        },
      ],
      legibilityIssues: [{
        id: 'legibility-1',
        transcriptText: 'word',
        possibleReadings: ['word', 'ward'],
        pageNumber: 1,
        regionDescription: 'line 1',
        explanation: 'Synthetic visible issue.',
        defaultOutcome: 'count_as_legibility_error' as const,
      }],
    }
    const uncapped = { ...capped, id: 'uncapped-result', essayId: 'uncapped', totalScore: 15 }

    expect(getClassOverviewStats(
      [successfulEssay('legibility')],
      [capped],
      legibilityTask,
    ).scoredEssayCount).toBe(1)
    expect(getClassOverviewStats(
      [successfulEssay('uncapped')],
      [uncapped],
      legibilityTask,
    ).scoredEssayCount).toBe(0)
  })

  it('accepts an exact modern rubric score channel and coherent legacy generation-zero scores', () => {
    const currentTask = {
      ...overviewTask(15, 3),
      rubricDraft: {
        source: 'teacher' as const,
        writingGoal: 'Synthetic goal.',
        offTopicCriteria: [],
        dimensions: [
          { id: 'content', name: 'Content', weight: 40, description: 'Content.', deductionFocus: [] },
          { id: 'language', name: 'Language', weight: 60, description: 'Language.', deductionFocus: [] },
        ],
        excellentFeatures: [],
        reviewTriggers: [],
        status: 'confirmed' as const,
      },
    }
    const modern = {
      ...result('modern', 12),
      dimensionScores: [
        { ...result('seed', 10).dimensionScores[0], id: 'content', name: 'Content', score: 5, maxScore: 6, weight: 40 },
        { ...result('seed', 10).dimensionScores[0], id: 'language', name: 'Language', score: 7, maxScore: 9, weight: 60 },
      ],
    }

    const modernStats = getClassOverviewStats(
      [successfulEssay('modern')],
      [modern],
      currentTask,
    )
    const legacyStats = getClassOverviewStats(
      [essay('legacy')],
      [result('legacy', 11)],
      { fullScore: 15, rubricGeneration: 0, rubricDraft: undefined },
    )

    expect(modernStats.scoredEssayCount).toBe(1)
    expect(legacyStats.scoredEssayCount).toBe(1)
  })

  it.each([
    ['dimension order', (dimensions: GradingResult['dimensionScores']) => [...dimensions].reverse()],
    ['dimension name', (dimensions: GradingResult['dimensionScores']) => [
      { ...dimensions[0], name: 'Different content name' }, dimensions[1],
    ]],
    ['dimension weight', (dimensions: GradingResult['dimensionScores']) => [
      { ...dimensions[0], maxScore: 7.5, weight: 50 },
      { ...dimensions[1], maxScore: 7.5, weight: 50 },
    ]],
    ['dimension maximum', (dimensions: GradingResult['dimensionScores']) => [
      { ...dimensions[0], maxScore: 5.99 }, dimensions[1],
    ]],
  ])('rejects modern current-rubric mismatch in %s', (_label, mutate) => {
    const currentTask = {
      ...overviewTask(15, 3),
      rubricDraft: {
        source: 'teacher' as const,
        writingGoal: 'Synthetic goal.',
        offTopicCriteria: [],
        dimensions: [
          { id: 'content', name: 'Content', weight: 40, description: 'Content.', deductionFocus: [] },
          { id: 'language', name: 'Language', weight: 60, description: 'Language.', deductionFocus: [] },
        ],
        excellentFeatures: [],
        reviewTriggers: [],
        status: 'confirmed' as const,
      },
    }
    const dimensions = [
      { ...result('seed', 10).dimensionScores[0], id: 'content', name: 'Content', score: 5, maxScore: 6, weight: 40 },
      { ...result('seed', 10).dimensionScores[0], id: 'language', name: 'Language', score: 7, maxScore: 9, weight: 60 },
    ]
    const mismatched = { ...result('mismatch', 12), dimensionScores: mutate(dimensions) }

    expect(getClassOverviewStats(
      [successfulEssay('mismatch')],
      [mismatched],
      currentTask,
    ).scoredEssayCount).toBe(0)
  })
})
