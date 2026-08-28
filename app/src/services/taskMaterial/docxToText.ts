import { MAX_DOCX_TEXT_CHARACTERS, MAX_MATERIAL_DOCUMENT_BYTES } from './constants'
import { MaterialNormalizationError, type MaterialWarningCode } from './types'

export type RawDocxExtractor = (
  arrayBuffer: ArrayBuffer,
) => Promise<{ value: string; messages?: readonly unknown[] }>

export interface DocxToTextOptions {
  extractRawText?: RawDocxExtractor
}

export interface DocxTextResult {
  text: string
  warnings: MaterialWarningCode[]
}

const productionExtractor: RawDocxExtractor = async (arrayBuffer) => {
  const mammoth = await import('mammoth')
  return mammoth.extractRawText({ arrayBuffer })
}

export async function extractDocxBodyText(
  file: File,
  options: DocxToTextOptions = {},
): Promise<DocxTextResult> {
  if (file.size > MAX_MATERIAL_DOCUMENT_BYTES) {
    throw new MaterialNormalizationError('document_too_large')
  }

  let extracted: Awaited<ReturnType<RawDocxExtractor>>
  try {
    const arrayBuffer = await file.arrayBuffer()
    extracted = await (options.extractRawText ?? productionExtractor)(arrayBuffer)
  } catch {
    throw new MaterialNormalizationError('docx_parse_failed')
  }

  if (typeof extracted.value !== 'string') {
    throw new MaterialNormalizationError('docx_parse_failed')
  }

  const text = extracted.value.trim()
  if (!text) throw new MaterialNormalizationError('docx_empty')
  if (Array.from(text).length > MAX_DOCX_TEXT_CHARACTERS) {
    throw new MaterialNormalizationError('docx_too_long')
  }

  const warnings: MaterialWarningCode[] = ['docx_body_only']
  if (extracted.messages && extracted.messages.length > 0) warnings.push('docx_parser_warning')

  return { text, warnings }
}
