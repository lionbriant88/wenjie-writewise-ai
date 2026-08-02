import type { Essay, Task } from '../../types'
import type { ConfirmedTaskPackageV2, MultimodalGradingRequestV2 } from './types'

export type BuildMultimodalGradingRequestResult =
  | { ok: true; request: MultimodalGradingRequestV2 }
  | { ok: false; error: { code: 'invalid_request'; message: string } }

function invalid(message: string): BuildMultimodalGradingRequestResult {
  return { ok: false, error: { code: 'invalid_request', message } }
}

const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
const maxImageBytes = 8 * 1024 * 1024
const validText = (value: unknown, max = 10_000) => typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= max
const validTextArray = (value: unknown) => Array.isArray(value) && value.every((item) => validText(item))
const validIds = (value: string[]) => value.every((id) => validText(id, 128)) && new Set(value).size === value.length
const validWeights = (weights: number[]) => weights.length > 0 && weights.every((weight) => Number.isFinite(weight) && weight > 0 && weight <= 100) && Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 100) <= 0.001

export function buildMultimodalGradingRequest(
  task: Task,
  essay: Essay,
  requestId: string,
): BuildMultimodalGradingRequestResult {
  const material = task.materialContext
  const rubric = task.rubricDraft
  if (!validText(requestId, 128) || !validText(task.id, 128) || !validText(essay.id, 128) || essay.taskId !== task.id || !material || rubric?.status !== 'confirmed' || !Number.isInteger(task.fullScore) || task.fullScore < 1 || task.fullScore > 100) {
    return invalid('题目材料或评分标准尚未确认。')
  }
  if (!validText(task.taskName) || !validText(material.materialSummary) || !material.writingRequirements.length || !validTextArray(material.writingRequirements) || !validTextArray(material.constraints) || !validTextArray(material.reviewWarnings) || !rubric.dimensions.length || rubric.dimensions.length > 10 || !validWeights(rubric.dimensions.map(({ weight }) => weight))) {
    return invalid('题目材料或评分标准尚未确认。')
  }
  if (new Set(rubric.dimensions.map((dimension) => dimension.id)).size !== rubric.dimensions.length || rubric.dimensions.some((dimension) => !validText(dimension.id, 128) || !validText(dimension.name) || !validText(dimension.description) || !validTextArray(dimension.deductionFocus) || !validTextArray(dimension.sourceEvidence))) {
    return invalid('题目材料或评分标准尚未确认。')
  }
  const confirmedTranscript = essay.transcriptSource === 'teacher_confirmed' ? essay.ocrText : undefined
  if (confirmedTranscript !== undefined && (!confirmedTranscript.trim() || confirmedTranscript.length > 50_000)) {
    return invalid('Teacher-confirmed transcript is unavailable.')
  }
  let pageIds: string[] = []
  let pages: Array<{ pageId: string; file: File }> = []
  if (confirmedTranscript === undefined) {
    if (essay.pageOrder.length < 1 || essay.pageOrder.length > 10 || essay.pages.length !== essay.pageOrder.length || !validIds(essay.pageOrder)) return invalid('作文图片不可用。')
    const pagesById = new Map(essay.pages.map((page) => [page.id, page]))
    const orderedPages = essay.pageOrder.map((pageId) => {
      const page = pagesById.get(pageId)
      return page?.sourceFile instanceof File && imageTypes.has(page.sourceFile.type) && page.sourceFile.size <= maxImageBytes ? { pageId, file: page.sourceFile } : null
    })
    if (orderedPages.some((page) => page === null) || orderedPages.length !== essay.pages.length) return invalid('作文图片不可用。')
    pageIds = [...essay.pageOrder]
    pages = orderedPages as Array<{ pageId: string; file: File }>
  }

  const confirmedTask: ConfirmedTaskPackageV2 = {
    taskId: task.id,
    fullScore: task.fullScore,
    materialSummary: material.materialSummary,
    writingRequirements: [...material.writingRequirements],
    constraints: [...material.constraints],
    rubric: {
      taskName: task.taskName,
      materialSummary: material.materialSummary,
      writingRequirements: [...material.writingRequirements],
      constraints: [...material.constraints],
      dimensions: rubric.dimensions.map((dimension) => ({
        id: dimension.id, name: dimension.name, weight: dimension.weight, description: dimension.description,
        deductionFocus: [...dimension.deductionFocus], sourceEvidence: [...(dimension.sourceEvidence ?? [])],
      })),
      reviewWarnings: [...material.reviewWarnings],
    },
  }
  return { ok: true, request: {
    requestVersion: 'multimodal-grading-request-v2', requestId, essayId: essay.id, pageIds, task: confirmedTask, pages,
    ...(confirmedTranscript !== undefined ? { confirmedTranscript } : {}),
  } }
}
