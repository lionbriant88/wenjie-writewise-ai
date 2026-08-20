import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DiagnosticScoreSummary } from './DiagnosticScoreSummary'

describe('DiagnosticScoreSummary', () => {
  it('marks the specific low-confidence dimension for teacher review', () => {
    render(
      <DiagnosticScoreSummary
        dimensions={[
          { id: 'content', name: '内容', score: 5, maxScore: 6, weight: 40, reason: '依据完整。', evidence: 'Student text.' },
          { id: 'language', name: '语言', score: 6, maxScore: 8.25, weight: 55, reason: '依据需复核。', evidence: 'Student text.', needsTeacherReview: true },
          { id: 'legibility', name: '字迹', score: 0.75, maxScore: 0.75, weight: 5, reason: '清晰。', evidence: 'Student text.' },
        ]}
        fullScore={15}
        issues={[]}
        onDimensionScoreChange={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('语言 分数').closest('label')).toHaveTextContent('建议教师复核')
    expect(screen.getAllByText('建议教师复核')).toHaveLength(1)
  })

  it('shows the mandatory legibility deduction instead of a rounded full score', () => {
    render(
      <DiagnosticScoreSummary
        dimensions={[
          { id: 'language', name: 'Language', score: 8.55, maxScore: 8.55, weight: 95, reason: 'Accurate.', evidence: 'Synthetic.' },
          { id: 'legibility', name: 'Legibility', score: 0, maxScore: 0.45, weight: 5, reason: 'One mark is unclear.', evidence: 'Synthetic.' },
        ]}
        fullScore={9}
        issues={[]}
        hasLegibilityIssue
        onDimensionScoreChange={vi.fn()}
      />,
    )

    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('/ 9')).toBeInTheDocument()
  })
})
