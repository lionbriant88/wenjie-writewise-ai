import { describe, expect, it } from 'vitest'
import {
  CLASS_REVIEW_WIRE_SERIALIZATION_VERSION,
  CONTROLLABLE_PROMPT_TOKENS_V1,
  FINAL_PROVIDER_TEXT_UTF8_BYTES_V1,
  FIXED_PREFIX_UTF8_BYTES_V1,
  FRAMING_RESERVE_TOKENS_V1,
  MAX_COMPLETION_TOKENS_V1,
  TOTAL_PROMPT_TOKENS_V1,
} from './limits.js'

describe('class-review v1 limits', () => {
  it('freezes the approved independent byte, token, completion and wire limits', () => {
    expect(CLASS_REVIEW_WIRE_SERIALIZATION_VERSION).toBe('class-review-wire-serialization-v1')
    expect(FIXED_PREFIX_UTF8_BYTES_V1).toBe(16_384)
    expect(FINAL_PROVIDER_TEXT_UTF8_BYTES_V1).toBe(49_152)
    expect(CONTROLLABLE_PROMPT_TOKENS_V1).toBe(15_872)
    expect(FRAMING_RESERVE_TOKENS_V1).toBe(512)
    expect(TOTAL_PROMPT_TOKENS_V1).toBe(16_384)
    expect(MAX_COMPLETION_TOKENS_V1).toBe(3_072)
  })
})
