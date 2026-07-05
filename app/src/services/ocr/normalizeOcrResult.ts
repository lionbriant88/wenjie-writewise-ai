import type { OcrEssayResult } from './types'

export function normalizeOcrResult(result: OcrEssayResult): OcrEssayResult {
  const pageWarnings = result.pages.flatMap((page) => page.warnings ?? [])
  const warnings = [...new Set([...(result.warnings ?? []), ...pageWarnings])]

  return {
    ...result,
    text: (result.text ?? '').trim(),
    pages: result.pages.map((page) => ({
      ...page,
      text: (page.text ?? '').trim(),
    })),
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

export function buildOcrDraftsFromResults(results: OcrEssayResult[], visibleGroupIds: string[]) {
  const resultByGroupId = new Map(results.map((result) => [result.essayGroupId, normalizeOcrResult(result)]))

  return visibleGroupIds.map((groupId) => resultByGroupId.get(groupId)?.text ?? '')
}

export function hasEmptyTextWarning(results: OcrEssayResult[]) {
  return results.some((result) => normalizeOcrResult(result).warnings?.includes('empty_text'))
}
