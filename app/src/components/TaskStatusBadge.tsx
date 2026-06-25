import type { TaskStatus } from '../types'

const statusMap: Record<TaskStatus, { label: string; className: string }> = {
  draft: { label: '草稿', className: 'bg-slate-100 text-slate-700' },
  processing: { label: '处理中', className: 'bg-amber-100 text-amber-800' },
  ready: { label: '已完成', className: 'bg-emerald-100 text-emerald-800' },
  needs_review: { label: '需复核', className: 'bg-rose-100 text-rose-800' },
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const item = statusMap[status]
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${item.className}`}>
      {item.label}
    </span>
  )
}
