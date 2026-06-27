import { describe, expect, it } from 'vitest'
import type { Essay } from '../types'
import { calculateProgress, summarizeStatuses } from './progress'

const essays = [
  { id: 'e1', status: 'completed' },
  { id: 'e2', status: 'needs_review' },
  { id: 'e3', status: 'grading' },
  { id: 'e4', status: 'manual' },
] as Essay[]

describe('progress helpers', () => {
  it('calculates completion and exception percentages from essays', () => {
    expect(calculateProgress(essays)).toEqual({
      total: 4,
      completed: 2,
      exceptions: 1,
      completionPercent: 50,
      exceptionPercent: 25,
    })
  })

  it('summarizes essay counts by status', () => {
    expect(summarizeStatuses(essays)).toEqual({
      completed: 1,
      needs_review: 1,
      grading: 1,
      manual: 1,
    })
  })
})
