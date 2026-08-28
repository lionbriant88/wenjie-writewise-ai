import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { TaskMaterialOrganizer } from '../components/TaskMaterialOrganizer'
import { TaskRubricEditor } from '../components/TaskRubricEditor'
import { useAppState } from '../context/useAppState'
import { useTaskMaterials } from '../hooks/useTaskMaterials'
import { AppLayout } from '../layout/AppLayout'
import {
  createConfiguredMaterialContextClient,
} from '../services/taskMaterial/materialClient'
import type { MaterialUnit, TaskMaterialRequestUnit } from '../services/taskMaterial/types'
import { buildTaskCreationInput } from '../services/taskRubric/buildTaskCreationInput'
import {
  createDefaultRubricDimensions,
  DEFAULT_TASK_NAME,
  validateRubricForm,
} from '../services/taskRubric/rubricForm'
import { createConfiguredRubricClient } from '../services/taskRubric/rubricClient'
import type { GeneratedTaskRubric } from '../services/taskRubric/types'
import type {
  RubricDimension,
  TaskMaterialContext,
  TaskMaterialProcessingStatus,
} from '../types'

type AiAssistState =
  | { status: 'idle' }
  | {
      status: 'generating'
      requestId: string
      snapshot: string
      controller: AbortController
    }
  | { status: 'failed'; message: string }

type MaterialContextState =
  | { status: 'none' }
  | { status: 'stale' }
  | { status: 'analyzing'; signature: string }
  | { status: 'ready'; signature: string; value: TaskMaterialContext }
  | { status: 'failed'; signature: string; message: string }

type GeneratingAiState = Extract<AiAssistState, { status: 'generating' }>

const MATERIAL_STALE_NOTICE = '材料已变化；当前评分标准仍可使用，如需让 AI 重新参考材料，可再次生成。'

function newRequestId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

function materialSignature(units: readonly MaterialUnit[]): string {
  return JSON.stringify(units.map((unit) => unit.kind === 'image'
    ? [
        unit.id,
        unit.kind,
        unit.sourceKind,
        unit.displayName,
        unit.pageNumber ?? null,
        unit.file.name,
        unit.file.type,
        unit.file.size,
        unit.file.lastModified,
      ]
    : [unit.id, unit.kind, unit.sourceKind, unit.displayName, unit.text]))
}

function materialFreshnessIdentity(
  units: readonly MaterialUnit[],
  mutationVersion: number,
): string {
  return JSON.stringify({ mutationVersion, units: materialSignature(units) })
}

function requestSnapshot(signature: string, fullScore: number, writingRequirement: string): string {
  return JSON.stringify({ signature, fullScore, writingRequirement })
}

function toRequestUnits(units: readonly MaterialUnit[]): TaskMaterialRequestUnit[] {
  return units.map((unit) => unit.kind === 'image'
    ? { id: unit.id, kind: 'image', file: unit.file }
    : { id: unit.id, kind: 'text', displayName: unit.displayName, text: unit.text })
}

function toVisibleAiDimensions(rubric: GeneratedTaskRubric): RubricDimension[] {
  return rubric.dimensions.map((dimension) => {
    const focus = dimension.deductionFocus
      .map((item) => item.trim())
      .filter(Boolean)
    return {
      id: dimension.id,
      name: dimension.name,
      weight: dimension.weight,
      description: focus.length
        ? `${dimension.description.trim()}\n扣分关注：${focus.join('；')}`
        : dimension.description.trim(),
      deductionFocus: [],
      sourceEvidence: [],
    }
  })
}

function toMaterialContext(rubric: GeneratedTaskRubric): TaskMaterialContext {
  return {
    materialSummary: rubric.materialSummary,
    writingRequirements: [...rubric.writingRequirements],
    constraints: [...rubric.constraints],
    reviewWarnings: [...rubric.reviewWarnings],
  }
}

