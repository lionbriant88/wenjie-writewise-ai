import type { GeneratedClassReviewPayload } from './classReviewMerge'
import type { SafeFailureCode } from './types'

export type LocalGenerationState =
  | 'queued'
  | 'running'
  | 'result_unknown'
  | 'succeeded_unapplied'
  | 'failed'
  | 'succeeded'
  | 'discarded'
  | 'invalidated'

export interface ReservationInput {
  opaqueTaskScope: string
  proposedGenerationId: string
  serviceGenerationId: string
  requestId: string
  executionIdentity: string
  requestBytes: string
  snapshotTuple: string
  fixedRevisions: string
  payloadDigest: string
  state: 'queued' | 'running'
  generationRevision: number
}

export interface LocalGenerationRecord {
  readonly opaqueTaskScope: string
  readonly generationId: string
  readonly requestId: string
  readonly executionIdentity: string
  readonly requestBytes: string
  readonly snapshotTuple: string
  readonly fixedRevisions: string
  readonly payloadDigest: string
  readonly state: LocalGenerationState
  readonly generationRevision: number
  readonly invalidationFence: number
  readonly boundedRequeueCount: number
  readonly candidate: GeneratedClassReviewPayload | null
  readonly safeFailureCode?: SafeFailureCode
}

interface MutableGenerationRecord extends Omit<
  LocalGenerationRecord,
  | 'state'
  | 'generationRevision'
  | 'invalidationFence'
  | 'boundedRequeueCount'
  | 'candidate'
  | 'safeFailureCode'
> {
  state: LocalGenerationState
  generationRevision: number
  invalidationFence: number
  boundedRequeueCount: number
  candidate: GeneratedClassReviewPayload | null
  safeFailureCode?: SafeFailureCode
}

export type ReservationResult =
  | { kind: 'reserved'; record: LocalGenerationRecord }
  | { kind: 'attached'; record: LocalGenerationRecord }

function fail(code: string): never {
  throw new Error(code)
}

function deepFreeze(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
  if (Array.isArray(value)) value.forEach(deepFreeze)
  else Object.values(value).forEach(deepFreeze)
  Object.freeze(value)
}

function snapshot(record: MutableGenerationRecord): LocalGenerationRecord {
  const value = structuredClone(record) as LocalGenerationRecord
  deepFreeze(value)
  return value
}

function frozenValue<T>(value: T): T {
  deepFreeze(value)
  return value
}

