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
  { mode: 'edit', label: '复核识别结果' },
]

interface EssaySourcePanelProps {
  essay: Essay
  activeHighlightText?: string
  issueMarkers?: SourceIssueMarker[]
  activeIssueId?: string | null
  transcriptionWarnings?: string[]
  printedTextExcluded?: boolean
  onIssueMarkerSelect?: (issueId: string) => void
  onOcrTextChange: (essayId: string, nextText: string) => void
  onViewOriginalImage: () => void
}

export function EssaySourcePanel({
  essay,
  activeHighlightText,
  issueMarkers = [],
  activeIssueId,
  transcriptionWarnings = [],
  printedTextExcluded,
  onIssueMarkerSelect,
  onOcrTextChange,
  onViewOriginalImage,
}: EssaySourcePanelProps) {
  const [mode, setMode] = useState<SourcePanelMode>('read')
  const [draftText, setDraftText] = useState(essay.ocrText)
  const currentEssayIdRef = useRef(essay.id)
  const highlightedRef = useRef<HTMLElement | null>(null)
  const match = useMemo(
    () => findTextMatch(essay.ocrText, activeHighlightText ?? ''),
    [activeHighlightText, essay.ocrText],
  )
  const highlightParts = useMemo(() => splitTextByMatch(essay.ocrText, match), [essay.ocrText, match])
  const markerParts = useMemo(() => splitTextByIssueMarkers(essay.ocrText, issueMarkers), [essay.ocrText, issueMarkers])
  const hasIssueMarkers = issueMarkers.length > 0
  const shouldShowFallback = Boolean(activeHighlightText) && !match
  const hasChangedDraft = draftText !== essay.ocrText
  const isGrading = essay.status === 'grading' || essay.gradingRun?.status === 'running'
  const setHighlightedElement = (element: HTMLElement | null) => {
    highlightedRef.current = element
  }

  useEffect(() => {
    const hasChangedEssay = currentEssayIdRef.current !== essay.id
    currentEssayIdRef.current = essay.id
    setDraftText(essay.ocrText)
    if (hasChangedEssay) setMode('read')
  }, [essay.id, essay.ocrText])

  useEffect(() => {
    highlightedRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }, [activeIssueId, match])

  const saveTranscript = () => {
    if (!hasChangedDraft || isGrading) return
    onOcrTextChange(essay.id, draftText)
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-950">学生作文识别文本</h3>
          {essay.ocrConfidence > 0 ? (
            <p className="mt-1 text-xs font-semibold text-amber-700">
              识别置信度 {formatConfidence(essay.ocrConfidence)}
            </p>
          ) : null}
          {essay.transcriptSource === 'kimi_vision' ? (
            <p className="mt-1 text-xs text-slate-500">Kimi 图像识别结果，建议结合原图复核。</p>
          ) : null}
          {isGrading ? <p className="mt-1 text-xs font-semibold text-amber-700">批改完成后再编辑</p> : null}
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

      {(essay.transcriptSource === 'kimi_vision' || transcriptionWarnings.length > 0 || printedTextExcluded !== undefined) ? (
        <section aria-label="图像识别说明" className="mt-3 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          {printedTextExcluded === true ? <p>已排除试卷印刷提示，仅保留学生作答内容。</p> : null}
          {printedTextExcluded === false ? <p>无法确认印刷提示是否已排除，请结合原图复核。</p> : null}
          {transcriptionWarnings.length > 0 ? (
            <ul className="mt-1 list-disc pl-4">
              {transcriptionWarnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
            </ul>
          ) : null}
        </section>
      ) : null}

      <div className="mt-4 inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
        {SOURCE_PANEL_MODE_OPTIONS.map((modeOption) => (
          <button
            key={modeOption.mode}
            type="button"
            disabled={isGrading && modeOption.mode === 'edit'}
            onClick={() => setMode(modeOption.mode)}
            className={`tech-focus rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              mode === modeOption.mode ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50'
            }`}
          >
            {modeOption.label}
          </button>
        ))}
      </div>
      {mode === 'edit' ? (
        <div className="mt-4 space-y-3">
          <textarea
            aria-label="学生作文识别文本"
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            className="min-h-[320px] w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-800 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs leading-5 text-slate-500">保存后当前批改结果将失效，需在进度页显式重新批改。</p>
            <button
              type="button"
              disabled={!hasChangedDraft || isGrading}
              onClick={saveTranscript}
              className="tech-focus rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-amber-300"
            >
              保存识别文本并使旧结果失效
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 max-h-[520px] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
          {shouldShowFallback ? (
            <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              未在原文中精确定位，请手动核对。
            </p>
          ) : null}
          <p className="whitespace-pre-wrap text-sm leading-7 text-slate-800">
            {hasIssueMarkers
              ? markerParts.map((part, index) => {
                  if (!part.marker) return <span key={`${part.text}-${index}`}>{part.text}</span>

                  const marker = part.marker
                  const isActive = activeIssueId !== undefined && activeIssueId !== null && marker.issueIds.includes(activeIssueId)
                  const markerTone = marker.source === 'logic'
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
              : highlightParts.map((part, index) => part.highlighted ? (
                <mark key={`${part.text}-${index}`} ref={setHighlightedElement} className="rounded bg-amber-100 px-1 font-semibold text-amber-800">
                  {part.text}
                </mark>
              ) : <span key={`${part.text}-${index}`}>{part.text}</span>)}
          </p>
        </div>
      )}
    </div>
  )
}
