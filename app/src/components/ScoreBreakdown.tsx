import type { ScoreDimension } from '../types'

interface ScoreBreakdownProps {
  dimensions: ScoreDimension[]
  editable?: boolean
  onChange?: (dimensionId: string, score: number) => void
}

export function ScoreBreakdown({ dimensions, editable = false, onChange }: ScoreBreakdownProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <h3 className="font-semibold text-slate-950">分项评分</h3>
      <div className="mt-2 divide-y divide-slate-100">
        {dimensions.map((dimension) => {
          const percent = Math.round((dimension.score / dimension.maxScore) * 100)
          const attentionLabel = percent <= 85 ? '主要扣分' : percent <= 92 ? '需关注' : null

          return (
            <div key={dimension.id} className="grid gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-800">{dimension.name}</p>
                  {attentionLabel ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        attentionLabel === '主要扣分'
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {attentionLabel}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs leading-4 text-slate-500">{dimension.reason}</p>
              </div>
              <div className="flex items-center gap-2 sm:justify-end">
                {editable ? (
                  <input
                    type="number"
                    min={0}
                    max={dimension.maxScore}
                    step={0.1}
                    value={dimension.score}
                    onChange={(event) =>
                      onChange?.(dimension.id, Number.parseFloat(event.target.value) || 0)
                    }
                    className="w-20 rounded-md border border-slate-200 px-2 py-1 text-sm font-semibold text-slate-900"
                  />
                ) : (
                  <p className="text-sm font-semibold text-slate-900">
                    {dimension.score.toFixed(1)} / {dimension.maxScore}
                  </p>
                )}
                {editable ? (
                  <span className="text-xs font-medium text-slate-500">/ {dimension.maxScore}</span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
