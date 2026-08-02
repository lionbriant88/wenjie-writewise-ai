import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import type { RubricClientResponse } from '../services/taskRubric/rubricClient'
import { CreateTaskPage } from './CreateTaskPage'

const generate = vi.fn<(request: unknown) => Promise<RubricClientResponse>>()

vi.mock('../services/taskRubric/rubricClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/taskRubric/rubricClient')>()
  return { ...actual, createConfiguredRubricClient: () => ({ generate }) }
})

const generatedRubric = {
  taskName: '环保主题写作',
  materialSummary: '材料要求学生说明日常环保行动。',
  writingRequirements: ['围绕材料完成写作'],
  constraints: ['使用英语表达'],
  dimensions: [
    { id: 'content', name: '内容', weight: 60, description: '回应材料要求。', deductionFocus: [], sourceEvidence: [] },
    { id: 'language', name: '语言', weight: 40, description: '语言准确连贯。', deductionFocus: [], sourceEvidence: [] },
  ],
  reviewWarnings: [],
}

function LocationProbe() {
  return <output aria-label="current location">{useLocation().pathname}</output>
}

function renderCreateTaskPage() {
  render(
    <AppStateProvider>
      <MemoryRouter initialEntries={['/tasks/new']}>
        <Routes>
          <Route path="/tasks/new" element={<CreateTaskPage />} />
          <Route path="/tasks/:taskId/upload" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}

function material(name = 'material.png', type = 'image/png') {
  return new File(['source material'], name, { type })
}

async function uploadMaterial(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText('材料图片'), material())
}

async function generateDraft(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '生成评分标准' }))
  await screen.findByText('环保主题写作')
}

afterEach(() => {
  generate.mockReset()
})

describe('CreateTaskPage', () => {
  it('only presents material images, full score, and rubric generation without the removed creation fields', () => {
    renderCreateTaskPage()

    expect(screen.getByLabelText('材料图片')).toBeInTheDocument()
    expect(screen.getByLabelText('满分')).toHaveValue(15)
    expect(screen.getByRole('button', { name: '生成评分标准' })).toBeInTheDocument()
    expect(screen.queryByText('应用文')).not.toBeInTheDocument()
    expect(screen.queryByText('读后续写')).not.toBeInTheDocument()
    expect(screen.queryByText('具体题型')).not.toBeInTheDocument()
    expect(screen.queryByText('评分模板')).not.toBeInTheDocument()
    expect(screen.queryByText('班级')).not.toBeInTheDocument()
    expect(screen.queryByText('班级讲评')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('创建任务步骤')).not.toBeInTheDocument()
  })

  it('keeps material and full-score input after a safe rubric Gateway failure so the teacher can retry', async () => {
    const user = userEvent.setup()
    generate.mockResolvedValueOnce({
      requestId: 'rubric-failure', status: 'failed',
      error: { code: 'provider_timeout', message: '安全提示', retryable: true },
    } as RubricClientResponse)
    renderCreateTaskPage()

    await uploadMaterial(user)
    await user.clear(screen.getByLabelText('满分'))
    await user.type(screen.getByLabelText('满分'), '20')
    await user.click(screen.getByRole('button', { name: '生成评分标准' }))

    expect(await screen.findByText('评分标准暂时无法生成，请保留材料后重试。')).toBeInTheDocument()
    expect(screen.getByLabelText('满分')).toHaveValue(20)
    expect(screen.getByText('material.png')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新生成评分标准' })).toBeInTheDocument()
  })

  it('renders an editable generated rubric, resets confirmation on edits, and blocks non-100 weights', async () => {
    const user = userEvent.setup()
    generate.mockResolvedValue({ requestId: 'rubric-1', status: 'success', rubric: generatedRubric })
    renderCreateTaskPage()

    await uploadMaterial(user)
    await generateDraft(user)
    await user.click(screen.getByRole('button', { name: '确认采用该标准' }))
    expect(screen.getByRole('button', { name: '确认并创建任务' })).toBeEnabled()

    await user.clear(screen.getByLabelText('内容权重'))
    await user.type(screen.getByLabelText('内容权重'), '50')
    expect(screen.getByText('评分维度权重合计必须为 100%。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认并创建任务' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认采用该标准' })).toBeDisabled()
  })

  it('creates a genre-free task and navigates only after the teacher explicitly confirms the rubric', async () => {
    const user = userEvent.setup()
    generate.mockResolvedValue({ requestId: 'rubric-1', status: 'success', rubric: generatedRubric })
    renderCreateTaskPage()

    await uploadMaterial(user)
    await generateDraft(user)
    expect(screen.getByRole('button', { name: '确认并创建任务' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '确认采用该标准' }))
    await user.click(screen.getByRole('button', { name: '确认并创建任务' }))

    await waitFor(() => expect(screen.getByLabelText('current location').textContent).toMatch(/^\/tasks\/task-\d+\/upload$/))
  })
})
