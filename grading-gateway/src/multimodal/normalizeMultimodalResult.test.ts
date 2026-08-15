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

const context = { requestId: 'request-normalize', essayId: 'essay-normalize', task, provider: 'remote' as const, pageCount: 1, createdAt: '2026-08-02T00:00:00.000Z' }

function validPayload(): Record<string, unknown> {
  return {
    transcript: 'I has a pen.\nIt are blue.', recognitionWarnings: [], printedTextExcluded: true,
    reportedTotalScore: 12,
    dimensionScores: [
      { dimensionId: 'content', score: 4.8, reason: 'Relevant.', evidence: 'I has a pen.', relatedIssueKeys: ['grammar-blue'] },
      { dimensionId: 'language', score: 6.45, reason: 'Grammar needs review.', evidence: 'It are blue.', relatedIssueKeys: ['grammar-blue'] },
      { dimensionId: 'legibility', score: 0.75, reason: 'Handwriting is legible.', evidence: 'I has a pen.', relatedIssueKeys: [] },
    ],
    issues: [{ issueKey: 'grammar-blue', type: 'grammar', severity: 'medium', originalText: 'It are blue.', suggestion: 'It is blue.', explanation: 'Agreement.', evidenceCertainty: 'certain', requiresTeacherReview: false }],
    sentenceRevisions: [], expressionUpgrades: [],
    fullTextRevision: { correctedText: 'I have a pen.\nIt is blue.', improvedText: 'I have a blue pen.', sentencePairs: [], logicNotes: [{ quote: 'I has a pen.', note: 'The opening subject-verb agreement weakens clarity.' }], logicIssues: [] },
    legibilityIssues: [],
    overallComment: 'A clear synthetic response.', reviewReasons: [],
  }
}

function payloadWithLogicIssue(): Record<string, unknown> {
  const payload = validPayload()
  payload.transcript = 'Before the party. My cat is blue. After the party.'
  payload.issues = []
  payload.dimensionScores = (payload.dimensionScores as Array<Record<string, unknown>>).map((score) => ({
    ...score,
    evidence: 'My cat is blue.',
    relatedIssueKeys: score.dimensionId === 'legibility' ? [] : ['logic-cat'],
  }))
  payload.fullTextRevision = {
    correctedText: 'Before the party. My cat is blue. After the party.',
    improvedText: 'Before the party. My cat is blue. After the party.',
    sentencePairs: [],
    logicNotes: [],
    logicIssues: [{
      issueKey: 'logic-cat', originalText: 'My cat is blue.', contextBefore: 'Before the party.', contextAfter: 'After the party.',
      subType: 'irrelevant_sentence', severity: 'medium', diagnosis: 'The sentence does not support the event.',
      suggestedAction: 'delete_sentence', conservativeSuggestion: 'Remove the sentence.', polishedSuggestion: 'Delete the unrelated sentence.',
      requiresTeacherReview: false,
    }],
  }
  return payload
}

function payloadWithLogicContext(transcript: string, contextBefore: string, contextAfter: string): Record<string, unknown> {
  const payload = payloadWithLogicIssue()
  payload.transcript = transcript
  payload.dimensionScores = (payload.dimensionScores as Array<Record<string, unknown>>).map((score) => ({ ...score, evidence: 'My cat is blue.' }))
  ;(payload.fullTextRevision as Record<string, unknown>).correctedText = transcript
  ;(payload.fullTextRevision as Record<string, unknown>).improvedText = transcript
  const issue = ((payload.fullTextRevision as Record<string, unknown>).logicIssues as Array<Record<string, unknown>>)[0]
  issue.contextBefore = contextBefore
  issue.contextAfter = contextAfter
  return payload
}

