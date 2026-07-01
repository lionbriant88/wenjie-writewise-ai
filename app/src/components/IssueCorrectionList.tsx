import { getSeverityImpactLabel } from '../utils/gradingDiagnostics'
import type { ReviewIssueCardItem } from '../utils/reviewIssueItems'

interface IssueCorrectionListProps {
  items: ReviewIssueCardItem[]
  activeIssueId?: string | null
  activeIssueLocateStatus?: 'idle' | 'located' | 'missing'
  onIssueSelect?: (issueId: string) => void
  isIssueAdded?: (issue: ReviewIssueCardItem) => boolean
  onAddIssue?: (issue: ReviewIssueCardItem) => void
}

const severityTone: Record<ReviewIssueCardItem['severity'], string> = {
  low: 'bg-slate-100 text-slate-600',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-rose-100 text-rose-700',
}

export function IssueCorrectionList({
  items,
  activeIssueId,
  activeIssueLocateStatus = 'idle',
  onIssueSelect,
  isIssueAdded = () => false,
  onAddIssue,
}: IssueCorrectionListProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-950">问题与修改建议</h3>
          <p className="mt-1 text-xs text-slate-500">
            合并展示原文问题、修改建议和教师可复用的讲评点。
          </p>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {items.map((item) => {
          const isAdded = isIssueAdded(item)
          const isActive = activeIssueId === item.id
          const locateLabel =
            isActive && activeIssueLocateStatus === 'located'
              ? '已定位'
              : isActive && activeIssueLocateStatus === 'missing'
                ? '未精确定位'
                : ''
          const locateTone =
            activeIssueLocateStatus === 'missing' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-700'

          return (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              aria-pressed={isActive}
              onClick={() => onIssueSelect?.(item.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onIssueSelect?.(item.id)
                }
              }}
              className={`tech-focus cursor-pointer rounded-lg border p-2.5 text-left transition ${
                isActive
                  ? 'border-blue-200 bg-blue-50 shadow-[0_0_0_1px_rgba(37,99,235,0.08)]'
                  : 'border-slate-100 bg-slate-50 hover:border-cyan-200 hover:bg-cyan-50/60'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-semibold text-cyan-700">
                    <span className="sr-only">问题类型</span>
                    问题类型：{item.typeLabel}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${severityTone[item.severity]}`}>
                    <span className="sr-only">扣分影响</span>
                    扣分影响：{getSeverityImpactLabel(item.severity)}
                  </span>
                  {locateLabel ? (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${locateTone}`}>
                      {locateLabel}
                    </span>
                  ) : null}
                  {item.needsTeacherReview ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      建议教师复核
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onAddIssue?.(item)
                  }}
                  className={`tech-focus inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                    isAdded
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-cyan-200 hover:bg-cyan-50'
                  }`}
                >
                  {isAdded ? '已加入班级总览' : '加入班级总览'}
                </button>
              </div>
              <dl className="mt-2 grid gap-1.5 text-sm">
                <div className="grid gap-1 md:grid-cols-[72px_minmax(0,1fr)]">
                  <dt className="text-xs font-semibold text-slate-500">原句</dt>
                  <dd className="text-slate-600 line-through">{item.original}</dd>
                </div>
                {item.source === 'language' ? (
                  <>
                    <div className="grid gap-1 md:grid-cols-[72px_minmax(0,1fr)]">
                      <dt className="text-xs font-semibold text-slate-500">推荐改法</dt>
                      <dd className="font-medium text-slate-950">{item.suggestion}</dd>
                    </div>
                    <div className="grid gap-1 md:grid-cols-[72px_minmax(0,1fr)]">
                      <dt className="text-xs font-semibold text-slate-500">原因</dt>
                      <dd className="text-xs leading-5 text-slate-500">{item.explanation}</dd>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid gap-1 md:grid-cols-[72px_minmax(0,1fr)]">
                      <dt className="text-xs font-semibold text-slate-500">诊断</dt>
                      <dd className="text-xs leading-5 text-slate-600">{item.diagnosis}</dd>
                    </div>
                    <div className="grid gap-1 md:grid-cols-[72px_minmax(0,1fr)]">
                      <dt className="text-xs font-semibold text-slate-500">建议处理</dt>
                      <dd className="font-medium text-slate-950">{item.suggestedActionLabel}</dd>
                    </div>
                    {item.conservativeSuggestion ? (
                      <div className="grid gap-1 md:grid-cols-[72px_minmax(0,1fr)]">
                        <dt className="text-xs font-semibold text-slate-500">保守建议</dt>
                        <dd className="text-xs leading-5 text-slate-500">{item.conservativeSuggestion}</dd>
                      </div>
                    ) : null}
                  </>
                )}
              </dl>
            </div>
          )
        })}
      </div>
    </div>
  )
}
