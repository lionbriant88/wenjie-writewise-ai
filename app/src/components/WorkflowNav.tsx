import { BookOpenCheck, ClipboardList, FileCheck2, Presentation, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { WorkflowStep } from '../utils/workflow'

const iconMap = {
  upload: Upload,
  progress: ClipboardList,
  exceptions: BookOpenCheck,
  results: FileCheck2,
  'class-review': Presentation,
}

interface WorkflowNavProps {
  steps: WorkflowStep[]
  ariaLabel?: string
}

export function WorkflowNav({ steps, ariaLabel = '作文批改流程' }: WorkflowNavProps) {
  return (
    <nav
      aria-label={ariaLabel}
      className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0"
    >
      {steps.map((step) => {
        const Icon = iconMap[step.id]
        return (
          <Link
            key={step.id}
            to={step.to}
            aria-current={step.current ? 'page' : undefined}
            className={[
              'tech-focus inline-flex min-w-max items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition',
              step.current
                ? 'border-blue-200 bg-blue-50 text-blue-800 shadow-[0_0_0_1px_rgba(37,99,235,0.08)]'
                : 'border-slate-200 bg-white text-slate-600 hover:border-cyan-200 hover:bg-cyan-50/60 hover:text-slate-900',
            ].join(' ')}
          >
            <Icon className="h-4 w-4" />
            {step.label}
          </Link>
        )
      })}
    </nav>
  )
}
