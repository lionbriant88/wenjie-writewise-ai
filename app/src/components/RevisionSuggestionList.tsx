import type { SentenceRevision, UpgradedExpression } from '../types'

interface RevisionSuggestionListProps {
  revisions: SentenceRevision[]
  upgrades: UpgradedExpression[]
}

export function RevisionSuggestionList({ revisions, upgrades }: RevisionSuggestionListProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="font-semibold text-slate-950">修改建议与升级表达</h3>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {revisions.map((item) => (
          <div key={item.id} className="rounded-lg bg-blue-50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold text-blue-700">错句修改</p>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                对应错误标注
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-500 line-through">{item.original}</p>
            <p className="mt-1 text-sm font-medium text-slate-950">{item.revised}</p>
            <p className="mt-1 text-xs text-slate-500">{item.note}</p>
          </div>
        ))}
        {upgrades.map((item) => (
          <div key={item.id} className="rounded-lg bg-emerald-50 p-3">
            <p className="text-xs font-semibold text-emerald-700">升级表达</p>
            <p className="mt-2 text-sm text-slate-500">{item.original}</p>
            <p className="mt-1 text-sm font-medium text-slate-950">{item.upgraded}</p>
            <p className="mt-1 text-xs text-slate-500">{item.note}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
