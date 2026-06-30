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
    localStorage.clear()
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

    await user.click(screen.getByRole('button', { name: '开始模拟 OCR（预计 6 篇）' }))

    expect(screen.getByText('OCR 识别完成')).toBeInTheDocument()
    const ocrDraft = screen.getByRole('textbox', { name: '作文 1 OCR 文本' }) as HTMLTextAreaElement
    expect(ocrDraft.value).toContain('作文图片 1')
  })

  it('confirms mock OCR text into the task progress queue', async () => {
    const user = userEvent.setup()
    renderUploadToProgressFlow()

    await user.click(screen.getByRole('button', { name: '开始模拟 OCR（预计 6 篇）' }))
    const ocrDraft = screen.getByRole('textbox', { name: '作文 1 OCR 文本' })
    await user.clear(ocrDraft)
    await user.type(ocrDraft, 'Confirmed OCR essay text')
    await user.click(screen.getByRole('button', { name: '确认 OCR 文本' }))

    expect(screen.getByRole('heading', { name: '批改进度' })).toBeInTheDocument()
    expect(screen.getAllByText('作文 11').length).toBeGreaterThan(0)
    expect(screen.getAllByText('待批改').length).toBeGreaterThan(0)
  })

  it('shows batch grouping modes and removes old top-level grouping actions', () => {
    renderUploadPage()

    expect(screen.getByRole('button', { name: '一张一篇' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '每 2 张一篇' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '混合页数' })).toBeInTheDocument()
    expect(screen.getByText('当前按上传顺序排列，自动分组将按此顺序生成作文。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始模拟 OCR（预计 6 篇）' })).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: '合并为多页作文' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '拆分页' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '手动分组' })).not.toBeInTheDocument()
  })

  it('groups images into fixed two-page essays before OCR', async () => {
    const user = userEvent.setup()
    renderUploadToProgressFlow()

    await user.click(screen.getByRole('button', { name: '每 2 张一篇' }))

    expect(screen.getByText('当前按上传顺序排列，自动分组将按此顺序生成作文。')).toBeInTheDocument()
    expect(screen.getByText('当前 6 张图片，预计生成 3 篇作文')).toBeInTheDocument()
    expect(screen.getByText('作文 1 · 共 2 页')).toBeInTheDocument()
    expect(screen.getByText('作文 3 · 共 2 页')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '开始模拟 OCR（预计 3 篇）' }))
    await user.click(screen.getByRole('button', { name: '确认 OCR 文本' }))

    expect(screen.getByRole('heading', { name: '批改进度' })).toBeInTheDocument()
    expect(screen.getAllByText('作文 11').length).toBeGreaterThan(0)
    expect(screen.getAllByText('作文 13').length).toBeGreaterThan(0)
  })

  it('shows a mixed-pages guide with dismiss and never-remind actions', async () => {
    const user = userEvent.setup()
    renderUploadPage()

    await user.click(screen.getByRole('button', { name: '混合页数' }))

    expect(
      screen.getByText(
        '混合页数模式：未合并的图片会默认作为单页作文。点击图片可选中，多选 2 张以上后可合并为一篇作文；多页作文卡片内可拆分。',
      ),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '知道了' }))
    expect(screen.queryByText('混合页数模式：未合并的图片会默认作为单页作文。')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看操作提示' })).toBeInTheDocument()
  })

  it('stores the mixed-pages never-remind preference locally', async () => {
    const user = userEvent.setup()
    renderUploadPage()

    await user.click(screen.getByRole('button', { name: '混合页数' }))
    await user.click(screen.getByRole('button', { name: '不再提醒' }))

    expect(localStorage.getItem('wenjie-hide-mixed-grouping-guide')).toBe('true')
    expect(screen.queryByText('混合页数模式：未合并的图片会默认作为单页作文。')).not.toBeInTheDocument()
  })

  it('keeps uploaded images as one queued essay per image in default single mode', async () => {
    const user = userEvent.setup()
    renderUploadToProgressFlow()

    await user.click(screen.getByRole('button', { name: '开始模拟 OCR（预计 6 篇）' }))
    await user.click(screen.getByRole('button', { name: '确认 OCR 文本' }))

    expect(screen.getByRole('heading', { name: '批改进度' })).toBeInTheDocument()
    expect(screen.getAllByText('作文 11').length).toBeGreaterThan(0)
    expect(screen.getAllByText('作文 16').length).toBeGreaterThan(0)
  })

  it('merges selected pages into one essay group in mixed mode', async () => {
    const user = userEvent.setup()
    renderUploadPage()

    await user.click(screen.getByRole('button', { name: '混合页数' }))

    expect(screen.getByText('作文 1 · 共 1 页')).toBeInTheDocument()
    expect(screen.getByText('当前 6 张图片，预计生成 6 篇作文')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '选择第 2 张图片' }))
    expect(screen.queryByRole('button', { name: '合并为一篇作文（已选 1 张）' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '选择第 3 张图片' }))
    await user.click(screen.getByRole('button', { name: '合并为一篇作文（已选 2 张）' }))

    expect(screen.getByText('作文 2 · 共 2 页')).toBeInTheDocument()
    expect(screen.getByText('当前 6 张图片，预计生成 5 篇作文')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '拆分此作文 2' })).toBeInTheDocument()
  })

  it('splits a merged essay group back into single-page essays', async () => {
    const user = userEvent.setup()
    renderUploadPage()

    await user.click(screen.getByRole('button', { name: '混合页数' }))
    await user.click(screen.getByRole('button', { name: '选择第 2 张图片' }))
    await user.click(screen.getByRole('button', { name: '选择第 3 张图片' }))
    await user.click(screen.getByRole('button', { name: '合并为一篇作文（已选 2 张）' }))
    await user.click(screen.getByRole('button', { name: '拆分此作文 2' }))

    expect(screen.getByText('当前 6 张图片，预计生成 6 篇作文')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '拆分此作文 2' })).not.toBeInTheDocument()
  })

  it('confirms manually grouped OCR drafts as separate queued essays', async () => {
    const user = userEvent.setup()
    renderUploadToProgressFlow()

    await user.click(screen.getByRole('button', { name: '混合页数' }))
    await user.click(screen.getByRole('button', { name: '选择第 2 张图片' }))
    await user.click(screen.getByRole('button', { name: '选择第 3 张图片' }))
    await user.click(screen.getByRole('button', { name: '合并为一篇作文（已选 2 张）' }))
    await user.click(screen.getByRole('button', { name: '开始模拟 OCR（预计 5 篇）' }))

    expect(screen.getByRole('textbox', { name: '作文 1 OCR 文本' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '作文 2 OCR 文本' })).toBeInTheDocument()

    await user.clear(screen.getByRole('textbox', { name: '作文 1 OCR 文本' }))
    await user.type(screen.getByRole('textbox', { name: '作文 1 OCR 文本' }), 'Manual group one text')
    await user.clear(screen.getByRole('textbox', { name: '作文 2 OCR 文本' }))
    await user.type(screen.getByRole('textbox', { name: '作文 2 OCR 文本' }), 'Manual group two text')
    await user.click(screen.getByRole('button', { name: '确认 OCR 文本' }))

    expect(screen.getByRole('heading', { name: '批改进度' })).toBeInTheDocument()
    expect(screen.getAllByText('作文 11').length).toBeGreaterThan(0)
    expect(screen.getAllByText('作文 12').length).toBeGreaterThan(0)
  })
})
