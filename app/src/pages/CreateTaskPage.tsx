import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'

const essayTypes = ['建议信', '邀请信', '申请信', '感谢信', '通知', '演讲稿', '报道', '咨询信', '倡议书', 'For and Against essay']

const dimensions = [
  ['卷面/字迹', '10%'],
  ['内容完成度', '25%'],
  ['语言准确性', '25%'],
  ['表达清晰度', '15%'],
  ['词汇句式', '15%'],
  ['意图表达清晰度', '10%'],
]

export function CreateTaskPage() {
  const navigate = useNavigate()
  const { createTask } = useAppState()
  const [generateClassReview, setGenerateClassReview] = useState(true)

  return (
    <AppLayout
      title="创建批改任务"
      description="第一阶段只保存到前端内存，用于演示从任务创建到作文批改的完整路径。"
    >
      <form
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"
        onSubmit={(event) => {
          event.preventDefault()
          const formData = new FormData(event.currentTarget)
          const taskId = createTask({
            taskName: String(formData.get('taskName') || '新的批改任务'),
            className: String(formData.get('className') || '未命名班级'),
            essayType: String(formData.get('essayType') || '建议信'),
            fullScore: Number(formData.get('fullScore') || 15),
            scoringTemplateId: 'default-15',
            generateClassReview,
          })
          navigate(`/tasks/${taskId}/upload`)
        }}
      >
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium text-slate-700 md:col-span-2">
              任务名称
              <input
                name="taskName"
                required
                defaultValue="九年级建议信课堂训练"
                className="rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              班级名称
              <input
                name="className"
                required
                defaultValue="九年级 2 班"
                className="rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              作文类型
              <select
                name="essayType"
                className="rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                {essayTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              满分
              <input
                name="fullScore"
                type="number"
                min={1}
                defaultValue={15}
                className="rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              评分模板
              <select
                name="template"
                className="rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                <option>默认 15 分制应用文模板</option>
              </select>
            </label>
          </div>

          <label className="mt-5 flex items-center gap-3 rounded-lg bg-blue-50 p-4 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={generateClassReview}
              onChange={(event) => setGenerateClassReview(event.target.checked)}
              className="h-4 w-4"
            />
            自动生成班级讲评材料
          </label>

          <button
            type="submit"
            className="mt-6 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
          >
            保存并进入上传
          </button>
        </div>

        <aside className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="font-semibold text-slate-950">默认评分维度</h3>
          <div className="mt-4 space-y-3">
            {dimensions.map(([name, weight]) => (
              <div key={name} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-sm text-slate-700">{name}</span>
                <span className="text-sm font-semibold text-blue-700">{weight}</span>
              </div>
            ))}
          </div>
        </aside>
      </form>
    </AppLayout>
  )
}
