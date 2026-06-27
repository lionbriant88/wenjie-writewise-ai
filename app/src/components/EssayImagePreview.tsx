import type { EssayPage } from '../types'

export function EssayImagePreview({ page }: { page: EssayPage }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div
        className="flex aspect-[4/3] items-center justify-center bg-slate-100"
        style={{ background: `linear-gradient(135deg, ${page.accent}22, #ffffff)` }}
      >
        <div className="w-3/4 space-y-2">
          <div className="h-2 rounded bg-slate-400/50" />
          <div className="h-2 rounded bg-slate-400/40" />
          <div className="h-2 w-5/6 rounded bg-slate-400/40" />
          <div className="h-2 w-2/3 rounded bg-slate-400/30" />
        </div>
      </div>
      <div className="flex items-center justify-between px-3 py-2 text-xs">
        <span className="font-medium text-slate-700">{page.label}</span>
        <span className="text-slate-500">{page.quality}</span>
      </div>
    </div>
  )
}
