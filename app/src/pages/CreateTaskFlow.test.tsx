import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import type { AppState } from '../context/appStateContextValue'
import { useAppState } from '../context/useAppState'
import { buildMultimodalGradingRequest } from '../services/grading/buildMultimodalGradingRequest'
import { createRemoteGradingClient } from '../services/grading/remoteGradingClient'
import { createOcrClient } from '../services/ocr/ocrClient'
import type { GeneratedTaskRubric, RubricClientResponse } from '../services/taskRubric/types'
import type { Essay, Task } from '../types'
import { CreateTaskPage } from './CreateTaskPage'
import { UploadPage } from './UploadPage'

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  convertPdfToImages: vi.fn(),
  createOcrClient: vi.fn(),
  extractDocxBodyText: vi.fn(),
  generate: vi.fn(),
  unexpectedFetch: vi.fn(),
}))

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

vi.mock('../services/taskMaterial/docxToText', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/taskMaterial/docxToText')>()
  return { ...actual, extractDocxBodyText: mocks.extractDocxBodyText }
})

vi.mock('../services/ocr/ocrClient', () => ({
  createOcrClient: mocks.createOcrClient,
  getDefaultOcrMode: vi.fn(() => 'mock'),
}))

const teacherRequirement = 'Write about a memorable day.'
const fixedNow = new Date('2026-08-28T01:00:00.000Z')
const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const generatedRubric: GeneratedTaskRubric = {
  taskName: 'AI title must stay internal',
  materialSummary: 'Safe AI material summary.',
  writingRequirements: ['AI inferred requirement.', 'Use a clear structure.'],
  constraints: ['Write in English.'],
  dimensions: [
    {
      id: 'content',
      name: 'AI 内容',
      weight: 55,
      description: 'Complete the teacher-confirmed task.',
      deductionFocus: ['Missing a required point'],
      sourceEvidence: ['Hidden source evidence'],
    },
    {
      id: 'language',
      name: 'AI 语言',
      weight: 40,
      description: 'Use accurate English.',
      deductionFocus: [],
      sourceEvidence: ['Hidden source evidence'],
    },
    {
      id: 'legibility',
      name: '卷面与可读性',
      weight: 5,
      description: 'Keep writing readable.',
      deductionFocus: ['Important ambiguity'],
      sourceEvidence: ['Hidden source evidence'],
    },
  ],
  reviewWarnings: [],
}

let capturedState: AppState | undefined
let createdTaskId = ''
let uuidSequence = 0

function StateCapture() {
  capturedState = useAppState()
  return null
}

function CreatedTaskProbe() {
  const { taskId = '' } = useParams()
  const { tasks } = useAppState()
  createdTaskId = taskId
  const task = tasks.find((candidate) => candidate.id === taskId)
  return <h1>{task ? '已存储新任务' : '正在读取新任务'}</h1>
}

function UploadDestination() {
  const { taskId = '' } = useParams()
  createdTaskId = taskId
  return <UploadPage />
}

