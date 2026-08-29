import { describe, expect, it } from 'vitest'
import type { Essay, EssayStatus, Task } from '../types'
import {
  getEssayStatusMeta,
  getProgressEssayPhaseMeta,
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
    expect(getEssayStatusMeta('grading_ready')).toMatchObject({
      label: '待教师确认',
    })
    expect(Boolean(getEssayStatusMeta('grading_ready').animated)).toBe(false)
  })

  it.each([
    ['pending_ocr', '等待批改', false, false],
    ['ocr_running', '处理中', true, false],
    ['pending_grading', '等待批改', false, false],
    ['grading', '批改中', true, false],
    ['grading_ready', '待教师确认', false, false],
    ['completed', '已完成', false, true],
    ['needs_review', '待教师复核', false, false],
    ['manual', '人工处理', false, true],
  ] satisfies Array<[EssayStatus, string, boolean, boolean]>)(
    'returns metadata for %s',
    (status, label, animated, showCheck) => {
      const meta = getEssayStatusMeta(status)

      expect(meta.label).toBe(label)
      expect(meta.label).not.toMatch(/OCR|识别/i)
      expect(Boolean(meta.animated)).toBe(animated)
      expect(Boolean(meta.showCheck)).toBe(showCheck)
      expect(meta.className).toEqual(expect.any(String))
    },
  )

  it.each([
    ['waiting', '等待批改', false, false],
    ['queued', '排队中', false, false],
    ['running', '批改中', true, false],
    ['rate_limit_wait', '因限流等待', false, false],
    ['result_unknown', '结果确认中', true, false],
    ['retryable_failure', '可重试失败', false, false],
    ['final_failure', '不可重试失败', false, false],
    ['succeeded', '待教师确认', false, false],
    ['teacher_confirmation', '待教师确认', false, false],
    ['teacher_review', '待教师复核', false, false],
    ['completed', '已完成', false, true],
    ['manual', '人工处理', false, true],
  ] as const)(
    'returns teacher-facing metadata for progress phase %s',
    (phase, label, animated, showCheck) => {
      const meta = getProgressEssayPhaseMeta(phase)

      expect(meta.label).toBe(label)
      expect(Boolean(meta.animated)).toBe(animated)
      expect(Boolean(meta.showCheck)).toBe(showCheck)
      expect(meta.className).toEqual(expect.any(String))
    },
  )

  it('points a ready AI result to teacher detail review without treating it as terminal', () => {
    const next = getProgressNextAction(task, [essay('作文 1', 'grading_ready')])
    expect(next).toMatchObject({
      tone: 'info',
      primaryLabel: '查看并确认批改',
      primaryTo: '/tasks/task-1/essays/作文 1',
    })
  })

  it('offers one action that starts every currently pending essay', () => {
    const next = getProgressNextAction(task, [
      essay('作文 1', 'pending_grading'),
      essay('作文 2', 'grading'),
    ])

    expect(next).toMatchObject({
      tone: 'info',
      primaryLabel: '开始批改全部待处理作文',
      primaryTo: '/tasks/task-1/progress',
    })
    expect(next.description).toContain('全部待处理作文')
    expect(next.description).toContain('有界并发')
    expect(next.description).not.toMatch(/OCR|识别|逐篇/i)
  })
})
