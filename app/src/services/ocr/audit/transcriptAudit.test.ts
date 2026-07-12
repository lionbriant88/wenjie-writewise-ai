import { describe, expect, it } from 'vitest'
import type { OcrEssayResult } from '../types'
import { confirmOcrAudit, createManualPendingOcrAudit, createPendingOcrAudit } from './transcriptAudit'

const assessedAt = '2026-07-12T02:00:00.000Z'
const confirmedAt = '2026-07-12T02:05:00.000Z'

const remoteResult: OcrEssayResult = {
  essayGroupId: 'group-1',
  text: 'Client final source',
  pages: [{ pageId: 'page-1', text: 'Client final source', confidence: 0.9 }],
  provider: 'remote',
  status: 'success',
}

describe('OCR transcript audit lifecycle', () => {
  it.each([
    ['remote', 'Client final source', 'no_obvious_risk'],
    ['mock', 'Client final source', 'insufficient_evidence'],
  ] as const)('captures %s client output before teacher edits', (sourceKind, sourceText, outcome) => {
    const pending = createPendingOcrAudit({
      sourceKind,
      result: remoteResult,
      expectedPageIds: ['page-1'],
      assessedAt,
    })

    expect(pending).toMatchObject({ sourceKind, sourceText, shadowAssessment: { outcome, assessedAt } })
  })

  it('uses an empty immutable source for manual input', () => {
    expect(createManualPendingOcrAudit(['page-1'], assessedAt)).toMatchObject({
      sourceKind: 'manual',
      sourceText: '',
      shadowAssessment: { outcome: 'insufficient_evidence', assessedAt },
    })
  })

  it('confirms a faithful transcript without overwriting source text', () => {
    const pending = createPendingOcrAudit({
      sourceKind: 'remote',
      result: remoteResult,
      expectedPageIds: ['page-1'],
      assessedAt,
    })
    const audit = confirmOcrAudit(pending, 'Teacher faithful transcript', confirmedAt)

    expect(audit.sourceText).toBe('Client final source')
    expect(audit.confirmedTranscript).toBe('Teacher faithful transcript')
    expect(audit.reviewOutcome.confirmedAt).toBe(confirmedAt)
    expect(audit.reviewOutcome.actualTeacherAction).toBe('confirmed_after_edit')
  })

  it('replaces pending source on retry instead of retaining run history', () => {
    const first = createPendingOcrAudit({
      sourceKind: 'remote',
      result: remoteResult,
      expectedPageIds: ['page-1'],
      assessedAt,
    })
    const retry = createPendingOcrAudit({
      sourceKind: 'remote',
      result: { ...remoteResult, text: 'Latest retry', pages: [{ pageId: 'page-1', text: 'Latest retry' }] },
      expectedPageIds: ['page-1'],
      assessedAt: '2026-07-12T02:01:00.000Z',
    })

    expect(first.sourceText).toBe('Client final source')
    expect(retry.sourceText).toBe('Latest retry')
    expect(retry).not.toHaveProperty('previousRuns')
  })
})
