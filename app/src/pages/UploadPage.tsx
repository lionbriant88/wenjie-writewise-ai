import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { EssayImagePreview } from '../components/EssayImagePreview'
import { UploadPanel } from '../components/UploadPanel'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import type { EssayPage } from '../types'
import type { UploadEssayGroup, UploadGroupingMode } from '../utils/essayGrouping'
import { createEssayImageGroups, renumberEssayGroups } from '../utils/essayGrouping'
import { findEssaysByTask, findTask } from '../utils/taskLookup'

const mixedGuideStorageKey = 'wenjie-hide-mixed-grouping-guide'

function buildPageOcrDraft(page: EssayPage, index: number) {
  return [
    `作文图片 ${index + 1}：${page.label}`,
    'Dear Sir or Madam,',
    'I am writing to share my suggestion for this activity.',
    'I believe it will help students improve their English writing.',
  ].join('\n')
}

function groupingButtonClass(active: boolean) {
  return active
    ? 'rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800 shadow-[0_0_0_1px_rgba(37,99,235,0.08)]'
    : 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50/60'
}

function sortGroupPagesByDisplayOrder(group: UploadEssayGroup, pageOrderIndex: Map<string, number>) {
  return [...group.pageIds].sort(
    (firstPageId, secondPageId) =>
      (pageOrderIndex.get(firstPageId) ?? Number.MAX_SAFE_INTEGER) -
      (pageOrderIndex.get(secondPageId) ?? Number.MAX_SAFE_INTEGER),
  )
}

