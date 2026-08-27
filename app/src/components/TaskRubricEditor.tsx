import { ChevronDown, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  createOrdinaryRubricDimension,
  LEGIBILITY_DIMENSION_ID,
  TOTAL_WEIGHT_TOLERANCE,
  type RubricValidity,
} from '../services/taskRubric/rubricForm'
import type { RubricDimension } from '../types'

export interface TaskRubricEditorProps {
  writingRequirement: string
  dimensions: readonly RubricDimension[]
  validity: RubricValidity
  disabled?: boolean
  canRequestAi: boolean
  aiState: 'idle' | 'generating' | 'failed'
  aiMessage?: string
  onWritingRequirementChange(value: string): void
  onDimensionsChange(dimensions: RubricDimension[]): void
  onRequestAi(): void
}

let ordinaryDimensionSequence = 0

function cloneDimension(dimension: RubricDimension): RubricDimension {
  return {
    ...dimension,
    deductionFocus: [...dimension.deductionFocus],
    ...(dimension.sourceEvidence ? { sourceEvidence: [...dimension.sourceEvidence] } : {}),
  }
}

function cloneDimensions(dimensions: readonly RubricDimension[]): RubricDimension[] {
  return dimensions.map(cloneDimension)
}

function createAvailableOrdinaryId(dimensions: readonly RubricDimension[]): string {
  const existingIds = new Set(dimensions.map(({ id }) => id))
  let candidate: string

  do {
    ordinaryDimensionSequence += 1
    candidate = `ordinary-${ordinaryDimensionSequence}`
  } while (existingIds.has(candidate))

  return candidate
}

function formatPercentage(value: number): string {
  if (!Number.isFinite(value)) return '无效数值'

  return new Intl.NumberFormat('zh-CN', {
    useGrouping: false,
    maximumFractionDigits: 6,
  }).format(value)
}

function totalWeightText(validity: RubricValidity): string {
  const { totalWeight, differenceFromHundred } = validity
  if (!Number.isFinite(totalWeight) || !Number.isFinite(differenceFromHundred)) {
    return '当前合计无效，请检查各维度权重'
  }

  const total = formatPercentage(totalWeight)
  if (differenceFromHundred === 0) return `当前合计 ${total}%，权重合计正确`
  if (differenceFromHundred <= TOTAL_WEIGHT_TOLERANCE) {
    return `当前合计 ${total}%，在 0.001% 容差内视为 100%`
  }
  if (totalWeight < 100) return `当前合计 ${total}%，还需 ${formatPercentage(100 - totalWeight)}%`

  return `当前合计 ${total}%，超出 ${formatPercentage(totalWeight - 100)}%`
}

function appendDescribedBy(...ids: Array<string | undefined>): string | undefined {
  const presentIds = ids.filter((id): id is string => Boolean(id))
  return presentIds.length > 0 ? presentIds.join(' ') : undefined
}

