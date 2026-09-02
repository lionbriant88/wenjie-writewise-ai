import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { DiagnosticScoreSummary } from '../components/DiagnosticScoreSummary'
import { EmptyState } from '../components/EmptyState'
import { EssayPageSorter } from '../components/EssayPageSorter'
import { EssaySourcePanel } from '../components/EssaySourcePanel'
import { FullTextRevisionPanel } from '../components/FullTextRevisionPanel'
import { IssueCorrectionList } from '../components/IssueCorrectionList'
import { OriginalPaperWorkspace } from '../components/OriginalPaperWorkspace'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import { calculateTotalScore, clampDimensionScore, formatTotalScore } from '../utils/gradingDiagnostics'
import { buildClassReviewIssueInputFromReviewIssue, buildReviewIssueItems } from '../utils/reviewIssueItems'
import { buildSourceIssueMarkers } from '../utils/sourceIssueMarkers'
import { findTextMatch } from '../utils/textHighlight'
import { findEssay, findEssaysByTask, findResultByEssayId, findTask } from '../utils/taskLookup'
import type { EssayStatus } from '../types'

type EssayDetailTab = 'scoring' | 'issues' | 'revision' | 'feedback'
type EssayWorkspaceMode = 'grading' | 'paper'

const essayDetailTabs: Array<{ id: EssayDetailTab; label: string }> = [
  { id: 'scoring', label: '评分诊断' },
  { id: 'issues', label: '问题批改' },
  { id: 'revision', label: '全文优化' },
  { id: 'feedback', label: '教师反馈' },
]

