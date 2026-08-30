import { describe, expect, it } from 'vitest'
import {
  recordClassReviewGeneration,
  createProviderTelemetryRecorder,
  recordProviderOperation,
  recordUniqueProviderAttempts,
  serializeSafeProviderMetric,
} from './providerTelemetry.js'
import type { ProviderAttemptObservation, ProviderUsageSnapshot } from './providers/providerTypes.js'

const knownUsage: ProviderUsageSnapshot = {
  promptTokens: { status: 'known', value: 100 },
  completionTokens: { status: 'known', value: 20 },
  totalTokens: { status: 'known', value: 120 },
  cachedTokens: { status: 'known', value: 40 },
}

function observation(id: string, usage: ProviderUsageSnapshot = knownUsage): ProviderAttemptObservation {
  return { attemptDiagnosticId: id, finishReason: 'stop', usage, providerElapsedMs: 17 }
}

describe('provider telemetry', () => {
  it('records and accounts for each random Provider attempt exactly once', () => {
    const metrics: unknown[] = []
    const recorder = createProviderTelemetryRecorder({
      emit: (metric) => metrics.push(metric),
      processDiagnosticIdFactory: () => '11111111-1111-4111-8111-111111111111',
    })
    const attempt = observation('22222222-2222-4222-8222-222222222222')
    const context = { stage: 'essay_grading_images' as const, model: 'kimi-k3', reasoningEffort: 'low' as const, outcome: 'success' as const }

    recordUniqueProviderAttempts(recorder, context, [attempt])
    recordUniqueProviderAttempts(recorder, { ...context, outcome: 'failed' }, [attempt])

    expect(metrics).toEqual([{
      event: 'provider_attempt',
      processDiagnosticId: '11111111-1111-4111-8111-111111111111',
      attemptDiagnosticId: '22222222-2222-4222-8222-222222222222',
      stage: 'essay_grading_images', model: 'kimi-k3', reasoningEffort: 'low',
      providerMs: 17, finishReason: 'stop', attempt: 1, outcome: 'success',
      promptTokens: 100, completionTokens: 20, totalTokens: 120, cachedTokens: 40,
    }])
    expect(recorder.snapshot()).toEqual({
      uniqueAttempts: 1,
      usageCoverage: { knownAttempts: 1, unknownAttempts: 0 },
      totals: {
        promptTokens: { status: 'known', value: 100 },
        completionTokens: { status: 'known', value: 20 },
        totalTokens: { status: 'known', value: 120 },
        cachedTokens: { status: 'known', value: 40 },
      },
    })
  })

  it('does not count unknown or internally invalid usage as zero or as billable totals', () => {
    const metrics: unknown[] = []
    const recorder = createProviderTelemetryRecorder({ emit: (metric) => metrics.push(metric) })
    const unknownUsage: ProviderUsageSnapshot = {
      promptTokens: { status: 'unknown', reason: 'absent' },
      completionTokens: { status: 'known', value: 20 },
      totalTokens: { status: 'known', value: 20 },
      cachedTokens: { status: 'unknown', reason: 'absent' },
    }
    recordUniqueProviderAttempts(recorder, {
      stage: 'rubric_generation', model: 'kimi-k3', reasoningEffort: 'low', outcome: 'failed',
    }, [observation('33333333-3333-4333-8333-333333333333', unknownUsage)])

    expect(metrics).toHaveLength(1)
    expect(metrics[0]).not.toHaveProperty('promptTokens')
    expect(metrics[0]).not.toHaveProperty('completionTokens')
    expect(metrics[0]).not.toHaveProperty('totalTokens')
    expect(metrics[0]).not.toHaveProperty('cachedTokens')
    expect(recorder.snapshot()).toEqual({
      uniqueAttempts: 1,
      usageCoverage: { knownAttempts: 0, unknownAttempts: 1 },
      totals: {
        promptTokens: { status: 'unknown', knownAttempts: 0, unknownAttempts: 1 },
        completionTokens: { status: 'unknown', knownAttempts: 0, unknownAttempts: 1 },
        totalTokens: { status: 'unknown', knownAttempts: 0, unknownAttempts: 1 },
        cachedTokens: { status: 'unknown', knownAttempts: 0, unknownAttempts: 1 },
      },
    })
  })

  it('labels known usage from mixed-coverage attempts as lower bounds instead of authoritative totals', () => {
    const recorder = createProviderTelemetryRecorder()
    const unknownUsage: ProviderUsageSnapshot = {
      promptTokens: { status: 'unknown', reason: 'absent' },
      completionTokens: { status: 'unknown', reason: 'absent' },
      totalTokens: { status: 'unknown', reason: 'absent' },
      cachedTokens: { status: 'unknown', reason: 'absent' },
    }
    const context = {
      stage: 'essay_grading_images' as const,
      model: 'kimi-k3',
      reasoningEffort: 'low' as const,
      outcome: 'success' as const,
    }

    recordUniqueProviderAttempts(recorder, context, [
      observation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      observation('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', unknownUsage),
    ])

    expect(recorder.snapshot()).toEqual({
      uniqueAttempts: 2,
      usageCoverage: { knownAttempts: 1, unknownAttempts: 1 },
      totals: {
        promptTokens: { status: 'partial', lowerBound: 100, knownAttempts: 1, unknownAttempts: 1 },
        completionTokens: { status: 'partial', lowerBound: 20, knownAttempts: 1, unknownAttempts: 1 },
        totalTokens: { status: 'partial', lowerBound: 120, knownAttempts: 1, unknownAttempts: 1 },
        cachedTokens: { status: 'partial', lowerBound: 40, knownAttempts: 1, unknownAttempts: 1 },
      },
    })
  })

  it('checked-adds each token dimension and downgrades only overflowing totals to partial', () => {
    const recorder = createProviderTelemetryRecorder()
    const nearLimitUsage: ProviderUsageSnapshot = {
      promptTokens: { status: 'known', value: Number.MAX_SAFE_INTEGER - 5 },
      completionTokens: { status: 'known', value: 5 },
      totalTokens: { status: 'known', value: Number.MAX_SAFE_INTEGER },
      cachedTokens: { status: 'known', value: Number.MAX_SAFE_INTEGER - 5 },
    }
    const smallUsage: ProviderUsageSnapshot = {
      promptTokens: { status: 'known', value: 10 },
      completionTokens: { status: 'known', value: 2 },
      totalTokens: { status: 'known', value: 12 },
      cachedTokens: { status: 'known', value: 0 },
    }
    const context = {
      stage: 'essay_grading_images' as const,
      model: 'kimi-k3',
      reasoningEffort: 'low' as const,
      outcome: 'success' as const,
    }

    recordUniqueProviderAttempts(recorder, context, [
      observation('10101010-1010-4010-8010-101010101010', nearLimitUsage),
      observation('20202020-2020-4020-8020-202020202020', smallUsage),
    ])

    expect(recorder.snapshot()).toEqual({
      uniqueAttempts: 2,
      usageCoverage: { knownAttempts: 2, unknownAttempts: 0 },
      totals: {
        promptTokens: {
          status: 'partial', lowerBound: Number.MAX_SAFE_INTEGER - 5, knownAttempts: 1, unknownAttempts: 1,
        },
        completionTokens: { status: 'known', value: 7 },
        totalTokens: {
          status: 'partial', lowerBound: Number.MAX_SAFE_INTEGER, knownAttempts: 1, unknownAttempts: 1,
        },
        cachedTokens: { status: 'known', value: Number.MAX_SAFE_INTEGER - 5 },
      },
    })
  })

  it('keeps operation and attachment timing metrics structurally unable to carry usage', () => {
    const metrics: unknown[] = []
    const recorder = createProviderTelemetryRecorder({
      emit: (metric) => metrics.push(metric),
      processDiagnosticIdFactory: () => '44444444-4444-4444-8444-444444444444',
    })
    recordProviderOperation(recorder, {
      stage: 'essay_regrading_text', model: 'kimi-k3', reasoningEffort: 'low',
      operationDiagnosticId: '55555555-5555-4555-8555-555555555555',
      queueMs: 3, parseMs: 4, normalizeMs: 5, totalMs: 29,
      outcome: 'success', pageCount: 0, totalBytes: 0, confirmedTextCodeUnits: 31,
    })

    expect(metrics).toEqual([{
      event: 'provider_operation',
      processDiagnosticId: '44444444-4444-4444-8444-444444444444',
      operationDiagnosticId: '55555555-5555-4555-8555-555555555555',
      stage: 'essay_regrading_text', model: 'kimi-k3', reasoningEffort: 'low',
      queueMs: 3, parseMs: 4, normalizeMs: 5, totalMs: 29,
      outcome: 'success', pageCount: 0, totalBytes: 0, confirmedTextCodeUnits: 31,
    }])
    expect(JSON.stringify(metrics)).not.toMatch(/Tokens|usage/i)
  })

  it('omits unknown keys and rejects known fields containing sensitive marker values', () => {
    const safe = serializeSafeProviderMetric({
      event: 'provider_operation',
      processDiagnosticId: '66666666-6666-4666-8666-666666666666',
      operationDiagnosticId: '77777777-7777-4777-8777-777777777777',
      stage: 'material_context', model: 'kimi-k3', reasoningEffort: 'low', outcome: 'success',
      totalMs: 9,
      essayText: 'PRIVATE-ESSAY-MARKER',
      apiKey: 'Bearer PRIVATE-KEY',
      sourceDigest: 'PRIVATE-DIGEST',
    })
    expect(safe && JSON.parse(safe)).toEqual({
      event: 'provider_operation',
      processDiagnosticId: '66666666-6666-4666-8666-666666666666',
      operationDiagnosticId: '77777777-7777-4777-8777-777777777777',
      stage: 'material_context', model: 'kimi-k3', reasoningEffort: 'low', totalMs: 9, outcome: 'success',
    })
    expect(safe).not.toMatch(/PRIVATE|essayText|apiKey|sourceDigest/)

    expect(serializeSafeProviderMetric({
      event: 'provider_operation',
      processDiagnosticId: '88888888-8888-4888-8888-888888888888',
      operationDiagnosticId: '99999999-9999-4999-8999-999999999999',
      stage: 'material_context', model: 'Bearer PRIVATE-KEY', reasoningEffort: 'low', outcome: 'failed',
    })).toBeNull()
  })

  it('deduplicates actual class-review completions and emits one exact safe operation record', () => {
    const metrics: unknown[] = []
    const recorder = createProviderTelemetryRecorder({
      emit: (metric) => metrics.push(metric),
      processDiagnosticIdFactory: () => 'abababab-abab-4bab-8bab-abababababab',
    })
    const attempt = observation('cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd')
    const context = {
      stage: 'class_review_generation' as const,
      model: 'kimi-k3',
      reasoningEffort: 'low' as const,
      outcome: 'success' as const,
    }
    recordUniqueProviderAttempts(recorder, context, [attempt])
    recordUniqueProviderAttempts(recorder, context, [attempt])
    recordClassReviewGeneration(recorder, {
      stage: 'class_review_generation',
      model: 'kimi-k3',
      reasoningEffort: 'low',
      operationDiagnosticId: 'efefefef-efef-4fef-8fef-efefefefefef',
      state: 'completed',
      outcome: 'success',
      attemptCount: 1,
      includedEssayCount: 3,
      excludedEssayCount: 1,
      projectedGroupCount: 2,
      eligibleGroupCount: 3,
      projectedDistinctEssaySupportSum: 3,
      eligibleDistinctEssaySupportSum: 4,
      projectedOccurrenceSum: 4,
      eligibleOccurrenceSum: 6,
      queueMs: 1,
      providerMs: 17,
      validationMs: 1,
      totalMs: 19,
      promptTokenInvariant: true,
    })

    expect(metrics).toEqual([
      {
        event: 'provider_attempt',
        processDiagnosticId: 'abababab-abab-4bab-8bab-abababababab',
        attemptDiagnosticId: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
        stage: 'class_review_generation', model: 'kimi-k3', reasoningEffort: 'low',
        providerMs: 17, finishReason: 'stop', attempt: 1, outcome: 'success',
        promptTokens: 100, completionTokens: 20, totalTokens: 120, cachedTokens: 40,
      },
      {
        event: 'provider_operation',
        processDiagnosticId: 'abababab-abab-4bab-8bab-abababababab',
        operationDiagnosticId: 'efefefef-efef-4fef-8fef-efefefefefef',
        stage: 'class_review_generation', model: 'kimi-k3', reasoningEffort: 'low',
        state: 'completed', outcome: 'success', attemptCount: 1,
        includedEssayCount: 3, excludedEssayCount: 1,
        projectedGroupCount: 2, eligibleGroupCount: 3,
        projectedDistinctEssaySupportSum: 3, eligibleDistinctEssaySupportSum: 4,
        projectedOccurrenceSum: 4, eligibleOccurrenceSum: 6,
        queueMs: 1, providerMs: 17, validationMs: 1, totalMs: 19,
        promptTokenInvariant: true,
      },
    ])
    expect(recorder.snapshot().uniqueAttempts).toBe(1)
  })

  it('allows a fixed class failure code but strips all body, alias, ratio, credential and raw fields', () => {
    const serialized = serializeSafeProviderMetric({
      event: 'provider_operation',
      processDiagnosticId: '12121212-1212-4212-8212-121212121212',
      operationDiagnosticId: '34343434-3434-4434-8434-343434343434',
      stage: 'class_review_generation', model: 'kimi-k3', reasoningEffort: 'low',
      state: 'completed', outcome: 'failed', safeFailureCode: 'provider_invalid_response',
      attemptCount: 1,
      includedEssayCount: 3, excludedEssayCount: 1,
      projectedGroupCount: 1, eligibleGroupCount: 3,
      projectedDistinctEssaySupportSum: 2, eligibleDistinctEssaySupportSum: 4,
      projectedOccurrenceSum: 3, eligibleOccurrenceSum: 6,
      queueMs: 1, providerMs: 2, validationMs: 1, totalMs: 4,
      promptTokenInvariant: false,
      groupCoverage: 1 / 3,
      requestId: 'PRIVATE-REQUEST-ID',
      groupIds: ['PRIVATE-GROUP-ID'],
      dimensionIds: ['PRIVATE-DIMENSION-ID'],
      originalText: 'PRIVATE-ESSAY-CONTENT',
      prompt: 'PRIVATE-PROMPT',
      Authorization: 'Bearer PRIVATE-KEY',
      rawResponse: { private: true },
    })
    expect(serialized && JSON.parse(serialized)).toEqual({
      event: 'provider_operation',
      processDiagnosticId: '12121212-1212-4212-8212-121212121212',
      operationDiagnosticId: '34343434-3434-4434-8434-343434343434',
      stage: 'class_review_generation', model: 'kimi-k3', reasoningEffort: 'low',
      state: 'completed', outcome: 'failed', safeFailureCode: 'provider_invalid_response',
      attemptCount: 1,
      includedEssayCount: 3, excludedEssayCount: 1,
      projectedGroupCount: 1, eligibleGroupCount: 3,
      projectedDistinctEssaySupportSum: 2, eligibleDistinctEssaySupportSum: 4,
      projectedOccurrenceSum: 3, eligibleOccurrenceSum: 6,
      queueMs: 1, providerMs: 2, validationMs: 1, totalMs: 4,
      promptTokenInvariant: false,
    })
    expect(serialized).not.toMatch(/PRIVATE|groupCoverage|requestId|groupIds|dimensionIds|originalText|"prompt"|Authorization|rawResponse/)
  })

  it('does not let fake or no-attempt operations claim the real-Kimi prompt invariant', () => {
    const base = {
      event: 'provider_operation',
      processDiagnosticId: '56565656-5656-4656-8656-565656565656',
      operationDiagnosticId: '78787878-7878-4878-8878-787878787878',
      stage: 'class_review_generation', reasoningEffort: 'low',
      state: 'completed', outcome: 'success',
      includedEssayCount: 3, excludedEssayCount: 1,
      projectedGroupCount: 2, eligibleGroupCount: 3,
      projectedDistinctEssaySupportSum: 3, eligibleDistinctEssaySupportSum: 4,
      projectedOccurrenceSum: 4, eligibleOccurrenceSum: 6,
      queueMs: 1, providerMs: 2, validationMs: 1, totalMs: 4,
    }
    const fake = serializeSafeProviderMetric({
      ...base, model: 'fake', attemptCount: 1, promptTokenInvariant: true,
    })
    expect(fake && JSON.parse(fake)).not.toHaveProperty('promptTokenInvariant')
    const noAttempt = serializeSafeProviderMetric({
      ...base, model: 'kimi-k3', attemptCount: 0, promptTokenInvariant: true,
    })
    expect(noAttempt && JSON.parse(noAttempt)).not.toHaveProperty('promptTokenInvariant')
  })

  it('rejects internally contradictory class-review operation metrics', () => {
    const base = {
      event: 'provider_operation',
      processDiagnosticId: '90909090-9090-4090-8090-909090909090',
      operationDiagnosticId: '91919191-9191-4191-8191-919191919191',
      stage: 'class_review_generation', model: 'kimi-k3', reasoningEffort: 'low',
      state: 'not_started', outcome: 'failed', safeFailureCode: 'provider_timeout',
      attemptCount: 0, includedEssayCount: 3, excludedEssayCount: 1,
      projectedGroupCount: 2, eligibleGroupCount: 3,
      projectedDistinctEssaySupportSum: 3, eligibleDistinctEssaySupportSum: 4,
      projectedOccurrenceSum: 4, eligibleOccurrenceSum: 6,
      queueMs: 1, providerMs: 0, validationMs: 1, totalMs: 2,
    }
    expect(serializeSafeProviderMetric({ ...base, outcome: 'success' })).toBeNull()
    expect(serializeSafeProviderMetric({ ...base, safeFailureCode: undefined })).toBeNull()
    expect(serializeSafeProviderMetric({ ...base, attemptCount: 1 })).toBeNull()
    expect(serializeSafeProviderMetric({ ...base, totalMs: 0 })).toBeNull()
    expect(serializeSafeProviderMetric({
      ...base, state: 'unknown', outcome: 'result_unknown',
      safeFailureCode: 'provider_timeout',
    })).toBeNull()
  })
})
