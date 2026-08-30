import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiSummaryV1, ClassReviewIssueBlockV1, ClassReviewReportAiAvailableV1, ClassReviewReportDraftV1, ClassReviewReportNoneV1, ClassReviewSynthesisRequestV1, ClassReviewSynthesisResultV1 } from './types'
import { buildClassReviewProjection, DEFAULT_CLASS_REVIEW_PROJECTION_LIMITS, type ClassReviewProjectionResult } from './classReviewProjection'
import type { ClassReviewAggregate } from './aggregateClassReview'
import { createLocalClassReviewCoordinator, type ClassReviewSynthesisClient } from './classReviewCoordinator'
import { createFakeClassReviewSynthesisClient } from './fakeClassReviewSynthesisClient'

function draft(aiTextEditRevision = 0): ClassReviewReportDraftV1 {
  return { contractVersion: 'class-review-report-v1', workspaceState: 'draft', taskRevision: 1, reportRevision: 1, aiTextEditRevision, currentGeneration: null, statistics: { totalEssayCount: 3, includedEssayCount: 3, issueEligibleEssayCount: 3, excludedEssayCount: 0, issueCoverageRate: 1, fullScore: 100, scoreSummary: { averageScore: 80, highestScore: 90, lowestScore: 70 }, scoreBands: [], dimensions: [] }, issueBlocks: [], issueOrder: [], clearSpellingItems: [], selectedMaterials: [] }
}

function none(): ClassReviewReportNoneV1 {
  return { ...draft(), workspaceState: 'none', reportRevision: null, aiTextEditRevision: 0, issueBlocks: [], issueOrder: [], selectedMaterials: [] }
}

const validRubricDigest = 'a'.repeat(43)

function aiAvailable(): ClassReviewReportAiAvailableV1 {
  return {
    ...draft(),
    workspaceState: 'ai_available',
    appliedGenerationId: 'applied-generation',
    generatedAt: '2026-08-30T00:00:00.000Z',
    snapshotMetadata: { includedEssayCount: 3, issueEligibleEssayCount: 3, totalEssayCount: 3, semanticCoverage: projection().projection.semanticCoverage },
    aiSummary: { overallComment: 'Old summary', strengths: [{ title: 'Old strength', detail: 'Old detail', dimensionIds: [] }], learningRecommendations: [{ title: 'Old next', action: 'Old action' }] },
  }
}

function teacherBlock(blockId: string, topicKey = `teacher.${blockId}`): ClassReviewIssueBlockV1 {
  return {
    blockId, topicKey, origin: 'teacher', title: `Title ${blockId}`, diagnosis: `Diagnosis ${blockId}`, teachingAction: `Action ${blockId}`, severity: 'medium',
    teacherStudentCount: 1, systemStudentCount: 0, combinedStudentCount: 1, occurrenceCount: 1, supportDenominator: null, anonymousExamples: [],
    evidenceRefs: [{ evidenceId: `evidence-${blockId}`, selectionOrigin: 'teacher_selected', sourceLocator: `source-${blockId}`, sourceResultRevision: 1, anonymousExample: null }],
  }
}

function teacherAddCommand(block: ClassReviewIssueBlockV1, essayIdentity: string) {
  return {
    kind: 'add' as const,
    blockId: block.blockId,
    topicKey: block.topicKey,
    title: block.title,
    diagnosis: block.diagnosis,
    teachingAction: block.teachingAction,
    severity: block.severity,
    evidence: [{ ref: block.evidenceRefs[0], essayIdentity, occurrenceCount: 1 }],
  }
}

function projection(): Extract<ClassReviewProjectionResult, { status: 'ready' }> {
  return {
    status: 'ready',
    projection: {
      statistics: { includedEssayCount: 3, issueEligibleEssayCount: 3, totalEssayCount: 3, excludedEssayCount: 0, score: { fullScore: 100, averageScore: 80, highestScore: 90, lowestScore: 70, medianScore: 80 }, scoreBands: [], dimensions: [], issueCounters: [] },
      groups: [],
      semanticCoverage: { projectedGroupCount: 0, eligibleGroupCount: 0, groupCoverage: 1, projectedDistinctEssaySupportSum: 0, eligibleDistinctEssaySupportSum: 0, supportWeightedCoverage: 1, projectedOccurrenceSum: 0, eligibleOccurrenceSum: 0, occurrenceWeightedCoverage: 1 },
    },
    hidden: { dimensionAliases: new Map(), selectedGroups: new Map(), unprojectedMustCover: [] },
  }
}

function projectionWithGroup(): Extract<ClassReviewProjectionResult, { status: 'ready' }> {
  const ready = projection()
  const atomicTopic = { kind: 'atomic' as const, keyVersion: 'topic-key-v1' as const, taskScope: `scope_v1_${'1'.repeat(32)}`, key: 'tk1.aaaaaaaaaaaaaaaa', fingerprintDigest: `fp1.${'b'.repeat(64)}` }
  ready.projection.groups = [{ groupId: 'g1', type: 'grammar', subtype: null, severity: 'medium', title: 'Agreement', mustCover: true, distinctEssaySupport: 2, occurrenceCount: 2, excerpt: { originalText: 'She go home.', suggestionOrDiagnosis: 'Use goes.' } }]
  ready.projection.semanticCoverage = { projectedGroupCount: 1, eligibleGroupCount: 1, groupCoverage: 1, projectedDistinctEssaySupportSum: 2, eligibleDistinctEssaySupportSum: 2, supportWeightedCoverage: 1, projectedOccurrenceSum: 2, eligibleOccurrenceSum: 2, occurrenceWeightedCoverage: 1 }
  ready.hidden.selectedGroups = new Map([['g1', { atomicTopic, title: { status: 'kept', text: 'Agreement', redactionVersion: 'class-review-redaction-v1', scrubbedEvidenceKey: `scrub_v1_${'1'.repeat(32)}` }, excerpt: { originalText: { status: 'kept', text: 'She go home.', redactionVersion: 'class-review-redaction-v1', scrubbedEvidenceKey: `scrub_v1_${'2'.repeat(32)}` }, suggestionOrDiagnosis: { status: 'kept', text: 'Use goes.', redactionVersion: 'class-review-redaction-v1', scrubbedEvidenceKey: `scrub_v1_${'3'.repeat(32)}` } }, essayIds: ['essay-a', 'essay-b'], occurrenceCount: 2 }]])
  return ready
}

