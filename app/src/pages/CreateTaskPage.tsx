import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MaterialImageOrganizer, type MaterialImagePage } from '../components/MaterialImageOrganizer'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import { createConfiguredRubricClient } from '../services/taskRubric/rubricClient'
import type { GeneratedTaskRubric } from '../services/taskRubric/types'
import type { RubricDimension, TaskMaterialContext, TaskRubricDraft } from '../types'

type RubricState = 'idle' | 'generating' | 'draft' | 'confirmed'

function hasCompleteWeights(dimensions: RubricDimension[]) {
  if (dimensions.length === 0 || dimensions.some((dimension) => !Number.isFinite(dimension.weight) || dimension.weight <= 0)) {
    return false
  }
  const total = dimensions.reduce((sum, dimension) => sum + dimension.weight, 0)
  const tolerance = 0.001 + Number.EPSILON * Math.max(Math.abs(total), 100)
  return Math.abs(total - 100) <= tolerance
}

function toDimensions(rubric: GeneratedTaskRubric): RubricDimension[] {
  return rubric.dimensions.map(({ id, name, weight, description, deductionFocus, sourceEvidence }) => ({
    id, name, weight, description, deductionFocus, sourceEvidence: [...sourceEvidence],
  }))
}

function toMaterialContext(rubric: GeneratedTaskRubric): TaskMaterialContext {
  return {
    materialSummary: rubric.materialSummary,
    writingRequirements: rubric.writingRequirements,
    constraints: rubric.constraints,
    reviewWarnings: rubric.reviewWarnings,
  }
}

function toRubricDraft(rubric: GeneratedTaskRubric, dimensions: RubricDimension[]): TaskRubricDraft {
  return {
    source: 'ai',
    writingGoal: rubric.materialSummary,
    offTopicCriteria: rubric.constraints,
    dimensions,
    excellentFeatures: rubric.writingRequirements,
    reviewTriggers: rubric.reviewWarnings,
    status: 'confirmed',
  }
}

function newRequestId() {
  return `rubric-${crypto.randomUUID?.() ?? Date.now()}`
}

function isValidFullScore(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 100
}

function generationSignature(pages: MaterialImagePage[], fullScore: number) {
  return JSON.stringify({ fullScore, pageIds: pages.map((page) => page.id) })
}

