import type { Essay, EssayStatus, Task } from '../types'

export type WorkflowStepId = 'upload' | 'progress' | 'exceptions' | 'results' | 'class-review'

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
  { id: 'exceptions', label: '异常复核', path: 'exceptions' },
  { id: 'results', label: '结果检查', path: 'progress' },
  { id: 'class-review', label: '班级讲评', path: 'class-review' },
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
      secondaryLabel: '查看讲评',
      secondaryTo: `/tasks/${task.id}/class-review`,
    }
  }

  if (essays.length > 0 && terminalCount === essays.length) {
    return {
      tone: 'success',
      title: '本批作文已完成',
      description: '可以直接查看班级共性问题，用于课堂讲评或白板展示。',
      primaryLabel: '查看班级讲评',
      primaryTo: `/tasks/${task.id}/class-review`,
    }
  }

  return {
    tone: 'info',
    title: activeCount > 0 ? `${activeCount} 篇作文仍在模拟处理中` : '等待作文进入批改队列',
    description: '阶段一原型使用本地 mock 数据模拟 OCR 与 AI 批改状态。',
    primaryLabel: '模拟完成下一篇',
    primaryTo: `/tasks/${task.id}/progress`,
    secondaryLabel: '查看异常队列',
    secondaryTo: `/tasks/${task.id}/exceptions`,
  }
}

export function getEssayStatusMeta(status: EssayStatus): EssayStatusMeta {
  const map: Record<EssayStatus, EssayStatusMeta> = {
    pending_ocr: {
      label: '待识别',
      className: 'border-slate-200 bg-slate-100 text-slate-600',
    },
    ocr_running: {
      label: '识别中',
      className: 'border-cyan-200 bg-cyan-50 text-cyan-700',
      animated: true,
    },
    pending_grading: {
      label: '待批改',
      className: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    },
    grading: {
      label: '批改中',
      className: 'border-blue-200 bg-blue-50 text-blue-700',
      animated: true,
    },
    completed: {
      label: '已完成',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      showCheck: true,
    },
    needs_review: {
      label: '需人工复核',
      className: 'border-rose-200 bg-rose-50 text-rose-700',
    },
    manual: {
      label: '人工批改',
      className: 'border-amber-200 bg-amber-50 text-amber-700',
    },
  }

  return map[status]
}
