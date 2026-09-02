import { describe, expect, it } from 'vitest'
import type {
  QueueItemPhase,
  QueueItemSnapshot,
  TaskQueueSnapshot,
} from '../services/grading/taskGradingScheduler'
import type { Essay, EssayStatus } from '../types'
import {
  filterEssaysByProgressTab,
  getProgressEssayPhase,
  getProgressQueueStats,
  isProcessableEssayStatus,
  isClassReviewQueueSettled,
  type ProgressEssayPhase,
} from './progressQueue'

function essay(id: string, status: EssayStatus, sourceGeneration = 2): Essay {
  return {
    id,
    taskId: 'task-1',
    sourceGeneration,
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

function queueItem(
  essayId: string,
  phase: QueueItemPhase,
  sourceGeneration = 2,
  rubricGeneration = 3,
): QueueItemSnapshot {
  return {
    essayId,
    phase,
    requestId: `request-${essayId}`,
    sourceGeneration,
    rubricGeneration,
    retryable: phase === 'retryable_failure' || phase === 'rate_limit_wait',
    reattachOnly: phase === 'result_unknown',
  }
}

function snapshot(
  items: QueueItemSnapshot[],
  taskId = 'task-1',
): TaskQueueSnapshot {
  return {
    taskId,
    status: 'running',
    targetConcurrency: 2,
    activeCount: items.filter((item) => item.phase === 'running').length,
    queuedCount: items.filter((item) => (
      item.phase === 'queued' || item.phase === 'rate_limit_wait'
    )).length,
    items: Object.fromEntries(items.map((item) => [item.essayId, item])),
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

  it.each([
    ['queued', 'queued'],
    ['running', 'running'],
    ['rate_limit_wait', 'rate_limit_wait'],
    ['result_unknown', 'result_unknown'],
    ['retryable_failure', 'retryable_failure'],
    ['final_failure', 'final_failure'],
    ['succeeded', 'succeeded'],
  ] satisfies Array<[QueueItemPhase, ProgressEssayPhase]>)(
    'uses a fresh %s queue item as presentation phase',
    (queuePhase, expected) => {
      const current = essay('作文 1', 'pending_grading')

      expect(getProgressEssayPhase(
        current,
        snapshot([queueItem(current.id, queuePhase)]),
        3,
      )).toBe(expected)
    },
  )

  it('treats an unstarted pending essay as waiting when no snapshot exists', () => {
    expect(getProgressEssayPhase(essay('作文 1', 'pending_grading'))).toBe('waiting')
  })

  it.each([
    [true, 'retryable_failure'],
    [false, 'final_failure'],
  ] satisfies Array<[boolean, ProgressEssayPhase]>) (
    'uses a %s preflight failure when no current queue item exists',
    (retryable, expected) => {
      const current = essay('作文 1', 'pending_grading')
      current.gradingRun = {
        status: 'failed',
        requestId: 'grading-preflight',
        errorCode: 'gateway_invalid_request',
        errorMessage: '无法安全构建批改请求。',
        retryable,
        completedAt: '2026-07-01T00:00:00.000Z',
        sourceGeneration: 2,
        rubricGeneration: 3,
      }

      expect(getProgressEssayPhase(current, undefined, 3)).toBe(expected)
    },
  )

  it.each([
    ['completed', 'completed'],
    ['manual', 'manual'],
    ['grading_ready', 'teacher_confirmation'],
    ['needs_review', 'teacher_review'],
  ] satisfies Array<[EssayStatus, ProgressEssayPhase]>)(
    'keeps durable %s state ahead of a transient queue item',
    (status, expected) => {
      const current = essay('作文 1', status)

      expect(getProgressEssayPhase(
        current,
        snapshot([queueItem(current.id, 'running')]),
        3,
      )).toBe(expected)
    },
  )

  it('ignores queue items from a stale essay or rubric generation', () => {
    const current = essay('作文 1', 'pending_grading', 2)

    expect(getProgressEssayPhase(
      current,
      snapshot([queueItem(current.id, 'running', 1, 3)]),
      3,
    )).toBe('waiting')
    expect(getProgressEssayPhase(
      current,
      snapshot([queueItem(current.id, 'running', 2, 2)]),
      3,
    )).toBe('waiting')
  })

  it('ignores a queue item that is not bound to the current task and essay', () => {
    const current = essay('作文 1', 'pending_grading')
    const wrongEssayItem = {
      ...queueItem(current.id, 'running'),
      essayId: '作文 2',
    }
    const wrongEssaySnapshot = snapshot([wrongEssayItem])
    wrongEssaySnapshot.items = { [current.id]: wrongEssayItem }

    expect(getProgressEssayPhase(
      current,
      snapshot([queueItem(current.id, 'running')], 'task-2'),
      3,
    )).toBe('waiting')
    expect(getProgressEssayPhase(current, wrongEssaySnapshot, 3)).toBe('waiting')
  })

  it('treats absent legacy generations as generation zero', () => {
    const current = essay('作文 1', 'pending_grading')
    delete current.sourceGeneration

    expect(getProgressEssayPhase(
      current,
      snapshot([queueItem(current.id, 'queued', 0, 0)]),
    )).toBe('queued')
  })

  it('calculates queue stats from fresh presentation phases', () => {
    const essays = [
      essay('作文 1', 'completed'),
      essay('作文 2', 'manual'),
      essay('作文 3', 'needs_review'),
      essay('作文 4', 'grading_ready'),
      essay('作文 5', 'pending_grading'),
      essay('作文 6', 'pending_grading'),
      essay('作文 7', 'pending_grading'),
      essay('作文 8', 'pending_grading'),
      essay('作文 9', 'pending_grading'),
      essay('作文 10', 'pending_grading'),
      essay('作文 11', 'pending_grading'),
      essay('作文 12', 'pending_grading'),
    ]
    const taskSnapshot = snapshot([
      queueItem('作文 5', 'queued'),
      queueItem('作文 6', 'running'),
      queueItem('作文 7', 'rate_limit_wait'),
      queueItem('作文 8', 'result_unknown'),
      queueItem('作文 9', 'retryable_failure'),
      queueItem('作文 10', 'final_failure'),
      queueItem('作文 11', 'succeeded'),
    ])

    expect(getProgressQueueStats(essays, taskSnapshot, 3)).toEqual({
      total: 12,
      completed: 1,
      processing: 5,
      reviewNeeded: 5,
      pending: 3,
      completionRate: 8,
      processable: 1,
    })
  })

  it('identifies only pending grading as processable', () => {
    expect(isProcessableEssayStatus('pending_ocr')).toBe(false)
    expect(isProcessableEssayStatus('ocr_running')).toBe(false)
    expect(isProcessableEssayStatus('pending_grading')).toBe(true)
    expect(isProcessableEssayStatus('grading')).toBe(false)
    expect(isProcessableEssayStatus('grading_ready')).toBe(false)
    expect(isProcessableEssayStatus('completed')).toBe(false)
    expect(isProcessableEssayStatus('needs_review')).toBe(false)
    expect(isProcessableEssayStatus('manual')).toBe(false)
  })

  it('filters essays by fresh progress phase without treating manual as completed', () => {
    const essays = [
      essay('作文 1', 'completed'),
      essay('作文 2', 'manual'),
      essay('作文 3', 'needs_review'),
      essay('作文 4', 'pending_grading'),
      essay('作文 5', 'pending_grading'),
      essay('作文 6', 'pending_grading'),
      essay('作文 7', 'pending_grading'),
      essay('作文 8', 'pending_grading'),
      essay('作文 9', 'pending_grading'),
      essay('作文 10', 'grading_ready'),
    ]
    const taskSnapshot = snapshot([
      queueItem('作文 4', 'queued'),
      queueItem('作文 5', 'running'),
      queueItem('作文 6', 'retryable_failure'),
      queueItem('作文 7', 'final_failure'),
      queueItem('作文 8', 'succeeded'),
    ])

    expect(filterEssaysByProgressTab(essays, 'all', taskSnapshot, 3).map((item) => item.id)).toEqual([
      '作文 1',
      '作文 2',
      '作文 3',
      '作文 4',
      '作文 5',
      '作文 6',
      '作文 7',
      '作文 8',
      '作文 9',
      '作文 10',
    ])
    expect(filterEssaysByProgressTab(essays, 'processing', taskSnapshot, 3).map((item) => item.id)).toEqual([
      '作文 4',
      '作文 5',
      '作文 9',
    ])
    expect(filterEssaysByProgressTab(essays, 'review', taskSnapshot, 3).map((item) => item.id)).toEqual([
      '作文 3',
      '作文 6',
      '作文 7',
      '作文 8',
      '作文 10',
    ])
    expect(filterEssaysByProgressTab(essays, 'completed', taskSnapshot, 3).map((item) => item.id)).toEqual(['作文 1'])
  })

  it('treats final failures and valid success states as class-review settled while active phases are not settled', () => {
    const finalFailure = essay('作文 2', 'pending_grading')
    finalFailure.gradingRun = {
      status: 'failed',
      requestId: 'request-final',
      errorCode: 'provider_content_filtered',
      errorMessage: '该作文无法自动处理。',
      retryable: false,
      completedAt: '2026-07-01T00:00:00.000Z',
      sourceGeneration: 2,
      rubricGeneration: 3,
    }
    expect(isClassReviewQueueSettled([
      essay('作文 1', 'completed'),
      essay('作文 3', 'manual'),
      essay('作文 4', 'grading_ready'),
      finalFailure,
    ], undefined, 3)).toBe(true)

    expect(isClassReviewQueueSettled(
      [essay('作文 1', 'completed'), essay('作文 5', 'pending_grading')],
      snapshot([queueItem('作文 5', 'result_unknown')]),
      3,
    )).toBe(false)
    expect(isClassReviewQueueSettled(
      [essay('作文 1', 'completed'), essay('作文 6', 'pending_grading')],
      snapshot([queueItem('作文 6', 'rate_limit_wait')]),
      3,
    )).toBe(false)
    expect(isClassReviewQueueSettled(
      [essay('作文 1', 'completed'), essay('作文 7', 'pending_grading')],
      undefined,
      3,
    )).toBe(false)
  })
})
