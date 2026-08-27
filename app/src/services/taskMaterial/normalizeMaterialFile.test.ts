import { describe, expect, it, vi } from 'vitest'
import { PdfToImagesError } from '../../utils/pdfToImages'
import {
  MAX_MATERIAL_DOCUMENT_BYTES,
  MAX_MATERIAL_IMAGE_BYTES,
} from './constants'
import { normalizeMaterialFile } from './normalizeMaterialFile'
import type { MaterialNormalizationError } from './types'

function sizedFile(name: string, type: string, size: number) {
  const file = new File(['content'], name, { type })
  Object.defineProperty(file, 'size', { configurable: true, value: size })
  return file
}

function pdfPage(name: string, size = 4) {
  return sizedFile(name, 'image/png', size)
}

async function expectCode(promise: Promise<unknown>, code: MaterialNormalizationError['code']) {
  await expect(promise).rejects.toMatchObject({ name: 'MaterialNormalizationError', code })
}

describe('normalizeMaterialFile', () => {
  it.each([
    ['photo.jpg', 'image/jpeg'],
    ['scan.png', 'image/png'],
    ['prompt.webp', 'image/webp'],
  ] as const)('normalizes supported image %s without creating a preview URL', async (name, mimeType) => {
    const file = sizedFile(name, mimeType, MAX_MATERIAL_IMAGE_BYTES)

    await expect(normalizeMaterialFile(file, { remainingUnits: 10 })).resolves.toEqual([{
      kind: 'image',
      sourceKind: 'image',
      displayName: name,
      file,
      mimeType,
    }])
  })

  it('rejects an image at 8 MiB plus one byte without returning a draft', async () => {
    await expectCode(normalizeMaterialFile(
      sizedFile('too-large.png', 'image/png', MAX_MATERIAL_IMAGE_BYTES + 1),
      { remainingUnits: 10 },
    ), 'image_too_large')
  })

  it('accepts a PDF exactly at 20 MiB and passes all PDF limits to the converter', async () => {
    const file = sizedFile('paper.pdf', 'application/pdf', MAX_MATERIAL_DOCUMENT_BYTES)
    const convertPdf = vi.fn(async (_file, options) => {
      expect(_file).toBe(file)
      expect(options).toMatchObject({
        maxPages: 2,
        maxInputBytes: MAX_MATERIAL_DOCUMENT_BYTES,
        maxOutputBytesPerPage: MAX_MATERIAL_IMAGE_BYTES,
      })
      return [pdfPage('paper-page-1.png')]
    })

    await expect(normalizeMaterialFile(file, { remainingUnits: 2, convertPdf })).resolves.toHaveLength(1)
  })

  it('rejects a PDF at 20 MiB plus one before invoking the converter', async () => {
    const convertPdf = vi.fn()

    await expectCode(normalizeMaterialFile(
      sizedFile('too-large.pdf', 'application/pdf', MAX_MATERIAL_DOCUMENT_BYTES + 1),
      { remainingUnits: 10, convertPdf },
    ), 'document_too_large')
    expect(convertPdf).not.toHaveBeenCalled()
  })

  it('preserves ordered PDF pages when eight existing units leave two slots', async () => {
    const first = pdfPage('paper-page-1.png')
    const second = pdfPage('paper-page-2.png')

    await expect(normalizeMaterialFile(
      sizedFile('paper.pdf', 'application/pdf', 128),
      { remainingUnits: 2, convertPdf: async () => [first, second] },
    )).resolves.toEqual([
      {
        kind: 'image', sourceKind: 'pdf', displayName: 'paper.pdf · 第 1 页',
        file: first, mimeType: 'image/png', pageNumber: 1,
      },
      {
        kind: 'image', sourceKind: 'pdf', displayName: 'paper.pdf · 第 2 页',
        file: second, mimeType: 'image/png', pageNumber: 2,
      },
    ])
  })

  it('rejects all three converted pages atomically when only two slots remain', async () => {
    const converted = [pdfPage('page-1.png'), pdfPage('page-2.png'), pdfPage('page-3.png')]

    await expectCode(normalizeMaterialFile(
      sizedFile('paper.pdf', 'application/pdf', 128),
      { remainingUnits: 2, convertPdf: async () => converted },
    ), 'pdf_too_many_pages')
  })

  it('rejects the whole PDF when any converted page exceeds 8 MiB', async () => {
    const converted = [pdfPage('page-1.png'), pdfPage('page-2.png', MAX_MATERIAL_IMAGE_BYTES + 1)]

    await expectCode(normalizeMaterialFile(
      sizedFile('paper.pdf', 'application/pdf', 128),
      { remainingUnits: 2, convertPdf: async () => converted },
    ), 'pdf_page_too_large')
  })

  it.each([
    ['empty', new PdfToImagesError('empty', 'dependency detail'), 'pdf_empty'],
    ['too many pages', new PdfToImagesError('too_many_pages', 'dependency detail'), 'pdf_too_many_pages'],
    ['large page', new PdfToImagesError('page_too_large', 'dependency detail'), 'pdf_page_too_large'],
    ['damaged PDF', new PdfToImagesError('render_failed', 'dependency detail'), 'pdf_render_failed'],
  ] as const)('maps %s conversion failure to a stable normalization code', async (_label, failure, code) => {
    await expectCode(normalizeMaterialFile(
      sizedFile('paper.pdf', 'application/pdf', 128),
      { remainingUnits: 10, convertPdf: async () => { throw failure } },
    ), code)
  })

  it('normalizes a DOCX as one text unit with stable warnings', async () => {
    const file = sizedFile('prompt.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 128)

    await expect(normalizeMaterialFile(file, {
      remainingUnits: 1,
      extractDocx: async () => ({ text: 'Paragraph one.\nParagraph two.', warnings: ['docx_body_only'] }),
    })).resolves.toEqual([{
      kind: 'text',
      sourceKind: 'docx',
      displayName: 'prompt.docx',
      text: 'Paragraph one.\nParagraph two.',
      warnings: ['docx_body_only'],
    }])
  })

  it('rejects a DOCX before extraction when no material unit remains', async () => {
    const extractDocx = vi.fn()

    await expectCode(normalizeMaterialFile(
      sizedFile('prompt.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 128),
      { remainingUnits: 0, extractDocx },
    ), 'unit_limit_exceeded')
    expect(extractDocx).not.toHaveBeenCalled()
  })

  it('gives legacy .doc files their dedicated conversion guidance', async () => {
    const promise = normalizeMaterialFile(
      sizedFile('legacy.doc', 'application/msword', 128),
      { remainingUnits: 10 },
    )

    await expectCode(promise, 'legacy_doc_unsupported')
    await expect(promise).rejects.toThrow('请转换为 DOCX 或 PDF 后上传')
  })

  it('rejects other unsupported formats with the stable unsupported code', async () => {
    await expectCode(normalizeMaterialFile(
      sizedFile('photo.heic', 'image/heic', 128),
      { remainingUnits: 10 },
    ), 'unsupported_type')
  })

  it('sanitizes source display names without changing the source File', async () => {
    const file = sizedFile('../unsafe\\name\u0000.png', 'image/png', 128)

    const [draft] = await normalizeMaterialFile(file, { remainingUnits: 10 })

    expect(draft).toMatchObject({ displayName: '.._unsafe_name.png', file })
  })
})
