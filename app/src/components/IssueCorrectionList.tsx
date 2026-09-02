import { useRef, useState } from 'react'
import { getSeverityImpactLabel } from '../utils/gradingDiagnostics'
import type { ReviewIssueCardItem } from '../utils/reviewIssueItems'

export type IssueClassReviewState = 'available' | 'teacher_selected' | 'system_included'

interface IssueCorrectionListProps {
  items: ReviewIssueCardItem[]
  activeIssueId?: string | null
  activeIssueLocateStatus?: 'idle' | 'located' | 'missing'
  onIssueSelect?: (issueId: string) => void
  getIssueClassReviewState?: (issue: ReviewIssueCardItem) => IssueClassReviewState
  isIssueAdded?: (issue: ReviewIssueCardItem) => boolean
  onAddIssue?: (issue: ReviewIssueCardItem) => void
  onRemoveIssue?: (issue: ReviewIssueCardItem) => void
  onUndoRemove?: () => void
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
  getIssueClassReviewState,
  isIssueAdded = () => false,
  onAddIssue,
  onRemoveIssue,
  onUndoRemove,
}: IssueCorrectionListProps) {
  const [undoIssue, setUndoIssue] = useState<ReviewIssueCardItem | null>(null)
  const [liveMessage, setLiveMessage] = useState('')
  const actionButtonRefs = useRef(new Map<string, HTMLButtonElement | null>())
  const undoButtonRef = useRef<HTMLButtonElement | null>(null)

  const resolveIssueState = (issue: ReviewIssueCardItem): IssueClassReviewState =>
    getIssueClassReviewState?.(issue) ?? (isIssueAdded(issue) ? 'teacher_selected' : 'available')

  const focusUndo = () => {
    window.setTimeout(() => undoButtonRef.current?.focus(), 0)
  }

  const focusIssueAction = (issueId: string) => {
    window.setTimeout(() => actionButtonRefs.current.get(issueId)?.focus(), 0)
  }

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
      <div aria-live="polite" className="sr-only">{liveMessage}</div>
      {undoIssue ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>已将“{undoIssue.typeLabel}”移出班级总览。</span>
          <button
            ref={undoButtonRef}
            type="button"
            onClick={() => {
              const issueId = undoIssue.id
              onUndoRemove?.()
              setUndoIssue(null)
              setLiveMessage(`已撤销移出 ${undoIssue.typeLabel}`)
              focusIssueAction(issueId)
            }}
            className="tech-focus min-h-11 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
          >
            撤销移出班级总览
          </button>
        </div>
      ) : null}
      <div className="mt-4 space-y-3">
        {items.map((item) => {
          const issueState = resolveIssueState(item)
          const isAdded = issueState === 'teacher_selected'
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
            <article
              key={item.id}
              aria-label={`${item.typeLabel} ${item.original}`}
              className={`rounded-lg border p-2.5 text-left transition ${
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
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onIssueSelect?.(item.id)}
                    className="tech-focus min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50"
                  >
                    定位原文
                  </button>
                  {issueState === 'system_included' ? (
                    <span className="inline-flex min-h-11 items-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                      已自动归纳
                    </span>
                  ) : (
                    <button
                      ref={(node) => {
                        if (node) actionButtonRefs.current.set(item.id, node)
                        else actionButtonRefs.current.delete(item.id)
                      }}
                      type="button"
                      onClick={() => {
                        if (isAdded) {
                          onRemoveIssue?.(item)
                          setUndoIssue(item)
                          setLiveMessage(`已将 ${item.typeLabel} 移出班级总览，可撤销`)
                          focusUndo()
                        } else {
                          onAddIssue?.(item)
                          setUndoIssue(null)
                          setLiveMessage(`已将 ${item.typeLabel} 加入班级总览`)
                        }
                      }}
                      className={`tech-focus min-h-11 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                        isAdded
                          ? 'border-amber-200 bg-white text-amber-700 hover:bg-amber-50'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-cyan-200 hover:bg-cyan-50'
                      }`}
                    >
                      {isAdded ? '移出班级总览' : '加入班级总览'}
                    </button>
                  )}
                </div>
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
            </article>
          )
        })}
      </div>
    </div>
  )
}
