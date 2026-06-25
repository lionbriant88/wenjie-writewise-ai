import { useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { EssayPageSorter } from '../components/EssayPageSorter'
import { OcrTextEditor } from '../components/OcrTextEditor'
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
  const task = findTask(tasks, taskId)
  const exceptionEssays = findEssaysByTask(essays, taskId).filter(
    (essay) => essay.status === 'needs_review',
  )

  if (!task) {
    return <EmptyState title="找不到任务" description="请返回任务列表重新选择一个批改任务。" />
  }

  return (
    <AppLayout task={task} title="异常复核" description="教师只处理 OCR 或图像质量不可靠的作文。">
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
                  onChange={(value) => updateEssayOcrText(essay.id, value)}
                />
                <div className="flex flex-wrap gap-3">
                  <button className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white">
                    重新批改
                  </button>
                  <button
                    onClick={() => markEssayManual(essay.id)}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
                  >
                    标记为人工批改
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </AppLayout>
  )
}
