import { describe, expect, it, vi } from 'vitest'
import { convertPdfToImages, type PdfDocumentAdapter } from './pdfToImages'

describe('convertPdfToImages', () => {
  it('renders PDF pages in order as PNG files and releases the document', async () => {
    const renderedPages: number[] = []
    const renderScales: number[] = []
    const destroy = vi.fn()
    const document: PdfDocumentAdapter = {
      numPages: 2,
      getPage: async (pageNumber) => ({
        getViewport: ({ scale }) => {
          renderScales.push(scale)
          return { width: 600 + pageNumber, height: 800 + pageNumber }
        },
        render: ({ canvas, viewport }) => {
          renderedPages.push(pageNumber)
          expect(canvas.width).toBe(600 + pageNumber)
          expect(canvas.height).toBe(800 + pageNumber)
          expect(viewport).toEqual({ width: 600 + pageNumber, height: 800 + pageNumber })
          return { promise: Promise.resolve() }
        },
      }),
      destroy,
    }

    const files = await convertPdfToImages(
      new File(['pdf bytes'], 'student-essay.pdf', { type: 'application/pdf' }),
      {
        renderScale: 1.5,
        loadDocument: async () => document,
        createCanvas: () => {
          const canvas = documentCreateCanvas()
          canvas.toBlob = (callback) => callback(new Blob(['png'], { type: 'image/png' }))
          return canvas
        },
      },
    )

    expect(renderedPages).toEqual([1, 2])
    expect(renderScales).toEqual([1.5, 1.5])
    expect(files.map((file) => file.name)).toEqual(['student-essay-page-1.png', 'student-essay-page-2.png'])
    expect(files.every((file) => file.type === 'image/png')).toBe(true)
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('rejects a PDF that exceeds the remaining page limit before rendering', async () => {
    const getPage = vi.fn()
    const destroy = vi.fn()
    const document: PdfDocumentAdapter = { numPages: 3, getPage, destroy }

    await expect(convertPdfToImages(
      new File(['pdf bytes'], 'too-long.pdf', { type: 'application/pdf' }),
      { maxPages: 2, loadDocument: async () => document },
    )).rejects.toThrow('最多还能添加 2 页')
    expect(getPage).not.toHaveBeenCalled()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('rejects an oversized input before reading bytes or loading a document', async () => {
    const file = sizedPdf(21)
    const loadDocument = vi.fn()

    await expect(convertPdfToImages(file, { maxInputBytes: 20, loadDocument }))
      .rejects.toThrow('PDF 文件超过大小限制')
    expect(file.arrayBuffer).not.toHaveBeenCalled()
    expect(loadDocument).not.toHaveBeenCalled()
  })

  it('accepts a rendered page exactly at the configured output limit', async () => {
    const destroy = vi.fn()
    const files = await convertPdfToImages(sizedPdf(20), {
      maxOutputBytesPerPage: 8 * 1024 * 1024,
      loadDocument: async () => onePageDocument(destroy),
      createCanvas: () => canvasWithBlobSize(8 * 1024 * 1024),
    })

    expect(files).toHaveLength(1)
    expect(files[0]?.size).toBe(8 * 1024 * 1024)
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('rejects the whole PDF when a later rendered page exceeds the output limit', async () => {
    const destroy = vi.fn()
    let convertedPage = 0
    const document: PdfDocumentAdapter = {
      numPages: 2,
      getPage: async () => pageAdapter(),
      destroy,
    }

    const conversion = convertPdfToImages(sizedPdf(20), {
      maxOutputBytesPerPage: 8 * 1024 * 1024,
      loadDocument: async () => document,
      createCanvas: () => {
        convertedPage += 1
        return canvasWithBlobSize(convertedPage === 1 ? 4 : 8 * 1024 * 1024 + 1)
      },
    })

    await expect(conversion).rejects.toThrow('PDF 转换后的页面文件过大')
    expect(convertedPage).toBe(2)
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('rejects an empty PDF and releases the loaded document', async () => {
    const destroy = vi.fn()

    await expect(convertPdfToImages(sizedPdf(20), {
      loadDocument: async () => ({ numPages: 0, getPage: vi.fn(), destroy }),
    })).rejects.toThrow('PDF 中没有可转换的页面')
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('maps a damaged PDF load failure to a safe static message', async () => {
    const privateMessage = 'damaged xref at C:\\private\\paper.pdf'

    try {
      await convertPdfToImages(sizedPdf(20), {
        loadDocument: async () => { throw new Error(privateMessage) },
      })
      throw new Error('expected conversion to reject')
    } catch (error) {
      expect(String(error)).toContain('PDF 页面转换失败')
      expect(String(error)).not.toContain(privateMessage)
    }
  })

  it.each([
    ['page loading', async () => { throw new Error('private getPage failure') }, canvasWithBlobSize(4)],
    ['page rendering', async () => ({ ...pageAdapter(), render: () => ({ promise: Promise.reject(new Error('private render failure')) }) }), canvasWithBlobSize(4)],
    ['PNG encoding', async () => pageAdapter(), canvasWithoutBlob()],
  ] as const)('maps %s failure safely and releases the loaded document', async (_label, getPage, canvas) => {
    const destroy = vi.fn()

    try {
      await convertPdfToImages(sizedPdf(20), {
        loadDocument: async () => ({ numPages: 1, getPage, destroy }),
        createCanvas: () => canvas,
      })
      throw new Error('expected conversion to reject')
    } catch (error) {
      expect(String(error)).toContain('PDF 页面转换失败')
      expect(String(error)).not.toContain('private')
    }
    expect(destroy).toHaveBeenCalledOnce()
  })
})

function documentCreateCanvas() {
  return document.createElement('canvas')
}

function sizedPdf(size: number) {
  const file = new File(['pdf'], 'prompt.pdf', { type: 'application/pdf' })
  Object.defineProperty(file, 'size', { configurable: true, value: size })
  Object.defineProperty(file, 'arrayBuffer', {
    configurable: true,
    value: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
  })
  return file
}

function pageAdapter() {
  return {
    getViewport: () => ({ width: 100, height: 200 }),
    render: () => ({ promise: Promise.resolve() }),
  }
}

function onePageDocument(destroy: () => void): PdfDocumentAdapter {
  return { numPages: 1, getPage: async () => pageAdapter(), destroy }
}

function canvasWithBlobSize(size: number) {
  const canvas = documentCreateCanvas()
  canvas.toBlob = (callback) => callback(new Blob([new Uint8Array(size)], { type: 'image/png' }))
  return canvas
}

function canvasWithoutBlob() {
  const canvas = documentCreateCanvas()
  canvas.toBlob = (callback) => callback(null)
  return canvas
}
