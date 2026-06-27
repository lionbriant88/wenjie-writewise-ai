import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import { ClassReviewPage } from './ClassReviewPage'

function renderClassReviewPage() {
  render(
    <AppStateProvider>
      <MemoryRouter initialEntries={['/tasks/task-1/class-review']}>
        <Routes>
          <Route path="/tasks/:taskId/class-review" element={<ClassReviewPage />} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}

describe('ClassReviewPage', () => {
  it('shows score distribution with summary stats and no classroom mode hint', () => {
    renderClassReviewPage()

    expect(screen.getByRole('heading', { name: '班级总览' })).toBeInTheDocument()
    expect(screen.getByText('分数分布')).toBeInTheDocument()
    expect(screen.getByText('作文总数')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('平均分')).toBeInTheDocument()
    expect(screen.getByText('最高分')).toBeInTheDocument()
    expect(screen.getByText('最低分')).toBeInTheDocument()
    expect(screen.getByText('1-3')).toBeInTheDocument()
    expect(screen.getByText('4-6')).toBeInTheDocument()
    expect(screen.getByText('7-9')).toBeInTheDocument()
    expect(screen.getByText('10-12')).toBeInTheDocument()
    expect(screen.getByText('13-15')).toBeInTheDocument()
    expect(screen.getByLabelText('13-15 分数分布：7 篇')).toHaveStyle({ height: '10px' })
    expect(screen.queryByText('课堂讲评模式')).not.toBeInTheDocument()
  })
})
