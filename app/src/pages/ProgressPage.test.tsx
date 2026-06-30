import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import { EssayResultPage } from './EssayResultPage'
import { ProgressPage } from './ProgressPage'
import { UploadPage } from './UploadPage'

function renderUploadProgressAndDetailFlow() {
  render(
    <AppStateProvider>
      <MemoryRouter initialEntries={['/tasks/task-1/upload']}>
        <Routes>
          <Route path="/tasks/:taskId/upload" element={<UploadPage />} />
          <Route path="/tasks/:taskId/progress" element={<ProgressPage />} />
          <Route path="/tasks/:taskId/essays/:essayId" element={<EssayResultPage />} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}

describe('ProgressPage', () => {
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
    expect(screen.getByText('表达升级建议')).toBeInTheDocument()
  })
})
