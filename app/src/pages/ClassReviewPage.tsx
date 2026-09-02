import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ClassReviewGenerationStatus } from '../components/ClassReviewGenerationStatus'
import { ClassReviewIssueList } from '../components/ClassReviewIssueList'
import { ClassReviewMaterialsPanel } from '../components/ClassReviewMaterialsPanel'
import { ClassReviewReportPanel } from '../components/ClassReviewReportPanel'
import { ClassReviewSpellingList } from '../components/ClassReviewSpellingList'
import { EmptyState } from '../components/EmptyState'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import type { AiSummaryV1, ClassReviewStatisticsV1 } from '../services/classReview/types'
import { findTask } from '../utils/taskLookup'

function formatScore(score: number | null) {
  return score === null ? '-' : score.toFixed(1)
}

function CurrentStatisticsPanel({ statistics }: { statistics: ClassReviewStatisticsV1 }) {
  const summary = statistics.scoreSummary
  const cards = [
    { label: '作文总数', value: statistics.totalEssayCount.toString() },
    { label: '纳入统计', value: statistics.includedEssayCount.toString() },
    { label: '平均分', value: formatScore(summary?.averageScore ?? null) },
    { label: '最高分', value: formatScore(summary?.highestScore ?? null) },
    { label: '最低分', value: formatScore(summary?.lowestScore ?? null) },
  ]

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-950">当前统计</h3>
          <p className="mt-1 text-sm text-slate-500">
            成绩通道纳入 {statistics.includedEssayCount} 篇；问题通道 {statistics.issueEligibleEssayCount} /{' '}
            {statistics.includedEssayCount}。
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          覆盖率 {Math.round(statistics.issueCoverageRate * 100)}%
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        {cards.map((item) => (
          <div key={item.label} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs font-medium text-slate-500">{item.label}</p>
            <p className="mt-1 text-lg font-semibold text-slate-950">{item.value}</p>
          </div>
        ))}
      </div>
      {statistics.dimensions.length > 0 ? (
        <div className="mt-4 grid gap-2 md:grid-cols-3">
          {statistics.dimensions.map((dimension) => (
            <div key={dimension.dimensionId} className="rounded-lg border border-slate-100 bg-white px-3 py-2">
              <p className="text-xs font-semibold text-slate-500">{dimension.name}</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">
                {formatScore(dimension.averageScore)} / {formatScore(dimension.maxScore)}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

export function ClassReviewPage() {
  const { taskId = '' } = useParams()
  const { tasks, classReviewMaterials, removeClassReviewMaterial, classReview } = useAppState()
  const [aiDraft, setAiDraft] = useState<AiSummaryV1 | null>(null)
  const [generationNotice, setGenerationNotice] = useState('')
  const [optimisticGenerating, setOptimisticGenerating] = useState(false)
  const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false)
  const regenerateTriggerRef = useRef<HTMLElement | null>(null)
  const confirmRegenerateRef = useRef<HTMLButtonElement | null>(null)
  const task = findTask(tasks, taskId)
  const taskMaterials = classReviewMaterials.filter((material) => material.taskId === taskId)

  useEffect(() => {
    if (!regenerateDialogOpen) return undefined
    const timer = window.setTimeout(() => confirmRegenerateRef.current?.focus(), 0)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setRegenerateDialogOpen(false)
      regenerateTriggerRef.current?.focus()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [regenerateDialogOpen])

  if (!task) {
    return <EmptyState title="找不到任务" description="请返回任务列表重新选择一个批改任务。" />
  }

  const baseSnapshot = classReview.getSnapshot(task.id)
  const snapshot = optimisticGenerating && baseSnapshot.report.currentGeneration === null
    ? {
        ...baseSnapshot,
        canGenerate: false,
        report: {
          ...baseSnapshot.report,
          currentGeneration: {
            generationId: 'local.optimistic-generation',
            generationRevision: 0,
            state: 'running' as const,
            createdAt: new Date(0).toISOString(),
          },
        },
      }
    : baseSnapshot
  const report = snapshot.report
  const generationState = report.currentGeneration?.state
  const editLocked = generationState === 'queued' || generationState === 'running' || generationState === 'result_unknown'
  const promotedSpellingIds = new Set(
    report.issueBlocks.flatMap((block) =>
      block.evidenceRefs.flatMap((ref) =>
        ref.selectionOrigin === 'teacher_selected' && ref.sourceLocator.startsWith('spelling.')
          ? [ref.sourceLocator.slice('spelling.'.length)]
          : [],
      ),
    ),
  )

  const generate = (intent: 'initial' | 'regenerate') => {
    setGenerationNotice('')
    setOptimisticGenerating(true)
    void classReview.generate(task.id, intent).catch(() => {
      setGenerationNotice('班级总结生成失败，请稍后重试。')
    }).finally(() => {
      setOptimisticGenerating(false)
    })
  }

  const closeRegenerateDialog = () => {
    setRegenerateDialogOpen(false)
    regenerateTriggerRef.current?.focus()
  }

  return (
    <AppLayout
      task={task}
      title="班级总览"
      currentStep="class-review"
      description="先看当前统计，再把 AI 总评、共性问题、明确拼写和精选素材整理成课堂讲评方案。"
    >
      <div className="space-y-5">
        <CurrentStatisticsPanel statistics={report.statistics} />
        <ClassReviewGenerationStatus
          snapshot={snapshot}
          hasUnsavedAiEdit={aiDraft !== null}
          onGenerate={() => generate('initial')}
          onRegenerate={(trigger) => {
            regenerateTriggerRef.current = trigger ?? null
            setRegenerateDialogOpen(true)
          }}
          onCheck={() => {
            classReview.checkGeneration(task.id)
            setGenerationNotice('已检查当前班级总结生成状态。')
          }}
          onApply={() => classReview.applyCandidate(task.id)}
          onDiscard={() => classReview.discardCandidate(task.id)}
        />
        {generationNotice ? (
          <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600" aria-live="polite">
            {generationNotice}
          </p>
        ) : null}
        <ClassReviewReportPanel
          report={report}
          editDraft={aiDraft}
          editLocked={editLocked}
          onBeginEdit={() => {
            if (report.workspaceState !== 'ai_available') return
            classReview.beginAiTextEdit(task.id)
            setAiDraft(report.aiSummary)
          }}
          onDraftChange={setAiDraft}
          onSave={(summary) => {
            classReview.saveAiTextEdit(task.id, summary)
            setAiDraft(null)
          }}
          onCancel={() => {
            classReview.cancelAiTextEdit(task.id)
            setAiDraft(null)
          }}
        />
        <ClassReviewIssueList
          issueBlocks={report.issueBlocks}
          issueOrder={report.issueOrder}
          onMoveIssue={(blockId, toIndex) => classReview.moveIssue(task.id, blockId, toIndex)}
          onRemoveTeacherEvidence={(evidenceId) => classReview.removeIssue(task.id, evidenceId)}
          onUndoRemove={() => classReview.undoIssueRemoval(task.id)}
        />
        <ClassReviewSpellingList
          items={report.clearSpellingItems}
          promotedItemIds={promotedSpellingIds}
          onPromote={(itemId) => classReview.promoteSpelling(task.id, itemId)}
        />
        <ClassReviewMaterialsPanel
          taskId={task.id}
          materials={taskMaterials}
          onRemoveMaterial={removeClassReviewMaterial}
        />

        {regenerateDialogOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="class-review-regenerate-title"
              className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
            >
              <h3 id="class-review-regenerate-title" className="text-base font-semibold text-slate-950">
                确认重新生成班级总结
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                这会消耗 1 次新的 AI 调用，并用新 AI 总评替换当前 AI 文本。
              </p>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={closeRegenerateDialog}
                  className="tech-focus min-h-11 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50"
                >
                  取消
                </button>
                <button
                  ref={confirmRegenerateRef}
                  type="button"
                  onClick={() => {
                    setRegenerateDialogOpen(false)
                    generate('regenerate')
                  }}
                  className="tech-focus min-h-11 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  确认重新生成
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </AppLayout>
  )
}
