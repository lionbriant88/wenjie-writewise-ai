import { validateGeneratedRubric } from '../multimodal/validateRubric.js'
import { generatedRubricSchema, reviewedRubricSchema, buildRubricGenerationMessages, buildRubricReviewMessages } from '../multimodal/rubricPrompts.js'
import type { GeneratedRubricV1 } from '../multimodal/types.js'
import type { GradeEssayProviderInput, GenerateRubricProviderInput, MultimodalProvider } from './multimodalProviderTypes.js'
import type { KimiTransport } from './kimiTransport.js'
import { GradingProviderError } from './providerTypes.js'

function invalidRubricError() {
  return new GradingProviderError('provider_invalid_response', 'Kimi 返回的评分标准不符合要求。', true)
}

export class KimiMultimodalProvider implements MultimodalProvider {
  constructor(private readonly transport: KimiTransport) {}

  async generateRubric(input: GenerateRubricProviderInput): Promise<GeneratedRubricV1> {
    const draft = await this.transport.complete({
      messages: buildRubricGenerationMessages({ fullScore: input.fullScore, pages: input.pages }),
      schemaName: 'generated-rubric',
      schema: generatedRubricSchema,
      signal: input.signal,
    })
    const reviewed = await this.transport.complete({
      messages: buildRubricReviewMessages({ fullScore: input.fullScore, pages: input.pages, draft }),
      schemaName: 'reviewed-rubric',
      schema: reviewedRubricSchema,
      signal: input.signal,
    })
    const validation = validateGeneratedRubric(reviewed)
    if (!validation.ok) throw invalidRubricError()
    return validation.value
  }

  async gradeEssay(_input: GradeEssayProviderInput): Promise<unknown> {
    throw new GradingProviderError('provider_not_configured', 'Kimi 作文评分尚未配置。', false)
  }
}
