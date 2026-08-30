import { describe, expect, it } from 'vitest'
import type { ClassReviewIssueBlockV1, ClassReviewProviderOutputV1, ClassReviewReportV1, ClassReviewSynthesisRequestV1, ClassReviewSynthesisResultV1 } from './types'
import type { ClassReviewProjectionHiddenStateV1 } from './classReviewProjection'
import { createInMemoryTopicKeyRegistry, type TopicHmac, type TopicIdentity } from './classReviewTopicKey'
import { cloneAndFreezeClassReviewGenerationSnapshot, createInternalIssueWorkspace, invalidateInternalSystemVariants, materializeClassReviewCandidate, materializeSystemIssueBlocks, mergeInternalIssueWorkspace, projectInternalIssueWorkspace, removeTeacherEvidence } from './classReviewMerge'

function topic(key: string): TopicIdentity {
  const suffix = key.replace(/[^a-f0-9]/g, '').padEnd(16, 'a').slice(0, 16)
  return { kind: 'atomic', keyVersion: 'topic-key-v1', taskScope: `scope_v1_${'1'.repeat(32)}`, key: `tk1.${suffix}`, fingerprintDigest: `fp1.${suffix.padEnd(64, 'b')}` }
}
const kept = (text: string, scrubbedEvidenceKey: string) => ({ status: 'kept' as const, text, redactionVersion: 'class-review-redaction-v1' as const, scrubbedEvidenceKey })

function hidden(): ClassReviewProjectionHiddenStateV1 {
  return {
    dimensionAliases: new Map(),
    selectedGroups: new Map([
      ['g1', { atomicTopic: topic('a'), title: kept('Grammar', 'ev1'), excerpt: { originalText: kept('I goes home.', 'ev2'), suggestionOrDiagnosis: kept('Subject verb agreement', 'ev3') }, essayIds: ['e1', 'e2'], occurrenceCount: 3 }],
      ['g2', { atomicTopic: topic('b'), title: kept('Word choice', 'ev4'), excerpt: { originalText: kept('filling happy', 'ev5'), suggestionOrDiagnosis: kept('Use feeling', 'ev6') }, essayIds: ['e2', 'e3'], occurrenceCount: 2 }],
      ['g3', { atomicTopic: topic('c'), title: kept('Rare', 'ev7'), excerpt: null, essayIds: ['e4'], occurrenceCount: 1 }],
    ]),
    unprojectedMustCover: [{ atomicTopic: topic('d'), type: 'logic', subtype: 'unclear_logic', severity: 'medium', distinctEssaySupport: 2, occurrenceCount: 2, content: { kind: 'template', template: 'logic_unclear_logic' }, anonymousExample: null }],
  }
}

function output(patterns: ClassReviewProviderOutputV1['patterns']): ClassReviewProviderOutputV1 {
  return { overallComment: 'Class comment', strengths: [{ title: 'Strength', detail: 'Good effort', dimensionIds: [] }], patterns, learningRecommendations: [{ title: 'Practice', action: 'Revise daily' }] }
}

function hmac(): TopicHmac {
  return {
    registry: createInMemoryTopicKeyRegistry(),
    digest: async (_domain, bytes) => {
      const out = new Uint8Array(32)
      bytes.forEach((byte, index) => { out[index % 32] = (out[index % 32] + byte + index) % 256 })
      return out
    },
  }
}

