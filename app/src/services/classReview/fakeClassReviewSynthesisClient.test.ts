import { describe, expect, it } from 'vitest'
import type { ClassReviewSynthesisRequestV1 } from './types'
import { createFakeClassReviewSynthesisClient } from './fakeClassReviewSynthesisClient'

function request(groups: readonly ClassReviewSynthesisRequestV1['groups'][number][] = []): ClassReviewSynthesisRequestV1 {
  const support = groups.reduce((sum, group) => sum + group.distinctEssaySupport, 0)
  const occurrences = groups.reduce((sum, group) => sum + group.occurrenceCount, 0)
  return {
    contractVersion: 'class-review-synthesis-request-v1', requestId: 'request-1', rubricRevisionDigest: 'a'.repeat(64), policyVersion: 'class-review-policy-v1', schemaVersion: 'kimi-class-review-output-v1', projectionVersion: 'class-review-projection-v1', budgetVersion: 'class-review-prompt-budget-v1',
    statistics: { includedEssayCount: 3, issueEligibleEssayCount: 3, totalEssayCount: 3, excludedEssayCount: 0, score: { fullScore: 100, averageScore: 80, highestScore: 90, lowestScore: 70, medianScore: 80 }, scoreBands: [], dimensions: [], issueCounters: [] },
    groups: [...groups],
    semanticCoverage: { projectedGroupCount: groups.length, eligibleGroupCount: groups.length, groupCoverage: 1, projectedDistinctEssaySupportSum: support, eligibleDistinctEssaySupportSum: support, supportWeightedCoverage: 1, projectedOccurrenceSum: occurrences, eligibleOccurrenceSum: occurrences, occurrenceWeightedCoverage: 1 },
    outputLimits: { maxCompletionTokens: 3072, maxVisibleCodePoints: 2200, maxJsonUtf8Bytes: 16384 },
  }
}

const g = (id: string, support = 2, mustCover = true) => ({ groupId: id, type: 'grammar' as const, subtype: null, severity: 'medium' as const, title: id, mustCover, distinctEssaySupport: support, occurrenceCount: support, excerpt: null })

describe('deterministic fake synthesis client', () => {
  it.each([
    ['success', 'succeeded'], ['empty', 'succeeded'], ['rate_limited_before_completion', 'failed'], ['auth_failed', 'failed'], ['result_unknown', 'result_unknown'], ['regeneration_failed', 'succeeded'],
  ] as const)('returns strict v1 for %s without I/O', async (scenario, status) => {
    const fake = createFakeClassReviewSynthesisClient({ scenario })
    const result = await fake.synthesize(request([g('g1')]))
    expect(result).toMatchObject({ contractVersion: 'class-review-synthesis-result-v1', requestId: 'request-1', status })
    expect(fake.getCallCountForTest()).toBe(1)
  })

  it('normalizes invalid-schema to a terminal safe failure and regeneration_failed only after its first call', async () => {
    await expect(createFakeClassReviewSynthesisClient({ scenario: 'invalid_schema' }).synthesize(request())).resolves.toMatchObject({ status: 'failed', safeFailureCode: 'provider_invalid_response', retryable: false, completionDisposition: 'completed' })
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'regeneration_failed' })
    expect((await fake.synthesize(request())).status).toBe('succeeded')
    expect((await fake.synthesize(request())).status).toBe('failed')
  })

  it.each([
    ['multi_group', [g('g1'), g('g2')], 1],
    ['sub_threshold', [g('g1', 1, false)], 1],
    ['omitted_must_cover', [g('g1'), g('g2')], 0],
  ] as const)('provides deterministic %s provider patterns', async (variant, groups, patternCount) => {
    const result = await createFakeClassReviewSynthesisClient({ scenario: 'success', variant }).synthesize(request(groups))
    expect(result.status).toBe('succeeded')
    if (result.status === 'succeeded') expect(result.output.patterns).toHaveLength(patternCount)
  })

  it('normalizes duplicate ownership to a terminal provider_invalid_response rather than throwing raw output', async () => {
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'success', variant: 'duplicate_group_ownership' })
    await expect(fake.synthesize(request([g('g1')]))).resolves.toMatchObject({ status: 'failed', safeFailureCode: 'provider_invalid_response', retryable: false, completionDisposition: 'completed' })
    expect(fake.getCallCountForTest()).toBe(1)
  })
})
