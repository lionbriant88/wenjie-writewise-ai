import { useState } from 'react'
import type { ErrorAnnotation, SentenceRevision } from '../types'
import { getSeverityImpactLabel } from '../utils/gradingDiagnostics'

interface IssueCorrectionListProps {
  annotations: ErrorAnnotation[]
  revisions: SentenceRevision[]
  activeIssueId?: string | null
  onIssueSelect?: (issueId: string) => void
}

const severityTone: Record<ErrorAnnotation['severity'], string> = {
  low: 'bg-slate-100 text-slate-600',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-rose-100 text-rose-700',
}

export function IssueCorrectionList({
  annotations,
  revisions,
  activeIssueId,
  onIssueSelect,
}: IssueCorrectionListProps) {
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())
  const revisionByErrorId = new Map(revisions.map((item) => [item.relatedErrorId, item]))

  const markAdded = (id: string) => {
    setAddedIds((current) => new Set(current).add(id))
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
      <div className="mt-4 space-y-3">
        {annotations.map((item) => {
          const revision = revisionByErrorId.get(item.id)
          const isAdded = addedIds.has(item.id)
          const isActive = activeIssueId === item.id

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
              className={`tech-focus cursor-pointer rounded-lg border p-3 text-left transition ${
                isActive
                  ? 'border-blue-200 bg-blue-50 shadow-[0_0_0_1px_rgba(37,99,235,0.08)]'
                  : 'border-slate-100 bg-slate-50 hover:border-cyan-200 hover:bg-cyan-50/60'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-semibold text-cyan-700">
                  <span className="sr-only">问题类型</span>
                  问题类型：{item.type}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${severityTone[item.severity]}`}>
                  <span className="sr-only">扣分影响</span>
                  扣分影响：{getSeverityImpactLabel(item.severity)}
                </span>
                {isActive ? (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                    正在定位原文
                  </span>
                ) : null}
              </div>
              <dl className="mt-3 grid gap-2 text-sm">
                <div>
                  <dt className="text-xs font-semibold text-slate-500">原句</dt>
                  <dd className="mt-1 text-slate-600 line-through">{item.original}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">推荐改法</dt>
                  <dd className="mt-1 font-medium text-slate-950">{revision?.revised ?? item.suggestion}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">原因</dt>
                  <dd className="mt-1 text-xs leading-5 text-slate-500">{revision?.note ?? item.explanation}</dd>
                </div>
              </dl>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  markAdded(item.id)
                }}
                className={`tech-focus mt-3 inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                  isAdded
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-cyan-200 hover:bg-cyan-50'
                }`}
              >
                {isAdded ? '已加入班级总览' : '加入班级总览'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
