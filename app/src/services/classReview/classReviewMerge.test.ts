import { describe, expect, it } from 'vitest'
import type { ClassReviewIssueBlockV1, ClassReviewProviderOutputV1, ClassReviewReportV1, ClassReviewSynthesisRequestV1, ClassReviewSynthesisResultV1 } from './types'
import type { ClassReviewProjectionHiddenStateV1 } from './classReviewProjection'
import { createInMemoryTopicKeyRegistry, type TopicHmac, type TopicIdentity } from './classReviewTopicKey'
import { classReviewSupportThreshold } from './aggregateClassReview'
import { applyMaterializedClassReviewCandidate, cloneAndFreezeClassReviewGenerationSnapshot, createInternalIssueWorkspace, invalidateInternalSystemVariants, materializeClassReviewCandidate as materializeClassReviewCandidateHandle, mergeInternalIssueWorkspace, projectInternalIssueWorkspace, removeTeacherEvidence, type SystemEvidenceFact } from './classReviewMerge'
import * as classReviewMergeModule from './classReviewMerge'

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
    unprojectedMustCover: [{ atomicTopic: topic('d'), type: 'logic', subtype: 'unclear_logic', severity: 'medium', distinctEssaySupport: 3, occurrenceCount: 3, content: { kind: 'template', template: 'logic_unclear_logic' }, anonymousExample: null }],
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
    { groupId: 'g1', type: 'grammar' as const, subtype: null, severity: 'high' as const, title: 'Grammar', mustCover: true, distinctEssaySupport: 2, occurrenceCount: 3, excerpt: { originalText: 'I goes home.', suggestionOrDiagnosis: 'Subject verb agreement' } },
    { groupId: 'g2', type: 'word_choice' as const, subtype: null, severity: 'medium' as const, title: 'Word choice', mustCover: true, distinctEssaySupport: 2, occurrenceCount: 2, excerpt: { originalText: 'filling happy', suggestionOrDiagnosis: 'Use feeling' } },
    { groupId: 'g3', type: 'structure' as const, subtype: null, severity: 'low' as const, title: 'Rare', mustCover: false, distinctEssaySupport: 1, occurrenceCount: 1, excerpt: null },
  ]
  return { contractVersion: 'class-review-synthesis-request-v1', requestId: 'request-1', rubricRevisionDigest: 'a'.repeat(43), policyVersion: 'class-review-policy-v1', schemaVersion: 'kimi-class-review-output-v1', projectionVersion: 'class-review-projection-v1', budgetVersion: 'class-review-prompt-budget-v1', statistics: { includedEssayCount: 4, issueEligibleEssayCount: 4, totalEssayCount: 4, excludedEssayCount: 0, score: { fullScore: 100, averageScore: 80, highestScore: 90, lowestScore: 70, medianScore: 80 }, scoreBands: [], dimensions: [], issueCounters: [] }, groups, semanticCoverage: { projectedGroupCount: 3, eligibleGroupCount: 3, groupCoverage: 1, projectedDistinctEssaySupportSum: 5, eligibleDistinctEssaySupportSum: 5, supportWeightedCoverage: 1, projectedOccurrenceSum: 6, eligibleOccurrenceSum: 6, occurrenceWeightedCoverage: 1 }, outputLimits: { maxCompletionTokens: 3072, maxVisibleCodePoints: 2200, maxJsonUtf8Bytes: 16384 } }
}

function browserReport(): ClassReviewReportV1 {
  return { contractVersion: 'class-review-report-v1', workspaceState: 'draft', taskRevision: 1, reportRevision: 1, aiTextEditRevision: 0, currentGeneration: null, statistics: { totalEssayCount: 4, includedEssayCount: 4, issueEligibleEssayCount: 4, excludedEssayCount: 0, issueCoverageRate: 1, fullScore: 100, scoreSummary: { averageScore: 80, highestScore: 90, lowestScore: 70 }, scoreBands: [], dimensions: [] }, issueBlocks: [], issueOrder: [], clearSpellingItems: [], selectedMaterials: [] }
}

function systemFactFor(
  block: ClassReviewIssueBlockV1,
  overrides: Partial<SystemEvidenceFact> = {},
): SystemEvidenceFact {
  return {
    topicKey: block.topicKey,
    essayIdentities: Array.from({ length: block.systemStudentCount }, (_, index) =>
      `essay-${block.blockId}-${index + 1}`,
    ),
    occurrenceCount: block.occurrenceCount,
    systemBlock: block,
    ...overrides,
  }
}

async function materializeClassReviewCandidate(input: {
  snapshot: Parameters<typeof materializeClassReviewCandidateHandle>[0]['snapshot']
  untrustedResult: unknown
  currentReport: ClassReviewReportV1
  currentIssueWorkspace?: ReturnType<typeof createInternalIssueWorkspace>
  topicHmac: TopicHmac
  createOpaqueId: () => string
  now: () => string
}) {
  const currentIssueWorkspace = input.currentIssueWorkspace
    ?? createInternalIssueWorkspace(input.currentReport.issueBlocks, { issueOrder: input.currentReport.issueOrder })
  const handle = await materializeClassReviewCandidateHandle({
    snapshot: input.snapshot,
    untrustedResult: input.untrustedResult,
    currentReport: input.currentReport,
    currentIssueWorkspace,
    topicHmac: input.topicHmac,
    createOpaqueId: input.createOpaqueId,
    now: input.now,
  })
  return {
    handle,
    ...applyMaterializedClassReviewCandidate({
      handle,
      currentReport: input.currentReport,
      currentIssueWorkspace,
    }),
  }
}

async function materializeBlocksThroughPublicBoundary(input: { providerOutput: ClassReviewProviderOutputV1; hidden: ClassReviewProjectionHiddenStateV1; issueEligibleEssayCount: number }) {
  const request = frozenRequest()
  request.statistics = { ...request.statistics, includedEssayCount: input.issueEligibleEssayCount, issueEligibleEssayCount: input.issueEligibleEssayCount, totalEssayCount: input.issueEligibleEssayCount }
  const threshold = classReviewSupportThreshold(input.issueEligibleEssayCount)
  request.groups = request.groups.map((group) => ({
    ...group,
    mustCover: group.distinctEssaySupport >= threshold,
  }))
  const current = browserReport()
  current.statistics = { ...current.statistics, includedEssayCount: input.issueEligibleEssayCount, issueEligibleEssayCount: input.issueEligibleEssayCount, totalEssayCount: input.issueEligibleEssayCount }
  const snapshot = cloneAndFreezeClassReviewGenerationSnapshot({ originalRequest: request, hidden: input.hidden, generationId: 'generation-public', invalidationEpoch: 0, executionIdentity: 'execution-public', payloadDigest: 'digest-public', taskRevision: 1, reportRevision: 1, aiTextEditRevision: 0, sourceRevisionEpoch: 0, browserStatistics: current.statistics })
  const result: ClassReviewSynthesisResultV1 = { contractVersion: 'class-review-synthesis-result-v1', requestId: request.requestId, status: 'succeeded', output: input.providerOutput, semanticCoverage: request.semanticCoverage, finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, cachedTokens: 0 }, timingsMs: { queueMs: 0, providerMs: 1, validationMs: 0, totalMs: 1 } }
  return materializeClassReviewCandidate({ snapshot, untrustedResult: result, currentReport: current, topicHmac: hmac(), createOpaqueId: (() => { let id = 0; return () => `public-${++id}` })(), now: () => '2026-08-30T00:00:00.000Z' })
}

