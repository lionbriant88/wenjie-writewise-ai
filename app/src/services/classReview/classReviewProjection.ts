import {
  classReviewSupportThreshold,
  type ClassReviewAggregate,
  type ClassReviewIssueAggregate,
} from './aggregateClassReview'
import type { RedactionResult } from './classReviewRedaction'
import type { TopicIdentity } from './classReviewTopicKey'
import {
  jsonUtf8ByteLength,
  type ClassReviewSynthesisProjectionV1,
  type IssueCounterIdV1,
  type SemanticCoverageV1,
  type Severity,
  type SynthesisGroupTypeV1,
  type SynthesisLogicSubtypeV1,
} from './types'

export interface ClassReviewProjectionLimits {
  maxDimensions: number
  maxScoreBands: number
  maxIssueCounters: number
  maxStatisticsJsonUtf8Bytes: number
  maxGroups: number
  maxEvidenceJsonUtf8Bytes: number
  maxOriginalTextCodePoints: number
  maxSuggestionOrDiagnosisCodePoints: number
  maxTitleCodePoints: number
  maxGroupVisibleCodePoints: number
}

export const DEFAULT_CLASS_REVIEW_PROJECTION_LIMITS: Readonly<ClassReviewProjectionLimits> = {
  maxDimensions: 10,
  maxScoreBands: 20,
  maxIssueCounters: 32,
  maxStatisticsJsonUtf8Bytes: 8 * 1024,
  maxGroups: 64,
  maxEvidenceJsonUtf8Bytes: 32 * 1024,
  maxOriginalTextCodePoints: 160,
  maxSuggestionOrDiagnosisCodePoints: 160,
  maxTitleCodePoints: 48,
  maxGroupVisibleCodePoints: 360,
}

export interface PreparedGroupProjectionIdentityV1 {
  atomicTopic: TopicIdentity
  title: RedactionResult
  excerpt: {
    originalText: RedactionResult
    suggestionOrDiagnosis: RedactionResult
  } | null
}

export interface RedactionContext {
  prepare(group: ClassReviewIssueAggregate): PreparedGroupProjectionIdentityV1 | null
}

export interface HiddenSelectedGroupV1 {
  atomicTopic: TopicIdentity
  title: RedactionResult
  excerpt: {
    originalText: RedactionResult
    suggestionOrDiagnosis: RedactionResult
  } | null
  essayIds: readonly string[]
  occurrenceCount: number
}

type FallbackTemplateV1 =
  | 'grammar'
  | 'spelling'
  | 'word_choice'
  | 'structure'
  | 'legibility'
  | `logic_${SynthesisLogicSubtypeV1}`

export interface HiddenMustCoverFallbackV1 {
  atomicTopic: TopicIdentity
  type: SynthesisGroupTypeV1
  subtype: SynthesisLogicSubtypeV1 | null
  severity: Severity
  distinctEssaySupport: number
  occurrenceCount: number
  content:
    | {
        kind: 'scrubbed'
        title: { text: string; scrubbedEvidenceKey: string }
        diagnosis: { text: string; scrubbedEvidenceKey: string }
        teachingTemplate: SynthesisGroupTypeV1
      }
    | {
        kind: 'template'
        template: FallbackTemplateV1
      }
  anonymousExample: null
}

export interface ClassReviewProjectionHiddenStateV1 {
  dimensionAliases: ReadonlyMap<string, string>
  selectedGroups: ReadonlyMap<string, HiddenSelectedGroupV1>
  unprojectedMustCover: readonly HiddenMustCoverFallbackV1[]
}

export type ClassReviewProjectionResult =
  | {
      status: 'ready'
      projection: ClassReviewSynthesisProjectionV1
      hidden: ClassReviewProjectionHiddenStateV1
    }
  | {
      status: 'rejected'
      safeFailureCode: 'class_review_projection_too_large'
    }
  | {
      status: 'rejected'
      safeFailureCode: 'class_review_projection_too_large'
      hidden: ClassReviewProjectionHiddenStateV1
    }
  | {
      status: 'invalid'
      reason: 'class_review_projection_preparation_invalid'
    }

