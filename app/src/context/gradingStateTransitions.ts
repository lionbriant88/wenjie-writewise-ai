import type { Essay } from '../types'
import type { AiGradingResultV1, GradingFailureV1 } from '../services/grading/types'

export interface EssayTransition {
  applied: boolean
  essays: Essay[]
  taskId?: string
}

export interface GradingAttemptVersion {
  requestId: string
  sourceGeneration: number
  rubricGeneration: number
}

function generation(value: number | undefined): number | null {
  if (value === undefined) return 0
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function isCurrentVersion(
  essay: Essay,
  attempt: GradingAttemptVersion,
  currentRubricGeneration: number,
): boolean {
  const sourceGeneration = generation(essay.sourceGeneration)
  const attemptSourceGeneration = generation(attempt.sourceGeneration)
  const attemptRubricGeneration = generation(attempt.rubricGeneration)
  const rubricGeneration = generation(currentRubricGeneration)
  return sourceGeneration !== null
    && attemptSourceGeneration !== null
    && attemptRubricGeneration !== null
    && rubricGeneration !== null
    && sourceGeneration === attemptSourceGeneration
    && rubricGeneration === attemptRubricGeneration
}

function replaceCurrentAttempt(
  essays: Essay[],
  essayId: string,
  attempt: GradingAttemptVersion,
  currentRubricGeneration: number,
  update: (essay: Essay) => Essay,
): EssayTransition {
  const target = essays.find((essay) => essay.id === essayId)
  const runningSourceGeneration = target?.gradingRun?.status === 'running'
    ? generation(target.gradingRun.sourceGeneration)
    : null
  const runningRubricGeneration = target?.gradingRun?.status === 'running'
    ? generation(target.gradingRun.rubricGeneration)
    : null
  if (
    !target
    || target.status !== 'grading'
    || target.gradingRun?.status !== 'running'
    || target.gradingRun.requestId !== attempt.requestId
    || runningSourceGeneration === null
    || runningRubricGeneration === null
    || runningSourceGeneration !== attempt.sourceGeneration
    || runningRubricGeneration !== attempt.rubricGeneration
    || !isCurrentVersion(target, attempt, currentRubricGeneration)
  ) return { applied: false, essays }
  return {
    applied: true,
    taskId: target.taskId,
    essays: essays.map((essay) => essay.id === essayId ? update(essay) : essay),
  }
}

export function beginGradingAttempt(
  essays: Essay[],
  essayId: string,
  attempt: GradingAttemptVersion,
  currentRubricGeneration: number,
  startedAt: string,
): EssayTransition {
  const target = essays.find((essay) => essay.id === essayId)
  if (
    !target
    || (target.status !== 'pending_grading' && target.status !== 'grading_ready')
    || !isCurrentVersion(target, attempt, currentRubricGeneration)
  ) {
    return { applied: false, essays }
  }
  return {
    applied: true,
    taskId: target.taskId,
    essays: essays.map((essay) => essay.id === essayId
      ? {
          ...essay,
          status: 'grading',
          teacherReviewed: false,
          gradingRun: {
            status: 'running',
            requestId: attempt.requestId,
            sourceGeneration: attempt.sourceGeneration,
            rubricGeneration: attempt.rubricGeneration,
            startedAt,
          },
          updatedAt: startedAt,
        }
      : essay),
  }
}

export function settleGradingSuccess(
  essays: Essay[],
  essayId: string,
  attempt: GradingAttemptVersion,
  currentRubricGeneration: number,
  resultId: string,
  response: AiGradingResultV1,
  options: { transcriptSource?: 'kimi_vision' | 'teacher_confirmed'; confirmedTranscript?: string } = {},
): EssayTransition {
  if (response.requestId !== attempt.requestId || response.essayId !== essayId) {
    return { applied: false, essays }
  }
  return replaceCurrentAttempt(essays, essayId, attempt, currentRubricGeneration, (essay) => ({
    ...essay,
    ...(options.transcriptSource === 'teacher_confirmed' && options.confirmedTranscript !== undefined
      ? { ocrText: options.confirmedTranscript, transcriptSource: 'teacher_confirmed' as const }
      : options.transcriptSource === 'kimi_vision' && response.transcript
      ? { ocrText: response.transcript, transcriptSource: 'kimi_vision' as const }
      : {}),
    status: 'grading_ready',
    aiResultId: resultId,
    teacherReviewed: false,
    gradingRun: {
      status: response.status,
      requestId: attempt.requestId,
      sourceGeneration: attempt.sourceGeneration,
      rubricGeneration: attempt.rubricGeneration,
      source: response.provider,
      reviewReasons: [...response.reviewReasons],
      startedAt: essay.gradingRun?.status === 'running' ? essay.gradingRun.startedAt : response.createdAt,
      completedAt: response.createdAt,
    },
    updatedAt: response.createdAt,
  }))
}

export function invalidateGradingAfterTranscriptEdit(
  essays: Essay[],
  essayId: string,
  timestamp: string,
): EssayTransition {
  const target = essays.find((essay) => essay.id === essayId)
  const isInFlight = target?.status === 'grading' && target.gradingRun?.status === 'running'
  if (!target || (!isInFlight && target.status !== 'grading_ready' && target.status !== 'completed')) {
    return { applied: false, essays }
  }

  return {
    applied: true,
    taskId: target.taskId,
    essays: essays.map((essay) => essay.id === essayId
      ? {
          ...essay,
          status: 'pending_grading',
          teacherReviewed: false,
          gradingRun: { status: 'idle' },
          aiResultId: undefined,
          updatedAt: timestamp,
        }
      : essay),
  }
}

export function settleGradingFailure(
  essays: Essay[],
  essayId: string,
  attempt: GradingAttemptVersion,
  currentRubricGeneration: number,
  failure: GradingFailureV1,
  completedAt: string,
): EssayTransition {
  if (failure.requestId !== attempt.requestId) return { applied: false, essays }
  return replaceCurrentAttempt(essays, essayId, attempt, currentRubricGeneration, (essay) => ({
    ...essay,
    status: 'pending_grading',
    teacherReviewed: false,
    gradingRun: {
      status: 'failed',
      requestId: attempt.requestId,
      sourceGeneration: attempt.sourceGeneration,
      rubricGeneration: attempt.rubricGeneration,
      errorCode: failure.error.code,
      errorMessage: failure.error.message,
      retryable: failure.error.retryable,
      startedAt: essay.gradingRun?.status === 'running' ? essay.gradingRun.startedAt : undefined,
      completedAt,
    },
    updatedAt: completedAt,
  }))
}

export function recordGradingPreflightFailure(
  essays: Essay[],
  essayId: string,
  attempt: GradingAttemptVersion,
  currentRubricGeneration: number,
  error: { code: string; message: string },
  completedAt: string,
): EssayTransition {
  const target = essays.find((essay) => essay.id === essayId)
  if (
    !target
    || (target.status !== 'pending_grading' && target.status !== 'grading_ready')
    || !isCurrentVersion(target, attempt, currentRubricGeneration)
  ) {
    return { applied: false, essays }
  }
  return {
    applied: true,
    taskId: target.taskId,
    essays: essays.map((essay) => essay.id === essayId
      ? {
          ...essay,
          status: 'pending_grading',
          teacherReviewed: false,
          gradingRun: {
            status: 'failed',
            requestId: attempt.requestId,
            sourceGeneration: attempt.sourceGeneration,
            rubricGeneration: attempt.rubricGeneration,
            errorCode: error.code,
            errorMessage: error.message,
            retryable: false,
            completedAt,
          },
          updatedAt: completedAt,
        }
      : essay),
  }
}

export function markEssayManualTransition(
  essays: Essay[],
  essayId: string,
  timestamp: string,
): EssayTransition {
  const target = essays.find((essay) => essay.id === essayId)
  if (!target) return { applied: false, essays }
  const gradingRun = target.gradingRun?.status === 'running'
    ? {
        status: 'failed' as const,
        requestId: target.gradingRun.requestId,
        sourceGeneration: generation(target.gradingRun.sourceGeneration) ?? 0,
        rubricGeneration: generation(target.gradingRun.rubricGeneration) ?? 0,
        errorCode: 'manual_override',
        errorMessage: '教师已转为人工处理。',
        retryable: false,
        startedAt: target.gradingRun.startedAt,
        completedAt: timestamp,
      }
    : target.gradingRun
  return {
    applied: true,
    taskId: target.taskId,
    essays: essays.map((essay) => essay.id === essayId
      ? { ...essay, status: 'manual', teacherReviewed: true, gradingRun, updatedAt: timestamp }
      : essay),
  }
}

export function confirmGradingTransition(
  essays: Essay[],
  essayId: string,
  timestamp: string,
): EssayTransition {
  const target = essays.find((essay) => essay.id === essayId)
  if (!target || target.status !== 'grading_ready' || !target.aiResultId) return { applied: false, essays }
  return {
    applied: true,
    taskId: target.taskId,
    essays: essays.map((essay) => essay.id === essayId
      ? { ...essay, status: 'completed', teacherReviewed: true, updatedAt: timestamp }
      : essay),
  }
}
