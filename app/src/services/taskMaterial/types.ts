export type MaterialSourceKind = 'image' | 'pdf' | 'docx'
export type MaterialWarningCode = 'docx_body_only' | 'docx_parser_warning'

export interface ImageMaterialUnitDraft {
  kind: 'image'
  sourceKind: 'image' | 'pdf'
  displayName: string
  file: File
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  pageNumber?: number
}

export interface TextMaterialUnitDraft {
  kind: 'text'
  sourceKind: 'docx'
  displayName: string
  text: string
  warnings: MaterialWarningCode[]
}

export type MaterialUnitDraft = ImageMaterialUnitDraft | TextMaterialUnitDraft

export interface ImageMaterialUnit extends ImageMaterialUnitDraft {
  id: string
  sourceId: string
  previewUrl: string
}

export interface TextMaterialUnit extends TextMaterialUnitDraft {
  id: string
  sourceId: string
}

export type MaterialUnit = ImageMaterialUnit | TextMaterialUnit

export type TaskMaterialRequestUnit =
  | { id: string; kind: 'image'; file: File }
  | { id: string; kind: 'text'; displayName: string; text: string }

export interface TaskMaterialRequestBase {
  requestId: string
  fullScore: number
  writingRequirement: string
  materials: readonly TaskMaterialRequestUnit[]
  signal?: AbortSignal
}

export type MaterialContextClientRequest = TaskMaterialRequestBase

export type MaterialNormalizationErrorCode =
  | 'unsupported_type'
  | 'legacy_doc_unsupported'
  | 'unit_limit_exceeded'
  | 'image_too_large'
  | 'document_too_large'
  | 'pdf_empty'
  | 'pdf_too_many_pages'
  | 'pdf_page_too_large'
  | 'pdf_render_failed'
  | 'docx_parse_failed'
  | 'docx_empty'
  | 'docx_too_long'

const DEFAULT_MESSAGES: Record<MaterialNormalizationErrorCode, string> = {
  unsupported_type: '仅支持 JPEG、PNG、WebP、PDF 或 DOCX 文件。',
  legacy_doc_unsupported: '旧版 .doc 文件暂不支持，请转换为 DOCX 或 PDF 后上传。',
  unit_limit_exceeded: '材料单元数量超过上限。',
  image_too_large: '图片文件超过 8 MiB 限制。',
  document_too_large: 'PDF 或 DOCX 文件超过 20 MiB 限制。',
  pdf_empty: 'PDF 中没有可转换的页面。',
  pdf_too_many_pages: 'PDF 页数超过剩余材料单元数量。',
  pdf_page_too_large: 'PDF 转换后的页面超过 8 MiB 限制。',
  pdf_render_failed: 'PDF 页面转换失败。',
  docx_parse_failed: 'DOCX 正文提取失败。',
  docx_empty: 'DOCX 正文为空。',
  docx_too_long: 'DOCX 正文超过 30,000 字符限制。',
}

export class MaterialNormalizationError extends Error {
  readonly code: MaterialNormalizationErrorCode

  constructor(code: MaterialNormalizationErrorCode, message = DEFAULT_MESSAGES[code]) {
    super(message)
    this.name = 'MaterialNormalizationError'
    this.code = code
  }
}
