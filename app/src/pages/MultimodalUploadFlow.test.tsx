import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useRef } from 'react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import type { AppState } from '../context/appStateContextValue'
import { useAppState } from '../context/useAppState'
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
        dimensions: [{ id: 'content', name: 'Content', weight: 100, description: 'Answer the material.', deductionFocus: [], sourceEvidence: ['A short source material.'] }],
      },
    })
    navigate(`/tasks/${taskId}/upload`)
  }, [createTask, navigate])

  return null
}

function renderMaterialFlow() {
  return render(
    <AppStateProvider>
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

  it('queues the original files in displayed order exactly once and keeps OCR out of material upload and progress', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn((file: File) => `blob:${file.name}`), revokeObjectURL: vi.fn() })
    const { container } = renderMaterialFlow()
    await screen.findByRole('button', { name: '为学生1添加作文' })

    expect(document.body.textContent).not.toMatch(/OCR/i)
    const fileA = new File(['page-a'], 'first-page.png', { type: 'image/png' })
    const fileB = new File(['page-b'], 'second-page.png', { type: 'image/png' })
    await user.click(screen.getByRole('button', { name: '为学生1添加作文' }))
    await user.upload(screen.getByLabelText('上传相册图片'), [fileA, fileB])
    await user.dblClick(screen.getByRole('button', { name: '提交作文并进入批改' }))

    await screen.findByRole('heading', { name: /批改进度/ })
    expect(container.querySelector('#upload-class-name')).toBeNull()
    expect(screen.queryByRole('button', { name: /提交作文并进入批改/ })).not.toBeInTheDocument()

    const materialTask = capturedState?.tasks.find((task) => task.taskName === 'Material task')
    await waitFor(() => expect(capturedState?.essays.filter((essay) => essay.taskId === materialTask?.id)).toHaveLength(1))
    const queued = capturedState?.essays.find((essay) => essay.taskId === materialTask?.id)
    expect(queued).toBeDefined()
    expect(queued?.pages).toHaveLength(2)
    expect(queued?.pages[0].sourceFile).toBe(fileA)
    expect(queued?.pages[1].sourceFile).toBe(fileB)
    expect(queued?.essayNumber).toBe('学生1')
    expect(queued?.pageOrder).toEqual(queued?.pages.map((page) => page.id))
    expect(document.body.textContent).not.toMatch(/OCR/i)
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
