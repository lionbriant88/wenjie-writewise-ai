import { describe, expect, it } from 'vitest'
import { createLocalClassReviewRegistry } from './classReviewRegistry'

describe('local class review generation registry', () => {
  const reserve = (registry: ReturnType<typeof createLocalClassReviewRegistry>, input: { generationId: string; executionIdentity: string; payloadDigest: string; state: 'queued' | 'running' }) => registry.reserveOrAttach({ opaqueTaskScope: `scope_v1_${'a'.repeat(32)}`, proposedGenerationId: input.generationId, serviceGenerationId: input.generationId, requestId: `request-${input.generationId}`, requestBytes: `bytes-${input.payloadDigest}`, snapshotTuple: 'snapshot', fixedRevisions: 'revisions', generationRevision: 0, ...input })

  it('enforces task-scoped actionable uniqueness and unapplied precedence', () => {
    const registry = createLocalClassReviewRegistry()
    reserve(registry, { generationId: 'g1', executionIdentity: 'x', payloadDigest: 'h', state: 'queued' })
    expect(() => reserve(registry, { generationId: 'g2', executionIdentity: 'y', payloadDigest: 'i', state: 'queued' })).toThrow('active_generation_conflict')
    registry.markRunning('g1', 0)
    registry.markSucceededUnapplied('g1', 1)
    expect(registry.getActionable(`scope_v1_${'a'.repeat(32)}`)).toMatchObject({ generationId: 'g1', state: 'succeeded_unapplied' })
    expect(() => reserve(registry, { generationId: 'g3', executionIdentity: 'z', payloadDigest: 'j', state: 'running' })).toThrow('class_review_candidate_conflict')
  })

  it('attaches exact replay but conflicts on a changed execution identity or payload', () => {
    const registry = createLocalClassReviewRegistry()
    const first = reserve(registry, { generationId: 'g1', executionIdentity: 'x', payloadDigest: 'h', state: 'queued' })
    expect(reserve(registry, { generationId: 'g1', executionIdentity: 'x', payloadDigest: 'h', state: 'queued' })).toBe(first)
    expect(() => reserve(registry, { generationId: 'g1', executionIdentity: 'x', payloadDigest: 'changed', state: 'queued' })).toThrow('active_generation_conflict')
  })

  it('uses task-scope actionable identity rather than a proposed generation id and retains suppressed variants behind the epoch fence', () => {
    const registry = createLocalClassReviewRegistry()
    const frozen = { snapshotTuple: 'snapshot', fixedRevisions: 'revisions', payloadDigest: 'digest' }
    const first = registry.reserveOrAttach({ opaqueTaskScope: `scope_v1_${'1'.repeat(32)}`, proposedGenerationId: 'client-g1', serviceGenerationId: 'service-g1', requestId: 'request-1', executionIdentity: 'execution-1', requestBytes: '{"stable":true}', state: 'queued', generationRevision: 0, ...frozen })
    const attached = registry.reserveOrAttach({ opaqueTaskScope: `scope_v1_${'1'.repeat(32)}`, proposedGenerationId: 'client-g2', serviceGenerationId: 'ignored', requestId: 'ignored', executionIdentity: 'ignored', requestBytes: 'ignored', state: 'queued', generationRevision: 0, ...frozen })
    expect(attached).toBe(first)
    registry.storeSuppressedVariant('service-g1', { generationId: 'service-g1', invalidationEpoch: 0, topicKey: 'tk1.aaaaaaaaaaaaaaaa', blockId: 'block-1', value: { safe: true } })
    expect(registry.getSuppressedVariant('service-g1', 'tk1.aaaaaaaaaaaaaaaa', 0)).toMatchObject({ blockId: 'block-1' })
    registry.invalidateTaskScope(`scope_v1_${'1'.repeat(32)}`, 'class_review_source_invalidated')
    expect(registry.getSuppressedVariant('service-g1', 'tk1.aaaaaaaaaaaaaaaa', 0)).toBeNull()
  })

  it('treats deterministic hidden-map/source-epoch snapshot changes as identity conflicts', () => {
    const registry = createLocalClassReviewRegistry()
    const scope = `scope_v1_${'2'.repeat(32)}`
    registry.reserveOrAttach({ opaqueTaskScope: scope, proposedGenerationId: 'g1', serviceGenerationId: 'service-g1', requestId: 'r1', executionIdentity: 'e1', requestBytes: 'bytes', snapshotTuple: '{"hidden":[["g1","fp1.a"]],"sourceRevisionEpoch":0}', fixedRevisions: 'rev', payloadDigest: 'digest', state: 'queued', generationRevision: 0 })
    expect(() => registry.reserveOrAttach({ opaqueTaskScope: scope, proposedGenerationId: 'g2', serviceGenerationId: 'service-g2', requestId: 'r2', executionIdentity: 'e2', requestBytes: 'bytes', snapshotTuple: '{"hidden":[["g1","fp1.b"]],"sourceRevisionEpoch":1}', fixedRevisions: 'rev', payloadDigest: 'digest', state: 'queued', generationRevision: 0 })).toThrow('active_generation_conflict')
  })

  it('uses revision CAS, terminal states never re-enter Provider, and invalidation fences late settlement', () => {
    const registry = createLocalClassReviewRegistry()
    reserve(registry, { generationId: 'g1', executionIdentity: 'x', payloadDigest: 'h', state: 'running' })
    expect(registry.commitSucceeded({ generationId: 'g1', expectedRevision: 1, expectedFence: 0 })).toBe(false)
    const invalidated = registry.invalidateTask(`scope_v1_${'a'.repeat(32)}`, 'class_review_source_invalidated')
    expect(invalidated).toMatchObject({ state: 'invalidated', generationRevision: 1, invalidationFence: 1, candidate: null })
    expect(registry.commitSucceeded({ generationId: 'g1', expectedRevision: 0, expectedFence: 0, candidate: { secret: 'late' } })).toBe(false)
    expect(registry.canDispatch('g1')).toBe(false)
  })

  it('permits only one same-identity confirmed-zero requeue after local settlement', () => {
    const registry = createLocalClassReviewRegistry()
    reserve(registry, { generationId: 'g1', executionIdentity: 'x', payloadDigest: 'h', state: 'running' })
    expect(() => registry.requeueConfirmedZero({ generationId: 'g1', expectedRevision: 0, executionIdentity: 'wrong', payloadHash: 'h', localCallSettled: true })).toThrow('execution_identity_conflict')
    expect(registry.requeueConfirmedZero({ generationId: 'g1', expectedRevision: 0, executionIdentity: 'x', payloadHash: 'h', localCallSettled: true })).toMatchObject({ state: 'queued', boundedRequeueCount: 1 })
    registry.markRunning('g1', 1)
    expect(() => registry.requeueConfirmedZero({ generationId: 'g1', expectedRevision: 2, executionIdentity: 'x', payloadHash: 'h', localCallSettled: true })).toThrow('requeue_exhausted')
  })
})
