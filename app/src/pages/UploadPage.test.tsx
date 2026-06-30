import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import { ProgressPage } from './ProgressPage'
import { UploadPage } from './UploadPage'

function renderUploadPage() {
  render(
    <AppStateProvider>
      <MemoryRouter initialEntries={['/tasks/task-1/upload']}>
        <Routes>
          <Route path="/tasks/:taskId/upload" element={<UploadPage />} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}

function renderUploadToProgressFlow() {
  render(
    <AppStateProvider>
      <MemoryRouter initialEntries={['/tasks/task-1/upload']}>
        <Routes>
          <Route path="/tasks/:taskId/upload" element={<UploadPage />} />
          <Route path="/tasks/:taskId/progress" element={<ProgressPage />} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}

describe('UploadPage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('adds selected local images to the organizer with real preview thumbnails', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:essay-photo-preview'),
      revokeObjectURL: vi.fn(),
    })
    renderUploadPage()

    const file = new File(['image-bytes'], 'essay-photo.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('选择本地图片'), file)

    expect(screen.getByText('essay-photo.png')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'essay-photo.png 预览' })).toHaveAttribute(
      'src',
      'blob:essay-photo-preview',
    )
  })

  it('removes selected local images from the organizer and releases their preview URLs', async () => {
    const user = userEvent.setup()
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:essay-photo-preview'),
      revokeObjectURL,
    })
    renderUploadPage()

    const file = new File(['image-bytes'], 'essay-photo.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('选择本地图片'), file)
    await user.click(screen.getByRole('button', { name: '删除 essay-photo.png' }))

    expect(screen.queryByText('essay-photo.png')).not.toBeInTheDocument()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:essay-photo-preview')
  })

  it('starts mock OCR and shows editable OCR draft text for the organized images', async () => {
    const user = userEvent.setup()
    renderUploadPage()

    await user.click(screen.getByRole('button', { name: '开始模拟 OCR' }))

    expect(screen.getByText('OCR 识别完成')).toBeInTheDocument()
    const ocrDraft = screen.getByRole('textbox', { name: '模拟 OCR 文本草稿' }) as HTMLTextAreaElement
    expect(ocrDraft.value).toContain('作文图片 1')
  })

  it('confirms mock OCR text into the task progress queue', async () => {
    const user = userEvent.setup()
    renderUploadToProgressFlow()

    await user.click(screen.getByRole('button', { name: '开始模拟 OCR' }))
    const ocrDraft = screen.getByRole('textbox', { name: '模拟 OCR 文本草稿' })
    await user.clear(ocrDraft)
    await user.type(ocrDraft, 'Confirmed OCR essay text')
    await user.click(screen.getByRole('button', { name: '确认 OCR 文本' }))

    expect(screen.getByRole('heading', { name: '批改进度' })).toBeInTheDocument()
    expect(screen.getAllByText('作文 11').length).toBeGreaterThan(0)
    expect(screen.getAllByText('待批改').length).toBeGreaterThan(0)
  })

  it('splits organized images into one queued essay per image when split mode is selected', async () => {
    const user = userEvent.setup()
    renderUploadToProgressFlow()

    await user.click(screen.getByRole('button', { name: '拆分页' }))
    await user.click(screen.getByRole('button', { name: '开始模拟 OCR' }))
    await user.click(screen.getByRole('button', { name: '确认 OCR 文本' }))

    expect(screen.getByRole('heading', { name: '批改进度' })).toBeInTheDocument()
    expect(screen.getAllByText('作文 11').length).toBeGreaterThan(0)
    expect(screen.getAllByText('作文 16').length).toBeGreaterThan(0)
  })

  it('shows manual essay groups and updates essay count when pages move between groups', async () => {
    const user = userEvent.setup()
    renderUploadPage()

    await user.click(screen.getByRole('button', { name: '手动分组' }))

    expect(screen.getByText('作文组 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新增作文组' })).toBeInTheDocument()
    expect(screen.getByText('当前 6 张，确认 OCR 后将提交 1 篇作文。')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '新增作文组' }))
    await user.click(screen.getByRole('button', { name: '将 Page 2 移到下一篇' }))

    expect(screen.getByText('作文组 2')).toBeInTheDocument()
    expect(screen.getByText('当前 6 张，确认 OCR 后将提交 2 篇作文。')).toBeInTheDocument()
  })
})
