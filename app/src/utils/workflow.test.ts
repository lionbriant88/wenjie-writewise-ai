import { describe, expect, it } from 'vitest'
import type { Essay, Task } from '../types'
import {
  getEssayStatusMeta,
  getProgressNextAction,
  getWorkflowSteps,
} from './workflow'

const task = {
  id: 'task-1',
  taskName: '九年级建议信单元测',
  className: '九年级 3 班',
  essayType: '建议信',
  fullScore: 15,
  scoringTemplateId: 'default-15',
  status: 'needs_review',
  totalEssayCount: 3,
  completedEssayCount: 1,
  exceptionEssayCount: 1,
  createdAt: '2026-06-25T09:00:00.000Z',
  updatedAt: '2026-06-25T09:00:00.000Z',
  generateClassReview: true,
} satisfies Task

const essay = (id: string, status: Essay['status']) =>
  ({
    id,
    taskId: task.id,
    essayNumber: id,
    pages: [],
    pageCount: 1,
    pageOrder: [],
    ocrText: '',
    ocrConfidence: 0.88,
    status,
    exceptionReasons: [],
    teacherReviewed: status === 'completed',
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }) as Essay

describe('workflow helpers', () => {
  it('returns stable task workflow steps with current step marked', () => {
    expect(getWorkflowSteps(task.id, 'progress')).toEqual([
      { id: 'upload', label: '上传整理', to: '/tasks/task-1/upload', current: false },
      { id: 'progress', label: '批改进度', to: '/tasks/task-1/progress', current: true },
      { id: 'exceptions', label: '异常复核', to: '/tasks/task-1/exceptions', current: false },
      { id: 'results', label: '结果检查', to: '/tasks/task-1/progress', current: false },
      { id: 'class-review', label: '班级讲评', to: '/tasks/task-1/class-review', current: false },
    ])
  })

  it('prioritizes exception review when exceptions exist', () => {
    const next = getProgressNextAction(task, [
      essay('作文 1', 'completed'),
      essay('作文 2', 'needs_review'),
      essay('作文 3', 'grading'),
    ])

    expect(next).toMatchObject({
      tone: 'danger',
      title: '先处理 1 篇异常作文',
      primaryLabel: '去复核',
      primaryTo: '/tasks/task-1/exceptions',
    })
  })

  it('points to class review when all essays are completed', () => {
    const next = getProgressNextAction({ ...task, status: 'ready' }, [
      essay('作文 1', 'completed'),
      essay('作文 2', 'completed'),
    ])

    expect(next).toMatchObject({
      tone: 'success',
      title: '本批作文已完成',
      primaryLabel: '查看班级讲评',
      primaryTo: '/tasks/task-1/class-review',
    })
  })

  it('labels active and completed essay statuses for animated chips', () => {
    expect(getEssayStatusMeta('grading')).toMatchObject({
      label: '批改中',
      animated: true,
    })
    expect(getEssayStatusMeta('completed')).toMatchObject({
      label: '已完成',
      showCheck: true,
    })
  })
})