function payloadWithCantAmbiguity(): Record<string, unknown> {
  const payload = validPayload()
  ;(payload.issues as Array<Record<string, unknown>>).push({
    issueKey: 'spelling-blue', type: 'spelling', severity: 'medium', originalText: 'It are blue.', suggestion: 'It is blue.',
    explanation: 'The letters are unclear.', evidenceCertainty: 'certain', requiresTeacherReview: false,
  })
  ;(payload.dimensionScores as Array<Record<string, unknown>>)[1].evidence = 'I has a pen.'
  ;(payload.dimensionScores as Array<Record<string, unknown>>)[2].evidence = 'It are blue.'
  ;(payload.fullTextRevision as Record<string, unknown>).logicIssues = [{
    issueKey: 'logic-blue', originalText: 'It are blue.', contextBefore: 'I has a pen.', contextAfter: '',
    subType: 'irrelevant_sentence', severity: 'medium', diagnosis: 'The sentence is irrelevant.',
    suggestedAction: 'delete_sentence', conservativeSuggestion: 'Remove the sentence.', polishedSuggestion: 'Delete the unrelated sentence.',
    requiresTeacherReview: false,
  }]
  payload.legibilityIssues = [{
    issueKey: 'legibility-blue', transcriptText: 'It are blue.', possibleReadings: ['It are blue.', 'It is blue.'],
    pageNumber: 1, regionDescription: 'line 2', explanation: 'The final verb form is unclear.', defaultOutcome: 'count_as_legibility_error',
  }]
  payload.dimensionScores = [
    { dimensionId: 'content', score: 6, reason: 'Complete.', evidence: 'I has a pen.', relatedIssueKeys: [] },
    { dimensionId: 'language', score: 8.25, reason: 'No language deduction.', evidence: 'I has a pen.', relatedIssueKeys: [] },
    { dimensionId: 'legibility', score: 0.25, reason: 'The verb form is unclear.', evidence: 'It are blue.', relatedIssueKeys: ['legibility-blue'] },
  ]
  payload.reportedTotalScore = 15
  return payload
}

