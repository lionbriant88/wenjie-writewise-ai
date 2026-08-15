import { describe, expect, it } from 'vitest'
import type { AiGradingResultV1, GradingRequestV1 } from './types'
import { adaptAiGradingResult } from './adaptAiGradingResult'

const request: GradingRequestV1 = {
  requestVersion: 'grading-request-v1',
  requestId: 'request-1',
  task: {
    taskId: 'task-1',
    writingGenre: 'practical_writing',
    fullScore: 15,
    prompt: { writingGenre: 'practical_writing', taskRequirement: 'Write synthetic advice.' },
    rubric: {
      status: 'confirmed',
      writingGoal: 'Give advice.',
      offTopicCriteria: [],
      dimensions: [{
        id: 'language', name: 'Language', weight: 100, description: 'Accuracy', deductionFocus: [],
      }],
      excellentFeatures: [],
      reviewTriggers: [],
    },
  },
  essay: {
    essayId: 'essay-1',
    confirmedTranscript: 'Teacher-confirmed synthetic transcript.',
    ocrContext: { sourceKind: 'manual', hasKnownOcrRisk: false, riskCodes: [] },
  },
}

const aiResult: AiGradingResultV1 = {
  resultVersion: 'grading-result-v1',
  requestId: request.requestId,
  essayId: request.essay.essayId,
  provider: 'remote',
  status: 'success',
  totalScore: 12,
  maxScore: 15,
  dimensionScores: [{
    dimensionId: 'language', name: 'Language', score: 12, maxScore: 15, weight: 100,
    reason: 'Mostly accurate.', evidence: 'Synthetic evidence.', requiresTeacherReview: true,
  }],
  issues: [{
    id: 'issue-1', type: 'grammar', severity: 'medium',
    originalText: 'I suggest you joins the club.',
    suggestion: 'I suggest you join the club.',
    explanation: 'Use the base verb.', evidenceCertainty: 'certain', requiresTeacherReview: true,
  }],
  sentenceRevisions: [{
    id: 'revision-1', relatedIssueIds: ['issue-1'], originalText: 'joins', revisedText: 'join', note: 'Base verb.', changeTypes: ['grammar'], requiresTeacherReview: false,
  }],
  expressionUpgrades: [{
    id: 'upgrade-1', originalText: 'very useful', upgradedText: 'highly beneficial', note: 'More precise.', requiresTeacherReview: true,
  }],
  fullTextRevision: {
    originalText: 'provider raw original',
    correctedText: 'Corrected synthetic transcript.',
    improvedText: 'Improved synthetic transcript.',
    sentencePairs: [{
      id: 'pair-1', originalText: 'joins', correctedText: 'join', improvedText: 'take part',
      relatedIssueIds: ['issue-1'], changeTypes: ['grammar'], explanation: 'Grammar correction.', requiresTeacherReview: true,
    }],
    logicNotes: ['Teacher should verify meaning.'],
    logicIssues: [{
      id: 'logic-1', originalText: 'joins', contextBefore: 'I suggest you ', contextAfter: ' the club.',
      subType: 'unclear_logic', severity: 'medium', diagnosis: 'Synthetic logic diagnosis.',
      suggestedAction: 'add_bridge_sentence', conservativeSuggestion: 'Clarify the connection.',
      polishedSuggestion: 'Add a transition.', requiresTeacherReview: true,
    }],
  },
  legibilityIssues: [{
    id: 'legibility-1', transcriptText: 'cant', possibleReadings: ['cant', "can't"], pageNumber: 1,
    regionDescription: 'Synthetic region.', explanation: 'The handwriting is ambiguous.', defaultOutcome: 'count_as_legibility_error',
  }],
  overallComment: 'A synthetic result.',
  reviewReasons: ['Review the suggested rewrite.'],
  transcript: 'Student text.',
  recognitionWarnings: ['One word unclear.'],
  printedTextExcluded: true,
  createdAt: '2026-07-20T00:00:00.000Z',
}

describe('adaptAiGradingResult', () => {
  it('adapts the normalized wire result into the existing page model', () => {
    const adapted = adaptAiGradingResult(aiResult, request)
    expect(adapted).toMatchObject({
      id: 'essay-1-result',
      essayId: 'essay-1',
      resultVersion: 'grading-result-v1',
      source: 'remote',
      teacherAdjusted: false,
      totalScore: 12,
    })
    expect(adapted.errorAnnotations[0]).toMatchObject({
      original: 'I suggest you joins the club.',
      suggestion: 'I suggest you join the club.',
      evidenceCertainty: 'certain',
    })
    expect(adapted.fullTextRevision?.originalText).toBe('Student text.')
    expect(adapted.fullTextRevision?.sentencePairs[0].needsTeacherReview).toBe(true)
    expect(adapted.dimensionScores[0].needsTeacherReview).toBe(true)
    expect(adapted.errorAnnotations[0].needsTeacherReview).toBe(true)
    expect(adapted.sentenceRevisions[0].needsTeacherReview).toBe(false)
    expect(adapted.upgradedExpressions[0].needsTeacherReview).toBe(true)
    expect(adapted.fullTextRevision?.logicIssues).toMatchObject([{
      id: 'logic-1', contextBefore: 'I suggest you ', suggestedAction: 'add_bridge_sentence',
    }])
    expect(adapted.sentenceRevisions[0]).toMatchObject({ relatedErrorIds: ['issue-1'], changeTypes: ['grammar'] })
    expect(adapted.fullTextRevision?.sentencePairs[0]).toMatchObject({ relatedErrorIds: ['issue-1'], changeTypes: ['grammar'] })
    expect(adapted.legibilityIssues?.[0]).toMatchObject({ defaultOutcome: 'count_as_legibility_error' })
    expect(adapted).toMatchObject({ transcript: 'Student text.', recognitionWarnings: ['One word unclear.'], printedTextExcluded: true })
  })

  it('never uses a Provider-supplied original full text', () => {
    const adapted = adaptAiGradingResult(aiResult, request)
    expect(JSON.stringify(adapted)).not.toContain('provider raw original')
  })

  it('does not map optional model self-confidence into the teacher page model', () => {
    const adapted = adaptAiGradingResult({ ...aiResult, modelSelfConfidence: 0.99 }, request)
    expect(adapted).not.toHaveProperty('aiConfidence')
  })
})
