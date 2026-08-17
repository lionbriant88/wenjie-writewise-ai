import { calculateDimensionMaxScore, calculateTotalScore, roundScore2 } from './scoringRules'
import type { GradingClient } from './types'

export function createMockGradingClient(): GradingClient {
  return {
    async gradeImages(request) {
      const confirmedMode = request.confirmedTranscript !== undefined
      if (confirmedMode
        ? request.pages.length !== 0 || request.pageIds.length !== 0 || !request.confirmedTranscript?.trim()
        : request.pages.length < 1 || request.pages.length !== request.pageIds.length || request.pages.some(({ file }) => !file)) {
        return { requestId: request.requestId, status: 'failed', error: { code: 'invalid_request', message: '作文图片不可用。', retryable: false } }
      }
      const transcript = request.confirmedTranscript ?? '本地 mock 图片文本，用于验证图片直传批改流程。'
      const createdAt = new Date().toISOString()
      const dimensionScores = request.task.rubric.dimensions.map((dimension) => {
        const maxScore = calculateDimensionMaxScore(request.task.fullScore, dimension.weight)
        return { dimensionId: dimension.id, name: dimension.name, score: roundScore2(maxScore * 0.8), maxScore, weight: dimension.weight, reason: '本地 mock 图片批改结果。', evidence: transcript }
      })
      return {
        resultVersion: 'grading-result-v2', requestId: request.requestId, essayId: request.essayId, provider: 'mock', status: 'success',
        totalScore: calculateTotalScore(dimensionScores.map(({ score }) => score), request.task.fullScore), maxScore: request.task.fullScore,
        dimensionScores, issues: [], sentenceRevisions: [], expressionUpgrades: [],
        fullTextRevision: { originalText: transcript, correctedText: transcript, improvedText: transcript, sentencePairs: [], logicNotes: [], logicIssues: [] },
        overallComment: '本地 mock 图片批改结果，请教师复核。', reviewReasons: ['local_mock'], createdAt,
        transcript, recognitionWarnings: [], legibilityIssues: [], printedTextExcluded: true,
      }
    },
  }
}
