import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FullTextRevisionPanel } from './FullTextRevisionPanel'

describe('FullTextRevisionPanel', () => {
  it('shows an empty state when full text revision data is missing', () => {
    render(<FullTextRevisionPanel upgrades={[]} />)

    expect(screen.getByRole('heading', { name: '全文优化稿' })).toBeInTheDocument()
    expect(screen.getByText('暂无全文优化稿')).toBeInTheDocument()
  })
})
