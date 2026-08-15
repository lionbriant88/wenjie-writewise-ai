import { describe, expect, it } from 'vitest'
import { exactUniqueTranscriptRange, transcriptRangesOverlap } from './transcriptRange.js'

describe('exactUniqueTranscriptRange', () => {
  it('grounds and overlaps a complete astral symbol without exposing half-surrogate ranges', () => {
    const emoji = exactUniqueTranscriptRange('A😀B', '😀')
    expect(emoji).toEqual({ start: 1, end: 3 })
    expect(transcriptRangesOverlap(emoji!, { start: 1, end: 3 })).toBe(true)
    expect(exactUniqueTranscriptRange('A😀B', '\uD83D')).toBeNull()
    expect(exactUniqueTranscriptRange('A😀B', '\uDE00')).toBeNull()
  })

  it.each(['\uD83D', '\uDE00'])('rejects an ill-formed transcript or quote containing %s', (surrogate) => {
    expect(exactUniqueTranscriptRange(`A${surrogate}B`, surrogate)).toBeNull()
    expect(exactUniqueTranscriptRange('A😀B', surrogate)).toBeNull()
  })

  it('rejects a repeated astral quote', () => {
    expect(exactUniqueTranscriptRange('😀 and 😀', '😀')).toBeNull()
  })
})
