import { describe, expect, it } from 'vitest'
import type { ErrorAnnotation, Essay, GradingResult, Task } from '../../types'
import {
  aggregateClassReviewSnapshot,
  classReviewSupportThreshold,
} from './aggregateClassReview'

const timestamp = '2026-08-29T00:00:00.000Z'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    rubricGeneration: 0,
    taskName: 'Synthetic task',
    className: '',
    essayType: '',
    fullScore: 15,
    scoringTemplateId: 'rubric-1',
    status: 'processing',
    totalEssayCount: 0,
    completedEssayCount: 0,
    exceptionEssayCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    generateClassReview: true,
    ...overrides,
  }
}

function essay(
  id: string,
  runStatus: 'success' | 'partial' | 'failed' | 'legacy' = 'success',
  overrides: Partial<Essay> = {},
): Essay {
  const gradingRun = runStatus === 'legacy'
    ? undefined
    : runStatus === 'failed'
      ? {
          status: 'failed' as const,
          requestId: `request-${id}`,
          errorCode: 'provider_unavailable',
          errorMessage: 'Synthetic failure',
          retryable: false,
          completedAt: timestamp,
          sourceGeneration: 0,
          rubricGeneration: 0,
        }
      : {
          status: runStatus,
          requestId: `request-${id}`,
          source: 'mock' as const,
          reviewReasons: [],
          startedAt: timestamp,
          completedAt: timestamp,
          sourceGeneration: 0,
          rubricGeneration: 0,
        }

  return {
    id,
    taskId: 'task-1',
    sourceGeneration: 0,
    essayNumber: id,
    pages: [],
    pageCount: 1,
    pageOrder: [],
    ocrText: '',
    ocrConfidence: 1,
    status: runStatus === 'failed' ? 'grading_ready' : 'grading_ready',
    exceptionReasons: [],
    aiResultId: `${id}-result`,
    gradingRun,
    teacherReviewed: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}

function issue(id: string, original = 'go school', suggestion = 'go to school'): ErrorAnnotation {
  return {
    id,
    type: 'grammar',
    original,
    suggestion,
    explanation: 'Missing preposition.',
    severity: 'medium',
    evidenceCertainty: 'certain',
  }
}

function result(
  essayId: string,
  totalScore: number,
  errorAnnotations: ErrorAnnotation[] = [],
): GradingResult {
  return {
    id: `${essayId}-result`,
    essayId,
    resultRevision: 1,
    totalScore,
    dimensionScores: [
      {
        id: 'language',
        name: 'Language',
        score: totalScore * 0.4,
        maxScore: 6,
        weight: 40,
        reason: '',
        evidence: '',
      },
    ],
    errorAnnotations,
    sentenceRevisions: [],
    upgradedExpressions: [],
    recognitionWarnings: [],
    legibilityIssues: [],
    overallComment: '',
    teacherAdjusted: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

describe('classReviewSupportThreshold', () => {
  it.each([
    [2, 2],
    [9, 2],
    [10, 3],
    [11, 3],
    [16, 4],
  ])('uses the headcount floor and rounded-up 20%% support for N_issue=%i', (count, expected) => {
    expect(classReviewSupportThreshold(count)).toBe(expected)
  })
})

describe('aggregateClassReviewSnapshot', () => {
  it('counts duplicate evidence once per essay while retaining every occurrence', () => {
    const essays = [essay('essay-1'), essay('essay-2')]
    const aggregate = aggregateClassReviewSnapshot({
      task: task({ totalEssayCount: essays.length }),
      essays,
      results: [
        result('essay-1', 12, [issue('issue-1'), issue('issue-2')]),
        result('essay-2', 10, [issue('issue-3')]),
      ],
    })

    expect(aggregate.issueEligibleEssayCount).toBe(2)
    expect(aggregate.issueGroups).toHaveLength(1)
    expect(aggregate.issueGroups[0]).toMatchObject({
      distinctEssaySupport: 2,
      occurrenceCount: 3,
    })
    expect(aggregate.commonIssueGroups).toHaveLength(1)
  })

  it('separates score and issue denominators and explains failed/manual exclusions', () => {
    const essays = [
      essay('success'),
      essay('partial', 'partial'),
      essay('legacy', 'legacy'),
      essay('failed', 'failed'),
      essay('manual', 'legacy', { status: 'manual' }),
    ]
    const aggregate = aggregateClassReviewSnapshot({
      task: task({ totalEssayCount: essays.length }),
      essays,
      results: [
        result('success', 13),
        result('partial', 12),
        result('legacy', 11),
        result('failed', 10),
        result('manual', 9),
      ],
    })

    expect(aggregate).toMatchObject({
      totalEssayCount: 5,
      includedEssayCount: 3,
      issueEligibleEssayCount: 1,
      excludedEssayCount: 2,
      partialIssueChannelCount: 2,
    })
    expect(aggregate.scoreSummary).toEqual({ averageScore: 12, highestScore: 13, lowestScore: 11 })
    expect(aggregate.dimensions).toEqual([
      {
        dimensionId: 'language',
        name: 'Language',
        averageScore: 4.8,
        maxScore: 6,
        normalizedPerformance: 0.8,
      },
    ])
    expect(aggregate.exclusions).toEqual([
      { essayId: 'failed', reason: 'grading_not_successful' },
      { essayId: 'manual', reason: 'manual' },
    ])
  })

  it('includes a current unconfirmed result and rejects stale generation captures', () => {
    const current = essay('current', 'success', { teacherReviewed: false })
    const stale = essay('stale', 'success', {
      sourceGeneration: 2,
      gradingRun: {
        status: 'success',
        requestId: 'stale-request',
        source: 'mock',
        reviewReasons: [],
        startedAt: timestamp,
        completedAt: timestamp,
        sourceGeneration: 1,
        rubricGeneration: 0,
      },
    })
    const aggregate = aggregateClassReviewSnapshot({
      task: task(),
      essays: [current, stale],
      results: [result('current', 12), result('stale', 14)],
    })

    expect(aggregate.includedEssayCount).toBe(1)
    expect(aggregate.scoreSummary?.averageScore).toBe(12)
    expect(aggregate.exclusions).toContainEqual({ essayId: 'stale', reason: 'stale_generation' })
  })

  it('returns a legal empty common-issue result', () => {
    const essays = [essay('essay-1'), essay('essay-2')]
    const aggregate = aggregateClassReviewSnapshot({
      task: task(),
      essays,
      results: [result('essay-1', 12), result('essay-2', 11)],
    })

    expect(aggregate.issueEligibleEssayCount).toBe(2)
    expect(aggregate.issueGroups).toEqual([])
    expect(aggregate.commonIssueGroups).toEqual([])
    expect(aggregate.clearSpellingItems).toEqual([])
  })

  it('requires an unambiguous current result association', () => {
    const withoutPointer = essay('ambiguous', 'legacy', { aiResultId: undefined })
    const aggregate = aggregateClassReviewSnapshot({
      task: task(),
      essays: [withoutPointer],
      results: [
        result('ambiguous', 10),
        { ...result('ambiguous', 11), id: 'ambiguous-result-2' },
      ],
    })

    expect(aggregate.includedEssayCount).toBe(0)
    expect(aggregate.exclusions).toEqual([
      { essayId: 'ambiguous', reason: 'ambiguous_result' },
    ])
  })
})
