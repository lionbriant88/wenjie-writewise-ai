import type { ClassReviewAppSnapshot } from '../context/appStateContextValue'

interface ClassReviewGenerationStatusProps {
  snapshot: ClassReviewAppSnapshot
  hasUnsavedAiEdit?: boolean
  onGenerate?: () => void
  onRegenerate?: (trigger?: HTMLElement) => void
  onCheck?: () => void
  onApply?: () => void
  onDiscard?: () => void
}

function statusCopy(snapshot: ClassReviewAppSnapshot): string {
  if (!snapshot.isSettled) return '等待批改队列结束'
  if (snapshot.report.statistics.includedEssayCount < 2) return '至少需要 2 篇成功批改后才能生成。'
  if (!snapshot.sourceReady) return '班级总览数据暂不可用。'
  return '当前暂不能生成班级总结。'
}

function isActiveGeneration(state: string | undefined): boolean {
  return state === 'queued' || state === 'running'
}

export function ClassReviewGenerationStatus({
  snapshot,
  hasUnsavedAiEdit = false,
  onGenerate,
  onRegenerate,
  onCheck,
  onApply,
  onDiscard,
}: ClassReviewGenerationStatusProps) {
  const currentGeneration = snapshot.report.currentGeneration
  const generationState = currentGeneration?.state

  if (generationState === 'succeeded_unapplied') {
    return (
      <section className="rounded-lg border border-amber-200 bg-amber-50 p-4" aria-live="polite">
        <p className="text-sm font-semibold text-amber-900">有一版新班级总结待应用</p>
        <p className="mt-1 text-sm text-amber-800">
          这版结果已经生成，但还没有覆盖当前 AI 总评；应用或丢弃都不会产生新的 AI 调用。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onApply}
            className="tech-focus min-h-11 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            应用新班级总结
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="tech-focus min-h-11 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
          >
            丢弃新版本
          </button>
        </div>
      </section>
    )
  }

  if (isActiveGeneration(generationState)) {
    return (
      <section className="rounded-lg border border-blue-200 bg-blue-50 p-4" aria-live="polite">
        <p className="text-sm font-semibold text-blue-900">正在生成班级总结</p>
        <p className="mt-1 text-sm text-blue-700">系统正在处理本次班级级综合，请稍候查看结果。</p>
      </section>
    )
  }

  if (generationState === 'result_unknown') {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4" aria-live="polite">
        <p className="text-sm font-semibold text-slate-900">班级总结结果状态未确认</p>
        <p className="mt-1 text-sm text-slate-500">先检查这次生成的结算结果，确认前不会发起新的生成。</p>
        <button
          type="button"
          onClick={onCheck}
          className="tech-focus mt-3 min-h-11 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50"
        >
          检查结果
        </button>
      </section>
    )
  }

  if (snapshot.report.workspaceState === 'ai_available') {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" aria-live="polite">
        <p className="text-sm font-semibold text-slate-900">班级总结已生成</p>
        <p className="mt-1 text-sm text-slate-500">重新生成会消耗 1 次新的 AI 调用。</p>
        <button
          type="button"
          disabled={hasUnsavedAiEdit || !snapshot.canGenerate}
          onClick={(event) => onRegenerate?.(event.currentTarget)}
          className="tech-focus mt-3 min-h-11 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:bg-white"
        >
          重新生成
        </button>
        {hasUnsavedAiEdit ? (
          <p className="mt-2 text-sm font-medium text-amber-700">请先保存或取消正在编辑的 AI 总评。</p>
        ) : null}
      </section>
    )
  }

  if (snapshot.canGenerate) {
    return (
      <section className="rounded-lg border border-blue-200 bg-blue-50 p-4" aria-live="polite">
        <p className="text-sm font-semibold text-blue-900">已满足生成条件</p>
        <p className="mt-1 text-sm text-blue-700">点击后会基于当前成功作文的去身份化统计生成班级总结。</p>
        <button
          type="button"
          onClick={onGenerate}
          className="tech-focus mt-3 min-h-11 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          生成班级总结
        </button>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4" aria-live="polite">
      <p className="text-sm font-semibold text-slate-900">{statusCopy(snapshot)}</p>
      <p className="mt-1 text-sm text-slate-500">
        满足队列结束且至少 2 篇成功批改后，才会开放班级总结生成。
      </p>
    </section>
  )
}