export function UploadPage() {
  const { taskId = '' } = useParams()
  const navigate = useNavigate()
  const { tasks, essays, confirmMockOcrEssay } = useAppState()
  const task = findTask(tasks, taskId)
  const taskEssays = findEssaysByTask(essays, taskId)
  const initialPages = useMemo(() => taskEssays.flatMap((essay) => essay.pages).slice(0, 6), [taskEssays])
  const [pages, setPages] = useState<EssayPage[]>(initialPages)
  const [groupingMode, setGroupingModeState] = useState<UploadGroupingMode>('single')
  const [mixedGroups, setMixedGroups] = useState<UploadEssayGroup[]>(() =>
    createEssayImageGroups(initialPages, 'single'),
  )
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([])
  const [mockOcrStatus, setMockOcrStatus] = useState<'idle' | 'completed'>('idle')
  const [ocrDrafts, setOcrDrafts] = useState<string[]>([])
  const [showMixedGuide, setShowMixedGuide] = useState(false)
  const localPreviewUrlsRef = useRef<string[]>([])

  const pagesById = useMemo(() => new Map(pages.map((page) => [page.id, page])), [pages])
  const pageOrderIndex = useMemo(() => new Map(pages.map((page, index) => [page.id, index])), [pages])

  const visibleEssayGroups = useMemo(() => {
    if (groupingMode !== 'mixed') {
      return createEssayImageGroups(pages, groupingMode)
    }

    const knownPageIds = new Set<string>()
    const sanitizedGroups = mixedGroups
      .map((group) => ({
        ...group,
        pageIds: sortGroupPagesByDisplayOrder(group, pageOrderIndex).filter((pageId) => {
          if (!pagesById.has(pageId) || knownPageIds.has(pageId)) return false
          knownPageIds.add(pageId)
          return true
        }),
      }))
      .filter((group) => group.pageIds.length > 0)
      .sort(
        (firstGroup, secondGroup) =>
          (pageOrderIndex.get(firstGroup.pageIds[0]) ?? Number.MAX_SAFE_INTEGER) -
          (pageOrderIndex.get(secondGroup.pageIds[0]) ?? Number.MAX_SAFE_INTEGER),
      )

    const missingGroups = pages
      .filter((page) => !knownPageIds.has(page.id))
      .map((page) => ({
        id: `group-missing-${page.id}`,
        pageIds: [page.id],
      }))

    return renumberEssayGroups([...sanitizedGroups, ...missingGroups])
  }, [groupingMode, mixedGroups, pageOrderIndex, pages, pagesById])

  const essaySubmissionCount = visibleEssayGroups.length

  useEffect(() => {
    const localPreviewUrls = localPreviewUrlsRef.current

    return () => {
      localPreviewUrls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  if (!task) {
    return <EmptyState title="找不到任务" description="请返回任务列表重新选择一个批改任务。" />
  }

  const resetOcrDraft = () => {
    setMockOcrStatus('idle')
    setOcrDrafts([])
  }

  const setGroupingMode = (mode: UploadGroupingMode) => {
    if (mode === 'mixed' && groupingMode !== 'mixed') {
      setMixedGroups(createEssayImageGroups(pages, 'single'))
      setShowMixedGuide(localStorage.getItem(mixedGuideStorageKey) !== 'true')
    }
    if (mode !== 'mixed') {
      setShowMixedGuide(false)
    }
    setGroupingModeState(mode)
    setSelectedPageIds([])
    resetOcrDraft()
  }

  const addPage = () => {
    const next = pages.length + 1
    const nextPage: EssayPage = {
      id: `uploaded-page-${Date.now()}`,
      label: `新增图片 ${next}`,
      pageNumber: next,
      quality: next % 3 === 0 ? 'tilted' : 'clear',
      accent: '#2563eb',
    }
    setPages((current) => [...current, nextPage])
    setMixedGroups((current) => renumberEssayGroups([...current, { id: `group-new-${nextPage.id}`, pageIds: [nextPage.id] }]))
    setSelectedPageIds([])
    resetOcrDraft()
  }

  const addLocalFiles = (files: File[]) => {
    if (files.length === 0) return

    setPages((current) => {
      const start = current.length + 1
      const nextPages = files.map((file, index): EssayPage => {
        const previewUrl = URL.createObjectURL(file)
        localPreviewUrlsRef.current.push(previewUrl)

        return {
          id: `local-page-${Date.now()}-${index}`,
          label: file.name,
          pageNumber: start + index,
          quality: 'clear',
          accent: '#0891b2',
          previewUrl,
        }
      })

      setMixedGroups((currentGroups) =>
        renumberEssayGroups([
          ...currentGroups,
          ...nextPages.map((page) => ({
            id: `group-local-${page.id}`,
            pageIds: [page.id],
          })),
        ]),
      )
      return [...current, ...nextPages]
    })
    setSelectedPageIds([])
    resetOcrDraft()
  }

  const movePage = (pageId: string, direction: 'up' | 'down') => {
    setPages((current) => {
      const index = current.findIndex((page) => page.id === pageId)
      const target = direction === 'up' ? index - 1 : index + 1
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })
    resetOcrDraft()
  }

  const removePage = (pageId: string) => {
    setPages((current) => {
      const target = current.find((page) => page.id === pageId)
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl)
        localPreviewUrlsRef.current = localPreviewUrlsRef.current.filter((url) => url !== target.previewUrl)
      }

      return current.filter((page) => page.id !== pageId)
    })
    setMixedGroups((current) =>
      renumberEssayGroups(
        current.map((group) => ({
          ...group,
          pageIds: group.pageIds.filter((currentPageId) => currentPageId !== pageId),
        })),
      ),
    )
    setSelectedPageIds((current) => current.filter((currentPageId) => currentPageId !== pageId))
    resetOcrDraft()
  }

  const togglePageSelection = (pageId: string) => {
    if (groupingMode !== 'mixed') return
    setSelectedPageIds((current) =>
      current.includes(pageId) ? current.filter((currentPageId) => currentPageId !== pageId) : [...current, pageId],
    )
  }

  const mergeSelectedPages = () => {
    if (selectedPageIds.length < 2) return

    const selectedSet = new Set(selectedPageIds)
    const orderedSelectedPageIds = pages.filter((page) => selectedSet.has(page.id)).map((page) => page.id)
    const firstSelectedIndex = Math.min(...orderedSelectedPageIds.map((pageId) => pageOrderIndex.get(pageId) ?? 0))
    const remainingGroups = visibleEssayGroups
      .map((group) => ({
        ...group,
        pageIds: group.pageIds.filter((pageId) => !selectedSet.has(pageId)),
      }))
      .filter((group) => group.pageIds.length > 0)

    const insertIndex = remainingGroups.findIndex(
      (group) => (pageOrderIndex.get(group.pageIds[0]) ?? Number.MAX_SAFE_INTEGER) > firstSelectedIndex,
    )
    const nextGroups = [...remainingGroups]
    nextGroups.splice(insertIndex < 0 ? nextGroups.length : insertIndex, 0, {
      id: 'group-merged-selection',
      pageIds: orderedSelectedPageIds,
    })

    setMixedGroups(renumberEssayGroups(nextGroups))
    setSelectedPageIds([])
    resetOcrDraft()
  }

  const splitEssayGroup = (groupIndex: number) => {
    const targetGroup = visibleEssayGroups[groupIndex]
    if (!targetGroup || targetGroup.pageIds.length <= 1) return

    const nextGroups = visibleEssayGroups.flatMap((group, currentIndex) =>
      currentIndex === groupIndex
        ? group.pageIds.map((pageId) => ({
            id: `group-split-${pageId}`,
            pageIds: [pageId],
          }))
        : [group],
    )

    setGroupingModeState('mixed')
    setMixedGroups(renumberEssayGroups(nextGroups))
    setSelectedPageIds([])
    resetOcrDraft()
  }

  const getGroupPages = (group: UploadEssayGroup) =>
    group.pageIds.map((pageId) => pagesById.get(pageId)).filter((page): page is EssayPage => Boolean(page))

  const startMockOcr = () => {
    setOcrDrafts(
      visibleEssayGroups.map((group) =>
        getGroupPages(group)
          .map((page) => buildPageOcrDraft(page, pageOrderIndex.get(page.id) ?? 0))
          .join('\n\n'),
      ),
    )
    setMockOcrStatus('completed')
  }

  const getEssayGroups = () =>
    visibleEssayGroups.map((group, groupIndex) => ({
      pages: getGroupPages(group),
      ocrText: ocrDrafts[groupIndex] ?? '',
    }))

  const canConfirmMockOcr =
    visibleEssayGroups.length > 0 &&
    ocrDrafts.length === visibleEssayGroups.length &&
    ocrDrafts.every((draft) => draft.trim().length > 0)

  const confirmMockOcrText = () => {
    confirmMockOcrEssay({
      taskId: task.id,
      essayGroups: getEssayGroups(),
    })
    resetOcrDraft()
    navigate(`/tasks/${task.id}/progress`)
  }

  const hideMixedGuidePermanently = () => {
    localStorage.setItem(mixedGuideStorageKey, 'true')
    setShowMixedGuide(false)
  }

  return (
    <AppLayout
      task={task}
      title="上传作文与图片整理"
      currentStep="upload"
      description="一口气上传作文图片，按页数规则整理成作文组，再批量模拟 OCR 与批改。"
    >
      <div className="space-y-6">
        <UploadPanel
          onAddPage={addPage}
          onSelectFiles={addLocalFiles}
          onSubmit={() => navigate(`/tasks/${task.id}/progress`)}
        />
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-slate-950">已上传图片</h3>
              <p className="mt-1 text-sm text-slate-500">
                当前 {pages.length} 张图片，预计生成 {essaySubmissionCount} 篇作文
              </p>
            </div>
            <button
              type="button"
              onClick={startMockOcr}
              disabled={pages.length === 0}
              className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
            >
              开始模拟 OCR（预计 {essaySubmissionCount} 篇）
            </button>
          </div>

          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">整理方式</p>
                <p className="mt-1 text-sm text-slate-500">选择最接近本次上传材料的页数规则。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-pressed={groupingMode === 'single'}
                  onClick={() => setGroupingMode('single')}
                  className={groupingButtonClass(groupingMode === 'single')}
                >
                  一张一篇
                </button>
                <button
                  type="button"
                  aria-pressed={groupingMode === 'fixed-2'}
                  onClick={() => setGroupingMode('fixed-2')}
                  className={groupingButtonClass(groupingMode === 'fixed-2')}
                >
                  每 2 张一篇
                </button>
                <button
                  type="button"
                  aria-pressed={groupingMode === 'mixed'}
                  onClick={() => setGroupingMode('mixed')}
                  className={groupingButtonClass(groupingMode === 'mixed')}
                >
                  混合页数
                </button>
              </div>
            </div>
            <p className="mt-3 rounded-md border border-cyan-100 bg-white px-3 py-2 text-sm text-slate-600">
              当前按上传顺序排列，自动分组将按此顺序生成作文。
            </p>
            {groupingMode === 'fixed-2' && pages.length % 2 === 1 ? (
              <p className="mt-2 text-sm text-amber-700">最后 1 张图片未满 2 张，已作为单页作文保留。</p>
            ) : null}
            {groupingMode === 'mixed' && showMixedGuide ? (
              <div className="mt-3 rounded-lg border border-blue-100 bg-white p-3">
                <p className="text-sm leading-6 text-slate-600">
                  混合页数模式：未合并的图片会默认作为单页作文。点击图片可选中，多选 2
                  张以上后可合并为一篇作文；多页作文卡片内可拆分。
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setShowMixedGuide(false)}
                    className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    知道了
                  </button>
                  <button
                    type="button"
                    onClick={hideMixedGuidePermanently}
                    className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-50"
                  >
                    不再提醒
                  </button>
                </div>
              </div>
            ) : null}
            {groupingMode === 'mixed' && !showMixedGuide ? (
              <button
                type="button"
                onClick={() => setShowMixedGuide(true)}
                className="mt-3 text-sm font-semibold text-blue-700 hover:text-blue-800"
              >
                查看操作提示
              </button>
            ) : null}
          </div>

          {groupingMode === 'mixed' && selectedPageIds.length >= 2 ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
              <span className="text-sm font-semibold text-blue-900">已选 {selectedPageIds.length} 张图片</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={mergeSelectedPages}
                  className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                >
                  合并为一篇作文（已选 {selectedPageIds.length} 张）
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPageIds([])}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  取消选择
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-5">
            {pages.length > 0 ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {visibleEssayGroups.map((group, groupIndex) => {
                  const groupPages = getGroupPages(group)
                  return (
                    <section key={group.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h4 className="text-sm font-semibold text-slate-950">
                            作文 {groupIndex + 1} · 共 {groupPages.length} 页
                          </h4>
                          <p className="mt-0.5 text-xs text-slate-500">OCR 将按卡片内图片顺序合并文本。</p>
                        </div>
                        {groupPages.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => splitEssayGroup(groupIndex)}
                            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            拆分此作文 {groupIndex + 1}
                          </button>
                        ) : null}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {groupPages.map((page) => {
                          const displayIndex = (pageOrderIndex.get(page.id) ?? 0) + 1
                          const selected = selectedPageIds.includes(page.id)
                          return (
                            <div
                              key={page.id}
                              className={`rounded-lg bg-white p-2 ${selected ? 'ring-2 ring-blue-400' : ''}`}
                            >
                              {groupingMode === 'mixed' ? (
                                <button
                                  type="button"
                                  aria-label={`选择第 ${displayIndex} 张图片`}
                                  aria-pressed={selected}
                                  onClick={() => togglePageSelection(page.id)}
                                  className="block w-full rounded-lg text-left"
                                >
                                  <EssayImagePreview page={page} />
                                </button>
                              ) : (
                                <EssayImagePreview page={page} />
                              )}
                              <div className="mt-2 grid grid-cols-3 gap-2">
                                <button
                                  type="button"
                                  disabled={displayIndex === 1}
                                  onClick={() => movePage(page.id, 'up')}
                                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 disabled:opacity-40"
                                >
                                  上移
                                </button>
                                <button
                                  type="button"
                                  disabled={displayIndex === pages.length}
                                  onClick={() => movePage(page.id, 'down')}
                                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 disabled:opacity-40"
                                >
                                  下移
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removePage(page.id)}
                                  aria-label={`删除 ${page.label}`}
                                  className="rounded-md border border-rose-100 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                                >
                                  删除
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </section>
                  )
                })}
              </div>
            ) : (
              <EmptyState
                title="还没有模拟图片"
                description="点击添加模拟图片，演示手机拍照或扫描件进入批改队列。"
              />
            )}
          </div>
        </div>

        {mockOcrStatus === 'completed' ? (
          <section className="rounded-lg border border-cyan-100 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-cyan-700">OCR 识别完成</p>
                <h3 className="mt-1 font-semibold text-slate-950">模拟 OCR 文本草稿</h3>
                <p className="mt-1 text-sm text-slate-500">
                  当前整理方式会提交 {essaySubmissionCount} 篇作文，每个文本框对应一篇作文。
                </p>
              </div>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                置信度 88%
              </span>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {visibleEssayGroups.map((group, groupIndex) => (
                <label key={`ocr-${group.id}`} className="block rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="text-sm font-semibold text-slate-800">作文 {groupIndex + 1} OCR 文本</span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {group.pageIds.length} 张图片，确认后进入批改队列
                  </span>
                  <textarea
                    aria-label={`作文 ${groupIndex + 1} OCR 文本`}
                    value={ocrDrafts[groupIndex] ?? ''}
                    onChange={(event) =>
                      setOcrDrafts((current) =>
                        current.map((draft, draftIndex) => (draftIndex === groupIndex ? event.target.value : draft)),
                      )
                    }
                    className="mt-3 min-h-40 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={confirmMockOcrText}
                disabled={!canConfirmMockOcr}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                确认 OCR 文本
              </button>
            </div>
          </section>
        ) : null}
        <Link to={`/tasks/${task.id}/progress`} className="inline-flex text-sm font-semibold text-blue-700">
          跳过上传，查看批改进度
        </Link>
      </div>
    </AppLayout>
  )
}
