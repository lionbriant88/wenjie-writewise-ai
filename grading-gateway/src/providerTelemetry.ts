import { randomUUID } from 'node:crypto'
import type { ProviderAttemptObservation, ProviderCallStage, ProviderUsageSnapshot } from './providers/providerTypes.js'

type MetricOutcome = 'success' | 'failed' | 'result_unknown'
type SafeFinishReason = ProviderAttemptObservation['finishReason']

export interface SafeImageDimensionMetric {
  page: number
  width: number
  height: number
}

export interface ProviderAttemptMetricContext {
  stage: ProviderCallStage
  model: string
  reasoningEffort: 'low'
  outcome: MetricOutcome
}

export interface ProviderOperationMetricInput extends ProviderAttemptMetricContext {
  operationDiagnosticId: string
  queueMs?: number
  parseMs?: number
  normalizeMs?: number
  totalMs?: number
  pageCount?: number
  totalBytes?: number
  dimensions?: readonly SafeImageDimensionMetric[]
  confirmedTextCodeUnits?: number
}

export interface SafeProviderAttemptMetric extends ProviderAttemptMetricContext {
  event: 'provider_attempt'
  processDiagnosticId: string
  attemptDiagnosticId: string
  providerMs: number
  finishReason: SafeFinishReason
  attempt: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  cachedTokens?: number
}

export interface SafeProviderOperationMetric extends ProviderOperationMetricInput {
  event: 'provider_operation'
  processDiagnosticId: string
}

export type SafeProviderMetric = SafeProviderAttemptMetric | SafeProviderOperationMetric
export type SafeProviderMetricSink = (metric: SafeProviderMetric) => void

export type ProviderTokenTotalSnapshot =
  | { status: 'known'; value: number }
  | { status: 'partial'; lowerBound: number; knownAttempts: number; unknownAttempts: number }
  | { status: 'unknown'; knownAttempts: 0; unknownAttempts: number }

export interface ProviderTelemetrySnapshot {
  uniqueAttempts: number
  usageCoverage: { knownAttempts: number; unknownAttempts: number }
  totals: {
    promptTokens: ProviderTokenTotalSnapshot
    completionTokens: ProviderTokenTotalSnapshot
    totalTokens: ProviderTokenTotalSnapshot
    cachedTokens: ProviderTokenTotalSnapshot
  }
}