function frozenRequest(): ClassReviewSynthesisRequestV1 {
  const groups = [
    { groupId: 'g1', type: 'grammar' as const, subtype: null, severity: 'high' as const, title: 'G1', mustCover: true, distinctEssaySupport: 2, occurrenceCount: 3, excerpt: null },
    { groupId: 'g2', type: 'word_choice' as const, subtype: null, severity: 'medium' as const, title: 'G2', mustCover: true, distinctEssaySupport: 2, occurrenceCount: 2, excerpt: null },
    { groupId: 'g3', type: 'structure' as const, subtype: null, severity: 'low' as const, title: 'G3', mustCover: true, distinctEssaySupport: 1, occurrenceCount: 1, excerpt: null },
  ]
  return { contractVersion: 'class-review-synthesis-request-v1', requestId: 'request-1', rubricRevisionDigest: 'a'.repeat(64), policyVersion: 'class-review-policy-v1', schemaVersion: 'kimi-class-review-output-v1', projectionVersion: 'class-review-projection-v1', budgetVersion: 'class-review-prompt-budget-v1', statistics: { includedEssayCount: 4, issueEligibleEssayCount: 4, totalEssayCount: 4, excludedEssayCount: 0, score: { fullScore: 100, averageScore: 80, highestScore: 90, lowestScore: 70, medianScore: 80 }, scoreBands: [], dimensions: [], issueCounters: [] }, groups, semanticCoverage: { projectedGroupCount: 3, eligibleGroupCount: 3, groupCoverage: 1, projectedDistinctEssaySupportSum: 5, eligibleDistinctEssaySupportSum: 5, supportWeightedCoverage: 1, projectedOccurrenceSum: 6, eligibleOccurrenceSum: 6, occurrenceWeightedCoverage: 1 }, outputLimits: { maxCompletionTokens: 3072, maxVisibleCodePoints: 2200, maxJsonUtf8Bytes: 16384 } }
}

function browserReport(): ClassReviewReportV1 {
  return { contractVersion: 'class-review-report-v1', workspaceState: 'draft', taskRevision: 1, reportRevision: 1, aiTextEditRevision: 0, currentGeneration: null, statistics: { totalEssayCount: 4, includedEssayCount: 4, issueEligibleEssayCount: 4, excludedEssayCount: 0, issueCoverageRate: 1, fullScore: 100, scoreSummary: { averageScore: 80, highestScore: 90, lowestScore: 70 }, scoreBands: [], dimensions: [] }, issueBlocks: [], issueOrder: [], clearSpellingItems: [], selectedMaterials: [] }
}

