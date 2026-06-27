import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import { TaskListPage } from './TaskListPage'

function renderTaskListPage() {
  render(
    <AppStateProvider>
      <MemoryRouter>
        <TaskListPage />
      </MemoryRouter>
    </AppStateProvider>,
  )
}

describe('TaskListPage', () => {
  it('renders a compact teacher workspace instead of prototype-style task cards', () => {
    renderTaskListPage()

    expect(screen.getByText('今日工作台')).toBeInTheDocument()
    expect(screen.getByText('任务队列')).toBeInTheDocument()
    expect(screen.getAllByText('立即处理')).toHaveLength(3)
    expect(screen.queryByText('后台批改队列模拟')).not.toBeInTheDocument()
  })
})
