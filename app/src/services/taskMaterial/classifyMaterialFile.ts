import { MATERIAL_IMAGE_MIME_TYPES } from './constants'

export type MaterialFileKind = 'image' | 'pdf' | 'docx' | 'legacy_doc' | 'unsupported'

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export function classifyMaterialFile(file: File): MaterialFileKind {
  const lowerName = file.name.toLowerCase()

  if (lowerName.endsWith('.doc') || file.type === 'application/msword') return 'legacy_doc'
  if ((MATERIAL_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) return 'image'
  if (file.type === 'application/pdf' || lowerName.endsWith('.pdf')) return 'pdf'
  if (file.type === DOCX_MIME_TYPE || lowerName.endsWith('.docx')) return 'docx'
  return 'unsupported'
}
