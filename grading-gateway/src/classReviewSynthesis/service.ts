import { randomUUID } from 'node:crypto'
import type {
  ClassReviewSynthesisResultV1,
  ProviderUsageV1,
  SafeFailureCode,
  SemanticCoverageV1,
  SynthesisTimingsV1,
} from '../../../app/src/services/classReview/types.js'
import type { GatewayRuntimeConfig } from '../gatewayRuntimeConfig.js'
import { OneShotProviderExecutionTracker, type OneShotExecutionOutcome } from '../oneShotProviderExecution.js'
import { ProviderAdmissionController, type AdmissionDecision, type AdmissionPauseReason } from '../providerAdmissionController.js'
import {
  createProviderTelemetryRecorder,
  recordClassReviewGeneration,
  recordUniqueProviderAttempts,
  type ClassReviewGenerationState,
  type ClassReviewSafeFailureCode,
  type ProviderTelemetryRecorder,
} from '../providerTelemetry.js'
import type { ClassReviewSynthesisProvider } from '../providers/classReviewSynthesisProviderTypes.js'
import { getClassReviewSynthesisProvider } from '../providers/index.js'
import { KimiClassReviewProvider } from '../providers/kimiClassReviewProvider.js'
import { createKimiTransport, type KimiTransport, type KimiTransportOptions } from '../providers/kimiTransport.js'
import {
  ClassReviewProviderError,
  GradingProviderError,
  type ClassReviewProviderErrorCode,
  type ProviderAttemptObservation,
  type ProviderUsageSnapshot,
} from '../providers/providerTypes.js'
import type { ClassReviewFramingCalibration } from './framingCalibrations.js'
import { deriveClassReviewPromptCacheKey } from './promptCacheKey.js'
import {
  prepareClassReviewSynthesisRequest,
  type ClassReviewPromptTokenizer,
  type ClassReviewPreparationErrorCode,
} from './promptBudget.js'
import { validateClassReviewProviderOutput } from './providerContract.js'
import {
  ClassReviewPromptContractDriftError,
  ClassReviewRuntimeInvariant,
  type ClassReviewTrustedMode,
} from './runtimeInvariant.js'
import type { ClassReviewProviderOutputV1, ClassReviewSynthesisRequestV1 } from './types.js'
import { validateClassReviewSynthesisRequest } from './validateRequest.js'

type GatewayResponse = {
  httpStatus: number
  result: ClassReviewSynthesisResultV1
}

interface CompletedValue {
  output: ClassReviewProviderOutputV1
  usage: ProviderUsageV1
  attempts: ProviderAttemptObservation[]
  invariant: boolean | undefined
}

interface ClassReviewSynthesisServiceOptions {
  mode: ClassReviewTrustedMode
  provider: ClassReviewSynthesisProvider
  admission: ProviderAdmissionController
  oneShot: OneShotProviderExecutionTracker
  calibration: ClassReviewFramingCalibration | null
  tokenizer?: ClassReviewPromptTokenizer
  hmacSecret?: string
  runtimeInvariant: ClassReviewRuntimeInvariant
  providerTelemetry?: ProviderTelemetryRecorder
  monotonicNow?: () => number
  diagnosticIdFactory?: () => string
}

export interface CreateClassReviewSynthesisProviderDependencies {
  fakeFactory?: () => ClassReviewSynthesisProvider
  kimiTransportFactory?: (options: KimiTransportOptions) => KimiTransport
  tokenizer?: ClassReviewPromptTokenizer
}

class AdmittedClassReviewConfigurationError extends GradingProviderError {
  constructor(readonly classReviewCode: ClassReviewProviderErrorCode) {
    super(
      'provider_invalid_response',
      'Class review Provider configuration failed after admission.',
      false,
      undefined,
      { termination: 'confirmed' },
    )
    this.name = 'AdmittedClassReviewConfigurationError'
  }
}

function fixedInvalidResponse(
  attempts: readonly ProviderAttemptObservation[],
): GradingProviderError {
  return new GradingProviderError(
    'provider_invalid_response',
    'Class review Provider response is invalid.',
    false,
    undefined,
    {
      termination: 'confirmed',
      ...(attempts.length > 0 ? { attemptObservations: dedupeAttempts(attempts) } : {}),
    },
  )
}

