import {
  calculateDimensionMaxScore,
  calculateTotalScore,
  roundScore2,
} from '../../../app/src/services/grading/scoringRules.js'
import type { ProviderGradingPayloadV1 } from '../types.js'
import { GradingProviderError, type GradingProvider, type GradingProviderInput } from './providerTypes.js'

function firstSentence(transcript: string) {
  const end = transcript.search(/[.!?。！？]/u)
  return end >= 0 ? transcript.slice(0, end + 1) : transcript.slice(0, 80)
}

export class MockGradingProvider implements GradingProvider {
  readonly publicName = 'mock' as const

  async grade({ request, signal }: GradingProviderInput): Promise<ProviderGradingPayloadV1> {
    if (signal.aborted) throw new GradingProviderError('provider_timeout', 'AI 批改超时。', true)
    const quote = firstSentence(request.essay.confirmedTranscript)
    const dimensionScores = request.task.rubric.dimensions.map((dimension) => {
      const maxScore = calculateDimensionMaxScore(request.task.fullScore, dimension.weight)
      return {
        dimensionId: dimension.id,
        score: roundScore2(maxScore * 0.8),
        reason: 'Gateway mock：根据已确认评分维度生成稳定候选结果。',
        evidence: quote,
      }
    })
    return {
      reportedTotalScore: calculateTotalScore(
        dimensionScores.map(({ score }) => score),
        request.task.fullScore,
      ),
      dimensionScores,
      issues: [{
        type: 'structure',
        severity: 'low',
        originalText: quote,
        suggestion: quote,
        explanation: 'Gateway mock 仅用于验证服务端结构化链路。',
        requiresTeacherReview: true,
      }],
      sentenceRevisions: [],
      expressionUpgrades: [],
      fullTextRevision: {
        correctedText: request.essay.confirmedTranscript,
        improvedText: request.essay.confirmedTranscript,
        sentencePairs: [],
        logicNotes: [{ quote, note: 'Gateway mock 不代表真实 AI 批改质量。' }],
      },
      overallComment: 'Gateway mock 批改结果，请教师复核。',
      reviewReasons: [],
    }
  }
}
