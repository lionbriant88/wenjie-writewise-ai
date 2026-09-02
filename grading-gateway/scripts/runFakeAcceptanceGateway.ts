import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import type { Server } from 'node:http'
import express from 'express'
import {
  createGatewayExecutionServices,
  createServer,
  type GatewayExecutionTimers,
  type GatewayExecutionServices,
} from '../src/server.js'
import type { GatewayRuntimeConfig } from '../src/gatewayRuntimeConfig.js'
import type { ClassReviewFramingCalibration } from '../src/classReviewSynthesis/framingCalibrations.js'
import type { ClassReviewPromptTokenizer } from '../src/classReviewSynthesis/promptBudget.js'
import type {
  ClassReviewProviderOutputV1,
  ClassReviewSynthesisRequestV1,
} from '../src/classReviewSynthesis/types.js'
import type { ClassReviewSynthesisProvider } from '../src/providers/classReviewSynthesisProviderTypes.js'
import type { MultimodalProvider } from '../src/providers/multimodalProviderTypes.js'
import {
  GradingProviderError,
  type ProviderAttemptObservation,
  type ProviderCallResult,
  type ProviderUsageSnapshot,
} from '../src/providers/providerTypes.js'
import {
  createProviderTelemetryRecorder,
  type ProviderTelemetryRecorder,
  type ProviderTelemetrySnapshot,
} from '../src/providerTelemetry.js'

export const FAKE_ACCEPTANCE_SCENARIOS = [
  'success',
  'rate-limit',
  'pause-auth',
  'result-unknown',
  'mixed',
] as const

export type FakeAcceptanceScenario = typeof FAKE_ACCEPTANCE_SCENARIOS[number]

export const FAKE_CLASS_REVIEW_ACCEPTANCE_SCENARIOS = [
  'success',
  'empty',
  'rate-limit',
  'pause-auth',
  'result-unknown',
  'invalid-schema',
] as const

export type FakeClassReviewAcceptanceScenario = typeof FAKE_CLASS_REVIEW_ACCEPTANCE_SCENARIOS[number]

export const FAKE_CLASS_REVIEW_SEMANTIC_VARIANTS = [
  'default',
  'combine-low-frequency',
  'subthreshold-and-omitted-must-cover',
  'duplicate-cross-pattern-ownership',
] as const

export type FakeClassReviewSemanticVariant = typeof FAKE_CLASS_REVIEW_SEMANTIC_VARIANTS[number]

export const FAKE_CLASS_REVIEW_SERVICE_BEARER = 'fake-class-review-service-bearer-v1'

export interface FakeAcceptanceGatewayOptions {
  scenario: FakeAcceptanceScenario
  classReviewScenario?: FakeClassReviewAcceptanceScenario
  classReviewSemanticVariant?: FakeClassReviewSemanticVariant
  allowedOrigin?: string
  hardLimit?: number
  httpDeadlineMs?: number
  providerFinalDeadlineMs?: number
  settlementGraceMs?: number
  successDelayMs?: number
  lateSuccessDelayMs?: number
  rateLimitRetryAfterMs?: number
  classReviewTokenizer?: ClassReviewPromptTokenizer
  monotonicNow?: () => number
  executionTimers?: GatewayExecutionTimers
}

export interface FakeAcceptanceSnapshot {
  scenario: FakeAcceptanceScenario
  providerCalls: number
  providerCompletions: number
  activeProviderCalls: number
  maxActiveProviderCalls: number
  ignoredAbortSignals: number
  outcomes: {
    succeeded: number
    rateLimited: number
    authFailed: number
    rejected: number
  }
  classReviewProviderCalls: number
  classReviewProviderCompletions: number
  classReviewObservations: ProviderAttemptObservation[]
  observations: ProviderAttemptObservation[]
  admission: ReturnType<GatewayExecutionServices['admission']['snapshot']>
  registry: ReturnType<GatewayExecutionServices['registry']['snapshot']>
  telemetry: ProviderTelemetrySnapshot
}

export interface FakeAcceptanceGateway {
  app: ReturnType<typeof createServer>
  executionServices: GatewayExecutionServices
  telemetry: ProviderTelemetryRecorder
  resume(): void
  snapshot(): FakeAcceptanceSnapshot
}

