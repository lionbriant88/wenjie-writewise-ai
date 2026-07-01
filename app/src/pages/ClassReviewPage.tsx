import { useParams } from 'react-router-dom'
import { ClassInsightPanel } from '../components/ClassInsightPanel'
import { ClassReviewMaterialsPanel } from '../components/ClassReviewMaterialsPanel'
import { EmptyState } from '../components/EmptyState'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import { getClassOverviewStats } from '../utils/classOverview'
import { findClassInsight, findEssaysByTask, findTask } from '../utils/taskLookup'

function formatScore(score: number | null) {
  return score === null ? '-' : score.toFixed(1)
}

export function ClassReviewPage() {
  const { taskId = '' } = useParams()
  const { tasks, essays, gradingResults, classInsights, classReviewMaterials, removeClassReviewMaterial } = useAppState()
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

  return (
    <AppLayout
      task={task}
      title="班级总览"
      currentStep="class-review"
      description="先看全班分数结构，再看高频问题和课堂讲评素材。"
    >
      <div className="space-y-6">
        <div className="rounded-lg border border-slate-800 bg-slate-950 p-6 text-white shadow-[0_16px_40px_rgba(15,23,42,0.18)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-cyan-200">{task.className}</p>
              <h3 className="mt-2 text-3xl font-semibold">{task.taskName}</h3>
            </div>
          </div>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-200">
            先看全班分数结构，再看高频问题和课堂讲评素材。
          </p>
        </div>
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
        <ClassReviewMaterialsPanel
          taskId={task.id}
          materials={taskMaterials}
          onRemoveMaterial={removeClassReviewMaterial}
        />
        <div className="grid gap-5 xl:grid-cols-2">
          <ClassInsightPanel title="高频语法错误" items={insight.grammarErrors} large />
          <ClassInsightPanel title="高频拼写错误" items={insight.spellingErrors} large />
          <ClassInsightPanel title="典型问题句" items={insight.typicalSentences} large />
          <ClassInsightPanel title="可上课改写练习" items={insight.rewriteExercises} large />
        </div>
      </div>
    </AppLayout>
  )
}
