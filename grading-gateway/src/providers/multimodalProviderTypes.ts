import type { ConfirmedTaskPackageV2, GeneratedRubricV1 } from '../multimodal/types.js'

export interface GatewayImageInput {
  pageId: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  buffer: Buffer
}

export interface GenerateRubricProviderInput {
  requestId: string
  fullScore: number
  pages: GatewayImageInput[]
  signal: AbortSignal
}

export interface GradeEssayProviderInput {
  requestId: string
  task: ConfirmedTaskPackageV2
  essayId: string
  pages: GatewayImageInput[]
  signal: AbortSignal
}

export interface MultimodalProvider {
  generateRubric(input: GenerateRubricProviderInput): Promise<GeneratedRubricV1>
  gradeEssay(input: GradeEssayProviderInput): Promise<unknown>
}
