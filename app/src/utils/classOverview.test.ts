import { describe, expect, it } from 'vitest'
import type { Essay, GradingResult } from '../types'
import { getClassOverviewStats } from './classOverview'

function essay(id: string): Essay {
  return {
    id,
    taskId: 'task-1',
    essayNumber: id,
    pages: [],
    pageCount: 1,
    pageOrder: [],
    ocrText: '',
    ocrConfidence: 0.9,
    status: 'completed',
    exceptionReasons: [],
    teacherReviewed: true,
    createdAt: '2026-06-25T09:00:00.000Z',
    updatedAt: '2026-06-25T09:00:00.000Z',
  }
}

function result(essayId: string, totalScore: number): GradingResult {
  return {
    id: `${essayId}-result`,
    essayId,
    totalScore,
    dimensionScores: [],
    errorAnnotations: [],
    sentenceRevisions: [],
    upgradedExpressions: [],
    overallComment: '',
    aiConfidence: 0.9,
    teacherAdjusted: false,
    createdAt: '2026-06-25T09:00:00.000Z',
    updatedAt: '2026-06-25T09:00:00.000Z',
  }
}

describe('getClassOverviewStats', () => {
  it('summarizes class scores and groups them by exam score bands', () => {
    const essays = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'].map(essay)
    const stats = getClassOverviewStats(essays, [
      result('e1', 2.4),
      result('e2', 5.8),
      result('e3', 8.6),
      result('e4', 12.4),
      result('e5', 12.6),
    ])

    expect(stats.totalEssayCount).toBe(6)
    expect(stats.scoredEssayCount).toBe(5)
    expect(stats.averageScore).toBe(8.4)
    expect(stats.highestScore).toBe(12.6)
    expect(stats.lowestScore).toBe(2.4)
    expect(stats.bands).toEqual([
      { label: '1-3', count: 1, percent: 20 },
      { label: '4-6', count: 1, percent: 20 },
      { label: '7-9', count: 1, percent: 20 },
      { label: '10-12', count: 1, percent: 20 },
      { label: '13-15', count: 1, percent: 20 },
    ])
  })

  it('returns empty score summaries when no essays have scores yet', () => {
    const stats = getClassOverviewStats([essay('e1')], [])

    expect(stats.totalEssayCount).toBe(1)
    expect(stats.scoredEssayCount).toBe(0)
    expect(stats.averageScore).toBeNull()
    expect(stats.highestScore).toBeNull()
    expect(stats.lowestScore).toBeNull()
    expect(stats.bands.every((band) => band.count === 0 && band.percent === 0)).toBe(true)
  })
})
