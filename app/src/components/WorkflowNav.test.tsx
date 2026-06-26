import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { WorkflowNav } from './WorkflowNav'
import type { WorkflowStep } from '../utils/workflow'

describe('WorkflowNav', () => {
  it('marks only the explicit current step active when routes are duplicated', () => {
    const steps: WorkflowStep[] = [
      {
        id: 'progress',
        label: '批改进度',
        to: '/tasks/task-1/progress',
        current: false,
      },
      {
        id: 'results',
        label: '结果检查',
        to: '/tasks/task-1/progress',
        current: true,
      },
    ]

    render(
      <MemoryRouter initialEntries={['/tasks/task-1/progress']}>
        <WorkflowNav steps={steps} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('navigation', { name: '作文批改流程' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /批改进度/ })).not.toHaveClass('border-blue-200')
    expect(screen.getByRole('link', { name: /批改进度/ })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: /结果检查/ })).toHaveClass('border-blue-200')
    expect(screen.getByRole('link', { name: /结果检查/ })).toHaveAttribute('aria-current', 'page')
  })
})
