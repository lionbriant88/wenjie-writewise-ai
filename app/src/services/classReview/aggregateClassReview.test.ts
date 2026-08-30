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

function spellingResult(
  essayId: string,
  occurrences: Array<{
    id: string
    original: string
    corrected: string
    type?: 'spelling' | 'word_choice'
  }>,
): GradingResult {
  const base = result(essayId, 12)
  return {
    ...base,
    errorAnnotations: occurrences.map((occurrence) => ({
      id: occurrence.id,
      type: occurrence.type ?? 'spelling',
      original: occurrence.original,
      suggestion: occurrence.corrected,
      explanation: 'Synthetic clear spelling.',
      severity: 'low',
      evidenceCertainty: 'certain',
    })),
    sentenceRevisions: occurrences.map((occurrence, index) => ({
      id: `revision-${essayId}-${index}`,
      relatedErrorIds: [occurrence.id],
      original: occurrence.original,
      revised: occurrence.corrected,
      note: '',
      changeTypes: [occurrence.type ?? 'spelling'],
    })),
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

  it('rejects stale rubric captures independently from stale source captures', () => {
    const staleRubric = essay('stale-rubric', 'success', {
      gradingRun: {
        status: 'success',
        requestId: 'stale-rubric-request',
        source: 'mock',
        reviewReasons: [],
        startedAt: timestamp,
        completedAt: timestamp,
        sourceGeneration: 0,
        rubricGeneration: 1,
      },
    })
    const aggregate = aggregateClassReviewSnapshot({
      task: task({ rubricGeneration: 2 }),
      essays: [staleRubric],
      results: [result('stale-rubric', 12)],
    })

    expect(aggregate.includedEssayCount).toBe(0)
    expect(aggregate.excludedEssayCount).toBe(1)
    expect(aggregate.exclusions).toEqual([
      { essayId: 'stale-rubric', reason: 'stale_generation' },
    ])
  })

  it.each([
    ['score below zero', { totalScore: -1 }],
    ['score above full score', { totalScore: 16 }],
    ['empty dimensions', { dimensionScores: [] }],
    ['duplicate dimensions', {
      dimensionScores: [
        result('seed', 10).dimensionScores[0],
        result('seed', 10).dimensionScores[0],
      ],
    }],
    ['malformed dimensions array', { dimensionScores: null }],
    ['non-finite dimension score', {
      dimensionScores: [{ ...result('seed', 10).dimensionScores[0], score: Number.NaN }],
    }],
  ])('excludes an invalid score channel with a fixed reason: %s', (_label, overrides) => {
    const invalid = { ...result('invalid', 10), ...overrides } as unknown as GradingResult
    const aggregate = aggregateClassReviewSnapshot({
      task: task(),
      essays: [essay('invalid')],
      results: [invalid],
    })

    expect(aggregate).toMatchObject({
      includedEssayCount: 0,
      issueEligibleEssayCount: 0,
      excludedEssayCount: 1,
      partialIssueChannelCount: 0,
    })
    expect(aggregate.exclusions).toEqual([{ essayId: 'invalid', reason: 'invalid_result' }])
  })

  it('requires score dimensions to correspond to the current rubric when available', () => {
    const currentTask = task({
      rubricDraft: {
        source: 'teacher',
        writingGoal: 'Write clearly.',
        offTopicCriteria: [],
        dimensions: [{
          id: 'language',
          name: 'Language',
          weight: 40,
          description: 'Language quality.',
          deductionFocus: [],
        }],
        excellentFeatures: [],
        reviewTriggers: [],
        status: 'confirmed',
      },
    })
    const mismatched = result('mismatched', 10)
    mismatched.dimensionScores[0] = { ...mismatched.dimensionScores[0], id: 'other' }

    const aggregate = aggregateClassReviewSnapshot({
      task: currentTask,
      essays: [essay('mismatched')],
      results: [mismatched],
    })

    expect(aggregate.includedEssayCount).toBe(0)
    expect(aggregate.exclusions).toEqual([
      { essayId: 'mismatched', reason: 'invalid_result' },
    ])
  })

  it.each([
    ['malformed lexical issues', { errorAnnotations: null }],
    ['malformed sentence revisions', { sentenceRevisions: null }],
    ['malformed recognition warnings', { recognitionWarnings: [7] }],
    ['malformed full-text issue structures', {
      fullTextRevision: {
        originalText: '',
        correctedText: '',
        polishedText: '',
        sentencePairs: null,
        logicIssues: [],
        logicNotes: [],
      },
    }],
  ])('keeps a usable score but excludes an incomplete issue channel: %s', (_label, overrides) => {
    const malformed = { ...result('malformed', 12), ...overrides } as unknown as GradingResult
    const aggregate = aggregateClassReviewSnapshot({
      task: task(),
      essays: [essay('malformed')],
      results: [malformed],
    })

    expect(aggregate).toMatchObject({
      includedEssayCount: 1,
      issueEligibleEssayCount: 0,
      excludedEssayCount: 0,
      partialIssueChannelCount: 1,
    })
    expect(aggregate.issueGroups).toEqual([])
    expect(aggregate.clearSpellingItems).toEqual([])
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

  it('groups clear spelling by exact normalized pair and recomputes after edits or invalidation', () => {
    const currentEssay = essay('spelling')
    const initialResult = spellingResult('spelling', [
      { id: 'spell-1', original: 'feelling', corrected: 'feeling' },
      { id: 'spell-2', original: 'feelling', corrected: 'feeling' },
    ])
    const initial = aggregateClassReviewSnapshot({
      task: task(),
      essays: [currentEssay],
      results: [initialResult],
    })

    expect(initial.clearSpellingItems).toHaveLength(1)
    expect(initial.clearSpellingItems[0]).toMatchObject({
      sourceSubtype: 'spelling',
      studentCount: 1,
      occurrenceCount: 2,
    })

    const edited = aggregateClassReviewSnapshot({
      task: task(),
      essays: [currentEssay],
      results: [result('spelling', 12)],
    })
    const invalidated = aggregateClassReviewSnapshot({
      task: task(),
      essays: [{ ...currentEssay, status: 'manual' }],
      results: [initialResult],
    })

    expect(edited.clearSpellingItems).toEqual([])
    expect(invalidated.clearSpellingItems).toEqual([])
  })

  it('never merges different spelling corrections or source subtypes', () => {
    const essays = [essay('spelling-a'), essay('spelling-b'), essay('word-choice')]
    const aggregate = aggregateClassReviewSnapshot({
      task: task(),
      essays,
      results: [
        spellingResult('spelling-a', [
          { id: 'spell-a', original: 'feelling', corrected: 'feeling' },
        ]),
        spellingResult('spelling-b', [
          { id: 'spell-b', original: 'feelling', corrected: 'feelings' },
        ]),
        spellingResult('word-choice', [
          { id: 'choice', original: 'feelling', corrected: 'feeling', type: 'word_choice' },
        ]),
      ],
    })

    expect(aggregate.clearSpellingItems).toHaveLength(3)
    expect(new Set(aggregate.clearSpellingItems.map((item) => item.fingerprint)).size).toBe(3)
  })

  it('returns deeply identical output for essay, result and annotation permutations', () => {
    const firstEssay = essay('essay-a')
    const secondEssay = essay('essay-b')
    const failedEssay = essay('essay-c', 'failed')
    const firstIssues = [
      { ...issue('issue-z'), explanation: 'Z detail.', severity: 'low' as const },
      { ...issue('issue-b', ' Go   school ', ' Go to school '), explanation: 'B detail.' },
    ]
    const secondIssues = [
      { ...issue('issue-a', 'GO SCHOOL', 'GO TO SCHOOL'), explanation: 'A detail.', severity: 'high' as const },
    ]
    const firstResult = {
      ...spellingResult('essay-a', [
        { id: 'spell-a', original: 'Ｆｅｅｌｌｉｎｇ', corrected: 'Ｆｅｅｌｉｎｇ' },
      ]),
      errorAnnotations: [
        ...firstIssues,
        ...spellingResult('essay-a', [
          { id: 'spell-a', original: 'Ｆｅｅｌｌｉｎｇ', corrected: 'Ｆｅｅｌｉｎｇ' },
        ]).errorAnnotations,
      ],
    }
    const secondResult = {
      ...spellingResult('essay-b', [
        { id: 'spell-b', original: 'feelling', corrected: 'feeling' },
      ]),
      errorAnnotations: [
        ...secondIssues,
        ...spellingResult('essay-b', [
          { id: 'spell-b', original: 'feelling', corrected: 'feeling' },
        ]).errorAnnotations,
      ],
    }
    const failedResult = result('essay-c', 9)

    const forward = aggregateClassReviewSnapshot({
      task: task(),
      essays: [firstEssay, failedEssay, secondEssay],
      results: [firstResult, failedResult, secondResult],
    })
    const reversed = aggregateClassReviewSnapshot({
      task: task(),
      essays: [secondEssay, failedEssay, firstEssay],
      results: [secondResult, failedResult, {
        ...firstResult,
        errorAnnotations: [...firstResult.errorAnnotations].reverse(),
      }],
    })

    expect(reversed).toEqual(forward)
    expect(forward.issueGroups[0]).toMatchObject({
      severity: 'high',
      title: 'A detail.',
      distinctEssaySupport: 2,
      occurrenceCount: 3,
    })
  })
})
