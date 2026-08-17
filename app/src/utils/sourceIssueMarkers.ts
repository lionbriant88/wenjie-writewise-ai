import type { ReviewIssueCardItem } from './reviewIssueItems'
import { findTextMatch } from './textHighlight'

export interface SourceIssueMarker {
  issueId: string
  issueIds: string[]
  source: ReviewIssueCardItem['source']
  severity: ReviewIssueCardItem['severity']
  original: string
  matchedText: string
  start: number
  end: number
}

export interface SourceIssueMarkerPart {
  text: string
  marker: SourceIssueMarker | null
}

const severityRank: Record<ReviewIssueCardItem['severity'], number> = {
  low: 1,
  medium: 2,
  high: 3,
}

export function buildSourceIssueMarkers(sourceText: string, issues: ReviewIssueCardItem[]): SourceIssueMarker[] {
  const matchedIssues: Array<{ marker: SourceIssueMarker; order: number }> = []

  for (const [order, issue] of issues.entries()) {
    const match = findTextMatch(sourceText, issue.original)

    if (!match) {
      continue
    }

    matchedIssues.push({
      order,
      marker: {
        issueId: issue.id,
        issueIds: [issue.id],
        source: issue.source,
        severity: issue.severity,
        original: issue.original,
        matchedText: match.matchedText,
        start: match.start,
        end: match.end,
      },
    })
  }

  const boundaries = [...new Set(matchedIssues.flatMap(({ marker }) => [marker.start, marker.end]))]
    .sort((first, second) => first - second)

  return boundaries.slice(0, -1).flatMap((start, index) => {
    const end = boundaries[index + 1]
    const coveringIssues = matchedIssues.filter(({ marker }) => marker.start < end && marker.end > start)

    if (coveringIssues.length === 0) return []

    const primary = coveringIssues.reduce((current, next) => {
      const severityDifference = severityRank[next.marker.severity] - severityRank[current.marker.severity]
      return severityDifference > 0 || (severityDifference === 0 && next.order < current.order) ? next : current
    })
    const issueIds = [...new Set(coveringIssues
      .sort((first, second) => first.order - second.order)
      .map(({ marker }) => marker.issueId))]

    return [{
      ...primary.marker,
      issueIds,
      matchedText: sourceText.slice(start, end),
      start,
      end,
    }]
  })
}

export function splitTextByIssueMarkers(sourceText: string, markers: SourceIssueMarker[]): SourceIssueMarkerPart[] {
  if (markers.length === 0) {
    return [{ text: sourceText, marker: null }]
  }

  const parts: SourceIssueMarkerPart[] = []
  let cursor = 0

  for (const marker of markers) {
    if (marker.start < cursor) {
      continue
    }

    if (marker.start > cursor) {
      parts.push({ text: sourceText.slice(cursor, marker.start), marker: null })
    }

    parts.push({ text: sourceText.slice(marker.start, marker.end), marker })
    cursor = marker.end
  }

  if (cursor < sourceText.length) {
    parts.push({ text: sourceText.slice(cursor), marker: null })
  }

  return parts.filter((part) => part.text.length > 0)
}
