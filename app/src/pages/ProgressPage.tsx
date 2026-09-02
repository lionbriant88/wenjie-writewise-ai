import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, ListFilter, TriangleAlert } from 'lucide-react'
import { EmptyState } from '../components/EmptyState'
import { EssayStatusChip } from '../components/EssayStatusChip'
import { ProgressSummary } from '../components/ProgressSummary'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import type { QueueItemSnapshot, TaskQueueSnapshot } from '../services/grading/taskGradingScheduler'
import type { Essay } from '../types'
import {
  filterEssaysByProgressTab,
  getProgressEssayPhase,
  getProgressQueueStats,
  isClassReviewQueueSettled,
  type ProgressEssayPhase,
  type ProgressQueueTab,
} from '../utils/progressQueue'
import { findEssaysByTask, findTask } from '../utils/taskLookup'

const progressTabs: Array<{ id: ProgressQueueTab; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'processing', label: '处理中' },
  { id: 'review', label: '待教师处理' },
  { id: 'completed', label: '已完成' },
]

const emptyTabText: Record<ProgressQueueTab, string> = {
  all: '当前还没有作文进入批改队列。',
  processing: '当前没有处理中的作文。',
  review: '当前没有等待教师处理的作文。',
  completed: '当前没有已确认完成的作文。',
}

const pauseCopy: Record<
  NonNullable<TaskQueueSnapshot['pauseReason']>,
  { title: string; description: string }
> = {
  auth: {
    title: '身份验证失败',
    description: '请修复配置或权限并重启 Gateway 后，再恢复批改。',
  },
  balance: {
    title: '账户额度不可用',
    description: '请处理账户额度或权限问题并重启 Gateway 后，再恢复批改。',
  },
  configuration: {
    title: '批改服务配置不可用',
    description: '请修复配置或权限并重启 Gateway 后，再恢复批改。',
  },
  long_retry_after: {
    title: '服务要求较长等待',
    description: '恢复后系统仍会遵守服务要求的剩余等待时间，并继续处理队列。',
  },
}

function currentQueueItem(
  essay: Essay,
  snapshot: TaskQueueSnapshot | undefined,
  rubricGeneration: number,
): QueueItemSnapshot | undefined {
  const item = snapshot?.items[essay.id]
  if (snapshot?.taskId !== essay.taskId
    || item?.essayId !== essay.id
    || item.sourceGeneration !== (essay.sourceGeneration ?? 0)
    || item.rubricGeneration !== rubricGeneration) return undefined
  return item
}

function failureMessage(essay: Essay, item?: QueueItemSnapshot): string {
  return item?.errorMessage
    ?? (essay.gradingRun?.status === 'failed' ? essay.gradingRun.errorMessage : undefined)
    ?? '本篇作文暂时无法自动完成批改。'
}

