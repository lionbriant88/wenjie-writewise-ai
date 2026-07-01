import { describe, expect, it } from 'vitest'
import { findTextMatch, splitTextByMatch } from './textHighlight'

describe('textHighlight helpers', () => {
  it('finds an exact source text match', () => {
    const match = findTextMatch('I suggest you joins the club.', 'you joins')

    expect(match).toEqual({
      start: 10,
      end: 19,
      matchedText: 'you joins',
    })
  })

  it('matches when the target has leading or trailing spaces', () => {
    const match = findTextMatch('I suggest you joins the club.', '  I suggest you joins the club.  ')

    expect(match?.matchedText).toBe('I suggest you joins the club.')
  })

  it('returns null for missing source or target text', () => {
    expect(findTextMatch('', 'you joins')).toBeNull()
    expect(findTextMatch('I suggest you joins the club.', '')).toBeNull()
    expect(findTextMatch('I suggest you joins the club.', '   ')).toBeNull()
  })

  it('returns null when the target text cannot be located', () => {
    expect(findTextMatch('The original essay has no spelling error.', 'enviroment')).toBeNull()
  })

  it('splits source text into before, highlighted, and after parts', () => {
    const sourceText = 'I suggest you joins the club.'
    const match = findTextMatch(sourceText, 'you joins')

    expect(splitTextByMatch(sourceText, match)).toEqual([
      { text: 'I suggest ', highlighted: false },
      { text: 'you joins', highlighted: true },
      { text: ' the club.', highlighted: false },
    ])
  })

  it('returns one plain part when there is no match', () => {
    expect(splitTextByMatch('Keep this text plain.', null)).toEqual([
      { text: 'Keep this text plain.', highlighted: false },
    ])
  })

  it('preserves newline text around the highlighted part', () => {
    const sourceText = 'Dear Peter,\nI suggest you joins the club.\nBest wishes.'
    const match = findTextMatch(sourceText, 'I suggest you joins the club.')

    expect(splitTextByMatch(sourceText, match)).toEqual([
      { text: 'Dear Peter,\n', highlighted: false },
      { text: 'I suggest you joins the club.', highlighted: true },
      { text: '\nBest wishes.', highlighted: false },
    ])
  })
})
