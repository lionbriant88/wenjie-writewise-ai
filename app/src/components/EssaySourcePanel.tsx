import { useEffect, useMemo, useRef } from 'react'
import { Image } from 'lucide-react'
import type { Essay } from '../types'
import { formatConfidence } from '../utils/gradingDiagnostics'
import { findTextMatch, splitTextByMatch } from '../utils/textHighlight'

interface EssaySourcePanelProps {
  essay: Essay
  activeHighlightText?: string
  onOcrTextChange: (essayId: string, nextText: string) => void
  onViewOriginalImage: () => void
}

export function EssaySourcePanel({
  essay,
  activeHighlightText,
  onOcrTextChange,
  onViewOriginalImage,
}: EssaySourcePanelProps) {
  const highlightedRef = useRef<HTMLElement | null>(null)
  const match = useMemo(
    () => findTextMatch(essay.ocrText, activeHighlightText ?? ''),
    [activeHighlightText, essay.ocrText],
  )
  const highlightParts = useMemo(() => splitTextByMatch(essay.ocrText, match), [essay.ocrText, match])
  const shouldShowPreview = Boolean(activeHighlightText)
  const shouldShowFallback = shouldShowPreview && !match

  useEffect(() => {
    highlightedRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }, [match])

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
      <textarea
        value={essay.ocrText}
        onChange={(event) => onOcrTextChange(essay.id, event.target.value)}
        className="mt-4 min-h-[320px] w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-800 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
      />
      {shouldShowPreview ? (
        <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-amber-800">定位预览</p>
            {shouldShowFallback ? (
              <p className="text-xs font-semibold text-amber-800">未在原文中精确定位，请手动核对</p>
            ) : null}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-800">
            {highlightParts.map((part, index) =>
              part.highlighted ? (
                <mark
                  key={`${part.text}-${index}`}
                  ref={highlightedRef}
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
      ) : null}
    </div>
  )
}