export function GradingReviewBanner({
  essayStatus,
  hasResult,
  reviewReasons,
  onConfirm,
}: {
  essayStatus: EssayStatus
  hasResult: boolean
  reviewReasons: string[]
  onConfirm: () => void
}) {
  const isPendingConfirmation = essayStatus === 'grading_ready'
  if (!isPendingConfirmation && reviewReasons.length === 0) return null

  return (
    <section aria-label={isPendingConfirmation ? '教师确认批改结果' : '建议教师复核'} className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-amber-950">
            {reviewReasons.length > 0 ? '建议教师复核' : 'AI 批改已完成，尚待教师确认。'}
          </p>
          <p className="mt-1 text-xs leading-5 text-amber-800">
            {reviewReasons.length > 0
              ? 'AI 已给出完整评分；以下依据置信度较低，请教师重点核对。'
              : '请核对评分、问题定位和改写建议后再确认。'}
          </p>
        </div>
        {isPendingConfirmation ? (
          <button
            type="button"
            disabled={!hasResult}
            onClick={onConfirm}
            className="tech-focus rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-amber-300"
          >
            确认本篇批改
          </button>
        ) : null}
      </div>
      {reviewReasons.length > 0 ? (
        <div className="mt-3 border-t border-amber-200 pt-3">
          <p className="text-xs font-semibold text-amber-950">低置信度依据</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-5 text-amber-900">
            {reviewReasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

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
  const location = useLocation()
  const {
    tasks,
    essays,
    gradingResults,
    updateEssayOcrText,
    updateGradingResult,
    confirmGradingResult,
    classReview,
  } = useAppState()
  const [saveNotice, setSaveNotice] = useState('')
  const [activeDetailTab, setActiveDetailTab] = useState<EssayDetailTab>('scoring')
  const [workspaceMode, setWorkspaceMode] = useState<EssayWorkspaceMode>('grading')
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null)
  const [showOriginalImage, setShowOriginalImage] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const feedbackPanelRef = useRef<HTMLDivElement | null>(null)
  const task = findTask(tasks, taskId)
  const essay = findEssay(essays, essayId)
  const result = findResultByEssayId(gradingResults, essayId)
  const taskEssays = findEssaysByTask(essays, taskId)
  const essayIndex = taskEssays.findIndex((item) => item.id === essayId)
  const previousEssayId = essayIndex > 0 ? taskEssays[essayIndex - 1].id : undefined
  const nextEssayId =
    essayIndex >= 0 && essayIndex < taskEssays.length - 1 ? taskEssays[essayIndex + 1].id : undefined
  const reviewIssueItems = result
    ? buildReviewIssueItems({
        annotations: result.errorAnnotations,
        revisions: result.sentenceRevisions,
        logicIssues: result.fullTextRevision?.logicIssues,
        legibilityIssues: result.legibilityIssues ?? [],
      })
    : []
  const resultRevision = result?.resultRevision ?? 0
  const sourceParams = new URLSearchParams(location.search)
  const sourceLocatorParam = sourceParams.get('sourceLocator')
  const sourceRevisionParam = sourceParams.get('sourceResultRevision')
  const sourceRevision = sourceRevisionParam !== null && /^\d+$/u.test(sourceRevisionParam)
    ? Number(sourceRevisionParam)
    : null
  const hasSourceRequest = sourceLocatorParam !== null || sourceRevisionParam !== null
  const hasResult = result !== undefined
  const sourceIssueId = result !== undefined
    && sourceLocatorParam !== null
    && sourceRevision !== null
    && sourceRevision === resultRevision
    ? reviewIssueItems.find((issue) => issue.sourceLocator === sourceLocatorParam)?.id ?? null
    : null

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!hasSourceRequest || !hasResult) return
    setWorkspaceMode('grading')
    setActiveDetailTab('issues')
    if (sourceIssueId) {
      setActiveIssueId(sourceIssueId)
      feedbackPanelRef.current?.focus()
      return
    }
    setActiveIssueId(null)
    feedbackPanelRef.current?.focus()
  }, [hasResult, hasSourceRequest, sourceIssueId])

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
          <GradingReviewBanner
            essayStatus={essay.status}
            hasResult={false}
            reviewReasons={[]}
            onConfirm={() => confirmGradingResult(essay.id)}
          />
          <EmptyState
            title={essay.status === 'pending_grading' ? '结果已失效' : '暂无批改结果'}
            description={essay.status === 'pending_grading'
              ? '识别文本已修改，原批改结果已失效。请返回进度页后显式重新批改。'
              : '这篇作文还未完成 AI 批改。'}
            action={essay.status === 'pending_grading' ? (
              <Link to={`/tasks/${task.id}/progress`} className="tech-focus inline-flex rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">
                返回批改进度重新批改
              </Link>
            ) : undefined}
          />
        </div>
      </AppLayout>
    )
  }

  const fullScore = task.fullScore ?? 15
  const hasLegibilityIssue = (result.legibilityIssues?.length ?? 0) > 0
  const totalScore = calculateTotalScore(result.dimensionScores, fullScore, hasLegibilityIssue)
  const sourceIssueMarkers = buildSourceIssueMarkers(essay.ocrText, reviewIssueItems)
  const activeIssue = reviewIssueItems.find((issue) => issue.id === activeIssueId) ?? null
  const activeIssueLocateStatus = !activeIssue
    ? 'idle'
    : findTextMatch(essay.ocrText, activeIssue.original)
      ? 'located'
      : 'missing'
  const sourceUnavailable = hasSourceRequest && sourceIssueId === null
  const classReviewSnapshot = classReview.peekSnapshot(task.id)
  const getIssueInput = (issue: (typeof reviewIssueItems)[number]) =>
    buildClassReviewIssueInputFromReviewIssue({
      taskId: task.id,
      essayId: essay.id,
      resultRevision,
      issue,
    })
  const issueMatchesRef = (
    issue: (typeof reviewIssueItems)[number],
    ref: { sourceLocator: string; sourceResultRevision: number; anonymousExample: string | null },
  ) =>
    ref.sourceLocator === issue.sourceLocator
    && ref.sourceResultRevision === resultRevision
    && (ref.anonymousExample === null || ref.anonymousExample === issue.original)
  const findTeacherEvidenceId = (issue: (typeof reviewIssueItems)[number]) => {
    if (!classReviewSnapshot) return null
    const sourceLocator = issue.sourceLocator
    for (const block of classReviewSnapshot.report.issueBlocks) {
      for (const ref of block.evidenceRefs) {
        if (
          ref.selectionOrigin === 'teacher_selected'
          && ref.sourceLocator === sourceLocator
          && issueMatchesRef(issue, ref)
        ) return ref.evidenceId
      }
    }
    return null
  }
  const getIssueClassReviewState = (issue: (typeof reviewIssueItems)[number]) => {
    if (findTeacherEvidenceId(issue)) return 'teacher_selected'
    if (!classReviewSnapshot) return 'available'
    for (const block of classReviewSnapshot.report.issueBlocks) {
      const hasSystemRef = block.evidenceRefs.some((ref) =>
        ref.selectionOrigin === 'system_generation'
        && (issueMatchesRef(issue, ref) || block.anonymousExamples.includes(issue.original)))
      if (hasSystemRef) return 'system_included'
    }
    return 'available'
  }

  return (
    <AppLayout
      task={task}
      title={`${essay.essayNumber} 批改结果`}
      currentStep="progress"
      description="教师可检查 AI 评分、问题与修改建议，并进行模拟调整。"
      focusedReview
    >
      <div className="space-y-5">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
          {[
            { mode: 'grading' as const, label: '批改工作台' },
            { mode: 'paper' as const, label: '原卷视图' },
          ].map((modeOption) => (
            <button
              key={modeOption.mode}
              type="button"
              aria-pressed={workspaceMode === modeOption.mode}
              onClick={() => setWorkspaceMode(modeOption.mode)}
              className={`tech-focus rounded-md px-4 py-2 text-sm font-semibold transition ${
                workspaceMode === modeOption.mode ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {modeOption.label}
            </button>
          ))}
        </div>

        {workspaceMode === 'paper' ? (
          <OriginalPaperWorkspace
            essay={essay}
            taskId={task.id}
            reviewIssues={reviewIssueItems}
            activeIssueId={activeIssueId}
            onIssueSelect={setActiveIssueId}
            previousEssayId={previousEssayId}
            nextEssayId={nextEssayId}
            onBackToGrading={() => setWorkspaceMode('grading')}
          />
        ) : (
          <>
            <GradingReviewBanner
              essayStatus={essay.status}
              hasResult
              reviewReasons={result.reviewReasons ?? []}
              onConfirm={() => confirmGradingResult(essay.id)}
            />
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
                </p>
                {result.source ? (
                  <span className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                    {result.source === 'remote' ? '真实 AI' : '演示结果'}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ReviewSwitchLink direction="previous" essayId={previousEssayId} taskId={task.id} />
              <ReviewSwitchLink direction="next" essayId={nextEssayId} taskId={task.id} />
            </div>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div role="region" aria-label="作文源文本面板" className="space-y-5">
            <EssaySourcePanel
              essay={essay}
              activeHighlightText={activeIssue?.original}
              issueMarkers={sourceIssueMarkers}
              activeIssueId={activeIssueId}
              transcriptionWarnings={result.recognitionWarnings ?? []}
              printedTextExcluded={result.printedTextExcluded}
              onIssueMarkerSelect={(issueId) => {
                setActiveIssueId(issueId)
                setActiveDetailTab('issues')
              }}
              onOcrTextChange={updateEssayOcrText}
              onViewOriginalImage={() => setShowOriginalImage(true)}
            />
          </div>

          <div
            ref={feedbackPanelRef}
            role="region"
            aria-label="教师反馈面板"
            tabIndex={-1}
            className="space-y-5"
          >
            {sourceUnavailable ? (
              <div
                role="status"
                className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
              >
                该来源版本已更新或不可用
              </div>
            ) : null}
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
            <div
              role="tablist"
              aria-label="单篇批改内容"
              className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm"
            >
              {essayDetailTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeDetailTab === tab.id}
                  onClick={() => setActiveDetailTab(tab.id)}
                  className={`tech-focus rounded-md px-4 py-2 text-sm font-semibold transition ${
                    activeDetailTab === tab.id
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeDetailTab === 'scoring' ? (
              <DiagnosticScoreSummary
                dimensions={result.dimensionScores}
                fullScore={fullScore}
                issues={result.errorAnnotations}
                hasLegibilityIssue={hasLegibilityIssue}
                onDimensionScoreChange={(dimensionId, nextScore) => {
                  const nextDimensions = result.dimensionScores.map((dimension) =>
                    dimension.id === dimensionId
                      ? { ...dimension, score: clampDimensionScore(nextScore, dimension.maxScore) }
                      : dimension,
                  )

                  updateGradingResult(essay.id, {
                    dimensionScores: nextDimensions,
                    totalScore: calculateTotalScore(nextDimensions, fullScore, hasLegibilityIssue),
                  })
                  showSaveNotice('分数已更新')
                }}
              />
            ) : null}

            {activeDetailTab === 'issues' ? (
              <IssueCorrectionList
                items={reviewIssueItems}
                activeIssueId={activeIssueId}
                activeIssueLocateStatus={activeIssueLocateStatus}
                onIssueSelect={setActiveIssueId}
                getIssueClassReviewState={getIssueClassReviewState}
                onAddIssue={(issue) => classReview.addIssue(getIssueInput(issue))}
                onRemoveIssue={(issue) => {
                  const evidenceId = findTeacherEvidenceId(issue)
                  if (evidenceId) classReview.removeIssue(task.id, evidenceId)
                }}
                onUndoRemove={() => classReview.undoIssueRemoval(task.id)}
              />
            ) : null}

            {activeDetailTab === 'revision' ? (
              <FullTextRevisionPanel revision={result.fullTextRevision} upgrades={result.upgradedExpressions} />
            ) : null}

            {activeDetailTab === 'feedback' ? (
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
            ) : null}
          </div>
        </div>
        <ReviewActionBar
          label="底部批改操作"
          previousEssayId={previousEssayId}
          nextEssayId={nextEssayId}
          taskId={task.id}
        />
          </>
        )}
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
