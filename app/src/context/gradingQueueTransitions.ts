import type { Essay } from '../types'
import type { GradingJobVersion } from '../services/grading/gradingJobIdentity'

export type VersionedTask = {
  id: string
  rubricGeneration?: number
}

export type VersionedEssay = Pick<Essay, 'id' | 'taskId' | 'status'> & {
  sourceGeneration?: number
}

export interface CapturedGradingQueueJob extends GradingJobVersion {
  requestId: string
}

function readGeneration(value: number | undefined, label: string): number {
  if (value === undefined) return 0
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`)
  }
  return value
}

export function getTaskRubricGeneration(task: Pick<VersionedTask, 'rubricGeneration'>): number {
  return readGeneration(task.rubricGeneration, 'rubricGeneration')
}

export function getEssaySourceGeneration(essay: Pick<VersionedEssay, 'sourceGeneration'>): number {
  return readGeneration(essay.sourceGeneration, 'sourceGeneration')
}

export function incrementGeneration(current?: number): number {
  const generation = readGeneration(current, 'generation')
  if (generation === Number.MAX_SAFE_INTEGER) {
    throw new RangeError('generation cannot exceed Number.MAX_SAFE_INTEGER')
  }
  return generation + 1
}

export function captureGradingQueueJob(
  task: VersionedTask,
  essay: VersionedEssay,
  requestId: string,
): CapturedGradingQueueJob {
  if (task.id !== essay.taskId) {
    throw new TypeError('Essay does not belong to the grading task')
  }
  if (!requestId.trim()) {
    throw new TypeError('A grading request id is required')
  }

  return {
    taskId: task.id,
    essayId: essay.id,
    requestId,
    sourceGeneration: getEssaySourceGeneration(essay),
    rubricGeneration: getTaskRubricGeneration(task),
  }
}

export function isCapturedGradingQueueJobCurrent(
  captured: CapturedGradingQueueJob,
  task: VersionedTask | undefined,
  essay: VersionedEssay | undefined,
  currentRequestId: string | undefined,
): boolean {
  if (!task || !essay) return false
  if (
    captured.requestId !== currentRequestId
    || captured.taskId !== task.id
    || captured.essayId !== essay.id
    || essay.taskId !== task.id
  ) return false

  try {
    return captured.sourceGeneration === getEssaySourceGeneration(essay)
      && captured.rubricGeneration === getTaskRubricGeneration(task)
  } catch {
    return false
  }
}

export function selectActionableTaskEssays<T extends VersionedEssay>(
  essays: readonly T[],
  taskId: string,
): T[] {
  return essays.filter((essay) => essay.taskId === taskId && essay.status === 'pending_grading')
}
