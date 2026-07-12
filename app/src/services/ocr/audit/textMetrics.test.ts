import { describe, expect, it } from 'vitest'
import {
  OCR_TEXT_METRICS_VERSION,
  calculateBenchmarkMetrics,
  calculateReviewTextMetrics,
  toMetricProjection,
} from './textMetrics'

describe('OCR text metrics v1', () => {
  it('uses the fixed comparison projection without correcting student language', () => {
    expect(toMetricProjection('  i  think\r\n\r\n\r\nIt\tis useful.  ')).toBe('i think\n\nIt is useful.')
    expect(toMetricProjection('pur-\npose')).toBe('pur-\npose')
  })

  it('counts Unicode code points with deterministic unit-cost edits', () => {
    expect(calculateReviewTextMetrics('a😀c', 'a😃c', '2026-07-12T00:00:00.000Z')).toEqual({
      metricsVersion: OCR_TEXT_METRICS_VERSION,
      actualTeacherAction: 'confirmed_after_edit',
      editDistance: 1,
      changedCharacterCount: 1,
      confirmedAt: '2026-07-12T00:00:00.000Z',
    })
  })

  it('preserves case, punctuation, hyphens, and line breaks in CER and WER', () => {
    const result = calculateBenchmarkMetrics('Hello, pur-\npose', 'hello purpose')

    expect(result.metricsVersion).toBe(OCR_TEXT_METRICS_VERSION)
    expect(result.cer).not.toBe(0)
    expect(result.wer).toBe(1.5)
    expect(result.invalidReason).toBeUndefined()
  })

  it('returns null CER and WER for an empty reference', () => {
    expect(calculateBenchmarkMetrics('extra', '')).toEqual({
      metricsVersion: OCR_TEXT_METRICS_VERSION,
      cer: null,
      wer: null,
      invalidReason: 'empty_reference',
    })
  })

  it('does not clamp CER or WER to one', () => {
    const result = calculateBenchmarkMetrics('a b c d', 'a')
    expect(result.cer).toBeGreaterThan(1)
    expect(result.wer).toBeGreaterThan(1)
  })
})
