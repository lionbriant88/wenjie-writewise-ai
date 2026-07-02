import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { ClassReviewMaterialsPanel } from '../components/ClassReviewMaterialsPanel'
import { EmptyState } from '../components/EmptyState'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import type { ClassInsightItem } from '../types'
import { getClassOverviewStats } from '../utils/classOverview'
import { findClassInsight, findEssaysByTask, findTask } from '../utils/taskLookup'

type ClassReviewTab = 'overview' | 'materials' | 'issues' | 'exercises'

const classReviewTabs: Array<{ id: ClassReviewTab; label: string }> = [
  { id: 'overview', label: '概览' },
  { id: 'materials', label: '教师精选素材' },
  { id: 'issues', label: '高频问题' },
  { id: 'exercises', label: '改写练习' },
]

function formatScore(score: number | null) {
  return score === null ? '-' : score.toFixed(1)
}

function ClassReviewTabList({
  activeTab,
  onTabChange,
}: {
  activeTab: ClassReviewTab
  onTabChange: (tab: ClassReviewTab) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="班级总览内容"
      className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm"
    >
      {classReviewTabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`tech-focus rounded-md px-4 py-2 text-sm font-semibold transition ${
            activeTab === tab.id
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function CompactInsightGroup({ title, items }: { title: string; items: ClassInsightItem[] }) {
  if (items.length === 0) {
    return null
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-slate-950">{title}</h3>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          {items.length} 项
        </span>
      </div>
      <div className="divide-y divide-slate-100">
        {items.map((item) => (
          <article key={item.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-950">{item.title}</h4>
              {typeof item.count === 'number' ? (
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                  {item.count} 次
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm leading-6 text-slate-600">{item.detail}</p>
            {item.examples.length ? (
              <div className="mt-2 space-y-1">
                {item.examples.map((example) => (
                  <p key={example} className="text-xs leading-5 text-slate-500">
                    例句：{example}
                  </p>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  )
}

function EmptyTabState({ title }: { title: string }) {
  return (
    <section className="rounded-lg border border-dashed border-slate-200 bg-white p-6 text-center shadow-sm">
      <p className="text-sm font-semibold text-slate-700">{title}</p>
    </section>
  )
}

export function ClassReviewPage() {
  const { taskId = '' } = useParams()
  const { tasks, essays, gradingResults, classInsights, classReviewMaterials, removeClassReviewMaterial } = useAppState()
  const [activeTab, setActiveTab] = useState<ClassReviewTab>('overview')
  const task = findTask(tasks, taskId)
  const insight = findClassInsight(classInsights, taskId)
  const taskMaterials = classReviewMaterials.filter((material) => material.taskId === taskId)
  const stats = getClassOverviewStats(findEssaysByTask(essays, taskId), gradingResults)
  const summaryStats = [
    { label: '作文总数', value: stats.totalEssayCount.toString() },
    { label: '平均分', value: formatScore(stats.averageScore) },
    { label: '最高分', value: formatScore(stats.highestScore) },
    { label: '最低分', value: formatScore(stats.lowestScore) },
  ]

  if (!task) {
    return <EmptyState title="找不到任务" description="请返回任务列表重新选择一个批改任务。" />
  }

  if (!insight) {
    return (
      <AppLayout task={task} title="班级总览" currentStep="class-review">
        <EmptyState title="暂无班级总览材料" description="该任务尚未生成班级总览数据。" />
      </AppLayout>
    )
  }

  const hasIssueInsights =
    insight.grammarErrors.length > 0 || insight.spellingErrors.length > 0 || insight.typicalSentences.length > 0

  return (
    <AppLayout
      task={task}
      title="班级总览"
      currentStep="class-review"
      description="先看全班表现，再整理课堂讲评素材。"
    >
      <div className="space-y-5">
        <ClassReviewTabList activeTab={activeTab} onTabChange={setActiveTab} />

        {activeTab === 'overview' ? (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-950">分数分布</h3>
                <p className="mt-1 text-sm text-slate-500">
                  按高考作文档次分段统计，已计入 {stats.scoredEssayCount} 篇有分数作文。
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {summaryStats.map((item) => (
                  <div key={item.label} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-xs font-medium text-slate-500">{item.label}</p>
                    <p className="mt-1 text-lg font-semibold text-slate-950">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {stats.bands.map((band) => (
                <div key={band.label} className="grid grid-cols-[56px_minmax(0,1fr)_64px] items-center gap-3">
                  <span className="text-sm font-semibold text-slate-700">{band.label}</span>
                  <div
                    aria-label={`${band.label} 分数分布：${band.count} 篇`}
                    className="overflow-hidden rounded-full bg-slate-100"
                    style={{ height: '10px' }}
                  >
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-[width] duration-500 ease-out"
                      style={{ width: `${band.percent}%`, height: '100%' }}
                    />
                  </div>
                  <span className="text-right text-sm font-medium text-slate-500">{band.count} 篇</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {activeTab === 'materials' ? (
          <ClassReviewMaterialsPanel
            taskId={task.id}
            materials={taskMaterials}
            onRemoveMaterial={removeClassReviewMaterial}
          />
        ) : null}

        {activeTab === 'issues' ? (
          hasIssueInsights ? (
            <div className="grid gap-4 xl:grid-cols-3">
              <CompactInsightGroup title="高频语法错误" items={insight.grammarErrors} />
              <CompactInsightGroup title="高频拼写错误" items={insight.spellingErrors} />
              <CompactInsightGroup title="典型问题句" items={insight.typicalSentences} />
            </div>
          ) : (
            <EmptyTabState title="当前暂无高频问题。" />
          )
        ) : null}

        {activeTab === 'exercises' ? (
          insight.rewriteExercises.length > 0 ? (
            <CompactInsightGroup title="可上课改写练习" items={insight.rewriteExercises} />
          ) : (
            <EmptyTabState title="当前暂无可上课改写练习。" />
          )
        ) : null}
      </div>
    </AppLayout>
  )
}
