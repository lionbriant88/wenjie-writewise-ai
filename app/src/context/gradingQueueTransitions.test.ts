import { describe, expect, it } from 'vitest'
import type { Essay } from '../types'
import {
  captureGradingQueueJob,
  getEssaySourceGeneration,
  getTaskRubricGeneration,
  incrementGeneration,
  isCapturedGradingQueueJobCurrent,
  selectActionableTaskEssays,
} from './gradingQueueTransitions'

type VersionedTask = { id: string; rubricGeneration?: number }

function essay(
  id: string,
  taskId: string,
  status: Essay['status'] = 'pending_grading',
  sourceGeneration?: number,
): Pick<Essay, 'id' | 'taskId' | 'status'> & { sourceGeneration?: number } {
  return { id, taskId, status, sourceGeneration }
}

describe('grading queue transitions', () => {
  it('treats absent legacy generations as zero when capturing a job', () => {
    const task: VersionedTask = { id: 'task-1' }
    const currentEssay = essay('essay-1', task.id)

    expect(getTaskRubricGeneration(task)).toBe(0)
    expect(getEssaySourceGeneration(currentEssay)).toBe(0)
    expect(captureGradingQueueJob(task, currentEssay, 'grading-opaque')).toEqual({
      taskId: 'task-1',
      essayId: 'essay-1',
      requestId: 'grading-opaque',
      sourceGeneration: 0,
      rubricGeneration: 0,
    })
  })

  it('captures explicit generations without embedding mutable task or essay data', () => {
    const captured = captureGradingQueueJob(
      { id: 'task-1', rubricGeneration: 7 },
      essay('essay-1', 'task-1', 'pending_grading', 4),
      'grading-opaque',
    )

    expect(captured).toEqual({
      taskId: 'task-1',
      essayId: 'essay-1',
      requestId: 'grading-opaque',
      sourceGeneration: 4,
      rubricGeneration: 7,
    })
    expect(Object.keys(captured).sort()).toEqual([
      'essayId',
      'requestId',
      'rubricGeneration',
      'sourceGeneration',
      'taskId',
    ])
  })

  it('requires the request id and every captured generation coordinate to remain current', () => {
    const captured = captureGradingQueueJob(
      { id: 'task-1', rubricGeneration: 3 },
      essay('essay-1', 'task-1', 'pending_grading', 2),
      'grading-current',
    )
    const task = { id: 'task-1', rubricGeneration: 3 }
    const currentEssay = essay('essay-1', 'task-1', 'grading', 2)

    expect(isCapturedGradingQueueJobCurrent(captured, task, currentEssay, 'grading-current')).toBe(true)
    expect(isCapturedGradingQueueJobCurrent(captured, task, currentEssay, 'grading-old')).toBe(false)
    expect(isCapturedGradingQueueJobCurrent(captured, { ...task, id: 'task-2' }, currentEssay, 'grading-current')).toBe(false)
    expect(isCapturedGradingQueueJobCurrent(captured, { ...task, rubricGeneration: 4 }, currentEssay, 'grading-current')).toBe(false)
    expect(isCapturedGradingQueueJobCurrent(captured, task, { ...currentEssay, id: 'essay-2' }, 'grading-current')).toBe(false)
    expect(isCapturedGradingQueueJobCurrent(captured, task, { ...currentEssay, taskId: 'task-2' }, 'grading-current')).toBe(false)
    expect(isCapturedGradingQueueJobCurrent(captured, task, { ...currentEssay, sourceGeneration: 3 }, 'grading-current')).toBe(false)
    expect(isCapturedGradingQueueJobCurrent(captured, task, undefined, 'grading-current')).toBe(false)
  })

  it('matches a captured zero generation against legacy values that are still absent', () => {
    const task: VersionedTask = { id: 'task-1' }
    const currentEssay = essay('essay-1', task.id)
    const captured = captureGradingQueueJob(task, currentEssay, 'grading-current')

    expect(isCapturedGradingQueueJobCurrent(captured, task, currentEssay, 'grading-current')).toBe(true)
  })

  it('keeps only actionable essays for one task in their original order', () => {
    const first = essay('essay-3', 'task-1')
    const otherTask = essay('essay-1', 'task-2')
    const ready = essay('essay-2', 'task-1', 'grading_ready')
    const second = essay('essay-1', 'task-1')
    const running = essay('essay-4', 'task-1', 'grading')

    const selected = selectActionableTaskEssays(
      [first, otherTask, ready, second, running],
      'task-1',
    )

    expect(selected).toEqual([first, second])
    expect(selected[0]).toBe(first)
    expect(selected[1]).toBe(second)
  })

  it('increments absent and explicit generations without exceeding safe integers', () => {
    expect(incrementGeneration()).toBe(1)
    expect(incrementGeneration(0)).toBe(1)
    expect(incrementGeneration(41)).toBe(42)
    expect(() => incrementGeneration(Number.MAX_SAFE_INTEGER)).toThrow(RangeError)
  })

  it('fails closed for malformed generations', () => {
    expect(() => getEssaySourceGeneration({ sourceGeneration: -1 })).toThrow(RangeError)
    expect(() => getTaskRubricGeneration({ rubricGeneration: 1.5 })).toThrow(RangeError)
    expect(() => incrementGeneration(Number.NaN)).toThrow(RangeError)
  })

  it('rejects inconsistent capture identities', () => {
    expect(() => captureGradingQueueJob(
      { id: 'task-1' },
      essay('essay-1', 'task-2'),
      'grading-current',
    )).toThrow(TypeError)
    expect(() => captureGradingQueueJob(
      { id: 'task-1' },
      essay('essay-1', 'task-1'),
      '   ',
    )).toThrow(TypeError)
  })

  it('returns false instead of throwing when corrupt current generations are compared', () => {
    const captured = captureGradingQueueJob(
      { id: 'task-1', rubricGeneration: 1 },
      essay('essay-1', 'task-1', 'pending_grading', 1),
      'grading-current',
    )

    expect(isCapturedGradingQueueJobCurrent(
      captured,
      { id: 'task-1', rubricGeneration: -1 },
      essay('essay-1', 'task-1', 'grading', 1),
      'grading-current',
    )).toBe(false)
  })
})
