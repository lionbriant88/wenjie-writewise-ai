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
  loadDocument?: (data: Uint8Array) => Promise<PdfDocumentAdapter>
  createCanvas?: () => HTMLCanvasElement
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

  const maxPages = options.maxPages ?? 10
  const loadDocument = options.loadDocument ?? loadPdfDocument
  const createCanvas = options.createCanvas ?? (() => document.createElement('canvas'))
  const pdf = await loadDocument(new Uint8Array(await file.arrayBuffer()))

  try {
    if (pdf.numPages < 1) throw new Error('PDF 中没有可转换的页面。')
    if (pdf.numPages > maxPages) throw new Error(`这份 PDF 页数过多，最多还能添加 ${maxPages} 页。`)

    const baseName = file.name.replace(/\.pdf$/i, '') || '作文'
    const files: File[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 2 })
      const canvas = createCanvas()
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvas, viewport }).promise
      const blob = await canvasToPng(canvas)
      files.push(new File([blob], `${baseName}-page-${pageNumber}.png`, { type: 'image/png' }))
      canvas.width = 0
      canvas.height = 0
    }
    return files
  } finally {
    await pdf.destroy?.()
  }
}
