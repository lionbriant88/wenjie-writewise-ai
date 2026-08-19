import { describe, expect, it } from 'vitest'
import { projectGradingClientResponse } from './projectGradingClientResponse'
import type { ConfirmedTaskPackageV2 } from './types'

const expected = { httpOk: true, requestId: 'request-1', essayId: 'essay-1' }

const semanticTask: ConfirmedTaskPackageV2 = {
  taskId: 'task-semantic', fullScore: 15, materialSummary: 'Synthetic material.',
  writingRequirements: ['Write clearly.'], constraints: [],
  rubric: {
    taskName: 'Synthetic task', materialSummary: 'Synthetic material.',
    writingRequirements: ['Write clearly.'], constraints: [], reviewWarnings: [],
    dimensions: [{ id: 'language', name: 'Language', weight: 100, description: 'Accuracy.', deductionFocus: [], sourceEvidence: [] }],
  },
}

const semanticExpected = {
  ...expected, requireMultimodal: true as const, inputMode: 'images' as const,
  pageCount: 1, fullScore: 15, task: semanticTask,
}

function validSuccess(): Record<string, unknown> {
  return {
    resultVersion: 'grading-result-v2',
    requestId: 'request-1',
    essayId: 'essay-1',
    provider: 'remote',
    status: 'success',
    totalScore: 12,
    maxScore: 15,
    dimensionScores: [{
      dimensionId: 'language', name: 'Language', score: 12, maxScore: 15, weight: 100,
      reason: 'Accurate.', evidence: 'Synthetic evidence.', requiresTeacherReview: true,
    }],
    issues: [{
      id: 'issue-1', type: 'grammar', severity: 'medium', originalText: 'Synthetic error.',
      suggestion: 'Synthetic correction.', explanation: 'Synthetic explanation.',
      evidenceCertainty: 'certain', requiresTeacherReview: true,
    }],
    sentenceRevisions: [{
      id: 'revision-1', relatedIssueIds: ['issue-1'], originalText: 'Synthetic error.',
      revisedText: 'Synthetic correction.', note: 'Synthetic note.', changeTypes: ['grammar'], requiresTeacherReview: true,
    }],
    expressionUpgrades: [{
      id: 'upgrade-1', originalText: 'useful', upgradedText: 'beneficial',
      note: 'Synthetic note.', requiresTeacherReview: false,
    }],
    fullTextRevision: {
      originalText: 'Student text.',
      correctedText: 'Synthetic correction.',
      improvedText: 'Synthetic improvement.',
      sentencePairs: [{
        id: 'pair-1', originalText: 'Synthetic error.', correctedText: 'Synthetic correction.',
        improvedText: 'Synthetic improvement.', relatedIssueIds: ['issue-1'], changeTypes: ['grammar'],
        explanation: 'Synthetic explanation.', requiresTeacherReview: true,
      }],
      logicNotes: ['Teacher review required.'],
      logicIssues: [{
        id: 'logic-1', originalText: 'Synthetic error.', contextBefore: '', contextAfter: '',
        subType: 'unclear_logic', severity: 'medium', diagnosis: 'Synthetic logic diagnosis.',
        suggestedAction: 'add_bridge_sentence', conservativeSuggestion: 'Synthetic conservative suggestion.',
        polishedSuggestion: 'Synthetic polished suggestion.', requiresTeacherReview: true,
      }],
    },
    legibilityIssues: [],
    recognitionWarnings: [],
    overallComment: 'Synthetic comment.',
    modelSelfConfidence: 0.8,
    reviewReasons: ['Review the rewrite.'],
    createdAt: '2026-07-20T00:00:00.000Z',
  }
}

