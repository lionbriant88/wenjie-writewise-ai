import { describe, expect, it, vi } from 'vitest'
import { convertPdfToImages, type PdfDocumentAdapter } from './pdfToImages'

describe('convertPdfToImages', () => {
  it('renders PDF pages in order as PNG files and releases the document', async () => {
    const renderedPages: number[] = []
    const destroy = vi.fn()
    const document: PdfDocumentAdapter = {
      numPages: 2,
      getPage: async (pageNumber) => ({
        getViewport: () => ({ width: 600 + pageNumber, height: 800 + pageNumber }),
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
        loadDocument: async () => document,
        createCanvas: () => {
          const canvas = documentCreateCanvas()
          canvas.toBlob = (callback) => callback(new Blob(['png'], { type: 'image/png' }))
          return canvas
        },
      },
    )

    expect(renderedPages).toEqual([1, 2])
    expect(files.map((file) => file.name)).toEqual(['student-essay-page-1.png', 'student-essay-page-2.png'])
    expect(files.every((file) => file.type === 'image/png')).toBe(true)
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('rejects a PDF that exceeds the remaining page limit before rendering', async () => {
    const getPage = vi.fn()
    const document: PdfDocumentAdapter = { numPages: 3, getPage }

    await expect(convertPdfToImages(
      new File(['pdf bytes'], 'too-long.pdf', { type: 'application/pdf' }),
      { maxPages: 2, loadDocument: async () => document },
    )).rejects.toThrow('最多还能添加 2 页')
    expect(getPage).not.toHaveBeenCalled()
  })
})

function documentCreateCanvas() {
  return document.createElement('canvas')
}
