export type LocalGenerationState = 'queued' | 'running' | 'result_unknown' | 'succeeded_unapplied' | 'failed' | 'succeeded' | 'discarded' | 'invalidated'

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
  state: LocalGenerationState
  generationRevision: number
  invalidationFence: number
  boundedRequeueCount: number
  candidate: unknown | null
  safeFailureCode?: string
}

interface SuppressedVariant {
  generationId: string
  invalidationEpoch: number
  topicKey: string
  blockId: string
  value: unknown
}
const ACTIONABLE = new Set<LocalGenerationState>(['queued', 'running', 'result_unknown', 'succeeded_unapplied'])
const TERMINAL = new Set<LocalGenerationState>(['failed', 'succeeded', 'discarded', 'invalidated'])
function fail(code: string): never {
  throw new Error(code)
}

export function createLocalClassReviewRegistry() {
  const byGeneration = new Map<string, LocalGenerationRecord>()
  const actionableByTask = new Map<string, string>()
  const suppressedByGeneration = new Map<string, Map<string, SuppressedVariant>>()
  const get = (generationId: string): LocalGenerationRecord | null => byGeneration.get(generationId) ?? null
  const getActionable = (scope: string): LocalGenerationRecord | null => {
    const id = actionableByTask.get(scope)
    return id ? get(id) : null
  }

  function reserveOrAttach(input: ReservationInput): LocalGenerationRecord {
    const active = getActionable(input.opaqueTaskScope)
    if (active) {
      if (active.state === 'succeeded_unapplied') fail('class_review_candidate_conflict')
      const same = active.snapshotTuple === input.snapshotTuple
        && active.fixedRevisions === input.fixedRevisions
        && active.payloadDigest === input.payloadDigest
      if (!same) fail('active_generation_conflict')
      return active
    }
    if (byGeneration.has(input.serviceGenerationId)) fail('active_generation_conflict')
    const record: LocalGenerationRecord = {
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
    return record
  }

  function transition(
    generationId: string,
    expectedRevision: number,
    expectedState: LocalGenerationState,
    nextState: LocalGenerationState,
  ): LocalGenerationRecord {
    const record = get(generationId)
    if (!record) fail('generation_not_found')
    if (record.generationRevision !== expectedRevision) fail('generation_revision_conflict')
    if (record.state !== expectedState || TERMINAL.has(record.state)) fail('generation_state_conflict')
    record.state = nextState
    record.generationRevision += 1
    if (!ACTIONABLE.has(nextState)) actionableByTask.delete(record.opaqueTaskScope)
    return record
  }

  function commitSucceeded(input: {
    generationId: string
    expectedRevision: number
    expectedFence: number
    candidate?: unknown
    unapplied?: boolean
  }): boolean {
    const record = get(input.generationId)
    if (!record
      || record.state !== 'running'
      || record.generationRevision !== input.expectedRevision
      || record.invalidationFence !== input.expectedFence) {
      return false
    }
    record.state = input.unapplied ? 'succeeded_unapplied' : 'succeeded'
    record.generationRevision += 1
    record.candidate = input.candidate ?? null
    if (!input.unapplied) actionableByTask.delete(record.opaqueTaskScope)
    return true
  }

  function invalidateTaskScope(scope: string, safeFailureCode: string): LocalGenerationRecord | null {
    const record = getActionable(scope)
    if (!record) return null
    record.state = 'invalidated'
    record.safeFailureCode = safeFailureCode
    record.generationRevision += 1
    record.invalidationFence += 1
    record.candidate = null
    suppressedByGeneration.delete(record.generationId)
    actionableByTask.delete(scope)
    return record
  }

  function requeueConfirmedZero(input: {
    generationId: string
    expectedRevision: number
    executionIdentity: string
    payloadHash: string
    localCallSettled: boolean
  }): LocalGenerationRecord {
    const record = get(input.generationId)
    if (!record || record.state !== 'running' || record.generationRevision !== input.expectedRevision) fail('generation_state_conflict')
    if (record.executionIdentity !== input.executionIdentity || record.payloadDigest !== input.payloadHash) fail('execution_identity_conflict')
    if (!input.localCallSettled) fail('provider_call_not_settled')
    if (record.boundedRequeueCount >= 1) fail('requeue_exhausted')
    record.state = 'queued'
    record.generationRevision += 1
    record.boundedRequeueCount += 1
    return record
  }

  function applyCandidate(generationId: string, expectedRevision: number): unknown {
    const record = get(generationId)
    if (!record || record.state !== 'succeeded_unapplied' || record.generationRevision !== expectedRevision || record.candidate === null) {
      fail('class_review_candidate_conflict')
    }
    const candidate = record.candidate
    record.candidate = null
    record.state = 'succeeded'
    record.generationRevision += 1
    actionableByTask.delete(record.opaqueTaskScope)
    return candidate
  }

  return {
    reserveOrAttach,
    get,
    getActionable,
    markRunning: (id: string, revision: number) => transition(id, revision, 'queued', 'running'),
    markSucceededUnapplied: (id: string, revision: number, candidate: unknown = null) => commitSucceeded({
      generationId: id,
      expectedRevision: revision,
      expectedFence: get(id)?.invalidationFence ?? -1,
      candidate,
      unapplied: true,
    }),
    markFailed: (id: string, revision: number, from: 'queued' | 'running' | 'result_unknown' = 'running') => transition(id, revision, from, 'failed'),
    markResultUnknown: (id: string, revision: number) => transition(id, revision, 'running', 'result_unknown'),
    commitSucceeded,
    applyCandidate,
    discardCandidate: (id: string, revision: number) => transition(id, revision, 'succeeded_unapplied', 'discarded'),
    invalidateTask: invalidateTaskScope,
    invalidateTaskScope,
    requeueConfirmedZero,
    canDispatch: (id: string) => ['queued', 'running'].includes(get(id)?.state ?? ''),
    storeSuppressedVariant(id: string, variant: SuppressedVariant) {
      let map = suppressedByGeneration.get(id)
      if (!map) {
        map = new Map()
        suppressedByGeneration.set(id, map)
      }
      map.set(variant.topicKey, variant)
    },
    getSuppressedVariant(id: string, topicKey: string, epoch: number) {
      const value = suppressedByGeneration.get(id)?.get(topicKey)
      return value?.invalidationEpoch === epoch ? value : null
    },
  }
}
