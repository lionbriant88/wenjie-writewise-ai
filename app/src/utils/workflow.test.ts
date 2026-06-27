import { describe, expect, it } from 'vitest'
import type { Essay, EssayStatus, Task } from '../types'
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
    teacherReviewed: ['completed', 'manual'].includes(status),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }) as Essay

describe('workflow helpers', () => {
  it('returns stable task workflow steps with current step marked', () => {
    expect(getWorkflowSteps(task.id, 'progress')).toEqual([
      { id: 'upload', label: '上传整理', to: '/tasks/task-1/upload', current: false },
      { id: 'progress', label: '批改进度', to: '/tasks/task-1/progress', current: true },
      { id: 'class-review', label: '班级总览', to: '/tasks/task-1/class-review', current: false },
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
      secondaryLabel: '查看总览',
      secondaryTo: '/tasks/task-1/class-review',
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
      primaryLabel: '查看班级总览',
      primaryTo: '/tasks/task-1/class-review',
    })
  })

  it('points to class review when essays are completed or manually reviewed', () => {
    const next = getProgressNextAction({ ...task, status: 'ready' }, [
      essay('作文 1', 'completed'),
      essay('作文 2', 'manual'),
    ])

    expect(next).toMatchObject({
      tone: 'success',
      title: '本批作文已完成',
      primaryLabel: '查看班级总览',
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

  it.each([
    ['pending_ocr', '待识别', false, false],
    ['ocr_running', '识别中', true, false],
    ['pending_grading', '待批改', false, false],
    ['grading', '批改中', true, false],
    ['completed', '已完成', false, true],
    ['needs_review', '需人工复核', false, false],
    ['manual', '人工批改', false, true],
  ] satisfies Array<[EssayStatus, string, boolean, boolean]>)(
    'returns metadata for %s',
    (status, label, animated, showCheck) => {
      const meta = getEssayStatusMeta(status)

      expect(meta.label).toBe(label)
      expect(Boolean(meta.animated)).toBe(animated)
      expect(Boolean(meta.showCheck)).toBe(showCheck)
      expect(meta.className).toEqual(expect.any(String))
    },
  )
})
