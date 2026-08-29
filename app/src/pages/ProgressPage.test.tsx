import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import { useAppState } from '../context/useAppState'
import type { TaskGradingSchedulerOptions } from '../services/grading/taskGradingScheduler'
import type { GradingClient, GradingClientResponse, MultimodalGradingRequestV2 } from '../services/grading/types'
import { EssayResultPage } from './EssayResultPage'
import { ExceptionsPage } from './ExceptionsPage'
import { ProgressPage } from './ProgressPage'

function renderProgressFlow(
  taskId = 'task-2',
  gradingClient?: GradingClient,
  gradingSchedulerOptions?: TaskGradingSchedulerOptions,
) {
  return render(
    <AppStateProvider gradingClient={gradingClient} gradingSchedulerOptions={gradingSchedulerOptions}>
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

function successfulResult(request: MultimodalGradingRequestV2) {
  const transcript = request.confirmedTranscript ?? 'Synthetic direct-image transcript.'
  return {
    resultVersion: 'grading-result-v2' as const,
    requestId: request.requestId,
    essayId: request.essayId,
    provider: 'mock' as const,
    status: 'success' as const,
    totalScore: request.task.fullScore,
    maxScore: request.task.fullScore,
    dimensionScores: request.task.rubric.dimensions.map((dimension) => ({
      dimensionId: dimension.id,
      name: dimension.name,
      score: dimension.weight * request.task.fullScore / 100,
      maxScore: dimension.weight * request.task.fullScore / 100,
      weight: dimension.weight,
      reason: 'Synthetic reason.',
      evidence: transcript,
    })),
    issues: [],
    sentenceRevisions: [],
    expressionUpgrades: [],
    recognitionWarnings: [],
    legibilityIssues: [],
    fullTextRevision: {
      originalText: transcript,
      correctedText: transcript,
      improvedText: transcript,
      sentencePairs: [],
      logicNotes: [],
      logicIssues: [],
    },
    overallComment: 'Synthetic result.',
    reviewReasons: [],
    createdAt: '2026-08-29T00:00:00.000Z',
    transcript,
    printedTextExcluded: true,
  }
}

function CrossTaskControls() {
  const { enqueueImageEssays, startTaskGrading } = useAppState()
  return (
    <div>
      <button type="button" onClick={() => enqueueImageEssays({
        submissionId: 'cross-task-current',
        taskId: 'task-3',
        className: 'Synthetic class',
        essayGroups: [{
          pages: [{
            id: 'current-page',
            label: 'Current page',
            pageNumber: 1,
            quality: 'clear',
            accent: '#000',
            sourceFile: new File(['image'], 'current.png', { type: 'image/png' }),
          }],
        }],
      })}>添加当前任务待批改作文</button>
      <button type="button" onClick={() => startTaskGrading('task-2')}>启动另一任务批改</button>
    </div>
  )
}

function renderCrossTaskProgress(gradingClient: GradingClient) {
  return render(
    <AppStateProvider
      gradingClient={gradingClient}
      gradingSchedulerOptions={{ mode: 'single-legacy', hardLimit: 1, stableSuccessWindow: 2 }}
    >
      <CrossTaskControls />
      <MemoryRouter initialEntries={['/tasks/task-3/progress']}>
        <Routes><Route path="/tasks/:taskId/progress" element={<ProgressPage />} /></Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}

describe('ProgressPage bounded whole-task grading', () => {
  it('offers one task-level start action and contains no stale OCR, serial, mock-fallback, or provider-cost copy', () => {
    renderProgressFlow()

    expect(screen.getByRole('button', { name: '开始批改全部待处理作文' })).toBeEnabled()
    expect(screen.getByText(/结果仅保存在当前页面状态中/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /待教师处理/ })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/OCR|逐篇|不会自动并发|mock 回退|第二次真实 Provider|RPM|TPM|token|cache/i)
  })

  it('shows running and queued essays after one click while exposing the bounded concurrency', async () => {
    const user = userEvent.setup()
    let resolve!: (value: GradingClientResponse) => void
    const pending = new Promise<GradingClientResponse>((done) => { resolve = done })
    const gradeImages = vi.fn((_request: MultimodalGradingRequestV2) => pending)
    renderProgressFlow(
      'task-2',
      { gradeImages },
      { mode: 'single-legacy', hardLimit: 1, stableSuccessWindow: 2 },
    )

    await user.click(screen.getByRole('button', { name: '开始批改全部待处理作文' }))

    expect((await screen.findAllByText('批改中')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('排队中')).length).toBeGreaterThan(0)
    expect(screen.getByText(/当前同时批改 1 篇.*最多同时处理 1 篇/)).toBeInTheDocument()
    expect(gradeImages).toHaveBeenCalledTimes(1)
    resolve(successfulResult(gradeImages.mock.calls[0][0]))
  })

  it('isolates one retryable failure, continues other essays, and retries with the same caller ID', async () => {
    const user = userEvent.setup()
    let failedEssayId = ''
    const requests: MultimodalGradingRequestV2[] = []
    const attempts = new Map<string, number>()
    const gradeImages = vi.fn(async (request: MultimodalGradingRequestV2) => {
      requests.push(request)
      failedEssayId ||= request.essayId
      const attempt = (attempts.get(request.essayId) ?? 0) + 1
      attempts.set(request.essayId, attempt)
      if (request.essayId === failedEssayId && attempt === 1) {
        return {
          requestId: request.requestId,
          status: 'failed' as const,
          error: { code: 'provider_timeout' as const, message: '安全超时提示。', retryable: true },
        }
      }
      return successfulResult(request)
    })
    renderProgressFlow(
      'task-2',
      { gradeImages },
      { mode: 'single-legacy', hardLimit: 1, stableSuccessWindow: 2 },
    )

    await user.click(screen.getByRole('button', { name: '开始批改全部待处理作文' }))
    expect(await screen.findByText('可重试失败')).toBeInTheDocument()
    expect((await screen.findAllByText('待教师确认')).length).toBeGreaterThan(0)
    const firstId = requests.find((request) => request.essayId === failedEssayId)?.requestId

    await user.click(screen.getByRole('button', { name: '重试批改' }))
    await waitFor(() => expect(attempts.get(failedEssayId)).toBe(2))
    const retryIds = requests.filter((request) => request.essayId === failedEssayId).map((request) => request.requestId)
    expect(retryIds).toEqual([firstId, firstId])
    await waitFor(() => expect(screen.queryByText('可重试失败')).not.toBeInTheDocument())
  })

  it('uses 检查结果 for an unknown settlement and reattaches the same job', async () => {
    const user = userEvent.setup()
    let unknownEssayId = ''
    const requests: MultimodalGradingRequestV2[] = []
    const gradeImages = vi.fn(async (request: MultimodalGradingRequestV2) => {
      requests.push(request)
      unknownEssayId ||= request.essayId
      if (request.essayId === unknownEssayId && requests.filter((item) => item.essayId === unknownEssayId).length === 1) {
        return {
          requestId: request.requestId,
          status: 'failed' as const,
          error: { code: 'provider_result_unknown' as const, message: '结果仍在确认。', retryable: false },
          clientMeta: { reattachOnly: true as const },
        }
      }
      return successfulResult(request)
    })
    renderProgressFlow(
      'task-2',
      { gradeImages },
      { mode: 'single-legacy', hardLimit: 1, stableSuccessWindow: 2 },
    )

    await user.click(screen.getByRole('button', { name: '开始批改全部待处理作文' }))
    expect(await screen.findByText('结果确认中')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重试批改' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '检查结果' }))

    await waitFor(() => expect(requests.filter((request) => request.essayId === unknownEssayId)).toHaveLength(2))
    const ids = requests.filter((request) => request.essayId === unknownEssayId).map((request) => request.requestId)
    expect(ids[1]).toBe(ids[0])
  })

  it('does not offer retry or result-check actions for a final failure', async () => {
    const user = userEvent.setup()
    let firstEssayId = ''
    const gradeImages = vi.fn(async (request: MultimodalGradingRequestV2) => {
      firstEssayId ||= request.essayId
      return request.essayId === firstEssayId
        ? {
            requestId: request.requestId,
            status: 'failed' as const,
            error: { code: 'provider_content_filtered' as const, message: '该作文无法自动处理。', retryable: false },
          }
        : successfulResult(request)
    })
    renderProgressFlow(
      'task-2',
      { gradeImages },
      { mode: 'single-legacy', hardLimit: 1, stableSuccessWindow: 2 },
    )

    await user.click(screen.getByRole('button', { name: '开始批改全部待处理作文' }))

    expect(await screen.findByText('不可重试失败')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重试批改' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '检查结果' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '转人工处理' })).toBeEnabled()
  })

  it('shows rate-limit waiting without exposing a teacher retry action', async () => {
    const user = userEvent.setup()
    const gradeImages = vi.fn(async (request: MultimodalGradingRequestV2) => ({
      requestId: request.requestId,
      status: 'failed' as const,
      error: { code: 'provider_rate_limited' as const, message: '请求较多，请稍候。', retryable: true },
      clientMeta: { retryAfterMs: 60_000 },
    }))
    renderProgressFlow(
      'task-2',
      { gradeImages },
      { mode: 'single-legacy', hardLimit: 1, stableSuccessWindow: 2 },
    )

    await user.click(screen.getByRole('button', { name: '开始批改全部待处理作文' }))

    expect(await screen.findByText('因限流等待')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重试批改' })).not.toBeInTheDocument()
  })

  it.each([
    ['auth', 'provider_auth_failed', false, undefined, '身份验证失败'],
    ['balance', 'provider_balance_unavailable', false, undefined, '账户额度不可用'],
    ['configuration', 'provider_not_configured', false, undefined, '批改服务配置不可用'],
    ['long retry', 'provider_rate_limited', true, 900_001, '服务要求较长等待'],
  ] as const)(
    'shows and explicitly clears the %s task pause banner',
    async (_label, code, retryable, retryAfterMs, expectedCopy) => {
      const user = userEvent.setup()
      let callCount = 0
      const gradeImages = vi.fn(async (request: MultimodalGradingRequestV2): Promise<GradingClientResponse> => {
        callCount += 1
        if (callCount > 1) return successfulResult(request)
        return {
          requestId: request.requestId,
          status: 'failed',
          error: { code, message: expectedCopy, retryable },
          ...(retryAfterMs === undefined ? {} : { clientMeta: { retryAfterMs } }),
        }
      })
      renderProgressFlow(
        'task-2',
        { gradeImages },
        { mode: 'single-legacy', hardLimit: 1, stableSuccessWindow: 2 },
      )

      await user.click(screen.getByRole('button', { name: '开始批改全部待处理作文' }))
      const banner = await screen.findByTestId('task-pause-banner')
      expect(banner).toHaveTextContent(expectedCopy)
      await user.click(within(banner).getByRole('button', { name: '恢复批改' }))
      await waitFor(() => expect(screen.queryByTestId('task-pause-banner')).not.toBeInTheDocument())
    },
  )

  it('does not hide the current task action while another task occupies the shared slot', async () => {
    const user = userEvent.setup()
    const gradeImages = vi.fn((_request: MultimodalGradingRequestV2) => new Promise<GradingClientResponse>(() => undefined))
    renderCrossTaskProgress({ gradeImages })
    await user.click(screen.getByRole('button', { name: '添加当前任务待批改作文' }))
    expect(screen.getByRole('button', { name: '开始批改全部待处理作文' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '启动另一任务批改' }))
    expect(gradeImages).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '开始批改全部待处理作文' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '开始批改全部待处理作文' }))
    expect(await screen.findByText('排队中')).toBeInTheDocument()
  })

  it('keeps valid AI results in the teacher-handling tab instead of treating them as completed', async () => {
    const user = userEvent.setup()
    const gradeImages = vi.fn(async (request: MultimodalGradingRequestV2) => successfulResult(request))
    renderProgressFlow(
      'task-2',
      { gradeImages },
      { mode: 'single-legacy', hardLimit: 1, stableSuccessWindow: 2 },
    )
    await user.click(screen.getByRole('button', { name: '开始批改全部待处理作文' }))
    await screen.findAllByText('待教师确认')

    await user.click(screen.getByRole('tab', { name: /待教师处理/ }))
    expect(screen.getAllByRole('link', { name: '查看并确认' }).length).toBeGreaterThan(0)
  })
})
