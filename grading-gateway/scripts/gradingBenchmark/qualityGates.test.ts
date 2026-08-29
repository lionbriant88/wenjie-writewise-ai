import { describe, expect, it } from 'vitest'

import { evaluateQualityGates } from './qualityGates.js'

const passingInput = {
  structuredSuccess: {
    baseline: { accepted: 99, total: 100 },
    candidate: { accepted: 99, total: 100 },
  },
  tokenMedians: { baseline: 100, candidate: 75 },
  cerDegradation95: { lower: -0.002, upper: 0.005 },
  scoreErrorDegradation95: { lower: -0.01, upper: 0.01 },
  importantIssueRecall: { baseline: 0.9, candidate: 0.85 },
  importantLegibilityRecall: { baseline: 1, candidate: 0.95 },
  evidence: { uniquelyLocated: 20, total: 20 },
  hardRisks: {
    studentMix: 0,
    wrongTaskContext: 0,
    highRiskLegibilityMiss: 0,
    piiLeakage: 0,
  },
  soak: { totalCalls: 100, contractFailures: 1 },
  throughput: {
    essayCount: 30,
    baselineElapsedMs: 100_000,
    candidateElapsedMs: 40_000,
    effectiveConcurrency: 4,
  },
  blindReview: {
    sampleCount: 40,
    reviewedSampleCount: 40,
    randomizedAB: true,
    secondaryReviewSampleCount: 8,
    reviewerRelationship: 'independent_teacher',
    sameTeacherReviewIntervalDays: null,
    unresolvedArbitrations: 0,
    systematicDegradation: false,
  },
} as const

