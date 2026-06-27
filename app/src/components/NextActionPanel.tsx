import { ArrowRight, CheckCircle2, Sparkles, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { NextAction } from '../utils/workflow'

const toneStyles = {
  info: {
    icon: Sparkles,
    panel: 'border-blue-100 bg-white',
    iconBox: 'bg-blue-50 text-blue-700',
    button: 'bg-blue-700 text-white hover:bg-blue-800',
  },
  danger: {
    icon: TriangleAlert,
    panel: 'border-rose-100 bg-rose-50/50',
    iconBox: 'bg-rose-100 text-rose-700',
    button: 'bg-rose-600 text-white hover:bg-rose-700',
  },
  success: {
    icon: CheckCircle2,
    panel: 'border-emerald-100 bg-emerald-50/50',
    iconBox: 'bg-emerald-100 text-emerald-700',
    button: 'bg-emerald-700 text-white hover:bg-emerald-800',
  },
}

interface NextActionPanelProps {
  action: NextAction
  onPrimaryClick?: () => void
}

export function NextActionPanel({ action, onPrimaryClick }: NextActionPanelProps) {
  const styles = toneStyles[action.tone]
  const Icon = styles.icon

  const primaryClasses = `tech-focus inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition active:scale-[0.99] ${styles.button}`

  return (
    <section className={`rounded-lg border p-4 shadow-sm ${styles.panel}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${styles.iconBox}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-950">{action.title}</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">{action.description}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {onPrimaryClick ? (
            <button type="button" onClick={onPrimaryClick} className={primaryClasses}>
              {action.primaryLabel}
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <Link to={action.primaryTo} className={primaryClasses}>
              {action.primaryLabel}
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
          {action.secondaryLabel && action.secondaryTo ? (
            <Link
              to={action.secondaryTo}
              className="tech-focus inline-flex items-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50"
            >
              {action.secondaryLabel}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  )
}
