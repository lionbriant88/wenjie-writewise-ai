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

interface ProposedAliasBinding {
  readonly generationId: string
  readonly commandIdentity: string
  readonly actionableIdentity: string
  readonly executionIdentity: string
  readonly snapshotTuple: string
  readonly fixedRevisions: string
  readonly payloadDigest: string
  readonly commandCore: string
}

const RESERVATION_REQUIRED_KEYS = [
  'opaqueTaskScope',
  'proposedGenerationId',
  'serviceGenerationId',
  'requestId',
  'executionIdentity',
  'requestBytes',
  'snapshotTuple',
  'fixedRevisions',
  'payloadDigest',
  'commandIdentity',
  'actionableIdentity',
  'commandCore',
  'state',
  'generationRevision',
] as const
const RESERVATION_OPTIONAL_KEYS = ['attachmentGenerationId'] as const
const SCOPED_GENERATION_KEYS = ['opaqueTaskScope', 'generationId'] as const
const READ_PROPOSED_KEYS = ['opaqueTaskScope', 'proposedGenerationId'] as const
const REPLAY_PROPOSED_KEYS = [
  'opaqueTaskScope',
  'proposedGenerationId',
  'commandCore',
  'commandIdentity',
  'actionableIdentity',
  'executionIdentity',
  'snapshotTuple',
  'fixedRevisions',
  'payloadDigest',
] as const
const MARK_RUNNING_KEYS = [...SCOPED_GENERATION_KEYS, 'expectedRevision'] as const
const MARK_RESULT_UNKNOWN_KEYS = [...MARK_RUNNING_KEYS, 'safeFailureCode'] as const
const MARK_FAILED_KEYS = [
  ...MARK_RUNNING_KEYS,
  'expectedState',
  'safeFailureCode',
] as const
const COMMIT_SUCCEEDED_KEYS = [
  ...MARK_RUNNING_KEYS,
  'expectedFence',
  'candidate',
  'unapplied',
] as const
const INVALIDATE_SCOPE_KEYS = ['opaqueTaskScope', 'safeFailureCode'] as const
const REQUEUE_KEYS = [
  ...MARK_RUNNING_KEYS,
  'executionIdentity',
  'payloadHash',
  'localCallSettled',
] as const
const APPLY_CANDIDATE_KEYS = [...MARK_RUNNING_KEYS, 'apply'] as const
const DISCARD_CANDIDATE_KEYS = MARK_RUNNING_KEYS
const PURGE_SCOPE_KEYS = ['opaqueTaskScope'] as const
const SAFE_FAILURE_CODES = new Set<SafeFailureCode>([
  'class_review_not_eligible',
  'active_generation_conflict',
  'class_review_candidate_conflict',
  'class_review_source_invalidated',
  'class_review_task_invalidated',
  'class_review_projection_too_large',
  'class_review_prompt_too_large',
  'class_review_prompt_calibration_missing',
  'class_review_prompt_contract_drift',
  'provider_not_configured',
  'provider_request_rejected',
  'provider_auth_failed',
  'provider_balance_unavailable',
  'provider_rate_limited',
  'provider_timeout',
  'provider_result_unknown',
  'provider_unavailable',
  'provider_content_filtered',
  'provider_unexpected_tool_call',
  'provider_invalid_response',
])

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

function assertNonEmptyString(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) fail('class_review_candidate_conflict')
}

function assertRevision(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail('class_review_candidate_conflict')
}

function assertScopedInput(input: Readonly<ScopedGenerationInput>): void {
  assertNonEmptyString(input.opaqueTaskScope)
  assertNonEmptyString(input.generationId)
}

function assertSafeFailureCode(value: unknown): asserts value is SafeFailureCode {
  if (!SAFE_FAILURE_CODES.has(value as SafeFailureCode)) fail('class_review_candidate_conflict')
}

