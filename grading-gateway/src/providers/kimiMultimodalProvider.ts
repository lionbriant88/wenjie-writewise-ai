import { validateGeneratedRubric } from '../multimodal/validateRubric.js'
import { validateTaskMaterialContext, prioritizeTeacherWritingRequirement } from '../multimodal/materialContextContract.js'
import { buildMaterialContextMessages, materialContextSchema } from '../multimodal/materialContextPrompts.js'
import { generatedRubricSchema, reviewedRubricSchema, buildRubricGenerationMessages, buildRubricReviewMessages } from '../multimodal/rubricPrompts.js'
import type { GeneratedRubricV1, TaskMaterialContextV1 } from '../multimodal/types.js'
import { buildEssayGradingMessages, essayGradingSchema } from '../multimodal/gradingPrompt.js'
import type { GenerateMaterialContextProviderInput, GenerateRubricProviderRequest, GradeEssayProviderInput, MultimodalProvider } from './multimodalProviderTypes.js'
import type { KimiTransport } from './kimiTransport.js'
import { GradingProviderError } from './providerTypes.js'

function invalidRubricError() {
  return new GradingProviderError('provider_invalid_response', 'Kimi 返回的评分标准不符合要求。', true)
}

function invalidMaterialContextError() {
  return new GradingProviderError('provider_invalid_response', 'Kimi 返回的题目材料上下文不符合要求。', true)
}

function prioritizeRubricContext(
  rubric: GeneratedRubricV1,
  teacherRequirement: string | undefined,
): GeneratedRubricV1 {
  const context = prioritizeTeacherWritingRequirement(rubric, teacherRequirement)
  return {
    ...rubric,
    materialSummary: context.materialSummary,
    writingRequirements: context.writingRequirements,
    constraints: context.constraints,
    reviewWarnings: context.reviewWarnings,
  }
}

function rubricMaterials(input: GenerateRubricProviderRequest) {
  if ('materials' in input) {
    return { materials: input.materials, writingRequirement: input.writingRequirement }
  }
  return {
    materials: input.pages.map((page) => ({
      kind: 'image' as const,
      unitId: page.pageId,
      mimeType: page.mimeType,
      buffer: page.buffer,
    })),
    writingRequirement: undefined,
  }
}

export class KimiMultimodalProvider implements MultimodalProvider {
  constructor(private readonly transport: KimiTransport) {}

  async generateMaterialContext(input: GenerateMaterialContextProviderInput): Promise<TaskMaterialContextV1> {
    const response = await this.transport.complete({
      messages: buildMaterialContextMessages({
        fullScore: input.fullScore,
        writingRequirement: input.writingRequirement,
        materials: input.materials,
      }),
      schemaName: 'material-context',
      schema: materialContextSchema,
      signal: input.signal,
    })
    const validation = validateTaskMaterialContext(response)
    if (!validation.ok) throw invalidMaterialContextError()
    return prioritizeTeacherWritingRequirement(validation.value, input.writingRequirement)
  }

  async generateRubric(input: GenerateRubricProviderRequest): Promise<GeneratedRubricV1> {
    const source = rubricMaterials(input)
    const rawDraft = await this.transport.complete({
      messages: buildRubricGenerationMessages({
        fullScore: input.fullScore,
        writingRequirement: source.writingRequirement,
        materials: source.materials,
      }),
      schemaName: 'generated-rubric',
      schema: generatedRubricSchema,
      signal: input.signal,
    })
    const draftValidation = validateGeneratedRubric(rawDraft)
    if (!draftValidation.ok) throw invalidRubricError()
    const draft = prioritizeRubricContext(draftValidation.value, source.writingRequirement)

    const rawReviewed = await this.transport.complete({
      messages: buildRubricReviewMessages({
        fullScore: input.fullScore,
        writingRequirement: source.writingRequirement,
        materials: source.materials,
        draft,
      }),
      schemaName: 'reviewed-rubric',
      schema: reviewedRubricSchema,
      signal: input.signal,
    })
    const validation = validateGeneratedRubric(rawReviewed)
    if (!validation.ok) throw invalidRubricError()
    return prioritizeRubricContext(validation.value, source.writingRequirement)
  }

  async gradeEssay(input: GradeEssayProviderInput): Promise<unknown> {
    return this.transport.complete({
      messages: buildEssayGradingMessages({ task: input.task, essayId: input.essayId, pages: input.pages, confirmedTranscript: input.confirmedTranscript }),
      schemaName: 'essay-grading', schema: essayGradingSchema, signal: input.signal,
    })
  }
}
