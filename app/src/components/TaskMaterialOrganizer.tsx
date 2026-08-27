import { MATERIAL_FILE_ACCEPT, MAX_MATERIAL_UNITS } from '../services/taskMaterial/constants'
import type { MaterialUnit } from '../services/taskMaterial/types'
import type { MaterialSourceState } from '../hooks/useTaskMaterials'

export interface TaskMaterialOrganizerProps {
  units: readonly MaterialUnit[]
  sources: readonly MaterialSourceState[]
  disabled?: boolean
  onSelectFiles(files: readonly File[]): void
  onRemoveUnit(unitId: string): void
  onRemoveSource(sourceKey: string): void
  onRetrySource(sourceKey: string): void
  onMoveUnit(unitId: string, direction: -1 | 1): void
}

export function TaskMaterialOrganizer({
  units,
  sources,
  disabled = false,
  onSelectFiles,
  onRemoveUnit,
  onRemoveSource,
  onRetrySource,
  onMoveUnit,
}: TaskMaterialOrganizerProps) {
  const activeSources = sources.filter(({ status }) => status !== 'ready')

  return (
    <section className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-slate-900">建议上传作文原材料（选填）</h2>
        <p className="text-sm leading-6 text-slate-600">
          不上传材料也能批改。支持 JPEG、PNG、WebP、PDF 和 DOCX，最多整理 {MAX_MATERIAL_UNITS} 个材料单元。
        </p>
      </div>

      <label className="grid grid-cols-1 gap-2 text-sm font-medium text-slate-700">
        选择作文原材料
        <input
          type="file"
          aria-label="选择作文原材料"
          accept={MATERIAL_FILE_ACCEPT}
          multiple
          disabled={disabled}
          onChange={(event) => {
            const selected = Array.from(event.currentTarget.files ?? [])
            if (selected.length > 0) onSelectFiles(selected)
            event.currentTarget.value = ''
          }}
          className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-blue-700 disabled:bg-slate-50 disabled:text-slate-400"
        />
      </label>

      {activeSources.length > 0 ? (
        <ul className="grid grid-cols-1 gap-3" aria-label="材料处理状态">
          {activeSources.map((source) => (
            <li
              key={source.key}
              role="status"
              className={`grid grid-cols-1 gap-3 rounded-lg border px-3 py-3 text-sm ${
                source.status === 'failed'
                  ? 'border-rose-200 bg-rose-50 text-rose-900'
                  : 'border-blue-200 bg-blue-50 text-blue-900'
              }`}
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{source.fileName}</p>
                <p className="mt-1 text-xs leading-5">
                  {source.status === 'failed' ? source.errorMessage : '正在处理，请稍候…'}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {source.status === 'failed' ? (
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`重试 ${source.fileName}`}
                    onClick={() => onRetrySource(source.key)}
                    className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 disabled:text-slate-300"
                  >
                    重试
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`删除 ${source.fileName}`}
                  onClick={() => onRemoveSource(source.key)}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:text-slate-300"
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {units.length > 0 ? (
        <ol className="grid grid-cols-1 gap-3" aria-label="已整理的作文原材料">
          {units.map((unit, index) => (
            <li key={unit.id} className="grid grid-cols-1 gap-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
              {unit.kind === 'image' ? (
                <img
                  src={unit.previewUrl}
                  alt={`${unit.displayName} 预览`}
                  className="h-32 w-full rounded-md bg-white object-contain sm:h-24"
                />
              ) : (
                <div className="flex min-h-24 items-center justify-center rounded-md border border-emerald-100 bg-emerald-50 px-3 text-center text-sm font-semibold text-emerald-800">
                  正文已提取
                </div>
              )}

              <div className="min-w-0 space-y-2">
                <div>
                  <p className="truncate text-sm font-medium text-slate-900">{unit.displayName}</p>
                  {unit.kind === 'image' ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {unit.sourceKind === 'pdf' ? `PDF 第 ${unit.pageNumber ?? 1} 页` : '图片材料'}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      DOCX 仅提取正文；复杂排版、表格或嵌入图片重要时，请改传 PDF。
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <UnitAction
                    label="上移"
                    displayName={unit.displayName}
                    disabled={disabled || index === 0}
                    onClick={() => onMoveUnit(unit.id, -1)}
                  />
                  <UnitAction
                    label="下移"
                    displayName={unit.displayName}
                    disabled={disabled || index === units.length - 1}
                    onClick={() => onMoveUnit(unit.id, 1)}
                  />
                  <UnitAction
                    label="删除"
                    displayName={unit.displayName}
                    disabled={disabled}
                    tone="danger"
                    onClick={() => onRemoveUnit(unit.id)}
                  />
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}

interface UnitActionProps {
  label: '上移' | '下移' | '删除'
  displayName: string
  disabled: boolean
  tone?: 'default' | 'danger'
  onClick(): void
}

function UnitAction({ label, displayName, disabled, tone = 'default', onClick }: UnitActionProps) {
  return (
    <button
      type="button"
      aria-label={`${label} ${displayName}`}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md border bg-white px-3 py-1.5 text-xs font-semibold disabled:text-slate-300 ${
        tone === 'danger' ? 'border-rose-100 text-rose-700' : 'border-slate-200 text-slate-700'
      }`}
    >
      {label}
    </button>
  )
}
