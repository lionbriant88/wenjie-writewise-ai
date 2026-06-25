import type { EssayPage } from '../types'
import { EssayImagePreview } from './EssayImagePreview'

interface EssayPageSorterProps {
  pages: EssayPage[]
  onMove?: (pageId: string, direction: 'up' | 'down') => void
}

export function EssayPageSorter({ pages, onMove }: EssayPageSorterProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {pages.map((page, index) => (
        <div key={page.id} className="rounded-lg bg-slate-50 p-2">
          <EssayImagePreview page={page} />
          {onMove ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => onMove(page.id, 'up')}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 disabled:opacity-40"
              >
                上移
              </button>
              <button
                type="button"
                disabled={index === pages.length - 1}
                onClick={() => onMove(page.id, 'down')}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 disabled:opacity-40"
              >
                下移
              </button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
