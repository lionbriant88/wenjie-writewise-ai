import { describe, expect, it } from 'vitest'
import { normalizeMultimodalResult } from './normalizeMultimodalResult.js'
import type { MultimodalGradingResult } from './normalizeMultimodalResult.js'
import type { AiGradingResultV1, EvidenceCertainty, LegibilityIssueV1, LogicIssueV1, RawMultimodalIssueV1 } from '../types.js'

type HasLegacyTranscriptionWarnings = 'transcriptionWarnings' extends keyof MultimodalGradingResult ? true : false
type HasRootLogicIssueProjection = 'logicIssues' extends keyof AiGradingResultV1 ? true : false
const noLegacyTranscriptionWarnings: HasLegacyTranscriptionWarnings = false
const noRootLogicIssueProjection: HasRootLogicIssueProjection = false
void noLegacyTranscriptionWarnings
void noRootLogicIssueProjection

const evidenceCertainty: EvidenceCertainty = 'uncertain'
const rawIssue: RawMultimodalIssueV1 = {
  issueKey: 'issue-1', type: 'grammar', severity: 'low', originalText: 'I has',
  suggestion: 'I have', explanation: 'Agreement.', evidenceCertainty, requiresTeacherReview: false,
}
const logicIssue: LogicIssueV1 = {
  id: 'logic-1', originalText: 'Then it happened.', contextBefore: 'I waited.', contextAfter: 'We went home.',
  subType: 'unclear_transition', severity: 'medium', diagnosis: 'The connection is unclear.',
  suggestedAction: 'add_bridge_sentence', conservativeSuggestion: 'Explain what changed.',
  polishedSuggestion: 'Add a sentence explaining the change.', requiresTeacherReview: false,
}
const legibilityIssue: LegibilityIssueV1 = {
  id: 'legibility-1', transcriptText: 'went', possibleReadings: ['went', 'want'], pageNumber: 1,
  regionDescription: 'line 2', explanation: 'Two readings are plausible.', defaultOutcome: 'count_as_legibility_error',
}
void rawIssue
void logicIssue
void legibilityIssue

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
    transcript: 'I has a pen.\nIt are blue.', recognitionWarnings: [], printedTextExcluded: true,
    reportedTotalScore: 12,
    dimensionScores: [
      { dimensionId: 'content', score: 4.8, reason: 'Relevant.', evidence: 'I has a pen.' },
      { dimensionId: 'language', score: 6.45, reason: 'Grammar needs review.', evidence: 'It are blue.' },
      { dimensionId: 'legibility', score: 0.75, reason: 'Handwriting is legible.', evidence: 'I has a pen.' },
    ],
    issues: [{ issueKey: 'grammar-blue', type: 'grammar', severity: 'medium', originalText: 'It are blue.', suggestion: 'It is blue.', explanation: 'Agreement.', evidenceCertainty: 'certain', requiresTeacherReview: false }],
    sentenceRevisions: [], expressionUpgrades: [],
    fullTextRevision: { correctedText: 'I have a pen.\nIt is blue.', improvedText: 'I have a blue pen.', sentencePairs: [], logicNotes: [{ quote: 'I has a pen.', note: 'The opening subject-verb agreement weakens clarity.' }], logicIssues: [] },
    legibilityIssues: [],
    overallComment: 'A clear synthetic response.', reviewReasons: [],
  }
}

