import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTaskCreationInput } from '../services/taskRubric/buildTaskCreationInput'
import { createDefaultRubricDimensions } from '../services/taskRubric/rubricForm'
import type { GeneratedTaskRubric, RubricClientResponse } from '../services/taskRubric/types'
import { CreateTaskPage } from './CreateTaskPage'

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(() => 'created-task'),
  navigate: vi.fn(),
  generate: vi.fn(),
  analyze: vi.fn(),
  convertPdfToImages: vi.fn(),
}))

vi.mock('../context/useAppState', () => ({
  useAppState: () => ({ createTask: mocks.createTask }),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mocks.navigate }
})

vi.mock('../services/taskRubric/rubricClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/taskRubric/rubricClient')>()
  return { ...actual, createConfiguredRubricClient: () => ({ generate: mocks.generate }) }
})

vi.mock('../services/taskMaterial/materialClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/taskMaterial/materialClient')>()
  return { ...actual, createConfiguredMaterialContextClient: () => ({ analyze: mocks.analyze }) }
})

vi.mock('../utils/pdfToImages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/pdfToImages')>()
  return { ...actual, convertPdfToImages: mocks.convertPdfToImages }
})

function renderCreateTaskPage() {
  return render(
    <MemoryRouter initialEntries={['/tasks/new']}>
      <CreateTaskPage />
    </MemoryRouter>,
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const generatedRubric: GeneratedTaskRubric = {
  taskName: 'AI 不应覆盖任务名称',
  materialSummary: 'AI material summary.',
  writingRequirements: ['Use the first generated requirement.', 'Use a clear structure.'],
  constraints: ['Write in English.'],
  dimensions: [
    {
      id: 'content', name: 'AI 内容', weight: 55, description: 'Respond to the task.',
      deductionFocus: ['Misses the main task', 'Ignores material evidence'], sourceEvidence: ['Private source excerpt'],
    },
    {
      id: 'language', name: 'AI 语言', weight: 40, description: 'Use accurate English.',
      deductionFocus: [], sourceEvidence: ['Private source excerpt'],
    },
    {
      id: 'legibility', name: '卷面与可读性', weight: 5, description: 'Keep writing readable.',
      deductionFocus: ['Important ambiguity'], sourceEvidence: ['Private source excerpt'],
    },
  ],
  reviewWarnings: ['Review unclear source text.'],
}

function aiSuccess(requestId: string, rubric = generatedRubric): RubricClientResponse {
  return { requestId, status: 'success', rubric }
}

function aiFailure(requestId: string): RubricClientResponse {
  return {
    requestId,
    status: 'failed',
    error: { code: 'provider_timeout', message: 'Safe failure.', retryable: true },
  }
}

function materialContextSuccess(requestId: string, value: {
  materialSummary?: string
  writingRequirements?: string[]
  constraints?: string[]
  reviewWarnings?: string[]
} = {}) {
  return {
    requestId,
    status: 'success' as const,
    materialContext: {
      materialSummary: value.materialSummary ?? 'Analyzed material.',
      writingRequirements: value.writingRequirements ?? ['Generated requirement.'],
      constraints: value.constraints ?? [],
      reviewWarnings: value.reviewWarnings ?? [],
    },
  }
}

async function uploadMaterial(
  user: ReturnType<typeof userEvent.setup>,
  name = 'material.png',
) {
  const file = new File([`contents:${name}`], name, { type: 'image/png', lastModified: 123 })
  await user.upload(screen.getByLabelText('选择作文原材料'), file)
  await screen.findByText(name)
  return file
}

async function enterValidRequirement(user: ReturnType<typeof userEvent.setup>, value = 'Write about a memorable day.') {
  await user.type(screen.getByLabelText('写作要求'), value)
}

beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
    revokeObjectURL: vi.fn(),
  })
})

