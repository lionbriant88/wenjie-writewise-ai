import { useState } from 'react'
import type { ErrorAnnotation, SentenceRevision } from '../types'

interface IssueCorrectionListProps {
  annotations: ErrorAnnotation[]
  revisions: SentenceRevision[]
}

const severityTone: Record<ErrorAnnotation['severity'], string> = {
  low: 'bg-slate-100 text-slate-600',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-rose-100 text-rose-700',
}

export function IssueCorrectionList({ annotations, revisions }: IssueCorrectionListProps) {
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
          <p className="mt-1 text-xs text-slate-500">合并展示原文问题、修改建议和教师可复用的讲评点。</p>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {annotations.map((item) => {
          const revision = revisionByErrorId.get(item.id)
          const isAdded = addedIds.has(item.id)

          return (
            <div key={item.id} className="rounded-lg bg-slate-50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-semibold text-cyan-700">
                  {item.type}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${severityTone[item.severity]}`}>
                  {item.severity}
                </span>
              </div>
              <div className="mt-3 grid gap-2 text-sm">
                <p className="text-slate-500">
                  <span className="font-semibold text-slate-700">原句：</span>
                  <span className="line-through">{item.original}</span>
                </p>
                <p className="font-medium text-slate-950">
                  <span className="font-semibold text-slate-700">修改：</span>
                  {revision?.revised ?? item.suggestion}
                </p>
                <p className="text-xs leading-5 text-slate-500">
                  <span className="font-semibold text-slate-600">说明：</span>
                  {revision?.note ?? item.explanation}
                </p>
              </div>
              <button
                type="button"
                onClick={() => markAdded(item.id)}
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
