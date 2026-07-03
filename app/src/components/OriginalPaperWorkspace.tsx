import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Essay, EssayPage } from '../types'

type EssayPageWithPossibleImages = EssayPage & {
  previewUrl?: string
  imageUrl?: string
  imageUrls?: string[]
  url?: string
}

interface OriginalPaperWorkspaceProps {
  essay: Essay
  taskId: string
  previousEssayId?: string
  nextEssayId?: string
  onBackToGrading: () => void
}

function getOriginalImageUrl(page?: EssayPage) {
  if (!page) return undefined
  const pageWithImages = page as EssayPageWithPossibleImages
  return pageWithImages.previewUrl ?? pageWithImages.imageUrl ?? pageWithImages.imageUrls?.[0] ?? pageWithImages.url
}

function PaperEssaySwitchLink({
  direction,
  essayId,
  taskId,
}: {
  direction: 'previous' | 'next'
  essayId?: string
  taskId: string
}) {
  const label = direction === 'previous' ? '上一篇' : '下一篇'
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight
  const className = 'tech-focus inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-semibold transition'

  if (!essayId) {
    return (
      <button
        type="button"
        disabled
        className={`${className} cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400`}
      >
        {direction === 'previous' ? <Icon className="h-4 w-4" /> : null}
        {label}
        {direction === 'next' ? <Icon className="h-4 w-4" /> : null}
      </button>
    )
  }

  return (
    <Link
      to={`/tasks/${taskId}/essays/${essayId}`}
      className={`${className} border-slate-200 bg-white text-slate-700 hover:border-cyan-200 hover:bg-cyan-50`}
    >
      {direction === 'previous' ? <Icon className="h-4 w-4" /> : null}
      {label}
      {direction === 'next' ? <Icon className="h-4 w-4" /> : null}
    </Link>
  )
}

export function OriginalPaperWorkspace({
  essay,
  taskId,
  previousEssayId,
  nextEssayId,
  onBackToGrading,
}: OriginalPaperWorkspaceProps) {
  const [pageIndex, setPageIndex] = useState(0)
  const pages = essay.pages
  const pageCount = Math.max(pages.length, 1)
  const currentPage = pages[Math.min(pageIndex, pages.length - 1)]
  const originalImageUrl = getOriginalImageUrl(currentPage)

  useEffect(() => {
    setPageIndex(0)
  }, [essay.id])

  return (
    <section data-testid="paper-workspace" className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onBackToGrading}
              className="tech-focus inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50"
            >
              <ArrowLeft className="h-4 w-4" />
              返回批改工作台
            </button>
            <Link
              to={`/tasks/${taskId}/progress`}
              className="tech-focus inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50"
            >
              返回批改进度
            </Link>
          </div>
          <div className="text-center">
            <h2 className="text-base font-semibold text-slate-950">{essay.essayNumber} · 原卷视图</h2>
            <p className="mt-0.5 text-xs text-slate-500">卷面批阅画布预留</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PaperEssaySwitchLink direction="previous" essayId={previousEssayId} taskId={taskId} />
            <PaperEssaySwitchLink direction="next" essayId={nextEssayId} taskId={taskId} />
          </div>
        </div>
      </div>

      <div
        data-testid="paper-canvas"
        className="grid gap-3 rounded-lg border border-slate-200 bg-slate-100 p-3 xl:grid-cols-[220px_minmax(520px,1fr)_280px] xl:grid-rows-[minmax(560px,70vh)_auto]"
      >
        <aside className="rounded-lg border border-dashed border-slate-300 bg-white/80 p-4">
          <h3 className="text-sm font-semibold text-slate-800">左侧批注区</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">后续用于承载靠近卷面左侧的批注联动信息。</p>
        </aside>

        <div
          data-testid="paper-image-stage"
          className="flex min-h-[560px] items-center justify-center overflow-hidden rounded-lg border border-slate-300 bg-white p-5"
        >
          {originalImageUrl ? (
            <img
              src={originalImageUrl}
              alt={`${essay.essayNumber} 原卷第 ${pageIndex + 1} 页`}
              className="max-h-[72vh] w-full object-contain"
            />
          ) : (
            <div
              className="flex min-h-[520px] w-full max-w-3xl flex-col items-center justify-center rounded-lg border border-slate-300 bg-white p-8 text-center"
              style={{
                background: currentPage?.accent
                  ? `linear-gradient(135deg, ${currentPage.accent}22, #ffffff)`
                  : undefined,
              }}
            >
              <h3 className="text-lg font-semibold text-slate-800">当前作文暂无原卷图片预览</h3>
              <p className="mt-3 max-w-md text-sm leading-6 text-slate-500">
                后续接入 OCR 坐标后，将在此处展示原卷批阅能力。
              </p>
            </div>
          )}
        </div>

        <aside className="rounded-lg border border-dashed border-slate-300 bg-white/80 p-4">
          <h3 className="text-sm font-semibold text-slate-800">右侧批注区</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            后续用于承载语言问题、逻辑问题和表达问题的批注联动信息。
          </p>
        </aside>

        <section className="rounded-lg border border-dashed border-slate-300 bg-white/80 p-4 xl:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">底部批注区</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">后续用于承载综合批注、跨句批注或较长说明。</p>
            </div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-600">
              <button
                type="button"
                disabled={pageIndex === 0}
                onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
                className="tech-focus rounded-lg border border-slate-200 bg-white px-3 py-2 disabled:cursor-not-allowed disabled:text-slate-300"
              >
                上一页
              </button>
              <span>
                第 {pageIndex + 1} / {pageCount} 页
              </span>
              <button
                type="button"
                disabled={pageIndex >= pageCount - 1}
                onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))}
                className="tech-focus rounded-lg border border-slate-200 bg-white px-3 py-2 disabled:cursor-not-allowed disabled:text-slate-300"
              >
                下一页
              </button>
            </div>
          </div>
        </section>
      </div>
    </section>
  )
}