function EssayAction({
  essay,
  taskId,
  phase,
  item,
  retryTaskEssay,
  checkUnknownTaskEssay,
  markEssayManual,
}: {
  essay: Essay
  taskId: string
  phase: ProgressEssayPhase
  item?: QueueItemSnapshot
  retryTaskEssay: (essayId: string) => void
  checkUnknownTaskEssay: (essayId: string) => void
  markEssayManual: (essayId: string) => void
}) {
  if (phase === 'teacher_confirmation' || phase === 'succeeded') {
    return (
      <div>
        <Link to={`/tasks/${taskId}/essays/${essay.id}`} className="font-semibold text-amber-800">
          查看并确认
        </Link>
        <p className="mt-1 text-xs text-amber-700">
          {essay.gradingRun?.status === 'partial' ? '建议重点复核' : '待教师确认'}
        </p>
      </div>
    )
  }
  if (phase === 'completed') {
    return <Link to={`/tasks/${taskId}/essays/${essay.id}`} className="font-semibold text-blue-700">查看结果</Link>
  }
  if (phase === 'teacher_review') {
    return <Link to={`/tasks/${taskId}/exceptions`} className="font-semibold text-rose-700">去处理异常</Link>
  }
  if (phase === 'manual') return <span className="font-semibold text-amber-700">已转人工处理</span>

  if (phase === 'result_unknown') {
    return (
      <div className="max-w-xl space-y-2">
        <p className="text-sm text-violet-700">{failureMessage(essay, item)}</p>
        <button
          type="button"
          onClick={() => checkUnknownTaskEssay(essay.id)}
          className="rounded-lg bg-violet-700 px-3 py-2 text-xs font-semibold text-white"
        >
          检查结果
        </button>
      </div>
    )
  }

  if (phase === 'retryable_failure' || phase === 'final_failure') {
    return (
      <div className="max-w-xl space-y-2">
        <p className="text-sm text-rose-700">{failureMessage(essay, item)}</p>
        <div className="flex flex-wrap gap-2">
          {phase === 'retryable_failure' ? (
            <button
              type="button"
              onClick={() => retryTaskEssay(essay.id)}
              className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white"
            >
              重试批改
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => markEssayManual(essay.id)}
            className="rounded-lg border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-800"
          >
            转人工处理
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'rate_limit_wait') return <span className="text-amber-700">系统将在等待结束后自动继续</span>
  if (phase === 'queued') return <span className="text-sky-700">等待系统调度</span>
  if (phase === 'running') return <span className="text-blue-700">正在生成批改结果</span>
  return <span className="text-slate-500">等待任务启动</span>
}

export function ProgressPage() {
  const { taskId = '' } = useParams()
  const {
    tasks,
    essays,
    taskGradingQueues,
    startTaskGrading,
    retryTaskEssay,
    checkUnknownTaskEssay,
    resumeTaskGrading,
    markEssayManual,
  } = useAppState()
  const [activeTab, setActiveTab] = useState<ProgressQueueTab>('all')
  const task = findTask(tasks, taskId)

  if (!task) return <EmptyState title="找不到任务" description="请返回任务列表重新选择一个批改任务。" />

  const taskEssays = findEssaysByTask(essays, taskId)
  const queueSnapshot = taskGradingQueues[taskId]
  const rubricGeneration = task.rubricGeneration ?? 0
  const queueStats = getProgressQueueStats(taskEssays, queueSnapshot, rubricGeneration)
  const filteredEssays = filterEssaysByProgressTab(
    taskEssays,
    activeTab,
    queueSnapshot,
    rubricGeneration,
  )
  const hasExceptions = taskEssays.some((essay) => essay.status === 'needs_review')
  const terminalForOverview = taskEssays.length > 0
    && isClassReviewQueueSettled(taskEssays, queueSnapshot, rubricGeneration)
  const pause = queueSnapshot?.pauseReason ? pauseCopy[queueSnapshot.pauseReason] : undefined
  const activeCount = queueSnapshot?.activeCount ?? 0
  const targetConcurrency = queueSnapshot?.targetConcurrency ?? 1
  const queuedCount = queueSnapshot
    ? Object.values(queueSnapshot.items).filter((item) => item.phase === 'queued').length
    : 0

  const tabCount = (tab: ProgressQueueTab) => {
    if (tab === 'processing') return queueStats.processing
    if (tab === 'review') return queueStats.reviewNeeded
    if (tab === 'completed') return queueStats.completed
    return queueStats.total
  }

  return (
    <AppLayout
      task={task}
      title="批改进度"
      currentStep="progress"
      description="学生作文页将直接交给多模态模型；全部待处理作文可一次启动，系统会在明确上限内自动排队。"
    >
      <div className="space-y-5">
        <ProgressSummary stats={queueStats} />

        {pause ? (
          <section
            data-testid="task-pause-banner"
            className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-900"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">{pause.title}</p>
                <p className="mt-1 text-sm">{pause.description}</p>
              </div>
              <button
                type="button"
                onClick={() => resumeTaskGrading(task.id)}
                className="shrink-0 rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white"
              >
                恢复批改
              </button>
            </div>
          </section>
        ) : null}

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-blue-50 p-2 text-blue-700">
                {hasExceptions ? <TriangleAlert className="h-5 w-5" /> : <ListFilter className="h-5 w-5" />}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-950">
                  当前同时批改 {activeCount} 篇，系统最多同时处理 {targetConcurrency} 篇
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {queuedCount} 篇排队中，{queueStats.reviewNeeded} 篇等待教师处理；单篇失败不会阻断其他作文。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {queueStats.processable > 0 ? (
                <button
                  type="button"
                  onClick={() => startTaskGrading(task.id)}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm"
                >
                  开始批改全部待处理作文
                </button>
              ) : null}
              {hasExceptions ? (
                <Link to={`/tasks/${task.id}/exceptions`} className="rounded-lg border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700">
                  查看异常队列
                </Link>
              ) : null}
              {terminalForOverview ? (
                <Link to={`/tasks/${task.id}/class-review`} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
                  进入班级总览 <ArrowRight className="h-4 w-4" />
                </Link>
              ) : null}
            </div>
          </div>
        </section>

        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          批改结果仅保存在当前页面状态中，刷新或重启后不保证恢复。
        </p>

        <div role="tablist" aria-label="批改状态筛选" className="flex gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-white p-2">
          {progressTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                activeTab === tab.id ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-transparent text-slate-600'
              }`}
            >
              {tab.label} {tabCount(tab.id)}
            </button>
          ))}
        </div>

        {filteredEssays.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
            {emptyTabText[activeTab]}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredEssays.map((essay) => {
              const phase = getProgressEssayPhase(essay, queueSnapshot, rubricGeneration)
              const item = currentQueueItem(essay, queueSnapshot, rubricGeneration)
              const reviewRow = phase === 'teacher_review'
                || phase === 'teacher_confirmation'
                || phase === 'succeeded'
              return (
                <article
                  key={essay.id}
                  data-testid={reviewRow ? 'progress-review-row' : undefined}
                  className={`grid gap-3 rounded-lg border p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_auto_minmax(260px,1fr)] md:items-center ${
                    reviewRow ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-white'
                  }`}
                >
                  <div>
                    <p className="font-semibold text-slate-950">{essay.essayNumber}</p>
                    <p className="mt-1 text-xs text-slate-500">{essay.pageCount} 页 · 作文页已就绪</p>
                  </div>
                  <EssayStatusChip status={essay.status} phase={phase} />
                  <div className="text-sm">
                    <EssayAction
                      essay={essay}
                      taskId={task.id}
                      phase={phase}
                      item={item}
                      retryTaskEssay={retryTaskEssay}
                      checkUnknownTaskEssay={checkUnknownTaskEssay}
                      markEssayManual={markEssayManual}
                    />
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
