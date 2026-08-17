export interface TranscriptRange {
  start: number
  end: number
}

export const GRADING_REVIEW_REASONS = {
  scoreMismatch: 'AI 自报总分与产品重算总分不一致。',
  recognitionUncertain: 'recognition_uncertain',
  printedTextExclusionUncertain: 'printed_text_exclusion_uncertain',
} as const

export function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      if (index + 1 >= value.length) return false
      const next = value.charCodeAt(index + 1)
      if (next < 0xDC00 || next > 0xDFFF) return false
      index += 1
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      return false
    }
  }
  return true
}

export function exactUniqueTranscriptRange(transcript: string, quote: string): TranscriptRange | null {
  if (quote.length === 0 || !isWellFormedUnicode(transcript) || !isWellFormedUnicode(quote)) return null
  const start = transcript.indexOf(quote)
  if (start < 0 || transcript.indexOf(quote, start + 1) >= 0) return null
  return { start, end: start + quote.length }
}

export function transcriptRangesOverlap(left: TranscriptRange, right: TranscriptRange): boolean {
  return left.start < right.end && right.start < left.end
}

export function locateUniqueNonOverlappingTranscriptRanges(
  transcript: string,
  quotes: readonly string[],
): TranscriptRange[] | null {
  const ranges: TranscriptRange[] = []
  for (const quote of quotes) {
    const range = exactUniqueTranscriptRange(transcript, quote)
    if (!range || ranges.some((candidate) => transcriptRangesOverlap(range, candidate))) return null
    ranges.push(range)
  }
  return ranges
}

export function rebuildTranscriptFromEdits(
  transcript: string,
  edits: readonly { originalText: string; replacementText: string }[],
): string | null {
  const ranges = locateUniqueNonOverlappingTranscriptRanges(transcript, edits.map(({ originalText }) => originalText))
  if (!ranges || edits.some(({ replacementText }) => !replacementText.trim() || !isWellFormedUnicode(replacementText))) return null
  return edits
    .map((edit, index) => ({ ...ranges[index]!, replacementText: edit.replacementText }))
    .sort((left, right) => right.start - left.start)
    .reduce((result, edit) => result.slice(0, edit.start) + edit.replacementText + result.slice(edit.end), transcript)
}

export function hasOrderedTranscriptContext(
  transcript: string,
  originalText: string,
  contextBefore: string,
  contextAfter: string,
): boolean {
  const originalRange = exactUniqueTranscriptRange(transcript, originalText)
  const beforeRange = contextBefore ? exactUniqueTranscriptRange(transcript, contextBefore) : null
  const afterRange = contextAfter ? exactUniqueTranscriptRange(transcript, contextAfter) : null
  return originalRange !== null
    && (!contextBefore || (beforeRange !== null && beforeRange.end <= originalRange.start))
    && (!contextAfter || (afterRange !== null && afterRange.start >= originalRange.end))
}

export function hasDistinctNormalizedText(values: readonly string[]): boolean {
  const normalized = values.map((value) => value.trim().normalize('NFC'))
  return normalized.every((value) => value.length > 0) && new Set(normalized).size === normalized.length
}

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}_]/u.test(value)
}

export function containsBoundedTerm(value: string, term: string): boolean {
  let start = value.indexOf(term)
  while (start >= 0) {
    const end = start + term.length
    if (!isWordCharacter(value[start - 1]) && !isWordCharacter(value[end])) return true
    start = value.indexOf(term, start + 1)
  }
  return false
}

const LOCAL_LEGIBILITY_REFERENCE_CUES = /\b(?:ambiguous|ambiguity|change|changed|correct|corrected|correction|handwriting|illegible|legibility|read|readable|readability|reading|replace|replaced|uncertain|unclear|unreadable)\b|字迹|辨认|可读|难辨|不清/iu

export function narrativeExplicitlyReferencesLocalLegibility(
  value: string,
  legibilityIssues: readonly { transcriptText: string; possibleReadings: readonly string[] }[],
): boolean {
  if (!LOCAL_LEGIBILITY_REFERENCE_CUES.test(value)) return false
  return legibilityIssues.some(({ transcriptText, possibleReadings }) => (
    [transcriptText, ...possibleReadings].some((term) => containsBoundedTerm(value, term))
  ))
}