interface PreparedCandidate {
  source: ClassReviewIssueAggregate
  prepared: PreparedGroupProjectionIdentityV1
  type: SynthesisGroupTypeV1
  subtype: SynthesisLogicSubtypeV1 | null
  severity: Severity
  mustCover: boolean
  title: string | null
  excerpt: {
    originalText: string | null
    suggestionOrDiagnosis: string | null
  } | null
}

interface ProjectableCandidate extends PreparedCandidate {
  title: string
  excerpt: {
    originalText: string
    suggestionOrDiagnosis: string
  } | null
}

const ISSUE_COUNTER_IDS: readonly IssueCounterIdV1[] = [
  'grammar',
  'spelling',
  'word_choice',
  'structure',
  'legibility',
  'logic_weak_connection',
  'logic_unclear_logic',
  'logic_missing_cause_effect',
  'logic_unclear_transition',
  'logic_topic_drift',
  'logic_irrelevant_sentence',
  'logic_unclear_reference',
  'logic_missing_motivation',
  'logic_plot_gap',
  'severity_low',
  'severity_medium',
  'severity_high',
  'other',
]
const ISSUE_COUNTER_SET = new Set<string>(ISSUE_COUNTER_IDS)
const GROUP_TYPES: readonly SynthesisGroupTypeV1[] = [
  'grammar',
  'spelling',
  'word_choice',
  'structure',
  'logic',
  'legibility',
]
const GROUP_TYPE_SET = new Set<string>(GROUP_TYPES)
const LOGIC_SUBTYPES: readonly SynthesisLogicSubtypeV1[] = [
  'weak_connection',
  'unclear_logic',
  'missing_cause_effect',
  'unclear_transition',
  'topic_drift',
  'irrelevant_sentence',
  'unclear_reference',
  'missing_motivation',
  'plot_gap',
]
const LOGIC_SUBTYPE_SET = new Set<string>(LOGIC_SUBTYPES)
const SEVERITIES: readonly Severity[] = ['high', 'medium', 'low']
const LIMIT_KEYS = Object.keys(DEFAULT_CLASS_REVIEW_PROJECTION_LIMITS).sort()
const REDACTION_OMISSION_REASONS = new Set([
  'malformed_input',
  'input_too_long',
  'unsafe_format',
  'prompt_injection',
  'entity_uncertain',
  'entity_detector_invalid',
  'residual_identifier',
  'meaning_destroyed',
  'invalid_evidence_key',
])

function invalid(): ClassReviewProjectionResult {
  return { status: 'invalid', reason: 'class_review_projection_preparation_invalid' }
}

function rejected(): ClassReviewProjectionResult {
  return { status: 'rejected', safeFailureCode: 'class_review_projection_too_large' }
}

function rejectedWithHidden(
  hidden: ClassReviewProjectionHiddenStateV1,
): ClassReviewProjectionResult {
  return attachHidden({
    status: 'rejected',
    safeFailureCode: 'class_review_projection_too_large',
  }, hidden)
}

