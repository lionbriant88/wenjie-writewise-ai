import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { EssayPageSorter } from '../components/EssayPageSorter'
import { UploadPanel } from '../components/UploadPanel'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import type { EssayPage } from '../types'
import { findEssaysByTask, findTask } from '../utils/taskLookup'

type EssayGroupingMode = 'merged' | 'perPage' | 'manual'

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
    : 'rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50/60'
}

export function UploadPage() {
  const { taskId = '' } = useParams()
  const navigate = useNavigate()
  const { tasks, essays, confirmMockOcrEssay } = useAppState()
  const task = findTask(tasks, taskId)
  const taskEssays = findEssaysByTask(essays, taskId)
  const initialPages = useMemo(() => taskEssays.flatMap((essay) => essay.pages).slice(0, 6), [taskEssays])
  const [pages, setPages] = useState<EssayPage[]>(initialPages)
  const [essayGroupingMode, setEssayGroupingMode] = useState<EssayGroupingMode>('merged')
  const [manualGroups, setManualGroups] = useState<string[][]>([initialPages.map((page) => page.id)])
  const [mockOcrStatus, setMockOcrStatus] = useState<'idle' | 'completed'>('idle')
  const [mockOcrDraft, setMockOcrDraft] = useState('')
  const [manualOcrDrafts, setManualOcrDrafts] = useState<string[]>([])
  const localPreviewUrlsRef = useRef<string[]>([])

  const pagesById = useMemo(() => new Map(pages.map((page) => [page.id, page])), [pages])
  const nonEmptyManualGroups = useMemo(
    () =>
      manualGroups
        .map((group) => group.filter((pageId) => pagesById.has(pageId)))
        .filter((group) => group.length > 0),
    [manualGroups, pagesById],
  )
  const essaySubmissionCount =
    essayGroupingMode === 'perPage'
      ? pages.length
      : essayGroupingMode === 'manual'
        ? nonEmptyManualGroups.length
        : pages.length > 0
          ? 1
          : 0

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
    setMockOcrDraft('')
    setManualOcrDrafts([])
  }

  const setGroupingMode = (mode: EssayGroupingMode) => {
    setEssayGroupingMode(mode)
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
    setManualGroups((current) => {
      const nextGroups = current.length > 0 ? [...current] : [[]]
      nextGroups[nextGroups.length - 1] = [...nextGroups[nextGroups.length - 1], nextPage.id]
      return nextGroups
    })
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

      setManualGroups((currentGroups) => {
        const nextGroups = currentGroups.length > 0 ? [...currentGroups] : [[]]
        nextGroups[nextGroups.length - 1] = [
          ...nextGroups[nextGroups.length - 1],
          ...nextPages.map((page) => page.id),
        ]
        return nextGroups
      })
      return [...current, ...nextPages]
    })
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

      const nextPages = current.filter((page) => page.id !== pageId)
      setManualGroups((currentGroups) => {
        const nextGroups = currentGroups
          .map((group) => group.filter((currentPageId) => currentPageId !== pageId))
          .filter((group) => group.length > 0)
        return nextGroups.length > 0 ? nextGroups : [nextPages.map((page) => page.id)]
      })
      return nextPages
    })
    resetOcrDraft()
  }

  const addManualGroup = () => {
    setManualGroups((current) => [...current, []])
    resetOcrDraft()
  }

  const movePageToManualGroup = (pageId: string, direction: 'previous' | 'next') => {
    setManualGroups((current) => {
      const sourceIndex = current.findIndex((group) => group.includes(pageId))
      if (sourceIndex < 0) return current

      const targetIndex = direction === 'previous' ? sourceIndex - 1 : sourceIndex + 1
      if (targetIndex < 0 || targetIndex >= current.length) return current

      const nextGroups = current.map((group) => group.filter((currentPageId) => currentPageId !== pageId))
      nextGroups[targetIndex] = [...nextGroups[targetIndex], pageId]
      const compacted = nextGroups.filter((group, index) => group.length > 0 || index === targetIndex)
      return compacted.length > 0 ? compacted : [pages.map((page) => page.id)]
    })
    resetOcrDraft()
  }

  const startMockOcr = () => {
    if (essayGroupingMode === 'manual') {
      setManualOcrDrafts(
        nonEmptyManualGroups.map((group) =>
          group
            .map((pageId) => pagesById.get(pageId))
            .filter((page): page is EssayPage => Boolean(page))
            .map((page, index) => buildPageOcrDraft(page, index))
            .join('\n\n'),
        ),
      )
      setMockOcrDraft('')
      setMockOcrStatus('completed')
      return
    }

    setMockOcrDraft(pages.map((page, index) => buildPageOcrDraft(page, index)).join('\n\n'))
    setMockOcrStatus('completed')
  }

  const getEssayGroups = () => {
    if (essayGroupingMode === 'manual') {
      return nonEmptyManualGroups.map((group, groupIndex) => ({
        pages: group.map((pageId) => pagesById.get(pageId)).filter((page): page is EssayPage => Boolean(page)),
        ocrText: manualOcrDrafts[groupIndex] ?? '',
      }))
    }

    if (essayGroupingMode === 'perPage') {
      const draftSections = mockOcrDraft
        .split(/\n{2,}/)
        .map((section) => section.trim())
        .filter(Boolean)

      return pages.map((page, index) => ({
        pages: [page],
        ocrText: draftSections[index] ?? buildPageOcrDraft(page, index),
      }))
    }

    return [
      {
        pages,
        ocrText: mockOcrDraft,
      },
    ]
  }

  const canConfirmMockOcr =
    essayGroupingMode === 'manual'
      ? nonEmptyManualGroups.length > 0 &&
        manualOcrDrafts.length === nonEmptyManualGroups.length &&
        manualOcrDrafts.every((draft) => draft.trim().length > 0)
      : mockOcrDraft.trim().length > 0 && pages.length > 0

  const confirmMockOcrText = () => {
    confirmMockOcrEssay({
      taskId: task.id,
      essayGroups: getEssayGroups(),
    })
    resetOcrDraft()
    navigate(`/tasks/${task.id}/progress`)
  }

  return (
    <AppLayout
      task={task}
      title="上传作文与多页整理"
      currentStep="upload"
      description="选择本地图片进行预览和页序整理，OCR 与 AI 批改仍保持模拟。"
    >
      <div className="space-y-6">
        <UploadPanel
          onAddPage={addPage}
          onSelectFiles={addLocalFiles}
          onSubmit={() => navigate(`/tasks/${task.id}/progress`)}
        />
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-950">已上传图片</h3>
              <p className="mt-1 text-sm text-slate-500">
                当前 {pages.length} 张，确认 OCR 后将提交 {essaySubmissionCount} 篇作文。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={startMockOcr}
                disabled={pages.length === 0}
                className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                开始模拟 OCR
              </button>
              <button
                type="button"
                aria-pressed={essayGroupingMode === 'merged'}
                onClick={() => setGroupingMode('merged')}
                className={groupingButtonClass(essayGroupingMode === 'merged')}
              >
                合并为多页作文
              </button>
              <button
                type="button"
                aria-pressed={essayGroupingMode === 'perPage'}
                onClick={() => setGroupingMode('perPage')}
                className={groupingButtonClass(essayGroupingMode === 'perPage')}
              >
                拆分页
              </button>
              <button
                type="button"
                aria-pressed={essayGroupingMode === 'manual'}
                onClick={() => setGroupingMode('manual')}
                className={groupingButtonClass(essayGroupingMode === 'manual')}
              >
                手动分组
              </button>
            </div>
          </div>
          <div className="mt-5">
            {pages.length > 0 && essayGroupingMode === 'manual' ? (
              <div className="space-y-3">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={addManualGroup}
                    disabled={pages.length === 0}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    新增作文组
                  </button>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {manualGroups.map((group, groupIndex) => {
                    const groupPages = group.map((pageId) => pagesById.get(pageId)).filter((page): page is EssayPage => Boolean(page))

                    return (
                      <section key={`manual-group-${groupIndex}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h4 className="text-sm font-semibold text-slate-950">作文组 {groupIndex + 1}</h4>
                            <p className="mt-0.5 text-xs text-slate-500">{groupPages.length} 张图片</p>
                          </div>
                        </div>
                        {groupPages.length > 0 ? (
                          <div className="grid gap-3 sm:grid-cols-2">
                            {groupPages.map((page) => (
                              <div key={page.id} className="rounded-lg bg-white p-2">
                                <EssayPageSorter pages={[page]} />
                                <div className="mt-2 grid grid-cols-3 gap-2">
                                  <button
                                    type="button"
                                    disabled={groupIndex === 0}
                                    onClick={() => movePageToManualGroup(page.id, 'previous')}
                                    aria-label={`将 ${page.label} 移到上一篇`}
                                    className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 disabled:opacity-40"
                                  >
                                    上一篇
                                  </button>
                                  <button
                                    type="button"
                                    disabled={groupIndex === manualGroups.length - 1}
                                    onClick={() => movePageToManualGroup(page.id, 'next')}
                                    aria-label={`将 ${page.label} 移到下一篇`}
                                    className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 disabled:opacity-40"
                                  >
                                    下一篇
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
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
                            可将图片移动到这里，形成新的作文。
                          </div>
                        )}
                      </section>
                    )
                  })}
                </div>
              </div>
            ) : pages.length > 0 ? (
              <EssayPageSorter pages={pages} onMove={movePage} onRemove={removePage} />
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
                  当前分组方式会提交 {essaySubmissionCount} 篇作文。
                </p>
              </div>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                置信度 88%
              </span>
            </div>
            {essayGroupingMode === 'manual' ? (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {nonEmptyManualGroups.map((group, groupIndex) => (
                  <label key={`manual-ocr-${groupIndex}`} className="block rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <span className="text-sm font-semibold text-slate-800">
                      作文组 {groupIndex + 1} OCR 文本
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">{group.length} 张图片</span>
                    <textarea
                      aria-label={`作文组 ${groupIndex + 1} OCR 文本`}
                      value={manualOcrDrafts[groupIndex] ?? ''}
                      onChange={(event) =>
                        setManualOcrDrafts((current) =>
                          current.map((draft, draftIndex) => (draftIndex === groupIndex ? event.target.value : draft)),
                        )
                      }
                      className="mt-3 min-h-40 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                ))}
              </div>
            ) : (
              <textarea
                aria-label="模拟 OCR 文本草稿"
                value={mockOcrDraft}
                onChange={(event) => setMockOcrDraft(event.target.value)}
                className="mt-4 min-h-44 w-full rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-800 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
              />
            )}
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