describe('frozen generation merge boundary', () => {
  it('accepts legitimately truncated projected group text while still rejecting substituted visible text', () => {
    const request = frozenRequest()
    const baseHidden = hidden()
    const longTitle = 'The reason is too general for classroom discussion.'
    const projectedTitle = Array.from(longTitle).slice(0, 48).join('')
    const selectedGroups = new Map(baseHidden.selectedGroups)
    selectedGroups.set('g3', {
      atomicTopic: topic('c'),
      title: kept(longTitle, 'ev7'),
      excerpt: null,
      essayIds: ['e4'],
      occurrenceCount: 1,
    })
    const source = { ...baseHidden, selectedGroups }
    request.groups[2] = { ...request.groups[2], title: projectedTitle }

    expect(() => cloneAndFreezeClassReviewGenerationSnapshot({
      originalRequest: request,
      hidden: source,
      generationId: 'generation-truncated-visible-text',
      invalidationEpoch: 0,
      executionIdentity: 'execution-truncated-visible-text',
      payloadDigest: 'digest-truncated-visible-text',
      taskRevision: 1,
      reportRevision: 1,
      aiTextEditRevision: 0,
      sourceRevisionEpoch: 0,
      browserStatistics: browserReport().statistics,
    })).not.toThrow()

    const substituted = structuredClone(request)
    substituted.groups[2] = { ...substituted.groups[2], title: 'Different visible text' }
    expect(() => cloneAndFreezeClassReviewGenerationSnapshot({
      originalRequest: substituted,
      hidden: source,
      generationId: 'generation-substituted-visible-text',
      invalidationEpoch: 0,
      executionIdentity: 'execution-substituted-visible-text',
      payloadDigest: 'digest-substituted-visible-text',
      taskRevision: 1,
      reportRevision: 1,
      aiTextEditRevision: 0,
      sourceRevisionEpoch: 0,
      browserStatistics: browserReport().statistics,
    })).toThrow('class_review_candidate_conflict')
  })

  it('maps Provider dimension aliases directly to original rubric dimensions and fails closed on hidden/browser disagreement', async () => {
    const request = frozenRequest()
    request.statistics.dimensions = [{ dimensionId: 'd1', label: 'Dimension 1', averageScore: 32, medianScore: 32, maxScore: 40, normalizedPerformance: 0.8 }]
    const mappedHidden = hidden()
    mappedHidden.dimensionAliases = new Map([['d1', 'rubric-content']])
    const current = browserReport()
    current.statistics.dimensions = [{ dimensionId: 'rubric-content', name: 'Content', averageScore: 32, maxScore: 40, normalizedPerformance: 0.8 }]
    const snapshot = cloneAndFreezeClassReviewGenerationSnapshot({ originalRequest: request, hidden: mappedHidden, generationId: 'generation-dimension', invalidationEpoch: 0, executionIdentity: 'execution-dimension', payloadDigest: 'digest-dimension', taskRevision: 1, reportRevision: 1, aiTextEditRevision: 0, sourceRevisionEpoch: 0, browserStatistics: current.statistics })
    const result: ClassReviewSynthesisResultV1 = {
      contractVersion: 'class-review-synthesis-result-v1', requestId: request.requestId, status: 'succeeded',
      output: { ...output([]), strengths: [{ title: 'Content strength', detail: 'Good content', dimensionIds: ['d1'] }] },
      semanticCoverage: request.semanticCoverage, finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, cachedTokens: 0 }, timingsMs: { queueMs: 0, providerMs: 1, validationMs: 0, totalMs: 1 },
    }
    let nextId = 0
    const materialized = await materializeClassReviewCandidate({ snapshot, untrustedResult: result, currentReport: current, topicHmac: hmac(), createOpaqueId: () => `block-${++nextId}`, now: () => '2026-08-30T00:00:00.000Z' })
    expect(materialized.report.workspaceState).toBe('ai_available')
    if (materialized.report.workspaceState !== 'ai_available') throw new Error('expected ai report')
    expect(materialized.report.aiSummary.strengths[0].dimensionIds).toEqual(['rubric-content'])

    const mismatched = structuredClone(current)
    mismatched.statistics.dimensions[0].dimensionId = 'rubric-other'
    await expect(materializeClassReviewCandidate({ snapshot, untrustedResult: result, currentReport: mismatched, topicHmac: hmac(), createOpaqueId: () => 'block', now: () => '2026-08-30T00:00:00.000Z' })).rejects.toThrow('class_review_candidate_conflict')
  })

  it('uses issueOrder as the sole visible order and retains latest deterministic statistics', async () => {
    const firstRef = { evidenceId: 'teacher-a', selectionOrigin: 'teacher_selected' as const, sourceLocator: 'source-a', sourceResultRevision: 1, anonymousExample: null }
    const secondRef = { evidenceId: 'teacher-b', selectionOrigin: 'teacher_selected' as const, sourceLocator: 'source-b', sourceResultRevision: 1, anonymousExample: null }
    const first: ClassReviewIssueBlockV1 = { blockId: 'block-a', topicKey: 'teacher.a', origin: 'teacher', title: 'A', diagnosis: 'A', teachingAction: 'A', severity: 'medium', teacherStudentCount: 1, systemStudentCount: 0, combinedStudentCount: 1, occurrenceCount: 1, supportDenominator: null, anonymousExamples: [], evidenceRefs: [firstRef] }
    const second: ClassReviewIssueBlockV1 = { ...first, blockId: 'block-b', topicKey: 'teacher.b', title: 'B', evidenceRefs: [secondRef] }
    const current = browserReport()
    current.issueBlocks = [first, second]
    current.issueOrder = ['block-b', 'block-a']
    current.statistics = { ...current.statistics, totalEssayCount: 5, includedEssayCount: 5, issueEligibleEssayCount: 5 }
    const request = frozenRequest()
    request.groups = []
    request.semanticCoverage = { projectedGroupCount: 0, eligibleGroupCount: 0, groupCoverage: 1, projectedDistinctEssaySupportSum: 0, eligibleDistinctEssaySupportSum: 0, supportWeightedCoverage: 1, projectedOccurrenceSum: 0, eligibleOccurrenceSum: 0, occurrenceWeightedCoverage: 1 }
    const emptyHidden: ClassReviewProjectionHiddenStateV1 = { dimensionAliases: new Map(), selectedGroups: new Map(), unprojectedMustCover: [] }
    const snapshot = cloneAndFreezeClassReviewGenerationSnapshot({ originalRequest: request, hidden: emptyHidden, generationId: 'generation-order', invalidationEpoch: 0, executionIdentity: 'execution-order', payloadDigest: 'digest-order', taskRevision: 1, reportRevision: 1, aiTextEditRevision: 0, sourceRevisionEpoch: 0, browserStatistics: browserReport().statistics })
    const result: ClassReviewSynthesisResultV1 = { contractVersion: 'class-review-synthesis-result-v1', requestId: request.requestId, status: 'succeeded', output: output([]), semanticCoverage: request.semanticCoverage, finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, cachedTokens: 0 }, timingsMs: { queueMs: 0, providerMs: 1, validationMs: 0, totalMs: 1 } }
    const currentIssueWorkspace = createInternalIssueWorkspace(current.issueBlocks, {
      issueOrder: current.issueOrder,
      teacherEvidenceFacts: [
        { topicKey: first.topicKey, evidenceId: firstRef.evidenceId, essayIdentity: 'essay-a', occurrenceCount: 1, evidenceRef: firstRef },
        { topicKey: second.topicKey, evidenceId: secondRef.evidenceId, essayIdentity: 'essay-b', occurrenceCount: 1, evidenceRef: secondRef },
      ],
    })
    const materialized = await materializeClassReviewCandidate({ snapshot, untrustedResult: result, currentReport: current, currentIssueWorkspace, topicHmac: hmac(), createOpaqueId: () => 'new', now: () => '2026-08-30T00:00:00.000Z' })
    expect(materialized.report.issueOrder).toEqual(['block-b', 'block-a'])
    expect(materialized.report.issueBlocks.map((block) => block.blockId)).toEqual(['block-b', 'block-a'])
    expect(materialized.report.statistics).toEqual(current.statistics)
  })

  it('exposes only the full snapshot materialization seam', () => {
    expect(Object.keys(classReviewMergeModule).filter((key) => key.startsWith('materialize'))).toEqual(['materializeClassReviewCandidate'])
    expect(classReviewMergeModule).not.toHaveProperty('mergeGeneratedClassReviewPayloadIntoWorkspace')
  })

  it('returns an opaque non-cloneable handle and rejects a forged materialization handle', async () => {
    const request = frozenRequest()
    request.groups = []
    request.semanticCoverage = { projectedGroupCount: 0, eligibleGroupCount: 0, groupCoverage: 1, projectedDistinctEssaySupportSum: 0, eligibleDistinctEssaySupportSum: 0, supportWeightedCoverage: 1, projectedOccurrenceSum: 0, eligibleOccurrenceSum: 0, occurrenceWeightedCoverage: 1 }
    const emptyHidden: ClassReviewProjectionHiddenStateV1 = { dimensionAliases: new Map(), selectedGroups: new Map(), unprojectedMustCover: [] }
    const snapshot = cloneAndFreezeClassReviewGenerationSnapshot({ originalRequest: request, hidden: emptyHidden, generationId: 'opaque-handle-generation', invalidationEpoch: 0, executionIdentity: 'opaque-handle-execution', payloadDigest: 'opaque-handle-digest', taskRevision: 1, reportRevision: 1, aiTextEditRevision: 0, sourceRevisionEpoch: 0, browserStatistics: browserReport().statistics })
    const result: ClassReviewSynthesisResultV1 = { contractVersion: 'class-review-synthesis-result-v1', requestId: request.requestId, status: 'succeeded', output: output([]), semanticCoverage: request.semanticCoverage, finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, cachedTokens: 0 }, timingsMs: { queueMs: 0, providerMs: 1, validationMs: 0, totalMs: 1 } }
    const currentReport = browserReport()
    const handle = await materializeClassReviewCandidateHandle({ snapshot, untrustedResult: result, currentReport, currentIssueWorkspace: createInternalIssueWorkspace([], { issueOrder: [] }), topicHmac: hmac(), createOpaqueId: () => 'preallocated-id', now: () => '2026-08-30T00:00:00.000Z' })
    expect(handle).not.toHaveProperty('report')
    expect(handle).not.toHaveProperty('generatedPayload')
    expect(() => structuredClone(handle)).toThrow()

    const nextModule = classReviewMergeModule as unknown as {
      applyMaterializedClassReviewCandidate?: (input: {
        handle: unknown
        currentReport: ClassReviewReportV1
        currentIssueWorkspace: ReturnType<typeof createInternalIssueWorkspace>
      }) => unknown
    }
    expect(nextModule.applyMaterializedClassReviewCandidate).toBeTypeOf('function')
    expect(() => nextModule.applyMaterializedClassReviewCandidate?.({
      handle: Object.freeze({ forged: true }),
      currentReport: browserReport(),
      currentIssueWorkspace: createInternalIssueWorkspace([], { issueOrder: [] }),
    })).toThrow('class_review_candidate_conflict')
  })
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
      topicKey: topic('d').key,
      title: '逻辑与连贯：逻辑不清',
    }))
    expect(candidate.report.issueBlocks.some((block) => block.title === 'MUTATED')).toBe(false)
    expect(Object.isFrozen(snapshot.originalRequest.groups)).toBe(true)
    const prior = browserReport(); const priorBytes = JSON.stringify(prior)
    await expect(materializeClassReviewCandidate({ snapshot, untrustedResult: result, currentReport: prior, topicHmac: hmac(), createOpaqueId: (() => { let n = 0; return () => `invalid-${++n}` })(), now: () => 'not-a-time' })).rejects.toThrow('class_review_candidate_conflict')
    expect(JSON.stringify(prior)).toBe(priorBytes)
  })

  it('prevents Map set/delete from mutating the frozen hidden snapshot', () => {
    const snapshot = cloneAndFreezeClassReviewGenerationSnapshot({ originalRequest: frozenRequest(), hidden: hidden(), generationId: 'generation-map', invalidationEpoch: 0, executionIdentity: 'execution-map', payloadDigest: 'digest-map', taskRevision: 1, reportRevision: 1, aiTextEditRevision: 0, sourceRevisionEpoch: 0, browserStatistics: browserReport().statistics })
    const aliases = snapshot.hidden.dimensionAliases as Map<string, string>
    const groups = snapshot.hidden.selectedGroups as Map<string, unknown>
    const firstGroup = snapshot.hidden.selectedGroups.get('g1')!
    expect(() => aliases.set('d1', 'rubric-content')).toThrow()
    expect(() => groups.delete('g1')).toThrow()
    expect(() => {
      ;(firstGroup.essayIds as string[])[0] = 'mutated-through-view'
    }).toThrow()
    expect(snapshot.hidden.dimensionAliases.size).toBe(0)
    expect(snapshot.hidden.selectedGroups.has('g1')).toBe(true)
    expect(firstGroup.essayIds[0]).toBe('e1')
  })

  it('accepts a safe fallback occurrence count above the issue-eligible essay count', () => {
    const request = frozenRequest()
    const projectionHidden = hidden()
    projectionHidden.unprojectedMustCover = [
      {
        ...projectionHidden.unprojectedMustCover[0],
        occurrenceCount: 7,
      },
    ]

    expect(() => cloneAndFreezeClassReviewGenerationSnapshot({
      originalRequest: request,
      hidden: projectionHidden,
      generationId: 'generation-occurrences',
      invalidationEpoch: 0,
      executionIdentity: 'execution-occurrences',
      payloadDigest: 'digest-occurrences',
      taskRevision: 1,
      reportRevision: 1,
      aiTextEditRevision: 0,
      sourceRevisionEpoch: 0,
      browserStatistics: browserReport().statistics,
    })).not.toThrow()
  })

  it('rejects malformed/duplicate/cross-generation results atomically without a partial candidate', async () => {
    const snapshot = cloneAndFreezeClassReviewGenerationSnapshot({ originalRequest: frozenRequest(), hidden: hidden(), generationId: 'generation-1', invalidationEpoch: 0, executionIdentity: 'execution-1', payloadDigest: 'digest-1', taskRevision: 1, reportRevision: 1, aiTextEditRevision: 0, sourceRevisionEpoch: 0, browserStatistics: browserReport().statistics })
    await expect(materializeClassReviewCandidate({ snapshot, untrustedResult: { status: 'succeeded' }, currentReport: browserReport(), topicHmac: hmac(), createOpaqueId: () => 'block', now: () => '2026-08-30T00:00:00.000Z' })).rejects.toThrow('provider_invalid_response')
  })

  it('preallocates generated system IDs while preserving an existing visible AI topic block id', async () => {
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
    const second = await materializeClassReviewCandidate({ snapshot: secondSnapshot, untrustedResult: secondResult, currentReport: first.report, currentIssueWorkspace: first.issueWorkspace, topicHmac: hmac(), createOpaqueId: () => `unexpected-${++allocations}`, now: () => '2026-08-30T00:00:01.000Z' })
    expect(second.report.issueBlocks.find((block) => block.topicKey === topic('a').key)).toMatchObject({ blockId: 'block-1', title: 'Updated' })
    expect(allocations).toBe(3)
  })
})