function attachHidden<T extends object>(
  result: T,
  hidden: ClassReviewProjectionHiddenStateV1,
): T & { readonly hidden: ClassReviewProjectionHiddenStateV1 } {
  Object.defineProperty(result, 'hidden', {
    value: hidden,
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return result as T & { readonly hidden: ClassReviewProjectionHiddenStateV1 }
}

const frozenReadonlyMapSnapshots = new WeakMap<
  object,
  readonly (readonly [unknown, unknown])[]
>()

class FrozenReadonlyMap<K, V> implements ReadonlyMap<K, V> {
  readonly #snapshot: Map<K, V>

  constructor(entries: Iterable<readonly [K, V]>) {
    this.#snapshot = new Map(entries)
    frozenReadonlyMapSnapshots.set(
      this,
      Object.freeze(Array.from(
        this.#snapshot,
        ([key, value]) => Object.freeze([key, value] as const),
      )),
    )
    Object.freeze(this)
  }

  get size(): number {
    return this.#snapshot.size
  }

  has(key: K): boolean {
    return this.#snapshot.has(key)
  }

  get(key: K): V | undefined {
    return this.#snapshot.get(key)
  }

  entries(): MapIterator<[K, V]> {
    return this.#snapshot.entries()
  }

  keys(): MapIterator<K> {
    return this.#snapshot.keys()
  }

  values(): MapIterator<V> {
    return this.#snapshot.values()
  }

  forEach(
    callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
    thisArg?: unknown,
  ): void {
    for (const [key, value] of this.#snapshot) callbackfn.call(thisArg, value, key, this)
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries()
  }
}

Object.freeze(FrozenReadonlyMap.prototype)

export function snapshotClassReviewProjectionReadonlyMap<K, V>(
  value: unknown,
  maxEntries: number,
): readonly (readonly [K, V])[] | null {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 0) return null
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return null
  const snapshot = frozenReadonlyMapSnapshots.get(value)
  if (snapshot === undefined || snapshot.length > maxEntries) return null
  return snapshot as readonly (readonly [K, V])[]
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join('\0') === [...expected].sort().join('\0')
}

function isSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function limitsAreValid(value: ClassReviewProjectionLimits): boolean {
  if (!value || typeof value !== 'object') return false
  if (Object.keys(value).sort().join('\0') !== LIMIT_KEYS.join('\0')) return false
  for (const key of LIMIT_KEYS as Array<keyof ClassReviewProjectionLimits>) {
    if (!isSafeInteger(value[key])) return false
    if (value[key] > DEFAULT_CLASS_REVIEW_PROJECTION_LIMITS[key]) return false
  }
  return true
}

function truncateCodePoints(value: string, maximum: number): string | null {
  let count = 0
  let end = 0
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return null
      if (count === maximum) return value.slice(0, end)
      index += 1
      end = index + 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return null
    } else {
      if (count === maximum) return value.slice(0, end)
      end = index + 1
    }
    count += 1
  }
  return value.slice(0, end)
}

function isValidRedactionResult(value: RedactionResult): boolean {
  if (!value || typeof value !== 'object' || value.redactionVersion !== 'class-review-redaction-v1') {
    return false
  }
  if (value.status === 'omitted') {
    return hasExactKeys(value, ['status', 'reason', 'redactionVersion'])
      && REDACTION_OMISSION_REASONS.has(value.reason)
  }
  return value.status === 'kept'
    && hasExactKeys(value, ['status', 'text', 'redactionVersion', 'scrubbedEvidenceKey'])
    && typeof value.text === 'string'
    && truncateCodePoints(value.text, 4096) === value.text
    && /^scrub_v1_[0-9a-f]{32,64}$/.test(value.scrubbedEvidenceKey)
}

function isValidAtomicTopic(value: TopicIdentity): boolean {
  return Boolean(value)
    && hasExactKeys(value, ['kind', 'keyVersion', 'taskScope', 'key', 'fingerprintDigest'])
    && value.kind === 'atomic'
    && value.keyVersion === 'topic-key-v1'
    && /^scope_v1_[0-9a-f]{32,64}$/.test(value.taskScope)
    && /^tk1\.[0-9a-f]{16}(?:\.[0-9a-f]{12}(?:\.(?:[2-9]|[1-9]\d+))?)?$/.test(value.key)
    && /^fp1\.[0-9a-f]{64}$/.test(value.fingerprintDigest)
}

function isValidPrepared(value: PreparedGroupProjectionIdentityV1 | null): value is PreparedGroupProjectionIdentityV1 {
  return value !== null
    && hasExactKeys(value, ['atomicTopic', 'title', 'excerpt'])
    && isValidAtomicTopic(value.atomicTopic)
    && isValidRedactionResult(value.title)
    && (value.excerpt === null || (
      hasExactKeys(value.excerpt, ['originalText', 'suggestionOrDiagnosis'])
      && isValidRedactionResult(value.excerpt.originalText)
      && isValidRedactionResult(value.excerpt.suggestionOrDiagnosis)
    ))
}

