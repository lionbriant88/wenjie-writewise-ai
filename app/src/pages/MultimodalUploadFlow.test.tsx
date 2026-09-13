import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useRef } from 'react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import type { AppState } from '../context/appStateContextValue'
import { useAppState } from '../context/useAppState'
import { createMockGradingClient } from '../services/grading/mockGradingClient'
import type { TaskGradingSchedulerOptions } from '../services/grading/taskGradingScheduler'
import type { GradingClient } from '../services/grading/types'
import { ProgressPage } from './ProgressPage'
import { UploadPage } from './UploadPage'

let capturedState: AppState | undefined

function StateCapture() {
  capturedState = useAppState()
  return null
}

function MaterialTaskSetup() {
  const { createTask } = useAppState()
  const navigate = useNavigate()
  const didCreate = useRef(false)

  useEffect(() => {
    if (didCreate.current) return
    didCreate.current = true
    const taskId = createTask({
      taskName: 'Material task',
      fullScore: 15,
      materialContext: {
        materialSummary: 'A short source material.',
        writingRequirements: ['Write a response to the material.'],
        constraints: [],
        reviewWarnings: [],
      },
      rubricDraft: {
        source: 'ai',
        status: 'confirmed',
        writingGoal: 'Respond to the material.',
        offTopicCriteria: [],
        excellentFeatures: [],
        reviewTriggers: [],
        dimensions: [
          { id: 'content', name: 'Content', weight: 95, description: 'Answer the material.', deductionFocus: [], sourceEvidence: ['A short source material.'] },
          { id: 'legibility', name: 'Legibility', weight: 5, description: 'Keep the response readable.', deductionFocus: [], sourceEvidence: [] },
        ],
      },
    })
    navigate(`/tasks/${taskId}/upload`)
  }, [createTask, navigate])

  return null
}

