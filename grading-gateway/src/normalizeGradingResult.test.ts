import { describe, expect, it } from 'vitest'
import type { GradingRequestV1 } from './types.js'
import { normalizeGradingResult } from './normalizeGradingResult.js'

const request: GradingRequestV1 = {
  requestVersion: 'grading-request-v1', requestId: 'request-normalize',
  task: {
    taskId: 'task-normalize', writingGenre: 'practical_writing', fullScore: 15,
    prompt: { writingGenre: 'practical_writing', taskRequirement: 'Synthetic task.' },
    rubric: {
      status: 'confirmed', writingGoal: 'Synthetic goal.', offTopicCriteria: [],
      dimensions: [
        { id: 'content', name: 'Content', weight: 40, description: 'Relevant', deductionFocus: [] },
        { id: 'language', name: 'Language', weight: 60, description: 'Accurate', deductionFocus: [] },
      ],
      excellentFeatures: [], reviewTriggers: [],
    },
  },
  essay: {
    essayId: 'essay-normalize',
    confirmedTranscript: 'First synthetic line.\nSecond   synthetic line.',
    ocrContext: { sourceKind: 'manual', hasKnownOcrRisk: false, riskCodes: [] },
  },
}

function validPayload(): Record<string, unknown> {
  return {
    reportedTotalScore: 12,
    dimensionScores: [
      { dimensionId: 'content', score: 4.8, reason: 'Relevant.', evidence: 'First synthetic line.', relatedIssueKeys: ['grammar-1'] },
      { dimensionId: 'language', score: 7.2, reason: 'Accurate.', evidence: 'Second   synthetic line.', relatedIssueKeys: ['grammar-1'] },
    ],
    issues: [{
      issueKey: 'grammar-1', type: 'grammar', severity: 'medium', originalText: 'Second   synthetic line.',
      suggestion: 'Second improved line.', explanation: 'Synthetic explanation.', evidenceCertainty: 'certain', requiresTeacherReview: true,
    }],
    sentenceRevisions: [{
      originalText: 'Second   synthetic line.', revisedText: 'Second improved line.', note: 'Synthetic note.',
      relatedIssueKeys: ['grammar-1'], changeTypes: ['grammar'],
    }],
    expressionUpgrades: [{
      originalText: 'First synthetic line.', upgradedText: 'First improved line.', note: 'Synthetic note.',
    }],
    fullTextRevision: {
      correctedText: 'First synthetic line.\nSecond corrected line.',
      improvedText: 'First improved line.\nSecond improved line.',
      sentencePairs: [{
        originalText: 'Second   synthetic line.', correctedText: 'Second corrected line.',
        improvedText: 'Second improved line.', changeTypes: ['grammar'],
        relatedIssueKeys: ['grammar-1'], explanation: 'Synthetic explanation.', requiresTeacherReview: true,
      }],
      logicNotes: [{ quote: 'First synthetic line.', note: 'Teacher review required.' }],
      logicIssues: [],
    },
    overallComment: 'Synthetic overall comment.',
    modelSelfConfidence: 0.8,
    reviewReasons: [],
    recognitionWarnings: [],
    legibilityIssues: [],
  }
}

const context = { provider: 'remote' as const, createdAt: '2026-07-20T00:00:00.000Z' }

function expectFailure(payload: unknown) {
  const result = normalizeGradingResult(payload, request, context)
  expect(result).toMatchObject({
    ok: false,
    error: { code: 'provider_invalid_response', retryable: true },
  })
  if (!result.ok) {
    expect(JSON.stringify(result.error)).not.toContain(request.essay.confirmedTranscript)
    expect(JSON.stringify(result.error)).not.toContain('SECRET-RAW')
  }
}