describe('normalizeMultimodalResult', () => {
  it('rejects raw quote whitespace drift in multimodal issue, revision, pair, logic, note, and legibility fields', () => {
    for (const mutate of [
      (payload: Record<string, unknown>) => { ;(payload.issues as Array<Record<string, unknown>>)[0].originalText = 'It  are blue.' },
      (payload: Record<string, unknown>) => { ;(payload.sentenceRevisions as Array<Record<string, unknown>>)[0].originalText = 'It  are blue.' },
      (payload: Record<string, unknown>) => { ;((payload.fullTextRevision as Record<string, unknown>).sentencePairs as Array<Record<string, unknown>>)[0].originalText = 'It  are blue.' },
      (payload: Record<string, unknown>) => { ;(payload.fullTextRevision as Record<string, unknown>).logicIssues = [{ issueKey: 'logic', originalText: 'It  are blue.', contextBefore: 'I has a pen.', contextAfter: '', subType: 'unclear_logic', severity: 'low', diagnosis: 'Synthetic.', suggestedAction: 'add_bridge_sentence', conservativeSuggestion: 'Synthetic.', polishedSuggestion: 'Synthetic.', requiresTeacherReview: false }] },
      (payload: Record<string, unknown>) => { ;((payload.fullTextRevision as Record<string, unknown>).logicNotes as Array<Record<string, unknown>>)[0].quote = 'I  has a pen.' },
      (payload: Record<string, unknown>) => { payload.legibilityIssues = [{ issueKey: 'legibility', transcriptText: 'It  are blue.', possibleReadings: ['It are blue.', 'It is blue.'], pageNumber: 1, regionDescription: 'line', explanation: 'Synthetic.', defaultOutcome: 'count_as_legibility_error' }] },
    ]) { const payload = validPayload(); payload.sentenceRevisions = [{ originalText: 'It are blue.', revisedText: 'It is blue.', note: 'Synthetic.', relatedIssueKeys: ['grammar-blue'], changeTypes: ['grammar'] }]; (payload.fullTextRevision as Record<string, unknown>).sentencePairs = [{ originalText: 'It are blue.', correctedText: 'It is blue.', improvedText: 'It is blue.', relatedIssueKeys: ['grammar-blue'], changeTypes: ['grammar'], explanation: 'Synthetic.', requiresTeacherReview: false }]; mutate(payload); expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: false }) }
  })

  it('rejects invalid reported totals and blank improved text, and marks a finite mismatch partial', () => {
    const invalidTotal = validPayload(); invalidTotal.reportedTotalScore = '12'; expect(normalizeMultimodalResult(invalidTotal, context)).toMatchObject({ ok: false })
    const blankImproved = validPayload(); ;(blankImproved.fullTextRevision as Record<string, unknown>).improvedText = ' '; expect(normalizeMultimodalResult(blankImproved, context)).toMatchObject({ ok: true })
    const mismatch = validPayload(); mismatch.reportedTotalScore = 14; expect(normalizeMultimodalResult(mismatch, context)).toMatchObject({ ok: true, result: { status: 'partial', reviewReasons: expect.arrayContaining(['AI 自报总分与产品重算总分不一致。']) } })
  })

  it('rejects whitespace-only dimension evidence before shared public projection', () => {
    const payload = validPayload()
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].evidence = '   '
    expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: false })
  })

  it('keeps expression-upgrade quotes exact and rejects collapsed or duplicate source text', () => {
    const collapsed = validPayload()
    collapsed.expressionUpgrades = [{ originalText: 'I  has a pen.', upgradedText: 'I have a pen.', note: 'Synthetic.' }]
    expect(normalizeMultimodalResult(collapsed, context)).toMatchObject({ ok: false })

    const duplicate = validPayload()
    duplicate.transcript = 'Repeated source. Repeated source.'
    duplicate.issues = []
    duplicate.sentenceRevisions = []
    duplicate.expressionUpgrades = [{ originalText: 'Repeated source.', upgradedText: 'Improved source.', note: 'Synthetic.' }]
    duplicate.fullTextRevision = { correctedText: 'Repeated source. Repeated source.', improvedText: 'Improved.', sentencePairs: [], logicNotes: [], logicIssues: [] }
    expect(normalizeMultimodalResult(duplicate, context)).toMatchObject({ ok: false })

    const exact = validPayload()
    exact.expressionUpgrades = [{ originalText: 'I has a pen.', upgradedText: 'I have a pen.', note: 'Synthetic.' }]
    expect(normalizeMultimodalResult(exact, context)).toMatchObject({ ok: true, result: { expressionUpgrades: [{ originalText: 'I has a pen.' }] } })
  })
  it('projects a grounded structured logic issue into the full-text revision', () => {
    const normalized = normalizeMultimodalResult(payloadWithLogicIssue(), context)

    expect(normalized.ok && (normalized.result.fullTextRevision as unknown as { logicIssues?: unknown[] } | undefined)?.logicIssues?.[0]).toMatchObject({
      id: 'essay-normalize-logic-1', subType: 'irrelevant_sentence', originalText: 'My cat is blue.', suggestedAction: 'delete_sentence',
    })
  })

  it.each(['originalText', 'contextBefore', 'contextAfter'] as const)('rejects an ungrounded structured logic %s', (field) => {
    const payload = payloadWithLogicIssue()
    ;(((payload.fullTextRevision as Record<string, unknown>).logicIssues as Array<Record<string, unknown>>)[0])[field] = 'Invented logic source.'

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
  })

  it('accepts a first-sentence logic issue with no preceding context', () => {
    const normalized = normalizeMultimodalResult(
      payloadWithLogicContext('My cat is blue. After the party.', '', 'After the party.'),
      context,
    )

    expect(normalized).toMatchObject({ ok: true, result: { fullTextRevision: { logicIssues: [{ originalText: 'My cat is blue.', contextBefore: '', contextAfter: 'After the party.' }] } } })
  })

  it('accepts a final-sentence logic issue with no following context', () => {
    const normalized = normalizeMultimodalResult(
      payloadWithLogicContext('Before the party. My cat is blue.', 'Before the party.', ''),
      context,
    )

    expect(normalized).toMatchObject({ ok: true, result: { fullTextRevision: { logicIssues: [{ originalText: 'My cat is blue.', contextBefore: 'Before the party.', contextAfter: '' }] } } })
  })

  it('rejects a logic contextBefore that appears after the diagnosed text', () => {
    const payload = payloadWithLogicContext('My cat is blue. Before the party. After the party.', 'Before the party.', 'After the party.')

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
  })

  it('rejects a logic contextAfter that appears before the diagnosed text', () => {
    const payload = payloadWithLogicContext('Before the party. After the party. My cat is blue.', 'Before the party.', 'After the party.')

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
  })

  it('ignores a blank Provider corrected aggregate when structured logic can be safely projected', () => {
    const payload = payloadWithLogicIssue()
    ;(payload.fullTextRevision as Record<string, unknown>).correctedText = ''

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true, result: { fullTextRevision: { correctedText: payload.transcript, logicIssues: [{ originalText: 'My cat is blue.' }] } },
    })
  })

  it('keeps a local legibility ambiguity successful and isolates it from other deductions', () => {
    const normalized = normalizeMultimodalResult(payloadWithCantAmbiguity(), context)
    expect(normalized.ok).toBe(true)
    if (!normalized.ok) throw new Error(normalized.error.message)

    expect(normalized.result.status).toBe('success')
    expect(normalized.result.legibilityIssues).toMatchObject([{
      id: 'essay-normalize-legibility-1', possibleReadings: ['It are blue.', 'It is blue.'], defaultOutcome: 'count_as_legibility_error',
    }])
    expect(normalized.result.reviewReasons).not.toContain('recognition_uncertain')
    expect(normalized.result.issues).toEqual([])
    expect((normalized.result.fullTextRevision as unknown as { logicIssues?: unknown[] } | undefined)?.logicIssues).toEqual([])
    expect(normalized.result.dimensionScores.filter(({ evidence }) => evidence.includes('It are blue.')).map(({ dimensionId }) => dimensionId)).toEqual(['legibility'])
  })

  it('rejects a legibility location beyond the uploaded image pages', () => {
    const payload = payloadWithCantAmbiguity()
    ;(payload.legibilityIssues as Array<Record<string, unknown>>)[0].pageNumber = 2

    expect(normalizeMultimodalResult(payload, { ...context, pageCount: 1 })).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
  })

  it('rejects legibility findings during a confirmed-text regrade', () => {
    const payload = payloadWithCantAmbiguity()
    const transcript = payload.transcript as string

    expect(normalizeMultimodalResult(payload, { ...context, confirmedTranscript: transcript, pageCount: 0 })).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
  })

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
    payload.dimensionScores = (payload.dimensionScores as Array<Record<string, unknown>>).map((score) => ({
      ...score,
      score: score.dimensionId === 'content' ? 6 : score.dimensionId === 'language' ? 8.25 : 0.75,
      evidence: 'It are blue.', relatedIssueKeys: [],
    }))
    payload.reportedTotalScore = 15
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

  it('rejects a dimension deduction related to filtered uncertain spelling', () => {
    const payload = validPayload()
    payload.transcript = 'I wark today.'
    payload.issues = [{
      issueKey: 'spelling-wark', type: 'spelling', severity: 'low', originalText: 'wark', suggestion: 'work',
      explanation: 'The handwriting is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    }]
    payload.dimensionScores = [
      { dimensionId: 'content', score: 6, reason: 'Complete.', evidence: 'I wark today.', relatedIssueKeys: [] },
      { dimensionId: 'language', score: 7.25, reason: 'The spelling is uncertain.', evidence: 'wark', relatedIssueKeys: ['spelling-wark'] },
      { dimensionId: 'legibility', score: 0.75, reason: 'Legible.', evidence: 'I wark today.', relatedIssueKeys: [] },
    ]
    payload.reportedTotalScore = 14
    payload.sentenceRevisions = []
    payload.expressionUpgrades = []
    payload.fullTextRevision = { correctedText: 'I wark today.', improvedText: 'I wark today.', sentencePairs: [], logicNotes: [], logicIssues: [] }

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
  })

  it.each([
    ['original only', 'The form wark is uncertain.'],
    ['suggestion only', 'Do not infer work from unclear handwriting.'],
  ])('rejects filtered spelling leaked through a dimension reason: %s', (_label, reason) => {
    const payload = validPayload()
    payload.transcript = 'I wark today.'
    payload.issues = [{
      issueKey: 'spelling-wark', type: 'spelling', severity: 'low', originalText: 'wark', suggestion: 'work',
      explanation: 'The handwriting is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    }]
    payload.dimensionScores = [
      { dimensionId: 'content', score: 6, reason, evidence: 'I wark today.', relatedIssueKeys: [] },
      { dimensionId: 'language', score: 8.25, reason: 'No deduction.', evidence: 'I wark today.', relatedIssueKeys: [] },
      { dimensionId: 'legibility', score: 0.75, reason: 'Legible.', evidence: 'I wark today.', relatedIssueKeys: [] },
    ]
    payload.reportedTotalScore = 15
    payload.sentenceRevisions = []
    payload.expressionUpgrades = []
    payload.fullTextRevision = { correctedText: 'I wark today.', improvedText: 'I wark today.', sentencePairs: [], logicNotes: [], logicIssues: [] }

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
  })

  it('removes an expression upgrade overlapping filtered spelling and rebuilds both aggregates', () => {
    const payload = validPayload()
    payload.issues = [{
      issueKey: 'spelling-has', type: 'spelling', severity: 'low', originalText: 'has', suggestion: 'have',
      explanation: 'The handwriting is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    }]
    payload.dimensionScores = (payload.dimensionScores as Array<Record<string, unknown>>).map((score) => ({
      ...score, score: score.dimensionId === 'content' ? 6 : score.dimensionId === 'language' ? 8.25 : 0.75,
      evidence: 'It are blue.', relatedIssueKeys: [],
    }))
    payload.reportedTotalScore = 15
    payload.sentenceRevisions = []
    payload.expressionUpgrades = [{ originalText: 'I has a pen.', upgradedText: 'I have a fountain pen.', note: 'Upgrade.' }]
    payload.fullTextRevision = { correctedText: 'I have a pen.\nIt are blue.', improvedText: 'I have a fountain pen.\nIt are blue.', sentencePairs: [], logicNotes: [], logicIssues: [] }

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        issues: [], expressionUpgrades: [],
        fullTextRevision: { correctedText: 'I has a pen.\nIt are blue.', improvedText: 'I has a pen.\nIt are blue.', sentencePairs: [] },
      },
    })
  })

  it('filters every output whose exact range intersects a local legibility range', () => {
    const payload = validPayload()
    payload.transcript = 'I can come.'
    payload.issues = [{ issueKey: 'grammar-can', type: 'grammar', severity: 'medium', originalText: 'I can come.', suggestion: 'I could come.', explanation: 'Synthetic.', evidenceCertainty: 'certain', requiresTeacherReview: false }]
    payload.sentenceRevisions = [{ originalText: 'I can come.', revisedText: 'I could come.', note: 'Synthetic.', relatedIssueKeys: ['grammar-can'], changeTypes: ['grammar'] }]
    payload.expressionUpgrades = [{ originalText: 'I can come.', upgradedText: 'I would be delighted to come.', note: 'Synthetic.' }]
    payload.fullTextRevision = {
      correctedText: 'I could come.', improvedText: 'I would be delighted to come.',
      sentencePairs: [{ originalText: 'I can come.', correctedText: 'I could come.', improvedText: 'I would be delighted to come.', relatedIssueKeys: ['grammar-can'], changeTypes: ['grammar'], explanation: 'Synthetic.', requiresTeacherReview: false }],
      logicNotes: [{ quote: 'I can come.', note: 'Synthetic logic.' }],
      logicIssues: [{ issueKey: 'logic-can', originalText: 'I can come.', contextBefore: '', contextAfter: '', subType: 'unclear_logic', severity: 'low', diagnosis: 'Synthetic.', suggestedAction: 'ask_student_to_explain', conservativeSuggestion: 'Synthetic.', polishedSuggestion: 'Synthetic.', requiresTeacherReview: false }],
    }
    payload.legibilityIssues = [{ issueKey: 'legibility-can', transcriptText: 'can', possibleReadings: ['can', "can't"], pageNumber: 1, regionDescription: 'line 1', explanation: 'Synthetic.', defaultOutcome: 'count_as_legibility_error' }]
    payload.dimensionScores = [
      { dimensionId: 'content', score: 6, reason: 'Complete.', evidence: 'come.', relatedIssueKeys: [] },
      { dimensionId: 'language', score: 8.25, reason: 'No language deduction.', evidence: 'come.', relatedIssueKeys: [] },
      { dimensionId: 'legibility', score: 0.25, reason: 'The word is unclear.', evidence: 'can', relatedIssueKeys: ['legibility-can'] },
    ]
    payload.reportedTotalScore = 15

    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'success', issues: [], sentenceRevisions: [], expressionUpgrades: [], recognitionWarnings: [], reviewReasons: [],
        fullTextRevision: { correctedText: 'I can come.', improvedText: 'I can come.', sentencePairs: [], logicNotes: [], logicIssues: [] },
      },
    })
  })

  it.each([
    ['full legibility score', (scores: Array<Record<string, unknown>>) => { scores[2].score = 0.75; scores[2].relatedIssueKeys = [] }],
    ['legibility deduction without key', (scores: Array<Record<string, unknown>>) => { scores[2].relatedIssueKeys = [] }],
    ['non-legibility relation', (scores: Array<Record<string, unknown>>) => { scores[0].score = 5.5; scores[0].relatedIssueKeys = ['legibility-blue'] }],
  ] as const)('rejects invalid local legibility scoring: %s', (_label, mutate) => {
    const payload = payloadWithCantAmbiguity()
    const scores = payload.dimensionScores as Array<Record<string, unknown>>
    scores[0].relatedIssueKeys = []
    scores[0].score = 6
    scores[1].relatedIssueKeys = []
    scores[1].score = 8.25
    scores[2].relatedIssueKeys = ['legibility-blue']
    scores[2].score = 0.25
    mutate(scores)
    expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
  })

  it('rejects a local legibility quote repeated in a non-legibility narrative or recognition warning', () => {
    const narrative = payloadWithCantAmbiguity()
    ;(narrative.dimensionScores as Array<Record<string, unknown>>)[0].reason = 'It are blue. is unclear.'
    expect(normalizeMultimodalResult(narrative, context)).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })

    const warning = payloadWithCantAmbiguity()
    warning.recognitionWarnings = ['It are blue. is unclear.']
    expect(normalizeMultimodalResult(warning, context)).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
  })

  it('keeps a separate global recognition warning partial alongside a local legibility finding', () => {
    const payload = payloadWithCantAmbiguity()
    payload.recognitionWarnings = ['The printed/student boundary is globally uncertain.']
    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: { status: 'partial', reviewReasons: expect.arrayContaining(['recognition_uncertain']), legibilityIssues: [{ transcriptText: 'It are blue.' }] },
    })
  })

  it.each([
    ['ungrounded', 'Invented evidence.'],
    ['whitespace-folded', 'I  has a pen.'],
  ])('rejects %s dimension evidence', (_label, evidence) => {
    const payload = validPayload()
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].evidence = evidence
    expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
  })

  it('rejects non-unique dimension evidence', () => {
    const payload = validPayload()
    payload.transcript = 'Repeated evidence. Repeated evidence.'
    payload.issues = []
    payload.dimensionScores = [
      { dimensionId: 'content', score: 6, reason: 'Complete.', evidence: 'Repeated evidence.', relatedIssueKeys: [] },
      { dimensionId: 'language', score: 8.25, reason: 'Accurate.', evidence: 'Repeated evidence.', relatedIssueKeys: [] },
      { dimensionId: 'legibility', score: 0.75, reason: 'Legible.', evidence: 'Repeated evidence.', relatedIssueKeys: [] },
    ]
    payload.reportedTotalScore = 15
    payload.fullTextRevision = { correctedText: payload.transcript, improvedText: payload.transcript, sentencePairs: [], logicNotes: [], logicIssues: [] }
    expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
  })

  it('does not retain provider review reasons after filtering uncertain spelling', () => {
    const payload = validPayload()
    payload.issues = [{
      issueKey: 'spelling-has', type: 'spelling', severity: 'low', originalText: 'has', suggestion: 'have',
      explanation: 'The letter shape is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    }]
    payload.dimensionScores = (payload.dimensionScores as Array<Record<string, unknown>>).map((score) => ({
      ...score,
      score: score.dimensionId === 'content' ? 6 : score.dimensionId === 'language' ? 8.25 : 0.75,
      evidence: 'It are blue.', relatedIssueKeys: [],
    }))
    payload.reportedTotalScore = 15
    payload.reviewReasons = ['Change has to have.']

    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({ ok: true, result: { status: 'success', reviewReasons: [], issues: [] } })
  })

  it('rejects a self-overlapping logic note quote', () => {
    const payload = validPayload()
    payload.transcript = 'aaa'
    payload.issues = []
    payload.dimensionScores = (payload.dimensionScores as Array<Record<string, unknown>>).map((score) => ({ ...score, evidence: 'aaa' }))
    payload.fullTextRevision = { correctedText: 'aaa', improvedText: 'aaa', sentencePairs: [], logicNotes: [{ quote: 'aa', note: 'Logic note.' }], logicIssues: [] }

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
  })

  it('rejects filtered spelling leaked through a logic note quote', () => {
    const payload = validPayload()
    payload.transcript = 'joins join'
    payload.dimensionScores = (payload.dimensionScores as Array<Record<string, unknown>>).map((score) => ({ ...score, evidence: 'joins join' }))
    payload.issues = [{
      issueKey: 'spelling-joins', type: 'spelling', severity: 'low', originalText: 'joins', suggestion: 'join',
      explanation: 'The letter shape is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    }]
    payload.fullTextRevision = { correctedText: 'joins join', improvedText: 'joins join', sentencePairs: [], logicNotes: [{ quote: 'joins join', note: 'Neutral note.' }], logicIssues: [] }

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
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
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].evidence = 'It are blue.'
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[1].evidence = 'It are blue.'
    payload.legibilityIssues = [{
      issueKey: 'legibility-opening', transcriptText: 'I has a pen.', possibleReadings: ['I has a pen.', 'I have a pen.'],
      pageNumber: 1, regionDescription: 'line 1', explanation: 'The verb ending is unclear.', defaultOutcome: 'count_as_legibility_error',
    }]
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[2] = {
      dimensionId: 'legibility', score: 0.25, reason: 'The opening is unclear.', evidence: 'I has a pen.', relatedIssueKeys: ['legibility-opening'],
    }

    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({ ok: true, result: { fullTextRevision: { logicNotes: [] } } })
  })

  it('rejects an ungrounded logic diagnostic instead of guessing its source', () => {
    const payload = validPayload()
    ;((payload.fullTextRevision as Record<string, unknown>).logicNotes as Array<Record<string, unknown>>)[0].quote = 'Invented logic quote.'
    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
  })

  it('rejects ungrounded dimension evidence even when printed-text exclusion is uncertain', () => {
    const payload = validPayload()
    payload.printedTextExcluded = false
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].evidence = 'Printed heading.'
    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
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
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].relatedIssueKeys = []
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
