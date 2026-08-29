import type { ProgressQueueStats } from '../utils/progressQueue'
import { StatCard } from './StatCard'

export function ProgressSummary({ stats }: { stats: ProgressQueueStats }) {
  const reviewRate = stats.total === 0
    ? 0
    : Math.round((stats.reviewNeeded / stats.total) * 100)

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <StatCard label="作文总数" value={stats.total} />
      <StatCard label="已完成" value={stats.completed} hint={`${stats.completionRate}%`} />
      <StatCard label="待教师处理" value={stats.reviewNeeded} hint={`${reviewRate}%`} />
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm font-medium text-slate-500">整体进度</p>
        <div className="mt-4 h-3 rounded-full bg-slate-100">
          <div
            className="h-3 rounded-full bg-blue-600"
            style={{ width: `${stats.completionRate}%` }}
          />
        </div>
        <p className="mt-2 text-sm text-slate-500">
          已由教师确认 {stats.completed} / {stats.total} 篇
        </p>
      </div>
    </div>
  )
}
