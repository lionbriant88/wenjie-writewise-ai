import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UploadSourceSelector } from './UploadSourceSelector'

describe('UploadSourceSelector', () => {
  it('uses Kimi wording and restricted image accept types for a multimodal task', () => {
    render(<UploadSourceSelector multimodal onAddMockImage={() => {}} onSelectImages={() => {}} />)
    expect(screen.queryByText(/OCR/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText('选择图片')).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp')
  })

  it('keeps legacy OCR guidance available when not in multimodal mode', () => {
    render(<UploadSourceSelector onAddMockImage={() => {}} onSelectImages={() => {}} />)
    expect(screen.getAllByText(/OCR/i).length).toBeGreaterThan(0)
  })
})
