import { Link } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { TaskStatusBadge } from '../components/TaskStatusBadge'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import { calculateProgress } from '../utils/progress'
import { findEssaysByTask } from '../utils/taskLookup'

export function TaskListPage() {
  const { tasks, essays } = useAppState()
  const taskTotal = tasks.length
  const essayTotal = tasks.reduce((total, task) => total + task.totalEssayCount, 0)
  const reviewTotal = tasks.reduce((total, task) => total + task.exceptionEssayCount, 0)
  const processingTotal = tasks.filter((task) => task.status === 'processing' || task.status === 'needs_review').length

  return (
    <AppLayout
      title="今日工作台"
      description="集中查看批改任务状态、复核压力和班级总览入口。"
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
        <div className="space-y-5">
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-5 text-white shadow-[0_16px_40px_rgba(15,23,42,0.16)]">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
              <div>
                <p className="text-sm font-medium text-cyan-200">文阶 AI 批改</p>
                <h3 className="mt-1 text-2xl font-semibold">批改与复核队列</h3>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:min-w-[480px]">
                <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
                  <p className="text-xs text-slate-300">任务</p>
                  <p className="mt-1 text-xl font-semibold">{taskTotal}</p>
                </div>
                <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
                  <p className="text-xs text-slate-300">作文</p>
                  <p className="mt-1 text-xl font-semibold">{essayTotal}</p>
                </div>
                <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
                  <p className="text-xs text-slate-300">处理中</p>
                  <p className="mt-1 text-xl font-semibold">{processingTotal}</p>
                </div>
                <div className="rounded-md border border-rose-300/20 bg-rose-300/10 px-3 py-2">
                  <p className="text-xs text-rose-100">待复核</p>
                  <p className="mt-1 text-xl font-semibold">{reviewTotal}</p>
                </div>
              </div>
            </div>
          </div>

          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <h3 className="font-semibold text-slate-950">任务队列</h3>
                <p className="mt-1 text-sm text-slate-500">按班级任务查看批改进度和下一步动作。</p>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
            {tasks.map((task) => {
              const taskEssays = findEssaysByTask(essays, task.id)
              const progress = calculateProgress(taskEssays)

              return (
                <article key={task.id} className="px-4 py-4 transition hover:bg-slate-50">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.8fr)_auto] lg:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-base font-semibold text-slate-950">{task.taskName}</h3>
                        <TaskStatusBadge status={task.status} />
                      </div>
                      <p className="mt-1 text-sm text-slate-500">
                        {task.className} · {task.essayType} · 满分 {task.fullScore}
                      </p>
                    </div>
                    <div>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-medium text-slate-700">完成 {progress.completed}/{progress.total}</span>
                        <span className="text-slate-500">复核 {progress.exceptions}</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-[width] duration-500"
                          style={{ width: `${progress.completionPercent}%` }}
                        />
                      </div>
                    </div>
                    <Link
                      to={`/tasks/${task.id}/progress`}
                      aria-label={`查看${task.taskName}的批改进度`}
                      className="tech-focus inline-flex items-center justify-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
                    >
                      立即处理
                    </Link>
                  </div>
                </article>
              )
            })}
            </div>
          </section>
        </div>
      )}
    </AppLayout>
  )
}
