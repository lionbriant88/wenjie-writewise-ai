import type { Essay, GradingResult } from '../types'
import { getDynamicScoreBands } from './gradingDiagnostics'

export interface ClassOverviewBand {
  label: string
  count: number
  percent: number
}

export interface ClassOverviewStats {
  totalEssayCount: number
  scoredEssayCount: number
  averageScore: number | null
  highestScore: number | null
  lowestScore: number | null
  bands: ClassOverviewBand[]
}

function roundToOneDecimal(value: number) {
  return Math.round(value * 10) / 10
}

export function getClassOverviewStats(
  essays: Essay[],
  gradingResults: GradingResult[],
  fullScore: number,
): ClassOverviewStats {
  const confirmedEssayIds = new Set(
    essays
      .filter((essay) => essay.status === 'completed' && essay.teacherReviewed)
      .map((essay) => essay.id),
  )
  const scores = gradingResults
    .filter((result) => confirmedEssayIds.has(result.essayId) && Number.isFinite(result.totalScore))
    .map((result) => result.totalScore)

  const bands = getDynamicScoreBands(fullScore).map<ClassOverviewBand>((band) => {
    const count = scores.filter((score) => {
      const roundedScore = Math.round(score)
      return roundedScore >= band.min && roundedScore <= band.max
    }).length

    return {
      label: band.label,
      count,
      percent: scores.length > 0 ? Math.round((count / scores.length) * 100) : 0,
    }
  })

  if (scores.length === 0) {
    return {
      totalEssayCount: essays.length,
      scoredEssayCount: 0,
      averageScore: null,
      highestScore: null,
      lowestScore: null,
      bands,
    }
  }

  return {
    totalEssayCount: essays.length,
    scoredEssayCount: scores.length,
    averageScore: roundToOneDecimal(scores.reduce((sum, score) => sum + score, 0) / scores.length),
    highestScore: roundToOneDecimal(Math.max(...scores)),
    lowestScore: roundToOneDecimal(Math.min(...scores)),
    bands,
  }
}
