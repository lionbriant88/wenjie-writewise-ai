import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AiSummaryV1, ClassReviewReportV1 } from '../services/classReview/types'
import { ClassReviewReportPanel } from './ClassReviewReportPanel'

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

const aiSummary: AiSummaryV1 = {
  overallComment: 'Class summary',
  strengths: [{ title: 'Strength', detail: 'Students completed the task.', dimensionIds: [] }],
  learningRecommendations: [{ title: 'Next step', action: 'Revise with examples.' }],
}

function report(workspaceState: 'draft' | 'ai_available' = 'ai_available'): ClassReviewReportV1 {
  const base = {
    contractVersion: 'class-review-report-v1',
    workspaceState,
    taskRevision: 0,
    reportRevision: 0,
    aiTextEditRevision: 0,
    currentGeneration: null,
    statistics,
    issueBlocks: [],
    issueOrder: [],
    clearSpellingItems: [],
    selectedMaterials: [],
  }
  if (workspaceState !== 'ai_available') return base as ClassReviewReportV1
  return {
    ...base,
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
    aiSummary,
  } as ClassReviewReportV1
}

describe('ClassReviewReportPanel', () => {
  it('shows the empty AI summary state before an AI report is applied', () => {
    render(<ClassReviewReportPanel report={report('draft')} />)

    expect(screen.getByRole('heading', { name: 'AI 班级总体评价' })).toBeInTheDocument()
    expect(screen.getByText('尚未生成 AI 班级总结。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
  })

  it('has one edit entry and saves or cancels only from edit mode', async () => {
    const user = userEvent.setup()
    const onBeginEdit = vi.fn()
    const onSave = vi.fn()
    const onCancel = vi.fn()
    const { rerender } = render(
      <ClassReviewReportPanel
        report={report()}
        onBeginEdit={onBeginEdit}
        onSave={onSave}
        onCancel={onCancel}
      />,
    )

    expect(screen.getAllByRole('button', { name: '编辑' })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: '编辑' }))
    expect(onBeginEdit).toHaveBeenCalledTimes(1)

    rerender(
      <ClassReviewReportPanel
        report={report()}
        editDraft={{ ...aiSummary, overallComment: 'Draft summary' }}
        onBeginEdit={onBeginEdit}
        onDraftChange={vi.fn()}
        onSave={onSave}
        onCancel={onCancel}
      />,
    )

    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('班级总体评价'), { target: { value: 'Teacher edited summary.' } })
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ overallComment: 'Teacher edited summary.' }))
  })

  it('disables AI text editing with an accessible reason while generation is active', () => {
    render(<ClassReviewReportPanel report={report()} editLocked />)

    expect(screen.getByRole('button', { name: '编辑' })).toBeDisabled()
    expect(screen.getByText('生成过程中暂不能编辑 AI 总评。')).toBeInTheDocument()
  })
})
