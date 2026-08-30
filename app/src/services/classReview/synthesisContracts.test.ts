import { describe, expect, it } from 'vitest'
import {
  parseClassReviewSynthesisRequest,
  parseClassReviewSynthesisResult,
} from './synthesisContracts'
import { synthesisFixtures } from './fixtures/loadContractFixtures'

describe('class review synthesis request contract', () => {
  it('accepts both canonical requests and returns exact nested types', () => {
    for (const value of Object.values(synthesisFixtures.requests)) {
      expect(parseClassReviewSynthesisRequest(value).ok).toBe(true)
    }
    const parsed = parseClassReviewSynthesisRequest(synthesisFixtures.requests.withGroups)
    if (!parsed.ok) throw new Error('fixture rejected')
    expect(parsed.value.statistics.dimensions[0]?.dimensionId).toBe('language')
    expect(parsed.value.groups[1]?.subtype).toBe('weak_connection')
  })

  it('rejects forbidden root keys and invalid group subtype pairs', () => {
    expect(
      parseClassReviewSynthesisRequest({
        ...synthesisFixtures.requests.pureStatistics,
        promptCacheKey: 'forbidden',
      }),
    ).toEqual({ ok: false, error: { code: 'unknown_key', path: '/promptCacheKey' } })
    const invalidSubtype = {
      ...synthesisFixtures.requests.withGroups,
      groups: [
        { ...synthesisFixtures.requests.withGroups.groups[0], subtype: 'unclear_logic' },
        synthesisFixtures.requests.withGroups.groups[1],
      ],
    }
    expect(parseClassReviewSynthesisRequest(invalidSubtype)).toEqual({
      ok: false,
      error: { code: 'invalid_value', path: '/groups/0/subtype' },
    })
  })

  it('reports non-string synthesis request discriminators as invalid_type', () => {
    const cases = [
      {
        value: { ...synthesisFixtures.requests.pureStatistics, contractVersion: 1 },
        path: '/contractVersion',
      },
      {
        value: { ...synthesisFixtures.requests.pureStatistics, policyVersion: false },
        path: '/policyVersion',
      },
      {
        value: { ...synthesisFixtures.requests.pureStatistics, schemaVersion: null },
        path: '/schemaVersion',
      },
      {
        value: { ...synthesisFixtures.requests.pureStatistics, projectionVersion: 1 },
        path: '/projectionVersion',
      },
      {
        value: { ...synthesisFixtures.requests.pureStatistics, budgetVersion: false },
        path: '/budgetVersion',
      },
    ]

    for (const testCase of cases) {
      expect(parseClassReviewSynthesisRequest(testCase.value)).toEqual({
        ok: false,
        error: { code: 'invalid_type', path: testCase.path },
      })
    }
  })

  it('accepts projected coverage below every eligible denominator', () => {
    expect(parseClassReviewSynthesisRequest(synthesisFixtures.requests.withGroups).ok).toBe(true)

    const groupCoverage = structuredClone(synthesisFixtures.requests.withGroups)
    groupCoverage.semanticCoverage.projectedGroupCount = 1
    groupCoverage.semanticCoverage.groupCoverage = 1 / 3
    expect(parseClassReviewSynthesisRequest(groupCoverage).ok).toBe(true)

    const supportCoverage = structuredClone(synthesisFixtures.requests.withGroups)
    supportCoverage.semanticCoverage.projectedDistinctEssaySupportSum = 2
    supportCoverage.semanticCoverage.supportWeightedCoverage = 0.5
    expect(parseClassReviewSynthesisRequest(supportCoverage).ok).toBe(true)

    const occurrenceCoverage = structuredClone(synthesisFixtures.requests.withGroups)
    occurrenceCoverage.semanticCoverage.projectedOccurrenceSum = 3
    occurrenceCoverage.semanticCoverage.occurrenceWeightedCoverage = 0.5
    expect(parseClassReviewSynthesisRequest(occurrenceCoverage).ok).toBe(true)
  })

  it('rejects every projected numerator above its eligible denominator', () => {
    const groupOverflow = structuredClone(synthesisFixtures.requests.withGroups)
    groupOverflow.semanticCoverage.projectedGroupCount = 4
    expect(parseClassReviewSynthesisRequest(groupOverflow)).toEqual({
      ok: false,
      error: { code: 'invalid_value', path: '/semanticCoverage/projectedGroupCount' },
    })

    const supportOverflow = structuredClone(synthesisFixtures.requests.withGroups)
    supportOverflow.semanticCoverage.projectedDistinctEssaySupportSum = 5
    expect(parseClassReviewSynthesisRequest(supportOverflow)).toEqual({
      ok: false,
      error: {
        code: 'invalid_value',
        path: '/semanticCoverage/projectedDistinctEssaySupportSum',
      },
    })

    const occurrenceOverflow = structuredClone(synthesisFixtures.requests.withGroups)
    occurrenceOverflow.semanticCoverage.projectedOccurrenceSum = 7
    expect(parseClassReviewSynthesisRequest(occurrenceOverflow)).toEqual({
      ok: false,
      error: { code: 'invalid_value', path: '/semanticCoverage/projectedOccurrenceSum' },
    })
  })

  it('requires ratio one for every zero semanticCoverage denominator', () => {
    const groupCoverage = structuredClone(synthesisFixtures.requests.pureStatistics)
    groupCoverage.semanticCoverage.groupCoverage = 0
    expect(parseClassReviewSynthesisRequest(groupCoverage)).toEqual({
      ok: false,
      error: { code: 'invalid_value', path: '/semanticCoverage/groupCoverage' },
    })

    const supportCoverage = structuredClone(synthesisFixtures.requests.pureStatistics)
    supportCoverage.semanticCoverage.supportWeightedCoverage = 0
    expect(parseClassReviewSynthesisRequest(supportCoverage)).toEqual({
      ok: false,
      error: { code: 'invalid_value', path: '/semanticCoverage/supportWeightedCoverage' },
    })

    const occurrenceCoverage = structuredClone(synthesisFixtures.requests.pureStatistics)
    occurrenceCoverage.semanticCoverage.occurrenceWeightedCoverage = 0
    expect(parseClassReviewSynthesisRequest(occurrenceCoverage)).toEqual({
      ok: false,
      error: {
        code: 'invalid_value',
        path: '/semanticCoverage/occurrenceWeightedCoverage',
      },
    })
  })

  it('reports deep nested failures as one RFC 6901 segment at a time', () => {
    const invalidScore = {
      ...synthesisFixtures.requests.withGroups,
      statistics: {
        ...synthesisFixtures.requests.withGroups.statistics,
        score: { ...synthesisFixtures.requests.withGroups.statistics.score, fullScore: 'invalid' },
      },
    }
    expect(parseClassReviewSynthesisRequest(invalidScore)).toEqual({
      ok: false,
      error: { code: 'invalid_type', path: '/statistics/score/fullScore' },
    })

    const escapedUnknownKey = {
      ...synthesisFixtures.requests.withGroups,
      statistics: {
        ...synthesisFixtures.requests.withGroups.statistics,
        score: {
          ...synthesisFixtures.requests.withGroups.statistics.score,
          'a/b~c': true,
        },
      },
    }
    expect(parseClassReviewSynthesisRequest(escapedUnknownKey)).toEqual({
      ok: false,
      error: { code: 'unknown_key', path: '/statistics/score/a~1b~0c' },
    })
  })

  it('enforces nested exact keys and unique statistics aliases', () => {
    const unknownScoreKey = {
      ...synthesisFixtures.requests.withGroups,
      statistics: {
        ...synthesisFixtures.requests.withGroups.statistics,
        score: {
          ...synthesisFixtures.requests.withGroups.statistics.score,
          studentName: 'forbidden',
        },
      },
    }
    expect(parseClassReviewSynthesisRequest(unknownScoreKey)).toEqual({
      ok: false,
      error: { code: 'unknown_key', path: '/statistics/score/studentName' },
    })

    const duplicateBand = {
      ...synthesisFixtures.requests.withGroups,
      statistics: {
        ...synthesisFixtures.requests.withGroups.statistics,
        scoreBands: [
          synthesisFixtures.requests.withGroups.statistics.scoreBands[0],
          synthesisFixtures.requests.withGroups.statistics.scoreBands[0],
        ],
      },
    }
    expect(parseClassReviewSynthesisRequest(duplicateBand)).toEqual({
      ok: false,
      error: { code: 'duplicate_value', path: '/statistics/scoreBands/1/bandId' },
    })

    const duplicateCounter = {
      ...synthesisFixtures.requests.withGroups,
      statistics: {
        ...synthesisFixtures.requests.withGroups.statistics,
        issueCounters: [
          ...synthesisFixtures.requests.withGroups.statistics.issueCounters,
          synthesisFixtures.requests.withGroups.statistics.issueCounters[0],
        ],
      },
    }
    expect(parseClassReviewSynthesisRequest(duplicateCounter)).toEqual({
      ok: false,
      error: { code: 'duplicate_value', path: '/statistics/issueCounters/2/counterId' },
    })
  })

  it('enforces group exact keys, aliases, code-point limits, and support bounds', () => {
    const duplicateGroup = {
      ...synthesisFixtures.requests.withGroups,
      groups: [
        ...synthesisFixtures.requests.withGroups.groups,
        synthesisFixtures.requests.withGroups.groups[0],
      ],
    }
    expect(parseClassReviewSynthesisRequest(duplicateGroup)).toEqual({
      ok: false,
      error: { code: 'duplicate_value', path: '/groups/2/groupId' },
    })

    const longTitle = {
      ...synthesisFixtures.requests.withGroups,
      groups: [
        { ...synthesisFixtures.requests.withGroups.groups[0], title: '😀'.repeat(49) },
        synthesisFixtures.requests.withGroups.groups[1],
      ],
    }
    expect(parseClassReviewSynthesisRequest(longTitle)).toEqual({
      ok: false,
      error: { code: 'limit_exceeded', path: '/groups/0/title' },
    })

    const excessiveVisibleText = {
      ...synthesisFixtures.requests.withGroups,
      groups: [
        {
          ...synthesisFixtures.requests.withGroups.groups[0],
          title: 'x'.repeat(41),
          excerpt: { originalText: 'x'.repeat(160), suggestionOrDiagnosis: 'x'.repeat(160) },
        },
        synthesisFixtures.requests.withGroups.groups[1],
      ],
    }
    expect(parseClassReviewSynthesisRequest(excessiveVisibleText)).toEqual({
      ok: false,
      error: { code: 'limit_exceeded', path: '/groups/0' },
    })

    const excessiveSupport = {
      ...synthesisFixtures.requests.withGroups,
      groups: [
        { ...synthesisFixtures.requests.withGroups.groups[0], distinctEssaySupport: 3 },
        synthesisFixtures.requests.withGroups.groups[1],
      ],
    }
    expect(parseClassReviewSynthesisRequest(excessiveSupport)).toEqual({
      ok: false,
      error: { code: 'invalid_value', path: '/groups/0/distinctEssaySupport' },
    })
  })

  it('enforces canonical 8 KiB statistics and 32 KiB groups budgets', () => {
    const oversizedStatistics = {
      ...synthesisFixtures.requests.withGroups,
      statistics: {
        ...synthesisFixtures.requests.withGroups.statistics,
        scoreBands: Array.from({ length: 20 }, (_, index) => ({
          bandId: `band${index}.${'a'.repeat(119)}`,
          lowerInclusive: 0,
          upperInclusive: 15,
          essayCount: 0,
        })),
        dimensions: Array.from({ length: 10 }, (_, index) => ({
          dimensionId: `dimension.${index}`,
          label: '😀'.repeat(120),
          averageScore: 8,
          medianScore: 8,
          maxScore: 10,
          normalizedPerformance: 0.8,
        })),
      },
    }
    expect(parseClassReviewSynthesisRequest(oversizedStatistics)).toEqual({
      ok: false,
      error: { code: 'limit_exceeded', path: '/statistics' },
    })

    const oversizedGroups = {
      ...synthesisFixtures.requests.withGroups,
      groups: Array.from({ length: 64 }, (_, index) => ({
        groupId: `group.${index}`,
        type: 'grammar',
        subtype: null,
        severity: 'medium',
        title: '😀'.repeat(40),
        mustCover: false,
        distinctEssaySupport: 2,
        occurrenceCount: 2,
        excerpt: {
          originalText: '😀'.repeat(160),
          suggestionOrDiagnosis: '😀'.repeat(160),
        },
      })),
    }
    expect(parseClassReviewSynthesisRequest(oversizedGroups)).toEqual({
      ok: false,
      error: { code: 'limit_exceeded', path: '/groups' },
    })
  })

  it('enforces each frozen output limit at its own fixed path', () => {
    expect(
      parseClassReviewSynthesisRequest({
        ...synthesisFixtures.requests.pureStatistics,
        outputLimits: {
          ...synthesisFixtures.requests.pureStatistics.outputLimits,
          maxCompletionTokens: 3073,
        },
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalid_value', path: '/outputLimits/maxCompletionTokens' },
    })
  })
})

function makeReferenceRichRequest(groupCount: number) {
  return {
    ...synthesisFixtures.requests.withGroups,
    statistics: {
      ...synthesisFixtures.requests.withGroups.statistics,
      dimensions: Array.from({ length: 10 }, (_, index) => ({
        dimensionId: `dimension.${index}.${'d'.repeat(115)}`,
        label: `Dimension ${index}`,
        averageScore: 8,
        medianScore: 8,
        maxScore: 10,
        normalizedPerformance: 0.8,
      })),
    },
    groups: Array.from({ length: groupCount }, (_, index) => ({
      groupId: `group.${index}.${'g'.repeat(index < 10 ? 119 : 118)}`,
      type: 'grammar',
      subtype: null,
      severity: 'medium',
      title: `Group ${index}`,
      mustCover: false,
      distinctEssaySupport: 1,
      occurrenceCount: 1,
      excerpt: null,
    })),
  }
}

describe('class review synthesis result contract', () => {
  it('accepts every canonical result and returns exact provider output types', () => {
    const request = parseClassReviewSynthesisRequest(synthesisFixtures.requests.withGroups)
    if (!request.ok) throw new Error('request fixture rejected')
    for (const value of Object.values(synthesisFixtures.results)) {
      expect(parseClassReviewSynthesisResult(value, request.value).ok).toBe(true)
    }
    const parsed = parseClassReviewSynthesisResult(
      synthesisFixtures.results.succeeded,
      request.value,
    )
    if (!parsed.ok || parsed.value.status !== 'succeeded') throw new Error('result rejected')
    expect(parsed.value.output.patterns[0]?.groupIds).toEqual(['grammar.tense'])

    expect(
      parseClassReviewSynthesisResult(
        { ...synthesisFixtures.results.completedFailure, finishReason: null },
        request.value,
      ).ok,
    ).toBe(true)
  })

  it.each([
    ['succeeded', synthesisFixtures.results.succeeded],
    ['failed', synthesisFixtures.results.completedFailure],
    ['result_unknown', synthesisFixtures.results.resultUnknown],
  ])('rejects a requestId mismatch for %s', (_status, result) => {
    const request = parseClassReviewSynthesisRequest(synthesisFixtures.requests.withGroups)
    if (!request.ok) throw new Error('request fixture rejected')

    expect(
      parseClassReviewSynthesisResult(
        { ...result, requestId: 'request.mismatch' },
        request.value,
      ),
    ).toEqual({ ok: false, error: { code: 'invalid_value', path: '/requestId' } })
  })

  it('parses result requestId type and grammar before checking correlation', () => {
    const request = parseClassReviewSynthesisRequest(synthesisFixtures.requests.withGroups)
    if (!request.ok) throw new Error('request fixture rejected')

    expect(
      parseClassReviewSynthesisResult(
        { ...synthesisFixtures.results.succeeded, requestId: false },
        request.value,
      ),
    ).toEqual({ ok: false, error: { code: 'invalid_type', path: '/requestId' } })
    expect(
      parseClassReviewSynthesisResult(
        { ...synthesisFixtures.results.succeeded, requestId: 'contains space' },
        request.value,
      ),
    ).toEqual({ ok: false, error: { code: 'invalid_value', path: '/requestId' } })
  })

  it('reports non-string synthesis result discriminators as invalid_type', () => {
    const request = parseClassReviewSynthesisRequest(synthesisFixtures.requests.withGroups)
    if (!request.ok) throw new Error('request fixture rejected')

    expect(
      parseClassReviewSynthesisResult(
        { ...synthesisFixtures.results.succeeded, contractVersion: 1 },
        request.value,
      ),
    ).toEqual({ ok: false, error: { code: 'invalid_type', path: '/contractVersion' } })
    expect(
      parseClassReviewSynthesisResult(
        { ...synthesisFixtures.results.succeeded, finishReason: false },
        request.value,
      ),
    ).toEqual({ ok: false, error: { code: 'invalid_type', path: '/finishReason' } })
    expect(
      parseClassReviewSynthesisResult(
        { ...synthesisFixtures.results.resultUnknown, safeFailureCode: null },
        request.value,
      ),
    ).toEqual({ ok: false, error: { code: 'invalid_type', path: '/safeFailureCode' } })
    expect(
      parseClassReviewSynthesisResult(
        { ...synthesisFixtures.results.resultUnknown, completionDisposition: 1 },
        request.value,
      ),
    ).toEqual({
      ok: false,
      error: { code: 'invalid_type', path: '/completionDisposition' },
    })
  })

  it('fully parses provider output exact keys and string/count bounds', () => {
    const request = parseClassReviewSynthesisRequest(synthesisFixtures.requests.withGroups)
    if (!request.ok) throw new Error('request fixture rejected')
    const unknownOutputKey = {
      ...synthesisFixtures.results.succeeded,
      output: { ...synthesisFixtures.results.succeeded.output, studentCount: 2 },
    }
    expect(parseClassReviewSynthesisResult(unknownOutputKey, request.value)).toEqual({
      ok: false,
      error: { code: 'unknown_key', path: '/output/studentCount' },
    })

    const longStrengthTitle = {
      ...synthesisFixtures.results.succeeded,
      output: {
        ...synthesisFixtures.results.succeeded.output,
        strengths: [
          { ...synthesisFixtures.results.succeeded.output.strengths[0], title: '😀'.repeat(41) },
        ],
      },
    }
    expect(parseClassReviewSynthesisResult(longStrengthTitle, request.value)).toEqual({
      ok: false,
      error: { code: 'limit_exceeded', path: '/output/strengths/0/title' },
    })

    expect(
      parseClassReviewSynthesisResult(
        {
          ...synthesisFixtures.results.succeeded,
          output: { ...synthesisFixtures.results.succeeded.output, strengths: [] },
        },
        request.value,
      ),
    ).toEqual({
      ok: false,
      error: { code: 'invalid_value', path: '/output/strengths' },
    })
  })

  it('enforces known unique aliases and unique ownership across patterns', () => {
    const request = parseClassReviewSynthesisRequest(synthesisFixtures.requests.withGroups)
    if (!request.ok) throw new Error('request fixture rejected')
    const unknownDimension = {
      ...synthesisFixtures.results.succeeded,
      output: {
        ...synthesisFixtures.results.succeeded.output,
        strengths: [
          {
            ...synthesisFixtures.results.succeeded.output.strengths[0],
            dimensionIds: ['unknown.dimension'],
          },
        ],
      },
    }
    expect(parseClassReviewSynthesisResult(unknownDimension, request.value)).toEqual({
      ok: false,
      error: { code: 'unknown_reference', path: '/output/strengths/0/dimensionIds/0' },
    })

    const duplicateOwnership = {
      ...synthesisFixtures.results.succeeded,
      output: {
        ...synthesisFixtures.results.succeeded.output,
        patterns: [
          synthesisFixtures.results.succeeded.output.patterns[0],
          {
            ...synthesisFixtures.results.succeeded.output.patterns[1],
            groupIds: ['grammar.tense'],
          },
        ],
      },
    }
    expect(parseClassReviewSynthesisResult(duplicateOwnership, request.value)).toEqual({
      ok: false,
      error: { code: 'duplicate_value', path: '/output/patterns/1/groupIds/0' },
    })
  })

  it('enforces the provider output visible-code-point and canonical JSON budgets', () => {
    const visibleRequest = parseClassReviewSynthesisRequest(makeReferenceRichRequest(8))
    if (!visibleRequest.ok) throw new Error('visible request rejected')
    const excessiveVisibleOutput = {
      ...synthesisFixtures.results.succeeded,
      output: {
        overallComment: '😀'.repeat(300),
        strengths: [
          { title: '😀'.repeat(40), detail: '😀'.repeat(120), dimensionIds: [] },
        ],
        patterns: visibleRequest.value.groups.map((group) => ({
          groupIds: [group.groupId],
          title: '😀'.repeat(40),
          diagnosis: '😀'.repeat(100),
          teachingAction: '😀'.repeat(100),
          severity: 'medium',
        })),
        learningRecommendations: [
          { title: '😀'.repeat(40), action: '😀'.repeat(120) },
        ],
      },
    }
    expect(
      parseClassReviewSynthesisResult(excessiveVisibleOutput, visibleRequest.value),
    ).toEqual({ ok: false, error: { code: 'limit_exceeded', path: '/output' } })

    const jsonRequest = parseClassReviewSynthesisRequest(makeReferenceRichRequest(64))
    if (!jsonRequest.ok) throw new Error('json request rejected')
    const oversizedJsonOutput = {
      ...synthesisFixtures.results.succeeded,
      output: {
        overallComment: '😀'.repeat(300),
        strengths: [0, 1, 2].map((strengthIndex) => ({
          title: '😀'.repeat(40),
          detail: '😀'.repeat(120),
          dimensionIds: jsonRequest.value.statistics.dimensions
            .slice(strengthIndex * 3, strengthIndex * 3 + 3)
            .map((dimension) => dimension.dimensionId),
        })),
        patterns: Array.from({ length: 8 }, (_, patternIndex) => ({
          groupIds: jsonRequest.value.groups
            .slice(patternIndex * 8, patternIndex * 8 + 8)
            .map((group) => group.groupId),
          title: '😀'.repeat(40),
          diagnosis: '😀'.repeat(40),
          teachingAction: '😀'.repeat(40),
          severity: 'medium',
        })),
        learningRecommendations: [0, 1, 2].map(() => ({
          title: '😀'.repeat(40),
          action: '😀'.repeat(80),
        })),
      },
    }
    expect(parseClassReviewSynthesisResult(oversizedJsonOutput, jsonRequest.value)).toEqual({
      ok: false,
      error: { code: 'limit_exceeded', path: '/output' },
    })
  })

  it('enforces usage, finish reason, retry, disposition, and timing relationships', () => {
    const request = parseClassReviewSynthesisRequest(synthesisFixtures.requests.withGroups)
    if (!request.ok) throw new Error('request fixture rejected')
    expect(
      parseClassReviewSynthesisResult({
        ...synthesisFixtures.results.succeeded,
        usage: { ...synthesisFixtures.results.succeeded.usage, totalTokens: 149 },
      }, request.value),
    ).toEqual({ ok: false, error: { code: 'invalid_value', path: '/usage/totalTokens' } })

    const invalidRetryAfter = {
      ...synthesisFixtures.results.rateLimited,
      safeFailureCode: 'provider_timeout',
    }
    expect(parseClassReviewSynthesisResult(invalidRetryAfter, request.value)).toEqual({
      ok: false,
      error: { code: 'invalid_value', path: '/retryAfterMs' },
    })

    const invalidZeroCompletion = {
      ...synthesisFixtures.results.rateLimited,
      finishReason: 'stop',
    }
    expect(parseClassReviewSynthesisResult(invalidZeroCompletion, request.value)).toEqual({
      ok: false,
      error: { code: 'invalid_value', path: '/finishReason' },
    })

    const invalidFinishReason = {
      ...synthesisFixtures.results.completedFailure,
      finishReason: 'forbidden',
    }
    expect(parseClassReviewSynthesisResult(invalidFinishReason, request.value)).toEqual({
      ok: false,
      error: { code: 'invalid_value', path: '/finishReason' },
    })

    const invalidTiming = {
      ...synthesisFixtures.results.completedFailure,
      timingsMs: { ...synthesisFixtures.results.completedFailure.timingsMs, totalMs: 1 },
    }
    expect(parseClassReviewSynthesisResult(invalidTiming, request.value)).toEqual({
      ok: false,
      error: { code: 'invalid_value', path: '/timingsMs/totalMs' },
    })

    expect(
      parseClassReviewSynthesisResult(
        { ...synthesisFixtures.results.resultUnknown, usage: null },
        request.value,
      ),
    ).toEqual({ ok: false, error: { code: 'unknown_key', path: '/usage' } })
  })

  it('contains the complete canonical result variant fixture set', () => {
    expect(Object.keys(synthesisFixtures.results).sort()).toEqual([
      'completedFailure',
      'rateLimited',
      'resultUnknown',
      'succeeded',
    ])
  })
})
