import { describe, expect, it } from 'vitest'
import type { Essay, EssayStatus } from '../types'
import {
  filterEssaysByProgressTab,
  getProgressQueueStats,
  isProcessableEssayStatus,
} from './progressQueue'

function essay(id: string, status: EssayStatus): Essay {
  return {
    id,
    taskId: 'task-1',
    essayNumber: id,
    pages: [],
    pageCount: 1,
    pageOrder: [],
    ocrText: '',
    ocrConfidence: 0.9,
    status,
    exceptionReasons: [],
    teacherReviewed: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}

describe('progressQueue', () => {
  it('returns zeroed stats for an empty queue', () => {
    expect(getProgressQueueStats([])).toEqual({
      total: 0,
      completed: 0,
      processing: 0,
      reviewNeeded: 0,
      pending: 0,
      completionRate: 0,
      processable: 0,
    })
  })

  it('calculates queue stats from current essay statuses', () => {
    const essays = [
      essay('作文 1', 'completed'),
      essay('作文 2', 'manual'),
      essay('作文 3', 'needs_review'),
      essay('作文 4', 'pending_grading'),
      essay('作文 5', 'grading'),
      essay('作文 6', 'pending_ocr'),
      essay('作文 7', 'ocr_running'),
    ]

    expect(getProgressQueueStats(essays)).toEqual({
      total: 7,
      completed: 1,
      processing: 4,
      reviewNeeded: 1,
      pending: 2,
      completionRate: 14,
      processable: 4,
    })
  })

  it('identifies only mock-processable statuses', () => {
    expect(isProcessableEssayStatus('pending_ocr')).toBe(true)
    expect(isProcessableEssayStatus('ocr_running')).toBe(true)
    expect(isProcessableEssayStatus('pending_grading')).toBe(true)
    expect(isProcessableEssayStatus('grading')).toBe(true)
    expect(isProcessableEssayStatus('completed')).toBe(false)
    expect(isProcessableEssayStatus('needs_review')).toBe(false)
    expect(isProcessableEssayStatus('manual')).toBe(false)
  })

  it('filters essays by progress tab without treating manual as completed', () => {
    const essays = [
      essay('作文 1', 'completed'),
      essay('作文 2', 'manual'),
      essay('作文 3', 'needs_review'),
      essay('作文 4', 'pending_grading'),
      essay('作文 5', 'grading'),
    ]

    expect(filterEssaysByProgressTab(essays, 'all').map((item) => item.id)).toEqual([
      '作文 1',
      '作文 2',
      '作文 3',
      '作文 4',
      '作文 5',
    ])
    expect(filterEssaysByProgressTab(essays, 'processing').map((item) => item.id)).toEqual([
      '作文 4',
      '作文 5',
    ])
    expect(filterEssaysByProgressTab(essays, 'review').map((item) => item.id)).toEqual(['作文 3'])
    expect(filterEssaysByProgressTab(essays, 'completed').map((item) => item.id)).toEqual(['作文 1'])
  })
})