function dedupeAttempts(
  attempts: readonly ProviderAttemptObservation[],
): ProviderAttemptObservation[] {
  const seen = new Set<string>()
  const result: ProviderAttemptObservation[] = []
  for (const attempt of attempts) {
    if (seen.has(attempt.attemptDiagnosticId)) continue
    seen.add(attempt.attemptDiagnosticId)
    result.push(attempt)
  }
  return result
}

function attemptsFrom(error: unknown): ProviderAttemptObservation[] {
  return error instanceof GradingProviderError
    ? dedupeAttempts(error.details?.attemptObservations ?? [])
    : []
}

function knownInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function knownUsage(usage: ProviderUsageSnapshot | undefined): ProviderUsageV1 | null {
  if (!usage) return null
  const prompt = usage.promptTokens
  const completion = usage.completionTokens
  const total = usage.totalTokens
  const cached = usage.cachedTokens
  if (prompt.status !== 'known' || !knownInteger(prompt.value)
    || completion.status !== 'known' || !knownInteger(completion.value)
    || total.status !== 'known' || !knownInteger(total.value)
    || prompt.value + completion.value !== total.value) return null
  if (cached.status === 'known' && (!knownInteger(cached.value) || cached.value > prompt.value)) {
    return null
  }
  return {
    promptTokens: prompt.value,
    completionTokens: completion.value,
    totalTokens: total.value,
    cachedTokens: cached.status === 'known' ? cached.value : null,
  }
}

function safeDuration(value: number): number {
  return Number.isFinite(value) && value >= 0
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value))
    : 0
}

function timings(
  queueMs: number,
  providerMs: number,
  validationMs: number,
  totalElapsedMs: number,
): SynthesisTimingsV1 {
  const normalized = {
    queueMs: safeDuration(queueMs),
    providerMs: safeDuration(providerMs),
    validationMs: safeDuration(validationMs),
    totalMs: safeDuration(totalElapsedMs),
  }
  normalized.totalMs = Math.max(
    normalized.totalMs,
    normalized.queueMs,
    normalized.providerMs,
    normalized.validationMs,
  )
  return normalized
}

function failureResult(input: {
  requestId: string
  safeFailureCode: SafeFailureCode
  retryable: boolean
  retryAfterMs?: number | null
  completionDisposition: 'not_started' | 'confirmed_zero_completion' | 'completed'
  finishReason?: ProviderAttemptObservation['finishReason'] | null
  usage?: ProviderUsageV1 | null
  timingsMs: SynthesisTimingsV1
}): ClassReviewSynthesisResultV1 {
  return {
    contractVersion: 'class-review-synthesis-result-v1',
    requestId: input.requestId,
    status: 'failed',
    safeFailureCode: input.safeFailureCode,
    retryable: input.retryable,
    retryAfterMs: input.retryAfterMs ?? null,
    completionDisposition: input.completionDisposition,
    finishReason: input.finishReason ?? null,
    usage: input.usage ?? null,
    timingsMs: input.timingsMs,
  }
}

function pauseMapping(reason: AdmissionPauseReason): {
  code: SafeFailureCode
  retryable: boolean
} {
  if (reason === 'provider_auth_failed') return { code: reason, retryable: false }
  if (reason === 'provider_balance_unavailable') return { code: reason, retryable: false }
  if (reason === 'provider_not_configured') return { code: reason, retryable: false }
  if (reason === 'provider_access_denied') {
    return { code: 'provider_request_rejected', retryable: false }
  }
  return { code: 'provider_rate_limited', retryable: false }
}

function admissionFailure(
  requestId: string,
  decision: Extract<AdmissionDecision, { accepted: false }>,
  admission: ProviderAdmissionController,
  timingsMs: SynthesisTimingsV1,
): GatewayResponse {
  if (decision.reason === 'target_busy' || decision.reason === 'hard_limit') {
    const retryAfterMs = knownInteger(decision.retryAfterMs) ? decision.retryAfterMs : null
    return {
      httpStatus: 429,
      result: failureResult({
        requestId,
        safeFailureCode: 'provider_rate_limited',
        retryable: true,
        retryAfterMs,
        completionDisposition: 'not_started',
        timingsMs,
      }),
    }
  }
  const snapshot = admission.snapshot()
  if (snapshot.pauseReason === null && knownInteger(decision.retryAfterMs)) {
    return {
      httpStatus: 429,
      result: failureResult({
        requestId,
        safeFailureCode: 'provider_rate_limited',
        retryable: true,
        retryAfterMs: decision.retryAfterMs,
        completionDisposition: 'not_started',
        timingsMs,
      }),
    }
  }
  const mapped = pauseMapping(snapshot.pauseReason ?? 'long_retry_after')
  return {
    httpStatus: 503,
    result: failureResult({
      requestId,
      safeFailureCode: mapped.code,
      retryable: mapped.retryable,
      completionDisposition: 'not_started',
      timingsMs,
    }),
  }
}

