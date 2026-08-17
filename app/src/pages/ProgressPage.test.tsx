import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import { useAppState } from '../context/useAppState'
import type { GradingClient, MultimodalGradingRequestV2 } from '../services/grading/types'
import { EssayResultPage } from './EssayResultPage'
import { ExceptionsPage } from './ExceptionsPage'
import { ProgressPage } from './ProgressPage'
import { UploadPage } from './UploadPage'

function renderProgressFlow(taskId = 'task-2', gradingClient?: GradingClient) {
  render(
    <AppStateProvider gradingClient={gradingClient}>
      <MemoryRouter initialEntries={[`/tasks/${taskId}/progress`]}>
        <Routes>
          <Route path="/tasks/:taskId/progress" element={<ProgressPage />} />
          <Route path="/tasks/:taskId/exceptions" element={<ExceptionsPage />} />
          <Route path="/tasks/:taskId/essays/:essayId" element={<EssayResultPage />} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}

function renderUploadFlow() {
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

function CrossTaskControls() {
  const { essays, enqueueImageEssays, gradeEssay } = useAppState()
  const otherTaskEssay = essays.find((essay) => essay.taskId === 'task-2' && essay.status === 'pending_grading')
  return (
    <div>
      <button type="button" onClick={() => enqueueImageEssays({
        submissionId: 'cross-task-current', taskId: 'task-3', className: 'Synthetic class',
        essayGroups: [{ pages: [{ id: 'current-page', label: 'Current page', pageNumber: 1, quality: 'clear', accent: '#000', sourceFile: new File(['image'], 'current.png', { type: 'image/png' }) }] }],
      })}>添加当前任务待批改作文</button>
      <button type="button" onClick={() => { if (otherTaskEssay) void gradeEssay(otherTaskEssay.id) }}>启动另一任务批改</button>
    </div>
  )
}

function renderCrossTaskProgress(gradingClient: GradingClient) {
  render(
    <AppStateProvider gradingClient={gradingClient}>
      <CrossTaskControls />
      <MemoryRouter initialEntries={['/tasks/task-3/progress']}>
        <Routes><Route path="/tasks/:taskId/progress" element={<ProgressPage />} /></Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}

function failedClient(grade = vi.fn(async (request: MultimodalGradingRequestV2) => ({
  requestId: request.requestId,
  status: 'failed' as const,
  error: { code: 'provider_timeout' as const, message: '安全超时提示。', retryable: true },
}))) {
  return { client: { gradeImages: grade } satisfies GradingClient, grade }
}

describe('ProgressPage', () => {
  it('offers one-at-a-time grading without batch controls and documents memory-only state', () => {
    renderProgressFlow()
    expect(screen.getByRole('button', { name: '开始批改' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /全部|批量/ })).not.toBeInTheDocument()
    expect(screen.getByText(/结果仅保存在当前页面状态中/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /处理中/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /需复核/ })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/DeepSeek|API.?key/i)
  })

  it('starts only the next pending essay and exposes its ready result for teacher review', async () => {
    const user = userEvent.setup()
    renderProgressFlow()
    await user.click(screen.getByRole('button', { name: '开始批改' }))
    expect((await screen.findAllByText('待教师确认')).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: '查看并确认' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /批量/ })).not.toBeInTheDocument()
  })

  it('shows a disabled running-row action and does not automatically retry', async () => {
    const user = userEvent.setup()
    let resolve!: (value: Awaited<ReturnType<GradingClient['gradeImages']>>) => void
    const deferred = new Promise<Awaited<ReturnType<GradingClient['gradeImages']>>>((done) => { resolve = done })
    const grade = vi.fn((_request: MultimodalGradingRequestV2) => deferred)
    renderProgressFlow('task-2', { gradeImages: grade })
    await user.click(screen.getByRole('button', { name: '开始批改' }))
    expect(await screen.findByRole('button', { name: '批改中' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '开始批改' })).not.toBeInTheDocument()
    expect(grade).toHaveBeenCalledTimes(1)
    const request = grade.mock.calls[0][0]
    resolve({
      requestId: request.requestId,
      status: 'failed',
      error: { code: 'provider_timeout', message: '安全超时提示。', retryable: true },
    })
  })

  it('disables failed-row retry actions while another essay in the task is running', async () => {
    const user = userEvent.setup()
    let resolveSecond!: (value: Awaited<ReturnType<GradingClient['gradeImages']>>) => void
    const secondResponse = new Promise<Awaited<ReturnType<GradingClient['gradeImages']>>>((done) => { resolveSecond = done })
    const grade = vi.fn((request: MultimodalGradingRequestV2) => grade.mock.calls.length === 1
      ? Promise.resolve({ requestId: request.requestId, status: 'failed' as const, error: { code: 'provider_timeout' as const, message: '安全超时提示。', retryable: true } })
      : secondResponse)
    renderProgressFlow('task-2', { gradeImages: grade })
    await user.click(screen.getByRole('button', { name: '开始批改' }))
    expect(await screen.findByRole('button', { name: '重试批改' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '开始批改' }))
    expect(screen.getByRole('button', { name: '重试批改' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '使用 mock 回退' })).toBeDisabled()
    const request = grade.mock.calls[1][0]
    resolveSecond({ requestId: request.requestId, status: 'failed', error: { code: 'provider_timeout', message: '安全超时提示。', retryable: true } })
  })

  it('hides current-task start actions while a different task request is in flight', async () => {
    const user = userEvent.setup()
    let resolveOther!: (value: Awaited<ReturnType<GradingClient['gradeImages']>>) => void
    const deferred = new Promise<Awaited<ReturnType<GradingClient['gradeImages']>>>((done) => { resolveOther = done })
    const grade = vi.fn((_request: MultimodalGradingRequestV2) => deferred)
    renderCrossTaskProgress({ gradeImages: grade })
    await user.click(screen.getByRole('button', { name: '添加当前任务待批改作文' }))
    expect(screen.getByRole('button', { name: '开始批改' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '启动另一任务批改' }))
    expect(grade).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: '开始批改' })).not.toBeInTheDocument()
    const request = grade.mock.calls[0][0]
    resolveOther({ requestId: request.requestId, status: 'failed', error: { code: 'provider_timeout', message: '安全超时提示。', retryable: true } })
    await waitFor(() => expect(screen.getByRole('button', { name: '开始批改' })).toBeEnabled())
  })

  it('renders safe failure recovery and explicit retry creates one additional call', async () => {
    const user = userEvent.setup()
    const { client, grade } = failedClient()
    renderProgressFlow('task-2', client)
    await user.click(screen.getByRole('button', { name: '开始批改' }))
    expect(await screen.findByText('安全超时提示。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试批改' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '使用 mock 回退' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '转人工处理' })).toBeEnabled()
    expect(screen.getByText(/可能产生第二次真实 Provider 费用/)).toBeInTheDocument()
    expect(grade).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: '重试批改' }))
    expect(grade).toHaveBeenCalledTimes(2)
    expect(grade.mock.calls[0][0].requestId).not.toBe(grade.mock.calls[1][0].requestId)
  })

  it('keeps mock fallback and manual handling actionable after failure', async () => {
    const user = userEvent.setup()
    const first = failedClient()
    renderProgressFlow('task-2', first.client)
    await user.click(screen.getByRole('button', { name: '开始批改' }))
    await user.click(await screen.findByRole('button', { name: '使用 mock 回退' }))
    expect((await screen.findAllByText('待教师确认')).length).toBeGreaterThan(0)
    expect(first.grade).toHaveBeenCalledTimes(1)

    const second = failedClient()
    renderProgressFlow('task-2', second.client)
    const startButtons = screen.getAllByRole('button', { name: '开始批改' })
    await user.click(startButtons[startButtons.length - 1])
    const manualButtons = await screen.findAllByRole('button', { name: '转人工处理' })
    await user.click(manualButtons[manualButtons.length - 1])
    expect(screen.getAllByText('已转人工处理').length).toBeGreaterThan(0)
  })

  it('includes grading_ready in review filtering and preserves neutral recognition review navigation', async () => {
    const user = userEvent.setup()
    renderProgressFlow('task-1')
    await user.click(screen.getByRole('tab', { name: /需复核/ }))
    expect(screen.getAllByTestId('progress-review-row').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: '去复核识别结果' }).length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(/OCR/i)
  })

  it('takes a directly queued image upload into the progress page', async () => {
    const user = userEvent.setup()
    renderUploadFlow()
    await user.click(screen.getByRole('button', { name: '添加模拟图片' }))
    await user.clear(screen.getByLabelText('班级'))
    await user.type(screen.getByLabelText('班级'), '九年级 3 班')
    await user.click(screen.getByRole('button', { name: '确认分组并进入批改' }))
    expect(screen.getByRole('heading', { name: '批改进度' })).toBeInTheDocument()
    expect(screen.getAllByText('待批改').length).toBeGreaterThan(0)
  })
})
