import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { FullTextRevisionPanel } from './FullTextRevisionPanel'

describe('FullTextRevisionPanel', () => {
  it('shows an empty state when full text revision data is missing', () => {
    render(<FullTextRevisionPanel upgrades={[]} />)

    expect(screen.getByRole('heading', { name: '全文优化稿' })).toBeInTheDocument()
    expect(screen.getByText('暂无全文优化稿')).toBeInTheDocument()
  })

  it('shows teacher-review markers without claiming that original intent was verified', async () => {
    const user = userEvent.setup()
    render(
      <FullTextRevisionPanel
        upgrades={[]}
        revision={{
          originalText: 'Synthetic original.',
          correctedText: 'Synthetic corrected.',
          polishedText: 'Synthetic improved.',
          sentencePairs: [{
            id: 'pair-1',
            original: 'Synthetic original.',
            corrected: 'Synthetic corrected.',
            polished: 'Synthetic improved.',
            changeTypes: ['grammar'],
            explanation: 'Synthetic explanation.',
            needsTeacherReview: true,
          }],
          logicIssues: [],
          logicNotes: [],
        }}
      />,
    )

    await user.click(screen.getAllByRole('button')[2])
    expect(screen.queryByText(/是否保留原意/)).not.toBeInTheDocument()
    expect(screen.getByText(/建议教师复核/)).toBeInTheDocument()
  })
})
