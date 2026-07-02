import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import { EssayResultPage } from './EssayResultPage'
import { ClassReviewPage } from './ClassReviewPage'

function renderClassReviewPage(initialPath = '/tasks/task-1/class-review') {
  render(
    <AppStateProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/tasks/:taskId/class-review" element={<ClassReviewPage />} />
          <Route path="/tasks/:taskId/essays/:essayId" element={<EssayResultPage />} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}

describe('ClassReviewPage', () => {
  it('shows overview by default and switches between class review tabs', async () => {
    const user = userEvent.setup()
    renderClassReviewPage()

    expect(screen.getByRole('heading', { name: '班级总览' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '概览' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '教师精选素材' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('heading', { name: '分数分布' })).toBeInTheDocument()
    expect(screen.getByText('作文总数')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('平均分')).toBeInTheDocument()
    expect(screen.getByText('最高分')).toBeInTheDocument()
    expect(screen.getByText('最低分')).toBeInTheDocument()
    expect(screen.getByText('1-3')).toBeInTheDocument()
    expect(screen.getByText('4-6')).toBeInTheDocument()
    expect(screen.getByText('7-9')).toBeInTheDocument()
    expect(screen.getByText('10-12')).toBeInTheDocument()
    expect(screen.getByText('13-15')).toBeInTheDocument()
    expect(screen.getByLabelText('13-15 分数分布：7 篇')).toHaveStyle({ height: '10px' })
    expect(screen.queryByText('课堂讲评模式')).not.toBeInTheDocument()
    expect(screen.queryByText('先看全班分数结构，再看高频问题和课堂讲评素材。')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '教师精选讲评素材' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '教师精选素材' }))
    expect(screen.getByRole('tab', { name: '教师精选素材' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: '教师精选讲评素材' })).toBeInTheDocument()
    expect(screen.getByText('还没有教师精选讲评素材。')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /表达提升/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '高频问题' }))
    expect(screen.getByRole('heading', { name: '高频语法错误' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '高频拼写错误' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '典型问题句' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '改写练习' }))
    expect(screen.getByRole('heading', { name: '可上课改写练习' })).toBeInTheDocument()
  })

  it('filters, removes, and links teacher selected materials back to their source essay', async () => {
    const user = userEvent.setup()
    renderClassReviewPage('/tasks/task-1/essays/task-1-essay-1')

    await user.click(screen.getByRole('tab', { name: '问题批改' }))
    await user.click(screen.getAllByRole('button', { name: '加入班级总览' })[0])
    const logicIssueCard = screen.getByRole('button', { name: /My mother was angry\./ })
    await user.click(within(logicIssueCard).getByRole('button', { name: '加入班级总览' }))
    await user.click(screen.getAllByRole('link', { name: '班级总览' })[0])
    await user.click(screen.getByRole('tab', { name: '教师精选素材' }))
    const materialsPanel = screen.getByRole('heading', { name: '教师精选讲评素材' }).closest('section')
    expect(materialsPanel).not.toBeNull()
    const materials = within(materialsPanel as HTMLElement)

    expect(materials.getByText('共 2 条素材')).toBeInTheDocument()
    expect(materials.getByRole('tab', { name: /全部 2/ })).toBeInTheDocument()
    expect(materials.getByRole('tab', { name: /典型错误 1/ })).toBeInTheDocument()
    expect(materials.getByRole('tab', { name: /逻辑问题 1/ })).toBeInTheDocument()
    expect(materials.queryByRole('tab', { name: /表达提升/ })).not.toBeInTheDocument()

    await user.click(materials.getByRole('tab', { name: /逻辑问题/ }))
    expect(materials.getByText('My mother was angry.')).toBeInTheDocument()
    expect(materials.getAllByText(/上下文关联度差/).length).toBeGreaterThan(0)
    expect(materials.getAllByText(/建议学生补充说明/).length).toBeGreaterThan(0)
    expect(materials.getByText('建议教师复核')).toBeInTheDocument()
    expect(materials.getByText('来源：作文 1')).toBeInTheDocument()
    expect(materials.queryByText('I suggest you joins the club.')).not.toBeInTheDocument()

    await user.click(materials.getByRole('tab', { name: /全部/ }))
    const removeButtons = materials.getAllByRole('button', { name: '移除' })
    await user.click(removeButtons[1])

    expect(materials.getByText('共 1 条素材')).toBeInTheDocument()
    expect(materials.queryByText('I suggest you joins the club.')).not.toBeInTheDocument()

    await user.click(materials.getByRole('link', { name: '查看来源' }))
    expect(screen.getByRole('heading', { name: /批改结果/ })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '问题批改' }))
    expect(screen.getAllByRole('button', { name: '加入班级总览' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '已加入班级总览' })).toBeInTheDocument()
  })
})