describe('system block behavior through the one public materialization boundary', () => {
  it('recomputes union support, occurrences, denominator, composite identity and scrubbed examples', async () => {
    const result = await materializeBlocksThroughPublicBoundary({ providerOutput: output([{ groupIds: ['g2', 'g1'], title: 'Shared', diagnosis: 'Diagnosis', teachingAction: 'Action', severity: 'high' }]), hidden: hidden(), issueEligibleEssayCount: 10 })
    expect(result.report.issueBlocks).toHaveLength(2) // pattern + unprojected must-cover
    expect(result.report.issueBlocks[0]).toMatchObject({ origin: 'ai', systemStudentCount: 3, combinedStudentCount: 3, occurrenceCount: 5, supportDenominator: 10 })
    expect(result.report.issueBlocks[0].topicKey).toMatch(/^tk1\./)
    expect(result.report.issueBlocks[0].anonymousExamples).toEqual(['I goes home.', 'filling happy'])
    expect(result.report.issueBlocks[1]).toMatchObject({ topicKey: topic('d').key, origin: 'ai', title: '逻辑与连贯：逻辑不清', diagnosis: '多篇作文出现同类逻辑不清问题。', teachingAction: '结合上下文梳理关系，并安排衔接与因果表达练习。', anonymousExamples: [] })
  })

  it('drops sub-threshold patterns and emits each must-cover fallback exactly once, including zero-pattern success', async () => {
    const result = await materializeBlocksThroughPublicBoundary({ providerOutput: output([{ groupIds: ['g3'], title: 'Rare', diagnosis: 'D', teachingAction: 'A', severity: 'low' }]), hidden: hidden(), issueEligibleEssayCount: 10 })
    expect(result.report.issueBlocks.map((block) => block.topicKey)).toEqual([topic('d').key])
    const empty = await materializeBlocksThroughPublicBoundary({ providerOutput: output([]), hidden: hidden(), issueEligibleEssayCount: 10 })
    expect(empty.report.issueBlocks.map((block) => block.topicKey)).toEqual([topic('d').key])
  })

  it('rejects unknown, cross-snapshot and duplicate group ownership', async () => {
    await expect(materializeBlocksThroughPublicBoundary({ hidden: hidden(), issueEligibleEssayCount: 3, providerOutput: output([{ groupIds: ['outside'], title: 'x', diagnosis: 'd', teachingAction: 'a', severity: 'low' }]) })).rejects.toThrow('provider_invalid_response')
    await expect(materializeBlocksThroughPublicBoundary({ hidden: hidden(), issueEligibleEssayCount: 3, providerOutput: output([
      { groupIds: ['g1'], title: 'x', diagnosis: 'd', teachingAction: 'a', severity: 'low' },
      { groupIds: ['g1'], title: 'y', diagnosis: 'd', teachingAction: 'a', severity: 'low' },
    ]) })).rejects.toThrow('provider_invalid_response')
  })
})

