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
  const eligibleEssayIds = new Set(
    essays
      .filter((essay) => essay.status === 'grading_ready' || essay.status === 'completed')
      .map((essay) => essay.id),
  )
  const resultsByEssayId = new Map<string, GradingResult[]>()
  for (const result of gradingResults) {
    if (!eligibleEssayIds.has(result.essayId) || !Number.isFinite(result.totalScore)) continue
    const current = resultsByEssayId.get(result.essayId)
    if (current) current.push(result)
    else resultsByEssayId.set(result.essayId, [result])
  }
  const scores: number[] = []
  for (const essay of essays) {
    if (!eligibleEssayIds.has(essay.id)) continue
    const candidates = resultsByEssayId.get(essay.id) ?? []
    const matching = essay.aiResultId
      ? candidates.filter((result) => result.id === essay.aiResultId)
      : candidates
    if (matching.length === 1) scores.push(matching[0].totalScore)
  }

  return getClassOverviewStatsFromScores(essays.length, scores, fullScore)
}

export function getClassOverviewStatsFromScores(
  totalEssayCount: number,
  scores: readonly number[],
  fullScore: number,
): ClassOverviewStats {

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
      totalEssayCount,
      scoredEssayCount: 0,
      averageScore: null,
      highestScore: null,
      lowestScore: null,
      bands,
    }
  }

  return {
    totalEssayCount,
    scoredEssayCount: scores.length,
    averageScore: roundToOneDecimal(scores.reduce((sum, score) => sum + score, 0) / scores.length),
    highestScore: roundToOneDecimal(Math.max(...scores)),
    lowestScore: roundToOneDecimal(Math.min(...scores)),
    bands,
  }
}
