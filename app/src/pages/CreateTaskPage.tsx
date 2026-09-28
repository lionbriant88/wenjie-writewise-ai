import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { TaskMaterialOrganizer } from '../components/TaskMaterialOrganizer'
import { TaskRubricEditor } from '../components/TaskRubricEditor'
import { useAppState } from '../context/useAppState'
import { useTaskMaterials } from '../hooks/useTaskMaterials'
import { AppLayout } from '../layout/AppLayout'
import { createConfiguredMaterialContextClient } from '../services/taskMaterial/materialClient'
import type {
  MaterialUnit,
  TaskMaterialRequestUnit,
} from '../services/taskMaterial/types'
import { buildTaskCreationInput } from '../services/taskRubric/buildTaskCreationInput'
import {
  createDefaultRubricDimensions,
  DEFAULT_TASK_NAME,
  validateRubricForm,
} from '../services/taskRubric/rubricForm'
import { createConfiguredRubricClient } from '../services/taskRubric/rubricClient'
import { createPilotMaterialClients } from '../pilot/materialClients'
import {
  createMaterialDraftSession,
  restoreMaterialUnits,
} from '../pilot/materialDraft'
import { startOwnedPolling } from '../pilot/polling'
import type {
  TaskDraftInput,
  TaskDto,
  JobDto,
} from '../../../shared/pilotContracts'
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

const MATERIAL_STALE_NOTICE =
  '材料已变化；当前评分标准仍可使用，如需让 AI 重新参考材料，可再次生成。'

function newRequestId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

function materialSignature(units: readonly MaterialUnit[]): string {
  return JSON.stringify(
    units.map((unit) =>
      unit.kind === 'image'
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
        : [unit.id, unit.kind, unit.sourceKind, unit.displayName, unit.text],
    ),
  )
}

function materialFreshnessIdentity(
  units: readonly MaterialUnit[],
  mutationVersion: number,
): string {
  return JSON.stringify({ mutationVersion, units: materialSignature(units) })
}

function requestSnapshot(
  signature: string,
  fullScore: number,
  writingRequirement: string,
): string {
  return JSON.stringify({ signature, fullScore, writingRequirement })
}

function toRequestUnits(
  units: readonly MaterialUnit[],
): TaskMaterialRequestUnit[] {
  return units.map((unit) =>
    unit.kind === 'image'
      ? { id: unit.id, kind: 'image', file: unit.file }
      : {
          id: unit.id,
          kind: 'text',
          displayName: unit.displayName,
          text: unit.text,
        },
  )
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
  const { pilot, loading } = useAppState()
  const { taskId } = useParams()
  const { state } = useLocation()
  if (pilot && taskId) {
    const task = pilot.tasks.find((t) => t.id === taskId)
    if (loading || !task)
      return (
        <AppLayout title="创建批改任务" description="恢复云端草稿">
          <p role="status">
            {loading ? '正在读取草稿…' : '草稿不存在或已删除。'}
          </p>
        </AppLayout>
      )
  }
  const editorIdentity = taskId && state?.draftId === taskId
    ? state.draftEditorKey
    : taskId ?? 'new'
  return <TaskDraftEditor key={editorIdentity} editorIdentity={editorIdentity} />
}