export function CreateTaskPage() {
  const navigate = useNavigate()
  const { createTask } = useAppState()
  const materials = useTaskMaterials()
  const rubricClient = useMemo(() => createConfiguredRubricClient(), [])
  const materialContextClient = useMemo(() => createConfiguredMaterialContextClient(), [])
  const [taskName, setTaskName] = useState(DEFAULT_TASK_NAME)
  const [fullScore, setFullScore] = useState(15)
  const [writingRequirement, setWritingRequirement] = useState('')
  const [dimensions, setDimensions] = useState<RubricDimension[]>(createDefaultRubricDimensions)
  const [rubricSource, setRubricSource] = useState<'teacher' | 'ai'>('teacher')
  const [aiState, setAiState] = useState<AiAssistState>({ status: 'idle' })
  const [materialContextState, setMaterialContextState] = useState<MaterialContextState>({ status: 'none' })
  const [materialMutationVersion, setMaterialMutationVersion] = useState(0)
  const [showMaterialStaleNotice, setShowMaterialStaleNotice] = useState(false)
  const [submitWarning, setSubmitWarning] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const mountedRef = useRef(true)
  const activeAiRef = useRef<GeneratingAiState | null>(null)
  const materialContextStateRef = useRef<MaterialContextState>(materialContextState)
  const contextControllerRef = useRef<AbortController | null>(null)
  const latestUnitsRef = useRef<readonly MaterialUnit[]>(materials.units)
  const materialMutationVersionRef = useRef(0)
  const rubricSourceRef = useRef(rubricSource)

  latestUnitsRef.current = materials.units
  rubricSourceRef.current = rubricSource
  const currentMaterialSignature = materialFreshnessIdentity(
    materials.units,
    materialMutationVersion,
  )
  const currentRequestSnapshot = requestSnapshot(currentMaterialSignature, fullScore, writingRequirement)
  const latestRequestSnapshotRef = useRef(currentRequestSnapshot)
  latestRequestSnapshotRef.current = currentRequestSnapshot

  const rubricValidity = validateRubricForm({ fullScore, writingRequirement, dimensions })
  const canCreate = rubricValidity.valid && !submitting
  const canRequestAi = materials.units.length > 0 && !materials.isNormalizing

  const replaceMaterialContextState = (next: MaterialContextState) => {
    materialContextStateRef.current = next
    if (mountedRef.current) setMaterialContextState(next)
  }

  const abortAi = () => {
    const active = activeAiRef.current
    if (!active) return
    activeAiRef.current = null
    active.controller.abort()
    if (mountedRef.current) setAiState({ status: 'idle' })
  }

  const registerMaterialMutation = () => {
    const nextVersion = materialMutationVersionRef.current + 1
    materialMutationVersionRef.current = nextVersion
    setMaterialMutationVersion(nextVersion)
    latestRequestSnapshotRef.current = requestSnapshot(
      materialFreshnessIdentity(latestUnitsRef.current, nextVersion),
      fullScore,
      writingRequirement,
    )
    abortAi()
    replaceMaterialContextState({ status: 'stale' })
    if (rubricSourceRef.current === 'ai') setShowMaterialStaleNotice(true)
  }

  useEffect(() => {
    const active = activeAiRef.current
    if (active && active.snapshot !== currentRequestSnapshot) abortAi()

    const cached = materialContextStateRef.current
    if (
      (cached.status === 'ready' || cached.status === 'failed')
      && cached.signature !== currentRequestSnapshot
    ) {
      replaceMaterialContextState({ status: 'stale' })
    }
  }, [currentRequestSnapshot])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const active = activeAiRef.current
      activeAiRef.current = null
      active?.controller.abort()
      contextControllerRef.current?.abort()
      contextControllerRef.current = null
    }
  }, [])

  const requestAiRubric = async () => {
    const readyUnits = latestUnitsRef.current
    if (readyUnits.length === 0 || materials.isNormalizing || submittingRef.current) return

    const snapshot = requestSnapshot(
      materialFreshnessIdentity(readyUnits, materialMutationVersionRef.current),
      fullScore,
      writingRequirement,
    )
    const requestId = newRequestId('rubric')
    const controller = new AbortController()
    const active: GeneratingAiState = { status: 'generating', requestId, snapshot, controller }
    activeAiRef.current?.controller.abort()
    activeAiRef.current = active
    setAiState(active)

    let response
    try {
      response = await rubricClient.generate({
        requestId,
        fullScore,
        writingRequirement,
        materials: toRequestUnits(readyUnits),
        signal: controller.signal,
      })
    } catch {
      response = null
    }

    if (
      !mountedRef.current
      || activeAiRef.current?.requestId !== requestId
      || activeAiRef.current.snapshot !== snapshot
      || latestRequestSnapshotRef.current !== snapshot
    ) return

    activeAiRef.current = null
    if (!response || response.requestId !== requestId || response.status === 'failed') {
      setAiState({ status: 'failed', message: '评分标准生成失败，请保留当前内容后重试。' })
      return
    }

    const visibleDimensions = toVisibleAiDimensions(response.rubric)
    const effectiveWritingRequirement = writingRequirement.trim()
      ? writingRequirement
      : response.rubric.writingRequirements[0] ?? ''
    const projectedValidity = validateRubricForm({
      fullScore,
      writingRequirement: effectiveWritingRequirement,
      dimensions: visibleDimensions,
    })
    if (!projectedValidity.valid) {
      setAiState({ status: 'failed', message: 'AI 返回的评分标准无法安全应用，当前内容已保留。' })
      return
    }

    setDimensions(visibleDimensions)
    if (!writingRequirement.trim()) setWritingRequirement(effectiveWritingRequirement)
    rubricSourceRef.current = 'ai'
    setRubricSource('ai')
    const appliedSnapshot = requestSnapshot(
      materialFreshnessIdentity(readyUnits, materialMutationVersionRef.current),
      fullScore,
      effectiveWritingRequirement,
    )
    replaceMaterialContextState({
      status: 'ready',
      signature: appliedSnapshot,
      value: toMaterialContext(response.rubric),
    })
    setShowMaterialStaleNotice(false)
    setAiState({ status: 'idle' })
  }

  const changeDimensions = (next: RubricDimension[]) => {
    abortAi()
    setDimensions(next)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submittingRef.current || !rubricValidity.valid) return

    submittingRef.current = true
    setSubmitting(true)
    setSubmitWarning('')
    const form = {
      taskName,
      fullScore,
      writingRequirement,
      dimensions,
      source: rubricSource,
    }
    abortAi()
    await materials.waitUntilIdle()
    if (!mountedRef.current) return

    const readyUnits = latestUnitsRef.current
    const snapshot = requestSnapshot(
      materialFreshnessIdentity(readyUnits, materialMutationVersionRef.current),
      form.fullScore,
      form.writingRequirement,
    )
    let analyzedMaterialContext: TaskMaterialContext | undefined
    let materialProcessingStatus: TaskMaterialProcessingStatus = 'none'
    const cached = materialContextStateRef.current

    if (readyUnits.length > 0) {
      if (cached.status === 'ready' && cached.signature === snapshot) {
        analyzedMaterialContext = cached.value
        materialProcessingStatus = 'ready'
      } else {
        const requestId = newRequestId('material-context')
        const controller = new AbortController()
        contextControllerRef.current = controller
        replaceMaterialContextState({ status: 'analyzing', signature: snapshot })
        let response
        try {
          response = await materialContextClient.analyze({
            requestId,
            fullScore: form.fullScore,
            writingRequirement: form.writingRequirement,
            materials: toRequestUnits(readyUnits),
            signal: controller.signal,
          })
        } catch {
          response = null
        }
        if (contextControllerRef.current === controller) contextControllerRef.current = null
        if (!mountedRef.current) return

        if (response?.requestId === requestId && response.status === 'success') {
          analyzedMaterialContext = response.materialContext
          materialProcessingStatus = 'ready'
          replaceMaterialContextState({ status: 'ready', signature: snapshot, value: response.materialContext })
        } else {
          materialProcessingStatus = 'failed'
          const message = '材料暂时无法读取，本任务将仅按已填写的写作要求评分。'
          setSubmitWarning(message)
          replaceMaterialContextState({ status: 'failed', signature: snapshot, message })
        }
      }
    }

    const built = buildTaskCreationInput({
      ...form,
      analyzedMaterialContext,
      materialProcessingStatus,
    })
    if (!built.ok) {
      submittingRef.current = false
      setSubmitting(false)
      return
    }

    const taskId = createTask(built.value)
    navigate(`/tasks/${taskId}/upload`)
  }

  return (
    <AppLayout
      title="创建批改任务"
      description="填写一份当前有效的评分标准后即可创建任务；原题材料与 AI 辅助均为选填。"
    >
      <form className="space-y-5" onSubmit={(event) => void submit(event)}>
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold text-slate-950">基本信息</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <label className="grid gap-2 text-sm font-semibold text-slate-800">
              任务名称（选填）
              <input
                type="text"
                value={taskName}
                maxLength={2_000}
                disabled={submitting}
                onChange={(event) => setTaskName(event.currentTarget.value.slice(0, 2_000))}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-slate-800">
              满分
              <input
                aria-label="满分"
                type="number"
                min={1}
                max={100}
                step={1}
                value={Number.isFinite(fullScore) ? fullScore : ''}
                disabled={submitting}
                aria-invalid={Boolean(rubricValidity.errors.fullScore)}
                onChange={(event) => setFullScore(event.currentTarget.valueAsNumber)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
              />
            </label>
          </div>
          {rubricValidity.errors.fullScore ? (
            <p className="mt-2 text-sm text-rose-700">{rubricValidity.errors.fullScore}</p>
          ) : null}
        </section>

        <TaskMaterialOrganizer
          units={materials.units}
          sources={materials.sources}
          disabled={submitting}
          onSelectFiles={(files) => {
            registerMaterialMutation()
            void materials.addFiles(files)
          }}
          onRemoveUnit={(unitId) => {
            registerMaterialMutation()
            materials.removeUnit(unitId)
          }}
          onRemoveSource={(sourceKey) => {
            registerMaterialMutation()
            materials.removeSource(sourceKey)
          }}
          onRetrySource={(sourceKey) => {
            registerMaterialMutation()
            void materials.retrySource(sourceKey)
          }}
          onMoveUnit={(unitId, direction) => {
            registerMaterialMutation()
            materials.moveUnit(unitId, direction)
          }}
        />

        {showMaterialStaleNotice ? (
          <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {MATERIAL_STALE_NOTICE}
          </p>
        ) : null}

        <TaskRubricEditor
          writingRequirement={writingRequirement}
          dimensions={dimensions}
          validity={rubricValidity}
          disabled={submitting}
          canRequestAi={canRequestAi}
          aiState={aiState.status}
          aiMessage={aiState.status === 'failed' ? aiState.message : undefined}
          onWritingRequirementChange={setWritingRequirement}
          onDimensionsChange={changeDimensions}
          onRequestAi={() => { void requestAiRubric() }}
        />

        <section className="sticky bottom-4 rounded-xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur">
          {submitWarning ? (
            <p role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {submitWarning}
            </p>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-slate-600">提交即确认当前评分标准，并进入学生作文上传。</p>
            <button
              type="submit"
              disabled={!canCreate}
              className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {submitting ? '正在创建任务…' : '创建任务并上传作文'}
            </button>
          </div>
        </section>
      </form>
    </AppLayout>
  )
}
