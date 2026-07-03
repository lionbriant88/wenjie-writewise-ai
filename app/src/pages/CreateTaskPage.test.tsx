import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import { UploadPage } from './UploadPage'
import { CreateTaskPage } from './CreateTaskPage'

function renderCreateTaskPage() {
  render(
    <AppStateProvider>
      <MemoryRouter initialEntries={['/tasks/new']}>
        <Routes>
          <Route path="/tasks/new" element={<CreateTaskPage />} />
          <Route path="/tasks/:taskId/upload" element={<UploadPage />} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}

describe('CreateTaskPage', () => {
  it('shows the three-step creation flow with practical writing as the default genre', () => {
    renderCreateTaskPage()

    expect(screen.getByRole('button', { name: '基础信息' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '题目信息' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '评分标准确认' })).toBeInTheDocument()

    expect(screen.getByRole('radio', { name: '应用文' })).toBeChecked()
    expect(screen.getByLabelText('具体题型')).toHaveValue('建议信')
    expect(screen.getByText('本任务评分标准预览')).toBeInTheDocument()
    expect(screen.getByText('内容完成度')).toBeInTheDocument()
    expect(screen.getByText('意图表达清晰度')).toBeInTheDocument()
  })

  it('requires the practical writing prompt before generating a rubric, while teacher requirements stay optional', async () => {
    const user = userEvent.setup()
    renderCreateTaskPage()

    await user.click(screen.getByRole('button', { name: '下一步：题目信息' }))
    expect(screen.getAllByText('题目信息').length).toBeGreaterThan(0)
    expect(screen.getByText('必填')).toBeInTheDocument()
    expect(screen.getAllByText('教师补充要求').length).toBeGreaterThan(0)
    expect(screen.getByText('选填')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '评分标准确认' }))
    await user.click(screen.getByRole('button', { name: '生成评分标准' }))

    expect(screen.getByText('请填写题目要求 / 写作任务。')).toBeInTheDocument()
    expect(screen.queryByText('待教师确认')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '返回题目信息' }))
    await user.type(screen.getByLabelText('题目要求 / 写作任务'), 'Write an email to give advice on joining an English club.')
    await user.click(screen.getByRole('button', { name: '下一步：评分标准确认' }))
    await user.click(screen.getByRole('button', { name: '生成评分标准' }))

    expect(screen.getByText('待教师确认')).toBeInTheDocument()
    const rubricPanel = screen.getByRole('region', { name: 'AI mock 评分标准' })
    expect(within(rubricPanel).getByText('本题写作目标')).toBeInTheDocument()
    expect(within(rubricPanel).getByText('内容完成度')).toBeInTheDocument()
    expect(within(rubricPanel).getByText('语言准确性')).toBeInTheDocument()
    expect(screen.queryByText('已参考教师补充要求')).not.toBeInTheDocument()
  })

  it('requires continuation source text and both paragraph openings before generating a continuation rubric', async () => {
    const user = userEvent.setup()
    renderCreateTaskPage()

    await user.click(screen.getByRole('radio', { name: '读后续写' }))
    expect(screen.getByLabelText('具体题型')).toHaveValue('故事续写')

    await user.click(screen.getByRole('button', { name: '下一步：题目信息' }))
    expect(screen.getByLabelText('读后续写原文')).toBeInTheDocument()
    expect(screen.getByLabelText('Paragraph 1 开头句')).toBeInTheDocument()
    expect(screen.getByLabelText('Paragraph 2 开头句')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '评分标准确认' }))
    await user.click(screen.getByRole('button', { name: '生成评分标准' }))
    expect(screen.getByText('请填写原文材料和两段开头句。')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '返回题目信息' }))
    await user.type(screen.getByLabelText('读后续写原文'), 'Tom lost his way on a rainy evening.')
    await user.type(screen.getByLabelText('Paragraph 1 开头句'), 'Suddenly, he saw a warm light ahead.')
    await user.type(screen.getByLabelText('Paragraph 2 开头句'), 'When he opened the door, he could not believe his eyes.')
    await user.click(screen.getByRole('button', { name: '下一步：评分标准确认' }))
    await user.click(screen.getByRole('button', { name: '生成评分标准' }))

    expect(screen.getByText('待教师确认')).toBeInTheDocument()
    expect(screen.getByText('本题续写目标')).toBeInTheDocument()
    expect(screen.getAllByText('情节衔接与合理性').length).toBeGreaterThan(0)
    expect(screen.getAllByText('人物情感与主题升华').length).toBeGreaterThan(0)
  })

  it('requires rubric confirmation before entering upload and keeps the existing practical writing path working', async () => {
    const user = userEvent.setup()
    renderCreateTaskPage()

    await user.click(screen.getByRole('button', { name: '下一步：题目信息' }))
    await user.type(screen.getByLabelText('题目要求 / 写作任务'), 'Write a suggestion letter about English reading.')
    await user.type(screen.getByLabelText('教师补充要求'), 'Focus on clear advice.')
    await user.click(screen.getByRole('button', { name: '评分标准确认' }))

    expect(screen.getByRole('button', { name: '确认标准并进入上传' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '生成评分标准' }))
    expect(screen.getByText('已参考教师补充要求')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认采用该标准' }))
    expect(screen.getByText('已确认')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '确认标准并进入上传' }))
    expect(screen.getByRole('heading', { name: '上传作文与图片整理' })).toBeInTheDocument()
  })

  it('resets the generated rubric when switching writing genre', async () => {
    const user = userEvent.setup()
    renderCreateTaskPage()

    await user.click(screen.getByRole('button', { name: '下一步：题目信息' }))
    await user.type(screen.getByLabelText('题目要求 / 写作任务'), 'Write a notice about a school activity.')
    await user.click(screen.getByRole('button', { name: '下一步：评分标准确认' }))
    await user.click(screen.getByRole('button', { name: '生成评分标准' }))
    expect(screen.getByText('待教师确认')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '返回基础信息' }))
    await user.click(screen.getByRole('radio', { name: '读后续写' }))

    expect(screen.getByText('写作大类已切换，请重新生成本任务评分标准。')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '评分标准确认' }))
    const rubricPanel = screen.getByRole('region', { name: 'AI mock 评分标准' })
    expect(within(rubricPanel).getByText('待生成')).toBeInTheDocument()
  })
})
