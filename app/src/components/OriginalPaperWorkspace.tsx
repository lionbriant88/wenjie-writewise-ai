import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, MessageSquareText, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { Essay, EssayPage } from '../types'
import type { ReviewIssueCardItem } from '../utils/reviewIssueItems'

type EssayPageWithPossibleImages = EssayPage & {
  imageUrl?: string
  imageUrls?: string[]
  url?: string
}

interface OriginalPaperWorkspaceProps {
  essay: Essay
  taskId: string
  reviewIssues: ReviewIssueCardItem[]
  activeIssueId: string | null
  onIssueSelect: (issueId: string | null) => void
  previousEssayId?: string
  nextEssayId?: string
  onBackToGrading: () => void
}

const zoomStep = 25
const minimumZoom = 50
const maximumZoom = 200
const defaultImageAspectRatio = 3 / 4
const desktopViewportQuery = '(min-width: 80rem)'
const focusableElementSelector = [
  'button:not([disabled]):not([tabindex="-1"])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getImageRotationTransform(rotation: number) {
  if (rotation === 90) return 'rotate(90deg) translateY(-100%)'
  if (rotation === 180) return 'rotate(180deg) translate(-100%, -100%)'
  if (rotation === 270) return 'rotate(270deg) translateX(-100%)'
  return 'rotate(0deg)'
}

function getPersistedImageUrl(page: EssayPage) {
  const pageWithImages = page as EssayPageWithPossibleImages
  return pageWithImages.previewUrl ?? pageWithImages.imageUrl ?? pageWithImages.imageUrls?.[0] ?? pageWithImages.url
}

function orderOriginalPaperPages(essay: Essay) {
  const pageById = new Map(essay.pages.map((page) => [page.id, page] as const))
  const seen = new Set<string>()
  const ordered = essay.pageOrder.flatMap((pageId) => {
    const page = pageById.get(pageId)
    if (!page || seen.has(pageId)) return []
    seen.add(pageId)
    return [page]
  })
  return [...ordered, ...essay.pages.filter((page) => !seen.has(page.id))]
}

