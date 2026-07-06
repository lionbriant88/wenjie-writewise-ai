export const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024
export const MAX_PAGES_PER_REQUEST = 10

export const allowedImageMimeTypes = ['image/png', 'image/jpeg', 'image/webp'] as const

export type AllowedImageMimeType = (typeof allowedImageMimeTypes)[number]
export type GatewayProviderName = 'mock' | 'mock_failure' | 'paddle_local'
export type OcrProviderName = 'mock' | 'remote'
export type OcrStatus = 'success' | 'partial' | 'failed'

export interface GatewayPageInput {
  pageId: string
  originalName: string
  mimeType: string
  size: number
  buffer: Buffer
}

export interface GatewayRecognizeInput {
  essayGroupId: string
  pages: GatewayPageInput[]
}

export interface OcrPageResult {
  pageId: string
  text: string
  confidence?: number
  warnings?: string[]
}

export interface OcrEssayResult {
  essayGroupId: string
  text: string
  pages: OcrPageResult[]
  provider: OcrProviderName
  status: OcrStatus
  error?: string
}

export interface OcrGatewayResponse {
  results: OcrEssayResult[]
}
