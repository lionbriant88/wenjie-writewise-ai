import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useRef } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import { useAppState } from '../context/useAppState'
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

function NoInsightTaskSetup() {
  const { createTask, addClassReviewMaterial } = useAppState()
  const initialized = useRef(false)
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    const taskId = createTask({ taskName: '真实验收任务', fullScore: 15, className: '真实验收班', generateClassReview: true })
    addClassReviewMaterial({ taskId, essayId: 'essay-real', essayLabel: '作文 3', type: 'logic_issue', categoryLabel: '因果关系缺失', original: 'First, you can organize your studies.', diagnosis: '理由交代不足。' })
  }, [addClassReviewMaterial, createTask])
  return null
}

function MaterialsTaskSetup() {
  const { addClassReviewMaterial } = useAppState()
  const initialized = useRef(false)
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    addClassReviewMaterial({
      taskId: 'task-1',
      essayId: 'task-1-essay-1',
      essayLabel: '作文 1',
      type: 'typical_error',
      categoryLabel: 'grammar',
      original: 'I suggest you joins the club.',
      revised: 'I suggest you join the club.',
      explanation: 'suggest 后使用动词原形。',
      severity: 'high',
      sourceIssueId: 'issue-language-1',
    })
    addClassReviewMaterial({
      taskId: 'task-1',
      essayId: 'task-1-essay-1',
      essayLabel: '作文 1',
      type: 'logic_issue',
      categoryLabel: '上下文关联度差',
      original: 'My mother was angry.',
      diagnosis: '该句与上下文关联度差。',
      teachingSuggestion: '建议学生补充说明：建议学生补充这句话与阅读节的关系。',
      severity: 'high',
      needsTeacherReview: true,
      sourceIssueId: 'issue-logic-1',
    })
  }, [addClassReviewMaterial])
  return null
}

function renderClassReviewPageWithoutInsight() {
  render(
    <AppStateProvider>
      <NoInsightTaskSetup />
      <MemoryRouter initialEntries={['/tasks/task-1234567890/class-review']}>
        <Routes>
          <Route path="/tasks/:taskId/class-review" element={<ClassReviewPage />} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}

function renderClassReviewPageWithMaterials(initialPath = '/tasks/task-1/class-review') {
  render(
    <AppStateProvider>
      <MaterialsTaskSetup />
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
  it('shows real task statistics and selected materials without requiring mock class insights', async () => {
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(1234567890)
    const user = userEvent.setup()
    renderClassReviewPageWithoutInsight()

    expect(await screen.findByRole('tab', { name: '概览' })).toBeInTheDocument()
    expect(screen.queryByText('暂无班级总览材料')).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '教师精选素材' }))
    expect(screen.getByText('First, you can organize your studies.')).toBeInTheDocument()
    expect(screen.getByText('理由交代不足。')).toBeInTheDocument()
    dateNow.mockRestore()
  })

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
    expect(screen.getByText('0-3')).toBeInTheDocument()
    expect(screen.getByText('4-6')).toBeInTheDocument()
    expect(screen.getByText('7-9')).toBeInTheDocument()
    expect(screen.getByText('10-12')).toBeInTheDocument()
    expect(screen.getByText('13-15')).toBeInTheDocument()
    expect(screen.getByLabelText('13-15 分数分布：7 篇')).toHaveStyle({ height: '10px' })
    expect(screen.getByText(/分数统计仅包含教师已确认结果/)).toBeInTheDocument()
    expect(screen.getByText(/仍为现有 mock 洞察/)).toBeInTheDocument()
    expect(screen.queryByText('课堂讲评模式')).not.toBeInTheDocument()
    expect(screen.queryByText('先看全班分数结构，再看高频问题和课堂讲评素材。')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '教师精选讲评素材' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '教师精选素材' }))
    expect(screen.getByRole('tab', { name: '教师精选素材' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: '教师精选讲评素材' })).toBeInTheDocument()
    expect(screen.getByText('还没有教师精选讲评素材。')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /表达提升/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '高频问题' }))
    expect(screen.getByText('当前暂无高频问题。')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '改写练习' }))
    expect(screen.getByText('当前暂无可上课改写练习。')).toBeInTheDocument()
  })

  it('filters, removes, and links teacher selected materials back to their source essay', async () => {
    const user = userEvent.setup()
    renderClassReviewPageWithMaterials()

    await user.click(screen.getByRole('tab', { name: '教师精选素材' }))
    const materialsPanel = screen.getByRole('heading', { name: '教师精选讲评素材' }).closest('section')
    expect(materialsPanel).not.toBeNull()
    const materials = within(materialsPanel as HTMLElement)

    expect(await materials.findByText('共 2 条素材')).toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: '已加入班级总览' })).not.toBeInTheDocument()
  })
})
