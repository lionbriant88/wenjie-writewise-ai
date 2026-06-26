import { BookOpenCheck, ClipboardList, FileCheck2, Presentation, Upload } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import type { WorkflowStep } from '../utils/workflow'

const iconMap = {
  upload: Upload,
  progress: ClipboardList,
  exceptions: BookOpenCheck,
  results: FileCheck2,
  'class-review': Presentation,
}

export function WorkflowNav({ steps }: { steps: WorkflowStep[] }) {
  return (
    <nav className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
      {steps.map((step) => {
        const Icon = iconMap[step.id]
        return (
          <NavLink
            key={step.id}
            to={step.to}
            className={({ isActive }) =>
              [
                'tech-focus inline-flex min-w-max items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition',
                isActive || step.current
                  ? 'border-blue-200 bg-blue-50 text-blue-800 shadow-[0_0_0_1px_rgba(37,99,235,0.08)]'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-cyan-200 hover:bg-cyan-50/60 hover:text-slate-900',
              ].join(' ')
            }
          >
            <Icon className="h-4 w-4" />
            {step.label}
          </NavLink>
        )
      })}
    </nav>
  )
}
