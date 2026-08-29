import { Check } from 'lucide-react'
import type { EssayStatus } from '../types'
import type { ProgressEssayPhase } from '../utils/progressQueue'
import { getEssayStatusMeta, getProgressEssayPhaseMeta } from '../utils/workflow'

export function EssayStatusChip({
  status,
  phase,
}: {
  status: EssayStatus
  phase?: ProgressEssayPhase
}) {
  const meta = phase ? getProgressEssayPhaseMeta(phase) : getEssayStatusMeta(status)

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
