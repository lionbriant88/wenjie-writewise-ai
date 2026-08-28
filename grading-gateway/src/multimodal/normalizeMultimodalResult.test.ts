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
    overallComment: 'A clear synthetic response.',
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

function payloadWithUnlinkedUncertainSpelling(): Record<string, unknown> {
  const payload = validPayload()
  payload.transcript = 'I wark today.'
  payload.issues = [{
    issueKey: 'spelling-wark', type: 'spelling', severity: 'low', originalText: 'wark', suggestion: 'work',
    explanation: 'The handwriting is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
  }]
  payload.dimensionScores = [
    { dimensionId: 'content', score: 6, reason: 'Complete.', evidence: payload.transcript, relatedIssueKeys: [] },
    { dimensionId: 'language', score: 7.25, reason: 'The spelling of wark is uncertain.', evidence: 'wark', relatedIssueKeys: [] },
    { dimensionId: 'legibility', score: 0.75, reason: 'Legible.', evidence: payload.transcript, relatedIssueKeys: [] },
  ]
  payload.reportedTotalScore = 14
  payload.sentenceRevisions = []
  payload.expressionUpgrades = []
  payload.fullTextRevision = { correctedText: payload.transcript, improvedText: payload.transcript, sentencePairs: [], logicNotes: [], logicIssues: [] }
  return payload
}

