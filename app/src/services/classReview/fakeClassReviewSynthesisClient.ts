import type { ClassReviewSynthesisRequestV1, ClassReviewSynthesisResultV1, SafeFailureCode } from './types'

export interface ClassReviewSynthesisClient {
  synthesize(request: ClassReviewSynthesisRequestV1): Promise<ClassReviewSynthesisResultV1>
}

export type FakeClassReviewScenario = 'success' | 'empty' | 'rate_limited_before_completion' | 'auth_failed' | 'result_unknown' | 'invalid_schema' | 'regeneration_failed'
export type FakeClassReviewVariant = 'default' | 'multi_group' | 'sub_threshold' | 'omitted_must_cover' | 'duplicate_group_ownership'

export function createFakeClassReviewSynthesisClient(options: { scenario: FakeClassReviewScenario; variant?: FakeClassReviewVariant }) {
  let callCount = 0
  const variant = options.variant ?? 'default'
  const timingsMs = { queueMs: 0, providerMs: 1, validationMs: 0, totalMs: 1 }
  function failure(request: ClassReviewSynthesisRequestV1, code: SafeFailureCode, disposition: 'not_started' | 'confirmed_zero_completion' | 'completed', retryable = false, retryAfterMs: number | null = null): ClassReviewSynthesisResultV1 {
    return { contractVersion: 'class-review-synthesis-result-v1', requestId: request.requestId, status: 'failed', safeFailureCode: code, retryable, retryAfterMs, completionDisposition: disposition, finishReason: null, usage: null, timingsMs }
  }
  return {
    getCallCountForTest: () => callCount,
    async synthesize(request: ClassReviewSynthesisRequestV1): Promise<ClassReviewSynthesisResultV1> {
      callCount += 1
      if (options.scenario === 'rate_limited_before_completion') return failure(request, 'provider_rate_limited', 'confirmed_zero_completion', true, 1)
      if (options.scenario === 'auth_failed' || (options.scenario === 'regeneration_failed' && callCount > 1)) return failure(request, 'provider_auth_failed', 'not_started')
      if (options.scenario === 'result_unknown') return { contractVersion: 'class-review-synthesis-result-v1', requestId: request.requestId, status: 'result_unknown', safeFailureCode: 'provider_result_unknown', completionDisposition: 'unknown', timingsMs }
      if (options.scenario === 'invalid_schema' || variant === 'duplicate_group_ownership') return failure(request, 'provider_invalid_response', 'completed')
      const patterns = options.scenario === 'empty' || request.groups.length === 0 || variant === 'omitted_must_cover' ? [] : [{ groupIds: variant === 'multi_group' ? request.groups.slice(0, 2).map((group) => group.groupId) : [request.groups[0].groupId], title: 'Common issue', diagnosis: 'Needs attention', teachingAction: 'Use focused revision', severity: 'medium' as const }]
      return { contractVersion: 'class-review-synthesis-result-v1', requestId: request.requestId, status: 'succeeded', output: { overallComment: 'Class summary', strengths: [{ title: 'Strength', detail: 'Students completed the task.', dimensionIds: [] }], patterns, learningRecommendations: [{ title: 'Next step', action: 'Revise with examples.' }] }, semanticCoverage: request.semanticCoverage, finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20, cachedTokens: 0 }, timingsMs }
    },
  }
}
