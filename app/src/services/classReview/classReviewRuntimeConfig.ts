export type ClassReviewRuntimeConfig = { mode: 'local-prototype'; available: true } | { mode: 'platform'; available: false; reason: 'platform_unavailable' }
export function parseClassReviewRuntimeConfig(environment: { VITE_CLASS_REVIEW_MODE?: string }, capability: { allowLocalPrototype: boolean }): ClassReviewRuntimeConfig {
  if (environment.VITE_CLASS_REVIEW_MODE === 'platform') return { mode: 'platform', available: false, reason: 'platform_unavailable' }
  if (environment.VITE_CLASS_REVIEW_MODE !== 'local-prototype') throw new Error('class_review_mode_invalid')
  if (!capability || capability.allowLocalPrototype !== true) throw new Error('local_prototype_not_allowed')
  return { mode: 'local-prototype', available: true }
}
