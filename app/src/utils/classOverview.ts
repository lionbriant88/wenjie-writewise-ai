import type { Essay, GradingResult } from '../types'

const scoreBands = [
  { label: '1-3', min: 1, max: 3 },
  { label: '4-6', min: 4, max: 6 },
  { label: '7-9', min: 7, max: 9 },
  { label: '10-12', min: 10, max: 12 },
  { label: '13-15', min: 13, max: 15 },
] as const

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
): ClassOverviewStats {
  const essayIds = new Set(essays.map((essay) => essay.id))
  const scores = gradingResults
    .filter((result) => essayIds.has(result.essayId) && Number.isFinite(result.totalScore))
    .map((result) => result.totalScore)

  const bands = scoreBands.map<ClassOverviewBand>((band) => {
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
