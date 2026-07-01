import type { Essay, EssayStatus } from '../types'

export type ProgressQueueTab = 'all' | 'processing' | 'review' | 'completed'

export interface ProgressQueueStats {
  total: number
  completed: number
  processing: number
  reviewNeeded: number
  pending: number
  completionRate: number
  processable: number
}

const processableStatuses = new Set<EssayStatus>([
  'pending_ocr',
  'ocr_running',
  'pending_grading',
  'grading',
])

const pendingStatuses = new Set<EssayStatus>(['pending_ocr', 'pending_grading'])

export function isProcessableEssayStatus(status: EssayStatus): boolean {
  return processableStatuses.has(status)
}

export function getProgressQueueStats(essays: Essay[]): ProgressQueueStats {
  const total = essays.length
  const completed = essays.filter((essay) => essay.status === 'completed').length
  const processing = essays.filter((essay) => isProcessableEssayStatus(essay.status)).length
  const reviewNeeded = essays.filter((essay) => essay.status === 'needs_review').length
  const pending = essays.filter((essay) => pendingStatuses.has(essay.status)).length

  return {
    total,
    completed,
    processing,
    reviewNeeded,
    pending,
    completionRate: total === 0 ? 0 : Math.round((completed / total) * 100),
    processable: processing,
  }
}

export function filterEssaysByProgressTab(essays: Essay[], tab: ProgressQueueTab): Essay[] {
  if (tab === 'processing') {
    return essays.filter((essay) => isProcessableEssayStatus(essay.status))
  }

  if (tab === 'review') {
    return essays.filter((essay) => essay.status === 'needs_review')
  }

  if (tab === 'completed') {
    return essays.filter((essay) => essay.status === 'completed')
  }

  return essays
}