interface FakeState {
  providerCalls: number
  providerCompletions: number
  activeProviderCalls: number
  maxActiveProviderCalls: number
  ignoredAbortSignals: number
  outcomes: FakeAcceptanceSnapshot['outcomes']
  classReviewProviderCalls: number
  classReviewProviderCompletions: number
  classReviewObservations: ProviderAttemptObservation[]
  observations: ProviderAttemptObservation[]
  callsByEssay: Map<string, number>
  mixedRolesByEssay: Map<string, MixedRole>
  nextMixedEssayOrdinal: number
}

type ScriptedOutcome = 'success' | 'rate-limit' | 'auth-failure' | 'rejected' | 'late-success'
type MixedRole = ScriptedOutcome
type NormalizedFakeAcceptanceGatewayOptions = Required<Omit<
  FakeAcceptanceGatewayOptions,
  'monotonicNow' | 'executionTimers' | 'classReviewTokenizer'
>> & Pick<FakeAcceptanceGatewayOptions, 'monotonicNow' | 'executionTimers' | 'classReviewTokenizer'>

const SAMPLE_ID = /^sample-[a-z0-9]+(?:-[a-z0-9]+)*$/
const BROWSER_UPLOAD_ESSAY_ID = /^task-[0-9]+-uploaded-upload-(?:(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})|[0-9]+)-[1-9][0-9]*$/i
const DEFAULT_ALLOWED_ORIGIN = 'http://127.0.0.1:5174'
const DEFAULT_HTTP_DEADLINE_MS = 500
const DEFAULT_PROVIDER_FINAL_DEADLINE_MS = 1_200
const DEFAULT_SETTLEMENT_GRACE_MS = 200
const DEFAULT_HARD_LIMIT = 3
const DEFAULT_RATE_LIMIT_RETRY_AFTER_MS = 1_000
const DEFAULT_SUCCESS_DELAY_MS = 25
const INVALID_CONFIGURATION = 'Invalid fake acceptance Gateway configuration.'
const classReviewCalibration: ClassReviewFramingCalibration = {
  apiBase: 'https://api.moonshot.cn/v1',
  model: 'kimi-k3',
  reasoningEffort: 'low',
  policyVersion: 'class-review-policy-v1',
  schemaVersion: 'kimi-class-review-output-v1',
  projectionVersion: 'class-review-projection-v1',
  budgetVersion: 'class-review-prompt-budget-v1',
  wireSerializationVersion: 'class-review-wire-serialization-v1',
  framingTokens: 512,
}
const defaultFakeTimers: GatewayExecutionTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

function positiveInteger(value: number, minimum = 1): number {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(INVALID_CONFIGURATION)
  return value
}

function nonNegativeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(INVALID_CONFIGURATION)
  return value
}

function loopbackHttpOrigin(value: string): string {
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(value)
  if (!match || Number(match[1]) > 65_535) throw new TypeError(INVALID_CONFIGURATION)
  return value
}

export function parseFakeAcceptanceScenario(value: unknown): FakeAcceptanceScenario {
  if (typeof value !== 'string' || !FAKE_ACCEPTANCE_SCENARIOS.includes(value as FakeAcceptanceScenario)) {
    throw new TypeError(INVALID_CONFIGURATION)
  }
  return value as FakeAcceptanceScenario
}

export function parseFakeClassReviewScenario(value: unknown): FakeClassReviewAcceptanceScenario {
  if (typeof value !== 'string'
    || !FAKE_CLASS_REVIEW_ACCEPTANCE_SCENARIOS.includes(value as FakeClassReviewAcceptanceScenario)) {
    throw new TypeError(INVALID_CONFIGURATION)
  }
  return value as FakeClassReviewAcceptanceScenario
}

export function parseFakeClassReviewSemanticVariant(value: unknown): FakeClassReviewSemanticVariant {
  if (typeof value !== 'string'
    || !FAKE_CLASS_REVIEW_SEMANTIC_VARIANTS.includes(value as FakeClassReviewSemanticVariant)) {
    throw new TypeError(INVALID_CONFIGURATION)
  }
  return value as FakeClassReviewSemanticVariant
}

