import { useState } from 'react'
import { Check } from 'lucide-react'
import type { FullTextChangeType, FullTextRevision, UpgradedExpression } from '../types'

interface FullTextRevisionPanelProps {
  revision?: FullTextRevision
  upgrades: UpgradedExpression[]
}

type RevisionTab = 'corrected' | 'polished' | 'comparison'

const tabLabels: Record<RevisionTab, string> = {
  corrected: '纠错版',
  polished: '提升版',
  comparison: '逐句对照',
}

const changeTypeLabel: Record<FullTextChangeType, string> = {
  grammar: '语法纠错',
  spelling: '拼写纠错',
  word_choice: '词汇搭配',
  sentence_upgrade: '句式提升',
  coherence: '逻辑衔接',
  logic_bridge: '补充衔接',
  delete_suggestion: '建议删除',
  replace_sentence: '建议替换',
  reference_clarification: '指代明确',
}

export function FullTextRevisionPanel({ revision, upgrades }: FullTextRevisionPanelProps) {
  const [activeTab, setActiveTab] = useState<RevisionTab>('polished')
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())

  const markAdded = (id: string) => {
    setAddedIds((current) => new Set(current).add(id))
  }

  if (!revision) {
    return (
      <section
        aria-labelledby="full-text-revision-heading"
        className="rounded-lg border border-slate-200 bg-white p-4"
      >
        <h3 id="full-text-revision-heading" className="font-semibold text-slate-950">
          全文优化稿
        </h3>
        <p className="mt-2 text-sm text-slate-500">暂无全文优化稿</p>
      </section>
    )
  }

  return (
    <section
      aria-labelledby="full-text-revision-heading"
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <div>
        <h3 id="full-text-revision-heading" className="font-semibold text-slate-950">
          全文优化稿
        </h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          保留学生原文思路，只纠正语言错误、优化表达，并在必要时提示逻辑衔接问题。
        </p>
      </div>

      <div className="mt-4 inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
        {(Object.keys(tabLabels) as RevisionTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            aria-pressed={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`tech-focus rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              activeTab === tab ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {tabLabels[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'corrected' ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="whitespace-pre-wrap text-sm leading-7 text-slate-800">{revision.correctedText}</p>
        </div>
      ) : null}

      {activeTab === 'polished' ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="whitespace-pre-wrap text-sm leading-7 text-slate-800">{revision.polishedText}</p>
        </div>
      ) : null}

      {activeTab === 'comparison' ? (
        <div className="mt-4 space-y-3">
          {revision.sentencePairs.map((pair) => (
            <div key={pair.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap gap-2">
                {pair.changeTypes.map((type) => (
                  <span key={type} className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-blue-700">
                    {changeTypeLabel[type]}
                  </span>
                ))}
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    pair.preservesOriginalIntent ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  是否保留原意：{pair.preservesOriginalIntent ? '是' : '需复核'}
                </span>
                {pair.needsTeacherReview ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                    建议教师复核
                  </span>
                ) : null}
              </div>
              <dl className="mt-3 grid gap-2 text-sm">
                <div className="grid gap-1 md:grid-cols-[72px_minmax(0,1fr)]">
                  <dt className="text-xs font-semibold text-slate-500">原句</dt>
                  <dd className="text-slate-600">{pair.original}</dd>
                </div>
                <div className="grid gap-1 md:grid-cols-[72px_minmax(0,1fr)]">
                  <dt className="text-xs font-semibold text-slate-500">纠错版</dt>
                  <dd className="text-slate-800">{pair.corrected}</dd>
                </div>
                <div className="grid gap-1 md:grid-cols-[72px_minmax(0,1fr)]">
                  <dt className="text-xs font-semibold text-slate-500">提升版</dt>
                  <dd className="font-medium text-slate-950">{pair.polished}</dd>
                </div>
                <div className="grid gap-1 md:grid-cols-[72px_minmax(0,1fr)]">
                  <dt className="text-xs font-semibold text-slate-500">说明</dt>
                  <dd className="text-xs leading-5 text-slate-500">{pair.explanation}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/60 p-3">
        <h4 className="text-sm font-semibold text-slate-950">逻辑优化说明</h4>
        <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-600">
          {revision.logicNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>

      {upgrades.length > 0 ? (
        <section aria-labelledby="revision-upgrade-heading" className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
          <h4 id="revision-upgrade-heading" className="text-sm font-semibold text-slate-950">
            本文重点提升点
          </h4>
          <div className="mt-2 grid gap-2 lg:grid-cols-2">
            {upgrades.map((upgrade) => {
              const isAdded = addedIds.has(upgrade.id)

              return (
                <div key={upgrade.id} className="rounded-md bg-white p-2 text-xs leading-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-semibold text-slate-600">{upgrade.original}</p>
                    <button
                      type="button"
                      onClick={() => markAdded(upgrade.id)}
                      className={`tech-focus inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                        isAdded
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-emerald-200 bg-white text-slate-700 hover:bg-emerald-100'
                      }`}
                    >
                      {isAdded ? <Check className="h-3.5 w-3.5" /> : null}
                      {isAdded ? '已加入班级总览' : '加入班级总览'}
                    </button>
                  </div>
                  <p className="mt-1 font-medium text-slate-950">{upgrade.upgraded}</p>
                  <p className="mt-1 text-slate-500">{upgrade.note}</p>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}
    </section>
  )
}
