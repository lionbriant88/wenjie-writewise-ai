import type { RawRecognitionWarningV1 } from './types.js'
import { isWellFormedUnicode } from './transcriptRange.js'

const MAX_PAGES = 10
const MAX_ANNOTATIONS = 8
const MAX_ANNOTATION_LENGTH = 160
const BODY_STATUSES = new Set(['complete', 'clipped', 'unreadable', 'boundary_uncertain'])

interface Context { pageCount: number; transcript: string; confirmedTranscript?: string }

/** Page observations are provider-internal; only bounded, fixed warnings cross the v2 boundary. */
export function normalizePageAssessments(value: unknown, context: Context): {
  warnings: RawRecognitionWarningV1[]; degraded: boolean
} {
  // Historical stored/fake payloads predate this field. Both current provider schemas require it.
  if (value === undefined) return { warnings: [], degraded: false }
  if (context.confirmedTranscript !== undefined) {
    return { warnings: [], degraded: !Array.isArray(value) || value.length !== 0 }
  }
  const warnings: RawRecognitionWarningV1[] = []
  const seen = new Set<number>()
  const transcriptLines = new Set(context.transcript.split(/\r?\n/u).map(line => line.trim()).filter(Boolean))
  let degraded = !Array.isArray(value) || value.length !== context.pageCount || context.pageCount > MAX_PAGES
  for (const item of (Array.isArray(value) ? value.slice(0, MAX_PAGES) : [])) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) { degraded = true; continue }
    const row = item as Record<string, unknown>
    const pageNumber = row.pageNumber
    if (Object.keys(row).length !== 3
      || !['pageNumber', 'bodyStatus', 'excludedAnnotations'].every(key => key in row)
      || typeof pageNumber !== 'number' || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > context.pageCount
      || seen.has(pageNumber) || typeof row.bodyStatus !== 'string' || !BODY_STATUSES.has(row.bodyStatus)
      || !Array.isArray(row.excludedAnnotations) || row.excludedAnnotations.length > MAX_ANNOTATIONS
      || row.excludedAnnotations.some(annotation => typeof annotation !== 'string' || !annotation.trim()
        || annotation.length > MAX_ANNOTATION_LENGTH || !isWellFormedUnicode(annotation))) {
      degraded = true
      continue
    }
    seen.add(pageNumber)
    if (row.bodyStatus === 'clipped') warnings.push({
      scope: 'image_clipped',
      message: `第 ${pageNumber} 页作文正文在图片边缘被截断，请补拍完整页面；缺失内容不能作为可靠识别结果。`,
    })
    if (row.bodyStatus === 'unreadable') warnings.push({
      scope: 'global_unreadable', message: `第 ${pageNumber} 页有无法可靠识别的正文，请核对原图或重新拍摄。`,
    })
    if (row.bodyStatus === 'boundary_uncertain') warnings.push({
      scope: 'printed_boundary', message: `第 ${pageNumber} 页的作文正文范围不明确，请核对正文边界。`,
    })
    if ((row.excludedAnnotations as string[]).some(annotation => transcriptLines.has(annotation.trim()))) {
      warnings.push({ scope: 'printed_boundary', message: `第 ${pageNumber} 页标记为非正文的内容仍出现在识别正文中，请核对正文边界。` })
    }
  }
  if (seen.size !== context.pageCount) degraded = true
  if (degraded) warnings.push({ scope: 'printed_boundary', message: '图片完整性检查未覆盖全部作文页，请结合原图核对。' })
  return { warnings, degraded }
}
