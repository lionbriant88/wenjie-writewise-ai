export interface GeneratedRubricDimensionV1 {
  id: string
  name: string
  weight: number
  description: string
  deductionFocus: string[]
  sourceEvidence: string[]
}

export interface GeneratedRubricV1 {
  taskName: string
  materialSummary: string
  writingRequirements: string[]
  constraints: string[]
  dimensions: GeneratedRubricDimensionV1[]
  reviewWarnings: string[]
}

export interface ConfirmedTaskPackageV2 {
  taskId: string
  fullScore: number
  materialSummary: string
  writingRequirements: string[]
  constraints: string[]
  rubric: GeneratedRubricV1
}

export interface MultimodalGradeInputV2 {
  task: ConfirmedTaskPackageV2
  essayId: string
  confirmedTranscript: string
  imageDataUrls: string[]
}

export interface ProviderMultimodalPayloadV1 {
  task: ConfirmedTaskPackageV2
  essay: {
    essayId: string
    confirmedTranscript: string
    imageDataUrls: string[]
  }
}