function clonePrepared(value: PreparedGroupProjectionIdentityV1): PreparedGroupProjectionIdentityV1 {
  const cloneRedaction = (redaction: RedactionResult): RedactionResult => redaction.status === 'kept'
    ? {
        status: 'kept',
        text: redaction.text,
        redactionVersion: 'class-review-redaction-v1',
        scrubbedEvidenceKey: redaction.scrubbedEvidenceKey,
      }
    : {
        status: 'omitted',
        reason: redaction.reason,
        redactionVersion: 'class-review-redaction-v1',
      }
  return Object.freeze({
    atomicTopic: Object.freeze({
      kind: 'atomic',
      keyVersion: 'topic-key-v1',
      taskScope: value.atomicTopic.taskScope,
      key: value.atomicTopic.key,
      fingerprintDigest: value.atomicTopic.fingerprintDigest,
    }),
    title: Object.freeze(cloneRedaction(value.title)),
    excerpt: value.excerpt === null
      ? null
      : Object.freeze({
          originalText: Object.freeze(cloneRedaction(value.excerpt.originalText)),
          suggestionOrDiagnosis: Object.freeze(cloneRedaction(value.excerpt.suggestionOrDiagnosis)),
        }),
  })
}

function fallbackTemplate(
  type: SynthesisGroupTypeV1,
  subtype: SynthesisLogicSubtypeV1 | null,
): FallbackTemplateV1 {
  return type === 'logic' && subtype !== null ? `logic_${subtype}` : type as FallbackTemplateV1
}

function visibleCandidate(
  source: ClassReviewIssueAggregate,
  prepared: PreparedGroupProjectionIdentityV1,
  limits: ClassReviewProjectionLimits,
  type: SynthesisGroupTypeV1,
  subtype: SynthesisLogicSubtypeV1 | null,
  mustCover: boolean,
): PreparedCandidate {
  const rawTitle = prepared.title.status === 'kept' ? prepared.title.text : null
  let remaining = limits.maxGroupVisibleCodePoints
  const title = rawTitle === null
    ? null
    : truncateCodePoints(rawTitle, Math.min(limits.maxTitleCodePoints, remaining))
  remaining -= title === null ? 0 : Array.from(title).length

  let excerpt: PreparedCandidate['excerpt'] = prepared.excerpt === null
    ? null
    : { originalText: null, suggestionOrDiagnosis: null }
  if (
    prepared.excerpt !== null
    && prepared.excerpt.originalText.status === 'kept'
    && prepared.excerpt.suggestionOrDiagnosis.status === 'kept'
    && remaining > 0
  ) {
    const originalText = truncateCodePoints(
      prepared.excerpt.originalText.text,
      Math.min(limits.maxOriginalTextCodePoints, remaining),
    )
    remaining -= originalText === null ? 0 : Array.from(originalText).length
    const suggestionOrDiagnosis = truncateCodePoints(
      prepared.excerpt.suggestionOrDiagnosis.text,
      Math.min(limits.maxSuggestionOrDiagnosisCodePoints, remaining),
    )
    excerpt = { originalText, suggestionOrDiagnosis }
  }

  return {
    source,
    prepared,
    type,
    subtype,
    severity: source.severity,
    mustCover,
    title,
    excerpt,
  }
}

function isProjectable(candidate: PreparedCandidate): candidate is ProjectableCandidate {
  return candidate.title !== null
    && candidate.title.length > 0
    && (candidate.excerpt === null || (
      candidate.excerpt.originalText !== null
      && candidate.excerpt.originalText.length > 0
      && candidate.excerpt.suggestionOrDiagnosis !== null
      && candidate.excerpt.suggestionOrDiagnosis.length > 0
    ))
}

function typeRank(value: SynthesisGroupTypeV1): number {
  return GROUP_TYPES.indexOf(value)
}

function severityRank(value: Severity): number {
  return SEVERITIES.indexOf(value)
}

