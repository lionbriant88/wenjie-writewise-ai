import {
  calculateDimensionMaxScore,
  calculateTotalScore,
  roundScore2,
} from './scoringRules'
import type { GradingClient } from './types'

function firstTranscriptSentence(transcript: string) {
  const sentenceEnd = transcript.search(/[.!?。！？]/u)
  return (sentenceEnd >= 0 ? transcript.slice(0, sentenceEnd + 1) : transcript.slice(0, 80)).trim()
}

export function createMockGradingClient(): GradingClient {
  return {
    async grade(request) {
      const transcript = request.essay.confirmedTranscript.trim()
      if (!transcript) {
        return {
          requestId: request.requestId,
          status: 'failed',
          error: { code: 'invalid_request', message: '确认文本不能为空。', retryable: false },
        }
      }

      const createdAt = new Date().toISOString()
      const dimensionScores = request.task.rubric.dimensions.map((dimension) => {
        const maxScore = calculateDimensionMaxScore(request.task.fullScore, dimension.weight)
        return {
          dimensionId: dimension.id,
          name: dimension.name,
          score: roundScore2(maxScore * 0.8),
          maxScore,
          weight: dimension.weight,
          reason: '本地 mock：根据已确认评分维度生成稳定结果。',
          evidence: transcript.slice(0, 80),
        }
      })
      const totalScore = calculateTotalScore(
        dimensionScores.map(({ score }) => score),
        request.task.fullScore,
      )
      const quote = firstTranscriptSentence(transcript)

      return {
        resultVersion: 'grading-result-v1',
        requestId: request.requestId,
        essayId: request.essay.essayId,
        provider: 'mock',
        status: 'success',
        totalScore,
        maxScore: request.task.fullScore,
        dimensionScores,
        issues: [{
          id: `${request.essay.essayId}-mock-review`,
          type: 'structure',
          severity: 'low',
          originalText: quote,
          suggestion: quote,
          explanation: '本地 mock 仅标记一处真实文本片段供链路测试。',
          requiresTeacherReview: true,
        }],
        sentenceRevisions: [],
        expressionUpgrades: [],
        fullTextRevision: {
          originalText: transcript,
          correctedText: transcript,
          improvedText: transcript,
          sentencePairs: [],
          logicNotes: ['本地 mock 仅用于链路回退，不代表真实 AI 质量。'],
        },
        overallComment: '本地 mock 批改结果，请教师复核。',
        reviewReasons: ['本结果由本地 mock 生成。'],
        createdAt,
      }
    },
  }
}