afterEach(() => {
  mocks.createTask.mockClear()
  mocks.navigate.mockClear()
  mocks.generate.mockReset()
  mocks.analyze.mockReset()
  mocks.convertPdfToImages.mockReset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CreateTaskPage unified teacher rubric flow', () => {
  it('renders basic information, optional materials, the default rubric, and one final action in order', () => {
    renderCreateTaskPage()

    const basic = screen.getByRole('heading', { name: '基本信息' })
    const materials = screen.getByRole('heading', { name: '建议上传作文原材料（选填）' })
    const rubric = screen.getByRole('heading', { name: '评分标准' })
    const create = screen.getByRole('button', { name: '创建任务并上传作文' })

    expect(basic.compareDocumentPosition(materials) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(materials.compareDocumentPosition(rubric) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(rubric.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByLabelText('任务名称（选填）')).toHaveValue('作文批改任务')
    expect(screen.getByLabelText('任务名称（选填）')).toHaveAttribute('maxLength', '2000')
    expect(screen.getByLabelText('满分')).toHaveValue(15)
    expect(screen.getByRole('button', { name: '编辑内容与任务完成' })).toHaveTextContent('40%')
    expect(screen.getByRole('button', { name: '编辑语言质量' })).toHaveTextContent('40%')
    expect(screen.getByRole('button', { name: '编辑结构与连贯' })).toHaveTextContent('15%')
    expect(screen.getByRole('button', { name: '编辑卷面与可读性' })).toHaveTextContent('5%')
    expect(create).toBeDisabled()
    expect(screen.queryByText('确认采用该标准')).not.toBeInTheDocument()
    expect(screen.queryByText('教师模式')).not.toBeInTheDocument()
    expect(screen.queryByText('AI 模式')).not.toBeInTheDocument()
    expect(screen.queryByText('评分标准来源')).not.toBeInTheDocument()
  })

  it('creates a confirmed teacher-only task without material or AI and navigates once', async () => {
    const user = userEvent.setup()
    renderCreateTaskPage()

    await enterValidRequirement(user)
    const create = screen.getByRole('button', { name: '创建任务并上传作文' })
    expect(create).toBeEnabled()
    await user.click(create)

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1))
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      taskName: '作文批改任务',
      fullScore: 15,
      materialProcessingStatus: 'none',
      materialContext: {
        materialSummary: '教师确认的写作要求：Write about a memorable day.',
        writingRequirements: ['Write about a memorable day.'],
        constraints: [],
        reviewWarnings: [],
      },
      rubricDraft: expect.objectContaining({
        source: 'teacher',
        writingGoal: 'Write about a memorable day.',
        status: 'confirmed',
      }),
    }))
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.analyze).not.toHaveBeenCalled()
    expect(mocks.navigate).toHaveBeenCalledOnce()
    expect(mocks.navigate).toHaveBeenCalledWith('/tasks/created-task/upload')
  })

  it('creates and navigates once after the StrictMode effect replay', async () => {
    const user = userEvent.setup()
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/tasks/new']}>
          <CreateTaskPage />
        </MemoryRouter>
      </StrictMode>,
    )

    await enterValidRequirement(user, 'Create safely after the StrictMode probe.')
    await user.click(screen.getByRole('button', { name: '创建任务并上传作文' }))

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledOnce())
    expect(mocks.navigate).toHaveBeenCalledOnce()
    expect(mocks.navigate).toHaveBeenCalledWith('/tasks/created-task/upload')
  })

  it('uses the default name when cleared and clamps UI changes to 2,000 characters', async () => {
    const user = userEvent.setup()
    renderCreateTaskPage()
    const taskName = screen.getByLabelText('任务名称（选填）')

    fireEvent.change(taskName, { target: { value: 'x'.repeat(2_001) } })
    expect(taskName).toHaveValue('x'.repeat(2_000))

    await user.clear(taskName)
    await enterValidRequirement(user)
    await user.click(screen.getByRole('button', { name: '创建任务并上传作文' }))

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledOnce())
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({ taskName: '作文批改任务' }))
  })

  it('keeps the builder as the final guard against a programmatic 2,001-character name', () => {
    const result = buildTaskCreationInput({
      taskName: 'x'.repeat(2_001),
      fullScore: 15,
      writingRequirement: 'Write clearly.',
      dimensions: createDefaultRubricDimensions(),
      source: 'teacher',
      materialProcessingStatus: 'none',
    })

    expect(result).toMatchObject({ ok: false, taskNameError: '任务名称不能超过 2000 个字符。' })
  })

  it('enables the final action only for an integer full score from 1 through 100 and a valid rubric', async () => {
    const user = userEvent.setup()
    renderCreateTaskPage()
    await enterValidRequirement(user)
    const score = screen.getByLabelText('满分')
    const create = screen.getByRole('button', { name: '创建任务并上传作文' })

    fireEvent.change(score, { target: { value: '0' } })
    expect(create).toBeDisabled()
    fireEvent.change(score, { target: { value: '1' } })
    expect(create).toBeEnabled()
    fireEvent.change(score, { target: { value: '100' } })
    expect(create).toBeEnabled()
    fireEvent.change(score, { target: { value: '101' } })
    expect(create).toBeDisabled()
    fireEvent.change(score, { target: { value: '15.5' } })
    expect(create).toBeDisabled()
  })

  it('locks synchronously so two submit events create and navigate only once', async () => {
    const user = userEvent.setup()
    renderCreateTaskPage()
    await enterValidRequirement(user)
    const create = screen.getByRole('button', { name: '创建任务并上传作文' })

    fireEvent.click(create)
    fireEvent.click(create)

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledOnce())
    expect(mocks.navigate).toHaveBeenCalledOnce()
  })
})

