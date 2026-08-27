export interface PdfPageAdapter {
  getViewport: (options: { scale: number }) => { width: number; height: number }
  render: (options: { canvas: HTMLCanvasElement; viewport: { width: number; height: number } }) => { promise: Promise<void> }
}

export interface PdfDocumentAdapter {
  numPages: number
  getPage: (pageNumber: number) => Promise<PdfPageAdapter>
  destroy?: () => void | Promise<void>
}

export interface PdfToImagesOptions {
  maxPages?: number
  maxInputBytes?: number
  maxOutputBytesPerPage?: number
  renderScale?: number
  loadDocument?: (data: Uint8Array) => Promise<PdfDocumentAdapter>
  createCanvas?: () => HTMLCanvasElement
}

export type PdfToImagesErrorCode =
  | 'input_too_large'
  | 'empty'
  | 'too_many_pages'
  | 'page_too_large'
  | 'render_failed'

export class PdfToImagesError extends Error {
  readonly code: PdfToImagesErrorCode

  constructor(code: PdfToImagesErrorCode, message: string) {
    super(message)
    this.name = 'PdfToImagesError'
    this.code = code
  }
}

async function loadPdfDocument(data: Uint8Array): Promise<PdfDocumentAdapter> {
  const [{ getDocument, GlobalWorkerOptions }, workerModule] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  GlobalWorkerOptions.workerSrc = workerModule.default
  return await getDocument({ data }).promise as unknown as PdfDocumentAdapter
}

function canvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('PDF 页面转换失败。'))
    }, 'image/png')
  })
}

export async function convertPdfToImages(file: File, options: PdfToImagesOptions = {}): Promise<File[]> {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('请选择 PDF 文件。')
  }
  if (options.maxInputBytes !== undefined && file.size > options.maxInputBytes) {
    throw new PdfToImagesError('input_too_large', 'PDF 文件超过大小限制。')
  }

  const maxPages = options.maxPages ?? 10
  const loadDocument = options.loadDocument ?? loadPdfDocument
  const createCanvas = options.createCanvas ?? (() => document.createElement('canvas'))
  const renderScale = options.renderScale ?? 2
  let pdf: PdfDocumentAdapter

  try {
    pdf = await loadDocument(new Uint8Array(await file.arrayBuffer()))
  } catch {
    throw new PdfToImagesError('render_failed', 'PDF 页面转换失败。')
  }

  try {
    if (pdf.numPages < 1) {
      throw new PdfToImagesError('empty', 'PDF 中没有可转换的页面。')
    }
    if (pdf.numPages > maxPages) {
      throw new PdfToImagesError('too_many_pages', `这份 PDF 页数过多，最多还能添加 ${maxPages} 页。`)
    }

    const baseName = file.name.replace(/\.pdf$/i, '') || '作文'
    const files: File[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: renderScale })
      const canvas = createCanvas()
      try {
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        await page.render({ canvas, viewport }).promise
        const blob = await canvasToPng(canvas)
        if (options.maxOutputBytesPerPage !== undefined && blob.size > options.maxOutputBytesPerPage) {
          throw new PdfToImagesError('page_too_large', 'PDF 转换后的页面文件过大。')
        }
        files.push(new File([blob], `${baseName}-page-${pageNumber}.png`, { type: 'image/png' }))
      } finally {
        canvas.width = 0
        canvas.height = 0
      }
    }
    return files
  } catch (error) {
    if (error instanceof PdfToImagesError) throw error
    throw new PdfToImagesError('render_failed', 'PDF 页面转换失败。')
  } finally {
    try {
      await pdf.destroy?.()
    } catch {
      // A cleanup failure must not expose PDF.js internals or replace the conversion result.
    }
  }
}
