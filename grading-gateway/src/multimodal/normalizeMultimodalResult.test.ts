import { describe, expect, it } from 'vitest'
import { normalizeMultimodalResult } from './normalizeMultimodalResult.js'

const task = {
  taskId: 'task-normalize', fullScore: 15,
  materialSummary: 'Write an English response.', writingRequirements: ['Address the scenario.'], constraints: ['Use English.'],
  rubric: {
    taskName: 'Synthetic task', materialSummary: 'Write an English response.', writingRequirements: ['Address the scenario.'], constraints: ['Use English.'],
    dimensions: [
      { id: 'content', name: 'Content', weight: 40, description: 'Relevant.', deductionFocus: [], sourceEvidence: [] },
      { id: 'language', name: 'Language', weight: 60, description: 'Accurate.', deductionFocus: [], sourceEvidence: [] },
    ], reviewWarnings: [],
  },
}

const context = { requestId: 'request-normalize', essayId: 'essay-normalize', task, provider: 'remote' as const, createdAt: '2026-08-02T00:00:00.000Z' }

function validPayload(): Record<string, unknown> {
  return {
    transcript: 'I has a pen.\nIt are blue.', transcriptionWarnings: [], printedTextExcluded: true,
    reportedTotalScore: 12,
    dimensionScores: [
      { dimensionId: 'content', score: 4.8, reason: 'Relevant.', evidence: 'I has a pen.' },
      { dimensionId: 'language', score: 7.2, reason: 'Grammar needs review.', evidence: 'It are blue.' },
    ],
    issues: [{ type: 'grammar', severity: 'medium', originalText: 'It are blue.', suggestion: 'It is blue.', explanation: 'Agreement.', requiresTeacherReview: false }],
    sentenceRevisions: [], expressionUpgrades: [],
    fullTextRevision: { correctedText: 'I have a pen.\nIt is blue.', improvedText: 'I have a blue pen.', sentencePairs: [], logicNotes: [] },
    overallComment: 'A clear synthetic response.', reviewReasons: [],
  }
}

describe('normalizeMultimodalResult', () => {
  it('returns the faithful student transcript and rubric-derived weighted scores', () => {
    const normalized = normalizeMultimodalResult(validPayload(), context)
    expect(normalized.ok).toBe(true)
    if (!normalized.ok) throw new Error(normalized.error.message)
    expect(normalized.result).toMatchObject({ transcript: 'I has a pen.\nIt are blue.', printedTextExcluded: true, totalScore: 12, maxScore: 15, status: 'success' })
    expect(normalized.result.dimensionScores.map(({ maxScore }) => maxScore)).toEqual([6, 9])
  })

  it('marks transcription uncertainty as partial with a stable reason', () => {
    const payload = validPayload()
    payload.transcriptionWarnings = ['A word is unclear.']
    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized.ok).toBe(true)
    if (!normalized.ok) throw new Error(normalized.error.message)
    expect(normalized.result.status).toBe('partial')
    expect(normalized.result.reviewReasons).toContain('transcription_uncertain')
  })

  it('marks an uncertain printed-text exclusion or evidence boundary for teacher review', () => {
    const payload = validPayload()
    payload.printedTextExcluded = false
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].evidence = 'Printed heading.'
    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized.ok).toBe(true)
    if (!normalized.ok) throw new Error(normalized.error.message)
    expect(normalized.result.printedTextExcluded).toBe(false)
    expect(normalized.result.reviewReasons).toEqual(expect.arrayContaining(['printed_text_exclusion_uncertain', 'dimension_evidence_unmatched']))
    expect(normalized.result.status).toBe('partial')
  })

  it('keeps an unmatched issue for teacher review without inventing a transcript match', () => {
    const payload = validPayload()
    ;(payload.issues as Array<Record<string, unknown>>)[0].originalText = 'Invented quote.'
    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized.ok).toBe(true)
    if (!normalized.ok) throw new Error(normalized.error.message)
    expect(normalized.result.issues).toMatchObject([{ originalText: 'Invented quote.', requiresTeacherReview: true }])
    expect(normalized.result.reviewReasons).toContain('issue_quote_unmatched')
  })

  it.each([
    ['duplicate issue', (payload: Record<string, unknown>) => (payload.issues as Array<Record<string, unknown>>).push({ ...(payload.issues as Array<Record<string, unknown>>)[0] })],
    ['missing dimension', (payload: Record<string, unknown>) => (payload.dimensionScores as Array<Record<string, unknown>>).pop()],
    ['out-of-bounds score', (payload: Record<string, unknown>) => { (payload.dimensionScores as Array<Record<string, unknown>>)[0].score = 6.01 }],
  ] as const)('rejects %s', (_label, mutate) => {
    const payload = validPayload()
    mutate(payload)
    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
  })

  it('rejects an invalid transcript and never exposes raw model data in failures', () => {
    const payload = validPayload()
    payload.transcript = '  '
    payload.raw = 'SECRET-RAW'
    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
    expect(JSON.stringify(normalized)).not.toMatch(/SECRET-RAW|I has a pen/)
  })
})
