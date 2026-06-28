import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
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
})
