import type { Essay } from '../types'
import { calculateProgress } from '../utils/progress'
import { StatCard } from './StatCard'

export function ProgressSummary({ essays }: { essays: Essay[] }) {
  const progress = calculateProgress(essays)

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <StatCard label="作文总数" value={progress.total} />
      <StatCard label="已完成" value={progress.completed} hint={`${progress.completionPercent}%`} />
      <StatCard label="需复核" value={progress.exceptions} hint={`${progress.exceptionPercent}%`} />
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm font-medium text-slate-500">整体进度</p>
        <div className="mt-4 h-3 rounded-full bg-slate-100">
          <div
            className="h-3 rounded-full bg-blue-600"
            style={{ width: `${progress.completionPercent}%` }}
          />
        </div>
        <p className="mt-2 text-sm text-slate-500">后台批改队列模拟</p>
      </div>
    </div>
  )
}
