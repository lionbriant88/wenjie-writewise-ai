import { describe, expect, it } from 'vitest'
import type { ClassInsight, Essay, GradingResult, Task } from '../types'
import {
  findClassInsight,
  findEssay,
  findEssaysByTask,
  findResultByEssayId,
  findTask,
} from './taskLookup'

const tasks = [
  { id: 'task-1', taskName: 'Task 1' },
  { id: 'task-2', taskName: 'Task 2' },
] as Task[]

const essays = [
  { id: 'essay-1', taskId: 'task-1' },
  { id: 'essay-2', taskId: 'task-1' },
  { id: 'essay-3', taskId: 'task-2' },
] as Essay[]

const results = [
  { id: 'result-1', essayId: 'essay-1' },
  { id: 'result-2', essayId: 'essay-3' },
] as GradingResult[]

const insights = [
  { id: 'insight-1', taskId: 'task-1' },
  { id: 'insight-2', taskId: 'task-2' },
] as ClassInsight[]

describe('task lookup helpers', () => {
  it('finds a task by id', () => {
    expect(findTask(tasks, 'task-2')?.taskName).toBe('Task 2')
  })

  it('returns undefined for a missing task', () => {
    expect(findTask(tasks, 'missing')).toBeUndefined()
  })

  it('finds essays for a task', () => {
    expect(findEssaysByTask(essays, 'task-1').map((essay) => essay.id)).toEqual([
      'essay-1',
      'essay-2',
    ])
  })

  it('finds an essay by id', () => {
    expect(findEssay(essays, 'essay-3')?.taskId).toBe('task-2')
  })

  it('finds a grading result by essay id', () => {
    expect(findResultByEssayId(results, 'essay-1')?.id).toBe('result-1')
  })

  it('finds class insight for a task', () => {
    expect(findClassInsight(insights, 'task-2')?.id).toBe('insight-2')
  })
})
