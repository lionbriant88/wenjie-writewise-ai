import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Image, X } from 'lucide-react'
import { DiagnosticScoreSummary } from '../components/DiagnosticScoreSummary'
import { EmptyState } from '../components/EmptyState'
import { EssayPageSorter } from '../components/EssayPageSorter'
import { ExpressionUpgradeList } from '../components/ExpressionUpgradeList'
import { IssueCorrectionList } from '../components/IssueCorrectionList'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import { calculateTotalScore, clampDimensionScore, formatConfidence, formatTotalScore } from '../utils/gradingDiagnostics'
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
  const { tasks, essays, gradingResults, updateEssayOcrText, updateGradingResult } = useAppState()
  const [saveNotice, setSaveNotice] = useState('')
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

  const showSaveNotice = (message = '已保存教师调整') => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
    }

    setSaveNotice(message)
    saveTimerRef.current = window.setTimeout(() => {
      setSaveNotice('')
      saveTimerRef.current = null
    }, 1800)
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

  const fullScore = task.fullScore ?? 15
  const totalScore = calculateTotalScore(result.dimensionScores, fullScore)

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
                  总分 <span className="font-semibold text-blue-700">{formatTotalScore(totalScore)} / {fullScore}</span>
                  <span className="mx-2 text-slate-300">|</span>
                  AI 置信度 {formatConfidence(result.aiConfidence)}
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
                    OCR 置信度 {formatConfidence(essay.ocrConfidence)}
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
            {(saveNotice || result.teacherAdjusted) ? (
              <div className="flex flex-wrap items-center gap-2">
                {saveNotice ? (
                  <div
                    role="status"
                    className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-sm"
                  >
                    {saveNotice}
                  </div>
                ) : null}
                {result.teacherAdjusted ? (
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                    已由教师调整
                  </span>
                ) : null}
              </div>
            ) : null}
            <DiagnosticScoreSummary
              aiConfidence={result.aiConfidence}
              dimensions={result.dimensionScores}
              fullScore={fullScore}
              issues={result.errorAnnotations}
              onDimensionScoreChange={(dimensionId, nextScore) => {
                const nextDimensions = result.dimensionScores.map((dimension) =>
                  dimension.id === dimensionId
                    ? { ...dimension, score: clampDimensionScore(nextScore, dimension.maxScore) }
                    : dimension,
                )

                updateGradingResult(essay.id, {
                  dimensionScores: nextDimensions,
                  totalScore: calculateTotalScore(nextDimensions, fullScore),
                })
                showSaveNotice('分数已更新')
              }}
            />
            <IssueCorrectionList annotations={result.errorAnnotations} revisions={result.sentenceRevisions} />
            <ExpressionUpgradeList upgrades={result.upgradedExpressions} />
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-950">AI 总评 / 教师补充建议</h3>
                  <p className="mt-1 text-xs text-slate-500">老师可在 AI 总评基础上补充最终反馈。</p>
                </div>
                {result.teacherAdjusted ? (
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                    已由教师调整
                  </span>
                ) : null}
              </div>
              <label className="mt-4 block">
                <span className="text-xs font-semibold text-slate-600">AI 总评</span>
                <textarea
                  aria-label="AI 总评"
                  value={result.overallComment}
                  onChange={(event) => updateGradingResult(essay.id, { overallComment: event.target.value })}
                  className="mt-2 min-h-28 w-full rounded-lg border border-slate-200 p-3 text-sm leading-6 text-slate-700"
                />
              </label>
              <label className="mt-3 block">
                <span className="text-xs font-semibold text-slate-600">教师补充建议</span>
                <textarea
                  aria-label="教师补充建议"
                  value={result.teacherSuggestion ?? ''}
                  onChange={(event) => updateGradingResult(essay.id, { teacherSuggestion: event.target.value })}
                  className="mt-2 min-h-24 w-full rounded-lg border border-slate-200 p-3 text-sm leading-6 text-slate-700"
                  placeholder="例如：建议先复习 suggest 后接动词原形，再重写第二段。"
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  updateGradingResult(essay.id, { teacherAdjusted: true })
                  showSaveNotice('已保存教师调整')
                }}
                className="tech-focus mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                保存调整
              </button>
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
