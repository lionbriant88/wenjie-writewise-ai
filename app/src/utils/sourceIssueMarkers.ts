import type { ReviewIssueCardItem } from './reviewIssueItems'
import { findTextMatch } from './textHighlight'

export interface SourceIssueMarker {
  issueId: string
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

function shouldReplaceMarker(current: SourceIssueMarker, next: SourceIssueMarker) {
  return severityRank[next.severity] > severityRank[current.severity]
}

export function buildSourceIssueMarkers(sourceText: string, issues: ReviewIssueCardItem[]): SourceIssueMarker[] {
  const markerByRange = new Map<string, SourceIssueMarker>()

  for (const issue of issues) {
    const match = findTextMatch(sourceText, issue.original)

    if (!match) {
      continue
    }

    const marker: SourceIssueMarker = {
      issueId: issue.id,
      source: issue.source,
      severity: issue.severity,
      original: issue.original,
      matchedText: match.matchedText,
      start: match.start,
      end: match.end,
    }
    const rangeKey = `${marker.start}:${marker.end}`
    const current = markerByRange.get(rangeKey)

    if (!current || shouldReplaceMarker(current, marker)) {
      markerByRange.set(rangeKey, marker)
    }
  }

  return [...markerByRange.values()].sort((first, second) => first.start - second.start)
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