function runtimeConfig(options: NormalizedFakeAcceptanceGatewayOptions): GatewayRuntimeConfig {
  const terminalTtlMs = options.providerFinalDeadlineMs + options.settlementGraceMs + 60_000
  return {
    provider: 'mock',
    rubricStrategy: 'single-pass-v1',
    essayPromptProfile: 'optimized-v1',
    executionRegistry: 'memory-v1',
    deadlines: {
      httpMs: options.httpDeadlineMs,
      providerFinalMs: options.providerFinalDeadlineMs,
      settlementGraceMs: options.settlementGraceMs,
    },
    admission: { hardLimit: options.hardLimit },
    registry: { terminalTtlMs, maxEntries: 2_000 },
    retry: {
      maxProviderAttempts: 2,
      maxRateLimitRequeues: 5,
      baseMs: 2_000,
      capMs: 60_000,
      pauseAfterMs: 900_000,
    },
    classReviewSynthesis: {
      mode: 'fake',
      serviceToken: FAKE_CLASS_REVIEW_SERVICE_BEARER,
      maxCompletionTokens: 3_072,
    },
    kimi: {
      apiBase: 'https://api.moonshot.cn/v1',
      model: 'kimi-k3',
      reasoningEffort: 'low',
      promptCacheSecret: '',
      stageBudgets: {
        material_context: 16_384,
        rubric_generation: 16_384,
        essay_grading_images: 16_384,
        essay_regrading_text: 16_384,
      },
    },
  }
}

function uuidFor(ordinal: number): string {
  const suffix = String(ordinal).padStart(12, '0')
  if (suffix.length > 12) throw new TypeError(INVALID_CONFIGURATION)
  return `00000000-0000-4000-8000-${suffix}`
}

function observation(ordinal: number, providerElapsedMs: number): ProviderAttemptObservation {
  return {
    attemptDiagnosticId: uuidFor(ordinal),
    finishReason: 'stop',
    providerElapsedMs,
    usage: {
      promptTokens: { status: 'known', value: 24 },
      completionTokens: { status: 'known', value: 12 },
      totalTokens: { status: 'known', value: 36 },
      cachedTokens: { status: 'known', value: 6 },
    },
  }
}

function classReviewUsage(): ProviderUsageSnapshot {
  return {
    promptTokens: { status: 'known', value: 100 },
    completionTokens: { status: 'known', value: 50 },
    totalTokens: { status: 'known', value: 150 },
    cachedTokens: { status: 'known', value: 20 },
  }
}

function classReviewObservation(
  ordinal: number,
  providerElapsedMs: number,
): ProviderAttemptObservation {
  return {
    attemptDiagnosticId: uuidFor(10_000 + ordinal),
    finishReason: 'stop',
    providerElapsedMs,
    usage: classReviewUsage(),
  }
}

