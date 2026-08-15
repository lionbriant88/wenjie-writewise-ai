/**
 * Parses a provider quote without altering it and establishes a single,
 * exact location in the confirmed transcript. Quote-bearing provider fields
 * must use this boundary rather than the permissive display matcher.
 */
export function strictlyGroundTranscriptQuote(transcript: string, value: unknown, maxLength = 10_000): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return null
  return exactUniqueTranscriptRange(transcript, value) ? value : null
}
import { exactUniqueTranscriptRange } from './multimodal/transcriptRange.js'
