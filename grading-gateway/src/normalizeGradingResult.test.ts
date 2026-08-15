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
      { dimensionId: 'content', score: 4.8, reason: 'Relevant.', evidence: 'First synthetic line.' },
      { dimensionId: 'language', score: 7.2, reason: 'Accurate.', evidence: 'Second synthetic line.' },
    ],
    issues: [{
      type: 'grammar', severity: 'medium', originalText: 'Second synthetic line.',
      suggestion: 'Second improved line.', explanation: 'Synthetic explanation.', requiresTeacherReview: true,
    }],
    sentenceRevisions: [{
      originalText: 'Second synthetic line.', revisedText: 'Second improved line.', note: 'Synthetic note.',
    }],
    expressionUpgrades: [{
      originalText: 'First synthetic line.', upgradedText: 'First improved line.', note: 'Synthetic note.',
    }],
    fullTextRevision: {
      correctedText: 'First synthetic line.\nSecond corrected line.',
      improvedText: 'First improved line.\nSecond improved line.',
      sentencePairs: [{
        originalText: 'Second synthetic line.', correctedText: 'Second corrected line.',
        improvedText: 'Second improved line.', changeTypes: ['grammar'],
        explanation: 'Synthetic explanation.', requiresTeacherReview: true,
      }],
      logicNotes: [{ quote: 'First synthetic line.', note: 'Teacher review required.' }],
    },
    overallComment: 'Synthetic overall comment.',
    modelSelfConfidence: 0.8,
    reviewReasons: [],
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

  it('drops an unmatched issue and marks the result partial', () => {
    const payload = validPayload()
    ;(payload.issues as Array<Record<string, unknown>>)[0].originalText = 'Invented quote.'
    const result = normalizeGradingResult(payload, request, context)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.result.issues).toEqual([])
    expect(result.result.status).toBe('partial')
  })

  it('replaces a collapsed-whitespace quote with the actual transcript slice', () => {
    const result = normalizeGradingResult(validPayload(), request, context)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.result.issues[0].originalText).toBe('Second   synthetic line.')
  })

  it('removes a logic note whose required quote cannot be grounded', () => {
    const payload = validPayload()
    ;((payload.fullTextRevision as Record<string, unknown>).logicNotes as Array<Record<string, unknown>>)[0].quote = 'Invented logic quote.'
    const result = normalizeGradingResult(payload, request, context)

    expect(result).toMatchObject({ ok: true, result: { fullTextRevision: { logicNotes: [] }, status: 'partial' } })
    if (result.ok) expect(result.result.reviewReasons.join(' ')).toMatch(/逻辑诊断原文引文无法定位/)
  })

  it('removes a sentence revision with missing revised text and becomes partial', () => {
    const payload = validPayload()
    ;(payload.sentenceRevisions as Array<Record<string, unknown>>)[0].revisedText = ''
    const result = normalizeGradingResult(payload, request, context)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.result.sentenceRevisions).toEqual([])
    expect(result.result.status).toBe('partial')
  })

  it('omits the full revision and becomes partial when corrected text is missing', () => {
    const payload = validPayload()
    ;(payload.fullTextRevision as Record<string, unknown>).correctedText = ''
    const result = normalizeGradingResult(payload, request, context)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.result.fullTextRevision).toBeUndefined()
    expect(result.result.status).toBe('partial')
  })

  it('uses corrected text as the improved fallback and becomes partial', () => {
    const payload = validPayload()
    delete (payload.fullTextRevision as Record<string, unknown>).improvedText
    const result = normalizeGradingResult(payload, request, context)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.result.fullTextRevision?.improvedText).toBe(result.result.fullTextRevision?.correctedText)
    expect(result.result.status).toBe('partial')
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

  it('fills a safe missing comment and marks the result partial', () => {
    const payload = validPayload()
    payload.overallComment = '  '
    const result = normalizeGradingResult(payload, request, context)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.result.overallComment).toBe('AI 总评缺失，请教师补充。')
    expect(result.result.status).toBe('partial')
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
