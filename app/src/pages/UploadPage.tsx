import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { EssayImagePreview } from '../components/EssayImagePreview'
import { UploadSourceSelector } from '../components/UploadSourceSelector'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import type { EssayPage } from '../types'
import type { UploadEssayGroup, UploadGroupingMode } from '../utils/essayGrouping'
import { createEssayImageGroups, renumberEssayGroups } from '../utils/essayGrouping'
import { findEssaysByTask, findTask } from '../utils/taskLookup'

const mixedGuideStorageKey = 'wenjie-hide-mixed-grouping-guide'

function groupingButtonClass(active: boolean) {
  return active
    ? 'rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800'
    : 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700'
}

export function UploadPage() {
  const { taskId = '' } = useParams()
  const navigate = useNavigate()
  const { tasks, essays, enqueueImageEssays } = useAppState()
  const task = findTask(tasks, taskId)
  const taskEssays = findEssaysByTask(essays, taskId)
  const initialPages = useMemo(() => taskEssays.flatMap((essay) => essay.pages).slice(0, 6), [taskEssays])
  const [pages, setPages] = useState<EssayPage[]>(initialPages)
  const [groupingMode, setGroupingMode] = useState<UploadGroupingMode>('single')
  const [mixedGroups, setMixedGroups] = useState<UploadEssayGroup[]>(() => createEssayImageGroups(initialPages, 'single'))
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([])
  const [className, setClassName] = useState(task?.className === '待选择班级' ? '' : (task?.className ?? ''))
  const [showMixedGuide, setShowMixedGuide] = useState(false)
  const localPreviewUrlsRef = useRef<string[]>([])
  const pagesById = useMemo(() => new Map(pages.map((page) => [page.id, page])), [pages])
  const pageOrderIndex = useMemo(() => new Map(pages.map((page, index) => [page.id, index])), [pages])
  const visibleEssayGroups = useMemo(() => {
    if (groupingMode !== 'mixed') return createEssayImageGroups(pages, groupingMode)
    const seen = new Set<string>()
    const selected = mixedGroups.map((group) => ({ ...group, pageIds: [...group.pageIds].sort((a, b) => (pageOrderIndex.get(a) ?? 0) - (pageOrderIndex.get(b) ?? 0)).filter((id) => pagesById.has(id) && !seen.has(id) && Boolean(seen.add(id))) })).filter((group) => group.pageIds.length)
    const missing = pages.filter((page) => !seen.has(page.id)).map((page) => ({ id: `group-${page.id}`, pageIds: [page.id] }))
    return renumberEssayGroups([...selected, ...missing].sort((a, b) => (pageOrderIndex.get(a.pageIds[0]) ?? 0) - (pageOrderIndex.get(b.pageIds[0]) ?? 0)))
  }, [groupingMode, mixedGroups, pageOrderIndex, pages, pagesById])

  useEffect(() => () => localPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url)), [])
  if (!task) return <EmptyState title="找不到任务" description="请返回任务列表重新选择一个批改任务。" />

  const addPage = () => {
    const next = pages.length + 1
    const page: EssayPage = { id: `uploaded-page-${Date.now()}`, label: `新增图片 ${next}`, pageNumber: next, quality: 'clear', accent: '#2563eb', sourceFile: new File([`mock page ${next}`], `mock-page-${next}.png`, { type: 'image/png' }) }
    setPages((current) => [...current, page])
    setMixedGroups((current) => renumberEssayGroups([...current, { id: `group-${page.id}`, pageIds: [page.id] }]))
  }
  const addLocalFiles = (files: File[]) => {
    if (!files.length) return
    setPages((current) => {
      const nextPages = files.map((file, index) => {
        const id = `local-page-${Date.now()}-${index}`
        const previewUrl = URL.createObjectURL(file)
        localPreviewUrlsRef.current.push(previewUrl)
        return { id, label: file.name, pageNumber: current.length + index + 1, quality: 'clear' as const, accent: '#0891b2', previewUrl, sourceFile: file }
      })
      setMixedGroups((groups) => renumberEssayGroups([...groups, ...nextPages.map((page) => ({ id: `group-${page.id}`, pageIds: [page.id] }))]))
      return [...current, ...nextPages]
    })
  }
  const movePage = (pageId: string, direction: 'up' | 'down') => setPages((current) => {
    const index = current.findIndex((page) => page.id === pageId); const target = direction === 'up' ? index - 1 : index + 1
    if (index < 0 || target < 0 || target >= current.length) return current
    const next = [...current]; const [page] = next.splice(index, 1); next.splice(target, 0, page); return next
  })
  const removePage = (pageId: string) => {
    setPages((current) => current.filter((page) => { if (page.id === pageId && page.previewUrl) { URL.revokeObjectURL(page.previewUrl); localPreviewUrlsRef.current = localPreviewUrlsRef.current.filter((url) => url !== page.previewUrl) }; return page.id !== pageId }))
    setMixedGroups((groups) => renumberEssayGroups(groups.map((group) => ({ ...group, pageIds: group.pageIds.filter((id) => id !== pageId) }))))
    setSelectedPageIds((ids) => ids.filter((id) => id !== pageId))
  }
  const mergeSelectedPages = () => {
    if (selectedPageIds.length < 2) return
    const selected = new Set(selectedPageIds); const ids = pages.filter((page) => selected.has(page.id)).map((page) => page.id)
    setMixedGroups(renumberEssayGroups([...visibleEssayGroups.map((group) => ({ ...group, pageIds: group.pageIds.filter((id) => !selected.has(id)) })).filter((group) => group.pageIds.length), { id: 'group-merged', pageIds: ids }].sort((a, b) => (pageOrderIndex.get(a.pageIds[0]) ?? 0) - (pageOrderIndex.get(b.pageIds[0]) ?? 0))))
    setSelectedPageIds([])
  }
  const splitGroup = (index: number) => setMixedGroups(renumberEssayGroups(visibleEssayGroups.flatMap((group, groupIndex) => groupIndex === index ? group.pageIds.map((id) => ({ id: `group-${id}`, pageIds: [id] })) : [group])))
  const getPages = (group: UploadEssayGroup) => group.pageIds.map((id) => pagesById.get(id)).filter((page): page is EssayPage => Boolean(page))
  const enqueueGroups = () => {
    if (!className.trim() || !pages.length) return
    enqueueImageEssays({ taskId: task.id, className, essayGroups: visibleEssayGroups.map((group) => ({ pages: getPages(group) })) })
    navigate(`/tasks/${task.id}/progress`)
  }
  const chooseMode = (mode: UploadGroupingMode) => { setGroupingMode(mode); setSelectedPageIds([]); if (mode === 'mixed') { setMixedGroups(createEssayImageGroups(pages, 'single')); setShowMixedGuide(localStorage.getItem(mixedGuideStorageKey) !== 'true') } else setShowMixedGuide(false) }

  return <AppLayout task={task} title="上传作文与图片整理" currentStep="upload" description="按页数规则整理作文图片，确认分组后直接进入批改队列。"><div className="space-y-6">
    <UploadSourceSelector onAddMockImage={addPage} onSelectImages={addLocalFiles} disabled={false} />
    <div className="rounded-lg border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="font-semibold text-slate-950">已上传图片</h3><p className="mt-1 text-sm text-slate-500">当前 {pages.length} 张图片，预计生成 {visibleEssayGroups.length} 篇作文</p></div><div className="w-full max-w-sm"><label className="text-sm font-semibold text-slate-700" htmlFor="upload-class-name">班级</label><div className="mt-1 flex gap-2"><input id="upload-class-name" value={className} onChange={(event) => setClassName(event.target.value)} placeholder="请输入班级" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" /><button type="button" onClick={enqueueGroups} disabled={!className.trim() || !pages.length} className="shrink-0 rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-200">确认分组并进入批改</button></div></div></div>
      <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-semibold text-slate-900">整理方式</p><div className="mt-3 flex flex-wrap gap-2">{(['single', 'fixed-2', 'mixed'] as const).map((mode) => <button key={mode} type="button" aria-pressed={groupingMode === mode} onClick={() => chooseMode(mode)} className={groupingButtonClass(groupingMode === mode)}>{mode === 'single' ? '一张一篇' : mode === 'fixed-2' ? '每 2 张一篇' : '混合页数'}</button>)}</div>
      {groupingMode === 'mixed' && showMixedGuide ? <div className="mt-3 rounded-lg border border-blue-100 bg-white p-3 text-sm text-slate-600">选择两张或更多图片后可合并为一篇作文。<button type="button" className="ml-3 text-blue-700" onClick={() => setShowMixedGuide(false)}>知道了</button><button type="button" className="ml-3 text-slate-500" onClick={() => { localStorage.setItem(mixedGuideStorageKey, 'true'); setShowMixedGuide(false) }}>不再提醒</button></div> : null}</div>
      {groupingMode === 'mixed' && selectedPageIds.length >= 2 ? <div className="mt-4"><button type="button" onClick={mergeSelectedPages} className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white">合并为一篇作文（已选 {selectedPageIds.length} 张）</button></div> : null}
      <div className="mt-5">{pages.length ? <div className="grid gap-3 lg:grid-cols-2">{visibleEssayGroups.map((group, groupIndex) => <section key={group.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="mb-3 flex justify-between"><div><h4 className="text-sm font-semibold text-slate-950">作文 {groupIndex + 1} · 共 {getPages(group).length} 页</h4><p className="text-xs text-slate-500">将按卡片内图片顺序发送给批改模型。</p></div>{group.pageIds.length > 1 ? <button type="button" onClick={() => splitGroup(groupIndex)} className="text-sm text-blue-700">拆分此作文 {groupIndex + 1}</button> : null}</div><div className="grid gap-3 sm:grid-cols-2">{getPages(group).map((page) => { const index = pageOrderIndex.get(page.id) ?? 0; const selected = selectedPageIds.includes(page.id); return <div key={page.id} className={`rounded-lg bg-white p-2 ${selected ? 'ring-2 ring-blue-400' : ''}`}>{groupingMode === 'mixed' ? <button type="button" aria-label={`选择第 ${index + 1} 张图片`} aria-pressed={selected} onClick={() => setSelectedPageIds((ids) => ids.includes(page.id) ? ids.filter((id) => id !== page.id) : [...ids, page.id])}><EssayImagePreview page={page} /></button> : <EssayImagePreview page={page} />}<div className="mt-2 grid grid-cols-3 gap-2"><button type="button" disabled={!index} onClick={() => movePage(page.id, 'up')}>上移</button><button type="button" disabled={index === pages.length - 1} onClick={() => movePage(page.id, 'down')}>下移</button><button type="button" aria-label={`删除 ${page.label}`} onClick={() => removePage(page.id)}>删除</button></div></div>})}</div></section>)}</div> : <EmptyState title="还没有图片" description="添加图片后可整理分组并直接进入批改队列。" />}</div>
    </div><Link to={`/tasks/${task.id}/progress`} className="inline-flex text-sm font-semibold text-blue-700">查看批改进度</Link>
  </div></AppLayout>
}
