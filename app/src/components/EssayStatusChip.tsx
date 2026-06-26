import { Check } from 'lucide-react'
import type { EssayStatus } from '../types'
import { getEssayStatusMeta } from '../utils/workflow'

export function EssayStatusChip({ status }: { status: EssayStatus }) {
  const meta = getEssayStatusMeta(status)

  return (
    <span
      className={[
        'status-chip inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
        meta.className,
        meta.animated ? 'status-chip-active' : '',
      ].join(' ')}
    >
      {meta.animated ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {meta.showCheck ? <Check className="h-3.5 w-3.5" /> : null}
      {meta.label}
    </span>
  )
}
