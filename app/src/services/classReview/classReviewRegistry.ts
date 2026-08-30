import {
  getMaterializedClassReviewCandidateMetadata,
  type MaterializedClassReviewCandidateHandle,
} from './classReviewMerge'
import type { SafeFailureCode } from './types'

export type LocalGenerationState =
  | 'queued' | 'running' | 'result_unknown' | 'succeeded_unapplied'
  | 'failed' | 'succeeded' | 'discarded' | 'invalidated'

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
  commandIdentity: string
  actionableIdentity: string
  commandCore: string
  state: 'queued' | 'running'
  generationRevision: number
  attachmentGenerationId?: string
}

export interface LocalGenerationRecord {
  readonly opaqueTaskScope: string
  readonly generationId: string
  readonly requestId: string | null
  readonly executionIdentity: string
  readonly snapshotTuple: string
  readonly fixedRevisions: string
  readonly payloadDigest: string
  readonly state: LocalGenerationState
  readonly generationRevision: number
  readonly invalidationFence: number
  readonly boundedRequeueCount: number
  readonly candidateAvailable: boolean
  readonly safeFailureCode?: SafeFailureCode
}

interface MutableGenerationRecord {
  opaqueTaskScope: string
  generationId: string
  requestId: string | null
  executionIdentity: string
  requestBytes: string | null
  snapshotTuple: string
  fixedRevisions: string
  payloadDigest: string
  commandIdentity: string
  actionableIdentity: string
  commandCore: string
  state: LocalGenerationState
  generationRevision: number
  invalidationFence: number
  boundedRequeueCount: number
  safeFailureCode?: SafeFailureCode
}

export type ReservationResult =
  | { kind: 'reserved'; record: LocalGenerationRecord }
  | { kind: 'attached'; record: LocalGenerationRecord }

interface ScopedGenerationInput {
  opaqueTaskScope: string
  generationId: string
}

function fail(code: string): never {
  throw new Error(code)
}

function deepFreeze(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
  if (Array.isArray(value)) value.forEach(deepFreeze)
  else Object.values(value).forEach(deepFreeze)
  Object.freeze(value)
}

function frozenValue<T>(value: T): T {
  deepFreeze(value)
  return value
}

