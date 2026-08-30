import { describe, expect, it } from 'vitest'
import {
  PRODUCTION_CLASS_REVIEW_FRAMING_CALIBRATION,
  isExactClassReviewFramingCalibration,
  type ClassReviewFramingCalibration,
} from './framingCalibrations.js'

export const syntheticCalibration: ClassReviewFramingCalibration = {
  apiBase: 'https://api.moonshot.cn/v1',
  model: 'kimi-k3',
  reasoningEffort: 'low',
  policyVersion: 'class-review-policy-v1',
  schemaVersion: 'kimi-class-review-output-v1',
  projectionVersion: 'class-review-projection-v1',
  budgetVersion: 'class-review-prompt-budget-v1',
  wireSerializationVersion: 'class-review-wire-serialization-v1',
  framingTokens: 512,
}

describe('class-review framing calibration', () => {
  it('ships no production calibration', () => {
    expect(PRODUCTION_CLASS_REVIEW_FRAMING_CALIBRATION).toBeNull()
  })

  it('accepts only the exact current tuple and safe integer framing bound', () => {
    expect(isExactClassReviewFramingCalibration(syntheticCalibration)).toBe(true)
    const hiddenExtra = { ...syntheticCalibration }
    Object.defineProperty(hiddenExtra, 'extra', { value: true })
    for (const value of [
      { ...syntheticCalibration, apiBase: 'https://example.invalid/v1' },
      { ...syntheticCalibration, model: 'other' },
      { ...syntheticCalibration, reasoningEffort: 'high' },
      { ...syntheticCalibration, policyVersion: 'class-review-policy-v2' },
      { ...syntheticCalibration, schemaVersion: 'kimi-class-review-output-v2' },
      { ...syntheticCalibration, projectionVersion: 'class-review-projection-v2' },
      { ...syntheticCalibration, budgetVersion: 'class-review-prompt-budget-v2' },
      { ...syntheticCalibration, wireSerializationVersion: 'class-review-wire-serialization-v2' },
      { ...syntheticCalibration, framingTokens: 513 },
      { ...syntheticCalibration, framingTokens: 1.5 },
      { ...syntheticCalibration, extra: true },
      hiddenExtra,
      { ...syntheticCalibration, [Symbol('extra')]: true },
      null,
    ]) {
      expect(isExactClassReviewFramingCalibration(value)).toBe(false)
    }
  })

  it('rejects accessor and throwing-proxy inputs without executing untrusted properties', () => {
    let getterReads = 0
    const accessor = { ...syntheticCalibration } as Record<string, unknown>
    Object.defineProperty(accessor, 'framingTokens', {
      enumerable: true,
      get() {
        getterReads += 1
        throw new Error('accessor must not execute')
      },
    })
    const throwingProxy = new Proxy(syntheticCalibration, {
      ownKeys() {
        throw new Error('proxy trap')
      },
    })

    expect(() => isExactClassReviewFramingCalibration(accessor)).not.toThrow()
    expect(isExactClassReviewFramingCalibration(accessor)).toBe(false)
    expect(getterReads).toBe(0)
    expect(() => isExactClassReviewFramingCalibration(throwingProxy)).not.toThrow()
    expect(isExactClassReviewFramingCalibration(throwingProxy)).toBe(false)
  })
})
