import { ArrowLeft, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { TaskStatusBadge } from '../components/TaskStatusBadge'
import type { Task } from '../types'
import { WorkflowNav } from '../components/WorkflowNav'
import { getWorkflowSteps, type WorkflowStepId } from '../utils/workflow'

interface AppLayoutProps {
  children: ReactNode
  task?: Task
  title: string
  description?: string
  currentStep?: WorkflowStepId
}

export function AppLayout({ children, task, title, description, currentStep }: AppLayoutProps) {
  const workflowSteps = task && currentStep ? getWorkflowSteps(task.id, currentStep) : []

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-slate-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-72 shrink-0 border-r border-slate-200 bg-white px-5 py-6 lg:block">
          <Link to="/" className="block rounded-lg border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
              <Sparkles className="h-3.5 w-3.5 text-cyan-500" />
              文阶
            </div>
            <h1 className="mt-1 text-xl font-semibold text-slate-950">WriteWise AI</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">英语作文批改与课堂讲评工作台</p>
          </Link>

          <div className="mt-6 space-y-2">
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
            {workflowSteps.length > 0 ? (
              <WorkflowNav steps={workflowSteps} ariaLabel="任务流程导航" />
            ) : null}
          </div>

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
              {workflowSteps.length > 0 ? (
                <div className="mt-4 lg:hidden">
                  <WorkflowNav steps={workflowSteps} ariaLabel="移动端任务流程导航" />
                </div>
              ) : null}
            </div>
          </header>
          <div className="mx-auto max-w-7xl px-5 py-6 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
