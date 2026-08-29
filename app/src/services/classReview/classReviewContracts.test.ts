import { describe, expect, it } from 'vitest'
import { parseClassReviewGenerationCommand, parseClassReviewGenerationStatus, parseClassReviewReport } from './classReviewContracts'
import { browserFixtures } from './fixtures/loadContractFixtures'

describe('class review browser contracts', () => {
  it('accepts every frozen command, generation state, and report state', () => {
    for (const value of Object.values(browserFixtures.commands)) expect(parseClassReviewGenerationCommand(value).ok).toBe(true)
    for (const value of Object.values(browserFixtures.statuses)) expect(parseClassReviewGenerationStatus(value).ok).toBe(true)
    for (const value of Object.values(browserFixtures.reports)) expect(parseClassReviewReport(value).ok).toBe(true)
  })

  it('rejects one illegal command field with its stable error', () => {
    const validRegenerate = browserFixtures.commands.regenerate
    expect(parseClassReviewGenerationCommand({ ...validRegenerate, expectedReportRevision: null })).toEqual({ ok: false, error: { code: 'invalid_type', path: '/expectedReportRevision' } })
  })

  it('rejects exact-key, revision, state, and current-generation violations', () => {
    expect(parseClassReviewGenerationCommand({ ...browserFixtures.commands.initial, extra: true })).toEqual({ ok: false, error: { code: 'unknown_key', path: '/extra' } })
    expect(parseClassReviewGenerationStatus({ ...browserFixtures.statuses.queued, generationRevision: 1.5 })).toEqual({ ok: false, error: { code: 'invalid_value', path: '/generationRevision' } })
    expect(parseClassReviewGenerationStatus({ ...browserFixtures.statuses.queued, completedAt: '2026-08-29T00:01:00Z' })).toEqual({ ok: false, error: { code: 'unknown_key', path: '/completedAt' } })
    const { currentGeneration: _ignored, ...missingCurrentGeneration } = browserFixtures.reports.draft
    expect(parseClassReviewReport(missingCurrentGeneration)).toEqual({ ok: false, error: { code: 'missing_key', path: '/currentGeneration' } })
  })

  it('requires ai snapshots and forbids them on none', () => {
    const validNone = browserFixtures.reports.none
    expect(parseClassReviewReport({ ...validNone, appliedGenerationId: 'forbidden' })).toEqual({ ok: false, error: { code: 'unknown_key', path: '/appliedGenerationId' } })
    const { aiSummary: _ignored, ...missingAiSnapshot } = browserFixtures.reports.ai_available
    expect(parseClassReviewReport(missingAiSnapshot)).toEqual({ ok: false, error: { code: 'missing_key', path: '/aiSummary' } })
  })
})
