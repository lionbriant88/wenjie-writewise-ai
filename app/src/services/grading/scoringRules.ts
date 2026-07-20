export const RUBRIC_WEIGHT_DECIMALS = 0
export const DIMENSION_SCORE_DECIMALS = 2

export function isValidRubricWeight(weight: number) {
  return Number.isInteger(weight) && weight >= 0 && weight <= 100
}

export function hasValidRubricWeights(weights: number[]) {
  return weights.length > 0
    && weights.every(isValidRubricWeight)
    && weights.reduce((sum, weight) => sum + weight, 0) === 100
}

export function roundScore2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function calculateDimensionMaxScore(fullScore: number, weight: number) {
  return roundScore2(fullScore * weight / 100)
}

export function calculateTotalScore(scores: number[], fullScore: number) {
  const rounded = Math.round(scores.map(roundScore2).reduce((sum, score) => sum + score, 0))
  return Math.min(Math.max(rounded, 0), fullScore)
}
