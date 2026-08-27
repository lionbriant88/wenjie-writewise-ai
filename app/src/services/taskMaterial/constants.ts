export const MATERIAL_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export const MATERIAL_FILE_ACCEPT =
  'image/jpeg,image/png,image/webp,application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx'

export const MAX_MATERIAL_UNITS = 10
export const MAX_MATERIAL_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_MATERIAL_DOCUMENT_BYTES = 20 * 1024 * 1024
export const MAX_DOCX_TEXT_CHARACTERS = 30_000
