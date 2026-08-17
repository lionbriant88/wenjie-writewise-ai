import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RubricClientResponse } from '../services/taskRubric/rubricClient'
import { CreateTaskPage } from './CreateTaskPage'

const generate = vi.fn<(request: unknown) => Promise<RubricClientResponse>>()
const createTask = vi.fn(() => 'created-task')

vi.mock('../context/useAppState', () => ({ useAppState: () => ({ createTask }) }))

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
    { id: 'content', name: '内容', weight: 60, description: '回应材料要求。', deductionFocus: [], sourceEvidence: ['材料中的环保行动要求'] },
    { id: 'language', name: '语言', weight: 40, description: '语言准确连贯。', deductionFocus: [], sourceEvidence: ['材料要求使用准确英语'] },
  ],
  reviewWarnings: [],
}

function LocationProbe() {
  return <output aria-label="current location">{useLocation().pathname}</output>
}

function renderCreateTaskPage() {
  render(
    <MemoryRouter initialEntries={['/tasks/new']}>
      <Routes>
        <Route path="/tasks/new" element={<CreateTaskPage />} />
        <Route path="/tasks/:taskId/upload" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
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
  createTask.mockClear()
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

  it('renders an editable generated rubric and requires a new confirmation after a legal rubric edit', async () => {
    const user = userEvent.setup()
    generate.mockResolvedValue({ requestId: 'rubric-1', status: 'success', rubric: generatedRubric })
    renderCreateTaskPage()

    await uploadMaterial(user)
    await generateDraft(user)
    await user.click(screen.getByRole('button', { name: '确认采用该标准' }))
    expect(screen.getByRole('button', { name: '确认并创建任务' })).toBeEnabled()

    await user.clear(screen.getByLabelText('内容权重'))
    await user.type(screen.getByLabelText('内容权重'), '55')
    await user.clear(screen.getByLabelText('语言权重'))
    await user.type(screen.getByLabelText('语言权重'), '45')
    expect(screen.queryByText('评分维度权重合计必须为 100%。')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认并创建任务' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认采用该标准' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '确认采用该标准' }))
    expect(screen.getByRole('button', { name: '确认并创建任务' })).toBeEnabled()
  })

  it('allows decimal teacher edits to a generated legibility weight before saving the confirmed rubric', async () => {
    const user = userEvent.setup()
    generate.mockResolvedValue({
      requestId: 'rubric-decimals', status: 'success', rubric: {
        ...generatedRubric,
        dimensions: [
          { ...generatedRubric.dimensions[0], weight: 95 },
          { ...generatedRubric.dimensions[1], id: 'legibility', name: '卷面与可读性', weight: 5 },
        ],
      },
    })
    renderCreateTaskPage()

    await uploadMaterial(user)
    await generateDraft(user)
    expect(screen.getByLabelText('内容权重')).toHaveAttribute('step', 'any')
    fireEvent.change(screen.getByLabelText('内容权重'), { target: { value: '94.5' } })
    fireEvent.change(screen.getByLabelText('卷面与可读性权重'), { target: { value: '5.5' } })
    await user.click(screen.getByRole('button', { name: '确认采用该标准' }))
    await user.click(screen.getByRole('button', { name: '确认并创建任务' }))

    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      rubricDraft: expect.objectContaining({ dimensions: [expect.objectContaining({ weight: 94.5 }), expect.objectContaining({ id: 'legibility', weight: 5.5 })] }),
    }))
  })

  it('preserves source evidence in the genre-free task input and sends ordered original files to the rubric client', async () => {
    const user = userEvent.setup()
    generate.mockResolvedValue({ requestId: 'rubric-1', status: 'success', rubric: generatedRubric })
    renderCreateTaskPage()
    const first = material('first.jpg', 'image/jpeg')
    const second = material('second.webp', 'image/webp')

    await user.upload(screen.getByLabelText('材料图片'), [first, second])
    await user.click(screen.getByRole('button', { name: '下移 first.jpg' }))
    await user.clear(screen.getByLabelText('满分'))
    await user.type(screen.getByLabelText('满分'), '20')
    await user.click(screen.getByRole('button', { name: '生成评分标准' }))
    await screen.findByText('环保主题写作')

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      requestId: expect.any(String), fullScore: 20,
      pages: [expect.objectContaining({ file: second }), expect.objectContaining({ file: first })],
    }))
    await user.click(screen.getByRole('button', { name: '确认采用该标准' }))
    await user.click(screen.getByRole('button', { name: '确认并创建任务' }))
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      materialContext: expect.objectContaining({ materialSummary: generatedRubric.materialSummary }),
      rubricDraft: expect.objectContaining({
        dimensions: expect.arrayContaining([
          expect.objectContaining({ id: 'content', sourceEvidence: ['材料中的环保行动要求'] }),
        ]),
      }),
    }))
  })

  it('requires a current successful generation after material or full-score changes, including a failed retry', async () => {
    const user = userEvent.setup()
    generate
      .mockResolvedValueOnce({ requestId: 'rubric-1', status: 'success', rubric: generatedRubric })
      .mockResolvedValueOnce({ requestId: 'rubric-2', status: 'failed', error: { code: 'provider_timeout', message: 'private', retryable: true } })
      .mockResolvedValueOnce({ requestId: 'rubric-3', status: 'success', rubric: generatedRubric })
    renderCreateTaskPage()

    await uploadMaterial(user)
    await generateDraft(user)
    await user.click(screen.getByRole('button', { name: '确认采用该标准' }))
    await user.upload(screen.getByLabelText('材料图片'), material('second.png'))
    expect(screen.getByRole('button', { name: '确认采用该标准' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认并创建任务' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '重新生成评分标准' }))
    expect(await screen.findByText('评分标准暂时无法生成，请保留材料后重试。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认采用该标准' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '重新生成评分标准' }))
    await screen.findByText('环保主题写作')
    expect(screen.getByRole('button', { name: '确认采用该标准' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '确认采用该标准' }))
    await user.clear(screen.getByLabelText('满分'))
    await user.type(screen.getByLabelText('满分'), '20')
    expect(screen.getByRole('button', { name: '确认采用该标准' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认并创建任务' })).toBeDisabled()
  })

  it('blocks zero, negative, empty, and out-of-tolerance weights while allowing the exact tolerance boundary', async () => {
    const user = userEvent.setup()
    generate.mockResolvedValue({
      requestId: 'rubric-1', status: 'success', rubric: {
        ...generatedRubric,
        dimensions: [
          { ...generatedRubric.dimensions[0], weight: 60 },
          { ...generatedRubric.dimensions[1], weight: 40.001 },
        ],
      },
    })
    renderCreateTaskPage()

    await uploadMaterial(user)
    await generateDraft(user)
    expect(screen.getByRole('button', { name: '确认采用该标准' })).toBeEnabled()
    fireEvent.change(screen.getByLabelText('内容权重'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('语言权重'), { target: { value: '100' } })
    expect(screen.getByRole('button', { name: '确认采用该标准' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('内容权重'), { target: { value: '-1' } })
    fireEvent.change(screen.getByLabelText('语言权重'), { target: { value: '101' } })
    expect(screen.getByRole('button', { name: '确认采用该标准' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('内容权重'), { target: { value: '' } })
    expect(screen.getByRole('button', { name: '确认采用该标准' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('内容权重'), { target: { value: '60' } })
    fireEvent.change(screen.getByLabelText('语言权重'), { target: { value: '40.002' } })
    expect(screen.getByRole('button', { name: '确认采用该标准' })).toBeDisabled()
  })

  it('blocks confirmation and creation after deleting every material page or entering an invalid full score', async () => {
    const user = userEvent.setup()
    generate.mockResolvedValue({ requestId: 'rubric-1', status: 'success', rubric: generatedRubric })
    renderCreateTaskPage()

    await uploadMaterial(user)
    await generateDraft(user)
    await user.click(screen.getByRole('button', { name: '确认采用该标准' }))
    await user.click(screen.getByRole('button', { name: '删除 material.png' }))
    expect(screen.getByRole('button', { name: '确认采用该标准' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认并创建任务' })).toBeDisabled()
    await user.upload(screen.getByLabelText('材料图片'), material())
    fireEvent.change(screen.getByLabelText('满分'), { target: { value: '0' } })
    expect(screen.getByRole('button', { name: '确认采用该标准' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认并创建任务' })).toBeDisabled()
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

    await waitFor(() => expect(screen.getByLabelText('current location').textContent).toBe('/tasks/created-task/upload'))
  })
})
