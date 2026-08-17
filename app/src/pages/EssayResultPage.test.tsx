import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import { createMockGradingClient } from '../services/grading/mockGradingClient'
import type { GradingClient } from '../services/grading/types'
import { ClassReviewPage } from './ClassReviewPage'
import { EssayResultPage, GradingReviewBanner } from './EssayResultPage'
import { ProgressPage } from './ProgressPage'

function renderEssayDetail(path = '/tasks/task-1/essays/task-1-essay-1') {
  return render(
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

function renderPendingReviewFlow(gradingClient: GradingClient) {
  return render(
    <MemoryRouter initialEntries={['/tasks/task-2/progress']}>
      <AppStateProvider gradingClient={gradingClient}>
        <Routes>
          <Route path="/tasks/:taskId/progress" element={<ProgressPage />} />
          <Route path="/tasks/:taskId/essays/:essayId" element={<EssayResultPage />} />
        </Routes>
      </AppStateProvider>
    </MemoryRouter>,
  )
}

function getIssueCardButton(name: RegExp) {
  const issueCard = screen
    .getAllByRole('button', { name })
    .find((button) => button.getAttribute('aria-pressed') !== null)

  if (!issueCard) {
    throw new Error(`Issue card not found: ${name}`)
  }

  return issueCard
}

function getSourceModeButton(mode: 'read' | 'edit') {
  const keywordsByMode = {
    read: ['阅读定位'],
    edit: ['复核识别结果'],
  } satisfies Record<typeof mode, string[]>
  const modeButton = screen
    .getAllByRole('button')
    .find((button) => keywordsByMode[mode].some((keyword) => button.textContent?.includes(keyword)))

  if (!modeButton) {
    throw new Error(`Source mode button not found: ${mode}`)
  }

  return modeButton
}

function getWorkspaceModeButton(mode: 'grading' | 'paper') {
  const keywordsByMode = {
    grading: ['批改工作台', '鎵规敼宸ヤ綔鍙?'],
    paper: ['原卷视图', '鍘熷嵎瑙嗗浘'],
  } satisfies Record<typeof mode, string[]>
  const modeButton = screen
    .getAllByRole('button')
    .find((button) => keywordsByMode[mode].some((keyword) => button.textContent?.includes(keyword)))

  if (!modeButton) {
    throw new Error(`Workspace mode button not found: ${mode}`)
  }

  return modeButton
}

describe('EssayResultPage teacher decision workflow', () => {
  it('keeps the grade visible while a transcript draft is edited and invalidates it only after explicit save', async () => {
    const user = userEvent.setup()
    renderEssayDetail()

    expect(screen.getAllByText(/总分|\u603b\u5206/).length).toBeGreaterThan(0)
    await user.click(getSourceModeButton('edit'))
    const transcript = screen.getByLabelText('学生作文识别文本')
    await user.clear(transcript)
    await user.type(transcript, 'Teacher-corrected recognition text.')

    expect(screen.getAllByText(/总分|\u603b\u5206/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '保存识别文本并使旧结果失效' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '保存识别文本并使旧结果失效' }))

    expect(screen.getByText('结果已失效')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认本篇批改' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回批改进度重新批改' })).toBeInTheDocument()
  })

  it('renders a provider-neutral remote review and confirms only through the explicit action', async () => {
    const user = userEvent.setup()
    const localClient = createMockGradingClient()
    const gradingClient: GradingClient = {
      gradeImages: async (request) => {
        const response = await localClient.gradeImages(request)
        if (response.status === 'failed') return response

        return {
          ...response,
          provider: 'remote',
          modelSelfConfidence: 0.99,
          reviewReasons: ['请复核合成作文中的改写建议。'],
        }
      },
    }
    renderPendingReviewFlow(gradingClient)

    await user.click(screen.getByRole('button', { name: '开始批改' }))
    await user.click(await screen.findByRole('link', { name: '查看并确认' }))

    expect(screen.getByText('真实 AI')).toBeInTheDocument()
    expect(screen.getByText('请复核合成作文中的改写建议。')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/DeepSeek|模型自报置信度|AI 置信度/i)
    expect(screen.getByRole('button', { name: '确认本篇批改' })).toBeEnabled()

    const scoreInput = screen.getAllByRole('spinbutton')[0]
    fireEvent.change(scoreInput, { target: { value: '1' } })
    expect(screen.getByRole('button', { name: '确认本篇批改' })).toBeEnabled()

    await user.click(screen.getByRole('tab', { name: '全文优化' }))
    expect(document.body.textContent).not.toMatch(/已保留原意|是否保留原意：是/)

    await user.click(screen.getByRole('button', { name: '确认本篇批改' }))
    expect(screen.queryByRole('button', { name: '确认本篇批改' })).not.toBeInTheDocument()
  })

  it('shows a structured legibility finding in the existing issue tab without changing the result tabs', async () => {
    const user = userEvent.setup()
    const localClient = createMockGradingClient()
    const gradingClient: GradingClient = {
      gradeImages: async (request) => {
        const response = await localClient.gradeImages(request)
        if (response.status === 'failed') return response
        return {
          ...response,
          recognitionWarnings: [],
          legibilityIssues: [{
            id: 'legibility-1', transcriptText: 'mock', possibleReadings: ['mock', 'mark'], pageNumber: 1,
            regionDescription: 'Synthetic region.', explanation: 'Synthetic ambiguous handwriting.', defaultOutcome: 'count_as_legibility_error',
          }],
        }
      },
    }
    renderPendingReviewFlow(gradingClient)

    await user.click(screen.getByRole('button', { name: '开始批改' }))
    await user.click(await screen.findByRole('link', { name: '查看并确认' }))
    await user.click(screen.getByRole('tab', { name: '问题批改' }))

    expect(screen.getByText('字迹不清导致语义无法确认')).toBeInTheDocument()
    expect(screen.getByText(/卷面与可读性/)).toBeInTheDocument()
    expect(screen.getByText('系统默认按错误处理；可能读法：mock / mark')).toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(4)
  })

  it('labels browser-local recovery as mock fallback', async () => {
    const user = userEvent.setup()
    const gradingClient: GradingClient = {
      gradeImages: vi.fn(async (request) => ({
        requestId: request.requestId,
        status: 'failed' as const,
        error: { code: 'provider_timeout' as const, message: '安全失败。', retryable: true },
      })),
    }
    renderPendingReviewFlow(gradingClient)

    await user.click(screen.getByRole('button', { name: '开始批改' }))
    await user.click(await screen.findByRole('button', { name: '使用 mock 回退' }))
    await user.click(await screen.findByRole('link', { name: '查看并确认' }))

    expect(screen.getByText('mock 回退')).toBeInTheDocument()
  })

  it('shows confirmation only for grading-ready state and disables it without a result', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const view = render(
      <GradingReviewBanner
        essayStatus="grading_ready"
        hasResult={false}
        reviewReasons={[]}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByRole('button', { name: '确认本篇批改' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '确认本篇批改' }))
    expect(onConfirm).not.toHaveBeenCalled()

    view.rerender(
      <GradingReviewBanner
        essayStatus="grading_ready"
        hasResult
        reviewReasons={[]}
        onConfirm={onConfirm}
      />,
    )
    await user.click(screen.getByRole('button', { name: '确认本篇批改' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)

    view.rerender(
      <GradingReviewBanner
        essayStatus="completed"
        hasResult
        reviewReasons={[]}
        onConfirm={onConfirm}
      />,
    )
    expect(screen.queryByRole('button', { name: '确认本篇批改' })).not.toBeInTheDocument()
  })

  it('shows a compact diagnostic summary with editable dimension scores', () => {
    renderEssayDetail()

    expect(screen.getByRole('tab', { name: '评分诊断' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '问题批改' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText('学生作文识别文本')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '诊断摘要' })).toBeInTheDocument()
    expect(screen.queryByText('AI 置信度')).not.toBeInTheDocument()
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
    expect(screen.getByRole('region', { name: '作文源文本面板' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '教师反馈面板' })).toBeInTheDocument()
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

    await user.click(getIssueCardButton(/My mother was angry\./))

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
    expect(screen.getAllByText(/是否忠实于原意仍需教师复核/).length).toBeGreaterThan(0)
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
    expect(screen.queryByText(/是否保留原意/)).not.toBeInTheDocument()
    expect(screen.getAllByText('建议教师复核').length).toBeGreaterThan(0)
  })

  it('marks an issue card as selected when the teacher clicks it', async () => {
    const user = userEvent.setup()
    renderEssayDetail()

    await user.click(screen.getByRole('tab', { name: '问题批改' }))
    await user.click(getIssueCardButton(/I suggest you joins the club\./))

    expect(screen.getByText('已定位')).toBeInTheDocument()
  })

  it('highlights the matching source text when an issue card is selected', async () => {
    const user = userEvent.setup()
    renderEssayDetail()

    expect(getWorkspaceModeButton('grading')).toHaveAttribute('aria-pressed', 'true')
    expect(getWorkspaceModeButton('paper')).toHaveAttribute('aria-pressed', 'false')
    expect(getSourceModeButton('read')).toBeInTheDocument()
    expect(getSourceModeButton('edit')).toBeInTheDocument()
    expect(
      screen
        .getAllByRole('button')
        .filter((button) => button.textContent?.includes('原卷视图') || button.textContent?.includes('鍘熷嵎瑙嗗浘')),
    ).toHaveLength(1)
    expect(screen.queryByLabelText('学生作文识别文本')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '问题批改' }))
    await user.click(getIssueCardButton(/I suggest you joins the club\./))

    expect(screen.queryByText('定位预览')).not.toBeInTheDocument()
    expect(screen.getAllByText('I suggest you joins the club.').length).toBeGreaterThanOrEqual(2)

    await user.click(screen.getByRole('button', { name: '复核识别结果' }))

    expect(screen.getByLabelText('学生作文识别文本')).toBeInTheDocument()
  })

  it('opens the issue correction tab and selects a card when a marked source sentence is clicked', async () => {
    const user = userEvent.setup()
    const view = renderEssayDetail()

    const languageMarker = view.container.querySelector('[data-issue-source="language"]')

    expect(languageMarker).not.toBeNull()

    await user.click(languageMarker as HTMLElement)

    expect(view.container.querySelector('[data-issue-source="language"]')).toHaveAttribute('data-active', 'true')
    expect(
      screen
        .getAllByRole('button', { name: /I suggest you joins the club\./ })
        .some((button) => button.getAttribute('aria-pressed') === 'true'),
    ).toBe(true)
  })

  it('hides source issue markers while reviewing recognition text and restores them before save', async () => {
    const user = userEvent.setup()
    const view = renderEssayDetail()

    expect(view.container.querySelector('[data-issue-source="language"]')).not.toBeNull()
    expect(view.container.querySelector('[data-issue-source="logic"]')).not.toBeNull()

    await user.click(getSourceModeButton('edit'))

    expect(view.container.querySelector('[data-issue-source="language"]')).toBeNull()
    expect(view.container.querySelector('[data-issue-source="logic"]')).toBeNull()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My mother was angry.' } })
    await user.click(getSourceModeButton('read'))

    expect(view.container.querySelector('[data-issue-source="language"]')).not.toBeNull()
    expect(view.container.querySelector('[data-issue-source="logic"]')).not.toBeNull()
  })

  it('keeps issue location tied to the saved recognition text until the teacher saves', async () => {
    const user = userEvent.setup()
    renderEssayDetail()

    await user.click(screen.getByRole('button', { name: '复核识别结果' }))
    await user.clear(screen.getByLabelText('学生作文识别文本'))
    await user.type(screen.getByLabelText('学生作文识别文本'), 'This edited recognition text no longer contains the issue sentence.')
    await user.click(screen.getByRole('button', { name: '阅读定位' }))
    await user.click(screen.getByRole('tab', { name: '问题批改' }))
    await user.click(getIssueCardButton(/I suggest you joins the club\./))

    expect(screen.getAllByText('I suggest you joins the club.').length).toBeGreaterThan(0)
  })

  it('switches to a page-level original paper workspace without grading content', async () => {
    const user = userEvent.setup()
    const view = renderEssayDetail()

    expect(getWorkspaceModeButton('grading')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('tab', { name: '评分诊断' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '问题批改' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '全文优化' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '教师反馈' })).toBeInTheDocument()
    expect(getSourceModeButton('read')).toBeInTheDocument()
    expect(getSourceModeButton('edit')).toBeInTheDocument()
    expect(view.container.querySelector('[data-issue-source="language"]')).not.toBeNull()

    await user.click(getWorkspaceModeButton('paper'))

    expect(getWorkspaceModeButton('paper')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('paper-workspace')).toBeInTheDocument()
    expect(screen.getByTestId('paper-image-stage')).toBeInTheDocument()
    expect(screen.getByText('后续接入图像定位信息后，将在此处展示原卷批阅能力。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回批改工作台' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回批改进度' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上一篇' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '下一篇' })).toBeInTheDocument()
    expect(screen.getByText('第 1 / 1 页')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '评分诊断' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '问题批改' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '全文优化' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '教师反馈' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '诊断摘要' })).not.toBeInTheDocument()
    expect(screen.queryByText('AI 置信度')).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: /语言准确性/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('学生作文识别文本')).not.toBeInTheDocument()
    expect(view.container.querySelector('[data-issue-source="language"]')).toBeNull()
    expect(view.container.querySelector('[data-issue-source="logic"]')).toBeNull()
  })

  it('returns from original paper workspace with grading workflows intact', async () => {
    const user = userEvent.setup()
    const view = renderEssayDetail()

    await user.click(getWorkspaceModeButton('paper'))
    expect(view.container.querySelector('[data-issue-source="language"]')).toBeNull()

    await user.click(screen.getByRole('button', { name: '返回批改工作台' }))

    expect(getWorkspaceModeButton('grading')).toHaveAttribute('aria-pressed', 'true')
    expect(getSourceModeButton('read')).toBeInTheDocument()
    expect(getSourceModeButton('edit')).toBeInTheDocument()
    expect(view.container.querySelector('[data-issue-source="language"]')).not.toBeNull()
    expect(view.container.querySelector('[data-issue-source="logic"]')).not.toBeNull()

    await user.click(screen.getByRole('tab', { name: '问题批改' }))
    await user.click(getIssueCardButton(/I suggest you joins the club\./))
    expect(screen.getByText('已定位')).toBeInTheDocument()

    await user.click(getSourceModeButton('edit'))
    expect(screen.getByLabelText('学生作文识别文本')).toBeInTheDocument()

    await user.click(getSourceModeButton('read'))
    await user.click(screen.getAllByRole('button', { name: '加入班级总览' })[0])
    expect(screen.getByRole('button', { name: '已加入班级总览' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '全文优化' }))
    expect(screen.getByRole('heading', { name: '全文优化稿' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '教师反馈' }))
    expect(screen.getByLabelText('AI 总评')).toBeInTheDocument()
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