function TaskDraftEditor({ editorIdentity }: { editorIdentity: string }) {
  const navigate = useNavigate()
  const { createTask, pilot } = useAppState()
  const { taskId: existingDraftId } = useParams()
  const [initialDraftId] = useState(existingDraftId)
  const [initialTask] = useState(() =>
    pilot?.tasks.find((t) => t.id === existingDraftId),
  )
  const initialDraft = initialTask?.draft
  const editingAllowed = !initialTask || initialTask.state === 'draft'
  const editorKey = useRef(existingDraftId ?? crypto.randomUUID()).current
  const [draftSave, setDraftSave] = useState('')
  const materials = useTaskMaterials()
  const session = useMemo(
    () =>
      pilot
        ? createMaterialDraftSession(pilot, editorKey, initialDraftId)
        : undefined,
    [pilot, editorKey, initialDraftId],
  )
  const saveForAiRef = useRef<() => Promise<TaskDto>>(async () => {
    throw Error('草稿尚未就绪。')
  })
  const clients = useMemo(
    () =>
      pilot
        ? createPilotMaterialClients({
            client: pilot.client,
            taskDraft: () => saveForAiRef.current(),
          })
        : {
            rubricClient: createConfiguredRubricClient(),
            materialClient: createConfiguredMaterialContextClient(),
          },
    [pilot],
  )
  const rubricClient = clients.rubricClient
  const materialContextClient = clients.materialClient
  const [restoreState, setRestoreState] = useState<
    'loading' | 'ready' | 'failed'
  >(initialDraft?.materialRefs.length ? 'loading' : 'ready')
  const [restoreAttempt, setRestoreAttempt] = useState(0)
  const [savedJob, setSavedJob] = useState<JobDto>()
  const [taskName, setTaskName] = useState(
    initialDraft?.taskName ?? DEFAULT_TASK_NAME,
  )
  const [fullScore, setFullScore] = useState(initialDraft?.fullScore ?? 15)
  const [writingRequirement, setWritingRequirement] = useState(
    initialDraft?.writingRequirement ?? '',
  )
  const [dimensions, setDimensions] = useState<RubricDimension[]>(
    initialDraft?.dimensions ?? createDefaultRubricDimensions,
  )
  const [rubricSource, setRubricSource] = useState<'teacher' | 'ai'>(
    initialDraft?.source ?? 'teacher',
  )
  const [aiState, setAiState] = useState<AiAssistState>({ status: 'idle' })
  const [materialContextState, setMaterialContextState] =
    useState<MaterialContextState>({ status: 'none' })
  const [materialMutationVersion, setMaterialMutationVersion] = useState(0)
  const [showMaterialStaleNotice, setShowMaterialStaleNotice] = useState(false)
  const [submitWarning, setSubmitWarning] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const mountedRef = useRef(true)
  const activeAiRef = useRef<GeneratingAiState | null>(null)
  const materialContextStateRef =
    useRef<MaterialContextState>(materialContextState)
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
  const currentRequestSnapshot = requestSnapshot(
    currentMaterialSignature,
    fullScore,
    writingRequirement,
  )
  const latestRequestSnapshotRef = useRef(currentRequestSnapshot)
  latestRequestSnapshotRef.current = currentRequestSnapshot

  const draftJson = JSON.stringify({
    taskName,
    fullScore: Number.isFinite(fullScore) ? fullScore : null,
    writingRequirement,
    dimensions: dimensions.map((d) => ({
      ...d,
      sourceEvidence: d.sourceEvidence ?? [],
    })),
    source: rubricSource,
    materialContext:
      materialContextState.status === 'ready'
        ? materialContextState.value
        : null,
    materialProcessingStatus:
      materialContextState.status === 'ready'
        ? 'ready'
        : materialContextState.status === 'failed'
          ? 'failed'
          : 'none',
    materialRefs: [],
  })
  const draftValue = JSON.parse(draftJson) as TaskDraftInput
  const retainDraftAddress = (task: TaskDto) => {
    if (mountedRef.current && !existingDraftId) {
      navigate(`/tasks/${task.id}/edit`, {
        replace: true,
        state: { draftId: task.id, draftEditorKey: editorIdentity },
      })
    }
    return task
  }
  const retainDraftAddressRef = useRef(retainDraftAddress)
  retainDraftAddressRef.current = retainDraftAddress
  saveForAiRef.current = () => {
    if (!session || restoreState !== 'ready') throw Error('草稿尚未就绪。')
    return session.save(draftValue, latestUnitsRef.current).then(retainDraftAddressRef.current)
  }
  useEffect(() => {
    if (
      !session ||
      submitting ||
      !editingAllowed ||
      restoreState !== 'ready' ||
      materials.isNormalizing
    )
      return
    let active = true
    setDraftSave('有未保存的修改')
    const timer = setTimeout(() => {
      setDraftSave('正在保存草稿…')
      void session
        .save(JSON.parse(draftJson), materials.units)
        .then((task) => {
          if (active) {
            setDraftSave('草稿已保存')
            retainDraftAddressRef.current(task)
          }
        })
        .catch(() => {
          if (active) setDraftSave('草稿未保存，请检查网络后重试')
        })
    }, 600)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [
    session,
    draftJson,
    submitting,
    restoreState,
    materials.units,
    materials.isNormalizing,
    editingAllowed,
  ])

  const restore = materials.restore
  useEffect(() => {
    if (!pilot || !initialTask || !editingAllowed) return
    const controller = new AbortController()
    setRestoreState('loading')
    void restoreMaterialUnits(pilot, initialTask, controller.signal)
      .then((saved) => {
        if (controller.signal.aborted) return
        const units = restore(saved)
        latestUnitsRef.current = units
        if (initialTask.draft.materialContext) {
          const ready: MaterialContextState = {
            status: 'ready',
            signature: requestSnapshot(
              materialFreshnessIdentity(units, 0),
              initialTask.draft.fullScore!,
              initialTask.draft.writingRequirement,
            ),
            value: initialTask.draft.materialContext,
          }
          materialContextStateRef.current = ready
          setMaterialContextState(ready)
        }
        setRestoreState('ready')
      })
      .catch(() => {
        if (!controller.signal.aborted) setRestoreState('failed')
      })
    return () => controller.abort()
  }, [pilot, initialTask, restore, restoreAttempt, editingAllowed])

  const editIdentity = JSON.stringify([
    taskName,
    fullScore,
    writingRequirement,
    dimensions,
    rubricSource,
    materialMutationVersion,
  ])
  const initialEditIdentity = useRef(editIdentity).current
  useEffect(() => {
    if (
      !pilot ||
      !initialTask ||
      !editingAllowed ||
      restoreState !== 'ready' ||
      editIdentity !== initialEditIdentity
    )
      return
    const controller = new AbortController()
    const stop = startOwnedPolling({
      signal: controller.signal,
      load: async () => {
        const jobs = await pilot.client.listAssistance(
          initialTask.id,
          controller.signal,
        )
        if (!controller.signal.aborted)
          setSavedJob(jobs.find((j) => j.kind === 'rubric'))
      },
      onSnapshot: () => {},
      onError: () => {},
      onExpired: () => {},
    })
    return () => {
      controller.abort()
      stop()
    }
  }, [
    pilot,
    initialTask,
    restoreState,
    editIdentity,
    initialEditIdentity,
    editingAllowed,
  ])

  const rubricValidity = validateRubricForm({
    fullScore,
    writingRequirement,
    dimensions,
  })
  const canCreate =
    rubricValidity.valid && !submitting && restoreState === 'ready'
  const canRequestAi =
    materials.units.length > 0 &&
    !materials.isNormalizing &&
    restoreState === 'ready'

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
      (cached.status === 'ready' || cached.status === 'failed') &&
      cached.signature !== currentRequestSnapshot
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
    if (
      readyUnits.length === 0 ||
      materials.isNormalizing ||
      submittingRef.current
    )
      return

    const snapshot = requestSnapshot(
      materialFreshnessIdentity(readyUnits, materialMutationVersionRef.current),
      fullScore,
      writingRequirement,
    )
    const requestId = newRequestId('rubric')
    const controller = new AbortController()
    const active: GeneratingAiState = {
      status: 'generating',
      requestId,
      snapshot,
      controller,
    }
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
      !mountedRef.current ||
      activeAiRef.current?.requestId !== requestId ||
      activeAiRef.current.snapshot !== snapshot ||
      latestRequestSnapshotRef.current !== snapshot
    )
      return

    activeAiRef.current = null
    if (
      !response ||
      response.requestId !== requestId ||
      response.status === 'failed'
    ) {
      setAiState({
        status: 'failed',
        message:
          pilot && response?.status === 'failed'
            ? response.error.message
            : '评分标准生成失败，请保留当前内容后重试。',
      })
      return
    }

    const visibleDimensions = toVisibleAiDimensions(response.rubric)
    const effectiveWritingRequirement = writingRequirement.trim()
      ? writingRequirement
      : (response.rubric.writingRequirements[0] ?? '')
    const projectedValidity = validateRubricForm({
      fullScore,
      writingRequirement: effectiveWritingRequirement,
      dimensions: visibleDimensions,
    })
    if (!projectedValidity.valid) {
      setAiState({
        status: 'failed',
        message: 'AI 返回的评分标准无法安全应用，当前内容已保留。',
      })
      return
    }

    setDimensions(visibleDimensions)
    if (!writingRequirement.trim())
      setWritingRequirement(effectiveWritingRequirement)
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
    if (
      submittingRef.current ||
      !rubricValidity.valid ||
      restoreState !== 'ready'
    )
      return

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
        replaceMaterialContextState({
          status: 'analyzing',
          signature: snapshot,
        })
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
        if (contextControllerRef.current === controller)
          contextControllerRef.current = null
        if (!mountedRef.current) return

        if (
          response?.requestId === requestId &&
          response.status === 'success'
        ) {
          analyzedMaterialContext = response.materialContext
          materialProcessingStatus = 'ready'
          replaceMaterialContextState({
            status: 'ready',
            signature: snapshot,
            value: response.materialContext,
          })
        } else {
          materialProcessingStatus = 'failed'
          const message = '材料暂时无法读取，本任务将仅按已填写的写作要求评分。'
          setSubmitWarning(message)
          replaceMaterialContextState({
            status: 'failed',
            signature: snapshot,
            message,
          })
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

    try {
      if (session)
        await session.save(
          {
            ...draftValue,
            materialContext: analyzedMaterialContext ?? null,
            materialProcessingStatus,
          },
          readyUnits,
        )
      const taskId = pilot
        ? await createTask(built.value, editorKey)
        : await createTask(built.value)
      if (mountedRef.current) navigate(`/tasks/${taskId}/upload`)
    } catch (error) {
      if (mountedRef.current) {
        setSubmitWarning(
          error instanceof Error ? error.message : '任务保存失败，请重试。',
        )
        submittingRef.current = false
        setSubmitting(false)
      }
    }
  }

  if (!editingAllowed)
    return (
      <AppLayout title="批改任务" description="当前评分标准已确认">
        <p>此任务已创建，请从任务列表进入。</p>
      </AppLayout>
    )
  return (
    <AppLayout
      title="创建批改任务"
      description="填写一份当前有效的评分标准后即可创建任务；原题材料与 AI 辅助均为选填。"
    >
      {draftSave ? (
        <p role="status" className="mb-3 text-sm text-slate-600">
          {draftSave}
        </p>
      ) : null}
      {restoreState !== 'ready' ? (
        <p role="status">
          {restoreState === 'loading'
            ? '正在恢复原题材料…'
            : '原题材料暂时无法读取。'}
          {restoreState === 'failed' ? (
            <button onClick={() => setRestoreAttempt((v) => v + 1)}>
              重新加载材料
            </button>
          ) : null}
        </p>
      ) : null}
      {savedJob && editIdentity === initialEditIdentity ? (
        <p role="status" className="mb-3 text-sm text-slate-600">
          {savedJob.state === 'queued' || savedJob.state === 'running'
            ? '上次评分标准仍在云端生成，正在检查结果。'
            : savedJob.state === 'result_unknown'
              ? '上次生成结果尚未确定，正在检查原任务。'
              : savedJob.state === 'succeeded' || savedJob.state === 'partial'
                ? '上次评分标准已生成。'
                : '上次生成未完成，当前评分标准仍可编辑。'}
          {savedJob.state === 'succeeded' || savedJob.state === 'partial' ? (
            <button
              type="button"
              disabled={aiState.status === 'generating' || submitting}
              onClick={() => void requestAiRubric()}
            >
              查看并应用上次生成
            </button>
          ) : null}
        </p>
      ) : null}
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
                disabled={submitting || restoreState !== 'ready'}
                onChange={(event) =>
                  setTaskName(event.currentTarget.value.slice(0, 2_000))
                }
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
                disabled={submitting || restoreState !== 'ready'}
                aria-invalid={Boolean(rubricValidity.errors.fullScore)}
                onChange={(event) =>
                  setFullScore(event.currentTarget.valueAsNumber)
                }
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
              />
            </label>
          </div>
          {rubricValidity.errors.fullScore ? (
            <p className="mt-2 text-sm text-rose-700">
              {rubricValidity.errors.fullScore}
            </p>
          ) : null}
        </section>

        <TaskMaterialOrganizer
          units={materials.units}
          sources={materials.sources}
          disabled={submitting || restoreState !== 'ready'}
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
          <p
            role="status"
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          >
            {MATERIAL_STALE_NOTICE}
          </p>
        ) : null}

        <TaskRubricEditor
          writingRequirement={writingRequirement}
          dimensions={dimensions}
          validity={rubricValidity}
          disabled={submitting || restoreState !== 'ready'}
          canRequestAi={canRequestAi}
          aiState={aiState.status}
          aiMessage={aiState.status === 'failed' ? aiState.message : undefined}
          onWritingRequirementChange={setWritingRequirement}
          onDimensionsChange={changeDimensions}
          onRequestAi={() => {
            void requestAiRubric()
          }}
        />

        <section className="sticky bottom-4 rounded-xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur">
          {submitWarning ? (
            <p
              role="status"
              className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            >
              {submitWarning}
            </p>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-slate-600">
              提交即确认当前评分标准，并进入学生作文上传。
            </p>
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