export function TaskRubricEditor({
  writingRequirement,
  dimensions,
  validity,
  disabled = false,
  canRequestAi,
  aiState,
  aiMessage,
  onWritingRequirementChange,
  onDimensionsChange,
  onRequestAi,
}: TaskRubricEditorProps) {
  const [expandedDimensionIds, setExpandedDimensionIds] = useState<Set<string>>(() => new Set())
  const writingRequirementErrorId = validity.errors.writingRequirement ? 'rubric-writing-requirement-error' : undefined
  const dimensionsErrorId = validity.errors.dimensions ? 'rubric-dimensions-error' : undefined

  const toggleDimension = (id: string) => {
    setExpandedDimensionIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const changeDimension = (index: number, patch: Partial<Pick<RubricDimension, 'name' | 'description' | 'weight'>>) => {
    const next = cloneDimensions(dimensions)
    next[index] = { ...next[index]!, ...patch }
    onDimensionsChange(next)
  }

  const addDimension = () => {
    const next = cloneDimensions(dimensions)
    next.push(createOrdinaryRubricDimension(createAvailableOrdinaryId(dimensions)))
    onDimensionsChange(next)
  }

  const deleteDimension = (id: string) => {
    if (id === LEGIBILITY_DIMENSION_ID) return
    onDimensionsChange(cloneDimensions(dimensions.filter((dimension) => dimension.id !== id)))
  }

  const aiIsGenerating = aiState === 'generating'
  const aiStatusMessage = aiMessage || (aiIsGenerating ? '正在根据材料生成评分标准…' : aiState === 'failed' ? '评分标准生成失败，请稍后重试。' : '')

  return (
    <section aria-labelledby="task-rubric-editor-title" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="task-rubric-editor-title" className="text-lg font-semibold text-slate-950">评分标准</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">填写写作要求，并按需调整评分维度与权重。</p>
        </div>
        <button
          type="button"
          disabled={disabled || !canRequestAi || aiIsGenerating}
          onClick={onRequestAi}
          className="tech-focus inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          <Sparkles aria-hidden="true" className="h-4 w-4" />
          根据材料生成评分标准
        </button>
      </div>

      {!canRequestAi && !aiIsGenerating && aiState !== 'failed' ? (
        <p className="mt-2 text-sm text-slate-500">上传并完成材料整理后，可以使用材料辅助填写。</p>
      ) : null}
      {aiIsGenerating ? (
        <p role="status" aria-live="polite" className="mt-2 text-sm text-blue-700">{aiStatusMessage}</p>
      ) : null}
      {aiState === 'failed' ? (
        <p role="alert" className="mt-2 text-sm text-rose-700">{aiStatusMessage}</p>
      ) : null}

      <div className="mt-6">
        <label htmlFor="rubric-writing-requirement" className="text-sm font-semibold text-slate-900">写作要求</label>
        <textarea
          id="rubric-writing-requirement"
          value={writingRequirement}
          disabled={disabled}
          aria-invalid={Boolean(validity.errors.writingRequirement)}
          aria-describedby={writingRequirementErrorId}
          onChange={(event) => onWritingRequirementChange(event.currentTarget.value)}
          className="mt-2 min-h-40 w-full resize-y rounded-lg border border-slate-200 p-3 text-sm leading-6 text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50"
        />
        {validity.errors.writingRequirement ? (
          <p id={writingRequirementErrorId} className="mt-1 text-sm text-rose-700">{validity.errors.writingRequirement}</p>
        ) : null}
      </div>

      <div className="mt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-slate-950">评分维度</h3>
            <p className="mt-1 text-sm text-slate-600">展开维度后可修改名称、说明和权重。</p>
          </div>
          <button
            type="button"
            disabled={disabled || dimensions.length >= 10}
            onClick={addDimension}
            className="tech-focus inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            添加评分维度
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {dimensions.map((dimension, index) => {
            const expanded = expandedDimensionIds.has(dimension.id)
            const itemErrors = validity.errors.dimensionItems[index] ?? {}
            const itemDomId = `rubric-dimension-${index}`
            const idErrorId = itemErrors.id ? `${itemDomId}-id-error` : undefined
            const nameErrorId = itemErrors.name ? `${itemDomId}-name-error` : undefined
            const descriptionErrorId = itemErrors.description ? `${itemDomId}-description-error` : undefined
            const weightErrorId = itemErrors.weight ? `${itemDomId}-weight-error` : undefined
            const displayName = dimension.name || `第 ${index + 1} 个维度`

            return (
              <div key={dimension.id} className="rounded-lg border border-slate-200 bg-slate-50/60">
                <div className="flex min-w-0 items-center gap-2 p-3 sm:gap-3 sm:p-4">
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`编辑${displayName}`}
                    aria-expanded={expanded}
                    aria-controls={`${itemDomId}-details`}
                    aria-invalid={Boolean(itemErrors.id)}
                    aria-describedby={idErrorId}
                    onClick={() => toggleDimension(dimension.id)}
                    className="tech-focus flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md text-left disabled:cursor-not-allowed"
                  >
                    <span className="min-w-0 truncate text-sm font-semibold text-slate-900">{displayName}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-sm font-semibold tabular-nums text-blue-700">
                        {formatPercentage(dimension.weight)}%
                      </span>
                      <ChevronDown aria-hidden="true" className={`h-4 w-4 text-slate-500 transition ${expanded ? 'rotate-180' : ''}`} />
                    </span>
                  </button>
                  {dimension.id !== LEGIBILITY_DIMENSION_ID ? (
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={`删除${displayName}`}
                      onClick={() => deleteDimension(dimension.id)}
                      className="tech-focus inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>

                {idErrorId ? <p id={idErrorId} className="px-4 pb-3 text-sm text-rose-700">{itemErrors.id}</p> : null}
                {expanded ? (
                  <div id={`${itemDomId}-details`} className="grid gap-4 border-t border-slate-200 bg-white p-3 sm:p-4">
                    <div>
                      <label htmlFor={`${itemDomId}-name`} className="text-sm font-medium text-slate-800">维度名称：{displayName}</label>
                      <input
                        id={`${itemDomId}-name`}
                        type="text"
                        value={dimension.name}
                        disabled={disabled}
                        aria-invalid={Boolean(itemErrors.name)}
                        aria-describedby={nameErrorId}
                        onChange={(event) => changeDimension(index, { name: event.currentTarget.value })}
                        className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50"
                      />
                      {nameErrorId ? <p id={nameErrorId} className="mt-1 text-sm text-rose-700">{itemErrors.name}</p> : null}
                    </div>

                    <div>
                      <label htmlFor={`${itemDomId}-description`} className="text-sm font-medium text-slate-800">维度说明：{displayName}</label>
                      <textarea
                        id={`${itemDomId}-description`}
                        value={dimension.description}
                        disabled={disabled}
                        aria-invalid={Boolean(itemErrors.description)}
                        aria-describedby={descriptionErrorId}
                        onChange={(event) => changeDimension(index, { description: event.currentTarget.value })}
                        className="mt-1.5 min-h-24 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6 text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50"
                      />
                      {descriptionErrorId ? <p id={descriptionErrorId} className="mt-1 text-sm text-rose-700">{itemErrors.description}</p> : null}
                    </div>

                    <div className="sm:max-w-48">
                      <label htmlFor={`${itemDomId}-weight`} className="text-sm font-medium text-slate-800">权重：{displayName}</label>
                      <div className="relative mt-1.5">
                        <input
                          id={`${itemDomId}-weight`}
                          type="number"
                          min="0"
                          max="100"
                          step="any"
                          value={Number.isFinite(dimension.weight) ? dimension.weight : ''}
                          disabled={disabled}
                          aria-invalid={Boolean(itemErrors.weight)}
                          aria-describedby={weightErrorId}
                          onChange={(event) => changeDimension(index, { weight: event.currentTarget.valueAsNumber })}
                          className="w-full rounded-lg border border-slate-200 py-2 pl-3 pr-8 text-sm tabular-nums text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50"
                        />
                        <span aria-hidden="true" className="pointer-events-none absolute right-3 top-2 text-sm text-slate-500">%</span>
                      </div>
                      {weightErrorId ? <p id={weightErrorId} className="mt-1 text-sm text-rose-700">{itemErrors.weight}</p> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p
            aria-live="polite"
            aria-invalid={Boolean(validity.errors.dimensions)}
            aria-describedby={appendDescribedBy(dimensionsErrorId)}
            className={`text-sm font-semibold ${validity.errors.dimensions ? 'text-rose-700' : 'text-emerald-700'}`}
          >
            {totalWeightText(validity)}
          </p>
          {dimensionsErrorId ? <p id={dimensionsErrorId} className="mt-1 text-sm text-rose-700">{validity.errors.dimensions}</p> : null}
        </div>
      </div>
    </section>
  )
}
