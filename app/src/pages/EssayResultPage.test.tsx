import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import { EssayResultPage } from './EssayResultPage'

function renderEssayDetail(path = '/tasks/task-1/essays/task-1-essay-1') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppStateProvider>
        <Routes>
          <Route path="/tasks/:taskId/essays/:essayId" element={<EssayResultPage />} />
        </Routes>
      </AppStateProvider>
    </MemoryRouter>,
  )
}

describe('EssayResultPage teacher decision workflow', () => {
  it('shows a compact diagnostic summary with editable dimension scores', () => {
    renderEssayDetail()

    expect(screen.getByRole('heading', { name: '诊断摘要' })).toBeInTheDocument()
    expect(screen.getByText('AI 置信度')).toBeInTheDocument()
    expect(screen.getByText('主要扣分项')).toBeInTheDocument()
    expect(screen.getByText('讲评建议')).toBeInTheDocument()
    expect(screen.getByText('优秀')).toBeInTheDocument()
    expect(screen.getByText('13')).toBeInTheDocument()
    expect(screen.getByText('/ 15')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /语言准确性/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '分项评分' })).not.toBeInTheDocument()
  })

  it('syncs dimension score edits with integer total score and five-band grade', async () => {
    const user = userEvent.setup()
    renderEssayDetail()

    const handwritingInput = screen.getByRole('spinbutton', { name: /卷面\/字迹/ })
    await user.clear(handwritingInput)
    await user.type(handwritingInput, '0.1')

    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('良好')).toBeInTheDocument()
    expect(screen.getByText('分数已更新')).toBeInTheDocument()
    expect(screen.getByText('已由教师调整')).toBeInTheDocument()
  })

  it('clamps invalid dimension score values without rounding valid max scores upward', () => {
    renderEssayDetail()

    const accuracyInput = screen.getByRole('spinbutton', { name: /语言准确性/ })

    fireEvent.change(accuracyInput, { target: { value: '99' } })
    expect(accuracyInput).toHaveValue(3.75)

    fireEvent.change(accuracyInput, { target: { value: '-3' } })
    expect(accuracyInput).toHaveValue(0)
  })
})
