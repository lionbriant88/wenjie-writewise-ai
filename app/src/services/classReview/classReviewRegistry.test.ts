import { describe, expect, it } from 'vitest'
import type { GeneratedClassReviewPayload } from './classReviewMerge'
import { createLocalClassReviewRegistry } from './classReviewRegistry'

const scopeA = `scope_v1_${'a'.repeat(32)}`
const scopeB = `scope_v1_${'b'.repeat(32)}`

function payload(
  generationId: string,
  executionIdentity: string,
  payloadDigest: string,
): GeneratedClassReviewPayload {
  return {
    generationId,
    invalidationEpoch: 0,
    executionIdentity,
    payloadDigest,
    generatedPayload: {
      aiSummary: { overallComment: 'safe', strengths: [{ title: 'S', detail: 'D', dimensionIds: [] }], learningRecommendations: [{ title: 'N', action: 'A' }] },
      systemIssueBlocks: [], systemEvidenceFacts: [], generatedAt: '2026-08-30T00:00:00.000Z',
      snapshotMetadata: { includedEssayCount: 2, issueEligibleEssayCount: 2, totalEssayCount: 2, semanticCoverage: { projectedGroupCount: 0, eligibleGroupCount: 0, groupCoverage: 1, projectedDistinctEssaySupportSum: 0, eligibleDistinctEssaySupportSum: 0, supportWeightedCoverage: 1, projectedOccurrenceSum: 0, eligibleOccurrenceSum: 0, occurrenceWeightedCoverage: 1 } },
    },
  }
}

