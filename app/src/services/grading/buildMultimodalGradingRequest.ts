import type { Essay, Task } from '../../types'
import { hasValidRubricWeights } from './scoringRules'
import type { ConfirmedTaskPackageV2, MultimodalGradingRequestV2 } from './types'

export type BuildMultimodalGradingRequestResult =
  | { ok: true; request: MultimodalGradingRequestV2 }
  | { ok: false; error: { code: 'invalid_request'; message: string } }

function invalid(message: string): BuildMultimodalGradingRequestResult {
  return { ok: false, error: { code: 'invalid_request', message } }
}

export function buildMultimodalGradingRequest(
  task: Task,
  essay: Essay,
  requestId: string,
): BuildMultimodalGradingRequestResult {
  const material = task.materialContext
  const rubric = task.rubricDraft
  if (!requestId.trim() || !material || rubric?.status !== 'confirmed' || !Number.isInteger(task.fullScore) || task.fullScore < 1 || task.fullScore > 100) {
    return invalid('题目材料或评分标准尚未确认。')
  }
  if (!material.materialSummary.trim() || !material.writingRequirements.length || !rubric.dimensions.length || !hasValidRubricWeights(rubric.dimensions.map(({ weight }) => weight))) {
    return invalid('题目材料或评分标准尚未确认。')
  }
  if (rubric.dimensions.some((dimension) => !dimension.id.trim() || !dimension.name.trim() || !dimension.description.trim() || !dimension.sourceEvidence?.some((item) => item.trim()))) {
    return invalid('题目材料或评分标准尚未确认。')
  }
  if (!essay.pageOrder.length || new Set(essay.pageOrder).size !== essay.pageOrder.length) return invalid('作文图片不可用。')
  const pagesById = new Map(essay.pages.map((page) => [page.id, page]))
  const pages = essay.pageOrder.map((pageId) => {
    const page = pagesById.get(pageId)
    return page?.sourceFile ? { pageId, file: page.sourceFile } : null
  })
  if (pages.some((page) => page === null) || pages.length !== essay.pages.length) return invalid('作文图片不可用。')

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
  return { ok: true, request: { requestVersion: 'multimodal-grading-request-v2', requestId, essayId: essay.id, pageIds: [...essay.pageOrder], task: confirmedTask, pages: pages as Array<{ pageId: string; file: File }> } }
}
