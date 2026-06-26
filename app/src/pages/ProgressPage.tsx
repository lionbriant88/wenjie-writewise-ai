import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { EssayStatusChip } from '../components/EssayStatusChip'
import { NextActionPanel } from '../components/NextActionPanel'
import { ProgressSummary } from '../components/ProgressSummary'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import { findEssaysByTask, findTask } from '../utils/taskLookup'
import { getProgressNextAction } from '../utils/workflow'

export function ProgressPage() {
  const { taskId = '' } = useParams()
  const { tasks, essays, completeEssayWithMockResult } = useAppState()
  const task = findTask(tasks, taskId)
  const taskEssays = findEssaysByTask(essays, taskId)
  const nextAction = task ? getProgressNextAction(task, taskEssays) : undefined
  const nextProcessableEssay = taskEssays.find((essay) =>
    ['pending_ocr', 'ocr_running', 'pending_grading', 'grading'].includes(essay.status),
  )

  if (!task) {
    return <EmptyState title="找不到任务" description="请返回任务列表重新选择一个批改任务。" />
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
        {nextAction ? (
          <NextActionPanel
            action={nextAction}
            onPrimaryClick={
              nextAction.primaryLabel === '模拟完成下一篇' && nextProcessableEssay
                ? () => completeEssayWithMockResult(nextProcessableEssay.id)
                : undefined
            }
          />
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
              <div className="mt-3">
                {essay.status === 'completed' ? (
                  <Link to={`/tasks/${task.id}/essays/${essay.id}`} className="text-sm font-semibold text-blue-700">
                    查看结果
                  </Link>
                ) : essay.status === 'needs_review' ? (
                  <Link to={`/tasks/${task.id}/exceptions`} className="text-sm font-semibold text-rose-700">
                    去复核
                  </Link>
                ) : (
                  <span className="text-sm text-slate-400">处理中</span>
                )}
              </div>
            </article>
          ))}
        </div>
        <div className="hidden overflow-hidden rounded-lg border border-slate-200 bg-white md:block">
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
                    {essay.status === 'completed' ? (
                      <Link to={`/tasks/${task.id}/essays/${essay.id}`} className="font-semibold text-blue-700">
                        查看结果
                      </Link>
                    ) : essay.status === 'needs_review' ? (
                      <Link to={`/tasks/${task.id}/exceptions`} className="font-semibold text-rose-700">
                        去复核
                      </Link>
                    ) : (
                      <span className="text-slate-400">处理中</span>
                    )}
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
