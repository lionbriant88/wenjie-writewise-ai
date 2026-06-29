import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { EssayPageSorter } from '../components/EssayPageSorter'
import { UploadPanel } from '../components/UploadPanel'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import type { EssayPage } from '../types'
import { findEssaysByTask, findTask } from '../utils/taskLookup'

export function UploadPage() {
  const { taskId = '' } = useParams()
  const navigate = useNavigate()
  const { tasks, essays, confirmMockOcrEssay } = useAppState()
  const task = findTask(tasks, taskId)
  const taskEssays = findEssaysByTask(essays, taskId)
  const initialPages = useMemo(() => taskEssays.flatMap((essay) => essay.pages).slice(0, 6), [taskEssays])
  const [pages, setPages] = useState<EssayPage[]>(initialPages)
  const [mockOcrStatus, setMockOcrStatus] = useState<'idle' | 'completed'>('idle')
  const [mockOcrDraft, setMockOcrDraft] = useState('')
  const localPreviewUrlsRef = useRef<string[]>([])

  useEffect(() => {
    const localPreviewUrls = localPreviewUrlsRef.current

    return () => {
      localPreviewUrls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  if (!task) {
    return <EmptyState title="找不到任务" description="请返回任务列表重新选择一个批改任务。" />
  }

  const addPage = () => {
    const next = pages.length + 1
    setPages((current) => [
      ...current,
      {
        id: `uploaded-page-${Date.now()}`,
        label: `新增图片 ${next}`,
        pageNumber: next,
        quality: next % 3 === 0 ? 'tilted' : 'clear',
        accent: '#2563eb',
      },
    ])
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

      return [...current, ...nextPages]
    })
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
    setMockOcrStatus('idle')
    setMockOcrDraft('')
  }

  const startMockOcr = () => {
    const draft = pages
      .map((page, index) =>
        [
          `作文图片 ${index + 1}：${page.label}`,
          'Dear Sir or Madam,',
          'I am writing to share my suggestion for this activity.',
          'I believe it will help students improve their English writing.',
        ].join('\n'),
      )
      .join('\n\n')

    setMockOcrDraft(draft)
    setMockOcrStatus('completed')
  }

  const confirmMockOcrText = () => {
    confirmMockOcrEssay({
      taskId: task.id,
      pages,
      ocrText: mockOcrDraft,
    })
    setMockOcrStatus('idle')
    setMockOcrDraft('')
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
              <p className="mt-1 text-sm text-slate-500">当前 {pages.length} 张，按作文编号进行整理。</p>
            </div>
            <div className="flex gap-2">
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
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"
              >
                合并为多页作文
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"
              >
                拆分页
              </button>
            </div>
          </div>
          <div className="mt-5">
            {pages.length > 0 ? (
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
              </div>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                置信度 88%
              </span>
            </div>
            <textarea
              aria-label="模拟 OCR 文本草稿"
              value={mockOcrDraft}
              onChange={(event) => setMockOcrDraft(event.target.value)}
              className="mt-4 min-h-44 w-full rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-800 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
            />
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={confirmMockOcrText}
                disabled={mockOcrDraft.trim().length === 0}
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
