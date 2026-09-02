import type { ClearSpellingItemV1 } from '../services/classReview/types'

interface ClassReviewSpellingListProps {
  items: ClearSpellingItemV1[]
  promotedItemIds?: ReadonlySet<string>
  onPromote?: (itemId: string) => void
}

function compareSpellingItem(left: ClearSpellingItemV1, right: ClearSpellingItemV1): number {
  return left.originalWord.localeCompare(right.originalWord)
    || left.correctedWord.localeCompare(right.correctedWord)
    || left.itemId.localeCompare(right.itemId)
}

export function ClassReviewSpellingList({
  items,
  promotedItemIds = new Set<string>(),
  onPromote,
}: ClassReviewSpellingListProps) {
  const sortedItems = [...items].sort(compareSpellingItem)

  return (
    <section
      role="region"
      aria-label="明确拼写错误"
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-950">明确拼写错误</h3>
          <p className="mt-1 text-sm text-slate-500">
            只列入证据确定、修正唯一且无字迹歧义的低级拼写错误；默认不消耗 AI 调用。
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          {sortedItems.length} 项
        </span>
      </div>

      {sortedItems.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
          <p className="text-sm font-semibold text-slate-600">暂无明确拼写错误。</p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {sortedItems.map((item) => {
            const promoted = promotedItemIds.has(item.itemId)
            return (
              <article key={item.itemId} className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-950">
                      {item.originalWord} → {item.correctedWord}
                    </h4>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.studentCount} 名学生，出现 {item.occurrenceCount} 次
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={promoted}
                    onClick={() => onPromote?.(item.itemId)}
                    className="tech-focus min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:bg-white"
                  >
                    {promoted ? '已加入问题列表' : '加入共性问题'}
                  </button>
                </div>
                {item.anonymousExample ? (
                  <p className="mt-3 text-xs leading-5 text-slate-500">{item.anonymousExample}</p>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
