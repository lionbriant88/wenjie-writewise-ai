import type { ScoreDimension } from '../types'

interface ScoreBreakdownProps {
  dimensions: ScoreDimension[]
  editable?: boolean
  onChange?: (dimensionId: string, score: number) => void
}

export function ScoreBreakdown({ dimensions, editable = false, onChange }: ScoreBreakdownProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="font-semibold text-slate-950">分项评分</h3>
      <div className="mt-4 space-y-4">
        {dimensions.map((dimension) => {
          const percent = Math.round((dimension.score / dimension.maxScore) * 100)
          return (
            <div key={dimension.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{dimension.name}</p>
                  <p className="mt-1 text-xs text-slate-500">{dimension.reason}</p>
                </div>
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
                    className="w-24 rounded-md border border-slate-200 px-2 py-1 text-sm"
                  />
                ) : (
                  <p className="text-sm font-semibold text-slate-900">
                    {dimension.score.toFixed(1)} / {dimension.maxScore}
                  </p>
                )}
              </div>
              <div className="mt-2 h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-blue-600" style={{ width: `${percent}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
