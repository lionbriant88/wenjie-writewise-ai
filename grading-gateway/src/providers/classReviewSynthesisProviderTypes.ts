import type {
  ClassReviewProviderOutputV1,
  ClassReviewSynthesisRequestV1,
} from '../classReviewSynthesis/types.js'
import type { ProviderCallResult } from './providerTypes.js'

export interface ClassReviewSynthesisProviderInput {
  request: ClassReviewSynthesisRequestV1
  signal: AbortSignal
}

export interface ClassReviewSynthesisProvider {
  synthesize(
    input: ClassReviewSynthesisProviderInput,
  ): Promise<ProviderCallResult<ClassReviewProviderOutputV1>>
}
