import { describe, expect, it } from 'vitest'
import {
  cloneAndFreezeClassReviewGenerationSnapshot,
  materializeClassReviewCandidate,
  type MaterializedClassReviewCandidateHandle,
} from './classReviewMerge'
import { createInMemoryTopicKeyRegistry } from './classReviewTopicKey'
import { createLocalClassReviewRegistry } from './classReviewRegistry'
import type { ClassReviewSynthesisRequestV1, ClassReviewSynthesisResultV1 } from './types'

const scopeA = `scope_v1_${'a'.repeat(32)}`
const scopeB = `scope_v1_${'b'.repeat(32)}`

function reserve(
  registry: ReturnType<typeof createLocalClassReviewRegistry>,
  input: { generationId: string; executionIdentity: string; payloadDigest: string; state: 'queued' | 'running'; scope?: string; proposedGenerationId?: string },
) {
  const proposedGenerationId = input.proposedGenerationId ?? input.generationId
  const actionableIdentity = `snapshot|revisions|${input.payloadDigest}`
  return registry.reserveOrAttach({
    opaqueTaskScope: input.scope ?? scopeA,
    proposedGenerationId,
    serviceGenerationId: input.generationId,
    requestId: `request-${input.generationId}`,
    requestBytes: `bytes-${input.payloadDigest}`,
    snapshotTuple: 'snapshot',
    fixedRevisions: 'revisions',
    commandIdentity: `${proposedGenerationId}|${actionableIdentity}`,
    actionableIdentity,
    commandCore: `${proposedGenerationId}|${actionableIdentity}`,
    generationRevision: 0,
    ...input,
  }).record
}

const scoped = (generationId: string, opaqueTaskScope = scopeA) => ({ opaqueTaskScope, generationId })

async function candidate(
  generationId: string,
  executionIdentity: string,
  payloadDigest: string,
  invalidationEpoch = 0,
): Promise<MaterializedClassReviewCandidateHandle> {
  const request: ClassReviewSynthesisRequestV1 = {
    contractVersion: 'class-review-synthesis-request-v1', requestId: `request-${generationId}`,
    rubricRevisionDigest: 'a'.repeat(43), policyVersion: 'class-review-policy-v1',
    schemaVersion: 'kimi-class-review-output-v1', projectionVersion: 'class-review-projection-v1',
    budgetVersion: 'class-review-prompt-budget-v1',
    statistics: { includedEssayCount: 2, issueEligibleEssayCount: 2, totalEssayCount: 2, excludedEssayCount: 0, score: { fullScore: 100, averageScore: 80, medianScore: 80, highestScore: 90, lowestScore: 70 }, scoreBands: [], dimensions: [], issueCounters: [] },
    groups: [], semanticCoverage: { projectedGroupCount: 0, eligibleGroupCount: 0, groupCoverage: 1, projectedDistinctEssaySupportSum: 0, eligibleDistinctEssaySupportSum: 0, supportWeightedCoverage: 1, projectedOccurrenceSum: 0, eligibleOccurrenceSum: 0, occurrenceWeightedCoverage: 1 },
    outputLimits: { maxCompletionTokens: 3072, maxVisibleCodePoints: 2200, maxJsonUtf8Bytes: 16384 },
  }
  const browserStatistics = { totalEssayCount: 2, includedEssayCount: 2, issueEligibleEssayCount: 2, excludedEssayCount: 0, issueCoverageRate: 1, fullScore: 100, scoreSummary: { averageScore: 80, highestScore: 90, lowestScore: 70 }, scoreBands: [], dimensions: [] }
  const snapshot = cloneAndFreezeClassReviewGenerationSnapshot({ originalRequest: request, hidden: { dimensionAliases: new Map(), selectedGroups: new Map(), unprojectedMustCover: [] }, generationId, invalidationEpoch, executionIdentity, payloadDigest, taskRevision: 1, reportRevision: 1, aiTextEditRevision: 0, sourceRevisionEpoch: 0, browserStatistics })
  const result: ClassReviewSynthesisResultV1 = { contractVersion: 'class-review-synthesis-result-v1', requestId: request.requestId, status: 'succeeded', output: { overallComment: 'Class summary', strengths: [{ title: 'Strength', detail: 'Students completed the task.', dimensionIds: [] }], patterns: [], learningRecommendations: [{ title: 'Next step', action: 'Revise with examples.' }] }, semanticCoverage: request.semanticCoverage, finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, cachedTokens: 0 }, timingsMs: { queueMs: 0, providerMs: 1, validationMs: 0, totalMs: 1 } }
  return materializeClassReviewCandidate({ snapshot, untrustedResult: result, topicHmac: { registry: createInMemoryTopicKeyRegistry(), digest: async () => new Uint8Array(32) }, createOpaqueId: () => 'unused', now: () => '2026-08-30T00:00:00.000Z' })
}

