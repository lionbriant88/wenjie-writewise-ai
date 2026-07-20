import {
  calculateDimensionMaxScore,
  calculateTotalScore,
  roundScore2,
} from '../../app/src/services/grading/scoringRules.js'

if (calculateDimensionMaxScore(15, 25) !== 3.75) {
  throw new Error('shared dimension maximum runtime check failed')
}
if (roundScore2(2.345) !== 2.35) {
  throw new Error('shared score rounding runtime check failed')
}
if (calculateTotalScore([3.75, 3.75, 3.75, 0.75], 15) !== 12) {
  throw new Error('shared total runtime check failed')
}

process.stdout.write('shared scoring runtime ok\n')
