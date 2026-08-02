import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import { useAppState } from '../context/useAppState'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { UploadPage } from './UploadPage'

function Probe() {
  const { essays } = useAppState()
  const essay = essays.at(-1)
  return <div><p data-testid="essay-status">{essay?.status}</p><p data-testid="page-order">{essay?.pageOrder.join(',')}</p><p data-testid="file-name">{essay?.pages[0]?.sourceFile?.name}</p></div>
}

function renderPage() {
  render(<AppStateProvider><MemoryRouter initialEntries={['/tasks/task-1/upload']}><Routes><Route path="/tasks/:taskId/upload" element={<UploadPage />} /><Route path="/tasks/:taskId/progress" element={<Probe />} /></Routes></MemoryRouter></AppStateProvider>)
}

describe('UploadPage direct image queue', () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

  it('keeps upload, preview and grouping controls without rendering OCR controls', async () => {
    const user = userEvent.setup({ applyAccept: false })
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:essay-preview'), revokeObjectURL: vi.fn() })
    renderPage()
    await user.upload(screen.getByLabelText('选择图片'), new File(['image'], 'essay-photo.png', { type: 'image/png' }))
    expect(screen.getByRole('img', { name: 'essay-photo.png 预览' })).toHaveAttribute('src', 'blob:essay-preview')
    expect(screen.getByRole('button', { name: '一张一篇' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '每 2 张一篇' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '混合页数' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /开始 OCR|确认 OCR|mock OCR|real OCR/i })).not.toBeInTheDocument()
  })

  it('requires a class, retains the original File and queues grouped pages in direct grading state', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:essay-preview'), revokeObjectURL: vi.fn() })
    renderPage()
    const file = new File(['image'], 'handwriting.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('选择图片'), file)
    const confirm = screen.getByRole('button', { name: '确认分组并进入批改' })
    await user.clear(screen.getByLabelText('班级'))
    expect(confirm).toBeDisabled()
    await user.type(screen.getByLabelText('班级'), '九年级 3 班')
    await user.click(confirm)
    expect(screen.getByTestId('essay-status')).toHaveTextContent('pending_grading')
    expect(screen.getByTestId('file-name')).toHaveTextContent('handwriting.png')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('preserves display order when a grouped essay is queued', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: '添加模拟图片' }))
    await user.click(screen.getByRole('button', { name: '添加模拟图片' }))
    await user.click(screen.getByRole('button', { name: '每 2 张一篇' }))
    await user.type(screen.getByLabelText('班级'), '九年级 3 班')
    await user.click(screen.getByRole('button', { name: '确认分组并进入批改' }))
    expect(screen.getByTestId('page-order').textContent?.split(',')).toHaveLength(2)
  })

  it.each([
    [new File(['gif'], 'essay.gif', { type: 'image/gif' })],
    [new File(['heic'], 'essay.heic', { type: 'image/heic' })],
    [new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })],
  ])('rejects unsupported or oversized local images before queueing', async (file) => {
    const user = userEvent.setup({ applyAccept: false })
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy)
    renderPage()
    await user.upload(screen.getByLabelText('选择图片'), file)
    expect(screen.getByRole('alert')).toHaveTextContent('仅支持 PNG、JPEG、WebP 图片，且单张不超过 8 MiB。')
    expect(screen.queryByText(file.name)).not.toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
