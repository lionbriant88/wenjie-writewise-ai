import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MaterialImageOrganizer } from './MaterialImageOrganizer'

function file(name: string, type = 'image/png') {
  return new File(['image'], name, { type })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('MaterialImageOrganizer', () => {
  it('accepts jpeg, png and webp only, creates previews, and revokes every created URL on deletion and unmount', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const createObjectURL = vi.fn((input: File) => `blob:${input.name}`)
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const view = render(<MaterialImageOrganizer pages={[]} onChange={onChange} disabled={false} />)

    await user.upload(screen.getByLabelText('材料图片'), [file('one.png'), file('two.webp', 'image/webp'), file('not-image.txt', 'text/plain')])
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ file: expect.any(File), previewUrl: 'blob:one.png' }),
      expect.objectContaining({ file: expect.any(File), previewUrl: 'blob:two.webp' }),
    ]))
    expect(createObjectURL).toHaveBeenCalledTimes(2)

    view.rerender(<MaterialImageOrganizer pages={[
      { id: 'one', file: file('one.png'), previewUrl: 'blob:one.png' },
      { id: 'two', file: file('two.webp', 'image/webp'), previewUrl: 'blob:two.webp' },
    ]} onChange={onChange} disabled={false} />)
    expect(screen.getByRole('button', { name: '上移 one.png' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '删除 one.png' }))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:one.png')
    view.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:two.webp')
  })

  it('moves pages in order and prevents mutations while generation is running', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const pages = [
      { id: 'one', file: file('one.png'), previewUrl: 'blob:one.png' },
      { id: 'two', file: file('two.png'), previewUrl: 'blob:two.png' },
    ]
    const { rerender } = render(<MaterialImageOrganizer pages={pages} onChange={onChange} disabled={false} />)

    await user.click(screen.getByRole('button', { name: '下移 one.png' }))
    expect(onChange).toHaveBeenCalledWith([pages[1], pages[0]])

    rerender(<MaterialImageOrganizer pages={pages} onChange={onChange} disabled />)
    expect(screen.getByLabelText('材料图片')).toBeDisabled()
    expect(screen.getByRole('button', { name: '删除 one.png' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下移 one.png' })).toBeDisabled()
  })

  it('caps the accepted pages at ten without creating URLs for overflow and keeps repeated Files independently manageable', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const createObjectURL = vi.fn((input: File) => `blob:${input.name}-${createObjectURL.mock.calls.length}`)
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })
    const tenView = render(<MaterialImageOrganizer pages={[]} onChange={onChange} disabled={false} />)
    const repeated = file('repeat.jpg', 'image/jpeg')
    const ten = Array.from({ length: 10 }, (_, index) => file(`page-${index}.png`))

    await user.upload(screen.getByLabelText('材料图片'), [...ten, file('overflow.png')])
    expect(createObjectURL).toHaveBeenCalledTimes(10)
    const accepted = onChange.mock.calls[0]?.[0]
    expect(accepted).toHaveLength(10)
    tenView.rerender(<MaterialImageOrganizer pages={accepted} onChange={onChange} disabled={false} />)
    expect(screen.getByLabelText('材料图片')).toBeDisabled()
    expect(screen.getByText('最多上传 10 张材料图片。')).toBeInTheDocument()

    render(<MaterialImageOrganizer pages={[]} onChange={onChange} disabled={false} />)
    await user.upload(screen.getAllByLabelText('材料图片')[1], [repeated, repeated])
    const repeatedPages = onChange.mock.calls[1]?.[0]
    expect(repeatedPages).toHaveLength(2)
    expect(repeatedPages[0].id).not.toBe(repeatedPages[1].id)
    expect(repeatedPages[0].previewUrl).not.toBe(repeatedPages[1].previewUrl)
  })
})
