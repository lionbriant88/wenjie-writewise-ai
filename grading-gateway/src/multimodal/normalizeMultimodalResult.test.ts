import { describe, expect, it } from 'vitest'
import { normalizeMultimodalResult } from './normalizeMultimodalResult.js'

const task = {
  taskId: 'task-normalize', fullScore: 15,
  materialSummary: 'Write an English response.', writingRequirements: ['Address the scenario.'], constraints: ['Use English.'],
  rubric: {
    taskName: 'Synthetic task', materialSummary: 'Write an English response.', writingRequirements: ['Address the scenario.'], constraints: ['Use English.'],
    dimensions: [
      { id: 'content', name: 'Content', weight: 40, description: 'Relevant.', deductionFocus: [], sourceEvidence: [] },
      { id: 'language', name: 'Language', weight: 55, description: 'Accurate.', deductionFocus: [], sourceEvidence: [] },
      { id: 'legibility', name: 'Legibility', weight: 5, description: 'Handles important handwriting ambiguity.', deductionFocus: [], sourceEvidence: [] },
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
      { dimensionId: 'language', score: 6.45, reason: 'Grammar needs review.', evidence: 'It are blue.' },
      { dimensionId: 'legibility', score: 0.75, reason: 'Handwriting is legible.', evidence: 'I has a pen.' },
    ],
    issues: [{ type: 'grammar', severity: 'medium', originalText: 'It are blue.', suggestion: 'It is blue.', explanation: 'Agreement.', requiresTeacherReview: false }],
    sentenceRevisions: [], expressionUpgrades: [],
    fullTextRevision: { correctedText: 'I have a pen.\nIt is blue.', improvedText: 'I have a blue pen.', sentencePairs: [], logicNotes: [{ quote: 'I has a pen.', note: 'The opening subject-verb agreement weakens clarity.' }] },
    overallComment: 'A clear synthetic response.', reviewReasons: [],
  }
}

describe('normalizeMultimodalResult', () => {
  it('returns the faithful student transcript and rubric-derived weighted scores', () => {
    const normalized = normalizeMultimodalResult(validPayload(), context)
    expect(normalized.ok).toBe(true)
    if (!normalized.ok) throw new Error(normalized.error.message)
    expect(normalized.result).toMatchObject({ transcript: 'I has a pen.\nIt are blue.', printedTextExcluded: true, totalScore: 12, maxScore: 15, status: 'success' })
    expect(normalized.result.dimensionScores.map(({ maxScore }) => maxScore)).toEqual([6, 8.25, 0.75])
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

  it('keeps only logic diagnostics whose quotes are grounded in the transcript', () => {
    const payload = validPayload()
    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: { fullTextRevision: { logicNotes: ['The opening subject-verb agreement weakens clarity.'] } },
    })
  })

  it('removes an ungrounded logic diagnostic and flags it for teacher review', () => {
    const payload = validPayload()
    ;((payload.fullTextRevision as Record<string, unknown>).logicNotes as Array<Record<string, unknown>>)[0].quote = 'Invented logic quote.'
    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: { fullTextRevision: { logicNotes: [] }, reviewReasons: expect.arrayContaining(['logic_note_quote_unmatched']), status: 'partial' },
    })
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

  it('keeps every structurally valid ungrounded citation for explicit teacher review', () => {
    const payload = validPayload()
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].evidence = 'Invented dimension evidence.'
    ;(payload.issues as Array<Record<string, unknown>>)[0].originalText = 'Invented issue quote.'
    payload.sentenceRevisions = [{ originalText: 'Invented revision quote.', revisedText: 'Revised.', note: 'Check.' }]
    payload.expressionUpgrades = [{ originalText: 'Invented upgrade quote.', upgradedText: 'Upgraded.', note: 'Check.' }]
    ;((payload.fullTextRevision as Record<string, unknown>).sentencePairs as Array<Record<string, unknown>>).push({
      originalText: 'Invented pair quote.', correctedText: 'Corrected.', improvedText: 'Improved.', changeTypes: ['grammar'], explanation: 'Check.', requiresTeacherReview: false,
    })
    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized.ok).toBe(true)
    if (!normalized.ok) throw new Error(normalized.error.message)
    expect(normalized.result.dimensionScores[0]).toMatchObject({ evidence: 'Invented dimension evidence.', requiresTeacherReview: true })
    expect(normalized.result.issues).toMatchObject([{ originalText: 'Invented issue quote.', requiresTeacherReview: true }])
    expect(normalized.result.sentenceRevisions).toMatchObject([{ originalText: 'Invented revision quote.', requiresTeacherReview: true }])
    expect(normalized.result.expressionUpgrades).toMatchObject([{ originalText: 'Invented upgrade quote.', requiresTeacherReview: true }])
    expect(normalized.result.fullTextRevision?.sentencePairs).toMatchObject([{ originalText: 'Invented pair quote.', requiresTeacherReview: true }])
    expect(normalized.result.reviewReasons).toEqual(expect.arrayContaining([
      'dimension_evidence_unmatched', 'issue_quote_unmatched', 'sentence_revision_quote_unmatched', 'expression_upgrade_quote_unmatched', 'sentence_pair_quote_unmatched',
    ]))
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
    ['out-of-bounds score', (payload: Record<string, unknown>) => { (payload.dimensionScores as Array<Record<string, unknown>>)[0].score = 6.004 }],
  ] as const)('rejects %s', (_label, mutate) => {
    const payload = validPayload()
    mutate(payload)
    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
  })

  it('accepts a raw dimension score exactly at its weighted maximum before rounding', () => {
    const payload = validPayload()
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].score = 6
    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized.ok).toBe(true)
    if (normalized.ok) expect(normalized.result.dimensionScores[0].score).toBe(6)
  })

  it('rejects an invalid transcript and never exposes raw model data in failures', () => {
    const payload = validPayload()
    payload.transcript = '  '
    payload.raw = 'SECRET-RAW'
    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
    expect(JSON.stringify(normalized)).not.toMatch(/SECRET-RAW|I has a pen/)
  })

  it('requires the model transcript to exactly equal the teacher-confirmed text', () => {
    const teacherText = ' Teacher corrected transcript. '
    const payload = validPayload()
    payload.transcript = teacherText
    const accepted = normalizeMultimodalResult(payload, { ...context, confirmedTranscript: teacherText })
    expect(accepted).toMatchObject({ ok: true, result: { transcript: teacherText } })

    const rejectedPayload = validPayload()
    rejectedPayload.transcript = 'MODEL-DIFFERENT'
    const rejected = normalizeMultimodalResult(rejectedPayload, { ...context, confirmedTranscript: teacherText })
    expect(rejected).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
    expect(JSON.stringify(rejected)).not.toContain('MODEL-DIFFERENT')
    expect(JSON.stringify(rejected)).not.toContain(teacherText)
  })
})
