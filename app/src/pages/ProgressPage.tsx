import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { EssayStatusChip } from '../components/EssayStatusChip'
import { NextActionPanel } from '../components/NextActionPanel'
import { ProgressSummary } from '../components/ProgressSummary'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import type { Essay } from '../types'
import { findEssaysByTask, findTask } from '../utils/taskLookup'
import { getProgressNextAction } from '../utils/workflow'

const processableStatuses = ['pending_ocr', 'ocr_running', 'pending_grading', 'grading']

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

export function ProgressPage() {
  const { taskId = '' } = useParams()
  const { tasks, essays, completeEssayWithMockResult } = useAppState()
  const [completionNotice, setCompletionNotice] = useState('')
  const noticeTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const task = findTask(tasks, taskId)
  const taskEssays = findEssaysByTask(essays, taskId)

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

  const nextAction = getProgressNextAction(task, taskEssays)
  const nextProcessableEssay = taskEssays.find((essay) => processableStatuses.includes(essay.status))
  const hasExceptions = taskEssays.some((essay) => essay.status === 'needs_review')
  const panelAction = nextProcessableEssay
    ? {
        tone: 'info' as const,
        title: `${taskEssays.filter((essay) => processableStatuses.includes(essay.status)).length} 篇作文仍在模拟处理中`,
        description: '可以逐篇模拟完成批改，完成后会生成可查看的 mock 批改结果。',
        primaryLabel: '模拟完成下一篇',
        primaryTo: `/tasks/${task.id}/progress`,
        secondaryLabel: hasExceptions ? '查看异常队列' : undefined,
        secondaryTo: hasExceptions ? `/tasks/${task.id}/exceptions` : undefined,
      }
    : nextAction.primaryLabel === '模拟完成下一篇'
      ? {
          ...nextAction,
          primaryLabel: '去上传作文',
          primaryTo: `/tasks/${task.id}/upload`,
        }
      : nextAction

  const completeNextEssay = () => {
    if (!nextProcessableEssay) return

    completeEssayWithMockResult(nextProcessableEssay.id)
    setCompletionNotice(`${nextProcessableEssay.essayNumber} 已完成批改，可查看结果`)
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current)
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setCompletionNotice('')
      noticeTimerRef.current = null
    }, 3000)
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
        <NextActionPanel
          action={panelAction}
          onPrimaryClick={nextProcessableEssay ? completeNextEssay : undefined}
        />
        {completionNotice ? (
          <div
            role="status"
            className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-sm"
          >
            {completionNotice}
          </div>
        ) : null}
        <div className="grid gap-3 md:hidden">
          {taskEssays.map((essay) => (
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
              {taskEssays.map((essay) => (
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
      </div>
    </AppLayout>
  )
}
