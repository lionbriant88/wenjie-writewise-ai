import { useEffect, useMemo, useRef, useState } from 'react'
import type { ClassReviewIssueBlockV1, EvidenceRefV1 } from '../services/classReview/types'

interface ClassReviewIssueListProps {
  issueBlocks: ClassReviewIssueBlockV1[]
  issueOrder: string[]
  onMoveIssue?: (blockId: string, toIndex: number) => void
  onRemoveTeacherEvidence?: (evidenceId: string) => void
  onUndoRemove?: () => void
}

function orderedIssueBlocks(
  issueBlocks: readonly ClassReviewIssueBlockV1[],
  issueOrder: readonly string[],
): ClassReviewIssueBlockV1[] {
  const byId = new Map(issueBlocks.map((block) => [block.blockId, block]))
  const ordered = issueOrder.flatMap((blockId) => {
    const block = byId.get(blockId)
    if (!block) return []
    byId.delete(blockId)
    return [block]
  })
  return [...ordered, ...issueBlocks.filter((block) => byId.has(block.blockId))]
}

function teacherEvidence(block: ClassReviewIssueBlockV1): EvidenceRefV1 | null {
  return block.evidenceRefs.find((ref) => ref.selectionOrigin === 'teacher_selected') ?? null
}

export function ClassReviewIssueList({
  issueBlocks,
  issueOrder,
  onMoveIssue,
  onRemoveTeacherEvidence,
  onUndoRemove,
}: ClassReviewIssueListProps) {
  const [undoTitle, setUndoTitle] = useState<string | null>(null)
  const [liveMessage, setLiveMessage] = useState('')
  const undoButtonRef = useRef<HTMLButtonElement | null>(null)
  const orderedBlocks = useMemo(() => orderedIssueBlocks(issueBlocks, issueOrder), [issueBlocks, issueOrder])

  useEffect(() => {
    if (undoTitle) undoButtonRef.current?.focus()
  }, [undoTitle])

  return (
    <section
      role="region"
      aria-label="共性问题与讲评建议"
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-950">共性问题与讲评建议</h3>
          <p className="mt-1 text-sm text-slate-500">系统归纳和教师手动加入的问题在这里按课堂讲评顺序展示。</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          {orderedBlocks.length} 项
        </span>
      </div>

      <div className="sr-only" aria-live="polite">{liveMessage}</div>
      {undoTitle ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-900">已移出「{undoTitle}」的一条手动来源。</p>
          <button
            ref={undoButtonRef}
            type="button"
            onClick={() => {
              onUndoRemove?.()
              setLiveMessage(`已撤销移出 ${undoTitle}`)
              setUndoTitle(null)
            }}
            className="tech-focus min-h-11 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
          >
            撤销移出
          </button>
        </div>
      ) : null}

      {orderedBlocks.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
          <p className="text-sm font-semibold text-slate-600">暂无共性问题。</p>
          <p className="mt-1 text-sm text-slate-500">可先生成班级总结，或从单篇作文、明确拼写清单中加入重点问题。</p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          {orderedBlocks.map((block, index) => {
            const removableTeacherEvidence = teacherEvidence(block)
            return (
              <article key={block.blockId} className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-950">{block.title}</h4>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {block.systemStudentCount > 0 && block.supportDenominator !== null ? (
                        <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800">
                          系统支持 {block.systemStudentCount} / {block.supportDenominator}
                        </span>
                      ) : null}
                      {block.teacherStudentCount > 0 ? (
                        <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-800">
                          教师添加 {block.teacherStudentCount}
                        </span>
                      ) : null}
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                        出现 {block.occurrenceCount} 次
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={index === 0}
                      aria-label={`上移：${block.title}`}
                      onClick={() => {
                        onMoveIssue?.(block.blockId, index - 1)
                        setLiveMessage(`已上移 ${block.title}`)
                      }}
                      className="tech-focus min-h-11 min-w-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={index === orderedBlocks.length - 1}
                      aria-label={`下移：${block.title}`}
                      onClick={() => {
                        onMoveIssue?.(block.blockId, index + 1)
                        setLiveMessage(`已下移 ${block.title}`)
                      }}
                      className="tech-focus min-h-11 min-w-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ↓
                    </button>
                  </div>
                </div>
                <dl className="mt-3 grid gap-2 text-sm">
                  <div className="grid gap-1 md:grid-cols-[84px_minmax(0,1fr)]">
                    <dt className="text-xs font-semibold text-slate-500">诊断</dt>
                    <dd className="text-slate-700">{block.diagnosis}</dd>
                  </div>
                  <div className="grid gap-1 md:grid-cols-[84px_minmax(0,1fr)]">
                    <dt className="text-xs font-semibold text-slate-500">建议</dt>
                    <dd className="text-slate-700">{block.teachingAction}</dd>
                  </div>
                </dl>
                {block.anonymousExamples.length > 0 ? (
                  <div className="mt-3 space-y-1">
                    {block.anonymousExamples.slice(0, 3).map((example) => (
                      <p key={example} className="text-xs leading-5 text-slate-500">{example}</p>
                    ))}
                  </div>
                ) : null}
                {removableTeacherEvidence ? (
                  <button
                    type="button"
                    onClick={() => {
                      onRemoveTeacherEvidence?.(removableTeacherEvidence.evidenceId)
                      setUndoTitle(block.title)
                      setLiveMessage(`已移出 ${block.title} 的一条手动来源`)
                    }}
                    className="tech-focus mt-4 min-h-11 rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                  >
                    移出手动添加
                  </button>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
