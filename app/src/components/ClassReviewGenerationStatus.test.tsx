import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ClassReviewAppSnapshot } from '../context/appStateContextValue'
import type { AiSummaryV1, ClassReviewReportV1 } from '../services/classReview/types'
import { ClassReviewGenerationStatus } from './ClassReviewGenerationStatus'

const statistics = {
  totalEssayCount: 12,
  includedEssayCount: 12,
  issueEligibleEssayCount: 12,
  excludedEssayCount: 0,
  issueCoverageRate: 1,
  fullScore: 15,
  scoreSummary: { averageScore: 12.5, highestScore: 14, lowestScore: 10 },
  scoreBands: [],
  dimensions: [],
}

const summary: AiSummaryV1 = {
  overallComment: 'Class summary',
  strengths: [{ title: 'Strength', detail: 'Students completed the task.', dimensionIds: [] }],
  learningRecommendations: [{ title: 'Next step', action: 'Revise with examples.' }],
}

function report(overrides: Partial<ClassReviewReportV1> = {}): ClassReviewReportV1 {
  return {
    contractVersion: 'class-review-report-v1',
    workspaceState: 'draft',
    taskRevision: 0,
    reportRevision: 0,
    aiTextEditRevision: 0,
    currentGeneration: null,
    statistics,
    issueBlocks: [],
    issueOrder: [],
    clearSpellingItems: [],
    selectedMaterials: [],
    ...overrides,
  } as ClassReviewReportV1
}

function snapshot(overrides: Partial<ClassReviewAppSnapshot> = {}): ClassReviewAppSnapshot {
  return {
    report: report(),
    generation: null,
    candidate: null,
    requestId: null,
    boundedRequeueCount: 0,
    providerSettlementKnown: true,
    sourceReady: true,
    taskDeleted: false,
    sourceRevisionEpoch: 0,
    canGenerate: true,
    isSettled: true,
    ...overrides,
  }
}

describe('ClassReviewGenerationStatus', () => {
  it('renders the initial generation action only when the settled snapshot is eligible', async () => {
    const user = userEvent.setup()
    const onGenerate = vi.fn()
    render(<ClassReviewGenerationStatus snapshot={snapshot()} onGenerate={onGenerate} />)

    await user.click(screen.getByRole('button', { name: '生成班级总结' }))

    expect(onGenerate).toHaveBeenCalledTimes(1)
  })

  it('uses CTA precedence for active, unknown, unapplied and applied states', () => {
    const callbacks = {
      onGenerate: vi.fn(),
      onRegenerate: vi.fn(),
      onCheck: vi.fn(),
      onApply: vi.fn(),
      onDiscard: vi.fn(),
    }
    const { rerender } = render(
      <ClassReviewGenerationStatus
        snapshot={snapshot({
          report: report({
            currentGeneration: {
              generationId: 'gen-running',
              generationRevision: 0,
              state: 'running',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          }),
        })}
        {...callbacks}
      />,
    )
    expect(screen.getByText('正在生成班级总结')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '生成班级总结' })).not.toBeInTheDocument()

    rerender(
      <ClassReviewGenerationStatus
        snapshot={snapshot({
          report: report({
            currentGeneration: {
              generationId: 'gen-unknown',
              generationRevision: 1,
              state: 'result_unknown',
              safeFailureCode: 'provider_result_unknown',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          }),
        })}
        {...callbacks}
      />,
    )
    expect(screen.getByRole('button', { name: '检查结果' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '生成班级总结' })).not.toBeInTheDocument()

    rerender(
      <ClassReviewGenerationStatus
        snapshot={snapshot({
          candidate: { available: true, generationId: 'gen-candidate' },
          report: report({
            currentGeneration: {
              generationId: 'gen-candidate',
              generationRevision: 2,
              state: 'succeeded_unapplied',
              safeUnappliedReason: 'ai_text_changed',
              createdAt: '2026-01-01T00:00:00.000Z',
              completedAt: '2026-01-01T00:00:01.000Z',
            },
          }),
        })}
        {...callbacks}
      />,
    )
    expect(screen.getByRole('button', { name: '应用新班级总结' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '丢弃新版本' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重新生成' })).not.toBeInTheDocument()

    rerender(
      <ClassReviewGenerationStatus
        snapshot={snapshot({
          canGenerate: true,
          report: report({
            workspaceState: 'ai_available',
            appliedGenerationId: 'gen-applied',
            generatedAt: '2026-01-01T00:00:01.000Z',
            snapshotMetadata: {
              includedEssayCount: 12,
              issueEligibleEssayCount: 12,
              totalEssayCount: 12,
              semanticCoverage: {
                projectedGroupCount: 1,
                eligibleGroupCount: 1,
                groupCoverage: 1,
                projectedDistinctEssaySupportSum: 12,
                eligibleDistinctEssaySupportSum: 12,
                supportWeightedCoverage: 1,
                projectedOccurrenceSum: 12,
                eligibleOccurrenceSum: 12,
                occurrenceWeightedCoverage: 1,
              },
            },
            aiSummary: summary,
          }),
        })}
        hasUnsavedAiEdit
        {...callbacks}
      />,
    )
    expect(screen.getByRole('button', { name: '重新生成' })).toBeDisabled()
    expect(screen.getByText('请先保存或取消正在编辑的 AI 总评。')).toBeInTheDocument()
  })

  it('shows a waiting state without a generation button when the task is not eligible', () => {
    render(<ClassReviewGenerationStatus snapshot={snapshot({ canGenerate: false, isSettled: false })} />)

    expect(screen.getByText('等待批改队列结束')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '生成班级总结' })).not.toBeInTheDocument()
  })
})
