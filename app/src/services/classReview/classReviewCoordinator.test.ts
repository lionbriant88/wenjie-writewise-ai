import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClassReviewReportDraftV1, ClassReviewReportNoneV1, ClassReviewSynthesisRequestV1, ClassReviewSynthesisResultV1 } from './types'
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

function coordinator(client: ClassReviewSynthesisClient) {
  let id = 0
  const value = createLocalClassReviewCoordinator({ synthesisClient: client, topicKeySecret: new Uint8Array(32).fill(7), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: () => `opaque-${++id}` })
  value.registerWorkspace({ taskKey: 'task-1', taskRevision: 1, rubricRevisionDigest: 'a'.repeat(64), report: draft(), projection: projection() })
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
    empty.registerWorkspace({ taskKey: 'task-none', taskRevision: 1, rubricRevisionDigest: 'a'.repeat(64), report: none(), projection: projection() })
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
    value.applyIssueCommand('task-1', { kind: 'sort', blockIds: [] })
    value.noteOrdinaryResultRevisionAdvance('task-1')
    await expect(value.generate({ taskKey: 'task-1', generationId: 'browser-g2', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 2 })).rejects.toThrow('active_generation_conflict')
    expect(deferred.calls()).toBe(1)
    deferred.resolve(success(value.getSnapshot('task-1').requestId as string)); await first
  })

  it('deep-clones hidden Map content so caller mutation cannot alter the reserved identity', async () => {
    const deferred = deferredClient(); const ready = projection(); let id = 0
    const value = createLocalClassReviewCoordinator({ synthesisClient: deferred.client, topicKeySecret: new Uint8Array(32).fill(7), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: () => `opaque-${++id}` })
    value.registerWorkspace({ taskKey: 'task-1', taskRevision: 1, rubricRevisionDigest: 'a'.repeat(64), report: draft(), projection: ready })
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
    value.registerWorkspace({ taskKey: 'task-built', taskRevision: 1, rubricRevisionDigest: 'a'.repeat(64), report: draft(), projection: built })
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
    await vi.advanceTimersByTimeAsync(10)
    await first
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
    value.applyIssueCommand('task-1', { kind: 'sort', blockIds: [] })
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
    expect(() => value.saveAiTextEdit('task-1', 'text')).toThrow('ai_text_edit_locked')
    expect(value.getSnapshot('task-1').report.aiTextEditRevision).toBe(0)
    expect(() => value.applyIssueCommand('task-1', { kind: 'sort', blockIds: [] })).not.toThrow()
    deferred.resolve(success(value.getSnapshot('task-1').requestId as string))
    await pending
  })
})
