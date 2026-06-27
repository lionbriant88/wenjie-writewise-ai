import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { WorkflowNav } from './WorkflowNav'
import type { WorkflowStep } from '../utils/workflow'

describe('WorkflowNav', () => {
  it('renders the streamlined task navigation and marks the current step', () => {
    const steps: WorkflowStep[] = [
      {
        id: 'upload',
        label: '上传整理',
        to: '/tasks/task-1/upload',
        current: false,
      },
      {
        id: 'progress',
        label: '批改进度',
        to: '/tasks/task-1/progress',
        current: true,
      },
      {
        id: 'class-review',
        label: '班级总览',
        to: '/tasks/task-1/class-review',
        current: false,
      },
    ]

    render(
      <MemoryRouter initialEntries={['/tasks/task-1/progress']}>
        <WorkflowNav steps={steps} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('navigation', { name: '作文批改流程' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /上传整理/ })).toHaveAttribute('href', '/tasks/task-1/upload')
    expect(screen.getByRole('link', { name: /批改进度/ })).toHaveClass('border-blue-200')
    expect(screen.getByRole('link', { name: /批改进度/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /班级总览/ })).toHaveAttribute('href', '/tasks/task-1/class-review')
    expect(screen.queryByRole('link', { name: /异常复核/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /结果检查/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /班级讲评/ })).not.toBeInTheDocument()
  })
})
