import { parseClassReviewReport } from './classReviewContracts'
import { classReviewSupportThreshold } from './aggregateClassReview'
import type {
  ClassReviewProjectionHiddenStateV1,
  HiddenMustCoverFallbackV1,
  HiddenSelectedGroupV1,
} from './classReviewProjection'
import { deriveCompositeTopicKey, type TopicHmac, type TopicIdentity } from './classReviewTopicKey'
import { parseClassReviewSynthesisRequest, parseClassReviewSynthesisResult } from './synthesisContracts'
import type {
  AiSummaryV1,
  ClassReviewIssueBlockV1,
  ClassReviewProviderOutputV1,
  ClassReviewReportV1,
  ClassReviewStatisticsV1,
  ClassReviewSynthesisRequestV1,
  EvidenceRefV1,
  Severity,
  SnapshotMetadataV1,
  SynthesisGroupV1,
} from './types'

function fail(code: string): never {
  throw new Error(code)
}

function compare(left: string, right: string): number {
  const leftScalars = [...left]
  const rightScalars = [...right]
  const length = Math.min(leftScalars.length, rightScalars.length)
  for (let index = 0; index < length; index += 1) {
    const leftCodePoint = leftScalars[index].codePointAt(0)!
    const rightCodePoint = rightScalars[index].codePointAt(0)!
    if (leftCodePoint !== rightCodePoint) return leftCodePoint - rightCodePoint
  }
  return leftScalars.length - rightScalars.length
}

function checkedAdd(left: number, right: number): number {
  const sum = left + right
  if (!Number.isSafeInteger(sum) || sum < 0) fail('hidden_snapshot_invalid')
  return sum
}