export function createLocalClassReviewRegistry() {
  const recordsByScope = new Map<string, Map<string, MutableGenerationRecord>>()
  const proposedAliasesByScope = new Map<string, Map<string, ProposedAliasBinding>>()
  const actionableByScope = new Map<string, string>()
  const candidateByRecord = new WeakMap<MutableGenerationRecord, MaterializedClassReviewCandidateHandle>()
  const purgedTaskScopes = new Set<string>()
  let captureInProgress = false
  let captureReentryDetected = false
  let applyCallbackInProgress = false
  let applyCallbackReentryDetected = false

  const captureExact = <T>(
    source: unknown,
    requiredKeys: readonly string[],
    optionalKeys: readonly string[] = [],
  ): Readonly<T> => {
    if (applyCallbackInProgress) {
      applyCallbackReentryDetected = true
      fail('class_review_candidate_conflict')
    }
    if (captureInProgress) {
      captureReentryDetected = true
      fail('class_review_candidate_conflict')
    }
    captureInProgress = true
    captureReentryDetected = false
    try {
      if (source === null || typeof source !== 'object') fail('class_review_candidate_conflict')
      const allowed = new Set([...requiredKeys, ...optionalKeys])
      const keys = Reflect.ownKeys(source)
      if (keys.length < requiredKeys.length || keys.length > allowed.size) {
        fail('class_review_candidate_conflict')
      }
      const captured = Object.create(null) as Record<string, unknown>
      for (const key of keys) {
        if (typeof key !== 'string' || !allowed.has(key)) fail('class_review_candidate_conflict')
        const descriptor = Reflect.getOwnPropertyDescriptor(source, key)
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          fail('class_review_candidate_conflict')
        }
        captured[key] = descriptor.value
      }
      for (const key of requiredKeys) {
        if (!Object.prototype.hasOwnProperty.call(captured, key)) fail('class_review_candidate_conflict')
      }
      if (captureReentryDetected) fail('class_review_candidate_conflict')
      return Object.freeze(captured) as Readonly<T>
    } catch {
      fail('class_review_candidate_conflict')
    } finally {
      captureInProgress = false
      captureReentryDetected = false
    }
  }

  const assertTaskNotPurged = (scope: string): void => {
    if (purgedTaskScopes.has(scope)) fail('class_review_task_invalidated')
  }

  const aliasBinding = (
    input: Readonly<ReservationInput>,
    generationId: string,
  ): ProposedAliasBinding => Object.freeze({
    generationId,
    commandIdentity: input.commandIdentity,
    actionableIdentity: input.actionableIdentity,
    executionIdentity: input.executionIdentity,
    snapshotTuple: input.snapshotTuple,
    fixedRevisions: input.fixedRevisions,
    payloadDigest: input.payloadDigest,
    commandCore: input.commandCore,
  })

  const aliasMatches = (
    alias: ProposedAliasBinding,
    input: Readonly<ReservationInput> | Readonly<{
      commandIdentity: string
      actionableIdentity: string
      executionIdentity: string
      snapshotTuple: string
      fixedRevisions: string
      payloadDigest: string
      commandCore: string
    }>,
  ): boolean => alias.commandIdentity === input.commandIdentity
    && alias.actionableIdentity === input.actionableIdentity
    && alias.executionIdentity === input.executionIdentity
    && alias.snapshotTuple === input.snapshotTuple
    && alias.fixedRevisions === input.fixedRevisions
    && alias.payloadDigest === input.payloadDigest
    && alias.commandCore === input.commandCore

  const ownerIdentityMatches = (
    record: MutableGenerationRecord,
    input: Readonly<ReservationInput>,
  ): boolean => record.actionableIdentity === input.actionableIdentity
    && record.executionIdentity === input.executionIdentity
    && record.snapshotTuple === input.snapshotTuple
    && record.fixedRevisions === input.fixedRevisions
    && record.payloadDigest === input.payloadDigest

  const scopedRecords = (scope: string, create = false): Map<string, MutableGenerationRecord> | null => {
    const existing = recordsByScope.get(scope)
    if (existing || !create) return existing ?? null
    const created = new Map<string, MutableGenerationRecord>()
    recordsByScope.set(scope, created)
    return created
  }
  const scopedAliases = (scope: string, create = false): Map<string, ProposedAliasBinding> | null => {
    const existing = proposedAliasesByScope.get(scope)
    if (existing || !create) return existing ?? null
    const created = new Map<string, ProposedAliasBinding>()
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
    const command = captureExact<ScopedGenerationInput>(input, SCOPED_GENERATION_KEYS)
    assertScopedInput(command)
    if (purgedTaskScopes.has(command.opaqueTaskScope)) return null
    const record = mutable(command)
    return record ? snapshot(record) : null
  }
  const readProposed = (input: { opaqueTaskScope: string; proposedGenerationId: string }): LocalGenerationRecord | null => {
    const command = captureExact<{ opaqueTaskScope: string; proposedGenerationId: string }>(
      input,
      READ_PROPOSED_KEYS,
    )
    assertNonEmptyString(command.opaqueTaskScope)
    assertNonEmptyString(command.proposedGenerationId)
    if (purgedTaskScopes.has(command.opaqueTaskScope)) return null
    const alias = scopedAliases(command.opaqueTaskScope)?.get(command.proposedGenerationId)
    if (!alias) return null
    const record = mutable({ opaqueTaskScope: command.opaqueTaskScope, generationId: alias.generationId })
    return record ? snapshot(record) : null
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
    const command = captureExact<typeof input>(input, REPLAY_PROPOSED_KEYS)
    assertNonEmptyString(command.opaqueTaskScope)
    assertNonEmptyString(command.proposedGenerationId)
    assertNonEmptyString(command.commandCore)
    assertNonEmptyString(command.commandIdentity)
    assertNonEmptyString(command.actionableIdentity)
    assertNonEmptyString(command.executionIdentity)
    assertNonEmptyString(command.snapshotTuple)
    assertNonEmptyString(command.fixedRevisions)
    assertNonEmptyString(command.payloadDigest)
    if (purgedTaskScopes.has(command.opaqueTaskScope)) return null
    const alias = scopedAliases(command.opaqueTaskScope)?.get(command.proposedGenerationId)
    if (!alias) return null
    const record = mutable({ opaqueTaskScope: command.opaqueTaskScope, generationId: alias.generationId })
    if (!record) fail('generation_not_found')
    if (!aliasMatches(alias, command)
      || record.actionableIdentity !== command.actionableIdentity
      || record.executionIdentity !== command.executionIdentity
      || record.snapshotTuple !== command.snapshotTuple
      || record.fixedRevisions !== command.fixedRevisions
      || record.payloadDigest !== command.payloadDigest) {
      fail('active_generation_conflict')
    }
    return snapshot(record)
  }
  const readActionable = (opaqueTaskScope: string): LocalGenerationRecord | null => {
    assertNonEmptyString(opaqueTaskScope)
    if (purgedTaskScopes.has(opaqueTaskScope)) return null
    const record = mutableActionable(opaqueTaskScope)
    return record ? snapshot(record) : null
  }

  function reserveOrAttach(input: ReservationInput): ReservationResult {
    const command = captureExact<ReservationInput>(
      input,
      RESERVATION_REQUIRED_KEYS,
      RESERVATION_OPTIONAL_KEYS,
    )
    assertNonEmptyString(command.opaqueTaskScope)
    assertNonEmptyString(command.proposedGenerationId)
    assertNonEmptyString(command.serviceGenerationId)
    assertNonEmptyString(command.requestId)
    assertNonEmptyString(command.executionIdentity)
    assertNonEmptyString(command.requestBytes)
    assertNonEmptyString(command.snapshotTuple)
    assertNonEmptyString(command.fixedRevisions)
    assertNonEmptyString(command.payloadDigest)
    assertNonEmptyString(command.commandIdentity)
    assertNonEmptyString(command.actionableIdentity)
    assertNonEmptyString(command.commandCore)
    if (command.state !== 'queued' && command.state !== 'running') fail('class_review_candidate_conflict')
    if (command.generationRevision !== 0) fail('class_review_candidate_conflict')
    if (Object.prototype.hasOwnProperty.call(command, 'attachmentGenerationId')) {
      assertNonEmptyString(command.attachmentGenerationId)
    }
    assertTaskNotPurged(command.opaqueTaskScope)
    const aliases = scopedAliases(command.opaqueTaskScope, true)!
    const proposedOwner = aliases.get(command.proposedGenerationId)
    if (proposedOwner) {
      if (!aliasMatches(proposedOwner, command)) fail('active_generation_conflict')
      const record = mutable({ opaqueTaskScope: command.opaqueTaskScope, generationId: proposedOwner.generationId })
      if (!record) fail('generation_not_found')
      if (!ownerIdentityMatches(record, command)) fail('active_generation_conflict')
      return frozenValue({ kind: 'attached' as const, record: snapshot(record) })
    }
    const active = mutableActionable(command.opaqueTaskScope)
    if (active) {
      const sameIdentity = ownerIdentityMatches(active, command)
      if (!sameIdentity) {
        if (active.state === 'succeeded_unapplied') fail('class_review_candidate_conflict')
        fail('active_generation_conflict')
      }
      aliases.set(command.proposedGenerationId, aliasBinding(command, active.generationId))
      return frozenValue({ kind: 'attached' as const, record: snapshot(active) })
    }
    if (command.attachmentGenerationId) {
      const prior = mutable({
        opaqueTaskScope: command.opaqueTaskScope,
        generationId: command.attachmentGenerationId,
      })
      const samePriorIdentity = prior !== null
        && ownerIdentityMatches(prior, command)
      if (samePriorIdentity) {
        aliases.set(command.proposedGenerationId, aliasBinding(command, prior.generationId))
        return frozenValue({ kind: 'attached' as const, record: snapshot(prior) })
      }
      if (prior !== null) fail('active_generation_conflict')
    }
    const records = scopedRecords(command.opaqueTaskScope, true)!
    if (records.has(command.serviceGenerationId)) fail('active_generation_conflict')
    const record: MutableGenerationRecord = {
      opaqueTaskScope: command.opaqueTaskScope,
      generationId: command.serviceGenerationId,
      requestId: command.requestId,
      executionIdentity: command.executionIdentity,
      requestBytes: command.requestBytes,
      snapshotTuple: command.snapshotTuple,
      fixedRevisions: command.fixedRevisions,
      payloadDigest: command.payloadDigest,
      commandIdentity: command.commandIdentity,
      actionableIdentity: command.actionableIdentity,
      commandCore: command.commandCore,
      state: command.state,
      generationRevision: command.generationRevision,
      invalidationFence: 0,
      boundedRequeueCount: 0,
    }
    records.set(record.generationId, record)
    aliases.set(command.proposedGenerationId, aliasBinding(command, record.generationId))
    actionableByScope.set(record.opaqueTaskScope, record.generationId)
    return frozenValue({ kind: 'reserved' as const, record: snapshot(record) })
  }

  function requireRecord(input: ScopedGenerationInput & { expectedRevision: number }, expectedState: LocalGenerationState): MutableGenerationRecord {
    assertTaskNotPurged(input.opaqueTaskScope)
    const record = mutable(input)
    if (!record) fail('generation_not_found')
    if (record.generationRevision !== input.expectedRevision) fail('generation_revision_conflict')
    if (record.state !== expectedState) fail('generation_state_conflict')
    return record
  }
  function markRunning(input: ScopedGenerationInput & { expectedRevision: number }): LocalGenerationRecord {
    const command = captureExact<typeof input>(input, MARK_RUNNING_KEYS)
    assertScopedInput(command)
    assertRevision(command.expectedRevision)
    const record = requireRecord(command, 'queued')
    record.state = 'running'
    record.generationRevision += 1
    record.safeFailureCode = undefined
    return snapshot(record)
  }
  function markResultUnknown(input: ScopedGenerationInput & { expectedRevision: number; safeFailureCode: 'provider_result_unknown' }): LocalGenerationRecord {
    const command = captureExact<typeof input>(input, MARK_RESULT_UNKNOWN_KEYS)
    assertScopedInput(command)
    assertRevision(command.expectedRevision)
    if (command.safeFailureCode !== 'provider_result_unknown') fail('class_review_candidate_conflict')
    const record = requireRecord(command, 'running')
    record.state = 'result_unknown'
    record.generationRevision += 1
    record.safeFailureCode = command.safeFailureCode
    record.requestBytes = null
    record.requestId = null
    return snapshot(record)
  }
  function markFailed(input: ScopedGenerationInput & { expectedRevision: number; expectedState: 'queued' | 'running' | 'result_unknown'; safeFailureCode: SafeFailureCode }): LocalGenerationRecord {
    const command = captureExact<typeof input>(input, MARK_FAILED_KEYS)
    assertScopedInput(command)
    assertRevision(command.expectedRevision)
    if (command.expectedState !== 'queued' && command.expectedState !== 'running'
      && command.expectedState !== 'result_unknown') fail('class_review_candidate_conflict')
    assertSafeFailureCode(command.safeFailureCode)
    if (command.safeFailureCode === 'provider_result_unknown'
      || command.safeFailureCode === 'class_review_source_invalidated'
      || command.safeFailureCode === 'class_review_task_invalidated') fail('class_review_candidate_conflict')
    const record = requireRecord(command, command.expectedState)
    record.state = 'failed'
    record.generationRevision += 1
    record.safeFailureCode = command.safeFailureCode
    record.requestBytes = null
    record.requestId = null
    candidateByRecord.delete(record)
    actionableByScope.delete(record.opaqueTaskScope)
    return snapshot(record)
  }
  function commitSucceeded(input: ScopedGenerationInput & { expectedRevision: number; expectedFence: number; candidate: MaterializedClassReviewCandidateHandle | null; unapplied: boolean }): LocalGenerationRecord | null {
    const command = captureExact<typeof input>(input, COMMIT_SUCCEEDED_KEYS)
    assertScopedInput(command)
    assertRevision(command.expectedRevision)
    assertRevision(command.expectedFence)
    if (typeof command.unapplied !== 'boolean'
      || (command.candidate !== null && typeof command.candidate !== 'object')) {
      fail('class_review_candidate_conflict')
    }
    assertTaskNotPurged(command.opaqueTaskScope)
    const record = mutable(command)
    if (!record || record.state !== 'running' || record.generationRevision !== command.expectedRevision || record.invalidationFence !== command.expectedFence) return null
    if (command.unapplied !== (command.candidate !== null)) fail('class_review_candidate_conflict')
    if (command.candidate) {
      const metadata = getMaterializedClassReviewCandidateMetadata(command.candidate)
      if (metadata.generationId !== record.generationId || metadata.invalidationEpoch !== record.invalidationFence
        || metadata.executionIdentity !== record.executionIdentity || metadata.payloadDigest !== record.payloadDigest) fail('class_review_candidate_conflict')
      candidateByRecord.set(record, command.candidate)
    }
    record.state = command.unapplied ? 'succeeded_unapplied' : 'succeeded'
    record.generationRevision += 1
    record.safeFailureCode = undefined
    record.requestBytes = null
    record.requestId = null
    if (!command.unapplied) actionableByScope.delete(record.opaqueTaskScope)
    return snapshot(record)
  }
  function invalidateTaskScope(input: { opaqueTaskScope: string; safeFailureCode: 'class_review_source_invalidated' | 'class_review_task_invalidated' }): LocalGenerationRecord | null {
    const command = captureExact<typeof input>(input, INVALIDATE_SCOPE_KEYS)
    assertNonEmptyString(command.opaqueTaskScope)
    if (command.safeFailureCode !== 'class_review_source_invalidated'
      && command.safeFailureCode !== 'class_review_task_invalidated') fail('class_review_candidate_conflict')
    assertTaskNotPurged(command.opaqueTaskScope)
    const record = mutableActionable(command.opaqueTaskScope)
    if (!record) return null
    record.state = 'invalidated'
    record.safeFailureCode = command.safeFailureCode
    record.generationRevision += 1
    record.invalidationFence += 1
    record.requestBytes = null
    record.requestId = null
    candidateByRecord.delete(record)
    actionableByScope.delete(command.opaqueTaskScope)
    return snapshot(record)
  }
  function requeueConfirmedZero(input: ScopedGenerationInput & { expectedRevision: number; executionIdentity: string; payloadHash: string; localCallSettled: true }): LocalGenerationRecord {
    const command = captureExact<typeof input>(input, REQUEUE_KEYS)
    assertScopedInput(command)
    assertRevision(command.expectedRevision)
    assertNonEmptyString(command.executionIdentity)
    assertNonEmptyString(command.payloadHash)
    if (command.localCallSettled !== true) fail('class_review_candidate_conflict')
    const record = requireRecord(command, 'running')
    if (record.executionIdentity !== command.executionIdentity || record.payloadDigest !== command.payloadHash) fail('execution_identity_conflict')
    if (record.boundedRequeueCount >= 1) fail('requeue_exhausted')
    record.state = 'queued'
    record.generationRevision += 1
    record.boundedRequeueCount += 1
    record.safeFailureCode = undefined
    return snapshot(record)
  }
  function applyCandidate<T>(input: ScopedGenerationInput & { expectedRevision: number; apply: (handle: MaterializedClassReviewCandidateHandle) => T }): { record: LocalGenerationRecord; value: T } {
    const command = captureExact<typeof input>(input, APPLY_CANDIDATE_KEYS)
    assertScopedInput(command)
    assertRevision(command.expectedRevision)
    if (typeof command.apply !== 'function') fail('class_review_candidate_conflict')
    assertTaskNotPurged(command.opaqueTaskScope)
    const record = mutable(command)
    const handle = record ? candidateByRecord.get(record) : undefined
    if (!record || record.state !== 'succeeded_unapplied' || record.generationRevision !== command.expectedRevision || !handle) fail('class_review_candidate_conflict')
    const expectedFence = record.invalidationFence
    let value: T
    applyCallbackInProgress = true
    applyCallbackReentryDetected = false
    try {
      value = command.apply(handle)
      if (applyCallbackReentryDetected) fail('class_review_candidate_conflict')
    } finally {
      applyCallbackInProgress = false
      applyCallbackReentryDetected = false
    }
    if (mutable(command) !== record
      || record.state !== 'succeeded_unapplied'
      || record.generationRevision !== command.expectedRevision
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
    const command = captureExact<typeof input>(input, DISCARD_CANDIDATE_KEYS)
    assertScopedInput(command)
    assertRevision(command.expectedRevision)
    assertTaskNotPurged(command.opaqueTaskScope)
    const record = mutable(command)
    if (!record || record.state !== 'succeeded_unapplied' || record.generationRevision !== command.expectedRevision || !candidateByRecord.has(record)) fail('class_review_candidate_conflict')
    candidateByRecord.delete(record)
    record.state = 'discarded'
    record.requestId = null
    record.generationRevision += 1
    actionableByScope.delete(record.opaqueTaskScope)
    return snapshot(record)
  }

  function purgeTaskScope(input: { opaqueTaskScope: string }): void {
    const command = captureExact<typeof input>(input, PURGE_SCOPE_KEYS)
    assertNonEmptyString(command.opaqueTaskScope)
    purgedTaskScopes.add(command.opaqueTaskScope)
    const records = recordsByScope.get(command.opaqueTaskScope)
    if (records) {
      for (const record of records.values()) candidateByRecord.delete(record)
    }
    recordsByScope.delete(command.opaqueTaskScope)
    proposedAliasesByScope.delete(command.opaqueTaskScope)
    actionableByScope.delete(command.opaqueTaskScope)
  }

  return { reserveOrAttach, readGeneration, readProposed, replayExactProposed, readActionable, markRunning, markResultUnknown, markFailed, commitSucceeded, invalidateTaskScope, purgeTaskScope, requeueConfirmedZero, applyCandidate, discardCandidate }
}
