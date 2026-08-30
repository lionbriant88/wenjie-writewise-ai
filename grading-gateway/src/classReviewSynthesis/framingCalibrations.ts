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
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = Reflect.ownKeys(record)
  if (keys.length !== CALIBRATION_KEYS.length) return false
  if (!CALIBRATION_KEYS.every((key) => Object.prototype.hasOwnProperty.call(record, key))) return false
  return record.apiBase === 'https://api.moonshot.cn/v1'
    && record.model === 'kimi-k3'
    && record.reasoningEffort === 'low'
    && record.policyVersion === 'class-review-policy-v1'
    && record.schemaVersion === 'kimi-class-review-output-v1'
    && record.projectionVersion === 'class-review-projection-v1'
    && record.budgetVersion === 'class-review-prompt-budget-v1'
    && record.wireSerializationVersion === CLASS_REVIEW_WIRE_SERIALIZATION_VERSION
    && Number.isSafeInteger(record.framingTokens)
    && (record.framingTokens as number) >= 0
    && (record.framingTokens as number) <= FRAMING_RESERVE_TOKENS_V1
}

export const PRODUCTION_CLASS_REVIEW_FRAMING_CALIBRATION:
ClassReviewFramingCalibration | null = null