function useOriginalPaperImageUrls(pages: EssayPage[]) {
  const [imageUrls, setImageUrls] = useState<Record<string, string | undefined>>({})

  useEffect(() => {
    const ownedUrls: string[] = []
    const nextUrls: Record<string, string | undefined> = {}

    for (const page of pages) {
      if (page.sourceFile && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        try {
          const url = URL.createObjectURL(page.sourceFile)
          ownedUrls.push(url)
          nextUrls[page.id] = url
          continue
        } catch {
          // A missing image fallback is safer than trusting a stale blob URL.
        }
      }
      nextUrls[page.id] = page.sourceFile ? undefined : getPersistedImageUrl(page)
    }

    setImageUrls(nextUrls)
    return () => {
      if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return
      ownedUrls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [pages])

  return imageUrls
}

function PaperEssaySwitchLink({ direction, essayId, taskId }: { direction: 'previous' | 'next'; essayId?: string; taskId: string }) {
  const label = direction === 'previous' ? '上一篇' : '下一篇'
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight
  const className = 'tech-focus inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-semibold transition'

  if (!essayId) {
    return (
      <button type="button" disabled className={`${className} cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400`}>
        {direction === 'previous' ? <Icon className="h-4 w-4" /> : null}
        {label}
        {direction === 'next' ? <Icon className="h-4 w-4" /> : null}
      </button>
    )
  }

  return (
    <Link to={`/tasks/${taskId}/essays/${essayId}`} className={`${className} border-slate-200 bg-white text-slate-700 hover:border-cyan-200 hover:bg-cyan-50`}>
      {direction === 'previous' ? <Icon className="h-4 w-4" /> : null}
      {label}
      {direction === 'next' ? <Icon className="h-4 w-4" /> : null}
    </Link>
  )
}

const sourceLabels: Record<ReviewIssueCardItem['source'], string> = {
  language: '语言',
  logic: '逻辑',
  legibility: '字迹',
}

const severityLabels: Record<ReviewIssueCardItem['severity'], string> = {
  low: '轻微',
  medium: '一般',
  high: '重点',
}

function PaperIssueCard({ issue, active, onSelect }: { issue: ReviewIssueCardItem; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${sourceLabels[issue.source]}批注：${issue.original}`}
      onClick={onSelect}
      className={`tech-focus w-full rounded-lg border p-3 text-left transition ${active ? 'border-blue-300 bg-blue-50 shadow-sm' : 'border-slate-200 bg-white hover:border-cyan-200'}`}
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">{sourceLabels[issue.source]} · {issue.typeLabel}</span>
        <span className="text-[11px] font-medium text-slate-500">{severityLabels[issue.severity]}</span>
        {issue.needsTeacherReview ? <span className="rounded bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800">建议复核</span> : null}
      </span>
      <span className="mt-2 block text-sm font-semibold leading-5 text-slate-900">{issue.original}</span>
      {issue.pageReference ? (
        <span className="mt-2 block rounded-md bg-amber-50 px-2 py-1.5 text-xs leading-5 text-amber-900">
          第 {issue.pageReference.pageNumber} 页 · 页内区域说明（无坐标）
          <span className="block font-semibold">{issue.pageReference.regionDescription}</span>
        </span>
      ) : (
        <span className="mt-2 inline-flex rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">未精确定位</span>
      )}
      {issue.suggestion ?? issue.conservativeSuggestion ? (
        <span className="mt-2 block text-xs leading-5 text-emerald-800">建议：{issue.suggestion ?? issue.conservativeSuggestion}</span>
      ) : null}
      {issue.explanation ?? issue.diagnosis ? (
        <span className="mt-1 block text-xs leading-5 text-slate-500">{issue.explanation ?? issue.diagnosis}</span>
      ) : null}
    </button>
  )
}

function PaperAnnotationContent({ pageNumber, reviewIssues, activeIssueId, onIssueSelect }: {
  pageNumber: number
  reviewIssues: ReviewIssueCardItem[]
  activeIssueId: string | null
  onIssueSelect: (issueId: string | null) => void
}) {
  const pageLegibilityIssues = reviewIssues.filter((issue) => issue.source === 'legibility' && issue.pageReference?.pageNumber === pageNumber)
  const unlocatedIssues = reviewIssues.filter((issue) => issue.source !== 'legibility' || !issue.pageReference)

  return (
    <div className="space-y-5">
      <section aria-label={`第 ${pageNumber} 页字迹复核`}>
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">本页字迹复核</h4>
          <span className="text-xs text-slate-400">{pageLegibilityIssues.length} 项</span>
        </div>
        <div className="mt-2 space-y-2">
          {pageLegibilityIssues.length ? pageLegibilityIssues.map((issue) => (
            <PaperIssueCard key={issue.id} issue={issue} active={issue.id === activeIssueId} onSelect={() => onIssueSelect(issue.id === activeIssueId ? null : issue.id)} />
          )) : (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs leading-5 text-slate-500">本页没有需要单独复核的字迹问题。</p>
          )}
        </div>
      </section>

      <section aria-label="全文问题（未精确定位）">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">全文问题</h4>
          <span className="text-xs text-slate-400">{unlocatedIssues.length} 项</span>
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-500">当前结果不含原卷坐标，语言和逻辑问题不会在图片上绘制高亮。</p>
        <div className="mt-2 space-y-2">
          {unlocatedIssues.length ? unlocatedIssues.map((issue) => (
            <PaperIssueCard key={issue.id} issue={issue} active={issue.id === activeIssueId} onSelect={() => onIssueSelect(issue.id === activeIssueId ? null : issue.id)} />
          )) : (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs leading-5 text-slate-500">暂无语言或逻辑批注。</p>
          )}
        </div>
      </section>
    </div>
  )
}

export function OriginalPaperWorkspace({
  essay,
  taskId,
  reviewIssues,
  activeIssueId,
  onIssueSelect,
  previousEssayId,
  nextEssayId,
  onBackToGrading,
}: OriginalPaperWorkspaceProps) {
  const [pageIndex, setPageIndex] = useState(0)
  const [zoomPercent, setZoomPercent] = useState(100)
  const [rotation, setRotation] = useState(0)
  const [mobileAnnotationsOpen, setMobileAnnotationsOpen] = useState(false)
  const [failedPageIds, setFailedPageIds] = useState<Set<string>>(() => new Set())
  const [imageAspectRatios, setImageAspectRatios] = useState<Record<string, number>>({})
  const imageStageRef = useRef<HTMLDivElement>(null)
  const panStartRef = useRef<{ clientX: number; clientY: number; scrollLeft: number; scrollTop: number } | null>(null)
  const mobileAnnotationTriggerRef = useRef<HTMLButtonElement>(null)
  const mobileAnnotationCloseRef = useRef<HTMLButtonElement>(null)
  const mobileAnnotationPanelRef = useRef<HTMLElement>(null)
  const pages = useMemo(() => orderOriginalPaperPages(essay), [essay])
  const imageUrls = useOriginalPaperImageUrls(pages)
  const pageCount = Math.max(pages.length, 1)
  const safePageIndex = Math.min(pageIndex, Math.max(pages.length - 1, 0))
  const currentPage = pages[safePageIndex]
  const currentPageNumber = safePageIndex + 1
  const currentImageUrl = currentPage ? imageUrls[currentPage.id] : undefined
  const currentImageFailed = currentPage ? failedPageIds.has(currentPage.id) : false
  const currentPageIssueCount = reviewIssues.filter((issue) => issue.source !== 'legibility' || !issue.pageReference || issue.pageReference.pageNumber === currentPageNumber).length
  const currentImageAspectRatio = currentPage ? imageAspectRatios[currentPage.id] ?? defaultImageAspectRatio : defaultImageAspectRatio
  const isQuarterTurn = rotation === 90 || rotation === 270
  const imageCarrierWidthPercent = isQuarterTurn ? zoomPercent / currentImageAspectRatio : zoomPercent
  const imageCarrierAspectRatio = isQuarterTurn ? 1 / currentImageAspectRatio : currentImageAspectRatio
  const imageWidthPercent = isQuarterTurn ? currentImageAspectRatio * 100 : 100
  const canPanImage = zoomPercent > 100 || isQuarterTurn

  const resetImageViewport = useCallback(() => {
    setZoomPercent(100)
    setRotation(0)
    if (imageStageRef.current) {
      imageStageRef.current.scrollLeft = 0
      imageStageRef.current.scrollTop = 0
    }
  }, [])

  useEffect(() => {
    setPageIndex(0)
    resetImageViewport()
    setMobileAnnotationsOpen(false)
    setFailedPageIds(new Set())
    setImageAspectRatios({})
  }, [essay.id, resetImageViewport])

  useEffect(() => {
    const activeIssue = reviewIssues.find((issue) => issue.id === activeIssueId)
    const trustedPageNumber = activeIssue?.source === 'legibility' ? activeIssue.pageReference?.pageNumber : undefined
    if (!trustedPageNumber || trustedPageNumber < 1 || trustedPageNumber > pages.length) return
    const nextPageIndex = trustedPageNumber - 1
    if (nextPageIndex === safePageIndex) return
    setPageIndex(nextPageIndex)
    resetImageViewport()
  }, [activeIssueId, pages.length, resetImageViewport, reviewIssues, safePageIndex])

  const closeMobileAnnotations = useCallback(() => {
    setMobileAnnotationsOpen(false)
    mobileAnnotationTriggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!mobileAnnotationsOpen) return
    mobileAnnotationCloseRef.current?.focus()
    const keepFocusInDialog = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMobileAnnotations()
        return
      }
      if (event.key !== 'Tab') return

      const panel = mobileAnnotationPanelRef.current
      if (!panel) return
      const focusableElements = Array.from(panel.querySelectorAll<HTMLElement>(focusableElementSelector))
      const firstElement = focusableElements[0]
      const lastElement = focusableElements.at(-1)
      if (!firstElement || !lastElement) {
        event.preventDefault()
        panel.focus()
        return
      }

      const activeElement = document.activeElement
      if (event.shiftKey && (activeElement === firstElement || !panel.contains(activeElement))) {
        event.preventDefault()
        lastElement.focus()
      } else if (!event.shiftKey && (activeElement === lastElement || !panel.contains(activeElement))) {
        event.preventDefault()
        firstElement.focus()
      }
    }
    document.addEventListener('keydown', keepFocusInDialog)

    const desktopMedia = typeof window.matchMedia === 'function' ? window.matchMedia(desktopViewportQuery) : undefined
    const closeForDesktop = (event: MediaQueryListEvent) => {
      if (!event.matches) return
      if (document.activeElement === mobileAnnotationCloseRef.current) mobileAnnotationPanelRef.current?.focus()
      setMobileAnnotationsOpen(false)
    }
    if (desktopMedia?.matches) setMobileAnnotationsOpen(false)
    desktopMedia?.addEventListener?.('change', closeForDesktop)

    return () => {
      document.removeEventListener('keydown', keepFocusInDialog)
      desktopMedia?.removeEventListener?.('change', closeForDesktop)
    }
  }, [closeMobileAnnotations, mobileAnnotationsOpen])

  const goToPage = (nextIndex: number) => {
    const boundedIndex = Math.max(0, Math.min(pageCount - 1, nextIndex))
    if (boundedIndex === safePageIndex) return
    const activeIssue = reviewIssues.find((issue) => issue.id === activeIssueId)
    if (activeIssue?.pageReference && activeIssue.pageReference.pageNumber !== boundedIndex + 1) onIssueSelect(null)
    setPageIndex(boundedIndex)
    resetImageViewport()
  }

  const markImageFailed = (pageId: string) => setFailedPageIds((current) => new Set(current).add(pageId))

  const rememberImageAspectRatio = (pageId: string, image: HTMLImageElement) => {
    if (!image.naturalWidth || !image.naturalHeight) return
    const nextAspectRatio = image.naturalWidth / image.naturalHeight
    if (!Number.isFinite(nextAspectRatio) || nextAspectRatio <= 0) return
    setImageAspectRatios((current) => current[pageId] === nextAspectRatio ? current : { ...current, [pageId]: nextAspectRatio })
  }

  const startPanning = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canPanImage || event.button !== 0) return
    panStartRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: event.currentTarget.scrollLeft,
      scrollTop: event.currentTarget.scrollTop,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const continuePanning = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = panStartRef.current
    if (!start) return
    event.preventDefault()
    event.currentTarget.scrollLeft = start.scrollLeft + start.clientX - event.clientX
    event.currentTarget.scrollTop = start.scrollTop + start.clientY - event.clientY
  }

  const stopPanning = (event: ReactPointerEvent<HTMLDivElement>) => {
    panStartRef.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <section data-testid="paper-workspace" className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onBackToGrading} className="tech-focus inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50">
              <ArrowLeft className="h-4 w-4" />返回批改工作台
            </button>
            <Link to={`/tasks/${taskId}/progress`} className="tech-focus inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50">返回批改进度</Link>
          </div>
          <div className="text-center">
            <h2 className="text-base font-semibold text-slate-950">{essay.essayNumber} · 原卷视图</h2>
            <p className="mt-0.5 text-xs text-slate-500">按页核对真实原图、字迹说明和批改意见</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PaperEssaySwitchLink direction="previous" essayId={previousEssayId} taskId={taskId} />
            <PaperEssaySwitchLink direction="next" essayId={nextEssayId} taskId={taskId} />
          </div>
        </div>
      </div>

      <div data-testid="paper-canvas" className="grid min-w-0 gap-3 rounded-lg border border-slate-200 bg-slate-100 p-3 xl:grid-cols-[112px_minmax(0,1fr)_320px]">
        <section data-testid="paper-image-panel" className="order-1 flex min-w-0 flex-col rounded-lg border border-slate-200 bg-white xl:col-start-2 xl:row-start-1 xl:h-[clamp(560px,calc(100dvh-10rem),860px)]">
          <div data-testid="paper-image-toolbar" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
            <div className="flex items-center gap-1">
              <button type="button" aria-label="缩小原卷" disabled={zoomPercent <= minimumZoom} onClick={() => setZoomPercent((current) => Math.max(minimumZoom, current - zoomStep))} className="tech-focus rounded-md border border-slate-200 p-2 text-slate-600 disabled:cursor-not-allowed disabled:text-slate-300"><ZoomOut className="h-4 w-4" /></button>
              <span className="min-w-14 text-center text-xs font-semibold text-slate-700">{zoomPercent}%</span>
              <button type="button" aria-label="放大原卷" disabled={zoomPercent >= maximumZoom} onClick={() => setZoomPercent((current) => Math.min(maximumZoom, current + zoomStep))} className="tech-focus rounded-md border border-slate-200 p-2 text-slate-600 disabled:cursor-not-allowed disabled:text-slate-300"><ZoomIn className="h-4 w-4" /></button>
              <button type="button" aria-label="顺时针旋转原卷" onClick={() => { setRotation((current) => (current + 90) % 360); if (imageStageRef.current) { imageStageRef.current.scrollLeft = 0; imageStageRef.current.scrollTop = 0 } }} className="tech-focus ml-1 rounded-md border border-slate-200 p-2 text-slate-600"><RotateCw className="h-4 w-4" /></button>
              <button type="button" aria-label="重置原卷视图" onClick={resetImageViewport} className="tech-focus rounded-md border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-600">重置</button>
            </div>
            <p className="text-xs text-slate-500">放大后可滚动或拖动查看</p>
          </div>

          <div
            ref={imageStageRef}
            data-testid="paper-image-stage"
            aria-label="原卷画布"
            onPointerDown={startPanning}
            onPointerMove={continuePanning}
            onPointerUp={stopPanning}
            onPointerCancel={stopPanning}
            className={`h-[62dvh] min-h-[420px] max-h-[680px] overflow-auto bg-slate-200/70 p-4 xl:h-auto xl:min-h-0 xl:max-h-none xl:flex-1 ${canPanImage ? 'touch-none cursor-grab select-none active:cursor-grabbing' : ''}`}
          >
            <div data-testid="paper-image-plane" className={`flex min-h-full min-w-full shrink-0 items-start ${zoomPercent <= 100 && rotation === 0 ? 'justify-center' : 'justify-start'}`}>
              {currentImageUrl && !currentImageFailed ? (
                <div
                  data-testid="paper-image-carrier"
                  className="relative shrink-0"
                  style={{ width: `${imageCarrierWidthPercent}%`, aspectRatio: String(imageCarrierAspectRatio) }}
                >
                  <img
                    src={currentImageUrl}
                    alt={`${essay.essayNumber} 原卷第 ${currentPageNumber} 页`}
                    draggable={false}
                    decoding="async"
                    onLoad={(event) => rememberImageAspectRatio(currentPage.id, event.currentTarget)}
                    onError={() => markImageFailed(currentPage.id)}
                    className="absolute left-0 top-0 h-auto max-w-none rounded-sm bg-white object-contain shadow-[0_12px_32px_rgba(15,23,42,0.16)] transition-transform"
                    style={{ width: `${imageWidthPercent}%`, transform: getImageRotationTransform(rotation), transformOrigin: 'top left' }}
                  />
                </div>
              ) : (
                <div className="flex min-h-[420px] w-full max-w-2xl flex-col items-center justify-center rounded-lg border border-slate-300 bg-white p-8 text-center" style={{ background: currentPage?.accent ? `linear-gradient(135deg, ${currentPage.accent}18, #ffffff)` : undefined }}>
                  <h3 className="text-lg font-semibold text-slate-800">{currentImageFailed ? '当前页原卷图片加载失败' : '当前页暂无可显示的原卷图片'}</h3>
                  <p className="mt-3 max-w-md text-sm leading-6 text-slate-500">{currentImageFailed ? '可切换其他页继续查看；本次批改结果和识别文本不会受影响。' : '这份历史数据没有保留原图文件；批改结果和识别文本仍可在工作台中查看。'}</p>
                </div>
              )}
            </div>
          </div>

          <div data-testid="paper-page-toolbar" className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-3 py-2">
            <p className="text-xs text-slate-500">当前只展示可信页级说明，不绘制虚构坐标。</p>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-600">
              <button type="button" disabled={safePageIndex === 0} onClick={() => goToPage(safePageIndex - 1)} className="tech-focus rounded-lg border border-slate-200 bg-white px-3 py-2 disabled:cursor-not-allowed disabled:text-slate-300">上一页</button>
              <span>第 {currentPageNumber} / {pageCount} 页</span>
              <button type="button" disabled={safePageIndex >= pageCount - 1} onClick={() => goToPage(safePageIndex + 1)} className="tech-focus rounded-lg border border-slate-200 bg-white px-3 py-2 disabled:cursor-not-allowed disabled:text-slate-300">下一页</button>
            </div>
          </div>
        </section>

        <nav data-testid="paper-thumbnail-rail" aria-label="原卷页码" className="order-2 flex min-w-0 gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-white p-2 xl:col-start-1 xl:row-start-1 xl:block xl:h-[clamp(560px,calc(100dvh-10rem),860px)] xl:min-h-0 xl:space-y-2 xl:overflow-x-hidden xl:overflow-y-auto">
          {pages.length ? pages.map((page, index) => {
            const selected = index === safePageIndex
            const pageImageUrl = imageUrls[page.id]
            return (
              <button key={page.id} type="button" aria-current={selected ? 'page' : undefined} aria-label={`查看第 ${index + 1} 页：${page.label}`} onClick={() => goToPage(index)} className={`tech-focus w-24 shrink-0 rounded-lg border p-1.5 text-left transition xl:w-full ${selected ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 bg-white hover:border-cyan-200'}`}>
                <span className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded bg-slate-100">
                  {pageImageUrl && !failedPageIds.has(page.id) ? <img src={pageImageUrl} alt={`${page.label} 缩略图`} loading="lazy" decoding="async" onError={() => markImageFailed(page.id)} className="h-full w-full object-cover" /> : <span className="text-xl font-semibold text-slate-400">{index + 1}</span>}
                </span>
                <span className="mt-1 block truncate px-0.5 text-xs font-semibold text-slate-700">第 {index + 1} 页</span>
                <span className="block truncate px-0.5 text-[10px] text-slate-400">{page.label}</span>
              </button>
            )
          }) : <p className="px-2 py-4 text-xs text-slate-500">暂无原卷页</p>}
        </nav>

        <button ref={mobileAnnotationTriggerRef} type="button" aria-expanded={mobileAnnotationsOpen} aria-controls="original-paper-annotations" onClick={() => setMobileAnnotationsOpen(true)} className="tech-focus order-3 sticky bottom-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-lg xl:hidden">
          <MessageSquareText className="h-4 w-4" />查看原卷批注（{currentPageIssueCount}）
        </button>

        {mobileAnnotationsOpen ? <button type="button" data-testid="paper-annotation-backdrop" tabIndex={-1} aria-hidden="true" onClick={closeMobileAnnotations} className="fixed inset-0 z-40 bg-slate-950/50 xl:hidden" /> : null}

        <aside
          ref={mobileAnnotationPanelRef}
          id="original-paper-annotations"
          data-testid="paper-annotation-rail"
          role={mobileAnnotationsOpen ? 'dialog' : undefined}
          aria-label={mobileAnnotationsOpen ? '原卷批注' : undefined}
          aria-modal={mobileAnnotationsOpen ? true : undefined}
          tabIndex={-1}
          className={`${mobileAnnotationsOpen ? 'fixed inset-x-0 bottom-0 z-50 flex max-h-[70dvh]' : 'hidden'} order-3 flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-xl xl:static xl:col-start-3 xl:row-start-1 xl:flex xl:h-[clamp(560px,calc(100dvh-10rem),860px)] xl:min-h-0 xl:max-h-none xl:rounded-lg xl:shadow-none`}
        >
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">原卷批注</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">字迹按页展示；语言和逻辑暂不标注图片坐标。</p>
            </div>
            <button ref={mobileAnnotationCloseRef} type="button" aria-label="关闭原卷批注" onClick={closeMobileAnnotations} className="tech-focus rounded-md p-1.5 text-slate-500 hover:bg-slate-100 xl:hidden"><X className="h-4 w-4" /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <PaperAnnotationContent pageNumber={currentPageNumber} reviewIssues={reviewIssues} activeIssueId={activeIssueId} onIssueSelect={onIssueSelect} />
          </div>
        </aside>
      </div>
    </section>
  )
}