function classReviewOutput(
  request: ClassReviewSynthesisRequestV1,
  scenario: FakeClassReviewAcceptanceScenario,
  variant: FakeClassReviewSemanticVariant,
): ClassReviewProviderOutputV1 {
  const dimensionIds = request.statistics.dimensions.slice(0, 1).map((dimension) => dimension.dimensionId)
  let patterns: ClassReviewProviderOutputV1['patterns'] = []
  if (scenario !== 'empty') {
    if (variant === 'combine-low-frequency') {
      const lowFrequency = request.groups.filter((group) => !group.mustCover).slice(0, 2)
      patterns = lowFrequency.length >= 2
        ? [{
            groupIds: lowFrequency.map((group) => group.groupId),
            title: 'Gateway combined low-frequency issue',
            diagnosis: 'Separate rare issues become common when their hidden essay support is unioned.',
            teachingAction: 'Teach them together with one focused comparison.',
            severity: 'medium',
          }]
        : []
    } else if (variant === 'subthreshold-and-omitted-must-cover') {
      const lowFrequency = request.groups.find((group) => !group.mustCover)
      patterns = lowFrequency
        ? [{
            groupIds: [lowFrequency.groupId],
            title: 'Gateway below-threshold issue',
            diagnosis: 'This should be dropped by deterministic support validation.',
            teachingAction: 'This action should not survive materialization.',
            severity: 'low',
          }]
        : []
    } else if (variant === 'duplicate-cross-pattern-ownership') {
      const groupId = request.groups[0]?.groupId ?? 'unknown.group'
      patterns = [
        {
          groupIds: [groupId],
          title: 'Gateway duplicate owner A',
          diagnosis: 'Duplicate ownership should fail.',
          teachingAction: 'Reject the whole candidate.',
          severity: 'medium',
        },
        {
          groupIds: [groupId],
          title: 'Gateway duplicate owner B',
          diagnosis: 'Duplicate ownership should fail.',
          teachingAction: 'Reject the whole candidate.',
          severity: 'medium',
        },
      ]
    } else {
      patterns = request.groups.filter((group) => group.mustCover).slice(0, 1).map((group) => ({
        groupIds: [group.groupId],
        title: 'Gateway common issue',
        diagnosis: 'Synthetic diagnosis for a common issue.',
        teachingAction: 'Use focused revision.',
        severity: 'medium',
      }))
    }
  }
  return {
    overallComment: 'Synthetic class-review summary.',
    strengths: [
      {
        title: 'Gateway strength',
        detail: 'Synthetic strengths are visible.',
        dimensionIds,
      },
    ],
    patterns,
    learningRecommendations: [
      {
        title: 'Gateway next step',
        action: 'Use focused revision.',
      },
    ],
  }
}

function invalidClassReviewOutput(request: ClassReviewSynthesisRequestV1): ClassReviewProviderOutputV1 {
  const groupId = request.groups[0]?.groupId ?? 'unknown.group'
  return {
    overallComment: 'Synthetic class-review summary.',
    strengths: [
      {
        title: 'Gateway strength',
        detail: 'Synthetic strengths are visible.',
        dimensionIds: [],
      },
    ],
    patterns: [
      {
        groupIds: [groupId],
        title: 'Gateway common issue',
        diagnosis: 'PRIVATE-INVALID-SCHEMA',
        teachingAction: 'Use focused revision.',
        severity: 'medium',
      },
      {
        groupIds: [groupId],
        title: 'Gateway duplicate issue',
        diagnosis: 'PRIVATE-INVALID-SCHEMA',
        teachingAction: 'Use focused revision.',
        severity: 'medium',
      },
    ],
    learningRecommendations: [
      {
        title: 'Gateway next step',
        action: 'Use focused revision.',
      },
    ],
  }
}

function syntheticRubric() {
  return {
    taskName: 'Synthetic fake acceptance task',
    materialSummary: 'Synthetic task context.',
    writingRequirements: ['Write a synthetic response.'],
    constraints: ['Use English.'],
    dimensions: [
      {
        id: 'content', name: 'Content', weight: 95, description: 'Address the task.',
        deductionFocus: [], sourceEvidence: [],
      },
      {
        id: 'legibility', name: 'Legibility', weight: 5, description: 'Remain readable.',
        deductionFocus: [], sourceEvidence: [],
      },
    ],
    reviewWarnings: [],
  }
}

function successfulPayload(input: Parameters<MultimodalProvider['gradeEssay']>[0]) {
  const transcript = input.confirmedTranscript ?? `Synthetic response for ${input.essayId}.`
  const dimensionScores = input.task.rubric.dimensions.map((dimension) => ({
    dimensionId: dimension.id,
    score: Math.round(input.task.fullScore * dimension.weight * 10_000) / 1_000_000,
    reason: 'Synthetic acceptance score.',
    evidence: transcript,
    relatedIssueKeys: [],
  }))
  return {
    transcript,
    recognitionWarnings: [],
    printedTextExcluded: true,
    reportedTotalScore: input.task.fullScore,
    dimensionScores,
    issues: [],
    sentenceRevisions: [],
    expressionUpgrades: [],
    fullTextRevision: { sentencePairs: [], logicNotes: [], logicIssues: [] },
    legibilityIssues: [],
    overallComment: 'Synthetic acceptance result.',
  }
}

