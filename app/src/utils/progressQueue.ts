import type {
  QueueItemPhase,
  TaskQueueSnapshot,
} from '../services/grading/taskGradingScheduler'
import type { Essay, EssayStatus } from '../types'

export type ProgressQueueTab = 'all' | 'processing' | 'review' | 'completed'

export type ProgressEssayPhase =
  | 'waiting'
  | QueueItemPhase
  | 'teacher_confirmation'
  | 'teacher_review'
  | 'completed'
  | 'manual'

export interface ProgressQueueStats {
  total: number
  completed: number
  processing: number
  reviewNeeded: number
  pending: number
  completionRate: number
  processable: number
}

const processableStatuses = new Set<EssayStatus>(['pending_grading'])
const processingPhases = new Set<ProgressEssayPhase>([
  'waiting',
  'queued',
  'running',
  'rate_limit_wait',
  'result_unknown',
])
const reviewPhases = new Set<ProgressEssayPhase>([
  'succeeded',
  'teacher_confirmation',
  'teacher_review',
  'retryable_failure',
  'final_failure',
])
const pendingPhases = new Set<ProgressEssayPhase>([
  'waiting',
  'queued',
  'rate_limit_wait',
])
const classReviewUnsettledPhases = new Set<ProgressEssayPhase>([
  'waiting',
  'queued',
  'running',
  'rate_limit_wait',
  'result_unknown',
  'retryable_failure',
])

export function isProcessableEssayStatus(status: EssayStatus): boolean {
  return processableStatuses.has(status)
}

export function getProgressEssayPhase(
  essay: Essay,
  snapshot?: TaskQueueSnapshot,
  rubricGeneration = 0,
): ProgressEssayPhase {
  if (essay.status === 'completed') return 'completed'
  if (essay.status === 'manual') return 'manual'
  if (essay.status === 'grading_ready') return 'teacher_confirmation'
  if (essay.status === 'needs_review') return 'teacher_review'

  const sourceGeneration = essay.sourceGeneration ?? 0
  const item = snapshot?.items[essay.id]
  if (snapshot?.taskId === essay.taskId
    && item?.essayId === essay.id
    && item.sourceGeneration === sourceGeneration
    && item.rubricGeneration === rubricGeneration) {
    return item.phase
  }

  const gradingRun = essay.gradingRun
  if (gradingRun?.status === 'failed'
    && (gradingRun.sourceGeneration ?? 0) === sourceGeneration
    && (gradingRun.rubricGeneration ?? 0) === rubricGeneration) {
    return gradingRun.retryable ? 'retryable_failure' : 'final_failure'
  }

  return 'waiting'
}

export function getProgressQueueStats(
  essays: Essay[],
  snapshot?: TaskQueueSnapshot,
  rubricGeneration = 0,
): ProgressQueueStats {
  const total = essays.length
  const phases = essays.map((essay) => getProgressEssayPhase(
    essay,
    snapshot,
    rubricGeneration,
  ))
  const completed = phases.filter((phase) => phase === 'completed').length
  const processing = phases.filter((phase) => processingPhases.has(phase)).length
  const reviewNeeded = phases.filter((phase) => reviewPhases.has(phase)).length
  const pending = phases.filter((phase) => pendingPhases.has(phase)).length

  return {
    total,
    completed,
    processing,
    reviewNeeded,
    pending,
    completionRate: total === 0 ? 0 : Math.round((completed / total) * 100),
    processable: essays.filter((essay, index) => (
      phases[index] === 'waiting' && isProcessableEssayStatus(essay.status)
    )).length,
  }
}

export function filterEssaysByProgressTab(
  essays: Essay[],
  tab: ProgressQueueTab,
  snapshot?: TaskQueueSnapshot,
  rubricGeneration = 0,
): Essay[] {
  if (tab === 'processing') {
    return essays.filter((essay) => processingPhases.has(getProgressEssayPhase(
      essay,
      snapshot,
      rubricGeneration,
    )))
  }

  if (tab === 'review') {
    return essays.filter((essay) => reviewPhases.has(getProgressEssayPhase(
      essay,
      snapshot,
      rubricGeneration,
    )))
  }

  if (tab === 'completed') {
    return essays.filter((essay) => getProgressEssayPhase(
      essay,
      snapshot,
      rubricGeneration,
    ) === 'completed')
  }

  return essays
}

export function isClassReviewQueueSettled(
  essays: Essay[],
  snapshot?: TaskQueueSnapshot,
  rubricGeneration = 0,
): boolean {
  return essays.every((essay) => !classReviewUnsettledPhases.has(getProgressEssayPhase(
    essay,
    snapshot,
    rubricGeneration,
  )))
}