function validSemanticSuccess(): Record<string, unknown> {
  const raw = validSuccess()
  const transcript = 'Synthetic error. A useful phrase. Logic sentence. cant'
  raw.status = 'success'
  raw.reviewReasons = []
  raw.transcript = transcript
  raw.printedTextExcluded = true
  raw.recognitionWarnings = []
  raw.dimensionScores = [{
    dimensionId: 'language', name: 'Language', score: 12, maxScore: 15, weight: 100,
    reason: 'Accurate.', evidence: 'Synthetic error.',
  }]
  raw.issues = [{
    id: 'issue-1', type: 'grammar', severity: 'medium', originalText: 'Synthetic error.',
    suggestion: 'Synthetic correction.', explanation: 'Synthetic explanation.',
    evidenceCertainty: 'certain', requiresTeacherReview: false,
  }]
  raw.sentenceRevisions = [{
    id: 'revision-1', relatedIssueIds: ['issue-1'], originalText: 'Synthetic error.',
    revisedText: 'Synthetic correction.', note: 'Synthetic note.', changeTypes: ['grammar'],
  }]
  raw.expressionUpgrades = [{
    id: 'upgrade-1', originalText: 'A useful phrase.', upgradedText: 'A beneficial phrase.', note: 'Synthetic note.',
  }]
  raw.fullTextRevision = {
    originalText: transcript,
    correctedText: 'Synthetic correction. A useful phrase. Logic sentence. cant',
    improvedText: 'Synthetic improvement. A useful phrase. Logic sentence. cant',
    sentencePairs: [{
      id: 'pair-1', originalText: 'Synthetic error.', correctedText: 'Synthetic correction.',
      improvedText: 'Synthetic improvement.', relatedIssueIds: ['issue-1'], changeTypes: ['grammar'],
      explanation: 'Synthetic explanation.', requiresTeacherReview: false,
    }],
    logicNotes: ['Synthetic logic note.'],
    logicIssues: [{
      id: 'logic-1', originalText: 'Logic sentence.', contextBefore: 'A useful phrase.', contextAfter: 'cant',
      subType: 'unclear_logic', severity: 'medium', diagnosis: 'Synthetic logic diagnosis.',
      suggestedAction: 'add_bridge_sentence', conservativeSuggestion: 'Synthetic conservative suggestion.',
      polishedSuggestion: 'Synthetic polished suggestion.', requiresTeacherReview: false,
    }],
  }
  raw.legibilityIssues = []
  return raw
}

function validSemanticLegibilitySuccess() {
  const raw = validSemanticSuccess()
  const task: ConfirmedTaskPackageV2 = {
    ...semanticTask,
    rubric: {
      ...semanticTask.rubric,
      dimensions: [
        { ...semanticTask.rubric.dimensions[0]!, weight: 95 },
        { id: 'legibility', name: 'Legibility', weight: 5, description: 'Readability.', deductionFocus: [], sourceEvidence: [] },
      ],
    },
  }
  raw.dimensionScores = [
    { dimensionId: 'language', name: 'Language', score: 11.5, maxScore: 14.25, weight: 95, reason: 'Accurate.', evidence: 'Synthetic error.' },
    { dimensionId: 'legibility', name: 'Legibility', score: 0.5, maxScore: 0.75, weight: 5, reason: 'One local ambiguity.', evidence: 'cant' },
  ]
  raw.legibilityIssues = [{
    id: 'legibility-1', transcriptText: 'cant', possibleReadings: ['cant', "can't"], pageNumber: 1,
    regionDescription: 'Last word.', explanation: 'Local ambiguity.', defaultOutcome: 'count_as_legibility_error',
  }]
  ;((raw.fullTextRevision as Record<string, unknown>).logicIssues as Array<Record<string, unknown>>)[0]!.contextAfter = ''
  return { raw, expected: { ...semanticExpected, task } }
}

function expectInvalid(value: unknown, override: Parameters<typeof projectGradingClientResponse>[1] = expected) {
  expect(projectGradingClientResponse(value, override)).toEqual({
    requestId: override.requestId,
    status: 'failed',
    error: {
      code: 'gateway_invalid_response',
      message: '批改服务返回了无法安全使用的响应，请重试或使用 mock 回退。',
      retryable: true,
    },
  })
}