function tierKey(candidate: PreparedCandidate): string {
  return JSON.stringify([
    candidate.mustCover ? 0 : 1,
    -candidate.source.distinctEssaySupport,
    typeRank(candidate.type),
    severityRank(candidate.severity),
  ])
}

function orderCandidates(candidates: readonly PreparedCandidate[]): PreparedCandidate[] {
  const tiers = new Map<string, PreparedCandidate[]>()
  const tierOrder = [...candidates].sort((left, right) => (
    Number(right.mustCover) - Number(left.mustCover)
    || right.source.distinctEssaySupport - left.source.distinctEssaySupport
    || typeRank(left.type) - typeRank(right.type)
    || severityRank(left.severity) - severityRank(right.severity)
    || compareText(left.prepared.atomicTopic.key, right.prepared.atomicTopic.key)
  ))
  for (const candidate of tierOrder) {
    const key = tierKey(candidate)
    const tier = tiers.get(key)
    if (tier) tier.push(candidate)
    else tiers.set(key, [candidate])
  }

  const ordered: PreparedCandidate[] = []
  for (const tier of tiers.values()) {
    const buckets = new Map<string, PreparedCandidate[]>()
    for (const candidate of tier) {
      const primaryEssay = [...candidate.source.essayIds].sort(compareText)[0] ?? ''
      const bucket = buckets.get(primaryEssay)
      if (bucket) bucket.push(candidate)
      else buckets.set(primaryEssay, [candidate])
    }
    const essayOrder = Array.from(buckets.keys()).sort(compareText)
    for (const bucket of buckets.values()) {
      bucket.sort((left, right) => compareText(
        left.prepared.atomicTopic.key,
        right.prepared.atomicTopic.key,
      ))
    }
    let round = 0
    while (essayOrder.some((essayId) => (buckets.get(essayId)?.length ?? 0) > round)) {
      for (const essayId of essayOrder) {
        const candidate = buckets.get(essayId)?.[round]
        if (candidate) ordered.push(candidate)
      }
      round += 1
    }
  }
  return ordered
}

function preparedGroupIsStructurallyValid(
  group: ClassReviewIssueAggregate,
  issueEligibleEssayCount: number,
): group is ClassReviewIssueAggregate & {
  type: SynthesisGroupTypeV1
  subtype: SynthesisLogicSubtypeV1 | null
  severity: Severity
} {
  if (!group || typeof group !== 'object') return false
  if (typeof group.type !== 'string' || !GROUP_TYPE_SET.has(group.type)) return false
  if (group.type === 'logic') {
    if (typeof group.subtype !== 'string' || !LOGIC_SUBTYPE_SET.has(group.subtype)) return false
  } else if (group.subtype !== null) return false
  if (!SEVERITIES.includes(group.severity)) return false
  if (
    !isSafeInteger(group.distinctEssaySupport)
    || group.distinctEssaySupport > issueEligibleEssayCount
    || !isSafeInteger(group.occurrenceCount)
    || group.occurrenceCount < group.distinctEssaySupport
    || !Array.isArray(group.essayIds)
    || group.essayIds.length !== group.distinctEssaySupport
    || group.essayIds.some((essayId) => typeof essayId !== 'string' || essayId.length === 0)
    || new Set(group.essayIds).size !== group.essayIds.length
  ) return false
  return true
}