describe('CreateTaskPage optional AI assistance', () => {
  it('keeps AI disabled without a ready unit, performs no call on upload, and calls once only after the explicit click', async () => {
    const user = userEvent.setup()
    mocks.generate.mockImplementation(async (request: { requestId: string }) => aiFailure(request.requestId))
    renderCreateTaskPage()
    const aiButton = screen.getByRole('button', { name: '根据材料生成评分标准' })

    expect(aiButton).toBeDisabled()
    await uploadMaterial(user)
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.analyze).not.toHaveBeenCalled()
    expect(aiButton).toBeEnabled()

    await user.click(aiButton)
    await screen.findByRole('alert')
    expect(mocks.generate).toHaveBeenCalledOnce()
    expect(mocks.analyze).not.toHaveBeenCalled()
    expect(mocks.generate.mock.calls[0]?.[0]).toMatchObject({
      fullScore: 15,
      writingRequirement: '',
      materials: [{ kind: 'image', file: expect.any(File) }],
      signal: expect.any(AbortSignal),
    })
  })

  it('applies a complete AI rubric atomically without overwriting teacher text or task name', async () => {
    const user = userEvent.setup()
    mocks.generate.mockImplementation(async (request: { requestId: string }) => aiSuccess(request.requestId))
    renderCreateTaskPage()
    await uploadMaterial(user)
    await enterValidRequirement(user, 'Teacher requirement wins exactly.  ')

    await user.click(screen.getByRole('button', { name: '根据材料生成评分标准' }))
    await screen.findByRole('button', { name: '编辑AI 内容' })

    expect(screen.getByLabelText('写作要求')).toHaveValue('Teacher requirement wins exactly.  ')
    expect(screen.getByLabelText('任务名称（选填）')).toHaveValue('作文批改任务')
    expect(screen.getByRole('button', { name: '编辑AI 内容' })).toHaveTextContent('55%')
    expect(screen.getByRole('button', { name: '编辑AI 语言' })).toHaveTextContent('40%')
    expect(screen.getByRole('button', { name: '编辑卷面与可读性' })).toHaveTextContent('5%')
    await user.click(screen.getByRole('button', { name: '编辑AI 内容' }))
    expect(screen.getByLabelText('维度说明：AI 内容')).toHaveValue(
      'Respond to the task.\n扣分关注：Misses the main task；Ignores material evidence',
    )

    await user.click(screen.getByRole('button', { name: '创建任务并上传作文' }))
    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledOnce())
    expect(mocks.analyze).not.toHaveBeenCalled()
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      taskName: '作文批改任务',
      materialProcessingStatus: 'ready',
      rubricDraft: expect.objectContaining({
        source: 'ai',
        writingGoal: 'Teacher requirement wins exactly.',
        dimensions: expect.arrayContaining([
          expect.objectContaining({
            id: 'content',
            description: 'Respond to the task.\n扣分关注：Misses the main task；Ignores material evidence',
            deductionFocus: [],
            sourceEvidence: [],
          }),
        ]),
      }),
    }))
  })

  it('uses the first generated requirement only when the teacher requirement is blank', async () => {
    const user = userEvent.setup()
    mocks.generate.mockImplementation(async (request: { requestId: string }) => aiSuccess(request.requestId))
    renderCreateTaskPage()
    await uploadMaterial(user)

    await user.click(screen.getByRole('button', { name: '根据材料生成评分标准' }))

    expect(await screen.findByLabelText('写作要求')).toHaveValue('Use the first generated requirement.')
    await user.click(screen.getByRole('button', { name: '创建任务并上传作文' }))
    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledOnce())
    expect(mocks.analyze).not.toHaveBeenCalled()
  })

  it('preserves every visible field when AI fails or when its surfaced description is invalid', async () => {
    const user = userEvent.setup()
    renderCreateTaskPage()
    await uploadMaterial(user)
    await enterValidRequirement(user, 'Keep this exact teacher requirement.')
    await user.click(screen.getByRole('button', { name: '编辑内容与任务完成' }))
    const description = screen.getByLabelText('维度说明：内容与任务完成')
    await user.clear(description)
    await user.type(description, 'Keep this exact teacher description.')

    mocks.generate.mockImplementationOnce(async (request: { requestId: string }) => aiFailure(request.requestId))
    await user.click(screen.getByRole('button', { name: '根据材料生成评分标准' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('写作要求')).toHaveValue('Keep this exact teacher requirement.')
    expect(screen.getByLabelText('维度说明：内容与任务完成')).toHaveValue('Keep this exact teacher description.')

    const invalidRubric: GeneratedTaskRubric = {
      ...generatedRubric,
      dimensions: generatedRubric.dimensions.map((dimension, index) => index === 0
        ? { ...dimension, description: 'x'.repeat(1_995), deductionFocus: ['too long'] }
        : dimension),
    }
    mocks.generate.mockImplementationOnce(async (request: { requestId: string }) => aiSuccess(request.requestId, invalidRubric))
    await user.click(screen.getByRole('button', { name: '根据材料生成评分标准' }))
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByLabelText('写作要求')).toHaveValue('Keep this exact teacher requirement.')
    expect(screen.getByLabelText('维度说明：内容与任务完成')).toHaveValue('Keep this exact teacher description.')
    expect(screen.queryByRole('button', { name: '编辑AI 内容' })).not.toBeInTheDocument()
  })

  it.each([
    ['ordered material signature', async (user: ReturnType<typeof userEvent.setup>) => { await uploadMaterial(user, 'later.png') }],
    ['full score', async (_user: ReturnType<typeof userEvent.setup>) => {
      fireEvent.change(screen.getByLabelText('满分'), { target: { value: '20' } })
    }],
    ['exact teacher requirement', async (user: ReturnType<typeof userEvent.setup>) => {
      await user.type(screen.getByLabelText('写作要求'), ' changed')
    }],
  ])('discards a late AI response after the %s changes', async (_label, changeSnapshot) => {
    const user = userEvent.setup()
    const pending = deferred<RubricClientResponse>()
    const abort = vi.spyOn(AbortController.prototype, 'abort')
    mocks.generate.mockReturnValueOnce(pending.promise)
    renderCreateTaskPage()
    await uploadMaterial(user, 'first.png')
    await enterValidRequirement(user, 'Original requirement.')

    await user.click(screen.getByRole('button', { name: '根据材料生成评分标准' }))
    await screen.findByRole('status')
    await changeSnapshot(user)
    await waitFor(() => expect(abort).toHaveBeenCalled())
    await act(async () => {
      const request = mocks.generate.mock.calls[0]?.[0] as { requestId: string }
      pending.resolve(aiSuccess(request.requestId))
      await pending.promise
    })

    expect(screen.queryByRole('button', { name: '编辑AI 内容' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编辑内容与任务完成' })).toBeInTheDocument()
    expect(mocks.generate).toHaveBeenCalledOnce()
  })

  it('does not overwrite a dimension the teacher edits while AI is pending', async () => {
    const user = userEvent.setup()
    const pending = deferred<RubricClientResponse>()
    mocks.generate.mockReturnValueOnce(pending.promise)
    renderCreateTaskPage()
    await uploadMaterial(user)
    await enterValidRequirement(user, 'Teacher requirement.')
    await user.click(screen.getByRole('button', { name: '根据材料生成评分标准' }))
    await screen.findByRole('status')

    await user.click(screen.getByRole('button', { name: '编辑内容与任务完成' }))
    const description = screen.getByLabelText('维度说明：内容与任务完成')
    await user.clear(description)
    await user.type(description, 'Teacher edited while AI was pending.')
    await act(async () => {
      const request = mocks.generate.mock.calls[0]?.[0] as { requestId: string }
      pending.resolve(aiSuccess(request.requestId))
      await pending.promise
    })

    expect(screen.getByLabelText('维度说明：内容与任务完成')).toHaveValue('Teacher edited while AI was pending.')
    expect(screen.queryByRole('button', { name: '编辑AI 内容' })).not.toBeInTheDocument()
  })

  it('aborts pending AI on unmount and ignores its late resolution', async () => {
    const user = userEvent.setup()
    const pending = deferred<RubricClientResponse>()
    const abort = vi.spyOn(AbortController.prototype, 'abort')
    mocks.generate.mockReturnValueOnce(pending.promise)
    const view = renderCreateTaskPage()
    await uploadMaterial(user)
    await enterValidRequirement(user, 'Teacher requirement.')
    await user.click(screen.getByRole('button', { name: '根据材料生成评分标准' }))
    await screen.findByRole('status')

    view.unmount()
    expect(abort).toHaveBeenCalledOnce()
    await act(async () => {
      const request = mocks.generate.mock.calls[0]?.[0] as { requestId: string }
      pending.resolve(aiSuccess(request.requestId))
      await pending.promise
    })

    expect(mocks.createTask).not.toHaveBeenCalled()
  })

  it('aborts AI before submit, creates from current visible values, and ignores the late response', async () => {
    const user = userEvent.setup()
    const pending = deferred<RubricClientResponse>()
    const abort = vi.spyOn(AbortController.prototype, 'abort')
    mocks.generate.mockReturnValueOnce(pending.promise)
    mocks.analyze.mockImplementationOnce(async (request: { requestId: string }) => ({
      requestId: request.requestId,
      status: 'success',
      materialContext: {
        materialSummary: 'Analyzed material.', writingRequirements: ['Visible teacher value.'],
        constraints: [], reviewWarnings: [],
      },
    }))
    renderCreateTaskPage()
    await uploadMaterial(user)
    await enterValidRequirement(user, 'Visible teacher value.')

    await user.click(screen.getByRole('button', { name: '根据材料生成评分标准' }))
    expect(screen.getByRole('button', { name: '创建任务并上传作文' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '创建任务并上传作文' }))

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledOnce())
    expect(abort).toHaveBeenCalled()
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      rubricDraft: expect.objectContaining({ source: 'teacher', writingGoal: 'Visible teacher value.' }),
    }))
    await act(async () => {
      const request = mocks.generate.mock.calls[0]?.[0] as { requestId: string }
      pending.resolve(aiSuccess(request.requestId))
      await pending.promise
    })
    expect(mocks.createTask).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: '编辑AI 内容' })).not.toBeInTheDocument()
  })
})