function renderCreateFlow(destination: 'probe' | 'upload' = 'probe') {
  return render(
    <AppStateProvider>
      <StateCapture />
      <MemoryRouter initialEntries={['/tasks/new']}>
        <Routes>
          <Route path="/tasks/new" element={<CreateTaskPage />} />
          <Route
            path="/tasks/:taskId/upload"
            element={destination === 'probe' ? <CreatedTaskProbe /> : <UploadDestination />}
          />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}

function rubricSuccess(requestId: string): RubricClientResponse {
  return { requestId, status: 'success', rubric: generatedRubric }
}

function safeFailure(requestId: string): RubricClientResponse {
  return {
    requestId,
    status: 'failed',
    error: { code: 'provider_timeout', message: 'Safe synthetic failure.', retryable: true },
  }
}

function materialContextSuccess(requestId: string) {
  return {
    requestId,
    status: 'success' as const,
    materialContext: {
      materialSummary: 'Safe analyzed material context.',
      writingRequirements: ['Later material-inferred requirement.'],
      constraints: ['Use evidence only when it does not conflict with the teacher.'],
      reviewWarnings: [],
    },
  }
}

function imageFile(name = 'task-image.png', body = 'TASK_IMAGE_PRIVATE_BYTES') {
  return new File([body], name, { type: 'image/png', lastModified: 101 })
}

function pdfFile(name = 'task-prompt.pdf') {
  return new File(['TASK_PDF_PRIVATE_BYTES'], name, { type: 'application/pdf', lastModified: 102 })
}

function docxFile(name = 'task-prompt.docx') {
  return new File(['TASK_DOCX_PRIVATE_BYTES'], name, { type: docxMime, lastModified: 103 })
}

async function addMaterials(
  user: ReturnType<typeof userEvent.setup>,
  files: File | File[],
) {
  await user.upload(screen.getByLabelText('选择作文原材料'), files)
  await waitFor(() => {
    expect(screen.getByRole('button', { name: '根据材料生成评分标准' })).toBeEnabled()
  })
}

async function createVisibleTask(
  user: ReturnType<typeof userEvent.setup>,
  requirement = teacherRequirement,
) {
  await user.type(screen.getByLabelText('写作要求'), requirement)
  await user.click(screen.getByRole('button', { name: '创建任务并上传作文' }))
  await screen.findByRole('heading', { name: '已存储新任务' })
  return getCreatedTask()
}

function getCreatedTask(): Task {
  const task = capturedState?.tasks.find((candidate) => candidate.id === createdTaskId)
  if (!task) throw new Error('Expected the routed task to exist in the real AppStateProvider.')
  return task
}

beforeEach(() => {
  capturedState = undefined
  createdTaskId = ''
  uuidSequence = 0
  mocks.analyze.mockReset()
  mocks.convertPdfToImages.mockReset()
  mocks.createOcrClient.mockReset()
  mocks.extractDocxBodyText.mockReset()
  mocks.generate.mockReset()
  mocks.unexpectedFetch.mockReset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(fixedNow)

  const deterministicCrypto = Object.create(globalThis.crypto) as Crypto
  Object.defineProperty(deterministicCrypto, 'randomUUID', {
    configurable: true,
    value: vi.fn(() => {
      uuidSequence += 1
      return `00000000-0000-4000-8000-${String(uuidSequence).padStart(12, '0')}`
    }),
  })
  vi.stubGlobal('crypto', deterministicCrypto)
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn((file: File) => `blob:owned/${file.name}`),
    revokeObjectURL: vi.fn(),
  })
  mocks.unexpectedFetch.mockRejectedValue(new Error('No network is permitted in this suite.'))
  vi.stubGlobal('fetch', mocks.unexpectedFetch)

  mocks.analyze.mockImplementation(async (request: { requestId: string }) => (
    materialContextSuccess(request.requestId)
  ))
  mocks.generate.mockImplementation(async (request: { requestId: string }) => (
    safeFailure(request.requestId)
  ))
  mocks.convertPdfToImages.mockImplementation(async (file: File) => [
    new File(['PDF_PAGE_ONE_PRIVATE'], `${file.name}-page-1.png`, { type: 'image/png', lastModified: 201 }),
    new File(['PDF_PAGE_TWO_PRIVATE'], `${file.name}-page-2.png`, { type: 'image/png', lastModified: 202 }),
  ])
  mocks.extractDocxBodyText.mockImplementation(async (file: File) => ({
    text: `DOCX_PRIVATE_BODY:${file.name}`,
    warnings: ['docx_body_only'] as const,
  }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('optional-material task creation vertical flow', () => {
  it('creates, stores, and navigates a confirmed default rubric without material or AI', async () => {
    const user = userEvent.setup()
    renderCreateFlow()

    const task = await createVisibleTask(user)

    expect(createdTaskId).toBe(`task-${fixedNow.valueOf()}`)
    expect(task).toMatchObject({
      taskName: '作文批改任务',
      fullScore: 15,
      materialProcessingStatus: 'none',
      rubricDraft: {
        source: 'teacher',
        status: 'confirmed',
        writingGoal: teacherRequirement,
        dimensions: [
          expect.objectContaining({ id: 'content', weight: 40 }),
          expect.objectContaining({ id: 'language', weight: 40 }),
          expect.objectContaining({ id: 'structure', weight: 15 }),
          expect.objectContaining({ id: 'legibility', weight: 5 }),
        ],
      },
      materialContext: {
        materialSummary: `教师确认的写作要求：${teacherRequirement}`,
        writingRequirements: [teacherRequirement],
        constraints: [],
        reviewWarnings: [],
      },
    })
    expect(capturedState?.essays.filter((essay) => essay.taskId === task.id)).toEqual([])
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.analyze).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'one image',
      files: () => [imageFile()],
      expected: [
        { kind: 'image', fileName: 'task-image.png' },
      ],
    },
    {
      label: 'one multi-page PDF',
      files: () => [pdfFile()],
      expected: [
        { kind: 'image', fileName: 'task-prompt.pdf-page-1.png' },
        { kind: 'image', fileName: 'task-prompt.pdf-page-2.png' },
      ],
    },
    {
      label: 'one DOCX',
      files: () => [docxFile()],
      expected: [
        { kind: 'text', displayName: 'task-prompt.docx', text: 'DOCX_PRIVATE_BODY:task-prompt.docx' },
      ],
    },
    {
      label: 'mixed image, PDF pages, and DOCX',
      files: () => [imageFile('first.png'), pdfFile('middle.pdf'), docxFile('last.docx')],
      expected: [
        { kind: 'image', fileName: 'first.png' },
        { kind: 'image', fileName: 'middle.pdf-page-1.png' },
        { kind: 'image', fileName: 'middle.pdf-page-2.png' },
        { kind: 'text', displayName: 'last.docx', text: 'DOCX_PRIVATE_BODY:last.docx' },
      ],
    },
  ])('normalizes $label in source and page order before creating', async ({ files, expected }) => {
    const user = userEvent.setup()
    renderCreateFlow()
    await addMaterials(user, files())

    const task = await createVisibleTask(user, `Teacher requirement for ${expected.length} units.`)

    expect(mocks.analyze).toHaveBeenCalledOnce()
    const request = mocks.analyze.mock.calls[0]?.[0] as {
      materials: Array<{ kind: 'image'; file: File } | { kind: 'text'; displayName: string; text: string }>
    }
    expect(request.materials.map((unit) => unit.kind === 'image'
      ? { kind: unit.kind, fileName: unit.file.name }
      : { kind: unit.kind, displayName: unit.displayName, text: unit.text }))
      .toEqual(expected)
    expect(task.materialProcessingStatus).toBe('ready')
    expect(task.rubricDraft?.status).toBe('confirmed')
  })

  it('keeps a post-AI teacher edit authoritative when the confirmed task is created', async () => {
    const user = userEvent.setup()
    mocks.generate.mockImplementation(async (request: { requestId: string }) => (
      rubricSuccess(request.requestId)
    ))
    renderCreateFlow()
    await addMaterials(user, imageFile())
    await user.type(screen.getByLabelText('写作要求'), 'Initial teacher requirement.')

    await user.click(screen.getByRole('button', { name: '根据材料生成评分标准' }))
    await screen.findByRole('button', { name: '编辑AI 内容' })
    await user.clear(screen.getByLabelText('写作要求'))
    await user.type(screen.getByLabelText('写作要求'), 'Final teacher-confirmed requirement.')
    await user.click(screen.getByRole('button', { name: '创建任务并上传作文' }))
    await screen.findByRole('heading', { name: '已存储新任务' })

    const task = getCreatedTask()
    expect(mocks.generate).toHaveBeenCalledOnce()
    expect(mocks.analyze).toHaveBeenCalledOnce()
    expect(task.taskName).toBe('作文批改任务')
    expect(task.materialContext?.writingRequirements).toEqual([
      'Final teacher-confirmed requirement.',
      'Later material-inferred requirement.',
    ])
    expect(task.rubricDraft).toMatchObject({
      source: 'ai',
      status: 'confirmed',
      writingGoal: 'Final teacher-confirmed requirement.',
      dimensions: expect.arrayContaining([
        expect.objectContaining({
          id: 'content',
          description: 'Complete the teacher-confirmed task.\n扣分关注：Missing a required point',
          deductionFocus: [],
          sourceEvidence: [],
        }),
      ]),
    })
  })

  it('preserves the valid visible teacher rubric after explicit AI failure and creates directly', async () => {
    const user = userEvent.setup()
    renderCreateFlow()
    await addMaterials(user, imageFile())
    await user.type(screen.getByLabelText('写作要求'), 'Teacher values survive AI failure.')

    await user.click(screen.getByRole('button', { name: '根据材料生成评分标准' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('评分标准生成失败')
    await user.click(screen.getByRole('button', { name: '创建任务并上传作文' }))
    await screen.findByRole('heading', { name: '已存储新任务' })

    const task = getCreatedTask()
    expect(mocks.generate).toHaveBeenCalledOnce()
    expect(mocks.analyze).toHaveBeenCalledOnce()
    expect(task.rubricDraft).toMatchObject({
      source: 'teacher',
      status: 'confirmed',
      writingGoal: 'Teacher values survive AI failure.',
      dimensions: [
        expect.objectContaining({ id: 'content', weight: 40 }),
        expect.objectContaining({ id: 'language', weight: 40 }),
        expect.objectContaining({ id: 'structure', weight: 15 }),
        expect.objectContaining({ id: 'legibility', weight: 5 }),
      ],
    })
  })

  it('creates after material-context failure and repeats the failed-status warning on UploadPage', async () => {
    const user = userEvent.setup()
    mocks.analyze.mockImplementation(async (request: { requestId: string }) => (
      safeFailure(request.requestId)
    ))
    renderCreateFlow('upload')
    await addMaterials(user, imageFile())
    await user.type(screen.getByLabelText('写作要求'), 'Use only this teacher requirement.')

    await user.click(screen.getByRole('button', { name: '创建任务并上传作文' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      '材料暂时无法读取，本任务将仅按已填写的写作要求评分。',
    )
    expect(screen.getByRole('button', { name: '为学生1添加作文' })).toBeInTheDocument()
    expect(getCreatedTask()).toMatchObject({
      materialProcessingStatus: 'failed',
      rubricDraft: { status: 'confirmed', writingGoal: 'Use only this teacher requirement.' },
      materialContext: {
        writingRequirements: ['Use only this teacher requirement.'],
        constraints: [],
        reviewWarnings: [],
      },
    })
    expect(mocks.analyze).toHaveBeenCalledOnce()
  })

  it('builds v2 essay multipart from only current student pages and never invokes an OCR boundary', async () => {
    const user = userEvent.setup()
    renderCreateFlow()
    await addMaterials(user, [
      imageFile('task-source.png'),
      pdfFile('task-source.pdf'),
      docxFile('task-source.docx'),
    ])
    const task = await createVisibleTask(user, 'Teacher-confirmed request for the student essay.')

    const studentPageOne = imageFile('student-page-1.png', 'STUDENT_PAGE_ONE_BYTES')
    const studentPageTwo = imageFile('student-page-2.png', 'STUDENT_PAGE_TWO_BYTES')
    const essay: Essay = {
      id: 'essay-current-student',
      taskId: task.id,
      essayNumber: '学生1',
      pages: [
        { id: 'essay-page-1', label: studentPageOne.name, pageNumber: 1, quality: 'clear', accent: '#0891b2', sourceFile: studentPageOne },
        { id: 'essay-page-2', label: studentPageTwo.name, pageNumber: 2, quality: 'clear', accent: '#0891b2', sourceFile: studentPageTwo },
      ],
      pageCount: 2,
      pageOrder: ['essay-page-1', 'essay-page-2'],
      ocrText: '',
      ocrConfidence: 0,
      status: 'pending_grading',
      exceptionReasons: [],
      teacherReviewed: false,
      gradingRun: { status: 'idle' },
      createdAt: fixedNow.toISOString(),
      updatedAt: fixedNow.toISOString(),
    }
    const built = buildMultimodalGradingRequest(task, essay, 'grading-request-current-student')
    expect(built.ok).toBe(true)
    if (!built.ok) throw new Error(built.error.message)

    const gradingFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    await act(async () => {
      await createRemoteGradingClient({ apiBase: 'http://grading.test', fetchImpl: gradingFetch })
        .gradeImages(built.request)
    })

    expect(gradingFetch).toHaveBeenCalledOnce()
    const [url, init] = gradingFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://grading.test/grading/grade-images')
    const form = init?.body as FormData
    const metadata = JSON.parse(String(form.get('metadata'))) as Record<string, unknown>
    expect(metadata).toMatchObject({
      requestVersion: 'multimodal-grading-request-v2',
      essayId: 'essay-current-student',
      pageIds: ['essay-page-1', 'essay-page-2'],
    })
    expect(form.getAll('pages').map((entry) => (entry as File).name)).toEqual([
      'student-page-1.png',
      'student-page-2.png',
    ])
    expect(form.get('materialManifest')).toBeNull()
    expect(form.get('textMaterials')).toBeNull()
    expect(JSON.stringify(metadata)).not.toContain('DOCX_PRIVATE_BODY')
    expect(JSON.stringify(metadata)).not.toContain('TASK_IMAGE_PRIVATE_BYTES')
    expect(JSON.stringify(metadata)).not.toContain('TASK_PDF_PRIVATE_BYTES')

    expect(createOcrClient).not.toHaveBeenCalled()
    expect(mocks.unexpectedFetch).not.toHaveBeenCalled()
    expect(capturedState?.essays.filter((candidate) => candidate.taskId === task.id)).toEqual([])
    expect(capturedState?.essays.some((candidate) => (
      candidate.taskId === task.id
      && (candidate.status === 'pending_ocr' || candidate.status === 'ocr_running')
    ))).toBe(false)
  })
})
