import {
  CLASS_REVIEW_WIRE_SERIALIZATION_VERSION,
  FRAMING_RESERVE_TOKENS_V1,
} from './limits.js'

export interface ClassReviewFramingCalibration {
  apiBase: 'https://api.moonshot.cn/v1'
  model: 'kimi-k3'
  reasoningEffort: 'low'
  policyVersion: 'class-review-policy-v1'
  schemaVersion: 'kimi-class-review-output-v1'
  projectionVersion: 'class-review-projection-v1'
  budgetVersion: 'class-review-prompt-budget-v1'
  wireSerializationVersion: typeof CLASS_REVIEW_WIRE_SERIALIZATION_VERSION
  framingTokens: number
}

const CALIBRATION_KEYS = [
  'apiBase',
  'model',
  'reasoningEffort',
  'policyVersion',
  'schemaVersion',
  'projectionVersion',
  'budgetVersion',
  'wireSerializationVersion',
  'framingTokens',
] as const

export function isExactClassReviewFramingCalibration(
  value: unknown,
): value is ClassReviewFramingCalibration {
  return parseClassReviewFramingCalibration(value) !== null
}

export function parseClassReviewFramingCalibration(
  value: unknown,
): ClassReviewFramingCalibration | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return null

    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)
    if (keys.length !== CALIBRATION_KEYS.length) return null
    if (!CALIBRATION_KEYS.every((key) => Object.prototype.hasOwnProperty.call(descriptors, key))) {
      return null
    }
    if (!CALIBRATION_KEYS.every((key) => Object.prototype.hasOwnProperty.call(descriptors[key], 'value'))) {
      return null
    }

    const apiBase = descriptors.apiBase.value
    const model = descriptors.model.value
    const reasoningEffort = descriptors.reasoningEffort.value
    const policyVersion = descriptors.policyVersion.value
    const schemaVersion = descriptors.schemaVersion.value
    const projectionVersion = descriptors.projectionVersion.value
    const budgetVersion = descriptors.budgetVersion.value
    const wireSerializationVersion = descriptors.wireSerializationVersion.value
    const framingTokens = descriptors.framingTokens.value

    if (apiBase !== 'https://api.moonshot.cn/v1'
      || model !== 'kimi-k3'
      || reasoningEffort !== 'low'
      || policyVersion !== 'class-review-policy-v1'
      || schemaVersion !== 'kimi-class-review-output-v1'
      || projectionVersion !== 'class-review-projection-v1'
      || budgetVersion !== 'class-review-prompt-budget-v1'
      || wireSerializationVersion !== CLASS_REVIEW_WIRE_SERIALIZATION_VERSION
      || !Number.isSafeInteger(framingTokens)
      || (framingTokens as number) < 0
      || (framingTokens as number) > FRAMING_RESERVE_TOKENS_V1) {
      return null
    }

    return Object.freeze({
      apiBase,
      model,
      reasoningEffort,
      policyVersion,
      schemaVersion,
      projectionVersion,
      budgetVersion,
      wireSerializationVersion,
      framingTokens,
    }) as ClassReviewFramingCalibration
  } catch {
    return null
  }
}

export const PRODUCTION_CLASS_REVIEW_FRAMING_CALIBRATION:
ClassReviewFramingCalibration | null = null
