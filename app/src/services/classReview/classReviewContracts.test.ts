import { describe, expect, it } from 'vitest'
import {
  parseClassReviewGenerationCommand,
  parseClassReviewGenerationStatus,
  parseClassReviewReport,
} from './classReviewContracts'
import { browserFixtures } from './fixtures/loadContractFixtures'

describe('class review browser contracts', () => {
  it('accepts every frozen command, generation state, actionable state, and report state', () => {
    for (const value of Object.values(browserFixtures.commands)) {
      expect(parseClassReviewGenerationCommand(value).ok).toBe(true)
    }
    for (const value of Object.values(browserFixtures.statuses)) {
      expect(parseClassReviewGenerationStatus(value).ok).toBe(true)
    }
    for (const currentGeneration of Object.values(browserFixtures.actionableGenerations)) {
      expect(
        parseClassReviewReport({ ...browserFixtures.reports.draft, currentGeneration }).ok,
      ).toBe(true)
    }
    for (const value of Object.values(browserFixtures.reports)) {
      expect(parseClassReviewReport(value).ok).toBe(true)
    }

    const parsed = parseClassReviewReport(browserFixtures.reports.ai_available)
    if (!parsed.ok || parsed.value.workspaceState !== 'ai_available') throw new Error('fixture rejected')
    expect(parsed.value.issueBlocks[0]?.blockId).toBe('issue.ai.1')
    expect(parsed.value.aiSummary.strengths[0]?.dimensionIds).toEqual(['language'])
  })

  it('rejects illegal command keys and regenerate null with fixed errors', () => {
    expect(
      parseClassReviewGenerationCommand({
        ...browserFixtures.commands.regenerate,
        expectedReportRevision: null,
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalid_type', path: '/expectedReportRevision' },
    })
    expect(
      parseClassReviewGenerationCommand({ ...browserFixtures.commands.initial, extra: true }),
    ).toEqual({ ok: false, error: { code: 'unknown_key', path: '/extra' } })
  })

  it('does not satisfy required fields from an object prototype', () => {
    const prototypeBackedCommand = Object.assign(
      Object.create({ contractVersion: 'class-review-generation-command-v1' }),
      {
        intent: 'initial',
        generationId: 'gen.initial',
        expectedTaskRevision: 4,
        expectedReportRevision: null,
      },
    )

    expect(parseClassReviewGenerationCommand(prototypeBackedCommand)).toEqual({
      ok: false,
      error: { code: 'missing_key', path: '/contractVersion' },
    })
  })

  it('reports non-string browser contract discriminators as invalid_type', () => {
    expect(
      parseClassReviewGenerationCommand({
        ...browserFixtures.commands.initial,
        contractVersion: 1,
      }),
    ).toEqual({ ok: false, error: { code: 'invalid_type', path: '/contractVersion' } })
    expect(
      parseClassReviewGenerationStatus({
        ...browserFixtures.statuses.queued,
        contractVersion: false,
      }),
    ).toEqual({ ok: false, error: { code: 'invalid_type', path: '/contractVersion' } })
    expect(
      parseClassReviewReport({
        ...browserFixtures.reports.none,
        contractVersion: null,
      }),
    ).toEqual({ ok: false, error: { code: 'invalid_type', path: '/contractVersion' } })
    expect(
      parseClassReviewGenerationStatus({
        ...browserFixtures.statuses.result_unknown,
        safeFailureCode: false,
      }),
    ).toEqual({ ok: false, error: { code: 'invalid_type', path: '/safeFailureCode' } })
    expect(
      parseClassReviewReport({
        ...browserFixtures.reports.draft,
        currentGeneration: {
          ...browserFixtures.actionableGenerations.result_unknown,
          safeFailureCode: 1,
        },
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalid_type', path: '/currentGeneration/safeFailureCode' },
    })
  })

  it('enforces generation revision, count, and state-specific fields', () => {
    expect(
      parseClassReviewGenerationStatus({
        ...browserFixtures.statuses.queued,
        generationRevision: 1.5,
      }),
    ).toEqual({ ok: false, error: { code: 'invalid_value', path: '/generationRevision' } })
    expect(
      parseClassReviewGenerationStatus({
        ...browserFixtures.statuses.queued,
        issueEligibleEssayCount: 4,
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalid_value', path: '/issueEligibleEssayCount' },
    })
    expect(
      parseClassReviewGenerationStatus({
        ...browserFixtures.statuses.queued,
        completedAt: '2026-08-29T00:01:00Z',
      }),
    ).toEqual({ ok: false, error: { code: 'unknown_key', path: '/completedAt' } })
  })

  it('parses actionable generations with exact nested keys', () => {
    const invalidReport = {
      ...browserFixtures.reports.draft,
      currentGeneration: {
        ...browserFixtures.actionableGenerations.queued,
        completedAt: '2026-08-29T00:01:00Z',
      },
    }
    expect(parseClassReviewReport(invalidReport)).toEqual({
      ok: false,
      error: { code: 'unknown_key', path: '/currentGeneration/completedAt' },
    })

    const missingCurrentGeneration = structuredClone(browserFixtures.reports.draft)
    Reflect.deleteProperty(missingCurrentGeneration, 'currentGeneration')
    expect(parseClassReviewReport(missingCurrentGeneration)).toEqual({
      ok: false,
      error: { code: 'missing_key', path: '/currentGeneration' },
    })
  })

  it('fully validates nested statistics and aliases', () => {
    const unknownBandKey = {
      ...browserFixtures.reports.draft,
      statistics: {
        ...browserFixtures.reports.draft.statistics,
        scoreBands: [
          { ...browserFixtures.reports.draft.statistics.scoreBands[0], extra: true },
          browserFixtures.reports.draft.statistics.scoreBands[1],
        ],
      },
    }
    expect(parseClassReviewReport(unknownBandKey)).toEqual({
      ok: false,
      error: { code: 'unknown_key', path: '/statistics/scoreBands/0/extra' },
    })

    const invalidOrdering = {
      ...browserFixtures.reports.draft,
      statistics: {
        ...browserFixtures.reports.draft.statistics,
        scoreSummary: {
          ...browserFixtures.reports.draft.statistics.scoreSummary,
          highestScore: 7,
        },
      },
    }
    expect(parseClassReviewReport(invalidOrdering)).toEqual({
      ok: false,
      error: { code: 'invalid_value', path: '/statistics/scoreSummary/highestScore' },
    })

    const duplicateDimension = {
      ...browserFixtures.reports.ai_available,
      statistics: {
        ...browserFixtures.reports.ai_available.statistics,
        dimensions: [
          browserFixtures.reports.ai_available.statistics.dimensions[0],
          browserFixtures.reports.ai_available.statistics.dimensions[0],
        ],
      },
    }
    expect(parseClassReviewReport(duplicateDimension)).toEqual({
      ok: false,
      error: { code: 'duplicate_value', path: '/statistics/dimensions/1/dimensionId' },
    })
  })

  it('fully validates issue blocks, evidence, and issue order references', () => {
    const invalidIssueTitle = {
      ...browserFixtures.reports.draft,
      issueBlocks: [
        { ...browserFixtures.reports.draft.issueBlocks[0], title: 'x'.repeat(121) },
      ],
    }
    expect(parseClassReviewReport(invalidIssueTitle)).toEqual({
      ok: false,
      error: { code: 'limit_exceeded', path: '/issueBlocks/0/title' },
    })

    const duplicateEvidence = {
      ...browserFixtures.reports.draft,
      issueBlocks: [
        {
          ...browserFixtures.reports.draft.issueBlocks[0],
          evidenceRefs: [
            browserFixtures.reports.draft.issueBlocks[0].evidenceRefs[0],
            browserFixtures.reports.draft.issueBlocks[0].evidenceRefs[0],
          ],
        },
      ],
    }
    expect(parseClassReviewReport(duplicateEvidence)).toEqual({
      ok: false,
      error: { code: 'duplicate_value', path: '/issueBlocks/0/evidenceRefs/1/evidenceId' },
    })

    const duplicateEvidenceAcrossBlocks = {
      ...browserFixtures.reports.ai_available,
      issueBlocks: [
        browserFixtures.reports.ai_available.issueBlocks[0],
        {
          ...browserFixtures.reports.ai_available.issueBlocks[1],
          evidenceRefs: [
            {
              ...browserFixtures.reports.ai_available.issueBlocks[1].evidenceRefs[0],
              evidenceId:
                browserFixtures.reports.ai_available.issueBlocks[0].evidenceRefs[0].evidenceId,
            },
          ],
        },
      ],
    }
    expect(parseClassReviewReport(duplicateEvidenceAcrossBlocks)).toEqual({
      ok: false,
      error: { code: 'duplicate_value', path: '/issueBlocks/1/evidenceRefs/0/evidenceId' },
    })

    expect(
      parseClassReviewReport({
        ...browserFixtures.reports.draft,
        issueOrder: ['issue.unknown'],
      }),
    ).toEqual({
      ok: false,
      error: { code: 'unknown_reference', path: '/issueOrder/0' },
    })
    expect(
      parseClassReviewReport({ ...browserFixtures.reports.draft, issueOrder: [] }),
    ).toEqual({ ok: false, error: { code: 'invalid_value', path: '/issueOrder' } })
  })

  it('enforces teacher-only draft content and none workspace invariants', () => {
    const aiBlockInDraft = {
      ...browserFixtures.reports.draft,
      issueBlocks: [{ ...browserFixtures.reports.draft.issueBlocks[0], origin: 'ai' }],
    }
    expect(parseClassReviewReport(aiBlockInDraft)).toEqual({
      ok: false,
      error: { code: 'invalid_value', path: '/issueBlocks/0/origin' },
    })

    expect(
      parseClassReviewReport({
        ...browserFixtures.reports.none,
        selectedMaterials: browserFixtures.reports.draft.selectedMaterials,
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalid_value', path: '/selectedMaterials' },
    })
  })

  it('validates spelling and selected-material nested exact keys', () => {
    const unknownSpellingKey = {
      ...browserFixtures.reports.draft,
      clearSpellingItems: [
        { ...browserFixtures.reports.draft.clearSpellingItems[0], studentName: 'forbidden' },
      ],
    }
    expect(parseClassReviewReport(unknownSpellingKey)).toEqual({
      ok: false,
      error: { code: 'unknown_key', path: '/clearSpellingItems/0/studentName' },
    })

    const longMaterialText = {
      ...browserFixtures.reports.draft,
      selectedMaterials: [
        {
          ...browserFixtures.reports.draft.selectedMaterials[0],
          originalText: 'x'.repeat(2001),
        },
      ],
    }
    expect(parseClassReviewReport(longMaterialText)).toEqual({
      ok: false,
      error: { code: 'limit_exceeded', path: '/selectedMaterials/0/originalText' },
    })

    const duplicateSpellingTopic = {
      ...browserFixtures.reports.ai_available,
      clearSpellingItems: [
        browserFixtures.reports.ai_available.clearSpellingItems[0],
        {
          ...browserFixtures.reports.ai_available.clearSpellingItems[1],
          topicKey: browserFixtures.reports.ai_available.clearSpellingItems[0].topicKey,
        },
      ],
    }
    expect(parseClassReviewReport(duplicateSpellingTopic)).toEqual({
      ok: false,
      error: { code: 'duplicate_value', path: '/clearSpellingItems/1/topicKey' },
    })
  })

  it('requires and validates every ai snapshot field and reference', () => {
    const missingAiSummary = structuredClone(browserFixtures.reports.ai_available)
    Reflect.deleteProperty(missingAiSummary, 'aiSummary')
    expect(parseClassReviewReport(missingAiSummary)).toEqual({
      ok: false,
      error: { code: 'missing_key', path: '/aiSummary' },
    })

    const unknownDimension = {
      ...browserFixtures.reports.ai_available,
      aiSummary: {
        ...browserFixtures.reports.ai_available.aiSummary,
        strengths: [
          {
            ...browserFixtures.reports.ai_available.aiSummary.strengths[0],
            dimensionIds: ['unknown.dimension'],
          },
        ],
      },
    }
    expect(parseClassReviewReport(unknownDimension)).toEqual({
      ok: false,
      error: { code: 'unknown_reference', path: '/aiSummary/strengths/0/dimensionIds/0' },
    })

    const invalidSnapshotCounts = {
      ...browserFixtures.reports.ai_available,
      snapshotMetadata: {
        ...browserFixtures.reports.ai_available.snapshotMetadata,
        issueEligibleEssayCount: 4,
      },
    }
    expect(parseClassReviewReport(invalidSnapshotCounts)).toEqual({
      ok: false,
      error: { code: 'invalid_value', path: '/snapshotMetadata/issueEligibleEssayCount' },
    })

    const reportWithNewerCurrentStatistics = {
      ...browserFixtures.reports.ai_available,
      statistics: {
        ...browserFixtures.reports.ai_available.statistics,
        totalEssayCount: 5,
        includedEssayCount: 4,
        issueEligibleEssayCount: 3,
        excludedEssayCount: 1,
        issueCoverageRate: 0.75,
      },
    }
    expect(parseClassReviewReport(reportWithNewerCurrentStatistics).ok).toBe(true)
  })

  it('rejects malformed Unicode and non-paginated collection overflow', () => {
    const malformedTitle = {
      ...browserFixtures.reports.draft,
      issueBlocks: [
        {
          ...browserFixtures.reports.draft.issueBlocks[0],
          title: String.fromCharCode(0xd800),
        },
      ],
    }
    expect(parseClassReviewReport(malformedTitle)).toEqual({
      ok: false,
      error: { code: 'invalid_value', path: '/issueBlocks/0/title' },
    })

    const tooManyIssues = {
      ...browserFixtures.reports.draft,
      issueBlocks: Array.from(
        { length: 513 },
        () => browserFixtures.reports.draft.issueBlocks[0],
      ),
    }
    expect(parseClassReviewReport(tooManyIssues)).toEqual({
      ok: false,
      error: { code: 'limit_exceeded', path: '/issueBlocks' },
    })
  })

  it('forbids AI snapshot keys on non-AI report states', () => {
    expect(
      parseClassReviewReport({
        ...browserFixtures.reports.none,
        appliedGenerationId: 'forbidden',
      }),
    ).toEqual({
      ok: false,
      error: { code: 'unknown_key', path: '/appliedGenerationId' },
    })
  })

  it('contains the complete canonical browser fixture variant set', () => {
    expect(Object.keys(browserFixtures.commands).sort()).toEqual([
      'apply_candidate',
      'discard_candidate',
      'initial',
      'regenerate',
    ])
    expect(Object.keys(browserFixtures.actionableGenerations).sort()).toEqual([
      'queued',
      'result_unknown',
      'running',
      'succeeded_unapplied',
    ])
    expect(Object.keys(browserFixtures.statuses).sort()).toEqual([
      'discarded',
      'failed',
      'invalidated',
      'queued',
      'result_unknown',
      'running',
      'succeeded',
      'succeeded_unapplied',
    ])
    expect(Object.keys(browserFixtures.reports).sort()).toEqual([
      'ai_available',
      'ai_removed',
      'draft',
      'none',
    ])
  })
})