describe('normalizeMultimodalResult', () => {
  it('accepts recognition warnings and exposes recognition uncertainty without accepting the legacy field', () => {
    const payload = validPayload()
    payload.recognitionWarnings = ['A word is unclear.']

    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({
      ok: true,
      result: {
        recognitionWarnings: ['A word is unclear.'],
        reviewReasons: expect.arrayContaining(['recognition_uncertain']),
        status: 'partial',
      },
    })

    const legacyPayload = validPayload()
    delete legacyPayload.recognitionWarnings
    legacyPayload.transcriptionWarnings = ['A word is unclear.']
    const legacy = normalizeMultimodalResult(legacyPayload, context)
    expect(legacy).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
  })

  it('returns the faithful student transcript and rubric-derived weighted scores', () => {
    const normalized = normalizeMultimodalResult(validPayload(), context)
    expect(normalized.ok).toBe(true)
    if (!normalized.ok) throw new Error(normalized.error.message)
    expect(normalized.result).toMatchObject({ transcript: 'I has a pen.\nIt are blue.', printedTextExcluded: true, totalScore: 12, maxScore: 15, status: 'success' })
    expect(normalized.result.dimensionScores.map(({ maxScore }) => maxScore)).toEqual([6, 8.25, 0.75])
  })

  it('marks recognition uncertainty as partial with a stable reason', () => {
    const payload = validPayload()
    payload.recognitionWarnings = ['A word is unclear.']
    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized.ok).toBe(true)
    if (!normalized.ok) throw new Error(normalized.error.message)
    expect(normalized.result.status).toBe('partial')
    expect(normalized.result.reviewReasons).toContain('recognition_uncertain')
  })

  it('silently removes uncertain spelling and rebuilds corrected text from kept pairs', () => {
    const payload = validPayload()
    payload.issues = [{
      issueKey: 'spelling-has', type: 'spelling', severity: 'low', originalText: 'has', suggestion: 'have',
      explanation: 'The letter shape is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    }]
    payload.sentenceRevisions = [{
      originalText: 'I has a pen.', revisedText: 'I have a pen.', note: 'Correct the uncertain spelling.',
      relatedIssueKeys: ['spelling-has'], changeTypes: ['spelling'],
    }]
    ;((payload.fullTextRevision as Record<string, unknown>).sentencePairs as Array<Record<string, unknown>>).push({
      originalText: 'I has a pen.', correctedText: 'I have a pen.', improvedText: 'I have a blue pen.',
      relatedIssueKeys: ['spelling-has'], changeTypes: ['spelling'], explanation: 'Correct the uncertain spelling.', requiresTeacherReview: false,
    })

    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'success', issues: [], sentenceRevisions: [], reviewReasons: [],
        fullTextRevision: { correctedText: 'I has a pen.\nIt are blue.', sentencePairs: [] },
      },
    })
  })

  it('keeps only logic diagnostics whose quotes are grounded in the transcript', () => {
    const payload = validPayload()
    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: { fullTextRevision: { logicNotes: ['The opening subject-verb agreement weakens clarity.'] } },
    })
  })

  it('isolates a logic note whose quote overlaps a legibility issue', () => {
    const payload = validPayload()
    payload.legibilityIssues = [{
      issueKey: 'legibility-opening', transcriptText: 'I has a pen.', possibleReadings: ['I has a pen.', 'I have a pen.'],
      pageNumber: 1, regionDescription: 'line 1', explanation: 'The verb ending is unclear.', defaultOutcome: 'count_as_legibility_error',
    }]

    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({ ok: true, result: { fullTextRevision: { logicNotes: [] } } })
  })

  it('rejects an ungrounded logic diagnostic instead of guessing its source', () => {
    const payload = validPayload()
    ;((payload.fullTextRevision as Record<string, unknown>).logicNotes as Array<Record<string, unknown>>)[0].quote = 'Invented logic quote.'
    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
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

  it('rejects ungrounded citations instead of retaining unsafe projections', () => {
    const payload = validPayload()
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].evidence = 'Invented dimension evidence.'
    ;(payload.issues as Array<Record<string, unknown>>)[0].originalText = 'Invented issue quote.'
    payload.sentenceRevisions = [{ originalText: 'Invented revision quote.', revisedText: 'Revised.', note: 'Check.' }]
    payload.expressionUpgrades = [{ originalText: 'Invented upgrade quote.', upgradedText: 'Upgraded.', note: 'Check.' }]
    ;((payload.fullTextRevision as Record<string, unknown>).sentencePairs as Array<Record<string, unknown>>).push({
      originalText: 'Invented pair quote.', correctedText: 'Corrected.', improvedText: 'Improved.', changeTypes: ['grammar'], explanation: 'Check.', requiresTeacherReview: false,
    })
    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
  })

  it('rejects an unmatched issue without inventing a transcript match', () => {
    const payload = validPayload()
    ;(payload.issues as Array<Record<string, unknown>>)[0].originalText = 'Invented quote.'
    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
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
    const teacherText = ' I has a pen.\nIt are blue. '
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
