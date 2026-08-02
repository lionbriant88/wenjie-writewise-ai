import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, ListFilter, TriangleAlert } from 'lucide-react'
import { EmptyState } from '../components/EmptyState'
import { EssayStatusChip } from '../components/EssayStatusChip'
import { ProgressSummary } from '../components/ProgressSummary'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import type { Essay } from '../types'
import {
  filterEssaysByProgressTab,
  getProgressQueueStats,
  isProcessableEssayStatus,
  type ProgressQueueTab,
} from '../utils/progressQueue'
import { findEssaysByTask, findTask } from '../utils/taskLookup'

const progressTabs: Array<{ id: ProgressQueueTab; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'processing', label: '处理中' },
  { id: 'review', label: '需复核' },
  { id: 'completed', label: '已完成' },
]

const emptyTabText: Record<ProgressQueueTab, string> = {
  all: '当前还没有作文进入批改队列。',
  processing: '当前没有处理中的作文。',
  review: '当前没有需要教师复核的作文。',
  completed: '当前没有已确认完成的作文。',
}

function ProcessingState({ essay }: { essay: Essay }) {
  if (essay.status === 'grading') {
    return <button type="button" disabled className="rounded-lg bg-blue-50 px-3 py-2 font-semibold text-blue-700">批改中</button>
  }
  if (essay.status === 'pending_ocr') return <span className="text-slate-500">等待图像识别</span>
  if (essay.status === 'ocr_running') return <span className="text-cyan-700">正在识别作文文本</span>
  return <span className="text-slate-500">等待开始批改</span>
}

function EssayAction({
  essay,
  taskId,
  retryGradeEssay,
  fallbackToMockGrading,
  markEssayManual,
}: {
  essay: Essay
  taskId: string
  retryGradeEssay: (essayId: string) => Promise<void>
  fallbackToMockGrading: (essayId: string) => Promise<void>
  markEssayManual: (essayId: string) => void
}) {
  if (essay.status === 'grading_ready') {
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
  if (essay.status === 'completed') {
    return <Link to={`/tasks/${taskId}/essays/${essay.id}`} className="font-semibold text-blue-700">查看结果</Link>
  }
  if (essay.status === 'needs_review') {
    return <Link to={`/tasks/${taskId}/exceptions`} className="font-semibold text-rose-700">去复核识别结果</Link>
  }
  if (essay.status === 'manual') return <span className="font-semibold text-amber-700">已转人工处理</span>
  if (essay.gradingRun?.status === 'failed') {
    return (
      <div className="max-w-xl space-y-2">
        <p className="text-sm text-rose-700">{essay.gradingRun.errorMessage}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void retryGradeEssay(essay.id)}
            className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white"
          >
            重试批改
          </button>
          <button
            type="button"
            onClick={() => void fallbackToMockGrading(essay.id)}
            className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-800"
          >
            使用 mock 回退
          </button>
          <button
            type="button"
            onClick={() => markEssayManual(essay.id)}
            className="rounded-lg border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-800"
          >
            转人工处理
          </button>
        </div>
        <p className="text-xs text-slate-500">重试将发起新的调用，可能产生第二次真实 Provider 费用。</p>
      </div>
    )
  }
  return <ProcessingState essay={essay} />
}

export function ProgressPage() {
  const { taskId = '' } = useParams()
  const {
    tasks,
    essays,
    gradeEssay,
    retryGradeEssay,
    fallbackToMockGrading,
    markEssayManual,
  } = useAppState()
  const [activeTab, setActiveTab] = useState<ProgressQueueTab>('all')
  const task = findTask(tasks, taskId)
  const taskEssays = findEssaysByTask(essays, taskId)
  const queueStats = getProgressQueueStats(taskEssays)
  const filteredEssays = filterEssaysByProgressTab(taskEssays, activeTab)
  const nextProcessableEssay = taskEssays.find((essay) => (
    isProcessableEssayStatus(essay.status) && essay.gradingRun?.status !== 'failed'
  ))
  const hasExceptions = taskEssays.some((essay) => essay.status === 'needs_review')

  if (!task) return <EmptyState title="找不到任务" description="请返回任务列表重新选择一个批改任务。" />

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
      description={task.materialContext ? '图片已入队，可逐篇启动 Kimi 批改；不会自动并发或重试。' : '教师确认识别文本后可逐篇启动批改；MVP 不进行批量并发或自动重试。'}
    >
      <div className="space-y-5">
        <ProgressSummary essays={taskEssays} />

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-blue-50 p-2 text-blue-700">
                {hasExceptions ? <TriangleAlert className="h-5 w-5" /> : <ListFilter className="h-5 w-5" />}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-950">
                  当前队列：{queueStats.processing} 篇处理中，{queueStats.reviewNeeded} 篇待复核
                </p>
                <p className="mt-1 text-sm text-slate-600">每次只启动一篇；运行中禁止重复点击。</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {nextProcessableEssay ? (
                <button
                  type="button"
                  onClick={() => void gradeEssay(nextProcessableEssay.id)}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm"
                >
                  开始批改
                </button>
              ) : null}
              {hasExceptions ? (
                <Link to={`/tasks/${task.id}/exceptions`} className="rounded-lg border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700">
                  查看异常队列
                </Link>
              ) : null}
              {!nextProcessableEssay && queueStats.processing === 0 && queueStats.reviewNeeded === 0 && queueStats.total > 0 ? (
                <Link to={`/tasks/${task.id}/class-review`} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
                  进入班级总览 <ArrowRight className="h-4 w-4" />
                </Link>
              ) : null}
            </div>
          </div>
        </section>

        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          MVP 结果仅保存在当前页面状态中，刷新或重启后不保证恢复。
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
              const reviewRow = essay.status === 'needs_review' || essay.status === 'grading_ready'
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
                    <p className="mt-1 text-xs text-slate-500">{essay.pageCount} 页{task.materialContext ? ' · 图片已入队' : ` · 识别置信度 ${Math.round(essay.ocrConfidence * 100)}%`}</p>
                  </div>
                  <EssayStatusChip status={essay.status} />
                  <div className="text-sm">
                    <EssayAction
                      essay={essay}
                      taskId={task.id}
                      retryGradeEssay={retryGradeEssay}
                      fallbackToMockGrading={fallbackToMockGrading}
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
