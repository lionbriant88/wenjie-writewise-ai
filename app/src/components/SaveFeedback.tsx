import { CheckCircle2 } from 'lucide-react'

interface SaveFeedbackProps {
  show: boolean
  label?: string
}

export function SaveFeedback({ show, label = '已保存调整' }: SaveFeedbackProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition',
        show
          ? 'translate-y-0 bg-emerald-50 text-emerald-700 opacity-100'
          : 'pointer-events-none translate-y-1 text-emerald-700 opacity-0',
      ].join(' ')}
    >
      {show ? (
        <>
          <CheckCircle2 className="h-3.5 w-3.5" />
          {label}
        </>
      ) : null}
    </span>
  )
}
