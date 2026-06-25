import { ArrowLeft, BookOpenCheck, ClipboardList, Presentation, Upload } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { TaskStatusBadge } from '../components/TaskStatusBadge'
import type { Task } from '../types'

interface AppLayoutProps {
  children: ReactNode
  task?: Task
  title: string
  description?: string
}

const taskLinks = (taskId: string) => [
  { to: `/tasks/${taskId}/upload`, label: '上传整理', icon: Upload },
  { to: `/tasks/${taskId}/progress`, label: '批改进度', icon: ClipboardList },
  { to: `/tasks/${taskId}/exceptions`, label: '异常复核', icon: BookOpenCheck },
  { to: `/tasks/${taskId}/class-review`, label: '班级讲评', icon: Presentation },
]

export function AppLayout({ children, task, title, description }: AppLayoutProps) {
  return (
    <div className="min-h-screen bg-[#f6f7f9] text-slate-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-72 shrink-0 border-r border-slate-200 bg-white px-5 py-6 lg:block">
          <Link to="/" className="block rounded-lg border border-slate-200 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
              文阶
            </p>
            <h1 className="mt-1 text-xl font-semibold text-slate-950">WriteWise AI</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">英语作文批改与课堂讲评工作台</p>
          </Link>

          <nav className="mt-6 space-y-2">
            <NavLink
              to="/"
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive ? 'bg-blue-50 text-blue-800' : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              <ArrowLeft className="h-4 w-4" />
              任务列表
            </NavLink>
            {task
              ? taskLinks(task.id).map((item) => {
                  const Icon = item.icon
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                          isActive
                            ? 'bg-blue-50 text-blue-800'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`
                      }
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </NavLink>
                  )
                })
              : null}
          </nav>

          {task ? (
            <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-900">{task.taskName}</p>
                <TaskStatusBadge status={task.status} />
              </div>
              <p className="mt-2 text-sm text-slate-500">{task.className}</p>
              <p className="mt-1 text-sm text-slate-500">
                {task.essayType} · 满分 {task.fullScore}
              </p>
            </div>
          ) : null}
        </aside>

        <main className="min-w-0 flex-1">
          <header className="border-b border-slate-200 bg-white px-5 py-5 lg:px-8">
            <div className="mx-auto max-w-7xl">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-blue-700">
                    {task ? `${task.className} · ${task.essayType}` : '教师端原型'}
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold text-slate-950">{title}</h2>
                  {description ? (
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                      {description}
                    </p>
                  ) : null}
                </div>
                <Link
                  to="/tasks/new"
                  className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-800"
                >
                  创建任务
                </Link>
              </div>
            </div>
          </header>
          <div className="mx-auto max-w-7xl px-5 py-6 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
