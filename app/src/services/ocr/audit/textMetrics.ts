export const OCR_TEXT_METRICS_VERSION = 'ocr-text-metrics-v1' as const

export type OcrTextMetricsVersion = typeof OCR_TEXT_METRICS_VERSION

export interface OcrReviewTextMetrics {
  metricsVersion: OcrTextMetricsVersion
  actualTeacherAction: 'confirmed_without_edit' | 'confirmed_after_edit'
  editDistance: number
  changedCharacterCount: number
  confirmedAt: string
}

export interface OcrBenchmarkMetrics {
  metricsVersion: OcrTextMetricsVersion
  cer: number | null
  wer: number | null
  invalidReason?: 'empty_reference'
}

interface EditBreakdown {
  distance: number
  insertions: number
  deletions: number
  substitutions: number
}

export function toMetricProjection(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\u00a0]/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function calculateEditBreakdown<T>(source: readonly T[], target: readonly T[]): EditBreakdown {
  const rows = source.length + 1
  const columns = target.length + 1
  const costs = Array.from({ length: rows }, () => Array<number>(columns).fill(0))

  for (let row = 1; row < rows; row += 1) costs[row][0] = row
  for (let column = 1; column < columns; column += 1) costs[0][column] = column

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const substitutionCost = Object.is(source[row - 1], target[column - 1]) ? 0 : 1
      costs[row][column] = Math.min(
        costs[row - 1][column] + 1,
        costs[row][column - 1] + 1,
        costs[row - 1][column - 1] + substitutionCost,
      )
    }
  }

  let row = source.length
  let column = target.length
  let insertions = 0
  let deletions = 0
  let substitutions = 0

  while (row > 0 || column > 0) {
    if (
      row > 0 &&
      column > 0 &&
      Object.is(source[row - 1], target[column - 1]) &&
      costs[row][column] === costs[row - 1][column - 1]
    ) {
      row -= 1
      column -= 1
      continue
    }

    if (row > 0 && column > 0 && costs[row][column] === costs[row - 1][column - 1] + 1) {
      substitutions += 1
      row -= 1
      column -= 1
      continue
    }

    if (row > 0 && costs[row][column] === costs[row - 1][column] + 1) {
      deletions += 1
      row -= 1
      continue
    }

    insertions += 1
    column -= 1
  }

  return {
    distance: costs[source.length][target.length],
    insertions,
    deletions,
    substitutions,
  }
}

function codePoints(text: string): string[] {
  return Array.from(text)
}

function wordTokens(text: string): string[] {
  return text.length === 0 ? [] : text.split(/\s+/u)
}

export function calculateReviewTextMetrics(
  sourceText: string,
  confirmedTranscript: string,
  confirmedAt: string,
): OcrReviewTextMetrics {
  const source = codePoints(toMetricProjection(sourceText))
  const confirmed = codePoints(toMetricProjection(confirmedTranscript))
  const edits = calculateEditBreakdown(source, confirmed)

  return {
    metricsVersion: OCR_TEXT_METRICS_VERSION,
    actualTeacherAction: edits.distance === 0 ? 'confirmed_without_edit' : 'confirmed_after_edit',
    editDistance: edits.distance,
    changedCharacterCount: edits.insertions + edits.deletions + edits.substitutions,
    confirmedAt,
  }
}

export function calculateBenchmarkMetrics(ocrText: string, referenceText: string): OcrBenchmarkMetrics {
  const ocrProjection = toMetricProjection(ocrText)
  const referenceProjection = toMetricProjection(referenceText)
  const referenceCharacters = codePoints(referenceProjection)
  const referenceWords = wordTokens(referenceProjection)

  if (referenceCharacters.length === 0 || referenceWords.length === 0) {
    return {
      metricsVersion: OCR_TEXT_METRICS_VERSION,
      cer: null,
      wer: null,
      invalidReason: 'empty_reference',
    }
  }

  const characterEdits = calculateEditBreakdown(codePoints(ocrProjection), referenceCharacters)
  const wordEdits = calculateEditBreakdown(wordTokens(ocrProjection), referenceWords)

  return {
    metricsVersion: OCR_TEXT_METRICS_VERSION,
    cer: characterEdits.distance / referenceCharacters.length,
    wer: wordEdits.distance / referenceWords.length,
  }
}