function renderMaterialFlow(
  gradingClient?: GradingClient,
  gradingSchedulerOptions?: TaskGradingSchedulerOptions,
) {
  return render(
    <AppStateProvider
      gradingClient={gradingClient}
      gradingSchedulerOptions={gradingSchedulerOptions}
    >
      <StateCapture />
      <MemoryRouter initialEntries={['/material-setup']}>
        <Routes>
          <Route path="/material-setup" element={<MaterialTaskSetup />} />
          <Route path="/tasks/:taskId/upload" element={<UploadPage />} />
          <Route path="/tasks/:taskId/progress" element={<ProgressPage />} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}

describe('material task direct image upload flow', () => {
  afterEach(() => {
    capturedState = undefined
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('queues multiple students once and starts every pending essay through one task action', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn((file: File) => `blob:${file.name}`), revokeObjectURL: vi.fn() })
    const localClient = createMockGradingClient()
    const gradeImages = vi.fn(localClient.gradeImages)
    const { container } = renderMaterialFlow(
      { gradeImages },
      { mode: 'adaptive-v1', hardLimit: 2, stableSuccessWindow: 1 },
    )
    await screen.findByRole('button', { name: '为学生1添加作文' })

    expect(document.body.textContent).not.toMatch(/OCR/i)
    const fileA = new File(['page-a'], 'first-page.png', { type: 'image/png' })
    const fileB = new File(['page-b'], 'second-page.png', { type: 'image/png' })
    await user.click(screen.getByRole('button', { name: '为学生1添加作文' }))
    await user.upload(screen.getByLabelText('上传相册图片'), [fileA, fileB])
    await user.click(screen.getByRole('button', { name: '添加下一位学生' }))
    const fileC = new File(['page-c'], 'student-2.png', { type: 'image/png' })
    await user.click(screen.getByRole('button', { name: '为学生2添加作文' }))
    await user.upload(screen.getAllByLabelText('上传相册图片')[1], fileC)
    await user.click(screen.getByRole('button', { name: '提交作文并进入批改' }))

    await screen.findByRole('heading', { name: /批改进度/ })
    expect(container.querySelector('#upload-class-name')).toBeNull()
    expect(screen.queryByRole('button', { name: /提交作文并进入批改/ })).not.toBeInTheDocument()

    const materialTask = capturedState?.tasks.find((task) => task.taskName === 'Material task')
    await waitFor(() => expect(capturedState?.essays.filter((essay) => essay.taskId === materialTask?.id)).toHaveLength(2))
    const queued = capturedState?.essays.filter((essay) => essay.taskId === materialTask?.id) ?? []
    expect(queued.map((essay) => essay.essayNumber)).toEqual(['学生1', '学生2'])
    expect(queued.map((essay) => essay.status)).toEqual(['pending_grading', 'pending_grading'])
    expect(queued[0]?.pages).toHaveLength(2)
    expect(queued[0]?.pages[0].sourceFile).toBe(fileA)
    expect(queued[0]?.pages[1].sourceFile).toBe(fileB)
    expect(queued[1]?.pages[0].sourceFile).toBe(fileC)
    expect(queued[0]?.pageOrder).toEqual(queued[0]?.pages.map((page) => page.id))
    expect(screen.getAllByRole('button', { name: '开始批改全部待处理作文' })).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: '开始批改全部待处理作文' }))

    await waitFor(() => expect(gradeImages).toHaveBeenCalledTimes(2))
    expect(document.body.textContent).not.toMatch(/OCR|mock 回退/i)
  })

  it('keeps repeated camera captures as ordered File pages on the selected student card', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn((file: File) => `blob:${file.name}`), revokeObjectURL: vi.fn() })
    renderMaterialFlow(createMockGradingClient(), { mode: 'adaptive-v1', hardLimit: 2, stableSuccessWindow: 1 })
    await screen.findByRole('button', { name: '为学生1添加作文' })
    const firstStudentPhoto = new File(['student one'], 'first.jpg', { type: 'image/jpeg' })
    const albumPage = new File(['album page'], 'album.png', { type: 'image/png' })
    const cameraPage = new File(['camera page'], 'capture.jpg', { type: 'image/jpeg' })
    await user.click(screen.getByRole('button', { name: '为学生1添加作文' }))
    await user.upload(screen.getByLabelText('拍照上传'), firstStudentPhoto)
    await user.click(screen.getByRole('button', { name: '添加下一位学生' }))
    await user.click(screen.getByRole('button', { name: '为学生2添加作文' }))
    await user.upload(screen.getAllByLabelText('上传相册图片')[1], albumPage)
    await user.upload(screen.getAllByLabelText('拍照上传')[1], cameraPage)
    await user.upload(screen.getAllByLabelText('拍照上传')[1], cameraPage)
    await user.click(screen.getByRole('button', { name: '提交作文并进入批改' }))

    await screen.findByRole('heading', { name: /批改进度/ })
    const materialTask = capturedState?.tasks.find((task) => task.taskName === 'Material task')
    const queued = capturedState?.essays.filter((essay) => essay.taskId === materialTask?.id) ?? []
    expect(queued.map((essay) => essay.essayNumber)).toEqual(['学生1', '学生2'])
    expect(queued[0]?.pages).toHaveLength(1)
    expect(queued[0]?.pages[0].sourceFile).toBe(firstStudentPhoto)
    expect(queued[1]?.pages).toHaveLength(3)
    expect(queued[1]?.pages[0].sourceFile).toBe(albumPage)
    expect(queued[1]?.pages[1].sourceFile).toBe(cameraPage)
    expect(queued[1]?.pages[2].sourceFile).toBe(cameraPage)
    expect(queued[1]?.pages.map((page) => page.pageNumber)).toEqual([1, 2, 3])
    expect(queued[1]?.pageOrder).toEqual(queued[1]?.pages.map((page) => page.id))
    expect(new Set(queued[1]?.pageOrder).size).toBe(3)
  })

  it('blocks eleven otherwise valid image pages for one student before it changes route or queues essays', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn((file: File) => `blob:${file.name}`), revokeObjectURL: vi.fn() })
    renderMaterialFlow()
    await screen.findByRole('button', { name: '为学生1添加作文' })

    const pages = Array.from({ length: 11 }, (_, index) => new File([`page-${index}`], `page-${index}.png`, { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: '为学生1添加作文' }))
    await user.upload(screen.getByLabelText('上传相册图片'), pages)

    expect(screen.getByRole('alert')).toHaveTextContent('10')
    expect(screen.getByRole('button', { name: '提交作文并进入批改' })).toBeDisabled()
    const materialTask = capturedState?.tasks.find((task) => task.taskName === 'Material task')
    expect(capturedState?.essays.filter((essay) => essay.taskId === materialTask?.id)).toHaveLength(0)
  })
})
