import { describe, expect, it } from 'vitest'
import { parseClassReviewRuntimeConfig } from './classReviewRuntimeConfig'

describe('class review runtime mode', () => {
  it('allows local prototype only with an explicit development/test capability', () => {
    expect(parseClassReviewRuntimeConfig({ VITE_CLASS_REVIEW_MODE: 'local-prototype' }, { allowLocalPrototype: true })).toEqual({ mode: 'local-prototype', available: true })
    expect(() => parseClassReviewRuntimeConfig({ VITE_CLASS_REVIEW_MODE: 'local-prototype' }, { allowLocalPrototype: false })).toThrow('local_prototype_not_allowed')
  })

  it('keeps platform as an explicit unavailable seam', () => {
    expect(parseClassReviewRuntimeConfig({ VITE_CLASS_REVIEW_MODE: 'platform' }, { allowLocalPrototype: false })).toEqual({ mode: 'platform', available: false, reason: 'platform_unavailable' })
  })

  it.each([undefined, '', 'fake', 'real', 'LOCAL-PROTOTYPE'])('fails closed for missing or unknown mode %s', (mode) => {
    expect(() => parseClassReviewRuntimeConfig({ VITE_CLASS_REVIEW_MODE: mode }, { allowLocalPrototype: true })).toThrow('class_review_mode_invalid')
  })
})