function buildStatistics(
  aggregate: ClassReviewAggregate,
  limits: ClassReviewProjectionLimits,
): {
  statistics: ClassReviewSynthesisProjectionV1['statistics']
  dimensionAliases: Map<string, string>
} | null {
  if (
    !Array.isArray(aggregate.dimensions)
    || aggregate.dimensions.length > limits.maxDimensions
    || !Array.isArray(aggregate.scoreBands)
    || aggregate.scoreBands.length > limits.maxScoreBands
    || !Array.isArray(aggregate.fixedIssueCounters)
    || aggregate.fixedIssueCounters.length > limits.maxIssueCounters
    || !isSafeInteger(aggregate.totalEssayCount)
    || !isSafeInteger(aggregate.includedEssayCount)
    || !isSafeInteger(aggregate.issueEligibleEssayCount)
    || !isSafeInteger(aggregate.excludedEssayCount)
    || aggregate.issueEligibleEssayCount > aggregate.includedEssayCount
    || aggregate.includedEssayCount > aggregate.totalEssayCount
    || aggregate.excludedEssayCount !== aggregate.totalEssayCount - aggregate.includedEssayCount
    || !isFiniteNumber(aggregate.fullScore)
    || aggregate.fullScore <= 0
    || aggregate.scoreSummary === null
    || !isFiniteNumber(aggregate.scoreMedian)
  ) return null

  const scoreValues = [
    aggregate.scoreSummary.averageScore,
    aggregate.scoreMedian,
    aggregate.scoreSummary.lowestScore,
    aggregate.scoreSummary.highestScore,
  ]
  if (
    scoreValues.some((score) => !isFiniteNumber(score) || score < 0 || score > aggregate.fullScore)
    || aggregate.scoreSummary.lowestScore > aggregate.scoreSummary.averageScore
    || aggregate.scoreSummary.lowestScore > aggregate.scoreMedian
    || aggregate.scoreSummary.averageScore > aggregate.scoreSummary.highestScore
    || aggregate.scoreMedian > aggregate.scoreSummary.highestScore
  ) return null

  const sortedBands = [...aggregate.scoreBands].sort((left, right) => (
    left.lowerInclusive - right.lowerInclusive
    || left.upperInclusive - right.upperInclusive
    || compareText(left.bandId, right.bandId)
  ))
  if (
    new Set(sortedBands.map(({ bandId }) => bandId)).size !== sortedBands.length
    || sortedBands.some((band) => (
      typeof band.bandId !== 'string'
      || !isFiniteNumber(band.lowerInclusive)
      || !isFiniteNumber(band.upperInclusive)
      || band.lowerInclusive < 0
      || band.upperInclusive < band.lowerInclusive
      || band.upperInclusive > aggregate.fullScore
      || !isSafeInteger(band.essayCount)
    ))
  ) return null

  const sortedDimensions = [...aggregate.dimensions].sort((left, right) => (
    compareText(left.dimensionId, right.dimensionId)
  ))
  if (
    new Set(sortedDimensions.map(({ dimensionId }) => dimensionId)).size !== sortedDimensions.length
    || sortedDimensions.some((dimension) => (
      typeof dimension.dimensionId !== 'string'
      || dimension.dimensionId.length === 0
      || !isFiniteNumber(dimension.averageScore)
      || !isFiniteNumber(dimension.medianScore)
      || !isFiniteNumber(dimension.maxScore)
      || dimension.maxScore <= 0
      || dimension.averageScore < 0
      || dimension.averageScore > dimension.maxScore
      || dimension.medianScore < 0
      || dimension.medianScore > dimension.maxScore
      || !isFiniteNumber(dimension.normalizedPerformance)
      || dimension.normalizedPerformance < 0
      || dimension.normalizedPerformance > 1
    ))
  ) return null

  const seenCounters = new Set<string>()
  if (aggregate.fixedIssueCounters.some((counter) => {
    if (
      !counter
      || typeof counter.counterId !== 'string'
      || !ISSUE_COUNTER_SET.has(counter.counterId)
      || seenCounters.has(counter.counterId)
      || !isSafeInteger(counter.count)
      || counter.count === 0
    ) return true
    seenCounters.add(counter.counterId)
    return false
  })) return null

  const dimensionAliases = new Map<string, string>()
  const dimensions = sortedDimensions.map((dimension, index) => {
    const dimensionId = `d${index + 1}`
    dimensionAliases.set(dimensionId, dimension.dimensionId)
    return {
      dimensionId,
      label: `Dimension ${index + 1}`,
      averageScore: dimension.averageScore,
      medianScore: dimension.medianScore,
      maxScore: dimension.maxScore,
      normalizedPerformance: dimension.normalizedPerformance,
    }
  })

  const statistics = {
    includedEssayCount: aggregate.includedEssayCount,
    issueEligibleEssayCount: aggregate.issueEligibleEssayCount,
    totalEssayCount: aggregate.totalEssayCount,
    excludedEssayCount: aggregate.excludedEssayCount,
    score: {
      fullScore: aggregate.fullScore,
      averageScore: aggregate.scoreSummary.averageScore,
      medianScore: aggregate.scoreMedian,
      lowestScore: aggregate.scoreSummary.lowestScore,
      highestScore: aggregate.scoreSummary.highestScore,
    },
    scoreBands: sortedBands.map((band, index) => ({
      bandId: `b${index + 1}`,
      lowerInclusive: band.lowerInclusive,
      upperInclusive: band.upperInclusive,
      essayCount: band.essayCount,
    })),
    dimensions,
    issueCounters: [...aggregate.fixedIssueCounters]
      .sort((left, right) => ISSUE_COUNTER_IDS.indexOf(left.counterId) - ISSUE_COUNTER_IDS.indexOf(right.counterId))
      .map(({ counterId, count }) => ({ counterId, count })),
  }
  return { statistics, dimensionAliases }
}

