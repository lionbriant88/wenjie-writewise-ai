import { ArrowRight, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { ProgressSummary } from '../components/ProgressSummary'
import { StatCard } from '../components/StatCard'
import { TaskStatusBadge } from '../components/TaskStatusBadge'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import { findEssaysByTask } from '../utils/taskLookup'
import { getProgressNextAction } from '../utils/workflow'

export function TaskListPage() {
  const { tasks, essays } = useAppState()

  return (
    <AppLayout
      title="批改任务列表"
      description="以批改任务组织班级作文，先跑通上传、复核、结果和讲评的完整演示流程。"
    >
      {tasks.length === 0 ? (
        <EmptyState
          title="还没有批改任务"
          description="创建一个任务后，即可模拟批量上传作文并查看后续批改流程。"
          action={
            <Link
              to="/tasks/new"
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white"
            >
              创建第一个任务
            </Link>
          }
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard label="批改任务" value={tasks.length} />
            <StatCard
              label="作文总数"
              value={tasks.reduce((total, task) => total + task.totalEssayCount, 0)}
            />
            <StatCard
              label="需复核作文"
              value={tasks.reduce((total, task) => total + task.exceptionEssayCount, 0)}
            />
          </div>

          <div className="grid gap-3">
            {tasks.map((task) => {
              const taskEssays = findEssaysByTask(essays, task.id)
              const nextAction = getProgressNextAction(task, taskEssays)

              return (
                <article key={task.id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-lg font-semibold text-slate-950">{task.taskName}</h3>
                        <TaskStatusBadge status={task.status} />
                      </div>
                      <p className="mt-2 text-sm text-slate-500">
                        {task.className} · {task.essayType} · 满分 {task.fullScore}
                      </p>
                    </div>
                  </div>
                  <div className="mt-5">
                    <ProgressSummary essays={taskEssays} />
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      {task.exceptionEssayCount > 0 ? (
                        <TriangleAlert className="h-4 w-4 text-rose-600" />
                      ) : null}
                      <span>{nextAction.title}</span>
                    </div>
                    <Link
                      to={nextAction.primaryTo}
                      className="tech-focus inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
                    >
                      {nextAction.primaryLabel}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      )}
    </AppLayout>
  )
}
