import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, RotateCcw } from 'lucide-react'
import { EmptyState } from '../components/EmptyState'
import { EssayPageSorter } from '../components/EssayPageSorter'
import { OcrTextEditor } from '../components/OcrTextEditor'
import { SaveFeedback } from '../components/SaveFeedback'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import { findEssaysByTask, findTask } from '../utils/taskLookup'

const reasonLabels: Record<string, string> = {
  low_ocr_confidence: 'OCR 置信度低',
  blurry_image: '图片模糊',
  messy_handwriting: '字迹太乱',
}

export function ExceptionsPage() {
  const { taskId = '' } = useParams()
  const { tasks, essays, updateEssayOcrText, markEssayManual } = useAppState()
  const [savedEssayId, setSavedEssayId] = useState<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const task = findTask(tasks, taskId)
  const exceptionEssays = findEssaysByTask(essays, taskId).filter(
    (essay) => essay.status === 'needs_review',
  )

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  const showSaved = (essayId: string) => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
    }

    setSavedEssayId(essayId)
    saveTimerRef.current = window.setTimeout(() => {
      setSavedEssayId(null)
      saveTimerRef.current = null
    }, 900)
  }

  if (!task) {
    return <EmptyState title="找不到任务" description="请返回任务列表重新选择一个批改任务。" />
  }

  return (
    <AppLayout
      task={task}
      title="异常复核"
      currentStep="progress"
      description="教师只处理 OCR 或图像质量不可靠的作文。"
    >
      <div className="space-y-5">
        <Link
          to={`/tasks/${task.id}/progress`}
          className="tech-focus inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </Link>
        {exceptionEssays.length === 0 ? (
          <EmptyState title="暂无异常作文" description="当前任务没有需要人工复核的作文。" />
        ) : (
          <div className="space-y-5">
            {exceptionEssays.map((essay) => (
              <article key={essay.id} className="grid gap-5 rounded-lg border border-slate-200 bg-white p-5 xl:grid-cols-[360px_minmax(0,1fr)]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-slate-950">{essay.essayNumber}</h3>
                  {essay.exceptionReasons.map((reason) => (
                    <span key={reason} className="rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-700">
                      {reasonLabels[reason]}
                    </span>
                  ))}
                </div>
                <div className="mt-4">
                  <EssayPageSorter pages={essay.pages} />
                </div>
              </div>
              <div className="space-y-4">
                <OcrTextEditor
                  value={essay.ocrText}
                  confidence={essay.ocrConfidence}
                  onChange={(value) => {
                    updateEssayOcrText(essay.id, value)
                    showSaved(essay.id)
                  }}
                />
                <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">复核动作</p>
                    <p className="mt-1 text-xs text-slate-500">修改 OCR 后可重新触发模拟批改，或转入人工批改。</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <SaveFeedback show={savedEssayId === essay.id} label="OCR 已保存" />
                    <button className="tech-focus inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 active:scale-[0.99]">
                      <RotateCcw className="h-4 w-4" />
                      重新批改
                    </button>
                    <button
                      onClick={() => markEssayManual(essay.id)}
                      className="tech-focus inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-amber-200 hover:bg-amber-50"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      标记为人工批改
                    </button>
                  </div>
                </div>
              </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