export function createLocalClassReviewRegistry() {
  const recordsByScope = new Map<string, Map<string, MutableGenerationRecord>>()
  const proposedAliasesByScope = new Map<string, Map<string, {
    generationId: string
    commandIdentity: string
    commandCore: string
  }>>()
  const actionableByScope = new Map<string, string>()
  const candidateByRecord = new WeakMap<MutableGenerationRecord, MaterializedClassReviewCandidateHandle>()

  const scopedRecords = (scope: string, create = false): Map<string, MutableGenerationRecord> | null => {
    const existing = recordsByScope.get(scope)
    if (existing || !create) return existing ?? null
    const created = new Map<string, MutableGenerationRecord>()
    recordsByScope.set(scope, created)
    return created
  }
  const scopedAliases = (scope: string, create = false): Map<string, {
    generationId: string
    commandIdentity: string
    commandCore: string
  }> | null => {
    const existing = proposedAliasesByScope.get(scope)
    if (existing || !create) return existing ?? null
    const created = new Map<string, {
      generationId: string
      commandIdentity: string
      commandCore: string
    }>()
    proposedAliasesByScope.set(scope, created)
    return created
  }
  const mutable = (input: ScopedGenerationInput): MutableGenerationRecord | null =>
    scopedRecords(input.opaqueTaskScope)?.get(input.generationId) ?? null
  const mutableActionable = (scope: string): MutableGenerationRecord | null => {
    const generationId = actionableByScope.get(scope)
    return generationId ? mutable({ opaqueTaskScope: scope, generationId }) : null
  }
  const snapshot = (record: MutableGenerationRecord): LocalGenerationRecord => frozenValue({
    opaqueTaskScope: record.opaqueTaskScope,
    generationId: record.generationId,
    requestId: record.requestId,
    executionIdentity: record.executionIdentity,
    snapshotTuple: record.snapshotTuple,
    fixedRevisions: record.fixedRevisions,
    payloadDigest: record.payloadDigest,
    state: record.state,
    generationRevision: record.generationRevision,
    invalidationFence: record.invalidationFence,
    boundedRequeueCount: record.boundedRequeueCount,
    candidateAvailable: candidateByRecord.has(record),
    ...(record.safeFailureCode === undefined ? {} : { safeFailureCode: record.safeFailureCode }),
  })
  const readGeneration = (input: ScopedGenerationInput): LocalGenerationRecord | null => {
    const record = mutable(input)
    return record ? snapshot(record) : null
  }
  const readProposed = (input: { opaqueTaskScope: string; proposedGenerationId: string }): LocalGenerationRecord | null => {
    const alias = scopedAliases(input.opaqueTaskScope)?.get(input.proposedGenerationId)
    return alias ? readGeneration({ opaqueTaskScope: input.opaqueTaskScope, generationId: alias.generationId }) : null
  }
  const replayExactProposed = (input: {
    opaqueTaskScope: string
    proposedGenerationId: string
    commandCore: string
    commandIdentity: string
    actionableIdentity: string
    executionIdentity: string
    snapshotTuple: string
    fixedRevisions: string
    payloadDigest: string
  }): LocalGenerationRecord | null => {
    const alias = scopedAliases(input.opaqueTaskScope)?.get(input.proposedGenerationId)
    if (!alias) return null
    const record = mutable({ opaqueTaskScope: input.opaqueTaskScope, generationId: alias.generationId })
    if (!record) fail('generation_not_found')
    if (alias.commandCore !== input.commandCore
      || alias.commandIdentity !== input.commandIdentity
      || record.actionableIdentity !== input.actionableIdentity
      || record.executionIdentity !== input.executionIdentity
      || record.snapshotTuple !== input.snapshotTuple
      || record.fixedRevisions !== input.fixedRevisions
      || record.payloadDigest !== input.payloadDigest) {
      fail('active_generation_conflict')
    }
    return snapshot(record)
  }
  const readActionable = (opaqueTaskScope: string): LocalGenerationRecord | null => {
    const record = mutableActionable(opaqueTaskScope)
    return record ? snapshot(record) : null
  }

  function reserveOrAttach(input: ReservationInput): ReservationResult {
    const aliases = scopedAliases(input.opaqueTaskScope, true)!
    const proposedOwner = aliases.get(input.proposedGenerationId)
    if (proposedOwner) {
      if (proposedOwner.commandCore !== input.commandCore
        || proposedOwner.commandIdentity !== input.commandIdentity) fail('active_generation_conflict')
      const record = mutable({ opaqueTaskScope: input.opaqueTaskScope, generationId: proposedOwner.generationId })
      if (!record) fail('generation_not_found')
      return frozenValue({ kind: 'attached' as const, record: snapshot(record) })
    }
    const active = mutableActionable(input.opaqueTaskScope)
    if (active) {
      const sameIdentity = active.actionableIdentity === input.actionableIdentity
      if (!sameIdentity) {
        if (active.state === 'succeeded_unapplied') fail('class_review_candidate_conflict')
        fail('active_generation_conflict')
      }
      aliases.set(input.proposedGenerationId, {
        generationId: active.generationId,
        commandIdentity: input.commandIdentity,
        commandCore: input.commandCore,
      })
      return frozenValue({ kind: 'attached' as const, record: snapshot(active) })
    }
    if (input.attachmentGenerationId) {
      const prior = mutable({
        opaqueTaskScope: input.opaqueTaskScope,
        generationId: input.attachmentGenerationId,
      })
      const samePriorIdentity = prior !== null
        && prior.actionableIdentity === input.actionableIdentity
      if (samePriorIdentity) {
        aliases.set(input.proposedGenerationId, {
          generationId: prior.generationId,
          commandIdentity: input.commandIdentity,
          commandCore: input.commandCore,
        })
        return frozenValue({ kind: 'attached' as const, record: snapshot(prior) })
      }
    }
    const records = scopedRecords(input.opaqueTaskScope, true)!
    if (records.has(input.serviceGenerationId)) fail('active_generation_conflict')
    const record: MutableGenerationRecord = {
      opaqueTaskScope: input.opaqueTaskScope,
      generationId: input.serviceGenerationId,
      requestId: input.requestId,
      executionIdentity: input.executionIdentity,
      requestBytes: input.requestBytes,
      snapshotTuple: input.snapshotTuple,
      fixedRevisions: input.fixedRevisions,
      payloadDigest: input.payloadDigest,
      commandIdentity: input.commandIdentity,
      actionableIdentity: input.actionableIdentity,
      commandCore: input.commandCore,
      state: input.state,
      generationRevision: input.generationRevision,
      invalidationFence: 0,
      boundedRequeueCount: 0,
    }
    records.set(record.generationId, record)
    aliases.set(input.proposedGenerationId, {
      generationId: record.generationId,
      commandIdentity: input.commandIdentity,
      commandCore: input.commandCore,
    })
    actionableByScope.set(record.opaqueTaskScope, record.generationId)
    return frozenValue({ kind: 'reserved' as const, record: snapshot(record) })
  }

  function requireRecord(input: ScopedGenerationInput & { expectedRevision: number }, expectedState: LocalGenerationState): MutableGenerationRecord {
    const record = mutable(input)
    if (!record) fail('generation_not_found')
    if (record.generationRevision !== input.expectedRevision) fail('generation_revision_conflict')
    if (record.state !== expectedState) fail('generation_state_conflict')
    return record
  }
  function markRunning(input: ScopedGenerationInput & { expectedRevision: number }): LocalGenerationRecord {
    const record = requireRecord(input, 'queued')
    record.state = 'running'
    record.generationRevision += 1
    record.safeFailureCode = undefined
    return snapshot(record)
  }
  function markResultUnknown(input: ScopedGenerationInput & { expectedRevision: number; safeFailureCode: 'provider_result_unknown' }): LocalGenerationRecord {
    const record = requireRecord(input, 'running')
    record.state = 'result_unknown'
    record.generationRevision += 1
    record.safeFailureCode = input.safeFailureCode
    record.requestBytes = null
    record.requestId = null
    return snapshot(record)
  }
  function markFailed(input: ScopedGenerationInput & { expectedRevision: number; expectedState: 'queued' | 'running' | 'result_unknown'; safeFailureCode: SafeFailureCode }): LocalGenerationRecord {
    const record = requireRecord(input, input.expectedState)
    record.state = 'failed'
    record.generationRevision += 1
    record.safeFailureCode = input.safeFailureCode
    record.requestBytes = null
    record.requestId = null
    candidateByRecord.delete(record)
    actionableByScope.delete(record.opaqueTaskScope)
    return snapshot(record)
  }
  function commitSucceeded(input: ScopedGenerationInput & { expectedRevision: number; expectedFence: number; candidate: MaterializedClassReviewCandidateHandle | null; unapplied: boolean }): LocalGenerationRecord | null {
    const record = mutable(input)
    if (!record || record.state !== 'running' || record.generationRevision !== input.expectedRevision || record.invalidationFence !== input.expectedFence) return null
    if (input.unapplied !== (input.candidate !== null)) fail('class_review_candidate_conflict')
    if (input.candidate) {
      const metadata = getMaterializedClassReviewCandidateMetadata(input.candidate)
      if (metadata.generationId !== record.generationId || metadata.invalidationEpoch !== record.invalidationFence
        || metadata.executionIdentity !== record.executionIdentity || metadata.payloadDigest !== record.payloadDigest) fail('class_review_candidate_conflict')
      candidateByRecord.set(record, input.candidate)
    }
    record.state = input.unapplied ? 'succeeded_unapplied' : 'succeeded'
    record.generationRevision += 1
    record.safeFailureCode = undefined
    record.requestBytes = null
    record.requestId = null
    if (!input.unapplied) actionableByScope.delete(record.opaqueTaskScope)
    return snapshot(record)
  }
  function invalidateTaskScope(input: { opaqueTaskScope: string; safeFailureCode: 'class_review_source_invalidated' | 'class_review_task_invalidated' }): LocalGenerationRecord | null {
    const record = mutableActionable(input.opaqueTaskScope)
    if (!record) return null
    record.state = 'invalidated'
    record.safeFailureCode = input.safeFailureCode
    record.generationRevision += 1
    record.invalidationFence += 1
    record.requestBytes = null
    record.requestId = null
    candidateByRecord.delete(record)
    actionableByScope.delete(input.opaqueTaskScope)
    return snapshot(record)
  }
  function requeueConfirmedZero(input: ScopedGenerationInput & { expectedRevision: number; executionIdentity: string; payloadHash: string; localCallSettled: true }): LocalGenerationRecord {
    const record = requireRecord(input, 'running')
    if (record.executionIdentity !== input.executionIdentity || record.payloadDigest !== input.payloadHash) fail('execution_identity_conflict')
    if (record.boundedRequeueCount >= 1) fail('requeue_exhausted')
    record.state = 'queued'
    record.generationRevision += 1
    record.boundedRequeueCount += 1
    record.safeFailureCode = undefined
    return snapshot(record)
  }
  function applyCandidate<T>(input: ScopedGenerationInput & { expectedRevision: number; apply: (handle: MaterializedClassReviewCandidateHandle) => T }): { record: LocalGenerationRecord; value: T } {
    const record = mutable(input)
    const handle = record ? candidateByRecord.get(record) : undefined
    if (!record || record.state !== 'succeeded_unapplied' || record.generationRevision !== input.expectedRevision || !handle) fail('class_review_candidate_conflict')
    const expectedFence = record.invalidationFence
    const value = input.apply(handle)
    if (mutable(input) !== record
      || record.state !== 'succeeded_unapplied'
      || record.generationRevision !== input.expectedRevision
      || record.invalidationFence !== expectedFence
      || candidateByRecord.get(record) !== handle
      || actionableByScope.get(record.opaqueTaskScope) !== record.generationId) {
      fail('class_review_candidate_conflict')
    }
    candidateByRecord.delete(record)
    record.state = 'succeeded'
    record.requestId = null
    record.generationRevision += 1
    actionableByScope.delete(record.opaqueTaskScope)
    return frozenValue({ record: snapshot(record), value })
  }
  function discardCandidate(input: ScopedGenerationInput & { expectedRevision: number }): LocalGenerationRecord {
    const record = mutable(input)
    if (!record || record.state !== 'succeeded_unapplied' || record.generationRevision !== input.expectedRevision || !candidateByRecord.has(record)) fail('class_review_candidate_conflict')
    candidateByRecord.delete(record)
    record.state = 'discarded'
    record.requestId = null
    record.generationRevision += 1
    actionableByScope.delete(record.opaqueTaskScope)
    return snapshot(record)
  }

  return { reserveOrAttach, readGeneration, readProposed, replayExactProposed, readActionable, markRunning, markResultUnknown, markFailed, commitSucceeded, invalidateTaskScope, requeueConfirmedZero, applyCandidate, discardCandidate }
}
