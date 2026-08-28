import type { GatewayTaskMaterial } from '../multipartTaskMaterials.js'
import type { ConfirmedTaskPackageV2, GeneratedRubricV1, TaskMaterialContextV1 } from '../multimodal/types.js'
import type { ProviderCallResult } from './providerTypes.js'

export interface GatewayImageInput {
  pageId: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  buffer: Buffer
}

export interface TaskMaterialProviderInput {
  requestId: string
  fullScore: number
  materials: GatewayTaskMaterial[]
  signal: AbortSignal
}

export interface GenerateMaterialContextProviderInput extends TaskMaterialProviderInput {
  writingRequirement: string
}

export interface GenerateRubricProviderInput extends TaskMaterialProviderInput {
  writingRequirement?: string
}

export interface GradeEssayProviderInput {
  requestId: string
  task: ConfirmedTaskPackageV2
  essayId: string
  pages: GatewayImageInput[]
  /** Exact text supplied by a teacher after reviewing an earlier transcription. */
  confirmedTranscript?: string
  signal: AbortSignal
}

export interface MultimodalProvider {
  generateMaterialContext(input: GenerateMaterialContextProviderInput): Promise<ProviderCallResult<TaskMaterialContextV1>>
  generateRubric(input: GenerateRubricProviderInput): Promise<ProviderCallResult<GeneratedRubricV1>>
  gradeEssay(input: GradeEssayProviderInput): Promise<ProviderCallResult<unknown>>
}
