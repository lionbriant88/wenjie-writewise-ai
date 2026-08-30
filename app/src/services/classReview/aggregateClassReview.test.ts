import { describe, expect, it } from 'vitest'
import type {
  ErrorAnnotation,
  Essay,
  FullTextChangeType,
  FullTextSentencePair,
  GradingResult,
  LegibilityIssue,
  LogicIssue,
  SentenceRevision,
  Task,
  UpgradedExpression,
} from '../../types'
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
    rubricDraft: {
      source: 'teacher',
      writingGoal: 'Synthetic goal.',
      offTopicCriteria: [],
      dimensions: [
        {
          id: 'language',
          name: 'Language',
          weight: 90,
          description: 'Language quality.',
          deductionFocus: [],
        },
        {
          id: 'legibility',
          name: 'Legibility',
          weight: 10,
          description: 'Legibility quality.',
          deductionFocus: [],
        },
      ],
      excellentFeatures: [],
      reviewTriggers: [],
      status: 'confirmed',
    },
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
    needsTeacherReview: false,
  }
}

function result(
  essayId: string,
  totalScore: number,
  errorAnnotations: ErrorAnnotation[] = [],
): GradingResult {
  const legibilityScore = Math.min(totalScore, 1.5)
  return {
    id: `${essayId}-result`,
    essayId,
    resultRevision: 1,
    totalScore,
    dimensionScores: [
      {
        id: 'language',
        name: 'Language',
        score: totalScore - legibilityScore,
        maxScore: 13.5,
        weight: 90,
        reason: 'Synthetic language score reason.',
        evidence: 'Synthetic language score evidence.',
      },
      {
        id: 'legibility',
        name: 'Legibility',
        score: legibilityScore,
        maxScore: 1.5,
        weight: 10,
        reason: 'Synthetic legibility score reason.',
        evidence: 'Synthetic legibility score evidence.',
      },
    ],
    errorAnnotations: errorAnnotations.map((annotation) => ({
      ...annotation,
      needsTeacherReview: annotation.needsTeacherReview ?? false,
    })),
    sentenceRevisions: [],
    upgradedExpressions: [],
    fullTextRevision: {
      originalText: 'Synthetic transcript.',
      correctedText: 'Synthetic transcript.',
      polishedText: 'Synthetic transcript.',
      sentencePairs: [],
      logicIssues: [],
      logicNotes: [],
    },
    recognitionWarnings: [],
    legibilityIssues: [],
    overallComment: 'Synthetic overall comment.',
    resultVersion: 'grading-result-v2',
    source: 'mock',
    reviewReasons: [],
    transcript: 'Synthetic transcript.',
    printedTextExcluded: true,
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
      needsTeacherReview: false,
    })),
    sentenceRevisions: occurrences.map((occurrence, index) => ({
      id: `revision-${essayId}-${index}`,
      relatedErrorIds: [occurrence.id],
      original: occurrence.original,
      revised: occurrence.corrected,
      note: 'Synthetic correction note.',
      changeTypes: [occurrence.type ?? 'spelling'],
      needsTeacherReview: false,
    })),
  }
}

function revisionItem(
  id = 'revision-1',
  relatedErrorIds: string[] = ['error-1'],
  changeTypes: FullTextChangeType[] = ['grammar'],
): SentenceRevision {
  return {
    id,
    relatedErrorIds,
    original: 'go school',
    revised: 'go to school',
    note: 'Synthetic revision note.',
    changeTypes,
    needsTeacherReview: false,
  }
}

function pairItem(
  id = 'pair-1',
  relatedErrorIds: string[] = ['error-1'],
  changeTypes: FullTextChangeType[] = ['grammar'],
): FullTextSentencePair {
  return {
    id,
    relatedErrorIds,
    original: 'go school',
    corrected: 'go to school',
    polished: 'I go to school.',
    explanation: 'Synthetic pair explanation.',
    changeTypes,
    needsTeacherReview: false,
  }
}

function logicItem(id = 'logic-1'): LogicIssue {
  return {
    id,
    original: 'This is unclear.',
    contextBefore: '',
    contextAfter: '',
    subType: 'unclear_logic',
    severity: 'medium',
    diagnosis: 'Synthetic diagnosis.',
    suggestedAction: 'ask_student_to_explain',
    conservativeSuggestion: 'Explain the connection.',
    polishedSuggestion: 'Clarify the connection.',
    needsTeacherReview: false,
  }
}

function upgradeItem(id = 'upgrade-1'): UpgradedExpression {
  return {
    id,
    original: 'good',
    upgraded: 'beneficial',
    note: 'Synthetic upgrade note.',
    needsTeacherReview: false,
  }
}