describe('grading benchmark quality gates', () => {
  it('passes every threshold at its inclusive boundary', () => {
    const result = evaluateQualityGates(passingInput)

    expect(result.status).toBe('pass')
    expect(Object.values(result.gates).every((gate) => gate.status === 'pass')).toBe(true)
    expect(result.gates.structuredSuccess).toMatchObject({
      status: 'pass',
      actual: 0.99,
      threshold: 0.99,
    })
    expect(result.gates.blindReview).toMatchObject({ status: 'pass' })
    expect(result.gates.tokenReduction.actual).toBe(0.25)
    expect(result.gates.throughput.actual).toBe(0.6)
  })

  it.each([
    [{ randomizedAB: false }, 'requires_randomized_ab'],
    [{ reviewerRelationship: 'same_teacher_delayed', sameTeacherReviewIntervalDays: 6 }, 'requires_independent_or_seven_day_review'],
  ] as const)('rejects an invalid blind-review protocol %o', (replacement, reason) => {
    const result = evaluateQualityGates({
      ...passingInput,
      blindReview: { ...passingInput.blindReview, ...replacement },
    })

    expect(result.gates.blindReview).toMatchObject({ status: 'fail', reason })
  })

  it.each([
    [
      'structuredSuccess',
      {
        structuredSuccess: {
          baseline: { accepted: 99, total: 100 },
          candidate: { accepted: 98, total: 100 },
        },
      },
    ],
    [
      'structuredSuccess',
      {
        structuredSuccess: {
          baseline: { accepted: 100, total: 100 },
          candidate: { accepted: 99, total: 100 },
        },
      },
    ],
    ['tokenReduction', { tokenMedians: { baseline: 100, candidate: 75.01 } }],
    ['cerDegradation', { cerDegradation95: { lower: -0.002, upper: 0.005_001 } }],
    ['scoreErrorDegradation', { scoreErrorDegradation95: { lower: 0, upper: 0.010_001 } }],
    ['importantIssueRecall', { importantIssueRecall: { baseline: 0.9, candidate: 0.849_999 } }],
    [
      'importantLegibilityRecall',
      { importantLegibilityRecall: { baseline: 1, candidate: 0.949_999 } },
    ],
    ['evidenceLocation', { evidence: { uniquelyLocated: 19, total: 20 } }],
    [
      'hardRisks',
      {
        hardRisks: {
          studentMix: 1,
          wrongTaskContext: 0,
          highRiskLegibilityMiss: 0,
          piiLeakage: 0,
        },
      },
    ],
    ['soak', { soak: { totalCalls: 100, contractFailures: 2 } }],
    [
      'throughput',
      {
        throughput: {
          essayCount: 30,
          baselineElapsedMs: 100_000,
          candidateElapsedMs: 40_001,
          effectiveConcurrency: 4,
        },
      },
    ],
    [
      'blindReview',
      {
        blindReview: {
          sampleCount: 40,
          reviewedSampleCount: 40,
          randomizedAB: true,
          secondaryReviewSampleCount: 8,
          reviewerRelationship: 'independent_teacher',
          sameTeacherReviewIntervalDays: null,
          unresolvedArbitrations: 0,
          systematicDegradation: true,
        },
      },
    ],
  ] as const)('fails %s when it misses the threshold', (gateName, replacement) => {
    const result = evaluateQualityGates({ ...passingInput, ...replacement } as never)

    expect(result.status).toBe('fail')
    expect(result.gates[gateName].status).toBe('fail')
  })

  it('is inconclusive when structured-success evidence is missing', () => {
    const result = evaluateQualityGates({ ...passingInput, structuredSuccess: undefined })

    expect(result.status).toBe('inconclusive')
    expect(result.gates.structuredSuccess).toMatchObject({
      status: 'not_measurable',
      actual: null,
    })
  })

  it.each([
    {
      baseline: { accepted: 0, total: 0 },
      candidate: { accepted: 99, total: 100 },
    },
    {
      baseline: { accepted: 99, total: 100 },
      candidate: { accepted: 0, total: 0 },
    },
    {
      baseline: { accepted: Number.NaN, total: 100 },
      candidate: { accepted: 99, total: 100 },
    },
    {
      baseline: { accepted: 99, total: 100 },
      candidate: { accepted: 99, total: Number.POSITIVE_INFINITY },
    },
    {
      baseline: { accepted: 101, total: 100 },
      candidate: { accepted: 99, total: 100 },
    },
  ])('is inconclusive for invalid structured-success counts %#', (structuredSuccess) => {
    const result = evaluateQualityGates({ ...passingInput, structuredSuccess })

    expect(result.status).toBe('inconclusive')
    expect(result.gates.structuredSuccess.status).toBe('not_measurable')
  })

  it.each([
    [
      'requires_exactly_40_samples',
      {
        sampleCount: 39,
        reviewedSampleCount: 39,
        randomizedAB: true,
        secondaryReviewSampleCount: 8,
        reviewerRelationship: 'independent_teacher',
        sameTeacherReviewIntervalDays: null,
        unresolvedArbitrations: 0,
        systematicDegradation: false,
      },
    ],
    [
      'requires_complete_review',
      {
        sampleCount: 40,
        reviewedSampleCount: 39,
        randomizedAB: true,
        secondaryReviewSampleCount: 8,
        reviewerRelationship: 'independent_teacher',
        sameTeacherReviewIntervalDays: null,
        unresolvedArbitrations: 0,
        systematicDegradation: false,
      },
    ],
    [
      'requires_20_percent_secondary_review',
      {
        sampleCount: 40,
        reviewedSampleCount: 40,
        randomizedAB: true,
        secondaryReviewSampleCount: 7,
        reviewerRelationship: 'independent_teacher',
        sameTeacherReviewIntervalDays: null,
        unresolvedArbitrations: 0,
        systematicDegradation: false,
      },
    ],
    [
      'requires_zero_unresolved_arbitrations',
      {
        sampleCount: 40,
        reviewedSampleCount: 40,
        randomizedAB: true,
        secondaryReviewSampleCount: 8,
        reviewerRelationship: 'independent_teacher',
        sameTeacherReviewIntervalDays: null,
        unresolvedArbitrations: 1,
        systematicDegradation: false,
      },
    ],
  ] as const)('fails a complete blind review that %s', (reason, blindReview) => {
    const result = evaluateQualityGates({ ...passingInput, blindReview } as never)

    expect(result.status).toBe('fail')
    expect(result.gates.blindReview).toMatchObject({ status: 'fail', reason })
  })

  it.each([
    undefined,
    {
      sampleCount: 40,
      reviewedSampleCount: 41,
      secondaryReviewSampleCount: 8,
      unresolvedArbitrations: 0,
      systematicDegradation: false,
    },
    {
      sampleCount: 40,
      reviewedSampleCount: 40,
      secondaryReviewSampleCount: 41,
      unresolvedArbitrations: 0,
      systematicDegradation: false,
    },
    {
      sampleCount: 40.5,
      reviewedSampleCount: 40,
      secondaryReviewSampleCount: 8,
      unresolvedArbitrations: 0,
      systematicDegradation: false,
    },
  ])('is inconclusive for missing or invalid blind-review evidence %#', (blindReview) => {
    const result = evaluateQualityGates({ ...passingInput, blindReview } as never)

    expect(result.status).toBe('inconclusive')
    expect(result.gates.blindReview.status).toBe('not_measurable')
  })

  it('is inconclusive when token usage is unknown rather than treating it as zero', () => {
    const result = evaluateQualityGates({ ...passingInput, tokenMedians: undefined })

    expect(result.status).toBe('inconclusive')
    expect(result.gates.tokenReduction).toMatchObject({
      status: 'not_measurable',
      actual: null,
    })
  })

  it('is inconclusive for zero-denominator recall instead of claiming perfect recall', () => {
    const result = evaluateQualityGates({
      ...passingInput,
      importantIssueRecall: { baseline: null, candidate: null },
    })

    expect(result.status).toBe('inconclusive')
    expect(result.gates.importantIssueRecall.status).toBe('not_measurable')
  })

  it('is inconclusive when evidence has no accepted references', () => {
    const result = evaluateQualityGates({
      ...passingInput,
      evidence: { uniquelyLocated: 0, total: 0 },
    })

    expect(result.status).toBe('inconclusive')
    expect(result.gates.evidenceLocation.status).toBe('not_measurable')
  })

  it('is inconclusive unless the soak contains exactly 100 calls', () => {
    const result = evaluateQualityGates({
      ...passingInput,
      soak: { totalCalls: 99, contractFailures: 0 },
    })

    expect(result.status).toBe('inconclusive')
    expect(result.gates.soak.status).toBe('not_measurable')
  })

  it('is inconclusive below effective concurrency four even with a fast candidate', () => {
    const result = evaluateQualityGates({
      ...passingInput,
      throughput: { ...passingInput.throughput, candidateElapsedMs: 1, effectiveConcurrency: 3.99 },
    })

    expect(result.status).toBe('inconclusive')
    expect(result.gates.throughput.status).toBe('not_measurable')
  })

  it('is inconclusive unless throughput measures exactly 30 essays', () => {
    const result = evaluateQualityGates({
      ...passingInput,
      throughput: { ...passingInput.throughput, essayCount: 29 },
    })

    expect(result.status).toBe('inconclusive')
    expect(result.gates.throughput.status).toBe('not_measurable')
  })

  it('keeps a real failure decisive even when another gate is not measurable', () => {
    const result = evaluateQualityGates({
      ...passingInput,
      tokenMedians: undefined,
      hardRisks: { ...passingInput.hardRisks, wrongTaskContext: 1 },
    })

    expect(result.status).toBe('fail')
    expect(result.gates.tokenReduction.status).toBe('not_measurable')
    expect(result.gates.hardRisks.status).toBe('fail')
  })
})
