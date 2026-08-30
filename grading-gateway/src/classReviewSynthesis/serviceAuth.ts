import { createHash, timingSafeEqual } from 'node:crypto'

export type ClassReviewServiceAuthDecision =
  | 'authorized'
  | 'forbidden_origin'
  | 'unauthorized'

export interface ClassReviewServiceAuthInput {
  originPresent: boolean
  authorizationHeader: string | undefined
  expectedToken: string
}

const TOKEN = /^[A-Za-z0-9._~-]{32,256}$/
const MALFORMED_CANDIDATE_SENTINEL = 'class-review-malformed-bearer-v1'
const INVALID_EXPECTED_SENTINEL = 'class-review-invalid-expected-token-v1'

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

function bearerCandidate(header: string | undefined): { value: string; valid: boolean } {
  if (typeof header !== 'string' || header.length < 39 || header.length > 263
    || !header.startsWith('Bearer ')) return { value: MALFORMED_CANDIDATE_SENTINEL, valid: false }
  const candidate = header.slice(7)
  return TOKEN.test(candidate)
    ? { value: candidate, valid: true }
    : { value: MALFORMED_CANDIDATE_SENTINEL, valid: false }
}

export function authorizeClassReviewServiceRequest(
  input: ClassReviewServiceAuthInput,
): ClassReviewServiceAuthDecision {
  if (input.originPresent) return 'forbidden_origin'
  const expectedValid = TOKEN.test(input.expectedToken)
  const expected = expectedValid ? input.expectedToken : INVALID_EXPECTED_SENTINEL
  const candidate = bearerCandidate(input.authorizationHeader)
  const equal = timingSafeEqual(
    digest(expected),
    digest(candidate.value),
  )
  return expectedValid && candidate.valid && equal ? 'authorized' : 'unauthorized'
}
