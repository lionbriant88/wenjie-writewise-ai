import { describe, expect, it } from 'vitest'
import type { Essay } from '../types'
import { calculateProgress, summarizeStatuses } from './progress'

const essays = [
  { id: 'e1', status: 'completed' },
  { id: 'e2', status: 'needs_review' },
  { id: 'e3', status: 'grading' },
] as Essay[]

describe('progress helpers', () => {
  it('calculates completion and exception percentages from essays', () => {
    expect(calculateProgress(essays)).toEqual({
      total: 3,
      completed: 1,
      exceptions: 1,
      completionPercent: 33,
      exceptionPercent: 33,
    })
  })

  it('summarizes essay counts by status', () => {
    expect(summarizeStatuses(essays)).toEqual({
      completed: 1,
      needs_review: 1,
      grading: 1,
    })
  })
})
