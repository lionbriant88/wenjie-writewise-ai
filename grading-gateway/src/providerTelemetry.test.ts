import { describe, expect, it } from 'vitest'
import {
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
      uniqueAttempts: 1, usageContributingAttempts: 1,
      promptTokens: 100, completionTokens: 20, totalTokens: 120, cachedTokens: 40,
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
      uniqueAttempts: 1, usageContributingAttempts: 0,
      promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0,
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
})
