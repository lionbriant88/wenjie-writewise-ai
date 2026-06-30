import { useState } from 'react'
import { Check } from 'lucide-react'
import type { UpgradedExpression } from '../types'

export function ExpressionUpgradeList({ upgrades }: { upgrades: UpgradedExpression[] }) {
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())

  if (upgrades.length === 0) {
    return null
  }

  const markAdded = (id: string) => {
    setAddedIds((current) => new Set(current).add(id))
  }

  return (
    <section
      aria-labelledby="expression-upgrade-heading"
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="expression-upgrade-heading" className="font-semibold text-slate-950">
            表达升级建议
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            以下内容不是错误，而是可用于提升表达质量的替换建议。
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {upgrades.map((item) => {
          const isAdded = addedIds.has(item.id)

          return (
            <div key={item.id} className="rounded-lg border border-emerald-100 bg-emerald-50/70 p-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-emerald-700">
                  可选升级
                </p>
                <button
                  type="button"
                  onClick={() => markAdded(item.id)}
                  className={`tech-focus inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                    isAdded
                      ? 'border-emerald-200 bg-white text-emerald-700'
                      : 'border-emerald-200 bg-white text-slate-700 hover:bg-emerald-100'
                  }`}
                >
                  {isAdded ? <Check className="h-3.5 w-3.5" /> : null}
                  {isAdded ? '已加入班级总览' : '加入班级总览'}
                </button>
              </div>
              <dl className="mt-2 grid gap-1.5 text-sm">
                <div className="grid gap-1 md:grid-cols-[58px_minmax(0,1fr)]">
                  <dt className="text-xs font-semibold text-slate-500">原表达</dt>
                  <dd className="text-slate-600">{item.original}</dd>
                </div>
                <div className="grid gap-1 md:grid-cols-[58px_minmax(0,1fr)]">
                  <dt className="text-xs font-semibold text-slate-500">升级</dt>
                  <dd className="font-medium text-slate-950">{item.upgraded}</dd>
                </div>
                <div className="grid gap-1 md:grid-cols-[58px_minmax(0,1fr)]">
                  <dt className="text-xs font-semibold text-slate-500">说明</dt>
                  <dd className="text-xs leading-5 text-slate-500">{item.note}</dd>
                </div>
              </dl>
            </div>
          )
        })}
      </div>
    </section>
  )
}