class ImmutableMapView<K, V> implements ReadonlyMap<K, V> {
  readonly #map: Map<K, V>
  constructor(entries: Iterable<readonly [K, V]>) {
    this.#map = new Map(entries)
    for (const [key, value] of this.#map) {
      deepFreeze(key)
      deepFreeze(value)
    }
    Object.freeze(this)
  }
  get size(): number { return this.#map.size }
  get(key: K): V | undefined { return this.#map.get(key) }
  has(key: K): boolean { return this.#map.has(key) }
  entries(): MapIterator<[K, V]> { return this.#map.entries() }
  keys(): MapIterator<K> { return this.#map.keys() }
  values(): MapIterator<V> { return this.#map.values() }
  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    this.#map.forEach((value, key) => callbackfn.call(thisArg, value, key, this))
  }
  [Symbol.iterator](): MapIterator<[K, V]> { return this.#map[Symbol.iterator]() }
}
const severityRank: Record<Severity, number> = { high: 0, medium: 1, low: 2 }
const identityTuple = (identity: TopicIdentity): string => JSON.stringify([
  identity.taskScope,
  identity.keyVersion,
  identity.key,
  identity.fingerprintDigest,
])

const TYPE_COPY = {
  grammar: ['语法准确性', '多篇作文出现同类语法问题。', '结合典型句型讲解规则，并安排针对性订正。'],
  spelling: ['拼写准确性', '多篇作文出现同类拼写问题。', '集中辨析易错词，并安排听写与订正。'],
  word_choice: ['词语选择', '多篇作文出现同类用词问题。', '结合语境辨析词义和搭配，并安排替换练习。'],
  structure: ['篇章结构', '多篇作文出现同类结构组织问题。', '示范段落组织方法，并练习信息排序与衔接。'],
  legibility: ['卷面与可读性', '多篇作文出现同类卷面可读性问题。', '明确书写与版面规范，并安排限时誊写检查。'],
} as const
const LOGIC_LABEL = {
  weak_connection: '衔接薄弱',
  unclear_logic: '逻辑不清',
  missing_cause_effect: '因果缺失',
  unclear_transition: '过渡不清',
  topic_drift: '偏离主题',
  irrelevant_sentence: '无关句',
  unclear_reference: '指代不清',
  missing_motivation: '动机缺失',
  plot_gap: '情节断裂',
} as const

function fallbackCopy(item: HiddenMustCoverFallbackV1): { title: string; diagnosis: string; teachingAction: string } {
  const action = item.type === 'logic' ? '结合上下文梳理关系，并安排衔接与因果表达练习。' : TYPE_COPY[item.type][2]
  if (item.content.kind === 'scrubbed') return { title: item.content.title.text, diagnosis: item.content.diagnosis.text, teachingAction: action }
  if (item.type === 'logic') {
    const label = LOGIC_LABEL[item.subtype ?? 'unclear_logic']
    return { title: `逻辑与连贯：${label}`, diagnosis: `多篇作文出现同类${label}问题。`, teachingAction: action }
  }
  const copy = TYPE_COPY[item.type]
  return { title: copy[0], diagnosis: copy[1], teachingAction: copy[2] }
}

async function materializeSystemIssueBlocks(input: {
  providerOutput: ClassReviewProviderOutputV1
  hidden: ClassReviewProjectionHiddenStateV1
  issueEligibleEssayCount: number
  topicHmac: TopicHmac
  createOpaqueId: () => string
  admittedGroups?: readonly SynthesisGroupV1[]
  projectedGroups?: readonly SynthesisGroupV1[]
}): Promise<{ issueBlocks: ClassReviewIssueBlockV1[]; consumedMustCover: Set<string>; systemEvidenceFacts: SystemEvidenceFact[] }> {
  const projected = new Map((input.projectedGroups ?? input.admittedGroups ?? []).map((group) => [group.groupId, group]))
  const identityOwners = new Map<string, string>()
  for (const [alias, group] of input.hidden.selectedGroups) {
    const key = identityTuple(group.atomicTopic)
    const owner = identityOwners.get(key)
    if (owner && owner !== alias) fail('hidden_snapshot_conflict')
    identityOwners.set(key, alias)
  }
  const ownedAliases = new Set<string>()
  const consumedMustCover = new Set<string>()
  const issueBlocks: ClassReviewIssueBlockV1[] = []
  const systemEvidenceFacts: SystemEvidenceFact[] = []
  const requiredSupport = classReviewSupportThreshold(input.issueEligibleEssayCount)

  for (const pattern of input.providerOutput.patterns) {
    const members: HiddenSelectedGroupV1[] = []
    for (const alias of pattern.groupIds) {
      if (ownedAliases.has(alias)) fail('duplicate_group_ownership')
      const member = input.hidden.selectedGroups.get(alias)
      if (!member) fail('unknown_group')
      ownedAliases.add(alias)
      members.push(member)
    }
    const essayIds = new Set<string>()
    let occurrenceCount = 0
    for (const member of members) {
      member.essayIds.forEach((essayId) => essayIds.add(essayId))
      occurrenceCount = checkedAdd(occurrenceCount, member.occurrenceCount)
    }
    if (essayIds.size < requiredSupport) continue
    const identities = [...new Map(members.map((member) => [identityTuple(member.atomicTopic), member.atomicTopic])).values()]
    const topic = identities.length === 1 ? identities[0] : await deriveCompositeTopicKey(identities, input.topicHmac)
    members.forEach((member) => consumedMustCover.add(identityTuple(member.atomicTopic)))
    const examples = members
      .flatMap((member) => member.excerpt?.originalText.status === 'kept'
        ? [{
            topicKey: member.atomicTopic.key,
            evidenceKey: member.excerpt.originalText.scrubbedEvidenceKey,
            text: member.excerpt.originalText.text,
          }]
        : [])
      .sort((a, b) =>
        compare(a.topicKey, b.topicKey)
        || compare(a.evidenceKey, b.evidenceKey)
        || compare(a.text, b.text),
      )
    const anonymousExamples = [...new Map(examples.map((example) => [example.text, example.text])).values()].slice(0, 3)
    issueBlocks.push({
      blockId: input.createOpaqueId(),
      topicKey: topic.key,
      origin: 'ai',
      title: pattern.title,
      diagnosis: pattern.diagnosis,
      teachingAction: pattern.teachingAction,
      severity: pattern.severity,
      teacherStudentCount: 0,
      systemStudentCount: essayIds.size,
      combinedStudentCount: essayIds.size,
      occurrenceCount,
      supportDenominator: input.issueEligibleEssayCount,
      anonymousExamples,
      evidenceRefs: [],
    })
    systemEvidenceFacts.push({
      topicKey: topic.key,
      essayIdentities: [...essayIds].sort(compare),
      occurrenceCount,
    })
  }

  const fallbacks = new Map<string, HiddenMustCoverFallbackV1>()
  for (const item of input.hidden.unprojectedMustCover) {
    if (!consumedMustCover.has(identityTuple(item.atomicTopic))) {
      fallbacks.set(identityTuple(item.atomicTopic), item)
    }
  }
  for (const [alias, member] of input.hidden.selectedGroups) {
    const group = projected.get(alias)
    if (!group?.mustCover || consumedMustCover.has(identityTuple(member.atomicTopic))) continue
    let content: HiddenMustCoverFallbackV1['content']
    if (
      member.title.status === 'kept'
      && member.excerpt?.suggestionOrDiagnosis.status === 'kept'
    ) {
      content = {
        kind: 'scrubbed',
        title: {
          text: member.title.text,
          scrubbedEvidenceKey: member.title.scrubbedEvidenceKey,
        },
        diagnosis: {
          text: member.excerpt.suggestionOrDiagnosis.text,
          scrubbedEvidenceKey: member.excerpt.suggestionOrDiagnosis.scrubbedEvidenceKey,
        },
        teachingTemplate: group.type,
      }
    } else {
      content = {
        kind: 'template',
        template: group.type === 'logic'
          ? `logic_${group.subtype ?? 'unclear_logic'}`
          : group.type,
      }
    }
    fallbacks.set(identityTuple(member.atomicTopic), {
      atomicTopic: member.atomicTopic,
      type: group.type,
      subtype: group.subtype,
      severity: group.severity,
      distinctEssaySupport: member.essayIds.length,
      occurrenceCount: member.occurrenceCount,
      content,
      anonymousExample: null,
    })
  }
  for (const item of fallbacks.values()) {
    const selected = [...input.hidden.selectedGroups.values()].find((group) => identityTuple(group.atomicTopic) === identityTuple(item.atomicTopic))
    issueBlocks.push({
      blockId: input.createOpaqueId(),
      topicKey: item.atomicTopic.key,
      origin: 'ai',
      ...fallbackCopy(item),
      severity: item.severity,
      teacherStudentCount: 0,
      systemStudentCount: item.distinctEssaySupport,
      combinedStudentCount: item.distinctEssaySupport,
      occurrenceCount: item.occurrenceCount,
      supportDenominator: input.issueEligibleEssayCount,
      anonymousExamples: [],
      evidenceRefs: [],
    })
    systemEvidenceFacts.push({
      topicKey: item.atomicTopic.key,
      essayIdentities: selected ? [...selected.essayIds].sort(compare) : [],
      occurrenceCount: item.occurrenceCount,
      identityMode: selected ? 'exact' : 'unavailable_fallback',
    })
  }
  issueBlocks.sort((left, right) => severityRank[left.severity] - severityRank[right.severity]
    || right.systemStudentCount - left.systemStudentCount
    || right.occurrenceCount - left.occurrenceCount
    || compare(left.topicKey, right.topicKey))
  return { issueBlocks, consumedMustCover, systemEvidenceFacts }
}

export interface GenerationSnapshot {
  originalRequest: ClassReviewSynthesisRequestV1
  hidden: ClassReviewProjectionHiddenStateV1
  generationId: string
  invalidationEpoch: number
  executionIdentity: string
  payloadDigest: string
  taskRevision: number
  reportRevision: number | null
  aiTextEditRevision: number
  sourceRevisionEpoch: number
  browserStatistics: ClassReviewStatisticsV1
}

function deepFreeze(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
  if (value instanceof Map) {
    for (const [key, item] of value) {
      deepFreeze(key)
      deepFreeze(item)
    }
  } else if (Array.isArray(value)) {
    value.forEach(deepFreeze)
  } else {
    Object.values(value).forEach(deepFreeze)
  }
  Object.freeze(value)
}

export function cloneAndFreezeClassReviewGenerationSnapshot(input: GenerationSnapshot): Readonly<GenerationSnapshot> {
  const parsedRequest = parseClassReviewSynthesisRequest(structuredClone(input.originalRequest))
  if (!parsedRequest.ok) fail('class_review_candidate_conflict')
  const selectedEntries = [...input.hidden.selectedGroups].map(([alias, group]) => [alias, structuredClone(group)] as const)
  const aliasEntries = [...input.hidden.dimensionAliases].map(([alias, original]) => [alias, original] as const)
  const hidden: ClassReviewProjectionHiddenStateV1 = {
    dimensionAliases: new ImmutableMapView(aliasEntries),
    selectedGroups: new ImmutableMapView(selectedEntries),
    unprojectedMustCover: structuredClone([...input.hidden.unprojectedMustCover]),
  }
  validateGenerationBoundary(parsedRequest.value, hidden, input.browserStatistics)
  const clone: GenerationSnapshot = {
    ...structuredClone({
      generationId: input.generationId,
      invalidationEpoch: input.invalidationEpoch,
      executionIdentity: input.executionIdentity,
      payloadDigest: input.payloadDigest,
      taskRevision: input.taskRevision,
      reportRevision: input.reportRevision,
      aiTextEditRevision: input.aiTextEditRevision,
      sourceRevisionEpoch: input.sourceRevisionEpoch,
      browserStatistics: input.browserStatistics,
    }),
    originalRequest: parsedRequest.value,
    hidden,
  }
  deepFreeze(clone)
  return clone
}

function validateTopicIdentity(identity: TopicIdentity): void {
  if (identity.kind !== 'atomic'
    || identity.keyVersion !== 'topic-key-v1'
    || !/^scope_v1_[0-9a-f]{32,64}$/u.test(identity.taskScope)
    || !/^tk1\.[0-9a-f]{16}(?:\.[0-9a-f]{12}(?:\.(?:[2-9]|[1-9]\d+))?)?$/u.test(identity.key)
    || !/^fp1\.[0-9a-f]{64}$/u.test(identity.fingerprintDigest)) {
    fail('class_review_candidate_conflict')
  }
}

function validateGenerationBoundary(
  request: ClassReviewSynthesisRequestV1,
  hidden: ClassReviewProjectionHiddenStateV1,
  browser: ClassReviewStatisticsV1,
): void {
  const requestCounts = request.statistics
  const browserScore = browser.scoreSummary
  if (requestCounts.totalEssayCount !== browser.totalEssayCount
    || requestCounts.includedEssayCount !== browser.includedEssayCount
    || requestCounts.issueEligibleEssayCount !== browser.issueEligibleEssayCount
    || requestCounts.excludedEssayCount !== browser.excludedEssayCount
    || requestCounts.score.fullScore !== browser.fullScore
    || browserScore === null
    || requestCounts.score.averageScore !== browserScore.averageScore
    || requestCounts.score.highestScore !== browserScore.highestScore
    || requestCounts.score.lowestScore !== browserScore.lowestScore) {
    fail('class_review_candidate_conflict')
  }

  const browserBands = [...browser.scoreBands].sort((left, right) => (
    left.lowerInclusive - right.lowerInclusive
    || left.upperInclusive - right.upperInclusive
    || compare(left.bandId, right.bandId)
  ))
  if (requestCounts.scoreBands.length !== browserBands.length) fail('class_review_candidate_conflict')
  for (let index = 0; index < requestCounts.scoreBands.length; index += 1) {
    const projected = requestCounts.scoreBands[index]
    const current = browserBands[index]
    if (projected.bandId !== `b${index + 1}`
      || projected.lowerInclusive !== current.lowerInclusive
      || projected.upperInclusive !== current.upperInclusive
      || projected.essayCount !== current.essayCount) fail('class_review_candidate_conflict')
  }

  if (hidden.dimensionAliases.size !== requestCounts.dimensions.length
    || browser.dimensions.length !== requestCounts.dimensions.length) {
    fail('class_review_candidate_conflict')
  }
  const originalDimensions = new Map(browser.dimensions.map((dimension) => [dimension.dimensionId, dimension]))
  if (originalDimensions.size !== browser.dimensions.length) fail('class_review_candidate_conflict')
  const seenOriginals = new Set<string>()
  for (let index = 0; index < requestCounts.dimensions.length; index += 1) {
    const alias = `d${index + 1}`
    const original = hidden.dimensionAliases.get(alias)
    const projected = requestCounts.dimensions[index]
    const current = original === undefined ? undefined : originalDimensions.get(original)
    if (projected.dimensionId !== alias
      || projected.label !== `Dimension ${index + 1}`
      || !original || !current || seenOriginals.has(original)
      || projected.averageScore !== current.averageScore
      || projected.maxScore !== current.maxScore
      || projected.normalizedPerformance !== current.normalizedPerformance) {
      fail('class_review_candidate_conflict')
    }
    seenOriginals.add(original)
  }
  if (seenOriginals.size !== hidden.dimensionAliases.size) fail('class_review_candidate_conflict')

  const requestGroups = new Map(request.groups.map((group) => [group.groupId, group]))
  if (requestGroups.size !== request.groups.length || hidden.selectedGroups.size !== requestGroups.size) fail('class_review_candidate_conflict')
  const identityOwners = new Set<string>()
  let sharedScope: string | null = null
  for (const [alias, selected] of hidden.selectedGroups) {
    const group = requestGroups.get(alias)
    validateTopicIdentity(selected.atomicTopic)
    const identity = identityTuple(selected.atomicTopic)
    const essays = new Set(selected.essayIds)
    const expectedMustCover = group
      ? group.distinctEssaySupport >= classReviewSupportThreshold(requestCounts.issueEligibleEssayCount)
      : false
    if (!group || group.mustCover !== expectedMustCover || identityOwners.has(identity) || essays.size !== selected.essayIds.length || essays.size !== group.distinctEssaySupport
      || selected.occurrenceCount !== group.occurrenceCount || selected.occurrenceCount < essays.size) {
      fail('class_review_candidate_conflict')
    }
    if (sharedScope !== null && sharedScope !== selected.atomicTopic.taskScope) fail('class_review_candidate_conflict')
    sharedScope = selected.atomicTopic.taskScope
    identityOwners.add(identity)
    const selectedTitle = selected.title.status === 'kept' ? selected.title.text : null
    if (selectedTitle !== null && selectedTitle !== group.title) fail('class_review_candidate_conflict')
    if (group.excerpt) {
      if (!selected.excerpt || selected.excerpt.originalText.status !== 'kept' || selected.excerpt.suggestionOrDiagnosis.status !== 'kept'
        || selected.excerpt.originalText.text !== group.excerpt.originalText
        || selected.excerpt.suggestionOrDiagnosis.text !== group.excerpt.suggestionOrDiagnosis) fail('class_review_candidate_conflict')
    } else if (selected.excerpt?.originalText.status === 'kept' || selected.excerpt?.suggestionOrDiagnosis.status === 'kept') {
      fail('class_review_candidate_conflict')
    }
  }
  for (const fallback of hidden.unprojectedMustCover) {
    validateTopicIdentity(fallback.atomicTopic)
    const identity = identityTuple(fallback.atomicTopic)
    if (identityOwners.has(identity)
      || (sharedScope !== null && fallback.atomicTopic.taskScope !== sharedScope)
      || fallback.distinctEssaySupport > requestCounts.issueEligibleEssayCount
      || fallback.distinctEssaySupport < classReviewSupportThreshold(requestCounts.issueEligibleEssayCount)
      || !Number.isSafeInteger(fallback.distinctEssaySupport)
      || !Number.isSafeInteger(fallback.occurrenceCount)
      || fallback.distinctEssaySupport < 0
      || fallback.occurrenceCount < fallback.distinctEssaySupport) {
      fail('class_review_candidate_conflict')
    }
    sharedScope ??= fallback.atomicTopic.taskScope
    identityOwners.add(identity)
  }
}

interface GeneratedClassReviewPayload {
  generationId: string
  invalidationEpoch: number
  executionIdentity: string
  payloadDigest: string
  generatedPayload: {
    aiSummary: AiSummaryV1
    systemIssueBlocks: ClassReviewIssueBlockV1[]
    systemEvidenceFacts: SystemEvidenceFact[]
    snapshotMetadata: SnapshotMetadataV1
    generatedAt: string
  }
}

export interface MaterializedClassReviewCandidateHandle {
  readonly __materializedClassReviewCandidateHandle: never
}

export interface MaterializedClassReviewCandidateMetadata {
  readonly generationId: string
  readonly invalidationEpoch: number
  readonly executionIdentity: string
  readonly payloadDigest: string
}

const payloadByHandle = new WeakMap<object, GeneratedClassReviewPayload>()

function createMaterializedHandle(payload: GeneratedClassReviewPayload): MaterializedClassReviewCandidateHandle {
  const handle: MaterializedClassReviewCandidateHandle = Object.freeze({
    __materializedClassReviewCandidateHandle: undefined as never,
    opaque: Symbol('class-review-candidate'),
  })
  payloadByHandle.set(handle, payload)
  return handle
}

function requireMaterializedPayload(handle: MaterializedClassReviewCandidateHandle): GeneratedClassReviewPayload {
  if (!handle || typeof handle !== 'object') fail('class_review_candidate_conflict')
  const payload = payloadByHandle.get(handle as object)
  if (!payload) fail('class_review_candidate_conflict')
  return payload
}

export function getMaterializedClassReviewCandidateMetadata(
  handle: MaterializedClassReviewCandidateHandle,
): MaterializedClassReviewCandidateMetadata {
  const payload = requireMaterializedPayload(handle)
  return Object.freeze({
    generationId: payload.generationId,
    invalidationEpoch: payload.invalidationEpoch,
    executionIdentity: payload.executionIdentity,
    payloadDigest: payload.payloadDigest,
  })
}

export async function materializeClassReviewCandidate(input: {
  snapshot: Readonly<GenerationSnapshot>
  untrustedResult: unknown
  currentReport: ClassReviewReportV1
  currentIssueWorkspace: InternalIssueWorkspace
  getCurrentWorkspace?: () => {
    currentReport: ClassReviewReportV1
    currentIssueWorkspace: InternalIssueWorkspace
  }
  topicHmac: TopicHmac
  createOpaqueId: () => string
  now: () => string
}): Promise<MaterializedClassReviewCandidateHandle> {
  const parsed = parseClassReviewSynthesisResult(input.untrustedResult, input.snapshot.originalRequest)
  if (!parsed.ok || parsed.value.status !== 'succeeded') fail('provider_invalid_response')
  const admittedGroups = input.snapshot.originalRequest.groups.slice(0, parsed.value.semanticCoverage.projectedGroupCount)
  const system = await materializeSystemIssueBlocks({
    providerOutput: parsed.value.output,
    hidden: input.snapshot.hidden,
    issueEligibleEssayCount: input.snapshot.originalRequest.statistics.issueEligibleEssayCount,
    topicHmac: input.topicHmac,
    createOpaqueId: input.createOpaqueId,
    admittedGroups,
    projectedGroups: input.snapshot.originalRequest.groups,
  })
  const generatedAt = input.now()
  const aiSummary: AiSummaryV1 = {
    overallComment: parsed.value.output.overallComment,
    strengths: parsed.value.output.strengths.map((strength) => ({
      ...strength,
      dimensionIds: strength.dimensionIds.map((alias) => {
        const original = input.snapshot.hidden.dimensionAliases.get(alias)
        if (!original) return fail('class_review_candidate_conflict')
        return original
      }),
    })),
    learningRecommendations: parsed.value.output.learningRecommendations,
  }
  const payload: GeneratedClassReviewPayload = {
    generationId: input.snapshot.generationId,
    invalidationEpoch: input.snapshot.invalidationEpoch,
    executionIdentity: input.snapshot.executionIdentity,
    payloadDigest: input.snapshot.payloadDigest,
    generatedPayload: {
      aiSummary,
      systemIssueBlocks: system.issueBlocks,
      systemEvidenceFacts: system.systemEvidenceFacts,
      generatedAt,
      snapshotMetadata: {
      includedEssayCount: input.snapshot.originalRequest.statistics.includedEssayCount,
      issueEligibleEssayCount: input.snapshot.originalRequest.statistics.issueEligibleEssayCount,
      totalEssayCount: input.snapshot.originalRequest.statistics.totalEssayCount,
      semanticCoverage: parsed.value.semanticCoverage,
      },
    },
  }
  const blockIds = payload.generatedPayload.systemIssueBlocks.map((block) => block.blockId)
  if (blockIds.some((blockId) => blockId.length === 0) || new Set(blockIds).size !== blockIds.length) {
    fail('class_review_candidate_conflict')
  }
  const syntheticReport: ClassReviewReportV1 = {
    contractVersion: 'class-review-report-v1',
    workspaceState: 'ai_available',
    taskRevision: input.snapshot.taskRevision,
    reportRevision: checkedAdd(input.snapshot.reportRevision ?? 0, 1),
    aiTextEditRevision: input.snapshot.aiTextEditRevision,
    currentGeneration: null,
    statistics: structuredClone(input.snapshot.browserStatistics),
    issueBlocks: structuredClone(payload.generatedPayload.systemIssueBlocks),
    issueOrder: blockIds,
    clearSpellingItems: [],
    selectedMaterials: [],
    appliedGenerationId: input.snapshot.generationId,
    generatedAt,
    snapshotMetadata: structuredClone(payload.generatedPayload.snapshotMetadata),
    aiSummary: structuredClone(aiSummary),
  }
  if (!parseClassReviewReport(syntheticReport).ok) fail('class_review_candidate_conflict')
  deepFreeze(payload)
  const currentWorkspace = input.getCurrentWorkspace?.() ?? {
    currentReport: input.currentReport,
    currentIssueWorkspace: input.currentIssueWorkspace,
  }
  mergeGeneratedClassReviewPayloadIntoWorkspace({
    payload,
    currentReport: currentWorkspace.currentReport,
    currentIssueWorkspace: currentWorkspace.currentIssueWorkspace,
  })
  return createMaterializedHandle(payload)
}

export interface TeacherEvidenceFact {
  topicKey: string
  evidenceId: string
  essayIdentity: string
  occurrenceCount: number
  evidenceRef?: EvidenceRefV1
}

export interface SystemEvidenceFact {
  topicKey: string
  essayIdentities: readonly string[]
  occurrenceCount: number
  identityMode?: 'exact' | 'unavailable_fallback'
}

export interface SuppressedSystemVariant {
  block: ClassReviewIssueBlockV1
  generationId: string
  invalidationEpoch: number
  systemEvidenceFact: SystemEvidenceFact
}

export interface InternalIssueWorkspace {
  visible: ClassReviewIssueBlockV1[]
  suppressed: Map<string, SuppressedSystemVariant>
  teacherFacts: Map<string, TeacherEvidenceFact>
  systemFacts: Map<string, SystemEvidenceFact>
}

function canonicalTeacherEvidenceRefs(facts: readonly TeacherEvidenceFact[]): EvidenceRefV1[] {
  return facts
    .map((fact) => structuredClone(fact.evidenceRef!))
    .sort((left, right) => compare(left.evidenceId, right.evidenceId))
}

function canonicalTeacherExamples(refs: readonly EvidenceRefV1[]): string[] {
  const examples = refs.flatMap((ref) => ref.anonymousExample === null ? [] : [ref.anonymousExample])
  return [...new Set(examples)].sort(compare).slice(0, 3)
}

function canonicalSystemFact(source: SystemEvidenceFact): SystemEvidenceFact {
  const identities = [...source.essayIdentities]
  if (!source.topicKey
    || new Set(identities).size !== identities.length
    || identities.some((identity) => identity.length === 0)
    || !Number.isSafeInteger(source.occurrenceCount)
    || source.occurrenceCount <= 0) {
    fail('class_review_candidate_conflict')
  }
  const identityMode = source.identityMode
    ?? (identities.length === 0 ? 'unavailable_fallback' : 'exact')
  if (identityMode !== 'exact' && identityMode !== 'unavailable_fallback') {
    fail('class_review_candidate_conflict')
  }
  if (identityMode === 'exact' && identities.length === 0) fail('class_review_candidate_conflict')
  if (identityMode === 'unavailable_fallback' && identities.length !== 0) fail('class_review_candidate_conflict')
  if (identityMode === 'exact' && source.occurrenceCount < identities.length) {
    fail('class_review_candidate_conflict')
  }
  const fact: SystemEvidenceFact = {
    topicKey: source.topicKey,
    essayIdentities: identities.sort(compare),
    occurrenceCount: source.occurrenceCount,
    identityMode,
  }
  deepFreeze(fact)
  return fact
}

function canonicalTeacherFact(source: TeacherEvidenceFact, evidenceRef: EvidenceRefV1): TeacherEvidenceFact {
  const fact: TeacherEvidenceFact = {
    topicKey: source.topicKey,
    evidenceId: source.evidenceId,
    essayIdentity: source.essayIdentity,
    occurrenceCount: source.occurrenceCount,
    evidenceRef: structuredClone(evidenceRef),
  }
  deepFreeze(fact)
  return fact
}

function rebuildTeacherOwnedBlock(input: {
  teacherBlock: ClassReviewIssueBlockV1
  teacherFacts: readonly TeacherEvidenceFact[]
  systemBlock?: ClassReviewIssueBlockV1
  systemFact?: SystemEvidenceFact
}): ClassReviewIssueBlockV1 {
  const teacherRefs = canonicalTeacherEvidenceRefs(input.teacherFacts)
  const teacherEssays = new Set(input.teacherFacts.map((fact) => fact.essayIdentity))
  if (!input.systemBlock && input.systemFact) fail('class_review_candidate_conflict')
  if (input.systemBlock && !input.systemFact) fail('class_review_candidate_conflict')

  if (!input.systemBlock || !input.systemFact) {
    let occurrenceCount = 0
    for (const fact of input.teacherFacts) {
      occurrenceCount = checkedAdd(occurrenceCount, fact.occurrenceCount)
    }
    return {
      ...structuredClone(input.teacherBlock),
      origin: 'teacher',
      teacherStudentCount: teacherEssays.size,
      systemStudentCount: 0,
      combinedStudentCount: teacherEssays.size,
      occurrenceCount,
      supportDenominator: null,
      anonymousExamples: canonicalTeacherExamples(teacherRefs),
      evidenceRefs: teacherRefs,
    }
  }

  if (input.systemFact.topicKey !== input.teacherBlock.topicKey
    || input.systemBlock.topicKey !== input.teacherBlock.topicKey
    || input.systemFact.identityMode !== 'exact') {
    fail('class_review_candidate_conflict')
  }
  const systemEssays = new Set(input.systemFact.essayIdentities)
  if (systemEssays.size !== input.systemBlock.systemStudentCount) {
    fail('class_review_candidate_conflict')
  }
  let teacherOnlyOccurrences = 0
  for (const fact of input.teacherFacts) {
    if (!systemEssays.has(fact.essayIdentity)) {
      teacherOnlyOccurrences = checkedAdd(teacherOnlyOccurrences, fact.occurrenceCount)
    }
  }
  const systemRefs = input.systemBlock.evidenceRefs
    .filter((ref) => ref.selectionOrigin === 'system_generation')
    .map((ref) => structuredClone(ref))
    .sort((left, right) => compare(left.evidenceId, right.evidenceId))
  const systemExamples = input.systemBlock.origin === 'teacher'
    ? systemRefs.flatMap((ref) => ref.anonymousExample === null ? [] : [ref.anonymousExample])
    : input.systemBlock.anonymousExamples
  const anonymousExamples = [...new Set([
    ...canonicalTeacherExamples(teacherRefs),
    ...systemExamples,
  ])].sort(compare).slice(0, 3)
  return {
    ...structuredClone(input.teacherBlock),
    origin: 'teacher',
    teacherStudentCount: teacherEssays.size,
    systemStudentCount: systemEssays.size,
    combinedStudentCount: new Set([...teacherEssays, ...systemEssays]).size,
    occurrenceCount: checkedAdd(input.systemFact.occurrenceCount, teacherOnlyOccurrences),
    supportDenominator: input.systemBlock.supportDenominator,
    anonymousExamples,
    evidenceRefs: [...teacherRefs, ...systemRefs],
  }
}

function canonicalStandaloneIssueBlock(input: ClassReviewIssueBlockV1): ClassReviewIssueBlockV1 {
  let candidate: unknown
  try {
    candidate = {
      contractVersion: 'class-review-report-v1',
      workspaceState: 'ai_available',
      taskRevision: 0,
      reportRevision: 0,
      aiTextEditRevision: 0,
      currentGeneration: null,
      statistics: {
        totalEssayCount: 0,
        includedEssayCount: 0,
        issueEligibleEssayCount: 0,
        excludedEssayCount: 0,
        issueCoverageRate: 1,
        fullScore: 1,
        scoreSummary: null,
        scoreBands: [],
        dimensions: [],
      },
      issueBlocks: [structuredClone(input)],
      issueOrder: [input.blockId],
      clearSpellingItems: [],
      selectedMaterials: [],
      appliedGenerationId: 'validation-generation',
      generatedAt: '2000-01-01T00:00:00.000Z',
      snapshotMetadata: {
        totalEssayCount: 0,
        includedEssayCount: 0,
        issueEligibleEssayCount: 0,
        semanticCoverage: {
          projectedGroupCount: 0,
          eligibleGroupCount: 0,
          groupCoverage: 1,
          projectedDistinctEssaySupportSum: 0,
          eligibleDistinctEssaySupportSum: 0,
          supportWeightedCoverage: 1,
          projectedOccurrenceSum: 0,
          eligibleOccurrenceSum: 0,
          occurrenceWeightedCoverage: 1,
        },
      },
      aiSummary: {
        overallComment: 'Validation',
        strengths: [],
        learningRecommendations: [],
      },
    }
  } catch {
    return fail('class_review_candidate_conflict')
  }
  const parsed = parseClassReviewReport(candidate)
  if (!parsed.ok || parsed.value.issueBlocks.length !== 1) fail('class_review_candidate_conflict')
  return parsed.value.issueBlocks[0]
}

export function createInternalIssueWorkspace(
  blocks: readonly ClassReviewIssueBlockV1[],
  options?: {
    teacherEvidenceFacts?: readonly TeacherEvidenceFact[]
    systemEvidenceFacts?: readonly SystemEvidenceFact[]
    issueOrder?: readonly string[]
    suppressed?: ReadonlyMap<string, SuppressedSystemVariant>
  },
): InternalIssueWorkspace {
  const byId = new Map(blocks.map((block) => [block.blockId, structuredClone(block)]))
  if (byId.size !== blocks.length) fail('class_review_candidate_conflict')
  const visible: ClassReviewIssueBlockV1[] = []
  const consumed = new Set<string>()
  for (const blockId of options?.issueOrder ?? []) {
    const block = byId.get(blockId)
    if (block && !consumed.has(blockId)) {
      visible.push(block)
      consumed.add(blockId)
    }
  }
  const unlisted = [...byId.values()]
    .filter((block) => !consumed.has(block.blockId))
    .sort((left, right) => compare(left.blockId, right.blockId))
  visible.push(...unlisted)
  const teacherFacts = new Map<string, TeacherEvidenceFact>()
  const teacherRefOwners = new Map<string, { topicKey: string; ref: EvidenceRefV1 }>()
  for (const block of visible) {
    for (const ref of block.evidenceRefs) {
      if (ref.selectionOrigin !== 'teacher_selected') continue
      if (block.origin !== 'teacher' || teacherRefOwners.has(ref.evidenceId)) {
        fail('class_review_candidate_conflict')
      }
      teacherRefOwners.set(ref.evidenceId, { topicKey: block.topicKey, ref })
    }
  }
  for (const sourceFact of options?.teacherEvidenceFacts ?? []) {
    const fact = structuredClone(sourceFact)
    const owner = teacherRefOwners.get(fact.evidenceId)
    const ownedRef = owner?.ref
    const invalidFact = !owner || owner.topicKey !== fact.topicKey || !ownedRef || teacherFacts.has(fact.evidenceId)
      || !fact.evidenceId || !fact.essayIdentity
      || !Number.isSafeInteger(fact.occurrenceCount) || fact.occurrenceCount <= 0
      || (fact.evidenceRef !== undefined
        && JSON.stringify(fact.evidenceRef) !== JSON.stringify(ownedRef))
    if (invalidFact) fail('class_review_candidate_conflict')
    teacherFacts.set(fact.evidenceId, canonicalTeacherFact(fact, ownedRef))
  }
  if (teacherFacts.size !== teacherRefOwners.size) fail('class_review_candidate_conflict')

  const systemFacts = new Map<string, SystemEvidenceFact>()
  for (const sourceFact of options?.systemEvidenceFacts ?? []) {
    if (systemFacts.has(sourceFact.topicKey)) fail('class_review_candidate_conflict')
    systemFacts.set(sourceFact.topicKey, canonicalSystemFact(sourceFact))
  }
  const suppressed = new Map<string, SuppressedSystemVariant>()
  for (const [key, source] of options?.suppressed ?? []) {
    const canonicalBlock = canonicalStandaloneIssueBlock(source.block)
    const visibleOwner = visible.find((block) => block.topicKey === key)
    if (suppressed.has(key) || key !== canonicalBlock.topicKey
      || key !== source.systemEvidenceFact.topicKey
      || !visibleOwner
      || visibleOwner.origin !== 'teacher'
      || visibleOwner.systemStudentCount <= 0
      || ![...teacherFacts.values()].some((fact) => fact.topicKey === key)
      || !source.generationId
      || !Number.isSafeInteger(source.invalidationEpoch)
      || source.invalidationEpoch < 0
      || canonicalBlock.origin !== 'ai'
      || canonicalBlock.teacherStudentCount !== 0
      || canonicalBlock.systemStudentCount <= 0
      || canonicalBlock.combinedStudentCount !== canonicalBlock.systemStudentCount
      || canonicalBlock.supportDenominator === null
      || !Number.isSafeInteger(canonicalBlock.supportDenominator)
      || canonicalBlock.supportDenominator <= 0
      || canonicalBlock.systemStudentCount > canonicalBlock.supportDenominator
      || canonicalBlock.evidenceRefs.some((ref) => ref.selectionOrigin === 'teacher_selected')) {
      fail('class_review_candidate_conflict')
    }
    const systemEvidenceFact = canonicalSystemFact(source.systemEvidenceFact)
    const variant: SuppressedSystemVariant = {
      block: canonicalBlock,
      generationId: source.generationId,
      invalidationEpoch: source.invalidationEpoch,
      systemEvidenceFact,
    }
    deepFreeze(variant)
    suppressed.set(key, variant)
  }

  const systemTopicOwners = new Set<string>()
  const visibleSystemTopics = new Set<string>()
  for (const block of visible) {
    if (block.systemStudentCount <= 0) {
      if (block.evidenceRefs.some((ref) => ref.selectionOrigin === 'system_generation')) {
        fail('class_review_candidate_conflict')
      }
      continue
    }
    if (visibleSystemTopics.has(block.topicKey)) fail('class_review_candidate_conflict')
    visibleSystemTopics.add(block.topicKey)
    if (block.origin === 'teacher' && !suppressed.has(block.topicKey)) {
      fail('class_review_candidate_conflict')
    }
    systemTopicOwners.add(block.topicKey)
  }
  for (const [topicKey, variant] of suppressed) {
    if (visible.some((block) => block.topicKey === topicKey && block.origin === 'ai')) {
      fail('class_review_candidate_conflict')
    }
    systemTopicOwners.add(topicKey)
    const fact = systemFacts.get(topicKey)
    if (!fact
      || JSON.stringify(fact) !== JSON.stringify(variant.systemEvidenceFact)
      || fact.identityMode !== 'exact'
      || fact.essayIdentities.length !== variant.block.systemStudentCount
      || fact.occurrenceCount !== variant.block.occurrenceCount) {
      fail('class_review_candidate_conflict')
    }
  }
  if (systemFacts.size !== systemTopicOwners.size
    || [...systemTopicOwners].some((topicKey) => !systemFacts.has(topicKey))) {
    fail('class_review_candidate_conflict')
  }

  for (let index = 0; index < visible.length; index += 1) {
    const block = visible[index]
    const facts = [...teacherFacts.values()].filter((fact) => fact.topicKey === block.topicKey)
    const systemFact = systemFacts.get(block.topicKey)
    if (block.origin === 'ai') {
      if (facts.length > 0 || !systemFact
        || block.teacherStudentCount !== 0
        || block.systemStudentCount !== block.combinedStudentCount
        || block.supportDenominator === null
        || !Number.isSafeInteger(block.supportDenominator)
        || block.supportDenominator <= 0
        || block.systemStudentCount > block.supportDenominator
        || block.occurrenceCount < block.systemStudentCount
        || block.occurrenceCount !== systemFact.occurrenceCount
        || (systemFact.identityMode === 'exact'
          && systemFact.essayIdentities.length !== block.systemStudentCount)
        || (systemFact.identityMode === 'unavailable_fallback'
          && systemFact.essayIdentities.length !== 0)) {
        fail('class_review_candidate_conflict')
      }
      visible[index] = {
        ...block,
        evidenceRefs: block.evidenceRefs
          .map((ref) => structuredClone(ref))
          .sort((left, right) => compare(left.evidenceId, right.evidenceId)),
        anonymousExamples: [...new Set(block.anonymousExamples)].sort(compare).slice(0, 3),
      }
      continue
    }
    if (facts.length === 0) {
      fail('class_review_candidate_conflict')
    }
    const rebuilt = rebuildTeacherOwnedBlock({
      teacherBlock: block,
      teacherFacts: facts,
      ...(systemFact
        ? { systemBlock: suppressed.get(block.topicKey)?.block ?? block, systemFact }
        : {}),
    })
    if (block.teacherStudentCount !== rebuilt.teacherStudentCount
      || block.systemStudentCount !== rebuilt.systemStudentCount
      || block.combinedStudentCount !== rebuilt.combinedStudentCount
      || block.occurrenceCount !== rebuilt.occurrenceCount
      || block.supportDenominator !== rebuilt.supportDenominator) {
      fail('class_review_candidate_conflict')
    }
    visible[index] = rebuilt
  }
  return {
    visible,
    suppressed,
    teacherFacts,
    systemFacts,
  }
}

export function mergeInternalIssueWorkspace(input: {
  workspace: InternalIssueWorkspace
  nextSystem: readonly ClassReviewIssueBlockV1[]
  generationId: string
  invalidationEpoch: number
  createOpaqueId: () => string
  systemEvidenceFacts?: readonly SystemEvidenceFact[]
}): InternalIssueWorkspace {
  const workspace = createInternalIssueWorkspace(input.workspace.visible, {
    teacherEvidenceFacts: [...input.workspace.teacherFacts.values()],
    systemEvidenceFacts: [...input.workspace.systemFacts.values()],
    issueOrder: input.workspace.visible.map((block) => block.blockId),
    suppressed: input.workspace.suppressed,
  })
  const suppliedSystemFacts = new Map<string, SystemEvidenceFact>()
  for (const sourceFact of input.systemEvidenceFacts ?? []) {
    if (suppliedSystemFacts.has(sourceFact.topicKey)) fail('class_review_candidate_conflict')
    suppliedSystemFacts.set(sourceFact.topicKey, canonicalSystemFact(sourceFact))
  }
  const normalizedNextSystem = input.nextSystem.map((block) => {
    const fact = suppliedSystemFacts.get(block.topicKey)
    if (!fact || block.origin !== 'ai' || block.systemStudentCount <= 0) {
      fail('class_review_candidate_conflict')
    }
    const systemStudentCount = fact.identityMode === 'exact'
      ? fact.essayIdentities.length
      : block.systemStudentCount
    return {
      ...structuredClone(block),
      teacherStudentCount: 0,
      systemStudentCount,
      combinedStudentCount: systemStudentCount,
      occurrenceCount: fact.occurrenceCount,
    }
  })
  const nextWorkspace = createInternalIssueWorkspace(normalizedNextSystem, {
    systemEvidenceFacts: [...suppliedSystemFacts.values()],
    issueOrder: normalizedNextSystem.map((block) => block.blockId),
  })
  const orderedSystem = [...nextWorkspace.visible].sort((left, right) =>
    severityRank[left.severity] - severityRank[right.severity]
    || right.systemStudentCount - left.systemStudentCount
    || right.occurrenceCount - left.occurrenceCount
    || compare(left.topicKey, right.topicKey),
  )
  const byTopic = new Map(orderedSystem.map((block) => [block.topicKey, block]))
  const used = new Set<string>()
  workspace.visible = workspace.visible.flatMap((old) => {
    const next = byTopic.get(old.topicKey)
    if (old.origin === 'teacher') {
      if (!next) {
        workspace.suppressed.delete(old.topicKey)
        const teacherFacts = [...workspace.teacherFacts.values()]
          .filter((fact) => fact.topicKey === old.topicKey)
        return [rebuildTeacherOwnedBlock({ teacherBlock: old, teacherFacts })]
      }
      used.add(old.topicKey)
      const systemFact = nextWorkspace.systemFacts.get(old.topicKey)
      if (!systemFact) fail('class_review_candidate_conflict')
      const teacherFacts = [...workspace.teacherFacts.values()].filter((fact) => fact.topicKey === old.topicKey)
      const variant: SuppressedSystemVariant = {
        block: { ...next, blockId: old.blockId },
        generationId: input.generationId,
        invalidationEpoch: input.invalidationEpoch,
        systemEvidenceFact: systemFact,
      }
      deepFreeze(variant)
      workspace.suppressed.set(old.topicKey, variant)
      return [rebuildTeacherOwnedBlock({
        teacherBlock: old,
        teacherFacts,
        systemBlock: next,
        systemFact,
      })]
    }
    if (!next) return []
    used.add(old.topicKey)
    return [{ ...next, blockId: old.blockId }]
  })
  for (const next of orderedSystem) {
    if (!used.has(next.topicKey) && !workspace.visible.some((block) => block.topicKey === next.topicKey)) {
      workspace.visible.push(structuredClone(next))
    }
  }
  workspace.systemFacts = new Map(nextWorkspace.systemFacts)
  return createInternalIssueWorkspace(workspace.visible, {
    teacherEvidenceFacts: [...workspace.teacherFacts.values()],
    systemEvidenceFacts: [...workspace.systemFacts.values()],
    issueOrder: workspace.visible.map((block) => block.blockId),
    suppressed: workspace.suppressed,
  })
}

export const projectInternalIssueWorkspace = (
  workspace: InternalIssueWorkspace,
): ClassReviewIssueBlockV1[] => structuredClone(workspace.visible)

export function removeTeacherEvidence(
  workspace: InternalIssueWorkspace,
  evidenceId: string,
  options?: { generationId: string; invalidationEpoch: number },
): InternalIssueWorkspace {
  const current = createInternalIssueWorkspace(workspace.visible, {
    teacherEvidenceFacts: [...workspace.teacherFacts.values()],
    systemEvidenceFacts: [...workspace.systemFacts.values()],
    issueOrder: workspace.visible.map((block) => block.blockId),
    suppressed: workspace.suppressed,
  })
  if (!current.teacherFacts.has(evidenceId)) fail('class_review_candidate_conflict')
  const teacherFacts = new Map(current.teacherFacts)
  teacherFacts.delete(evidenceId)
  const suppressed = new Map(current.suppressed)
  const systemFacts = new Map(current.systemFacts)
  const visible = current.visible.flatMap((block): ClassReviewIssueBlockV1[] => {
    if (block.origin === 'ai') return [structuredClone(block)]
    const facts = [...teacherFacts.values()].filter((fact) => fact.topicKey === block.topicKey)
    const variant = suppressed.get(block.topicKey)
    if (facts.length > 0) {
      const systemFact = systemFacts.get(block.topicKey)
      return [rebuildTeacherOwnedBlock({
        teacherBlock: block,
        teacherFacts: facts,
        ...(systemFact
          ? { systemBlock: variant?.block ?? block, systemFact }
          : {}),
      })]
    }
    const restorable = variant !== undefined
      && (!options || (variant.generationId === options.generationId
        && variant.invalidationEpoch === options.invalidationEpoch))
    suppressed.delete(block.topicKey)
    if (!restorable) {
      systemFacts.delete(block.topicKey)
      return []
    }
    return [{
      ...structuredClone(variant.block),
      blockId: block.blockId,
      evidenceRefs: variant.block.evidenceRefs
        .filter((ref) => ref.selectionOrigin === 'system_generation')
        .map((ref) => structuredClone(ref))
        .sort((left, right) => compare(left.evidenceId, right.evidenceId)),
      anonymousExamples: [...new Set(variant.block.anonymousExamples)].sort(compare).slice(0, 3),
    }]
  })
  return createInternalIssueWorkspace(visible, {
    teacherEvidenceFacts: [...teacherFacts.values()],
    systemEvidenceFacts: [...systemFacts.values()],
    issueOrder: visible.map((block) => block.blockId),
    suppressed,
  })
}

export function invalidateInternalSystemVariants(
  workspace: InternalIssueWorkspace,
  _epoch: number,
  removedTeacherEvidenceIds: readonly string[] = [],
): InternalIssueWorkspace {
  const removed = new Set(removedTeacherEvidenceIds)
  if (removed.size !== removedTeacherEvidenceIds.length) fail('class_review_candidate_conflict')
  const teacherFacts = [...workspace.teacherFacts.values()]
    .filter((fact) => !removed.has(fact.evidenceId))
    .map((fact) => structuredClone(fact))
  const visible = workspace.visible.flatMap((block): ClassReviewIssueBlockV1[] => {
    if (block.origin !== 'teacher') return []
    const facts = teacherFacts.filter((fact) => fact.topicKey === block.topicKey)
    return facts.length === 0
      ? []
      : [rebuildTeacherOwnedBlock({ teacherBlock: block, teacherFacts: facts })]
  })
  return createInternalIssueWorkspace(visible, {
    teacherEvidenceFacts: teacherFacts,
    issueOrder: visible.map((block) => block.blockId),
  })
}

function mergeGeneratedClassReviewPayloadIntoWorkspace(input: {
  payload: GeneratedClassReviewPayload
  currentReport: ClassReviewReportV1
  currentIssueWorkspace: InternalIssueWorkspace
}): { report: ClassReviewReportV1; issueWorkspace: InternalIssueWorkspace } {
  const currentDimensionIds = new Set(input.currentReport.statistics.dimensions.map((dimension) => dimension.dimensionId))
  if (input.payload.generatedPayload.aiSummary.strengths.some((strength) =>
    strength.dimensionIds.some((dimensionId) => !currentDimensionIds.has(dimensionId)))) {
    fail('class_review_candidate_conflict')
  }
  const issueWorkspace = mergeInternalIssueWorkspace({
    workspace: input.currentIssueWorkspace,
    nextSystem: input.payload.generatedPayload.systemIssueBlocks,
    generationId: input.payload.generationId,
    invalidationEpoch: input.payload.invalidationEpoch,
    createOpaqueId: () => fail('class_review_candidate_conflict'),
    systemEvidenceFacts: input.payload.generatedPayload.systemEvidenceFacts,
  })
  const issueBlocks = projectInternalIssueWorkspace(issueWorkspace)
  const candidate: ClassReviewReportV1 = {
    ...input.currentReport,
    workspaceState: 'ai_available',
    reportRevision: (input.currentReport.reportRevision ?? 0) + 1,
    currentGeneration: null,
    statistics: structuredClone(input.currentReport.statistics),
    issueBlocks,
    issueOrder: issueBlocks.map((block) => block.blockId),
    appliedGenerationId: input.payload.generationId,
    generatedAt: input.payload.generatedPayload.generatedAt,
    snapshotMetadata: structuredClone(input.payload.generatedPayload.snapshotMetadata),
    aiSummary: structuredClone(input.payload.generatedPayload.aiSummary),
  }
  const parsed = parseClassReviewReport(candidate)
  if (!parsed.ok) fail('class_review_candidate_conflict')
  return { report: parsed.value, issueWorkspace }
}

export function applyMaterializedClassReviewCandidate(input: {
  handle: MaterializedClassReviewCandidateHandle
  currentReport: ClassReviewReportV1
  currentIssueWorkspace: InternalIssueWorkspace
}): { report: ClassReviewReportV1; issueWorkspace: InternalIssueWorkspace } {
  return mergeGeneratedClassReviewPayloadIntoWorkspace({
    payload: requireMaterializedPayload(input.handle),
    currentReport: input.currentReport,
    currentIssueWorkspace: input.currentIssueWorkspace,
  })
}