function coverage(
  selected: readonly PreparedCandidate[],
  eligible: readonly PreparedCandidate[],
): SemanticCoverageV1 {
  const projectedDistinctEssaySupportSum = selected.reduce(
    (total, candidate) => total + candidate.source.distinctEssaySupport,
    0,
  )
  const eligibleDistinctEssaySupportSum = eligible.reduce(
    (total, candidate) => total + candidate.source.distinctEssaySupport,
    0,
  )
  const projectedOccurrenceSum = selected.reduce(
    (total, candidate) => total + candidate.source.occurrenceCount,
    0,
  )
  const eligibleOccurrenceSum = eligible.reduce(
    (total, candidate) => total + candidate.source.occurrenceCount,
    0,
  )
  return {
    projectedGroupCount: selected.length,
    eligibleGroupCount: eligible.length,
    groupCoverage: eligible.length === 0 ? 1 : selected.length / eligible.length,
    projectedDistinctEssaySupportSum,
    eligibleDistinctEssaySupportSum,
    supportWeightedCoverage: eligibleDistinctEssaySupportSum === 0
      ? 1
      : projectedDistinctEssaySupportSum / eligibleDistinctEssaySupportSum,
    projectedOccurrenceSum,
    eligibleOccurrenceSum,
    occurrenceWeightedCoverage: eligibleOccurrenceSum === 0
      ? 1
      : projectedOccurrenceSum / eligibleOccurrenceSum,
  }
}

function hiddenFallback(candidate: PreparedCandidate): HiddenMustCoverFallbackV1 {
  const title = candidate.prepared.title
  const diagnosis = candidate.prepared.excerpt?.suggestionOrDiagnosis
  const content: HiddenMustCoverFallbackV1['content'] = Object.freeze(
    title.status === 'kept' && diagnosis?.status === 'kept'
      ? {
          kind: 'scrubbed',
          title: Object.freeze({ text: title.text, scrubbedEvidenceKey: title.scrubbedEvidenceKey }),
          diagnosis: Object.freeze({
            text: diagnosis.text,
            scrubbedEvidenceKey: diagnosis.scrubbedEvidenceKey,
          }),
          teachingTemplate: candidate.type,
        }
      : {
          kind: 'template',
          template: fallbackTemplate(candidate.type, candidate.subtype),
        },
  )
  return Object.freeze({
    atomicTopic: candidate.prepared.atomicTopic,
    type: candidate.type,
    subtype: candidate.subtype,
    severity: candidate.severity,
    distinctEssaySupport: candidate.source.distinctEssaySupport,
    occurrenceCount: candidate.source.occurrenceCount,
    content,
    anonymousExample: null,
  })
}

