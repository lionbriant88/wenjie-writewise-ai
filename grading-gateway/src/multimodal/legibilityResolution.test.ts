import { describe, expect, it } from 'vitest'
import { normalizeMultimodalResult } from './normalizeMultimodalResult.js'

const context = {
  requestId: 'request-legibility-resolution', essayId: 'essay-legibility-resolution',
  provider: 'remote' as const, pageCount: 1, createdAt: '2026-09-06T00:00:00.000Z',
  task: {
    taskId: 'task-legibility-resolution', fullScore: 20,
    materialSummary: 'A synthetic account.', writingRequirements: ['Describe the event.'], constraints: [],
    rubric: {
      taskName: 'Synthetic task', materialSummary: 'A synthetic account.', writingRequirements: ['Describe the event.'], constraints: [],
      dimensions: [
        { id: 'content', name: 'Content', weight: 90, description: 'Relevant.', deductionFocus: [], sourceEvidence: [] },
        { id: 'legibility', name: 'Legibility', weight: 10, description: 'Important unresolved readings.', deductionFocus: [], sourceEvidence: [] },
      ], reviewWarnings: [],
    },
  },
}

function issue(issueKey = 'legibility-resolved', transcriptText = 'realized', resolution = 'resolved_correct', deductionPoints = 0): Record<string, unknown> {
  return {
    issueKey, transcriptText, possibleReadings: [transcriptText, transcriptText === 'realized' ? 'redized' : 'want'],
    pageNumber: 1, regionDescription: 'Synthetic line 1', explanation: 'Synthetic reading assessment.',
    defaultOutcome: 'count_as_legibility_error', resolution, deductionPoints,
  }
}

function payload(items: Record<string, unknown>[] = [issue()], score = 1): Record<string, unknown> {
  return {
    transcript: 'A cat rested. I realized it. We went home.', recognitionWarnings: [], printedTextExcluded: true,
    reportedTotalScore: Math.round(18 + score),
    dimensionScores: [
      { dimensionId: 'content', score: 18, reason: 'Complete.', evidence: 'A cat rested.', relatedIssueKeys: [] },
      { dimensionId: 'legibility', score, reason: 'Synthetic reading assessment.', evidence: String(items[0]?.transcriptText ?? 'A cat rested.'), relatedIssueKeys: items.map(({ issueKey }) => issueKey) },
    ],
    issues: [], sentenceRevisions: [], expressionUpgrades: [],
    fullTextRevision: { sentencePairs: [], logicNotes: [], logicIssues: [] },
    legibilityIssues: items, overallComment: 'A complete account.',
  }
}

function normalize(value: Record<string, unknown>) {
  const result = normalizeMultimodalResult(value, context)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.diagnosticCode)
  return result.result
}

