import type { ClassInsightItem } from '../types'

interface ClassInsightPanelProps {
  title: string
  items: ClassInsightItem[]
  large?: boolean
}

export function ClassInsightPanel({ title, items, large = false }: ClassInsightPanelProps) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 h-1 w-12 rounded-full bg-cyan-400" />
      <h3 className={large ? 'text-2xl font-semibold text-slate-950' : 'font-semibold text-slate-950'}>
        {title}
      </h3>
      <div className="mt-4 grid gap-3">
        {items.map((item) => (
          <article key={item.id} className="rounded-lg bg-slate-50 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className={large ? 'text-xl font-semibold text-slate-900' : 'font-semibold text-slate-900'}>
                  {item.title}
                </p>
                <p className={large ? 'mt-2 text-base leading-7 text-slate-600' : 'mt-1 text-sm text-slate-500'}>
                  {item.detail}
                </p>
              </div>
              {item.count ? (
                <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-800">
                  {item.count} 次
                </span>
              ) : null}
            </div>
            <ul className="mt-3 space-y-1">
              {item.examples.map((example) => (
                <li
                  key={example}
                  className={large ? 'text-lg leading-8 text-slate-800' : 'text-sm text-slate-600'}
                >
                  {example}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  )
}