describe('normalizeGradingResult', () => {
  it('silently filters uncertain spelling and rebuilds corrected text from structured pairs', () => {
    const payload = validPayload()
    payload.issues = [{ issueKey: 'spell-1', type: 'spelling', severity: 'low', originalText: 'Second   synthetic line.', suggestion: 'Second corrected line.', explanation: 'Synthetic spelling.', evidenceCertainty: 'uncertain', requiresTeacherReview: false }]
    payload.dimensionScores = [
      { dimensionId: 'content', score: 6, reason: 'Relevant.', evidence: 'First synthetic line.', relatedIssueKeys: [] },
      { dimensionId: 'language', score: 9, reason: 'Accurate.', evidence: 'First synthetic line.', relatedIssueKeys: [] },
    ]
    payload.reportedTotalScore = 15
    payload.sentenceRevisions = [{ originalText: 'Second   synthetic line.', revisedText: 'Second corrected line.', note: 'Synthetic.', relatedIssueKeys: ['spell-1'], changeTypes: ['spelling'] }]
    payload.fullTextRevision = { correctedText: 'Provider aggregate must not win.', improvedText: 'Synthetic improved.', sentencePairs: [{ originalText: 'Second   synthetic line.', correctedText: 'Second corrected line.', improvedText: 'Synthetic improved.', relatedIssueKeys: ['spell-1'], changeTypes: ['spelling'], explanation: 'Synthetic.', requiresTeacherReview: false }], logicNotes: [], logicIssues: [] }
    const result = normalizeGradingResult(payload, request, context)
    expect(result).toMatchObject({ ok: true, result: { status: 'success', issues: [], sentenceRevisions: [], fullTextRevision: { correctedText: request.essay.confirmedTranscript, sentencePairs: [] } } })
  })

  it('rejects a generic dimension deduction related to filtered uncertain spelling', () => {
    const payload = validPayload()
    payload.issues = [{ issueKey: 'spell-1', type: 'spelling', severity: 'low', originalText: 'Second   synthetic line.', suggestion: 'Second corrected line.', explanation: 'Synthetic spelling.', evidenceCertainty: 'uncertain', requiresTeacherReview: false }]
    payload.dimensionScores = [
      { dimensionId: 'content', score: 6, reason: 'Complete.', evidence: 'First synthetic line.', relatedIssueKeys: [] },
      { dimensionId: 'language', score: 8, reason: 'Spelling deduction.', evidence: 'Second   synthetic line.', relatedIssueKeys: ['spell-1'] },
    ]
    payload.reportedTotalScore = 14
    payload.sentenceRevisions = []
    payload.expressionUpgrades = []
    payload.fullTextRevision = { correctedText: request.essay.confirmedTranscript, improvedText: request.essay.confirmedTranscript, sentencePairs: [], logicNotes: [], logicIssues: [] }
    expectFailure(payload)
  })

  it('rebuilds generic improved text from retained sentence pairs', () => {
    const payload = validPayload()
    ;(payload.fullTextRevision as Record<string, unknown>).improvedText = 'Provider aggregate must not win.'
    const result = normalizeGradingResult(payload, request, context)
    expect(result).toMatchObject({ ok: true, result: { fullTextRevision: { improvedText: 'First synthetic line.\nSecond improved line.' } } })
  })

  it('does not let filtered uncertain spelling bypass malformed data or provider review reasons', () => {
    const malformed = validPayload()
    malformed.issues = [{ issueKey: 'spell-1', type: 'spelling', severity: 'low', originalText: 'Invented quote.', suggestion: 'Correct.', explanation: 'Synthetic.', evidenceCertainty: 'uncertain', requiresTeacherReview: false }]
    expectFailure(malformed)
    const silent = validPayload()
    silent.issues = [{ issueKey: 'spell-1', type: 'spelling', severity: 'low', originalText: 'Second   synthetic line.', suggestion: 'Second corrected line.', explanation: 'Synthetic.', evidenceCertainty: 'uncertain', requiresTeacherReview: false }]
    silent.dimensionScores = [
      { dimensionId: 'content', score: 6, reason: 'Relevant.', evidence: 'First synthetic line.', relatedIssueKeys: [] },
      { dimensionId: 'language', score: 9, reason: 'Accurate.', evidence: 'First synthetic line.', relatedIssueKeys: [] },
    ]
    silent.reportedTotalScore = 15
    silent.sentenceRevisions = [{ originalText: 'Second   synthetic line.', revisedText: 'Second corrected line.', note: 'Synthetic.', relatedIssueKeys: ['spell-1'], changeTypes: ['spelling'] }]
    ;(silent.fullTextRevision as Record<string, unknown>).sentencePairs = [{ originalText: 'Second   synthetic line.', correctedText: 'Second corrected line.', improvedText: 'Synthetic.', explanation: 'Synthetic.', requiresTeacherReview: false, relatedIssueKeys: ['spell-1'], changeTypes: ['spelling'] }]
    silent.reviewReasons = ['Provider narrative must not affect status.']
    expect(normalizeGradingResult(silent, request, context)).toMatchObject({ ok: true, result: { status: 'success', reviewReasons: [], issues: [], sentenceRevisions: [] } })
  })

  it('requires the complete full-text revision object', () => {
    for (const field of ['fullTextRevision', 'logicNotes', 'logicIssues'] as const) {
      const payload = validPayload()
      if (field === 'fullTextRevision') delete payload.fullTextRevision
      else delete (payload.fullTextRevision as Record<string, unknown>)[field]
      expectFailure(payload)
    }
  })

  it.each(['sentence revision', 'sentence pair'] as const)('rejects empty generic %s changeTypes', (kind) => {
    const payload = validPayload()
    if (kind === 'sentence revision') (payload.sentenceRevisions as Array<Record<string, unknown>>)[0].changeTypes = []
    else ((payload.fullTextRevision as Record<string, unknown>).sentencePairs as Array<Record<string, unknown>>)[0].changeTypes = []
    expectFailure(payload)
  })

  it.each(['unknown action', 'ungrounded original', 'wrong context order'] as const)('rejects unsafe generic logic: %s', (kind) => {
    const payload = validPayload()
    ;(payload.fullTextRevision as Record<string, unknown>).logicIssues = [{ issueKey: 'logic-1', originalText: 'Second   synthetic line.', contextBefore: 'First synthetic line.', contextAfter: '', subType: 'unclear_logic', severity: 'medium', diagnosis: 'Synthetic logic.', suggestedAction: 'add_bridge_sentence', conservativeSuggestion: 'Synthetic conservative.', polishedSuggestion: 'Synthetic polished.', requiresTeacherReview: false }]
    const logic = ((payload.fullTextRevision as Record<string, unknown>).logicIssues as Array<Record<string, unknown>>)[0]
    if (kind === 'unknown action') logic.suggestedAction = 'invented'
    if (kind === 'ungrounded original') logic.originalText = 'Invented sentence.'
    if (kind === 'wrong context order') logic.contextBefore = 'Second   synthetic line.'
    expectFailure(payload)
  })
  it('creates a trusted success with rubric-derived maximums and product total', () => {
    const result = normalizeGradingResult(validPayload(), request, context)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.result).toMatchObject({
      resultVersion: 'grading-result-v1', requestId: request.requestId, essayId: request.essay.essayId,
      provider: 'remote', status: 'success', totalScore: 12, maxScore: 15,
    })
    expect(result.result.dimensionScores.map(({ maxScore }) => maxScore)).toEqual([6, 9])
  })

  it('uses the product total and becomes partial when the reported total differs', () => {
    const payload = validPayload()
    payload.reportedTotalScore = 14
    const result = normalizeGradingResult(payload, request, context)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.result.totalScore).toBe(12)
    expect(result.result.status).toBe('partial')
    expect(result.result.reviewReasons.join(' ')).toMatch(/总分/)
  })

  it.each([
    ['missing dimension', (dimensions: Array<Record<string, unknown>>) => dimensions.pop()],
    ['duplicate dimension', (dimensions: Array<Record<string, unknown>>) => { dimensions[1].dimensionId = 'content' }],
    ['unknown dimension', (dimensions: Array<Record<string, unknown>>) => { dimensions[1].dimensionId = 'unknown' }],
  ] as const)('fails for a %s', (_label, mutate) => {
    const payload = validPayload()
    mutate(payload.dimensionScores as Array<Record<string, unknown>>)
    expectFailure(payload)
  })

  it('rounds finite dimension scores to two decimals', () => {
    const payload = validPayload()
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].score = 4.805
    const result = normalizeGradingResult(payload, request, context)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.result.dimensionScores[0].score).toBe(4.81)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.01, 6.006])('fails for unsafe core score %s', (score) => {
    const payload = validPayload()
    ;(payload.dimensionScores as Array<Record<string, unknown>>)[0].score = score
    expectFailure(payload)
  })

  it('rejects an unmatched issue instead of guessing its source', () => {
    const payload = validPayload()
    ;(payload.issues as Array<Record<string, unknown>>)[0].originalText = 'Invented quote.'
    expectFailure(payload)
  })

  it('rejects a collapsed-whitespace quote rather than normalizing it', () => {
    const payload = validPayload()
    ;(payload.issues as Array<Record<string, unknown>>)[0].originalText = 'Second synthetic line.'
    expectFailure(payload)
  })

  it.each(['duplicate-first', 'duplicate-last'] as const)('rejects duplicate generic dimensions before projection: %s', (order) => {
    const payload = validPayload()
    const duplicate = { ...(payload.dimensionScores as Array<Record<string, unknown>>)[0] }
    payload.dimensionScores = order === 'duplicate-first'
      ? [duplicate, ...(payload.dimensionScores as Array<Record<string, unknown>>)]
      : [...(payload.dimensionScores as Array<Record<string, unknown>>), duplicate]
    expectFailure(payload)
  })

  it.each(['\uD83D', '\uDE00'])('rejects ill-formed Unicode in generic transcript and evidence: %s', (surrogate) => {
    const illFormedRequest = { ...request, essay: { ...request.essay, confirmedTranscript: `A${surrogate}B` } }
    const payload = validPayload()
    payload.issues = []
    payload.sentenceRevisions = []
    payload.expressionUpgrades = []
    payload.dimensionScores = [
      { dimensionId: 'content', score: 6, reason: 'Complete.', evidence: surrogate, relatedIssueKeys: [] },
      { dimensionId: 'language', score: 9, reason: 'Accurate.', evidence: surrogate, relatedIssueKeys: [] },
    ]
    payload.reportedTotalScore = 15
    payload.fullTextRevision = { correctedText: illFormedRequest.essay.confirmedTranscript, improvedText: illFormedRequest.essay.confirmedTranscript, sentencePairs: [], logicNotes: [], logicIssues: [] }
    expect(normalizeGradingResult(payload, illFormedRequest, context)).toMatchObject({ ok: false, error: { code: 'provider_invalid_response' } })
  })

  it('keeps expression-upgrade quotes exact and rejects collapsed or duplicate source text', () => {
    const collapsed = validPayload()
    ;(collapsed.expressionUpgrades as Array<Record<string, unknown>>)[0].originalText = 'First  synthetic line.'
    expectFailure(collapsed)

    const duplicateRequest = { ...request, essay: { ...request.essay, confirmedTranscript: 'Repeated source. Repeated source.' } }
    const duplicate = validPayload()
    duplicate.issues = []
    duplicate.sentenceRevisions = []
    duplicate.fullTextRevision = { correctedText: 'Provider aggregate.', improvedText: 'Improved.', sentencePairs: [], logicNotes: [], logicIssues: [] }
    duplicate.expressionUpgrades = [{ originalText: 'Repeated source.', upgradedText: 'Improved source.', note: 'Synthetic note.' }]
    expect(normalizeGradingResult(duplicate, duplicateRequest, context)).toMatchObject({ ok: false })

    const exact = normalizeGradingResult(validPayload(), request, context)
    expect(exact).toMatchObject({ ok: true, result: { expressionUpgrades: [{ originalText: 'First synthetic line.' }] } })
  })

  it('does not let uncertain spelling or logic narratives fold whitespace before policy', () => {
    const spelling = validPayload()
    spelling.issues = [{ issueKey: 'spell-1', type: 'spelling', severity: 'low', originalText: 'Second synthetic line.', suggestion: 'Second corrected line.', explanation: 'Synthetic.', evidenceCertainty: 'uncertain', requiresTeacherReview: false }]
    spelling.sentenceRevisions = []
    ;(spelling.fullTextRevision as Record<string, unknown>).sentencePairs = []
    expectFailure(spelling)
    const logicNote = validPayload()
    ;((logicNote.fullTextRevision as Record<string, unknown>).logicNotes as Array<Record<string, unknown>>)[0].quote = 'Second synthetic line.'
    expectFailure(logicNote)
  })

  it('rejects a logic note whose required quote cannot be grounded', () => {
    const payload = validPayload()
    ;((payload.fullTextRevision as Record<string, unknown>).logicNotes as Array<Record<string, unknown>>)[0].quote = 'Invented logic quote.'
    const result = normalizeGradingResult(payload, request, context)

    expectFailure(payload)
  })

  it('rejects a sentence revision with missing revised text', () => {
    const payload = validPayload()
    ;(payload.sentenceRevisions as Array<Record<string, unknown>>)[0].revisedText = ''
    expectFailure(payload)
  })

  it('ignores a blank Provider corrected aggregate and safely rebuilds it', () => {
    const payload = validPayload()
    ;(payload.fullTextRevision as Record<string, unknown>).correctedText = ''
    expect(normalizeGradingResult(payload, request, context)).toMatchObject({
      ok: true, result: { fullTextRevision: { correctedText: 'First synthetic line.\nSecond corrected line.' } },
    })
  })

  it('rejects a missing required improved text', () => {
    const payload = validPayload()
    delete (payload.fullTextRevision as Record<string, unknown>).improvedText
    expectFailure(payload)
  })

  it('keeps model self-confidence optional and drops invalid values without partial status', () => {
    const missing = validPayload()
    delete missing.modelSelfConfidence
    const missingResult = normalizeGradingResult(missing, request, context)
    expect(missingResult.ok).toBe(true)
    if (missingResult.ok) {
      expect(missingResult.result).not.toHaveProperty('modelSelfConfidence')
      expect(missingResult.result.status).toBe('success')
    }

    const invalid = validPayload()
    invalid.modelSelfConfidence = 2
    const invalidResult = normalizeGradingResult(invalid, request, context)
    expect(invalidResult.ok).toBe(true)
    if (invalidResult.ok) {
      expect(invalidResult.result).not.toHaveProperty('modelSelfConfidence')
      expect(invalidResult.result.status).toBe('success')
    }
  })

  it('rejects a missing required overall comment', () => {
    const payload = validPayload()
    payload.overallComment = '  '
    expectFailure(payload)
  })

  it('ignores Provider metadata, unknown fields, and claims about preserved intent', () => {
    const payload = validPayload()
    Object.assign(payload, {
      provider: 'deepseek', status: 'trusted', requestId: 'provider-id', essayId: 'provider-essay',
      createdAt: 'provider-time', unknown: 'SECRET-RAW', preservesOriginalIntent: true,
    })
    ;(payload.fullTextRevision as Record<string, unknown>).preservesOriginalIntent = true
    const result = normalizeGradingResult(payload, request, context)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    const serialized = JSON.stringify(result.result)
    expect(serialized).not.toMatch(/deepseek|provider-id|provider-time|SECRET-RAW|preservesOriginalIntent/)
    expect(result.result.fullTextRevision?.sentencePairs[0].requiresTeacherReview).toBe(true)
  })

  it('never includes raw payload or transcript text in failures', () => {
    expectFailure({ dimensionScores: 'SECRET-RAW', transcript: request.essay.confirmedTranscript })
  })
})
