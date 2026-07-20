import { describe, expect, it } from 'vitest'
import { projectGradingClientResponse } from './projectGradingClientResponse'

const expected = { httpOk: true, requestId: 'request-1', essayId: 'essay-1' }

function validSuccess(): Record<string, unknown> {
  return {
    resultVersion: 'grading-result-v1',
    requestId: 'request-1',
    essayId: 'essay-1',
    provider: 'remote',
    status: 'success',
    totalScore: 12,
    maxScore: 15,
    dimensionScores: [{
      dimensionId: 'language', name: 'Language', score: 12, maxScore: 15, weight: 100,
      reason: 'Accurate.', evidence: 'Synthetic evidence.', unknownNested: 'discard',
    }],
    issues: [{
      id: 'issue-1', type: 'grammar', severity: 'medium', originalText: 'Synthetic error.',
      suggestion: 'Synthetic correction.', explanation: 'Synthetic explanation.',
      requiresTeacherReview: true, unknownNested: 'discard',
    }],
    sentenceRevisions: [{
      id: 'revision-1', relatedIssueId: 'issue-1', originalText: 'Synthetic error.',
      revisedText: 'Synthetic correction.', note: 'Synthetic note.', unknownNested: 'discard',
    }],
    expressionUpgrades: [{
      id: 'upgrade-1', originalText: 'useful', upgradedText: 'beneficial',
      note: 'Synthetic note.', unknownNested: 'discard',
    }],
    fullTextRevision: {
      originalText: 'Untrusted provider original.',
      correctedText: 'Synthetic correction.',
      improvedText: 'Synthetic improvement.',
      sentencePairs: [{
        id: 'pair-1', originalText: 'Synthetic error.', correctedText: 'Synthetic correction.',
        improvedText: 'Synthetic improvement.', changeTypes: ['grammar'],
        explanation: 'Synthetic explanation.', requiresTeacherReview: true, unknownNested: 'discard',
      }],
      logicNotes: ['Teacher review required.'],
      unknownNested: 'discard',
    },
    overallComment: 'Synthetic comment.',
    modelSelfConfidence: 0.8,
    reviewReasons: ['Review the rewrite.'],
    createdAt: '2026-07-20T00:00:00.000Z',
    unknownTopLevel: 'discard',
  }
}

function expectInvalid(value: unknown, override = expected) {
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
  it('projects every success field into new allowlisted nested objects', () => {
    const raw = validSuccess()
    const result = projectGradingClientResponse(raw, expected)
    expect(result.status).toBe('success')
    expect(result).not.toBe(raw)
    if (result.status === 'failed') throw new Error(result.error.message)
    expect(result).not.toHaveProperty('unknownTopLevel')
    expect(result.dimensionScores[0]).not.toHaveProperty('unknownNested')
    expect(result.issues[0]).not.toHaveProperty('unknownNested')
    expect(result.sentenceRevisions[0]).not.toHaveProperty('unknownNested')
    expect(result.expressionUpgrades[0]).not.toHaveProperty('unknownNested')
    expect(result.fullTextRevision).not.toHaveProperty('unknownNested')
    expect(result.fullTextRevision?.sentencePairs[0]).not.toHaveProperty('unknownNested')
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
    ['result version', 'resultVersion', 'grading-result-v2'],
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

  it('accepts a fully projected failure only on non-2xx with a matching request id', () => {
    const raw = {
      requestId: 'request-1',
      status: 'failed',
      error: {
        code: 'provider_timeout', message: 'Provider timed out.', retryable: true, secret: 'discard',
      },
      unknownTopLevel: 'discard',
    }
    const result = projectGradingClientResponse(raw, { ...expected, httpOk: false })
    expect(result).toEqual({
      requestId: 'request-1',
      status: 'failed',
      error: { code: 'provider_timeout', message: 'Provider timed out.', retryable: true },
    })
    expectInvalid(raw, expected)
  })

  it.each([
    ['error code', (raw: Record<string, unknown>) => {
      (raw.error as Record<string, unknown>).code = 'unknown_code'
    }],
    ['error message', (raw: Record<string, unknown>) => {
      (raw.error as Record<string, unknown>).message = ''
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
})
