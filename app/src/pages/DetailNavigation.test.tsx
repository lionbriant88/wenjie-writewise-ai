import { render, screen, within } from '@testing-library/react'
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
