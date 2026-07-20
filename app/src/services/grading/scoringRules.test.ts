import { describe, expect, it } from 'vitest'
import {
  calculateDimensionMaxScore,
  calculateTotalScore,
  hasValidRubricWeights,
  isValidRubricWeight,
  roundScore2,
} from './scoringRules'

describe('shared grading score rules', () => {
  it('accepts integer weights only and requires an exact total of 100', () => {
    expect(isValidRubricWeight(0)).toBe(true)
    expect(isValidRubricWeight(100)).toBe(true)
    expect(isValidRubricWeight(33.3)).toBe(false)
    expect(isValidRubricWeight(-1)).toBe(false)
    expect(isValidRubricWeight(101)).toBe(false)
    expect(hasValidRubricWeights([40, 35, 25])).toBe(true)
    expect(hasValidRubricWeights([40, 35, 24])).toBe(false)
    expect(hasValidRubricWeights([50.5, 49.5])).toBe(false)
  })

  it('rounds dimension scores and maximums to two decimals', () => {
    expect(roundScore2(1.005)).toBe(1.01)
    expect(calculateDimensionMaxScore(15, 33)).toBe(4.95)
    expect(calculateDimensionMaxScore(17, 33)).toBe(5.61)
  })

  it('rounds the sum to an integer and clamps it to the full-score range', () => {
    expect(calculateTotalScore([4.49, 4.49, 4.49], 15)).toBe(13)
    expect(calculateTotalScore([8, 8], 15)).toBe(15)
    expect(calculateTotalScore([-4, 1], 15)).toBe(0)
  })
})