function legibilityItem(id = 'legibility-1', pageNumber = 1): LegibilityIssue {
  return {
    id,
    transcriptText: 'word',
    possibleReadings: ['word', 'ward'],
    pageNumber,
    regionDescription: 'line 1',
    explanation: 'Synthetic legibility explanation.',
    defaultOutcome: 'count_as_legibility_error',
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
  it('retains authoritative full-score and exact score medians for projection', () => {
    const essays = [essay('median-a'), essay('median-b'), essay('median-c')]
    const aggregate = aggregateClassReviewSnapshot({
      task: task({ fullScore: 15 }),
      essays,
      results: [
        result('median-a', 3),
        result('median-b', 13),
        result('median-c', 12),
      ],
    })

    expect(aggregate.fullScore).toBe(15)
    expect(aggregate.scoreMedian).toBe(12)
    expect(aggregate.dimensions).toEqual([
      {
        dimensionId: 'language',
        name: 'Language',
        averageScore: 7.8,
        medianScore: 10.5,
        maxScore: 13.5,
        normalizedPerformance: 0.577778,
      },
      {
        dimensionId: 'legibility',
        name: 'Legibility',
        averageScore: 1.5,
        medianScore: 1.5,
        maxScore: 1.5,
        normalizedPerformance: 1,
      },
    ])
  })

  it('counts only fixed nonzero issue counters before clear-spelling extraction', () => {
    const directIssues: ErrorAnnotation[] = [
      issue('grammar-counter'),
      {
        ...issue('spelling-counter', 'feelling', 'feeling'),
        type: 'spelling',
        severity: 'low',
      },
      {
        ...issue('word-choice-counter', 'filling', 'feeling'),
        type: 'word_choice',
        severity: 'high',
      },
      {
        ...issue('structure-counter', 'First. Second.', 'First, then second.'),
        type: 'structure',
        severity: 'low',
      },
    ]
    const clearSpellingBase = spellingResult('counter-a', [
      { id: 'spelling-counter', original: 'feelling', corrected: 'feeling' },
    ])
    const countedResult = {
      ...clearSpellingBase,
      errorAnnotations: directIssues,
    }
    const structuralBase = result('counter-b', 11)
    const structuralResult = {
      ...structuralBase,
      fullTextRevision: {
        ...structuralBase.fullTextRevision!,
        logicIssues: [logicItem('logic-counter')],
      },
      legibilityIssues: [legibilityItem('legibility-counter')],
    }
    const aggregate = aggregateClassReviewSnapshot({
      task: task(),
      essays: [essay('counter-a'), essay('counter-b')],
      results: [countedResult, structuralResult],
    })

    expect(aggregate.clearSpellingItems).toHaveLength(1)
    expect(aggregate.fixedIssueCounters).toEqual([
      { counterId: 'grammar', count: 1 },
      { counterId: 'spelling', count: 1 },
      { counterId: 'word_choice', count: 1 },
      { counterId: 'structure', count: 1 },
      { counterId: 'legibility', count: 1 },
      { counterId: 'logic_unclear_logic', count: 1 },
      { counterId: 'severity_low', count: 2 },
      { counterId: 'severity_medium', count: 2 },
      { counterId: 'severity_high', count: 1 },
    ])
    expect(aggregate.fixedIssueCounters.some(({ counterId }) => counterId === 'other')).toBe(false)
  })

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
        averageScore: 10.5,
        medianScore: 10.5,
        maxScore: 13.5,
        normalizedPerformance: 0.777778,
      },
      {
        dimensionId: 'legibility',
        name: 'Legibility',
        averageScore: 1.5,
        medianScore: 1.5,
        maxScore: 1.5,
        normalizedPerformance: 1,
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
    ['missing', undefined, 0],
    ['draft', { ...task().rubricDraft!, status: 'draft' as const }, 0],
    ['valid confirmed', task().rubricDraft!, 1],
  ])('isolates modern score eligibility with a %s rubric', (_label, rubricDraft, expected) => {
    const aggregate = aggregateClassReviewSnapshot({
      task: task({ rubricDraft }),
      essays: [essay('modern-rubric-state')],
      results: [result('modern-rubric-state', 12)],
    })

    expect(aggregate.includedEssayCount).toBe(expected)
    expect(aggregate.excludedEssayCount).toBe(1 - expected)
  })

  it.each([
    ['blank writing goal', () => ({
      currentTask: task({
        rubricDraft: { ...task().rubricDraft!, writingGoal: '   ' },
      }),
      currentResult: result('invalid-confirmed', 12),
    })],
    ['blank dimension description', () => ({
      currentTask: task({
        rubricDraft: {
          ...task().rubricDraft!,
          dimensions: task().rubricDraft!.dimensions.map((dimension, index) => (
            index === 0 ? { ...dimension, description: ' ' } : dimension
          )),
        },
      }),
      currentResult: result('invalid-confirmed', 12),
    })],
    ['only one non-legibility dimension', () => ({
      currentTask: task({
        rubricDraft: {
          ...task().rubricDraft!,
          dimensions: [{
            id: 'language',
            name: 'Language',
            weight: 100,
            description: 'Language quality.',
            deductionFocus: [],
          }],
        },
      }),
      currentResult: {
        ...result('invalid-confirmed', 12),
        dimensionScores: [{
          ...result('invalid-confirmed', 12).dimensionScores[0],
          score: 12,
          maxScore: 15,
          weight: 100,
        }],
      },
    })],
  ])('rejects a modern invalid-confirmed rubric: %s', (_label, makeCase) => {
    const { currentTask, currentResult } = makeCase()
    const aggregate = aggregateClassReviewSnapshot({
      task: currentTask,
      essays: [essay('invalid-confirmed')],
      results: [currentResult],
    })

    expect(aggregate.includedEssayCount).toBe(0)
    expect(aggregate.exclusions).toEqual([
      { essayId: 'invalid-confirmed', reason: 'invalid_result' },
    ])
  })

  it('keeps the explicit no-run generation-zero legacy route without a rubric', () => {
    const aggregate = aggregateClassReviewSnapshot({
      task: task({ rubricGeneration: 0, rubricDraft: undefined }),
      essays: [essay('legacy-zero', 'legacy')],
      results: [result('legacy-zero', 12)],
    })

    expect(aggregate).toMatchObject({
      includedEssayCount: 1,
      issueEligibleEssayCount: 0,
      excludedEssayCount: 0,
      partialIssueChannelCount: 1,
    })
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
        dimensions: [
          {
            id: 'language',
            name: 'Language',
            weight: 90,
            description: 'Language quality.',
            deductionFocus: [],
          },
          {
            id: 'legibility',
            name: 'Legibility',
            weight: 10,
            description: 'Legibility quality.',
            deductionFocus: [],
          },
        ],
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

  it.each([
    ['duplicate related IDs', (base: GradingResult) => ({
      ...base,
      errorAnnotations: [issue('error-1')],
      sentenceRevisions: [revisionItem('revision-1', ['error-1', 'error-1'])],
    })],
    ['dangling related IDs', (base: GradingResult) => ({
      ...base,
      errorAnnotations: [issue('error-1')],
      sentenceRevisions: [revisionItem('revision-1', ['missing-error'])],
    })],
    ['empty change types', (base: GradingResult) => ({
      ...base,
      errorAnnotations: [issue('error-1')],
      sentenceRevisions: [revisionItem('revision-1', ['error-1'], [])],
    })],
    ['duplicate change types', (base: GradingResult) => ({
      ...base,
      errorAnnotations: [issue('error-1')],
      sentenceRevisions: [revisionItem('revision-1', ['error-1'], ['grammar', 'grammar'])],
    })],
    ['invalid change types', (base: GradingResult) => ({
      ...base,
      errorAnnotations: [issue('error-1')],
      sentenceRevisions: [revisionItem(
        'revision-1',
        ['error-1'],
        ['invalid_change_type' as FullTextChangeType],
      )],
    })],
    ['duplicate lexical issue IDs', (base: GradingResult) => ({
      ...base,
      errorAnnotations: [issue('error-1'), issue('error-1')],
    })],
    ['duplicate sentence revision IDs', (base: GradingResult) => ({
      ...base,
      errorAnnotations: [issue('error-1')],
      sentenceRevisions: [revisionItem('revision-1'), revisionItem('revision-1')],
    })],
    ['duplicate sentence pair IDs', (base: GradingResult) => ({
      ...base,
      errorAnnotations: [issue('error-1')],
      fullTextRevision: {
        ...base.fullTextRevision!,
        sentencePairs: [pairItem('pair-1'), pairItem('pair-1')],
      },
    })],
    ['duplicate logic issue IDs', (base: GradingResult) => ({
      ...base,
      fullTextRevision: {
        ...base.fullTextRevision!,
        logicIssues: [logicItem('logic-1'), logicItem('logic-1')],
      },
    })],
    ['duplicate upgraded-expression IDs', (base: GradingResult) => ({
      ...base,
      upgradedExpressions: [upgradeItem('upgrade-1'), upgradeItem('upgrade-1')],
    })],
    ['duplicate legibility IDs', (base: GradingResult) => ({
      ...base,
      legibilityIssues: [legibilityItem('legibility-1'), legibilityItem('legibility-1')],
    })],
    ['cross-collection duplicate IDs', (base: GradingResult) => ({
      ...base,
      errorAnnotations: [issue('shared-id')],
      sentenceRevisions: [revisionItem('shared-id', ['shared-id'])],
    })],
    ['malformed upgraded expression', (base: GradingResult) => ({
      ...base,
      upgradedExpressions: [{ ...upgradeItem(), note: '' }],
    })],
    ['empty lexical evidence text', (base: GradingResult) => ({
      ...base,
      errorAnnotations: [{ ...issue('error-1'), original: '' }],
    })],
    ['empty overall comment', (base: GradingResult) => ({
      ...base,
      overallComment: '',
    })],
    ['empty recognition warning', (base: GradingResult) => ({
      ...base,
      recognitionWarnings: [''],
    })],
    ['duplicate logic notes', (base: GradingResult) => ({
      ...base,
      fullTextRevision: {
        ...base.fullTextRevision!,
        logicNotes: ['Synthetic note.', 'Synthetic note.'],
      },
    })],
    ['invalid legibility page zero', (base: GradingResult) => ({
      ...base,
      legibilityIssues: [legibilityItem('legibility-1', 0)],
    })],
    ['invalid legibility page above essay count', (base: GradingResult) => ({
      ...base,
      legibilityIssues: [legibilityItem('legibility-1', 2)],
    })],
    ['invalid fractional legibility page', (base: GradingResult) => ({
      ...base,
      legibilityIssues: [legibilityItem('legibility-1', 1.5)],
    })],
    ['missing full-text revision', (base: GradingResult) => ({
      ...base,
      fullTextRevision: undefined,
    })],
    ['empty full-text source', (base: GradingResult) => ({
      ...base,
      fullTextRevision: { ...base.fullTextRevision!, originalText: '' },
    })],
    ['full-text source not equal to adapted transcript', (base: GradingResult) => ({
      ...base,
      fullTextRevision: { ...base.fullTextRevision!, originalText: 'Different transcript.' },
    })],
    ['out-of-range optional confidence', (base: GradingResult) => ({
      ...base,
      aiConfidence: 1.1,
    })],
    ['negative optional result revision', (base: GradingResult) => ({
      ...base,
      resultRevision: -1,
    })],
  ])('keeps score eligibility but rejects deeply incomplete issue evidence: %s', (
    _label,
    mutate,
  ) => {
    const malformed = mutate(result('deep-malformed', 12)) as GradingResult
    const aggregate = aggregateClassReviewSnapshot({
      task: task(),
      essays: [essay('deep-malformed')],
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

  it('accepts pure presentation revisions and sentence pairs with no related issue IDs', () => {
    const complete = result('unlinked-presentation', 12)
    complete.sentenceRevisions = [revisionItem('revision-1', [], ['coherence'])]
    complete.fullTextRevision = {
      ...complete.fullTextRevision!,
      sentencePairs: [pairItem('pair-1', [], ['sentence_upgrade'])],
    }

    const aggregate = aggregateClassReviewSnapshot({
      task: task(),
      essays: [essay('unlinked-presentation')],
      results: [complete],
    })

    expect(aggregate).toMatchObject({
      includedEssayCount: 1,
      issueEligibleEssayCount: 1,
      excludedEssayCount: 0,
      partialIssueChannelCount: 0,
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
      occurrenceCount: 1,
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

  it('uses only the newly pointed-to result when old and new regrade results coexist', () => {
    const currentEssay = essay('regraded', 'success', { aiResultId: 'regraded-result-new' })
    const oldResult = {
      ...spellingResult('regraded', [
        { id: 'old-spelling', original: 'feelling', corrected: 'feeling' },
      ]),
      id: 'regraded-result-old',
    }
    const newResult = {
      ...spellingResult('regraded', [
        { id: 'new-spelling', original: 'recieve', corrected: 'receive' },
      ]),
      id: 'regraded-result-new',
      resultRevision: 2,
    }

    const aggregate = aggregateClassReviewSnapshot({
      task: task(),
      essays: [currentEssay],
      results: [oldResult, newResult],
    })

    expect(aggregate.includedEssayCount).toBe(1)
    expect(aggregate.clearSpellingItems).toHaveLength(1)
    expect(aggregate.clearSpellingItems[0]).toMatchObject({
      originalWord: 'recieve',
      correctedWord: 'receive',
      occurrenceCount: 1,
    })
    expect(aggregate.clearSpellingItems.some((item) => item.originalWord === 'feelling')).toBe(false)
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