describe('frozen generation merge boundary', () => {
  it('deep-clones/freezes the full snapshot, parses unknown result, honors first-K, and produces a complete valid report candidate', async () => {
    const request = frozenRequest()
    const mutableHidden = hidden()
    const snapshot = cloneAndFreezeClassReviewGenerationSnapshot({ originalRequest: request, hidden: mutableHidden, generationId: 'generation-1', invalidationEpoch: 0, executionIdentity: 'execution-1', payloadDigest: 'digest-1', taskRevision: 1, reportRevision: 1, aiTextEditRevision: 0, sourceRevisionEpoch: 0, browserStatistics: browserReport().statistics })
    request.groups[0].title = 'MUTATED'
    ;(mutableHidden.selectedGroups.get('g1')!.essayIds as string[])[0] = 'mutated-essay'
    const result: unknown = { contractVersion: 'class-review-synthesis-result-v1', requestId: 'request-1', status: 'succeeded', output: output([{ groupIds: ['g1', 'g2'], title: 'Combined', diagnosis: 'D', teachingAction: 'A', severity: 'high' }]), semanticCoverage: { ...frozenRequest().semanticCoverage, projectedGroupCount: 2, projectedDistinctEssaySupportSum: 4, projectedOccurrenceSum: 5, groupCoverage: 2 / 3, supportWeightedCoverage: 4 / 5, occurrenceWeightedCoverage: 5 / 6 }, finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20, cachedTokens: 0 }, timingsMs: { queueMs: 0, providerMs: 1, validationMs: 0, totalMs: 1 } }
    let nextBlock = 0
    const candidate = await materializeClassReviewCandidate({ snapshot, untrustedResult: result, currentReport: browserReport(), topicHmac: hmac(), createOpaqueId: () => `block-${++nextBlock}`, now: () => '2026-08-30T00:00:00.000Z' })
    expect(candidate.report.statistics).toEqual(browserReport().statistics)
    expect(candidate.report.issueBlocks[0]).toMatchObject({ systemStudentCount: 3, occurrenceCount: 5, evidenceRefs: [] })
    expect(candidate.report.issueBlocks).toContainEqual(expect.objectContaining({
      topicKey: topic('c').key,
      title: '篇章结构',
    }))
    expect(candidate.report.issueBlocks.some((block) => block.title === 'MUTATED')).toBe(false)
    expect(Object.isFrozen(snapshot.originalRequest.groups)).toBe(true)
    const prior = browserReport(); const priorBytes = JSON.stringify(prior)
    await expect(materializeClassReviewCandidate({ snapshot, untrustedResult: result, currentReport: prior, topicHmac: hmac(), createOpaqueId: (() => { let n = 0; return () => `invalid-${++n}` })(), now: () => 'not-a-time' })).rejects.toThrow('class_review_candidate_invalid')
    expect(JSON.stringify(prior)).toBe(priorBytes)
  })

  it('rejects malformed/duplicate/cross-generation results atomically without a partial candidate', async () => {
    const snapshot = cloneAndFreezeClassReviewGenerationSnapshot({ originalRequest: frozenRequest(), hidden: hidden(), generationId: 'generation-1', invalidationEpoch: 0, executionIdentity: 'execution-1', payloadDigest: 'digest-1', taskRevision: 1, reportRevision: 1, aiTextEditRevision: 0, sourceRevisionEpoch: 0, browserStatistics: browserReport().statistics })
    await expect(materializeClassReviewCandidate({ snapshot, untrustedResult: { status: 'succeeded' }, currentReport: browserReport(), topicHmac: hmac(), createOpaqueId: () => 'block', now: () => '2026-08-30T00:00:00.000Z' })).rejects.toThrow('provider_invalid_response')
  })

  it('preserves an existing AI topic block id and allocates only newly visible system blocks', async () => {
    const firstRequest = frozenRequest()
    const firstSnapshot = cloneAndFreezeClassReviewGenerationSnapshot({ originalRequest: firstRequest, hidden: hidden(), generationId: 'generation-1', invalidationEpoch: 0, executionIdentity: 'execution-1', payloadDigest: 'digest-1', taskRevision: 1, reportRevision: 1, aiTextEditRevision: 0, sourceRevisionEpoch: 0, browserStatistics: browserReport().statistics })
    const firstResult: ClassReviewSynthesisResultV1 = { contractVersion: 'class-review-synthesis-result-v1', requestId: firstRequest.requestId, status: 'succeeded', output: output([{ groupIds: ['g1'], title: 'First', diagnosis: 'D', teachingAction: 'A', severity: 'high' }]), semanticCoverage: firstRequest.semanticCoverage, finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20, cachedTokens: 0 }, timingsMs: { queueMs: 0, providerMs: 1, validationMs: 0, totalMs: 1 } }
    let allocations = 0
    const first = await materializeClassReviewCandidate({ snapshot: firstSnapshot, untrustedResult: firstResult, currentReport: browserReport(), topicHmac: hmac(), createOpaqueId: () => `block-${++allocations}`, now: () => '2026-08-30T00:00:00.000Z' })
    const surviving = first.report.issueBlocks.find((block) => block.topicKey === topic('a').key)
    expect(surviving?.blockId).toBe('block-1')

    const secondRequest = { ...frozenRequest(), requestId: 'request-2' }
    const secondSnapshot = cloneAndFreezeClassReviewGenerationSnapshot({ originalRequest: secondRequest, hidden: hidden(), generationId: 'generation-2', invalidationEpoch: 0, executionIdentity: 'execution-2', payloadDigest: 'digest-2', taskRevision: 1, reportRevision: first.report.reportRevision, aiTextEditRevision: 0, sourceRevisionEpoch: 0, browserStatistics: browserReport().statistics })
    const secondResult: ClassReviewSynthesisResultV1 = { ...firstResult, requestId: secondRequest.requestId, output: output([{ groupIds: ['g1'], title: 'Updated', diagnosis: 'D2', teachingAction: 'A2', severity: 'high' }]) }
    allocations = 0
    const second = await materializeClassReviewCandidate({ snapshot: secondSnapshot, untrustedResult: secondResult, currentReport: first.report, topicHmac: hmac(), createOpaqueId: () => `unexpected-${++allocations}`, now: () => '2026-08-30T00:00:01.000Z' })
    expect(second.report.issueBlocks.find((block) => block.topicKey === topic('a').key)).toMatchObject({ blockId: 'block-1', title: 'Updated' })
    expect(allocations).toBe(0)
  })
})

