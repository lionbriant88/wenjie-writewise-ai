import {
  convertPdfToImages,
  PdfToImagesError,
} from '../../utils/pdfToImages'
import { classifyMaterialFile } from './classifyMaterialFile'
import {
  MAX_MATERIAL_DOCUMENT_BYTES,
  MAX_MATERIAL_IMAGE_BYTES,
  MAX_MATERIAL_UNITS,
} from './constants'
import { extractDocxBodyText } from './docxToText'
import {
  MaterialNormalizationError,
  type ImageMaterialUnitDraft,
  type MaterialUnitDraft,
} from './types'

export interface NormalizeMaterialFileOptions {
  remainingUnits: number
  convertPdf?: typeof convertPdfToImages
  extractDocx?: typeof extractDocxBodyText
}

export async function normalizeMaterialFile(
  file: File,
  options: NormalizeMaterialFileOptions,
): Promise<MaterialUnitDraft[]> {
  const fileKind = classifyMaterialFile(file)
  if (fileKind === 'legacy_doc') throw new MaterialNormalizationError('legacy_doc_unsupported')
  if (fileKind === 'unsupported') throw new MaterialNormalizationError('unsupported_type')

  const remainingUnits = Math.min(Math.floor(options.remainingUnits), MAX_MATERIAL_UNITS)
  if (!Number.isFinite(remainingUnits) || remainingUnits < 1) {
    throw new MaterialNormalizationError('unit_limit_exceeded')
  }

  const displayName = sanitizeDisplayName(file.name)

  if (fileKind === 'image') {
    if (file.size > MAX_MATERIAL_IMAGE_BYTES) {
      throw new MaterialNormalizationError('image_too_large')
    }
    return [{
      kind: 'image',
      sourceKind: 'image',
      displayName,
      file,
      mimeType: file.type as ImageMaterialUnitDraft['mimeType'],
    }]
  }

  if (file.size > MAX_MATERIAL_DOCUMENT_BYTES) {
    throw new MaterialNormalizationError('document_too_large')
  }

  if (fileKind === 'docx') {
    try {
      const result = await (options.extractDocx ?? extractDocxBodyText)(file)
      return [{
        kind: 'text',
        sourceKind: 'docx',
        displayName,
        text: result.text,
        warnings: [...result.warnings],
      }]
    } catch (error) {
      if (error instanceof MaterialNormalizationError) throw error
      throw new MaterialNormalizationError('docx_parse_failed')
    }
  }

  let pages: File[]
  try {
    pages = await (options.convertPdf ?? convertPdfToImages)(file, {
      maxPages: remainingUnits,
      maxInputBytes: MAX_MATERIAL_DOCUMENT_BYTES,
      maxOutputBytesPerPage: MAX_MATERIAL_IMAGE_BYTES,
    })
  } catch (error) {
    throw mapPdfError(error)
  }

  if (pages.length < 1) throw new MaterialNormalizationError('pdf_empty')
  if (pages.length > remainingUnits) throw new MaterialNormalizationError('pdf_too_many_pages')
  if (pages.some((page) => page.size > MAX_MATERIAL_IMAGE_BYTES)) {
    throw new MaterialNormalizationError('pdf_page_too_large')
  }
  if (pages.some((page) => page.type !== 'image/png')) {
    throw new MaterialNormalizationError('pdf_render_failed')
  }

  return pages.map((page, index) => ({
    kind: 'image',
    sourceKind: 'pdf',
    displayName: `${displayName} · 第 ${index + 1} 页`,
    file: page,
    mimeType: 'image/png',
    pageNumber: index + 1,
  }))
}

function mapPdfError(error: unknown): MaterialNormalizationError {
  if (!(error instanceof PdfToImagesError)) {
    return new MaterialNormalizationError('pdf_render_failed')
  }

  switch (error.code) {
    case 'input_too_large':
      return new MaterialNormalizationError('document_too_large')
    case 'empty':
      return new MaterialNormalizationError('pdf_empty')
    case 'too_many_pages':
      return new MaterialNormalizationError('pdf_too_many_pages')
    case 'page_too_large':
      return new MaterialNormalizationError('pdf_page_too_large')
    case 'render_failed':
      return new MaterialNormalizationError('pdf_render_failed')
  }
}

const UNSAFE_DISPLAY_NAME_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

function sanitizeDisplayName(fileName: string): string {
  const withoutControlCharacters = Array.from(fileName)
    .filter((character) => !UNSAFE_DISPLAY_NAME_CHARACTER.test(character))
    .join('')
  return withoutControlCharacters.replaceAll('/', '_').replaceAll('\\', '_').trim().slice(0, 255) || '材料文件'
}
