import type { ErrorAnnotation, ScoreDimension } from '../types'

export interface GradeBand {
  label: '优秀' | '良好' | '合格' | '待提升' | '基础薄弱'
  tone: 'excellent' | 'good' | 'pass' | 'weak' | 'veryWeak'
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

export function getGradeBand(totalScore: number): GradeBand {
  if (totalScore >= 13) return { label: '优秀', tone: 'excellent' }
  if (totalScore >= 10) return { label: '良好', tone: 'good' }
  if (totalScore >= 7) return { label: '合格', tone: 'pass' }
  if (totalScore >= 4) return { label: '待提升', tone: 'weak' }
  return { label: '基础薄弱', tone: 'veryWeak' }
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
  aiConfidence,
  issues,
}: {
  totalScore: number
  aiConfidence: number
  issues: ErrorAnnotation[]
}) {
  const normalizedConfidence = normalizeConfidence(aiConfidence)
  const highSeverityCount = issues.filter((issue) => issue.severity === 'high').length

  if (normalizedConfidence < 0.7) return '建议教师复核'
  if (highSeverityCount >= 2) return '建议重点讲评'
  if (totalScore >= 13) return '可作为优秀范例'
  if (totalScore >= 10) return '普通反馈'
  if (totalScore >= 7) return '建议关注主要问题'
  return '建议教师复核'
}
