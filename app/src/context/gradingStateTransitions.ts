import type { Essay } from '../types'
import type { AiGradingResultV1, GradingFailureV1 } from '../services/grading/types'

export interface EssayTransition {
  applied: boolean
  essays: Essay[]
  taskId?: string
}

function replaceCurrentAttempt(
  essays: Essay[],
  essayId: string,
  requestId: string,
  update: (essay: Essay) => Essay,
): EssayTransition {
  const target = essays.find((essay) => essay.id === essayId)
  if (
    !target
    || target.status !== 'grading'
    || target.gradingRun?.status !== 'running'
    || target.gradingRun.requestId !== requestId
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
  requestId: string,
  startedAt: string,
): EssayTransition {
  const target = essays.find((essay) => essay.id === essayId)
  if (!target || (target.status !== 'pending_grading' && target.status !== 'grading_ready')) {
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
          gradingRun: { status: 'running', requestId, startedAt },
          updatedAt: startedAt,
        }
      : essay),
  }
}

export function settleGradingSuccess(
  essays: Essay[],
  essayId: string,
  requestId: string,
  resultId: string,
  response: AiGradingResultV1,
): EssayTransition {
  if (response.requestId !== requestId || response.essayId !== essayId) return { applied: false, essays }
  return replaceCurrentAttempt(essays, essayId, requestId, (essay) => ({
    ...essay,
    status: 'grading_ready',
    aiResultId: resultId,
    teacherReviewed: false,
    gradingRun: {
      status: response.status,
      requestId,
      source: response.provider,
      reviewReasons: [...response.reviewReasons],
      startedAt: essay.gradingRun?.status === 'running' ? essay.gradingRun.startedAt : response.createdAt,
      completedAt: response.createdAt,
    },
    updatedAt: response.createdAt,
  }))
}

export function settleGradingFailure(
  essays: Essay[],
  essayId: string,
  requestId: string,
  failure: GradingFailureV1,
  completedAt: string,
): EssayTransition {
  if (failure.requestId !== requestId) return { applied: false, essays }
  return replaceCurrentAttempt(essays, essayId, requestId, (essay) => ({
    ...essay,
    status: 'pending_grading',
    teacherReviewed: false,
    gradingRun: {
      status: 'failed',
      requestId,
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
  requestId: string,
  error: { code: string; message: string },
  completedAt: string,
): EssayTransition {
  const target = essays.find((essay) => essay.id === essayId)
  if (!target || (target.status !== 'pending_grading' && target.status !== 'grading_ready')) {
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
            requestId,
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
