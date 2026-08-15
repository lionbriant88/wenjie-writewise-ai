export interface TranscriptRange {
  start: number
  end: number
}

export function exactUniqueTranscriptRange(transcript: string, quote: string): TranscriptRange | null {
  if (quote.length === 0) return null
  const start = transcript.indexOf(quote)
  if (start < 0 || transcript.indexOf(quote, start + 1) >= 0) return null
  return { start, end: start + quote.length }
}

export function transcriptRangesOverlap(left: TranscriptRange, right: TranscriptRange): boolean {
  return left.start < right.end && right.start < left.end
}