describe('CreateTaskPage submission-time material context', () => {
  it('awaits an already-started PDF normalization and analyzes the latest converted units once', async () => {
    const user = userEvent.setup()
    const conversion = deferred<File[]>()
    mocks.convertPdfToImages.mockReturnValueOnce(conversion.promise)
    mocks.analyze.mockImplementationOnce(async (request: { requestId: string }) => materialContextSuccess(request.requestId))
    renderCreateTaskPage()
    await enterValidRequirement(user, 'Use the converted PDF prompt.')

    await user.upload(
      screen.getByLabelText('选择作文原材料'),
      new File(['pdf'], 'prompt.pdf', { type: 'application/pdf', lastModified: 123 }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('正在处理，请稍候')
    await user.click(screen.getByRole('button', { name: '创建任务并上传作文' }))
    expect(mocks.analyze).not.toHaveBeenCalled()

    await act(async () => {
      conversion.resolve([
        new File(['one'], 'page-1.png', { type: 'image/png', lastModified: 1 }),
        new File(['two'], 'page-2.png', { type: 'image/png', lastModified: 2 }),
      ])
      await conversion.promise
    })

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledOnce())
    expect(mocks.analyze).toHaveBeenCalledOnce()
    expect(mocks.analyze.mock.calls[0]?.[0]).toMatchObject({
      materials: [
        { kind: 'image', file: expect.objectContaining({ name: 'page-1.png' }) },
        { kind: 'image', file: expect.objectContaining({ name: 'page-2.png' }) },
      ],
    })
  })

  it('analyzes ready units exactly once and merges the exact teacher requirement first', async () => {
    const user = userEvent.setup()
    mocks.analyze.mockImplementationOnce(async (request: { requestId: string }) => materialContextSuccess(request.requestId, {
      writingRequirements: ['Generated requirement.', ' Teacher requirement. '],
      constraints: ['Stay on topic.'],
    }))
    renderCreateTaskPage()
    await uploadMaterial(user)
    await enterValidRequirement(user, 'Teacher requirement.')

    await user.click(screen.getByRole('button', { name: '创建任务并上传作文' }))

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledOnce())
    expect(mocks.analyze).toHaveBeenCalledOnce()
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      materialProcessingStatus: 'ready',
      materialContext: {
        materialSummary: 'Analyzed material.',
        writingRequirements: ['Teacher requirement.', 'Generated requirement.'],
        constraints: ['Stay on topic.'],
        reviewWarnings: [],
      },
    }))
  })

  it.each(['reorder', 'add', 'delete'] as const)(
    '%s changes the material signature, preserves the visible AI rubric, and invalidates only the context cache',
    async (change) => {
      const user = userEvent.setup()
      mocks.generate.mockImplementationOnce(async (request: { requestId: string }) => aiSuccess(request.requestId))
      mocks.analyze.mockImplementationOnce(async (request: { requestId: string }) => materialContextSuccess(request.requestId))
      renderCreateTaskPage()
      await uploadMaterial(user, 'first.png')
      await uploadMaterial(user, 'second.png')
      await enterValidRequirement(user, 'Teacher requirement.')
      await user.click(screen.getByRole('button', { name: '根据材料生成评分标准' }))
      await screen.findByRole('button', { name: '编辑AI 内容' })

      if (change === 'reorder') {
        await user.click(screen.getByRole('button', { name: '上移 second.png' }))
      } else if (change === 'add') {
        await uploadMaterial(user, 'third.png')
      } else {
        await user.click(screen.getByRole('button', { name: '删除 second.png' }))
      }

      expect(screen.getByRole('button', { name: '编辑AI 内容' })).toHaveTextContent('55%')
      expect(screen.getByLabelText('写作要求')).toHaveValue('Teacher requirement.')
      await user.click(screen.getByRole('button', { name: '创建任务并上传作文' }))
      await waitFor(() => expect(mocks.createTask).toHaveBeenCalledOnce())
      expect(mocks.analyze).toHaveBeenCalledOnce()
      expect(mocks.generate).toHaveBeenCalledOnce()
    },
  )

  it.each([
    ['fullScore', () => fireEvent.change(screen.getByLabelText('满分'), { target: { value: '20' } })],
    ['exact teacher requirement', () => fireEvent.change(screen.getByLabelText('写作要求'), { target: { value: 'Changed exactly.' } })],
  ])('%s changes preserve visible AI dimensions but invalidate its context cache', async (_label, change) => {
    const user = userEvent.setup()
    mocks.generate.mockImplementationOnce(async (request: { requestId: string }) => aiSuccess(request.requestId))
    mocks.analyze.mockImplementationOnce(async (request: { requestId: string }) => materialContextSuccess(request.requestId))
    renderCreateTaskPage()
    await uploadMaterial(user)
    await enterValidRequirement(user, 'Teacher requirement.')
    await user.click(screen.getByRole('button', { name: '根据材料生成评分标准' }))
    await screen.findByRole('button', { name: '编辑AI 内容' })

    change()

    expect(screen.getByRole('button', { name: '编辑AI 内容' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '创建任务并上传作文' }))
    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledOnce())
    expect(mocks.analyze).toHaveBeenCalledOnce()
  })

  it('falls back once to teacher-only context, persists failed status, and shows a status warning', async () => {
    const user = userEvent.setup()
    mocks.analyze.mockImplementationOnce(async (request: { requestId: string }) => aiFailure(request.requestId))
    renderCreateTaskPage()
    await uploadMaterial(user)
    await enterValidRequirement(user, 'Teacher-only fallback requirement.')

    await user.click(screen.getByRole('button', { name: '创建任务并上传作文' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      '材料暂时无法读取，本任务将仅按已填写的写作要求评分。',
    )
    expect(mocks.analyze).toHaveBeenCalledOnce()
    expect(mocks.createTask).toHaveBeenCalledOnce()
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      materialProcessingStatus: 'failed',
      materialContext: {
        materialSummary: '教师确认的写作要求：Teacher-only fallback requirement.',
        writingRequirements: ['Teacher-only fallback requirement.'],
        constraints: [],
        reviewWarnings: [],
      },
    }))
  })

  it('does not let a failed local source block a valid teacher-only task or trigger either client', async () => {
    const user = userEvent.setup({ applyAccept: false })
    renderCreateTaskPage()
    await enterValidRequirement(user, 'Teacher requirement remains sufficient.')
    await user.upload(
      screen.getByLabelText('选择作文原材料'),
      new File(['legacy'], 'prompt.doc', { type: 'application/msword' }),
    )
    expect(await screen.findByText('旧版 .doc 文件暂不支持，请转换为 DOCX 或 PDF 后上传。')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '创建任务并上传作文' }))

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledOnce())
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({ materialProcessingStatus: 'none' }))
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.analyze).not.toHaveBeenCalled()
  })
})
