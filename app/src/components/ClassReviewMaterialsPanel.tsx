import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ClassReviewMaterial } from '../types'
import {
  classReviewMaterialTypeLabel,
  filterClassReviewMaterials,
  getVisibleClassReviewMaterialTabs,
  type ClassReviewMaterialTab,
} from '../utils/classReviewMaterials'
import { getSeverityImpactLabel } from '../utils/gradingDiagnostics'

interface ClassReviewMaterialsPanelProps {
  taskId: string
  materials: ClassReviewMaterial[]
  onRemoveMaterial: (materialId: string) => void
}

export function ClassReviewMaterialsPanel({
  taskId,
  materials,
  onRemoveMaterial,
}: ClassReviewMaterialsPanelProps) {
  const [activeTab, setActiveTab] = useState<ClassReviewMaterialTab>('all')
  const visibleTabs = useMemo(() => getVisibleClassReviewMaterialTabs(materials), [materials])
  const safeActiveTab = visibleTabs.some((tab) => tab.id === activeTab) ? activeTab : 'all'
  const filteredMaterials = filterClassReviewMaterials(materials, safeActiveTab)

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-950">教师精选讲评素材</h3>
          <p className="mt-1 text-sm text-slate-500">
            {materials.length > 0
              ? `共 ${materials.length} 条素材`
              : '还没有教师精选讲评素材。'}
          </p>
        </div>
        {materials.length > 0 ? (
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="讲评素材筛选">
            {visibleTabs.map((tab) => {
              const count = tab.id === 'all' ? materials.length : materials.filter((item) => item.type === tab.id).length
              const selected = safeActiveTab === tab.id

              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveTab(tab.id)}
                  className={[
                    'tech-focus rounded-lg border px-3 py-2 text-sm font-semibold transition',
                    selected
                      ? 'border-blue-200 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-cyan-200 hover:bg-cyan-50',
                  ].join(' ')}
                >
                  {tab.label} {count}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      {materials.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
          <p className="text-sm font-medium text-slate-600">你可以在单篇作文详情页中点击“加入班级总览”。</p>
          <p className="mt-1 text-sm text-slate-500">将典型问题、逻辑问题或表达提升加入这里。</p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          {filteredMaterials.map((material) => (
            <article key={material.id} className="rounded-lg border border-slate-100 bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800">
                    {classReviewMaterialTypeLabel[material.type]}
                  </span>
                  <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-700">
                    {material.categoryLabel}
                  </span>
                  {material.severity ? (
                    <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
                      {getSeverityImpactLabel(material.severity)}
                    </span>
                  ) : null}
                  {material.needsTeacherReview ? (
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                      建议教师复核
                    </span>
                  ) : null}
                </div>
                <p className="text-sm font-semibold text-slate-600">来源：{material.essayLabel}</p>
              </div>

              <dl className="mt-3 grid gap-2 text-sm">
                <div className="grid gap-1 md:grid-cols-[84px_minmax(0,1fr)]">
                  <dt className="text-xs font-semibold text-slate-500">原句</dt>
                  <dd className="text-slate-700">{material.original}</dd>
                </div>
                {material.revised ? (
                  <div className="grid gap-1 md:grid-cols-[84px_minmax(0,1fr)]">
                    <dt className="text-xs font-semibold text-slate-500">改法</dt>
                    <dd className="font-medium text-slate-950">{material.revised}</dd>
                  </div>
                ) : null}
                {material.diagnosis ? (
                  <div className="grid gap-1 md:grid-cols-[84px_minmax(0,1fr)]">
                    <dt className="text-xs font-semibold text-slate-500">诊断</dt>
                    <dd className="text-slate-700">{material.diagnosis}</dd>
                  </div>
                ) : null}
                {(material.explanation || material.teachingSuggestion) ? (
                  <div className="grid gap-1 md:grid-cols-[84px_minmax(0,1fr)]">
                    <dt className="text-xs font-semibold text-slate-500">讲评建议</dt>
                    <dd className="text-slate-600">{material.explanation ?? material.teachingSuggestion}</dd>
                  </div>
                ) : null}
              </dl>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  to={`/tasks/${taskId}/essays/${material.essayId}`}
                  className="tech-focus rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50"
                >
                  查看来源
                </Link>
                <button
                  type="button"
                  onClick={() => onRemoveMaterial(material.id)}
                  className="tech-focus rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                >
                  移除
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
