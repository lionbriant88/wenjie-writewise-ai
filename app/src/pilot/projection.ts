import type {
  TaskDto,
  EssayDto,
  TaskDraftInput,
  PilotCapabilities,
} from '../../../shared/pilotContracts'
import type { Task, Essay, GradingResult, CreateTaskInput } from '../types'
import type {
  QueueItemSnapshot,
  TaskQueueSnapshot,
} from '../services/grading/taskGradingScheduler'
import { adaptAiGradingResult } from '../services/grading/adaptAiGradingResult'
import { calculateTotalScore } from '../services/grading/scoringRules'
export function draftFromInput(input: CreateTaskInput): TaskDraftInput {
  return {
    taskName: input.taskName,
    fullScore: input.fullScore,
    writingRequirement:
      input.promptInfo?.teacherRequirements ??
      input.promptInfo?.manualPromptText ??
      input.rubricDraft?.writingGoal ??
      '',
    dimensions: (input.rubricDraft?.dimensions ?? []).map((d) => ({
      ...d,
      sourceEvidence: d.sourceEvidence ?? [],
    })),
    source: input.rubricDraft?.source === 'ai' ? 'ai' : 'teacher',
    materialContext: input.materialContext ?? null,
    materialProcessingStatus: input.materialProcessingStatus ?? 'none',
    materialRefs: [],
  }
}
export function projectTask(row: TaskDto): Task {
  const d = row.draft
  return {
    id: row.id,
    rubricGeneration: row.rubricRevision,
    taskName: d.taskName || '作文批改任务',
    className: '',
    essayType: '英语作文',
    fullScore: d.fullScore ?? 15,
    scoringTemplateId: 'cloud-rubric',
    promptInfo: {
      writingGenre: 'practical_writing',
      manualPromptText: d.writingRequirement,
      teacherRequirements: d.writingRequirement,
    },
    rubricDraft: {
      source: d.source,
      writingGoal: d.writingRequirement,
      offTopicCriteria: [],
      dimensions: d.dimensions,
      excellentFeatures: [],
      reviewTriggers: d.materialContext?.reviewWarnings ?? [],
      status: row.state === 'confirmed' ? 'confirmed' : 'draft',
    },
    materialContext: d.materialContext ?? undefined,
    materialProcessingStatus: d.materialProcessingStatus,
    status:
      row.state === 'draft'
        ? 'draft'
        : row.counts.exceptions
          ? 'needs_review'
          : row.counts.total > row.counts.completed
            ? 'processing'
            : 'ready',
    totalEssayCount: row.counts.total,
    completedEssayCount: row.counts.completed,
    exceptionEssayCount: row.counts.exceptions,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    generateClassReview: false,
  }
}
export function projectResult(row: EssayDto): GradingResult | undefined {
  const result = row.currentResult
  if (!result) return
  const base = adaptAiGradingResult(result.ai),
    review = result.review
  const dimensionScores = base.dimensionScores.map((d) => ({
    ...d,
    score:
      review?.dimensionScores.find((s) => s.dimensionId === d.id)?.score ??
      d.score,
  }))
  return {
    ...base,
    essayId: row.id,
    id: row.id + '-result',
    dimensionScores,
    totalScore: review
      ? calculateTotalScore(
          dimensionScores.map((d) => d.score),
          result.ai.maxScore,
        )
      : base.totalScore,
    overallComment: review?.overallComment ?? base.overallComment,
    teacherSuggestion: review?.teacherSuggestion ?? '',
    teacherAdjusted: !!review,
    resultRevision: result.resultRevision,
    updatedAt: result.updatedAt,
  }
}
export function projectEssay(row: EssayDto): Essay {
  const j = row.currentJob,
    result = row.currentResult,
    now = j?.updatedAt ?? new Date().toISOString()
  return {
    id: row.id,
    taskId: row.taskId,
    sourceGeneration: row.sourceRevision,
    essayNumber: row.studentName,
    pages: row.pages.map((p) => ({
      id: p.id,
      uploadId: p.uploadId,
      label: p.label,
      pageNumber: p.pageNumber,
      quality: 'clear',
      accent: '#0891b2',
    })),
    pageCount: row.pages.length,
    pageOrder: row.pages.map((p) => p.id),
    ocrText: row.confirmedTranscript ?? result?.ai.transcript ?? '',
    transcriptSource: row.confirmedTranscript
      ? 'teacher_confirmed'
      : 'kimi_vision',
    ocrConfidence: 0,
    status: row.teacherReviewed
      ? 'completed'
      : row.manualReviewRequired
        ? 'manual'
        : result
          ? result.ai.status === 'partial'
            ? 'needs_review'
            : 'grading_ready'
          : j?.state === 'running'
            ? 'grading'
            : j?.state === 'failed' || j?.state === 'result_unknown'
              ? 'needs_review'
              : 'pending_grading',
    exceptionReasons: [],
    aiResultId: result ? row.id + '-result' : undefined,
    gradingRun: result
      ? {
          status: result.ai.status,
          requestId: result.ai.requestId,
          source: 'remote',
          reviewReasons: result.ai.reviewReasons,
          startedAt: j?.createdAt ?? now,
          completedAt: now,
        }
      : j?.state === 'running'
        ? { status: 'running', requestId: j.id, startedAt: j.createdAt }
        : j?.state === 'failed' || j?.state === 'result_unknown'
          ? {
              status: 'failed',
              requestId: j.id,
              errorCode: j.errorCode ?? 'provider_result_unknown',
              errorMessage:
                j.state === 'result_unknown'
                  ? '结果尚未确认，请检查原批改结果。'
                  : '本篇未能完成批改。',
              retryable: j.retryable,
              completedAt: j.updatedAt,
            }
          : { status: 'idle' },
    teacherReviewed: row.teacherReviewed,
    createdAt: now,
    updatedAt: now,
  }
}
export function projectQueue(
  task: TaskDto,
  essays: EssayDto[],
  capabilities?: PilotCapabilities,
): TaskQueueSnapshot {
  const items: Record<string, QueueItemSnapshot> = {}
  for (const e of essays) {
    const j = e.currentJob
    if (!j) continue
    items[e.id] = {
      essayId: e.id,
      phase:
        j.state === 'queued'
          ? 'queued'
          : j.state === 'running'
            ? 'running'
            : j.state === 'result_unknown'
              ? 'result_unknown'
              : j.state === 'succeeded' || j.state === 'partial'
                ? 'succeeded'
                : j.retryable
                  ? 'retryable_failure'
                  : 'final_failure',
      requestId: j.id,
      sourceGeneration: e.sourceRevision,
      rubricGeneration: task.rubricRevision,
      retryable: j.retryable,
      reattachOnly: j.state === 'result_unknown',
      errorCode: j.errorCode ?? undefined,
    }
  }
  const values = Object.values(items),
    activeCount = values.filter((i) => i.phase === 'running').length,
    queuedCount = values.filter((i) => i.phase === 'queued').length
  return {
    taskId: task.id,
    status:
      capabilities?.queueState === 'paused'
        ? 'paused'
        : activeCount || queuedCount
          ? 'running'
          : values.length
            ? 'settled'
            : 'idle',
    ...(capabilities?.queueState === 'paused'
      ? { pauseReason: 'configuration' as const }
      : {}),
    targetConcurrency: 1,
    activeCount,
    queuedCount,
    items,
  }
}