function projectionWithTwoGroups(): Extract<ClassReviewProjectionResult, { status: 'ready' }> {
  const ready = projectionWithGroup()
  const atomicTopic = {
    kind: 'atomic' as const,
    keyVersion: 'topic-key-v1' as const,
    taskScope: `scope_v1_${'1'.repeat(32)}`,
    key: 'tk1.bbbbbbbbbbbbbbbb',
    fingerprintDigest: `fp1.${'c'.repeat(64)}`,
  }
  ready.projection.groups.push({
    groupId: 'g2',
    type: 'spelling',
    subtype: null,
    severity: 'low',
    title: 'Spelling',
    mustCover: true,
    distinctEssaySupport: 2,
    occurrenceCount: 3,
    excerpt: null,
  })
  ready.projection.semanticCoverage = {
    projectedGroupCount: 2,
    eligibleGroupCount: 2,
    groupCoverage: 1,
    projectedDistinctEssaySupportSum: 4,
    eligibleDistinctEssaySupportSum: 4,
    supportWeightedCoverage: 1,
    projectedOccurrenceSum: 5,
    eligibleOccurrenceSum: 5,
    occurrenceWeightedCoverage: 1,
  }
  ready.hidden.selectedGroups = new Map([
    ...ready.hidden.selectedGroups,
    ['g2', {
      atomicTopic,
      title: {
        status: 'kept',
        text: 'Spelling',
        redactionVersion: 'class-review-redaction-v1',
        scrubbedEvidenceKey: `scrub_v1_${'4'.repeat(32)}`,
      },
      excerpt: null,
      essayIds: ['essay-a', 'essay-c'],
      occurrenceCount: 3,
    }],
  ])
  return ready
}

function coordinator(client: ClassReviewSynthesisClient) {
  let id = 0
  const value = createLocalClassReviewCoordinator({ synthesisClient: client, topicKeySecret: new Uint8Array(32).fill(7), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: () => `opaque-${++id}` })
  value.registerWorkspace({ taskKey: 'task-1', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report: draft(), projection: projection() })
  return value
}

function deferredClient() {
  let calls = 0
  let resolve!: (value: ClassReviewSynthesisResultV1) => void
  const promise = new Promise<ClassReviewSynthesisResultV1>((done) => { resolve = done })
  const client: ClassReviewSynthesisClient = { synthesize: async () => { calls += 1; return promise } }
  return { client, resolve, calls: () => calls }
}

function success(requestId: string): ClassReviewSynthesisResultV1 {
  return { contractVersion: 'class-review-synthesis-result-v1', requestId, status: 'succeeded', output: { overallComment: 'Summary', strengths: [{ title: 'Strength', detail: 'Detail', dimensionIds: [] }], patterns: [], learningRecommendations: [{ title: 'Next', action: 'Practice' }] }, semanticCoverage: projection().projection.semanticCoverage, finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20, cachedTokens: 0 }, timingsMs: { queueMs: 0, providerMs: 1, validationMs: 0, totalMs: 1 } }
}