describe('materializeSystemIssueBlocks', () => {
  it('recomputes union support, occurrences, denominator, composite identity and scrubbed examples', async () => {
    const result = await materializeSystemIssueBlocks({
      providerOutput: output([{ groupIds: ['g2', 'g1'], title: 'Shared', diagnosis: 'Diagnosis', teachingAction: 'Action', severity: 'high' }]),
      hidden: hidden(), issueEligibleEssayCount: 10, topicHmac: hmac(), createOpaqueId: () => 'block-1',
    })
    expect(result.issueBlocks).toHaveLength(2) // pattern + omitted must-cover fallback
    expect(result.issueBlocks[0]).toMatchObject({ origin: 'ai', systemStudentCount: 3, combinedStudentCount: 3, occurrenceCount: 5, supportDenominator: 10 })
    expect(result.issueBlocks[0].topicKey).toMatch(/^tk1\./)
    expect(result.issueBlocks[0].anonymousExamples).toEqual(['I goes home.', 'filling happy'])
    expect(result.issueBlocks[1]).toMatchObject({ topicKey: topic('d').key, origin: 'ai', title: '逻辑与连贯：逻辑不清', diagnosis: '多篇作文出现同类逻辑不清问题。', teachingAction: '结合上下文梳理关系，并安排衔接与因果表达练习。', anonymousExamples: [] })
  })

  it('drops sub-threshold patterns and emits each must-cover fallback exactly once, including zero-pattern success', async () => {
    const result = await materializeSystemIssueBlocks({ providerOutput: output([{ groupIds: ['g3'], title: 'Rare', diagnosis: 'D', teachingAction: 'A', severity: 'low' }]), hidden: hidden(), issueEligibleEssayCount: 10, topicHmac: hmac(), createOpaqueId: (() => { let n = 0; return () => `b${++n}` })() })
    expect(result.issueBlocks.map((block) => block.topicKey)).toEqual([topic('d').key])
    const empty = await materializeSystemIssueBlocks({ providerOutput: output([]), hidden: hidden(), issueEligibleEssayCount: 10, topicHmac: hmac(), createOpaqueId: () => 'fallback' })
    expect(empty.issueBlocks.map((block) => block.topicKey)).toEqual([topic('d').key])
  })

  it('rejects unknown, cross-snapshot and duplicate group ownership', async () => {
    const base = { hidden: hidden(), issueEligibleEssayCount: 3, topicHmac: hmac(), createOpaqueId: () => 'b' }
    await expect(materializeSystemIssueBlocks({ ...base, providerOutput: output([{ groupIds: ['outside'], title: 'x', diagnosis: 'd', teachingAction: 'a', severity: 'low' }]) })).rejects.toThrow('unknown_group')
    await expect(materializeSystemIssueBlocks({ ...base, providerOutput: output([
      { groupIds: ['g1'], title: 'x', diagnosis: 'd', teachingAction: 'a', severity: 'low' },
      { groupIds: ['g1'], title: 'y', diagnosis: 'd', teachingAction: 'a', severity: 'low' },
    ]) })).rejects.toThrow('duplicate_group_ownership')
  })
})