describe('structured legibility resolution', () => {
  it('silently removes a resolved reading and restores its entire legibility deduction', () => {
    const result = normalize(payload())
    expect(result.status).toBe('success')
    expect(result.totalScore).toBe(20)
    expect(result.dimensionScores[1]).toMatchObject({ score: 2 })
    expect(result.legibilityIssues).toEqual([])
    expect(result.reviewReasons).toEqual([])
    expect(result.recognitionWarnings).toEqual([])
  })

  it('removes only resolved deductions in a mixed assessment', () => {
    const result = normalize(payload([issue(), issue('legibility-unresolved', 'went', 'unresolved', 0.5)], 0.5))
    expect(result.status).toBe('success')
    expect(result.dimensionScores[1].score).toBe(1.5)
    expect(result.totalScore).toBe(19)
    expect(result.legibilityIssues).toEqual([expect.objectContaining({ transcriptText: 'went' })])
    expect(result.dimensionScores[1].evidence).toBe('went')
  })

  it('caps the sum of genuine unresolved deductions at the dimension maximum', () => {
    const result = normalize(payload([issue('legibility-one', 'realized', 'unresolved', 1.5), issue('legibility-two', 'went', 'unresolved', 1.5)], 0))
    expect(result.dimensionScores[1].score).toBe(0)
    expect(result.legibilityIssues).toHaveLength(2)
    expect(result.totalScore).toBe(18)
  })

  it('cleans resolved-only linked edits, warnings, and feedback without a fake partial', () => {
    const value = payload()
    value.recognitionWarnings = [{ scope: 'global_unreadable', message: 'Check the reading realized.' }]
    value.overallComment = 'Check the reading realized.'
    value.sentenceRevisions = [{ originalText: 'realized', revisedText: 'redized', note: 'Check realized.', relatedIssueKeys: ['legibility-resolved'], changeTypes: ['spelling'] }]
    value.expressionUpgrades = [{ originalText: 'realized', upgradedText: 'redized', note: 'Check realized.' }]
    value.fullTextRevision = {
      sentencePairs: [{ originalText: 'realized', correctedText: 'redized', improvedText: 'redized', explanation: 'Check realized.', relatedIssueKeys: ['legibility-resolved'], changeTypes: ['spelling'], requiresTeacherReview: false }],
      logicNotes: [{ quote: 'realized', note: 'Check realized.' }], logicIssues: [],
    }
    const result = normalize(value)
    expect(result.status).toBe('success')
    expect(result.sentenceRevisions).toEqual([])
    expect(result.expressionUpgrades).toEqual([])
    expect(result.fullTextRevision?.sentencePairs).toEqual([])
    expect(result.fullTextRevision?.correctedText).toBe(value.transcript)
    expect(result.recognitionWarnings).toEqual([])
    expect(result.overallComment).not.toContain('Check')
  })

  const languageCases = [
    { type: 'grammar', original: 'He realize it.', corrected: 'He realizes it.', word: 'realize', readings: ['realize', 'reolize'], explanation: 'The third-person singular subject requires a singular present-tense verb.' },
    { type: 'word_choice', original: 'I had a strange filling.', corrected: 'I had a strange feeling.', word: 'filling', readings: ['filling', 'filing'], explanation: 'The intended meaning is an emotional sensation, not material used to fill a gap.' },
  ] as const

  function languagePayload(sample: typeof languageCases[number]) {
    const transcript = `A cat rested. ${sample.original}`
    const value = {
      ...payload([], 2), transcript, reportedTotalScore: 19,
      dimensionScores: [
        { dimensionId: 'content', score: 17, reason: sample.explanation, evidence: sample.original, relatedIssueKeys: ['language-one'] },
        { dimensionId: 'legibility', score: 2, reason: 'Readable.', evidence: 'A cat rested.', relatedIssueKeys: [] },
      ],
      issues: [{ issueKey: 'language-one', type: sample.type, severity: 'medium', originalText: sample.original, suggestion: sample.corrected, explanation: sample.explanation, evidenceCertainty: 'certain', requiresTeacherReview: false }] as Array<Record<string, unknown>>,
      sentenceRevisions: [{ originalText: sample.original, revisedText: sample.corrected, note: sample.explanation, relatedIssueKeys: ['language-one'], changeTypes: [sample.type] }],
      fullTextRevision: {
        sentencePairs: [{ originalText: sample.original, correctedText: sample.corrected, improvedText: sample.corrected, explanation: sample.explanation, relatedIssueKeys: ['language-one'], changeTypes: [sample.type], requiresTeacherReview: false }],
        logicNotes: [], logicIssues: [],
      },
      legibilityIssues: [{ ...issue('legibility-resolved', sample.word), possibleReadings: [...sample.readings] as string[] }],
    }
    return value
  }

  it.each(languageCases)('preserves an independent $type correction after the letters have been resolved', (sample) => {
    const result = normalize(languagePayload(sample))
    expect(result.status).toBe('success')
    expect(result.totalScore).toBe(19)
    expect(result.dimensionScores.map(({ score }) => score)).toEqual([17, 2])
    expect(result.issues).toEqual([expect.objectContaining({ type: sample.type, originalText: sample.original, suggestion: sample.corrected })])
    expect(result.sentenceRevisions).toEqual([expect.objectContaining({ originalText: sample.original, revisedText: sample.corrected })])
    expect(result.fullTextRevision?.sentencePairs).toEqual([expect.objectContaining({ originalText: sample.original, correctedText: sample.corrected })])
    expect(result.fullTextRevision?.correctedText).toBe(`A cat rested. ${sample.corrected}`)
    expect(result.legibilityIssues).toEqual([])
    expect(result.reviewReasons).toEqual([])
  })

  it.each(languageCases)('keeps the original uncertain-spelling guard for a claimed certain $type correction', (sample) => {
    const value = languagePayload(sample)
    value.issues.push({ issueKey: 'spelling-uncertain', type: 'spelling', severity: 'low', originalText: sample.word, suggestion: sample.corrected, explanation: 'An unresolved visual reading.', evidenceCertainty: 'uncertain', requiresTeacherReview: true })
    const result = normalize(value)
    expect(result.status).toBe('partial')
    expect(result.totalScore).toBe(19)
    expect(result.issues).toEqual([])
    expect(result.sentenceRevisions).toEqual([])
    expect(result.fullTextRevision?.sentencePairs).toEqual([])
    expect(result.fullTextRevision?.correctedText).toBe(`A cat rested. ${sample.original}`)
  })

  it.each(languageCases)('does not disguise a rejected visual reading as a certain $type correction', (sample) => {
    const value = languagePayload(sample)
    value.legibilityIssues[0].possibleReadings = [sample.word, sample.type === 'grammar' ? 'realizes' : 'feeling']
    const result = normalize(value)
    expect(result.status).toBe('partial')
    expect(result.totalScore).toBe(19)
    expect(result.issues).toEqual([])
    expect(result.sentenceRevisions).toEqual([])
    expect(result.fullTextRevision?.sentencePairs).toEqual([])
    expect(result.fullTextRevision?.correctedText).toBe(`A cat rested. ${sample.original}`)
  })

  it.each([
    ['missing deduction', { resolution: 'resolved_correct', deductionPoints: undefined }],
    ['invalid resolution', { resolution: 'maybe', deductionPoints: 0 }],
    ['negative deduction', { resolution: 'resolved_correct', deductionPoints: -1 }],
    ['positive resolved deduction', { resolution: 'resolved_correct', deductionPoints: 1 }],
    ['nonfinite deduction', { resolution: 'resolved_correct', deductionPoints: Number.NaN }],
    ['zero unresolved deduction', { resolution: 'unresolved', deductionPoints: 0 }],
    ['unrepresentable unresolved deduction', { resolution: 'unresolved', deductionPoints: 0.001 }],
    ['overprecision unresolved deduction', { resolution: 'unresolved', deductionPoints: 0.014 }],
    ['oversized unresolved deduction', { resolution: 'unresolved', deductionPoints: 3 }],
  ])('does not invent full marks beside an invalid %s entry', (_label, fields) => {
    const value = payload([issue(), { ...issue('legibility-unknown', 'went'), ...fields }], 0.5)
    const result = normalize(value)
    expect(result.status).toBe('partial')
    expect(result.dimensionScores[1].score).toBe(0.5)
  })

  it.each(['duplicate key', 'same quote', 'ungrounded quote', 'invalid page'] as const)('preserves review and the core score for %s uncertainty', (kind) => {
    const other = issue('legibility-other', 'went', 'unresolved', 0.5)
    if (kind === 'duplicate key') other.issueKey = 'legibility-resolved'
    if (kind === 'same quote') other.transcriptText = 'realized'
    if (kind === 'ungrounded quote') other.transcriptText = 'absent'
    if (kind === 'invalid page') other.pageNumber = 2
    const result = normalize(payload([issue(), other], 0.5))
    expect(result.status).toBe('partial')
    expect(result.dimensionScores[1].score).toBe(0.5)
  })

  it('keeps legacy payload behavior when both new fields are absent', () => {
    const legacy = issue()
    delete legacy.resolution
    delete legacy.deductionPoints
    const result = normalize(payload([legacy]))
    expect(result.status).toBe('success')
    expect(result.dimensionScores[1].score).toBe(1)
    expect(result.legibilityIssues).toHaveLength(1)
  })

  it('does not treat a legacy sibling as a fully classified new assessment', () => {
    const legacy = issue('legibility-legacy', 'went')
    delete legacy.resolution
    delete legacy.deductionPoints
    const result = normalize(payload([issue(), legacy], 0.5))
    expect(result.status).toBe('partial')
    expect(result.dimensionScores[1].score).toBe(0.5)
    expect(result.legibilityIssues).toEqual([expect.objectContaining({ transcriptText: 'went' })])
  })

  it('retains genuine reported-total inconsistency after a policy adjustment', () => {
    const value = payload()
    value.reportedTotalScore = 12
    const result = normalize(value)
    expect(result.dimensionScores[1].score).toBe(2)
    expect(result.totalScore).toBe(20)
    expect(result.status).toBe('partial')
  })

  it('does not hide an unknown score link by rebuilding a resolved-only score', () => {
    const value = payload()
    ;(value.dimensionScores as Array<Record<string, unknown>>)[1].relatedIssueKeys = ['legibility-resolved', 'unknown-finding']
    const result = normalize(value)
    expect(result.status).toBe('partial')
    expect(result.dimensionScores[1].score).toBe(1)
  })

  it.each([
    ['unlinked unrelated evidence', [], 'went'],
    ['unlinked resolved evidence', [], 'realized'],
    ['linked unrelated evidence', ['legibility-resolved'], 'went'],
    ['linked whole-transcript evidence', ['legibility-resolved'], 'A cat rested. I realized it. We went home.'],
  ] as const)('preserves an existing deduction with %s instead of assuming it belongs to a resolved reading', (_label, links, evidence) => {
    const value = payload()
    ;(value.dimensionScores as Array<Record<string, unknown>>)[1] = {
      dimensionId: 'legibility', score: 1, reason: 'A different unreadable word needs review.', evidence, relatedIssueKeys: [...links],
    }
    const result = normalize(value)
    expect(result.dimensionScores[1].score).toBe(1)
    expect(result.totalScore).toBe(19)
    expect(result.status).toBe('partial')
    expect(result.dimensionScores[1].requiresTeacherReview).toBe(true)
  })

  it('restores a deduction with a precise quote contained in its linked resolved finding', () => {
    const value = payload([issue('legibility-resolved', 'I realized it.')])
    ;(value.dimensionScores as Array<Record<string, unknown>>)[1].evidence = 'realized'
    const result = normalize(value)
    expect(result.dimensionScores[1].score).toBe(2)
    expect(result.status).toBe('success')
  })

  it('still discloses incomplete attribution when only a legacy sibling is linked', () => {
    const legacy = issue('legibility-legacy', 'went')
    delete legacy.resolution
    delete legacy.deductionPoints
    const value = payload([issue(), legacy], 0.5)
    ;(value.dimensionScores as Array<Record<string, unknown>>)[1] = {
      dimensionId: 'legibility', score: 0.5, reason: 'Synthetic unresolved reading.', evidence: 'went', relatedIssueKeys: ['legibility-legacy'],
    }
    const result = normalize(value)
    expect(result.status).toBe('partial')
    expect(result.dimensionScores[1].score).toBe(0.5)
  })

  it('projects only the unchanged public v2 issue fields', async () => {
    // Exercise the browser boundary without adding its Bundler-only dependency
    // graph to the Gateway's NodeNext compilation unit.
    const projectionPath = new URL('../../../app/src/services/grading/projectGradingClientResponse.ts', import.meta.url).href
    const { projectGradingClientResponse } = await import(projectionPath)
    const value = payload([issue('legibility-unresolved', 'went', 'unresolved', 0.5)], 1.5)
    value.reportedTotalScore = 19
    const result = normalize(value)
    expect(result.legibilityIssues).toHaveLength(1)
    expect(Object.keys(result.legibilityIssues[0]).sort()).toEqual(['defaultOutcome', 'explanation', 'id', 'pageNumber', 'possibleReadings', 'regionDescription', 'transcriptText'])
    expect(projectGradingClientResponse(result, { httpOk: true, requestId: context.requestId, essayId: context.essayId, requireMultimodal: true, pageCount: 1, inputMode: 'images', task: context.task })).toMatchObject({ resultVersion: 'grading-result-v2', status: 'success' })
  })
})
