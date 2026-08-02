import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MaterialImageOrganizer } from './MaterialImageOrganizer'

function file(name: string, type = 'image/png') {
  return new File(['image'], name, { type })
}

afterEach(() => {
  vi.restoreAllMocks()
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
})
