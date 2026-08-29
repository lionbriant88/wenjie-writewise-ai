import { describe, expect, it } from 'vitest'

import {
  aggregateUniqueCompletionMetrics,
  calculateCer,
  calculateEvidenceLocationRate,
  calculateImportantRecall,
  calculateMean,
  calculateMedian,
  normalizedScoreError,
  pairedBootstrap95,
  summarizeCer,
} from './metrics.js'

describe('grading benchmark metrics', () => {
  it('counts Unicode code points rather than UTF-16 code units for CER', () => {
    expect(calculateCer('𠮷甲', '𠮷乙')).toEqual({
      status: 'measured',
      value: 0.5,
      editDistance: 1,
      referenceCodePoints: 2,
    })
  })

  it('keeps CER not measurable when the reference has no code points', () => {
    expect(calculateCer('', '多')).toEqual({
      status: 'not_measurable',
      reason: 'empty_reference',
    })
  })

  it('reports distinct macro and micro CER aggregates', () => {
    const summary = summarizeCer([
      { reference: 'a', hypothesis: 'x' },
      { reference: 'abcdefghi', hypothesis: 'xbcdefghi' },
    ])

    expect(summary.macro).toEqual({ status: 'measured', value: 5 / 9 })
    expect(summary.micro).toEqual({ status: 'measured', value: 0.2 })
    expect(summary.measurableSampleCount).toBe(2)
    expect(summary.excludedSampleCount).toBe(0)
  })

  it('does not let an empty reference silently improve CER aggregates', () => {
    const summary = summarizeCer([{ reference: '', hypothesis: '' }])

    expect(summary.macro).toEqual({
      status: 'not_measurable',
      reason: 'no_non_empty_references',
    })
    expect(summary.micro).toEqual({
      status: 'not_measurable',
      reason: 'no_reference_code_points',
    })
    expect(summary.excludedSampleCount).toBe(1)
  })

  it('normalizes absolute score error by full score', () => {
    expect(normalizedScoreError(82, 90, 100)).toEqual({
      status: 'measured',
      value: 0.08,
    })
  })

  it('keeps score error not measurable for a zero full score', () => {
    expect(normalizedScoreError(0, 0, 0)).toEqual({
      status: 'not_measurable',
      reason: 'non_positive_full_score',
    })
  })

  it('calculates the finite arithmetic mean without mutating caller-owned data', () => {
    const values = [1, 2, 6]

    expect(calculateMean(values)).toEqual({ status: 'measured', value: 3 })
    expect(values).toEqual([1, 2, 6])
  })

  it.each([
    { name: 'empty input', values: [] },
    { name: 'null observation', values: [1, null] },
    { name: 'undefined observation', values: [1, undefined] },
    { name: 'NaN observation', values: [1, Number.NaN] },
    { name: 'positive infinity observation', values: [1, Number.POSITIVE_INFINITY] },
    { name: 'negative infinity observation', values: [1, Number.NEGATIVE_INFINITY] },
  ])('keeps the mean not measurable for $name', ({ values }) => {
    expect(calculateMean(values)).toEqual({
      status: 'not_measurable',
      reason: 'unknown_or_invalid_value',
    })
  })

  it('keeps the mean not measurable when adding finite observations overflows', () => {
    expect(calculateMean([Number.MAX_VALUE, Number.MAX_VALUE])).toEqual({
      status: 'not_measurable',
      reason: 'unknown_or_invalid_value',
    })
  })

  it.each([
    {
      name: 'score subtraction',
      modelScore: Number.MAX_VALUE,
      teacherScore: -Number.MAX_VALUE,
      fullScore: 1,
    },
    {
      name: 'score division',
      modelScore: Number.MAX_VALUE,
      teacherScore: 0,
      fullScore: Number.MIN_VALUE,
    },
  ])('keeps score error not measurable when finite $name overflows', (sample) => {
    expect(
      normalizedScoreError(sample.modelScore, sample.teacherScore, sample.fullScore),
    ).toEqual({
      status: 'not_measurable',
      reason: 'unknown_or_invalid_value',
    })
  })

  it('calculates an even-sized median without sorting caller-owned data', () => {
    const values = [30, 10, 40, 20]

    expect(calculateMedian(values)).toEqual({ status: 'measured', value: 25 })
    expect(values).toEqual([30, 10, 40, 20])
  })

  it('keeps a median with any unknown observation not measurable', () => {
    expect(calculateMedian([10, null, 20])).toEqual({
      status: 'not_measurable',
      reason: 'unknown_or_invalid_value',
    })
  })

  it('keeps an even median not measurable when adding finite middle values overflows', () => {
    expect(calculateMedian([Number.MAX_VALUE, Number.MAX_VALUE])).toEqual({
      status: 'not_measurable',
      reason: 'unknown_or_invalid_value',
    })
  })

  it('measures only teacher-labelled important items in recall', () => {
    expect(
      calculateImportantRecall([
        { important: true, detected: true },
        { important: true, detected: false },
        { important: false, detected: false },
      ]),
    ).toEqual({ status: 'measured', value: 0.5, matched: 1, total: 2 })
  })

  it('reports zero-denominator issue or legibility recall as not measurable', () => {
    expect(calculateImportantRecall([{ important: false, detected: true }])).toEqual({
      status: 'not_measurable',
      reason: 'no_important_labels',
    })
  })

  it('deduplicates repeated HTTP observations by UUID provider attempt', () => {
    const attemptId = '123e4567-e89b-42d3-a456-426614174000'
    const result = aggregateUniqueCompletionMetrics([
      {
        attemptId,
        usage: { promptTokens: 100, completionTokens: 40, totalTokens: 140, cachedTokens: 20 },
        finishReason: 'stop',
        phaseTimingsMs: { queue: 5, provider: 80, parse: 3, normalize: 2, total: 90 },
      },
      {
        attemptId,
        usage: { promptTokens: 100, completionTokens: 40, totalTokens: 140, cachedTokens: 20 },
        finishReason: 'stop',
        phaseTimingsMs: { queue: 5, provider: 80, parse: 3, normalize: 2, total: 90 },
      },
    ])

    expect(result.uniqueAttemptCount).toBe(1)
    expect(result.duplicateObservationCount).toBe(1)
    expect(result.tokens.totalTokens).toEqual({ status: 'measured', value: 140 })
    expect(result.finishReasons).toEqual({ counts: { stop: 1 }, unknownCount: 0 })
    expect(result.phaseTimingsMs.provider).toEqual({ status: 'measured', value: 80 })
  })

  it('keeps partial and unknown token fields unknown instead of adding zero', () => {
    const result = aggregateUniqueCompletionMetrics([
      {
        attemptId: '123e4567-e89b-42d3-a456-426614174000',
        usage: { promptTokens: 100 },
        finishReason: null,
        phaseTimingsMs: { provider: 80 },
      },
      {
        attemptId: '123e4567-e89b-42d3-a456-426614174001',
      },
    ])

    expect(result.tokens.promptTokens).toEqual({
      status: 'not_measurable',
      reason: 'unknown_or_partial_usage',
    })
    expect(result.tokens.totalTokens).toEqual({
      status: 'not_measurable',
      reason: 'unknown_or_partial_usage',
    })
    expect(result.finishReasons.unknownCount).toBe(2)
    expect(result.phaseTimingsMs.provider).toEqual({
      status: 'not_measurable',
      reason: 'unknown_or_partial_phase_timing',
    })
    expect(result.phaseTimingsMs.parse).toEqual({
      status: 'not_measurable',
      reason: 'unknown_or_partial_phase_timing',
    })
  })

  it('keeps non-safe-integer token observations not measurable', () => {
    const result = aggregateUniqueCompletionMetrics([
      {
        attemptId: '123e4567-e89b-42d3-a456-426614174000',
        usage: { promptTokens: 1e308 },
      },
    ])

    expect(result.tokens.promptTokens).toEqual({
      status: 'not_measurable',
      reason: 'unknown_or_partial_usage',
    })
  })

  it('keeps token aggregation not measurable when safe integer observations overflow the safe sum', () => {
    const result = aggregateUniqueCompletionMetrics([
      {
        attemptId: '123e4567-e89b-42d3-a456-426614174000',
        usage: { promptTokens: Number.MAX_SAFE_INTEGER },
      },
      {
        attemptId: '123e4567-e89b-42d3-a456-426614174001',
        usage: { promptTokens: Number.MAX_SAFE_INTEGER },
      },
    ])

    expect(result.tokens.promptTokens).toEqual({
      status: 'not_measurable',
      reason: 'unknown_or_partial_usage',
    })
  })

  it('keeps phase timing aggregation not measurable when finite observations overflow the sum', () => {
    const result = aggregateUniqueCompletionMetrics([
      {
        attemptId: '123e4567-e89b-42d3-a456-426614174000',
        phaseTimingsMs: { provider: 1e308 },
      },
      {
        attemptId: '123e4567-e89b-42d3-a456-426614174001',
        phaseTimingsMs: { provider: 1e308 },
      },
    ])

    expect(result.phaseTimingsMs.provider).toEqual({
      status: 'not_measurable',
      reason: 'unknown_or_partial_phase_timing',
    })
  })

  it('lets a late known observation fill an unknown only for the same provider attempt', () => {
    const firstAttemptId = '123e4567-e89b-42d3-a456-426614174000'
    const sameAttempt = aggregateUniqueCompletionMetrics([
      {
        attemptId: firstAttemptId,
        usage: { totalTokens: null },
        finishReason: null,
        phaseTimingsMs: { provider: null },
      },
      {
        attemptId: firstAttemptId,
        usage: { totalTokens: 140 },
        finishReason: 'stop',
        phaseTimingsMs: { provider: 80 },
      },
    ])

    expect(sameAttempt.duplicateObservationCount).toBe(1)
    expect(sameAttempt.tokens.totalTokens).toEqual({ status: 'measured', value: 140 })
    expect(sameAttempt.phaseTimingsMs.provider).toEqual({ status: 'measured', value: 80 })
    expect(sameAttempt.finishReasons).toEqual({ counts: { stop: 1 }, unknownCount: 0 })

    const differentAttempts = aggregateUniqueCompletionMetrics([
      { attemptId: firstAttemptId, usage: { totalTokens: 140 } },
      {
        attemptId: '123e4567-e89b-42d3-a456-426614174001',
        usage: { totalTokens: null },
      },
    ])
    expect(differentAttempts.tokens.totalTokens).toEqual({
      status: 'not_measurable',
      reason: 'unknown_or_partial_usage',
    })
  })

  it('rejects non-UUID attempt identities so caller IDs cannot masquerade as completions', () => {
    expect(() => aggregateUniqueCompletionMetrics([{ attemptId: 'request-1' }])).toThrow(
      'attemptId must be a UUID',
    )
  })

  it('rejects conflicting duplicates for the same provider attempt', () => {
    const attemptId = '123e4567-e89b-42d3-a456-426614174000'

    expect(() =>
      aggregateUniqueCompletionMetrics([
        { attemptId, usage: { totalTokens: 140 } },
        { attemptId, usage: { totalTokens: 141 } },
      ]),
    ).toThrow('conflicting observations for provider attempt')
  })

  it('keeps internally inconsistent usage unknown', () => {
    const result = aggregateUniqueCompletionMetrics([
      {
        attemptId: '123e4567-e89b-42d3-a456-426614174000',
        usage: { promptTokens: 100, completionTokens: 40, totalTokens: 139, cachedTokens: 101 },
      },
    ])

    expect(result.tokens.promptTokens).toEqual({
      status: 'not_measurable',
      reason: 'unknown_or_partial_usage',
    })
    expect(result.tokens.totalTokens).toEqual({
      status: 'not_measurable',
      reason: 'unknown_or_partial_usage',
    })
  })

  it('returns a deterministic paired bootstrap 95% interval', () => {
    const first = pairedBootstrap95([0.1, 0.2, 0.3, 0.4], [0.11, 0.18, 0.32, 0.43], {
      seed: 2468,
      iterations: 2000,
    })
    const second = pairedBootstrap95([0.1, 0.2, 0.3, 0.4], [0.11, 0.18, 0.32, 0.43], {
      seed: 2468,
      iterations: 2000,
    })

    expect(first).toEqual(second)
    expect(first.status).toBe('measured')
    if (first.status === 'measured') {
      expect(first.value.estimate).toBeCloseTo(0.01, 12)
      expect(first.value.lower).toBeLessThanOrEqual(first.value.estimate)
      expect(first.value.upper).toBeGreaterThanOrEqual(first.value.estimate)
      expect(first.value.confidence).toBe(0.95)
    }
  })

  it('returns an exact paired interval for a single pair', () => {
    expect(pairedBootstrap95([0.2], [0.205], { seed: 1, iterations: 100 })).toEqual({
      status: 'measured',
      value: {
        estimate: 0.004999999999999977,
        lower: 0.004999999999999977,
        upper: 0.004999999999999977,
        confidence: 0.95,
        iterations: 100,
        seed: 1,
      },
    })
  })

  it('keeps an empty paired bootstrap comparison not measurable', () => {
    expect(pairedBootstrap95([], [])).toEqual({
      status: 'not_measurable',
      reason: 'no_pairs',
    })
  })

  it('keeps paired bootstrap not measurable when a finite pair difference overflows', () => {
    expect(
      pairedBootstrap95([-Number.MAX_VALUE], [Number.MAX_VALUE], {
        seed: 1,
        iterations: 10,
      }),
    ).toEqual({
      status: 'not_measurable',
      reason: 'unknown_or_invalid_value',
    })
  })

  it('keeps paired bootstrap not measurable when resampling finite differences overflows', () => {
    expect(
      pairedBootstrap95([0, 0], [Number.MAX_VALUE, -Number.MAX_VALUE], {
        seed: 1,
        iterations: 100,
      }),
    ).toEqual({
      status: 'not_measurable',
      reason: 'unknown_or_invalid_value',
    })
  })

  it('counts evidence as located only when it has exactly one transcript match', () => {
    expect(
      calculateEvidenceLocationRate([
        { accepted: true, transcriptMatchCount: 1 },
        { accepted: true, transcriptMatchCount: 2 },
        { accepted: false, transcriptMatchCount: 0 },
      ]),
    ).toEqual({ status: 'measured', value: 0.5, uniquelyLocated: 1, total: 2 })
  })

  it('keeps evidence location not measurable when no accepted evidence exists', () => {
    expect(calculateEvidenceLocationRate([])).toEqual({
      status: 'not_measurable',
      reason: 'no_accepted_evidence',
    })
  })
})
