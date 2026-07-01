import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import { EssayResultPage } from './EssayResultPage'
import { ExceptionsPage } from './ExceptionsPage'

function renderWithRoute(route: string, element: React.ReactElement) {
  render(
    <AppStateProvider>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/tasks/:taskId/essays/:essayId" element={element} />
          <Route path="/tasks/:taskId/exceptions" element={element} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}

describe('detail flow back navigation', () => {
  it('links essay result pages back to the task progress page and keeps progress current', () => {
    renderWithRoute('/tasks/task-1/essays/task-1-essay-1', <EssayResultPage />)

    const topActions = screen.getByRole('region', { name: '顶部批改操作' })
    expect(within(topActions).getByRole('link', { name: '返回批改进度' })).toHaveAttribute(
      'href',
      '/tasks/task-1/progress',
    )

    expect(screen.queryByRole('navigation', { name: '任务流程导航' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开导航' })).toBeInTheDocument()
  })

  it('can expand the focused detail sidebar without hiding review controls', async () => {
    const user = userEvent.setup()
    renderWithRoute('/tasks/task-1/essays/task-1-essay-1', <EssayResultPage />)

    await user.click(screen.getByRole('button', { name: '展开导航' }))

    const workflowNav = screen.getByRole('navigation', { name: '任务流程导航' })
    expect(within(workflowNav).getByRole('link', { name: /批改进度/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '折叠导航' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '顶部批改操作' })).toBeInTheDocument()
  })

  it('shows top review controls with score, confidence, and previous or next essay links', () => {
    renderWithRoute('/tasks/task-1/essays/task-1-essay-1', <EssayResultPage />)

    const topActions = screen.getByRole('region', { name: '顶部批改操作' })
    expect(screen.getAllByText('作文 1 批改结果').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('13 / 15')).toBeInTheDocument()
    expect(
      within(topActions).getAllByText((_, element) => element?.textContent?.includes('AI 置信度 86%') ?? false).length,
    ).toBeGreaterThanOrEqual(1)
    expect(within(topActions).getByRole('button', { name: '上一篇' })).toBeDisabled()
    expect(within(topActions).getByRole('link', { name: '下一篇' })).toHaveAttribute(
      'href',
      '/tasks/task-1/essays/task-1-essay-2',
    )
  })

  it('links the previous essay from the top review controls when available', () => {
    renderWithRoute('/tasks/task-1/essays/task-1-essay-2', <EssayResultPage />)

    const topActions = screen.getByRole('region', { name: '顶部批改操作' })
    expect(within(topActions).getByRole('link', { name: '上一篇' })).toHaveAttribute(
      'href',
      '/tasks/task-1/essays/task-1-essay-1',
    )
  })

  it('shows bottom review actions for returning or switching essays', () => {
    renderWithRoute('/tasks/task-1/essays/task-1-essay-1', <EssayResultPage />)

    const bottomActions = screen.getByRole('region', { name: '底部批改操作' })
    expect(within(bottomActions).getByRole('link', { name: '返回批改进度' })).toHaveAttribute(
      'href',
      '/tasks/task-1/progress',
    )
    expect(within(bottomActions).getByRole('button', { name: '上一篇' })).toBeDisabled()
    expect(within(bottomActions).getByRole('link', { name: '下一篇' })).toHaveAttribute(
      'href',
      '/tasks/task-1/essays/task-1-essay-2',
    )
  })

  it('prioritizes the student essay source and opens original images on demand', async () => {
    const user = userEvent.setup()
    renderWithRoute('/tasks/task-1/essays/task-1-essay-1', <EssayResultPage />)

    expect(screen.getByRole('heading', { name: '学生作文原文' })).toBeInTheDocument()
    expect(screen.getByText('OCR 置信度 89%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看原图' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '原图预览' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '查看原图' }))

    expect(screen.getByRole('dialog', { name: '原图预览' })).toBeInTheDocument()
  })

  it('combines error annotations and sentence revisions into one issue correction module', async () => {
    const user = userEvent.setup()
    renderWithRoute('/tasks/task-1/essays/task-1-essay-1', <EssayResultPage />)

    expect(screen.getByRole('heading', { name: '问题与修改建议' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '错误标注' })).not.toBeInTheDocument()
    expect(screen.queryByText('教师可检查 AI 评分、错误标注和修改建议，并进行模拟调整。')).not.toBeInTheDocument()
    expect(screen.queryByText('与错误标注中的 suggest 句型一致，修正为动词原形。')).not.toBeInTheDocument()
    expect(screen.queryByText('错句修改')).not.toBeInTheDocument()
    expect(screen.getByText('I suggest you joins the club.')).toBeInTheDocument()
    expect(screen.getByText('I suggest you join the club.')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: '加入班级总览' })[0])

    expect(screen.getByRole('button', { name: '已加入班级总览' })).toBeInTheDocument()
  })

  it('integrates expression upgrades into full text revision with optional class overview feedback', async () => {
    const user = userEvent.setup()
    renderWithRoute('/tasks/task-1/essays/task-1-essay-1', <EssayResultPage />)

    expect(screen.getByRole('heading', { name: '全文优化稿' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '本文重点提升点' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '表达升级建议' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '修改建议与升级表达' })).not.toBeInTheDocument()

    const upgradeSection = screen.getByRole('region', { name: '本文重点提升点' })
    expect(within(upgradeSection).getByText('I think')).toBeInTheDocument()
    expect(within(upgradeSection).getByText('From my point of view')).toBeInTheDocument()

    await user.click(within(upgradeSection).getAllByRole('button', { name: '加入班级总览' })[0])

    expect(within(upgradeSection).getByRole('button', { name: '已加入班级总览' })).toBeInTheDocument()
  })

  it('links exception review pages back to the task progress page and keeps progress current', () => {
    renderWithRoute('/tasks/task-1/exceptions', <ExceptionsPage />)

    expect(screen.getByRole('link', { name: '返回' })).toHaveAttribute(
      'href',
      '/tasks/task-1/progress',
    )

    const workflowNav = screen.getByRole('navigation', { name: '任务流程导航' })
    expect(within(workflowNav).getByRole('link', { name: /批改进度/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})
