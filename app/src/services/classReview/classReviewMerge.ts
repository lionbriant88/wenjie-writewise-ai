import { parseClassReviewReport } from './classReviewContracts'
import type { ClassReviewProjectionHiddenStateV1, HiddenMustCoverFallbackV1, HiddenSelectedGroupV1 } from './classReviewProjection'
import { deriveCompositeTopicKey, type TopicHmac, type TopicIdentity } from './classReviewTopicKey'
import { parseClassReviewSynthesisResult } from './synthesisContracts'
import type { ClassReviewIssueBlockV1, ClassReviewProviderOutputV1, ClassReviewReportV1, ClassReviewStatisticsV1, ClassReviewSynthesisRequestV1, Severity, SynthesisGroupV1 } from './types'

function fail(code: string): never {
  throw new Error(code)
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function checkedAdd(left: number, right: number): number {
  const sum = left + right
  if (!Number.isSafeInteger(sum) || sum < 0) fail('hidden_snapshot_invalid')
  return sum
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
const LOGIC_LABEL = { weak_connection: '衔接薄弱', unclear_logic: '逻辑不清', missing_cause_effect: '因果缺失', unclear_transition: '过渡不清', topic_drift: '偏离主题', irrelevant_sentence: '无关句', unclear_reference: '指代不清', missing_motivation: '动机缺失', plot_gap: '情节断裂' } as const

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

export async function materializeSystemIssueBlocks(input: {
  providerOutput: ClassReviewProviderOutputV1
  hidden: ClassReviewProjectionHiddenStateV1
  issueEligibleEssayCount: number
  topicHmac: TopicHmac
  createOpaqueId: () => string
  admittedGroups?: readonly SynthesisGroupV1[]
  projectedGroups?: readonly SynthesisGroupV1[]
}) {
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
  const requiredSupport = Math.max(input.issueEligibleEssayCount < 10 ? 2 : 3, Math.ceil(input.issueEligibleEssayCount * 0.2))

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
    const examples = members.flatMap((member) => member.excerpt?.originalText.status === 'kept' ? [{ topicKey: member.atomicTopic.key, evidenceKey: member.excerpt.originalText.scrubbedEvidenceKey, text: member.excerpt.originalText.text }] : [])
      .sort((a, b) => compare(a.topicKey, b.topicKey) || compare(a.evidenceKey, b.evidenceKey) || compare(a.text, b.text))
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
    const content: HiddenMustCoverFallbackV1['content'] = member.title.status === 'kept' && member.excerpt?.suggestionOrDiagnosis.status === 'kept'
      ? { kind: 'scrubbed', title: { text: member.title.text, scrubbedEvidenceKey: member.title.scrubbedEvidenceKey }, diagnosis: { text: member.excerpt.suggestionOrDiagnosis.text, scrubbedEvidenceKey: member.excerpt.suggestionOrDiagnosis.scrubbedEvidenceKey }, teachingTemplate: group.type }
      : { kind: 'template', template: group.type === 'logic' ? `logic_${group.subtype ?? 'unclear_logic'}` : group.type }
    fallbacks.set(identityTuple(member.atomicTopic), { atomicTopic: member.atomicTopic, type: group.type, subtype: group.subtype, severity: group.severity, distinctEssaySupport: member.essayIds.length, occurrenceCount: member.occurrenceCount, content, anonymousExample: null })
  }
  for (const item of fallbacks.values()) {
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
  }
  issueBlocks.sort((left, right) => severityRank[left.severity] - severityRank[right.severity]
    || right.systemStudentCount - left.systemStudentCount
    || right.occurrenceCount - left.occurrenceCount
    || compare(left.topicKey, right.topicKey))
  return { issueBlocks, consumedMustCover }
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
  const clone = structuredClone(input)
  deepFreeze(clone)
  return clone
}

export async function materializeClassReviewCandidate(input: {
  snapshot: Readonly<GenerationSnapshot>
  untrustedResult: unknown
  currentReport: ClassReviewReportV1
  topicHmac: TopicHmac
  createOpaqueId: () => string
  now: () => string
}) {
  const parsed = parseClassReviewSynthesisResult(input.untrustedResult, input.snapshot.originalRequest)
  if (!parsed.ok || parsed.value.status !== 'succeeded') fail('provider_invalid_response')
  const admittedGroups = input.snapshot.originalRequest.groups.slice(0, parsed.value.semanticCoverage.projectedGroupCount)
  const system = await materializeSystemIssueBlocks({
    providerOutput: parsed.value.output,
    hidden: input.snapshot.hidden,
    issueEligibleEssayCount: input.snapshot.originalRequest.statistics.issueEligibleEssayCount,
    topicHmac: input.topicHmac,
    createOpaqueId: () => 'pending-system-block',
    admittedGroups,
    projectedGroups: input.snapshot.originalRequest.groups,
  })
  const issueWorkspace = mergeInternalIssueWorkspace({
    workspace: createInternalIssueWorkspace(input.currentReport.issueBlocks),
    nextSystem: system.issueBlocks,
    generationId: input.snapshot.generationId,
    invalidationEpoch: input.snapshot.invalidationEpoch,
    createOpaqueId: input.createOpaqueId,
  })
  const reverseAliases = new Map([...input.snapshot.hidden.dimensionAliases].map(([dimensionId, alias]) => [alias, dimensionId]))
  const allBlocks = projectInternalIssueWorkspace(issueWorkspace)
  const generatedAt = input.now()
  const candidate: ClassReviewReportV1 = {
    ...input.currentReport,
    workspaceState: 'ai_available',
    taskRevision: input.snapshot.taskRevision,
    reportRevision: (input.currentReport.reportRevision ?? 0) + 1,
    currentGeneration: null,
    statistics: input.snapshot.browserStatistics,
    issueBlocks: allBlocks,
    issueOrder: allBlocks.map((block) => block.blockId),
    appliedGenerationId: input.snapshot.generationId,
    generatedAt,
    snapshotMetadata: {
      includedEssayCount: input.snapshot.originalRequest.statistics.includedEssayCount,
      issueEligibleEssayCount: input.snapshot.originalRequest.statistics.issueEligibleEssayCount,
      totalEssayCount: input.snapshot.originalRequest.statistics.totalEssayCount,
      semanticCoverage: parsed.value.semanticCoverage,
    },
    aiSummary: {
      overallComment: parsed.value.output.overallComment,
      strengths: parsed.value.output.strengths.map((strength) => ({
        ...strength,
        dimensionIds: strength.dimensionIds.map((alias) => reverseAliases.get(alias) ?? alias),
      })),
      learningRecommendations: parsed.value.output.learningRecommendations,
    },
  }
  const validated = parseClassReviewReport(candidate)
  if (!validated.ok) fail('class_review_candidate_invalid')
  return { report: validated.value, semanticCoverage: parsed.value.semanticCoverage }
}

export interface TeacherEvidenceFact {
  topicKey: string
  evidenceId: string
  essayIdentity: string
  occurrenceCount: number
}

export interface SystemEvidenceFact {
  topicKey: string
  essayIdentities: readonly string[]
  occurrenceCount: number
}

interface SuppressedSystemVariant {
  block: ClassReviewIssueBlockV1
  generationId: string
  invalidationEpoch: number
}

export interface InternalIssueWorkspace {
  visible: ClassReviewIssueBlockV1[]
  suppressed: Map<string, SuppressedSystemVariant>
  teacherFacts: Map<string, TeacherEvidenceFact>
}

export function createInternalIssueWorkspace(
  blocks: readonly ClassReviewIssueBlockV1[],
  options?: { teacherEvidenceFacts?: readonly TeacherEvidenceFact[] },
): InternalIssueWorkspace {
  return {
    visible: structuredClone([...blocks]),
    suppressed: new Map(),
    teacherFacts: new Map((options?.teacherEvidenceFacts ?? []).map((fact) => [fact.evidenceId, { ...fact }])),
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
  const workspace = createInternalIssueWorkspace(input.workspace.visible, { teacherEvidenceFacts: [...input.workspace.teacherFacts.values()] })
  workspace.suppressed = new Map(input.workspace.suppressed)
  const orderedSystem = [...input.nextSystem].sort((left, right) => severityRank[left.severity] - severityRank[right.severity]
    || right.systemStudentCount - left.systemStudentCount
    || right.occurrenceCount - left.occurrenceCount
    || compare(left.topicKey, right.topicKey))
  const byTopic = new Map(orderedSystem.map((block) => [block.topicKey, block]))
  const used = new Set<string>()
  workspace.visible = workspace.visible.flatMap((old) => {
    const next = byTopic.get(old.topicKey)
    if (old.origin === 'teacher') {
      if (!next) return [old]
      used.add(old.topicKey)
      const systemFact = input.systemEvidenceFacts?.find((fact) => fact.topicKey === old.topicKey)
      const teacherFacts = [...workspace.teacherFacts.values()].filter((fact) => fact.topicKey === old.topicKey)
      const teacherEssays = new Set(teacherFacts.map((fact) => fact.essayIdentity))
      const systemEssays = new Set(systemFact?.essayIdentities ?? [])
      const combinedEssays = new Set([...teacherEssays, ...systemEssays])
      let extraOccurrences = 0
      for (const fact of teacherFacts) {
        if (!systemEssays.has(fact.essayIdentity)) {
          extraOccurrences = checkedAdd(extraOccurrences, fact.occurrenceCount)
        }
      }
      workspace.suppressed.set(old.topicKey, {
        block: { ...next, blockId: old.blockId },
        generationId: input.generationId,
        invalidationEpoch: input.invalidationEpoch,
      })
      return [{
        ...old,
        teacherStudentCount: teacherEssays.size,
        systemStudentCount: systemEssays.size,
        combinedStudentCount: combinedEssays.size,
        occurrenceCount: checkedAdd(systemFact?.occurrenceCount ?? next.occurrenceCount, extraOccurrences),
        evidenceRefs: [
          ...old.evidenceRefs.filter((ref) => ref.selectionOrigin === 'teacher_selected'),
          ...next.evidenceRefs.filter((ref) => ref.selectionOrigin === 'system_generation'),
        ],
      }]
    }
    if (!next) return []
    used.add(old.topicKey)
    return [{ ...next, blockId: old.blockId }]
  })
  for (const next of orderedSystem) {
    if (!used.has(next.topicKey) && !workspace.visible.some((block) => block.topicKey === next.topicKey)) {
      workspace.visible.push({ ...next, blockId: input.createOpaqueId() })
    }
  }
  return workspace
}

export const projectInternalIssueWorkspace = (workspace: InternalIssueWorkspace): ClassReviewIssueBlockV1[] => structuredClone(workspace.visible)

export function removeTeacherEvidence(workspace: InternalIssueWorkspace, evidenceId: string): InternalIssueWorkspace {
  const result = createInternalIssueWorkspace(workspace.visible, {
    teacherEvidenceFacts: [...workspace.teacherFacts.values()].filter((fact) => fact.evidenceId !== evidenceId),
  })
  result.suppressed = new Map(workspace.suppressed)
  result.visible = result.visible.flatMap((block) => {
    const evidenceRefs = block.evidenceRefs.filter((ref) => ref.evidenceId !== evidenceId)
    if (evidenceRefs.some((ref) => ref.selectionOrigin === 'teacher_selected')) {
      return [{ ...block, evidenceRefs }]
    }
    const variant = result.suppressed.get(block.topicKey)
    return variant
      ? [{ ...variant.block, evidenceRefs: variant.block.evidenceRefs.filter((ref) => ref.selectionOrigin === 'system_generation') }]
      : []
  })
  return result
}

export function invalidateInternalSystemVariants(workspace: InternalIssueWorkspace, _epoch: number): InternalIssueWorkspace {
  return createInternalIssueWorkspace(
    workspace.visible
      .filter((block) => block.origin === 'teacher')
      .map((block) => ({
        ...block,
        evidenceRefs: block.evidenceRefs.filter((ref) => ref.selectionOrigin === 'teacher_selected'),
      })),
    { teacherEvidenceFacts: [...workspace.teacherFacts.values()] },
  )
}
