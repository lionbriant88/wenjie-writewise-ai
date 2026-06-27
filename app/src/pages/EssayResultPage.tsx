import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Image, X } from 'lucide-react'
import { EmptyState } from '../components/EmptyState'
import { EssayPageSorter } from '../components/EssayPageSorter'
import { ExpressionUpgradeList } from '../components/ExpressionUpgradeList'
import { IssueCorrectionList } from '../components/IssueCorrectionList'
import { SaveFeedback } from '../components/SaveFeedback'
import { ScoreBreakdown } from '../components/ScoreBreakdown'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import { findEssay, findEssaysByTask, findResultByEssayId, findTask } from '../utils/taskLookup'

function ReviewSwitchLink({
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

function ReviewActionBar({
  label,
  previousEssayId,
  nextEssayId,
  taskId,
}: {
  label?: string
  previousEssayId?: string
  nextEssayId?: string
  taskId: string
}) {
  return (
    <div
      role={label ? 'region' : undefined}
      aria-label={label}
      className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to={`/tasks/${taskId}/progress`}
          className="tech-focus inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50"
        >
          <ArrowLeft className="h-4 w-4" />
          返回批改进度
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <ReviewSwitchLink direction="previous" essayId={previousEssayId} taskId={taskId} />
          <ReviewSwitchLink direction="next" essayId={nextEssayId} taskId={taskId} />
        </div>
      </div>
    </div>
  )
}

export function EssayResultPage() {
  const { taskId = '', essayId = '' } = useParams()
  const {
    tasks,
    essays,
    gradingResults,
    updateEssayOcrText,
    updateGradingResult,
  } = useAppState()
  const [saveNotice, setSaveNotice] = useState(false)
  const [showOriginalImage, setShowOriginalImage] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const task = findTask(tasks, taskId)
  const essay = findEssay(essays, essayId)
  const result = findResultByEssayId(gradingResults, essayId)
  const taskEssays = findEssaysByTask(essays, taskId)
  const essayIndex = taskEssays.findIndex((item) => item.id === essayId)
  const previousEssayId = essayIndex > 0 ? taskEssays[essayIndex - 1].id : undefined
  const nextEssayId =
    essayIndex >= 0 && essayIndex < taskEssays.length - 1 ? taskEssays[essayIndex + 1].id : undefined

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  const showSaveNotice = () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
    }

    setSaveNotice(true)
    saveTimerRef.current = window.setTimeout(() => {
      setSaveNotice(false)
      saveTimerRef.current = null
    }, 900)
  }

  if (!task || !essay) {
    return <EmptyState title="找不到作文" description="请返回任务进度页重新选择一篇作文。" />
  }

  if (!result) {
    return (
      <AppLayout task={task} title={`${essay.essayNumber} 批改结果`} currentStep="progress">
        <div className="space-y-4">
          <ReviewActionBar previousEssayId={previousEssayId} nextEssayId={nextEssayId} taskId={task.id} />
          <EmptyState title="暂无批改结果" description="这篇作文还未完成 AI 批改。" />
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout
      task={task}
      title={`${essay.essayNumber} 批改结果`}
      currentStep="progress"
      description="教师可检查 AI 评分、问题与修改建议，并进行模拟调整。"
    >
      <div className="space-y-5">
        <div
          role="region"
          aria-label="顶部批改操作"
          className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to={`/tasks/${task.id}/progress`}
                className="tech-focus inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50"
              >
                <ArrowLeft className="h-4 w-4" />
                返回批改进度
              </Link>
              <div>
                <p className="text-sm font-semibold text-slate-950">{essay.essayNumber} 批改结果</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  总分 <span className="font-semibold text-blue-700">{result.totalScore.toFixed(1)} / {task.fullScore}</span>
                  <span className="mx-2 text-slate-300">|</span>
                  AI 置信度 {Math.round(result.aiConfidence * 100)}%
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ReviewSwitchLink direction="previous" essayId={previousEssayId} taskId={task.id} />
              <ReviewSwitchLink direction="next" essayId={nextEssayId} taskId={task.id} />
            </div>
          </div>
        </div>
        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-5">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-950">学生作文原文</h3>
                  <p className="mt-1 text-xs font-semibold text-amber-700">
                    OCR 置信度 {Math.round(essay.ocrConfidence * 100)}%
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowOriginalImage(true)}
                  className="tech-focus inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50"
                >
                  <Image className="h-4 w-4" />
                  查看原图
                </button>
              </div>
              <textarea
                value={essay.ocrText}
                onChange={(event) => updateEssayOcrText(essay.id, event.target.value)}
                className="mt-4 min-h-[320px] w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-800 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>
          <div className="space-y-5">
            <div className="rounded-lg border border-blue-100 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-500">总分</p>
                  <div className="mt-2 flex flex-wrap items-end gap-3">
                    <input
                      type="number"
                      min={0}
                      max={task.fullScore}
                      step={0.1}
                      value={result.totalScore}
                      onChange={(event) => {
                        updateGradingResult(essay.id, {
                          totalScore: Number.parseFloat(event.target.value) || 0,
                        })
                        showSaveNotice()
                      }}
                      className="tech-focus w-32 rounded-lg border border-slate-200 px-3 py-2 text-3xl font-semibold text-slate-950"
                    />
                    <span className="pb-2 text-slate-500">/ {task.fullScore}</span>
                  </div>
                </div>
                <div className="text-right">
                  <SaveFeedback show={saveNotice} />
                  <p className="mt-2 text-xs text-slate-500">AI 置信度 {Math.round(result.aiConfidence * 100)}%</p>
                </div>
              </div>
              {result.teacherAdjusted ? (
                <span className="mt-4 inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                  教师已调整
                </span>
              ) : null}
            </div>
            <ScoreBreakdown
              dimensions={result.dimensionScores}
              editable
              onChange={(dimensionId, score) => {
                updateGradingResult(essay.id, {
                  dimensionScores: result.dimensionScores.map((dimension) =>
                    dimension.id === dimensionId ? { ...dimension, score } : dimension,
                  ),
                })
                showSaveNotice()
              }}
            />
            <IssueCorrectionList annotations={result.errorAnnotations} revisions={result.sentenceRevisions} />
            <ExpressionUpgradeList upgrades={result.upgradedExpressions} />
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="font-semibold text-slate-950">总评</h3>
              <textarea
                value={result.overallComment}
                onChange={(event) => {
                  updateGradingResult(essay.id, { overallComment: event.target.value })
                  showSaveNotice()
                }}
                className="mt-3 min-h-28 w-full rounded-lg border border-slate-200 p-3 text-sm leading-6 text-slate-700"
              />
            </div>
          </div>
        </div>
        <ReviewActionBar
          label="底部批改操作"
          previousEssayId={previousEssayId}
          nextEssayId={nextEssayId}
          taskId={task.id}
        />
      </div>
      {showOriginalImage ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="原图预览"
            className="max-h-full w-full max-w-4xl overflow-auto rounded-lg bg-white p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="font-semibold text-slate-950">原图预览</h3>
              <button
                type="button"
                onClick={() => setShowOriginalImage(false)}
                className="tech-focus inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <X className="h-4 w-4" />
                关闭
              </button>
            </div>
            <EssayPageSorter pages={essay.pages} />
          </div>
        </div>
      ) : null}
    </AppLayout>
  )
}