function scriptedOutcome(
  scenario: FakeAcceptanceScenario,
  essayId: string,
  providerCallOrdinal: number,
  essayCallOrdinal: number,
  state: FakeState,
): ScriptedOutcome {
  const isSampleFixture = SAMPLE_ID.test(essayId)
  const isBrowserUpload = BROWSER_UPLOAD_ESSAY_ID.test(essayId)
  if (!isSampleFixture && !isBrowserUpload) return 'rejected'
  if (scenario === 'success') return 'success'
  if (scenario === 'rate-limit') return providerCallOrdinal === 1 ? 'rate-limit' : 'success'
  if (scenario === 'pause-auth') return providerCallOrdinal === 1 ? 'auth-failure' : 'success'
  if (scenario === 'result-unknown') return 'late-success'
  if (isSampleFixture) {
    if (essayId.includes('rate-limit')) return essayCallOrdinal === 1 ? 'rate-limit' : 'success'
    if (essayId.includes('failure')) return 'rejected'
    if (essayId === 'sample-auth') return essayCallOrdinal === 1 ? 'auth-failure' : 'success'
    if (essayId.includes('late') || essayId.includes('unknown')) return 'late-success'
    return 'success'
  }
  let role = state.mixedRolesByEssay.get(essayId)
  if (!role) {
    state.nextMixedEssayOrdinal += 1
    role = state.nextMixedEssayOrdinal === 2 ? 'rate-limit'
      : state.nextMixedEssayOrdinal === 3 ? 'rejected'
        : state.nextMixedEssayOrdinal === 4 ? 'auth-failure'
          : state.nextMixedEssayOrdinal === 5 ? 'late-success'
            : 'success'
    state.mixedRolesByEssay.set(essayId, role)
  }
  return (role === 'rate-limit' || role === 'auth-failure') && essayCallOrdinal > 1 ? 'success' : role
}

function delayIgnoringAbort(
  delayMs: number,
  signal: AbortSignal,
  state: FakeState,
  timers: GatewayExecutionTimers,
): Promise<void> {
  if (delayMs === 0) return Promise.resolve()
  return new Promise((resolvePromise) => {
    let countedAbort = false
    const recordAbort = () => {
      if (countedAbort) return
      countedAbort = true
      state.ignoredAbortSignals += 1
    }
    if (signal.aborted) recordAbort()
    else signal.addEventListener('abort', recordAbort, { once: true })
    timers.setTimeout(() => {
      signal.removeEventListener('abort', recordAbort)
      resolvePromise()
    }, delayMs)
  })
}

function createScriptedProvider(
  options: NormalizedFakeAcceptanceGatewayOptions,
  state: FakeState,
): MultimodalProvider {
  const recordCompletion = <T>(value: T, elapsedMs: number): ProviderCallResult<T> => {
    state.providerCompletions += 1
    state.outcomes.succeeded += 1
    const item = observation(state.providerCompletions, elapsedMs)
    state.observations.push(item)
    return { value, attempts: [item] }
  }
  return {
    async generateMaterialContext() {
      return recordCompletion({
        materialSummary: 'Synthetic task context.',
        writingRequirements: ['Write a synthetic response.'],
        constraints: ['Use English.'],
        reviewWarnings: [],
      }, 1)
    },
    async generateRubric() {
      return recordCompletion(syntheticRubric(), 1)
    },
    async gradeEssay(input) {
      state.providerCalls += 1
      state.activeProviderCalls += 1
      state.maxActiveProviderCalls = Math.max(state.maxActiveProviderCalls, state.activeProviderCalls)
      const providerCallOrdinal = state.providerCalls
      const essayCallOrdinal = (state.callsByEssay.get(input.essayId) ?? 0) + 1
      state.callsByEssay.set(input.essayId, essayCallOrdinal)
      const outcome = scriptedOutcome(options.scenario, input.essayId, providerCallOrdinal, essayCallOrdinal, state)
      try {
        if (outcome === 'rate-limit') {
          state.outcomes.rateLimited += 1
          throw new GradingProviderError(
            'provider_rate_limited', 'Synthetic rate limit.', true, undefined,
            { termination: 'confirmed', retryAfterMs: options.rateLimitRetryAfterMs, attemptObservations: [] },
          )
        }
        if (outcome === 'auth-failure') {
          state.outcomes.authFailed += 1
          throw new GradingProviderError(
            'provider_auth_failed', 'Synthetic auth failure.', false, undefined,
            { termination: 'confirmed', attemptObservations: [] },
          )
        }
        if (outcome === 'rejected') {
          state.outcomes.rejected += 1
          throw new GradingProviderError(
            'provider_request_rejected', 'Synthetic request rejection.', false, undefined,
            { termination: 'confirmed', attemptObservations: [] },
          )
        }
        const delayMs = outcome === 'late-success' ? options.lateSuccessDelayMs : options.successDelayMs
        await delayIgnoringAbort(delayMs, input.signal, state, options.executionTimers ?? defaultFakeTimers)
        return recordCompletion(successfulPayload(input), delayMs)
      } finally {
        state.activeProviderCalls -= 1
      }
    },
  }
}

