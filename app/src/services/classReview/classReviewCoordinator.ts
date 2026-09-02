import { parseClassReviewReport } from './classReviewContracts'
import {
  cloneAndFreezeClassReviewGenerationSnapshot,
  applyMaterializedClassReviewCandidate,
  createInternalIssueWorkspace,
  invalidateInternalSystemVariants,
  materializeClassReviewCandidate,
  projectInternalIssueWorkspace,
  removeTeacherEvidence,
  type GenerationSnapshot,
  type InternalIssueWorkspace,
  type SuppressedSystemVariant,
  type SystemEvidenceFact,
  type TeacherEvidenceFact,
} from './classReviewMerge'
import {
  cloneClassReviewProjectionHiddenState,
  snapshotClassReviewProjectionReadonlyMap,
  type ClassReviewProjectionResult,
  type HiddenMustCoverFallbackV1,
  type HiddenSelectedGroupV1,
} from './classReviewProjection'
import {
  createLocalClassReviewRegistry,
  type LocalGenerationRecord,
} from './classReviewRegistry'
import {
  createInMemoryTopicKeyRegistry,
  type TopicHmac,
  type TopicHmacDomain,
} from './classReviewTopicKey'
import { parseClassReviewSynthesisRequest, parseClassReviewSynthesisResult } from './synthesisContracts'
import type {
  AiSummaryV1,
  ClassReviewIssueBlockV1,
  ClassReviewReportV1,
  ClassReviewStatisticsV1,
  ClassReviewSynthesisRequestV1,
  EvidenceRefV1,
  SafeFailureCode,
  Severity,
} from './types'
import type { ClassReviewSynthesisClient } from './fakeClassReviewSynthesisClient'
export type { ClassReviewSynthesisClient } from './fakeClassReviewSynthesisClient'

type ReadyProjection = Extract<ClassReviewProjectionResult, { status: 'ready' }>

export type TeacherIssueCommand =
  | {
      kind: 'add'
      blockId: string
      topicKey: string
      title: string
      diagnosis: string
      teachingAction: string
      severity: Severity
      evidence: readonly { ref: EvidenceRefV1; essayIdentity: string; occurrenceCount: number }[]
    }
  | { kind: 'remove'; evidenceId: string }
  | { kind: 'undo' }
  | { kind: 'move'; blockId: string; toIndex: number }

interface RegisterWorkspaceInput {
  taskKey: string
  taskRevision: number
  rubricRevisionDigest: string
  report: ClassReviewReportV1
  projection: ReadyProjection
  teacherEvidenceFacts?: readonly TeacherEvidenceFact[]
  systemEvidenceFacts?: readonly SystemEvidenceFact[]
  suppressedSystemVariants?: ReadonlyMap<string, SuppressedSystemVariant>
}

interface GenerateCommandInput {
  taskKey: string
  generationId: string
  intent: 'initial' | 'regenerate'
  expectedTaskRevision: number
  expectedReportRevision: number | null
}

interface ApplyCandidateCommandInput {
  taskKey: string
  generationId: string
  expectedTaskRevision: number
  expectedReportRevision: number
  expectedGenerationRevision: number
  expectedAiTextEditRevision: number
}

interface DiscardCandidateCommandInput {
  taskKey: string
  generationId: string
  expectedGenerationRevision: number
}

interface ExecutionLease {
  opaqueTaskScope: string
  generationId: string
  request: ClassReviewSynthesisRequestV1 | null
  snapshot: Readonly<GenerationSnapshot> | null
  startAiTextEditRevision: number
}

interface InFlightOwner {
  opaqueTaskScope: string
  generationId: string
  promise: Promise<LocalGenerationRecord>
  resolve(record: LocalGenerationRecord): void
}

interface Workspace {
  taskKey: string
  taskRevision: number
  rubricRevisionDigest: string
  report: ClassReviewReportV1
  projection: ReadyProjection | null
  issueWorkspace: InternalIssueWorkspace
  opaqueTaskScope: string | null
  lastGenerationId: string | null
  activeExecution: ExecutionLease | null
  inFlight: InFlightOwner | null
  providerSettlementKnown: boolean
  sourceRevisionEpoch: number
  invalidationEpoch: number
  sourceReady: boolean
  taskDeleted: boolean
  undoIssueWorkspace: InternalIssueWorkspace | null
  cancelRetry: (() => void) | null
}

interface PreparedReservation {
  proposedGenerationId: string
  serviceGenerationId: string
  requestId: string
  request: ClassReviewSynthesisRequestV1
  requestBytes: string
  payloadDigest: string
  opaqueTaskScope: string
  executionIdentity: string
  fixedRevisions: string
  snapshotTuple: string
  commandIdentity: string
  actionableIdentity: string
  actionableReplayCore: string
  commandCore: string
  snapshot: Readonly<GenerationSnapshot>
  sourceFence: Readonly<{
    opaqueTaskScope: string | null
    workspaceState: ClassReviewReportV1['workspaceState']
    taskRevision: number
    rubricRevisionDigest: string
    reportRevision: number | null
    aiTextEditRevision: number
    sourceRevisionEpoch: number
    invalidationEpoch: number
    projectionIdentity: ReadyProjection
    statisticsIdentity: ClassReviewStatisticsV1
    ownerGenerationId: string | null
  }>
}

interface AcceptedAliasIdentity {
  readonly generationId: string
  readonly commandCore: string
  readonly actionableReplayCore: string
  readonly commandIdentity: string
  readonly actionableIdentity: string
  readonly executionIdentity: string
  readonly snapshotTuple: string
  readonly fixedRevisions: string
  readonly payloadDigest: string
}

export interface LocalClassReviewCoordinator {
  registerWorkspace(input: RegisterWorkspaceInput): void
  generate(command: GenerateCommandInput): Promise<LocalGenerationRecord>
  getSnapshot(taskKey: string): {
    report: ClassReviewReportV1
    generation: LocalGenerationRecord | null
    candidate: { readonly available: true; readonly generationId: string } | null
    requestId: string | null
    boundedRequeueCount: number
    providerSettlementKnown: boolean
    sourceReady: boolean
    taskDeleted: boolean
    sourceRevisionEpoch: number
  }
  applyCandidate(command: ApplyCandidateCommandInput): void
  discardCandidate(command: DiscardCandidateCommandInput): void
  syncSources(command: SourceSyncCommand): void
  beginAiTextEdit(taskKey: string): void
  saveAiTextEdit(taskKey: string, summary: AiSummaryV1): void
  cancelAiTextEdit(taskKey: string): void
  applyIssueCommand(taskKey: string, command: TeacherIssueCommand): void
}

export interface ClassReviewSourceReplacement {
  taskRevision: number
  rubricRevisionDigest: string
  statistics: ClassReviewStatisticsV1
  projection: ReadyProjection
}

interface SourceSyncCas {
  taskKey: string
  expectedTaskRevision: number
  expectedReportRevision: number | null
  expectedSourceRevisionEpoch: number
}

export type SourceSyncCommand =
  | (SourceSyncCas & { kind: 'ordinary_revision'; replacement: ClassReviewSourceReplacement })
  | (SourceSyncCas & {
      kind: 'source_deleted'
      removedTeacherEvidenceIds: readonly string[]
      replacement: ClassReviewSourceReplacement | null
    })
  | (SourceSyncCas & { kind: 'task_deleted' })

function fail(code: string): never {
  throw new Error(code)
}
const encoder = new TextEncoder()
const compareCodePoints = (left: string, right: string): number => {
  const leftScalars = [...left]
  const rightScalars = [...right]
  const length = Math.min(leftScalars.length, rightScalars.length)
  for (let index = 0; index < length; index += 1) {
    const difference = leftScalars[index].codePointAt(0)! - rightScalars[index].codePointAt(0)!
    if (difference !== 0) return difference
  }
  return leftScalars.length - rightScalars.length
}
const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
function checkedAdd(left: number, right: number): number {
  const value = left + right
  if (!Number.isSafeInteger(value) || value < 0) fail('class_review_candidate_conflict')
  return value
}

function frozenClone<T>(value: T): T {
  const clone = structuredClone(value)
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) return
    if (Array.isArray(item)) item.forEach(freeze)
    else Object.values(item).forEach(freeze)
    Object.freeze(item)
  }
  freeze(clone)
  return clone
}

type ExpectedEnumerability = boolean | 'either' | Readonly<{
  enumerable: boolean
  writable: boolean
  configurable: boolean
}>