export interface ProviderTelemetryRecorder {
  recordUniqueAttempts(context: ProviderAttemptMetricContext, attempts: readonly ProviderAttemptObservation[]): void
  recordOperation(metric: ProviderOperationMetricInput): void
  snapshot(): ProviderTelemetrySnapshot
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const SENSITIVE_MARKER = /private|bearer|authorization|api[_-]?key|base64|secret|content|digest/i
const STAGES = new Set<ProviderCallStage>(['material_context', 'rubric_generation', 'essay_grading_images', 'essay_regrading_text'])
const OUTCOMES = new Set<MetricOutcome>(['success', 'failed', 'result_unknown'])
const FINISH_REASONS = new Set<SafeFinishReason>(['stop', 'length', 'content_filter', 'tool_calls', 'unknown'])

function safeId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

function safeModel(value: unknown): value is string {
  return typeof value === 'string' && SAFE_MODEL.test(value) && !SENSITIVE_MARKER.test(value)
}

function safeDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function safeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function knownToken(value: ProviderUsageSnapshot[keyof ProviderUsageSnapshot]): number | null {
  return value.status === 'known' && safeInteger(value.value) ? value.value : null
}

function validUsage(usage: ProviderUsageSnapshot) {
  const promptTokens = knownToken(usage.promptTokens)
  const completionTokens = knownToken(usage.completionTokens)
  const totalTokens = knownToken(usage.totalTokens)
  const cachedTokens = knownToken(usage.cachedTokens)
  if (promptTokens === null || completionTokens === null || totalTokens === null || promptTokens + completionTokens !== totalTokens) return null
  if (cachedTokens !== null && cachedTokens > promptTokens) return null
  return { promptTokens, completionTokens, totalTokens, ...(cachedTokens === null ? {} : { cachedTokens }) }
}

function safeDimensions(value: unknown): SafeImageDimensionMetric[] | undefined {
  if (!Array.isArray(value) || value.length > 10) return undefined
  const dimensions: SafeImageDimensionMetric[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return undefined
    const candidate = item as Record<string, unknown>
    if (!safeInteger(candidate.page) || candidate.page < 1 || !safeInteger(candidate.width) || candidate.width < 1 || candidate.width > 100_000
      || !safeInteger(candidate.height) || candidate.height < 1 || candidate.height > 100_000) return undefined
    dimensions.push({ page: candidate.page, width: candidate.width, height: candidate.height })
  }
  return dimensions
}

function sanitizedMetric(value: unknown): SafeProviderMetric | null {
  if (typeof value !== 'object' || value === null) return null
  const metric = value as Record<string, unknown>
  if (!safeId(metric.processDiagnosticId) || !STAGES.has(metric.stage as ProviderCallStage)
    || !safeModel(metric.model) || metric.reasoningEffort !== 'low' || !OUTCOMES.has(metric.outcome as MetricOutcome)) return null
  if (metric.event === 'provider_attempt') {
    if (!safeId(metric.attemptDiagnosticId) || !safeDuration(metric.providerMs)
      || !FINISH_REASONS.has(metric.finishReason as SafeFinishReason) || !safeInteger(metric.attempt) || metric.attempt < 1) return null
    const result: SafeProviderAttemptMetric = {
      event: 'provider_attempt', processDiagnosticId: metric.processDiagnosticId, attemptDiagnosticId: metric.attemptDiagnosticId,
      stage: metric.stage as ProviderCallStage, model: metric.model, reasoningEffort: 'low',
      providerMs: metric.providerMs, finishReason: metric.finishReason as SafeFinishReason, attempt: metric.attempt,
      outcome: metric.outcome as MetricOutcome,
    }
    for (const key of ['promptTokens', 'completionTokens', 'totalTokens', 'cachedTokens'] as const) {
      if (safeInteger(metric[key])) result[key] = metric[key]
    }
    return result
  }
  if (metric.event !== 'provider_operation' || !safeId(metric.operationDiagnosticId)) return null
  const result: SafeProviderOperationMetric = {
    event: 'provider_operation', processDiagnosticId: metric.processDiagnosticId, operationDiagnosticId: metric.operationDiagnosticId,
    stage: metric.stage as ProviderCallStage, model: metric.model, reasoningEffort: 'low',
    outcome: metric.outcome as MetricOutcome,
  }
  for (const key of ['queueMs', 'parseMs', 'normalizeMs', 'totalMs'] as const) {
    if (safeDuration(metric[key])) result[key] = metric[key]
  }
  for (const key of ['pageCount', 'totalBytes', 'confirmedTextCodeUnits'] as const) {
    if (safeInteger(metric[key])) result[key] = metric[key]
  }
  const dimensions = safeDimensions(metric.dimensions)
  if (dimensions?.length) result.dimensions = dimensions
  return result
}

export function serializeSafeProviderMetric(metric: unknown): string | null {
  const sanitized = sanitizedMetric(metric)
  return sanitized ? JSON.stringify(sanitized) : null
}

export function createProviderTelemetryRecorder(options: {
  emit?: SafeProviderMetricSink
  processDiagnosticIdFactory?: () => string
} = {}): ProviderTelemetryRecorder {
  const processDiagnosticId = (options.processDiagnosticIdFactory ?? randomUUID)()
  const seenAttemptIds = new Set<string>()
  const accounting = {
    uniqueAttempts: 0,
    usageKnownAttempts: 0,
  }
  const tokenAccounting = {
    promptTokens: { value: 0, knownAttempts: 0, overflowed: false },
    completionTokens: { value: 0, knownAttempts: 0, overflowed: false },
    totalTokens: { value: 0, knownAttempts: 0, overflowed: false },
    cachedTokens: { value: 0, knownAttempts: 0, overflowed: false },
  }
  const checkedAdd = (dimension: keyof typeof tokenAccounting, value: number) => {
    const aggregate = tokenAccounting[dimension]
    if (aggregate.overflowed) return
    const next = aggregate.value + value
    if (!safeInteger(next)) {
      aggregate.overflowed = true
      return
    }
    aggregate.value = next
    aggregate.knownAttempts += 1
  }
  const emit = (metric: SafeProviderMetric) => {
    const sanitized = sanitizedMetric(metric)
    if (!sanitized || !options.emit) return
    try { options.emit(sanitized) } catch { /* Metrics must never alter grading. */ }
  }
  return {
    recordUniqueAttempts(context, attempts) {
      attempts.forEach((observation, index) => {
        if (!safeId(observation.attemptDiagnosticId) || seenAttemptIds.has(observation.attemptDiagnosticId)) return
        seenAttemptIds.add(observation.attemptDiagnosticId)
        accounting.uniqueAttempts += 1
        const usage = validUsage(observation.usage)
        if (usage) {
          accounting.usageKnownAttempts += 1
          checkedAdd('promptTokens', usage.promptTokens)
          checkedAdd('completionTokens', usage.completionTokens)
          checkedAdd('totalTokens', usage.totalTokens)
          if (usage.cachedTokens !== undefined) {
            checkedAdd('cachedTokens', usage.cachedTokens)
          }
        }
        emit({
          event: 'provider_attempt', processDiagnosticId, attemptDiagnosticId: observation.attemptDiagnosticId,
          ...context, providerMs: observation.providerElapsedMs, finishReason: observation.finishReason, attempt: index + 1,
          ...(usage ?? {}),
        })
      })
    },
    recordOperation(metric) {
      emit({ event: 'provider_operation', processDiagnosticId, ...metric })
    },
    snapshot() {
      const aggregate = (dimension: keyof typeof tokenAccounting): ProviderTokenTotalSnapshot => {
        const { value, knownAttempts } = tokenAccounting[dimension]
        const unknownAttempts = accounting.uniqueAttempts - knownAttempts
        if (knownAttempts === accounting.uniqueAttempts && accounting.uniqueAttempts > 0) return { status: 'known', value }
        if (knownAttempts > 0) return { status: 'partial', lowerBound: value, knownAttempts, unknownAttempts }
        return { status: 'unknown', knownAttempts: 0, unknownAttempts }
      }
      return {
        uniqueAttempts: accounting.uniqueAttempts,
        usageCoverage: {
          knownAttempts: accounting.usageKnownAttempts,
          unknownAttempts: accounting.uniqueAttempts - accounting.usageKnownAttempts,
        },
        totals: {
          promptTokens: aggregate('promptTokens'),
          completionTokens: aggregate('completionTokens'),
          totalTokens: aggregate('totalTokens'),
          cachedTokens: aggregate('cachedTokens'),
        },
      }
    },
  }
}

export function recordUniqueProviderAttempts(
  recorder: ProviderTelemetryRecorder,
  context: ProviderAttemptMetricContext,
  attempts: readonly ProviderAttemptObservation[],
): void {
  recorder.recordUniqueAttempts(context, attempts)
}

export function recordProviderOperation(recorder: ProviderTelemetryRecorder, metric: ProviderOperationMetricInput): void {
  recorder.recordOperation(metric)
}

export function createSafeProviderMetricStderrSink(
  enabled: string | undefined,
  output: (line: string) => void,
): SafeProviderMetricSink | undefined {
  if (enabled !== '1') return undefined
  return (metric) => {
    const serialized = serializeSafeProviderMetric(metric)
    if (serialized) output(serialized)
  }
}
