import type { EssayPage } from '../../types'
import type { UploadEssayGroup } from '../../utils/essayGrouping'

export type OcrMode = 'mock' | 'real'
export type OcrRunStatus = 'idle' | 'running' | 'success' | 'failed'
export type OcrProviderName = 'mock' | 'remote'
export type OcrStatus = 'success' | 'partial' | 'failed'

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
  warnings?: string[]
}

export interface OcrGatewayResponse {
  results: OcrEssayResult[]
}

export interface OcrRunInput {
  groups: UploadEssayGroup[]
  getGroupPages: (group: UploadEssayGroup) => EssayPage[]
  getPageFile: (pageId: string) => File | undefined
  pageOrderIndex: Map<string, number>
}

export interface OcrClient {
  recognize(input: OcrRunInput): Promise<OcrEssayResult[]>
}
