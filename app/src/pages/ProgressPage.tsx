import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { ProgressSummary } from '../components/ProgressSummary'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import type { EssayStatus } from '../types'
import { findEssaysByTask, findTask } from '../utils/taskLookup'

const statusLabels: Record<EssayStatus, string> = {
  pending_ocr: '待识别',
  ocr_running: '识别中',
  pending_grading: '待批改',
  grading: '批改中',
  completed: '已完成',
  needs_review: '需人工复核',
  manual: '人工批改',
}

export function ProgressPage() {
  const { taskId = '' } = useParams()
  const { tasks, essays } = useAppState()
  const task = findTask(tasks, taskId)
  const taskEssays = findEssaysByTask(essays, taskId)

  if (!task) {
    return <EmptyState title="找不到任务" description="请返回任务列表重新选择一个批改任务。" />
  }

  return (
    <AppLayout task={task} title="批改进度" description="模拟后台 OCR 与 AI 批改队列，让教师不用逐篇等待。">
      <div className="space-y-6">
        <ProgressSummary essays={taskEssays} />
        <div className="flex flex-wrap gap-3">
          <Link to={`/tasks/${task.id}/exceptions`} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white">
            查看异常作文
          </Link>
          <Link to={`/tasks/${task.id}/class-review`} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white">
            查看班级讲评
          </Link>
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
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
                  <td className="px-4 py-3 text-slate-600">{statusLabels[essay.status]}</td>
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