describe('internal mixed teacher/system workspace', () => {
  const teacher = (id: string, key: string): ClassReviewIssueBlockV1 => ({ blockId: id, topicKey: key, origin: 'teacher', title: id, diagnosis: 'd', teachingAction: 'a', severity: 'medium', teacherStudentCount: 1, systemStudentCount: 0, combinedStudentCount: 1, occurrenceCount: 1, supportDenominator: null, anonymousExamples: [], evidenceRefs: [{ evidenceId: `t-${id}`, selectionOrigin: 'teacher_selected', sourceLocator: 'src', sourceResultRevision: 1, anonymousExample: null }] })
  const ai = (id: string, key: string): ClassReviewIssueBlockV1 => ({ ...teacher(id, key), origin: 'ai', teacherStudentCount: 0, systemStudentCount: 2, combinedStudentCount: 2, supportDenominator: 3, evidenceRefs: [{ evidenceId: `s-${id}`, selectionOrigin: 'system_generation', sourceLocator: 'grp', sourceResultRevision: 1, anonymousExample: null }] })

  it('preserves teacher order and surviving block IDs while deterministic new system order allocates IDs only for new visible blocks', () => {
    const createOpaqueId = (() => { let n = 0; return () => `new-${++n}` })()
    const workspace = createInternalIssueWorkspace([teacher('t1', 'teacher.1'), ai('old-a', 'tk1.a'), teacher('t2', 'teacher.2'), ai('vanished', 'tk1.z')])
    const merged = mergeInternalIssueWorkspace({ workspace, nextSystem: [ai('new-c', 'tk1.c'), ai('new-a', 'tk1.a'), ai('new-b', 'tk1.b')], generationId: 'generation-1', invalidationEpoch: 0, createOpaqueId })
    expect(projectInternalIssueWorkspace(merged).map((item) => [item.topicKey, item.blockId])).toEqual([['teacher.1', 't1'], ['tk1.a', 'old-a'], ['teacher.2', 't2'], ['tk1.b', 'new-1'], ['tk1.c', 'new-2']])
  })

  it('retains teacher-first/system evidence and identity-union counts, restores at the same slot, but never after invalidation', () => {
    const teacherBlock = teacher('t', 'tk1.a')
    teacherBlock.evidenceRefs = [{ evidenceId: 'teacher-evidence', selectionOrigin: 'teacher_selected', sourceLocator: 'teacher-source', sourceResultRevision: 1, anonymousExample: null }]
    const system = ai('system', 'tk1.a')
    system.evidenceRefs = [{ evidenceId: 'system-evidence', selectionOrigin: 'system_generation', sourceLocator: 'system-source', sourceResultRevision: 1, anonymousExample: null }]
    const base = createInternalIssueWorkspace([teacherBlock], { teacherEvidenceFacts: [{ topicKey: 'tk1.a', evidenceId: 'teacher-evidence', essayIdentity: 'essay-overlap', occurrenceCount: 2 }] })
    const mixed = mergeInternalIssueWorkspace({ workspace: base, nextSystem: [system], generationId: 'generation-1', invalidationEpoch: 0, createOpaqueId: () => 'must-not-run', systemEvidenceFacts: [{ topicKey: 'tk1.a', essayIdentities: ['essay-overlap', 'essay-system'], occurrenceCount: 3 }] })
    expect(projectInternalIssueWorkspace(mixed)[0]).toMatchObject({ origin: 'teacher', teacherStudentCount: 1, systemStudentCount: 2, combinedStudentCount: 2, occurrenceCount: 3 })
    expect(projectInternalIssueWorkspace(mixed)[0].evidenceRefs.map((ref) => ref.selectionOrigin)).toEqual(['teacher_selected', 'system_generation'])
    const restored = removeTeacherEvidence(mixed, 'teacher-evidence')
    expect(projectInternalIssueWorkspace(restored)[0]).toMatchObject({ blockId: 't', origin: 'ai' })
    const invalidated = invalidateInternalSystemVariants(mixed, 1)
    expect(projectInternalIssueWorkspace(removeTeacherEvidence(invalidated, 'teacher-evidence'))).toHaveLength(0)
  })
})
