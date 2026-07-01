import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, CheckCircle2, ListFilter, TriangleAlert } from 'lucide-react'
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
  processing: '当前没有处理中作文。',
  review: '当前没有需复核作文。',
  completed: '当前没有已完成作文。',
}

function getMockProcessingProgress(essay: Essay) {
  const numericSeed = Array.from(essay.id).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const base = essay.status === 'pending_grading' ? 42 : 68
  return Math.min(92, base + (numericSeed % 18))
}

function getProcessingStage(essay: Essay) {
  if (essay.status === 'pending_ocr') return '等待 OCR 识别'
  if (essay.status === 'ocr_running') return '正在识别作文文本'
  if (essay.status === 'pending_grading') return '等待 AI 批改'
  return '正在生成修改建议'
}

function ProcessingProgress({ essay }: { essay: Essay }) {
  const progress = getMockProcessingProgress(essay)

  return (
    <div className="min-w-[150px]">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-blue-700">模拟进度</span>
        <span className="font-semibold text-slate-600">{progress}%</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-slate-100">
        <div className="h-1.5 rounded-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">{getProcessingStage(essay)}</p>
    </div>
  )
}

function EssayAction({ essay, taskId }: { essay: Essay; taskId: string }) {
  if (essay.status === 'completed') {
    return (
      <Link to={`/tasks/${taskId}/essays/${essay.id}`} className="font-semibold text-blue-700">
        查看结果
      </Link>
    )
  }

  if (essay.status === 'needs_review') {
    return (
      <Link to={`/tasks/${taskId}/exceptions`} className="font-semibold text-rose-700">
        去复核
      </Link>
    )
  }

  if (essay.status === 'manual') {
    return <span className="font-semibold text-amber-700">已人工处理</span>
  }

  return <ProcessingProgress essay={essay} />
}

function getQueueDescription(queueStats: ReturnType<typeof getProgressQueueStats>) {
  if (queueStats.total === 0) {
    return '上传作文后，这里会显示 OCR 与 AI 批改队列。'
  }

  if (queueStats.processing > 0) {
    return '可以逐篇或批量模拟完成批改，完成后会生成可查看的 mock 批改结果。'
  }

  if (queueStats.reviewNeeded > 0) {
    return '当前没有可自动推进的作文，请先处理需要人工复核的异常项。'
  }

  return '当前批改队列已处理完毕，可以进入班级总览查看整体讲评素材。'
}