describe('local class review generation registry', () => {
  it('enforces task-scoped actionable uniqueness and unapplied precedence', async () => {
    const registry = createLocalClassReviewRegistry()
    reserve(registry, { generationId: 'g1', executionIdentity: 'x', payloadDigest: 'h', state: 'queued' })
    expect(() => reserve(registry, { generationId: 'g2', executionIdentity: 'y', payloadDigest: 'i', state: 'queued' })).toThrow('active_generation_conflict')
    const running = registry.markRunning({ ...scoped('g1'), expectedRevision: 0 })
    registry.commitSucceeded({ ...scoped('g1'), expectedRevision: running.generationRevision, expectedFence: 0, candidate: await candidate('g1', 'x', 'h'), unapplied: true })
    expect(registry.readActionable(scopeA)).toMatchObject({ generationId: 'g1', state: 'succeeded_unapplied' })
    expect(() => reserve(registry, { generationId: 'g3', executionIdentity: 'z', payloadDigest: 'j', state: 'running' })).toThrow('class_review_candidate_conflict')
  })

  it('attaches exact actionable identity and records every proposed alias', () => {
    const registry = createLocalClassReviewRegistry()
    const first = reserve(registry, { generationId: 'g1', executionIdentity: 'x', payloadDigest: 'h', state: 'queued', proposedGenerationId: 'client-1' })
    const attached = reserve(registry, { generationId: 'ignored', executionIdentity: 'other', payloadDigest: 'h', state: 'queued', proposedGenerationId: 'client-2' })
    expect(attached).toEqual(first)
    expect(registry.readProposed({ opaqueTaskScope: scopeA, proposedGenerationId: 'client-2' })).toEqual(first)
    expect(() => reserve(registry, { generationId: 'g3', executionIdentity: 'x', payloadDigest: 'changed', state: 'queued' })).toThrow('active_generation_conflict')
  })

  it('replays only an exact same proposed terminal command and allows a distinct proposed ID to reserve', () => {
    const registry = createLocalClassReviewRegistry()
    reserve(registry, { generationId: 'g1', executionIdentity: 'x', payloadDigest: 'h', state: 'running', proposedGenerationId: 'client-1' })
    registry.markFailed({ ...scoped('g1'), expectedRevision: 0, expectedState: 'running', safeFailureCode: 'provider_auth_failed' })
    const replay = reserve(registry, { generationId: 'ignored', executionIdentity: 'new', payloadDigest: 'h', state: 'queued', proposedGenerationId: 'client-1' })
    expect(replay).toMatchObject({ generationId: 'g1', state: 'failed' })
    expect(() => reserve(registry, { generationId: 'ignored-again', executionIdentity: 'new', payloadDigest: 'drifted', state: 'queued', proposedGenerationId: 'client-1' })).toThrow('active_generation_conflict')
    const fresh = reserve(registry, { generationId: 'g2', executionIdentity: 'new', payloadDigest: 'new', state: 'queued', proposedGenerationId: 'client-2' })
    expect(fresh.generationId).toBe('g2')
  })

  it('treats hidden snapshot/source epoch identity changes as active conflicts', () => {
    const registry = createLocalClassReviewRegistry()
    registry.reserveOrAttach({ opaqueTaskScope: scopeA, proposedGenerationId: 'g1', serviceGenerationId: 'g1', requestId: 'r1', executionIdentity: 'e1', requestBytes: 'bytes', snapshotTuple: 'snapshot-a', fixedRevisions: 'epoch-0', payloadDigest: 'digest-a', commandIdentity: 'command-a', actionableIdentity: 'action-a', commandCore: 'core-a', state: 'queued', generationRevision: 0 })
    expect(() => registry.reserveOrAttach({ opaqueTaskScope: scopeA, proposedGenerationId: 'g2', serviceGenerationId: 'g2', requestId: 'r2', executionIdentity: 'e2', requestBytes: 'bytes', snapshotTuple: 'snapshot-b', fixedRevisions: 'epoch-1', payloadDigest: 'digest-b', commandIdentity: 'command-b', actionableIdentity: 'action-b', commandCore: 'core-b', state: 'queued', generationRevision: 0 })).toThrow('active_generation_conflict')
  })

  it('uses revision CAS and invalidation fences late settlement', async () => {
    const registry = createLocalClassReviewRegistry()
    reserve(registry, { generationId: 'g1', executionIdentity: 'x', payloadDigest: 'h', state: 'running' })
    expect(registry.commitSucceeded({ ...scoped('g1'), expectedRevision: 1, expectedFence: 0, candidate: null, unapplied: false })).toBeNull()
    const invalidated = registry.invalidateTaskScope({ opaqueTaskScope: scopeA, safeFailureCode: 'class_review_source_invalidated' })
    expect(invalidated).toMatchObject({ state: 'invalidated', generationRevision: 1, invalidationFence: 1, candidateAvailable: false })
    expect(registry.commitSucceeded({ ...scoped('g1'), expectedRevision: 0, expectedFence: 0, candidate: await candidate('g1', 'x', 'h'), unapplied: true })).toBeNull()
    expect(registry.readGeneration(scoped('g1'))?.state).toBe('invalidated')
  })

  it('rejects inconsistent candidate/state commits atomically', () => {
    const registry = createLocalClassReviewRegistry()
    reserve(registry, { generationId: 'g1', executionIdentity: 'x', payloadDigest: 'h', state: 'running' })
    expect(() => registry.commitSucceeded({ ...scoped('g1'), expectedRevision: 0, expectedFence: 0, candidate: null, unapplied: true })).toThrow('class_review_candidate_conflict')
    expect(registry.readGeneration(scoped('g1'))).toMatchObject({ state: 'running', generationRevision: 0, candidateAvailable: false })
  })

  it('rejects a candidate not bound to generation, execution identity, digest, and fence', async () => {
    const registry = createLocalClassReviewRegistry()
    reserve(registry, { generationId: 'g1', executionIdentity: 'x', payloadDigest: 'h', state: 'running' })
    const wrongCandidate = await candidate('other', 'x', 'h')
    expect(() => registry.commitSucceeded({ ...scoped('g1'), expectedRevision: 0, expectedFence: 0, candidate: wrongCandidate, unapplied: true })).toThrow('class_review_candidate_conflict')
    expect(registry.readGeneration(scoped('g1'))).toMatchObject({ state: 'running', candidateAvailable: false })
  })

  it('permits only one same-identity confirmed-zero requeue after local settlement', () => {
    const registry = createLocalClassReviewRegistry()
    reserve(registry, { generationId: 'g1', executionIdentity: 'x', payloadDigest: 'h', state: 'running' })
    expect(() => registry.requeueConfirmedZero({ ...scoped('g1'), expectedRevision: 0, executionIdentity: 'wrong', payloadHash: 'h', localCallSettled: true })).toThrow('execution_identity_conflict')
    expect(registry.requeueConfirmedZero({ ...scoped('g1'), expectedRevision: 0, executionIdentity: 'x', payloadHash: 'h', localCallSettled: true })).toMatchObject({ state: 'queued', boundedRequeueCount: 1 })
    const running = registry.markRunning({ ...scoped('g1'), expectedRevision: 1 })
    expect(() => registry.requeueConfirmedZero({ ...scoped('g1'), expectedRevision: running.generationRevision, executionIdentity: 'x', payloadHash: 'h', localCallSettled: true })).toThrow('requeue_exhausted')
  })

  it('returns deep-frozen detached content-free snapshots and transitions failure atomically', () => {
    const registry = createLocalClassReviewRegistry()
    const reservation = registry.reserveOrAttach({ opaqueTaskScope: scopeA, proposedGenerationId: 'g1', serviceGenerationId: 'g1', requestId: 'request-g1', requestBytes: 'secret-bytes', snapshotTuple: 'snapshot', fixedRevisions: 'revisions', payloadDigest: 'h', commandIdentity: 'command-g1', actionableIdentity: 'action-g1', commandCore: 'core-g1', executionIdentity: 'x', state: 'running', generationRevision: 0 })
    expect(Object.isFrozen(reservation.record)).toBe(true)
    expect(reservation.record).not.toHaveProperty('requestBytes')
    expect(reservation.record).not.toHaveProperty('candidate')
    expect(Reflect.set(reservation.record, 'state', 'succeeded')).toBe(false)
    const failed = registry.markFailed({ ...scoped('g1'), expectedRevision: 0, expectedState: 'running', safeFailureCode: 'provider_auth_failed' })
    expect(failed).toMatchObject({ state: 'failed', generationRevision: 1, safeFailureCode: 'provider_auth_failed' })
  })

  it('binds candidate apply and discard atomically to target task scope', async () => {
    const registry = createLocalClassReviewRegistry()
    reserve(registry, { generationId: 'apply-g', executionIdentity: 'x', payloadDigest: 'h', state: 'running' })
    registry.commitSucceeded({ ...scoped('apply-g'), expectedRevision: 0, expectedFence: 0, candidate: await candidate('apply-g', 'x', 'h'), unapplied: true })
    expect(() => registry.applyCandidate({ ...scoped('apply-g', scopeB), expectedRevision: 1, apply: () => 'wrong' })).toThrow('class_review_candidate_conflict')
    expect(registry.readGeneration(scoped('apply-g'))).toMatchObject({ state: 'succeeded_unapplied' })
    const applied = registry.applyCandidate({ ...scoped('apply-g'), expectedRevision: 1, apply: () => 'applied-value' })
    expect(applied).toMatchObject({ record: { state: 'succeeded' }, value: 'applied-value' })

    reserve(registry, { generationId: 'discard-g', executionIdentity: 'y', payloadDigest: 'i', state: 'running' })
    registry.commitSucceeded({ ...scoped('discard-g'), expectedRevision: 0, expectedFence: 0, candidate: await candidate('discard-g', 'y', 'i'), unapplied: true })
    expect(() => registry.discardCandidate({ ...scoped('discard-g', scopeB), expectedRevision: 1 })).toThrow('class_review_candidate_conflict')
    expect(registry.discardCandidate({ ...scoped('discard-g'), expectedRevision: 1 })).toMatchObject({ state: 'discarded' })
  })

  it('keeps candidate and state untouched when the synchronous apply callback fails', async () => {
    const registry = createLocalClassReviewRegistry()
    reserve(registry, { generationId: 'callback-g', executionIdentity: 'x', payloadDigest: 'h', state: 'running' })
    registry.commitSucceeded({ ...scoped('callback-g'), expectedRevision: 0, expectedFence: 0, candidate: await candidate('callback-g', 'x', 'h'), unapplied: true })
    expect(() => registry.applyCandidate({ ...scoped('callback-g'), expectedRevision: 1, apply: () => { throw new Error('local-conflict') } })).toThrow('local-conflict')
    expect(registry.readGeneration(scoped('callback-g'))).toMatchObject({ state: 'succeeded_unapplied', candidateAvailable: true, generationRevision: 1 })
  })

  it('keys generations by scope and wrong-scope transitions cannot mutate either owner', () => {
    const registry = createLocalClassReviewRegistry()
    reserve(registry, { generationId: 'shared-generation', executionIdentity: 'scope-a-execution', payloadDigest: 'scope-a-digest', state: 'queued', scope: scopeA })
    reserve(registry, { generationId: 'shared-generation', executionIdentity: 'scope-b-execution', payloadDigest: 'scope-b-digest', state: 'queued', scope: scopeB })
    expect(registry.readGeneration(scoped('shared-generation', scopeA))).toMatchObject({ state: 'queued' })
    expect(registry.readGeneration(scoped('shared-generation', scopeB))).toMatchObject({ state: 'queued' })
    expect(() => registry.markRunning({ ...scoped('shared-generation', `scope_v1_${'c'.repeat(32)}`), expectedRevision: 0 })).toThrow('generation_not_found')
    expect(registry.readGeneration(scoped('shared-generation', scopeA))).toMatchObject({ state: 'queued' })
    expect(registry.readGeneration(scoped('shared-generation', scopeB))).toMatchObject({ state: 'queued' })
  })

  it('persists a secondary actionable proposed alias through real candidate discard and terminal replay', async () => {
    const registry = createLocalClassReviewRegistry()
    reserve(registry, {
      generationId: 'candidate-owner', executionIdentity: 'execution-owner',
      payloadDigest: 'digest-owner', state: 'running', proposedGenerationId: 'browser-primary',
    })
    registry.commitSucceeded({
      ...scoped('candidate-owner'), expectedRevision: 0, expectedFence: 0,
      candidate: await candidate('candidate-owner', 'execution-owner', 'digest-owner'),
      unapplied: true,
    })
    const attached = reserve(registry, {
      generationId: 'ignored-secondary', executionIdentity: 'execution-owner',
      payloadDigest: 'digest-owner', state: 'queued', proposedGenerationId: 'browser-secondary',
    })
    expect(attached).toMatchObject({ generationId: 'candidate-owner', state: 'succeeded_unapplied' })
    registry.discardCandidate({ ...scoped('candidate-owner'), expectedRevision: 1 })
    expect(registry.readProposed({
      opaqueTaskScope: scopeA,
      proposedGenerationId: 'browser-secondary',
    })).toMatchObject({ generationId: 'candidate-owner', state: 'discarded' })
  })

  it('clears public request identity for result-unknown, unapplied and discarded terminal records', async () => {
    const registry = createLocalClassReviewRegistry()
    reserve(registry, {
      generationId: 'unknown-owner', executionIdentity: 'unknown-execution',
      payloadDigest: 'unknown-digest', state: 'running',
    })
    expect(registry.markResultUnknown({
      ...scoped('unknown-owner'), expectedRevision: 0,
      safeFailureCode: 'provider_result_unknown',
    })).toMatchObject({ state: 'result_unknown', requestId: null })

    reserve(registry, {
      generationId: 'candidate-owner', executionIdentity: 'candidate-execution',
      payloadDigest: 'candidate-digest', state: 'running', scope: scopeB,
    })
    expect(registry.commitSucceeded({
      ...scoped('candidate-owner', scopeB), expectedRevision: 0, expectedFence: 0,
      candidate: await candidate('candidate-owner', 'candidate-execution', 'candidate-digest'),
      unapplied: true,
    })).toMatchObject({ state: 'succeeded_unapplied', requestId: null })
    expect(registry.discardCandidate({
      ...scoped('candidate-owner', scopeB), expectedRevision: 1,
    })).toMatchObject({ state: 'discarded', requestId: null })
  })
})
