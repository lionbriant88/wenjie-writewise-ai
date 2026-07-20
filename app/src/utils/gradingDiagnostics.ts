import type { ErrorAnnotation, ScoreDimension } from '../types'

export interface GradeBand {
  label: '优秀' | '良好' | '合格' | '待提升' | '基础薄弱'
  tone: 'excellent' | 'good' | 'pass' | 'weak' | 'veryWeak'
}

export interface DynamicScoreBand {
  label: string
  min: number
  max: number
}

function getBandThresholds(fullScore: number) {
  const normalizedFullScore = Math.max(1, Math.round(fullScore))

  return {
    fullScore: normalizedFullScore,
    excellentMin: Math.ceil((normalizedFullScore * 13) / 15),
    goodMin: Math.ceil((normalizedFullScore * 10) / 15),
    passMin: Math.ceil((normalizedFullScore * 7) / 15),
    weakMin: Math.ceil((normalizedFullScore * 4) / 15),
  }
}

function getScoreRate(dimension: ScoreDimension) {
  if (!dimension.maxScore) return 0
  return dimension.score / dimension.maxScore
}

export function clampDimensionScore(value: number, maxScore: number) {
  if (!Number.isFinite(value)) return 0

  const clamped = Math.min(Math.max(value, 0), maxScore)
  const rounded = Math.round(clamped * 100) / 100

  return Math.min(rounded, maxScore)
}

export function calculateTotalScore(dimensions: ScoreDimension[], fullScore = 15) {
  const rawTotal = dimensions.reduce((sum, dimension) => sum + dimension.score, 0)
  const roundedTotal = Math.round(rawTotal)
  return Math.min(Math.max(roundedTotal, 0), fullScore)
}

export function formatTotalScore(score: number) {
  return String(Math.round(score))
}

export function formatDimensionScore(score: number) {
  return Number.isInteger(score) ? String(score) : String(score)
}

export function normalizeConfidence(confidence: number) {
  return confidence > 1 ? confidence / 100 : confidence
}

export function formatConfidence(confidence: number) {
  return `${Math.round(normalizeConfidence(confidence) * 100)}%`
}

export function getGradeBand(totalScore: number, fullScore = 15): GradeBand {
  const { excellentMin, goodMin, passMin, weakMin } = getBandThresholds(fullScore)

  if (totalScore >= excellentMin) return { label: '优秀', tone: 'excellent' }
  if (totalScore >= goodMin) return { label: '良好', tone: 'good' }
  if (totalScore >= passMin) return { label: '合格', tone: 'pass' }
  if (totalScore >= weakMin) return { label: '待提升', tone: 'weak' }
  return { label: '基础薄弱', tone: 'veryWeak' }
}

export function getDynamicScoreBands(fullScore: number): DynamicScoreBand[] {
  const { fullScore: maxScore, excellentMin, goodMin, passMin, weakMin } = getBandThresholds(fullScore)
  const boundaries = [0, weakMin, passMin, goodMin, excellentMin, maxScore + 1]

  return boundaries.slice(0, -1).flatMap((min, index) => {
    const max = boundaries[index + 1] - 1
    return min <= max ? [{ label: `${min}-${max}`, min, max }] : []
  })
}

export function getMainDeductionDimensions(dimensions: ScoreDimension[], limit = 2) {
  return [...dimensions].sort((left, right) => getScoreRate(left) - getScoreRate(right)).slice(0, limit)
}

export function getSeverityImpactLabel(severity: ErrorAnnotation['severity']) {
  if (severity === 'high') return '高'
  if (severity === 'medium') return '中'
  return '低'
}

export function getReviewRecommendation({
  totalScore,
  issues,
  fullScore = 15,
}: {
  totalScore: number
  issues: ErrorAnnotation[]
  fullScore?: number
}) {
  const highSeverityCount = issues.filter((issue) => issue.severity === 'high').length
  const gradeBand = getGradeBand(totalScore, fullScore)

  if (highSeverityCount >= 2) return '建议重点讲评'
  if (gradeBand.tone === 'excellent') return '可作为优秀范例'
  if (gradeBand.tone === 'good') return '普通反馈'
  if (gradeBand.tone === 'pass') return '建议关注主要问题'
  return '建议教师复核'
}