describe('projectGradingClientResponse', () => {
  it('projects every success field into new exact nested objects', () => {
    const raw = validSuccess()
    const result = projectGradingClientResponse(raw, expected)
    expect(result.status).toBe('success')
    expect(result).not.toBe(raw)
    if (result.status === 'failed') throw new Error(result.error.message)
    expect(result.dimensionScores[0].requiresTeacherReview).toBe(true)
    expect(result.issues[0].requiresTeacherReview).toBe(true)
    expect(result.sentenceRevisions[0].requiresTeacherReview).toBe(true)
    expect(result.expressionUpgrades[0].requiresTeacherReview).toBe(false)
    expect(result.fullTextRevision?.sentencePairs[0].requiresTeacherReview).toBe(true)
    expect(result).toMatchObject({
      recognitionWarnings: [],
      legibilityIssues: [],
      fullTextRevision: { logicIssues: [expect.objectContaining({ id: 'logic-1' })] },
    })
  })

  it.each([
    ['success top level', (raw: Record<string, unknown>) => { raw.extra = true }],
    ['dimension', (raw: Record<string, unknown>) => { (raw.dimensionScores as Array<Record<string, unknown>>)[0].extra = true }],
    ['issue', (raw: Record<string, unknown>) => { (raw.issues as Array<Record<string, unknown>>)[0].extra = true }],
    ['revision', (raw: Record<string, unknown>) => { (raw.sentenceRevisions as Array<Record<string, unknown>>)[0].extra = true }],
    ['expression upgrade', (raw: Record<string, unknown>) => { (raw.expressionUpgrades as Array<Record<string, unknown>>)[0].extra = true }],
    ['full-text revision', (raw: Record<string, unknown>) => { (raw.fullTextRevision as Record<string, unknown>).extra = true }],
    ['full-text pair', (raw: Record<string, unknown>) => { ((raw.fullTextRevision as Record<string, unknown>).sentencePairs as Array<Record<string, unknown>>)[0].extra = true }],
    ['logic issue', (raw: Record<string, unknown>) => { ((raw.fullTextRevision as Record<string, unknown>).logicIssues as Array<Record<string, unknown>>)[0].extra = true }],
    ['legibility issue', (raw: Record<string, unknown>) => {
      raw.legibilityIssues = [{ id: 'legibility-1', transcriptText: 'cant', possibleReadings: ['cant', "can't"], pageNumber: 1, regionDescription: 'Synthetic.', explanation: 'Synthetic.', defaultOutcome: 'count_as_legibility_error', extra: true }]
    }],
  ] as const)('fails closed for an extra %s property', (_label, mutate) => {
    const raw = validSuccess()
    mutate(raw)
    expectInvalid(raw)
  })

  it.each([
    ['spelling certainty', (raw: Record<string, unknown>) => {
      const issue = (raw.issues as Array<Record<string, unknown>>)[0]
      issue.type = 'spelling'
      delete issue.evidenceCertainty
    }],
    ['unknown certainty', (raw: Record<string, unknown>) => {
      ;(raw.issues as Array<Record<string, unknown>>)[0].evidenceCertainty = 'maybe'
    }],
    ['revision change type', (raw: Record<string, unknown>) => {
      ;(raw.sentenceRevisions as Array<Record<string, unknown>>)[0].changeTypes = ['invented_change']
    }],
    ['logic issue action', (raw: Record<string, unknown>) => {
      const revision = raw.fullTextRevision as Record<string, unknown>
      ;(revision.logicIssues as Array<Record<string, unknown>>)[0].suggestedAction = 'invented_action'
    }],
    ['legibility outcome', (raw: Record<string, unknown>) => {
      raw.legibilityIssues = [{
        id: 'legibility-1', transcriptText: 'cant', possibleReadings: ['cant', "can't"], pageNumber: 1,
        regionDescription: 'Synthetic region.', explanation: 'Synthetic ambiguity.', defaultOutcome: 'ignore',
      }]
    }],
  ] as const)('rejects a removed or invalid structured field: %s', (_label, mutate) => {
    const raw = validSuccess()
    mutate(raw)
    expectInvalid(raw)
  })

  it.each([
    ['dimension score', (raw: Record<string, unknown>) => {
      (raw.dimensionScores as Array<Record<string, unknown>>)[0].score = '12'
    }],
    ['issue severity', (raw: Record<string, unknown>) => {
      (raw.issues as Array<Record<string, unknown>>)[0].severity = 'urgent'
    }],
    ['sentence revision id', (raw: Record<string, unknown>) => {
      (raw.sentenceRevisions as Array<Record<string, unknown>>)[0].id = ''
    }],
    ['expression upgrade note', (raw: Record<string, unknown>) => {
      (raw.expressionUpgrades as Array<Record<string, unknown>>)[0].note = 42
    }],
    ['sentence-pair change types', (raw: Record<string, unknown>) => {
      const revision = raw.fullTextRevision as Record<string, unknown>
      ;(revision.sentencePairs as Array<Record<string, unknown>>)[0].changeTypes = ['invented_change']
    }],
    ['review reason item', (raw: Record<string, unknown>) => {
      raw.reviewReasons = ['valid', 42]
    }],
    ['created date', (raw: Record<string, unknown>) => {
      raw.createdAt = 'not-a-date'
    }],
    ['confidence range', (raw: Record<string, unknown>) => {
      raw.modelSelfConfidence = 1.1
    }],
  ] as const)('rejects an invalid nested %s', (_label, mutate) => {
    const raw = validSuccess()
    mutate(raw)
    expectInvalid(raw)
  })

  it.each([
    ['request id', 'requestId', 'old-request'],
    ['essay id', 'essayId', 'old-essay'],
    ['provider', 'provider', 'deepseek'],
    ['status', 'status', 'failed'],
    ['result version', 'resultVersion', 'grading-result-v1'],
  ] as const)('rejects a mismatched or unknown %s', (_label, field, value) => {
    const raw = validSuccess()
    raw[field] = value
    expectInvalid(raw)
  })

  it('accepts success and partial only on HTTP 2xx', () => {
    const partial = validSuccess()
    partial.status = 'partial'
    expect(projectGradingClientResponse(partial, expected).status).toBe('partial')
    expectInvalid(validSuccess(), { ...expected, httpOk: false })
  })

  it('maps a non-2xx failure to a fixed safe local message', () => {
    const raw = {
      requestId: 'request-1',
      status: 'failed',
      error: {
        code: 'provider_timeout', message: 'Provider timed out.', retryable: true,
      },
    }
    const result = projectGradingClientResponse(raw, { ...expected, httpOk: false })
    expect(result).toMatchObject({ requestId: 'request-1', status: 'failed', error: { code: 'provider_timeout', retryable: true } })
    expect(JSON.stringify(result)).not.toContain('Provider timed out.')
    expectInvalid(raw, expected)
  })

  it('requires the full multimodal transcript contract when requested', () => {
    for (const missing of ['transcript', 'recognitionWarnings', 'printedTextExcluded', 'legibilityIssues'] as const) {
      const raw = validSuccess()
      raw.transcript = 'Student text.'
      raw.recognitionWarnings = []
      raw.printedTextExcluded = true
      delete raw[missing]
      expect(projectGradingClientResponse(raw, { ...expected, requireMultimodal: true })).toMatchObject({ status: 'failed', error: { code: 'gateway_invalid_response' } })
    }
    expect(projectGradingClientResponse(validSuccess(), { ...expected, requireMultimodal: true })).toMatchObject({ status: 'failed', error: { code: 'gateway_invalid_response' } })
  })

  it('never exposes an upstream failure body', () => {
    const result = projectGradingClientResponse({ requestId: 'request-1', status: 'failed', error: { code: 'provider_timeout', message: 'sk-test-secret-marker raw upstream', retryable: true } }, { ...expected, httpOk: false })
    expect(JSON.stringify(result)).not.toContain('sk-test-secret-marker')
  })

  it('preserves every multimodal review field after strict projection', () => {
    const raw = validSemanticSuccess()
    raw.recognitionWarnings = ['One word unclear.']
    raw.reviewReasons = ['recognition_uncertain']
    raw.status = 'partial'
    const result = projectGradingClientResponse(raw, semanticExpected)
    expect(result).toMatchObject({ status: 'partial', transcript: raw.transcript, recognitionWarnings: ['One word unclear.'], legibilityIssues: [], printedTextExcluded: true })
    if (result.status === 'failed') throw new Error('Expected a projected multimodal success')
    expect(result.recognitionWarnings).not.toBe(raw.recognitionWarnings)
    ;(raw.recognitionWarnings as string[]).push('Raw mutation must not leak.')
    expect(result.recognitionWarnings).toEqual(['One word unclear.'])
  })

  it('requires fullTextRevision and binds its original text to the multimodal transcript', () => {
    const missing = validSuccess()
    delete missing.fullTextRevision
    expectInvalid(missing)

    const mismatch = validSuccess()
    mismatch.transcript = 'Teacher-confirmed transcript.'
    mismatch.recognitionWarnings = []
    mismatch.printedTextExcluded = true
    expectInvalid(mismatch, { ...expected, requireMultimodal: true, inputMode: 'confirmed_text', confirmedTranscript: 'Teacher-confirmed transcript.' })
  })

  it('fails closed when a failure object contains unknown keys', () => {
    expectInvalid({
      requestId: 'request-1', status: 'failed',
      error: { code: 'provider_timeout', message: 'Provider timed out.', retryable: true, extra: true },
    }, { ...expected, httpOk: false })
  })

  it('fails closed when a failure object has an unknown outer key', () => {
    expectInvalid({ requestId: 'request-1', status: 'failed', error: { code: 'provider_timeout', message: 'Provider timed out.', retryable: true }, extra: true }, { ...expected, httpOk: false })
  })

  it('rejects duplicate or unresolved plural issue links and impossible legibility context', () => {
    const duplicate = validSuccess()
    ;(duplicate.sentenceRevisions as Array<Record<string, unknown>>)[0].relatedIssueIds = ['issue-1', 'issue-1']
    expectInvalid(duplicate)
    const unresolved = validSuccess()
    ;((unresolved.fullTextRevision as Record<string, unknown>).sentencePairs as Array<Record<string, unknown>>)[0].relatedIssueIds = ['unknown-issue']
    expectInvalid(unresolved)
    const imageLegibility = validSuccess()
    imageLegibility.legibilityIssues = [{ id: 'legibility-1', transcriptText: 'cant', possibleReadings: ['cant', "can't"], pageNumber: 2, regionDescription: 'Synthetic.', explanation: 'Synthetic.', defaultOutcome: 'count_as_legibility_error' }]
    expectInvalid(imageLegibility, { ...expected, inputMode: 'images', pageCount: 1 })
    expectInvalid(imageLegibility, { ...expected, inputMode: 'confirmed_text' })
  })

  it('uses the shared rounded total and dimension maximum rules', () => {
    const raw = validSuccess()
    raw.totalScore = 12
    raw.dimensionScores = [{ dimensionId: 'language', name: 'Language', score: 11.6, maxScore: 15, weight: 100, reason: 'Accurate.', evidence: 'Synthetic evidence.' }]
    expect(projectGradingClientResponse(raw, { ...expected, fullScore: 15 }).status).toBe('success')
    raw.totalScore = 11
    expectInvalid(raw, { ...expected, fullScore: 15 })
  })

  it('accepts positive decimal rubric weights totaling 100 and exact 50,000-code-unit public text limits', () => {
    const raw = validSuccess()
    raw.totalScore = 15
    raw.dimensionScores = [
      { dimensionId: 'content', name: 'Content', score: 4.99, maxScore: 4.99, weight: 33.3, reason: 'Relevant.', evidence: 'Synthetic evidence.' },
      { dimensionId: 'language', name: 'Language', score: 10.01, maxScore: 10.01, weight: 66.7, reason: 'Accurate.', evidence: 'Synthetic evidence.' },
    ]
    raw.overallComment = 'x'.repeat(50_000)
    raw.transcript = 't'.repeat(50_000)
    ;(raw.fullTextRevision as Record<string, unknown>).originalText = raw.transcript
    raw.printedTextExcluded = true
    expect(projectGradingClientResponse(raw, { ...expected, fullScore: 15 })).toMatchObject({
      status: 'success', overallComment: raw.overallComment, transcript: raw.transcript,
    })

    raw.overallComment = 'x'.repeat(50_001)
    expectInvalid(raw, { ...expected, fullScore: 15 })
    raw.overallComment = 'Allowed.'
    raw.transcript = 't'.repeat(50_001)
    expectInvalid(raw, { ...expected, fullScore: 15 })
  })

  it.each([
    ['duplicate', ['grammar', 'grammar']],
    ['empty', []],
    ['oversized', Array.from({ length: 21 }, (_, index) => index === 0 ? 'grammar' : `unknown-${index}`)],
  ] as const)('rejects %s changeTypes arrays', (_label, values) => {
    const raw = validSuccess()
    ;(raw.sentenceRevisions as Array<Record<string, unknown>>)[0].changeTypes = [...values]
    expectInvalid(raw)
  })

  it('rejects duplicate public IDs rather than overwriting relationships', () => {
    const raw = validSuccess()
    const revision = (raw.sentenceRevisions as Array<Record<string, unknown>>)[0]
    raw.sentenceRevisions = [revision, { ...revision }]
    expectInvalid(raw)
  })

  it('accepts empty relationship arrays while keeping them bounded and unique', () => {
    const raw = validSuccess()
    raw.issues = []
    ;(raw.sentenceRevisions as Array<Record<string, unknown>>)[0].relatedIssueIds = []
    ;((raw.fullTextRevision as Record<string, unknown>).sentencePairs as Array<Record<string, unknown>>)[0].relatedIssueIds = []
    expect(projectGradingClientResponse(raw, expected)).toMatchObject({
      status: 'success', sentenceRevisions: [{ relatedIssueIds: [] }], fullTextRevision: { sentencePairs: [{ relatedIssueIds: [] }] },
    })
  })

  it('drops unknown Kimi response fields while keeping failures free of raw upstream content', () => {
    const raw = validSuccess()
    raw.transcript = 'Student text.'
    raw.recognitionWarnings = []
    raw.printedTextExcluded = true
    raw.rawKimiReasoning = 'sk-kimi-secret-marker'
    const result = projectGradingClientResponse(raw, { ...expected, requireMultimodal: true })
    expect(JSON.stringify(result)).not.toContain('sk-kimi-secret-marker')

    const failure = projectGradingClientResponse({ requestId: 'request-1', status: 'failed', error: { code: 'provider_invalid_response', message: 'Kimi raw secret marker', retryable: false } }, { ...expected, httpOk: false })
    expect(JSON.stringify(failure)).not.toContain('Kimi raw secret marker')
  })

  it('rejects the removed legacy transcription warning field', () => {
    const raw = validSuccess()
    raw.transcript = 'Student text.'
    raw.recognitionWarnings = []
    raw.printedTextExcluded = true
    raw.transcriptionWarnings = []
    expectInvalid(raw, { ...expected, requireMultimodal: true })
  })

  it.each([
    ['error code', (raw: Record<string, unknown>) => {
      (raw.error as Record<string, unknown>).code = 'unknown_code'
    }],
    ['error retryable', (raw: Record<string, unknown>) => {
      (raw.error as Record<string, unknown>).retryable = 'true'
    }],
    ['failure request id', (raw: Record<string, unknown>) => {
      raw.requestId = 'old-request'
    }],
  ] as const)('rejects invalid failure %s', (_label, mutate) => {
    const raw: Record<string, unknown> = {
      requestId: 'request-1', status: 'failed',
      error: { code: 'provider_timeout', message: 'Timed out.', retryable: true },
    }
    mutate(raw)
    expectInvalid(raw, { ...expected, httpOk: false })
  })

  it('rejects unknown response kinds and malformed arrays', () => {
    expectInvalid({ requestId: 'request-1', status: 'pending' })
    const raw = validSuccess()
    raw.issues = [{ id: 'incomplete' }]
    expectInvalid(raw)
  })

  it('accepts a semantically grounded multimodal result and a valid astral character', () => {
    expect(projectGradingClientResponse(validSemanticSuccess(), semanticExpected)).toMatchObject({ status: 'success' })

    const astral = validSemanticSuccess()
    const transcript = 'Synthetic error. A useful phrase. Logic sentence. 😀'
    astral.transcript = transcript
    const revision = astral.fullTextRevision as Record<string, unknown>
    revision.originalText = transcript
    revision.correctedText = 'Synthetic correction. A useful phrase. Logic sentence. 😀'
    revision.improvedText = 'Synthetic improvement. A useful phrase. Logic sentence. 😀'
    ;(revision.logicIssues as Array<Record<string, unknown>>)[0]!.contextAfter = '😀'
    expect(projectGradingClientResponse(astral, semanticExpected)).toMatchObject({ status: 'success' })
  })

  it.each([
    ['dimension evidence', (raw: Record<string, unknown>) => { (raw.dimensionScores as Array<Record<string, unknown>>)[0]!.evidence = 'Invented quote.' }],
    ['language issue', (raw: Record<string, unknown>) => { (raw.issues as Array<Record<string, unknown>>)[0]!.originalText = 'Invented quote.' }],
    ['sentence revision', (raw: Record<string, unknown>) => { (raw.sentenceRevisions as Array<Record<string, unknown>>)[0]!.originalText = 'Invented quote.' }],
    ['expression upgrade', (raw: Record<string, unknown>) => { (raw.expressionUpgrades as Array<Record<string, unknown>>)[0]!.originalText = 'Invented quote.' }],
    ['sentence pair', (raw: Record<string, unknown>) => { ((raw.fullTextRevision as Record<string, unknown>).sentencePairs as Array<Record<string, unknown>>)[0]!.originalText = 'Invented quote.' }],
    ['logic issue', (raw: Record<string, unknown>) => { ((raw.fullTextRevision as Record<string, unknown>).logicIssues as Array<Record<string, unknown>>)[0]!.originalText = 'Invented quote.' }],
  ] as const)('rejects an ungrounded public %s quote', (_label, mutate) => {
    const raw = validSemanticSuccess()
    mutate(raw)
    expectInvalid(raw, semanticExpected)
  })

  it.each(['\uD83D', '\uDE00'])('rejects ill-formed UTF-16 in transcript and quote-bearing fields: %s', (surrogate) => {
    const transcript = validSemanticSuccess()
    transcript.transcript = `Synthetic error. ${surrogate}`
    ;(transcript.fullTextRevision as Record<string, unknown>).originalText = transcript.transcript
    expectInvalid(transcript, semanticExpected)

    const quote = validSemanticSuccess()
    ;(quote.dimensionScores as Array<Record<string, unknown>>)[0]!.evidence = surrogate
    expectInvalid(quote, semanticExpected)
  })

  it('rejects repeated quotes, unordered logic context, overlapping edits, and aggregate drift', () => {
    const repeated = validSemanticSuccess()
    const repeatedTranscript = 'Synthetic error. Synthetic error. A useful phrase. Logic sentence. cant'
    repeated.transcript = repeatedTranscript
    const repeatedRevision = repeated.fullTextRevision as Record<string, unknown>
    repeatedRevision.originalText = repeatedTranscript
    expectInvalid(repeated, semanticExpected)

    const unordered = validSemanticSuccess()
    ;((unordered.fullTextRevision as Record<string, unknown>).logicIssues as Array<Record<string, unknown>>)[0]!.contextBefore = 'cant'
    expectInvalid(unordered, semanticExpected)

    for (const field of ['sentenceRevisions', 'sentencePairs'] as const) {
      const overlapping = validSemanticSuccess()
      const item = field === 'sentenceRevisions'
        ? (overlapping.sentenceRevisions as Array<Record<string, unknown>>)[0]!
        : ((overlapping.fullTextRevision as Record<string, unknown>).sentencePairs as Array<Record<string, unknown>>)[0]!
      const nested = { ...item, id: `${field}-nested`, originalText: 'error.' }
      if (field === 'sentenceRevisions') (overlapping.sentenceRevisions as Array<Record<string, unknown>>).push(nested)
      else ((overlapping.fullTextRevision as Record<string, unknown>).sentencePairs as Array<Record<string, unknown>>).push(nested)
      expectInvalid(overlapping, semanticExpected)
    }

    for (const field of ['correctedText', 'improvedText'] as const) {
      const drift = validSemanticSuccess()
      ;(drift.fullTextRevision as Record<string, unknown>)[field] = 'Provider aggregate drift.'
      expectInvalid(drift, semanticExpected)
    }
  })

  it.each([
    ['id', 'legacy-language'], ['name', 'Writing'], ['weight', 99], ['maxScore', 14],
  ] as const)('rejects a rubric dimension with mismatched %s', (field, value) => {
    const raw = validSemanticSuccess()
    ;(raw.dimensionScores as Array<Record<string, unknown>>)[0]![field] = value
    expectInvalid(raw, semanticExpected)
  })

  it('rejects missing, duplicate, and extra requested rubric dimensions', () => {
    const missing = validSemanticSuccess()
    missing.dimensionScores = []
    expectInvalid(missing, semanticExpected)

    const duplicate = validSemanticSuccess()
    const dimension = (duplicate.dimensionScores as Array<Record<string, unknown>>)[0]!
    duplicate.dimensionScores = [dimension, { ...dimension }]
    expectInvalid(duplicate, semanticExpected)
  })

  it('accepts logic-only and mixed links but rejects unknown, legibility, and colliding IDs', () => {
    const linked = validSemanticSuccess()
    ;(linked.sentenceRevisions as Array<Record<string, unknown>>)[0]!.relatedIssueIds = ['logic-1']
    ;((linked.fullTextRevision as Record<string, unknown>).sentencePairs as Array<Record<string, unknown>>)[0]!.relatedIssueIds = ['issue-1', 'logic-1']
    expect(projectGradingClientResponse(linked, semanticExpected)).toMatchObject({
      status: 'success', sentenceRevisions: [{ relatedIssueIds: ['logic-1'] }],
      fullTextRevision: { sentencePairs: [{ relatedIssueIds: ['issue-1', 'logic-1'] }] },
    })

    const unknown = validSemanticSuccess()
    ;(unknown.sentenceRevisions as Array<Record<string, unknown>>)[0]!.relatedIssueIds = ['unknown-1']
    expectInvalid(unknown, semanticExpected)

    const collision = validSemanticSuccess()
    ;((collision.fullTextRevision as Record<string, unknown>).logicIssues as Array<Record<string, unknown>>)[0]!.id = 'issue-1'
    expectInvalid(collision, semanticExpected)

    const legibility = validSemanticLegibilitySuccess()
    ;(legibility.raw.sentenceRevisions as Array<Record<string, unknown>>)[0]!.relatedIssueIds = ['legibility-1']
    expectInvalid(legibility.raw, legibility.expected)
  })

  it('requires distinct normalized legibility readings and grounded page-local evidence', () => {
    const valid = validSemanticLegibilitySuccess()
    expect(projectGradingClientResponse(valid.raw, valid.expected)).toMatchObject({ status: 'success' })

    for (const readings of [['cant', 'cant'], ['cant', ' cant '], ['café', 'cafe\u0301']]) {
      const candidate = validSemanticLegibilitySuccess()
      ;(candidate.raw.legibilityIssues as Array<Record<string, unknown>>)[0]!.possibleReadings = readings
      expectInvalid(candidate.raw, candidate.expected)
    }
    const ungrounded = validSemanticLegibilitySuccess()
    ;(ungrounded.raw.legibilityIssues as Array<Record<string, unknown>>)[0]!.transcriptText = 'invented'
    expectInvalid(ungrounded.raw, ungrounded.expected)
  })

  it('keeps local legibility out of public non-legibility narratives without bare-term false positives', () => {
    const explicit = validSemanticLegibilitySuccess()
    explicit.raw.overallComment = 'The handwriting for cant is unclear.'
    expectInvalid(explicit.raw, explicit.expected)

    const benign = validSemanticLegibilitySuccess()
    benign.raw.overallComment = 'The word cant is discussed in the lesson.'
    expect(projectGradingClientResponse(benign.raw, benign.expected)).toMatchObject({ status: 'success' })
  })

  it('derives review reasons and status from recognition and printed-text state', () => {
    const recognition = validSemanticSuccess()
    recognition.status = 'partial'
    recognition.recognitionWarnings = ['A global region is unreadable.']
    recognition.reviewReasons = ['recognition_uncertain']
    expect(projectGradingClientResponse(recognition, semanticExpected)).toMatchObject({ status: 'partial' })

    const printed = validSemanticSuccess()
    printed.status = 'partial'
    printed.printedTextExcluded = false
    printed.reviewReasons = ['printed_text_exclusion_uncertain']
    expect(projectGradingClientResponse(printed, semanticExpected)).toMatchObject({ status: 'partial' })

    const scoreMismatch = validSemanticSuccess()
    scoreMismatch.status = 'partial'
    scoreMismatch.reviewReasons = ['AI 自报总分与产品重算总分不一致。']
    expect(projectGradingClientResponse(scoreMismatch, semanticExpected)).toMatchObject({ status: 'partial' })

    for (const reason of [
      '部分逻辑建议因无法定位到原文已自动省略。',
      '部分表达优化因无法定位到原文已自动省略。',
      '维度分数与问题关联不一致，已按有利于学生的原则修正。',
      '部分维度证据未能逐字定位，已改用可定位的原文证据。',
    ]) {
      const safelyDegraded = validSemanticSuccess()
      safelyDegraded.status = 'partial'
      safelyDegraded.reviewReasons = [reason]
      expect(projectGradingClientResponse(safelyDegraded, semanticExpected)).toMatchObject({ status: 'partial' })
    }

    for (const mutate of [
      (raw: Record<string, unknown>) => { raw.recognitionWarnings = ['Warning.'] },
      (raw: Record<string, unknown>) => { raw.printedTextExcluded = false },
      (raw: Record<string, unknown>) => { raw.status = 'partial'; raw.reviewReasons = ['Provider says review this.'] },
      (raw: Record<string, unknown>) => { raw.status = 'partial'; raw.reviewReasons = [] },
      (raw: Record<string, unknown>) => { raw.reviewReasons = ['recognition_uncertain'] },
      (raw: Record<string, unknown>) => { raw.status = 'partial'; raw.reviewReasons = ['recognition_uncertain', 'recognition_uncertain']; raw.recognitionWarnings = ['Warning.'] },
    ]) {
      const raw = validSemanticSuccess()
      mutate(raw)
      expectInvalid(raw, semanticExpected)
    }
  })

  it('enforces confirmed-text and image page invariants from the submitted request', () => {
    const confirmed = validSemanticSuccess()
    const confirmedExpected = { ...semanticExpected, inputMode: 'confirmed_text' as const, confirmedTranscript: confirmed.transcript as string, pageCount: 0 }
    expect(projectGradingClientResponse(confirmed, confirmedExpected)).toMatchObject({ status: 'success' })

    const warning = validSemanticSuccess()
    warning.status = 'partial'
    warning.recognitionWarnings = ['Warning.']
    warning.reviewReasons = ['recognition_uncertain']
    expectInvalid(warning, confirmedExpected)

    const missingTask = validSemanticSuccess()
    const { task: _task, ...withoutTask } = semanticExpected
    expectInvalid(missingTask, withoutTask)

    expectInvalid(validSemanticSuccess(), { ...semanticExpected, pageCount: 0 })
  })
})
