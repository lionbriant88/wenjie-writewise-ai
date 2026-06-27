import type { ErrorAnnotation } from '../types'

export function ErrorAnnotationList({ annotations }: { annotations: ErrorAnnotation[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="font-semibold text-slate-950">错误标注</h3>
      <div className="mt-4 space-y-3">
        {annotations.map((item) => (
          <div key={item.id} className="rounded-lg bg-slate-50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
                {item.type}
              </span>
              <span className="text-xs text-slate-500">{item.severity}</span>
            </div>
            <p className="mt-2 text-sm text-slate-500 line-through">{item.original}</p>
            <p className="mt-1 text-sm font-medium text-slate-900">{item.suggestion}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{item.explanation}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