export function ProgressPage() {
  const { taskId = '' } = useParams()
  const { tasks, essays, completeEssayWithMockResult } = useAppState()
  const [completionNotice, setCompletionNotice] = useState('')
  const [activeTab, setActiveTab] = useState<ProgressQueueTab>('all')
  const noticeTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const task = findTask(tasks, taskId)
  const taskEssays = findEssaysByTask(essays, taskId)
  const queueStats = getProgressQueueStats(taskEssays)
  const filteredEssays = filterEssaysByProgressTab(taskEssays, activeTab)
  const processableEssays = taskEssays.filter((essay) => isProcessableEssayStatus(essay.status))
  const nextProcessableEssay = processableEssays[0]
  const hasExceptions = queueStats.reviewNeeded > 0
  const activeTabLabel = progressTabs.find((tab) => tab.id === activeTab)?.label ?? '全部'

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        window.clearTimeout(noticeTimerRef.current)
      }
    }
  }, [])

  if (!task) {
    return <EmptyState title="找不到任务" description="请返回任务列表重新选择一个批改任务。" />
  }

  const showCompletionNotice = (message: string) => {
    setCompletionNotice(message)
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current)
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setCompletionNotice('')
      noticeTimerRef.current = null
    }, 3000)
  }

  const completeNextEssay = () => {
    if (!nextProcessableEssay) return

    completeEssayWithMockResult(nextProcessableEssay.id)
    showCompletionNotice(`${nextProcessableEssay.essayNumber} 已完成批改，可查看结果`)
  }

  const completeAllProcessableEssays = () => {
    if (processableEssays.length === 0) return

    processableEssays.forEach((essay) => completeEssayWithMockResult(essay.id))
    showCompletionNotice(`${processableEssays.length} 篇作文已完成批改，可查看结果`)
  }

  const getTabCount = (tab: ProgressQueueTab) => {
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
      description="模拟后台 OCR 与 AI 批改队列，让教师不用逐篇等待。"
    >
      <div className="space-y-6">
        <ProgressSummary essays={taskEssays} />
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-blue-50 p-2 text-blue-700">
                {hasExceptions ? <TriangleAlert className="h-5 w-5" /> : <ListFilter className="h-5 w-5" />}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-950">
                  当前队列：{queueStats.processing} 篇处理中，{queueStats.reviewNeeded} 篇需人工复核。
                </p>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                  {getQueueDescription(queueStats)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {nextProcessableEssay ? (
                <button
                  type="button"
                  onClick={completeNextEssay}
                  className="tech-focus inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 active:scale-[0.99]"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  模拟完成下一篇
                </button>
              ) : null}
              {processableEssays.length > 1 ? (
                <button
                  type="button"
                  onClick={completeAllProcessableEssays}
                  className="tech-focus inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-800 transition hover:bg-blue-100"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  模拟完成全部可处理
                </button>
              ) : null}
              {hasExceptions ? (
                <Link
                  to={`/tasks/${task.id}/exceptions`}
                  className="tech-focus inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                >
                  <TriangleAlert className="h-4 w-4" />
                  查看异常队列
                </Link>
              ) : null}
              {!nextProcessableEssay && !hasExceptions && queueStats.total > 0 ? (
                <Link
                  to={`/tasks/${task.id}/class-review`}
                  className="tech-focus inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50"
                >
                  进入班级总览
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ) : null}
              {queueStats.total === 0 ? (
                <Link
                  to={`/tasks/${task.id}/upload`}
                  className="tech-focus inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50"
                >
                  去上传作文
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ) : null}
            </div>
          </div>
        </section>
        {completionNotice ? (
          <div
            role="status"
            className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-sm"
          >
            {completionNotice}
          </div>
        ) : null}
        <div className="space-y-3">
          <div
            role="tablist"
            aria-label="批改状态筛选"
            className="flex gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-white p-2"
          >
            {progressTabs.map((tab) => {
              const isSelected = activeTab === tab.id
              const selectedClass =
                tab.id === 'review'
                  ? 'border-rose-200 bg-rose-50 text-rose-800'
                  : 'border-blue-200 bg-blue-50 text-blue-800'

              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setActiveTab(tab.id)}
                  className={`tech-focus min-w-max rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                    isSelected
                      ? selectedClass
                      : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {tab.label} {getTabCount(tab.id)}
                </button>
              )
            })}
          </div>
          <p className="text-sm font-medium text-slate-600">当前显示：{activeTabLabel}</p>
        </div>
        {filteredEssays.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
            {emptyTabText[activeTab]}
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:hidden">
              {filteredEssays.map((essay) => (
                <article key={essay.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-950">{essay.essayNumber}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {essay.pageCount} 页 · OCR {Math.round(essay.ocrConfidence * 100)}%
                      </p>
                    </div>
                    <EssayStatusChip status={essay.status} />
                  </div>
                  <div className="mt-3 text-sm">
                    <EssayAction essay={essay} taskId={task.id} />
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white md:block">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">作文编号</th>
                    <th className="px-4 py-3 font-semibold">页数</th>
                    <th className="px-4 py-3 font-semibold">OCR 置信度</th>
                    <th className="px-4 py-3 font-semibold">状态</th>
                    <th className="px-4 py-3 font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredEssays.map((essay) => (
                    <tr key={essay.id}>
                      <td className="px-4 py-3 font-medium text-slate-900">{essay.essayNumber}</td>
                      <td className="px-4 py-3 text-slate-600">{essay.pageCount}</td>
                      <td className="px-4 py-3 text-slate-600">{Math.round(essay.ocrConfidence * 100)}%</td>
                      <td className="px-4 py-3 text-slate-600">
                        <EssayStatusChip status={essay.status} />
                      </td>
                      <td className="px-4 py-3">
                        <EssayAction essay={essay} taskId={task.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  )
}