describe('internal mixed teacher/system workspace', () => {
  const teacher = (id: string, key: string): ClassReviewIssueBlockV1 => ({ blockId: id, topicKey: key, origin: 'teacher', title: id, diagnosis: 'd', teachingAction: 'a', severity: 'medium', teacherStudentCount: 1, systemStudentCount: 0, combinedStudentCount: 1, occurrenceCount: 1, supportDenominator: null, anonymousExamples: [], evidenceRefs: [{ evidenceId: `t-${id}`, selectionOrigin: 'teacher_selected', sourceLocator: 'src', sourceResultRevision: 1, anonymousExample: null }] })
  const ai = (id: string, key: string): ClassReviewIssueBlockV1 => ({ ...teacher(id, key), origin: 'ai', teacherStudentCount: 0, systemStudentCount: 2, combinedStudentCount: 2, occurrenceCount: 2, supportDenominator: 3, evidenceRefs: [{ evidenceId: `s-${id}`, selectionOrigin: 'system_generation', sourceLocator: 'grp', sourceResultRevision: 1, anonymousExample: null }] })

  it('preserves teacher order and surviving block IDs while deterministic new system order allocates IDs only for new visible blocks', () => {
    const createOpaqueId = (() => { let n = 0; return () => `new-${++n}` })()
    const firstTeacher = teacher('t1', 'teacher.1')
    const secondTeacher = teacher('t2', 'teacher.2')
    const oldA = ai('old-a', 'tk1.a')
    const vanished = ai('vanished', 'tk1.z')
    const workspace = createInternalIssueWorkspace([firstTeacher, oldA, secondTeacher, vanished], {
      issueOrder: ['t1', 'old-a', 't2', 'vanished'],
      teacherEvidenceFacts: [
        { topicKey: firstTeacher.topicKey, evidenceId: 't-t1', essayIdentity: 'essay-t1', occurrenceCount: 1 },
        { topicKey: secondTeacher.topicKey, evidenceId: 't-t2', essayIdentity: 'essay-t2', occurrenceCount: 1 },
      ],
      systemEvidenceFacts: [
        systemFactFor(oldA, { essayIdentities: ['essay-a-1', 'essay-a-2'] }),
        systemFactFor(vanished, { essayIdentities: ['essay-z-1', 'essay-z-2'] }),
      ],
    })
    const newC = ai('new-c', 'tk1.c')
    const newA = ai('new-a', 'tk1.a')
    const newB = ai('new-b', 'tk1.b')
    const merged = mergeInternalIssueWorkspace({ workspace, nextSystem: [newC, newA, newB], generationId: 'generation-1', invalidationEpoch: 0, createOpaqueId, systemEvidenceFacts: [
      systemFactFor(newA, { essayIdentities: ['essay-a-1', 'essay-a-2'] }),
      systemFactFor(newB, { essayIdentities: ['essay-b-1', 'essay-b-2'] }),
      systemFactFor(newC, { essayIdentities: ['essay-c-1', 'essay-c-2'] }),
    ] })
    expect(projectInternalIssueWorkspace(merged).map((item) => [item.topicKey, item.blockId])).toEqual([['teacher.1', 't1'], ['tk1.a', 'old-a'], ['teacher.2', 't2'], ['tk1.b', 'new-b'], ['tk1.c', 'new-c']])
  })

  it('retains teacher-first/system evidence and identity-union counts, restores at the same slot, but never after invalidation', () => {
    const teacherBlock = teacher('t', 'tk1.a')
    teacherBlock.evidenceRefs = [{ evidenceId: 'teacher-evidence', selectionOrigin: 'teacher_selected', sourceLocator: 'teacher-source', sourceResultRevision: 1, anonymousExample: null }]
    teacherBlock.occurrenceCount = 2
    const system = ai('system', 'tk1.a')
    system.occurrenceCount = 3
    system.evidenceRefs = [{ evidenceId: 'system-evidence', selectionOrigin: 'system_generation', sourceLocator: 'system-source', sourceResultRevision: 1, anonymousExample: null }]
    const base = createInternalIssueWorkspace([teacherBlock], { issueOrder: ['t'], teacherEvidenceFacts: [{ topicKey: 'tk1.a', evidenceId: 'teacher-evidence', essayIdentity: 'essay-overlap', occurrenceCount: 2 }] })
    const mixed = mergeInternalIssueWorkspace({ workspace: base, nextSystem: [system], generationId: 'generation-1', invalidationEpoch: 0, createOpaqueId: () => 'must-not-run', systemEvidenceFacts: [systemFactFor(system, { essayIdentities: ['essay-overlap', 'essay-system'], occurrenceCount: 3 })] })
    expect(projectInternalIssueWorkspace(mixed)[0]).toMatchObject({ origin: 'teacher', teacherStudentCount: 1, systemStudentCount: 2, combinedStudentCount: 2, occurrenceCount: 3 })
    expect(projectInternalIssueWorkspace(mixed)[0].evidenceRefs.map((ref) => ref.selectionOrigin)).toEqual(['teacher_selected', 'system_generation'])
    const restored = removeTeacherEvidence(mixed, 'teacher-evidence')
    expect(projectInternalIssueWorkspace(restored)[0]).toMatchObject({ blockId: 't', origin: 'ai' })
    expect(restored.suppressed.size).toBe(0)
    const invalidated = invalidateInternalSystemVariants(mixed, 1)
    expect(projectInternalIssueWorkspace(removeTeacherEvidence(invalidated, 'teacher-evidence'))).toHaveLength(0)
  })
})

function materializationFixture(groupCount: 1 | 2) {
  const request = frozenRequest()
  request.groups = request.groups.slice(0, groupCount)
  const projectedSupport = groupCount === 1 ? 2 : 4
  const projectedOccurrences = groupCount === 1 ? 3 : 5
  request.semanticCoverage = {
    projectedGroupCount: groupCount,
    eligibleGroupCount: groupCount,
    groupCoverage: 1,
    projectedDistinctEssaySupportSum: projectedSupport,
    eligibleDistinctEssaySupportSum: projectedSupport,
    supportWeightedCoverage: 1,
    projectedOccurrenceSum: projectedOccurrences,
    eligibleOccurrenceSum: projectedOccurrences,
    occurrenceWeightedCoverage: 1,
  }
  const sourceHidden = hidden()
  sourceHidden.selectedGroups = new Map(
    [...sourceHidden.selectedGroups].filter(([alias]) => request.groups.some((group) => group.groupId === alias)),
  )
  sourceHidden.unprojectedMustCover = []
  const current = browserReport()
  const snapshot = cloneAndFreezeClassReviewGenerationSnapshot({
    originalRequest: request,
    hidden: sourceHidden,
    generationId: `admission-${groupCount}`,
    invalidationEpoch: 0,
    executionIdentity: `execution-${groupCount}`,
    payloadDigest: `digest-${groupCount}`,
    taskRevision: 1,
    reportRevision: 1,
    aiTextEditRevision: 0,
    sourceRevisionEpoch: 0,
    browserStatistics: current.statistics,
  })
  const patterns = request.groups.map((group) => ({
    groupIds: [group.groupId],
    title: group.title,
    diagnosis: `Diagnosis ${group.groupId}`,
    teachingAction: `Action ${group.groupId}`,
    severity: group.severity,
  }))
  const result: ClassReviewSynthesisResultV1 = {
    contractVersion: 'class-review-synthesis-result-v1',
    requestId: request.requestId,
    status: 'succeeded',
    output: output(patterns),
    semanticCoverage: request.semanticCoverage,
    finishReason: 'stop',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, cachedTokens: 0 },
    timingsMs: { queueMs: 0, providerMs: 1, validationMs: 0, totalMs: 1 },
  }
  return { snapshot, result, current }
}

