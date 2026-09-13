import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppStateProvider } from '../context/AppStateContext'
import { useAppState } from '../context/useAppState'
import { convertPdfToImages } from '../utils/pdfToImages'
import { UploadPage } from './UploadPage'

vi.mock('../utils/pdfToImages', () => ({
  convertPdfToImages: vi.fn(async () => [
    new File(['page one'], 'essay-page-1.png', { type: 'image/png' }),
    new File(['page two'], 'essay-page-2.png', { type: 'image/png' }),
  ]),
}))

function Probe() {
  const { essays } = useAppState()
  const queued = essays.slice(-2)
  return (
    <div>
      <p data-testid="essay-names">{queued.map((essay) => essay.essayNumber).join(',')}</p>
      <p data-testid="page-counts">{queued.map((essay) => essay.pageCount).join(',')}</p>
      <p data-testid="file-name">{queued.at(-1)?.pages[0]?.sourceFile?.name}</p>
      <p data-testid="last-page-numbers">{queued.at(-1)?.pages.map((page) => page.pageNumber).join(',')}</p>
    </div>
  )
}

function renderPage() {
  return render(
    <AppStateProvider>
      <MemoryRouter initialEntries={['/tasks/task-1/upload']}>
        <Routes>
          <Route path="/tasks/:taskId/upload" element={<UploadPage />} />
          <Route path="/tasks/:taskId/progress" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}

function deferPdfConversion() {
  let resolve!: (files: File[]) => void
  const result = new Promise<File[]>((complete) => { resolve = complete })
  vi.mocked(convertPdfToImages).mockReturnValueOnce(result)
  return resolve
}

function FailedTaskRedirect() {
  const { createTask } = useAppState()
  const [taskId, setTaskId] = useState('')

  useEffect(() => {
    setTaskId(createTask({
      taskName: 'Fallback task',
      fullScore: 15,
      materialProcessingStatus: 'failed',
      materialContext: {
        materialSummary: '教师确认的写作要求：Write clearly.',
        writingRequirements: ['Write clearly.'],
        constraints: [],
        reviewWarnings: [],
      },
      rubricDraft: {
        source: 'teacher',
        writingGoal: 'Write clearly.',
        offTopicCriteria: [],
        dimensions: [
          { id: 'content', name: 'Content', weight: 95, description: 'Address the task.', deductionFocus: [], sourceEvidence: [] },
          { id: 'legibility', name: 'Legibility', weight: 5, description: 'Keep writing readable.', deductionFocus: [], sourceEvidence: [] },
        ],
        excellentFeatures: [],
        reviewTriggers: [],
        status: 'confirmed',
      },
    }))
  }, [createTask])

  return taskId ? <Navigate to={`/tasks/${taskId}/upload`} replace /> : null
}

function renderFailedTaskPage() {
  render(
    <AppStateProvider>
      <MemoryRouter initialEntries={['/failed-task']}>
        <Routes>
          <Route path="/failed-task" element={<FailedTaskRedirect />} />
          <Route path="/tasks/:taskId/upload" element={<UploadPage />} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}

describe('UploadPage student cards', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('starts with 学生1 and reveals exactly three upload choices from the plus button', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByRole('button', { name: '学生1' })).toBeInTheDocument()
    expect(screen.queryByLabelText('班级')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '一张一篇' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '为学生1添加作文' }))

    expect(screen.getByLabelText('上传相册图片')).toHaveAttribute('multiple')
    expect(screen.getByLabelText('上传相册图片')).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp')
    expect(screen.getByLabelText('上传PDF文件')).toHaveAttribute('accept', 'application/pdf')
    expect(screen.getByLabelText('拍照上传')).toHaveAttribute('capture', 'environment')
  })

  it('repeats the material-analysis fallback warning without changing the student upload workspace', async () => {
    renderFailedTaskPage()

    expect(await screen.findByRole('status')).toHaveTextContent(
      '材料暂时无法读取，本任务将仅按已填写的写作要求评分。',
    )
    expect(screen.getByRole('button', { name: '学生1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '为学生1添加作文' })).toBeInTheDocument()
  })

  it('edits a student name, keeps multiple images together and defaults the next blank name to 学生2', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn((file: File) => `blob:${file.name}`), revokeObjectURL: vi.fn() })
    renderPage()

    await user.click(screen.getByRole('button', { name: '学生1' }))
    const nameInput = screen.getByLabelText('学生1姓名')
    await user.clear(nameInput)
    await user.type(nameInput, '李明{Enter}')

    await user.click(screen.getByRole('button', { name: '为李明添加作文' }))
    await user.upload(screen.getByLabelText('上传相册图片'), [
      new File(['page one'], 'li-ming-1.png', { type: 'image/png' }),
      new File(['page two'], 'li-ming-2.jpg', { type: 'image/jpeg' }),
    ])

    await user.click(screen.getByRole('button', { name: '添加下一位学生' }))
    await user.click(screen.getByRole('button', { name: '为学生2添加作文' }))
    await user.upload(screen.getAllByLabelText('上传相册图片')[1], new File(['page'], 'student-2.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: '提交作文并进入批改' }))

    expect(screen.getByTestId('essay-names')).toHaveTextContent('李明,学生2')
    expect(screen.getByTestId('page-counts')).toHaveTextContent('2,1')
    expect(screen.getByTestId('file-name')).toHaveTextContent('student-2.png')
  })

  it('adds every converted PDF page to the same student card', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn((file: File) => `blob:${file.name}`), revokeObjectURL: vi.fn() })
    renderPage()

    await user.click(screen.getByRole('button', { name: '为学生1添加作文' }))
    await user.upload(
      screen.getByLabelText('上传PDF文件'),
      new File(['pdf'], 'student-essay.pdf', { type: 'application/pdf' }),
    )

    expect(await screen.findByRole('img', { name: 'essay-page-1.png 预览' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'essay-page-2.png 预览' })).toBeInTheDocument()
  })

  it('rejects a late PDF page when a camera upload has filled the tenth page', async () => {
    const user = userEvent.setup()
    const createObjectURL = vi.fn((file: File) => `blob:${file.name}`)
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() })
    const resolvePdf = deferPdfConversion()
    renderPage()
    await user.click(screen.getByRole('button', { name: '为学生1添加作文' }))
    await user.upload(screen.getByLabelText('上传相册图片'), Array.from({ length: 9 }, (_, index) => (
      new File(['page'], `page-${index + 1}.png`, { type: 'image/png' })
    )))
    await user.upload(screen.getByLabelText('上传PDF文件'), new File(['pdf'], 'late.pdf', { type: 'application/pdf' }))
    await user.upload(screen.getByLabelText('拍照上传'), new File(['photo'], 'camera.jpg', { type: 'image/jpeg' }))

    await act(async () => { resolvePdf([new File(['pdf page'], 'late.png', { type: 'image/png' })]) })

    expect(screen.getAllByRole('img', { name: /预览$/ })).toHaveLength(10)
    expect(screen.getByRole('alert')).toHaveTextContent('每位学生最多上传 10 页作文。')
    expect(createObjectURL).toHaveBeenCalledTimes(10)
    await user.click(screen.getByRole('button', { name: '提交作文并进入批改' }))
    expect(screen.getByTestId('last-page-numbers')).toHaveTextContent('1,2,3,4,5,6,7,8,9,10')
  })

  it('does not allocate previews for a PDF whose student card was deleted', async () => {
    const user = userEvent.setup()
    const createObjectURL = vi.fn((file: File) => `blob:${file.name}`)
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const resolvePdf = deferPdfConversion()
    renderPage()
    await user.click(screen.getByRole('button', { name: '为学生1添加作文' }))
    await user.upload(screen.getByLabelText('拍照上传'), new File(['photo'], 'camera.jpg', { type: 'image/jpeg' }))
    await user.upload(screen.getByLabelText('上传PDF文件'), new File(['pdf'], 'late.pdf', { type: 'application/pdf' }))
    await user.click(screen.getByRole('button', { name: '添加下一位学生' }))
    await user.click(screen.getByRole('button', { name: '删除学生1' }))

    await act(async () => { resolvePdf([new File(['pdf page'], 'late.png', { type: 'image/png' })]) })

    expect(screen.queryByRole('img', { name: /预览$/ })).not.toBeInTheDocument()
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:camera.jpg')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not allocate previews when PDF conversion finishes after unmount', async () => {
    const user = userEvent.setup()
    const createObjectURL = vi.fn((file: File) => `blob:${file.name}`)
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const resolvePdf = deferPdfConversion()
    const { unmount } = renderPage()
    await user.click(screen.getByRole('button', { name: '为学生1添加作文' }))
    await user.upload(screen.getByLabelText('拍照上传'), new File(['photo'], 'camera.jpg', { type: 'image/jpeg' }))
    await user.upload(screen.getByLabelText('上传PDF文件'), new File(['pdf'], 'late.pdf', { type: 'application/pdf' }))
    unmount()

    await act(async () => { resolvePdf([new File(['pdf page'], 'late.png', { type: 'image/png' })]) })

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:camera.jpg')
  })

  it.each([
    [new File(['gif'], 'essay.gif', { type: 'image/gif' })],
    [new File(['heic'], 'essay.heic', { type: 'image/heic' })],
    [new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })],
  ])('rejects unsupported or oversized local images before queueing', async (file) => {
    const user = userEvent.setup({ applyAccept: false })
    renderPage()
    await user.click(screen.getByRole('button', { name: '为学生1添加作文' }))
    await user.upload(screen.getByLabelText('上传相册图片'), file)

    expect(screen.getByRole('alert')).toHaveTextContent('仅支持 PNG、JPEG、WebP 图片，且单张不超过 8 MiB。')
    expect(screen.queryByText(file.name)).not.toBeInTheDocument()
  })
})
