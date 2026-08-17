import { describe, expect, it } from 'vitest'
import type { ReviewIssueCardItem } from './reviewIssueItems'
import { buildSourceIssueMarkers, splitTextByIssueMarkers } from './sourceIssueMarkers'
import { findTextMatch } from './textHighlight'

const issues: ReviewIssueCardItem[] = [
  {
    id: 'language-1',
    source: 'language',
    typeLabel: 'grammar',
    severity: 'high',
    original: 'I suggest you joins the club.',
    suggestion: 'I suggest you join the club.',
    explanation: 'suggest 后使用动词原形。',
  },
  {
    id: 'logic-1',
    source: 'logic',
    typeLabel: '上下文关联度差',
    severity: 'medium',
    original: 'My mother was angry.',
    diagnosis: '上下文关联度差。',
    suggestedActionLabel: '建议学生补充说明',
  },
  {
    id: 'missing-1',
    source: 'language',
    typeLabel: 'spelling',
    severity: 'low',
    original: 'not in source',
    suggestion: 'not in source',
    explanation: 'missing',
  },
]

describe('sourceIssueMarkers', () => {
  it('uses findTextMatch as a stable batchable pure matcher', () => {
    const source = 'A sentence. I suggest you joins the club.'
    const first = findTextMatch(source, 'I suggest you joins the club.')
    const second = findTextMatch(source, 'I suggest you joins the club.')

    expect(first).toEqual(second)
    expect(source).toBe('A sentence. I suggest you joins the club.')
  })

  it('builds language and logic markers from matched review issues only', () => {
    const source = 'I suggest you joins the club. My mother was angry.'
    const markers = buildSourceIssueMarkers(source, issues)

    expect(markers).toHaveLength(2)
    expect(markers[0]).toMatchObject({
      issueId: 'language-1',
      source: 'language',
      severity: 'high',
      matchedText: 'I suggest you joins the club.',
    })
    expect(markers[1]).toMatchObject({
      issueId: 'logic-1',
      source: 'logic',
      severity: 'medium',
      matchedText: 'My mother was angry.',
    })
    expect(markers.some((marker) => marker.issueId === 'missing-1')).toBe(false)
  })

  it('keeps one source marker for duplicated sentence matches without changing the issue list', () => {
    const duplicateIssues: ReviewIssueCardItem[] = [
      { ...issues[1], id: 'logic-low', severity: 'low', original: 'My mother was angry.' },
      { ...issues[1], id: 'logic-high', severity: 'high', original: 'My mother was angry.' },
    ]

    const markers = buildSourceIssueMarkers('My mother was angry.', duplicateIssues)

    expect(markers).toHaveLength(1)
    expect(markers[0].issueId).toBe('logic-high')
    expect(markers[0].issueIds).toEqual(['logic-low', 'logic-high'])
    expect(duplicateIssues).toHaveLength(2)
  })

  it('splits source text into normal and issue marker parts', () => {
    const source = 'Before. I suggest you joins the club. After.'
    const markers = buildSourceIssueMarkers(source, [issues[0]])
    const parts = splitTextByIssueMarkers(source, markers)

    expect(parts).toEqual([
      { text: 'Before. ', marker: null },
      { text: 'I suggest you joins the club.', marker: markers[0] },
      { text: ' After.', marker: null },
    ])
  })

  it('segments nested issue ranges without dropping either issue id', () => {
    const source = 'Before outer inner tail after.'
    const nestedIssues: ReviewIssueCardItem[] = [
      {
        id: 'outer-high', source: 'language', typeLabel: 'structure', severity: 'high',
        original: 'outer inner tail', suggestion: 'outer revised tail', explanation: 'Outer issue.',
      },
      {
        id: 'inner-medium', source: 'logic', typeLabel: 'unclear_logic', severity: 'medium',
        original: 'inner', diagnosis: 'Inner issue.', suggestedActionLabel: 'Clarify it.',
      },
    ]

    const markers = buildSourceIssueMarkers(source, nestedIssues)

    expect(markers.map(({ matchedText, issueId, issueIds }) => ({ matchedText, issueId, issueIds }))).toEqual([
      { matchedText: 'outer ', issueId: 'outer-high', issueIds: ['outer-high'] },
      { matchedText: 'inner', issueId: 'outer-high', issueIds: ['outer-high', 'inner-medium'] },
      { matchedText: ' tail', issueId: 'outer-high', issueIds: ['outer-high'] },
    ])
    expect(splitTextByIssueMarkers(source, markers).map(({ text }) => text).join('')).toBe(source)
  })
})