function createScriptedClassReviewProvider(
  options: NormalizedFakeAcceptanceGatewayOptions,
  state: FakeState,
): ClassReviewSynthesisProvider {
  const recordCompletion = (
    value: ClassReviewProviderOutputV1,
    elapsedMs: number,
  ): ProviderCallResult<ClassReviewProviderOutputV1> => {
    state.classReviewProviderCompletions += 1
    const item = classReviewObservation(state.classReviewProviderCompletions, elapsedMs)
    state.classReviewObservations.push(item)
    return { value, attempts: [item] }
  }
  return {
    async synthesize(input) {
      state.classReviewProviderCalls += 1
      if (options.classReviewScenario === 'rate-limit') {
        throw new GradingProviderError(
          'provider_rate_limited',
          'PRIVATE-RATE-LIMIT',
          true,
          undefined,
          {
            termination: 'confirmed',
            retryAfterMs: options.rateLimitRetryAfterMs,
            attemptObservations: [],
          },
        )
      }
      if (options.classReviewScenario === 'pause-auth') {
        throw new GradingProviderError(
          'provider_auth_failed',
          'PRIVATE-AUTH',
          false,
          undefined,
          { termination: 'confirmed', attemptObservations: [] },
        )
      }
      if (options.classReviewScenario === 'result-unknown') {
        throw new GradingProviderError(
          'provider_unavailable',
          'PRIVATE-UNKNOWN',
          true,
          undefined,
          { termination: 'unknown', attemptObservations: [] },
        )
      }
      if (options.classReviewScenario === 'invalid-schema') {
        return recordCompletion(invalidClassReviewOutput(input.request), 1)
      }
      return recordCompletion(classReviewOutput(
        input.request,
        options.classReviewScenario,
        options.classReviewSemanticVariant,
      ), 1)
    },
  }
}

