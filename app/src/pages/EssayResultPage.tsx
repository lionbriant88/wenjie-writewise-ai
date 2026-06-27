import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { EmptyState } from '../components/EmptyState'
import { ErrorAnnotationList } from '../components/ErrorAnnotationList'
import { EssayPageSorter } from '../components/EssayPageSorter'
import { OcrTextEditor } from '../components/OcrTextEditor'
import { RevisionSuggestionList } from '../components/RevisionSuggestionList'
import { SaveFeedback } from '../components/SaveFeedback'
import { ScoreBreakdown } from '../components/ScoreBreakdown'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import { findEssay, findResultByEssayId, findTask } from '../utils/taskLookup'

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
  const saveTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const task = findTask(tasks, taskId)
  const essay = findEssay(essays, essayId)
  const result = findResultByEssayId(gradingResults, essayId)

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
          <Link
            to={`/tasks/${task.id}/progress`}
            className="tech-focus inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50"
          >
            <ArrowLeft className="h-4 w-4" />
            返回
          </Link>
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
      description="教师可检查 AI 评分、错误标注和修改建议，并进行模拟调整。"
    >
      <div className="space-y-5">
        <Link
          to={`/tasks/${task.id}/progress`}
          className="tech-focus inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </Link>
        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-5">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="font-semibold text-slate-950">原图预览</h3>
              <div className="mt-4">
                <EssayPageSorter pages={essay.pages} />
              </div>
            </div>
            <OcrTextEditor
              value={essay.ocrText}
              confidence={essay.ocrConfidence}
              onChange={(value) => updateEssayOcrText(essay.id, value)}
            />
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
            <ErrorAnnotationList annotations={result.errorAnnotations} />
            <RevisionSuggestionList revisions={result.sentenceRevisions} upgrades={result.upgradedExpressions} />
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
      </div>
    </AppLayout>
  )
}