describe('local class review coordinator', () => {
  afterEach(() => vi.useRealTimers())

  it('atomically creates draft from eligible none and makes one call; initial failure preserves an existing teacher draft', async () => {
    const fakeNone = createFakeClassReviewSynthesisClient({ scenario: 'success' })
    const empty = createLocalClassReviewCoordinator({ synthesisClient: fakeNone, topicKeySecret: new Uint8Array(32), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: () => 'id' })
    empty.registerWorkspace({ taskKey: 'task-none', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report: none(), projection: projection() })
    await empty.generate({ taskKey: 'task-none', generationId: 'browser-none', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: null })
    expect(fakeNone.getCallCountForTest()).toBe(1)
    expect(empty.getSnapshot('task-none').report.workspaceState).not.toBe('none')
    const value = coordinator(createFakeClassReviewSynthesisClient({ scenario: 'auth_failed' }))
    await value.generate({ taskKey: 'task-1', generationId: 'browser-failed', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    expect(value.getSnapshot('task-1').report).toMatchObject({ workspaceState: 'draft', reportRevision: 1 })
    expect(value.getSnapshot('task-1').generation?.state).toBe('failed')
  })

  it('makes exactly one initial call and attaches double-click replay to the same actionable generation', async () => {
    const deferred = deferredClient()
    const value = coordinator(deferred.client)
    const first = value.generate({ taskKey: 'task-1', generationId: 'browser-g1', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    const replay = value.generate({ taskKey: 'task-1', generationId: 'browser-g2', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await vi.waitFor(() => expect(deferred.calls()).toBe(1))
    expect(deferred.calls()).toBe(1)
    expect(value.getSnapshot('task-1').generation?.state).toBe('running')
    const requestId = value.getSnapshot('task-1').requestId as string
    deferred.resolve(success(requestId))
    expect(await replay).toEqual(await first)
    expect(deferred.calls()).toBe(1)
  })

  it('conflicts an in-flight command whose report/source identity changed without a second call', async () => {
    const deferred = deferredClient(); const value = coordinator(deferred.client)
    const first = value.generate({ taskKey: 'task-1', generationId: 'browser-g1', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await vi.waitFor(() => expect(deferred.calls()).toBe(1))
    value.applyIssueCommand('task-1', teacherAddCommand(teacherBlock('identity-change'), 'essay-change'))
    value.noteOrdinaryResultRevisionAdvance('task-1')
    await expect(value.generate({ taskKey: 'task-1', generationId: 'browser-g2', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 2 })).rejects.toThrow('active_generation_conflict')
    expect(deferred.calls()).toBe(1)
    deferred.resolve(success(value.getSnapshot('task-1').requestId as string)); await first
  })

  it('deep-clones hidden Map content so caller mutation cannot alter the reserved identity', async () => {
    const deferred = deferredClient(); const ready = projection(); let id = 0
    const value = createLocalClassReviewCoordinator({ synthesisClient: deferred.client, topicKeySecret: new Uint8Array(32).fill(7), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: () => `opaque-${++id}` })
    value.registerWorkspace({ taskKey: 'task-1', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report: draft(), projection: ready })
    const first = value.generate({ taskKey: 'task-1', generationId: 'browser-g1', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await vi.waitFor(() => expect(deferred.calls()).toBe(1))
    ;(ready.hidden.dimensionAliases as Map<string, string>).set('dimension-1', 'alias-1')
    const replay = value.generate({ taskKey: 'task-1', generationId: 'browser-g2', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    expect(deferred.calls()).toBe(1)
    await vi.waitFor(() => expect(id).toBeGreaterThanOrEqual(4))
    await new Promise((resolve) => setTimeout(resolve, 25))
    deferred.resolve(success(value.getSnapshot('task-1').requestId as string)); await first
    await expect(replay).resolves.toMatchObject({ generationId: value.getSnapshot('task-1').generation?.generationId })
  })

  it('preserves the real projection builder non-enumerable hidden snapshot', async () => {
    const issue = { fingerprint: 'grammar-1', type: 'grammar' as const, subtype: null, severity: 'medium' as const, title: 'Agreement', originalText: 'She go home.', suggestionOrDiagnosis: 'Use goes.', changeTypes: ['grammar'], distinctEssaySupport: 2, occurrenceCount: 3, essayIds: ['essay-a', 'essay-b'], mustCover: true }
    const aggregate: ClassReviewAggregate = { totalEssayCount: 3, includedEssayCount: 3, issueEligibleEssayCount: 3, excludedEssayCount: 0, partialIssueChannelCount: 0, exclusions: [], fullScore: 100, scoreMedian: 80, scoreSummary: { averageScore: 80, highestScore: 90, lowestScore: 70 }, scoreBands: [], dimensions: [], fixedIssueCounters: [{ counterId: 'grammar', count: 3 }], issueGroups: [issue], commonIssueGroups: [issue], clearSpellingItems: [] }
    const kept = (text: string, key: string) => ({ status: 'kept' as const, text, redactionVersion: 'class-review-redaction-v1' as const, scrubbedEvidenceKey: key })
    const built = buildClassReviewProjection({ aggregate, redactionContext: { prepare: () => ({ atomicTopic: { kind: 'atomic', keyVersion: 'topic-key-v1', taskScope: `scope_v1_${'a'.repeat(32)}`, key: 'tk1.aaaaaaaaaaaaaaaa', fingerprintDigest: `fp1.${'b'.repeat(64)}` }, title: kept('Agreement', `scrub_v1_${'1'.repeat(32)}`), excerpt: { originalText: kept('She go home.', `scrub_v1_${'2'.repeat(32)}`), suggestionOrDiagnosis: kept('Use goes.', `scrub_v1_${'3'.repeat(32)}`) } }) }, limits: DEFAULT_CLASS_REVIEW_PROJECTION_LIMITS })
    expect(built.status).toBe('ready')
    if (built.status !== 'ready') throw new Error('projection not ready')
    expect(Object.getOwnPropertyDescriptor(built, 'hidden')?.enumerable).toBe(false)
    expect(built.hidden.selectedGroups.values().next().value).toMatchObject({ atomicTopic: { fingerprintDigest: `fp1.${'b'.repeat(64)}` }, occurrenceCount: 3, essayIds: ['essay-a', 'essay-b'], excerpt: { originalText: { text: 'She go home.' } } })
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'success' }); let id = 0
    const value = createLocalClassReviewCoordinator({ synthesisClient: fake, topicKeySecret: new Uint8Array(32).fill(7), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: () => `opaque-${++id}` })
    value.registerWorkspace({ taskKey: 'task-built', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report: draft(), projection: built })
    await value.generate({ taskKey: 'task-built', generationId: 'browser-built', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    expect(fake.getCallCountForTest()).toBe(1)
    expect(value.getSnapshot('task-built').report.issueBlocks[0]).toMatchObject({ occurrenceCount: 3, anonymousExamples: ['She go home.'] })
  })

  it('regenerates only after applied success; apply and discard candidates add zero calls', async () => {
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'success' })
    const value = coordinator(fake)
    await value.generate({ taskKey: 'task-1', generationId: 'browser-success', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    expect(fake.getCallCountForTest()).toBe(1)
    const applied = value.getSnapshot('task-1').report
    await value.generate({ taskKey: 'task-1', generationId: 'browser-regenerate', intent: 'regenerate', expectedTaskRevision: 1, expectedReportRevision: applied.reportRevision })
    expect(fake.getCallCountForTest()).toBe(2)

    const deferred = deferredClient()
    const conflict = coordinator(deferred.client)
    const completing = conflict.generate({ taskKey: 'task-1', generationId: 'browser-conflict', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await vi.waitFor(() => expect(conflict.getSnapshot('task-1').generation?.state).toBe('running'))
    conflict.syncExternalReport('task-1', { ...draft(1), reportRevision: 2 })
    deferred.resolve(success(conflict.getSnapshot('task-1').requestId as string))
    await completing
    const candidate = conflict.getSnapshot('task-1').generation
    expect(candidate?.state).toBe('succeeded_unapplied')
    expect(() => conflict.applyCandidate({ taskKey: 'task-1', generationId: candidate!.generationId, expectedTaskRevision: 1, expectedReportRevision: 1, expectedGenerationRevision: candidate!.generationRevision, expectedAiTextEditRevision: 0 })).toThrow('class_review_candidate_conflict')
    conflict.discardCandidate({ taskKey: 'task-1', generationId: candidate!.generationId, expectedGenerationRevision: candidate!.generationRevision })
    expect(deferred.calls()).toBe(1)
  })

  it('applies a current deferred candidate atomically and permits a later regeneration', async () => {
    const deferred = deferredClient()
    const value = coordinator(deferred.client)
    const pending = value.generate({ taskKey: 'task-1', generationId: 'browser-deferred', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await vi.waitFor(() => expect(value.getSnapshot('task-1').generation?.state).toBe('running'))
    value.syncExternalReport('task-1', { ...draft(1), reportRevision: 2 })
    deferred.resolve(success(value.getSnapshot('task-1').requestId as string))
    await pending

    const deferredCandidate = value.getSnapshot('task-1').generation
    expect(deferredCandidate?.state).toBe('succeeded_unapplied')
    value.applyCandidate({
      taskKey: 'task-1',
      generationId: deferredCandidate!.generationId,
      expectedTaskRevision: 1,
      expectedReportRevision: 2,
      expectedGenerationRevision: deferredCandidate!.generationRevision,
      expectedAiTextEditRevision: 1,
    })
    expect(value.getSnapshot('task-1')).toMatchObject({
      generation: { state: 'succeeded' },
      candidate: null,
      report: { workspaceState: 'ai_available' },
    })

    const appliedReport = value.getSnapshot('task-1').report
    await value.generate({ taskKey: 'task-1', generationId: 'browser-next', intent: 'regenerate', expectedTaskRevision: 1, expectedReportRevision: appliedReport.reportRevision })
    expect(deferred.calls()).toBe(2)
  })

  it.each(['result_unknown', 'succeeded_unapplied'] as const)('%s blocks every new generation', async (state) => {
    const fake = createFakeClassReviewSynthesisClient({ scenario: state === 'result_unknown' ? 'result_unknown' : 'success' })
    const value = coordinator(fake)
    if (state === 'succeeded_unapplied') {
      const deferred = deferredClient()
      const conflict = coordinator(deferred.client)
      const run = conflict.generate({ taskKey: 'task-1', generationId: 'browser-unapplied', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
      await vi.waitFor(() => expect(conflict.getSnapshot('task-1').generation?.state).toBe('running'))
      conflict.syncExternalReport('task-1', { ...draft(1), reportRevision: 2 })
      deferred.resolve(success(conflict.getSnapshot('task-1').requestId as string)); await run
      const unapplied = conflict.getSnapshot('task-1').generation
      await expect(conflict.generate({ taskKey: 'task-1', generationId: 'browser-unapplied-replay', intent: 'regenerate', expectedTaskRevision: 1, expectedReportRevision: 2 })).resolves.toMatchObject({ state: 'succeeded_unapplied', generationId: unapplied?.generationId })
      return
    }
    await value.generate({ taskKey: 'task-1', generationId: 'browser-unknown', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await expect(value.generate({ taskKey: 'task-1', generationId: 'browser-unknown-replay', intent: 'regenerate', expectedTaskRevision: 1, expectedReportRevision: 1 })).resolves.toMatchObject({ state: 'result_unknown' })
    expect(fake.getCallCountForTest()).toBe(1)
  })

  it('invalidates active work, deletes candidate evidence and fences a late result without pretending settlement', async () => {
    const deferred = deferredClient()
    const value = coordinator(deferred.client)
    const pending = value.generate({ taskKey: 'task-1', generationId: 'browser-invalidate', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await vi.waitFor(() => expect(value.getSnapshot('task-1').generation?.state).toBe('running'))
    const before = value.getSnapshot('task-1')
    value.invalidateSources('task-1', 'class_review_source_invalidated')
    const after = value.getSnapshot('task-1')
    expect(after.generation).toMatchObject({ state: 'invalidated', generationRevision: before.generation!.generationRevision + 1 })
    expect(after.candidate).toBeNull()
    expect(after.providerSettlementKnown).toBe(false)
    deferred.resolve(success(before.requestId as string))
    await pending
    expect(value.getSnapshot('task-1').generation?.state).toBe('invalidated')
    expect(value.getSnapshot('task-1').report).toEqual(after.report)
  })

  it('settles a confirmed-zero 429 before one same-identity requeue; unknown never requeues', async () => {
    vi.useFakeTimers()
    let calls = 0
    let releaseRate!: () => void
    const firstRate = new Promise<void>((resolve) => { releaseRate = resolve })
    const rateClient: ClassReviewSynthesisClient = { async synthesize(request) {
      calls += 1
      if (calls === 1) {
        await firstRate
        return { contractVersion: 'class-review-synthesis-result-v1', requestId: request.requestId, status: 'failed', safeFailureCode: 'provider_rate_limited', retryable: true, retryAfterMs: 10, completionDisposition: 'confirmed_zero_completion', finishReason: null, usage: null, timingsMs: { queueMs: 0, providerMs: 1, validationMs: 0, totalMs: 1 } }
      }
      return { contractVersion: 'class-review-synthesis-result-v1', requestId: request.requestId, status: 'failed', safeFailureCode: 'provider_rate_limited', retryable: true, retryAfterMs: 10, completionDisposition: 'confirmed_zero_completion', finishReason: null, usage: null, timingsMs: { queueMs: 0, providerMs: 1, validationMs: 0, totalMs: 1 } }
    } }
    const rate = coordinator(rateClient)
    const first = rate.generate({ taskKey: 'task-1', generationId: 'browser-rate', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await vi.waitFor(() => expect(calls).toBe(1))
    releaseRate(); await vi.advanceTimersByTimeAsync(0)
    expect(rate.getSnapshot('task-1')).toMatchObject({ generation: { state: 'queued' }, boundedRequeueCount: 1, providerSettlementKnown: true })
    const duplicateBeforeExpiry = rate.generate({ taskKey: 'task-1', generationId: 'browser-rate-duplicate', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await vi.advanceTimersByTimeAsync(9)
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(10)
    await first
    await duplicateBeforeExpiry
    expect(rate.getSnapshot('task-1').generation?.state).toBe('failed')
    expect(calls).toBe(2)
    const unknown = coordinator(createFakeClassReviewSynthesisClient({ scenario: 'result_unknown' }))
    await unknown.generate({ taskKey: 'task-1', generationId: 'browser-unknown-rate', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    expect(unknown.getSnapshot('task-1')).toMatchObject({ generation: { state: 'result_unknown' }, boundedRequeueCount: 0 })
  })

  it('maps an unstructured client rejection to result_unknown with no retry', async () => {
    const throwing: ClassReviewSynthesisClient = { synthesize: async (_request: ClassReviewSynthesisRequestV1) => { throw new Error('opaque') } }
    const value = coordinator(throwing)
    await value.generate({ taskKey: 'task-1', generationId: 'browser-throw', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    expect(value.getSnapshot('task-1')).toMatchObject({ generation: { state: 'result_unknown' }, boundedRequeueCount: 0 })
  })

  it('absorbs ordinary report/result revision changes but deletion fences the same deferred success', async () => {
    const ordinary = deferredClient(); const value = coordinator(ordinary.client)
    const pending = value.generate({ taskKey: 'task-1', generationId: 'browser-ordinary', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await vi.waitFor(() => expect(value.getSnapshot('task-1').generation?.state).toBe('running'))
    value.applyIssueCommand('task-1', teacherAddCommand(teacherBlock('ordinary-change'), 'essay-change'))
    value.noteOrdinaryResultRevisionAdvance('task-1')
    ordinary.resolve(success(value.getSnapshot('task-1').requestId as string)); await pending
    expect(value.getSnapshot('task-1').generation?.state).toBe('succeeded')
  })

  it('blocks AI-text editing while active but keeps issue commands legal', async () => {
    const deferred = deferredClient()
    const value = coordinator(deferred.client)
    const pending = value.generate({ taskKey: 'task-1', generationId: 'browser-edit-lock', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await vi.waitFor(() => expect(value.getSnapshot('task-1').generation?.state).toBe('running'))
    expect(() => value.beginAiTextEdit('task-1')).toThrow('ai_text_edit_locked')
    expect(() => value.saveAiTextEdit('task-1', { overallComment: 'text', strengths: [], learningRecommendations: [] })).toThrow('ai_text_edit_locked')
    expect(value.getSnapshot('task-1').report.aiTextEditRevision).toBe(0)
    expect(() => value.applyIssueCommand('task-1', teacherAddCommand(teacherBlock('while-active'), 'essay-active'))).not.toThrow()
    deferred.resolve(success(value.getSnapshot('task-1').requestId as string))
    await pending
  })

  it.each([
    { name: 'none cannot regenerate', report: none(), intent: 'regenerate' as const, expectedReportRevision: null },
    { name: 'draft cannot regenerate', report: draft(), intent: 'regenerate' as const, expectedReportRevision: 1 },
    { name: 'ai_removed cannot regenerate', report: { ...draft(), workspaceState: 'ai_removed' as const }, intent: 'regenerate' as const, expectedReportRevision: 1 },
    { name: 'ai_available cannot initial-generate', report: aiAvailable(), intent: 'initial' as const, expectedReportRevision: 1 },
  ])('rejects ineligible intent/workspace pair before crypto or synthesis: $name', async ({ report, intent, expectedReportRevision }) => {
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'success' })
    const value = createLocalClassReviewCoordinator({ synthesisClient: fake, topicKeySecret: new Uint8Array(32).fill(7), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: () => 'opaque' })
    value.registerWorkspace({ taskKey: 'task-eligibility', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report, projection: projection() })
    await expect(value.generate({ taskKey: 'task-eligibility', generationId: 'browser-ineligible', intent, expectedTaskRevision: 1, expectedReportRevision })).rejects.toThrow('class_review_not_eligible')
    expect(fake.getCallCountForTest()).toBe(0)
  })

  it.each([0, 1])('rejects N_success=%s before crypto or synthesis and accepts equality at two', async (includedEssayCount) => {
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'success' })
    const report = draft()
    report.statistics = { ...report.statistics, totalEssayCount: includedEssayCount, includedEssayCount, issueEligibleEssayCount: includedEssayCount, excludedEssayCount: 0, issueCoverageRate: 1, scoreSummary: includedEssayCount === 0 ? null : report.statistics.scoreSummary }
    const ready = projection()
    ready.projection.statistics = { ...ready.projection.statistics, totalEssayCount: includedEssayCount, includedEssayCount, issueEligibleEssayCount: includedEssayCount, excludedEssayCount: 0 }
    const value = createLocalClassReviewCoordinator({ synthesisClient: fake, topicKeySecret: new Uint8Array(32).fill(7), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: () => 'opaque' })
    value.registerWorkspace({ taskKey: 'task-sample', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report, projection: ready })
    await expect(value.generate({ taskKey: 'task-sample', generationId: 'browser-sample', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })).rejects.toThrow('class_review_not_eligible')
    expect(fake.getCallCountForTest()).toBe(0)
  })

  it('accepts N_success equality at two', async () => {
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'success' })
    const report = draft()
    report.statistics = { ...report.statistics, totalEssayCount: 2, includedEssayCount: 2, issueEligibleEssayCount: 2 }
    const ready = projection()
    ready.projection.statistics = { ...ready.projection.statistics, totalEssayCount: 2, includedEssayCount: 2, issueEligibleEssayCount: 2 }
    const value = createLocalClassReviewCoordinator({ synthesisClient: fake, topicKeySecret: new Uint8Array(32).fill(7), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: () => 'opaque' })
    value.registerWorkspace({ taskKey: 'task-sample-two', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report, projection: ready })
    await expect(value.generate({ taskKey: 'task-sample-two', generationId: 'browser-sample-two', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })).resolves.toMatchObject({ state: 'succeeded' })
    expect(fake.getCallCountForTest()).toBe(1)
  })

  it.each([
    { name: 'alias set differs', mutate: (ready: ReturnType<typeof projectionWithGroup>) => { ready.hidden.dimensionAliases = new Map([['d1', 'rubric-a']]); ready.projection.statistics.dimensions = [] } },
    { name: 'request/browser statistics disagree', mutate: (ready: ReturnType<typeof projectionWithGroup>) => { ready.projection.statistics.includedEssayCount = 2 } },
    { name: 'request group has no hidden owner', mutate: (ready: ReturnType<typeof projectionWithGroup>) => { ready.hidden.selectedGroups = new Map() } },
    { name: 'support and occurrence disagree', mutate: (ready: ReturnType<typeof projectionWithGroup>) => { const value = ready.hidden.selectedGroups.get('g1')!; ready.hidden.selectedGroups = new Map([['g1', { ...value, essayIds: ['essay-a'], occurrenceCount: 99 }]]) } },
    { name: 'fallback exceeds N_issue', mutate: (ready: ReturnType<typeof projectionWithGroup>) => { ready.hidden.unprojectedMustCover = [{ atomicTopic: { kind: 'atomic', keyVersion: 'topic-key-v1', taskScope: `scope_v1_${'1'.repeat(32)}`, key: 'tk1.cccccccccccccccc', fingerprintDigest: `fp1.${'c'.repeat(64)}` }, type: 'grammar', subtype: null, severity: 'medium', distinctEssaySupport: 4, occurrenceCount: 4, content: { kind: 'template', template: 'grammar' }, anonymousExample: null }] } },
    { name: 'selected/fallback identity duplicates globally', mutate: (ready: ReturnType<typeof projectionWithGroup>) => { const value = ready.hidden.selectedGroups.get('g1')!; ready.hidden.unprojectedMustCover = [{ atomicTopic: value.atomicTopic, type: 'grammar', subtype: null, severity: 'medium', distinctEssaySupport: 2, occurrenceCount: 2, content: { kind: 'template', template: 'grammar' }, anonymousExample: null }] } },
    { name: 'topic identity grammar is invalid', mutate: (ready: ReturnType<typeof projectionWithGroup>) => { const value = ready.hidden.selectedGroups.get('g1')!; ready.hidden.selectedGroups = new Map([['g1', { ...value, atomicTopic: { ...value.atomicTopic, key: 'raw-topic' } }]]) } },
    { name: 'topic scopes differ across ledger', mutate: (ready: ReturnType<typeof projectionWithGroup>) => { ready.hidden.unprojectedMustCover = [{ atomicTopic: { kind: 'atomic', keyVersion: 'topic-key-v1', taskScope: `scope_v1_${'2'.repeat(32)}`, key: 'tk1.cccccccccccccccc', fingerprintDigest: `fp1.${'c'.repeat(64)}` }, type: 'grammar', subtype: null, severity: 'medium', distinctEssaySupport: 2, occurrenceCount: 2, content: { kind: 'template', template: 'grammar' }, anonymousExample: null }] } },
    { name: 'duplicate atomic identity ownership', mutate: (ready: ReturnType<typeof projectionWithGroup>) => { const value = ready.hidden.selectedGroups.get('g1')!; ready.projection.groups.push({ ...ready.projection.groups[0], groupId: 'g2' }); ready.hidden.selectedGroups = new Map([['g1', value], ['g2', { ...value }]]) } },
  ])('fails the complete frozen request/hidden boundary locally with zero calls: $name', async ({ mutate }) => {
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'success' })
    const ready = projectionWithGroup()
    mutate(ready)
    const value = createLocalClassReviewCoordinator({ synthesisClient: fake, topicKeySecret: new Uint8Array(32).fill(7), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: () => 'opaque' })
    value.registerWorkspace({ taskKey: 'task-boundary', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report: draft(), projection: ready })
    await expect(value.generate({ taskKey: 'task-boundary', generationId: 'browser-boundary', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })).rejects.toThrow('class_review_candidate_conflict')
    expect(fake.getCallCountForTest()).toBe(0)
    expect(value.getSnapshot('task-boundary').generation).toBeNull()
  })

  it('parses and deep-freezes exact outbound request bytes before the client and preserves the retry/result binding', async () => {
    let calls = 0
    let requestWasFrozen = false
    let groupsWereFrozen = false
    let groupMutationWasRejected = false
    const client: ClassReviewSynthesisClient = { async synthesize(request) {
      calls += 1
      requestWasFrozen = Object.isFrozen(request)
      groupsWereFrozen = Object.isFrozen(request.groups)
      const originalRequestId = request.requestId
      Reflect.set(request, 'requestId', 'mutated-request')
      try { request.groups.push({ ...request.groups[0], groupId: 'mutated-group' }) } catch { groupMutationWasRejected = true }
      if (calls === 1) return { contractVersion: 'class-review-synthesis-result-v1', requestId: originalRequestId, status: 'failed', safeFailureCode: 'provider_rate_limited', retryable: true, retryAfterMs: 0, completionDisposition: 'confirmed_zero_completion', finishReason: null, usage: null, timingsMs: { queueMs: 0, providerMs: 1, validationMs: 0, totalMs: 1 } }
      return { ...success(originalRequestId), semanticCoverage: request.semanticCoverage }
    } }
    const value = createLocalClassReviewCoordinator({ synthesisClient: client, topicKeySecret: new Uint8Array(32).fill(7), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: (() => { let id = 0; return () => `opaque-${++id}` })() })
    value.registerWorkspace({ taskKey: 'task-frozen-request', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report: draft(), projection: projectionWithGroup() })
    await value.generate({ taskKey: 'task-frozen-request', generationId: 'browser-frozen-request', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    expect({ calls, requestWasFrozen, groupsWereFrozen, groupMutationWasRejected }).toEqual({ calls: 2, requestWasFrozen: true, groupsWereFrozen: true, groupMutationWasRejected: true })
    expect(value.getSnapshot('task-frozen-request').generation?.state).toBe('succeeded')
  })

  it('rejects duplicate workspace registration while an owner is active and lets the original owner settle', async () => {
    const deferred = deferredClient()
    const value = coordinator(deferred.client)
    const pending = value.generate({ taskKey: 'task-1', generationId: 'browser-owner', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await vi.waitFor(() => expect(deferred.calls()).toBe(1))
    expect(() => value.registerWorkspace({ taskKey: 'task-1', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report: draft(), projection: projection() })).toThrow('class_review_workspace_already_registered')
    deferred.resolve(success(value.getSnapshot('task-1').requestId as string))
    await pending
    expect(value.getSnapshot('task-1').generation?.state).toBe('succeeded')
  })

  it('stores actual AI summary content on save and cancel changes no content or revision', () => {
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'success' })
    const value = createLocalClassReviewCoordinator({ synthesisClient: fake, topicKeySecret: new Uint8Array(32).fill(7), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: () => 'opaque' })
    value.registerWorkspace({ taskKey: 'task-edit', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report: aiAvailable(), projection: projection() })
    const next: AiSummaryV1 = { overallComment: 'Saved summary', strengths: [{ title: 'Saved strength', detail: 'Saved detail', dimensionIds: [] }], learningRecommendations: [{ title: 'Saved next', action: 'Saved action' }] }
    value.saveAiTextEdit('task-edit', next)
    expect(value.getSnapshot('task-edit').report).toMatchObject({ aiSummary: next, reportRevision: 2, aiTextEditRevision: 1 })
  })

  it('cancels AI summary editing without changing content or any revision', () => {
    const value = createLocalClassReviewCoordinator({ synthesisClient: createFakeClassReviewSynthesisClient({ scenario: 'success' }), topicKeySecret: new Uint8Array(32).fill(7), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: () => 'opaque' })
    value.registerWorkspace({ taskKey: 'task-cancel', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report: aiAvailable(), projection: projection() })
    const before = value.getSnapshot('task-cancel').report
    value.cancelAiTextEdit('task-cancel')
    expect(value.getSnapshot('task-cancel').report).toEqual(before)
  })

  it('applies typed teacher add and move commands to content/order while advancing only report revision', () => {
    const value = coordinator(createFakeClassReviewSynthesisClient({ scenario: 'success' }))
    const first = teacherBlock('teacher-a')
    const second = teacherBlock('teacher-b')
    value.applyIssueCommand('task-1', teacherAddCommand(first, 'essay-a'))
    value.applyIssueCommand('task-1', teacherAddCommand(second, 'essay-b'))
    expect(value.getSnapshot('task-1').report).toMatchObject({ reportRevision: 3, aiTextEditRevision: 0, issueOrder: ['teacher-a', 'teacher-b'] })
  })

  it('moves only issueOrder and leaves issue content and AI-text revision unchanged', () => {
    const report = draft()
    const first = teacherBlock('teacher-a')
    const second = teacherBlock('teacher-b')
    report.issueBlocks = [first, second]
    report.issueOrder = [first.blockId, second.blockId]
    const value = createLocalClassReviewCoordinator({ synthesisClient: createFakeClassReviewSynthesisClient({ scenario: 'success' }), topicKeySecret: new Uint8Array(32).fill(7), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: () => 'opaque' })
    value.registerWorkspace({ taskKey: 'task-move', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report, projection: projection() })
    value.applyIssueCommand('task-move', { kind: 'move', blockId: 'teacher-b', toIndex: 0 })
    expect(value.getSnapshot('task-move').report).toMatchObject({ reportRevision: 2, aiTextEditRevision: 0, issueOrder: ['teacher-b', 'teacher-a'], issueBlocks: [first, second] })
  })

  it('applies typed teacher remove and undo commands with exact evidence restoration', () => {
    const report = draft()
    const block = teacherBlock('teacher-a')
    report.issueBlocks = [block]
    report.issueOrder = [block.blockId]
    const value = createLocalClassReviewCoordinator({ synthesisClient: createFakeClassReviewSynthesisClient({ scenario: 'success' }), topicKeySecret: new Uint8Array(32).fill(7), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: () => 'opaque' })
    value.registerWorkspace({ taskKey: 'task-remove', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report, projection: projection(), teacherEvidenceFacts: [{ topicKey: block.topicKey, evidenceId: block.evidenceRefs[0].evidenceId, essayIdentity: 'essay-a', occurrenceCount: 1 }] })
    value.applyIssueCommand('task-remove', { kind: 'remove', evidenceId: block.evidenceRefs[0].evidenceId })
    expect(value.getSnapshot('task-remove').report).toMatchObject({ reportRevision: 2, issueBlocks: [], issueOrder: [] })
    value.applyIssueCommand('task-remove', { kind: 'undo' })
    expect(value.getSnapshot('task-remove').report).toMatchObject({ reportRevision: 3, issueBlocks: [block], issueOrder: [block.blockId] })
  })

  it('rejects an unknown teacher evidence removal without advancing report state', () => {
    const value = coordinator(createFakeClassReviewSynthesisClient({ scenario: 'success' }))
    const block = teacherBlock('known-teacher')
    value.applyIssueCommand('task-1', teacherAddCommand(block, 'essay-known'))
    const before = value.getSnapshot('task-1').report

    expect(() => value.applyIssueCommand('task-1', {
      kind: 'remove',
      evidenceId: 'missing-evidence',
    })).toThrow('class_review_candidate_conflict')
    expect(value.getSnapshot('task-1').report).toEqual(before)
  })

  it('merges a deferred AI payload against latest teacher operations and never overwrites their order', async () => {
    const deferred = deferredClient()
    const value = coordinator(deferred.client)
    const pending = value.generate({ taskKey: 'task-1', generationId: 'browser-latest-teacher', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await vi.waitFor(() => expect(deferred.calls()).toBe(1))
    const added = teacherBlock('teacher-late')
    value.applyIssueCommand('task-1', teacherAddCommand(added, 'essay-late'))
    deferred.resolve(success(value.getSnapshot('task-1').requestId as string))
    await pending
    expect(value.getSnapshot('task-1').report.issueOrder).toContain('teacher-late')
    expect(value.getSnapshot('task-1').report.issueBlocks).toContainEqual(added)
  })

  it('stores a generated payload rather than a stale report and reapplies it to the latest teacher workspace under four-revision CAS', async () => {
    const deferred = deferredClient()
    const value = coordinator(deferred.client)
    const pending = value.generate({ taskKey: 'task-1', generationId: 'browser-unapplied-latest', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await vi.waitFor(() => expect(deferred.calls()).toBe(1))
    value.syncExternalReport('task-1', { ...draft(1), reportRevision: 2 })
    deferred.resolve(success(value.getSnapshot('task-1').requestId as string))
    await pending
    const unapplied = value.getSnapshot('task-1')
    expect(unapplied.generation?.state).toBe('succeeded_unapplied')
    expect(unapplied.candidate).not.toHaveProperty('contractVersion')
    expect(unapplied.candidate).toHaveProperty('generatedPayload.aiSummary.overallComment', 'Summary')

    const latestTeacher = teacherBlock('teacher-after-candidate')
    value.applyIssueCommand('task-1', teacherAddCommand(latestTeacher, 'essay-after'))
    const current = value.getSnapshot('task-1')
    value.applyCandidate({
      taskKey: 'task-1', generationId: current.generation!.generationId, expectedTaskRevision: current.report.taskRevision,
      expectedReportRevision: current.report.reportRevision!, expectedGenerationRevision: current.generation!.generationRevision,
      expectedAiTextEditRevision: current.report.aiTextEditRevision,
    })
    expect(value.getSnapshot('task-1').report.issueOrder).toContain(latestTeacher.blockId)
    expect(value.getSnapshot('task-1').report.issueBlocks).toContainEqual(latestTeacher)
  })

  it('binds coordinator apply/discard candidate commands to the owning task scope', async () => {
    const deferred = deferredClient()
    const value = coordinator(deferred.client)
    value.registerWorkspace({ taskKey: 'task-2', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report: draft(1), projection: projection() })
    const pending = value.generate({ taskKey: 'task-1', generationId: 'browser-owned-candidate', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await vi.waitFor(() => expect(deferred.calls()).toBe(1))
    value.syncExternalReport('task-1', { ...draft(1), reportRevision: 2 })
    deferred.resolve(success(value.getSnapshot('task-1').requestId as string))
    await pending
    const candidate = value.getSnapshot('task-1').generation!
    expect(() => value.applyCandidate({ taskKey: 'task-2', generationId: candidate.generationId, expectedTaskRevision: 1, expectedReportRevision: 1, expectedGenerationRevision: candidate.generationRevision, expectedAiTextEditRevision: 1 })).toThrow('class_review_candidate_conflict')
    expect(() => value.discardCandidate({ taskKey: 'task-2', generationId: candidate.generationId, expectedGenerationRevision: candidate.generationRevision })).toThrow('class_review_candidate_conflict')
    expect(value.getSnapshot('task-1').generation?.state).toBe('succeeded_unapplied')
  })

  it('retains current statistics when an old frozen snapshot completes', async () => {
    const deferred = deferredClient()
    const value = coordinator(deferred.client)
    const pending = value.generate({ taskKey: 'task-1', generationId: 'browser-current-statistics', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await vi.waitFor(() => expect(deferred.calls()).toBe(1))
    const latest = draft()
    latest.reportRevision = 2
    latest.statistics = { ...latest.statistics, totalEssayCount: 7, includedEssayCount: 6, issueEligibleEssayCount: 5, excludedEssayCount: 1, issueCoverageRate: 5 / 6 }
    value.syncExternalReport('task-1', latest)
    deferred.resolve(success(value.getSnapshot('task-1').requestId as string))
    await pending
    expect(value.getSnapshot('task-1').report.statistics).toEqual(latest.statistics)
  })

  it('clears applied system state on source invalidation and never restores a suppressed variant', async () => {
    const block = teacherBlock('teacher-system', 'tk1.aaaaaaaaaaaaaaaa')
    const report = draft()
    report.issueBlocks = [block]
    report.issueOrder = [block.blockId]
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'success' })
    const value = createLocalClassReviewCoordinator({ synthesisClient: fake, topicKeySecret: new Uint8Array(32).fill(7), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: (() => { let id = 0; return () => `opaque-${++id}` })() })
    value.registerWorkspace({ taskKey: 'task-system', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report, projection: projectionWithGroup(), teacherEvidenceFacts: [{ topicKey: block.topicKey, evidenceId: block.evidenceRefs[0].evidenceId, essayIdentity: 'essay-a', occurrenceCount: 1 }] })
    await value.generate({ taskKey: 'task-system', generationId: 'browser-system', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    expect(value.getSnapshot('task-system').report.issueBlocks[0]).toMatchObject({ origin: 'teacher', systemStudentCount: 2 })
    value.invalidateSources('task-system', 'class_review_source_invalidated')
    expect(value.getSnapshot('task-system').report.workspaceState).toBe('ai_removed')
    value.applyIssueCommand('task-system', { kind: 'remove', evidenceId: block.evidenceRefs[0].evidenceId })
    expect(value.getSnapshot('task-system').report.issueBlocks).toHaveLength(0)
  })

  it('persists one internal suppressed system variant and restores it in place after the final teacher source is removed', async () => {
    const block = teacherBlock('teacher-system', 'tk1.aaaaaaaaaaaaaaaa')
    const report = draft()
    report.issueBlocks = [block]
    report.issueOrder = [block.blockId]
    const value = createLocalClassReviewCoordinator({ synthesisClient: createFakeClassReviewSynthesisClient({ scenario: 'success' }), topicKeySecret: new Uint8Array(32).fill(7), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: (() => { let id = 0; return () => `opaque-${++id}` })() })
    value.registerWorkspace({ taskKey: 'task-restore', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report, projection: projectionWithGroup(), teacherEvidenceFacts: [{ topicKey: block.topicKey, evidenceId: block.evidenceRefs[0].evidenceId, essayIdentity: 'essay-a', occurrenceCount: 1 }] })
    await value.generate({ taskKey: 'task-restore', generationId: 'browser-restore', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    value.applyIssueCommand('task-restore', { kind: 'remove', evidenceId: block.evidenceRefs[0].evidenceId })
    expect(value.getSnapshot('task-restore').report.issueBlocks[0]).toMatchObject({ blockId: block.blockId, origin: 'ai', title: 'Common issue', systemStudentCount: 2 })
    expect(value.getSnapshot('task-restore').report.issueOrder).toEqual([block.blockId])
  })

  it('suppresses one generated topic without dropping other generated topics or their restoration facts', async () => {
    const value = createLocalClassReviewCoordinator({
      synthesisClient: createFakeClassReviewSynthesisClient({ scenario: 'success' }),
      topicKeySecret: new Uint8Array(32).fill(7),
      now: () => '2026-08-30T00:00:00.000Z',
      createOpaqueId: (() => {
        let id = 0
        return () => `opaque-${++id}`
      })(),
    })
    value.registerWorkspace({
      taskKey: 'task-two-system-topics',
      taskRevision: 1,
      rubricRevisionDigest: validRubricDigest,
      report: draft(),
      projection: projectionWithTwoGroups(),
    })
    await value.generate({
      taskKey: 'task-two-system-topics',
      generationId: 'browser-two-system-topics',
      intent: 'initial',
      expectedTaskRevision: 1,
      expectedReportRevision: 1,
    })
    const generated = value.getSnapshot('task-two-system-topics').report
    expect(generated.issueBlocks).toHaveLength(2)

    const teacher = teacherBlock('teacher-overlap', 'tk1.aaaaaaaaaaaaaaaa')
    value.applyIssueCommand(
      'task-two-system-topics',
      teacherAddCommand(teacher, 'essay-a'),
    )
    const mixed = value.getSnapshot('task-two-system-topics').report
    expect(mixed.issueBlocks).toHaveLength(2)
    expect(mixed.issueBlocks.map((block) => block.topicKey)).toContain('tk1.bbbbbbbbbbbbbbbb')

    value.applyIssueCommand('task-two-system-topics', {
      kind: 'remove',
      evidenceId: teacher.evidenceRefs[0].evidenceId,
    })
    const restored = value.getSnapshot('task-two-system-topics').report
    expect(restored.issueBlocks).toHaveLength(2)
    expect(restored.issueBlocks.map((block) => block.topicKey)).toEqual([
      'tk1.aaaaaaaaaaaaaaaa',
      'tk1.bbbbbbbbbbbbbbbb',
    ])
  })

  it('does not expose a public Retry-After resume path', () => {
    const value = coordinator(createFakeClassReviewSynthesisClient({ scenario: 'success' }))
    expect(value).not.toHaveProperty('resumeQueued')
  })

  it('classifies an invalid local clock as a local candidate conflict, not a Provider response failure', async () => {
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'success' })
    const value = createLocalClassReviewCoordinator({ synthesisClient: fake, topicKeySecret: new Uint8Array(32).fill(7), now: () => 'not-rfc3339', createOpaqueId: () => 'opaque' })
    value.registerWorkspace({ taskKey: 'task-clock', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report: draft(), projection: projection() })
    await value.generate({ taskKey: 'task-clock', generationId: 'browser-clock', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    expect(value.getSnapshot('task-clock').generation).toMatchObject({ state: 'failed', safeFailureCode: 'class_review_candidate_conflict' })
  })
})