function normalizedOptions(options: FakeAcceptanceGatewayOptions): NormalizedFakeAcceptanceGatewayOptions {
  const scenario = parseFakeAcceptanceScenario(options.scenario)
  const classReviewScenario = parseFakeClassReviewScenario(options.classReviewScenario ?? 'success')
  const classReviewSemanticVariant = parseFakeClassReviewSemanticVariant(
    options.classReviewSemanticVariant ?? 'default',
  )
  const httpDeadlineMs = positiveInteger(options.httpDeadlineMs ?? DEFAULT_HTTP_DEADLINE_MS)
  const providerFinalDeadlineMs = positiveInteger(options.providerFinalDeadlineMs ?? DEFAULT_PROVIDER_FINAL_DEADLINE_MS)
  const settlementGraceMs = nonNegativeInteger(options.settlementGraceMs ?? DEFAULT_SETTLEMENT_GRACE_MS)
  if (providerFinalDeadlineMs <= httpDeadlineMs) throw new TypeError(INVALID_CONFIGURATION)
  if ((options.monotonicNow === undefined) !== (options.executionTimers === undefined)) {
    throw new TypeError(INVALID_CONFIGURATION)
  }
  const defaultLateDelayMs = providerFinalDeadlineMs + settlementGraceMs + 100
  const normalized = {
    scenario,
    classReviewScenario,
    classReviewSemanticVariant,
    allowedOrigin: loopbackHttpOrigin(options.allowedOrigin ?? DEFAULT_ALLOWED_ORIGIN),
    hardLimit: positiveInteger(options.hardLimit ?? DEFAULT_HARD_LIMIT),
    httpDeadlineMs,
    providerFinalDeadlineMs,
    settlementGraceMs,
    successDelayMs: nonNegativeInteger(options.successDelayMs ?? DEFAULT_SUCCESS_DELAY_MS),
    lateSuccessDelayMs: nonNegativeInteger(options.lateSuccessDelayMs ?? defaultLateDelayMs),
    rateLimitRetryAfterMs: nonNegativeInteger(options.rateLimitRetryAfterMs ?? DEFAULT_RATE_LIMIT_RETRY_AFTER_MS),
    ...(options.classReviewTokenizer ? { classReviewTokenizer: options.classReviewTokenizer } : {}),
    ...(options.monotonicNow ? { monotonicNow: options.monotonicNow } : {}),
    ...(options.executionTimers ? { executionTimers: options.executionTimers } : {}),
  }
  if ((scenario === 'result-unknown' || scenario === 'mixed')
    && normalized.lateSuccessDelayMs <= providerFinalDeadlineMs + settlementGraceMs) {
    throw new TypeError(INVALID_CONFIGURATION)
  }
  return normalized
}

export function createFakeAcceptanceGateway(options: FakeAcceptanceGatewayOptions): FakeAcceptanceGateway {
  const normalized = normalizedOptions(options)
  const config = runtimeConfig(normalized)
  const state: FakeState = {
    providerCalls: 0,
    providerCompletions: 0,
    activeProviderCalls: 0,
    maxActiveProviderCalls: 0,
    ignoredAbortSignals: 0,
    outcomes: { succeeded: 0, rateLimited: 0, authFailed: 0, rejected: 0 },
    classReviewProviderCalls: 0,
    classReviewProviderCompletions: 0,
    classReviewObservations: [],
    observations: [],
    callsByEssay: new Map(),
    mixedRolesByEssay: new Map(),
    nextMixedEssayOrdinal: 0,
  }
  const telemetry = createProviderTelemetryRecorder()
  const createExecutionServices = () => createGatewayExecutionServices(config, {
    random: () => 0,
    ...(normalized.monotonicNow ? { now: normalized.monotonicNow } : {}),
    ...(normalized.executionTimers ? { timers: normalized.executionTimers } : {}),
  })
  const executionServices = createExecutionServices()
  const gradingApp = createServer({
    multimodalProvider: createScriptedProvider(normalized, state),
    classReviewProvider: createScriptedClassReviewProvider(normalized, state),
    classReviewFramingCalibration: classReviewCalibration,
    ...(normalized.classReviewTokenizer ? { classReviewTokenizer: normalized.classReviewTokenizer } : {}),
    runtimeConfig: config,
    timeoutMs: normalized.httpDeadlineMs,
    executionServices,
    providerTelemetry: telemetry,
    allowedOrigin: normalized.allowedOrigin,
    ...(normalized.monotonicNow ? { monotonicNow: normalized.monotonicNow } : {}),
    ...(normalized.executionTimers ? { executionTimers: normalized.executionTimers } : {}),
  })
  const resume = () => {
    const restarted = createExecutionServices()
    executionServices.admission = restarted.admission
    executionServices.registry = restarted.registry
    executionServices.oneShot = restarted.oneShot
  }
  const snapshot = (): FakeAcceptanceSnapshot => ({
    scenario: normalized.scenario,
    providerCalls: state.providerCalls,
    providerCompletions: state.providerCompletions,
    activeProviderCalls: state.activeProviderCalls,
    maxActiveProviderCalls: state.maxActiveProviderCalls,
    ignoredAbortSignals: state.ignoredAbortSignals,
    outcomes: { ...state.outcomes },
    classReviewProviderCalls: state.classReviewProviderCalls,
    classReviewProviderCompletions: state.classReviewProviderCompletions,
    classReviewObservations: structuredClone(state.classReviewObservations),
    observations: structuredClone(state.observations),
    admission: executionServices.admission.snapshot(),
    registry: executionServices.registry.snapshot(),
    telemetry: telemetry.snapshot(),
  })
  const app = express()
  app.use((request, response, next) => {
    const origin = request.headers.origin
    if (origin !== undefined && origin !== normalized.allowedOrigin) {
      response.sendStatus(403)
      return
    }
    next()
  })
  gradingApp.post('/fake-acceptance/resume', (_request, response) => {
    resume()
    response.json({ status: 'resumed' })
  })
  gradingApp.get('/fake-acceptance/status', (_request, response) => response.json(snapshot()))
  app.use(gradingApp)
  return { app, executionServices, telemetry, resume, snapshot }
}

