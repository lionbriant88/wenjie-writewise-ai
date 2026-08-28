import { randomUUID } from 'node:crypto'
import { validateGeneratedRubric } from '../multimodal/validateRubric.js'
import { validateTaskMaterialContext, prioritizeTeacherWritingRequirement } from '../multimodal/materialContextContract.js'
import { buildMaterialContextMessages, materialContextSchema } from '../multimodal/materialContextPrompts.js'
import { generatedRubricSchema, reviewedRubricSchema, buildRubricGenerationMessages, buildRubricReviewMessages } from '../multimodal/rubricPrompts.js'
import type { GeneratedRubricV1, TaskMaterialContextV1 } from '../multimodal/types.js'
import { buildEssayGradingMessages, essayGradingSchema } from '../multimodal/gradingPrompt.js'
import type { GenerateMaterialContextProviderInput, GenerateRubricProviderInput, GradeEssayProviderInput, MultimodalProvider } from './multimodalProviderTypes.js'
import type { KimiTransport } from './kimiTransport.js'
import { GradingProviderError } from './providerTypes.js'

const defaultMaxCompletionTokens = 16_384

function diagnosticContext() {
  return randomUUID()
}

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

export class KimiMultimodalProvider implements MultimodalProvider {
  constructor(private readonly transport: KimiTransport) {}

  private get maxCompletionTokens() {
    return this.transport.maxCompletionTokens ?? defaultMaxCompletionTokens
  }

  async generateMaterialContext(input: GenerateMaterialContextProviderInput) {
    const response = await this.transport.complete({
      messages: buildMaterialContextMessages({
        fullScore: input.fullScore,
        writingRequirement: input.writingRequirement,
        materials: input.materials,
      }),
      schemaName: 'material-context',
      schema: materialContextSchema,
      signal: input.signal,
      stage: 'material_context', maxCompletionTokens: this.maxCompletionTokens, attempt: 1, diagnosticContext: diagnosticContext(),
    })
    const validation = validateTaskMaterialContext(response.value)
    if (!validation.ok) throw invalidMaterialContextError()
    return {
      value: prioritizeTeacherWritingRequirement(validation.value, input.writingRequirement),
      attempts: [response.observation],
    }
  }

  async generateRubric(input: GenerateRubricProviderInput) {
    const rawDraft = await this.transport.complete({
      messages: buildRubricGenerationMessages({
        fullScore: input.fullScore,
        writingRequirement: input.writingRequirement,
        materials: input.materials,
      }),
      schemaName: 'generated-rubric',
      schema: generatedRubricSchema,
      signal: input.signal,
      stage: 'rubric_generation', maxCompletionTokens: this.maxCompletionTokens, attempt: 1, diagnosticContext: diagnosticContext(),
    })
    const draftValidation = validateGeneratedRubric(rawDraft.value)
    if (!draftValidation.ok) throw invalidRubricError()
    const draft = prioritizeRubricContext(draftValidation.value, input.writingRequirement)

    const rawReviewed = await this.transport.complete({
      messages: buildRubricReviewMessages({
        fullScore: input.fullScore,
        writingRequirement: input.writingRequirement,
        materials: input.materials,
        draft,
      }),
      schemaName: 'reviewed-rubric',
      schema: reviewedRubricSchema,
      signal: input.signal,
      stage: 'rubric_generation', maxCompletionTokens: this.maxCompletionTokens, attempt: 2, diagnosticContext: diagnosticContext(),
    })
    const validation = validateGeneratedRubric(rawReviewed.value)
    if (!validation.ok) throw invalidRubricError()
    return {
      value: prioritizeRubricContext(validation.value, input.writingRequirement),
      attempts: [rawDraft.observation, rawReviewed.observation],
    }
  }

  async gradeEssay(input: GradeEssayProviderInput) {
    const response = await this.transport.complete({
      messages: buildEssayGradingMessages({ task: input.task, essayId: input.essayId, pages: input.pages, confirmedTranscript: input.confirmedTranscript }),
      schemaName: 'essay-grading', schema: essayGradingSchema, signal: input.signal,
      stage: input.confirmedTranscript === undefined ? 'essay_grading_images' : 'essay_regrading_text',
      maxCompletionTokens: this.maxCompletionTokens, attempt: 1, diagnosticContext: diagnosticContext(),
    })
    return { value: response.value, attempts: [response.observation] }
  }
}
