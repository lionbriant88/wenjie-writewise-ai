import { Camera, FileImage, FileScan, MonitorUp } from 'lucide-react'

interface UploadSourceSelectorProps {
  onSelectImages: (files: File[]) => void
  onAddMockImage: () => void
  disabled?: boolean
}

function statusClass(available: boolean) {
  return available
    ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
    : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200'
}

export function UploadSourceSelector({ onSelectImages, onAddMockImage, disabled = false }: UploadSourceSelectorProps) {
  return (
    <section
      role="region"
      aria-label="选择导入方式"
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-950">选择导入方式</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            当前版本支持图片 / 文件导入。拍照采集、扫描件导入和希沃展台采集将在阶段三接入。
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div
          role="group"
          aria-label="图片 / 文件导入"
          className="rounded-lg border border-blue-200 bg-blue-50/70 p-4 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileImage className="h-5 w-5 text-blue-700" />
              <h4 className="font-semibold text-slate-950">图片 / 文件导入</h4>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(true)}`}>当前可用</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            从当前设备选择已经存在的作文图片或文件，例如相册照片、电脑文件夹图片、扫描仪或阅卷系统导出的图片 / PDF。
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <label
              className={`tech-focus inline-flex rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 ${
                disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
              }`}
            >
              选择图片
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={disabled}
                aria-label="选择图片"
                className="sr-only"
                onChange={(event) => {
                  if (disabled) return
                  onSelectImages(Array.from(event.target.files ?? []))
                  event.target.value = ''
                }}
              />
            </label>
            <button
              type="button"
              onClick={onAddMockImage}
              disabled={disabled}
              className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              添加模拟图片
            </button>
          </div>
        </div>

        <div role="group" aria-label="拍照采集" className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-slate-500" />
              <h4 className="font-semibold text-slate-950">拍照采集</h4>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(false)}`}>阶段三接入</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            未来可在软件内调用手机、平板或电脑摄像头现场拍摄作文，预览确认后加入上传整理页图片列表。
          </p>
          <p className="mt-3 text-xs font-semibold text-slate-500">当前可先通过图片 / 文件导入使用已有照片。</p>
        </div>

        <div role="group" aria-label="扫描件导入" className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileScan className="h-5 w-5 text-slate-500" />
              <h4 className="font-semibold text-slate-950">扫描件导入</h4>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(false)}`}>阶段三接入</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            用于学校扫描仪或阅卷系统已经生成的作文图片、PDF 或文件夹导入，适合大型考试后的批量作文批改。
          </p>
          <p className="mt-3 text-xs font-semibold text-slate-500">当前不解析 PDF、文件夹或自动拆页。</p>
        </div>

        <div role="group" aria-label="希沃展台采集" className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <MonitorUp className="h-5 w-5 text-slate-500" />
              <h4 className="font-semibold text-slate-950">希沃展台采集</h4>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(false)}`}>阶段三接入</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            未来可通过希沃白板视频展台采集作文画面，既可用于课堂即时批改，也可用于批量采集上传。
          </p>
          <div className="mt-3 space-y-2">
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-800">课堂即时批改</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass(false)}`}>
                  阶段三接入
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                采集单篇作文后直接进入 OCR、AI 批改和单篇详情页。
              </p>
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-800">批量采集上传</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass(false)}`}>
                  阶段三接入
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                连续采集多张作文图片后进入上传整理、OCR 和批改队列。
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