export function CreateTaskPage() {
  const navigate = useNavigate()
  const { createTask } = useAppState()
  const rubricClient = useMemo(() => createConfiguredRubricClient(), [])
  const [pages, setPages] = useState<MaterialImagePage[]>([])
  const [fullScore, setFullScore] = useState(15)
  const [rubric, setRubric] = useState<GeneratedTaskRubric | null>(null)
  const [dimensions, setDimensions] = useState<RubricDimension[]>([])
  const [generatedFor, setGeneratedFor] = useState<string | null>(null)
  const [rubricState, setRubricState] = useState<RubricState>('idle')
  const [error, setError] = useState('')

  const weightsValid = hasCompleteWeights(dimensions)
  const inputIsCurrent = generatedFor === generationSignature(pages, fullScore)
  const canConfirm = rubricState === 'draft' && Boolean(rubric) && pages.length > 0 && isValidFullScore(fullScore) && weightsValid && inputIsCurrent
  const canCreate = rubricState === 'confirmed' && Boolean(rubric) && pages.length > 0 && isValidFullScore(fullScore) && weightsValid && inputIsCurrent

  const resetConfirmation = () => {
    if (rubricState === 'confirmed') setRubricState('draft')
  }

  const changePages = (nextPages: MaterialImagePage[]) => {
    setPages(nextPages)
    setGeneratedFor(null)
    resetConfirmation()
  }

  const changeFullScore = (value: string) => {
    setFullScore(value === '' ? Number.NaN : Number(value))
    setGeneratedFor(null)
    resetConfirmation()
  }

  const changeDimension = (id: string, patch: Partial<RubricDimension>) => {
    setDimensions((current) => current.map((dimension) => dimension.id === id ? { ...dimension, ...patch } : dimension))
    resetConfirmation()
  }

  const generateRubric = async () => {
    if (pages.length === 0) {
      setError('请先上传至少一张材料图片。')
      return
    }
    if (!isValidFullScore(fullScore)) {
      setError('满分必须是 1 到 100 之间的整数。')
      return
    }
    setError('')
    setRubricState('generating')
    const currentSignature = generationSignature(pages, fullScore)
    let response
    try {
      response = await rubricClient.generate({ requestId: newRequestId(), fullScore, pages })
    } catch {
      setGeneratedFor(null)
      setRubricState(rubric ? 'draft' : 'idle')
      setError('评分标准暂时无法生成，请保留材料后重试。')
      return
    }
    if (response.status === 'failed') {
      setGeneratedFor(null)
      setRubricState(rubric ? 'draft' : 'idle')
      setError('评分标准暂时无法生成，请保留材料后重试。')
      return
    }
    setRubric(response.rubric)
    setDimensions(toDimensions(response.rubric))
    setGeneratedFor(currentSignature)
    setRubricState('draft')
  }

  const createConfirmedTask = () => {
    if (!rubric || !canCreate) return
    const taskId = createTask({
      taskName: rubric.taskName,
      fullScore,
      materialContext: toMaterialContext(rubric),
      rubricDraft: toRubricDraft(rubric, dimensions),
    })
    navigate(`/tasks/${taskId}/upload`)
  }

  return (
    <AppLayout
      title="创建批改任务"
      description="上传原材料，生成并确认本次写作的评分标准后，即可继续上传学生作文。"
    >
      <form
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"
        onSubmit={(event) => {
          event.preventDefault()
          createConfirmedTask()
        }}
      >
        <div className="space-y-5">
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div>
              <h3 className="font-semibold text-slate-950">原材料</h3>
              <p className="mt-1 text-sm leading-6 text-slate-500">上传写作材料图片，可调整页序后生成评分标准。</p>
            </div>
            <div className="mt-4">
              <MaterialImageOrganizer pages={pages} onChange={changePages} disabled={rubricState === 'generating'} />
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <label className="grid max-w-xs gap-2 text-sm font-medium text-slate-700">
              满分
              <input
                aria-label="满分"
                type="number"
                min={1}
                max={100}
                step={1}
                value={Number.isFinite(fullScore) ? fullScore : ''}
                disabled={rubricState === 'generating'}
                onChange={(event) => changeFullScore(event.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
              />
            </label>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5" aria-label="评分标准">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-950">评分标准</h3>
                <p className="mt-1 text-sm leading-6 text-slate-500">由材料生成初稿，教师可编辑百分比权重后明确确认。</p>
              </div>
              <button
                type="button"
                onClick={() => void generateRubric()}
                disabled={rubricState === 'generating'}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {rubricState === 'generating' ? '正在生成评分标准…' : rubric || error ? '重新生成评分标准' : '生成评分标准'}
              </button>
            </div>

            {error ? <p className="mt-4 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p> : null}

            {rubric ? (
              <div className="mt-5 space-y-5">
                <div className="rounded-lg bg-slate-50 p-4">
                  <p className="font-semibold text-slate-900">{rubric.taskName}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{rubric.materialSummary}</p>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">评分维度</h4>
                  <div className="mt-3 grid gap-3">
                    {dimensions.map((dimension) => (
                      <div key={dimension.id} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-[minmax(0,1fr)_96px]">
                        <div className="grid gap-2">
                          <label className="grid gap-1 text-sm font-medium text-slate-700">
                            维度名称
                            <input
                              value={dimension.name}
                              disabled={rubricState === 'generating'}
                              onChange={(event) => changeDimension(dimension.id, { name: event.target.value })}
                              className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                            />
                          </label>
                          <label className="grid gap-1 text-sm font-medium text-slate-700">
                            评分说明
                            <textarea
                              value={dimension.description}
                              disabled={rubricState === 'generating'}
                              onChange={(event) => changeDimension(dimension.id, { description: event.target.value })}
                              className="min-h-16 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                            />
                          </label>
                        </div>
                        <label className="grid content-start gap-1 text-sm font-medium text-slate-700">
                          {`${dimension.name}权重`}
                          <input
                            aria-label={`${dimension.name}权重`}
                            type="number"
                            min={1}
                            max={100}
                            value={Number.isFinite(dimension.weight) ? dimension.weight : ''}
                            disabled={rubricState === 'generating'}
                            onChange={(event) => changeDimension(dimension.id, { weight: Number(event.target.value) })}
                            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                          />
                          <span className="text-xs text-slate-500">%</span>
                        </label>
                      </div>
                    ))}
                  </div>
                  {!weightsValid ? <p className="mt-3 text-sm font-semibold text-rose-700">评分维度权重合计必须为 100%。</p> : null}
                </div>
              </div>
            ) : (
              <p className="mt-5 rounded-lg bg-slate-50 p-4 text-sm leading-6 text-slate-500">上传材料图片并填写满分后，生成本次任务的评分标准。</p>
            )}

            <div className="mt-5 flex flex-wrap justify-between gap-3 border-t border-slate-100 pt-5">
              <button
                type="button"
                onClick={() => setRubricState('confirmed')}
                disabled={!canConfirm}
                className="rounded-lg border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
              >
                确认采用该标准
              </button>
              <button
                type="submit"
                disabled={!canCreate}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                确认并创建任务
              </button>
            </div>
          </section>
        </div>

        <aside className="h-fit rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="font-semibold text-slate-950">确认提示</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">确认前可反复调整材料顺序、满分和评分维度。任一调整都会要求重新确认，但不会清除评分标准草案。</p>
        </aside>
      </form>
    </AppLayout>
  )
}
