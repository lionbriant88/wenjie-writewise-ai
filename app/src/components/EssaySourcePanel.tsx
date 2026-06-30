import { useEffect, useMemo, useRef, useState } from 'react'
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
  const [mode, setMode] = useState<'read' | 'edit'>('read')
  const highlightedRef = useRef<HTMLElement | null>(null)
  const match = useMemo(
    () => findTextMatch(essay.ocrText, activeHighlightText ?? ''),
    [activeHighlightText, essay.ocrText],
  )
  const highlightParts = useMemo(() => splitTextByMatch(essay.ocrText, match), [essay.ocrText, match])
  const shouldShowFallback = Boolean(activeHighlightText) && !match

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
      <div className="mt-4 inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
        {(['read', 'edit'] as const).map((modeOption) => (
          <button
            key={modeOption}
            type="button"
            onClick={() => setMode(modeOption)}
            className={`tech-focus rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              mode === modeOption ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {modeOption === 'read' ? '阅读定位' : '编辑 OCR'}
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
      )}
    </div>
  )
}
