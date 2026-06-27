interface UploadPanelProps {
  onAddPage: () => void
  onSubmit: () => void
}

export function UploadPanel({ onAddPage, onSubmit }: UploadPanelProps) {
  return (
    <div className="rounded-lg border border-dashed border-blue-300 bg-blue-50 p-6">
      <h3 className="text-lg font-semibold text-slate-950">模拟上传作文图片</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        第一阶段不读取真实图片，这里用页面占位模拟手机拍照、扫描件或白板展台画面。
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
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
