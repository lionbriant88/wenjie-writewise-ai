import { describe, expect, it } from 'vitest'
import { parseClassReviewSynthesisRequest, parseClassReviewSynthesisResult } from './synthesisContracts'
import { synthesisFixtures } from './fixtures/loadContractFixtures'

describe('class review synthesis contracts', () => {
  it('accepts every canonical internal request and result', () => {
    for (const value of Object.values(synthesisFixtures.requests)) expect(parseClassReviewSynthesisRequest(value).ok).toBe(true)
    for (const value of Object.values(synthesisFixtures.results)) expect(parseClassReviewSynthesisResult(value).ok).toBe(true)
  })

  it('rejects forbidden prompt cache keys and invalid subtype pairs', () => {
    expect(parseClassReviewSynthesisRequest({ ...synthesisFixtures.requests.pureStatistics, promptCacheKey: 'forbidden' })).toEqual({ ok: false, error: { code: 'unknown_key', path: '/promptCacheKey' } })
    expect(parseClassReviewSynthesisRequest({ ...synthesisFixtures.requests.withGroups, groups: [{ ...synthesisFixtures.requests.withGroups.groups[0], subtype: 'unclear_logic' }] })).toEqual({ ok: false, error: { code: 'invalid_value', path: '/groups/0/subtype' } })
  })

  it('rejects invalid usage accounting and result-unknown extras', () => {
    expect(parseClassReviewSynthesisResult({ ...synthesisFixtures.results.succeeded, usage: { ...synthesisFixtures.results.succeeded.usage, totalTokens: 149 } })).toEqual({ ok: false, error: { code: 'invalid_value', path: '/usage/totalTokens' } })
    expect(parseClassReviewSynthesisResult({ ...synthesisFixtures.results.resultUnknown, usage: null })).toEqual({ ok: false, error: { code: 'unknown_key', path: '/usage' } })
  })
})
