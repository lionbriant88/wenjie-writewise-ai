import { useEffect, useMemo, useRef, useState } from 'react'
import { Image } from 'lucide-react'
import type { Essay } from '../types'
import { formatConfidence } from '../utils/gradingDiagnostics'
import type { SourceIssueMarker } from '../utils/sourceIssueMarkers'
import { splitTextByIssueMarkers } from '../utils/sourceIssueMarkers'
import { findTextMatch, splitTextByMatch } from '../utils/textHighlight'

type SourcePanelMode = 'read' | 'edit'

const SOURCE_PANEL_MODE_OPTIONS: Array<{ mode: SourcePanelMode; label: string }> = [
  { mode: 'read', label: '阅读定位' },
  { mode: 'edit', label: '编辑 OCR' },
]

interface EssaySourcePanelProps {
  essay: Essay
  activeHighlightText?: string
  issueMarkers?: SourceIssueMarker[]
  activeIssueId?: string | null
  onIssueMarkerSelect?: (issueId: string) => void
  onOcrTextChange: (essayId: string, nextText: string) => void
  onViewOriginalImage: () => void
}

export function EssaySourcePanel({
  essay,
  activeHighlightText,
  issueMarkers = [],
  activeIssueId,
  onIssueMarkerSelect,
  onOcrTextChange,
  onViewOriginalImage,
}: EssaySourcePanelProps) {
  const [mode, setMode] = useState<SourcePanelMode>('read')
  const highlightedRef = useRef<HTMLElement | null>(null)
  const match = useMemo(
    () => findTextMatch(essay.ocrText, activeHighlightText ?? ''),
    [activeHighlightText, essay.ocrText],
  )
  const highlightParts = useMemo(() => splitTextByMatch(essay.ocrText, match), [essay.ocrText, match])
  const markerParts = useMemo(() => splitTextByIssueMarkers(essay.ocrText, issueMarkers), [essay.ocrText, issueMarkers])
  const hasIssueMarkers = issueMarkers.length > 0
  const shouldShowFallback = Boolean(activeHighlightText) && !match
  const setHighlightedElement = (element: HTMLElement | null) => {
    highlightedRef.current = element
  }

  useEffect(() => {
    highlightedRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }, [activeIssueId, match])

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-950">学生作文原文</h3>
          <p className="mt-1 text-xs font-semibold text-amber-700">
            OCR 置信度 {formatConfidence(essay.ocrConfidence)}
          </p>
        </div>
        <button
          type="button"
          onClick={onViewOriginalImage}
          className="tech-focus inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50"
        >
          <Image className="h-4 w-4" />
          查看原图
        </button>
      </div>
      <div className="mt-4 inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
        {SOURCE_PANEL_MODE_OPTIONS.map((modeOption) => (
          <button
            key={modeOption.mode}
            type="button"
            onClick={() => setMode(modeOption.mode)}
            className={`tech-focus rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              mode === modeOption.mode ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {modeOption.label}
          </button>
        ))}
      </div>
      {mode === 'edit' ? (
        <textarea
          aria-label="学生作文原文"
          value={essay.ocrText}
          onChange={(event) => onOcrTextChange(essay.id, event.target.value)}
          className="mt-4 min-h-[320px] w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-800 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
        />
      ) : (
        <div className="mt-4 max-h-[520px] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
          {shouldShowFallback ? (
            <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              未在原文中精确定位，请手动核对
            </p>
          ) : null}
          <p className="whitespace-pre-wrap text-sm leading-7 text-slate-800">
            {hasIssueMarkers
              ? markerParts.map((part, index) => {
                  if (!part.marker) {
                    return <span key={`${part.text}-${index}`}>{part.text}</span>
                  }

                  const marker = part.marker
                  const isActive = marker.issueId === activeIssueId
                  const markerTone =
                    marker.source === 'logic'
                      ? isActive
                        ? 'bg-amber-100 text-amber-950 ring-1 ring-amber-200'
                        : 'bg-amber-50 text-slate-800 hover:bg-amber-100'
                      : isActive
                        ? 'bg-cyan-100 text-cyan-950 ring-1 ring-cyan-200'
                        : 'bg-cyan-50 text-slate-800 hover:bg-cyan-100'

                  return (
                    <button
                      key={`${part.text}-${index}`}
                      ref={isActive ? setHighlightedElement : undefined}
                      type="button"
                      aria-label={`查看问题：${marker.matchedText}`}
                      data-active={isActive ? 'true' : 'false'}
                      data-issue-source={marker.source}
                      onClick={() => onIssueMarkerSelect?.(marker.issueId)}
                      className={`tech-focus inline rounded-sm px-0.5 text-left align-baseline transition ${markerTone}`}
                    >
                      {part.text}
                    </button>
                  )
                })
              : highlightParts.map((part, index) =>
                  part.highlighted ? (
                    <mark
                      key={`${part.text}-${index}`}
                      ref={setHighlightedElement}
                      className="rounded bg-amber-100 px-1 font-semibold text-amber-800"
                    >
                      {part.text}
                    </mark>
                  ) : (
                    <span key={`${part.text}-${index}`}>{part.text}</span>
                  ),
                )}
          </p>
        </div>
      )}
    </div>
  )
}
