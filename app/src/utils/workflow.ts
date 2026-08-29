import type { Essay, EssayStatus, Task } from '../types'
import type { ProgressEssayPhase } from './progressQueue'

export type WorkflowStepId = 'upload' | 'progress' | 'class-review'

export interface WorkflowStep {
  id: WorkflowStepId
  label: string
  to: string
  current: boolean
}

export interface NextAction {
  tone: 'info' | 'danger' | 'success'
  title: string
  description: string
  primaryLabel: string
  primaryTo: string
  secondaryLabel?: string
  secondaryTo?: string
}

export interface EssayStatusMeta {
  label: string
  className: string
  animated?: boolean
  showCheck?: boolean
}

const workflowLabels: Array<{ id: WorkflowStepId; label: string; path: string }> = [
  { id: 'upload', label: '上传整理', path: 'upload' },
  { id: 'progress', label: '批改进度', path: 'progress' },
  { id: 'class-review', label: '班级总览', path: 'class-review' },
]

export function getWorkflowSteps(taskId: string, current: WorkflowStepId): WorkflowStep[] {
  return workflowLabels.map((step) => ({
    id: step.id,
    label: step.label,
    to: `/tasks/${taskId}/${step.path}`,
    current: step.id === current,
  }))
}

export function getProgressNextAction(task: Task, essays: Essay[]): NextAction {
  const exceptionCount = essays.filter((essay) => essay.status === 'needs_review').length
  const terminalCount = essays.filter((essay) =>
    ['completed', 'manual'].includes(essay.status),
  ).length
  const activeCount = essays.filter((essay) =>
    ['pending_ocr', 'ocr_running', 'pending_grading', 'grading'].includes(essay.status),
  ).length

  if (exceptionCount > 0) {
    return {
      tone: 'danger',
      title: `先处理 ${exceptionCount} 篇异常作文`,
      description: '系统已经把低置信度或图像质量不稳定的作文集中到复核队列。',
      primaryLabel: '去复核',
      primaryTo: `/tasks/${task.id}/exceptions`,
      secondaryLabel: '查看总览',
      secondaryTo: `/tasks/${task.id}/class-review`,
    }
  }

  const readyEssay = essays.find((essay) => essay.status === 'grading_ready')
  if (readyEssay) {
    return {
      tone: 'info',
      title: 'AI 批改已完成，等待教师确认',
      description: '请检查评分、问题与修改建议；只有明确确认后才计入完成和班级统计。',
      primaryLabel: '查看并确认批改',
      primaryTo: `/tasks/${task.id}/essays/${readyEssay.id}`,
      secondaryLabel: '返回批改进度',
      secondaryTo: `/tasks/${task.id}/progress`,
    }
  }

  if (essays.length > 0 && terminalCount === essays.length) {
    return {
      tone: 'success',
      title: '本批作文已完成',
      description: '可以直接查看班级整体表现和高频问题，用于课堂讲评或白板展示。',
      primaryLabel: '查看班级总览',
      primaryTo: `/tasks/${task.id}/class-review`,
    }
  }

  return {
    tone: 'info',
    title: activeCount > 0 ? `${activeCount} 篇作文仍在处理队列中` : '等待作文进入批改队列',
    description: '点击后将一次启动当前任务的全部待处理作文；系统会在有界并发内自动排队，单篇失败不影响其他作文。',
    primaryLabel: '开始批改全部待处理作文',
    primaryTo: `/tasks/${task.id}/progress`,
    secondaryLabel: '查看异常队列',
    secondaryTo: `/tasks/${task.id}/exceptions`,
  }
}

export function getProgressEssayPhaseMeta(phase: ProgressEssayPhase): EssayStatusMeta {
  const map: Record<ProgressEssayPhase, EssayStatusMeta> = {
    waiting: {
      label: '等待批改',
      className: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    },
    queued: {
      label: '排队中',
      className: 'border-sky-200 bg-sky-50 text-sky-700',
    },
    running: {
      label: '批改中',
      className: 'border-blue-200 bg-blue-50 text-blue-700',
      animated: true,
    },
    rate_limit_wait: {
      label: '因限流等待',
      className: 'border-amber-200 bg-amber-50 text-amber-700',
    },
    result_unknown: {
      label: '结果确认中',
      className: 'border-violet-200 bg-violet-50 text-violet-700',
      animated: true,
    },
    retryable_failure: {
      label: '可重试失败',
      className: 'border-rose-200 bg-rose-50 text-rose-700',
    },
    final_failure: {
      label: '不可重试失败',
      className: 'border-rose-300 bg-rose-100 text-rose-800',
    },
    succeeded: {
      label: '待教师确认',
      className: 'border-amber-200 bg-amber-50 text-amber-700',
    },
    teacher_confirmation: {
      label: '待教师确认',
      className: 'border-amber-200 bg-amber-50 text-amber-700',
    },
    teacher_review: {
      label: '待教师复核',
      className: 'border-rose-200 bg-rose-50 text-rose-700',
    },
    completed: {
      label: '已完成',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      showCheck: true,
    },
    manual: {
      label: '人工处理',
      className: 'border-amber-200 bg-amber-50 text-amber-700',
      showCheck: true,
    },
  }

  return map[phase]
}

export function getEssayStatusMeta(status: EssayStatus): EssayStatusMeta {
  if (status === 'ocr_running') {
    return {
      label: '处理中',
      className: 'border-cyan-200 bg-cyan-50 text-cyan-700',
      animated: true,
    }
  }

  const phaseByStatus: Record<Exclude<EssayStatus, 'ocr_running'>, ProgressEssayPhase> = {
    pending_ocr: 'waiting',
    pending_grading: 'waiting',
    grading: 'running',
    grading_ready: 'teacher_confirmation',
    completed: 'completed',
    needs_review: 'teacher_review',
    manual: 'manual',
  }

  return getProgressEssayPhaseMeta(phaseByStatus[status])
}
