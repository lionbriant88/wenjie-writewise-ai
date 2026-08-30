import { createHmac } from 'node:crypto'
import { GradingProviderError } from '../providers/providerTypes.js'

export interface ClassReviewPromptCacheKeyInput {
  hmacSecret: string
  rubricRevisionDigest: string
  policyVersion: string
  schemaVersion: string
  projectionVersion: string
}

const INPUT_KEYS = [
  'hmacSecret',
  'rubricRevisionDigest',
  'policyVersion',
  'schemaVersion',
  'projectionVersion',
] as const

function configurationError(): GradingProviderError {
  return new GradingProviderError(
    'provider_not_configured',
    'Class review Provider configuration is invalid.',
    false,
    undefined,
    { termination: 'confirmed' },
  )
}

function validateInput(value: unknown): ClassReviewPromptCacheKeyInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw configurationError()
  const record = value as Record<string, unknown>
  const keys = Reflect.ownKeys(record)
  if (keys.length !== INPUT_KEYS.length) throw configurationError()
  if (!INPUT_KEYS.every((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    throw configurationError()
  }
  if (!INPUT_KEYS.every((key) => typeof record[key] === 'string')) throw configurationError()
  const input = record as unknown as ClassReviewPromptCacheKeyInput
  const normalizedSecret = input.hmacSecret.trim()
  if (Buffer.byteLength(normalizedSecret, 'utf8') < 32) throw configurationError()
  if (
    input.rubricRevisionDigest.length === 0
    || input.policyVersion.length === 0
    || input.schemaVersion.length === 0
    || input.projectionVersion.length === 0
  ) throw configurationError()
  return { ...input, hmacSecret: normalizedSecret }
}

export function deriveClassReviewPromptCacheKey(
  value: ClassReviewPromptCacheKeyInput,
): string {
  const input = validateInput(value)
  const tuple = [
    'class-review-prompt-cache-key-v1',
    input.rubricRevisionDigest,
    input.policyVersion,
    input.schemaVersion,
    input.projectionVersion,
  ]
  return createHmac('sha256', input.hmacSecret)
    .update(JSON.stringify(tuple))
    .digest('base64url')
}
