interface UploadPanelProps {
  onAddPage: () => void
  onSelectFiles: (files: File[]) => void
  onSubmit: () => void
}

export function UploadPanel({ onAddPage, onSelectFiles, onSubmit }: UploadPanelProps) {
  return (
    <div className="rounded-lg border border-dashed border-blue-300 bg-blue-50 p-6">
      <h3 className="text-lg font-semibold text-slate-950">上传作文图片</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        可选择本地图片查看真实预览；OCR 识别和 AI 批改暂时仍使用模拟结果。
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <label className="tech-focus inline-flex cursor-pointer rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100">
          选择本地图片
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(event) => {
              onSelectFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
        </label>
        <button
          type="button"
          onClick={onAddPage}
          className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"
        >
          添加模拟图片
        </button>
        <button
          type="button"
          onClick={onSubmit}
          className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
        >
          提交到批改队列
        </button>
      </div>
    </div>
  )
}
