import { randomUUID } from 'node:crypto'
import type { ClassReviewFramingCalibration } from '../classReviewSynthesis/framingCalibrations.js'
import { MAX_COMPLETION_TOKENS_V1 } from '../classReviewSynthesis/limits.js'
import {
  prepareClassReviewSynthesisRequest,
  type ClassReviewPromptTokenizer,
  type ClassReviewPreparationErrorCode,
} from '../classReviewSynthesis/promptBudget.js'
import { deriveClassReviewPromptCacheKey } from '../classReviewSynthesis/promptCacheKey.js'
import {
  classReviewProviderOutputSchema,
  validateClassReviewProviderOutput,
} from '../classReviewSynthesis/providerContract.js'
import type {
  ClassReviewSynthesisProvider,
  ClassReviewSynthesisProviderInput,
} from './classReviewSynthesisProviderTypes.js'
import type { KimiTransport } from './kimiTransport.js'
import {
  ClassReviewProviderError,
  GradingProviderError,
  type ProviderAttemptObservation,
  type ProviderDiagnosticCode,
  type ProviderErrorDetails,
} from './providerTypes.js'

export interface KimiClassReviewProviderOptions {
  transport: KimiTransport
  hmacSecret: string
  calibration: ClassReviewFramingCalibration | null
  tokenizer?: ClassReviewPromptTokenizer
}

function dedupeObservations(
  observations: readonly ProviderAttemptObservation[],
): ProviderAttemptObservation[] {
  const seen = new Set<string>()
  return observations.filter((observation) => {
    if (seen.has(observation.attemptDiagnosticId)) return false
    seen.add(observation.attemptDiagnosticId)
    return true
  })
}

function preparationError(code: ClassReviewPreparationErrorCode): ClassReviewProviderError {
  return new ClassReviewProviderError(
    code,
    'Class review prompt configuration or size is invalid.',
    false,
    undefined,
    { termination: 'confirmed' },
  )
}

function localInvalidResponse(
  observations: readonly ProviderAttemptObservation[],
): GradingProviderError {
  return new GradingProviderError(
    'provider_invalid_response',
    'Class review Provider response is invalid.',
    false,
    'completion_content',
    {
      termination: 'confirmed', diagnosticCode: 'completion_content',
      attemptObservations: dedupeObservations(observations),
    },
  )
}

function rethrowTransportError(error: unknown): never {
  if (!(error instanceof GradingProviderError)) throw error
  const details: ProviderErrorDetails = error.details ?? { termination: 'unknown' }
  const attemptObservations = dedupeObservations(details.attemptObservations ?? [])
  const normalizedDetails: ProviderErrorDetails = {
    ...details,
    ...(attemptObservations.length > 0 ? { attemptObservations } : {}),
  }
  const completedInvalid = details.termination === 'confirmed'
    && (
      error.code === 'provider_invalid_response'
      || error.code === 'provider_content_filtered'
      || error.code === 'provider_unexpected_tool_call'
    )
  const code = completedInvalid ? 'provider_invalid_response' : error.code
  const diagnosticCode: ProviderDiagnosticCode | undefined = error.diagnosticCode
  throw new GradingProviderError(
    code,
    error.message,
    completedInvalid ? false : error.retryable,
    diagnosticCode,
    normalizedDetails,
  )
}

export class KimiClassReviewProvider implements ClassReviewSynthesisProvider {
  constructor(private readonly options: KimiClassReviewProviderOptions) {}

  async synthesize(input: ClassReviewSynthesisProviderInput) {
    const promptCacheKey = deriveClassReviewPromptCacheKey({
      hmacSecret: this.options.hmacSecret,
      rubricRevisionDigest: input.request.rubricRevisionDigest,
      policyVersion: input.request.policyVersion,
      schemaVersion: input.request.schemaVersion,
      projectionVersion: input.request.projectionVersion,
    })
    const prepared = prepareClassReviewSynthesisRequest({
      request: input.request,
      tokenizer: this.options.tokenizer,
      calibration: this.options.calibration,
    })
    if (!prepared.ok) throw preparationError(prepared.code)

    let response
    try {
      response = await this.options.transport.complete({
        messages: prepared.messages,
        schemaName: 'kimi-class-review-output-v1',
        schema: classReviewProviderOutputSchema,
        signal: input.signal,
        stage: 'class_review_generation',
        maxCompletionTokens: MAX_COMPLETION_TOKENS_V1,
        promptCacheKey,
        attempt: 1,
        diagnosticContext: randomUUID(),
      })
    } catch (error) {
      rethrowTransportError(error)
    }

    const validation = validateClassReviewProviderOutput(response.value, prepared.request)
    if (!validation.ok) throw localInvalidResponse([response.observation])
    return { value: validation.value, attempts: [response.observation] }
  }
}
