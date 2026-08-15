export interface TranscriptRange {
  start: number
  end: number
}

function isWellFormedUnicode(value: string): boolean {
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
