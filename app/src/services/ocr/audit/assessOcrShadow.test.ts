import { describe, expect, it } from 'vitest'
import type { OcrEssayResult } from '../types'
import { assessOcrShadow } from './assessOcrShadow'
import { OCR_SHADOW_ASSESSMENT_VERSION } from './types'

const assessedAt = '2026-07-12T01:02:03.000Z'

function result(overrides: Partial<OcrEssayResult> = {}): OcrEssayResult {
  return {
    essayGroupId: 'group-1',
    text: 'Essay text',
    pages: [{ pageId: 'page-1', text: 'Essay text', confidence: 0.9 }],
    provider: 'remote',
    status: 'success',
    ...overrides,
  }
}

describe('assessOcrShadow', () => {
  it('detects a missing page by pageId set difference, not page count', () => {
    const assessment = assessOcrShadow({
      sourceKind: 'remote',
      result: result({ pages: [{ pageId: 'wrong-page', text: 'Essay text' }] }),
      expectedPageIds: ['page-1'],
      assessedAt,
    })

    expect(assessment.outcome).toBe('review_recommended')
    expect(assessment.reasons).toContainEqual({ code: 'page_result_missing', severity: 'critical', value: 1 })
  })

  it('recommends review for partial, failed, and empty unified results', () => {
    expect(
      assessOcrShadow({
        sourceKind: 'remote',
        result: result({ status: 'partial' }),
        expectedPageIds: ['page-1'],
        assessedAt,
      }).outcome,
    ).toBe('review_recommended')

    expect(
      assessOcrShadow({
        sourceKind: 'remote',
        result: result({ status: 'failed', text: '' }),
        expectedPageIds: ['page-1'],
        assessedAt,
      }).outcome,
    ).toBe('review_recommended')
  })

  it('returns insufficient evidence for mock and manual sources', () => {
    expect(
      assessOcrShadow({ sourceKind: 'mock', result: result(), expectedPageIds: ['page-1'], assessedAt }).outcome,
    ).toBe('insufficient_evidence')
    expect(
      assessOcrShadow({ sourceKind: 'manual', expectedPageIds: ['page-1'], assessedAt }).outcome,
    ).toBe('insufficient_evidence')
  })

  it('records finite confidence average and suspected hyphen count without changing outcome', () => {
    const assessment = assessOcrShadow({
      sourceKind: 'remote',
      result: result({
        text: 'pur-\npose',
        pages: [
          { pageId: 'page-1', text: 'pur-', confidence: 0.8 },
          { pageId: 'page-2', text: 'pose', confidence: 1 },
        ],
      }),
      expectedPageIds: ['page-1', 'page-2'],
      assessedAt,
    })

    expect(assessment).toMatchObject({
      assessmentVersion: OCR_SHADOW_ASSESSMENT_VERSION,
      outcome: 'no_obvious_risk',
      assessedAt,
    })
    expect(assessment.reasons).toContainEqual({ code: 'confidence_observed', severity: 'info', value: 0.9 })
    expect(assessment.reasons).toContainEqual({
      code: 'suspected_hyphen_break_observed',
      severity: 'info',
      value: 1,
    })
  })
})
