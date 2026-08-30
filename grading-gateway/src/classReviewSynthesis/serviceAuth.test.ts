import { describe, expect, it, vi } from 'vitest'

const cryptoSpies = vi.hoisted(() => ({
  timingSafeEqual: vi.fn((left: Uint8Array, right: Uint8Array) =>
    Buffer.from(left).equals(Buffer.from(right)),
  ),
}))

vi.mock('node:crypto', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:crypto')>(),
  timingSafeEqual: cryptoSpies.timingSafeEqual,
}))

import { authorizeClassReviewServiceRequest } from './serviceAuth.js'

const serviceToken = 'S._~-0123456789abcdefghijklmnopqrstuvwxyz'

describe('class-review internal service authorization', () => {
  it('authorizes only the exact canonical Bearer bytes without request-side trimming', () => {
    cryptoSpies.timingSafeEqual.mockClear()
    expect(authorizeClassReviewServiceRequest({
      originPresent: false,
      authorizationHeader: `Bearer ${serviceToken}`,
      expectedToken: serviceToken,
    })).toBe('authorized')

    const rejectedHeaders = [
      undefined,
      '',
      'Bearer',
      'bearer token',
      'Basic token',
      `Bearer  ${serviceToken}`,
      `Bearer ${serviceToken} `,
      `Bearer\t${serviceToken}`,
      `Bearer ${'a'.repeat(257)}`,
      `Bearer ${'界'.repeat(32)}`,
      `Bearer ${serviceToken}=`,
      `Bearer ${serviceToken}, Bearer ${serviceToken}`,
      `Bearer ${'x'.repeat(serviceToken.length)}`,
    ]
    for (const authorizationHeader of rejectedHeaders) {
      expect(authorizeClassReviewServiceRequest({
        originPresent: false,
        authorizationHeader,
        expectedToken: serviceToken,
      })).toBe('unauthorized')
    }
    expect(cryptoSpies.timingSafeEqual).toHaveBeenCalledTimes(rejectedHeaders.length + 1)
    for (const [left, right] of cryptoSpies.timingSafeEqual.mock.calls) {
      expect(left).toHaveLength(32)
      expect(right).toHaveLength(32)
    }
  })

  it('checks Origin presence first, including an explicitly empty Origin value', () => {
    cryptoSpies.timingSafeEqual.mockClear()
    for (const authorizationHeader of [undefined, `Bearer ${serviceToken}`]) {
      expect(authorizeClassReviewServiceRequest({
        originPresent: true,
        authorizationHeader,
        expectedToken: serviceToken,
      })).toBe('forbidden_origin')
    }
    expect(cryptoSpies.timingSafeEqual).not.toHaveBeenCalled()
  })

  it('returns only a fixed decision and never returns token or header bytes', () => {
    const privateMarker = 'PRIVATE-SERVICE-TOKEN-MARKER'
    const decision = authorizeClassReviewServiceRequest({
      originPresent: false,
      authorizationHeader: `Bearer ${privateMarker}`,
      expectedToken: serviceToken,
    })
    expect(decision).toBe('unauthorized')
    expect(JSON.stringify(decision)).not.toContain(privateMarker)
    expect(JSON.stringify(decision)).not.toContain(serviceToken)
  })

  it('never authorizes sentinel collisions while still performing one fixed digest comparison', () => {
    cryptoSpies.timingSafeEqual.mockClear()
    expect(authorizeClassReviewServiceRequest({
      originPresent: false,
      authorizationHeader: 'Bearer class-review-invalid-expected-token-v1',
      expectedToken: 'invalid expected token',
    })).toBe('unauthorized')
    expect(authorizeClassReviewServiceRequest({
      originPresent: false,
      authorizationHeader: undefined,
      expectedToken: 'class-review-malformed-bearer-v1',
    })).toBe('unauthorized')
    expect(cryptoSpies.timingSafeEqual).toHaveBeenCalledTimes(2)
    for (const [left, right] of cryptoSpies.timingSafeEqual.mock.calls) {
      expect(left).toHaveLength(32)
      expect(right).toHaveLength(32)
    }
  })
})
