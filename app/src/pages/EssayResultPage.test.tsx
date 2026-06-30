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
    expect(screen.getAllByText('已由教师调整').length).toBeGreaterThanOrEqual(1)
  })

  it('clamps invalid dimension score values without rounding valid max scores upward', () => {
    renderEssayDetail()

    const accuracyInput = screen.getByRole('spinbutton', { name: /语言准确性/ })

    fireEvent.change(accuracyInput, { target: { value: '99' } })
    expect(accuracyInput).toHaveValue(3.75)

    fireEvent.change(accuracyInput, { target: { value: '-3' } })
    expect(accuracyInput).toHaveValue(0)
  })

  it('shows structured issue correction details and class overview feedback', async () => {
    const user = userEvent.setup()
    renderEssayDetail()

    expect(screen.getByRole('heading', { name: '问题与修改建议' })).toBeInTheDocument()
    expect(screen.getAllByText('问题类型')[0]).toBeInTheDocument()
    expect(screen.getAllByText('扣分影响')[0]).toBeInTheDocument()
    expect(screen.getAllByText('原句')[0]).toBeInTheDocument()
    expect(screen.getAllByText('推荐改法')[0]).toBeInTheDocument()
    expect(screen.getAllByText('原因')[0]).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: '加入班级总览' })[0])

    expect(screen.getByRole('button', { name: '已加入班级总览' })).toBeInTheDocument()
  })

  it('saves teacher comment adjustments with lightweight feedback', async () => {
    const user = userEvent.setup()
    renderEssayDetail()

    await user.clear(screen.getByLabelText('AI 总评'))
    await user.type(screen.getByLabelText('AI 总评'), 'Teacher adjusted overall comment.')
    await user.type(screen.getByLabelText('教师补充建议'), 'Focus on subject-verb agreement before final submission.')
    await user.click(screen.getByRole('button', { name: '保存调整' }))

    expect(screen.getByText('已保存教师调整')).toBeInTheDocument()
    expect(screen.getAllByText('已由教师调整').length).toBeGreaterThanOrEqual(1)
  })
})
