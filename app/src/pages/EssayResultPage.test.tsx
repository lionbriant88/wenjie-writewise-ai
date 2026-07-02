import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import { ClassReviewPage } from './ClassReviewPage'
import { EssayResultPage } from './EssayResultPage'

function renderEssayDetail(path = '/tasks/task-1/essays/task-1-essay-1') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppStateProvider>
        <Routes>
          <Route path="/tasks/:taskId/essays/:essayId" element={<EssayResultPage />} />
          <Route path="/tasks/:taskId/class-review" element={<ClassReviewPage />} />
        </Routes>
      </AppStateProvider>
    </MemoryRouter>,
  )
}

describe('EssayResultPage teacher decision workflow', () => {
  it('shows a compact diagnostic summary with editable dimension scores', () => {
    renderEssayDetail()

    expect(screen.getByRole('tab', { name: '评分诊断' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '问题批改' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText('学生作文原文')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '诊断摘要' })).toBeInTheDocument()
    expect(screen.getByText('AI 置信度')).toBeInTheDocument()
    expect(screen.getByText('主要扣分项')).toBeInTheDocument()
    expect(screen.getByText('讲评建议')).toBeInTheDocument()
    expect(screen.getByText('优秀')).toBeInTheDocument()
    expect(screen.getByText('13')).toBeInTheDocument()
    expect(screen.getByText('/ 15')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /语言准确性/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '分项评分' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '问题与修改建议' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '全文优化稿' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('教师补充建议')).not.toBeInTheDocument()
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

    await user.click(screen.getByRole('tab', { name: '问题批改' }))
    expect(screen.getByRole('heading', { name: '问题与修改建议' })).toBeInTheDocument()
    expect(screen.getAllByText('问题类型')[0]).toBeInTheDocument()
    expect(screen.getAllByText('扣分影响')[0]).toBeInTheDocument()
    expect(screen.getAllByText('原句')[0]).toBeInTheDocument()
    expect(screen.getAllByText('推荐改法')[0]).toBeInTheDocument()
    expect(screen.getAllByText('原因')[0]).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: '加入班级总览' })[0])

    expect(screen.getByRole('button', { name: '已加入班级总览' })).toBeInTheDocument()
  })

  it('adds a language issue to class review materials across the task flow', async () => {
    const user = userEvent.setup()
    renderEssayDetail()

    await user.click(screen.getByRole('tab', { name: '问题批改' }))
    await user.click(screen.getAllByRole('button', { name: '加入班级总览' })[0])
    await user.click(screen.getByRole('button', { name: '已加入班级总览' }))
    await user.click(screen.getAllByRole('link', { name: '班级总览' })[0])
    await user.click(screen.getByRole('tab', { name: '教师精选素材' }))

    expect(screen.getByRole('heading', { name: '教师精选讲评素材' })).toBeInTheDocument()
    expect(screen.getByText('共 1 条素材')).toBeInTheDocument()
    expect(screen.getByText('典型错误')).toBeInTheDocument()
    expect(screen.getAllByText('I suggest you joins the club.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('I suggest you join the club.').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/suggest/).length).toBeGreaterThan(0)
    expect(screen.getByText('来源：作文 1')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /表达提升/ })).not.toBeInTheDocument()
  })

  it('shows logic coherence issues in the issue correction module', async () => {
    const user = userEvent.setup()
    renderEssayDetail()

    await user.click(screen.getByRole('tab', { name: '问题批改' }))
    expect(screen.getAllByText(/上下文关联度差/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('建议教师复核').length).toBeGreaterThan(0)
    expect(screen.getByText('建议学生补充说明')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '加入班级总览' }).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: /My mother was angry\./ }))

    expect(screen.getByText('已定位')).toBeInTheDocument()

    const addButtons = screen.getAllByRole('button', { name: '加入班级总览' })
    await user.click(addButtons[addButtons.length - 1])

    expect(screen.getByRole('button', { name: '已加入班级总览' })).toBeInTheDocument()
  })

  it('shows full text revision with safe correction and sentence comparison views', async () => {
    const user = userEvent.setup()
    renderEssayDetail()

    await user.click(screen.getByRole('tab', { name: '全文优化' }))
    expect(screen.getByRole('heading', { name: '全文优化稿' })).toBeInTheDocument()
    expect(screen.getAllByText(/保留学生原文思路/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '纠错版' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '提升版' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '逐句对照' })).toBeInTheDocument()
    expect(screen.getByText('逻辑优化说明')).toBeInTheDocument()
    expect(screen.getByText('本文重点提升点')).toBeInTheDocument()
    expect(screen.getAllByText(/From my point of view/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('heading', { name: '表达升级建议' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '纠错版' }))
    expect(screen.getAllByText(/I suggest you join the club\./).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: '逐句对照' }))
    expect(screen.getAllByText(/是否保留原意/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('建议教师复核').length).toBeGreaterThan(0)
  })

  it('marks an issue card as selected when the teacher clicks it', async () => {
    const user = userEvent.setup()
    renderEssayDetail()

    await user.click(screen.getByRole('tab', { name: '问题批改' }))
    await user.click(screen.getByText('I suggest you joins the club.'))

    expect(screen.getByText('已定位')).toBeInTheDocument()
  })

  it('highlights the matching source text when an issue card is selected', async () => {
    const user = userEvent.setup()
    renderEssayDetail()

    expect(screen.getByRole('button', { name: '阅读定位' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编辑 OCR' })).toBeInTheDocument()
    expect(screen.queryByLabelText('学生作文原文')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '问题批改' }))
    await user.click(screen.getByText('I suggest you joins the club.'))

    expect(screen.queryByText('定位预览')).not.toBeInTheDocument()
    expect(screen.getAllByText('I suggest you joins the club.').length).toBeGreaterThanOrEqual(2)

    await user.click(screen.getByRole('button', { name: '编辑 OCR' }))

    expect(screen.getByLabelText('学生作文原文')).toBeInTheDocument()
  })

  it('shows fallback feedback when selected issue text is not found in the source', async () => {
    const user = userEvent.setup()
    renderEssayDetail()

    await user.click(screen.getByRole('button', { name: '编辑 OCR' }))
    await user.clear(screen.getByLabelText('学生作文原文'))
    await user.type(screen.getByLabelText('学生作文原文'), 'This edited OCR text no longer contains the issue sentence.')
    await user.click(screen.getByRole('button', { name: '阅读定位' }))
    await user.click(screen.getByRole('tab', { name: '问题批改' }))
    await user.click(screen.getByText('I suggest you joins the club.'))

    expect(screen.getByText('未精确定位')).toBeInTheDocument()
    expect(screen.getByText('未在原文中精确定位，请手动核对')).toBeInTheDocument()
  })

  it('saves teacher comment adjustments with lightweight feedback', async () => {
    const user = userEvent.setup()
    renderEssayDetail()

    await user.click(screen.getByRole('tab', { name: '教师反馈' }))
    await user.clear(screen.getByLabelText('AI 总评'))
    await user.type(screen.getByLabelText('AI 总评'), 'Teacher adjusted overall comment.')
    await user.type(screen.getByLabelText('教师补充建议'), 'Focus on subject-verb agreement before final submission.')
    await user.click(screen.getByRole('button', { name: '保存调整' }))

    expect(screen.getByText('已保存教师调整')).toBeInTheDocument()
    expect(screen.getAllByText('已由教师调整').length).toBeGreaterThanOrEqual(1)
  })
})
