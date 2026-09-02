import { useEffect, useState } from 'react'
import type { AiSummaryV1, ClassReviewReportV1 } from '../services/classReview/types'

interface ClassReviewReportPanelProps {
  report: ClassReviewReportV1
  editDraft?: AiSummaryV1 | null
  editLocked?: boolean
  onBeginEdit?: () => void
  onDraftChange?: (draft: AiSummaryV1) => void
  onSave?: (draft: AiSummaryV1) => void
  onCancel?: () => void
}

function cloneSummary(summary: AiSummaryV1): AiSummaryV1 {
  return {
    overallComment: summary.overallComment,
    strengths: summary.strengths.map((item) => ({
      title: item.title,
      detail: item.detail,
      dimensionIds: [...item.dimensionIds],
    })),
    learningRecommendations: summary.learningRecommendations.map((item) => ({
      title: item.title,
      action: item.action,
    })),
  }
}

export function ClassReviewReportPanel({
  report,
  editDraft = null,
  editLocked = false,
  onBeginEdit,
  onDraftChange,
  onSave,
  onCancel,
}: ClassReviewReportPanelProps) {
  const [localDraft, setLocalDraft] = useState<AiSummaryV1 | null>(() =>
    editDraft ? cloneSummary(editDraft) : null,
  )
  const isEditing = editDraft !== null && report.workspaceState === 'ai_available'

  useEffect(() => {
    setLocalDraft(editDraft ? cloneSummary(editDraft) : null)
  }, [editDraft])

  const updateDraft = (nextDraft: AiSummaryV1) => {
    setLocalDraft(nextDraft)
    onDraftChange?.(nextDraft)
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-950">AI 班级总体评价</h3>
          {report.workspaceState === 'ai_available' ? (
            <p className="mt-1 text-sm text-slate-500">
              AI 生成时纳入 {report.snapshotMetadata.includedEssayCount} 篇；问题通道{' '}
              {report.snapshotMetadata.issueEligibleEssayCount} / {report.snapshotMetadata.includedEssayCount}
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-500">生成后可在这里统一编辑总体评价、主要优点和学习建议。</p>
          )}
        </div>
        {report.workspaceState === 'ai_available' && !isEditing ? (
          <button
            type="button"
            disabled={editLocked}
            onClick={onBeginEdit}
            className="tech-focus min-h-11 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:bg-white"
          >
            编辑
          </button>
        ) : null}
      </div>

      {editLocked && report.workspaceState === 'ai_available' && !isEditing ? (
        <p className="mt-2 text-sm font-medium text-amber-700">生成过程中暂不能编辑 AI 总评。</p>
      ) : null}

      {report.workspaceState !== 'ai_available' ? (
        <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
          <p className="text-sm font-semibold text-slate-600">尚未生成 AI 班级总结。</p>
        </div>
      ) : isEditing && localDraft ? (
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">班级总体评价</span>
            <textarea
              value={localDraft.overallComment}
              onChange={(event) => updateDraft({ ...localDraft, overallComment: event.target.value })}
              className="tech-focus mt-2 min-h-28 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6 text-slate-800"
            />
          </label>
          {localDraft.strengths.map((strength, index) => (
            <label key={`${strength.title}-${index}`} className="block">
              <span className="text-sm font-semibold text-slate-700">主要优点 {index + 1}</span>
              <textarea
                value={strength.detail}
                onChange={(event) => {
                  const strengths = localDraft.strengths.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, detail: event.target.value } : item,
                  )
                  updateDraft({ ...localDraft, strengths })
                }}
                className="tech-focus mt-2 min-h-20 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6 text-slate-800"
              />
            </label>
          ))}
          {localDraft.learningRecommendations.map((recommendation, index) => (
            <label key={`${recommendation.title}-${index}`} className="block">
              <span className="text-sm font-semibold text-slate-700">学习建议 {index + 1}</span>
              <textarea
                value={recommendation.action}
                onChange={(event) => {
                  const learningRecommendations = localDraft.learningRecommendations.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, action: event.target.value } : item,
                  )
                  updateDraft({ ...localDraft, learningRecommendations })
                }}
                className="tech-focus mt-2 min-h-20 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6 text-slate-800"
              />
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => localDraft && onSave?.(cloneSummary(localDraft))}
              className="tech-focus min-h-11 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              保存
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="tech-focus min-h-11 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
            {report.aiSummary.overallComment}
          </p>
          {report.aiSummary.strengths.length > 0 ? (
            <div>
              <h4 className="text-sm font-semibold text-slate-900">主要优点</h4>
              <div className="mt-2 grid gap-2">
                {report.aiSummary.strengths.map((strength) => (
                  <article key={strength.title} className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                    <p className="text-sm font-semibold text-emerald-900">{strength.title}</p>
                    <p className="mt-1 text-sm leading-6 text-emerald-800">{strength.detail}</p>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
          {report.aiSummary.learningRecommendations.length > 0 ? (
            <div>
              <h4 className="text-sm font-semibold text-slate-900">学习建议</h4>
              <div className="mt-2 grid gap-2">
                {report.aiSummary.learningRecommendations.map((recommendation) => (
                  <article key={recommendation.title} className="rounded-lg border border-blue-100 bg-blue-50 p-3">
                    <p className="text-sm font-semibold text-blue-900">{recommendation.title}</p>
                    <p className="mt-1 text-sm leading-6 text-blue-800">{recommendation.action}</p>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
