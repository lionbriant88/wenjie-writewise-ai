export type NotMeasurableMetric = {
  status: 'not_measurable'
  reason: string
}

export type MeasuredMetric<T> = {
  status: 'measured'
  value: T
}

export type Metric<T> = MeasuredMetric<T> | NotMeasurableMetric

export type CerMetric =
  | (MeasuredMetric<number> & {
      editDistance: number
      referenceCodePoints: number
    })
  | NotMeasurableMetric

export interface CerSample {
  reference: string
  hypothesis: string
}

export interface CerSummary {
  macro: Metric<number>
  micro: Metric<number>
  measurableSampleCount: number
  excludedSampleCount: number
  totalEditDistance: number
  totalReferenceCodePoints: number
}

export interface ImportantLabelObservation {
  important: boolean
  detected: boolean
}

export type RecallMetric =
  | (MeasuredMetric<number> & {
      matched: number
      total: number
    })
  | NotMeasurableMetric

export interface EvidenceLocationObservation {
  accepted: boolean
  transcriptMatchCount: number
}

export type EvidenceLocationMetric =
  | (MeasuredMetric<number> & {
      uniquelyLocated: number
      total: number
    })
  | NotMeasurableMetric

export type BenchmarkPhaseTiming = 'queue' | 'provider' | 'parse' | 'normalize' | 'total'
export type TokenField = 'promptTokens' | 'completionTokens' | 'totalTokens' | 'cachedTokens'

export interface CompletionUsageObservation {
  attemptId: string
  usage?: Partial<Record<TokenField, number | null>>
  finishReason?: string | null
  phaseTimingsMs?: Partial<Record<BenchmarkPhaseTiming, number | null>>
}

export interface UniqueCompletionAggregate {
  uniqueAttemptCount: number
  duplicateObservationCount: number
  tokens: Record<TokenField, Metric<number>>
  finishReasons: {
    counts: Record<string, number>
    unknownCount: number
  }
  phaseTimingsMs: Record<BenchmarkPhaseTiming, Metric<number>>
}

export interface ConfidenceInterval95 {
  estimate: number
  lower: number
  upper: number
  confidence: 0.95
  iterations: number
  seed: number
}

