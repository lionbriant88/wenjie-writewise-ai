import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import { createFakeClassReviewSynthesisClient, type ClassReviewSynthesisClient } from '../services/classReview/fakeClassReviewSynthesisClient'
import type { ClassReviewSynthesisRequestV1, ClassReviewSynthesisResultV1 } from '../services/classReview/types'
import { EssayResultPage } from './EssayResultPage'
import { ClassReviewPage } from './ClassReviewPage'

function renderClassReviewPage({
  initialPath = '/tasks/task-3/class-review',
  client = createFakeClassReviewSynthesisClient({ scenario: 'success' }),
}: {
  initialPath?: string
  client?: ClassReviewSynthesisClient
} = {}) {
  render(
    <AppStateProvider classReviewSynthesisClient={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/tasks/:taskId/class-review" element={<ClassReviewPage />} />
          <Route path="/tasks/:taskId/essays/:essayId" element={<EssayResultPage />} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

async function generateAndShowReport(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '生成班级总结' }))
  await screen.findByText('Class summary')
}

describe('ClassReviewPage workspace', () => {
  it('renders one vertical class-review workspace without legacy tabs or mock insight copy', () => {
    renderClassReviewPage()

    expect(screen.getByRole('heading', { name: '班级总览' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: '班级总览内容' })).not.toBeInTheDocument()
    expect(screen.queryByText(/仍为现有 mock 洞察/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '当前统计' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'AI 班级总体评价' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '共性问题与讲评建议' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '明确拼写错误' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '教师精选讲评素材' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '生成班级总结' })).toBeInTheDocument()
  })

  it('generates exactly one applied report, then requires an explicit-cost regenerate action', async () => {
    const user = userEvent.setup()
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'success' })
    renderClassReviewPage({ client: fake })

    await user.click(screen.getByRole('button', { name: '生成班级总结' }))
    await waitFor(() => expect(fake.getCallCountForTest()).toBe(1))

    expect(await screen.findByText('Class summary')).toBeInTheDocument()
    expect(screen.getByText('Common issue')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '应用新班级总结' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '丢弃新版本' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '生成班级总结' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新生成' })).toBeInTheDocument()
    expect(screen.getByText('重新生成会消耗 1 次新的 AI 调用。')).toBeInTheDocument()
  })

  it('shows active-run and result-unknown precedence without duplicate generation buttons', async () => {
    const user = userEvent.setup()
    const release = deferred<void>()
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'success' })
    const synthesize = vi.fn(async (request: ClassReviewSynthesisRequestV1): Promise<ClassReviewSynthesisResultV1> => {
      await release.promise
      return fake.synthesize(request)
    })
    renderClassReviewPage({ client: { synthesize } })

    await user.click(screen.getByRole('button', { name: '生成班级总结' }))
    expect(await screen.findByText('正在生成班级总结')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '生成班级总结' })).not.toBeInTheDocument()

    release.resolve()
    expect(await screen.findByText('Class summary')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '应用新班级总结' })).not.toBeInTheDocument()

    cleanup()
    const unknown = createFakeClassReviewSynthesisClient({ scenario: 'result_unknown' })
    renderClassReviewPage({ client: unknown })
    await user.click(screen.getByRole('button', { name: '生成班级总结' }))
    expect(await screen.findByRole('button', { name: '检查结果' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '生成班级总结' })).not.toBeInTheDocument()
  })

  it('locks AI-summary editing during generation and uses a focused regenerate confirmation dialog', async () => {
    const user = userEvent.setup()
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'success' })
    renderClassReviewPage({ client: fake })
    await generateAndShowReport(user)

    await user.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByLabelText('班级总体评价'), { target: { value: 'Teacher edited summary.' } })

    expect(screen.getByRole('button', { name: '重新生成' })).toBeDisabled()
    expect(screen.getByText('请先保存或取消正在编辑的 AI 总评。')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '保存' }))
    const regenerate = screen.getByRole('button', { name: '重新生成' })
    regenerate.focus()
    await user.click(regenerate)

    expect(screen.getByRole('dialog', { name: '确认重新生成班级总结' })).toBeInTheDocument()
    expect(screen.getByText('这会消耗 1 次新的 AI 调用，并用新 AI 总评替换当前 AI 文本。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认重新生成' })).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '确认重新生成班级总结' })).not.toBeInTheDocument()
    expect(regenerate).toHaveFocus()
  })

  it('promotes definite spelling into the issue list without an AI call and supports remove/undo', async () => {
    const user = userEvent.setup()
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'success' })
    renderClassReviewPage({ client: fake })

    const spellingSection = screen.getByRole('region', { name: '明确拼写错误' })
    await user.click(within(spellingSection).getAllByRole('button', { name: '加入共性问题' })[0])

    expect(fake.getCallCountForTest()).toBe(0)
    const issueSection = screen.getByRole('region', { name: '共性问题与讲评建议' })
    expect(within(issueSection).getByRole('heading', { name: /^拼写错误：enviroment → environment$/ })).toBeInTheDocument()
    await user.click(within(issueSection).getByRole('button', { name: '移出手动添加' }))
    expect(screen.getByRole('button', { name: '撤销移出' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: '撤销移出' }))
    expect(within(issueSection).getByRole('button', { name: '移出手动添加' })).toBeInTheDocument()
  })
})