describe('Task 8 round 3 candidate and canonical fact admission', () => {
  it('rejects a non-RFC3339 generated timestamp before creating an opaque candidate handle', async () => {
    const fixture = materializationFixture(1)
    await expect(materializeClassReviewCandidateHandle({
      snapshot: fixture.snapshot,
      untrustedResult: fixture.result,
      currentReport: fixture.current,
      currentIssueWorkspace: createInternalIssueWorkspace([], { issueOrder: [] }),
      topicHmac: hmac(),
      createOpaqueId: () => 'valid-system-block',
      now: () => 'not-rfc3339',
    })).rejects.toThrow('class_review_candidate_conflict')
  })

  it.each([
    { name: 'empty generated block ID', groupCount: 1 as const, createOpaqueId: (): string => '' },
    { name: 'duplicate generated block IDs', groupCount: 2 as const, createOpaqueId: (): string => 'duplicate-system-block' },
  ])('rejects $name before creating an opaque candidate handle', async ({ groupCount, createOpaqueId }) => {
    const fixture = materializationFixture(groupCount)
    await expect(materializeClassReviewCandidateHandle({
      snapshot: fixture.snapshot,
      untrustedResult: fixture.result,
      currentReport: fixture.current,
      currentIssueWorkspace: createInternalIssueWorkspace([], { issueOrder: [] }),
      topicHmac: hmac(),
      createOpaqueId,
      now: () => '2026-08-30T00:00:00.000Z',
    })).rejects.toThrow('class_review_candidate_conflict')
  })

  it.each([
    {
      name: 'visible teacher ref without a fact',
      build: () => {
        const first = { evidenceId: 'evidence-a', selectionOrigin: 'teacher_selected' as const, sourceLocator: 'source-a', sourceResultRevision: 1, anonymousExample: 'A' }
        const second = { evidenceId: 'evidence-b', selectionOrigin: 'teacher_selected' as const, sourceLocator: 'source-b', sourceResultRevision: 1, anonymousExample: 'B' }
        const block: ClassReviewIssueBlockV1 = {
          blockId: 'teacher-bijection', topicKey: 'teacher.bijection', origin: 'teacher',
          title: 'Teacher', diagnosis: 'Teacher', teachingAction: 'Teacher', severity: 'medium',
          teacherStudentCount: 2, systemStudentCount: 0, combinedStudentCount: 2,
          occurrenceCount: 2, supportDenominator: null, anonymousExamples: ['A', 'B'],
          evidenceRefs: [first, second],
        }
        return { blocks: [block], facts: [{ topicKey: block.topicKey, evidenceId: first.evidenceId, essayIdentity: 'essay-a', occurrenceCount: 1, evidenceRef: first }] }
      },
    },
    {
      name: 'caller counts and examples that disagree with facts',
      build: () => {
        const ref = { evidenceId: 'evidence-count', selectionOrigin: 'teacher_selected' as const, sourceLocator: 'source-count', sourceResultRevision: 1, anonymousExample: 'Derived example' }
        const block: ClassReviewIssueBlockV1 = {
          blockId: 'teacher-count', topicKey: 'teacher.count', origin: 'teacher',
          title: 'Teacher', diagnosis: 'Teacher', teachingAction: 'Teacher', severity: 'medium',
          teacherStudentCount: 9, systemStudentCount: 0, combinedStudentCount: 9,
          occurrenceCount: 9, supportDenominator: null, anonymousExamples: ['Caller injected'],
          evidenceRefs: [ref],
        }
        return { blocks: [block], facts: [{ topicKey: block.topicKey, evidenceId: ref.evidenceId, essayIdentity: 'essay-count', occurrenceCount: 2, evidenceRef: ref }] }
      },
    },
    {
      name: 'workspace-duplicate evidence ID across blocks',
      build: () => {
        const ref = { evidenceId: 'evidence-shared', selectionOrigin: 'teacher_selected' as const, sourceLocator: 'source-shared', sourceResultRevision: 1, anonymousExample: null }
        const makeBlock = (blockId: string, topicKey: string): ClassReviewIssueBlockV1 => ({
          blockId, topicKey, origin: 'teacher', title: blockId, diagnosis: blockId,
          teachingAction: blockId, severity: 'medium', teacherStudentCount: 1,
          systemStudentCount: 0, combinedStudentCount: 1, occurrenceCount: 1,
          supportDenominator: null, anonymousExamples: [], evidenceRefs: [ref],
        })
        const first = makeBlock('teacher-first', 'teacher.first')
        const second = makeBlock('teacher-second', 'teacher.second')
        return { blocks: [first, second], facts: [{ topicKey: first.topicKey, evidenceId: ref.evidenceId, essayIdentity: 'essay-shared', occurrenceCount: 1, evidenceRef: ref }] }
      },
    },
  ])('fails closed on non-bijective teacher evidence: $name', ({ build }) => {
    const { blocks, facts } = build()
    expect(() => createInternalIssueWorkspace(blocks, {
      issueOrder: blocks.map((block) => block.blockId),
      teacherEvidenceFacts: facts,
    })).toThrow('class_review_candidate_conflict')
  })

  it('rejects a positive-support system fact whose exact essay identity set disagrees with the visible system block', () => {
    const block: ClassReviewIssueBlockV1 = {
      blockId: 'system-count', topicKey: 'tk1.aaaaaaaaaaaaaaaa', origin: 'ai',
      title: 'System', diagnosis: 'System', teachingAction: 'System', severity: 'medium',
      teacherStudentCount: 0, systemStudentCount: 2, combinedStudentCount: 2,
      occurrenceCount: 2, supportDenominator: 3, anonymousExamples: [], evidenceRefs: [],
    }
    expect(() => createInternalIssueWorkspace([block], {
      issueOrder: [block.blockId],
      systemEvidenceFacts: [systemFactFor(block, { essayIdentities: ['essay-only-one'] })],
    })).toThrow('class_review_candidate_conflict')
  })

  it('recomputes vanished system contributions from teacher facts and removes stale system occurrences/examples', () => {
    const teacherRef = { evidenceId: 'teacher-evidence', selectionOrigin: 'teacher_selected' as const, sourceLocator: 'teacher-source', sourceResultRevision: 1, anonymousExample: 'Teacher example' }
    const systemRef = { evidenceId: 'system-evidence', selectionOrigin: 'system_generation' as const, sourceLocator: 'system-source', sourceResultRevision: 1, anonymousExample: 'System example' }
    const mixed: ClassReviewIssueBlockV1 = {
      blockId: 'mixed', topicKey: 'tk1.aaaaaaaaaaaaaaaa', origin: 'teacher',
      title: 'Mixed', diagnosis: 'Mixed', teachingAction: 'Mixed', severity: 'medium',
      teacherStudentCount: 1, systemStudentCount: 2, combinedStudentCount: 2,
      occurrenceCount: 3, supportDenominator: 3,
      anonymousExamples: ['System example', 'Teacher example'], evidenceRefs: [teacherRef, systemRef],
    }
    const workspace = createInternalIssueWorkspace([mixed], {
      issueOrder: [mixed.blockId],
      teacherEvidenceFacts: [{
        topicKey: mixed.topicKey, evidenceId: teacherRef.evidenceId,
        essayIdentity: 'essay-teacher', occurrenceCount: 2, evidenceRef: teacherRef,
      }],
      systemEvidenceFacts: [{
        topicKey: mixed.topicKey, essayIdentities: ['essay-teacher', 'essay-system'], occurrenceCount: 3,
        systemBlock: {
          ...mixed,
          blockId: 'system-mixed',
          origin: 'ai',
          teacherStudentCount: 0,
          systemStudentCount: 2,
          combinedStudentCount: 2,
          occurrenceCount: 3,
          anonymousExamples: ['System example'],
          evidenceRefs: [systemRef],
        },
      }],
      suppressed: new Map([[mixed.topicKey, {
        block: {
          ...mixed,
          blockId: 'system-mixed',
          origin: 'ai',
          teacherStudentCount: 0,
          systemStudentCount: 2,
          combinedStudentCount: 2,
          occurrenceCount: 3,
          anonymousExamples: ['System example'],
          evidenceRefs: [systemRef],
        },
        generationId: 'applied-generation',
        invalidationEpoch: 0,
        systemEvidenceFact: {
          topicKey: mixed.topicKey,
          essayIdentities: ['essay-teacher', 'essay-system'],
          occurrenceCount: 3,
          systemBlock: {
            ...mixed,
            blockId: 'system-mixed',
            origin: 'ai',
            teacherStudentCount: 0,
            systemStudentCount: 2,
            combinedStudentCount: 2,
            occurrenceCount: 3,
            anonymousExamples: ['System example'],
            evidenceRefs: [systemRef],
          },
        },
      }]]),
    })
    const vanished = mergeInternalIssueWorkspace({
      workspace, nextSystem: [], generationId: 'next-generation', invalidationEpoch: 0,
      createOpaqueId: () => 'unused', systemEvidenceFacts: [],
    })
    expect(projectInternalIssueWorkspace(vanished)).toEqual([{
      ...mixed,
      teacherStudentCount: 1,
      systemStudentCount: 0,
      combinedStudentCount: 1,
      occurrenceCount: 2,
      supportDenominator: null,
      anonymousExamples: ['Teacher example'],
      evidenceRefs: [teacherRef],
    }])
  })

  it('fails closed when an identity-less positive-support fallback collides with teacher evidence', () => {
    const teacherRef = { evidenceId: 'teacher-fallback', selectionOrigin: 'teacher_selected' as const, sourceLocator: 'teacher-source', sourceResultRevision: 1, anonymousExample: null }
    const teacherBlock: ClassReviewIssueBlockV1 = {
      blockId: 'teacher-fallback-block', topicKey: 'tk1.aaaaaaaaaaaaaaaa', origin: 'teacher',
      title: 'Teacher', diagnosis: 'Teacher', teachingAction: 'Teacher', severity: 'medium',
      teacherStudentCount: 1, systemStudentCount: 0, combinedStudentCount: 1,
      occurrenceCount: 1, supportDenominator: null, anonymousExamples: [], evidenceRefs: [teacherRef],
    }
    const fallback: ClassReviewIssueBlockV1 = {
      ...teacherBlock,
      blockId: 'fallback-system',
      origin: 'ai',
      teacherStudentCount: 0,
      systemStudentCount: 2,
      combinedStudentCount: 2,
      occurrenceCount: 2,
      supportDenominator: 3,
      evidenceRefs: [],
    }
    const workspace = createInternalIssueWorkspace([teacherBlock], {
      issueOrder: [teacherBlock.blockId],
      teacherEvidenceFacts: [{
        topicKey: teacherBlock.topicKey, evidenceId: teacherRef.evidenceId,
        essayIdentity: 'essay-teacher', occurrenceCount: 1, evidenceRef: teacherRef,
      }],
    })
    expect(() => mergeInternalIssueWorkspace({
      workspace,
      nextSystem: [fallback],
      generationId: 'fallback-generation',
      invalidationEpoch: 0,
      createOpaqueId: () => 'unused',
      systemEvidenceFacts: [systemFactFor(fallback, { essayIdentities: [], identityMode: 'unavailable_fallback' })],
    })).toThrow('class_review_candidate_conflict')
  })

  it('canonicalizes opaque identities by Unicode scalar value rather than UTF-16 code-unit order', () => {
    const bmp = '\uE000'
    const astral = '\u{10000}'
    const block: ClassReviewIssueBlockV1 = {
      blockId: 'unicode-system', topicKey: 'tk1.aaaaaaaaaaaaaaaa', origin: 'ai',
      title: 'System', diagnosis: 'System', teachingAction: 'System', severity: 'medium',
      teacherStudentCount: 0, systemStudentCount: 2, combinedStudentCount: 2,
      occurrenceCount: 2, supportDenominator: 3, anonymousExamples: [], evidenceRefs: [],
    }
    const workspace = createInternalIssueWorkspace([block], {
      issueOrder: [block.blockId],
      systemEvidenceFacts: [systemFactFor(block, { essayIdentities: [astral, bmp] })],
    })
    expect(workspace.systemFacts.get(block.topicKey)?.essayIdentities).toEqual([bmp, astral])
  })

  it('rebuilds teacher refs and unique examples in Unicode-scalar order and caps examples at three', () => {
    const bmp = '\uE000'
    const astral = '\u{10000}'
    const facts = [
      { evidenceId: `e-${astral}`, example: astral, essayIdentity: 'essay-astral' },
      { evidenceId: `e-${bmp}`, example: bmp, essayIdentity: 'essay-bmp' },
      { evidenceId: 'e-B', example: 'B', essayIdentity: 'essay-b' },
      { evidenceId: 'e-A', example: 'A', essayIdentity: 'essay-a' },
    ]
    const refs = facts.map((fact) => ({
      evidenceId: fact.evidenceId,
      selectionOrigin: 'teacher_selected' as const,
      sourceLocator: `source-${fact.essayIdentity}`,
      sourceResultRevision: 1,
      anonymousExample: fact.example,
    }))
    const block: ClassReviewIssueBlockV1 = {
      blockId: 'teacher-canonical', topicKey: 'teacher.canonical', origin: 'teacher',
      title: 'Teacher', diagnosis: 'Teacher', teachingAction: 'Teacher', severity: 'medium',
      teacherStudentCount: 4, systemStudentCount: 0, combinedStudentCount: 4,
      occurrenceCount: 4, supportDenominator: null,
      anonymousExamples: ['A', 'B', bmp], evidenceRefs: refs,
    }
    const workspace = createInternalIssueWorkspace([block], {
      issueOrder: [block.blockId],
      teacherEvidenceFacts: facts.map((fact, index) => ({
        topicKey: block.topicKey,
        evidenceId: fact.evidenceId,
        essayIdentity: fact.essayIdentity,
        occurrenceCount: 1,
        evidenceRef: refs[index],
      })),
    })
    const rebuilt = projectInternalIssueWorkspace(invalidateInternalSystemVariants(workspace, 1))[0]
    expect(rebuilt.evidenceRefs.map((ref) => ref.evidenceId)).toEqual(['e-A', 'e-B', `e-${bmp}`, `e-${astral}`])
    expect(rebuilt.anonymousExamples).toEqual(['A', 'B', bmp])
  })

  it.each(['missing owner fact', 'orphan fact'] as const)(
    'enforces positive-support system topic/fact bijection: %s',
    (scenario) => {
    const block: ClassReviewIssueBlockV1 = {
      blockId: 'system-owned',
      topicKey: 'tk1.aaaaaaaaaaaaaaaa',
      origin: 'ai',
      title: 'System',
      diagnosis: 'System diagnosis',
      teachingAction: 'System action',
      severity: 'medium',
      teacherStudentCount: 0,
      systemStudentCount: 2,
      combinedStudentCount: 2,
      occurrenceCount: 2,
      supportDenominator: 3,
      anonymousExamples: [],
      evidenceRefs: [],
    }
      const blocks = scenario === 'missing owner fact' ? [block] : []
      const facts = scenario === 'orphan fact'
        ? [{ topicKey: block.topicKey, essayIdentities: ['essay-a', 'essay-b'], occurrenceCount: 2 }]
        : []
      expect(() => createInternalIssueWorkspace(blocks, {
        issueOrder: blocks.map((item) => item.blockId),
        systemEvidenceFacts: facts,
      })).toThrow('class_review_candidate_conflict')
      if (scenario === 'orphan fact') {
        expect(() => createInternalIssueWorkspace([], {
          issueOrder: [],
          systemEvidenceFacts: facts,
          suppressed: new Map([[block.topicKey, {
            block,
            generationId: 'orphan-suppressed-generation',
            invalidationEpoch: 0,
            systemEvidenceFact: facts[0],
          }]]),
        })).toThrow('class_review_candidate_conflict')
      }
    },
  )

  it('rejects exact system occurrence below the identity-set cardinality', () => {
    const block: ClassReviewIssueBlockV1 = {
      blockId: 'system-impossible-occurrence',
      topicKey: 'tk1.aaaaaaaaaaaaaaaa',
      origin: 'ai',
      title: 'System',
      diagnosis: 'System diagnosis',
      teachingAction: 'System action',
      severity: 'medium',
      teacherStudentCount: 0,
      systemStudentCount: 2,
      combinedStudentCount: 2,
      occurrenceCount: 1,
      supportDenominator: 3,
      anonymousExamples: [],
      evidenceRefs: [],
    }
    expect(() => createInternalIssueWorkspace([block], {
      issueOrder: [block.blockId],
      systemEvidenceFacts: [{
        topicKey: block.topicKey,
        essayIdentities: ['essay-a', 'essay-b'],
        occurrenceCount: 1,
      }],
    })).toThrow('class_review_candidate_conflict')
    const otherwiseValid = { ...block, occurrenceCount: 2 }
    expect(() => createInternalIssueWorkspace([otherwiseValid], {
      issueOrder: [otherwiseValid.blockId],
      systemEvidenceFacts: [{
        topicKey: otherwiseValid.topicKey,
        essayIdentities: ['essay-a'],
        occurrenceCount: 2,
        identityMode: 'bogus' as 'exact',
      }],
    })).toThrow('class_review_candidate_conflict')
    expect(() => createInternalIssueWorkspace([block], {
      issueOrder: [block.blockId],
      systemEvidenceFacts: [{
        topicKey: block.topicKey,
        essayIdentities: [],
        occurrenceCount: 1,
        identityMode: 'unavailable_fallback',
      }],
    })).toThrow('class_review_candidate_conflict')
  })

  it('deep-freezes canonical teacher/system facts, nested refs, and identity arrays at admission', () => {
    const teacherRef = {
      evidenceId: 'teacher-frozen',
      selectionOrigin: 'teacher_selected' as const,
      sourceLocator: 'teacher-source',
      sourceResultRevision: 1,
      anonymousExample: 'Teacher example',
    }
    const teacherBlock: ClassReviewIssueBlockV1 = {
      blockId: 'teacher-frozen-block',
      topicKey: 'teacher.frozen',
      origin: 'teacher',
      title: 'Teacher',
      diagnosis: 'Teacher diagnosis',
      teachingAction: 'Teacher action',
      severity: 'medium',
      teacherStudentCount: 1,
      systemStudentCount: 0,
      combinedStudentCount: 1,
      occurrenceCount: 1,
      supportDenominator: null,
      anonymousExamples: ['Teacher example'],
      evidenceRefs: [teacherRef],
    }
    const systemBlock: ClassReviewIssueBlockV1 = {
      blockId: 'system-frozen-block',
      topicKey: 'tk1.aaaaaaaaaaaaaaaa',
      origin: 'ai',
      title: 'System',
      diagnosis: 'System diagnosis',
      teachingAction: 'System action',
      severity: 'medium',
      teacherStudentCount: 0,
      systemStudentCount: 2,
      combinedStudentCount: 2,
      occurrenceCount: 2,
      supportDenominator: 3,
      anonymousExamples: [],
      evidenceRefs: [],
    }
    const workspace = createInternalIssueWorkspace([teacherBlock, systemBlock], {
      issueOrder: [teacherBlock.blockId, systemBlock.blockId],
      teacherEvidenceFacts: [{
        topicKey: teacherBlock.topicKey,
        evidenceId: teacherRef.evidenceId,
        essayIdentity: 'essay-teacher',
        occurrenceCount: 1,
        evidenceRef: teacherRef,
      }],
      systemEvidenceFacts: [{
        topicKey: systemBlock.topicKey,
        essayIdentities: ['essay-system-a', 'essay-system-b'],
        occurrenceCount: 2,
        systemBlock,
      }],
    })
    const storedTeacher = workspace.teacherFacts.get(teacherRef.evidenceId)!
    const storedSystem = workspace.systemFacts.get(systemBlock.topicKey)!
    expect.soft(Object.isFrozen(storedTeacher)).toBe(true)
    expect.soft(Object.isFrozen(storedTeacher.evidenceRef)).toBe(true)
    expect.soft(Object.isFrozen(storedSystem)).toBe(true)
    expect.soft(Object.isFrozen(storedSystem.essayIdentities)).toBe(true)
  })

  it('rebuilds every mixed field from current teacher facts and the new system variant', () => {
    const teacherRef = {
      evidenceId: 'teacher-current',
      selectionOrigin: 'teacher_selected' as const,
      sourceLocator: 'teacher-source',
      sourceResultRevision: 1,
      anonymousExample: 'Teacher current',
    }
    const oldSystemRef = {
      evidenceId: 'system-old',
      selectionOrigin: 'system_generation' as const,
      sourceLocator: 'old-system-source',
      sourceResultRevision: 1,
      anonymousExample: 'Old system',
    }
    const oldMixed: ClassReviewIssueBlockV1 = {
      blockId: 'mixed-current',
      topicKey: 'tk1.aaaaaaaaaaaaaaaa',
      origin: 'teacher',
      title: 'Teacher title',
      diagnosis: 'Teacher diagnosis',
      teachingAction: 'Teacher action',
      severity: 'medium',
      teacherStudentCount: 1,
      systemStudentCount: 2,
      combinedStudentCount: 3,
      occurrenceCount: 6,
      supportDenominator: 9,
      anonymousExamples: ['Old system', 'Teacher current'],
      evidenceRefs: [teacherRef, oldSystemRef],
    }
    const workspace = createInternalIssueWorkspace([oldMixed], {
      issueOrder: [oldMixed.blockId],
      teacherEvidenceFacts: [{
        topicKey: oldMixed.topicKey,
        evidenceId: teacherRef.evidenceId,
        essayIdentity: 'essay-teacher',
        occurrenceCount: 2,
        evidenceRef: teacherRef,
      }],
      systemEvidenceFacts: [{
        topicKey: oldMixed.topicKey,
        essayIdentities: ['essay-old-a', 'essay-old-b'],
        occurrenceCount: 4,
        systemBlock: {
          ...oldMixed,
          blockId: 'old-system-id',
          origin: 'ai',
          teacherStudentCount: 0,
          systemStudentCount: 2,
          combinedStudentCount: 2,
          occurrenceCount: 4,
          anonymousExamples: ['Old system'],
          evidenceRefs: [oldSystemRef],
        },
      }],
      suppressed: new Map([[oldMixed.topicKey, {
        block: {
          ...oldMixed,
          blockId: 'old-system-id',
          origin: 'ai',
          teacherStudentCount: 0,
          systemStudentCount: 2,
          combinedStudentCount: 2,
          occurrenceCount: 4,
          anonymousExamples: ['Old system'],
          evidenceRefs: [oldSystemRef],
        },
        generationId: 'old-generation',
        invalidationEpoch: 0,
        systemEvidenceFact: {
          topicKey: oldMixed.topicKey,
          essayIdentities: ['essay-old-a', 'essay-old-b'],
          occurrenceCount: 4,
          systemBlock: {
            ...oldMixed,
            blockId: 'old-system-id',
            origin: 'ai',
            teacherStudentCount: 0,
            systemStudentCount: 2,
            combinedStudentCount: 2,
            occurrenceCount: 4,
            anonymousExamples: ['Old system'],
            evidenceRefs: [oldSystemRef],
          },
        },
      }]]),
    })
    const nextSystem: ClassReviewIssueBlockV1 = {
      ...oldMixed,
      blockId: 'new-system-id',
      origin: 'ai',
      title: 'New system title',
      diagnosis: 'New system diagnosis',
      teachingAction: 'New system action',
      teacherStudentCount: 0,
      systemStudentCount: 2,
      combinedStudentCount: 2,
      occurrenceCount: 3,
      supportDenominator: 4,
      anonymousExamples: ['New system'],
      evidenceRefs: [],
    }
    const merged = mergeInternalIssueWorkspace({
      workspace,
      nextSystem: [nextSystem],
      generationId: 'new-generation',
      invalidationEpoch: 0,
      createOpaqueId: () => 'unused',
      systemEvidenceFacts: [{
        topicKey: nextSystem.topicKey,
        essayIdentities: ['essay-new-a', 'essay-new-b'],
        occurrenceCount: 3,
        systemBlock: nextSystem,
      }],
    })
    expect(projectInternalIssueWorkspace(merged)[0]).toMatchObject({
      origin: 'teacher',
      teacherStudentCount: 1,
      systemStudentCount: 2,
      combinedStudentCount: 3,
      occurrenceCount: 5,
      supportDenominator: 4,
      anonymousExamples: ['New system', 'Teacher current'],
      evidenceRefs: [teacherRef],
    })
  })

  it('removes stale teacher examples while rebuilding a surviving mixed block', () => {
    const removedRef = {
      evidenceId: 'teacher-remove',
      selectionOrigin: 'teacher_selected' as const,
      sourceLocator: 'teacher-remove-source',
      sourceResultRevision: 1,
      anonymousExample: 'Removed teacher',
    }
    const survivingRef = {
      evidenceId: 'teacher-survive',
      selectionOrigin: 'teacher_selected' as const,
      sourceLocator: 'teacher-survive-source',
      sourceResultRevision: 1,
      anonymousExample: 'Surviving teacher',
    }
    const systemRef = {
      evidenceId: 'system-current',
      selectionOrigin: 'system_generation' as const,
      sourceLocator: 'system-current-source',
      sourceResultRevision: 1,
      anonymousExample: 'System current',
    }
    const mixed: ClassReviewIssueBlockV1 = {
      blockId: 'mixed-remove',
      topicKey: 'tk1.aaaaaaaaaaaaaaaa',
      origin: 'teacher',
      title: 'Teacher',
      diagnosis: 'Teacher diagnosis',
      teachingAction: 'Teacher action',
      severity: 'medium',
      teacherStudentCount: 2,
      systemStudentCount: 2,
      combinedStudentCount: 3,
      occurrenceCount: 4,
      supportDenominator: 4,
      anonymousExamples: ['Removed teacher', 'Surviving teacher', 'System current'],
      evidenceRefs: [removedRef, survivingRef, systemRef],
    }
    const workspace = createInternalIssueWorkspace([mixed], {
      issueOrder: [mixed.blockId],
      teacherEvidenceFacts: [
        { topicKey: mixed.topicKey, evidenceId: removedRef.evidenceId, essayIdentity: 'essay-teacher-only', occurrenceCount: 1, evidenceRef: removedRef },
        { topicKey: mixed.topicKey, evidenceId: survivingRef.evidenceId, essayIdentity: 'essay-system-a', occurrenceCount: 1, evidenceRef: survivingRef },
      ],
      systemEvidenceFacts: [{
        topicKey: mixed.topicKey,
        essayIdentities: ['essay-system-a', 'essay-system-b'],
        occurrenceCount: 3,
        systemBlock: {
          ...mixed,
          blockId: 'system-current-id',
          origin: 'ai',
          teacherStudentCount: 0,
          systemStudentCount: 2,
          combinedStudentCount: 2,
          occurrenceCount: 3,
          anonymousExamples: ['System current'],
          evidenceRefs: [systemRef],
        },
      }],
      suppressed: new Map([[mixed.topicKey, {
        block: {
          ...mixed,
          blockId: 'system-current-id',
          origin: 'ai',
          teacherStudentCount: 0,
          systemStudentCount: 2,
          combinedStudentCount: 2,
          occurrenceCount: 3,
          anonymousExamples: ['System current'],
          evidenceRefs: [systemRef],
        },
        generationId: 'applied-generation',
        invalidationEpoch: 0,
        systemEvidenceFact: {
          topicKey: mixed.topicKey,
          essayIdentities: ['essay-system-a', 'essay-system-b'],
          occurrenceCount: 3,
          systemBlock: {
            ...mixed,
            blockId: 'system-current-id',
            origin: 'ai',
            teacherStudentCount: 0,
            systemStudentCount: 2,
            combinedStudentCount: 2,
            occurrenceCount: 3,
            anonymousExamples: ['System current'],
            evidenceRefs: [systemRef],
          },
        },
      }]]),
    })
    const rebuilt = projectInternalIssueWorkspace(removeTeacherEvidence(
      workspace,
      removedRef.evidenceId,
    ))[0]
    expect(rebuilt).toMatchObject({
      teacherStudentCount: 1,
      systemStudentCount: 2,
      combinedStudentCount: 2,
      occurrenceCount: 3,
      supportDenominator: 4,
      anonymousExamples: ['Surviving teacher', 'System current'],
      evidenceRefs: [survivingRef, systemRef],
    })
  })

  it('restores a still-valid suppressed applied variant despite a later attempt becoming current', () => {
    const teacherRef = {
      evidenceId: 'teacher-suppressed',
      selectionOrigin: 'teacher_selected' as const,
      sourceLocator: 'teacher-source',
      sourceResultRevision: 1,
      anonymousExample: null,
    }
    const teacherBlock: ClassReviewIssueBlockV1 = {
      blockId: 'teacher-suppressed-block',
      topicKey: 'tk1.aaaaaaaaaaaaaaaa',
      origin: 'teacher',
      title: 'Teacher',
      diagnosis: 'Teacher diagnosis',
      teachingAction: 'Teacher action',
      severity: 'medium',
      teacherStudentCount: 1,
      systemStudentCount: 0,
      combinedStudentCount: 1,
      occurrenceCount: 1,
      supportDenominator: null,
      anonymousExamples: [],
      evidenceRefs: [teacherRef],
    }
    const base = createInternalIssueWorkspace([teacherBlock], {
      issueOrder: [teacherBlock.blockId],
      teacherEvidenceFacts: [{
        topicKey: teacherBlock.topicKey,
        evidenceId: teacherRef.evidenceId,
        essayIdentity: 'essay-teacher',
        occurrenceCount: 1,
        evidenceRef: teacherRef,
      }],
    })
    const systemBlock: ClassReviewIssueBlockV1 = {
      ...teacherBlock,
      blockId: 'system-applied',
      origin: 'ai',
      title: 'Applied system',
      diagnosis: 'Applied diagnosis',
      teachingAction: 'Applied action',
      teacherStudentCount: 0,
      systemStudentCount: 2,
      combinedStudentCount: 2,
      occurrenceCount: 2,
      supportDenominator: 3,
      evidenceRefs: [],
    }
    const mixed = mergeInternalIssueWorkspace({
      workspace: base,
      nextSystem: [systemBlock],
      generationId: 'applied-generation',
      invalidationEpoch: 0,
      createOpaqueId: () => 'unused',
      systemEvidenceFacts: [{
        topicKey: systemBlock.topicKey,
        essayIdentities: ['essay-system-a', 'essay-system-b'],
        occurrenceCount: 2,
        systemBlock,
      }],
    })
    const stale = removeTeacherEvidence(mixed, teacherRef.evidenceId, {
      generationId: 'different-applied-generation',
      invalidationEpoch: 0,
    })
    expect(projectInternalIssueWorkspace(stale)).toEqual([])
    const restored = removeTeacherEvidence(mixed, teacherRef.evidenceId, {
      generationId: 'applied-generation',
      invalidationEpoch: 0,
    })
    expect(projectInternalIssueWorkspace(restored)).toEqual([{
      ...systemBlock,
      blockId: teacherBlock.blockId,
    }])
  })

  it('previews an identity-less fallback collision before returning an opaque candidate handle', async () => {
    const request = frozenRequest()
    const sourceHidden = hidden()
    const current = browserReport()
    const fallbackTopic = sourceHidden.unprojectedMustCover[0].atomicTopic.key
    const teacherRef = {
      evidenceId: 'teacher-fallback-preview',
      selectionOrigin: 'teacher_selected' as const,
      sourceLocator: 'teacher-source',
      sourceResultRevision: 1,
      anonymousExample: null,
    }
    const teacherBlock: ClassReviewIssueBlockV1 = {
      blockId: 'teacher-fallback-preview-block',
      topicKey: fallbackTopic,
      origin: 'teacher',
      title: 'Teacher',
      diagnosis: 'Teacher diagnosis',
      teachingAction: 'Teacher action',
      severity: 'medium',
      teacherStudentCount: 1,
      systemStudentCount: 0,
      combinedStudentCount: 1,
      occurrenceCount: 1,
      supportDenominator: null,
      anonymousExamples: [],
      evidenceRefs: [teacherRef],
    }
    current.issueBlocks = [teacherBlock]
    current.issueOrder = [teacherBlock.blockId]
    const currentIssueWorkspace = createInternalIssueWorkspace([teacherBlock], {
      issueOrder: [teacherBlock.blockId],
      teacherEvidenceFacts: [{
        topicKey: fallbackTopic,
        evidenceId: teacherRef.evidenceId,
        essayIdentity: 'essay-teacher',
        occurrenceCount: 1,
        evidenceRef: teacherRef,
      }],
    })
    const snapshot = cloneAndFreezeClassReviewGenerationSnapshot({
      originalRequest: request,
      hidden: sourceHidden,
      generationId: 'preview-generation',
      invalidationEpoch: 0,
      executionIdentity: 'preview-execution',
      payloadDigest: 'preview-digest',
      taskRevision: 1,
      reportRevision: 1,
      aiTextEditRevision: 0,
      sourceRevisionEpoch: 0,
      browserStatistics: current.statistics,
    })
    const result: ClassReviewSynthesisResultV1 = {
      contractVersion: 'class-review-synthesis-result-v1',
      requestId: request.requestId,
      status: 'succeeded',
      output: output([]),
      semanticCoverage: request.semanticCoverage,
      finishReason: 'stop',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, cachedTokens: 0 },
      timingsMs: { queueMs: 0, providerMs: 1, validationMs: 0, totalMs: 1 },
    }
    const materializeWithPreview = materializeClassReviewCandidateHandle as unknown as (
      input: Parameters<typeof materializeClassReviewCandidateHandle>[0] & {
        currentReport: ClassReviewReportV1
        currentIssueWorkspace: ReturnType<typeof createInternalIssueWorkspace>
        getCurrentWorkspace?: () => {
          currentReport: ClassReviewReportV1
          currentIssueWorkspace: ReturnType<typeof createInternalIssueWorkspace>
        }
      },
    ) => Promise<unknown>
    let nextPreviewBlockId = 0

    await expect(materializeWithPreview({
      snapshot,
      untrustedResult: result,
      currentReport: current,
      currentIssueWorkspace,
      topicHmac: hmac(),
      createOpaqueId: () => `preview-system-block-${++nextPreviewBlockId}`,
      now: () => '2026-08-30T00:00:00.000Z',
    })).rejects.toThrow('class_review_candidate_conflict')

    const latestReport = browserReport()
    await expect(materializeWithPreview({
      snapshot,
      untrustedResult: result,
      currentReport: current,
      currentIssueWorkspace,
      getCurrentWorkspace: () => ({
        currentReport: latestReport,
        currentIssueWorkspace: createInternalIssueWorkspace([], { issueOrder: [] }),
      }),
      topicHmac: hmac(),
      createOpaqueId: () => `latest-preview-system-block-${++nextPreviewBlockId}`,
      now: () => '2026-08-30T00:00:00.000Z',
    })).resolves.toBeDefined()
  })

  it('rejects a mixed block unless its canonical system fact and suppressed system-only variant are both present', () => {
    const teacherRef = {
      evidenceId: 'teacher-missing-suppressed',
      selectionOrigin: 'teacher_selected' as const,
      sourceLocator: 'teacher-source',
      sourceResultRevision: 1,
      anonymousExample: null,
    }
    const mixed: ClassReviewIssueBlockV1 = {
      blockId: 'mixed-missing-suppressed',
      topicKey: 'tk1.aaaaaaaaaaaaaaaa',
      origin: 'teacher',
      title: 'Teacher title',
      diagnosis: 'Teacher diagnosis',
      teachingAction: 'Teacher action',
      severity: 'medium',
      teacherStudentCount: 1,
      systemStudentCount: 2,
      combinedStudentCount: 3,
      occurrenceCount: 3,
      supportDenominator: 3,
      anonymousExamples: [],
      evidenceRefs: [teacherRef],
    }

    expect(() => createInternalIssueWorkspace([mixed], {
      issueOrder: [mixed.blockId],
      teacherEvidenceFacts: [{
        topicKey: mixed.topicKey,
        evidenceId: teacherRef.evidenceId,
        essayIdentity: 'essay-teacher',
        occurrenceCount: 1,
        evidenceRef: teacherRef,
      }],
      systemEvidenceFacts: [{
        topicKey: mixed.topicKey,
        essayIdentities: ['essay-system-a', 'essay-system-b'],
        occurrenceCount: 2,
      }],
    })).toThrow('class_review_candidate_conflict')

    expect(() => createInternalIssueWorkspace([mixed], {
      issueOrder: [mixed.blockId],
      teacherEvidenceFacts: [{
        topicKey: mixed.topicKey,
        evidenceId: teacherRef.evidenceId,
        essayIdentity: 'essay-teacher',
        occurrenceCount: 1,
        evidenceRef: teacherRef,
      }],
      systemEvidenceFacts: [{
        topicKey: mixed.topicKey,
        essayIdentities: ['essay-system-a', 'essay-system-b'],
        occurrenceCount: 2,
      }],
      suppressed: new Map([[mixed.topicKey, {
        block: {
          ...mixed,
          blockId: 'suppressed-system',
          origin: 'ai',
          title: '',
          teacherStudentCount: 0,
          systemStudentCount: 2,
          combinedStudentCount: 2,
          occurrenceCount: 2,
          anonymousExamples: [],
          evidenceRefs: [],
        },
        generationId: 'applied-generation',
        invalidationEpoch: 0,
        systemEvidenceFact: {
          topicKey: mixed.topicKey,
          essayIdentities: ['essay-system-a', 'essay-system-b'],
          occurrenceCount: 2,
        },
      }]]),
    })).toThrow('class_review_candidate_conflict')
  })

  it('rejects a teacher-origin block with no canonical teacher evidence fact', () => {
    const forged: ClassReviewIssueBlockV1 = {
      blockId: 'teacher-free-text',
      topicKey: 'teacher.free-text',
      origin: 'teacher',
      title: 'Caller title',
      diagnosis: 'Caller diagnosis',
      teachingAction: 'Caller action',
      severity: 'medium',
      teacherStudentCount: 9,
      systemStudentCount: 0,
      combinedStudentCount: 9,
      occurrenceCount: 99,
      supportDenominator: null,
      anonymousExamples: ['Caller forged example'],
      evidenceRefs: [],
    }

    expect(() => createInternalIssueWorkspace([forged], {
      issueOrder: [forged.blockId],
      teacherEvidenceFacts: [],
    })).toThrow('class_review_candidate_conflict')
  })

  it('rebuilds ai-only blocks from the supplied system fact block rather than caller visible fields', () => {
    const canonicalRef = {
      evidenceId: 'system-owned-ref',
      selectionOrigin: 'system_generation' as const,
      sourceLocator: 'system-source',
      sourceResultRevision: 1,
      anonymousExample: 'System owned example',
    }
    const forgedRef = {
      evidenceId: 'caller-forged-ref',
      selectionOrigin: 'system_generation' as const,
      sourceLocator: 'caller-source',
      sourceResultRevision: 1,
      anonymousExample: 'Caller forged example',
    }
    const canonical: ClassReviewIssueBlockV1 = {
      blockId: 'canonical-ai-block',
      topicKey: 'tk1.aaaaaaaaaaaaaaaa',
      origin: 'ai',
      title: 'System owned title',
      diagnosis: 'System owned diagnosis',
      teachingAction: 'System owned action',
      severity: 'high',
      teacherStudentCount: 0,
      systemStudentCount: 2,
      combinedStudentCount: 2,
      occurrenceCount: 3,
      supportDenominator: 3,
      anonymousExamples: ['System owned example'],
      evidenceRefs: [canonicalRef],
    }
    const forged: ClassReviewIssueBlockV1 = {
      ...canonical,
      title: 'Caller forged title',
      diagnosis: 'Caller forged diagnosis',
      teachingAction: 'Caller forged action',
      severity: 'low',
      supportDenominator: 999,
      anonymousExamples: ['Caller forged example'],
      evidenceRefs: [forgedRef],
    }

    const workspace = createInternalIssueWorkspace([forged], {
      issueOrder: [forged.blockId],
      systemEvidenceFacts: [{
        topicKey: canonical.topicKey,
        essayIdentities: ['essay-a', 'essay-b'],
        occurrenceCount: 3,
        systemBlock: canonical,
      } as never],
    })

    expect(workspace.visible).toEqual([canonical])
  })
})
