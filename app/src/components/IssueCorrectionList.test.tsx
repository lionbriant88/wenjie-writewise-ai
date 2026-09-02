import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { IssueCorrectionList } from './IssueCorrectionList'
import type { ReviewIssueCardItem } from '../utils/reviewIssueItems'

const baseIssue: ReviewIssueCardItem = {
  id: 'issue-1',
  source: 'language',
  typeLabel: 'grammar',
  categoryLabel: 'grammar',
  severity: 'high',
  original: 'I suggest you joins the club.',
  suggestion: 'I suggest you join the club.',
  explanation: 'suggest 后使用动词原形。',
  sourceLocator: 'language.issue-1',
}

describe('IssueCorrectionList', () => {
  it('separates source locating from class-review inclusion without nested interactive controls', async () => {
    const user = userEvent.setup()
    const locate = vi.fn()
    const add = vi.fn()
    const { container } = render(
      <IssueCorrectionList
        items={[baseIssue]}
        onIssueSelect={locate}
        onAddIssue={add}
        getIssueClassReviewState={() => 'available'}
      />,
    )

    expect(container.querySelector('[role="button"] button')).toBeNull()
    const card = screen.getByRole('article', { name: /grammar/ })
    await user.click(within(card).getByRole('button', { name: '定位原文' }))
    expect(locate).toHaveBeenCalledWith('issue-1')
    expect(add).not.toHaveBeenCalled()

    await user.click(within(card).getByRole('button', { name: '加入班级总览' }))
    expect(add).toHaveBeenCalledWith(baseIssue)
    expect(locate).toHaveBeenCalledTimes(1)
  })

  it('renders automatic and teacher-selected states with reversible removal', async () => {
    const user = userEvent.setup()
    const remove = vi.fn()
    const undo = vi.fn()
    render(
      <IssueCorrectionList
        items={[
          baseIssue,
          { ...baseIssue, id: 'issue-2', sourceLocator: 'language.issue-2', original: 'It can make you know many knowledge.' },
        ]}
        getIssueClassReviewState={(issue) => issue.id === 'issue-1' ? 'system_included' : 'teacher_selected'}
        onRemoveIssue={remove}
        onUndoRemove={undo}
      />,
    )

    const automaticCard = screen.getByRole('article', { name: /I suggest you joins/ })
    expect(within(automaticCard).getByText('已自动归纳')).toBeInTheDocument()
    expect(within(automaticCard).queryByRole('button', { name: /班级总览/ })).toBeNull()

    const teacherCard = screen.getByRole('article', { name: /many knowledge/ })
    await user.click(within(teacherCard).getByRole('button', { name: '移出班级总览' }))
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'issue-2' }))
    const undoButton = screen.getByRole('button', { name: '撤销移出班级总览' })
    expect(undoButton).toHaveFocus()

    await user.click(undoButton)
    expect(undo).toHaveBeenCalled()
    expect(within(teacherCard).getByRole('button', { name: '移出班级总览' })).toHaveFocus()
  })
})