type FakeEnvironment = Record<string, string | undefined>

function environmentInteger(value: string | undefined, fallback: number, minimum = 1): number {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  return minimum === 0 ? nonNegativeInteger(parsed) : positiveInteger(parsed, minimum)
}

export function createFakeAcceptanceGatewayFromEnvironment(env: FakeEnvironment = process.env): {
  gateway: FakeAcceptanceGateway
  host: '127.0.0.1'
  port: number
} {
  const host = env.HOST?.trim() || '127.0.0.1'
  if (host !== '127.0.0.1') throw new TypeError(INVALID_CONFIGURATION)
  const scenario = parseFakeAcceptanceScenario(env.FAKE_ACCEPTANCE_SCENARIO)
  const classReviewScenario = parseFakeClassReviewScenario(env.FAKE_CLASS_REVIEW_SCENARIO ?? 'success')
  const httpDeadlineMs = environmentInteger(env.FAKE_HTTP_DEADLINE_MS, DEFAULT_HTTP_DEADLINE_MS)
  const providerFinalDeadlineMs = environmentInteger(env.FAKE_PROVIDER_FINAL_DEADLINE_MS, DEFAULT_PROVIDER_FINAL_DEADLINE_MS)
  const settlementGraceMs = environmentInteger(env.FAKE_SETTLEMENT_GRACE_MS, DEFAULT_SETTLEMENT_GRACE_MS, 0)
  return {
    gateway: createFakeAcceptanceGateway({
      scenario,
      classReviewScenario,
      allowedOrigin: env.FAKE_ALLOWED_ORIGIN ?? DEFAULT_ALLOWED_ORIGIN,
      hardLimit: environmentInteger(env.FAKE_PROVIDER_HARD_LIMIT, DEFAULT_HARD_LIMIT),
      httpDeadlineMs,
      providerFinalDeadlineMs,
      settlementGraceMs,
      successDelayMs: environmentInteger(env.FAKE_SUCCESS_DELAY_MS, DEFAULT_SUCCESS_DELAY_MS, 0),
      lateSuccessDelayMs: environmentInteger(
        env.FAKE_LATE_SUCCESS_DELAY_MS,
        providerFinalDeadlineMs + settlementGraceMs + 100,
        0,
      ),
      rateLimitRetryAfterMs: environmentInteger(
        env.FAKE_RATE_LIMIT_RETRY_AFTER_MS,
        DEFAULT_RATE_LIMIT_RETRY_AFTER_MS,
        0,
      ),
    }),
    host: '127.0.0.1',
    port: environmentInteger(env.PORT, 8_792),
  }
}

export function startFakeAcceptanceGateway(
  env: FakeEnvironment = process.env,
  output: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Server {
  const { gateway, host, port } = createFakeAcceptanceGatewayFromEnvironment(env)
  return gateway.app.listen(port, host, () => {
    output(JSON.stringify({ event: 'fake_acceptance_gateway_started', host, port, scenario: gateway.snapshot().scenario }))
  })
}

function isDirectExecution(): boolean {
  const scriptPath = process.argv[1]
  if (!scriptPath) return false
  return pathToFileURL(resolve(scriptPath)).href === pathToFileURL(resolve(fileURLToPath(import.meta.url))).href
}

if (isDirectExecution()) startFakeAcceptanceGateway()
