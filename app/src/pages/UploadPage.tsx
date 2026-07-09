import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { EssayImagePreview } from '../components/EssayImagePreview'
import { UploadSourceSelector } from '../components/UploadSourceSelector'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import { buildOcrDraftsFromResults, hasEmptyTextWarning } from '../services/ocr/normalizeOcrResult'
import { createOcrClient, getDefaultOcrMode } from '../services/ocr/ocrClient'
import type { OcrEssayResult, OcrMode, OcrRunStatus } from '../services/ocr/types'
import type { EssayPage } from '../types'
import type { UploadEssayGroup, UploadGroupingMode } from '../utils/essayGrouping'
import { createEssayImageGroups, renumberEssayGroups } from '../utils/essayGrouping'
import { findEssaysByTask, findTask } from '../utils/taskLookup'

const mixedGuideStorageKey = 'wenjie-hide-mixed-grouping-guide'

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
  const [ocrMode, setOcrMode] = useState<OcrMode>(() => getDefaultOcrMode())
  const [ocrStatus, setOcrStatus] = useState<OcrRunStatus>('idle')
  const [, setOcrResults] = useState<OcrEssayResult[]>([])
  const [ocrError, setOcrError] = useState('')
  const [emptyTextWarning, setEmptyTextWarning] = useState(false)
  const [ocrFallbackNotice, setOcrFallbackNotice] = useState('')
  const [ocrDrafts, setOcrDrafts] = useState<string[]>([])
  const [showMixedGuide, setShowMixedGuide] = useState(false)
  const localPreviewUrlsRef = useRef<string[]>([])
  const localFilesByPageIdRef = useRef<Map<string, File>>(new Map())

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
  const visibleGroupIds = useMemo(() => visibleEssayGroups.map((group) => group.id), [visibleEssayGroups])
  const isOcrRunning = ocrStatus === 'running'

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
    setOcrStatus('idle')
    setOcrResults([])
    setOcrError('')
    setEmptyTextWarning(false)
    setOcrFallbackNotice('')
    setOcrDrafts([])
  }

  const setGroupingMode = (mode: UploadGroupingMode) => {
    if (isOcrRunning) return
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
    if (isOcrRunning) return
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
    if (isOcrRunning) return
    if (files.length === 0) return

    setPages((current) => {
      const start = current.length + 1
      const nextPages = files.map((file, index): EssayPage => {
        const pageId = `local-page-${Date.now()}-${index}`
        const previewUrl = URL.createObjectURL(file)
        localPreviewUrlsRef.current.push(previewUrl)
        localFilesByPageIdRef.current.set(pageId, file)

        return {
          id: pageId,
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
    if (isOcrRunning) return
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
    if (isOcrRunning) return
    localFilesByPageIdRef.current.delete(pageId)
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
    if (isOcrRunning) return
    if (groupingMode !== 'mixed') return
    setSelectedPageIds((current) =>
      current.includes(pageId) ? current.filter((currentPageId) => currentPageId !== pageId) : [...current, pageId],
    )
  }

  const mergeSelectedPages = () => {
    if (isOcrRunning) return
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
    if (isOcrRunning) return
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

  const applyOcrResults = (results: OcrEssayResult[], groupIdsSnapshot = visibleGroupIds) => {
    setOcrResults(results)
    const drafts = buildOcrDraftsFromResults(results, groupIdsSnapshot)
    setOcrDrafts(drafts)
    setEmptyTextWarning(hasEmptyTextWarning(results))

    const failedResult = results.find((result) => result.status === 'failed')
    if (failedResult) {
      setOcrStatus('failed')
      setOcrError(failedResult.error ?? 'OCR 识别失败。')
      return
    }

    setOcrStatus('success')
    setOcrError('')
  }

  const startOcr = async () => {
    if (pages.length === 0 || isOcrRunning) return

    const groupsSnapshot = visibleEssayGroups
    const groupIdsSnapshot = groupsSnapshot.map((group) => group.id)
    const pageOrderSnapshot = new Map(pageOrderIndex)
    const client = createOcrClient(ocrMode)

    setOcrStatus('running')
    setOcrResults([])
    setOcrError('')
    setEmptyTextWarning(false)
    setOcrFallbackNotice('')

    const results = await client.recognize({
      groups: groupsSnapshot,
      getGroupPages,
      getPageFile: (pageId) => localFilesByPageIdRef.current.get(pageId),
      pageOrderIndex: pageOrderSnapshot,
    })

    applyOcrResults(results, groupIdsSnapshot)
  }

  const useMockDraftFallback = async () => {
    const groupsSnapshot = visibleEssayGroups
    const groupIdsSnapshot = groupsSnapshot.map((group) => group.id)
    const results = await createOcrClient('mock').recognize({
      groups: groupsSnapshot,
      getGroupPages,
      getPageFile: (pageId) => localFilesByPageIdRef.current.get(pageId),
      pageOrderIndex,
    })

    applyOcrResults(results, groupIdsSnapshot)
    setOcrFallbackNotice('已使用 mock OCR 草稿作为回退。')
  }

  const startManualOcrInput = () => {
    setOcrStatus('success')
    setOcrResults([])
    setOcrError('')
    setEmptyTextWarning(false)
    setOcrFallbackNotice('')
    setOcrDrafts(visibleEssayGroups.map(() => ''))
  }

  const getEssayGroups = () =>
    visibleEssayGroups.map((group, groupIndex) => ({
      pages: getGroupPages(group),
      ocrText: ocrDrafts[groupIndex] ?? '',
    }))

  const canConfirmOcr =
    ocrStatus === 'success' &&
    visibleEssayGroups.length > 0 &&
    ocrDrafts.length === visibleEssayGroups.length &&
    ocrDrafts.every((draft) => draft.trim().length > 0)

  const confirmMockOcrText = () => {
    if (!canConfirmOcr) return

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
        <UploadSourceSelector onAddMockImage={addPage} onSelectImages={addLocalFiles} disabled={isOcrRunning} />
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-slate-950">已上传图片</h3>
              <p className="mt-1 text-sm text-slate-500">
                当前 {pages.length} 张图片，预计生成 {essaySubmissionCount} 篇作文
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  aria-pressed={ocrMode === 'mock'}
                  onClick={() => setOcrMode('mock')}
                  disabled={isOcrRunning}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                    ocrMode === 'mock' ? 'bg-white text-blue-800 shadow-sm' : 'text-slate-600 hover:text-blue-700'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  mock OCR
                </button>
                <button
                  type="button"
                  aria-pressed={ocrMode === 'real'}
                  onClick={() => setOcrMode('real')}
                  disabled={isOcrRunning}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                    ocrMode === 'real' ? 'bg-white text-blue-800 shadow-sm' : 'text-slate-600 hover:text-blue-700'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  real OCR 链路测试
                </button>
              </div>
              <button
                type="button"
                onClick={startOcr}
                disabled={pages.length === 0 || isOcrRunning}
                className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                {isOcrRunning ? 'OCR 识别中...' : `开始 OCR 识别（预计 ${essaySubmissionCount} 篇）`}
              </button>
            </div>
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
                  disabled={isOcrRunning}
                  className={groupingButtonClass(groupingMode === 'single')}
                >
                  一张一篇
                </button>
                <button
                  type="button"
                  aria-pressed={groupingMode === 'fixed-2'}
                  onClick={() => setGroupingMode('fixed-2')}
                  disabled={isOcrRunning}
                  className={groupingButtonClass(groupingMode === 'fixed-2')}
                >
                  每 2 张一篇
                </button>
                <button
                  type="button"
                  aria-pressed={groupingMode === 'mixed'}
                  onClick={() => setGroupingMode('mixed')}
                  disabled={isOcrRunning}
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
                  disabled={isOcrRunning}
                  className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  合并为一篇作文（已选 {selectedPageIds.length} 张）
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPageIds([])}
                  disabled={isOcrRunning}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
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
                            disabled={isOcrRunning}
                            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
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
                                  disabled={isOcrRunning}
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
                                  disabled={displayIndex === 1 || isOcrRunning}
                                  onClick={() => movePage(page.id, 'up')}
                                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 disabled:opacity-40"
                                >
                                  上移
                                </button>
                                <button
                                  type="button"
                                  disabled={displayIndex === pages.length || isOcrRunning}
                                  onClick={() => movePage(page.id, 'down')}
                                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 disabled:opacity-40"
                                >
                                  下移
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removePage(page.id)}
                                  disabled={isOcrRunning}
                                  aria-label={`删除 ${page.label}`}
                                  className="rounded-md border border-rose-100 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
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

        {ocrStatus === 'success' || ocrStatus === 'failed' ? (
          <section className="rounded-lg border border-cyan-100 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-cyan-700">
                  {ocrStatus === 'failed' ? 'OCR 识别失败' : 'OCR 识别完成'}
                </p>
                <h3 className="mt-1 font-semibold text-slate-950">OCR 文本草稿</h3>
                <p className="mt-1 text-sm text-slate-500">
                  当前整理方式会提交 {essaySubmissionCount} 篇作文，每个文本框对应一篇作文。
                </p>
              </div>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                {ocrMode === 'real' ? 'Gateway OCR' : 'mock OCR'}
              </span>
            </div>
            {ocrError ? (
              <div className="mt-4 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
                {ocrError}
              </div>
            ) : null}
            {emptyTextWarning ? (
              <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                识别结果为空，请检查图片或手动输入。
              </div>
            ) : null}
            {ocrFallbackNotice ? (
              <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                {ocrFallbackNotice}
              </div>
            ) : null}
            {ocrStatus === 'failed' ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={useMockDraftFallback}
                  className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                >
                  使用 mock 草稿
                </button>
                <button
                  type="button"
                  onClick={startManualOcrInput}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  手动输入 OCR 文本
                </button>
                <button
                  type="button"
                  onClick={startOcr}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  重试 OCR
                </button>
              </div>
            ) : null}
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
                disabled={!canConfirmOcr}
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
