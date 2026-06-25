import { Link, useParams } from 'react-router-dom'
import { ClassInsightPanel } from '../components/ClassInsightPanel'
import { EmptyState } from '../components/EmptyState'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import { findClassInsight, findTask } from '../utils/taskLookup'

export function ClassReviewPage() {
  const { taskId = '' } = useParams()
  const { tasks, classInsights } = useAppState()
  const task = findTask(tasks, taskId)
  const insight = findClassInsight(classInsights, taskId)

  if (!task) {
    return <EmptyState title="找不到任务" description="请返回任务列表重新选择一个批改任务。" />
  }

  if (!insight) {
    return (
      <AppLayout task={task} title="班级讲评">
        <EmptyState title="暂无讲评材料" description="该任务尚未生成班级讲评数据。" />
      </AppLayout>
    )
  }

  return (
    <AppLayout
      task={task}
      title="班级共性问题讲评"
      description="适合电脑端或白板横屏展示，不依赖学生姓名。"
    >
      <div className="space-y-6">
        <div className="rounded-lg bg-slate-950 p-6 text-white">
          <p className="text-sm font-medium text-blue-200">{task.className}</p>
          <h3 className="mt-2 text-3xl font-semibold">{task.taskName}</h3>
          <p className="mt-3 max-w-3xl text-lg leading-8 text-slate-200">
            本页用于课堂讲评：先看高频错误，再看典型句，最后用改写练习带学生即时修正。
          </p>
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          <ClassInsightPanel title="高频语法错误" items={insight.grammarErrors} large />
          <ClassInsightPanel title="高频拼写错误" items={insight.spellingErrors} large />
          <ClassInsightPanel title="典型问题句" items={insight.typicalSentences} large />
          <ClassInsightPanel title="可上课改写练习" items={insight.rewriteExercises} large />
        </div>
        <Link to={`/tasks/${task.id}/progress`} className="inline-flex text-sm font-semibold text-blue-700">
          返回批改进度
        </Link>
      </div>
    </AppLayout>
  )
}