describe('local class review generation registry', () => {
  const reserve = (registry: ReturnType<typeof createLocalClassReviewRegistry>, input: { generationId: string; executionIdentity: string; payloadDigest: string; state: 'queued' | 'running'; scope?: string }) => registry.reserveOrAttach({ opaqueTaskScope: input.scope ?? scopeA, proposedGenerationId: input.generationId, serviceGenerationId: input.generationId, requestId: `request-${input.generationId}`, requestBytes: `bytes-${input.payloadDigest}`, snapshotTuple: 'snapshot', fixedRevisions: 'revisions', generationRevision: 0, ...input }).record

  it('enforces task-scoped actionable uniqueness and unapplied precedence', () => {
    const registry = createLocalClassReviewRegistry()
    reserve(registry, { generationId: 'g1', executionIdentity: 'x', payloadDigest: 'h', state: 'queued' })
    expect(() => reserve(registry, { generationId: 'g2', executionIdentity: 'y', payloadDigest: 'i', state: 'queued' })).toThrow('active_generation_conflict')
    const running = registry.markRunning({ generationId: 'g1', expectedRevision: 0 })
    registry.commitSucceeded({ generationId: 'g1', expectedRevision: running.generationRevision, expectedFence: 0, candidate: payload('g1', 'x', 'h'), unapplied: true })
    expect(registry.readActionable(scopeA)).toMatchObject({ generationId: 'g1', state: 'succeeded_unapplied' })
    expect(() => reserve(registry, { generationId: 'g3', executionIdentity: 'z', payloadDigest: 'j', state: 'running' })).toThrow('class_review_candidate_conflict')
  })

  it('attaches exact replay but conflicts on changed snapshot/execution payload identity', () => {
    const registry = createLocalClassReviewRegistry()
    const first = reserve(registry, { generationId: 'g1', executionIdentity: 'x', payloadDigest: 'h', state: 'queued' })
    const attached = reserve(registry, { generationId: 'g2', executionIdentity: 'other', payloadDigest: 'h', state: 'queued' })
    expect(attached).toEqual(first)
    expect(() => reserve(registry, { generationId: 'g3', executionIdentity: 'x', payloadDigest: 'changed', state: 'queued' })).toThrow('active_generation_conflict')
  })

  it('uses task scope rather than proposed generation id and has no duplicate suppressed-variant store', () => {
    const registry = createLocalClassReviewRegistry()
    reserve(registry, { generationId: 'service-g1', executionIdentity: 'execution-1', payloadDigest: 'digest', state: 'queued', scope: `scope_v1_${'1'.repeat(32)}` })
    const attached = registry.reserveOrAttach({ opaqueTaskScope: `scope_v1_${'1'.repeat(32)}`, proposedGenerationId: 'client-g2', serviceGenerationId: 'ignored', requestId: 'ignored', executionIdentity: 'ignored', requestBytes: 'ignored', state: 'queued', generationRevision: 0, snapshotTuple: 'snapshot', fixedRevisions: 'revisions', payloadDigest: 'digest' })
    expect(attached.kind).toBe('attached')
    expect(attached.record.generationId).toBe('service-g1')
    expect(registry).not.toHaveProperty('storeSuppressedVariant')
    expect(registry).not.toHaveProperty('getSuppressedVariant')
  })

  it('treats hidden snapshot/source epoch identity changes as conflicts', () => {
    const registry = createLocalClassReviewRegistry()
    registry.reserveOrAttach({ opaqueTaskScope: scopeA, proposedGenerationId: 'g1', serviceGenerationId: 'g1', requestId: 'r1', executionIdentity: 'e1', requestBytes: 'bytes', snapshotTuple: 'snapshot-a', fixedRevisions: 'epoch-0', payloadDigest: 'digest-a', state: 'queued', generationRevision: 0 })
    expect(() => registry.reserveOrAttach({ opaqueTaskScope: scopeA, proposedGenerationId: 'g2', serviceGenerationId: 'g2', requestId: 'r2', executionIdentity: 'e2', requestBytes: 'bytes', snapshotTuple: 'snapshot-b', fixedRevisions: 'epoch-1', payloadDigest: 'digest-b', state: 'queued', generationRevision: 0 })).toThrow('active_generation_conflict')
  })

  it('uses revision CAS, terminal states never re-enter Provider, and invalidation fences late settlement', () => {
    const registry = createLocalClassReviewRegistry()
    reserve(registry, { generationId: 'g1', executionIdentity: 'x', payloadDigest: 'h', state: 'running' })
    expect(registry.commitSucceeded({ generationId: 'g1', expectedRevision: 1, expectedFence: 0, candidate: null, unapplied: false })).toBeNull()
    const invalidated = registry.invalidateTaskScope({ opaqueTaskScope: scopeA, safeFailureCode: 'class_review_source_invalidated' })
    expect(invalidated).toMatchObject({ state: 'invalidated', generationRevision: 1, invalidationFence: 1, candidate: null })
    expect(registry.commitSucceeded({ generationId: 'g1', expectedRevision: 0, expectedFence: 0, candidate: payload('g1', 'x', 'h'), unapplied: true })).toBeNull()
    expect(registry.readGeneration('g1')?.state).toBe('invalidated')
  })

  it('rejects inconsistent candidate/state commits atomically', () => {
    const registry = createLocalClassReviewRegistry()
    reserve(registry, {
      generationId: 'g1',
      executionIdentity: 'x',
      payloadDigest: 'h',
      state: 'running',
    })

    expect(() => registry.commitSucceeded({
      generationId: 'g1',
      expectedRevision: 0,
      expectedFence: 0,
      candidate: null,
      unapplied: true,
    })).toThrow('class_review_candidate_conflict')
    expect(registry.readGeneration('g1')).toMatchObject({
      state: 'running',
      generationRevision: 0,
      candidate: null,
    })
  })

  it('rejects a candidate that is not bound to the running generation and fence', () => {
    const registry = createLocalClassReviewRegistry()
    reserve(registry, {
      generationId: 'g1',
      executionIdentity: 'x',
      payloadDigest: 'h',
      state: 'running',
    })

    expect(() => registry.commitSucceeded({
      generationId: 'g1',
      expectedRevision: 0,
      expectedFence: 0,
      candidate: payload('other-generation', 'x', 'h'),
      unapplied: true,
    })).toThrow('class_review_candidate_conflict')
    expect(registry.readGeneration('g1')).toMatchObject({
      state: 'running',
      generationRevision: 0,
      candidate: null,
    })
  })

  it('permits only one same-identity confirmed-zero requeue after local settlement', () => {
    const registry = createLocalClassReviewRegistry()
    reserve(registry, { generationId: 'g1', executionIdentity: 'x', payloadDigest: 'h', state: 'running' })
    expect(() => registry.requeueConfirmedZero({ generationId: 'g1', expectedRevision: 0, executionIdentity: 'wrong', payloadHash: 'h', localCallSettled: true })).toThrow('execution_identity_conflict')
    expect(registry.requeueConfirmedZero({ generationId: 'g1', expectedRevision: 0, executionIdentity: 'x', payloadHash: 'h', localCallSettled: true })).toMatchObject({ state: 'queued', boundedRequeueCount: 1 })
    const running = registry.markRunning({ generationId: 'g1', expectedRevision: 1 })
    expect(() => registry.requeueConfirmedZero({ generationId: 'g1', expectedRevision: running.generationRevision, executionIdentity: 'x', payloadHash: 'h', localCallSettled: true })).toThrow('requeue_exhausted')
  })

  it('returns only deep-frozen detached snapshots and transitions failure facts atomically', () => {
    const registry = createLocalClassReviewRegistry()
    const reservation = registry.reserveOrAttach({ opaqueTaskScope: scopeA, proposedGenerationId: 'g1', serviceGenerationId: 'g1', requestId: 'request-g1', requestBytes: 'bytes', snapshotTuple: 'snapshot', fixedRevisions: 'revisions', payloadDigest: 'h', executionIdentity: 'x', state: 'running', generationRevision: 0 })
    const reserved = reservation.record
    expect(Object.isFrozen(reservation)).toBe(true)
    expect(Object.isFrozen(reserved)).toBe(true)
    expect(Reflect.set(reserved, 'state', 'succeeded')).toBe(false)
    expect(registry.readGeneration('g1')).toMatchObject({ state: 'running', generationRevision: 0 })
    const failed = registry.markFailed({ generationId: 'g1', expectedRevision: 0, expectedState: 'running', safeFailureCode: 'provider_auth_failed' })
    expect(failed).toMatchObject({ state: 'failed', generationRevision: 1, safeFailureCode: 'provider_auth_failed' })
    expect(Object.isFrozen(failed)).toBe(true)
  })

  it('binds candidate apply and discard atomically to target task scope', () => {
    const registry = createLocalClassReviewRegistry()
    reserve(registry, { generationId: 'apply-g', executionIdentity: 'x', payloadDigest: 'h', state: 'running' })
    registry.commitSucceeded({ generationId: 'apply-g', expectedRevision: 0, expectedFence: 0, candidate: payload('apply-g', 'x', 'h'), unapplied: true })
    expect(() => registry.applyCandidate({ opaqueTaskScope: scopeB, generationId: 'apply-g', expectedRevision: 1 })).toThrow('class_review_candidate_conflict')
    expect(registry.readGeneration('apply-g')).toMatchObject({ state: 'succeeded_unapplied' })
    const applied = registry.applyCandidate({ opaqueTaskScope: scopeA, generationId: 'apply-g', expectedRevision: 1 })
    expect(applied.record).toMatchObject({ state: 'succeeded' })
    expect(Object.isFrozen(applied)).toBe(true)
    expect(Object.isFrozen(applied.candidate.generatedPayload)).toBe(true)
    reserve(registry, { generationId: 'discard-g', executionIdentity: 'y', payloadDigest: 'i', state: 'running' })
    registry.commitSucceeded({ generationId: 'discard-g', expectedRevision: 0, expectedFence: 0, candidate: payload('discard-g', 'y', 'i'), unapplied: true })
    expect(() => registry.discardCandidate({ opaqueTaskScope: scopeB, generationId: 'discard-g', expectedRevision: 1 })).toThrow('class_review_candidate_conflict')
    expect(registry.readGeneration('discard-g')).toMatchObject({ state: 'succeeded_unapplied' })
    expect(registry.discardCandidate({ opaqueTaskScope: scopeA, generationId: 'discard-g', expectedRevision: 1 })).toMatchObject({ state: 'discarded' })
  })
})
