import type { ErrorAnnotation, ScoreDimension } from '../types'
import {
  calculateTotalScore,
  formatConfidence,
  formatDimensionScore,
  formatTotalScore,
  getGradeBand,
  getMainDeductionDimensions,
  getReviewRecommendation,
} from '../utils/gradingDiagnostics'

const gradeToneClass = {
  excellent: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  good: 'bg-blue-50 text-blue-700 border-blue-100',
  pass: 'bg-amber-50 text-amber-700 border-amber-100',
  weak: 'bg-rose-50 text-rose-700 border-rose-100',
  veryWeak: 'bg-slate-100 text-slate-700 border-slate-200',
}

interface DiagnosticScoreSummaryProps {
  aiConfidence: number
  dimensions: ScoreDimension[]
  fullScore: number
  issues: ErrorAnnotation[]
  onDimensionScoreChange: (dimensionId: string, score: number) => void
}

export function DiagnosticScoreSummary({
  aiConfidence,
  dimensions,
  fullScore,
  issues,
  onDimensionScoreChange,
}: DiagnosticScoreSummaryProps) {
  const safeFullScore = fullScore ?? 15
  const totalScore = calculateTotalScore(dimensions, safeFullScore)
  const gradeBand = getGradeBand(totalScore)
  const mainDeductions = getMainDeductionDimensions(dimensions)
  const reviewRecommendation = getReviewRecommendation({ totalScore, aiConfidence, issues })

  return (
    <section className="rounded-lg border border-blue-100 bg-white p-4 shadow-sm" aria-labelledby="diagnostic-summary-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-blue-700">AI 批改工作台</p>
          <h3 id="diagnostic-summary-title" className="mt-1 text-lg font-semibold text-slate-950">
            诊断摘要
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${gradeToneClass[gradeBand.tone]}`}>
            {gradeBand.label}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
            <span>讲评建议</span>
            <span className="mx-1 text-slate-400">/</span>
            <span>{reviewRecommendation}</span>
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-xs font-semibold text-slate-500">总分</p>
          <p className="mt-1 text-3xl font-semibold text-slate-950">
            {formatTotalScore(totalScore)}
            <span className="ml-1 text-base font-medium text-slate-500">/ {safeFullScore}</span>
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-500">AI 置信度</p>
          <p className="mt-2 text-sm font-semibold text-slate-800">{formatConfidence(aiConfidence)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-500">主要扣分项</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {mainDeductions.map((dimension) => (
              <span key={dimension.id} className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
                {dimension.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3">
        <div className="grid gap-2 lg:grid-cols-2">
          {dimensions.map((dimension) => {
            const isMainDeduction = mainDeductions.some((item) => item.id === dimension.id)

            return (
              <label key={dimension.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md bg-slate-50 px-3 py-2">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
                    {dimension.name}
                    {isMainDeduction ? (
                      <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700">
                        主要扣分
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">{dimension.reason}</span>
                </span>
                <span className="flex items-center gap-1">
                  <input
                    aria-label={`${dimension.name} 分数`}
                    type="number"
                    min={0}
                    max={dimension.maxScore}
                    step={0.05}
                    value={dimension.score}
                    onChange={(event) => onDimensionScoreChange(dimension.id, Number.parseFloat(event.target.value))}
                    className="tech-focus w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-semibold text-slate-900"
                  />
                  <span className="text-xs font-medium text-slate-500">/ {formatDimensionScore(dimension.maxScore)}</span>
                </span>
              </label>
            )
          })}
        </div>
      </div>
    </section>
  )
}
