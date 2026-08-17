import type { Essay, Task } from '../../types'
import { buildConfirmedTaskPackage } from './buildConfirmedTaskPackage'
import { isWellFormedUnicode } from './gradingResultSemantics'
import type { MultimodalGradingRequestV2 } from './types'

export type BuildMultimodalGradingRequestResult =
  | { ok: true; request: MultimodalGradingRequestV2 }
  | { ok: false; error: { code: 'invalid_request'; message: string } }

function invalid(message: string): BuildMultimodalGradingRequestResult {
  return { ok: false, error: { code: 'invalid_request', message } }
}

const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
const maxImageBytes = 8 * 1024 * 1024
const validText = (value: unknown, max = 10_000) => typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= max
const validIds = (value: string[]) => value.every((id) => validText(id, 128)) && new Set(value).size === value.length

export function buildMultimodalGradingRequest(
  task: Task,
  essay: Essay,
  requestId: string,
): BuildMultimodalGradingRequestResult {
  const confirmedTask = buildConfirmedTaskPackage(task)
  if (!validText(requestId, 128) || !validText(essay.id, 128) || essay.taskId !== task.id || !confirmedTask) {
    return invalid('题目材料或评分标准尚未确认。')
  }
  const confirmedTranscript = essay.transcriptSource === 'teacher_confirmed' ? essay.ocrText : undefined
  if (confirmedTranscript !== undefined && (!confirmedTranscript.trim() || confirmedTranscript.length > 50_000 || !isWellFormedUnicode(confirmedTranscript))) {
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

  return { ok: true, request: {
    requestVersion: 'multimodal-grading-request-v2', requestId, essayId: essay.id, pageIds, task: confirmedTask, pages,
    ...(confirmedTranscript !== undefined ? { confirmedTranscript } : {}),
  } }
}
