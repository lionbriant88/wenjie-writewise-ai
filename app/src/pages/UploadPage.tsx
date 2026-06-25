import { useMemo, useState } from 'react'
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
  const { tasks, essays } = useAppState()
  const task = findTask(tasks, taskId)
  const taskEssays = findEssaysByTask(essays, taskId)
  const initialPages = useMemo(() => taskEssays.flatMap((essay) => essay.pages).slice(0, 6), [taskEssays])
  const [pages, setPages] = useState<EssayPage[]>(initialPages)

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

  return (
    <AppLayout
      task={task}
      title="上传作文与多页整理"
      description="用模拟图片演示批量上传、多页合并、拆分和页序调整。"
    >
      <div className="space-y-6">
        <UploadPanel onAddPage={addPage} onSubmit={() => navigate(`/tasks/${task.id}/progress`)} />
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-950">已上传图片</h3>
              <p className="mt-1 text-sm text-slate-500">当前 {pages.length} 张，按作文编号进行整理。</p>
            </div>
            <div className="flex gap-2">
              <button className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
                合并为多页作文
              </button>
              <button className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
                拆分页
              </button>
            </div>
          </div>
          <div className="mt-5">
            {pages.length > 0 ? (
              <EssayPageSorter pages={pages} onMove={movePage} />
            ) : (
              <EmptyState
                title="还没有模拟图片"
                description="点击添加模拟图片，演示手机拍照或扫描件进入批改队列。"
              />
            )}
          </div>
        </div>
        <Link to={`/tasks/${task.id}/progress`} className="inline-flex text-sm font-semibold text-blue-700">
          跳过上传，查看批改进度
        </Link>
      </div>
    </AppLayout>
  )
}
