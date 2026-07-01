import { describe, expect, it } from 'vitest'
import type { ErrorAnnotation, ScoreDimension } from '../types'
import {
  calculateTotalScore,
  clampDimensionScore,
  formatConfidence,
  formatDimensionScore,
  formatTotalScore,
  getGradeBand,
  getMainDeductionDimensions,
  getReviewRecommendation,
  getSeverityImpactLabel,
  normalizeConfidence,
} from './gradingDiagnostics'

const dimensions: ScoreDimension[] = [
  {
    id: 'content',
    name: '内容完成度',
    score: 3.4,
    maxScore: 3.75,
    weight: 25,
    reason: '信息点完整',
    evidence: 'Suggestion is clear.',
  },
  {
    id: 'accuracy',
    name: '语言准确性',
    score: 2.4,
    maxScore: 3.75,
    weight: 25,
    reason: '基础语法错误较多',
    evidence: 'joins',
  },
  {
    id: 'handwriting',
    name: '卷面/字迹',
    score: 0.9,
    maxScore: 1.5,
    weight: 10,
    reason: '识别受影响',
    evidence: 'messy words',
  },
]

const highIssues: ErrorAnnotation[] = [
  {
    id: 'err-1',
    type: 'grammar',
    original: 'I suggest you joins.',
    suggestion: 'I suggest you join.',
    explanation: 'suggest 后用动词原形。',
    severity: 'high',
  },
  {
    id: 'err-2',
    type: 'structure',
    original: 'No closing sentence.',
    suggestion: 'Add a closing sentence.',
    explanation: '结尾不完整。',
    severity: 'high',
  },
]

describe('grading diagnostics', () => {
  it('calculates integer total score from dimensions and clamps to full score', () => {
    expect(calculateTotalScore(dimensions)).toBe(7)
    expect(calculateTotalScore([{ ...dimensions[0], score: 20 }], 15)).toBe(15)
    expect(calculateTotalScore([{ ...dimensions[0], score: -2 }], 15)).toBe(0)
  })

  it('formats total score separately from dimension score', () => {
    expect(formatTotalScore(13.1)).toBe('13')
    expect(formatTotalScore(13.6)).toBe('14')
    expect(formatDimensionScore(3)).toBe('3')
    expect(formatDimensionScore(3.75)).toBe('3.75')
  })

  it('clamps dimension score while preserving valid two-decimal max scores', () => {
    expect(clampDimensionScore(9, 3.75)).toBe(3.75)
    expect(clampDimensionScore(-1, 3.75)).toBe(0)
    expect(clampDimensionScore(Number.NaN, 3.75)).toBe(0)
    expect(clampDimensionScore(3.756, 3.75)).toBe(3.75)
    expect(clampDimensionScore(2.235, 2.25)).toBe(2.24)
  })

  it('returns five grade bands from integer total score', () => {
    expect(getGradeBand(15).label).toBe('优秀')
    expect(getGradeBand(13).label).toBe('优秀')
    expect(getGradeBand(12).label).toBe('良好')
    expect(getGradeBand(10).label).toBe('良好')
    expect(getGradeBand(9).label).toBe('合格')
    expect(getGradeBand(7).label).toBe('合格')
    expect(getGradeBand(6).label).toBe('待提升')
    expect(getGradeBand(4).label).toBe('待提升')
    expect(getGradeBand(3).label).toBe('基础薄弱')
    expect(getGradeBand(0).label).toBe('基础薄弱')
  })

  it('returns the lowest score-rate dimensions as main deductions and tolerates zero max score', () => {
    const zeroMaxDimension: ScoreDimension = {
      id: 'zero',
      name: '异常维度',
      score: 0,
      maxScore: 0,
      weight: 0,
      reason: '无满分',
      evidence: '',
    }

    expect(getMainDeductionDimensions([...dimensions, zeroMaxDimension]).map((item) => item.name)).toEqual([
      '异常维度',
      '卷面/字迹',
    ])
  })

  it('maps severity into teacher-facing impact labels', () => {
    expect(getSeverityImpactLabel('high')).toBe('高')
    expect(getSeverityImpactLabel('medium')).toBe('中')
    expect(getSeverityImpactLabel('low')).toBe('低')
  })

  it('normalizes and formats confidence stored as ratio or percent', () => {
    expect(normalizeConfidence(0.86)).toBe(0.86)
    expect(normalizeConfidence(86)).toBe(0.86)
    expect(formatConfidence(0.86)).toBe('86%')
    expect(formatConfidence(86)).toBe('86%')
  })

  it('builds review recommendations from integer score, normalized confidence, and issue severity', () => {
    expect(getReviewRecommendation({ totalScore: 14, aiConfidence: 0.9, issues: [] })).toBe('可作为优秀范例')
    expect(getReviewRecommendation({ totalScore: 12, aiConfidence: 0.9, issues: [] })).toBe('普通反馈')
    expect(getReviewRecommendation({ totalScore: 9, aiConfidence: 0.9, issues: [] })).toBe('建议关注主要问题')
    expect(getReviewRecommendation({ totalScore: 6, aiConfidence: 0.9, issues: [] })).toBe('建议教师复核')
    expect(getReviewRecommendation({ totalScore: 12, aiConfidence: 66, issues: [] })).toBe('建议教师复核')
    expect(getReviewRecommendation({ totalScore: 12, aiConfidence: 0.9, issues: highIssues })).toBe('建议重点讲评')
  })
})