function completedFailureFacts(error: GradingProviderError): {
  disposition: 'confirmed_zero_completion' | 'completed'
  finishReason: ProviderAttemptObservation['finishReason'] | null
  usage: ProviderUsageV1 | null
} {
  const attempts = attemptsFrom(error)
  const observation = attempts.length === 1 ? attempts[0] : undefined
  const definitelyCompleted = error.code === 'provider_invalid_response'
    || error.code === 'provider_content_filtered'
    || error.code === 'provider_unexpected_tool_call'
    || error.details?.finishReason !== undefined
    || (observation !== undefined && observation.finishReason !== 'unknown')
  if (!definitelyCompleted) {
    return { disposition: 'confirmed_zero_completion', finishReason: null, usage: null }
  }
  return {
    disposition: 'completed',
    finishReason: error.details?.finishReason ?? observation?.finishReason ?? null,
    usage: knownUsage(observation?.usage ?? error.details?.usage),
  }
}

function preparationFailureCode(code: ClassReviewPreparationErrorCode): SafeFailureCode {
  return code
}

function safeProviderFailureCode(code: GradingProviderError['code']): SafeFailureCode {
  return code === 'unsupported_genre' ? 'provider_request_rejected' : code
}

function providerFailureRetryable(error: GradingProviderError): boolean {
  return error.code !== 'unsupported_genre'
    && error.code !== 'provider_not_configured'
    && error.code !== 'provider_request_rejected'
    && error.code !== 'provider_auth_failed'
    && error.code !== 'provider_balance_unavailable'
    && error.retryable
}

export class ClassReviewSynthesisService {
  readonly #mode: ClassReviewTrustedMode
  readonly #provider: ClassReviewSynthesisProvider
  readonly #admission: ProviderAdmissionController
  readonly #oneShot: OneShotProviderExecutionTracker
  readonly #calibration: ClassReviewFramingCalibration | null
  readonly #tokenizer?: ClassReviewPromptTokenizer
  readonly #hmacSecret?: string
  readonly #runtimeInvariant: ClassReviewRuntimeInvariant
  readonly #telemetry: ProviderTelemetryRecorder
  readonly #now: () => number
  readonly #diagnosticIdFactory: () => string

  constructor(options: ClassReviewSynthesisServiceOptions) {
    if ((options.mode !== 'fake' && options.mode !== 'kimi')
      || !options.provider || typeof options.provider.synthesize !== 'function'
      || !(options.admission instanceof ProviderAdmissionController)
      || !(options.oneShot instanceof OneShotProviderExecutionTracker)
      || !(options.runtimeInvariant instanceof ClassReviewRuntimeInvariant)) {
      throw new TypeError('Invalid class review synthesis service configuration.')
    }
    this.#mode = options.mode
    this.#provider = options.provider
    this.#admission = options.admission
    this.#oneShot = options.oneShot
    this.#calibration = options.calibration
    this.#tokenizer = options.tokenizer
    this.#hmacSecret = options.hmacSecret
    this.#runtimeInvariant = options.runtimeInvariant
    this.#telemetry = options.providerTelemetry ?? createProviderTelemetryRecorder()
    this.#now = options.monotonicNow ?? performance.now.bind(performance)
    this.#diagnosticIdFactory = options.diagnosticIdFactory ?? randomUUID
  }