export interface BootstrapOptions {
  iterations?: number
  seed?: number
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

const TOKEN_FIELDS: readonly TokenField[] = [
  'promptTokens',
  'completionTokens',
  'totalTokens',
  'cachedTokens',
]

const PHASE_TIMINGS: readonly BenchmarkPhaseTiming[] = [
  'queue',
  'provider',
  'parse',
  'normalize',
  'total',
]

function measured<T>(value: T): MeasuredMetric<T> {
  return { status: 'measured', value }
}

function notMeasurable(reason: string): NotMeasurableMetric {
  return { status: 'not_measurable', reason }
}

function assertFiniteNumber(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${field} must be finite`)
  }
}

function levenshteinDistance(reference: readonly string[], hypothesis: readonly string[]): number {
  let previous = Array.from({ length: hypothesis.length + 1 }, (_, index) => index)

  for (let referenceIndex = 1; referenceIndex <= reference.length; referenceIndex += 1) {
    const current = new Array<number>(hypothesis.length + 1)
    current[0] = referenceIndex

    for (let hypothesisIndex = 1; hypothesisIndex <= hypothesis.length; hypothesisIndex += 1) {
      const substitutionCost =
        reference[referenceIndex - 1] === hypothesis[hypothesisIndex - 1] ? 0 : 1
      current[hypothesisIndex] = Math.min(
        previous[hypothesisIndex] + 1,
        current[hypothesisIndex - 1] + 1,
        previous[hypothesisIndex - 1] + substitutionCost,
      )
    }

    previous = current
  }

  return previous[hypothesis.length]
}

export function calculateCer(reference: string, hypothesis: string): CerMetric {
  const referenceCodePoints = Array.from(reference)
  if (referenceCodePoints.length === 0) {
    return notMeasurable('empty_reference')
  }

  const editDistance = levenshteinDistance(referenceCodePoints, Array.from(hypothesis))
  return {
    status: 'measured',
    value: editDistance / referenceCodePoints.length,
    editDistance,
    referenceCodePoints: referenceCodePoints.length,
  }
}

export function summarizeCer(samples: readonly CerSample[]): CerSummary {
  let rateSum = 0
  let measurableSampleCount = 0
  let excludedSampleCount = 0
  let totalEditDistance = 0
  let totalReferenceCodePoints = 0

  for (const sample of samples) {
    const cer = calculateCer(sample.reference, sample.hypothesis)
    if (cer.status === 'not_measurable') {
      excludedSampleCount += 1
      continue
    }

    rateSum += cer.value
    measurableSampleCount += 1
    totalEditDistance += cer.editDistance
    totalReferenceCodePoints += cer.referenceCodePoints
  }

  return {
    macro:
      measurableSampleCount === 0
        ? notMeasurable('no_non_empty_references')
        : measured(rateSum / measurableSampleCount),
    micro:
      totalReferenceCodePoints === 0
        ? notMeasurable('no_reference_code_points')
        : measured(totalEditDistance / totalReferenceCodePoints),
    measurableSampleCount,
    excludedSampleCount,
    totalEditDistance,
    totalReferenceCodePoints,
  }
}

export function normalizedScoreError(
  modelScore: number,
  teacherScore: number,
  fullScore: number,
): Metric<number> {
  assertFiniteNumber(modelScore, 'modelScore')
  assertFiniteNumber(teacherScore, 'teacherScore')
  assertFiniteNumber(fullScore, 'fullScore')
  if (fullScore <= 0) {
    return notMeasurable('non_positive_full_score')
  }

  const absoluteDifference = Math.abs(modelScore - teacherScore)
  if (!Number.isFinite(absoluteDifference)) {
    return notMeasurable('unknown_or_invalid_value')
  }
  const value = absoluteDifference / fullScore
  return Number.isFinite(value) ? measured(value) : notMeasurable('unknown_or_invalid_value')
}

export function calculateMean(
  values: readonly (number | null | undefined)[],
): Metric<number> {
  if (values.length === 0) return notMeasurable('unknown_or_invalid_value')

  let sum = 0
  for (const value of values) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return notMeasurable('unknown_or_invalid_value')
    }
    sum += value
    if (!Number.isFinite(sum)) return notMeasurable('unknown_or_invalid_value')
  }

  const value = sum / values.length
  return Number.isFinite(value) ? measured(value) : notMeasurable('unknown_or_invalid_value')
}

export function calculateMedian(
  values: readonly (number | null | undefined)[],
): Metric<number> {
  if (
    values.length === 0 ||
    values.some((value) => value === null || value === undefined || !Number.isFinite(value))
  ) {
    return notMeasurable('unknown_or_invalid_value')
  }

  const sorted = [...(values as readonly number[])].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const value =
    sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  return Number.isFinite(value) ? measured(value) : notMeasurable('unknown_or_invalid_value')
}

export function calculateImportantRecall(
  observations: readonly ImportantLabelObservation[],
): RecallMetric {
  let matched = 0
  let total = 0

  for (const observation of observations) {
    if (!observation.important) continue
    total += 1
    if (observation.detected) matched += 1
  }

  if (total === 0) {
    return notMeasurable('no_important_labels')
  }

  return { status: 'measured', value: matched / total, matched, total }
}

export function calculateEvidenceLocationRate(
  observations: readonly EvidenceLocationObservation[],
): EvidenceLocationMetric {
  let uniquelyLocated = 0
  let total = 0

  for (const observation of observations) {
    if (!Number.isInteger(observation.transcriptMatchCount) || observation.transcriptMatchCount < 0) {
      throw new Error('transcriptMatchCount must be a non-negative integer')
    }
    if (!observation.accepted) continue
    total += 1
    if (observation.transcriptMatchCount === 1) uniquelyLocated += 1
  }

  if (total === 0) {
    return notMeasurable('no_accepted_evidence')
  }

  return { status: 'measured', value: uniquelyLocated / total, uniquelyLocated, total }
}

function cloneObservation(observation: CompletionUsageObservation): CompletionUsageObservation {
  return {
    attemptId: observation.attemptId,
    usage: observation.usage === undefined ? undefined : { ...observation.usage },
    finishReason: observation.finishReason,
    phaseTimingsMs:
      observation.phaseTimingsMs === undefined ? undefined : { ...observation.phaseTimingsMs },
  }
}

function mergeScalar<T>(current: T | null | undefined, incoming: T | null | undefined): T | undefined {
  const normalizedCurrent = current ?? undefined
  const normalizedIncoming = incoming ?? undefined
  if (normalizedCurrent !== undefined && normalizedIncoming !== undefined && normalizedCurrent !== normalizedIncoming) {
    throw new Error('conflicting observations for provider attempt')
  }
  return normalizedCurrent ?? normalizedIncoming
}

function mergeDuplicate(
  current: CompletionUsageObservation,
  incoming: CompletionUsageObservation,
): CompletionUsageObservation {
  const usage: Partial<Record<TokenField, number>> = {}
  for (const field of TOKEN_FIELDS) {
    const value = mergeScalar(current.usage?.[field], incoming.usage?.[field])
    if (value !== undefined) usage[field] = value
  }

  const phaseTimingsMs: Partial<Record<BenchmarkPhaseTiming, number>> = {}
  for (const field of PHASE_TIMINGS) {
    const value = mergeScalar(current.phaseTimingsMs?.[field], incoming.phaseTimingsMs?.[field])
    if (value !== undefined) phaseTimingsMs[field] = value
  }

  return {
    attemptId: current.attemptId,
    usage: Object.keys(usage).length === 0 ? undefined : usage,
    finishReason: mergeScalar(current.finishReason, incoming.finishReason),
    phaseTimingsMs: Object.keys(phaseTimingsMs).length === 0 ? undefined : phaseTimingsMs,
  }
}

function aggregateCompleteField<T extends string>(
  observations: readonly CompletionUsageObservation[],
  read: (observation: CompletionUsageObservation, field: T) => number | null | undefined,
  field: T,
  unknownReason: string,
  valueKind: 'token' | 'timing',
): Metric<number> {
  if (observations.length === 0) return notMeasurable('no_provider_attempts')

  let total = 0
  for (const observation of observations) {
    const value = read(observation, field)
    if (value === undefined || value === null) return notMeasurable(unknownReason)
    if (
      value < 0 ||
      (valueKind === 'token' ? !Number.isSafeInteger(value) : !Number.isFinite(value))
    ) {
      return notMeasurable(unknownReason)
    }
    const nextTotal = total + value
    if (
      !Number.isFinite(nextTotal) ||
      (valueKind === 'token' && !Number.isSafeInteger(nextTotal))
    ) {
      return notMeasurable(unknownReason)
    }
    total = nextTotal
  }
  return measured(total)
}

function hasInvalidOrInconsistentUsage(observation: CompletionUsageObservation): boolean {
  const usage = observation.usage
  if (usage === undefined) return false
  for (const field of TOKEN_FIELDS) {
    const value = usage[field]
    if (value !== undefined && value !== null && (!Number.isSafeInteger(value) || value < 0)) return true
  }

  const { promptTokens, completionTokens, totalTokens, cachedTokens } = usage
  if (
    promptTokens !== undefined &&
    promptTokens !== null &&
    completionTokens !== undefined &&
    completionTokens !== null &&
    totalTokens !== undefined &&
    totalTokens !== null &&
    totalTokens !== promptTokens + completionTokens
  ) {
    return true
  }
  return (
    cachedTokens !== undefined &&
    cachedTokens !== null &&
    promptTokens !== undefined &&
    promptTokens !== null &&
    cachedTokens > promptTokens
  )
}

export function aggregateUniqueCompletionMetrics(
  observations: readonly CompletionUsageObservation[],
): UniqueCompletionAggregate {
  const unique = new Map<string, CompletionUsageObservation>()
  let duplicateObservationCount = 0

  for (const observation of observations) {
    if (!UUID_PATTERN.test(observation.attemptId)) {
      throw new Error('attemptId must be a UUID')
    }
    const attemptId = observation.attemptId.toLowerCase()
    const normalized = cloneObservation({ ...observation, attemptId })
    const existing = unique.get(attemptId)
    if (existing === undefined) {
      unique.set(attemptId, normalized)
    } else {
      duplicateObservationCount += 1
      unique.set(attemptId, mergeDuplicate(existing, normalized))
    }
  }

  const attempts = [...unique.values()]
  const invalidUsageAttemptIds = new Set(
    attempts.filter(hasInvalidOrInconsistentUsage).map((attempt) => attempt.attemptId),
  )
  const tokens = Object.fromEntries(
    TOKEN_FIELDS.map((field) => [
      field,
      aggregateCompleteField(
        attempts,
        (observation, key) =>
          invalidUsageAttemptIds.has(observation.attemptId) ? undefined : observation.usage?.[key],
        field,
        'unknown_or_partial_usage',
        'token',
      ),
    ]),
  ) as Record<TokenField, Metric<number>>

  const finishReasons: UniqueCompletionAggregate['finishReasons'] = {
    counts: {},
    unknownCount: 0,
  }
  for (const attempt of attempts) {
    const reason = attempt.finishReason?.trim()
    if (!reason) {
      finishReasons.unknownCount += 1
    } else {
      finishReasons.counts[reason] = (finishReasons.counts[reason] ?? 0) + 1
    }
  }

  const phaseTimingsMs = Object.fromEntries(
    PHASE_TIMINGS.map((field) => [
      field,
      aggregateCompleteField(
        attempts,
        (observation, key) => observation.phaseTimingsMs?.[key],
        field,
        'unknown_or_partial_phase_timing',
        'timing',
      ),
    ]),
  ) as Record<BenchmarkPhaseTiming, Metric<number>>

  return {
    uniqueAttemptCount: attempts.length,
    duplicateObservationCount,
    tokens,
    finishReasons,
    phaseTimingsMs,
  }
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function percentile(sorted: readonly number[], probability: number): number {
  const position = (sorted.length - 1) * probability
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  if (lowerIndex === upperIndex) return sorted[lowerIndex]
  const fraction = position - lowerIndex
  return sorted[lowerIndex] * (1 - fraction) + sorted[upperIndex] * fraction
}

export function pairedBootstrap95(
  baseline: readonly number[],
  candidate: readonly number[],
  options: BootstrapOptions = {},
): Metric<ConfidenceInterval95> {
  if (baseline.length !== candidate.length) {
    throw new Error('paired inputs must have equal length')
  }
  if (baseline.length === 0) return notMeasurable('no_pairs')

  const iterations = options.iterations ?? 10_000
  const seed = options.seed ?? 0x51f15e
  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new Error('iterations must be a positive integer')
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new Error('seed must be a uint32 integer')
  }

  const differences = new Array<number>(baseline.length)
  for (let index = 0; index < baseline.length; index += 1) {
    const baselineValue = baseline[index]
    const candidateValue = candidate[index]
    assertFiniteNumber(baselineValue, `baseline[${index}]`)
    assertFiniteNumber(candidateValue, `candidate[${index}]`)
    const difference = candidateValue - baselineValue
    if (!Number.isFinite(difference)) return notMeasurable('unknown_or_invalid_value')
    differences[index] = difference
  }

  let differenceSum = 0
  for (const difference of differences) {
    differenceSum += difference
    if (!Number.isFinite(differenceSum)) return notMeasurable('unknown_or_invalid_value')
  }
  const estimate = differenceSum / differences.length
  if (!Number.isFinite(estimate)) return notMeasurable('unknown_or_invalid_value')
  const random = createRandom(seed)
  const resampledMeans = new Array<number>(iterations)

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0
    for (let sampleIndex = 0; sampleIndex < differences.length; sampleIndex += 1) {
      sum += differences[Math.floor(random() * differences.length)]
      if (!Number.isFinite(sum)) return notMeasurable('unknown_or_invalid_value')
    }
    const mean = sum / differences.length
    if (!Number.isFinite(mean)) return notMeasurable('unknown_or_invalid_value')
    resampledMeans[iteration] = mean
  }
  resampledMeans.sort((left, right) => left - right)

  const lower = percentile(resampledMeans, 0.025)
  const upper = percentile(resampledMeans, 0.975)
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
    return notMeasurable('unknown_or_invalid_value')
  }

  return measured({
    estimate,
    lower,
    upper,
    confidence: 0.95,
    iterations,
    seed,
  })
}