function buildHiddenState(
  dimensionAliases: ReadonlyMap<string, string>,
  selected: readonly PreparedCandidate[],
  selectedGroups: ReadonlyMap<string, HiddenSelectedGroupV1>,
  eligible: readonly PreparedCandidate[],
): ClassReviewProjectionHiddenStateV1 {
  const selectedSources = new Set(selected.map(({ source }) => source))
  return Object.freeze({
    dimensionAliases: new FrozenReadonlyMap(dimensionAliases.entries()),
    selectedGroups: new FrozenReadonlyMap(selectedGroups.entries()),
    unprojectedMustCover: Object.freeze(eligible
      .filter((candidate) => candidate.mustCover && !selectedSources.has(candidate.source))
      .map(hiddenFallback)),
  })
}

export function buildClassReviewProjection(input: {
  aggregate: ClassReviewAggregate
  redactionContext: RedactionContext
  limits: ClassReviewProjectionLimits
}): ClassReviewProjectionResult {
  if (
    !input
    || typeof input !== 'object'
    || !limitsAreValid(input.limits)
    || !input.redactionContext
    || typeof input.redactionContext.prepare !== 'function'
  ) return invalid()

  const statisticsState = buildStatistics(input.aggregate, input.limits)
  if (
    statisticsState === null
    || jsonUtf8ByteLength(statisticsState.statistics) > input.limits.maxStatisticsJsonUtf8Bytes
  ) return rejected()
  if (!Array.isArray(input.aggregate.issueGroups)) return invalid()

  const requiredSupport = classReviewSupportThreshold(input.aggregate.issueEligibleEssayCount)
  const candidates: PreparedCandidate[] = []
  for (const source of input.aggregate.issueGroups) {
    if (!preparedGroupIsStructurallyValid(source, input.aggregate.issueEligibleEssayCount)) {
      return invalid()
    }
    let prepared: PreparedGroupProjectionIdentityV1 | null
    try {
      prepared = input.redactionContext.prepare(source)
    } catch {
      return invalid()
    }
    if (!isValidPrepared(prepared)) return invalid()
    prepared = clonePrepared(prepared)
    const type = source.type as SynthesisGroupTypeV1
    const subtype = source.subtype as SynthesisLogicSubtypeV1 | null
    candidates.push(visibleCandidate(
      source,
      prepared,
      input.limits,
      type,
      subtype,
      source.distinctEssaySupport >= requiredSupport,
    ))
  }

  const ordered = orderCandidates(candidates)
  const selected: PreparedCandidate[] = []
  const groups: ClassReviewSynthesisProjectionV1['groups'] = []
  const selectedGroups = new Map<string, HiddenSelectedGroupV1>()
  for (const candidate of ordered) {
    if (!isProjectable(candidate)) continue
    if (groups.length >= input.limits.maxGroups) break
    const groupId = `g${groups.length + 1}`
    const projectedGroup = {
      groupId,
      type: candidate.type,
      subtype: candidate.subtype,
      severity: candidate.severity,
      title: candidate.title,
      mustCover: candidate.mustCover,
      distinctEssaySupport: candidate.source.distinctEssaySupport,
      occurrenceCount: candidate.source.occurrenceCount,
      excerpt: candidate.excerpt,
    }
    if (jsonUtf8ByteLength([...groups, projectedGroup]) > input.limits.maxEvidenceJsonUtf8Bytes) {
      break
    }
    groups.push(projectedGroup)
    selected.push(candidate)
    selectedGroups.set(groupId, Object.freeze({
      atomicTopic: candidate.prepared.atomicTopic,
      title: candidate.prepared.title,
      excerpt: candidate.prepared.excerpt,
      essayIds: Object.freeze([...candidate.source.essayIds]),
      occurrenceCount: candidate.source.occurrenceCount,
    }))
  }

  const hidden = buildHiddenState(
    statisticsState.dimensionAliases,
    selected,
    selectedGroups,
    ordered,
  )
  if (ordered.length > 0 && groups.length === 0) return rejectedWithHidden(hidden)

  return attachHidden({
    status: 'ready',
    projection: {
      statistics: statisticsState.statistics,
      groups,
      semanticCoverage: coverage(selected, ordered),
    },
  }, hidden)
}
