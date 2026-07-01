import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import { ClassReviewPage } from './ClassReviewPage'
import { EssayResultPage } from './EssayResultPage'
import { ExceptionsPage } from './ExceptionsPage'
import { ProgressPage } from './ProgressPage'
import { UploadPage } from './UploadPage'

function renderUploadProgressAndDetailFlow() {
  render(
    <AppStateProvider>
      <MemoryRouter initialEntries={['/tasks/task-1/upload']}>
        <Routes>
          <Route path="/tasks/:taskId/upload" element={<UploadPage />} />
          <Route path="/tasks/:taskId/progress" element={<ProgressPage />} />
          <Route path="/tasks/:taskId/exceptions" element={<ExceptionsPage />} />
          <Route path="/tasks/:taskId/class-review" element={<ClassReviewPage />} />
          <Route path="/tasks/:taskId/essays/:essayId" element={<EssayResultPage />} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}

function renderProgressFlow(taskId = 'task-1') {
  render(
    <AppStateProvider>
      <MemoryRouter initialEntries={[`/tasks/${taskId}/progress`]}>
        <Routes>
          <Route path="/tasks/:taskId/progress" element={<ProgressPage />} />
          <Route path="/tasks/:taskId/exceptions" element={<ExceptionsPage />} />
          <Route path="/tasks/:taskId/class-review" element={<ClassReviewPage />} />
          <Route path="/tasks/:taskId/essays/:essayId" element={<EssayResultPage />} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}

describe('ProgressPage', () => {
  it('shows queue operation bar and status tabs without replacing the summary cards', async () => {
    renderProgressFlow()

    expect(screen.getAllByText('作文总数').length).toBeGreaterThan(0)
    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0)
    expect(screen.getAllByText('需复核').length).toBeGreaterThan(0)
    expect(screen.getAllByText('整体进度').length).toBeGreaterThan(0)

    expect(screen.getByText(/当前队列：/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '模拟完成下一篇' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '模拟完成全部可处理' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看异常队列' })).toBeInTheDocument()

    expect(screen.getByRole('tab', { name: /全部/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /处理中/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /需复核/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /已完成/ })).toBeInTheDocument()
  })

  it('shows batch completion only when multiple essays are processable', () => {
    renderProgressFlow('task-2')

    expect(screen.getByRole('button', { name: '模拟完成下一篇' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '模拟完成全部可处理' })).toBeInTheDocument()
  })

  it('filters progress table by review and completed tabs', async () => {
    const user = userEvent.setup()
    renderProgressFlow()

    await user.click(screen.getByRole('tab', { name: /需复核/ }))
    expect(screen.getByText('当前显示：需复核')).toBeInTheDocument()
    expect(screen.getAllByText('去复核').length).toBeGreaterThan(0)
    expect(screen.queryByText('模拟进度')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /已完成/ }))
    expect(screen.getByText('当前显示：已完成')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '查看结果' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: '去复核' })).not.toBeInTheDocument()
  })

  it('completes the next queued OCR essay and opens its generated review result', async () => {
    const user = userEvent.setup()
    renderUploadProgressAndDetailFlow()

    await user.click(screen.getByRole('button', { name: '开始模拟 OCR（预计 6 篇）' }))
    const ocrDraft = screen.getByRole('textbox', { name: '作文 1 OCR 文本' })
    await user.clear(ocrDraft)
    await user.type(ocrDraft, 'Confirmed OCR essay text')
    await user.click(screen.getByRole('button', { name: '确认 OCR 文本' }))

    expect(screen.getByRole('heading', { name: '批改进度' })).toBeInTheDocument()
    expect(screen.getAllByText('作文 11').length).toBeGreaterThan(0)
    expect(screen.getAllByText('模拟进度').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: '模拟完成下一篇' }))
    expect(screen.getByRole('status')).toHaveTextContent('作文 9 已完成批改，可查看结果')

    await user.click(screen.getByRole('button', { name: '模拟完成下一篇' }))
    expect(screen.getByRole('status')).toHaveTextContent('作文 11 已完成批改，可查看结果')
    const resultLinks = screen.getAllByRole('link', { name: '查看结果' })
    await user.click(resultLinks[resultLinks.length - 1])

    expect(screen.getByRole('heading', { name: '作文 11 批改结果' })).toBeInTheDocument()
    expect(screen.getByText('Confirmed OCR essay text')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '编辑 OCR' }))
    expect(screen.getByDisplayValue('Confirmed OCR essay text')).toBeInTheDocument()
    expect(screen.getByText('问题与修改建议')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '全文优化稿' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '本文重点提升点' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '表达升级建议' })).not.toBeInTheDocument()
  })
})
