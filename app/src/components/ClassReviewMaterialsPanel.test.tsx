import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { ClassReviewMaterial } from '../types'
import { ClassReviewMaterialsPanel } from './ClassReviewMaterialsPanel'

const materials: ClassReviewMaterial[] = [
  {
    id: 'material-1',
    taskId: 'task-1',
    essayId: 'essay-1',
    essayLabel: '作文 1',
    type: 'typical_error',
    categoryLabel: 'grammar',
    original: 'I suggest you joins the club.',
    revised: 'I suggest you join the club.',
    explanation: 'suggest 后使用动词原形。',
    severity: 'high',
    sourceIssueId: 'issue-1',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'material-2',
    taskId: 'task-1',
    essayId: 'essay-2',
    essayLabel: '作文 2',
    type: 'expression_upgrade',
    categoryLabel: '表达提升',
    original: 'I think',
    revised: 'From my point of view',
    explanation: '语气更正式。',
    severity: 'low',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
]

describe('ClassReviewMaterialsPanel', () => {
  it('explains that ordinary issues live in the common issue list when no material exists', () => {
    render(<ClassReviewMaterialsPanel taskId="task-1" materials={[]} onRemoveMaterial={vi.fn()} />)

    expect(screen.getByText('普通问题会进入上方共性问题列表；这里仅保留教师精选素材。')).toBeInTheDocument()
  })

  it('filters and removes teacher-selected materials', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(
      <MemoryRouter>
        <ClassReviewMaterialsPanel taskId="task-1" materials={materials} onRemoveMaterial={onRemove} />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('tab', { name: /表达提升/ }))
    expect(screen.getByText('From my point of view')).toBeInTheDocument()
    expect(screen.queryByText('I suggest you joins the club.')).not.toBeInTheDocument()

    const card = screen.getByRole('article')
    await user.click(within(card).getByRole('button', { name: '移除' }))
    expect(onRemove).toHaveBeenCalledWith('material-2')
  })
})