export function createLocalClassReviewRegistry() {
  const byGeneration = new Map<string, MutableGenerationRecord>()
  const actionableByTask = new Map<string, string>()

  const mutable = (generationId: string): MutableGenerationRecord | null =>
    byGeneration.get(generationId) ?? null
  const mutableActionable = (scope: string): MutableGenerationRecord | null => {
    const generationId = actionableByTask.get(scope)
    return generationId ? mutable(generationId) : null
  }
  const readGeneration = (generationId: string): LocalGenerationRecord | null => {
    const record = mutable(generationId)
    return record ? snapshot(record) : null
  }
  const readActionable = (scope: string): LocalGenerationRecord | null => {
    const record = mutableActionable(scope)
    return record ? snapshot(record) : null
  }

  function reserveOrAttach(input: ReservationInput): ReservationResult {
    const active = mutableActionable(input.opaqueTaskScope)
    if (active) {
      const sameIdentity = active.snapshotTuple === input.snapshotTuple
        && active.fixedRevisions === input.fixedRevisions
        && active.payloadDigest === input.payloadDigest
      if (!sameIdentity) {
        if (active.state === 'succeeded_unapplied') fail('class_review_candidate_conflict')
        fail('active_generation_conflict')
      }
      return frozenValue({ kind: 'attached' as const, record: snapshot(active) })
    }
    if (byGeneration.has(input.serviceGenerationId)) fail('active_generation_conflict')
    const record: MutableGenerationRecord = {
      opaqueTaskScope: input.opaqueTaskScope,
      generationId: input.serviceGenerationId,
      requestId: input.requestId,
      executionIdentity: input.executionIdentity,
      requestBytes: input.requestBytes,
      snapshotTuple: input.snapshotTuple,
      fixedRevisions: input.fixedRevisions,
      payloadDigest: input.payloadDigest,
      state: input.state,
      generationRevision: input.generationRevision,
      invalidationFence: 0,
      boundedRequeueCount: 0,
      candidate: null,
    }
    byGeneration.set(record.generationId, record)
    actionableByTask.set(record.opaqueTaskScope, record.generationId)
    return frozenValue({ kind: 'reserved' as const, record: snapshot(record) })
  }

  function requireRecord(
    generationId: string,
    expectedRevision: number,
    expectedState: LocalGenerationState,
  ): MutableGenerationRecord {
    const record = mutable(generationId)
    if (!record) fail('generation_not_found')
    if (record.generationRevision !== expectedRevision) fail('generation_revision_conflict')
    if (record.state !== expectedState) fail('generation_state_conflict')
    return record
  }

  function markRunning(input: { generationId: string; expectedRevision: number }): LocalGenerationRecord {
    const record = requireRecord(input.generationId, input.expectedRevision, 'queued')
    record.state = 'running'
    record.generationRevision += 1
    record.safeFailureCode = undefined
    return snapshot(record)
  }

  function markResultUnknown(input: { generationId: string; expectedRevision: number; safeFailureCode: 'provider_result_unknown' }): LocalGenerationRecord {
    const record = requireRecord(input.generationId, input.expectedRevision, 'running')
    record.state = 'result_unknown'
    record.generationRevision += 1
    record.safeFailureCode = input.safeFailureCode
    return snapshot(record)
  }

  function markFailed(input: {
    generationId: string
    expectedRevision: number
    expectedState: 'queued' | 'running' | 'result_unknown'
    safeFailureCode: SafeFailureCode
  }): LocalGenerationRecord {
    const record = requireRecord(input.generationId, input.expectedRevision, input.expectedState)
    record.state = 'failed'
    record.generationRevision += 1
    record.safeFailureCode = input.safeFailureCode
    record.candidate = null
    actionableByTask.delete(record.opaqueTaskScope)
    return snapshot(record)
  }

  function commitSucceeded(input: {
    generationId: string
    expectedRevision: number
    expectedFence: number
    candidate: GeneratedClassReviewPayload | null
    unapplied: boolean
  }): LocalGenerationRecord | null {
    const record = mutable(input.generationId)
    if (
      !record
      || record.state !== 'running'
      || record.generationRevision !== input.expectedRevision
      || record.invalidationFence !== input.expectedFence
    ) {
      return null
    }
    const candidate = input.candidate
    if (input.unapplied !== (candidate !== null)) {
      fail('class_review_candidate_conflict')
    }
    if (
      candidate
      && (
        candidate.generationId !== record.generationId
        || candidate.invalidationEpoch !== record.invalidationFence
        || candidate.executionIdentity !== record.executionIdentity
        || candidate.payloadDigest !== record.payloadDigest
      )
    ) {
      fail('class_review_candidate_conflict')
    }
    record.state = input.unapplied ? 'succeeded_unapplied' : 'succeeded'
    record.generationRevision += 1
    record.candidate = input.unapplied && input.candidate ? structuredClone(input.candidate) : null
    record.safeFailureCode = undefined
    if (!input.unapplied) actionableByTask.delete(record.opaqueTaskScope)
    return snapshot(record)
  }

  function invalidateTaskScope(input: {
    opaqueTaskScope: string
    safeFailureCode: 'class_review_source_invalidated' | 'class_review_task_invalidated'
  }): LocalGenerationRecord | null {
    const record = mutableActionable(input.opaqueTaskScope)
    if (!record) return null
    record.state = 'invalidated'
    record.safeFailureCode = input.safeFailureCode
    record.generationRevision += 1
    record.invalidationFence += 1
    record.candidate = null
    actionableByTask.delete(input.opaqueTaskScope)
    return snapshot(record)
  }

  function requeueConfirmedZero(input: {
    generationId: string
    expectedRevision: number
    executionIdentity: string
    payloadHash: string
    localCallSettled: true
  }): LocalGenerationRecord {
    const record = requireRecord(input.generationId, input.expectedRevision, 'running')
    if (record.executionIdentity !== input.executionIdentity || record.payloadDigest !== input.payloadHash) fail('execution_identity_conflict')
    if (record.boundedRequeueCount >= 1) fail('requeue_exhausted')
    record.state = 'queued'
    record.generationRevision += 1
    record.boundedRequeueCount += 1
    record.safeFailureCode = undefined
    return snapshot(record)
  }

  function applyCandidate(input: {
    opaqueTaskScope: string
    generationId: string
    expectedRevision: number
  }): { record: LocalGenerationRecord; candidate: GeneratedClassReviewPayload } {
    const record = mutable(input.generationId)
    if (
      !record
      || record.opaqueTaskScope !== input.opaqueTaskScope
      || record.state !== 'succeeded_unapplied'
      || record.generationRevision !== input.expectedRevision
      || record.candidate === null
    ) {
      fail('class_review_candidate_conflict')
    }
    const candidate = structuredClone(record.candidate)
    record.candidate = null
    record.state = 'succeeded'
    record.generationRevision += 1
    actionableByTask.delete(record.opaqueTaskScope)
    return frozenValue({ record: snapshot(record), candidate })
  }

  function discardCandidate(input: { opaqueTaskScope: string; generationId: string; expectedRevision: number }): LocalGenerationRecord {
    const record = mutable(input.generationId)
    if (
      !record
      || record.opaqueTaskScope !== input.opaqueTaskScope
      || record.state !== 'succeeded_unapplied'
      || record.generationRevision !== input.expectedRevision
    ) {
      fail('class_review_candidate_conflict')
    }
    record.candidate = null
    record.state = 'discarded'
    record.generationRevision += 1
    actionableByTask.delete(record.opaqueTaskScope)
    return snapshot(record)
  }

  return {
    reserveOrAttach,
    readGeneration,
    readActionable,
    markRunning,
    markResultUnknown,
    markFailed,
    commitSucceeded,
    invalidateTaskScope,
    requeueConfirmedZero,
    applyCandidate,
    discardCandidate,
  }
}
