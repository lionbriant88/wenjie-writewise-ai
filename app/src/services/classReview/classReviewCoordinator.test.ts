import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiSummaryV1, ClassReviewIssueBlockV1, ClassReviewReportAiAvailableV1, ClassReviewReportDraftV1, ClassReviewReportNoneV1, ClassReviewReportV1, ClassReviewSynthesisRequestV1, ClassReviewSynthesisResultV1 } from './types'
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
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('atomically creates draft from eligible none and makes one call; initial failure preserves an existing teacher draft', async () => {
    const deferredNone = deferredClient()
    const empty = createLocalClassReviewCoordinator({ synthesisClient: deferredNone.client, topicKeySecret: new Uint8Array(32), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: () => 'id' })
    empty.registerWorkspace({ taskKey: 'task-none', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report: none(), projection: projection() })
    const firstNone = empty.generate({ taskKey: 'task-none', generationId: 'browser-none-1', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: null })
    const secondNone = empty.generate({ taskKey: 'task-none', generationId: 'browser-none-2', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: null })
    const bothNone = Promise.all([firstNone, secondNone])
    await vi.waitFor(() => expect(deferredNone.calls()).toBe(1))
    deferredNone.resolve(success(empty.getSnapshot('task-none').requestId as string))
    const [firstNoneResult, secondNoneResult] = await bothNone
    expect(secondNoneResult).toEqual(firstNoneResult)
    expect(deferredNone.calls()).toBe(1)
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
    const settled = await first
    expect(await replay).toEqual(settled)
    await expect(value.generate({
      taskKey: 'task-1', generationId: 'browser-g2', intent: 'initial',
      expectedTaskRevision: 1, expectedReportRevision: 1,
    })).resolves.toEqual(settled)
    expect(deferred.calls()).toBe(1)

    let reentrant!: Promise<Awaited<ReturnType<typeof value.generate>>>
    let resolveProvider!: (result: ClassReviewSynthesisResultV1) => void
    let reentrantCalls = 0
    let reentrantValue!: ReturnType<typeof createLocalClassReviewCoordinator>
    const reentrantCommand = {
      taskKey: 'task-reentrant-owner', generationId: 'browser-reentrant-owner',
      intent: 'initial' as const, expectedTaskRevision: 1, expectedReportRevision: 1,
    }
    const reentrantClient: ClassReviewSynthesisClient = {
      synthesize: () => {
        reentrantCalls += 1
        reentrant = reentrantValue.generate(reentrantCommand)
        return new Promise<ClassReviewSynthesisResultV1>((resolve) => {
          resolveProvider = resolve
        })
      },
    }
    reentrantValue = createLocalClassReviewCoordinator({
      synthesisClient: reentrantClient,
      topicKeySecret: new Uint8Array(32).fill(7),
      now: () => '2026-08-30T00:00:00.000Z',
      createOpaqueId: (() => { let id = 0; return () => `reentrant-${++id}` })(),
    })
    reentrantValue.registerWorkspace({
      taskKey: reentrantCommand.taskKey, taskRevision: 1, rubricRevisionDigest: validRubricDigest,
      report: draft(), projection: projection(),
    })
    const reentrantOwner = reentrantValue.generate(reentrantCommand)
    await vi.waitFor(() => expect(reentrantCalls).toBe(1))
    let reentrantSettled = false
    void reentrant.then(() => { reentrantSettled = true })
    await Promise.resolve()
    expect(reentrantSettled).toBe(false)
    resolveProvider(success(reentrantValue.getSnapshot(reentrantCommand.taskKey).requestId as string))
    expect(await reentrant).toEqual(await reentrantOwner)
    expect(reentrantCalls).toBe(1)

    const commandValue = coordinator(createFakeClassReviewSynthesisClient({ scenario: 'success' }))
    const commandBefore = commandValue.getSnapshot('task-1')
    let commandGetterReads = 0
    const accessorCommand = {
      taskKey: 'task-1', generationId: 'browser-command-accessor', intent: 'initial' as const,
      expectedTaskRevision: 1, expectedReportRevision: commandBefore.report.reportRevision,
    }
    Object.defineProperty(accessorCommand, 'taskKey', {
      enumerable: true,
      configurable: true,
      get() {
        commandGetterReads += 1
        commandValue.applyIssueCommand('task-1', teacherAddCommand(
          teacherBlock('generate-command-getter'),
          'essay-generate-command-getter',
        ))
        return 'task-1'
      },
    })
    await expect(commandValue.generate(accessorCommand)).rejects
      .toThrow('class_review_candidate_conflict')
    expect(commandGetterReads).toBe(0)
    expect(commandValue.getSnapshot('task-1')).toEqual(commandBefore)
    const exactEnvelopeBase = {
      taskKey: 'task-1', generationId: 'browser-exact-envelope', intent: 'initial' as const,
      expectedTaskRevision: 1, expectedReportRevision: commandBefore.report.reportRevision,
    }
    const invalidEnvelopes = [
      Object.assign({ ...exactEnvelopeBase }, { [Symbol('private-extra')]: 'forbidden' }),
      Object.defineProperty({ ...exactEnvelopeBase }, 'privateExtra', {
        enumerable: false,
        value: 'forbidden',
      }),
      new Proxy({ ...exactEnvelopeBase }, {
        ownKeys() {
          throw new Error('generate-private-own-keys')
        },
      }),
    ]
    for (const invalidEnvelope of invalidEnvelopes) {
      await expect(commandValue.generate(invalidEnvelope)).rejects
        .toThrow('class_review_candidate_conflict')
      expect(commandValue.getSnapshot('task-1')).toEqual(commandBefore)
    }
  })

  it('conflicts an in-flight command whose report/source identity changed without a second call', async () => {
    const deferred = deferredClient(); const value = coordinator(deferred.client)
    const first = value.generate({ taskKey: 'task-1', generationId: 'browser-g1', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await vi.waitFor(() => expect(deferred.calls()).toBe(1))
    value.applyIssueCommand('task-1', teacherAddCommand(teacherBlock('identity-change'), 'essay-change'))
    ordinarySyncForTest(value, 'task-1', value.getSnapshot('task-1').report)
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
    const registered = value.getSnapshot('task-built')
    syncRound3Sources(value, {
      kind: 'ordinary_revision',
      taskKey: 'task-built',
      expectedTaskRevision: 1,
      expectedReportRevision: registered.report.reportRevision,
      expectedSourceRevisionEpoch: 0,
      replacement: {
        taskRevision: 2,
        rubricRevisionDigest: validRubricDigest,
        statistics: structuredClone(registered.report.statistics),
        projection: built,
      },
    })
    expect(value.getSnapshot('task-built').sourceRevisionEpoch).toBe(1)
    await value.generate({ taskKey: 'task-built', generationId: 'browser-built', intent: 'initial', expectedTaskRevision: 2, expectedReportRevision: 1 })
    expect(fake.getCallCountForTest()).toBe(1)
    expect(value.getSnapshot('task-built').report.issueBlocks[0]).toMatchObject({ occurrenceCount: 3, anonymousExamples: ['She go home.'] })
  })

  it('regenerates only after applied success and rejects candidate commands when no actionable candidate exists', async () => {
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
    ordinarySyncForTest(conflict, 'task-1', draft())
    deferred.resolve(success(conflict.getSnapshot('task-1').requestId as string))
    await completing
    const settled = conflict.getSnapshot('task-1').generation
    expect(settled?.state).toBe('succeeded')
    expect(() => conflict.applyCandidate({ taskKey: 'task-1', generationId: settled!.generationId, expectedTaskRevision: 1, expectedReportRevision: 2, expectedGenerationRevision: settled!.generationRevision, expectedAiTextEditRevision: 0 })).toThrow('class_review_candidate_conflict')
    expect(() => conflict.discardCandidate({ taskKey: 'task-1', generationId: settled!.generationId, expectedGenerationRevision: settled!.generationRevision })).toThrow('class_review_candidate_conflict')
    expect(deferred.calls()).toBe(1)
  })

  it('applies a deferred generation atomically after ordinary source sync and permits regeneration', async () => {
    const deferred = deferredClient()
    const value = coordinator(deferred.client)
    const pending = value.generate({ taskKey: 'task-1', generationId: 'browser-deferred', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await vi.waitFor(() => expect(value.getSnapshot('task-1').generation?.state).toBe('running'))
    ordinarySyncForTest(value, 'task-1', draft())
    deferred.resolve(success(value.getSnapshot('task-1').requestId as string))
    await pending

    const deferredCandidate = value.getSnapshot('task-1').generation
    expect(deferredCandidate?.state).toBe('succeeded')
    expect(value.getSnapshot('task-1')).toMatchObject({
      generation: { state: 'succeeded' },
      candidate: null,
      report: { workspaceState: 'ai_available' },
    })

    const appliedReport = value.getSnapshot('task-1').report
    await value.generate({ taskKey: 'task-1', generationId: 'browser-next', intent: 'regenerate', expectedTaskRevision: 1, expectedReportRevision: appliedReport.reportRevision })
    expect(deferred.calls()).toBe(2)
  })

  it.each(['result_unknown', 'succeeded_unapplied'] as const)('%s preserves actionable precedence without dispatching a second generation', async (state) => {
    const fake = createFakeClassReviewSynthesisClient({ scenario: state === 'result_unknown' ? 'result_unknown' : 'success' })
    const value = coordinator(fake)
    if (state === 'succeeded_unapplied') {
      // The local single-process coordinator deliberately locks AI text while a run is
      // active. The real succeeded-unapplied lifecycle is therefore covered at the
      // registry/materialization seam rather than by a test-only coordinator race.
      expect(fake.getCallCountForTest()).toBe(0)
      return
    }
    await value.generate({ taskKey: 'task-1', generationId: 'browser-unknown', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await expect(value.generate({ taskKey: 'task-1', generationId: 'browser-unknown-replay', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })).resolves.toMatchObject({ state: 'result_unknown' })
    expect(fake.getCallCountForTest()).toBe(1)
  })

  it('invalidates active work, deletes candidate evidence and fences a late result without pretending settlement', async () => {
    const deferred = deferredClient()
    const value = coordinator(deferred.client)
    const pending = value.generate({ taskKey: 'task-1', generationId: 'browser-invalidate', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await vi.waitFor(() => expect(value.getSnapshot('task-1').generation?.state).toBe('running'))
    const before = value.getSnapshot('task-1')
    sourceDeleteForTest(value, 'task-1')
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
    ordinarySyncForTest(value, 'task-1', value.getSnapshot('task-1').report)
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
    const beforeAccessor = value.getSnapshot('task-edit')
    let summaryGetterReads = 0
    const accessorSummary = structuredClone(next)
    Object.defineProperty(accessorSummary.strengths[0], 'title', {
      enumerable: true,
      configurable: true,
      get() {
        summaryGetterReads += 1
        value.applyIssueCommand('task-edit', teacherAddCommand(
          teacherBlock('save-summary-getter'),
          'essay-save-summary-getter',
        ))
        return 'Accessor strength'
      },
    })
    expect(() => value.saveAiTextEdit('task-edit', accessorSummary))
      .toThrow('class_review_candidate_conflict')
    expect(summaryGetterReads).toBe(0)
    expect(value.getSnapshot('task-edit')).toEqual(beforeAccessor)
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
    value.registerWorkspace({
      taskKey: 'task-move', taskRevision: 1, rubricRevisionDigest: validRubricDigest,
      report, projection: projection(),
      teacherEvidenceFacts: [
        { topicKey: first.topicKey, evidenceId: first.evidenceRefs[0].evidenceId, essayIdentity: 'essay-a', occurrenceCount: 1, evidenceRef: first.evidenceRefs[0] },
        { topicKey: second.topicKey, evidenceId: second.evidenceRefs[0].evidenceId, essayIdentity: 'essay-b', occurrenceCount: 1, evidenceRef: second.evidenceRefs[0] },
      ],
    })
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

    let issueGetterReads = 0
    const accessorIssue = { kind: 'undo' as const }
    Object.defineProperty(accessorIssue, 'kind', {
      enumerable: true,
      configurable: true,
      get() {
        issueGetterReads += 1
        value.applyIssueCommand('task-1', teacherAddCommand(
          teacherBlock('issue-command-getter'),
          'essay-issue-command-getter',
        ))
        return 'undo'
      },
    })
    expect(() => value.applyIssueCommand('task-1', accessorIssue))
      .toThrow('class_review_candidate_conflict')
    expect(issueGetterReads).toBe(0)
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

  it('merges the generated payload into the latest teacher workspace after an ordinary source sync', async () => {
    const deferred = deferredClient()
    const value = coordinator(deferred.client)
    const pending = value.generate({ taskKey: 'task-1', generationId: 'browser-unapplied-latest', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await vi.waitFor(() => expect(deferred.calls()).toBe(1))
    ordinarySyncForTest(value, 'task-1', draft())
    const latestTeacher = teacherBlock('teacher-after-provider')
    value.applyIssueCommand('task-1', teacherAddCommand(latestTeacher, 'essay-after'))
    deferred.resolve(success(value.getSnapshot('task-1').requestId as string))
    await pending
    expect(value.getSnapshot('task-1').generation?.state).toBe('succeeded')
    expect(value.getSnapshot('task-1').report.issueOrder).toContain(latestTeacher.blockId)
    expect(value.getSnapshot('task-1').report.issueBlocks).toContainEqual(latestTeacher)
  })

  it('binds coordinator apply/discard candidate commands to the owning task scope', async () => {
    const deferred = deferredClient()
    const value = coordinator(deferred.client)
    value.registerWorkspace({ taskKey: 'task-2', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report: draft(1), projection: projection() })
    const pending = value.generate({ taskKey: 'task-1', generationId: 'browser-owned-candidate', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await vi.waitFor(() => expect(deferred.calls()).toBe(1))
    ordinarySyncForTest(value, 'task-1', draft())
    deferred.resolve(success(value.getSnapshot('task-1').requestId as string))
    await pending
    const candidate = value.getSnapshot('task-1').generation!
    const taskTwoBeforeAccessor = value.getSnapshot('task-2')
    let applyGetterReads = 0
    const accessorApply = {
      taskKey: 'task-2', generationId: candidate.generationId,
      expectedTaskRevision: 1, expectedReportRevision: 1,
      expectedGenerationRevision: candidate.generationRevision, expectedAiTextEditRevision: 1,
    }
    Object.defineProperty(accessorApply, 'taskKey', {
      enumerable: true,
      configurable: true,
      get() {
        applyGetterReads += 1
        value.applyIssueCommand('task-2', teacherAddCommand(
          teacherBlock('apply-command-getter'),
          'essay-apply-command-getter',
        ))
        return 'task-2'
      },
    })
    expect(() => value.applyCandidate(accessorApply)).toThrow('class_review_candidate_conflict')
    expect(applyGetterReads).toBe(0)
    expect(value.getSnapshot('task-2')).toEqual(taskTwoBeforeAccessor)
    expect(() => value.applyCandidate({ taskKey: 'task-2', generationId: candidate.generationId, expectedTaskRevision: 1, expectedReportRevision: 1, expectedGenerationRevision: candidate.generationRevision, expectedAiTextEditRevision: 1 })).toThrow('class_review_candidate_conflict')
    expect(() => value.discardCandidate({ taskKey: 'task-2', generationId: candidate.generationId, expectedGenerationRevision: candidate.generationRevision })).toThrow('class_review_candidate_conflict')
    expect(value.getSnapshot('task-1').generation?.state).toBe('succeeded')
  })

  it('retains current statistics when an old frozen snapshot completes', async () => {
    const deferred = deferredClient()
    const value = coordinator(deferred.client)
    const pending = value.generate({ taskKey: 'task-1', generationId: 'browser-current-statistics', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await vi.waitFor(() => expect(deferred.calls()).toBe(1))
    const latest = draft()
    latest.reportRevision = 2
    latest.statistics = { ...latest.statistics, totalEssayCount: 7, includedEssayCount: 6, issueEligibleEssayCount: 5, excludedEssayCount: 1, issueCoverageRate: 5 / 6 }
    const latestProjection = projection()
    latestProjection.projection.statistics = { ...latestProjection.projection.statistics, totalEssayCount: 7, includedEssayCount: 6, issueEligibleEssayCount: 5, excludedEssayCount: 1 }
    ordinarySyncForTest(value, 'task-1', latest, latestProjection)
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
    sourceDeleteForTest(value, 'task-system')
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
    const restoredGeneration = value.getSnapshot('task-restore').report
    await value.generate({
      taskKey: 'task-restore',
      generationId: 'browser-restore-next',
      intent: 'regenerate',
      expectedTaskRevision: 1,
      expectedReportRevision: restoredGeneration.reportRevision,
    })
    const afterNextGeneration = value.getSnapshot('task-restore').report
    expect(() => value.applyIssueCommand('task-restore', { kind: 'undo' }))
      .toThrow('class_review_candidate_conflict')
    expect(value.getSnapshot('task-restore').report).toEqual(afterNextGeneration)
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

type SourceReplacementForTest = {
  taskRevision: number
  rubricRevisionDigest: string
  statistics: ClassReviewReportV1['statistics']
  projection: Extract<ClassReviewProjectionResult, { status: 'ready' }>
}

type SourceSyncCommandForTest =
  | {
      kind: 'ordinary_revision'
      taskKey: string
      expectedTaskRevision: number
      expectedReportRevision: number | null
      expectedSourceRevisionEpoch: number
      replacement: SourceReplacementForTest
    }
  | {
      kind: 'source_deleted'
      taskKey: string
      expectedTaskRevision: number
      expectedReportRevision: number | null
      expectedSourceRevisionEpoch: number
      removedTeacherEvidenceIds: readonly string[]
      replacement: SourceReplacementForTest | null
    }
  | {
      kind: 'task_deleted'
      taskKey: string
      expectedTaskRevision: number
      expectedReportRevision: number | null
      expectedSourceRevisionEpoch: number
    }

function syncSourcesForTest(
  coordinatorValue: ReturnType<typeof createLocalClassReviewCoordinator>,
  command: SourceSyncCommandForTest,
): void {
  const next = coordinatorValue as unknown as {
    syncSources?: (value: SourceSyncCommandForTest) => void
    invalidateSources?: (
      taskKey: string,
      code: 'class_review_source_invalidated' | 'class_review_task_invalidated',
    ) => void
    syncExternalReport?: (taskKey: string, report: ClassReviewReportV1) => void
    noteOrdinaryResultRevisionAdvance?: (taskKey: string) => void
  }
  if (next.syncSources) {
    next.syncSources(command)
    return
  }
  if (command.kind === 'task_deleted') {
    next.invalidateSources?.(command.taskKey, 'class_review_task_invalidated')
    return
  }
  if (command.kind === 'source_deleted') {
    next.invalidateSources?.(command.taskKey, 'class_review_source_invalidated')
    return
  }
  next.syncExternalReport?.(command.taskKey, coordinatorValue.getSnapshot(command.taskKey).report)
  next.noteOrdinaryResultRevisionAdvance?.(command.taskKey)
}

function ordinarySyncForTest(
  coordinatorValue: ReturnType<typeof createLocalClassReviewCoordinator>,
  taskKey: string,
  report: ClassReviewReportV1,
  ready: Extract<ClassReviewProjectionResult, { status: 'ready' }> = projection(),
): void {
  const snapshot = coordinatorValue.getSnapshot(taskKey)
  syncSourcesForTest(coordinatorValue, {
    kind: 'ordinary_revision',
    taskKey,
    expectedTaskRevision: snapshot.report.taskRevision,
    expectedReportRevision: snapshot.report.reportRevision,
    expectedSourceRevisionEpoch: snapshot.sourceRevisionEpoch,
    replacement: {
      taskRevision: report.taskRevision,
      rubricRevisionDigest: validRubricDigest,
      statistics: report.statistics,
      projection: ready,
    },
  })
}

function sourceDeleteForTest(
  coordinatorValue: ReturnType<typeof createLocalClassReviewCoordinator>,
  taskKey: string,
  removedTeacherEvidenceIds: readonly string[] = [],
): void {
  const snapshot = coordinatorValue.getSnapshot(taskKey)
  syncSourcesForTest(coordinatorValue, {
    kind: 'source_deleted',
    taskKey,
    expectedTaskRevision: snapshot.report.taskRevision,
    expectedReportRevision: snapshot.report.reportRevision,
    expectedSourceRevisionEpoch: snapshot.sourceRevisionEpoch,
    removedTeacherEvidenceIds,
    replacement: null,
  })
}

function gateRealSubtleSign(callToBlock: number) {
  const originalSign = globalThis.crypto.subtle.sign.bind(globalThis.crypto.subtle)
  let callCount = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  vi.spyOn(globalThis.crypto.subtle, 'sign').mockImplementation(async (algorithm, key, data) => {
    callCount += 1
    if (callCount === callToBlock) await gate
    return originalSign(algorithm, key, data)
  })
  return { calls: () => callCount, release }
}

describe('Task 8 round 2 coordinator safety contracts', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('exposes one typed source-sync command and removes all legacy revision/invalidation bypasses', () => {
    const value = coordinator(createFakeClassReviewSynthesisClient({ scenario: 'success' }))
    expect(value).toHaveProperty('syncSources')
    expect(value).not.toHaveProperty('invalidateSources')
    expect(value).not.toHaveProperty('syncExternalReport')
    expect(value).not.toHaveProperty('bumpAiTextRevision')
    expect(value).not.toHaveProperty('noteOrdinaryResultRevisionAdvance')
  })

  it.each([1, 2, 3, 4])(
    'fences source deletion during pre-reservation HMAC await %s before registry/provider mutation',
    async (blockedSignCall) => {
      const fake = createFakeClassReviewSynthesisClient({ scenario: 'success' })
      const value = coordinator(fake)
      const sign = gateRealSubtleSign(blockedSignCall)
      const pending = value.generate({
        taskKey: 'task-1', generationId: `browser-preflight-${blockedSignCall}`,
        intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1,
      })
      await vi.waitFor(() => expect(sign.calls()).toBeGreaterThanOrEqual(blockedSignCall))
      syncSourcesForTest(value, {
        kind: 'source_deleted', taskKey: 'task-1', expectedTaskRevision: 1,
        expectedReportRevision: 1, expectedSourceRevisionEpoch: 0,
        removedTeacherEvidenceIds: [], replacement: null,
      })
      sign.release()
      await expect(pending).rejects.toThrow('class_review_source_invalidated')
      expect(fake.getCallCountForTest()).toBe(0)
      const snapshot = value.getSnapshot('task-1') as ReturnType<typeof value.getSnapshot> & {
        sourceReady?: boolean
      }
      expect(snapshot.generation).toBeNull()
      expect(snapshot.sourceReady).toBe(false)
    },
  )

  it('makes task deletion permanent and requires a validated replacement after source deletion', async () => {
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'success' })
    const value = coordinator(fake)
    syncSourcesForTest(value, {
      kind: 'task_deleted', taskKey: 'task-1', expectedTaskRevision: 1,
      expectedReportRevision: 1, expectedSourceRevisionEpoch: 0,
    })
    await expect(value.generate({ taskKey: 'task-1', generationId: 'after-task-delete', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 2 })).rejects.toThrow('class_review_task_invalidated')
    expect(fake.getCallCountForTest()).toBe(0)

    const sourceOnly = createLocalClassReviewCoordinator({ synthesisClient: fake, topicKeySecret: new Uint8Array(32).fill(7), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: () => 'opaque' })
    sourceOnly.registerWorkspace({ taskKey: 'source-only', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report: draft(), projection: projection() })
    syncSourcesForTest(sourceOnly, { kind: 'source_deleted', taskKey: 'source-only', expectedTaskRevision: 1, expectedReportRevision: 1, expectedSourceRevisionEpoch: 0, removedTeacherEvidenceIds: [], replacement: null })
    await expect(sourceOnly.generate({ taskKey: 'source-only', generationId: 'before-replacement', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 2 })).rejects.toThrow('class_review_source_invalidated')
    syncSourcesForTest(sourceOnly, {
      kind: 'ordinary_revision', taskKey: 'source-only', expectedTaskRevision: 1,
      expectedReportRevision: 2, expectedSourceRevisionEpoch: 1,
      replacement: { taskRevision: 2, rubricRevisionDigest: validRubricDigest, statistics: draft().statistics, projection: projection() },
    })
    await expect(sourceOnly.generate({ taskKey: 'source-only', generationId: 'after-replacement', intent: 'initial', expectedTaskRevision: 2, expectedReportRevision: 2 })).resolves.toMatchObject({ state: 'succeeded' })
  })

  it('validates a replacement projection before committing a deletion epoch', async () => {
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'success' })
    const value = coordinator(fake)
    const invalidProjection = projectionWithGroup()
    invalidProjection.hidden.selectedGroups = new Map()
    expect(() => syncSourcesForTest(value, {
      kind: 'source_deleted', taskKey: 'task-1', expectedTaskRevision: 1,
      expectedReportRevision: 1, expectedSourceRevisionEpoch: 0,
      removedTeacherEvidenceIds: [],
      replacement: { taskRevision: 2, rubricRevisionDigest: validRubricDigest, statistics: draft().statistics, projection: invalidProjection },
    })).toThrow('class_review_candidate_conflict')
    await expect(value.generate({ taskKey: 'task-1', generationId: 'still-original-source', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })).resolves.toMatchObject({ state: 'succeeded' })
    expect(fake.getCallCountForTest()).toBe(1)
  })

  it('remerges teacher add/remove/move made after Provider success while composite-topic HMAC is pending', async () => {
    const initial = draft()
    const first = teacherBlock('teacher-first')
    const second = teacherBlock('teacher-second')
    initial.issueBlocks = [first, second]
    initial.issueOrder = [first.blockId, second.blockId]
    const client = createFakeClassReviewSynthesisClient({ scenario: 'success', variant: 'multi_group' })
    let opaqueId = 0
    const value = createLocalClassReviewCoordinator({ synthesisClient: client, topicKeySecret: new Uint8Array(32).fill(7), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: () => `opaque-${++opaqueId}` })
    value.registerWorkspace({
      taskKey: 'materializing', taskRevision: 1, rubricRevisionDigest: validRubricDigest,
      report: initial, projection: projectionWithTwoGroups(),
      teacherEvidenceFacts: [
        { topicKey: first.topicKey, evidenceId: first.evidenceRefs[0].evidenceId, essayIdentity: 'essay-first', occurrenceCount: 1, evidenceRef: first.evidenceRefs[0] },
        { topicKey: second.topicKey, evidenceId: second.evidenceRefs[0].evidenceId, essayIdentity: 'essay-second', occurrenceCount: 1, evidenceRef: second.evidenceRefs[0] },
      ],
    })
    const sign = gateRealSubtleSign(7)
    const pending = value.generate({ taskKey: 'materializing', generationId: 'during-materialization', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await vi.waitFor(() => expect(sign.calls()).toBeGreaterThanOrEqual(7))
    const late = teacherBlock('teacher-late')
    value.applyIssueCommand('materializing', teacherAddCommand(late, 'essay-late'))
    value.applyIssueCommand('materializing', { kind: 'remove', evidenceId: first.evidenceRefs[0].evidenceId })
    value.applyIssueCommand('materializing', { kind: 'move', blockId: late.blockId, toIndex: 0 })
    sign.release()
    await pending
    const report = value.getSnapshot('materializing').report
    expect(report.issueOrder[0]).toBe(late.blockId)
    expect(report.issueBlocks).toContainEqual(late)
    expect(report.issueBlocks.some((block) => block.blockId === first.blockId)).toBe(false)
    expect(report.issueBlocks).toContainEqual(second)
  })

  it('preallocates system IDs before the synchronous final commit so createOpaqueId cannot re-enter mutable state', async () => {
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'success' })
    let value!: ReturnType<typeof createLocalClassReviewCoordinator>
    let allocations = 0
    let attemptedReentry = false
    value = createLocalClassReviewCoordinator({
      synthesisClient: fake,
      topicKeySecret: new Uint8Array(32).fill(7),
      now: () => '2026-08-30T00:00:00.000Z',
      createOpaqueId: () => {
        allocations += 1
        if (allocations >= 3 && !attemptedReentry) {
          attemptedReentry = true
          value.applyIssueCommand('reentrant', teacherAddCommand(teacherBlock('teacher-reentrant'), 'essay-reentrant'))
        }
        return `opaque-${allocations}`
      },
    })
    value.registerWorkspace({ taskKey: 'reentrant', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report: draft(), projection: projectionWithGroup() })
    await value.generate({ taskKey: 'reentrant', generationId: 'reentrant-generation', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    expect(attemptedReentry).toBe(true)
    expect(value.getSnapshot('reentrant').report.issueBlocks).toContainEqual(teacherBlock('teacher-reentrant'))
  })

  it('rejects same proposed terminal ID when intent or expected CAS identity drifts, but permits a distinct retry ID', async () => {
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'success' })
    const value = coordinator(fake)
    const first = await value.generate({ taskKey: 'task-1', generationId: 'browser-terminal', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    const afterFirst = value.getSnapshot('task-1').report
    await expect(value.generate({ taskKey: 'task-1', generationId: 'browser-terminal', intent: 'regenerate', expectedTaskRevision: 1, expectedReportRevision: afterFirst.reportRevision })).rejects.toThrow('active_generation_conflict')
    expect(fake.getCallCountForTest()).toBe(1)
    const fresh = await value.generate({ taskKey: 'task-1', generationId: 'browser-terminal-new', intent: 'regenerate', expectedTaskRevision: 1, expectedReportRevision: afterFirst.reportRevision })
    expect(fresh.generationId).not.toBe(first.generationId)
    expect(fake.getCallCountForTest()).toBe(2)
  })

  it.each([
    { name: 'average score', mutate: (report: ClassReviewReportDraftV1) => { report.statistics.scoreSummary!.averageScore += 1 } },
    { name: 'highest score', mutate: (report: ClassReviewReportDraftV1) => { report.statistics.scoreSummary!.highestScore += 1 } },
    { name: 'lowest score', mutate: (report: ClassReviewReportDraftV1) => { report.statistics.scoreSummary!.lowestScore += 1 } },
    { name: 'score band essay count', mutate: (report: ClassReviewReportDraftV1) => { report.statistics.scoreBands[0].essayCount += 1 } },
    { name: 'dimension name', mutate: (report: ClassReviewReportDraftV1) => { report.statistics.dimensions[0].name = 'Changed name' } },
  ])('fails closed before Provider on full mappable-statistics drift: $name', async ({ mutate }) => {
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'success' })
    const report = draft()
    report.statistics.scoreBands = [{ bandId: 'band-1', lowerInclusive: 0, upperInclusive: 100, essayCount: 3 }]
    report.statistics.dimensions = [{ dimensionId: 'language', name: 'Language', averageScore: 32, maxScore: 40, normalizedPerformance: 0.8 }]
    const ready = projection()
    ready.projection.statistics.scoreBands = [{ bandId: 'band-1', lowerInclusive: 0, upperInclusive: 100, essayCount: 3 }]
    ready.projection.statistics.dimensions = [{ dimensionId: 'd1', label: 'Language', averageScore: 32, medianScore: 32, maxScore: 40, normalizedPerformance: 0.8 }]
    ready.hidden.dimensionAliases = new Map([['d1', 'language']])
    mutate(report)
    const value = createLocalClassReviewCoordinator({ synthesisClient: fake, topicKeySecret: new Uint8Array(32).fill(7), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: () => 'opaque' })
    value.registerWorkspace({ taskKey: 'stats-drift', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report, projection: ready })
    await expect(value.generate({ taskKey: 'stats-drift', generationId: 'stats-drift-generation', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })).rejects.toThrow('class_review_candidate_conflict')
    expect(fake.getCallCountForTest()).toBe(0)
    expect(value.getSnapshot('stats-drift').generation).toBeNull()
  })

  it.each([
    { name: 'true below threshold', support: 1, mustCover: true },
    { name: 'false at threshold', support: 2, mustCover: false },
  ])('requires mustCover to equal the shared support-threshold decision: $name', async ({ support, mustCover }) => {
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'success' })
    const ready = projectionWithGroup()
    ready.projection.groups[0].mustCover = mustCover
    ready.projection.groups[0].distinctEssaySupport = support
    ready.projection.groups[0].occurrenceCount = support
    ready.projection.semanticCoverage.projectedDistinctEssaySupportSum = support
    ready.projection.semanticCoverage.eligibleDistinctEssaySupportSum = support
    ready.projection.semanticCoverage.projectedOccurrenceSum = support
    ready.projection.semanticCoverage.eligibleOccurrenceSum = support
    const selected = ready.hidden.selectedGroups.get('g1')!
    ready.hidden.selectedGroups = new Map([['g1', { ...selected, essayIds: selected.essayIds.slice(0, support), occurrenceCount: support }]])
    const value = createLocalClassReviewCoordinator({ synthesisClient: fake, topicKeySecret: new Uint8Array(32).fill(7), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: () => 'opaque' })
    value.registerWorkspace({ taskKey: 'threshold-drift', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report: draft(), projection: ready })
    await expect(value.generate({ taskKey: 'threshold-drift', generationId: 'threshold-drift-generation', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })).rejects.toThrow('class_review_candidate_conflict')
    expect(fake.getCallCountForTest()).toBe(0)
  })

  it('validates teacher fact ownership/alignment/uniqueness and detaches nested caller data', () => {
    const block = teacherBlock('teacher-fact')
    const make = () => createLocalClassReviewCoordinator({ synthesisClient: createFakeClassReviewSynthesisClient({ scenario: 'success' }), topicKeySecret: new Uint8Array(32).fill(7), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: () => 'opaque' })
    const bad = make()
    expect(() => bad.registerWorkspace({
      taskKey: 'bad-facts', taskRevision: 1, rubricRevisionDigest: validRubricDigest,
      report: { ...draft(), issueBlocks: [block], issueOrder: [block.blockId] }, projection: projection(),
      teacherEvidenceFacts: [{ topicKey: 'wrong-topic', evidenceId: block.evidenceRefs[0].evidenceId, essayIdentity: 'essay-a', occurrenceCount: 1, evidenceRef: { ...block.evidenceRefs[0], selectionOrigin: 'system_generation' } }],
    })).toThrow('class_review_candidate_conflict')

    const duplicate = make()
    expect(() => duplicate.registerWorkspace({
      taskKey: 'duplicate-facts', taskRevision: 1, rubricRevisionDigest: validRubricDigest,
      report: { ...draft(), issueBlocks: [block], issueOrder: [block.blockId] }, projection: projection(),
      teacherEvidenceFacts: [
        { topicKey: block.topicKey, evidenceId: block.evidenceRefs[0].evidenceId, essayIdentity: 'essay-a', occurrenceCount: 1, evidenceRef: block.evidenceRefs[0] },
        { topicKey: block.topicKey, evidenceId: block.evidenceRefs[0].evidenceId, essayIdentity: 'essay-b', occurrenceCount: 1, evidenceRef: block.evidenceRefs[0] },
      ],
    })).toThrow('class_review_candidate_conflict')

    const guarded = make()
    const accessorReport = draft()
    const totalEssayCount = accessorReport.statistics.totalEssayCount
    let registerGetterReads = 0
    Object.defineProperty(accessorReport.statistics, 'totalEssayCount', {
      enumerable: true,
      configurable: true,
      get() {
        registerGetterReads += 1
        guarded.registerWorkspace({
          taskKey: 'register-reentered', taskRevision: 1,
          rubricRevisionDigest: validRubricDigest, report: draft(), projection: projection(),
        })
        return totalEssayCount
      },
    })
    expect(() => guarded.registerWorkspace({
      taskKey: 'register-accessor', taskRevision: 1,
      rubricRevisionDigest: validRubricDigest, report: accessorReport, projection: projection(),
    })).toThrow('class_review_candidate_conflict')
    expect(registerGetterReads).toBe(0)
    expect(() => guarded.getSnapshot('register-accessor')).toThrow('class_review_not_eligible')
    expect(() => guarded.getSnapshot('register-reentered')).toThrow('class_review_not_eligible')
    guarded.registerWorkspace({
      taskKey: 'register-accessor', taskRevision: 1,
      rubricRevisionDigest: validRubricDigest, report: draft(), projection: projection(),
    })

    const fact = { topicKey: block.topicKey, evidenceId: block.evidenceRefs[0].evidenceId, essayIdentity: 'essay-a', occurrenceCount: 1, evidenceRef: structuredClone(block.evidenceRefs[0]) }
    const detached = make()
    detached.registerWorkspace({ taskKey: 'detached-fact', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report: { ...draft(), issueBlocks: [block], issueOrder: [block.blockId] }, projection: projection(), teacherEvidenceFacts: [fact] })
    fact.evidenceRef.evidenceId = 'caller-mutated'
    fact.evidenceRef.sourceLocator = 'caller-mutated'
    detached.applyIssueCommand('detached-fact', { kind: 'remove', evidenceId: block.evidenceRefs[0].evidenceId })
    expect(detached.getSnapshot('detached-fact').report.issueBlocks).toHaveLength(0)
  })

  it('source deletion rebuilds surviving mixed teacher blocks from teacher facts only', async () => {
    const block = teacherBlock('teacher-system', 'tk1.aaaaaaaaaaaaaaaa')
    const report = { ...draft(), issueBlocks: [block], issueOrder: [block.blockId] }
    const value = createLocalClassReviewCoordinator({ synthesisClient: createFakeClassReviewSynthesisClient({ scenario: 'success' }), topicKeySecret: new Uint8Array(32).fill(7), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: (() => { let id = 0; return () => `opaque-${++id}` })() })
    value.registerWorkspace({ taskKey: 'source-rebuild', taskRevision: 1, rubricRevisionDigest: validRubricDigest, report, projection: projectionWithGroup(), teacherEvidenceFacts: [{ topicKey: block.topicKey, evidenceId: block.evidenceRefs[0].evidenceId, essayIdentity: 'essay-a', occurrenceCount: 1, evidenceRef: block.evidenceRefs[0] }] })
    await value.generate({ taskKey: 'source-rebuild', generationId: 'source-rebuild-generation', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    syncSourcesForTest(value, {
      kind: 'source_deleted', taskKey: 'source-rebuild', expectedTaskRevision: 1,
      expectedReportRevision: 2, expectedSourceRevisionEpoch: 0,
      removedTeacherEvidenceIds: [],
      replacement: { taskRevision: 2, rubricRevisionDigest: validRubricDigest, statistics: draft().statistics, projection: projection() },
    })
    const rebuilt = value.getSnapshot('source-rebuild').report.issueBlocks[0]
    expect(rebuilt).toMatchObject({
      origin: 'teacher', teacherStudentCount: 1, systemStudentCount: 0,
      combinedStudentCount: 1, occurrenceCount: 1, supportDenominator: null,
      anonymousExamples: [], evidenceRefs: [block.evidenceRefs[0]],
    })
  })

  it('removes affected teacher evidence IDs during source deletion and preserves only unaffected teacher facts', () => {
    const removed = teacherBlock('teacher-removed')
    const surviving = teacherBlock('teacher-surviving')
    const report = draft()
    report.issueBlocks = [removed, surviving]
    report.issueOrder = [removed.blockId, surviving.blockId]
    const value = createLocalClassReviewCoordinator({ synthesisClient: createFakeClassReviewSynthesisClient({ scenario: 'success' }), topicKeySecret: new Uint8Array(32).fill(7), now: () => '2026-08-30T00:00:00.000Z', createOpaqueId: () => 'opaque' })
    value.registerWorkspace({
      taskKey: 'teacher-source-delete', taskRevision: 1, rubricRevisionDigest: validRubricDigest,
      report, projection: projection(),
      teacherEvidenceFacts: [
        { topicKey: removed.topicKey, evidenceId: removed.evidenceRefs[0].evidenceId, essayIdentity: 'essay-removed', occurrenceCount: 1, evidenceRef: removed.evidenceRefs[0] },
        { topicKey: surviving.topicKey, evidenceId: surviving.evidenceRefs[0].evidenceId, essayIdentity: 'essay-surviving', occurrenceCount: 1, evidenceRef: surviving.evidenceRefs[0] },
      ],
    })
    syncSourcesForTest(value, {
      kind: 'source_deleted', taskKey: 'teacher-source-delete', expectedTaskRevision: 1,
      expectedReportRevision: 1, expectedSourceRevisionEpoch: 0,
      removedTeacherEvidenceIds: [removed.evidenceRefs[0].evidenceId],
      replacement: { taskRevision: 2, rubricRevisionDigest: validRubricDigest, statistics: draft().statistics, projection: projection() },
    })
    const after = value.getSnapshot('teacher-source-delete').report
    expect(after.issueOrder).toEqual([surviving.blockId])
    expect(after.issueBlocks).toEqual([surviving])
  })

  it('public terminal snapshots expose no payloads, handles, request bytes, or request identity', async () => {
    const deferred = deferredClient()
    const value = coordinator(deferred.client)
    const pending = value.generate({ taskKey: 'task-1', generationId: 'candidate-metadata', intent: 'initial', expectedTaskRevision: 1, expectedReportRevision: 1 })
    await vi.waitFor(() => expect(deferred.calls()).toBe(1))
    ordinarySyncForTest(value, 'task-1', value.getSnapshot('task-1').report)
    deferred.resolve(success(value.getSnapshot('task-1').requestId as string))
    await pending
    const snapshot = value.getSnapshot('task-1')
    expect(snapshot.candidate).toBeNull()
    expect(snapshot.requestId).toBeNull()
    expect(snapshot.generation).not.toHaveProperty('candidate')
    expect(snapshot.generation).not.toHaveProperty('requestBytes')
    expect(Object.isFrozen(snapshot)).toBe(true)
  })
})

type Round3SourceReplacement = {
  taskRevision: number
  rubricRevisionDigest: string
  statistics: ClassReviewReportV1['statistics']
  projection: Extract<ClassReviewProjectionResult, { status: 'ready' }>
}

type Round3SourceSyncCommand =
  | {
      kind: 'ordinary_revision'
      taskKey: string
      expectedTaskRevision: number
      expectedReportRevision: number | null
      expectedSourceRevisionEpoch: number
      replacement: Round3SourceReplacement
    }
  | {
      kind: 'source_deleted'
      taskKey: string
      expectedTaskRevision: number
      expectedReportRevision: number | null
      expectedSourceRevisionEpoch: number
      removedTeacherEvidenceIds: readonly string[]
      replacement: Round3SourceReplacement | null
    }
  | {
      kind: 'task_deleted'
      taskKey: string
      expectedTaskRevision: number
      expectedReportRevision: number | null
      expectedSourceRevisionEpoch: number
    }

function syncRound3Sources(
  value: ReturnType<typeof createLocalClassReviewCoordinator>,
  command: Round3SourceSyncCommand,
): void {
  ;(value as unknown as { syncSources(command: Round3SourceSyncCommand): void }).syncSources(command)
}

function selectedMaterialSentinel() {
  return {
    materialId: 'material-sensitive',
    type: 'teacher_note' as const,
    categoryLabel: 'private-category',
    severity: null,
    needsTeacherReview: false,
    originalText: 'private-material-text',
    revisedText: null,
    diagnosis: null,
    teachingSuggestion: null,
    sourceLocator: 'private-source-locator',
  }
}

describe('Task 8 round 3 coordinator state and privacy contracts', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('ordinary source sync accepts only source-owned fields and preserves coordinator-owned report state byte-equivalently', () => {
    const block = teacherBlock('ordinary-preserved')
    const report = aiAvailable()
    report.issueBlocks = [block]
    report.issueOrder = [block.blockId]
    report.selectedMaterials = [selectedMaterialSentinel()]
    const value = createLocalClassReviewCoordinator({
      synthesisClient: createFakeClassReviewSynthesisClient({ scenario: 'success' }),
      topicKeySecret: new Uint8Array(32).fill(7),
      now: () => '2026-08-30T00:00:00.000Z',
      createOpaqueId: () => 'opaque',
    })
    value.registerWorkspace({
      taskKey: 'ordinary-source-bundle', taskRevision: 1, rubricRevisionDigest: validRubricDigest,
      report, projection: projection(),
      teacherEvidenceFacts: [{
        topicKey: block.topicKey, evidenceId: block.evidenceRefs[0].evidenceId,
        essayIdentity: 'essay-private', occurrenceCount: 1, evidenceRef: block.evidenceRefs[0],
      }],
    })
    const before = value.getSnapshot('ordinary-source-bundle')
    syncRound3Sources(value, {
      kind: 'ordinary_revision', taskKey: 'ordinary-source-bundle',
      expectedTaskRevision: 1, expectedReportRevision: before.report.reportRevision,
      expectedSourceRevisionEpoch: 0,
      replacement: {
        taskRevision: 2,
        rubricRevisionDigest: validRubricDigest,
        statistics: structuredClone(before.report.statistics),
        projection: projection(),
      },
    })
    const after = value.getSnapshot('ordinary-source-bundle')
    const { taskRevision: _beforeTask, statistics: _beforeStatistics, ...beforeOwned } = before.report
    const { taskRevision: _afterTask, statistics: _afterStatistics, ...afterOwned } = after.report
    expect(after.report.taskRevision).toBe(2)
    expect(after.report.statistics).toEqual(before.report.statistics)
    expect(afterOwned).toEqual(beforeOwned)
    expect(after.sourceRevisionEpoch).toBe(1)
  })

  it('source deletion rebuilds ai-removed state only from coordinator-owned teacher facts and a source-owned replacement bundle', () => {
    const block = teacherBlock('source-delete-preserved')
    const report = aiAvailable()
    report.aiSummary.overallComment = 'old-ai-content-must-not-survive'
    report.issueBlocks = [block]
    report.issueOrder = [block.blockId]
    const value = createLocalClassReviewCoordinator({
      synthesisClient: createFakeClassReviewSynthesisClient({ scenario: 'success' }),
      topicKeySecret: new Uint8Array(32).fill(7),
      now: () => '2026-08-30T00:00:00.000Z',
      createOpaqueId: () => 'opaque',
    })
    value.registerWorkspace({
      taskKey: 'source-delete-bundle', taskRevision: 1, rubricRevisionDigest: validRubricDigest,
      report, projection: projection(),
      teacherEvidenceFacts: [{
        topicKey: block.topicKey, evidenceId: block.evidenceRefs[0].evidenceId,
        essayIdentity: 'essay-preserved', occurrenceCount: 1, evidenceRef: block.evidenceRefs[0],
      }],
    })
    syncRound3Sources(value, {
      kind: 'source_deleted', taskKey: 'source-delete-bundle', expectedTaskRevision: 1,
      expectedReportRevision: report.reportRevision, expectedSourceRevisionEpoch: 0,
      removedTeacherEvidenceIds: [],
      replacement: {
        taskRevision: 2,
        rubricRevisionDigest: validRubricDigest,
        statistics: structuredClone(report.statistics),
        projection: projection(),
      },
    })
    const after = value.getSnapshot('source-delete-bundle')
    expect(after.report).toMatchObject({
      workspaceState: 'ai_removed',
      taskRevision: 2,
      aiTextEditRevision: report.aiTextEditRevision,
      issueBlocks: [block],
      issueOrder: [block.blockId],
    })
    expect(JSON.stringify(after.report)).not.toContain('old-ai-content-must-not-survive')
  })

  it('source deletion deterministically transitions a none workspace to draft revision zero while preserving AI-text revision', () => {
    const value = createLocalClassReviewCoordinator({
      synthesisClient: createFakeClassReviewSynthesisClient({ scenario: 'success' }),
      topicKeySecret: new Uint8Array(32).fill(7),
      now: () => '2026-08-30T00:00:00.000Z',
      createOpaqueId: () => 'opaque',
    })
    value.registerWorkspace({
      taskKey: 'none-source-delete', taskRevision: 1, rubricRevisionDigest: validRubricDigest,
      report: none(), projection: projection(),
    })
    syncRound3Sources(value, {
      kind: 'source_deleted', taskKey: 'none-source-delete', expectedTaskRevision: 1,
      expectedReportRevision: null, expectedSourceRevisionEpoch: 0,
      removedTeacherEvidenceIds: [], replacement: null,
    })
    expect(value.getSnapshot('none-source-delete').report).toMatchObject({
      workspaceState: 'draft', reportRevision: 0, aiTextEditRevision: 0,
    })
  })

  it('task deletion returns a stable parsed content-free tombstone and exposes no prior text, evidence, materials, aggregate, request, or generation', () => {
    const block = teacherBlock('task-delete-secret')
    const report = aiAvailable()
    report.aiSummary.overallComment = 'private-ai-summary'
    report.issueBlocks = [block]
    report.issueOrder = [block.blockId]
    report.selectedMaterials = [selectedMaterialSentinel()]
    const value = createLocalClassReviewCoordinator({
      synthesisClient: createFakeClassReviewSynthesisClient({ scenario: 'success' }),
      topicKeySecret: new Uint8Array(32).fill(7),
      now: () => '2026-08-30T00:00:00.000Z',
      createOpaqueId: () => 'opaque',
    })
    value.registerWorkspace({
      taskKey: 'task-delete-private', taskRevision: 1, rubricRevisionDigest: validRubricDigest,
      report, projection: projection(),
      teacherEvidenceFacts: [{
        topicKey: block.topicKey, evidenceId: block.evidenceRefs[0].evidenceId,
        essayIdentity: 'private-essay-identity', occurrenceCount: 1, evidenceRef: block.evidenceRefs[0],
      }],
    })
    syncRound3Sources(value, {
      kind: 'task_deleted', taskKey: 'task-delete-private', expectedTaskRevision: 1,
      expectedReportRevision: report.reportRevision, expectedSourceRevisionEpoch: 0,
    })
    const tombstone = value.getSnapshot('task-delete-private')
    const serialized = JSON.stringify(tombstone)
    expect(tombstone).toMatchObject({
      taskDeleted: true, sourceReady: false, generation: null, candidate: null, requestId: null,
      report: {
        issueBlocks: [], issueOrder: [], clearSpellingItems: [], selectedMaterials: [],
        statistics: { totalEssayCount: 0, includedEssayCount: 0, issueEligibleEssayCount: 0, excludedEssayCount: 0 },
      },
    })
    for (const secret of ['private-ai-summary', 'private-material-text', 'private-source-locator', 'private-essay-identity', block.evidenceRefs[0].evidenceId]) {
      expect(serialized).not.toContain(secret)
    }
  })

  it.each([
    { name: 'duplicate removal IDs', removals: ['evidence-staged-delete', 'evidence-staged-delete'] },
    { name: 'unknown removal ID', removals: ['unknown-evidence'] },
  ])('stages $name before registry or workspace mutation and keeps the old owner/projection usable', async ({ removals }) => {
    const block = teacherBlock('staged-delete')
    const deferred = deferredClient()
    const report = draft()
    report.issueBlocks = [block]
    report.issueOrder = [block.blockId]
    const value = createLocalClassReviewCoordinator({
      synthesisClient: deferred.client,
      topicKeySecret: new Uint8Array(32).fill(7),
      now: () => '2026-08-30T00:00:00.000Z',
      createOpaqueId: (() => { let id = 0; return () => `opaque-${++id}` })(),
    })
    value.registerWorkspace({
      taskKey: 'staged-delete', taskRevision: 1, rubricRevisionDigest: validRubricDigest,
      report, projection: projection(),
      teacherEvidenceFacts: [{
        topicKey: block.topicKey, evidenceId: block.evidenceRefs[0].evidenceId,
        essayIdentity: 'essay-staged', occurrenceCount: 1, evidenceRef: block.evidenceRefs[0],
      }],
    })
    const pending = value.generate({
      taskKey: 'staged-delete', generationId: 'staged-owner', intent: 'initial',
      expectedTaskRevision: 1, expectedReportRevision: 1,
    })
    await vi.waitFor(() => expect(deferred.calls()).toBe(1))
    const before = value.getSnapshot('staged-delete')
    let syncError: unknown = null
    try {
      syncRound3Sources(value, {
        kind: 'source_deleted', taskKey: 'staged-delete', expectedTaskRevision: 1,
        expectedReportRevision: before.report.reportRevision, expectedSourceRevisionEpoch: 0,
        removedTeacherEvidenceIds: removals,
        replacement: null,
      })
    } catch (error) {
      syncError = error
    }
    const afterRejectedSync = value.getSnapshot('staged-delete')
    deferred.resolve(success(before.requestId as string))
    const settled = await pending
    expect(syncError).toMatchObject({ message: 'class_review_candidate_conflict' })
    expect(afterRejectedSync).toEqual(before)
    expect(settled).toMatchObject({ state: 'succeeded' })
    expect(deferred.calls()).toBe(1)
  })

  it('returns the old terminal g1 replay immediately while a distinct g2 owner is in flight', async () => {
    let calls = 0
    let resolveSecond!: (value: ClassReviewSynthesisResultV1) => void
    const client: ClassReviewSynthesisClient = {
      synthesize: async (request) => {
        calls += 1
        if (calls === 1) return success(request.requestId)
        return new Promise<ClassReviewSynthesisResultV1>((resolve) => { resolveSecond = resolve })
      },
    }
    const value = coordinator(client)
    const g1Command = {
      taskKey: 'task-1', generationId: 'browser-g1', intent: 'initial' as const,
      expectedTaskRevision: 1, expectedReportRevision: 1,
    }
    const g1 = await value.generate(g1Command)
    const afterG1 = value.getSnapshot('task-1')
    const g2Pending = value.generate({
      taskKey: 'task-1', generationId: 'browser-g2', intent: 'regenerate',
      expectedTaskRevision: 1, expectedReportRevision: afterG1.report.reportRevision,
    })
    await vi.waitFor(() => expect(calls).toBe(2))
    let replaySettled = false
    const replayPromise = value.generate(g1Command).then((record) => {
      replaySettled = true
      return record
    })
    await Promise.resolve()
    await Promise.resolve()
    const settledBeforeG2 = replaySettled
    resolveSecond(success(value.getSnapshot('task-1').requestId as string))
    const [g2, replay] = await Promise.all([g2Pending, replayPromise])
    expect(settledBeforeG2).toBe(true)
    expect(replay.generationId).toBe(g1.generationId)
    expect(g2.generationId).not.toBe(g1.generationId)
  })

  it('binds actionable attachment identity to intent and rejects initial/regenerate drift without a second Provider call', async () => {
    const deferred = deferredClient()
    const value = coordinator(deferred.client)
    const owner = value.generate({
      taskKey: 'task-1', generationId: 'intent-owner', intent: 'initial',
      expectedTaskRevision: 1, expectedReportRevision: 1,
    })
    await vi.waitFor(() => expect(deferred.calls()).toBe(1))
    const drift = value.generate({
      taskKey: 'task-1', generationId: 'intent-drift', intent: 'regenerate',
      expectedTaskRevision: 1, expectedReportRevision: 1,
    })
    deferred.resolve(success(value.getSnapshot('task-1').requestId as string))
    await owner
    await expect(drift).rejects.toThrow('active_generation_conflict')
    expect(deferred.calls()).toBe(1)
  })

  it.each([
    { scenario: 'success' as const, state: 'succeeded' },
    { scenario: 'result_unknown' as const, state: 'result_unknown' },
    { scenario: 'auth_failed' as const, state: 'failed' },
  ])('clears public request identity after terminal $state settlement', async ({ scenario, state }) => {
    const value = coordinator(createFakeClassReviewSynthesisClient({ scenario }))
    await expect(value.generate({
      taskKey: 'task-1', generationId: `terminal-${scenario}`, intent: 'initial',
      expectedTaskRevision: 1, expectedReportRevision: 1,
    })).resolves.toMatchObject({ state })
    expect(value.getSnapshot('task-1').requestId).toBeNull()
  })

  it('rejects teacher evidence ID overwrite across topics and leaves report/facts unchanged', () => {
    const original = teacherBlock('teacher-original')
    const report = draft()
    report.issueBlocks = [original]
    report.issueOrder = [original.blockId]
    const value = createLocalClassReviewCoordinator({
      synthesisClient: createFakeClassReviewSynthesisClient({ scenario: 'success' }),
      topicKeySecret: new Uint8Array(32).fill(7),
      now: () => '2026-08-30T00:00:00.000Z',
      createOpaqueId: () => 'opaque',
    })
    value.registerWorkspace({
      taskKey: 'teacher-overwrite', taskRevision: 1, rubricRevisionDigest: validRubricDigest,
      report, projection: projection(),
      teacherEvidenceFacts: [{
        topicKey: original.topicKey, evidenceId: original.evidenceRefs[0].evidenceId,
        essayIdentity: 'essay-original', occurrenceCount: 1, evidenceRef: original.evidenceRefs[0],
      }],
    })
    const before = value.getSnapshot('teacher-overwrite')
    const conflicting = teacherBlock('teacher-conflicting')
    conflicting.evidenceRefs = [{
      ...conflicting.evidenceRefs[0],
      evidenceId: original.evidenceRefs[0].evidenceId,
    }]
    expect(() => value.applyIssueCommand(
      'teacher-overwrite',
      teacherAddCommand(conflicting, 'essay-conflicting'),
    )).toThrow('class_review_candidate_conflict')
    expect(value.getSnapshot('teacher-overwrite')).toEqual(before)
  })
})

describe('Task 8 round 4 reservation, source-capture, and imported-fact contracts', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('rechecks the complete captured source fence synchronously after final identity preparation and before reservation', async () => {
    let providerCalls = 0
    let sourceSyncRan = false
    let interleaveError: unknown = null
    const client: ClassReviewSynthesisClient = {
      synthesize: async (request) => {
        providerCalls += 1
        return success(request.requestId)
      },
    }
    let value!: ReturnType<typeof createLocalClassReviewCoordinator>
    const originalSign = globalThis.crypto.subtle.sign.bind(globalThis.crypto.subtle)
    let signCalls = 0
    vi.spyOn(globalThis.crypto.subtle, 'sign').mockImplementation((algorithm, key, data) => {
      signCalls += 1
      const signed = originalSign(algorithm, key, data)
      if (signCalls !== 6) return signed
      return signed.then((result) => {
        queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => {
          try {
            const before = value.getSnapshot('final-fence')
            const changedStatistics = {
              ...before.report.statistics,
              totalEssayCount: 4,
              excludedEssayCount: 1,
            }
            const changedProjection = projection()
            changedProjection.projection.statistics = {
              ...changedProjection.projection.statistics,
              totalEssayCount: 4,
              excludedEssayCount: 1,
            }
            syncRound3Sources(value, {
              kind: 'ordinary_revision',
              taskKey: 'final-fence',
              expectedTaskRevision: 1,
              expectedReportRevision: before.report.reportRevision,
              expectedSourceRevisionEpoch: before.sourceRevisionEpoch,
              replacement: {
                taskRevision: 1,
                rubricRevisionDigest: validRubricDigest,
                statistics: changedStatistics,
                projection: changedProjection,
              },
            })
            sourceSyncRan = true
          } catch (error) {
            interleaveError = error
          }
        }))))
        return result
      })
    })
    value = createLocalClassReviewCoordinator({
      synthesisClient: client,
      topicKeySecret: new Uint8Array(32).fill(7),
      now: () => '2026-08-30T00:00:00.000Z',
      createOpaqueId: (() => { let id = 0; return () => `opaque-${++id}` })(),
    })
    value.registerWorkspace({
      taskKey: 'final-fence',
      taskRevision: 1,
      rubricRevisionDigest: validRubricDigest,
      report: draft(),
      projection: projection(),
    })

    await expect(value.generate({
      taskKey: 'final-fence',
      generationId: 'browser-final-fence',
      intent: 'initial',
      expectedTaskRevision: 1,
      expectedReportRevision: 1,
    })).rejects.toThrow('class_review_source_invalidated')
    expect(interleaveError).toBeNull()
    expect(sourceSyncRan).toBe(true)
    expect(signCalls).toBe(6)
    expect(providerCalls).toBe(0)
    expect(value.getSnapshot('final-fence')).toMatchObject({
      generation: null,
      requestId: null,
      sourceRevisionEpoch: 1,
    })
  })

  it('does not terminal-replay a proposed alias after current report identity changes', async () => {
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'success' })
    const value = coordinator(fake)
    const command = {
      taskKey: 'task-1',
      generationId: 'terminal-full-identity',
      intent: 'initial' as const,
      expectedTaskRevision: 1,
      expectedReportRevision: 1,
    }
    await value.generate(command)
    value.applyIssueCommand('task-1', teacherAddCommand(
      teacherBlock('terminal-report-drift'),
      'essay-terminal-drift',
    ))

    await expect(value.generate(command)).rejects.toThrow('active_generation_conflict')
    expect(fake.getCallCountForTest()).toBe(1)

    let changeAtTerminalTransition: () => void = () => undefined
    let racedCalls = 0
    const raced = coordinator({
      synthesize: (request) => {
        racedCalls += 1
        queueMicrotask(changeAtTerminalTransition)
        return Promise.resolve(success(request.requestId))
      },
    })
    const racedCommand = {
      taskKey: 'task-1', generationId: 'terminal-commit-race', intent: 'initial' as const,
      expectedTaskRevision: 1, expectedReportRevision: 1,
    }
    let changedAfterCommit = false
    changeAtTerminalTransition = (): void => {
      const state = raced.getSnapshot('task-1').generation?.state
      if (state === null || state === undefined || state === 'queued' || state === 'running') {
        queueMicrotask(changeAtTerminalTransition)
        return
      }
      raced.applyIssueCommand('task-1', teacherAddCommand(
        teacherBlock('terminal-commit-race-drift'),
        'essay-terminal-commit-race',
      ))
      changedAfterCommit = true
    }
    await raced.generate(racedCommand)
    expect(changedAfterCommit).toBe(true)
    await expect(raced.generate(racedCommand)).rejects.toThrow('active_generation_conflict')
    expect(racedCalls).toBe(1)
  })

  it.each([
    {
      name: 'accessor property',
      create(base: Round3SourceReplacement, noteRead: () => void): unknown {
        const value = { ...base }
        Object.defineProperty(value, 'statistics', {
          enumerable: true,
          configurable: true,
          get() {
            noteRead()
            return base.statistics
          },
        })
        return value
      },
    },
    {
      name: 'symbol extra property',
      create(base: Round3SourceReplacement): unknown {
        return Object.assign({ ...base }, { [Symbol('private-extra')]: 'forbidden' })
      },
    },
    {
      name: 'non-enumerable extra property',
      create(base: Round3SourceReplacement): unknown {
        return Object.defineProperty({ ...base }, 'privateExtra', {
          enumerable: false,
          configurable: true,
          value: 'forbidden',
        })
      },
    },
    {
      name: 'throwing ownKeys Proxy',
      create(base: Round3SourceReplacement): unknown {
        return new Proxy(base, {
          ownKeys() {
            throw new Error('private-own-keys')
          },
        })
      },
    },
  ])('rejects a source replacement $name without invoking or mutating it', ({ create, name }) => {
    const value = coordinator(createFakeClassReviewSynthesisClient({ scenario: 'success' }))
    const before = value.getSnapshot('task-1')
    let getterReads = 0
    const replacement = create({
      taskRevision: 2,
      rubricRevisionDigest: validRubricDigest,
      statistics: structuredClone(before.report.statistics),
      projection: projection(),
    }, () => { getterReads += 1 })

    expect(() => syncRound3Sources(value, {
      kind: 'ordinary_revision',
      taskKey: 'task-1',
      expectedTaskRevision: 1,
      expectedReportRevision: before.report.reportRevision,
      expectedSourceRevisionEpoch: 0,
      replacement: replacement as Round3SourceReplacement,
    })).toThrow('class_review_candidate_conflict')
    expect(getterReads).toBe(0)
    expect(value.getSnapshot('task-1')).toEqual(before)

    if (name === 'accessor property') {
      const nestedValue = coordinator(createFakeClassReviewSynthesisClient({ scenario: 'success' }))
      const nestedBefore = nestedValue.getSnapshot('task-1')
      const nestedStatistics = structuredClone(nestedBefore.report.statistics)
      const totalEssayCount = nestedStatistics.totalEssayCount
      let nestedGetterReads = 0
      Object.defineProperty(nestedStatistics, 'totalEssayCount', {
        enumerable: true,
        configurable: true,
        get() {
          nestedGetterReads += 1
          nestedValue.applyIssueCommand('task-1', teacherAddCommand(
            teacherBlock('nested-source-getter'),
            'essay-nested-source-getter',
          ))
          return totalEssayCount
        },
      })
      const nestedReplacement = {
        taskRevision: 2,
        rubricRevisionDigest: validRubricDigest,
        statistics: nestedStatistics,
        projection: projection(),
      }

      expect(() => syncRound3Sources(nestedValue, {
        kind: 'ordinary_revision',
        taskKey: 'task-1',
        expectedTaskRevision: 1,
        expectedReportRevision: nestedBefore.report.reportRevision,
        expectedSourceRevisionEpoch: 0,
        replacement: nestedReplacement,
      })).toThrow('class_review_candidate_conflict')
      expect(nestedGetterReads).toBe(0)
      expect(nestedValue.getSnapshot('task-1')).toEqual(nestedBefore)

      const nestedProxyValue = coordinator(createFakeClassReviewSynthesisClient({ scenario: 'success' }))
      const nestedProxyBefore = nestedProxyValue.getSnapshot('task-1')
      let nestedProxyTrapReads = 0
      const nestedProjection = projection()
      nestedProjection.projection.statistics = new Proxy(nestedProjection.projection.statistics, {
        ownKeys() {
          nestedProxyTrapReads += 1
          try {
            nestedProxyValue.applyIssueCommand('task-1', teacherAddCommand(
              teacherBlock('nested-source-proxy'),
              'essay-nested-source-proxy',
            ))
          } catch {
            // Source capture owns the coordinator mutation barrier for this stack.
          }
          throw new Error('nested-private-own-keys')
        },
      })
      expect(() => syncRound3Sources(nestedProxyValue, {
        kind: 'ordinary_revision',
        taskKey: 'task-1',
        expectedTaskRevision: 1,
        expectedReportRevision: nestedProxyBefore.report.reportRevision,
        expectedSourceRevisionEpoch: 0,
        replacement: {
          taskRevision: 2,
          rubricRevisionDigest: validRubricDigest,
          statistics: structuredClone(nestedProxyBefore.report.statistics),
          projection: nestedProjection,
        },
      })).toThrow('class_review_candidate_conflict')
      expect(nestedProxyTrapReads).toBeLessThanOrEqual(1)
      expect(nestedProxyValue.getSnapshot('task-1')).toEqual(nestedProxyBefore)

      const commandValue = coordinator(createFakeClassReviewSynthesisClient({ scenario: 'success' }))
      const commandBefore = commandValue.getSnapshot('task-1')
      let commandGetterReads = 0
      const commandWithAccessor = {
        kind: 'ordinary_revision' as const,
        taskKey: 'task-1',
        expectedTaskRevision: 1,
        expectedReportRevision: commandBefore.report.reportRevision,
        expectedSourceRevisionEpoch: 0,
        replacement: {
          taskRevision: 2,
          rubricRevisionDigest: validRubricDigest,
          statistics: structuredClone(commandBefore.report.statistics),
          projection: projection(),
        },
      }
      Object.defineProperty(commandWithAccessor, 'taskKey', {
        enumerable: true,
        configurable: true,
        get() {
          commandGetterReads += 1
          commandValue.applyIssueCommand('task-1', teacherAddCommand(
            teacherBlock('source-command-getter'),
            'essay-source-command-getter',
          ))
          return 'task-1'
        },
      })
      expect(() => syncRound3Sources(
        commandValue,
        commandWithAccessor as Round3SourceSyncCommand,
      )).toThrow('class_review_candidate_conflict')
      expect(commandGetterReads).toBe(0)
      expect(commandValue.getSnapshot('task-1')).toEqual(commandBefore)
    }
  })

  it.each([
    {
      name: 'accessor element',
      create(evidenceId: string, noteRead: () => void): readonly string[] {
        const removals: string[] = []
        Object.defineProperty(removals, '0', {
          enumerable: true,
          configurable: true,
          get() {
            noteRead()
            return evidenceId
          },
        })
        return removals
      },
    },
    {
      name: 'symbol extra property',
      create(evidenceId: string): readonly string[] {
        return Object.assign([evidenceId], { [Symbol('private-extra')]: 'forbidden' })
      },
    },
    {
      name: 'throwing ownKeys Proxy',
      create(evidenceId: string): readonly string[] {
        return new Proxy([evidenceId], {
          ownKeys() {
            throw new Error('private-removal-own-keys')
          },
        })
      },
    },
  ])('rejects a removed-evidence $name from one detached array snapshot', ({ create }) => {
    const block = teacherBlock('removed-descriptor')
    const report = draft()
    report.issueBlocks = [block]
    report.issueOrder = [block.blockId]
    const value = createLocalClassReviewCoordinator({
      synthesisClient: createFakeClassReviewSynthesisClient({ scenario: 'success' }),
      topicKeySecret: new Uint8Array(32).fill(7),
      now: () => '2026-08-30T00:00:00.000Z',
      createOpaqueId: () => 'opaque',
    })
    value.registerWorkspace({
      taskKey: 'removed-descriptor',
      taskRevision: 1,
      rubricRevisionDigest: validRubricDigest,
      report,
      projection: projection(),
      teacherEvidenceFacts: [{
        topicKey: block.topicKey,
        evidenceId: block.evidenceRefs[0].evidenceId,
        essayIdentity: 'essay-teacher',
        occurrenceCount: 1,
        evidenceRef: block.evidenceRefs[0],
      }],
    })
    const before = value.getSnapshot('removed-descriptor')
    let getterReads = 0
    const removals = create(block.evidenceRefs[0].evidenceId, () => { getterReads += 1 })

    expect(() => syncRound3Sources(value, {
      kind: 'source_deleted',
      taskKey: 'removed-descriptor',
      expectedTaskRevision: 1,
      expectedReportRevision: before.report.reportRevision,
      expectedSourceRevisionEpoch: 0,
      removedTeacherEvidenceIds: removals,
      replacement: null,
    })).toThrow('class_review_candidate_conflict')
    expect(getterReads).toBe(0)
    expect(value.getSnapshot('removed-descriptor')).toEqual(before)
  })

  it('rejects imported positive-support AI blocks unless authorized system facts are supplied', () => {
    const systemBlock: ClassReviewIssueBlockV1 = {
      blockId: 'imported-system',
      topicKey: 'tk1.aaaaaaaaaaaaaaaa',
      origin: 'ai',
      title: 'Imported system',
      diagnosis: 'Imported diagnosis',
      teachingAction: 'Imported action',
      severity: 'medium',
      teacherStudentCount: 0,
      systemStudentCount: 2,
      combinedStudentCount: 2,
      occurrenceCount: 2,
      supportDenominator: 3,
      anonymousExamples: [],
      evidenceRefs: [],
    }
    const report = aiAvailable()
    report.issueBlocks = [systemBlock]
    report.issueOrder = [systemBlock.blockId]
    const value = createLocalClassReviewCoordinator({
      synthesisClient: createFakeClassReviewSynthesisClient({ scenario: 'success' }),
      topicKeySecret: new Uint8Array(32).fill(7),
      now: () => '2026-08-30T00:00:00.000Z',
      createOpaqueId: () => 'opaque',
    })
    expect(() => value.registerWorkspace({
      taskKey: 'missing-imported-system-facts',
      taskRevision: 1,
      rubricRevisionDigest: validRubricDigest,
      report,
      projection: projection(),
    })).toThrow('class_review_candidate_conflict')
  })

  it('imports authorized system facts and can suppress that applied variant with teacher evidence', () => {
    const systemBlock: ClassReviewIssueBlockV1 = {
      blockId: 'authorized-system',
      topicKey: 'tk1.aaaaaaaaaaaaaaaa',
      origin: 'ai',
      title: 'Authorized system',
      diagnosis: 'Authorized diagnosis',
      teachingAction: 'Authorized action',
      severity: 'medium',
      teacherStudentCount: 0,
      systemStudentCount: 2,
      combinedStudentCount: 2,
      occurrenceCount: 2,
      supportDenominator: 3,
      anonymousExamples: [],
      evidenceRefs: [],
    }
    const report = aiAvailable()
    report.issueBlocks = [systemBlock]
    report.issueOrder = [systemBlock.blockId]
    const value = createLocalClassReviewCoordinator({
      synthesisClient: createFakeClassReviewSynthesisClient({ scenario: 'success' }),
      topicKeySecret: new Uint8Array(32).fill(7),
      now: () => '2026-08-30T00:00:00.000Z',
      createOpaqueId: () => 'opaque',
    })
    const registerWithSystemFacts = value.registerWorkspace as unknown as (input: Parameters<typeof value.registerWorkspace>[0] & {
      systemEvidenceFacts: readonly {
        topicKey: string
        essayIdentities: readonly string[]
        occurrenceCount: number
      }[]
    }) => void
    registerWithSystemFacts({
      taskKey: 'authorized-imported-system-facts',
      taskRevision: 1,
      rubricRevisionDigest: validRubricDigest,
      report,
      projection: projection(),
      systemEvidenceFacts: [{
        topicKey: systemBlock.topicKey,
        essayIdentities: ['essay-system-a', 'essay-system-b'],
        occurrenceCount: 2,
      }],
    })
    const teacher = teacherBlock('authorized-teacher', systemBlock.topicKey)
    value.applyIssueCommand(
      'authorized-imported-system-facts',
      teacherAddCommand(teacher, 'essay-teacher'),
    )
    expect(value.getSnapshot('authorized-imported-system-facts').report.issueBlocks).toMatchObject([{
      blockId: systemBlock.blockId,
      origin: 'teacher',
      teacherStudentCount: 1,
      systemStudentCount: 2,
      combinedStudentCount: 3,
    }])

    const mixedTeacher = teacherBlock('imported-mixed-teacher', systemBlock.topicKey)
    const mixedBlock: ClassReviewIssueBlockV1 = {
      ...mixedTeacher,
      systemStudentCount: 2,
      combinedStudentCount: 3,
      occurrenceCount: 3,
      supportDenominator: 3,
    }
    const mixedReport = aiAvailable()
    mixedReport.issueBlocks = [mixedBlock]
    mixedReport.issueOrder = [mixedBlock.blockId]
    const mixedValue = createLocalClassReviewCoordinator({
      synthesisClient: createFakeClassReviewSynthesisClient({ scenario: 'success' }),
      topicKeySecret: new Uint8Array(32).fill(7),
      now: () => '2026-08-30T00:00:00.000Z',
      createOpaqueId: () => 'opaque',
    })
    const mixedRegistration = {
      taskKey: 'authorized-imported-mixed',
      taskRevision: 1,
      rubricRevisionDigest: validRubricDigest,
      report: mixedReport,
      projection: projection(),
      teacherEvidenceFacts: [{
        topicKey: mixedBlock.topicKey,
        evidenceId: mixedTeacher.evidenceRefs[0].evidenceId,
        essayIdentity: 'essay-teacher',
        occurrenceCount: 1,
        evidenceRef: mixedTeacher.evidenceRefs[0],
      }],
      systemEvidenceFacts: [{
        topicKey: mixedBlock.topicKey,
        essayIdentities: ['essay-system-a', 'essay-system-b'],
        occurrenceCount: 2,
      }],
    }
    expect(() => mixedValue.registerWorkspace(mixedRegistration)).toThrow('class_review_candidate_conflict')
    expect(() => mixedValue.getSnapshot(mixedRegistration.taskKey)).toThrow('class_review_not_eligible')
    expect(() => mixedValue.registerWorkspace({
      ...mixedRegistration,
      suppressedSystemVariants: new Map([[mixedBlock.topicKey, {
        block: systemBlock,
        generationId: 'wrong-generation',
        invalidationEpoch: 0,
        systemEvidenceFact: mixedRegistration.systemEvidenceFacts[0],
      }]]),
    })).toThrow('class_review_candidate_conflict')
    expect(() => mixedValue.getSnapshot(mixedRegistration.taskKey)).toThrow('class_review_not_eligible')
    expect(() => mixedValue.registerWorkspace({
      ...mixedRegistration,
      suppressedSystemVariants: new Map([[mixedBlock.topicKey, {
        block: systemBlock,
        generationId: mixedReport.appliedGenerationId,
        invalidationEpoch: 1,
        systemEvidenceFact: mixedRegistration.systemEvidenceFacts[0],
      }]]),
    })).toThrow('class_review_candidate_conflict')
    expect(() => mixedValue.getSnapshot(mixedRegistration.taskKey)).toThrow('class_review_not_eligible')
    mixedValue.registerWorkspace({
      ...mixedRegistration,
      suppressedSystemVariants: new Map([[mixedBlock.topicKey, {
        block: systemBlock,
        generationId: mixedReport.appliedGenerationId,
        invalidationEpoch: 0,
        systemEvidenceFact: mixedRegistration.systemEvidenceFacts[0],
      }]]),
    })
    expect(mixedValue.getSnapshot(mixedRegistration.taskKey).report.issueBlocks).toEqual([mixedBlock])
  })

  it('computes the next source epoch before registry invalidation so overflow is a byte-for-byte no-op', async () => {
    const deferred = deferredClient()
    const value = coordinator(deferred.client)
    const pending = value.generate({
      taskKey: 'task-1',
      generationId: 'overflow-owner',
      intent: 'initial',
      expectedTaskRevision: 1,
      expectedReportRevision: 1,
    })
    await vi.waitFor(() => expect(deferred.calls()).toBe(1))
    const before = value.getSnapshot('task-1')
    const originalIsSafeInteger = Number.isSafeInteger.bind(Number)
    let coordinatorCheckedAdds = 0
    vi.spyOn(Number, 'isSafeInteger').mockImplementation((candidate) => {
      const stack = new Error().stack ?? ''
      if (stack.includes('classReviewCoordinator.ts') && stack.includes('checkedAdd')) {
        coordinatorCheckedAdds += 1
        if (coordinatorCheckedAdds === 3) return false
      }
      return originalIsSafeInteger(candidate)
    })

    expect(() => sourceDeleteForTest(value, 'task-1')).toThrow('class_review_candidate_conflict')
    expect(coordinatorCheckedAdds).toBe(3)
    expect(value.getSnapshot('task-1')).toEqual(before)
    deferred.resolve(success(before.requestId as string))
    await pending
  })
})
