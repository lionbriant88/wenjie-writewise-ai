import { useEffect, useRef } from 'react'

const acceptedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

export interface MaterialImagePage {
  id: string
  file: File
  previewUrl: string
}

interface MaterialImageOrganizerProps {
  pages: MaterialImagePage[]
  onChange: (pages: MaterialImagePage[]) => void
  disabled: boolean
}

function pageId() {
  return `material-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

export function MaterialImageOrganizer({ pages, onChange, disabled }: MaterialImageOrganizerProps) {
  const activeUrls = useRef(new Set<string>())

  useEffect(() => () => {
    activeUrls.current.forEach((url) => URL.revokeObjectURL(url))
    activeUrls.current.clear()
  }, [])

  const revoke = (url: string) => {
    if (!activeUrls.current.delete(url)) return
    URL.revokeObjectURL(url)
  }

  const addFiles = (files: FileList | null) => {
    if (disabled || !files) return
    const additions = Array.from(files)
      .filter((file) => acceptedImageTypes.has(file.type))
      .map((file) => {
        const previewUrl = URL.createObjectURL(file)
        activeUrls.current.add(previewUrl)
        return { id: pageId(), file, previewUrl }
      })
    if (additions.length > 0) onChange([...pages, ...additions])
  }

  const remove = (page: MaterialImagePage) => {
    if (disabled) return
    revoke(page.previewUrl)
    onChange(pages.filter((item) => item.id !== page.id))
  }

  const move = (index: number, direction: -1 | 1) => {
    if (disabled) return
    const destination = index + direction
    if (destination < 0 || destination >= pages.length) return
    const nextPages = [...pages]
    const current = nextPages[index]
    const target = nextPages[destination]
    if (!current || !target) return
    nextPages[index] = target
    nextPages[destination] = current
    onChange(nextPages)
  }

  return (
    <div className="space-y-3">
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        材料图片
        <input
          aria-label="材料图片"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={disabled}
          onChange={(event) => {
            addFiles(event.target.files)
            event.currentTarget.value = ''
          }}
          className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-blue-700"
        />
      </label>
      <p className="text-xs leading-5 text-slate-500">支持 JPEG、PNG、WebP；可调整顺序或删除。</p>
      {pages.length > 0 ? (
        <ol className="grid gap-3 sm:grid-cols-2">
          {pages.map((page, index) => (
            <li key={page.id} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              <img src={page.previewUrl} alt={`${page.file.name} 预览`} className="h-32 w-full object-cover" />
              <div className="space-y-2 p-3">
                <p className="truncate text-sm font-medium text-slate-800">{page.file.name}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => move(index, -1)} disabled={disabled || index === 0} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 disabled:text-slate-300">上移</button>
                  <button type="button" onClick={() => move(index, 1)} disabled={disabled || index === pages.length - 1} aria-label={`下移 ${page.file.name}`} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 disabled:text-slate-300">下移</button>
                  <button type="button" onClick={() => remove(page)} disabled={disabled} aria-label={`删除 ${page.file.name}`} className="rounded border border-rose-100 bg-white px-2 py-1 text-xs font-semibold text-rose-700 disabled:text-slate-300">删除</button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}