function captureOneOfDataRecords(
  input: unknown,
  expectedShapes: readonly (readonly string[])[],
  enumerability: Readonly<Record<string, ExpectedEnumerability>> = {},
): Record<string, unknown> {
  try {
    if (!input || typeof input !== 'object') throw new Error('invalid')
    const keys = Reflect.ownKeys(input)
    if (keys.some((key) => typeof key !== 'string')) {
      throw new Error('invalid')
    }
    const stringKeys = keys as string[]
    const expectedKeys = expectedShapes.find((shape) =>
      shape.length === stringKeys.length && stringKeys.every((key) => shape.includes(key)),
    )
    if (!expectedKeys) throw new Error('invalid')
    const descriptors = new Map<PropertyKey, PropertyDescriptor>()
    for (const key of keys) {
      const descriptor = Reflect.getOwnPropertyDescriptor(input, key)
      if (!descriptor) throw new Error('invalid')
      descriptors.set(key, descriptor)
    }
    const captured: Record<string, unknown> = {}
    for (const key of expectedKeys) {
      const descriptor = descriptors.get(key)
      const expectedEnumerability = enumerability[key] ?? true
      const expectedEnumerableFlag = typeof expectedEnumerability === 'object'
        ? expectedEnumerability.enumerable
        : expectedEnumerability
      if (!descriptor
        || (expectedEnumerableFlag !== 'either'
          && descriptor.enumerable !== expectedEnumerableFlag)
        || !('value' in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined
        || (typeof expectedEnumerability === 'object'
          && (descriptor.writable !== expectedEnumerability.writable
            || descriptor.configurable !== expectedEnumerability.configurable))) {
        throw new Error('invalid')
      }
      captured[key] = descriptor.value
    }
    return captured
  } catch {
    return fail('class_review_candidate_conflict')
  }
}

function captureExactDataRecord(
  input: unknown,
  expectedKeys: readonly string[],
  enumerability: Readonly<Record<string, ExpectedEnumerability>> = {},
): Record<string, unknown> {
  return captureOneOfDataRecords(input, [expectedKeys], enumerability)
}

const CAPTURE_LIMITS = Object.freeze({
  dimensions: 10,
  scoreBands: 20,
  counters: 32,
  groups: 64,
  records: 512,
  examples: 3,
  dimensionIds: 10,
})

function captureExactArray(input: unknown, maximum: number): unknown[] {
  try {
    if (!Array.isArray(input)) throw new Error('invalid')
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(input, 'length')
    const lengthValue = lengthDescriptor && 'value' in lengthDescriptor
      ? lengthDescriptor.value
      : undefined
    if (!lengthDescriptor || lengthDescriptor.enumerable !== false
      || !Number.isSafeInteger(lengthValue)
      || (lengthValue as number) < 0
      || (lengthValue as number) > maximum) {
      throw new Error('invalid')
    }
    const length = lengthValue as number
    const keys = Reflect.ownKeys(input)
    if (keys.length !== length + 1) throw new Error('invalid')
    const descriptors = new Map<PropertyKey, PropertyDescriptor>()
    for (const key of keys) {
      if (key === 'length') {
        descriptors.set(key, lengthDescriptor)
        continue
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(input, key)
      if (!descriptor) throw new Error('invalid')
      descriptors.set(key, descriptor)
    }
    const captured: unknown[] = []
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors.get(String(index))
      if (!descriptor || descriptor.enumerable !== true
        || !('value' in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) {
        throw new Error('invalid')
      }
      captured.push(descriptor.value)
    }
    if ([...descriptors.keys()].some((key) => key !== 'length'
      && (typeof key !== 'string' || !/^0$|^[1-9]\d*$/.test(key)
        || Number(key) >= length))) {
      throw new Error('invalid')
    }
    return captured
  } catch {
    return fail('class_review_candidate_conflict')
  }
}

function captureExactStringArray(input: unknown, maximum: number = CAPTURE_LIMITS.records): string[] {
  const captured = captureExactArray(input, maximum)
  if (captured.some((value) => typeof value !== 'string' || value.length === 0)) {
    return fail('class_review_candidate_conflict')
  }
  return captured as string[]
}

const mapIteratorNext = Object.getPrototypeOf(new Map().entries()).next as (
  this: MapIterator<unknown>,
) => IteratorResult<unknown>
const mapSizeGetter = Reflect.getOwnPropertyDescriptor(Map.prototype, 'size')?.get
const mapEntries = Map.prototype.entries as (this: Map<unknown, unknown>) => MapIterator<unknown>

function captureExactReadonlyMap(
  input: unknown,
  maximum: number,
): readonly (readonly [unknown, unknown])[] {
  try {
    if (!input || typeof input !== 'object') throw new Error('invalid')
    const trustedSnapshot = snapshotClassReviewProjectionReadonlyMap(input, maximum)
    if (trustedSnapshot !== null) return trustedSnapshot
    if (!Number.isSafeInteger(maximum) || maximum < 0
      || Reflect.ownKeys(input).length !== 0
      || Reflect.getPrototypeOf(input) !== Map.prototype
      || typeof mapSizeGetter !== 'function') throw new Error('invalid')
    const size = Reflect.apply(mapSizeGetter, input, []) as unknown
    if (!Number.isSafeInteger(size) || (size as number) < 0 || (size as number) > maximum) {
      throw new Error('invalid')
    }
    const prototype = Reflect.getPrototypeOf(input)
    let iterator: unknown
    if (prototype === Map.prototype) {
      iterator = Reflect.apply(mapEntries, input, [])
    } else throw new Error('invalid')
    const entries: Array<readonly [unknown, unknown]> = []
    while (true) {
      const step = Reflect.apply(mapIteratorNext, iterator, []) as IteratorResult<unknown>
      if (step.done) break
      if (!Array.isArray(step.value) || step.value.length !== 2) throw new Error('invalid')
      entries.push([step.value[0], step.value[1]])
      if (entries.length > maximum) throw new Error('invalid')
    }
    if (entries.length !== size) throw new Error('invalid')
    return entries
  } catch {
    return fail('class_review_candidate_conflict')
  }
}

function captureProjectionReadonlyMap(
  input: unknown,
  maximum: number,
): readonly (readonly [unknown, unknown])[] {
  try {
    const trustedSnapshot = snapshotClassReviewProjectionReadonlyMap(input, maximum)
    if (trustedSnapshot === null) throw new Error('invalid')
    return trustedSnapshot
  } catch {
    return fail('class_review_candidate_conflict')
  }
}

function captureClassReviewStatistics(input: unknown): ClassReviewStatisticsV1 {
  const value = captureExactDataRecord(input, [
    'totalEssayCount',
    'includedEssayCount',
    'issueEligibleEssayCount',
    'excludedEssayCount',
    'issueCoverageRate',
    'fullScore',
    'scoreSummary',
    'scoreBands',
    'dimensions',
  ])
  const scoreSummary = value.scoreSummary === null
    ? null
    : captureExactDataRecord(value.scoreSummary, ['averageScore', 'highestScore', 'lowestScore'])
  const scoreBands = captureExactArray(value.scoreBands, CAPTURE_LIMITS.scoreBands).map((band) =>
    captureExactDataRecord(band, ['bandId', 'lowerInclusive', 'upperInclusive', 'essayCount']),
  )
  const dimensions = captureExactArray(value.dimensions, CAPTURE_LIMITS.dimensions).map((dimension) =>
    captureExactDataRecord(dimension, [
      'dimensionId',
      'name',
      'averageScore',
      'maxScore',
      'normalizedPerformance',
    ]),
  )
  return {
    totalEssayCount: value.totalEssayCount,
    includedEssayCount: value.includedEssayCount,
    issueEligibleEssayCount: value.issueEligibleEssayCount,
    excludedEssayCount: value.excludedEssayCount,
    issueCoverageRate: value.issueCoverageRate,
    fullScore: value.fullScore,
    scoreSummary,
    scoreBands,
    dimensions,
  } as unknown as ClassReviewStatisticsV1
}

function captureSemanticCoverage(input: unknown): ClassReviewSynthesisRequestV1['semanticCoverage'] {
  return captureExactDataRecord(input, [
    'projectedGroupCount',
    'eligibleGroupCount',
    'groupCoverage',
    'projectedDistinctEssaySupportSum',
    'eligibleDistinctEssaySupportSum',
    'supportWeightedCoverage',
    'projectedOccurrenceSum',
    'eligibleOccurrenceSum',
    'occurrenceWeightedCoverage',
  ]) as unknown as ClassReviewSynthesisRequestV1['semanticCoverage']
}

function semanticCoverageMatches(
  left: ClassReviewSynthesisRequestV1['semanticCoverage'],
  right: ClassReviewSynthesisRequestV1['semanticCoverage'],
): boolean {
  return left.projectedGroupCount === right.projectedGroupCount
    && left.eligibleGroupCount === right.eligibleGroupCount
    && left.groupCoverage === right.groupCoverage
    && left.projectedDistinctEssaySupportSum === right.projectedDistinctEssaySupportSum
    && left.eligibleDistinctEssaySupportSum === right.eligibleDistinctEssaySupportSum
    && left.supportWeightedCoverage === right.supportWeightedCoverage
    && left.projectedOccurrenceSum === right.projectedOccurrenceSum
    && left.eligibleOccurrenceSum === right.eligibleOccurrenceSum
    && left.occurrenceWeightedCoverage === right.occurrenceWeightedCoverage
}

function captureSynthesisStatistics(input: unknown): ClassReviewSynthesisRequestV1['statistics'] {
  const value = captureExactDataRecord(input, [
    'includedEssayCount',
    'issueEligibleEssayCount',
    'totalEssayCount',
    'excludedEssayCount',
    'score',
    'scoreBands',
    'dimensions',
    'issueCounters',
  ])
  const score = captureExactDataRecord(value.score, [
    'fullScore',
    'averageScore',
    'medianScore',
    'lowestScore',
    'highestScore',
  ])
  const scoreBands = captureExactArray(value.scoreBands, CAPTURE_LIMITS.scoreBands).map((band) =>
    captureExactDataRecord(band, ['bandId', 'lowerInclusive', 'upperInclusive', 'essayCount']),
  )
  const dimensions = captureExactArray(value.dimensions, CAPTURE_LIMITS.dimensions).map((dimension) =>
    captureExactDataRecord(dimension, [
      'dimensionId',
      'label',
      'averageScore',
      'medianScore',
      'maxScore',
      'normalizedPerformance',
    ]),
  )
  const issueCounters = captureExactArray(value.issueCounters, CAPTURE_LIMITS.counters).map((counter) =>
    captureExactDataRecord(counter, ['counterId', 'count']),
  )
  return {
    includedEssayCount: value.includedEssayCount,
    issueEligibleEssayCount: value.issueEligibleEssayCount,
    totalEssayCount: value.totalEssayCount,
    excludedEssayCount: value.excludedEssayCount,
    score,
    scoreBands,
    dimensions,
    issueCounters,
  } as unknown as ClassReviewSynthesisRequestV1['statistics']
}

function captureSynthesisGroup(input: unknown): ClassReviewSynthesisRequestV1['groups'][number] {
  const value = captureExactDataRecord(input, [
    'groupId',
    'type',
    'subtype',
    'severity',
    'title',
    'mustCover',
    'distinctEssaySupport',
    'occurrenceCount',
    'excerpt',
  ])
  const excerpt = value.excerpt === null
    ? null
    : captureExactDataRecord(value.excerpt, ['originalText', 'suggestionOrDiagnosis'])
  return { ...value, excerpt } as unknown as ClassReviewSynthesisRequestV1['groups'][number]
}

function captureTopicIdentity(input: unknown): Record<string, unknown> {
  return captureExactDataRecord(input, [
    'kind',
    'keyVersion',
    'taskScope',
    'key',
    'fingerprintDigest',
  ])
}

function captureRedactionResult(input: unknown): Record<string, unknown> {
  const value = captureOneOfDataRecords(input, [
    ['status', 'text', 'redactionVersion', 'scrubbedEvidenceKey'],
    ['status', 'reason', 'redactionVersion'],
  ])
  const validShape = value.status === 'kept'
    ? Object.hasOwn(value, 'text') && Object.hasOwn(value, 'scrubbedEvidenceKey')
    : value.status === 'omitted' && Object.hasOwn(value, 'reason')
  if (!validShape) return fail('class_review_candidate_conflict')
  return value
}

function captureHiddenExcerpt(input: unknown): Record<string, unknown> | null {
  if (input === null) return null
  const value = captureExactDataRecord(input, ['originalText', 'suggestionOrDiagnosis'])
  return {
    originalText: captureRedactionResult(value.originalText),
    suggestionOrDiagnosis: captureRedactionResult(value.suggestionOrDiagnosis),
  }
}

function captureHiddenSelectedGroup(input: unknown): HiddenSelectedGroupV1 {
  const value = captureExactDataRecord(input, [
    'atomicTopic',
    'title',
    'excerpt',
    'essayIds',
    'occurrenceCount',
  ])
  return {
    atomicTopic: captureTopicIdentity(value.atomicTopic),
    title: captureRedactionResult(value.title),
    excerpt: captureHiddenExcerpt(value.excerpt),
    essayIds: captureExactStringArray(value.essayIds),
    occurrenceCount: value.occurrenceCount,
  } as unknown as HiddenSelectedGroupV1
}

function captureFallbackContent(input: unknown): Record<string, unknown> {
  const value = captureOneOfDataRecords(input, [
    ['kind', 'title', 'diagnosis', 'teachingTemplate'],
    ['kind', 'template'],
  ])
  if (value.kind === 'scrubbed') {
    if (!Object.hasOwn(value, 'title') || !Object.hasOwn(value, 'diagnosis')) {
      return fail('class_review_candidate_conflict')
    }
    return {
      kind: value.kind,
      title: captureExactDataRecord(value.title, ['text', 'scrubbedEvidenceKey']),
      diagnosis: captureExactDataRecord(value.diagnosis, ['text', 'scrubbedEvidenceKey']),
      teachingTemplate: value.teachingTemplate,
    }
  }
  if (value.kind !== 'template' || !Object.hasOwn(value, 'template')) {
    return fail('class_review_candidate_conflict')
  }
  return value
}

function captureHiddenFallback(input: unknown): HiddenMustCoverFallbackV1 {
  const value = captureExactDataRecord(input, [
    'atomicTopic',
    'type',
    'subtype',
    'severity',
    'distinctEssaySupport',
    'occurrenceCount',
    'content',
    'anonymousExample',
  ])
  return {
    atomicTopic: captureTopicIdentity(value.atomicTopic),
    type: value.type,
    subtype: value.subtype,
    severity: value.severity,
    distinctEssaySupport: value.distinctEssaySupport,
    occurrenceCount: value.occurrenceCount,
    content: captureFallbackContent(value.content),
    anonymousExample: value.anonymousExample,
  } as unknown as HiddenMustCoverFallbackV1
}

function captureReadyProjection(input: unknown): ReadyProjection {
  const value = captureExactDataRecord(
    input,
    ['status', 'projection', 'hidden'],
    { hidden: { enumerable: false, writable: false, configurable: false } },
  )
  if (value.status !== 'ready') return fail('class_review_candidate_conflict')
  const projection = captureExactDataRecord(value.projection, [
    'statistics',
    'groups',
    'semanticCoverage',
  ])
  const hidden = captureExactDataRecord(value.hidden, [
    'dimensionAliases',
    'selectedGroups',
    'unprojectedMustCover',
  ])
  const dimensionAliases: Array<readonly [string, string]> = []
  for (const [key, alias] of captureProjectionReadonlyMap(
    hidden.dimensionAliases,
    CAPTURE_LIMITS.dimensions,
  )) {
    if (typeof key !== 'string' || typeof alias !== 'string') {
      return fail('class_review_candidate_conflict')
    }
    dimensionAliases.push([key, alias])
  }
  const selectedGroups: Array<readonly [string, ReturnType<typeof captureHiddenSelectedGroup>]> = []
  for (const [key, group] of captureProjectionReadonlyMap(
    hidden.selectedGroups,
    CAPTURE_LIMITS.groups,
  )) {
    if (typeof key !== 'string') return fail('class_review_candidate_conflict')
    selectedGroups.push([key, captureHiddenSelectedGroup(group)])
  }
  const unprojectedMustCover = captureExactArray(hidden.unprojectedMustCover, CAPTURE_LIMITS.records)
    .map(captureHiddenFallback)
  const capturedProjection = {
    status: value.status,
    projection: {
      statistics: captureSynthesisStatistics(projection.statistics),
      groups: captureExactArray(projection.groups, CAPTURE_LIMITS.groups).map(captureSynthesisGroup),
      semanticCoverage: captureSemanticCoverage(projection.semanticCoverage),
    },
  }
  Object.defineProperty(capturedProjection, 'hidden', {
    value: cloneClassReviewProjectionHiddenState({
      dimensionAliases,
      selectedGroups,
      unprojectedMustCover,
    }),
    enumerable: false,
    writable: false,
    configurable: false,
  })
  return capturedProjection as unknown as ReadyProjection
}

function captureEvidenceRef(input: unknown): EvidenceRefV1 {
  return captureExactDataRecord(input, [
    'evidenceId',
    'selectionOrigin',
    'sourceLocator',
    'sourceResultRevision',
    'anonymousExample',
  ]) as unknown as EvidenceRefV1
}

function captureIssueBlock(input: unknown): ClassReviewIssueBlockV1 {
  const value = captureExactDataRecord(input, [
    'blockId',
    'topicKey',
    'origin',
    'title',
    'diagnosis',
    'teachingAction',
    'severity',
    'teacherStudentCount',
    'systemStudentCount',
    'combinedStudentCount',
    'occurrenceCount',
    'supportDenominator',
    'anonymousExamples',
    'evidenceRefs',
  ])
  return {
    ...value,
    anonymousExamples: captureExactStringArray(value.anonymousExamples, CAPTURE_LIMITS.examples),
    evidenceRefs: captureExactArray(value.evidenceRefs, CAPTURE_LIMITS.records).map(captureEvidenceRef),
  } as unknown as ClassReviewIssueBlockV1
}

function captureAiSummary(input: unknown): AiSummaryV1 {
  const value = captureExactDataRecord(input, [
    'overallComment',
    'strengths',
    'learningRecommendations',
  ])
  return {
    overallComment: value.overallComment,
    strengths: captureExactArray(value.strengths, CAPTURE_LIMITS.records).map((strength) => {
      const item = captureExactDataRecord(strength, ['title', 'detail', 'dimensionIds'])
      return { ...item, dimensionIds: captureExactStringArray(item.dimensionIds, CAPTURE_LIMITS.dimensionIds) }
    }),
    learningRecommendations: captureExactArray(value.learningRecommendations, CAPTURE_LIMITS.records).map((recommendation) =>
      captureExactDataRecord(recommendation, ['title', 'action']),
    ),
  } as unknown as AiSummaryV1
}

function captureCurrentGeneration(input: unknown): ClassReviewReportV1['currentGeneration'] {
  if (input === null) return null
  const value = captureOneOfDataRecords(input, [
    ['generationId', 'generationRevision', 'state', 'createdAt'],
    ['generationId', 'generationRevision', 'state', 'safeFailureCode', 'createdAt'],
    [
      'generationId',
      'generationRevision',
      'state',
      'safeUnappliedReason',
      'createdAt',
      'completedAt',
    ],
  ])
  const validShape = (value.state === 'queued' || value.state === 'running')
    ? !Object.hasOwn(value, 'safeFailureCode') && !Object.hasOwn(value, 'safeUnappliedReason')
    : value.state === 'result_unknown'
      ? Object.hasOwn(value, 'safeFailureCode')
      : value.state === 'succeeded_unapplied' && Object.hasOwn(value, 'safeUnappliedReason')
  if (!validShape) return fail('class_review_candidate_conflict')
  return value as unknown as ClassReviewReportV1['currentGeneration']
}

function captureClassReviewReport(input: unknown): ClassReviewReportV1 {
  const commonKeys = [
    'contractVersion',
    'workspaceState',
    'taskRevision',
    'reportRevision',
    'aiTextEditRevision',
    'currentGeneration',
    'statistics',
    'issueBlocks',
    'issueOrder',
    'clearSpellingItems',
    'selectedMaterials',
  ] as const
  const aiKeys = [
    ...commonKeys,
    'appliedGenerationId',
    'generatedAt',
    'snapshotMetadata',
    'aiSummary',
  ] as const
  const value = captureOneOfDataRecords(input, [commonKeys, aiKeys])
  const clearSpellingItems = captureExactArray(value.clearSpellingItems, CAPTURE_LIMITS.records).map((item) =>
    captureExactDataRecord(item, [
      'itemId',
      'topicKey',
      'sourceSubtype',
      'originalWord',
      'correctedWord',
      'studentCount',
      'occurrenceCount',
      'anonymousExample',
    ]),
  )
  const selectedMaterials = captureExactArray(value.selectedMaterials, CAPTURE_LIMITS.records).map((material) =>
    captureExactDataRecord(material, [
      'materialId',
      'type',
      'categoryLabel',
      'severity',
      'needsTeacherReview',
      'originalText',
      'revisedText',
      'diagnosis',
      'teachingSuggestion',
      'sourceLocator',
    ]),
  )
  const common = {
    contractVersion: value.contractVersion,
    workspaceState: value.workspaceState,
    taskRevision: value.taskRevision,
    reportRevision: value.reportRevision,
    aiTextEditRevision: value.aiTextEditRevision,
    currentGeneration: captureCurrentGeneration(value.currentGeneration),
    statistics: captureClassReviewStatistics(value.statistics),
    issueBlocks: captureExactArray(value.issueBlocks, CAPTURE_LIMITS.records).map(captureIssueBlock),
    issueOrder: captureExactStringArray(value.issueOrder, CAPTURE_LIMITS.records),
    clearSpellingItems,
    selectedMaterials,
  }
  if (value.workspaceState === 'ai_available' && Object.hasOwn(value, 'snapshotMetadata')) {
    const metadata = captureExactDataRecord(value.snapshotMetadata, [
      'includedEssayCount',
      'issueEligibleEssayCount',
      'totalEssayCount',
      'semanticCoverage',
    ])
    return {
      ...common,
      appliedGenerationId: value.appliedGenerationId,
      generatedAt: value.generatedAt,
      snapshotMetadata: {
        includedEssayCount: metadata.includedEssayCount,
        issueEligibleEssayCount: metadata.issueEligibleEssayCount,
        totalEssayCount: metadata.totalEssayCount,
        semanticCoverage: captureSemanticCoverage(metadata.semanticCoverage),
      },
      aiSummary: captureAiSummary(value.aiSummary),
    } as unknown as ClassReviewReportV1
  }
  if (Object.hasOwn(value, 'snapshotMetadata')) return fail('class_review_candidate_conflict')
  return common as unknown as ClassReviewReportV1
}

function captureTeacherEvidenceFact(input: unknown): TeacherEvidenceFact {
  const value = captureOneOfDataRecords(input, [
    ['topicKey', 'evidenceId', 'essayIdentity', 'occurrenceCount'],
    ['topicKey', 'evidenceId', 'essayIdentity', 'occurrenceCount', 'evidenceRef'],
  ])
  return {
    topicKey: value.topicKey,
    evidenceId: value.evidenceId,
    essayIdentity: value.essayIdentity,
    occurrenceCount: value.occurrenceCount,
    ...(Object.hasOwn(value, 'evidenceRef')
      ? { evidenceRef: captureEvidenceRef(value.evidenceRef) }
      : {}),
  } as unknown as TeacherEvidenceFact
}

function captureSystemEvidenceFact(input: unknown): SystemEvidenceFact {
  const value = captureOneOfDataRecords(input, [
    ['topicKey', 'essayIdentities', 'occurrenceCount'],
    ['topicKey', 'essayIdentities', 'occurrenceCount', 'identityMode'],
    ['topicKey', 'essayIdentities', 'occurrenceCount', 'systemBlock'],
    ['topicKey', 'essayIdentities', 'occurrenceCount', 'identityMode', 'systemBlock'],
  ])
  return {
    topicKey: value.topicKey,
    essayIdentities: captureExactStringArray(value.essayIdentities, CAPTURE_LIMITS.records),
    occurrenceCount: value.occurrenceCount,
    ...(Object.hasOwn(value, 'identityMode') ? { identityMode: value.identityMode } : {}),
    ...(Object.hasOwn(value, 'systemBlock') ? { systemBlock: captureIssueBlock(value.systemBlock) } : {}),
  } as unknown as SystemEvidenceFact
}

function captureSuppressedSystemVariant(input: unknown): SuppressedSystemVariant {
  const value = captureExactDataRecord(input, [
    'block',
    'generationId',
    'invalidationEpoch',
    'systemEvidenceFact',
  ])
  return {
    block: captureIssueBlock(value.block),
    generationId: value.generationId,
    invalidationEpoch: value.invalidationEpoch,
    systemEvidenceFact: captureSystemEvidenceFact(value.systemEvidenceFact),
  } as unknown as SuppressedSystemVariant
}

function captureRegisterWorkspaceInput(input: unknown): RegisterWorkspaceInput {
  const required = ['taskKey', 'taskRevision', 'rubricRevisionDigest', 'report', 'projection']
  const optional = ['teacherEvidenceFacts', 'systemEvidenceFacts', 'suppressedSystemVariants']
  const shapes: string[][] = []
  for (let mask = 0; mask < 2 ** optional.length; mask += 1) {
    shapes.push([
      ...required,
      ...optional.filter((_, index) => (mask & (1 << index)) !== 0),
    ])
  }
  const value = captureOneOfDataRecords(input, shapes)
  if (typeof value.taskKey !== 'string' || value.taskKey.length === 0
    || !Number.isSafeInteger(value.taskRevision) || (value.taskRevision as number) < 0
    || typeof value.rubricRevisionDigest !== 'string' || value.rubricRevisionDigest.length === 0) {
    return fail('class_review_candidate_conflict')
  }
  const suppressedSystemVariants = new Map<string, SuppressedSystemVariant>()
  if (Object.hasOwn(value, 'suppressedSystemVariants')) {
    for (const [topicKey, variant] of captureExactReadonlyMap(
      value.suppressedSystemVariants,
      CAPTURE_LIMITS.records,
    )) {
      if (typeof topicKey !== 'string' || topicKey.length === 0) {
        return fail('class_review_candidate_conflict')
      }
      suppressedSystemVariants.set(topicKey, captureSuppressedSystemVariant(variant))
    }
  }
  return {
    taskKey: value.taskKey,
    taskRevision: value.taskRevision,
    rubricRevisionDigest: value.rubricRevisionDigest,
    report: captureClassReviewReport(value.report),
    projection: captureReadyProjection(value.projection),
    ...(Object.hasOwn(value, 'teacherEvidenceFacts')
      ? { teacherEvidenceFacts: captureExactArray(value.teacherEvidenceFacts, CAPTURE_LIMITS.records).map(captureTeacherEvidenceFact) }
      : {}),
    ...(Object.hasOwn(value, 'systemEvidenceFacts')
      ? { systemEvidenceFacts: captureExactArray(value.systemEvidenceFacts, CAPTURE_LIMITS.records).map(captureSystemEvidenceFact) }
      : {}),
    ...(Object.hasOwn(value, 'suppressedSystemVariants') ? { suppressedSystemVariants } : {}),
  } as unknown as RegisterWorkspaceInput
}

function captureGenerateCommand(input: unknown): GenerateCommandInput {
  const value = captureExactDataRecord(input, [
    'taskKey',
    'generationId',
    'intent',
    'expectedTaskRevision',
    'expectedReportRevision',
  ])
  const valid = typeof value.taskKey === 'string' && value.taskKey.length > 0
    && typeof value.generationId === 'string' && value.generationId.length > 0
    && (value.intent === 'initial' || value.intent === 'regenerate')
    && Number.isSafeInteger(value.expectedTaskRevision)
    && (value.expectedTaskRevision as number) >= 0
    && (value.expectedReportRevision === null
      || (Number.isSafeInteger(value.expectedReportRevision)
        && (value.expectedReportRevision as number) >= 0))
  if (!valid) return fail('class_review_candidate_conflict')
  return value as unknown as GenerateCommandInput
}

function captureApplyCandidateCommand(input: unknown): ApplyCandidateCommandInput {
  const value = captureExactDataRecord(input, [
    'taskKey',
    'generationId',
    'expectedTaskRevision',
    'expectedReportRevision',
    'expectedGenerationRevision',
    'expectedAiTextEditRevision',
  ])
  if (typeof value.taskKey !== 'string' || value.taskKey.length === 0
    || typeof value.generationId !== 'string' || value.generationId.length === 0
    || ['expectedTaskRevision', 'expectedReportRevision', 'expectedGenerationRevision', 'expectedAiTextEditRevision']
      .some((key) => !Number.isSafeInteger(value[key]) || (value[key] as number) < 0)) {
    return fail('class_review_candidate_conflict')
  }
  return value as unknown as ApplyCandidateCommandInput
}

function captureDiscardCandidateCommand(input: unknown): DiscardCandidateCommandInput {
  const value = captureExactDataRecord(input, [
    'taskKey',
    'generationId',
    'expectedGenerationRevision',
  ])
  if (typeof value.taskKey !== 'string' || value.taskKey.length === 0
    || typeof value.generationId !== 'string' || value.generationId.length === 0
    || !Number.isSafeInteger(value.expectedGenerationRevision)
    || (value.expectedGenerationRevision as number) < 0) {
    return fail('class_review_candidate_conflict')
  }
  return value as unknown as DiscardCandidateCommandInput
}

function captureTeacherIssueCommand(input: unknown): TeacherIssueCommand {
  const value = captureOneOfDataRecords(input, [
    [
      'kind',
      'blockId',
      'topicKey',
      'title',
      'diagnosis',
      'teachingAction',
      'severity',
      'evidence',
    ],
    ['kind', 'evidenceId'],
    ['kind'],
    ['kind', 'blockId', 'toIndex'],
  ])
  if (value.kind === 'add' && Object.hasOwn(value, 'evidence')) {
    return {
      ...value,
      kind: value.kind,
      evidence: captureExactArray(value.evidence, CAPTURE_LIMITS.records).map((source) => {
        const item = captureExactDataRecord(source, ['ref', 'essayIdentity', 'occurrenceCount'])
        return {
          ref: captureEvidenceRef(item.ref),
          essayIdentity: item.essayIdentity,
          occurrenceCount: item.occurrenceCount,
        }
      }),
    } as unknown as TeacherIssueCommand
  }
  if (value.kind === 'remove' && Object.hasOwn(value, 'evidenceId')) {
    return value as unknown as TeacherIssueCommand
  }
  if (value.kind === 'undo' && Object.keys(value).length === 1) {
    return value as unknown as TeacherIssueCommand
  }
  if (value.kind === 'move' && Object.hasOwn(value, 'blockId') && Object.hasOwn(value, 'toIndex')) {
    return value as unknown as TeacherIssueCommand
  }
  return fail('class_review_candidate_conflict')
}

function captureTaskKey(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) {
    return fail('class_review_candidate_conflict')
  }
  return input
}

export function createLocalClassReviewCoordinator(options: {
  synthesisClient: ClassReviewSynthesisClient
  topicKeySecret: Uint8Array
  now: () => string
  createOpaqueId: () => string
}): LocalClassReviewCoordinator {
  const secret = new Uint8Array(options.topicKeySecret)
  const workspaces = new Map<string, Workspace>()
  const registry = createLocalClassReviewRegistry()
  const topicRegistry = createInMemoryTopicKeyRegistry()
  const terminalReportRevisionByGeneration = new Map<string, number | null>()
  const acceptedAliasIdentities = new Map<string, AcceptedAliasIdentity>()
  const acceptedGenerationIdentities = new Map<string, AcceptedAliasIdentity>()
  let mutationCaptureInProgress = false
  const terminalFenceKey = (opaqueTaskScope: string, generationId: string): string =>
    JSON.stringify([opaqueTaskScope, generationId])
  const aliasFenceKey = (opaqueTaskScope: string, proposedGenerationId: string): string =>
    JSON.stringify([opaqueTaskScope, proposedGenerationId])
  const isTerminalAudit = (state: LocalGenerationRecord['state']): boolean =>
    state === 'failed' || state === 'succeeded' || state === 'discarded' || state === 'invalidated'
  const taskInvalidatedSettlement = Object.freeze({
    requestId: null,
    state: 'invalidated',
    generationRevision: 0,
    invalidationFence: 0,
    boundedRequeueCount: 0,
    candidateAvailable: false,
    safeFailureCode: 'class_review_task_invalidated',
  }) as unknown as LocalGenerationRecord

  function assertMutationAllowed(): void {
    if (mutationCaptureInProgress) fail('class_review_candidate_conflict')
  }

  function captureMutationInput<T>(capture: () => T): T {
    assertMutationAllowed()
    mutationCaptureInProgress = true
    try {
      return capture()
    } finally {
      mutationCaptureInProgress = false
    }
  }

  function acceptedIdentity(prepared: PreparedReservation, generationId: string): AcceptedAliasIdentity {
    return Object.freeze({
      generationId,
      commandCore: prepared.commandCore,
      actionableReplayCore: prepared.actionableReplayCore,
      commandIdentity: prepared.commandIdentity,
      actionableIdentity: prepared.actionableIdentity,
      executionIdentity: prepared.executionIdentity,
      snapshotTuple: prepared.snapshotTuple,
      fixedRevisions: prepared.fixedRevisions,
      payloadDigest: prepared.payloadDigest,
    })
  }

  function rememberAcceptedIdentity(
    prepared: PreparedReservation,
    record: LocalGenerationRecord,
  ): void {
    const aliasKey = aliasFenceKey(prepared.opaqueTaskScope, prepared.proposedGenerationId)
    const generationKey = terminalFenceKey(prepared.opaqueTaskScope, record.generationId)
    const accepted = acceptedIdentity(prepared, record.generationId)
    const priorAlias = acceptedAliasIdentities.get(aliasKey)
    if (priorAlias && JSON.stringify(priorAlias) !== JSON.stringify(accepted)) {
      fail('active_generation_conflict')
    }
    const priorGeneration = acceptedGenerationIdentities.get(generationKey)
    if (priorGeneration && (priorGeneration.actionableReplayCore !== accepted.actionableReplayCore
      || priorGeneration.actionableIdentity !== accepted.actionableIdentity
      || priorGeneration.executionIdentity !== accepted.executionIdentity
      || priorGeneration.snapshotTuple !== accepted.snapshotTuple
      || priorGeneration.fixedRevisions !== accepted.fixedRevisions
      || priorGeneration.payloadDigest !== accepted.payloadDigest)) {
      fail('active_generation_conflict')
    }
    acceptedAliasIdentities.set(aliasKey, accepted)
    if (!priorGeneration) acceptedGenerationIdentities.set(generationKey, accepted)
  }

  function clearAcceptedIdentities(opaqueTaskScope: string): void {
    const belongsToScope = (key: string): boolean => {
      try {
        const parsed = JSON.parse(key) as unknown
        return Array.isArray(parsed) && parsed[0] === opaqueTaskScope
      } catch {
        return false
      }
    }
    for (const key of acceptedAliasIdentities.keys()) {
      if (belongsToScope(key)) acceptedAliasIdentities.delete(key)
    }
    for (const key of acceptedGenerationIdentities.keys()) {
      if (belongsToScope(key)) acceptedGenerationIdentities.delete(key)
    }
    for (const key of terminalReportRevisionByGeneration.keys()) {
      if (belongsToScope(key)) terminalReportRevisionByGeneration.delete(key)
    }
  }

  function rememberTerminalReportRevision(
    workspace: Workspace,
    record: LocalGenerationRecord,
  ): LocalGenerationRecord {
    if (isTerminalAudit(record.state) && !workspace.taskDeleted) {
      terminalReportRevisionByGeneration.set(
        terminalFenceKey(record.opaqueTaskScope, record.generationId),
        workspace.report.reportRevision,
      )
    }
    return record
  }

  async function hmac(domain: string, bytes: Uint8Array): Promise<Uint8Array> {
    if (secret.byteLength < 32 || !globalThis.crypto?.subtle) fail('class_review_crypto_unavailable')
    try {
      const key = await crypto.subtle.importKey(
        'raw',
        secret,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      const prefix = encoder.encode(`${domain}\0`)
      const message = new Uint8Array(prefix.byteLength + bytes.byteLength)
      message.set(prefix)
      message.set(bytes, prefix.byteLength)
      return new Uint8Array(await crypto.subtle.sign('HMAC', key, message))
    } catch {
      return fail('class_review_crypto_unavailable')
    }
  }
  const topicHmac: TopicHmac = {
    registry: topicRegistry,
    digest: (domain: TopicHmacDomain, bytes: Uint8Array) => hmac(domain, bytes),
  }

  function getWorkspace(taskKey: string): Workspace {
    const workspace = workspaces.get(taskKey)
    if (!workspace) fail('class_review_not_eligible')
    return workspace
  }

  function readWorkspaceGeneration(
    workspace: Workspace,
    generationId: string | null = workspace.lastGenerationId,
  ): LocalGenerationRecord | null {
    if (!workspace.opaqueTaskScope || !generationId) return null
    return registry.readGeneration({
      opaqueTaskScope: workspace.opaqueTaskScope,
      generationId,
    })
  }

  function cloneReadyProjection(input: ReadyProjection): ReadyProjection {
    const clone = {
      status: 'ready',
      projection: structuredClone(input.projection),
    }
    Object.defineProperty(clone, 'hidden', {
      value: cloneClassReviewProjectionHiddenState(input.hidden),
      enumerable: false,
      writable: false,
      configurable: false,
    })
    return clone as ReadyProjection
  }

  function cloneInternal(workspace: InternalIssueWorkspace): InternalIssueWorkspace {
    return createInternalIssueWorkspace(workspace.visible, {
      issueOrder: workspace.visible.map((block) => block.blockId),
      teacherEvidenceFacts: [...workspace.teacherFacts.values()],
      systemEvidenceFacts: [...workspace.systemFacts.values()],
      suppressed: workspace.suppressed,
    })
  }

  function buildRequest(
    rubricRevisionDigest: string,
    projection: ReadyProjection,
    requestId: string,
  ): ClassReviewSynthesisRequestV1 {
    const candidate: unknown = {
      contractVersion: 'class-review-synthesis-request-v1',
      requestId,
      rubricRevisionDigest,
      policyVersion: 'class-review-policy-v1',
      schemaVersion: 'kimi-class-review-output-v1',
      projectionVersion: 'class-review-projection-v1',
      budgetVersion: 'class-review-prompt-budget-v1',
      ...structuredClone(projection.projection),
      outputLimits: { maxCompletionTokens: 3072, maxVisibleCodePoints: 2200, maxJsonUtf8Bytes: 16384 },
    }
    const parsed = parseClassReviewSynthesisRequest(candidate)
    if (!parsed.ok) fail('class_review_candidate_conflict')
    return parsed.value
  }

  function serializeHidden(snapshot: Readonly<GenerationSnapshot>): string {
    return JSON.stringify({
      dimensionAliases: [...snapshot.hidden.dimensionAliases].sort(([left], [right]) => compareCodePoints(left, right)),
      selectedGroups: [...snapshot.hidden.selectedGroups].sort(([left], [right]) => compareCodePoints(left, right)).map(([alias, group]) => ({
        alias,
        atomicTopic: [
          group.atomicTopic.kind,
          group.atomicTopic.keyVersion,
          group.atomicTopic.taskScope,
          group.atomicTopic.key,
          group.atomicTopic.fingerprintDigest,
        ],
        title: group.title,
        excerpt: group.excerpt,
        essayIds: [...group.essayIds].sort(compareCodePoints),
        occurrenceCount: group.occurrenceCount,
      })),
      unprojectedMustCover: [...snapshot.hidden.unprojectedMustCover].sort(
        (left, right) => compareCodePoints(
          JSON.stringify(left.atomicTopic),
          JSON.stringify(right.atomicTopic),
        ),
      ),
    })
  }

  function checkEligibility(workspace: Workspace, intent: 'initial' | 'regenerate'): void {
    if (workspace.taskDeleted) fail('class_review_task_invalidated')
    if (!workspace.sourceReady || workspace.projection === null) fail('class_review_source_invalidated')
    const initialAllowed = workspace.report.workspaceState === 'none'
      || workspace.report.workspaceState === 'draft'
      || workspace.report.workspaceState === 'ai_removed'
    const regenerateAllowed = workspace.report.workspaceState === 'ai_available'
    if ((intent === 'initial' && !initialAllowed) || (intent === 'regenerate' && !regenerateAllowed) || workspace.report.statistics.includedEssayCount < 2) {
      fail('class_review_not_eligible')
    }
  }

  function buildCommandCore(
    workspace: Workspace,
    command: {
      generationId: string
      intent: 'initial' | 'regenerate'
      expectedTaskRevision: number
      expectedReportRevision: number | null
    },
  ): string {
    return JSON.stringify({
      proposedGenerationId: command.generationId,
      intent: command.intent,
      expectedTaskRevision: command.expectedTaskRevision,
      expectedReportRevision: command.expectedReportRevision,
      taskRevision: workspace.taskRevision,
      rubricRevisionDigest: workspace.rubricRevisionDigest,
      aiTextEditRevision: workspace.report.aiTextEditRevision,
      sourceRevisionEpoch: workspace.sourceRevisionEpoch,
      invalidationEpoch: workspace.invalidationEpoch,
    })
  }

  function buildActionableReplayCore(
    workspace: Workspace,
    command: {
      intent: 'initial' | 'regenerate'
      expectedTaskRevision: number
      expectedReportRevision: number | null
    },
  ): string {
    return JSON.stringify({
      intent: command.intent,
      expectedTaskRevision: command.expectedTaskRevision,
      expectedReportRevision: command.expectedReportRevision,
      taskRevision: workspace.taskRevision,
      rubricRevisionDigest: workspace.rubricRevisionDigest,
      aiTextEditRevision: workspace.report.aiTextEditRevision,
      sourceRevisionEpoch: workspace.sourceRevisionEpoch,
      invalidationEpoch: workspace.invalidationEpoch,
    })
  }

  function acceptedNoneTransitionGeneration(
    workspace: Workspace,
    fence: PreparedReservation['sourceFence'],
    actionableReplayCore: string,
    prepared?: PreparedReservation,
  ): string | null {
    if (fence.workspaceState !== 'none' || fence.reportRevision !== null
      || !workspace.opaqueTaskScope || !workspace.lastGenerationId
      || workspace.report.aiTextEditRevision !== fence.aiTextEditRevision
      || JSON.stringify(workspace.report.statistics) !== JSON.stringify(fence.statisticsIdentity)) {
      return null
    }
    const generationId = workspace.lastGenerationId
    const accepted = acceptedGenerationIdentities.get(terminalFenceKey(
      workspace.opaqueTaskScope,
      generationId,
    ))
    const record = registry.readGeneration({
      opaqueTaskScope: workspace.opaqueTaskScope,
      generationId,
    })
    if (!accepted || !record || accepted.actionableReplayCore !== actionableReplayCore
      || accepted.generationId !== record.generationId) {
      return null
    }
    if (prepared && (accepted.actionableIdentity !== prepared.actionableIdentity
      || accepted.executionIdentity !== prepared.executionIdentity
      || accepted.snapshotTuple !== prepared.snapshotTuple
      || accepted.fixedRevisions !== prepared.fixedRevisions
      || accepted.payloadDigest !== prepared.payloadDigest)) {
      return null
    }
    const isInternalDraft = workspace.report.workspaceState === 'draft'
      && workspace.report.reportRevision === 0
      && (record.state === 'queued' || record.state === 'running'
        || record.state === 'result_unknown' || record.state === 'failed')
    const isAppliedResult = workspace.report.workspaceState === 'ai_available'
      && workspace.report.appliedGenerationId === generationId
      && record.state === 'succeeded'
    if (!isInternalDraft && !isAppliedResult) return null
    if (isTerminalAudit(record.state)) {
      const terminalRevision = terminalReportRevisionByGeneration.get(
        terminalFenceKey(workspace.opaqueTaskScope, generationId),
      )
      if (terminalRevision === undefined || terminalRevision !== workspace.report.reportRevision) {
        return null
      }
    }
    return generationId
  }

  function acceptedOwnerTerminalTransitionGeneration(
    workspace: Workspace,
    fence: PreparedReservation['sourceFence'],
    _actionableReplayCore: string,
    _prepared?: PreparedReservation,
  ): string | null {
    const generationId = fence.ownerGenerationId
    if (!generationId || !workspace.opaqueTaskScope) return null
    const accepted = acceptedGenerationIdentities.get(terminalFenceKey(
      workspace.opaqueTaskScope,
      generationId,
    ))
    const record = registry.readGeneration({
      opaqueTaskScope: workspace.opaqueTaskScope,
      generationId,
    })
    if (!accepted || !record || accepted.generationId !== generationId) {
      return null
    }
    const isAppliedOwner = record.state === 'succeeded'
      && workspace.report.workspaceState === 'ai_available'
      && workspace.report.appliedGenerationId === generationId
    if (!isAppliedOwner) return null
    const terminalRevision = terminalReportRevisionByGeneration.get(
      terminalFenceKey(workspace.opaqueTaskScope, generationId),
    )
    return terminalRevision === workspace.report.reportRevision ? generationId : null
  }

  async function prepareReservation(
    workspace: Workspace,
    command: {
      generationId: string
      intent: 'initial' | 'regenerate'
      expectedTaskRevision: number
      expectedReportRevision: number | null
    },
  ): Promise<PreparedReservation> {
    if (workspace.taskDeleted) fail('class_review_task_invalidated')
    if (!workspace.sourceReady || workspace.projection === null) fail('class_review_source_invalidated')
    const capturedInvalidationEpoch = workspace.invalidationEpoch
    const capturedTaskRevision = workspace.taskRevision
    const capturedRubricRevisionDigest = workspace.rubricRevisionDigest
    const capturedAiTextEditRevision = workspace.report.aiTextEditRevision
    const capturedSourceRevisionEpoch = workspace.sourceRevisionEpoch
    const sourceFence = Object.freeze({
      opaqueTaskScope: workspace.opaqueTaskScope,
      workspaceState: workspace.report.workspaceState,
      taskRevision: workspace.taskRevision,
      rubricRevisionDigest: workspace.rubricRevisionDigest,
      reportRevision: workspace.report.reportRevision,
      aiTextEditRevision: workspace.report.aiTextEditRevision,
      sourceRevisionEpoch: workspace.sourceRevisionEpoch,
      invalidationEpoch: workspace.invalidationEpoch,
      projectionIdentity: workspace.projection,
      statisticsIdentity: workspace.report.statistics,
      ownerGenerationId: workspace.opaqueTaskScope
        ? registry.readActionable(workspace.opaqueTaskScope)?.generationId ?? null
        : null,
    })
    const commandCore = buildCommandCore(workspace, command)
    const actionableReplayCore = buildActionableReplayCore(workspace, command)
    const capturedStatistics = structuredClone(workspace.report.statistics)
    const capturedProjection = cloneReadyProjection(workspace.projection)
    const assertSourceFence = (): void => {
      const acceptedNoneTransition = acceptedNoneTransitionGeneration(
        workspace,
        sourceFence,
        actionableReplayCore,
      ) !== null
      const acceptedOwnerTransition = acceptedOwnerTerminalTransitionGeneration(
        workspace,
        sourceFence,
        actionableReplayCore,
      ) !== null
      const reportMatches = workspace.report.workspaceState === sourceFence.workspaceState
        && workspace.report.reportRevision === sourceFence.reportRevision
        && workspace.report.statistics === sourceFence.statisticsIdentity
      if (workspace.taskDeleted) fail('class_review_task_invalidated')
      if (!workspace.sourceReady || workspace.projection === null
        || workspace.invalidationEpoch !== capturedInvalidationEpoch
        || workspace.taskRevision !== capturedTaskRevision
        || workspace.rubricRevisionDigest !== capturedRubricRevisionDigest
        || workspace.report.aiTextEditRevision !== sourceFence.aiTextEditRevision
        || workspace.sourceRevisionEpoch !== capturedSourceRevisionEpoch
        || workspace.projection !== sourceFence.projectionIdentity
        || (!reportMatches && !acceptedNoneTransition && !acceptedOwnerTransition)) {
        fail('class_review_source_invalidated')
      }
    }
    const guardedHmac = async (domain: string, bytes: Uint8Array): Promise<Uint8Array> => {
      const digest = await hmac(domain, bytes)
      assertSourceFence()
      return digest
    }
    const serviceGenerationId = options.createOpaqueId()
    const requestId = options.createOpaqueId()
    const request = buildRequest(capturedRubricRevisionDigest, capturedProjection, requestId)
    const preliminary = cloneAndFreezeClassReviewGenerationSnapshot({
      originalRequest: request,
      hidden: capturedProjection.hidden,
      generationId: serviceGenerationId,
      invalidationEpoch: capturedInvalidationEpoch,
      executionIdentity: 'pending',
      payloadDigest: 'pending',
      taskRevision: capturedTaskRevision,
      reportRevision: command.expectedReportRevision,
      aiTextEditRevision: capturedAiTextEditRevision,
      sourceRevisionEpoch: capturedSourceRevisionEpoch,
      browserStatistics: capturedStatistics,
    })
    const fixedRevisions = JSON.stringify({
      taskRevision: capturedTaskRevision,
      reportRevision: command.expectedReportRevision,
      aiTextEditRevision: capturedAiTextEditRevision,
      sourceRevisionEpoch: capturedSourceRevisionEpoch,
      rubricRevisionDigest: capturedRubricRevisionDigest,
    })
    const serializedHidden = encoder.encode(serializeHidden(preliminary))
    const snapshotDigest = await guardedHmac('class-review-snapshot-v1', serializedHidden)
    const snapshotTuple = `snapshot_v1_${bytesToHex(snapshotDigest)}`
    const canonicalRequest = structuredClone(request) as Partial<ClassReviewSynthesisRequestV1>
    delete canonicalRequest.requestId
    const payloadBytes = encoder.encode(JSON.stringify({ fixedRevisions, snapshotTuple, request: canonicalRequest }))
    const payloadDigest = bytesToHex(await guardedHmac('class-review-payload-v1', payloadBytes))
    const taskScopeDigest = await guardedHmac(
      'class-review-task-scope-v1',
      encoder.encode(workspace.taskKey),
    )
    const opaqueTaskScope = `scope_v1_${bytesToHex(taskScopeDigest)}`
    const executionDigest = await guardedHmac(
      'class-review-execution-v1',
      encoder.encode(payloadDigest),
    )
    const executionIdentity = `execution_v1_${bytesToHex(executionDigest)}`
    const actionableCoreBytes = encoder.encode(JSON.stringify({
      intent: command.intent,
      expectedTaskRevision: command.expectedTaskRevision,
      expectedReportRevision: command.expectedReportRevision,
      fixedRevisions,
      snapshotTuple,
      payloadDigest,
    }))
    const actionableIdentity = bytesToHex(await guardedHmac(
      'class-review-actionable-command-v1',
      actionableCoreBytes,
    ))
    const commandIdentity = bytesToHex(await guardedHmac(
      'class-review-proposed-command-v1',
      encoder.encode(JSON.stringify({
        proposedGenerationId: command.generationId,
        actionableIdentity,
      })),
    ))
    const snapshot = cloneAndFreezeClassReviewGenerationSnapshot({
      ...preliminary,
      executionIdentity,
      payloadDigest,
    })
    assertSourceFence()
    return {
      proposedGenerationId: command.generationId,
      serviceGenerationId,
      requestId,
      request: snapshot.originalRequest,
      requestBytes: JSON.stringify(snapshot.originalRequest),
      payloadDigest,
      opaqueTaskScope,
      executionIdentity,
      fixedRevisions,
      snapshotTuple,
      commandIdentity,
      actionableIdentity,
      actionableReplayCore,
      commandCore,
      snapshot,
      sourceFence,
    }
  }

  function assertPreparedSourceFence(workspace: Workspace, prepared: PreparedReservation): string | null {
    const fence = prepared.sourceFence
    const scopeMatches = workspace.opaqueTaskScope === fence.opaqueTaskScope
      || (fence.opaqueTaskScope === null && workspace.opaqueTaskScope === prepared.opaqueTaskScope)
    const acceptedNoneTransition = acceptedNoneTransitionGeneration(
      workspace,
      fence,
      prepared.actionableReplayCore,
      prepared,
    )
    const acceptedOwnerTransition = acceptedOwnerTerminalTransitionGeneration(
      workspace,
      fence,
      prepared.actionableReplayCore,
      prepared,
    )
    const reportMatches = workspace.report.workspaceState === fence.workspaceState
      && workspace.report.reportRevision === fence.reportRevision
      && workspace.report.statistics === fence.statisticsIdentity
    if (workspace.taskDeleted) fail('class_review_task_invalidated')
    if (!workspace.sourceReady || workspace.projection === null
      || !scopeMatches
      || workspace.taskRevision !== fence.taskRevision
      || workspace.rubricRevisionDigest !== fence.rubricRevisionDigest
      || workspace.report.aiTextEditRevision !== fence.aiTextEditRevision
      || workspace.sourceRevisionEpoch !== fence.sourceRevisionEpoch
      || workspace.invalidationEpoch !== fence.invalidationEpoch
      || workspace.projection !== fence.projectionIdentity
      || (!reportMatches && acceptedNoneTransition === null && acceptedOwnerTransition === null)) {
      fail('class_review_source_invalidated')
    }
    return acceptedNoneTransition ?? acceptedOwnerTransition
  }

  function asDraft(report: ClassReviewReportV1): ClassReviewReportV1 {
    if (report.workspaceState !== 'none') return report
    return { ...report, workspaceState: 'draft', reportRevision: 0 }
  }

  function safeFailure(error: unknown): SafeFailureCode {
    return error instanceof Error && error.message === 'provider_invalid_response' ? 'provider_invalid_response' : 'class_review_candidate_conflict'
  }

  async function waitForRetryDelay(workspace: Workspace, milliseconds: number): Promise<boolean> {
    let active = true
    let cancel!: () => void
    const elapsed = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (!active) return
        active = false
        resolve(true)
      }, milliseconds)
      cancel = () => {
        if (!active) return
        active = false
        clearTimeout(timer)
        resolve(false)
      }
      workspace.cancelRetry = cancel
    })
    if (workspace.cancelRetry === cancel) workspace.cancelRetry = null
    return elapsed
  }

  function scrubExecutionLease(execution: ExecutionLease | null): void {
    if (!execution) return
    execution.request = null
    execution.snapshot = null
  }

  async function dispatch(workspace: Workspace, execution: ExecutionLease): Promise<LocalGenerationRecord> {
    const scopedGeneration = {
      opaqueTaskScope: execution.opaqueTaskScope,
      generationId: execution.generationId,
    }
    let record = registry.readGeneration(scopedGeneration)
    if (!record) fail('generation_not_found')
    if (record.state === 'queued') {
      record = registry.markRunning({
        opaqueTaskScope: execution.opaqueTaskScope,
        generationId: record.generationId,
        expectedRevision: record.generationRevision,
      })
    }
    if (record.state !== 'running') return record
    const runningRevision = record.generationRevision
    const fence = record.invalidationFence
    if (execution.request === null) return record
    let untrusted: unknown
    try {
      untrusted = await options.synthesisClient.synthesize(execution.request)
    } catch {
      if (workspace.taskDeleted) return taskInvalidatedSettlement
      const current = registry.readGeneration(scopedGeneration)
      if (current?.state === 'running' && current.invalidationFence === fence) {
        return registry.markResultUnknown({
          opaqueTaskScope: execution.opaqueTaskScope,
          generationId: current.generationId,
          expectedRevision: current.generationRevision,
          safeFailureCode: 'provider_result_unknown',
        })
      }
      return current ?? record
    }
    if (workspace.taskDeleted || workspace.activeExecution === execution) {
      workspace.providerSettlementKnown = true
    }
    const current = registry.readGeneration(scopedGeneration)
    if (workspace.taskDeleted) return taskInvalidatedSettlement
    if (
      !current
      || current.state === 'invalidated'
      || current.generationRevision !== runningRevision
      || current.invalidationFence !== fence
    ) {
      return current ?? record
    }
    const request = execution.request
    if (request === null) return current
    let parsed: ReturnType<typeof parseClassReviewSynthesisResult>
    try {
      parsed = parseClassReviewSynthesisResult(untrusted, request)
    } catch {
      if (workspace.taskDeleted) return taskInvalidatedSettlement
      const latest = registry.readGeneration(scopedGeneration)
      if (!latest || latest.state !== 'running' || latest.invalidationFence !== fence) {
        return latest ?? record
      }
      return rememberTerminalReportRevision(workspace, registry.markFailed({
        opaqueTaskScope: execution.opaqueTaskScope,
        generationId: latest.generationId,
        expectedRevision: latest.generationRevision,
        expectedState: 'running',
        safeFailureCode: 'provider_invalid_response',
      }))
    }
    if (!parsed.ok) {
      return rememberTerminalReportRevision(workspace, registry.markFailed({
        opaqueTaskScope: execution.opaqueTaskScope,
        generationId: current.generationId,
        expectedRevision: current.generationRevision,
        expectedState: 'running',
        safeFailureCode: 'provider_invalid_response',
      }))
    }
    const result = parsed.value
    if (result.status === 'result_unknown') {
      return registry.markResultUnknown({
        opaqueTaskScope: execution.opaqueTaskScope,
        generationId: current.generationId,
        expectedRevision: current.generationRevision,
        safeFailureCode: 'provider_result_unknown',
      })
    }
    if (result.status === 'failed') {
      const bounded429 = result.safeFailureCode === 'provider_rate_limited'
        && result.retryable
        && result.completionDisposition === 'confirmed_zero_completion'
        && result.retryAfterMs !== null
        && result.retryAfterMs <= 60_000
        && current.boundedRequeueCount < 1
      if (bounded429) {
        const queued = registry.requeueConfirmedZero({
          opaqueTaskScope: execution.opaqueTaskScope,
          generationId: current.generationId,
          expectedRevision: current.generationRevision,
          executionIdentity: current.executionIdentity,
          payloadHash: current.payloadDigest,
          localCallSettled: true,
        })
        const elapsed = await waitForRetryDelay(workspace, result.retryAfterMs!)
        if (!elapsed) {
          if (workspace.taskDeleted) return taskInvalidatedSettlement
          return registry.readGeneration(scopedGeneration) ?? queued
        }
        const afterDelay = registry.readGeneration(scopedGeneration)
        return afterDelay?.state === 'queued' ? dispatch(workspace, execution) : afterDelay ?? queued
      }
      return rememberTerminalReportRevision(workspace, registry.markFailed({
        opaqueTaskScope: execution.opaqueTaskScope,
        generationId: current.generationId,
        expectedRevision: current.generationRevision,
        expectedState: 'running',
        safeFailureCode: result.safeFailureCode,
      }))
    }
    try {
      const snapshot = execution.snapshot
      if (snapshot === null) return current
      const executionIsActive = (): boolean => {
        if (workspace.taskDeleted || !workspace.sourceReady
          || workspace.invalidationEpoch !== snapshot.invalidationEpoch) return false
        const latest = registry.readGeneration(scopedGeneration)
        return latest?.state === 'running' && latest.invalidationFence === fence
      }
      const materialized = await materializeClassReviewCandidate({
        snapshot,
        untrustedResult: result,
        currentReport: workspace.report,
        currentIssueWorkspace: workspace.issueWorkspace,
        getCurrentWorkspace: () => ({
          currentReport: workspace.report,
          currentIssueWorkspace: workspace.issueWorkspace,
        }),
        topicHmac: { ...topicHmac, isActive: executionIsActive },
        createOpaqueId: () => {
          if (!executionIsActive()) fail('class_review_candidate_conflict')
          return options.createOpaqueId()
        },
        now: () => {
          if (!executionIsActive()) fail('class_review_candidate_conflict')
          return options.now()
        },
      })
      const latest = registry.readGeneration(scopedGeneration)
      if (!latest || latest.state !== 'running'
        || latest.invalidationFence !== fence
        || workspace.invalidationEpoch !== snapshot.invalidationEpoch
        || workspace.taskDeleted || !workspace.sourceReady) return latest ?? current
      const unapplied = workspace.report.aiTextEditRevision !== execution.startAiTextEditRevision
      const preview = applyMaterializedClassReviewCandidate({
        handle: materialized,
        currentReport: workspace.report,
        currentIssueWorkspace: workspace.issueWorkspace,
      })
      const merged = unapplied ? null : preview
      const committed = registry.commitSucceeded({
        opaqueTaskScope: execution.opaqueTaskScope,
        generationId: latest.generationId,
        expectedRevision: latest.generationRevision,
        expectedFence: fence,
        candidate: unapplied ? materialized : null,
        unapplied,
      })
      if (!committed) return registry.readGeneration(scopedGeneration) ?? latest
      if (merged) {
        workspace.report = merged.report
        workspace.issueWorkspace = merged.issueWorkspace
        workspace.undoIssueWorkspace = null
      }
      return rememberTerminalReportRevision(workspace, committed)
    } catch (error) {
      if (workspace.taskDeleted) return taskInvalidatedSettlement
      const latest = registry.readGeneration(scopedGeneration)
      if (!latest || latest.state !== 'running') return latest ?? current
      return rememberTerminalReportRevision(workspace, registry.markFailed({
        opaqueTaskScope: execution.opaqueTaskScope,
        generationId: latest.generationId,
        expectedRevision: latest.generationRevision,
        expectedState: 'running',
        safeFailureCode: safeFailure(error),
      }))
    }
  }

  function generate(input: GenerateCommandInput): Promise<LocalGenerationRecord> {
    let command: GenerateCommandInput
    try {
      command = captureMutationInput(() => captureGenerateCommand(input))
    } catch (error) {
      return Promise.reject(error)
    }
    const workspace = getWorkspace(command.taskKey)
    if (workspace.taskDeleted) return Promise.reject(new Error('class_review_task_invalidated'))
    if (!workspace.sourceReady || workspace.projection === null) {
      return Promise.reject(new Error('class_review_source_invalidated'))
    }
    const knownProposed = workspace.opaqueTaskScope
      ? registry.readProposed({
          opaqueTaskScope: workspace.opaqueTaskScope,
          proposedGenerationId: command.generationId,
        })
      : null
    const knownActionable = workspace.opaqueTaskScope
      ? registry.readActionable(workspace.opaqueTaskScope)
      : null
    if (!knownProposed && !knownActionable) {
      const revisionsMatch = command.expectedTaskRevision === workspace.taskRevision
        && command.expectedReportRevision === workspace.report.reportRevision
      if (!revisionsMatch) return Promise.reject(new Error('active_generation_conflict'))
      try {
        checkEligibility(workspace, command.intent)
      } catch (error) {
        return Promise.reject(error)
      }
    }
    let resolveGenerate!: (record: LocalGenerationRecord) => void
    let rejectGenerate!: (error: unknown) => void
    const generationPromise = new Promise<LocalGenerationRecord>((resolve, reject) => {
      resolveGenerate = resolve
      rejectGenerate = reject
    })
    const ownerStarted = Symbol('owner-started')
    void (async (): Promise<LocalGenerationRecord | typeof ownerStarted> => {
      const prepared = await prepareReservation(workspace, command)
      const proposed = registry.readProposed({
        opaqueTaskScope: prepared.opaqueTaskScope,
        proposedGenerationId: command.generationId,
      })
      const actionable = registry.readActionable(prepared.opaqueTaskScope)
      const fencedTransitionGeneration = assertPreparedSourceFence(workspace, prepared)
      if (proposed && isTerminalAudit(proposed.state)) {
        const terminalRevision = terminalReportRevisionByGeneration.get(
          terminalFenceKey(prepared.opaqueTaskScope, proposed.generationId),
        )
        if (terminalRevision === undefined || terminalRevision !== workspace.report.reportRevision) {
          fail('active_generation_conflict')
        }
      }
      if (!proposed && !actionable && fencedTransitionGeneration === null) {
        const revisionsMatch = command.expectedTaskRevision === workspace.taskRevision
          && command.expectedReportRevision === workspace.report.reportRevision
        if (!revisionsMatch) fail('active_generation_conflict')
        checkEligibility(workspace, command.intent)
      }
      const attachmentGenerationId = knownActionable?.generationId ?? fencedTransitionGeneration ?? null
      const reservation = registry.reserveOrAttach({
        opaqueTaskScope: prepared.opaqueTaskScope,
        proposedGenerationId: prepared.proposedGenerationId,
        serviceGenerationId: prepared.serviceGenerationId,
        requestId: prepared.requestId,
        executionIdentity: prepared.executionIdentity,
        requestBytes: prepared.requestBytes,
        snapshotTuple: prepared.snapshotTuple,
        fixedRevisions: prepared.fixedRevisions,
        payloadDigest: prepared.payloadDigest,
        commandIdentity: prepared.commandIdentity,
        actionableIdentity: prepared.actionableIdentity,
        commandCore: prepared.commandCore,
        state: 'queued',
        generationRevision: 0,
        ...(attachmentGenerationId === null ? {} : { attachmentGenerationId }),
      })
      rememberAcceptedIdentity(prepared, reservation.record)
      if (reservation.kind === 'attached') {
        const owner = workspace.inFlight
        const ownsAttachedRun = owner !== null
          && owner.opaqueTaskScope === prepared.opaqueTaskScope
          && owner.generationId === reservation.record.generationId
        return ownsAttachedRun ? owner.promise : reservation.record
      }
      workspace.opaqueTaskScope = prepared.opaqueTaskScope
      workspace.lastGenerationId = reservation.record.generationId
      workspace.report = asDraft(workspace.report)
      const execution: ExecutionLease = {
        opaqueTaskScope: prepared.opaqueTaskScope,
        generationId: reservation.record.generationId,
        request: prepared.request,
        snapshot: prepared.snapshot,
        startAiTextEditRevision: workspace.report.aiTextEditRevision,
      }
      workspace.activeExecution = execution
      workspace.providerSettlementKnown = false
      const owner: InFlightOwner = {
        opaqueTaskScope: prepared.opaqueTaskScope,
        generationId: reservation.record.generationId,
        promise: generationPromise,
        resolve: resolveGenerate,
      }
      void generationPromise.then(() => {
        if (workspace.inFlight === owner) workspace.inFlight = null
        if (workspace.activeExecution === execution) workspace.activeExecution = null
        scrubExecutionLease(execution)
      }, () => {
        if (workspace.inFlight === owner) workspace.inFlight = null
        if (workspace.activeExecution === execution) workspace.activeExecution = null
        scrubExecutionLease(execution)
      })
      workspace.inFlight = owner
      void dispatch(workspace, execution).then(resolveGenerate, rejectGenerate)
      return ownerStarted
    })().then((result) => {
      if (result !== ownerStarted) resolveGenerate(result)
    }, rejectGenerate)
    return generationPromise
  }

  function activeLocksAiText(workspace: Workspace): boolean {
    const record = readWorkspaceGeneration(workspace)
    return record !== null && (record.state === 'queued' || record.state === 'running' || record.state === 'result_unknown')
  }

  function syncReportIssues(workspace: Workspace): void {
    const issueBlocks = projectInternalIssueWorkspace(workspace.issueWorkspace)
    if (workspace.report.workspaceState === 'none') return
    const parsed = parseClassReviewReport({
      ...workspace.report,
      reportRevision: workspace.report.reportRevision + 1,
      issueBlocks,
      issueOrder: issueBlocks.map((block) => block.blockId),
    })
    if (!parsed.ok) fail('class_review_candidate_conflict')
    workspace.report = parsed.value
  }

  function addTeacherIssue(workspace: Workspace, command: Extract<TeacherIssueCommand, { kind: 'add' }>): void {
    if (
      !command.blockId
      || !command.topicKey
      || !command.title
      || !command.diagnosis
      || !command.teachingAction
      || command.evidence.length === 0
    ) {
      fail('class_review_candidate_conflict')
    }
    const evidenceIds = new Set<string>()
    const facts: TeacherEvidenceFact[] = command.evidence.map((item) => {
      const invalidEvidence = item.ref.selectionOrigin !== 'teacher_selected'
        || evidenceIds.has(item.ref.evidenceId)
        || workspace.issueWorkspace.teacherFacts.has(item.ref.evidenceId)
        || !item.essayIdentity
        || !Number.isSafeInteger(item.occurrenceCount)
        || item.occurrenceCount <= 0
      if (invalidEvidence) fail('class_review_candidate_conflict')
      evidenceIds.add(item.ref.evidenceId)
      return {
        topicKey: command.topicKey,
        evidenceId: item.ref.evidenceId,
        essayIdentity: item.essayIdentity,
        occurrenceCount: item.occurrenceCount,
        evidenceRef: structuredClone(item.ref),
      }
    })
    const allTeacherFacts = [
      ...workspace.issueWorkspace.teacherFacts.values(),
      ...facts,
    ]
    const existing = workspace.issueWorkspace.visible.find((block) => block.topicKey === command.topicKey)
    const topicFacts = allTeacherFacts
      .filter((fact) => fact.topicKey === command.topicKey)
    const teacherEssays = new Set(topicFacts.map((fact) => fact.essayIdentity))
    const teacherRefs = topicFacts
      .flatMap((fact) => fact.evidenceRef ? [structuredClone(fact.evidenceRef)] : [])
      .sort((left, right) => compareCodePoints(left.evidenceId, right.evidenceId))
    const teacherExamples = [...new Set(teacherRefs.flatMap((ref) =>
      ref.anonymousExample === null ? [] : [ref.anonymousExample]))]
      .sort(compareCodePoints)
      .slice(0, 3)
    const systemFact = workspace.issueWorkspace.systemFacts.get(command.topicKey)
    const suppressed = workspace.issueWorkspace.suppressed.get(command.topicKey)
    const systemBlock = existing?.origin === 'ai' ? existing : suppressed?.block
    const systemIdentities = new Set(systemFact?.essayIdentities ?? [])
    if (systemFact && systemIdentities.size === 0) fail('class_review_candidate_conflict')
    let teacherOnlyOccurrences = 0
    for (const fact of topicFacts) {
      if (!systemIdentities.has(fact.essayIdentity)) {
        teacherOnlyOccurrences = checkedAdd(teacherOnlyOccurrences, fact.occurrenceCount)
      }
    }
    const systemOccurrences = systemFact?.occurrenceCount ?? 0
    const occurrenceCount = checkedAdd(systemOccurrences, teacherOnlyOccurrences)
    const systemRefs = systemBlock?.evidenceRefs.filter(
      (ref) => ref.selectionOrigin === 'system_generation',
    ) ?? []
    const teacherBlock: ClassReviewIssueBlockV1 = {
      blockId: existing?.blockId ?? command.blockId,
      topicKey: command.topicKey,
      origin: 'teacher',
      title: command.title,
      diagnosis: command.diagnosis,
      teachingAction: command.teachingAction,
      severity: command.severity,
      teacherStudentCount: teacherEssays.size,
      systemStudentCount: systemIdentities.size,
      combinedStudentCount: new Set([...teacherEssays, ...systemIdentities]).size,
      occurrenceCount,
      supportDenominator: systemBlock?.supportDenominator ?? null,
      anonymousExamples: [...new Set([
        ...teacherExamples,
        ...(systemBlock?.anonymousExamples ?? []),
      ])].sort(compareCodePoints).slice(0, 3),
      evidenceRefs: [...teacherRefs, ...systemRefs],
    }
    const visible = existing
      ? workspace.issueWorkspace.visible.map((block) =>
        block.blockId === existing.blockId ? teacherBlock : block,
      )
      : [...workspace.issueWorkspace.visible, teacherBlock]
    const suppressedVariants = new Map(workspace.issueWorkspace.suppressed)
    if (existing?.origin === 'ai') {
      const appliedGenerationId = workspace.report.workspaceState === 'ai_available'
        ? workspace.report.appliedGenerationId
        : null
      const generation = appliedGenerationId
        ? readWorkspaceGeneration(workspace, appliedGenerationId)
        : null
      if (!appliedGenerationId || !systemFact) fail('class_review_candidate_conflict')
      suppressedVariants.set(existing.topicKey, {
        block: structuredClone(existing),
        generationId: appliedGenerationId,
        invalidationEpoch: generation?.invalidationFence ?? workspace.invalidationEpoch,
        systemEvidenceFact: structuredClone(systemFact),
      })
    }
    workspace.issueWorkspace = createInternalIssueWorkspace(visible, {
      issueOrder: visible.map((block) => block.blockId),
      teacherEvidenceFacts: allTeacherFacts,
      systemEvidenceFacts: [...workspace.issueWorkspace.systemFacts.values()],
      suppressed: suppressedVariants,
    })
  }

  function validateSourceReplacement(input: ClassReviewSourceReplacement): {
    taskRevision: number
    rubricRevisionDigest: string
    statistics: ClassReviewStatisticsV1
    projection: ReadyProjection
  } {
    const captured = captureExactDataRecord(input, [
      'taskRevision',
      'rubricRevisionDigest',
      'statistics',
      'projection',
    ])
    const statistics = captureClassReviewStatistics(captured.statistics)
    const projection = cloneReadyProjection(captureReadyProjection(captured.projection))
    const request = buildRequest(
      captured.rubricRevisionDigest as string,
      projection,
      'source-sync-validation',
    )
    cloneAndFreezeClassReviewGenerationSnapshot({
      originalRequest: request,
      hidden: projection.hidden,
      generationId: 'source-sync-validation',
      invalidationEpoch: 0,
      executionIdentity: 'source-sync-validation',
      payloadDigest: 'source-sync-validation',
      taskRevision: captured.taskRevision as number,
      reportRevision: null,
      aiTextEditRevision: 0,
      sourceRevisionEpoch: 0,
      browserStatistics: statistics,
    })
    return {
      taskRevision: captured.taskRevision as number,
      rubricRevisionDigest: captured.rubricRevisionDigest as string,
      statistics,
      projection,
    }
  }

  function captureSourceSyncCommand(input: unknown): SourceSyncCommand {
    const captured = captureOneOfDataRecords(input, [
      [
        'kind',
        'taskKey',
        'expectedTaskRevision',
        'expectedReportRevision',
        'expectedSourceRevisionEpoch',
        'replacement',
      ],
      [
        'kind',
        'taskKey',
        'expectedTaskRevision',
        'expectedReportRevision',
        'expectedSourceRevisionEpoch',
        'removedTeacherEvidenceIds',
        'replacement',
      ],
      [
        'kind',
        'taskKey',
        'expectedTaskRevision',
        'expectedReportRevision',
        'expectedSourceRevisionEpoch',
      ],
    ])
    const validCas = typeof captured.taskKey === 'string' && captured.taskKey.length > 0
      && Number.isSafeInteger(captured.expectedTaskRevision)
      && (captured.expectedTaskRevision as number) >= 0
      && (captured.expectedReportRevision === null
        || (Number.isSafeInteger(captured.expectedReportRevision)
          && (captured.expectedReportRevision as number) >= 0))
      && Number.isSafeInteger(captured.expectedSourceRevisionEpoch)
      && (captured.expectedSourceRevisionEpoch as number) >= 0
    if (!validCas) return fail('class_review_candidate_conflict')
    const cas = {
      taskKey: captured.taskKey,
      expectedTaskRevision: captured.expectedTaskRevision,
      expectedReportRevision: captured.expectedReportRevision,
      expectedSourceRevisionEpoch: captured.expectedSourceRevisionEpoch,
    } as SourceSyncCas
    if (captured.kind === 'ordinary_revision'
      && Object.hasOwn(captured, 'replacement')
      && !Object.hasOwn(captured, 'removedTeacherEvidenceIds')) {
      return {
        ...cas,
        kind: captured.kind,
        replacement: validateSourceReplacement(captured.replacement as ClassReviewSourceReplacement),
      }
    }
    if (captured.kind === 'source_deleted'
      && Object.hasOwn(captured, 'removedTeacherEvidenceIds')
      && Object.hasOwn(captured, 'replacement')) {
      return {
        ...cas,
        kind: captured.kind,
        removedTeacherEvidenceIds: captureExactStringArray(captured.removedTeacherEvidenceIds),
        replacement: captured.replacement === null
          ? null
          : validateSourceReplacement(captured.replacement as ClassReviewSourceReplacement),
      }
    }
    if (captured.kind === 'task_deleted'
      && !Object.hasOwn(captured, 'removedTeacherEvidenceIds')
      && !Object.hasOwn(captured, 'replacement')) {
      return { ...cas, kind: captured.kind }
    }
    return fail('class_review_candidate_conflict')
  }

  function assertSourceSyncCas(workspace: Workspace, command: SourceSyncCas): void {
    if (workspace.taskDeleted) fail('class_review_task_invalidated')
    if (workspace.taskRevision !== command.expectedTaskRevision
      || workspace.report.reportRevision !== command.expectedReportRevision
      || workspace.sourceRevisionEpoch !== command.expectedSourceRevisionEpoch) {
      fail('active_generation_conflict')
    }
  }

  function parsedReport(value: unknown): ClassReviewReportV1 {
    const parsed = parseClassReviewReport(value)
    if (!parsed.ok) fail('class_review_candidate_conflict')
    return parsed.value
  }

  function syncSources(command: SourceSyncCommand): void {
    const capturedCommand = captureMutationInput(() => captureSourceSyncCommand(command))
    const workspace = getWorkspace(capturedCommand.taskKey)
    assertSourceSyncCas(workspace, capturedCommand)

    if (capturedCommand.kind === 'ordinary_revision') {
      const validatedReplacement = capturedCommand.replacement
      const nextSourceRevisionEpoch = checkedAdd(workspace.sourceRevisionEpoch, 1)
      const report = parsedReport({
        ...workspace.report,
        taskRevision: validatedReplacement.taskRevision,
        statistics: validatedReplacement.statistics,
      })
      workspace.taskRevision = validatedReplacement.taskRevision
      workspace.rubricRevisionDigest = validatedReplacement.rubricRevisionDigest
      workspace.report = report
      workspace.projection = validatedReplacement.projection
      workspace.sourceReady = true
      workspace.sourceRevisionEpoch = nextSourceRevisionEpoch
      workspace.undoIssueWorkspace = null
      return
    }

    if (capturedCommand.kind === 'task_deleted') {
      const nextInvalidationEpoch = checkedAdd(workspace.invalidationEpoch, 1)
      const nextSourceRevisionEpoch = checkedAdd(workspace.sourceRevisionEpoch, 1)
      const tombstoneStatistics: ClassReviewStatisticsV1 = {
        totalEssayCount: 0,
        includedEssayCount: 0,
        issueEligibleEssayCount: 0,
        excludedEssayCount: 0,
        issueCoverageRate: 1,
        fullScore: 1,
        scoreSummary: null,
        scoreBands: [],
        dimensions: [],
      }
      const tombstone = parsedReport({
        contractVersion: 'class-review-report-v1',
        workspaceState: 'none',
        taskRevision: workspace.taskRevision,
        reportRevision: null,
        aiTextEditRevision: 0,
        currentGeneration: null,
        statistics: tombstoneStatistics,
        issueBlocks: [],
        issueOrder: [],
        clearSpellingItems: [],
        selectedMaterials: [],
      })
      const emptyIssues = createInternalIssueWorkspace([])
      const settleOwner = workspace.inFlight?.resolve ?? null
      workspace.cancelRetry?.()
      workspace.cancelRetry = null
      if (workspace.opaqueTaskScope) {
        registry.purgeTaskScope({ opaqueTaskScope: workspace.opaqueTaskScope })
        clearAcceptedIdentities(workspace.opaqueTaskScope)
      }
      workspace.invalidationEpoch = nextInvalidationEpoch
      workspace.sourceRevisionEpoch = nextSourceRevisionEpoch
      scrubExecutionLease(workspace.activeExecution)
      workspace.activeExecution = null
      workspace.inFlight = null
      workspace.taskDeleted = true
      workspace.sourceReady = false
      workspace.projection = null
      workspace.report = tombstone
      workspace.issueWorkspace = emptyIssues
      workspace.undoIssueWorkspace = null
      workspace.lastGenerationId = null
      workspace.opaqueTaskScope = null
      settleOwner?.(taskInvalidatedSettlement)
      return
    }

    const removedTeacherEvidenceIds = capturedCommand.removedTeacherEvidenceIds
    const validatedReplacement = capturedCommand.replacement
    const removed = new Set(removedTeacherEvidenceIds)
    if (removed.size !== removedTeacherEvidenceIds.length
      || removedTeacherEvidenceIds.some((id) => !workspace.issueWorkspace.teacherFacts.has(id))) {
      fail('class_review_candidate_conflict')
    }
    const nextInvalidationEpoch = checkedAdd(workspace.invalidationEpoch, 1)
    const nextReportRevision = workspace.report.reportRevision === null
      ? 0
      : checkedAdd(workspace.report.reportRevision, 1)
    const nextSourceRevisionEpoch = checkedAdd(workspace.sourceRevisionEpoch, 1)
    const issueWorkspace = invalidateInternalSystemVariants(
      workspace.issueWorkspace,
      nextInvalidationEpoch,
      removedTeacherEvidenceIds,
    )
    const issueBlocks = projectInternalIssueWorkspace(issueWorkspace)
    const issueOrder = issueBlocks.map((block) => block.blockId)
    const wasAiWorkspace = workspace.report.workspaceState === 'ai_available'
      || workspace.report.workspaceState === 'ai_removed'
    const unavailableReport = parsedReport({
      contractVersion: 'class-review-report-v1',
      workspaceState: wasAiWorkspace ? 'ai_removed' : 'draft',
      taskRevision: validatedReplacement?.taskRevision ?? workspace.taskRevision,
      reportRevision: nextReportRevision,
      aiTextEditRevision: workspace.report.aiTextEditRevision,
      currentGeneration: null,
      statistics: validatedReplacement?.statistics ?? workspace.report.statistics,
      issueBlocks,
      issueOrder,
      clearSpellingItems: [],
      selectedMaterials: workspace.report.selectedMaterials,
    })
    const settleOwner = workspace.inFlight?.resolve ?? null
    workspace.cancelRetry?.()
    workspace.cancelRetry = null
    let invalidatedRecord: LocalGenerationRecord | null = null
    if (workspace.opaqueTaskScope) {
      invalidatedRecord = registry.invalidateTaskScope({
        opaqueTaskScope: workspace.opaqueTaskScope,
        safeFailureCode: 'class_review_source_invalidated',
      })
    }
    workspace.invalidationEpoch = nextInvalidationEpoch
    workspace.sourceRevisionEpoch = nextSourceRevisionEpoch
    scrubExecutionLease(workspace.activeExecution)
    workspace.activeExecution = null
    workspace.inFlight = null
    workspace.providerSettlementKnown = false
    workspace.issueWorkspace = issueWorkspace
    workspace.undoIssueWorkspace = null
    workspace.report = unavailableReport
    workspace.taskRevision = validatedReplacement?.taskRevision ?? workspace.taskRevision
    workspace.rubricRevisionDigest = validatedReplacement?.rubricRevisionDigest ?? workspace.rubricRevisionDigest
    workspace.projection = validatedReplacement?.projection ?? null
    workspace.sourceReady = validatedReplacement !== null
    if (invalidatedRecord) settleOwner?.(invalidatedRecord)
  }

  return {
    registerWorkspace(source) {
      const input = captureMutationInput(() => captureRegisterWorkspaceInput(source))
      if (workspaces.has(input.taskKey)) fail('class_review_workspace_already_registered')
      const parsed = parseClassReviewReport(input.report)
      if (!parsed.ok) fail('class_review_candidate_conflict')
      let report = structuredClone(parsed.value)
      if (input.taskRevision !== report.taskRevision || report.currentGeneration !== null) {
        fail('class_review_candidate_conflict')
      }
      const mixedSystemTopics = new Set(report.issueBlocks
        .filter((block) => block.origin === 'teacher' && block.systemStudentCount > 0)
        .map((block) => block.topicKey))
      const suppressedSystemVariants = new Map(input.suppressedSystemVariants ?? [])
      if (mixedSystemTopics.size !== suppressedSystemVariants.size
        || [...mixedSystemTopics].some((topicKey) => !suppressedSystemVariants.has(topicKey))
        || (suppressedSystemVariants.size > 0 && report.workspaceState !== 'ai_available')) {
        fail('class_review_candidate_conflict')
      }
      if (report.workspaceState === 'ai_available') {
        const appliedGenerationId = report.appliedGenerationId
        if ([...suppressedSystemVariants.values()].some((variant) =>
          variant.generationId !== appliedGenerationId || variant.invalidationEpoch !== 0)) {
          fail('class_review_candidate_conflict')
        }
      }
      const projection = cloneReadyProjection(input.projection)
      if (report.workspaceState === 'ai_available') {
        const metadata = report.snapshotMetadata
        if (metadata.totalEssayCount !== projection.projection.statistics.totalEssayCount
          || metadata.includedEssayCount !== projection.projection.statistics.includedEssayCount
          || metadata.issueEligibleEssayCount !== projection.projection.statistics.issueEligibleEssayCount
          || !semanticCoverageMatches(metadata.semanticCoverage, projection.projection.semanticCoverage)) {
          fail('class_review_candidate_conflict')
        }
      }
      const registrationRequest = buildRequest(
        input.rubricRevisionDigest,
        projection,
        'registration-validation',
      )
      cloneAndFreezeClassReviewGenerationSnapshot({
        originalRequest: registrationRequest,
        hidden: projection.hidden,
        generationId: 'registration-validation',
        invalidationEpoch: 0,
        executionIdentity: 'registration-validation',
        payloadDigest: 'registration-validation',
        taskRevision: input.taskRevision,
        reportRevision: report.reportRevision,
        aiTextEditRevision: report.aiTextEditRevision,
        sourceRevisionEpoch: 0,
        browserStatistics: report.statistics,
      })
      const issueWorkspace = createInternalIssueWorkspace(report.issueBlocks, {
        issueOrder: report.issueOrder,
        teacherEvidenceFacts: input.teacherEvidenceFacts,
        systemEvidenceFacts: input.systemEvidenceFacts ?? [],
        suppressed: suppressedSystemVariants,
      })
      const systemBlocks = issueWorkspace.visible.filter((block) => block.systemStudentCount > 0)
      if (systemBlocks.length > 0) {
        if (report.workspaceState !== 'ai_available') {
          fail('class_review_candidate_conflict')
        }
        const issueEligibleEssayCount = report.snapshotMetadata.issueEligibleEssayCount
        if (systemBlocks.some((block) => block.supportDenominator !== issueEligibleEssayCount
          || block.systemStudentCount > issueEligibleEssayCount)) fail('class_review_candidate_conflict')
      }
      const canonicalIssueBlocks = projectInternalIssueWorkspace(issueWorkspace)
      const canonicalReport = parseClassReviewReport({
        ...report,
        issueBlocks: canonicalIssueBlocks,
        issueOrder: canonicalIssueBlocks.map((block) => block.blockId),
      })
      if (!canonicalReport.ok) fail('class_review_candidate_conflict')
      report = canonicalReport.value
      workspaces.set(input.taskKey, {
        taskKey: input.taskKey,
        taskRevision: input.taskRevision,
        rubricRevisionDigest: input.rubricRevisionDigest,
        report,
        projection,
        issueWorkspace,
        opaqueTaskScope: null,
        lastGenerationId: null,
        activeExecution: null,
        inFlight: null,
        providerSettlementKnown: false,
        sourceRevisionEpoch: 0,
        invalidationEpoch: 0,
        sourceReady: true,
        taskDeleted: false,
        undoIssueWorkspace: null,
        cancelRetry: null,
      })
    },
    generate,
    getSnapshot(taskKey) {
      const workspace = getWorkspace(taskKey)
      const generation = readWorkspaceGeneration(workspace)
      return frozenClone({
        report: workspace.report,
        generation,
        candidate: generation?.candidateAvailable
          ? { available: true as const, generationId: generation.generationId }
          : null,
        requestId: workspace.activeExecution?.request?.requestId ?? null,
        boundedRequeueCount: generation?.boundedRequeueCount ?? 0,
        providerSettlementKnown: workspace.providerSettlementKnown,
        sourceReady: workspace.sourceReady,
        taskDeleted: workspace.taskDeleted,
        sourceRevisionEpoch: workspace.sourceRevisionEpoch,
      })
    },
    applyCandidate(source) {
      const command = captureMutationInput(() => captureApplyCandidateCommand(source))
      const workspace = getWorkspace(command.taskKey)
      const opaqueTaskScope = workspace.opaqueTaskScope
      const record = opaqueTaskScope ? registry.readGeneration({
        opaqueTaskScope,
        generationId: command.generationId,
      }) : null
      const candidateApplies = opaqueTaskScope !== null && record !== null
        && record.state === 'succeeded_unapplied'
        && record.candidateAvailable
        && workspace.taskRevision === command.expectedTaskRevision
        && workspace.report.reportRevision === command.expectedReportRevision
        && record.generationRevision === command.expectedGenerationRevision
        && workspace.report.aiTextEditRevision === command.expectedAiTextEditRevision
      if (!candidateApplies) fail('class_review_candidate_conflict')
      const applied = registry.applyCandidate({
        opaqueTaskScope,
        generationId: record.generationId,
        expectedRevision: record.generationRevision,
        apply: (handle) => applyMaterializedClassReviewCandidate({
          handle,
          currentReport: workspace.report,
          currentIssueWorkspace: workspace.issueWorkspace,
        }),
      })
      workspace.report = applied.value.report
      workspace.issueWorkspace = applied.value.issueWorkspace
      workspace.undoIssueWorkspace = null
      terminalReportRevisionByGeneration.set(
        terminalFenceKey(applied.record.opaqueTaskScope, applied.record.generationId),
        workspace.report.reportRevision,
      )
    },
    discardCandidate(source) {
      const command = captureMutationInput(() => captureDiscardCandidateCommand(source))
      const workspace = getWorkspace(command.taskKey)
      if (!workspace.opaqueTaskScope) fail('class_review_candidate_conflict')
      const discarded = registry.discardCandidate({
        opaqueTaskScope: workspace.opaqueTaskScope,
        generationId: command.generationId,
        expectedRevision: command.expectedGenerationRevision,
      })
      terminalReportRevisionByGeneration.set(
        terminalFenceKey(discarded.opaqueTaskScope, discarded.generationId),
        workspace.report.reportRevision,
      )
      workspace.undoIssueWorkspace = null
    },
    syncSources(command) {
      syncSources(command)
    },
    beginAiTextEdit(taskKey) {
      const capturedTaskKey = captureMutationInput(() => captureTaskKey(taskKey))
      if (activeLocksAiText(getWorkspace(capturedTaskKey))) fail('ai_text_edit_locked')
    },
    saveAiTextEdit(taskKey, summary) {
      const captured = captureMutationInput(() => ({
        taskKey: captureTaskKey(taskKey),
        summary: captureAiSummary(summary),
      }))
      const workspace = getWorkspace(captured.taskKey)
      if (activeLocksAiText(workspace)) fail('ai_text_edit_locked')
      if (workspace.report.workspaceState !== 'ai_available') fail('class_review_candidate_conflict')
      const candidate = {
        ...workspace.report,
        reportRevision: workspace.report.reportRevision + 1,
        aiTextEditRevision: workspace.report.aiTextEditRevision + 1,
        aiSummary: captured.summary,
      }
      const parsed = parseClassReviewReport(candidate)
      if (!parsed.ok) fail('class_review_candidate_conflict')
      workspace.report = parsed.value
    },
    cancelAiTextEdit(taskKey) {
      getWorkspace(captureMutationInput(() => captureTaskKey(taskKey)))
    },
    applyIssueCommand(taskKey, source) {
      const captured = captureMutationInput(() => ({
        taskKey: captureTaskKey(taskKey),
        command: captureTeacherIssueCommand(source),
      }))
      const command = captured.command
      const workspace = getWorkspace(captured.taskKey)
      if (workspace.report.workspaceState === 'none') fail('class_review_candidate_conflict')
      const priorReport = workspace.report
      const priorIssues = workspace.issueWorkspace
      const priorUndo = workspace.undoIssueWorkspace
      workspace.issueWorkspace = cloneInternal(priorIssues)
      try {
        if (command.kind === 'add') {
          addTeacherIssue(workspace, command)
          workspace.undoIssueWorkspace = null
        } else if (command.kind === 'remove') {
          if (!workspace.issueWorkspace.teacherFacts.has(command.evidenceId)) {
            fail('class_review_candidate_conflict')
          }
          workspace.undoIssueWorkspace = cloneInternal(workspace.issueWorkspace)
          const appliedGenerationId = workspace.report.workspaceState === 'ai_available'
            ? workspace.report.appliedGenerationId
            : null
          workspace.issueWorkspace = removeTeacherEvidence(
            workspace.issueWorkspace,
            command.evidenceId,
            appliedGenerationId
              ? {
                  generationId: appliedGenerationId,
                  invalidationEpoch: workspace.invalidationEpoch,
                }
              : undefined,
          )
        } else if (command.kind === 'undo') {
          if (!workspace.undoIssueWorkspace) fail('class_review_candidate_conflict')
          workspace.issueWorkspace = cloneInternal(workspace.undoIssueWorkspace)
          workspace.undoIssueWorkspace = null
        } else {
          const invalidIndex = !Number.isSafeInteger(command.toIndex)
            || command.toIndex < 0
            || command.toIndex >= workspace.issueWorkspace.visible.length
          if (invalidIndex) fail('class_review_candidate_conflict')
          const index = workspace.issueWorkspace.visible.findIndex((block) => block.blockId === command.blockId)
          if (index < 0) fail('class_review_candidate_conflict')
          const [block] = workspace.issueWorkspace.visible.splice(index, 1)
          workspace.issueWorkspace.visible.splice(command.toIndex, 0, block)
          const parsed = parseClassReviewReport({
            ...workspace.report,
            reportRevision: workspace.report.reportRevision + 1,
            issueOrder: workspace.issueWorkspace.visible.map((item) => item.blockId),
          })
          if (!parsed.ok) fail('class_review_candidate_conflict')
          workspace.report = parsed.value
          workspace.undoIssueWorkspace = null
          return
        }
        syncReportIssues(workspace)
      } catch (error) {
        workspace.report = priorReport
        workspace.issueWorkspace = priorIssues
        workspace.undoIssueWorkspace = priorUndo
        throw error
      }
    },
  }
}
