import { describe, expect, it } from 'vitest'
import { matchTranscriptQuote } from './matchTranscriptQuote.js'

describe('matchTranscriptQuote', () => {
  it('returns an exact transcript slice for direct and collapsed-whitespace matches', () => {
    expect(matchTranscriptQuote('First line.\nSecond   line.', 'First line.')).toBe('First line.')
    expect(matchTranscriptQuote('First line.\nSecond   line.', 'Second line.')).toBe('Second   line.')
  })

  it('rejects empty and invented quotes', () => {
    expect(matchTranscriptQuote('First line.', '')).toBeNull()
    expect(matchTranscriptQuote('First line.', 'Invented line.')).toBeNull()
  })
})
