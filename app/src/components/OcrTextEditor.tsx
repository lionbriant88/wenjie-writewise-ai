interface OcrTextEditorProps {
  value: string
  confidence: number
  onChange: (value: string) => void
}

export function OcrTextEditor({ value, confidence, onChange }: OcrTextEditorProps) {
  const confidencePercent = Math.round(confidence * 100)

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-slate-950">OCR 识别文本</h3>
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
          置信度 {confidencePercent}%
        </span>
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-40 w-full resize-y rounded-lg border border-slate-200 p-3 text-sm leading-6 text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      />
    </div>
  )
}