function payloadWithMixedSpellingAndGrammar(): Record<string, unknown> {
  const payload = validPayload()
  payload.transcript = 'I wark today. It are blue.'
  payload.issues = [
    {
      issueKey: 'spelling-wark', type: 'spelling', severity: 'low', originalText: 'wark', suggestion: 'work',
      explanation: 'The handwriting is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    },
    {
      issueKey: 'grammar-blue', type: 'grammar', severity: 'medium', originalText: 'It are blue.', suggestion: 'It is blue.',
      explanation: 'Agreement.', evidenceCertainty: 'certain', requiresTeacherReview: false,
    },
  ]
  payload.dimensionScores = [
    { dimensionId: 'content', score: 6, reason: 'Complete.', evidence: 'today.', relatedIssueKeys: [] },
    { dimensionId: 'language', score: 7.25, reason: 'Grammar needs review.', evidence: 'It are blue.', relatedIssueKeys: ['grammar-blue'] },
    { dimensionId: 'legibility', score: 0.75, reason: 'Legible.', evidence: 'today.', relatedIssueKeys: [] },
  ]
  payload.reportedTotalScore = 14
  payload.sentenceRevisions = []
  payload.expressionUpgrades = []
  payload.fullTextRevision = { correctedText: payload.transcript, improvedText: payload.transcript, sentencePairs: [], logicNotes: [], logicIssues: [] }
  return payload
}

function payloadWithOneTranscriptSpace(): Record<string, unknown> {
  const payload = validPayload()
  payload.transcript = 'A B'
  payload.reportedTotalScore = 15
  payload.dimensionScores = [
    { dimensionId: 'content', score: 6, reason: 'Complete.', evidence: payload.transcript, relatedIssueKeys: [] },
    { dimensionId: 'language', score: 8.25, reason: 'Accurate.', evidence: payload.transcript, relatedIssueKeys: [] },
    { dimensionId: 'legibility', score: 0.75, reason: 'Legible.', evidence: payload.transcript, relatedIssueKeys: [] },
  ]
  payload.issues = []
  payload.sentenceRevisions = []
  payload.expressionUpgrades = []
  payload.fullTextRevision = { correctedText: payload.transcript, improvedText: payload.transcript, sentencePairs: [], logicNotes: [], logicIssues: [] }
  payload.legibilityIssues = []
  return payload
}

type SuppressedIssueVariant = 'type-null' | 'extra-key' | 'ungrounded-grammar' | 'duplicate'

function payloadWithSuppressedIssueVariant(variant: SuppressedIssueVariant): {
  payload: Record<string, unknown>
  issueKey: string
  originalText: string
  suggestion: string
} {
  const payload = validPayload()
  payload.transcript = 'A wark appears. I has a pen. It are blue.'
  payload.dimensionScores = [
    { dimensionId: 'content', score: 4.8, reason: 'Relevant.', evidence: 'I has a pen.', relatedIssueKeys: ['grammar-blue'] },
    { dimensionId: 'language', score: 6.45, reason: 'Grammar needs review.', evidence: 'It are blue.', relatedIssueKeys: ['grammar-blue'] },
    { dimensionId: 'legibility', score: 0.75, reason: 'Legible.', evidence: 'I has a pen.', relatedIssueKeys: [] },
  ]
  payload.fullTextRevision = { correctedText: payload.transcript, improvedText: payload.transcript, sentencePairs: [], logicNotes: [], logicIssues: [] }
  const grammar = {
    issueKey: 'grammar-blue', type: 'grammar', severity: 'medium', originalText: 'It are blue.', suggestion: 'It is blue.',
    explanation: 'Agreement.', evidenceCertainty: 'certain', requiresTeacherReview: false,
  }
  const issueKey = variant === 'duplicate' ? 'omitted-duplicate' : 'omitted-candidate'
  const originalText = variant === 'ungrounded-grammar' ? 'SECRET-INVENTED-QUOTE' : 'wark'
  const suggestion = variant === 'ungrounded-grammar' ? 'SECRET-CORRECTION' : 'work'
  const candidate = {
    issueKey, type: variant === 'ungrounded-grammar' ? 'grammar' : 'spelling', severity: 'low', originalText, suggestion,
    explanation: variant === 'ungrounded-grammar' ? 'Synthetic grammar.' : 'The spelling is uncertain.',
    evidenceCertainty: variant === 'ungrounded-grammar' ? 'certain' : 'uncertain', requiresTeacherReview: false,
  }
  if (variant === 'type-null') payload.issues = [grammar, { ...candidate, type: null }]
  if (variant === 'extra-key') payload.issues = [grammar, { ...candidate, extra: true }]
  if (variant === 'ungrounded-grammar') payload.issues = [grammar, candidate]
  if (variant === 'duplicate') payload.issues = [grammar, candidate, { ...candidate, originalText: 'A wark appears.', suggestion: 'walk' }]
  return { payload, issueKey, originalText, suggestion }
}

describe('normalizeMultimodalResult', () => {
  it.each([
    ['an unexpected top-level field', (payload: Record<string, unknown>) => { payload.unexpected = 'PRIVATE-STUDENT-TEXT' }],
    ['a malformed dimension evidence field', (payload: Record<string, unknown>) => { ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].evidence = null }],
  ] as const)('keeps the core score when Provider output has %s', (_label, mutate) => {
    const payload = validPayload()
    mutate(payload)

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({ ok: true })
    expect(JSON.stringify(normalized)).not.toContain('PRIVATE-STUDENT-TEXT')
  })

  it.each([
    ['dimension score', () => validPayload(), (payload: Record<string, unknown>) => { ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].extra = true }],
    ['issue', () => validPayload(), (payload: Record<string, unknown>) => { ;(payload.issues as Array<Record<string, unknown>>)[0].extra = true }],
    ['sentence revision', () => { const payload = validPayload(); payload.sentenceRevisions = [{ originalText: 'It are blue.', revisedText: 'It is blue.', note: 'Synthetic.', relatedIssueKeys: ['grammar-blue'], changeTypes: ['grammar'] }]; return payload }, (payload: Record<string, unknown>) => { ;(payload.sentenceRevisions as Array<Record<string, unknown>>)[0].extra = true }],
    ['full-text revision', () => validPayload(), (payload: Record<string, unknown>) => { ;(payload.fullTextRevision as Record<string, unknown>).extra = true }],
    ['sentence pair', () => { const payload = validPayload(); ;(payload.fullTextRevision as Record<string, unknown>).sentencePairs = [{ originalText: 'It are blue.', correctedText: 'It is blue.', improvedText: 'It is blue.', relatedIssueKeys: ['grammar-blue'], changeTypes: ['grammar'], explanation: 'Synthetic.', requiresTeacherReview: false }]; return payload }, (payload: Record<string, unknown>) => { ;((payload.fullTextRevision as Record<string, unknown>).sentencePairs as Array<Record<string, unknown>>)[0].extra = true }],
    ['logic note', () => validPayload(), (payload: Record<string, unknown>) => { ;((payload.fullTextRevision as Record<string, unknown>).logicNotes as Array<Record<string, unknown>>)[0].extra = true }],
    ['logic issue', () => payloadWithLogicIssue(), (payload: Record<string, unknown>) => { ;((payload.fullTextRevision as Record<string, unknown>).logicIssues as Array<Record<string, unknown>>)[0].extra = true }],
    ['legibility issue', () => payloadWithCantAmbiguity(), (payload: Record<string, unknown>) => { ;(payload.legibilityIssues as Array<Record<string, unknown>>)[0].extra = true }],
    ['recognition warning', () => { const payload = validPayload(); payload.recognitionWarnings = [{ scope: 'global_unreadable', message: 'Synthetic warning.' }]; return payload }, (payload: Record<string, unknown>) => { ;(payload.recognitionWarnings as Array<Record<string, unknown>>)[0].extra = true }],
  ] as const)('ignores or safely omits an unexpected nested %s key', (_label, makePayload, mutate) => {
    const payload = makePayload()
    expect(normalizeMultimodalResult(payload, context).ok).toBe(true)
    mutate(payload)
    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({ ok: true })
    expect(JSON.stringify(normalized)).not.toContain('"extra"')
  })

  it('marks an unexpected auxiliary key on a required dimension row for review without losing its core score', () => {
    const payload = validPayload()
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].extra = 'SECRET-DIMENSION-AUX'

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: { status: 'partial', totalScore: 12, reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']) },
    })
    expect(JSON.stringify(normalized)).not.toContain('SECRET-DIMENSION-AUX')
  })

  it('omits a malformed expression upgrade without discarding the score', () => {
    const payload = validPayload()
    payload.expressionUpgrades = [{ originalText: 'I has a pen.', upgradedText: 'I have a pen.', note: 'Synthetic.', extra: 'PRIVATE-STUDENT-TEXT' }]

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial', expressionUpgrades: [], totalScore: 12,
        reviewReasons: expect.arrayContaining(['部分表达优化因依据不完整已自动省略。']),
      },
    })
    expect(JSON.stringify(normalized)).not.toContain('PRIVATE-STUDENT-TEXT')
  })

  it('salvages valid issues and keeps the spelling filter active when a malformed sibling is omitted', () => {
    const payload = payloadWithUnlinkedUncertainSpelling()
    payload.transcript = 'I wark today. It are wrong.'
    payload.issues = [
      {
        issueKey: 'spelling-wark', type: 'spelling', severity: 'low', originalText: 'wark', suggestion: 'work',
        explanation: 'The handwriting is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
      },
      {
        issueKey: 'grammar-wrong', type: 'grammar', severity: 'medium', originalText: 'It are wrong.', suggestion: 'It is wrong.',
        explanation: 'A genuine agreement issue.', evidenceCertainty: 'certain', requiresTeacherReview: false,
      },
      { issueKey: 'grammar-wrong', malformed: true },
    ]
    const dimensions = payload.dimensionScores as Array<Record<string, unknown>>
    dimensions[0].evidence = payload.transcript
    dimensions[1].relatedIssueKeys = ['spelling-wark']
    dimensions[2].evidence = payload.transcript
    ;(payload.fullTextRevision as Record<string, unknown>).correctedText = payload.transcript
    ;(payload.fullTextRevision as Record<string, unknown>).improvedText = payload.transcript
    payload.overallComment = 'Change wark to work because the spelling is uncertain.'

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial', totalScore: 15,
        issues: [expect.objectContaining({ type: 'grammar', originalText: 'It are wrong.' })],
        dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'language', score: 8.25 })]),
        reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']),
      },
    })
    expect(JSON.stringify(normalized)).not.toContain('Change wark to work')
  })

  it('keeps a valid issue when a malformed same-key sibling carries different suppressed content', () => {
    const payload = validPayload()
    ;(payload.issues as unknown[]).push({
      issueKey: 'grammar-blue', type: null, severity: 'low', originalText: 'It are blue.', suggestion: 'SECRET-SAME-KEY-CORRECTION',
      explanation: 'Uncertain Provider finding.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    })
    payload.expressionUpgrades = [{ originalText: 'I has a pen.', upgradedText: 'Use SECRET-SAME-KEY-CORRECTION.', note: 'Correct the uncertain finding.' }]
    payload.overallComment = 'Change It are blue. to SECRET-SAME-KEY-CORRECTION.'

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial',
        issues: [expect.objectContaining({ type: 'grammar', originalText: 'It are blue.' })],
        expressionUpgrades: [],
        overallComment: '已依据评分标准完成批改。',
      },
    })
    expect(JSON.stringify(normalized)).not.toContain('SECRET-SAME-KEY-CORRECTION')
  })

  it('does not treat a same-key malformed sibling with a different explanation as an exact clone', () => {
    const payload = validPayload()
    ;(payload.issues as unknown[]).push({
      issueKey: 'grammar-blue', type: 'grammar', severity: 'medium', originalText: 'It are blue.', suggestion: 'It is blue.',
      explanation: 'PRIVATE-SAME-KEY-EXPLANATION', evidenceCertainty: 'certain', requiresTeacherReview: false, extra: true,
    })
    payload.expressionUpgrades = [{
      originalText: 'I has a pen.', upgradedText: 'Use PRIVATE-SAME-KEY-EXPLANATION.', note: 'Synthetic.',
    }]
    ;(payload.fullTextRevision as Record<string, unknown>).logicNotes = [{
      quote: 'I has a pen.', note: 'PRIVATE-SAME-KEY-EXPLANATION',
    }]

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial',
        issues: [expect.objectContaining({ id: 'essay-normalize-issue-1', type: 'grammar', explanation: 'Agreement.' })],
        expressionUpgrades: [],
        fullTextRevision: { logicNotes: [] },
      },
    })
    expect(JSON.stringify(normalized)).not.toContain('PRIVATE-SAME-KEY-EXPLANATION')
  })

  it('does not treat a same-key spelling classification conflict as a benign grammar clone', () => {
    const payload = validPayload()
    payload.transcript = 'I wark today.'
    payload.reportedTotalScore = 14
    payload.issues = [{
      issueKey: 'grammar-wark', type: 'grammar', severity: 'medium', originalText: 'wark', suggestion: 'work',
      explanation: 'Grammar correction.', evidenceCertainty: 'certain', requiresTeacherReview: false,
    }, {
      issueKey: 'grammar-wark', type: 'spelling', severity: 'medium', originalText: 'wark', suggestion: 'work',
      explanation: 'Grammar correction.', evidenceCertainty: 'uncertain', requiresTeacherReview: false, extra: true,
    }]
    payload.dimensionScores = [
      { dimensionId: 'content', score: 6, reason: 'Complete.', evidence: payload.transcript, relatedIssueKeys: [] },
      { dimensionId: 'language', score: 7.25, reason: 'Grammar correction is needed.', evidence: 'wark', relatedIssueKeys: ['grammar-wark'] },
      { dimensionId: 'legibility', score: 0.75, reason: 'Legible.', evidence: payload.transcript, relatedIssueKeys: [] },
    ]
    payload.overallComment = 'The grammar correction from wark to work is needed.'
    payload.fullTextRevision = { correctedText: payload.transcript, improvedText: payload.transcript, sentencePairs: [], logicNotes: [], logicIssues: [] }

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'partial', totalScore: 14,
        issues: [], overallComment: '已依据评分标准完成批改。',
        dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'language', score: 7.25, requiresTeacherReview: true })]),
      },
    })
  })

  it.each([
    ['issue suggestion plus explanation', (payload: Record<string, unknown>) => {
      ;(payload.issues as unknown[]).push({
        issueKey: 'grammar-split', type: 'grammar', severity: 'low', originalText: 'today.', suggestion: 'Use work.',
        explanation: 'Correct the spelling.', evidenceCertainty: 'certain', requiresTeacherReview: false,
      })
    }, 'partial'],
    ['logic diagnosis plus suggestions', (payload: Record<string, unknown>) => {
      ;((payload.fullTextRevision as Record<string, unknown>).logicIssues as unknown[]).push({
        issueKey: 'logic-split', originalText: 'today.', contextBefore: '', contextAfter: 'I work later.', subType: 'unclear_logic', severity: 'low',
        diagnosis: 'Correct the spelling.', suggestedAction: 'replace_sentence', conservativeSuggestion: 'Use work.',
        polishedSuggestion: 'Use work.', requiresTeacherReview: false,
      })
    }, 'partial'],
    ['revision replacement plus note', (payload: Record<string, unknown>) => {
      payload.sentenceRevisions = [{
        originalText: 'today.', revisedText: 'Use work.', note: 'Correct the spelling.',
        relatedIssueKeys: ['spelling-wark'], changeTypes: ['spelling'],
      }]
    }, 'success'],
    ['pair replacements plus explanation', (payload: Record<string, unknown>) => {
      ;(payload.fullTextRevision as Record<string, unknown>).sentencePairs = [{
        originalText: 'today.', correctedText: 'Use work.', improvedText: 'Use work.',
        relatedIssueKeys: ['spelling-wark'], changeTypes: ['spelling'], explanation: 'Correct the spelling.', requiresTeacherReview: false,
      }]
    }, 'success'],
    ['upgrade text plus note', (payload: Record<string, unknown>) => {
      payload.expressionUpgrades = [{ originalText: 'today.', upgradedText: 'Use work.', note: 'Correct the spelling.' }]
    }, 'success'],
    ['logic-note quote plus note', (payload: Record<string, unknown>) => {
      ;(payload.fullTextRevision as Record<string, unknown>).logicNotes = [{ quote: 'work', note: 'Correct the spelling.' }]
    }, 'success'],
    ['overall comment', (payload: Record<string, unknown>) => {
      payload.overallComment = 'Use work. Correct the spelling.'
    }, 'success'],
  ] as const)('suppresses a spelling correction split across one %s item', (_label, mutate, expectedStatus) => {
    const payload = payloadWithUnlinkedUncertainSpelling()
    payload.transcript = 'I wark today. I work later.'
    payload.dimensionScores = [
      { dimensionId: 'content', score: 6, reason: 'Complete.', evidence: payload.transcript, relatedIssueKeys: [] },
      { dimensionId: 'language', score: 7.25, reason: 'The spelling is uncertain.', evidence: 'wark', relatedIssueKeys: ['spelling-wark'] },
      { dimensionId: 'legibility', score: 0.75, reason: 'Legible.', evidence: payload.transcript, relatedIssueKeys: [] },
    ]
    payload.fullTextRevision = { correctedText: payload.transcript, improvedText: payload.transcript, sentencePairs: [], logicNotes: [], logicIssues: [] }
    mutate(payload)

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({ ok: true, result: { status: expectedStatus, totalScore: 15 } })
    expect(JSON.stringify(normalized)).not.toMatch(/Use work\.|Correct the spelling\./)
  })

  it('preserves ordinary feedback that uses an ambiguous original or suggestion term without a correction cue', () => {
    const payload = validPayload()
    payload.transcript = 'Your work is clear.'
    payload.reportedTotalScore = 15
    payload.issues = [{
      issueKey: 'spelling-work', type: 'spelling', severity: 'low', originalText: 'work', suggestion: 'word',
      explanation: 'The handwriting is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    }]
    payload.dimensionScores = [
      { dimensionId: 'content', score: 6, reason: 'Good work.', evidence: payload.transcript, relatedIssueKeys: [] },
      { dimensionId: 'language', score: 8.25, reason: 'The work has clear logic.', evidence: payload.transcript, relatedIssueKeys: [] },
      { dimensionId: 'legibility', score: 0.75, reason: 'Legible.', evidence: payload.transcript, relatedIssueKeys: [] },
    ]
    payload.overallComment = 'Good work. This word is vivid.'
    payload.fullTextRevision = { correctedText: payload.transcript, improvedText: payload.transcript, sentencePairs: [], logicNotes: [], logicIssues: [] }

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'success', issues: [], overallComment: 'Good work. This word is vivid.',
        dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'language', reason: 'The work has clear logic.' })]),
      },
    })
  })

  it('suppresses explicit single-field spelling directives while restoring their sole deduction', () => {
    const payload = payloadWithUnlinkedUncertainSpelling()
    const language = (payload.dimensionScores as Array<Record<string, unknown>>)[1]
    language.reason = 'Use work.'
    language.relatedIssueKeys = ['spelling-wark']
    payload.expressionUpgrades = [{ originalText: 'today.', upgradedText: 'Prefer work.', note: 'Synthetic.' }]
    payload.overallComment = 'Choose work. Replace wark with work.'

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({ ok: true, result: { status: 'success', totalScore: 15, expressionUpgrades: [] } })
    expect(JSON.stringify(normalized)).not.toMatch(/Use work\.|Prefer work\.|Choose work\.|Replace wark with work\./i)
  })

  it.each(['issue', 'logic', 'legibility'] as const)('does not republish a %s item removed during policy sanitization', (kind) => {
    const marker = `PRIVATE-POLICY-${kind.toUpperCase()}`
    const payload = payloadWithUnlinkedUncertainSpelling()
    payload.transcript = 'I wark today. Safe blur.'
    payload.dimensionScores = [
      { dimensionId: 'content', score: 6, reason: 'Complete.', evidence: payload.transcript, relatedIssueKeys: [] },
      { dimensionId: 'language', score: 7.25, reason: 'The spelling is uncertain.', evidence: 'wark', relatedIssueKeys: ['spelling-wark'] },
      { dimensionId: 'legibility', score: kind === 'legibility' ? 0 : 0.75, reason: kind === 'legibility' ? 'One mark is unclear.' : 'Legible.', evidence: kind === 'legibility' ? 'blur' : payload.transcript, relatedIssueKeys: kind === 'legibility' ? ['legibility-blur'] : [] },
    ]
    payload.reportedTotalScore = kind === 'legibility' ? 14 : 15
    payload.fullTextRevision = { correctedText: payload.transcript, improvedText: payload.transcript, sentencePairs: [], logicNotes: [], logicIssues: [] }
    if (kind === 'issue') {
      ;(payload.issues as unknown[]).push({
        issueKey: 'grammar-policy', type: 'grammar', severity: 'low', originalText: 'wark', suggestion: marker,
        explanation: marker, evidenceCertainty: 'certain', requiresTeacherReview: false,
      })
    } else if (kind === 'logic') {
      ;(payload.fullTextRevision as Record<string, unknown>).logicIssues = [{
        issueKey: 'logic-policy', originalText: 'Safe', contextBefore: 'wark', contextAfter: '', subType: 'unclear_logic', severity: 'low',
        diagnosis: marker, suggestedAction: 'add_bridge_sentence', conservativeSuggestion: marker,
        polishedSuggestion: marker, requiresTeacherReview: false,
      }]
    } else {
      payload.legibilityIssues = [{
        issueKey: 'legibility-blur', transcriptText: 'blur', possibleReadings: ['blur', 'blue'], pageNumber: 1,
        regionDescription: marker, explanation: `${marker}. Change wark to work.`, defaultOutcome: 'count_as_legibility_error',
      }]
    }
    payload.expressionUpgrades = [{ originalText: 'today.', upgradedText: marker, note: marker }]
    payload.overallComment = marker

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial', expressionUpgrades: [], overallComment: '已依据评分标准完成批改。',
        ...(kind === 'issue' ? { issues: [] } : {}),
        ...(kind === 'logic' ? { fullTextRevision: { logicIssues: [] } } : {}),
        ...(kind === 'legibility' ? { legibilityIssues: [] } : {}),
      },
    })
    expect(JSON.stringify(normalized)).not.toContain(marker)
  })

  it.each(['issue', 'logic', 'legibility'] as const)('does not let a policy-removed item narrative flow back through another public %s', (publicKind) => {
    const marker = `PRIVATE-POLICY-CHAIN-${publicKind.toUpperCase()}`
    const payload = payloadWithUnlinkedUncertainSpelling()
    payload.transcript = 'I wark today. It are blue. Then I left.'
    payload.dimensionScores = [
      { dimensionId: 'content', score: 6, reason: 'Complete.', evidence: 'Then I left.', relatedIssueKeys: [] },
      { dimensionId: 'language', score: 7.25, reason: 'The spelling of wark is uncertain.', evidence: 'wark', relatedIssueKeys: ['spelling-wark'] },
      { dimensionId: 'legibility', score: publicKind === 'legibility' ? 0 : 0.75, reason: publicKind === 'legibility' ? 'One mark is unclear.' : 'Legible.', evidence: publicKind === 'legibility' ? 'left' : 'Then I left.', relatedIssueKeys: publicKind === 'legibility' ? ['legibility-policy-sink'] : [] },
    ]
    payload.reportedTotalScore = 14
    ;(payload.fullTextRevision as Record<string, unknown>).correctedText = payload.transcript
    ;(payload.fullTextRevision as Record<string, unknown>).improvedText = payload.transcript
    ;(payload.fullTextRevision as Record<string, unknown>).logicIssues = [{
      issueKey: 'logic-policy-source', originalText: 'It are blue.', contextBefore: 'wark', contextAfter: 'Then I left.',
      subType: 'unclear_logic', severity: 'low', diagnosis: marker, suggestedAction: 'add_bridge_sentence',
      conservativeSuggestion: marker, polishedSuggestion: marker, requiresTeacherReview: false,
    }]
    if (publicKind === 'issue') {
      ;(payload.issues as unknown[]).push({
        issueKey: 'grammar-policy-sink', type: 'grammar', severity: 'medium', originalText: 'It are blue.', suggestion: marker,
        explanation: marker, evidenceCertainty: 'certain', requiresTeacherReview: false,
      })
    } else if (publicKind === 'logic') {
      ;((payload.fullTextRevision as Record<string, unknown>).logicIssues as unknown[]).push({
        issueKey: 'logic-policy-sink', originalText: 'Then I left.', contextBefore: 'It are blue.', contextAfter: '',
        subType: 'unclear_logic', severity: 'low', diagnosis: marker, suggestedAction: 'add_bridge_sentence',
        conservativeSuggestion: marker, polishedSuggestion: marker, requiresTeacherReview: false,
      })
    } else {
      payload.legibilityIssues = [{
        issueKey: 'legibility-policy-sink', transcriptText: 'left', possibleReadings: ['left', 'loft'], pageNumber: 1,
        regionDescription: marker, explanation: marker, defaultOutcome: 'count_as_legibility_error',
      }]
    }

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial',
        ...(publicKind === 'issue' ? { issues: [] } : {}),
        ...(publicKind === 'logic' ? { fullTextRevision: { logicIssues: [] } } : {}),
        ...(publicKind === 'legibility' ? { legibilityIssues: [] } : {}),
      },
    })
    expect(JSON.stringify(normalized)).not.toContain(marker)
  })

  it('does not let a safely classified spelling candidate steal a valid grammar sibling key', () => {
    const payload = payloadWithMixedSpellingAndGrammar()
    const issues = payload.issues as Array<Record<string, unknown>>
    issues[0] = { ...issues[0], issueKey: 'grammar-blue', extra: true }
    const language = (payload.dimensionScores as Array<Record<string, unknown>>)[1]
    language.relatedIssueKeys = ['grammar-blue']

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        totalScore: 14,
        issues: [expect.objectContaining({ type: 'grammar', originalText: 'It are blue.' })],
        dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'language', score: 7.25 })]),
      },
    })
  })

  it.each([
    'A noun needs a plural ending.',
    'The predicate does not match the subject.',
    'A preposition is missing.',
    'This is a sentence fragment.',
  ])('does not restore a deduction without positive local spelling attribution: %s', (reason) => {
    const payload = payloadWithUnlinkedUncertainSpelling()
    const language = (payload.dimensionScores as Array<Record<string, unknown>>)[1]
    language.reason = reason
    language.relatedIssueKeys = ['spelling-wark']

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'partial', totalScore: 14,
        dimensionScores: expect.arrayContaining([expect.objectContaining({
          dimensionId: 'language', score: 7.25, requiresTeacherReview: true,
        })]),
      },
    })
  })

  it.each([
    ['local spelling evidence', 'wark', 15, 'success'],
    ['wide evidence also covering grammar', 'I wark today. It are blue.', 14, 'partial'],
  ] as const)('uses positive local evidence ahead of a stale wide grammar link: %s', (_label, evidence, expectedTotal, expectedStatus) => {
    const payload = payloadWithMixedSpellingAndGrammar()
    ;(payload.issues as Array<Record<string, unknown>>)[1] = {
      issueKey: 'grammar-blue', type: 'grammar', severity: 'medium', originalText: payload.transcript,
      suggestion: 'I wark today. It is blue.', explanation: 'Fix agreement.', evidenceCertainty: 'certain', requiresTeacherReview: false,
    }
    const language = (payload.dimensionScores as Array<Record<string, unknown>>)[1]
    language.reason = 'The spelling of wark is uncertain.'
    language.evidence = evidence
    language.relatedIssueKeys = ['grammar-blue']

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: expectedStatus, totalScore: expectedTotal,
        issues: [expect.objectContaining({ id: 'essay-normalize-issue-1', type: 'grammar' })],
        dimensionScores: expect.arrayContaining([expect.objectContaining({
          dimensionId: 'language', score: expectedTotal === 15 ? 8.25 : 7.25,
        })]),
      },
    })
  })

  it.each([
    [15, 6, 8.25, 14],
    [10, 4, 5.5, 9],
    [9, 3.6, 4.95, 8],
  ] as const)('makes a real legibility deduction visible in a %i-point total', (fullScore, contentScore, languageScore, expectedTotal) => {
    const weightedTask = { ...task, fullScore }
    const payload = validPayload()
    payload.transcript = 'I can come.'
    payload.reportedTotalScore = expectedTotal
    payload.issues = []
    payload.dimensionScores = [
      { dimensionId: 'content', score: contentScore, reason: 'Complete.', evidence: payload.transcript, relatedIssueKeys: [] },
      { dimensionId: 'language', score: languageScore, reason: 'Accurate.', evidence: payload.transcript, relatedIssueKeys: [] },
      { dimensionId: 'legibility', score: 0, reason: 'One mark is unclear.', evidence: 'can', relatedIssueKeys: ['legibility-can'] },
    ]
    payload.legibilityIssues = [{
      issueKey: 'legibility-can', transcriptText: 'can', possibleReadings: ['can', "can't"], pageNumber: 1,
      regionDescription: 'middle word', explanation: 'Two readings are plausible.', defaultOutcome: 'count_as_legibility_error',
    }]
    payload.fullTextRevision = { correctedText: payload.transcript, improvedText: payload.transcript, sentencePairs: [], logicNotes: [], logicIssues: [] }

    expect(normalizeMultimodalResult(payload, { ...context, task: weightedTask })).toMatchObject({
      ok: true,
      result: {
        totalScore: expectedTotal,
        legibilityIssues: [expect.objectContaining({ transcriptText: 'can' })],
        dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'legibility', score: 0 })]),
      },
    })
  })

  it('keeps spelling restoration projector-safe when the fallback transcript overlaps a real legibility issue', () => {
    const payload = payloadWithUnlinkedUncertainSpelling()
    const language = (payload.dimensionScores as Array<Record<string, unknown>>)[1]
    language.relatedIssueKeys = ['spelling-wark']
    payload.legibilityIssues = [{
      issueKey: 'legibility-wark', transcriptText: 'wark', possibleReadings: ['wark', 'work'], pageNumber: 1,
      regionDescription: 'first word', explanation: 'Two readings are genuinely plausible.', defaultOutcome: 'count_as_legibility_error',
    }]
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[2] = {
      dimensionId: 'legibility', score: 0, reason: 'The first word is unclear.', evidence: 'wark', relatedIssueKeys: ['legibility-wark'],
    }
    payload.reportedTotalScore = 14

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'partial', totalScore: 14,
        dimensionScores: expect.arrayContaining([expect.objectContaining({
          dimensionId: 'language', score: 8.25, evidence: payload.transcript, requiresTeacherReview: true,
        })]),
        legibilityIssues: [expect.objectContaining({ transcriptText: 'wark' })],
      },
    })
  })

  it('neutralizes provider narratives and localized support when malformed issue classification is unrecoverable', () => {
    const payload = payloadWithUnlinkedUncertainSpelling()
    payload.issues = [{
      issueKey: 'malformed-spelling', type: null, severity: 'low', originalText: 'wark', suggestion: 'work',
      explanation: 'The spelling is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    }]
    const language = (payload.dimensionScores as Array<Record<string, unknown>>)[1]
    language.reason = 'Change wark to work.'
    language.evidence = 'wark'
    language.relatedIssueKeys = ['malformed-spelling']
    payload.overallComment = 'Change wark to work because the spelling is uncertain.'

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial', totalScore: 14,
        overallComment: '已依据评分标准完成批改。',
        dimensionScores: expect.arrayContaining([expect.objectContaining({
          dimensionId: 'language', score: 7.25, reason: '该维度评分依据需教师复核。', evidence: payload.transcript, requiresTeacherReview: true,
        })]),
      },
    })
    expect(JSON.stringify(normalized)).not.toContain('Change wark to work')
  })

  it('salvages a valid sentence revision beside a malformed sibling', () => {
    const payload = validPayload()
    payload.sentenceRevisions = [
      { originalText: 'It are blue.', revisedText: 'It is blue.', note: 'Fix agreement.', relatedIssueKeys: ['grammar-blue'], changeTypes: ['grammar'] },
      { malformed: true },
    ]

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'partial', sentenceRevisions: [expect.objectContaining({ originalText: 'It are blue.' })],
        reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']),
      },
    })
  })

  it('salvages a valid sentence pair beside a malformed sibling', () => {
    const payload = validPayload()
    ;(payload.fullTextRevision as Record<string, unknown>).sentencePairs = [
      { originalText: 'It are blue.', correctedText: 'It is blue.', improvedText: 'It is bright blue.', relatedIssueKeys: ['grammar-blue'], changeTypes: ['grammar'], explanation: 'Fix agreement.', requiresTeacherReview: false },
      { malformed: true },
    ]

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'partial',
        fullTextRevision: {
          correctedText: 'I has a pen.\nIt is blue.',
          sentencePairs: [expect.objectContaining({ originalText: 'It are blue.' })],
        },
        reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']),
      },
    })
  })

  it('salvages a valid expression upgrade beside a malformed sibling', () => {
    const payload = validPayload()
    payload.expressionUpgrades = [
      { originalText: 'I has a pen.', upgradedText: 'I own a pen.', note: 'Use a concise verb.' },
      { malformed: true },
    ]

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'partial', expressionUpgrades: [expect.objectContaining({ originalText: 'I has a pen.' })],
        reviewReasons: expect.arrayContaining(['部分表达优化因依据不完整已自动省略。']),
      },
    })
  })

  it('salvages a valid logic issue beside a malformed sibling', () => {
    const payload = payloadWithLogicIssue()
    ;((payload.fullTextRevision as Record<string, unknown>).logicIssues as unknown[]).push({ issueKey: 'logic-cat', malformed: true })

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'partial', fullTextRevision: { logicIssues: [expect.objectContaining({ originalText: 'My cat is blue.' })] },
        reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']),
      },
    })
  })

  it('salvages a valid legibility issue beside a malformed sibling', () => {
    const payload = payloadWithCantAmbiguity()
    ;(payload.legibilityIssues as unknown[]).push({ issueKey: 'legibility-blue', malformed: true })

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'partial', legibilityIssues: [expect.objectContaining({ transcriptText: 'It are blue.' })],
        reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']),
      },
    })
  })

  it.each(['logic', 'legibility'] as const)('keeps a valid %s issue beside an exact malformed extra-key clone', (kind) => {
    const payload = kind === 'logic' ? payloadWithLogicIssue() : payloadWithCantAmbiguity()
    if (kind === 'logic') {
      const logicIssues = (payload.fullTextRevision as Record<string, unknown>).logicIssues as Array<Record<string, unknown>>
      logicIssues.push({ ...logicIssues[0], extra: true })
    } else {
      const legibilityIssues = payload.legibilityIssues as Array<Record<string, unknown>>
      legibilityIssues.push({ ...legibilityIssues[0], extra: true })
    }

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({ ok: true, result: { status: 'partial' } })
    if (!normalized.ok) return
    expect(kind === 'logic' ? normalized.result.fullTextRevision.logicIssues : normalized.result.legibilityIssues).toHaveLength(1)
  })

  it('salvages a valid logic note beside a malformed sibling', () => {
    const payload = validPayload()
    ;((payload.fullTextRevision as Record<string, unknown>).logicNotes as unknown[]).push({ malformed: true })

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'partial', fullTextRevision: { logicNotes: ['The opening subject-verb agreement weakens clarity.'] },
        reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']),
      },
    })
  })

  it('salvages a grounded issue when a structurally valid sibling is ungrounded', () => {
    const payload = validPayload()
    ;(payload.issues as unknown[]).push({
      issueKey: 'unmatched-grammar', type: 'grammar', severity: 'low', originalText: 'Invented quote.', suggestion: 'Synthetic.',
      explanation: 'Synthetic.', evidenceCertainty: 'certain', requiresTeacherReview: false,
    })

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'partial', issues: [expect.objectContaining({ originalText: 'It are blue.' })],
        reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']),
      },
    })
  })

  it('does not expose an ungrounded issue quote through provider narratives or localized support', () => {
    const payload = validPayload()
    ;(payload.issues as unknown[]).push({
      issueKey: 'unmatched-grammar', type: 'grammar', severity: 'low', originalText: 'SECRET-INVENTED-QUOTE', suggestion: 'SECRET-CORRECTION',
      explanation: 'Synthetic grammar.', evidenceCertainty: 'certain', requiresTeacherReview: false,
    })
    const content = (payload.dimensionScores as Array<Record<string, unknown>>)[0]
    content.reason = 'Change SECRET-INVENTED-QUOTE to SECRET-CORRECTION.'
    content.evidence = 'I has a pen.'
    content.relatedIssueKeys = ['unmatched-grammar']
    payload.overallComment = 'Change SECRET-INVENTED-QUOTE to SECRET-CORRECTION.'

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial', overallComment: '已依据评分标准完成批改。',
        dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'content', evidence: payload.transcript })]),
      },
    })
    expect(JSON.stringify(normalized)).not.toMatch(/SECRET-INVENTED-QUOTE|SECRET-CORRECTION/)
  })

  const suppressedReferenceSurfaces = [
    'other issue', 'upgrade source', 'upgrade narrative', 'revision source', 'revision narrative', 'pair source', 'pair narrative',
    'logic note quote', 'logic note narrative', 'logic context', 'logic narrative', 'recognition warning', 'overall support', 'dimension support',
  ] as const

  describe.each(['type-null', 'extra-key', 'ungrounded-grammar', 'duplicate'] as const)(
    'suppressed %s issue references',
    (variant) => {
      it.each(suppressedReferenceSurfaces)('cannot reappear through %s', (surface) => {
        const { payload, issueKey, originalText, suggestion } = payloadWithSuppressedIssueVariant(variant)
        const leak = `Change ${originalText} to ${suggestion}.`
        const candidateSource = originalText
        const fullTextRevision = payload.fullTextRevision as Record<string, unknown>
        if (surface === 'other issue') {
          ;(payload.issues as unknown[]).push({
            issueKey: 'leaky-grammar', type: 'grammar', severity: 'low', originalText: 'I has a pen.', suggestion: leak,
            explanation: leak, evidenceCertainty: 'certain', requiresTeacherReview: false,
          })
        }
        if (surface === 'upgrade source') payload.expressionUpgrades = [{ originalText: candidateSource, upgradedText: 'Use a stronger phrase.', note: 'Style.' }]
        if (surface === 'upgrade narrative') payload.expressionUpgrades = [{ originalText: 'I has a pen.', upgradedText: leak, note: leak }]
        if (surface === 'revision source') payload.sentenceRevisions = [{ originalText: candidateSource, revisedText: 'Use a stronger phrase.', note: 'Style.', relatedIssueKeys: ['grammar-blue'], changeTypes: ['grammar'] }]
        if (surface === 'revision narrative') payload.sentenceRevisions = [{ originalText: 'I has a pen.', revisedText: leak, note: leak, relatedIssueKeys: ['grammar-blue'], changeTypes: ['grammar'] }]
        if (surface === 'pair source') fullTextRevision.sentencePairs = [{ originalText: candidateSource, correctedText: 'Use a stronger phrase.', improvedText: 'Use a vivid phrase.', relatedIssueKeys: ['grammar-blue'], changeTypes: ['grammar'], explanation: 'Style.', requiresTeacherReview: false }]
        if (surface === 'pair narrative') fullTextRevision.sentencePairs = [{ originalText: 'I has a pen.', correctedText: leak, improvedText: leak, relatedIssueKeys: ['grammar-blue'], changeTypes: ['grammar'], explanation: leak, requiresTeacherReview: false }]
        if (surface === 'logic note quote') fullTextRevision.logicNotes = [{ quote: candidateSource, note: 'Check the connection.' }]
        if (surface === 'logic note narrative') fullTextRevision.logicNotes = [{ quote: 'I has a pen.', note: leak }]
        if (surface === 'logic context') fullTextRevision.logicIssues = [{
          issueKey: 'leaky-logic', originalText: 'I has a pen.', contextBefore: candidateSource, contextAfter: '',
          subType: 'unclear_logic', severity: 'low', diagnosis: 'Check the connection.', suggestedAction: 'add_bridge_sentence',
          conservativeSuggestion: 'Explain the connection.', polishedSuggestion: 'Add a bridge.', requiresTeacherReview: false,
        }]
        if (surface === 'logic narrative') fullTextRevision.logicIssues = [{
          issueKey: 'leaky-logic', originalText: 'I has a pen.', contextBefore: '', contextAfter: '',
          subType: 'unclear_logic', severity: 'low', diagnosis: leak, suggestedAction: 'add_bridge_sentence',
          conservativeSuggestion: leak, polishedSuggestion: leak, requiresTeacherReview: false,
        }]
        if (surface === 'recognition warning') payload.recognitionWarnings = [{ scope: 'global_unreadable', message: leak }]
        if (surface === 'overall support') payload.overallComment = leak
        if (surface === 'dimension support') {
          const content = (payload.dimensionScores as Array<Record<string, unknown>>)[0]
          content.reason = leak
          content.evidence = candidateSource
          content.relatedIssueKeys = [issueKey]
        }

        const normalized = normalizeMultimodalResult(payload, context)

        const extraKeySuppressionIsSilent = variant === 'extra-key' && [
          'upgrade source', 'upgrade narrative', 'logic note quote', 'logic note narrative',
          'recognition warning', 'overall support', 'dimension support',
        ].includes(surface)

        expect(normalized).toMatchObject({
          ok: true,
          result: {
            status: extraKeySuppressionIsSilent ? 'success' : 'partial',
            issues: [expect.objectContaining({ type: 'grammar', originalText: 'It are blue.' })],
          },
        })
        if (!normalized.ok) return
        const result = normalized.result
        if (surface.startsWith('upgrade')) expect(result.expressionUpgrades).toEqual([])
        if (surface.startsWith('revision')) expect(result.sentenceRevisions).toEqual([])
        if (surface.startsWith('pair')) expect(result.fullTextRevision.sentencePairs).toEqual([])
        if (surface.startsWith('logic note')) expect(result.fullTextRevision.logicNotes).toEqual([])
        if (surface.startsWith('logic ')) expect(result.fullTextRevision.logicIssues).toEqual([])
        if (surface === 'recognition warning') expect(result.recognitionWarnings).toEqual([])
        if (surface === 'overall support') expect(result.overallComment).toBe('已依据评分标准完成批改。')
        if (surface === 'dimension support') expect(result.dimensionScores[0]).toMatchObject({
          reason: variant === 'extra-key' || variant === 'duplicate' ? '该维度未发现需扣分的问题。' : '该维度评分依据需教师复核。',
          evidence: payload.transcript,
        })
        expect(JSON.stringify(result)).not.toContain(leak)
        if (variant === 'ungrounded-grammar') expect(JSON.stringify(result)).not.toMatch(/SECRET-INVENTED-QUOTE|SECRET-CORRECTION/)
      })
    },
  )

  it.each([
    ['sentence revision', false],
    ['sentence pair', true],
  ] as const)('salvages a grounded %s when a structurally valid sibling is ungrounded', (_label, usePair) => {
    const payload = validPayload()
    const grounded = usePair
      ? { originalText: 'It are blue.', correctedText: 'It is blue.', improvedText: 'It is bright blue.', relatedIssueKeys: ['grammar-blue'], changeTypes: ['grammar'], explanation: 'Fix agreement.', requiresTeacherReview: false }
      : { originalText: 'It are blue.', revisedText: 'It is blue.', note: 'Fix agreement.', relatedIssueKeys: ['grammar-blue'], changeTypes: ['grammar'] }
    const ungrounded = usePair
      ? { originalText: 'Invented quote.', correctedText: 'Synthetic.', improvedText: 'Synthetic.', relatedIssueKeys: ['grammar-blue'], changeTypes: ['grammar'], explanation: 'Synthetic.', requiresTeacherReview: false }
      : { originalText: 'Invented quote.', revisedText: 'Synthetic.', note: 'Synthetic.', relatedIssueKeys: ['grammar-blue'], changeTypes: ['grammar'] }
    if (usePair) (payload.fullTextRevision as Record<string, unknown>).sentencePairs = [grounded, ungrounded]
    else payload.sentenceRevisions = [grounded, ungrounded]

    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial', reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']),
      },
    })
    if (!normalized.ok) return
    expect(usePair ? normalized.result.fullTextRevision.sentencePairs : normalized.result.sentenceRevisions).toEqual([
      expect.objectContaining({ originalText: 'It are blue.' }),
    ])
  })

  it.each([
    ['sentence revision', false],
    ['sentence pair', true],
  ] as const)('salvages an independent %s when sibling edit locations conflict', (_label, usePair) => {
    const payload = validPayload()
    const makeEdit = (originalText: string, replacement: string) => usePair
      ? { originalText, correctedText: replacement, improvedText: replacement, relatedIssueKeys: ['grammar-blue'], changeTypes: ['grammar'], explanation: 'Synthetic.', requiresTeacherReview: false }
      : { originalText, revisedText: replacement, note: 'Synthetic.', relatedIssueKeys: ['grammar-blue'], changeTypes: ['grammar'] }
    const edits = [
      makeEdit('I has a pen.', 'I have a pen.'),
      makeEdit('It are blue.', 'It is blue.'),
      makeEdit('It are blue.', 'It looks blue.'),
    ]
    if (usePair) (payload.fullTextRevision as Record<string, unknown>).sentencePairs = edits
    else payload.sentenceRevisions = edits

    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial', reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']),
      },
    })
    if (!normalized.ok) return
    expect(usePair ? normalized.result.fullTextRevision.sentencePairs : normalized.result.sentenceRevisions).toEqual([
      expect.objectContaining({ originalText: 'I has a pen.' }),
    ])
  })

  it('salvages only globally unique issue keys when other declarations collide', () => {
    const payload = validPayload()
    ;(payload.issues as unknown[]).push(
      { issueKey: 'duplicate-key', type: 'word_choice', severity: 'low', originalText: 'I has a pen.', suggestion: 'Synthetic one.', explanation: 'Synthetic.', evidenceCertainty: 'certain', requiresTeacherReview: false },
      { issueKey: 'duplicate-key', type: 'structure', severity: 'low', originalText: 'I has', suggestion: 'Synthetic two.', explanation: 'Synthetic.', evidenceCertainty: 'certain', requiresTeacherReview: false },
    )

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'partial', issues: [expect.objectContaining({ originalText: 'It are blue.' })],
        reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']),
      },
    })
  })

  it.each([
    ['sentence revision', false],
    ['sentence pair', true],
  ] as const)('omits a %s with an unknown issue relation and requests review', (_label, usePair) => {
    const payload = validPayload()
    const edit = usePair
      ? { originalText: 'It are blue.', correctedText: 'It is blue.', improvedText: 'It is bright blue.', relatedIssueKeys: ['missing-issue'], changeTypes: ['grammar'], explanation: 'Fix agreement.', requiresTeacherReview: false }
      : { originalText: 'It are blue.', revisedText: 'It is blue.', note: 'Fix agreement.', relatedIssueKeys: ['missing-issue'], changeTypes: ['grammar'] }
    if (usePair) (payload.fullTextRevision as Record<string, unknown>).sentencePairs = [edit]
    else payload.sentenceRevisions = [edit]

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial',
        reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']),
      },
    })
    if (!normalized.ok) return
    expect(usePair ? normalized.result.fullTextRevision.sentencePairs : normalized.result.sentenceRevisions).toEqual([])
  })

  it.each([
    ['sentence revision', false],
    ['sentence pair', true],
  ] as const)('omits a %s linked only to a legibility key before public projection', (_label, usePair) => {
    const payload = payloadWithCantAmbiguity()
    const edit = usePair
      ? { originalText: 'I has a pen.', correctedText: 'I have a pen.', improvedText: 'I own a pen.', relatedIssueKeys: ['legibility-blue'], changeTypes: ['grammar'], explanation: 'Synthetic edit.', requiresTeacherReview: false }
      : { originalText: 'I has a pen.', revisedText: 'I have a pen.', note: 'Synthetic edit.', relatedIssueKeys: ['legibility-blue'], changeTypes: ['grammar'] }
    if (usePair) (payload.fullTextRevision as Record<string, unknown>).sentencePairs = [edit]
    else payload.sentenceRevisions = [edit]

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial', legibilityIssues: [expect.any(Object)],
        reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']),
      },
    })
    if (!normalized.ok) return
    expect(usePair ? normalized.result.fullTextRevision.sentencePairs : normalized.result.sentenceRevisions).toEqual([])
  })

  it('ignores legacy Provider aggregate length because public revisions are rebuilt locally', () => {
    const atLimit = validPayload()
    ;(atLimit.fullTextRevision as Record<string, unknown>).correctedText = 'x'.repeat(50_000)
    expect(normalizeMultimodalResult(atLimit, context)).toMatchObject({
      ok: true, result: { status: 'success', fullTextRevision: { correctedText: atLimit.transcript } },
    })

    const overLimit = validPayload()
    ;(overLimit.fullTextRevision as Record<string, unknown>).correctedText = 'x'.repeat(50_001)
    expect(normalizeMultimodalResult(overLimit, context)).toMatchObject({
      ok: true, result: { status: 'success', fullTextRevision: { correctedText: overLimit.transcript } },
    })
  })

  it('drops sentence-pair edits whose rebuilt full text exceeds the public limit', () => {
    const payload = validPayload()
    ;(payload.fullTextRevision as Record<string, unknown>).sentencePairs = [{
      originalText: 'It are blue.', correctedText: 'x'.repeat(50_000), improvedText: 'y'.repeat(50_000),
      relatedIssueKeys: ['grammar-blue'], changeTypes: ['grammar'], explanation: 'Synthetic oversized rebuild.', requiresTeacherReview: false,
    }]

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'partial', totalScore: 12,
        fullTextRevision: {
          correctedText: payload.transcript, improvedText: payload.transcript, sentencePairs: [],
        },
        reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']),
      },
    })
  })

  it('measures bounded identifiers before trimming so runtime matches the Provider schema', () => {
    const setIssueKey = (payload: Record<string, unknown>, issueKey: string) => {
      ;(payload.issues as Array<Record<string, unknown>>)[0].issueKey = issueKey
      for (const dimension of payload.dimensionScores as Array<Record<string, unknown>>) {
        if ((dimension.relatedIssueKeys as string[]).length > 0) dimension.relatedIssueKeys = [issueKey]
      }
    }
    const atLimit = validPayload()
    setIssueKey(atLimit, 'x'.repeat(200))
    expect(normalizeMultimodalResult(atLimit, context)).toMatchObject({ ok: true })

    const overLimitAfterTrimming = validPayload()
    setIssueKey(overLimitAfterTrimming, ` ${'x'.repeat(200)}`)
    expect(normalizeMultimodalResult(overLimitAfterTrimming, context)).toMatchObject({ ok: true, result: { status: 'partial', issues: [] } })
  })

  it('omits whitespace-only relationship identifiers but still rejects a negative core score', () => {
    const whitespaceKey = validPayload()
    ;(whitespaceKey.issues as Array<Record<string, unknown>>)[0].issueKey = '   '
    ;(whitespaceKey.dimensionScores as Array<Record<string, unknown>>)[0].relatedIssueKeys = ['   ']
    expect(normalizeMultimodalResult(whitespaceKey, context)).toMatchObject({ ok: true, result: { status: 'partial', issues: [] } })

    const negativeScore = validPayload()
    ;(negativeScore.dimensionScores as Array<Record<string, unknown>>)[0].score = -0.01
    expect(normalizeMultimodalResult(negativeScore, context)).toMatchObject({ ok: false })
  })

  it('omits auxiliary feedback with raw quote whitespace drift while retaining the score', () => {
    for (const mutate of [
      (payload: Record<string, unknown>) => { ;(payload.issues as Array<Record<string, unknown>>)[0].originalText = 'It  are blue.' },
      (payload: Record<string, unknown>) => { ;(payload.sentenceRevisions as Array<Record<string, unknown>>)[0].originalText = 'It  are blue.' },
      (payload: Record<string, unknown>) => { ;((payload.fullTextRevision as Record<string, unknown>).sentencePairs as Array<Record<string, unknown>>)[0].originalText = 'It  are blue.' },
      (payload: Record<string, unknown>) => { ;(payload.fullTextRevision as Record<string, unknown>).logicIssues = [{ issueKey: 'logic', originalText: 'It  are blue.', contextBefore: 'I has a pen.', contextAfter: '', subType: 'unclear_logic', severity: 'low', diagnosis: 'Synthetic.', suggestedAction: 'add_bridge_sentence', conservativeSuggestion: 'Synthetic.', polishedSuggestion: 'Synthetic.', requiresTeacherReview: false }] },
      (payload: Record<string, unknown>) => { payload.legibilityIssues = [{ issueKey: 'legibility', transcriptText: 'It  are blue.', possibleReadings: ['It are blue.', 'It is blue.'], pageNumber: 1, regionDescription: 'line', explanation: 'Synthetic.', defaultOutcome: 'count_as_legibility_error' }] },
    ]) { const payload = validPayload(); payload.sentenceRevisions = [{ originalText: 'It are blue.', revisedText: 'It is blue.', note: 'Synthetic.', relatedIssueKeys: ['grammar-blue'], changeTypes: ['grammar'] }]; (payload.fullTextRevision as Record<string, unknown>).sentencePairs = [{ originalText: 'It are blue.', correctedText: 'It is blue.', improvedText: 'It is blue.', relatedIssueKeys: ['grammar-blue'], changeTypes: ['grammar'], explanation: 'Synthetic.', requiresTeacherReview: false }]; mutate(payload); expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: true, result: { status: 'partial', reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']) } }) }
  })

  it('omits or regrounds every whitespace-only auxiliary quote even when the space is unique', () => {
    const cases: Array<{ name: string; mutate: (payload: Record<string, unknown>) => void; assertSafe: (result: MultimodalGradingResult) => void }> = [
      {
        name: 'issue originalText',
        mutate: (payload) => { payload.issues = [{ issueKey: 'space-issue', type: 'grammar', severity: 'low', originalText: ' ', suggestion: 'Synthetic.', explanation: 'Synthetic.', evidenceCertainty: 'certain', requiresTeacherReview: false }] },
        assertSafe: (result) => expect(result.issues).toEqual([]),
      },
      {
        name: 'sentence revision originalText',
        mutate: (payload) => { payload.sentenceRevisions = [{ originalText: ' ', revisedText: 'Synthetic.', note: 'Synthetic.', relatedIssueKeys: [], changeTypes: ['grammar'] }] },
        assertSafe: (result) => expect(result.sentenceRevisions).toEqual([]),
      },
      {
        name: 'sentence pair originalText',
        mutate: (payload) => { (payload.fullTextRevision as Record<string, unknown>).sentencePairs = [{ originalText: ' ', correctedText: 'x', improvedText: 'y', relatedIssueKeys: [], changeTypes: ['grammar'], explanation: 'Synthetic.', requiresTeacherReview: false }] },
        assertSafe: (result) => expect(result.fullTextRevision.sentencePairs).toEqual([]),
      },
      {
        name: 'expression upgrade originalText',
        mutate: (payload) => { payload.expressionUpgrades = [{ originalText: ' ', upgradedText: 'Synthetic.', note: 'Synthetic.' }] },
        assertSafe: (result) => expect(result.expressionUpgrades).toEqual([]),
      },
      {
        name: 'logic issue originalText',
        mutate: (payload) => { (payload.fullTextRevision as Record<string, unknown>).logicIssues = [{ issueKey: 'space-logic', originalText: ' ', contextBefore: '', contextAfter: '', subType: 'unclear_logic', severity: 'low', diagnosis: 'Synthetic.', suggestedAction: 'add_bridge_sentence', conservativeSuggestion: 'Synthetic.', polishedSuggestion: 'Synthetic.', requiresTeacherReview: false }] },
        assertSafe: (result) => expect(result.fullTextRevision.logicIssues).toEqual([]),
      },
      {
        name: 'logic issue context',
        mutate: (payload) => { (payload.fullTextRevision as Record<string, unknown>).logicIssues = [{ issueKey: 'space-context', originalText: 'B', contextBefore: ' ', contextAfter: '', subType: 'unclear_logic', severity: 'low', diagnosis: 'Synthetic.', suggestedAction: 'add_bridge_sentence', conservativeSuggestion: 'Synthetic.', polishedSuggestion: 'Synthetic.', requiresTeacherReview: false }] },
        assertSafe: (result) => expect(result.fullTextRevision.logicIssues).toEqual([]),
      },
      {
        name: 'legibility transcriptText',
        mutate: (payload) => { payload.legibilityIssues = [{ issueKey: 'space-legibility', transcriptText: ' ', possibleReadings: ['A', 'B'], pageNumber: 1, regionDescription: 'middle', explanation: 'Synthetic.', defaultOutcome: 'count_as_legibility_error' }] },
        assertSafe: (result) => expect(result.legibilityIssues).toEqual([]),
      },
      {
        name: 'logic note quote',
        mutate: (payload) => { (payload.fullTextRevision as Record<string, unknown>).logicNotes = [{ quote: ' ', note: 'Synthetic.' }] },
        assertSafe: (result) => expect(result.fullTextRevision.logicNotes).toEqual([]),
      },
      {
        name: 'dimension evidence',
        mutate: (payload) => { (payload.dimensionScores as Array<Record<string, unknown>>)[0].evidence = ' ' },
        assertSafe: (result) => expect(result.dimensionScores[0]).toMatchObject({ evidence: 'A B', requiresTeacherReview: true }),
      },
    ]

    for (const testCase of cases) {
      const payload = payloadWithOneTranscriptSpace()
      testCase.mutate(payload)
      const normalized = normalizeMultimodalResult(payload, context)
      expect(normalized, testCase.name).toMatchObject({
        ok: true,
        result: {
          status: 'partial', totalScore: 15,
          reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']),
        },
      })
      if (normalized.ok) testCase.assertSafe(normalized.result)
    }
  })

  it('ignores an invalid reported total and blank aggregate, and marks a finite mismatch partial', () => {
    const invalidTotal = validPayload(); invalidTotal.reportedTotalScore = '12'; expect(normalizeMultimodalResult(invalidTotal, context)).toMatchObject({ ok: true, result: { status: 'partial', totalScore: 12 } })
    const blankImproved = validPayload(); ;(blankImproved.fullTextRevision as Record<string, unknown>).improvedText = ' '; expect(normalizeMultimodalResult(blankImproved, context)).toMatchObject({ ok: true })
    const mismatch = validPayload(); mismatch.reportedTotalScore = 14; expect(normalizeMultimodalResult(mismatch, context)).toMatchObject({ ok: true, result: { status: 'partial', reviewReasons: expect.arrayContaining(['AI 自报总分与产品重算总分不一致。']) } })
  })

  it('returns a reviewable score when a deducted dimension has no linked issue', () => {
    const payload = validPayload()
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].relatedIssueKeys = []

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial',
        totalScore: 12,
        dimensionScores: expect.arrayContaining([
          expect.objectContaining({ dimensionId: 'content', score: 4.8, requiresTeacherReview: true }),
        ]),
        reviewReasons: expect.arrayContaining(['部分维度评分依据不完整，建议教师复核。']),
      },
    })
  })

  it('regrounds an unlinked deducted dimension and still returns its original score for review', () => {
    const payload = validPayload()
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].relatedIssueKeys = []
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].evidence = 'Invented paraphrase.'

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial',
        totalScore: 12,
        dimensionScores: expect.arrayContaining([
          expect.objectContaining({ dimensionId: 'content', score: 4.8, requiresTeacherReview: true }),
        ]),
        reviewReasons: expect.arrayContaining([
          '部分维度评分依据不完整，建议教师复核。',
          '部分维度证据未能逐字定位，已改用可定位的原文证据。',
        ]),
      },
    })
    if (normalized.ok) expect(normalized.result.dimensionScores[0]?.evidence).not.toBe('Invented paraphrase.')
  })

  it('drops an unknown dimension relationship while preserving the bounded score for review', () => {
    const payload = validPayload()
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].relatedIssueKeys = ['missing-provider-key']

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'partial', totalScore: 12,
        dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'content', score: 4.8, requiresTeacherReview: true })]),
        reviewReasons: expect.arrayContaining(['部分维度评分依据不完整，建议教师复核。']),
      },
    })
  })

  it('regrounds dimension evidence only from an already-linked exact issue quote', () => {
    const payload = validPayload()
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[1].evidence = 'Invented paraphrase.'

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial',
        dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'language', evidence: 'It are blue.' })]),
        reviewReasons: expect.arrayContaining(['部分维度证据未能逐字定位，已改用可定位的原文证据。']),
      },
    })
  })

  it('regrounds whitespace-only dimension evidence from its linked issue', () => {
    const payload = validPayload()
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].evidence = '   '
    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: { status: 'partial', dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'content', evidence: 'It are blue.' })]) },
    })
  })

  it('keeps grammar, suppresses overlapping spelling, and preserves the score as reviewable', () => {
    const payload = validPayload()
    ;(payload.issues as Array<Record<string, unknown>>).push({
      issueKey: 'spelling-blue', type: 'spelling', severity: 'low', originalText: 'It are blue.',
      suggestion: 'It is blue.', explanation: 'Synthetic duplicate.', evidenceCertainty: 'certain', requiresTeacherReview: false,
    })

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: { issues: [expect.objectContaining({ type: 'grammar' })] },
    })

    const linked = structuredClone(payload)
    ;(linked.dimensionScores as Array<Record<string, unknown>>)[1].relatedIssueKeys = ['grammar-blue', 'spelling-blue']
    expect(normalizeMultimodalResult(linked, context)).toMatchObject({
      ok: true,
      result: {
        status: 'partial',
        totalScore: 12,
        issues: [expect.objectContaining({ type: 'grammar' })],
        dimensionScores: expect.arrayContaining([
          expect.objectContaining({ dimensionId: 'language', score: 6.45, requiresTeacherReview: true }),
        ]),
        reviewReasons: expect.arrayContaining(['部分维度评分依据不完整，建议教师复核。']),
      },
    })
  })

  it('treats uncertain spelling as correct and restores a dimension deducted only for that issue', () => {
    const payload = validPayload()
    ;(payload.issues as Array<Record<string, unknown>>).push({
      issueKey: 'spelling-has', type: 'spelling', severity: 'low', originalText: 'I has a pen.',
      suggestion: 'I have a pen.', explanation: 'The letter shape is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    })
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].relatedIssueKeys = ['spelling-has']
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].reason = 'A possible spelling form affected this dimension.'

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'success',
        totalScore: 13,
        issues: [expect.not.objectContaining({ type: 'spelling' })],
        dimensionScores: expect.arrayContaining([
          expect.objectContaining({
            dimensionId: 'content', score: 6, maxScore: 6,
            reason: '该维度未发现需扣分的问题。',
          }),
        ]),
        reviewReasons: [],
      },
    })
  })

  it('keeps only expression upgrades whose exact quote is uniquely grounded', () => {
    const collapsed = validPayload()
    collapsed.expressionUpgrades = [
      { originalText: 'I has a pen.', upgradedText: 'I have a pen.', note: 'Grounded.' },
      { originalText: 'I  has a pen.', upgradedText: 'I have a pen.', note: 'Ungrounded.' },
    ]
    expect(normalizeMultimodalResult(collapsed, context)).toMatchObject({
      ok: true,
      result: {
        status: 'partial',
        expressionUpgrades: [{ originalText: 'I has a pen.' }],
        reviewReasons: expect.arrayContaining(['部分表达优化因无法定位到原文已自动省略。']),
      },
    })

    const duplicate = validPayload()
    duplicate.transcript = 'Repeated source. Repeated source.'
    duplicate.issues = []
    duplicate.sentenceRevisions = []
    duplicate.expressionUpgrades = [{ originalText: 'Repeated source.', upgradedText: 'Improved source.', note: 'Synthetic.' }]
    duplicate.fullTextRevision = { correctedText: 'Repeated source. Repeated source.', improvedText: 'Improved.', sentencePairs: [], logicNotes: [], logicIssues: [] }
    expect(normalizeMultimodalResult(duplicate, context)).toMatchObject({
      ok: true,
      result: { status: 'partial', expressionUpgrades: [], reviewReasons: expect.arrayContaining(['部分表达优化因无法定位到原文已自动省略。']) },
    })

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

  it.each(['originalText', 'contextBefore', 'contextAfter'] as const)('omits an ungrounded structured logic %s while retaining the score', (field) => {
    const payload = payloadWithLogicIssue()
    ;(((payload.fullTextRevision as Record<string, unknown>).logicIssues as Array<Record<string, unknown>>)[0])[field] = 'Invented logic source.'

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: { status: 'partial', fullTextRevision: { logicIssues: [] }, reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']) },
    })
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

  it('omits a logic contextBefore that appears after the diagnosed text', () => {
    const payload = payloadWithLogicContext('My cat is blue. Before the party. After the party.', 'Before the party.', 'After the party.')

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: true, result: { status: 'partial', fullTextRevision: { logicIssues: [] } } })
  })

  it('omits a logic contextAfter that appears before the diagnosed text', () => {
    const payload = payloadWithLogicContext('Before the party. After the party. My cat is blue.', 'Before the party.', 'After the party.')

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: true, result: { status: 'partial', fullTextRevision: { logicIssues: [] } } })
  })

  it('ignores a blank Provider corrected aggregate when structured logic can be safely projected', () => {
    const payload = payloadWithLogicIssue()
    ;(payload.fullTextRevision as Record<string, unknown>).correctedText = ''

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true, result: { fullTextRevision: { correctedText: payload.transcript, logicIssues: [{ originalText: 'My cat is blue.' }] } },
    })
  })

  it('keeps a local legibility ambiguity visible in the total and isolates it from other deductions', () => {
    const normalized = normalizeMultimodalResult(payloadWithCantAmbiguity(), context)
    expect(normalized.ok).toBe(true)
    if (!normalized.ok) throw new Error(normalized.error.message)

    expect(normalized.result).toMatchObject({
      status: 'partial', totalScore: 14,
      reviewReasons: expect.arrayContaining(['AI 自报总分与产品重算总分不一致。']),
    })
    expect(normalized.result.legibilityIssues).toMatchObject([{
      id: 'essay-normalize-legibility-1', possibleReadings: ['It are blue.', 'It is blue.'], defaultOutcome: 'count_as_legibility_error',
    }])
    expect(normalized.result.reviewReasons).not.toContain('recognition_uncertain')
    expect(normalized.result.issues).toEqual([])
    expect((normalized.result.fullTextRevision as unknown as { logicIssues?: unknown[] } | undefined)?.logicIssues).toEqual([])
    expect(normalized.result.dimensionScores.filter(({ evidence }) => evidence.includes('It are blue.')).map(({ dimensionId }) => dimensionId)).toEqual(['legibility'])
  })

  it('omits a legibility location beyond the uploaded image pages while retaining the score', () => {
    const payload = payloadWithCantAmbiguity()
    ;(payload.legibilityIssues as Array<Record<string, unknown>>)[0].pageNumber = 2

    expect(normalizeMultimodalResult(payload, { ...context, pageCount: 1 })).toMatchObject({ ok: true, result: { status: 'partial', legibilityIssues: [] } })
  })

  it('omits legibility findings during a confirmed-text regrade while retaining the score', () => {
    const payload = payloadWithCantAmbiguity()
    const transcript = payload.transcript as string

    expect(normalizeMultimodalResult(payload, { ...context, confirmedTranscript: transcript, pageCount: 0 })).toMatchObject({ ok: true, result: { status: 'partial', legibilityIssues: [] } })
  })

  it('accepts recognition warnings and safely ignores the legacy field', () => {
    const payload = validPayload()
    payload.recognitionWarnings = [{ scope: 'global_unreadable', message: 'A page is globally unclear.' }]

    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({
      ok: true,
      result: {
        recognitionWarnings: ['A page is globally unclear.'],
        reviewReasons: expect.arrayContaining(['recognition_uncertain']),
        status: 'partial',
      },
    })

    const legacyPayload = validPayload()
    delete legacyPayload.recognitionWarnings
    legacyPayload.transcriptionWarnings = ['A word is unclear.']
    const legacy = normalizeMultimodalResult(legacyPayload, context)
    expect(legacy).toMatchObject({ ok: true, result: { status: 'partial', recognitionWarnings: [] } })
  })

  it('returns the faithful student transcript and rubric-derived weighted scores', () => {
    const normalized = normalizeMultimodalResult(validPayload(), context)
    expect(normalized.ok).toBe(true)
    if (!normalized.ok) throw new Error(normalized.error.message)
    expect(normalized.result).toMatchObject({ transcript: 'I has a pen.\nIt are blue.', printedTextExcluded: true, totalScore: 12, maxScore: 15, status: 'success' })
    expect(normalized.result.dimensionScores.map(({ maxScore }) => maxScore)).toEqual([6, 8.25, 0.75])
  })

  it('rebuilds both public aggregate revisions when optimized Provider output omits them', () => {
    const payload = validPayload()
    const fullTextRevision = payload.fullTextRevision as Record<string, unknown>
    delete fullTextRevision.correctedText
    delete fullTextRevision.improvedText
    fullTextRevision.sentencePairs = [{
      originalText: 'It are blue.', correctedText: 'It is blue.', improvedText: 'It looks blue.',
      relatedIssueKeys: ['grammar-blue'], changeTypes: ['grammar'], explanation: 'Fix agreement.', requiresTeacherReview: false,
    }]

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'success',
        reviewReasons: [],
        fullTextRevision: {
          correctedText: 'I has a pen.\nIt is blue.',
          improvedText: 'I has a pen.\nIt looks blue.',
          sentencePairs: [expect.objectContaining({ originalText: 'It are blue.' })],
        },
      },
    })
  })

  it('preserves a bounded numeric model self-confidence value', () => {
    const payload = validPayload()
    payload.modelSelfConfidence = 0.72

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: { modelSelfConfidence: 0.72 },
    })
  })

  it('marks recognition uncertainty as partial with a stable reason', () => {
    const payload = validPayload()
    payload.recognitionWarnings = [{ scope: 'printed_boundary', message: 'The printed boundary is unclear.' }]
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

  it.each([
    ['separable revision', false, false],
    ['inseparable revision', false, true],
    ['separable pair', true, false],
    ['inseparable pair', true, true],
  ] as const)('handles a %s with mixed grammar/spelling support', (_label, usePair, containsSpellingLeak) => {
    const payload = payloadWithMixedSpellingAndGrammar()
    const note = containsSpellingLeak ? 'Fix agreement and change wark to work.' : 'Fix agreement.'
    const edit = usePair
      ? { originalText: 'It are blue.', correctedText: 'It is blue.', improvedText: 'It looks blue.', relatedIssueKeys: ['grammar-blue', 'spelling-wark'], changeTypes: ['grammar', 'spelling'], explanation: note, requiresTeacherReview: false }
      : { originalText: 'It are blue.', revisedText: 'It is blue.', note, relatedIssueKeys: ['grammar-blue', 'spelling-wark'], changeTypes: ['grammar', 'spelling'] }
    if (usePair) (payload.fullTextRevision as Record<string, unknown>).sentencePairs = [edit]
    else payload.sentenceRevisions = [edit]

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial',
        issues: [expect.objectContaining({ type: 'grammar', originalText: 'It are blue.' })],
        reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']),
      },
    })
    if (!normalized.ok) return
    const edits = usePair ? normalized.result.fullTextRevision.sentencePairs : normalized.result.sentenceRevisions
    if (containsSpellingLeak) {
      expect(edits).toEqual([])
    } else {
      expect(edits).toEqual([expect.objectContaining({ changeTypes: ['grammar'], relatedIssueIds: ['essay-normalize-issue-1'] })])
    }
    expect(JSON.stringify(normalized)).not.toContain('change wark to work')
  })

  it.each(['expression upgrade', 'logic note'] as const)('marks a removed mixed spelling/grammar %s for review', (kind) => {
    const payload = payloadWithMixedSpellingAndGrammar()
    if (kind === 'expression upgrade') {
      payload.expressionUpgrades = [{ originalText: 'It are blue.', upgradedText: 'Fix grammar and change wark to work.', note: 'Mixed feedback.' }]
    } else {
      ;(payload.fullTextRevision as Record<string, unknown>).logicNotes = [{ quote: 'It are blue.', note: 'Fix grammar and change wark to work.' }]
    }

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial',
        issues: [expect.objectContaining({ type: 'grammar' })],
        reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']),
      },
    })
    if (!normalized.ok) return
    expect(kind === 'expression upgrade' ? normalized.result.expressionUpgrades : normalized.result.fullTextRevision.logicNotes).toEqual([])
  })

  it('keeps removal of a pure uncertain-spelling logic note silent', () => {
    const payload = payloadWithUnlinkedUncertainSpelling()
    const language = (payload.dimensionScores as Array<Record<string, unknown>>)[1]
    language.score = 8.25
    language.reason = 'Accurate.'
    language.evidence = payload.transcript
    payload.reportedTotalScore = 15
    ;(payload.fullTextRevision as Record<string, unknown>).logicNotes = [{ quote: 'wark', note: 'Change wark to work.' }]

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: { status: 'success', fullTextRevision: { logicNotes: [] }, reviewReasons: [] },
    })
  })

  it('silently filters uncertain spelling and restores the score deducted only for that issue', () => {
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

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'success', totalScore: 15, issues: [],
        dimensionScores: expect.arrayContaining([expect.objectContaining({
          dimensionId: 'language', score: 8.25, maxScore: 8.25, reason: '该维度未发现需扣分的问题。',
        })]),
        reviewReasons: [],
      },
    })
  })

  it('silently restores a sole localized uncertain-spelling deduction when the Provider omitted its relation', () => {
    const payload = payloadWithUnlinkedUncertainSpelling()

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'success', totalScore: 15, issues: [], reviewReasons: [],
        dimensionScores: expect.arrayContaining([expect.objectContaining({
          dimensionId: 'language', score: 8.25, reason: '该维度未发现需扣分的问题。', evidence: payload.transcript,
        })]),
      },
    })
  })

  it('keeps an explicitly linked spelling deduction for review when its provider quote is ungrounded', () => {
    const payload = payloadWithUnlinkedUncertainSpelling()
    const spelling = (payload.issues as Array<Record<string, unknown>>)[0]
    spelling.originalText = 'SECRET-UNGROUNDED-SPELLING'
    spelling.suggestion = 'SECRET-CORRECTION'
    const language = (payload.dimensionScores as Array<Record<string, unknown>>)[1]
    language.reason = 'The uncertain spelling should be corrected.'
    language.evidence = payload.transcript
    language.relatedIssueKeys = ['spelling-wark']
    payload.overallComment = 'Change SECRET-UNGROUNDED-SPELLING to SECRET-CORRECTION.'

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial', totalScore: 14, issues: [],
        dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'language', score: 7.25, requiresTeacherReview: true })]),
        reviewReasons: expect.arrayContaining(['部分维度评分依据不完整，建议教师复核。']),
      },
    })
    expect(JSON.stringify(normalized)).not.toMatch(/SECRET-UNGROUNDED-SPELLING|SECRET-CORRECTION/)
  })

  it('silently clears a stale uncertain-spelling relation from a maximum-score dimension', () => {
    const payload = payloadWithUnlinkedUncertainSpelling()
    const language = (payload.dimensionScores as Array<Record<string, unknown>>)[1]
    language.score = 8.25
    language.relatedIssueKeys = ['spelling-wark']
    payload.reportedTotalScore = 15

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'success', totalScore: 15, issues: [], reviewReasons: [],
        dimensionScores: expect.arrayContaining([expect.objectContaining({
          dimensionId: 'language', score: 8.25, reason: '该维度未发现需扣分的问题。', evidence: payload.transcript,
        })]),
      },
    })
  })

  it.each(['grammar', 'logic'] as const)('restores an unlinked uncertain-spelling deduction when a genuine %s finding is locally unrelated', (kind) => {
    const payload = payloadWithUnlinkedUncertainSpelling()
    payload.transcript = 'I wark today. This sentence is wrong.'
    ;(payload.dimensionScores as Array<Record<string, unknown>>).forEach((dimension) => {
      if (dimension.evidence === 'I wark today.') dimension.evidence = payload.transcript
    })
    ;(payload.fullTextRevision as Record<string, unknown>).correctedText = payload.transcript
    ;(payload.fullTextRevision as Record<string, unknown>).improvedText = payload.transcript
    if (kind === 'grammar') {
      ;(payload.issues as Array<Record<string, unknown>>).push({
        issueKey: 'grammar-wrong', type: 'grammar', severity: 'medium', originalText: 'This sentence is wrong.',
        suggestion: 'This sentence is correct.', explanation: 'A genuine grammar issue.', evidenceCertainty: 'certain', requiresTeacherReview: false,
      })
    } else {
      ;(payload.fullTextRevision as Record<string, unknown>).logicIssues = [{
        issueKey: 'logic-wrong', originalText: 'This sentence is wrong.', contextBefore: '', contextAfter: '',
        subType: 'unclear_logic', severity: 'medium', diagnosis: 'A genuine logic issue.', suggestedAction: 'add_bridge_sentence',
        conservativeSuggestion: 'Explain the connection.', polishedSuggestion: 'Add a logical bridge.', requiresTeacherReview: false,
      }]
    }

    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'success', totalScore: 15,
        dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'language', score: 8.25 })]),
      },
    })
    if (!normalized.ok) return
    expect(kind === 'grammar' ? normalized.result.issues : normalized.result.fullTextRevision.logicIssues).toHaveLength(1)
  })

  it.each(['grammar', 'logic'] as const)('keeps a linked deduction when its evidence also supports an independent %s finding', (kind) => {
    const payload = payloadWithUnlinkedUncertainSpelling()
    const language = (payload.dimensionScores as Array<Record<string, unknown>>)[1]
    language.evidence = payload.transcript
    language.relatedIssueKeys = ['spelling-wark']
    if (kind === 'grammar') {
      ;(payload.issues as Array<Record<string, unknown>>).push({
        issueKey: 'grammar-today', type: 'grammar', severity: 'medium', originalText: 'today.',
        suggestion: 'today', explanation: 'A genuine grammar issue.', evidenceCertainty: 'certain', requiresTeacherReview: false,
      })
    } else {
      ;(payload.fullTextRevision as Record<string, unknown>).logicIssues = [{
        issueKey: 'logic-today', originalText: 'today.', contextBefore: '', contextAfter: '',
        subType: 'unclear_logic', severity: 'medium', diagnosis: 'A genuine logic issue.', suggestedAction: 'add_bridge_sentence',
        conservativeSuggestion: 'Explain the connection.', polishedSuggestion: 'Add a logical bridge.', requiresTeacherReview: false,
      }]
    }

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial', totalScore: 14,
        dimensionScores: expect.arrayContaining([expect.objectContaining({
          dimensionId: 'language', score: 7.25, requiresTeacherReview: true,
        })]),
      },
    })
    if (!normalized.ok) return
    expect(kind === 'grammar' ? normalized.result.issues : normalized.result.fullTextRevision.logicIssues).toHaveLength(1)
  })

  it('keeps a linked deduction when its reason clearly cites an independent grammar finding', () => {
    const payload = payloadWithMixedSpellingAndGrammar()
    const language = (payload.dimensionScores as Array<Record<string, unknown>>)[1]
    language.reason = 'The form wark is uncertain, and It are blue. has an agreement error.'
    language.evidence = 'wark'
    language.relatedIssueKeys = ['spelling-wark']

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'partial', totalScore: 14,
        dimensionScores: expect.arrayContaining([expect.objectContaining({
          dimensionId: 'language', score: 7.25, requiresTeacherReview: true,
        })]),
        issues: [expect.objectContaining({ type: 'grammar', originalText: 'It are blue.' })],
      },
    })
  })

  it('keeps a linked deduction when its reason contains a generic genuine grammar cue', () => {
    const payload = payloadWithUnlinkedUncertainSpelling()
    const language = (payload.dimensionScores as Array<Record<string, unknown>>)[1]
    language.reason = 'The spelling is uncertain, and subject-verb agreement is wrong.'
    language.evidence = 'wark'
    language.relatedIssueKeys = ['spelling-wark']

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'partial', totalScore: 14,
        dimensionScores: expect.arrayContaining([expect.objectContaining({
          dimensionId: 'language', score: 7.25, requiresTeacherReview: true,
        })]),
      },
    })
  })

  it.each([
    ['different key safely classified as ambiguous spelling', 'spelling-overlap', 'spelling', 'uncertain', true, 15],
    ['same key safely classified as ambiguous spelling', 'spelling-wark', 'spelling', 'uncertain', true, 15],
    ['different key with unrecoverable classification', 'unknown-overlap', null, 'uncertain', false, 14],
    ['same key with unrecoverable classification', 'spelling-wark', null, 'uncertain', false, 14],
  ] as const)('attributes a spelling-only deduction conservatively beside an overlapping rejected declaration: %s', (_label, issueKey, type, evidenceCertainty, expectedSuccess, expectedTotal) => {
    const payload = payloadWithUnlinkedUncertainSpelling()
    ;(payload.issues as unknown[]).push({
      issueKey, type, severity: 'low', originalText: 'wark', suggestion: 'walk',
      explanation: 'Provider overlap.', evidenceCertainty, requiresTeacherReview: false, extra: true,
    })
    const language = (payload.dimensionScores as Array<Record<string, unknown>>)[1]
    language.relatedIssueKeys = ['spelling-wark']

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: expectedSuccess ? 'success' : 'partial', totalScore: expectedTotal,
        dimensionScores: expect.arrayContaining([expect.objectContaining({
          dimensionId: 'language', score: expectedSuccess ? 8.25 : 7.25,
        })]),
      },
    })
  })

  it('does not silently classify an extra-key spelling declaration whose narrative claims a genuine grammar error', () => {
    const payload = payloadWithUnlinkedUncertainSpelling()
    ;(payload.issues as unknown[]).push({
      issueKey: 'spelling-overlap', type: 'spelling', severity: 'low', originalText: 'wark', suggestion: 'walk',
      explanation: 'Subject-verb agreement is wrong.', evidenceCertainty: 'uncertain', requiresTeacherReview: false, extra: true,
    })
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[1].relatedIssueKeys = ['spelling-wark']

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'partial', totalScore: 14,
        dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'language', score: 7.25, requiresTeacherReview: true })]),
      },
    })
  })

  it('uses a grounded malformed uncertain-spelling quote as a private range-only suppression candidate', () => {
    const payload = payloadWithUnlinkedUncertainSpelling()
    payload.issues = [{
      issueKey: 'spelling-wark', type: 'spelling', severity: 'low', originalText: 'wark', suggestion: null,
      explanation: 'The spelling is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    }]
    const language = (payload.dimensionScores as Array<Record<string, unknown>>)[1]
    language.score = 8.25
    language.reason = 'Accurate.'
    language.evidence = payload.transcript
    payload.reportedTotalScore = 15
    payload.expressionUpgrades = [{ originalText: 'today.', upgradedText: 'Change wark to work.', note: 'Correct the spelling.' }]
    ;(payload.fullTextRevision as Record<string, unknown>).logicNotes = [{ quote: 'today.', note: 'Change wark to work.' }]
    ;(payload.fullTextRevision as Record<string, unknown>).logicIssues = [{
      issueKey: 'logic-today', originalText: 'today.', contextBefore: '', contextAfter: '', subType: 'unclear_logic', severity: 'low',
      diagnosis: 'Change wark to work.', suggestedAction: 'add_bridge_sentence', conservativeSuggestion: 'Change wark to work.',
      polishedSuggestion: 'Change wark to work.', requiresTeacherReview: false,
    }]

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial', expressionUpgrades: [],
        fullTextRevision: { logicNotes: [], logicIssues: [] },
      },
    })
    expect(JSON.stringify(normalized)).not.toContain('Change wark to work')
  })

  it('does not exempt a different same-key rejected reference from narrative suppression', () => {
    const payload = validPayload()
    payload.transcript = 'A wark appears. It are blue.'
    payload.issues = [{
      issueKey: 'grammar-blue', type: 'grammar', severity: 'medium', originalText: 'It are blue.',
      suggestion: 'Change wark to SECRET-WALK and write It is blue.',
      explanation: 'Agreement plus SECRET-WALK.', evidenceCertainty: 'certain', requiresTeacherReview: false,
    }, {
      issueKey: 'grammar-blue', type: null, severity: 'low', originalText: 'wark', suggestion: 'SECRET-WALK',
      explanation: 'Rejected finding.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    }]
    ;(payload.dimensionScores as Array<Record<string, unknown>>).forEach((dimension) => { dimension.evidence = payload.transcript })
    ;(payload.fullTextRevision as Record<string, unknown>).correctedText = payload.transcript
    ;(payload.fullTextRevision as Record<string, unknown>).improvedText = payload.transcript

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({ ok: true, result: { status: 'partial', issues: [] } })
    expect(JSON.stringify(normalized)).not.toContain('SECRET-WALK')
  })

  it.each(['grammar issue', 'logic issue and context', 'sentence revision', 'sentence pair'] as const)('preserves a genuine wide-reference %s that keeps the ambiguous token unchanged', (kind) => {
    const payload = payloadWithMixedSpellingAndGrammar()
    const transcript = payload.transcript as string
    const wideOriginal = transcript
    const grammar = (payload.issues as Array<Record<string, unknown>>)[1]
    grammar.originalText = wideOriginal
    grammar.suggestion = 'I wark today. It is blue.'
    grammar.explanation = 'Fix subject-verb agreement while preserving the first word.'
    const language = (payload.dimensionScores as Array<Record<string, unknown>>)[1]
    language.reason = 'Subject-verb agreement is wrong in the second sentence.'
    language.evidence = wideOriginal
    language.relatedIssueKeys = ['grammar-blue']
    if (kind === 'logic issue and context') {
      payload.issues = [(payload.issues as Array<Record<string, unknown>>)[0]]
      ;(payload.fullTextRevision as Record<string, unknown>).logicIssues = [{
        issueKey: 'logic-blue', originalText: 'It are blue.', contextBefore: 'I wark today.', contextAfter: '',
        subType: 'unclear_logic', severity: 'medium', diagnosis: 'The second sentence needs a clearer agreement-based connection.',
        suggestedAction: 'replace_sentence', conservativeSuggestion: 'I wark today. It is blue.',
        polishedSuggestion: 'I wark today. It is clearly blue.', requiresTeacherReview: false,
      }]
      language.relatedIssueKeys = ['logic-blue']
    }
    if (kind === 'sentence revision') {
      payload.sentenceRevisions = [{
        originalText: wideOriginal, revisedText: 'I wark today. It is blue.', note: 'Fix agreement.',
        relatedIssueKeys: ['grammar-blue', 'spelling-wark'], changeTypes: ['grammar', 'spelling'],
      }]
    }
    if (kind === 'sentence pair') {
      ;(payload.fullTextRevision as Record<string, unknown>).sentencePairs = [{
        originalText: wideOriginal, correctedText: 'I wark today. It is blue.', improvedText: 'I wark today. It looks blue.',
        relatedIssueKeys: ['grammar-blue', 'spelling-wark'], changeTypes: ['grammar', 'spelling'], explanation: 'Fix agreement.', requiresTeacherReview: false,
      }]
    }

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        totalScore: 14,
        dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'language', score: 7.25 })]),
      },
    })
    if (!normalized.ok) return
    if (kind === 'grammar issue') expect(normalized.result.issues).toHaveLength(1)
    if (kind === 'logic issue and context') expect(normalized.result.fullTextRevision.logicIssues).toHaveLength(1)
    if (kind === 'sentence revision') expect(normalized.result.sentenceRevisions).toEqual([expect.objectContaining({ revisedText: 'I wark today. It is blue.', changeTypes: ['grammar'] })])
    if (kind === 'sentence pair') expect(normalized.result.fullTextRevision.sentencePairs).toEqual([expect.objectContaining({ correctedText: 'I wark today. It is blue.', changeTypes: ['grammar'] })])
  })

  it.each(['grammar issue', 'sentence revision', 'sentence pair', 'expression upgrade'] as const)('omits a %s whose evidence is only the ambiguous spelling token', (kind) => {
    const payload = payloadWithMixedSpellingAndGrammar()
    const grammar = (payload.issues as Array<Record<string, unknown>>)[1]
    grammar.originalText = 'wark'
    grammar.suggestion = 'wark'
    grammar.explanation = 'A claimed agreement issue.'
    const language = (payload.dimensionScores as Array<Record<string, unknown>>)[1]
    language.reason = 'A claimed agreement issue.'
    language.evidence = 'wark'
    language.relatedIssueKeys = ['grammar-blue']
    if (kind === 'sentence revision') payload.sentenceRevisions = [{
      originalText: 'wark', revisedText: 'wark', note: 'Fix agreement.', relatedIssueKeys: ['grammar-blue', 'spelling-wark'], changeTypes: ['grammar', 'spelling'],
    }]
    if (kind === 'sentence pair') (payload.fullTextRevision as Record<string, unknown>).sentencePairs = [{
      originalText: 'wark', correctedText: 'wark', improvedText: 'wark', relatedIssueKeys: ['grammar-blue', 'spelling-wark'],
      changeTypes: ['grammar', 'spelling'], explanation: 'Fix agreement.', requiresTeacherReview: false,
    }]
    if (kind === 'expression upgrade') payload.expressionUpgrades = [{ originalText: 'wark', upgradedText: 'wark', note: 'Neutral style note.' }]

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({ ok: true, result: { status: 'partial', issues: [] } })
    if (!normalized.ok) return
    if (kind === 'sentence revision') expect(normalized.result.sentenceRevisions).toEqual([])
    if (kind === 'sentence pair') expect(normalized.result.fullTextRevision.sentencePairs).toEqual([])
    if (kind === 'expression upgrade') expect(normalized.result.expressionUpgrades).toEqual([])
  })

  it('silently replaces a dimension reason that leaks filtered spelling', () => {
    const payload = validPayload()
    payload.transcript = 'I wark today.'
    payload.issues = [{
      issueKey: 'spelling-wark', type: 'spelling', severity: 'low', originalText: 'wark', suggestion: 'work',
      explanation: 'The handwriting is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    }]
    payload.dimensionScores = [
      { dimensionId: 'content', score: 6, reason: 'The form wark is uncertain.', evidence: 'today.', relatedIssueKeys: [] },
      { dimensionId: 'language', score: 8.25, reason: 'No deduction.', evidence: 'today.', relatedIssueKeys: [] },
      { dimensionId: 'legibility', score: 0.75, reason: 'Legible.', evidence: 'today.', relatedIssueKeys: [] },
    ]
    payload.reportedTotalScore = 15
    payload.sentenceRevisions = []
    payload.expressionUpgrades = []
    payload.fullTextRevision = { correctedText: 'I wark today.', improvedText: 'I wark today.', sentencePairs: [], logicNotes: [], logicIssues: [] }

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'success', issues: [], reviewReasons: [],
        dimensionScores: [expect.objectContaining({ dimensionId: 'content', reason: '该维度未发现需扣分的问题。' }), expect.anything(), expect.anything()],
      },
    })
  })

  it('silently omits an off-range expression upgrade that leaks filtered spelling', () => {
    const payload = validPayload()
    payload.transcript = 'I wark today.'
    payload.issues = [{
      issueKey: 'spelling-wark', type: 'spelling', severity: 'low', originalText: 'wark', suggestion: 'work',
      explanation: 'The handwriting is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    }]
    payload.dimensionScores = [
      { dimensionId: 'content', score: 6, reason: 'Complete.', evidence: 'today.', relatedIssueKeys: [] },
      { dimensionId: 'language', score: 8.25, reason: 'Accurate.', evidence: 'today.', relatedIssueKeys: [] },
      { dimensionId: 'legibility', score: 0.75, reason: 'Legible.', evidence: 'today.', relatedIssueKeys: [] },
    ]
    payload.reportedTotalScore = 15
    payload.sentenceRevisions = []
    payload.expressionUpgrades = [{ originalText: 'today.', upgradedText: 'Replace wark with work today.', note: 'Correct the spelling.' }]
    payload.fullTextRevision = { correctedText: 'I wark today.', improvedText: 'I wark today.', sentencePairs: [], logicNotes: [], logicIssues: [] }

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: { status: 'success', issues: [], expressionUpgrades: [], reviewReasons: [] },
    })
  })

  it('silently omits an ungrounded upgrade whose only content is the filtered uncertain spelling', () => {
    const payload = payloadWithUnlinkedUncertainSpelling()
    const language = (payload.dimensionScores as Array<Record<string, unknown>>)[1]
    language.score = 8.25
    language.reason = 'Accurate.'
    language.evidence = payload.transcript
    payload.reportedTotalScore = 15
    payload.expressionUpgrades = [{
      originalText: 'Invented source.', upgradedText: 'Replace wark with work.', note: 'Correct the uncertain spelling.',
    }]

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: { status: 'success', totalScore: 15, issues: [], expressionUpgrades: [], reviewReasons: [] },
    })
  })

  it('does not re-publish an unrelated legibility item that leaks filtered spelling during score-only fallback', () => {
    const payload = validPayload()
    payload.transcript = 'A wark appears beside blur.'
    payload.issues = [{
      issueKey: 'spelling-wark', type: 'spelling', severity: 'low', originalText: 'wark', suggestion: 'work',
      explanation: 'The handwriting is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    }]
    payload.legibilityIssues = [{
      issueKey: 'legibility-blur', transcriptText: 'blur', possibleReadings: ['blur', 'blue'], pageNumber: 1,
      regionDescription: 'line 1', explanation: 'The handwritten word wark could be read as work.', defaultOutcome: 'count_as_legibility_error',
    }]
    payload.dimensionScores = [
      { dimensionId: 'content', score: 6, reason: 'Complete.', evidence: 'appears', relatedIssueKeys: [] },
      { dimensionId: 'language', score: 8.25, reason: 'Accurate.', evidence: 'appears', relatedIssueKeys: [] },
      { dimensionId: 'legibility', score: 0.25, reason: 'One mark is unclear.', evidence: 'blur', relatedIssueKeys: ['legibility-blur'] },
    ]
    payload.reportedTotalScore = 15
    payload.sentenceRevisions = []
    payload.expressionUpgrades = []
    payload.fullTextRevision = { correctedText: payload.transcript, improvedText: payload.transcript, sentencePairs: [], logicNotes: [], logicIssues: [] }

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'partial', issues: [], legibilityIssues: [],
        reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']),
      },
    })
    expect(JSON.stringify(normalizeMultimodalResult(payload, context))).not.toContain('could be read as work')
  })

  it('does not reject an ordinary use of a filtered spelling suggestion', () => {
    const payload = validPayload()
    payload.transcript = 'I wark today.'
    payload.issues = [{
      issueKey: 'spelling-wark', type: 'spelling', severity: 'low', originalText: 'wark', suggestion: 'work',
      explanation: 'The handwriting is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    }]
    payload.dimensionScores = [
      { dimensionId: 'content', score: 6, reason: 'Good work overall.', evidence: 'today.', relatedIssueKeys: [] },
      { dimensionId: 'language', score: 8.25, reason: 'No deduction.', evidence: 'today.', relatedIssueKeys: [] },
      { dimensionId: 'legibility', score: 0.75, reason: 'Legible.', evidence: 'today.', relatedIssueKeys: [] },
    ]
    payload.reportedTotalScore = 15
    payload.sentenceRevisions = []
    payload.expressionUpgrades = []
    payload.fullTextRevision = { correctedText: 'I wark today.', improvedText: 'I wark today.', sentencePairs: [], logicNotes: [], logicIssues: [] }

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: true, result: { overallComment: expect.any(String) } })
  })

  it('uses a neutral comment when auxiliary overall feedback is blank', () => {
    const payload = validPayload()
    payload.overallComment = '   '

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: { overallComment: '已依据评分标准完成批改。' },
    })
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
        status: 'partial', totalScore: 14, issues: [], sentenceRevisions: [], expressionUpgrades: [], recognitionWarnings: [],
        reviewReasons: expect.arrayContaining(['AI 自报总分与产品重算总分不一致。']),
        fullTextRevision: { correctedText: 'I can come.', improvedText: 'I can come.', sentencePairs: [], logicNotes: [], logicIssues: [] },
      },
    })
  })

  it.each([
    ['full legibility score', (scores: Array<Record<string, unknown>>) => { scores[2].score = 0.75; scores[2].relatedIssueKeys = [] }],
    ['legibility deduction without key', (scores: Array<Record<string, unknown>>) => { scores[2].relatedIssueKeys = [] }],
    ['non-legibility relation', (scores: Array<Record<string, unknown>>) => { scores[0].score = 5.5; scores[0].relatedIssueKeys = ['legibility-blue'] }],
    ['grounded but unrelated legibility evidence', (scores: Array<Record<string, unknown>>) => { scores[2].evidence = 'I has a pen.' }],
  ] as const)('keeps a direct score and requests review for inconsistent local legibility scoring: %s', (label, mutate) => {
    const payload = payloadWithCantAmbiguity()
    const scores = payload.dimensionScores as Array<Record<string, unknown>>
    scores[0].relatedIssueKeys = []
    scores[0].score = 6
    scores[1].relatedIssueKeys = []
    scores[1].score = 8.25
    scores[2].relatedIssueKeys = ['legibility-blue']
    scores[2].score = 0.25
    mutate(scores)
    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial',
        legibilityIssues: [expect.objectContaining({ defaultOutcome: 'count_as_legibility_error' })],
        dimensionScores: expect.arrayContaining([expect.objectContaining({ requiresTeacherReview: true })]),
        reviewReasons: expect.arrayContaining(['部分维度评分依据不完整，建议教师复核。']),
      },
    })
    if (label === 'full legibility score' && normalized.ok) {
      expect(normalized.result.dimensionScores.find(({ dimensionId }) => dimensionId === 'legibility')).toMatchObject({ score: 0, maxScore: 0.75, requiresTeacherReview: true })
      expect(normalized.result.totalScore).toBeLessThan(normalized.result.maxScore)
    }
  })

  it.each(['unsafe-first', 'unsafe-last'] as const)('rejects duplicate dimensions before Map projection: %s', (order) => {
    const payload = validPayload()
    payload.issues = [{ issueKey: 'spelling-has', type: 'spelling', severity: 'low', originalText: 'has', suggestion: 'have', explanation: 'Uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false }]
    const safe = { dimensionId: 'content', score: 6, reason: 'Complete.', evidence: 'It are blue.', relatedIssueKeys: [] }
    const unsafe = { dimensionId: 'content', score: 5, reason: 'Deducted.', evidence: 'has', relatedIssueKeys: ['spelling-has'] }
    payload.dimensionScores = [
      ...(order === 'unsafe-first' ? [unsafe, safe] : [safe, unsafe]),
      { dimensionId: 'language', score: 8.25, reason: 'Accurate.', evidence: 'It are blue.', relatedIssueKeys: [] },
      { dimensionId: 'legibility', score: 0.75, reason: 'Legible.', evidence: 'It are blue.', relatedIssueKeys: [] },
    ]
    payload.reportedTotalScore = 15
    payload.fullTextRevision = { correctedText: payload.transcript, improvedText: payload.transcript, sentencePairs: [], logicNotes: [], logicIssues: [] }
    expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
  })

  it.each(['safe-first', 'safe-last'] as const)('rejects a duplicate legibility dimension in either order: %s', (order) => {
    const payload = payloadWithCantAmbiguity()
    const scores = payload.dimensionScores as Array<Record<string, unknown>>
    const safe = { dimensionId: 'legibility', score: 0.25, reason: 'Unclear.', evidence: 'It are blue.', relatedIssueKeys: ['legibility-blue'] }
    const invalid = { dimensionId: 'legibility', score: 0.75, reason: 'Legible.', evidence: 'I has a pen.', relatedIssueKeys: [] }
    payload.dimensionScores = [scores[0], scores[1], ...(order === 'safe-first' ? [safe, invalid] : [invalid, safe])]
    expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
  })

  it('replaces a local legibility quote repeated in a non-legibility narrative and keeps the score', () => {
    const narrative = payloadWithCantAmbiguity()
    ;(narrative.dimensionScores as Array<Record<string, unknown>>)[0].reason = 'It are blue. is unclear.'
    expect(normalizeMultimodalResult(narrative, context)).toMatchObject({
      ok: true,
      result: {
        status: 'partial',
        dimensionScores: [expect.objectContaining({ reason: '该维度评分依据需教师复核。', requiresTeacherReview: true }), expect.anything(), expect.anything()],
      },
    })
  })

  it('projects a scoped global recognition warning containing a local English word without treating it as local', () => {
    const payload = payloadWithCantAmbiguity()
    payload.transcript = 'I can come.'
    payload.issues = []
    payload.legibilityIssues = [{ issueKey: 'legibility-can', transcriptText: 'can', possibleReadings: ['can', "can't"], pageNumber: 1, regionDescription: 'line', explanation: 'Synthetic.', defaultOutcome: 'count_as_legibility_error' }]
    payload.dimensionScores = [
      { dimensionId: 'content', score: 6, reason: 'Complete.', evidence: 'come.', relatedIssueKeys: [] },
      { dimensionId: 'language', score: 8.25, reason: 'Accurate.', evidence: 'come.', relatedIssueKeys: [] },
      { dimensionId: 'legibility', score: 0.25, reason: 'Unclear.', evidence: 'can', relatedIssueKeys: ['legibility-can'] },
    ]
    payload.reportedTotalScore = 14.5
    payload.fullTextRevision = { correctedText: 'I can come.', improvedText: 'I can come.', sentencePairs: [], logicNotes: [], logicIssues: [] }
    payload.recognitionWarnings = [{ scope: 'global_unreadable', message: 'The model cannot determine whether all pages are readable.' }]
    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: { status: 'partial', recognitionWarnings: ['The model cannot determine whether all pages are readable.'], reviewReasons: expect.arrayContaining(['recognition_uncertain']), legibilityIssues: [{ transcriptText: 'can' }] },
    })
  })

  it('omits legacy or unsupported recognition warnings while retaining the score', () => {
    const legacy = validPayload(); legacy.recognitionWarnings = ['A word is unclear.']
    expect(normalizeMultimodalResult(legacy, context)).toMatchObject({ ok: true, result: { status: 'partial', recognitionWarnings: [] } })
    const local = validPayload(); local.recognitionWarnings = [{ scope: 'local', message: 'A local word is unclear.' }]
    expect(normalizeMultimodalResult(local, context)).toMatchObject({ ok: true, result: { status: 'partial', recognitionWarnings: [] } })
    const linked = validPayload(); linked.recognitionWarnings = [{ scope: 'global_unreadable', message: 'Repeated local warning.', relatedIssueKey: 'legibility-blue' }]
    expect(normalizeMultimodalResult(linked, context)).toMatchObject({ ok: true, result: { status: 'partial', recognitionWarnings: [] } })
  })

  it.each([
    ['exact duplicate', ['can', 'can']],
    ['trimmed duplicate', ['can', ' can ']],
    ['Unicode-normalized duplicate', ['caf\u00e9', 'cafe\u0301']],
  ])('omits a legibility item with %s possible readings', (_label, possibleReadings) => {
    const payload = payloadWithCantAmbiguity()
    ;(payload.legibilityIssues as Array<Record<string, unknown>>)[0].possibleReadings = possibleReadings

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: true, result: { status: 'partial', legibilityIssues: [] } })
  })

  it.each(['\uD83D', '\uDE00'])('rejects ill-formed Unicode in multimodal transcript and quotes: %s', (surrogate) => {
    const payload = validPayload()
    payload.transcript = `A${surrogate}B`
    payload.issues = []
    payload.dimensionScores = [
      { dimensionId: 'content', score: 6, reason: 'Complete.', evidence: surrogate, relatedIssueKeys: [] },
      { dimensionId: 'language', score: 8.25, reason: 'Accurate.', evidence: surrogate, relatedIssueKeys: [] },
      { dimensionId: 'legibility', score: 0.75, reason: 'Legible.', evidence: surrogate, relatedIssueKeys: [] },
    ]
    payload.fullTextRevision = { correctedText: payload.transcript, improvedText: payload.transcript, sentencePairs: [], logicNotes: [], logicIssues: [] }
    expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: false })
  })

  it.each([
    ['issue text', () => validPayload(), (payload: Record<string, unknown>, unsafe: string) => { ;(payload.issues as Array<Record<string, unknown>>)[0].suggestion = unsafe }],
    ['revision text', () => { const payload = validPayload(); payload.sentenceRevisions = [{ originalText: 'It are blue.', revisedText: 'It is blue.', note: 'Fix agreement.', relatedIssueKeys: ['grammar-blue'], changeTypes: ['grammar'] }]; return payload }, (payload: Record<string, unknown>, unsafe: string) => { ;(payload.sentenceRevisions as Array<Record<string, unknown>>)[0].note = unsafe }],
    ['pair text', () => { const payload = validPayload(); ;(payload.fullTextRevision as Record<string, unknown>).sentencePairs = [{ originalText: 'It are blue.', correctedText: 'It is blue.', improvedText: 'It is bright blue.', relatedIssueKeys: ['grammar-blue'], changeTypes: ['grammar'], explanation: 'Fix agreement.', requiresTeacherReview: false }]; return payload }, (payload: Record<string, unknown>, unsafe: string) => { ;((payload.fullTextRevision as Record<string, unknown>).sentencePairs as Array<Record<string, unknown>>)[0].correctedText = unsafe }],
    ['upgrade quote', () => { const payload = validPayload(); payload.expressionUpgrades = [{ originalText: 'I has a pen.', upgradedText: 'I own a pen.', note: 'Style.' }]; return payload }, (payload: Record<string, unknown>, unsafe: string) => { ;(payload.expressionUpgrades as Array<Record<string, unknown>>)[0].originalText = unsafe }],
    ['logic-note quote', () => validPayload(), (payload: Record<string, unknown>, unsafe: string) => { ;((payload.fullTextRevision as Record<string, unknown>).logicNotes as Array<Record<string, unknown>>)[0].quote = unsafe }],
    ['logic context', () => payloadWithLogicIssue(), (payload: Record<string, unknown>, unsafe: string) => { ;((payload.fullTextRevision as Record<string, unknown>).logicIssues as Array<Record<string, unknown>>)[0].contextBefore = unsafe }],
    ['legibility text', () => payloadWithCantAmbiguity(), (payload: Record<string, unknown>, unsafe: string) => { ;(payload.legibilityIssues as Array<Record<string, unknown>>)[0].regionDescription = unsafe }],
    ['recognition warning', () => { const payload = validPayload(); payload.recognitionWarnings = [{ scope: 'global_unreadable', message: 'Unclear.' }]; return payload }, (payload: Record<string, unknown>, unsafe: string) => { ;(payload.recognitionWarnings as Array<Record<string, unknown>>)[0].message = unsafe }],
    ['overall comment', () => validPayload(), (payload: Record<string, unknown>, unsafe: string) => { payload.overallComment = unsafe }],
    ['dimension reason', () => validPayload(), (payload: Record<string, unknown>, unsafe: string) => { ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].reason = unsafe }],
    ['dimension evidence', () => validPayload(), (payload: Record<string, unknown>, unsafe: string) => { ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].evidence = unsafe }],
  ] as const)('omits or neutralizes ill-formed Unicode in auxiliary %s without rejecting the score core', (_label, makePayload, mutate) => {
    const payload = makePayload()
    mutate(payload, `unsafe-\uD83D-text`)

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({ ok: true, result: { status: 'partial' } })
    expect(JSON.stringify(normalized)).not.toMatch(/\\ud83d|\\ude00/iu)
  })

  it('ignores ill-formed Unicode in a legacy Provider aggregate rebuilt by the Gateway', () => {
    const payload = validPayload()
    ;(payload.fullTextRevision as Record<string, unknown>).correctedText = 'unsafe-\uD83D-text'

    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'success',
        fullTextRevision: { correctedText: payload.transcript, improvedText: payload.transcript },
      },
    })
    expect(JSON.stringify(normalized)).not.toMatch(/\\ud83d|\\ude00/iu)
  })

  it('preserves raw exact auxiliary quotes containing valid surrogate pairs', () => {
    const payload = validPayload()
    payload.transcript = 'Before  😀  target.'
    payload.issues = []
    payload.dimensionScores = [
      { dimensionId: 'content', score: 6, reason: 'Complete.', evidence: 'target.', relatedIssueKeys: [] },
      { dimensionId: 'language', score: 8.25, reason: 'Accurate.', evidence: 'target.', relatedIssueKeys: [] },
      { dimensionId: 'legibility', score: 0.75, reason: 'Legible.', evidence: 'target.', relatedIssueKeys: [] },
    ]
    payload.reportedTotalScore = 15
    payload.expressionUpgrades = [{ originalText: ' 😀 ', upgradedText: 'a vivid symbol', note: 'Style.' }]
    payload.fullTextRevision = {
      correctedText: payload.transcript, improvedText: payload.transcript, sentencePairs: [], logicNotes: [],
      logicIssues: [{
        issueKey: 'logic-target', originalText: 'target.', contextBefore: ' 😀 ', contextAfter: '', subType: 'unclear_logic', severity: 'low',
        diagnosis: 'The connection is unclear.', suggestedAction: 'add_bridge_sentence', conservativeSuggestion: 'Explain the connection.',
        polishedSuggestion: 'Add a bridge.', requiresTeacherReview: false,
      }],
    }

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        expressionUpgrades: [expect.objectContaining({ originalText: ' 😀 ' })],
        fullTextRevision: { logicIssues: [expect.objectContaining({ contextBefore: ' 😀 ' })] },
      },
    })
  })

  it('filters a full-codepoint astral overlap with local legibility', () => {
    const payload = validPayload()
    payload.transcript = 'I 😀 agree.'
    payload.issues = [{ issueKey: 'grammar-emoji', type: 'grammar', severity: 'low', originalText: 'I 😀 agree.', suggestion: 'I agree.', explanation: 'Synthetic.', evidenceCertainty: 'certain', requiresTeacherReview: false }]
    payload.legibilityIssues = [{ issueKey: 'legibility-emoji', transcriptText: '😀', possibleReadings: ['😀', 'word'], pageNumber: 1, regionDescription: 'line', explanation: 'Synthetic.', defaultOutcome: 'count_as_legibility_error' }]
    payload.dimensionScores = [
      { dimensionId: 'content', score: 6, reason: 'Complete.', evidence: 'agree.', relatedIssueKeys: [] },
      { dimensionId: 'language', score: 8.25, reason: 'Accurate.', evidence: 'agree.', relatedIssueKeys: [] },
      { dimensionId: 'legibility', score: 0.25, reason: 'Unclear symbol.', evidence: '😀', relatedIssueKeys: ['legibility-emoji'] },
    ]
    payload.reportedTotalScore = 15
    payload.fullTextRevision = { correctedText: 'I agree.', improvedText: 'I agree.', sentencePairs: [], logicNotes: [], logicIssues: [] }
    expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: true, result: { issues: [], fullTextRevision: { correctedText: 'I 😀 agree.', improvedText: 'I 😀 agree.' } } })
  })

  it.each([
    ['ungrounded', 'Invented evidence.'],
    ['whitespace-folded', 'I  has a pen.'],
  ])('regrounds %s dimension evidence from its linked issue', (_label, evidence) => {
    const payload = validPayload()
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].evidence = evidence
    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: { status: 'partial', dimensionScores: expect.arrayContaining([expect.objectContaining({ dimensionId: 'content', evidence: 'It are blue.' })]) },
    })
  })

  it('uses the exact full transcript for non-unique evidence on maximum-score dimensions', () => {
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
    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: {
        status: 'partial',
        dimensionScores: expect.arrayContaining([expect.objectContaining({ evidence: 'Repeated evidence. Repeated evidence.' })]),
      },
    })
  })

  it('ignores Provider-authored review reasons while deriving normalized reasons internally', () => {
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
    expect(normalized).toMatchObject({ ok: true, result: { reviewReasons: [] } })
    expect(JSON.stringify(normalized)).not.toContain('Change has to have.')
  })

  it.each([
    ['recognition warning', (payload: Record<string, unknown>) => { payload.recognitionWarnings = [{ scope: 'global_unreadable', message: 'Synthetic warning.' }] }],
    ['legibility item', (payload: Record<string, unknown>) => { payload.legibilityIssues = [{ issueKey: 'legibility-1', transcriptText: 'I has a pen.', possibleReadings: ['I has a pen.', 'I have a pen.'], pageNumber: 1, regionDescription: 'line 1', explanation: 'Synthetic.', defaultOutcome: 'count_as_legibility_error' }] }],
    ['printed text not excluded', (payload: Record<string, unknown>) => { payload.printedTextExcluded = false }],
    ['changed transcript', (payload: Record<string, unknown>) => { payload.transcript = 'MODEL-DIFFERENT' }],
  ] as const)('sanitizes non-core confirmed-text Provider invariant violations but rejects %s when core', (label, mutate) => {
    const teacherText = validPayload().transcript as string
    const payload = validPayload()
    mutate(payload)
    const normalized = normalizeMultimodalResult(payload, { ...context, confirmedTranscript: teacherText, pageCount: 0 })
    expect(normalized).toMatchObject(label === 'changed transcript'
      ? { ok: false, error: { code: 'provider_invalid_response' } }
      : { ok: true, result: { status: 'partial', recognitionWarnings: [], legibilityIssues: [], printedTextExcluded: true } })
    expect(JSON.stringify(normalized)).not.toMatch(/MODEL-DIFFERENT|Synthetic warning/)
  })

  it.each([
    ['duplicate', ['grammar', 'grammar']],
    ['empty', []],
    ['oversized', Array.from({ length: 21 }, () => 'grammar')],
  ] as const)('omits a revision with %s raw changeTypes arrays', (_label, changeTypes) => {
    const payload = validPayload()
    payload.sentenceRevisions = [{
      originalText: 'It are blue.', revisedText: 'It is blue.', note: 'Synthetic.',
      relatedIssueKeys: ['grammar-blue'], changeTypes: [...changeTypes],
    }]
    expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: true, result: { status: 'partial', sentenceRevisions: [] } })
  })

  it('accepts an empty bounded relationship array when a revision has no source issue', () => {
    const payload = validPayload()
    payload.issues = []
    payload.dimensionScores = (payload.dimensionScores as Array<Record<string, unknown>>).map((score) => ({
      ...score,
      score: score.dimensionId === 'content' ? 6 : score.dimensionId === 'language' ? 8.25 : 0.75,
      relatedIssueKeys: [],
    }))
    payload.reportedTotalScore = 15
    payload.sentenceRevisions = [{
      originalText: 'It are blue.', revisedText: 'It is blue.', note: 'Synthetic.', relatedIssueKeys: [], changeTypes: ['grammar'],
    }]
    expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: true, result: { sentenceRevisions: [{ relatedIssueIds: [] }] } })
  })

  it('omits a self-overlapping logic note quote without discarding the score', () => {
    const payload = validPayload()
    payload.transcript = 'aaa'
    payload.issues = []
    payload.dimensionScores = (payload.dimensionScores as Array<Record<string, unknown>>).map((score) => ({ ...score, evidence: 'aaa' }))
    payload.fullTextRevision = { correctedText: 'aaa', improvedText: 'aaa', sentencePairs: [], logicNotes: [{ quote: 'aa', note: 'Logic note.' }], logicIssues: [] }

    expect(normalizeMultimodalResult(payload, context)).toMatchObject({
      ok: true,
      result: { status: 'partial', fullTextRevision: { logicNotes: [] }, reviewReasons: expect.arrayContaining(['部分逻辑建议因无法定位到原文已自动省略。']) },
    })
  })

  it('keeps a wide logic-note quote that preserves filtered spelling without correcting it', () => {
    const payload = validPayload()
    payload.transcript = 'joins join'
    payload.dimensionScores = (payload.dimensionScores as Array<Record<string, unknown>>).map((score) => ({ ...score, evidence: 'joins join' }))
    payload.issues = [{
      issueKey: 'spelling-joins', type: 'spelling', severity: 'low', originalText: 'joins', suggestion: 'join',
      explanation: 'The letter shape is uncertain.', evidenceCertainty: 'uncertain', requiresTeacherReview: false,
    }]
    payload.fullTextRevision = { correctedText: 'joins join', improvedText: 'joins join', sentencePairs: [], logicNotes: [{ quote: 'joins join', note: 'Neutral note.' }], logicIssues: [] }

    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({ ok: true, result: { status: 'partial', issues: [], fullTextRevision: { logicNotes: ['Neutral note.'] } } })
    expect(JSON.stringify(normalized)).not.toMatch(/Uncertain handwriting|should be work/)
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

  it('omits an ungrounded logic note without guessing its source or discarding the safe result', () => {
    const payload = validPayload()
    ;(payload.fullTextRevision as Record<string, unknown>).logicNotes = [
      { quote: 'I has a pen.', note: 'Grounded logic note.' },
      { quote: 'Invented logic quote.', note: 'Ungrounded logic note.' },
    ]
    const normalized = normalizeMultimodalResult(payload, context)

    expect(normalized).toMatchObject({
      ok: true,
      result: {
        status: 'partial',
        fullTextRevision: { logicNotes: ['Grounded logic note.'] },
        reviewReasons: expect.arrayContaining(['部分逻辑建议因无法定位到原文已自动省略。']),
      },
    })
  })

  it('regrounds dimension evidence while preserving printed-text exclusion review', () => {
    const payload = validPayload()
    payload.printedTextExcluded = false
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].evidence = 'Printed heading.'
    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({
      ok: true,
      result: { status: 'partial', reviewReasons: expect.arrayContaining(['printed_text_exclusion_uncertain', '部分维度证据未能逐字定位，已改用可定位的原文证据。']) },
    })
  })

  it('omits ungrounded citations instead of retaining unsafe projections', () => {
    const payload = validPayload()
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].evidence = 'Invented dimension evidence.'
    ;(payload.issues as Array<Record<string, unknown>>)[0].originalText = 'Invented issue quote.'
    payload.sentenceRevisions = [{ originalText: 'Invented revision quote.', revisedText: 'Revised.', note: 'Check.' }]
    payload.expressionUpgrades = [{ originalText: 'Invented upgrade quote.', upgradedText: 'Upgraded.', note: 'Check.' }]
    ;((payload.fullTextRevision as Record<string, unknown>).sentencePairs as Array<Record<string, unknown>>).push({
      originalText: 'Invented pair quote.', correctedText: 'Corrected.', improvedText: 'Improved.', changeTypes: ['grammar'], explanation: 'Check.', requiresTeacherReview: false,
    })
    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({
      ok: true,
      result: { status: 'partial', issues: [], sentenceRevisions: [], expressionUpgrades: [], fullTextRevision: { sentencePairs: [] } },
    })
    expect(JSON.stringify(normalized)).not.toContain('Invented')
  })

  it('omits an unmatched issue without inventing a transcript match and retains the score', () => {
    const payload = validPayload()
    ;(payload.issues as Array<Record<string, unknown>>)[0].originalText = 'Invented quote.'
    const normalized = normalizeMultimodalResult(payload, context)
    expect(normalized).toMatchObject({
      ok: true,
      result: { status: 'partial', issues: [], reviewReasons: expect.arrayContaining(['部分辅助批改内容不完整，建议教师复核。']) },
    })
  })

  it('omits duplicate auxiliary issues while retaining the score', () => {
    const payload = validPayload()
    ;(payload.issues as Array<Record<string, unknown>>).push({ ...(payload.issues as Array<Record<string, unknown>>)[0] })
    expect(normalizeMultimodalResult(payload, context)).toMatchObject({ ok: true, result: { status: 'partial', issues: [] } })
  })

  it.each([
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
