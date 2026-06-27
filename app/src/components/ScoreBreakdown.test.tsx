import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ScoreDimension } from '../types'
import { ScoreBreakdown } from './ScoreBreakdown'

const dimensions: ScoreDimension[] = [
  {
    id: 'content',
    name: '内容完成度',
    score: 3.4,
    maxScore: 3.75,
    weight: 25,
    reason: '覆盖主要信息点，个别细节展开不足。',
    evidence: '',
  },
  {
    id: 'accuracy',
    name: '语言准确性',
    score: 3,
    maxScore: 3.75,
    weight: 25,
    reason: '有少量时态、冠词和主谓一致错误。',
    evidence: '',
  },
]

describe('ScoreBreakdown', () => {
  it('renders compact scoring rows and highlights the main deduction items', () => {
    render(<ScoreBreakdown dimensions={dimensions} />)

    expect(screen.getByText('分项评分')).toBeInTheDocument()
    expect(screen.getByText('内容完成度')).toBeInTheDocument()
    expect(screen.getByText('3.4 / 3.75')).toBeInTheDocument()
    expect(screen.getByText('语言准确性')).toBeInTheDocument()
    expect(screen.getByText('主要扣分')).toBeInTheDocument()
    expect(document.querySelector('.bg-blue-600')).not.toBeInTheDocument()
  })
})