  async synthesize(input: {
    request: ClassReviewSynthesisRequestV1
    receivedAt: number
    httpDeadlineMs: number
  }): Promise<GatewayResponse> {
    const invokedAt = this.#now()
    if (!Number.isFinite(input.receivedAt) || input.receivedAt < 0
      || input.receivedAt > invokedAt
      || !Number.isFinite(input.httpDeadlineMs) || input.httpDeadlineMs < 1) {
      throw new TypeError('Invalid class review synthesis request timing.')
    }
    const strictValidationStartedAt = invokedAt
    const validated = validateClassReviewSynthesisRequest(input.request)
    if (!validated.ok) throw new TypeError('Invalid class review synthesis request.')
    const request = validated.value
    const startedAt = input.receivedAt
    let coverage: SemanticCoverageV1 = request.semanticCoverage
    let queueMs = 0
    let providerMs = 0
    let validationMs = safeDuration(this.#now() - strictValidationStartedAt)
    let observedAttempts: ProviderAttemptObservation[] = []
    let promptTokenInvariant: boolean | undefined
    let telemetryRecorded = false

    const elapsed = () => safeDuration(this.#now() - startedAt)
    const makeTimings = () => timings(queueMs, providerMs, validationMs, elapsed())
    const recordAttempts = (
      outcome: 'success' | 'failed' | 'result_unknown',
      attempts: readonly ProviderAttemptObservation[],
    ) => {
      const deduped = dedupeAttempts(attempts)
      observedAttempts = deduped
      if (deduped.length > 0) {
        providerMs = safeDuration(deduped.reduce(
          (sum, attempt) => sum + safeDuration(attempt.providerElapsedMs),
          0,
        ))
        recordUniqueProviderAttempts(this.#telemetry, {
          stage: 'class_review_generation',
          model: this.#mode === 'kimi' ? 'kimi-k3' : 'fake',
          reasoningEffort: 'low',
          outcome,
        }, deduped)
      }
    }
    const recordOperation = (response: GatewayResponse) => {
      if (telemetryRecorded) return
      telemetryRecorded = true
      const result = response.result
      const state: ClassReviewGenerationState = result.status === 'succeeded'
        ? 'completed'
        : result.status === 'result_unknown'
          ? 'unknown'
          : result.completionDisposition
      const outcome = result.status === 'succeeded'
        ? 'success'
        : result.status === 'result_unknown'
          ? 'result_unknown'
          : 'failed'
      const operationTimings = result.timingsMs
      recordClassReviewGeneration(this.#telemetry, {
        stage: 'class_review_generation',
        model: this.#mode === 'kimi' ? 'kimi-k3' : 'fake',
        reasoningEffort: 'low',
        operationDiagnosticId: this.#diagnosticIdFactory(),
        state,
        outcome,
        ...(result.status === 'failed' || result.status === 'result_unknown'
          ? { safeFailureCode: result.safeFailureCode as ClassReviewSafeFailureCode }
          : {}),
        attemptCount: observedAttempts.length,
        includedEssayCount: request.statistics.includedEssayCount,
        excludedEssayCount: request.statistics.excludedEssayCount,
        projectedGroupCount: coverage.projectedGroupCount,
        eligibleGroupCount: coverage.eligibleGroupCount,
        projectedDistinctEssaySupportSum: coverage.projectedDistinctEssaySupportSum,
        eligibleDistinctEssaySupportSum: coverage.eligibleDistinctEssaySupportSum,
        projectedOccurrenceSum: coverage.projectedOccurrenceSum,
        eligibleOccurrenceSum: coverage.eligibleOccurrenceSum,
        queueMs: operationTimings.queueMs,
        providerMs: operationTimings.providerMs,
        validationMs: operationTimings.validationMs,
        totalMs: operationTimings.totalMs,
        ...(this.#mode === 'kimi' && observedAttempts.length > 0
          && typeof promptTokenInvariant === 'boolean'
          ? { promptTokenInvariant }
          : {}),
      })
    }
    const finish = (response: GatewayResponse): GatewayResponse => {
      recordOperation(response)
      return response
    }
    const localFailure = (
      code: SafeFailureCode,
      retryable = false,
    ): GatewayResponse => finish({
      httpStatus: 503,
      result: failureResult({
        requestId: request.requestId,
        safeFailureCode: code,
        retryable,
        completionDisposition: 'not_started',
        timingsMs: makeTimings(),
      }),
    })

    const preflightValidationStartedAt = this.#now()
    try {
      this.#runtimeInvariant.assertCanDispatch(this.#mode)
    } catch (error) {
      if (error instanceof ClassReviewPromptContractDriftError) {
        validationMs += safeDuration(this.#now() - preflightValidationStartedAt)
        return localFailure('class_review_prompt_contract_drift')
      }
      throw error
    }

    if (this.#mode === 'kimi') {
      try {
        deriveClassReviewPromptCacheKey({
          hmacSecret: this.#hmacSecret ?? '',
          rubricRevisionDigest: request.rubricRevisionDigest,
          policyVersion: request.policyVersion,
          schemaVersion: request.schemaVersion,
          projectionVersion: request.projectionVersion,
        })
      } catch (error) {
        if (error instanceof GradingProviderError) {
          validationMs += safeDuration(this.#now() - preflightValidationStartedAt)
          return localFailure('provider_not_configured')
        }
        throw error
      }
    }

    const prepared = prepareClassReviewSynthesisRequest({
      request,
      ...(this.#tokenizer ? { tokenizer: this.#tokenizer } : {}),
      calibration: this.#calibration,
    })
    validationMs += safeDuration(this.#now() - preflightValidationStartedAt)
    if (!prepared.ok) return localFailure(preparationFailureCode(prepared.code))
    coverage = prepared.request.semanticCoverage
    const admissionReadyAt = this.#now()

    const outcome: OneShotExecutionOutcome<CompletedValue> = await this.#oneShot.run({
      receivedAt: input.receivedAt,
      httpDeadlineMs: input.httpDeadlineMs,
      execute: async ({ signal }) => {
        queueMs = safeDuration(this.#now() - admissionReadyAt)
        let providerResult
        try {
          providerResult = await this.#provider.synthesize({ request: prepared.request, signal })
        } catch (error) {
          const errorValidationStartedAt = this.#now()
          if (error instanceof ClassReviewProviderError) {
            validationMs += safeDuration(this.#now() - errorValidationStartedAt)
            throw new AdmittedClassReviewConfigurationError(error.code)
          }
          if (error instanceof GradingProviderError) {
            const attempts = attemptsFrom(error)
            try {
              promptTokenInvariant = this.#runtimeInvariant.inspectAttempts(this.#mode, attempts)
            } catch (drift) {
              if (drift instanceof ClassReviewPromptContractDriftError) {
                recordAttempts('failed', attemptsFrom(drift))
              }
              validationMs += safeDuration(this.#now() - errorValidationStartedAt)
              throw drift
            }
            recordAttempts(
              error.details?.termination === 'unknown' ? 'result_unknown' : 'failed',
              attempts,
            )
          }
          validationMs += safeDuration(this.#now() - errorValidationStartedAt)
          throw error
        }

        const attempts = Array.isArray(providerResult?.attempts)
          ? providerResult.attempts
          : []
        const validationStartedAt = this.#now()
        try {
          promptTokenInvariant = this.#runtimeInvariant.inspectAttempts(this.#mode, attempts)
        } catch (drift) {
          if (drift instanceof ClassReviewPromptContractDriftError) {
            recordAttempts('failed', attemptsFrom(drift))
          }
          validationMs += safeDuration(this.#now() - validationStartedAt)
          throw drift
        }

        if (attempts.length !== 1 || attempts[0].finishReason !== 'stop') {
          recordAttempts('failed', attempts)
          validationMs += safeDuration(this.#now() - validationStartedAt)
          throw fixedInvalidResponse(attempts)
        }
        const usage = knownUsage(attempts[0].usage)
        if (usage === null) {
          recordAttempts('failed', attempts)
          validationMs += safeDuration(this.#now() - validationStartedAt)
          throw fixedInvalidResponse(attempts)
        }
        const parsedOutput = validateClassReviewProviderOutput(
          providerResult.value,
          prepared.request,
        )
        validationMs += safeDuration(this.#now() - validationStartedAt)
        if (!parsedOutput.ok) {
          recordAttempts('failed', attempts)
          throw fixedInvalidResponse(attempts)
        }
        recordAttempts('success', attempts)
        return {
          output: parsedOutput.value,
          usage,
          attempts: dedupeAttempts(attempts),
          invariant: promptTokenInvariant,
        }
      },
    })

    if (outcome.kind === 'success') {
      promptTokenInvariant = outcome.value.invariant
      const response: GatewayResponse = {
        httpStatus: 200,
        result: {
          contractVersion: 'class-review-synthesis-result-v1',
          requestId: request.requestId,
          status: 'succeeded',
          output: outcome.value.output,
          semanticCoverage: prepared.request.semanticCoverage,
          finishReason: 'stop',
          usage: outcome.value.usage,
          timingsMs: makeTimings(),
        },
      }
      return finish(response)
    }
    if (outcome.kind === 'caller_timeout_before_dispatch') {
      return localFailure('provider_timeout', true)
    }
    if (outcome.kind === 'admission_rejected') {
      return finish(admissionFailure(
        request.requestId,
        outcome.decision,
        this.#admission,
        makeTimings(),
      ))
    }
    if (outcome.kind === 'result_unknown') {
      return finish({
        httpStatus: 503,
        result: {
          contractVersion: 'class-review-synthesis-result-v1',
          requestId: request.requestId,
          status: 'result_unknown',
          safeFailureCode: 'provider_result_unknown',
          completionDisposition: 'unknown',
          timingsMs: makeTimings(),
        },
      })
    }

    const error = outcome.error
    if (error instanceof AdmittedClassReviewConfigurationError) {
      return localFailure(error.classReviewCode)
    }
    if (error instanceof ClassReviewPromptContractDriftError) {
      const attempts = attemptsFrom(error)
      recordAttempts('failed', attempts)
      const observation = attempts.length === 1 ? attempts[0] : undefined
      return finish({
        httpStatus: 503,
        result: failureResult({
          requestId: request.requestId,
          safeFailureCode: 'class_review_prompt_contract_drift',
          retryable: false,
          completionDisposition: attempts.length > 0 ? 'completed' : 'not_started',
          finishReason: observation?.finishReason ?? null,
          usage: knownUsage(observation?.usage),
          timingsMs: makeTimings(),
        }),
      })
    }
    if (!(error instanceof GradingProviderError)) {
      return finish({
        httpStatus: 503,
        result: {
          contractVersion: 'class-review-synthesis-result-v1',
          requestId: request.requestId,
          status: 'result_unknown',
          safeFailureCode: 'provider_result_unknown',
          completionDisposition: 'unknown',
          timingsMs: makeTimings(),
        },
      })
    }

    const attempts = attemptsFrom(error)
    recordAttempts('failed', attempts)
    if (error.code === 'provider_rate_limited') {
      const retryAfterMs = knownInteger(error.details?.retryAfterMs)
        ? error.details.retryAfterMs
        : null
      return finish({
        httpStatus: 429,
        result: failureResult({
          requestId: request.requestId,
          safeFailureCode: 'provider_rate_limited',
          retryable: true,
          retryAfterMs,
          completionDisposition: 'confirmed_zero_completion',
          timingsMs: makeTimings(),
        }),
      })
    }
    const facts = completedFailureFacts(error)
    return finish({
      httpStatus: 503,
      result: failureResult({
        requestId: request.requestId,
        safeFailureCode: safeProviderFailureCode(error.code),
        retryable: facts.disposition === 'completed' ? false : providerFailureRetryable(error),
        completionDisposition: facts.disposition,
        finishReason: facts.finishReason,
        usage: facts.usage,
        timingsMs: makeTimings(),
      }),
    })
  }
}

export function createClassReviewSynthesisProviderForRuntime(
  runtimeConfig: GatewayRuntimeConfig,
  dependencies: CreateClassReviewSynthesisProviderDependencies = {},
): ClassReviewSynthesisProvider | null {
  const runtime = runtimeConfig.classReviewSynthesis
  return getClassReviewSynthesisProvider(runtime.mode, {
    ...(runtime.mode === 'fake'
      ? { fakeFactory: dependencies.fakeFactory }
      : {}),
    ...(runtime.mode === 'kimi'
      ? {
        kimiFactory: () => {
          const transportFactory = dependencies.kimiTransportFactory ?? createKimiTransport
          const transport = transportFactory({
            apiKey: runtime.apiKey,
            apiBase: runtimeConfig.kimi.apiBase,
            model: runtimeConfig.kimi.model,
            reasoningEffort: runtimeConfig.kimi.reasoningEffort,
            maxCompletionTokens: runtime.maxCompletionTokens,
          })
          return new KimiClassReviewProvider({
            transport,
            hmacSecret: runtimeConfig.kimi.promptCacheSecret,
            calibration: runtime.framingCalibration,
            ...(dependencies.tokenizer ? { tokenizer: dependencies.tokenizer } : {}),
          })
        },
      }
      : {}),
  })
}
