import { describe, expect, it } from 'vitest'
import { GradingProviderError } from '../providers/providerTypes.js'
import { deriveClassReviewPromptCacheKey } from './promptCacheKey.js'

const base = {
  hmacSecret: '  0123456789abcdef0123456789abcdef  ',
  rubricRevisionDigest: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  policyVersion: 'class-review-policy-v1',
  schemaVersion: 'kimi-class-review-output-v1',
  projectionVersion: 'class-review-projection-v1',
}

describe('class-review prompt cache key', () => {
  it('derives the exact normalized revision-only HMAC tuple', () => {
    expect(deriveClassReviewPromptCacheKey(base)).toBe('ZS4Y09bDJCPPH6rQnTo-O_Z9UBs0m93grwziilpjzk8')
    expect(deriveClassReviewPromptCacheKey(base)).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it.each([
    ['rubricRevisionDigest', 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'],
    ['policyVersion', 'class-review-policy-v2'],
    ['schemaVersion', 'kimi-class-review-output-v2'],
    ['projectionVersion', 'class-review-projection-v2'],
  ] as const)('changes when %s changes', (key, value) => {
    expect(deriveClassReviewPromptCacheKey({ ...base, [key]: value })).not.toBe(
      deriveClassReviewPromptCacheKey(base),
    )
  })

  it('rejects missing, blank, short, and extra-key inputs with content-free configuration errors', () => {
    const nonEnumerableExtra = { ...base }
    Object.defineProperty(nonEnumerableExtra, 'taskId', { value: 'private-task' })
    const symbolExtra = { ...base, [Symbol('student')]: 'private-student' }
    const invalid = [
      { ...base, hmacSecret: '' },
      { ...base, hmacSecret: ' '.repeat(40) },
      { ...base, hmacSecret: 'a'.repeat(31) },
      { ...base, taskId: 'private-task' },
      nonEnumerableExtra,
      symbolExtra,
      Object.assign(Object.create({ hmacSecret: base.hmacSecret }), {
        rubricRevisionDigest: base.rubricRevisionDigest,
        policyVersion: base.policyVersion,
        schemaVersion: base.schemaVersion,
        projectionVersion: base.projectionVersion,
      }),
    ]
    for (const value of invalid) {
      try {
        deriveClassReviewPromptCacheKey(value as typeof base)
        throw new Error('expected failure')
      } catch (error) {
        expect(error).toBeInstanceOf(GradingProviderError)
        expect(error).toMatchObject({ code: 'provider_not_configured', retryable: false })
        expect(String((error as Error).message)).not.toContain('private-task')
      }
    }
  })

  it('measures the normalized secret in UTF-8 bytes', () => {
    expect(() => deriveClassReviewPromptCacheKey({ ...base, hmacSecret: ` ${'界'.repeat(10)}a ` })).toThrowError(GradingProviderError)
    expect(deriveClassReviewPromptCacheKey({ ...base, hmacSecret: ` ${'界'.repeat(11)} ` })).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})
