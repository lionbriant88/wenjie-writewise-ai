import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import { EssayResultPage } from './EssayResultPage'
import { ExceptionsPage } from './ExceptionsPage'

function renderWithRoute(route: string, element: React.ReactElement) {
  render(
    <AppStateProvider>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/tasks/:taskId/essays/:essayId" element={element} />
          <Route path="/tasks/:taskId/exceptions" element={element} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}

describe('detail flow back navigation', () => {
  it('links essay result pages back to the task progress page and keeps progress current', () => {
    renderWithRoute('/tasks/task-1/essays/task-1-essay-1', <EssayResultPage />)

    expect(screen.getByRole('link', { name: '返回批改进度' })).toHaveAttribute(
      'href',
      '/tasks/task-1/progress',
    )

    const workflowNav = screen.getByRole('navigation', { name: '任务流程导航' })
    expect(within(workflowNav).getByRole('link', { name: /批改进度/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('shows top review controls with score, confidence, and previous or next essay links', () => {
    renderWithRoute('/tasks/task-1/essays/task-1-essay-1', <EssayResultPage />)

    expect(screen.getAllByText('作文 1 批改结果').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('12.6 / 15')).toBeInTheDocument()
    expect(screen.getByText('AI 置信度 86%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上一篇' })).toBeDisabled()
    expect(screen.getByRole('link', { name: '下一篇' })).toHaveAttribute(
      'href',
      '/tasks/task-1/essays/task-1-essay-2',
    )
  })

  it('links the previous essay from the top review controls when available', () => {
    renderWithRoute('/tasks/task-1/essays/task-1-essay-2', <EssayResultPage />)

    expect(screen.getByRole('link', { name: '上一篇' })).toHaveAttribute(
      'href',
      '/tasks/task-1/essays/task-1-essay-1',
    )
  })

  it('prioritizes the student essay source and opens original images on demand', async () => {
    const user = userEvent.setup()
    renderWithRoute('/tasks/task-1/essays/task-1-essay-1', <EssayResultPage />)

    expect(screen.getByRole('heading', { name: '学生作文原文' })).toBeInTheDocument()
    expect(screen.getByText('OCR 置信度 89%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看原图' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '原图预览' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '查看原图' }))

    expect(screen.getByRole('dialog', { name: '原图预览' })).toBeInTheDocument()
  })

  it('links exception review pages back to the task progress page and keeps progress current', () => {
    renderWithRoute('/tasks/task-1/exceptions', <ExceptionsPage />)

    expect(screen.getByRole('link', { name: '返回' })).toHaveAttribute(
      'href',
      '/tasks/task-1/progress',
    )

    const workflowNav = screen.getByRole('navigation', { name: '任务流程导航' })
    expect(within(workflowNav).getByRole('link', { name: /批改进度/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})
