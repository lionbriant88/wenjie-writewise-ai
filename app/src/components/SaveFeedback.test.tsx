import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SaveFeedback } from './SaveFeedback'

describe('SaveFeedback', () => {
  it('inserts and removes status text based on show', () => {
    const { rerender } = render(<SaveFeedback show={false} label="Saved changes" />)

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('Saved changes')).not.toBeInTheDocument()

    rerender(<SaveFeedback show label="Saved changes" />)

    expect(screen.getByRole('status')).toHaveTextContent('Saved changes')

    rerender(<SaveFeedback show={false} label="Saved changes" />)

    expect(screen.queryByText('Saved changes')).not.toBeInTheDocument()
  })
})
