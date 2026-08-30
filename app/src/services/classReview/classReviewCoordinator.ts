import { parseClassReviewReport } from './classReviewContracts'
import {
  cloneAndFreezeClassReviewGenerationSnapshot,
  applyMaterializedClassReviewCandidate,
  createInternalIssueWorkspace,
  invalidateInternalSystemVariants,
  materializeClassReviewCandidate,
  mergeInternalIssueWorkspace,
  projectInternalIssueWorkspace,
  removeTeacherEvidence,
  type GenerationSnapshot,
  type InternalIssueWorkspace,
  type TeacherEvidenceFact,
} from './classReviewMerge'
import type { ClassReviewProjectionResult } from './classReviewProjection'
import {
  createLocalClassReviewRegistry,
  type LocalGenerationRecord,
} from './classReviewRegistry'
import {
  createInMemoryTopicKeyRegistry,
  type TopicHmac,
  type TopicHmacDomain,
} from './classReviewTopicKey'
import { parseClassReviewSynthesisRequest, parseClassReviewSynthesisResult } from './synthesisContracts'
import type {
  AiSummaryV1,
  ClassReviewIssueBlockV1,
  ClassReviewReportV1,
  ClassReviewSynthesisRequestV1,
  EvidenceRefV1,
  SafeFailureCode,
  Severity,
} from './types'
import type { ClassReviewSynthesisClient } from './fakeClassReviewSynthesisClient'
export type { ClassReviewSynthesisClient } from './fakeClassReviewSynthesisClient'

type ReadyProjection = Extract<ClassReviewProjectionResult, { status: 'ready' }>

export type TeacherIssueCommand =
  | {
      kind: 'add'
      blockId: string
      topicKey: string
      title: string
      diagnosis: string
      teachingAction: string
      severity: Severity
      evidence: readonly { ref: EvidenceRefV1; essayIdentity: string; occurrenceCount: number }[]
    }
  | { kind: 'remove'; evidenceId: string }
  | { kind: 'undo' }
  | { kind: 'move'; blockId: string; toIndex: number }

interface ActiveExecution {
  opaqueTaskScope: string
  generationId: string
  request: ClassReviewSynthesisRequestV1
  snapshot: Readonly<GenerationSnapshot>
  startAiTextEditRevision: number
}

interface Workspace {
  taskKey: string
  taskRevision: number
  rubricRevisionDigest: string
  report: ClassReviewReportV1
  projection: ReadyProjection | null
  issueWorkspace: InternalIssueWorkspace
  opaqueTaskScope: string | null
  lastGenerationId: string | null
  activeExecution: ActiveExecution | null
  inFlight: Promise<LocalGenerationRecord> | null
  providerSettlementKnown: boolean
  sourceRevisionEpoch: number
  invalidationEpoch: number
  sourceReady: boolean
  taskDeleted: boolean
  undoIssueWorkspace: InternalIssueWorkspace | null
}

interface PreparedReservation {
  proposedGenerationId: string
  serviceGenerationId: string
  requestId: string
  request: ClassReviewSynthesisRequestV1
  requestBytes: string
  payloadDigest: string
  opaqueTaskScope: string
  executionIdentity: string
  fixedRevisions: string
  snapshotTuple: string
  snapshot: Readonly<GenerationSnapshot>
}

export interface LocalClassReviewCoordinator {
  registerWorkspace(input: {
    taskKey: string
    taskRevision: number
    rubricRevisionDigest: string
    report: ClassReviewReportV1
    projection: ReadyProjection
    teacherEvidenceFacts?: readonly TeacherEvidenceFact[]
  }): void
  generate(command: {
    taskKey: string
    generationId: string
    intent: 'initial' | 'regenerate'
    expectedTaskRevision: number
    expectedReportRevision: number | null
  }): Promise<LocalGenerationRecord>
  getSnapshot(taskKey: string): {
    report: ClassReviewReportV1
    generation: LocalGenerationRecord | null
    candidate: { readonly available: true; readonly generationId: string } | null
    requestId: string | null
    boundedRequeueCount: number
    providerSettlementKnown: boolean
    sourceReady: boolean
    taskDeleted: boolean
    sourceRevisionEpoch: number
  }
  applyCandidate(command: {
    taskKey: string
    generationId: string
    expectedTaskRevision: number
    expectedReportRevision: number
    expectedGenerationRevision: number
    expectedAiTextEditRevision: number
  }): void
  discardCandidate(command: { taskKey: string; generationId: string; expectedGenerationRevision: number }): void
  syncSources(command: SourceSyncCommand): void
  beginAiTextEdit(taskKey: string): void
  saveAiTextEdit(taskKey: string, summary: AiSummaryV1): void
  cancelAiTextEdit(taskKey: string): void
  applyIssueCommand(taskKey: string, command: TeacherIssueCommand): void
}

export interface ClassReviewSourceReplacement {
  taskRevision: number
  rubricRevisionDigest: string
  report: ClassReviewReportV1
  projection: ReadyProjection
}

interface SourceSyncCas {
  taskKey: string
  expectedTaskRevision: number
  expectedReportRevision: number | null
  expectedSourceRevisionEpoch: number
}

export type SourceSyncCommand =
  | (SourceSyncCas & { kind: 'ordinary_revision'; replacement: ClassReviewSourceReplacement })
  | (SourceSyncCas & {
      kind: 'source_deleted'
      removedTeacherEvidenceIds: readonly string[]
      replacement: ClassReviewSourceReplacement | null
    })
  | (SourceSyncCas & { kind: 'task_deleted' })

function fail(code: string): never {
  throw new Error(code)
}
const encoder = new TextEncoder()
const compareCodePoints = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0
const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
function checkedAdd(left: number, right: number): number {
  const value = left + right
  if (!Number.isSafeInteger(value) || value < 0) fail('class_review_candidate_conflict')
  return value
}

function frozenClone<T>(value: T): T {
  const clone = structuredClone(value)
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) return
    if (Array.isArray(item)) item.forEach(freeze)
    else Object.values(item).forEach(freeze)
    Object.freeze(item)
  }
  freeze(clone)
  return clone
}

export function createLocalClassReviewCoordinator(options: {
  synthesisClient: ClassReviewSynthesisClient
  topicKeySecret: Uint8Array
  now: () => string
  createOpaqueId: () => string
}): LocalClassReviewCoordinator {
  const secret = new Uint8Array(options.topicKeySecret)
  const workspaces = new Map<string, Workspace>()
  const registry = createLocalClassReviewRegistry()
  const topicRegistry = createInMemoryTopicKeyRegistry()

  async function hmac(domain: string, bytes: Uint8Array): Promise<Uint8Array> {
    if (secret.byteLength < 32 || !globalThis.crypto?.subtle) fail('class_review_crypto_unavailable')
    try {
      const key = await crypto.subtle.importKey(
        'raw',
        secret,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      const prefix = encoder.encode(`${domain}\0`)
      const message = new Uint8Array(prefix.byteLength + bytes.byteLength)
      message.set(prefix)
      message.set(bytes, prefix.byteLength)
      return new Uint8Array(await crypto.subtle.sign('HMAC', key, message))
    } catch {
      return fail('class_review_crypto_unavailable')
    }
  }
  const topicHmac: TopicHmac = {
    registry: topicRegistry,
    digest: (domain: TopicHmacDomain, bytes: Uint8Array) => hmac(domain, bytes),
  }

  function getWorkspace(taskKey: string): Workspace {
    const workspace = workspaces.get(taskKey)
    if (!workspace) fail('class_review_not_eligible')
    return workspace
  }

  function readWorkspaceGeneration(
    workspace: Workspace,
    generationId: string | null = workspace.lastGenerationId,
  ): LocalGenerationRecord | null {
    if (!workspace.opaqueTaskScope || !generationId) return null
    return registry.readGeneration({
      opaqueTaskScope: workspace.opaqueTaskScope,
      generationId,
    })
  }

  function cloneReadyProjection(input: ReadyProjection): ReadyProjection {
    return {
      status: 'ready',
      projection: structuredClone(input.projection),
      hidden: {
        dimensionAliases: new Map(input.hidden.dimensionAliases),
        selectedGroups: new Map([...input.hidden.selectedGroups].map(([key, value]) => [key, structuredClone(value)])),
        unprojectedMustCover: structuredClone([...input.hidden.unprojectedMustCover]),
      },
    }
  }

  function cloneInternal(workspace: InternalIssueWorkspace): InternalIssueWorkspace {
    return createInternalIssueWorkspace(workspace.visible, {
      issueOrder: workspace.visible.map((block) => block.blockId),
      teacherEvidenceFacts: [...workspace.teacherFacts.values()],
      systemEvidenceFacts: [...workspace.systemFacts.values()],
      suppressed: workspace.suppressed,
    })
  }

  function buildRequest(
    rubricRevisionDigest: string,
    projection: ReadyProjection,
    requestId: string,
  ): ClassReviewSynthesisRequestV1 {
    const candidate: unknown = {
      contractVersion: 'class-review-synthesis-request-v1',
      requestId,
      rubricRevisionDigest,
      policyVersion: 'class-review-policy-v1',
      schemaVersion: 'kimi-class-review-output-v1',
      projectionVersion: 'class-review-projection-v1',
      budgetVersion: 'class-review-prompt-budget-v1',
      ...structuredClone(projection.projection),
      outputLimits: { maxCompletionTokens: 3072, maxVisibleCodePoints: 2200, maxJsonUtf8Bytes: 16384 },
    }
    const parsed = parseClassReviewSynthesisRequest(candidate)
    if (!parsed.ok) fail('class_review_candidate_conflict')
    return parsed.value
  }

  function serializeHidden(snapshot: Readonly<GenerationSnapshot>): string {
    return JSON.stringify({
      dimensionAliases: [...snapshot.hidden.dimensionAliases].sort(([left], [right]) => compareCodePoints(left, right)),
      selectedGroups: [...snapshot.hidden.selectedGroups].sort(([left], [right]) => compareCodePoints(left, right)).map(([alias, group]) => ({
        alias,
        atomicTopic: [
          group.atomicTopic.kind,
          group.atomicTopic.keyVersion,
          group.atomicTopic.taskScope,
          group.atomicTopic.key,
          group.atomicTopic.fingerprintDigest,
        ],
        title: group.title,
        excerpt: group.excerpt,
        essayIds: [...group.essayIds].sort(compareCodePoints),
        occurrenceCount: group.occurrenceCount,
      })),
      unprojectedMustCover: [...snapshot.hidden.unprojectedMustCover].sort(
        (left, right) => compareCodePoints(
          JSON.stringify(left.atomicTopic),
          JSON.stringify(right.atomicTopic),
        ),
      ),
    })
  }

  function checkEligibility(workspace: Workspace, intent: 'initial' | 'regenerate'): void {
    if (workspace.taskDeleted) fail('class_review_task_invalidated')
    if (!workspace.sourceReady || workspace.projection === null) fail('class_review_source_invalidated')
    const initialAllowed = workspace.report.workspaceState === 'none'
      || workspace.report.workspaceState === 'draft'
      || workspace.report.workspaceState === 'ai_removed'
    const regenerateAllowed = workspace.report.workspaceState === 'ai_available'
    if ((intent === 'initial' && !initialAllowed) || (intent === 'regenerate' && !regenerateAllowed) || workspace.report.statistics.includedEssayCount < 2) {
      fail('class_review_not_eligible')
    }
  }

  async function prepareReservation(
    workspace: Workspace,
    proposedGenerationId: string,
    expectedReportRevision: number | null,
  ): Promise<PreparedReservation> {
    if (workspace.taskDeleted) fail('class_review_task_invalidated')
    if (!workspace.sourceReady || workspace.projection === null) fail('class_review_source_invalidated')
    const capturedInvalidationEpoch = workspace.invalidationEpoch
    const capturedTaskRevision = workspace.taskRevision
    const capturedRubricRevisionDigest = workspace.rubricRevisionDigest
    const capturedAiTextEditRevision = workspace.report.aiTextEditRevision
    const capturedSourceRevisionEpoch = workspace.sourceRevisionEpoch
    const capturedStatistics = structuredClone(workspace.report.statistics)
    const capturedProjection = cloneReadyProjection(workspace.projection)
    const assertSourceFence = (): void => {
      if (workspace.taskDeleted) fail('class_review_task_invalidated')
      if (!workspace.sourceReady || workspace.projection === null
        || workspace.invalidationEpoch !== capturedInvalidationEpoch) {
        fail('class_review_source_invalidated')
      }
    }
    const guardedHmac = async (domain: string, bytes: Uint8Array): Promise<Uint8Array> => {
      const digest = await hmac(domain, bytes)
      assertSourceFence()
      return digest
    }
    const serviceGenerationId = options.createOpaqueId()
    const requestId = options.createOpaqueId()
    const request = buildRequest(capturedRubricRevisionDigest, capturedProjection, requestId)
    const preliminary = cloneAndFreezeClassReviewGenerationSnapshot({
      originalRequest: request,
      hidden: capturedProjection.hidden,
      generationId: serviceGenerationId,
      invalidationEpoch: capturedInvalidationEpoch,
      executionIdentity: 'pending',
      payloadDigest: 'pending',
      taskRevision: capturedTaskRevision,
      reportRevision: expectedReportRevision,
      aiTextEditRevision: capturedAiTextEditRevision,
      sourceRevisionEpoch: capturedSourceRevisionEpoch,
      browserStatistics: capturedStatistics,
    })
    const fixedRevisions = JSON.stringify({
      taskRevision: capturedTaskRevision,
      reportRevision: expectedReportRevision,
      aiTextEditRevision: capturedAiTextEditRevision,
      sourceRevisionEpoch: capturedSourceRevisionEpoch,
      rubricRevisionDigest: capturedRubricRevisionDigest,
    })
    const serializedHidden = encoder.encode(serializeHidden(preliminary))
    const snapshotDigest = await guardedHmac('class-review-snapshot-v1', serializedHidden)
    const snapshotTuple = `snapshot_v1_${bytesToHex(snapshotDigest)}`
    const canonicalRequest = structuredClone(request) as Partial<ClassReviewSynthesisRequestV1>
    delete canonicalRequest.requestId
    const payloadBytes = encoder.encode(JSON.stringify({ fixedRevisions, snapshotTuple, request: canonicalRequest }))
    const payloadDigest = bytesToHex(await guardedHmac('class-review-payload-v1', payloadBytes))
    const taskScopeDigest = await guardedHmac(
      'class-review-task-scope-v1',
      encoder.encode(workspace.taskKey),
    )
    const opaqueTaskScope = `scope_v1_${bytesToHex(taskScopeDigest)}`
    const executionDigest = await guardedHmac(
      'class-review-execution-v1',
      encoder.encode(payloadDigest),
    )
    const executionIdentity = `execution_v1_${bytesToHex(executionDigest)}`
    const snapshot = cloneAndFreezeClassReviewGenerationSnapshot({
      ...preliminary,
      executionIdentity,
      payloadDigest,
    })
    assertSourceFence()
    return {
      proposedGenerationId,
      serviceGenerationId,
      requestId,
      request: snapshot.originalRequest,
      requestBytes: JSON.stringify(snapshot.originalRequest),
      payloadDigest,
      opaqueTaskScope,
      executionIdentity,
      fixedRevisions,
      snapshotTuple,
      snapshot,
    }
  }

  function asDraft(report: ClassReviewReportV1): ClassReviewReportV1 {
    if (report.workspaceState !== 'none') return report
    return { ...report, workspaceState: 'draft', reportRevision: 0 }
  }

  function safeFailure(error: unknown): SafeFailureCode {
    return error instanceof Error && error.message === 'provider_invalid_response' ? 'provider_invalid_response' : 'class_review_candidate_conflict'
  }

  async function dispatch(workspace: Workspace, execution: ActiveExecution): Promise<LocalGenerationRecord> {
    const scopedGeneration = {
      opaqueTaskScope: execution.opaqueTaskScope,
      generationId: execution.generationId,
    }
    let record = registry.readGeneration(scopedGeneration)
    if (!record) fail('generation_not_found')
    if (record.state === 'queued') {
      record = registry.markRunning({
        opaqueTaskScope: execution.opaqueTaskScope,
        generationId: record.generationId,
        expectedRevision: record.generationRevision,
      })
    }
    if (record.state !== 'running') return record
    const runningRevision = record.generationRevision
    const fence = record.invalidationFence
    let untrusted: unknown
    try {
      untrusted = await options.synthesisClient.synthesize(execution.request)
    } catch {
      const current = registry.readGeneration(scopedGeneration)
      if (current?.state === 'running' && current.invalidationFence === fence) {
        return registry.markResultUnknown({
          opaqueTaskScope: execution.opaqueTaskScope,
          generationId: current.generationId,
          expectedRevision: current.generationRevision,
          safeFailureCode: 'provider_result_unknown',
        })
      }
      return current ?? record
    }
    workspace.providerSettlementKnown = true
    const current = registry.readGeneration(scopedGeneration)
    if (
      !current
      || current.state === 'invalidated'
      || current.generationRevision !== runningRevision
      || current.invalidationFence !== fence
    ) {
      return current ?? record
    }
    const parsed = parseClassReviewSynthesisResult(untrusted, execution.request)
    if (!parsed.ok) {
      return registry.markFailed({
        opaqueTaskScope: execution.opaqueTaskScope,
        generationId: current.generationId,
        expectedRevision: current.generationRevision,
        expectedState: 'running',
        safeFailureCode: 'provider_invalid_response',
      })
    }
    const result = parsed.value
    if (result.status === 'result_unknown') {
      return registry.markResultUnknown({
        opaqueTaskScope: execution.opaqueTaskScope,
        generationId: current.generationId,
        expectedRevision: current.generationRevision,
        safeFailureCode: 'provider_result_unknown',
      })
    }
    if (result.status === 'failed') {
      const bounded429 = result.safeFailureCode === 'provider_rate_limited'
        && result.retryable
        && result.completionDisposition === 'confirmed_zero_completion'
        && result.retryAfterMs !== null
        && result.retryAfterMs <= 60_000
        && current.boundedRequeueCount < 1
      if (bounded429) {
        const queued = registry.requeueConfirmedZero({
          opaqueTaskScope: execution.opaqueTaskScope,
          generationId: current.generationId,
          expectedRevision: current.generationRevision,
          executionIdentity: current.executionIdentity,
          payloadHash: current.payloadDigest,
          localCallSettled: true,
        })
        await new Promise<void>((resolve) => setTimeout(resolve, result.retryAfterMs!))
        const afterDelay = registry.readGeneration(scopedGeneration)
        return afterDelay?.state === 'queued' ? dispatch(workspace, execution) : afterDelay ?? queued
      }
      return registry.markFailed({
        opaqueTaskScope: execution.opaqueTaskScope,
        generationId: current.generationId,
        expectedRevision: current.generationRevision,
        expectedState: 'running',
        safeFailureCode: result.safeFailureCode,
      })
    }
    try {
      const materialized = await materializeClassReviewCandidate({
        snapshot: execution.snapshot,
        untrustedResult: result,
        topicHmac,
        createOpaqueId: options.createOpaqueId,
        now: options.now,
      })
      const latest = registry.readGeneration(scopedGeneration)
      if (!latest || latest.state !== 'running'
        || latest.invalidationFence !== fence
        || workspace.invalidationEpoch !== execution.snapshot.invalidationEpoch
        || workspace.taskDeleted || !workspace.sourceReady) return latest ?? current
      const unapplied = workspace.report.aiTextEditRevision !== execution.startAiTextEditRevision
      const merged = unapplied ? null : applyMaterializedClassReviewCandidate({
        handle: materialized,
        currentReport: workspace.report,
        currentIssueWorkspace: workspace.issueWorkspace,
      })
      const committed = registry.commitSucceeded({
        opaqueTaskScope: execution.opaqueTaskScope,
        generationId: latest.generationId,
        expectedRevision: latest.generationRevision,
        expectedFence: fence,
        candidate: unapplied ? materialized : null,
        unapplied,
      })
      if (!committed) return registry.readGeneration(scopedGeneration) ?? latest
      if (merged) {
        workspace.report = merged.report
        workspace.issueWorkspace = merged.issueWorkspace
      }
      return committed
    } catch (error) {
      const latest = registry.readGeneration(scopedGeneration)
      if (!latest || latest.state !== 'running') return latest ?? current
      return registry.markFailed({
        opaqueTaskScope: execution.opaqueTaskScope,
        generationId: latest.generationId,
        expectedRevision: latest.generationRevision,
        expectedState: 'running',
        safeFailureCode: safeFailure(error),
      })
    }
  }

  function generate(command: {
    taskKey: string
    generationId: string
    intent: 'initial' | 'regenerate'
    expectedTaskRevision: number
    expectedReportRevision: number | null
  }): Promise<LocalGenerationRecord> {
    const workspace = getWorkspace(command.taskKey)
    if (workspace.opaqueTaskScope) {
      const replay = registry.readProposed({
        opaqueTaskScope: workspace.opaqueTaskScope,
        proposedGenerationId: command.generationId,
      })
      if (replay) return workspace.inFlight ?? Promise.resolve(replay)
    }
    if (workspace.taskDeleted) return Promise.reject(new Error('class_review_task_invalidated'))
    if (!workspace.sourceReady || workspace.projection === null) {
      return Promise.reject(new Error('class_review_source_invalidated'))
    }
    const actionable = workspace.opaqueTaskScope ? registry.readActionable(workspace.opaqueTaskScope) : null
    if (actionable?.state === 'succeeded_unapplied') return Promise.resolve(actionable)
    if (!actionable) {
      const revisionsMatch = command.expectedTaskRevision === workspace.taskRevision
        && command.expectedReportRevision === workspace.report.reportRevision
      if (!revisionsMatch) {
        return Promise.reject(new Error('active_generation_conflict'))
      }
      try {
        checkEligibility(workspace, command.intent)
      } catch (error) {
        return Promise.reject(error)
      }
    }
    return (async () => {
      const prepared = await prepareReservation(workspace, command.generationId, command.expectedReportRevision)
      const reservation = registry.reserveOrAttach({
        opaqueTaskScope: prepared.opaqueTaskScope,
        proposedGenerationId: prepared.proposedGenerationId,
        serviceGenerationId: prepared.serviceGenerationId,
        requestId: prepared.requestId,
        executionIdentity: prepared.executionIdentity,
        requestBytes: prepared.requestBytes,
        snapshotTuple: prepared.snapshotTuple,
        fixedRevisions: prepared.fixedRevisions,
        payloadDigest: prepared.payloadDigest,
        state: 'queued',
        generationRevision: 0,
        attachmentGenerationId: actionable?.generationId,
      })
      if (reservation.kind === 'attached') return workspace.inFlight ?? reservation.record
      workspace.opaqueTaskScope = prepared.opaqueTaskScope
      workspace.lastGenerationId = reservation.record.generationId
      workspace.report = asDraft(workspace.report)
      const execution: ActiveExecution = {
        opaqueTaskScope: prepared.opaqueTaskScope,
        generationId: reservation.record.generationId,
        request: prepared.request,
        snapshot: prepared.snapshot,
        startAiTextEditRevision: workspace.report.aiTextEditRevision,
      }
      workspace.activeExecution = execution
      workspace.providerSettlementKnown = false
      const owner = dispatch(workspace, execution)
      workspace.inFlight = owner
      return owner.finally(() => {
        if (workspace.inFlight === owner) workspace.inFlight = null
      })
    })()
  }

  function activeLocksAiText(workspace: Workspace): boolean {
    const record = readWorkspaceGeneration(workspace)
    return record !== null && (record.state === 'queued' || record.state === 'running' || record.state === 'result_unknown')
  }

  function syncReportIssues(workspace: Workspace): void {
    const issueBlocks = projectInternalIssueWorkspace(workspace.issueWorkspace)
    if (workspace.report.workspaceState === 'none') return
    const parsed = parseClassReviewReport({
      ...workspace.report,
      reportRevision: workspace.report.reportRevision + 1,
      issueBlocks,
      issueOrder: issueBlocks.map((block) => block.blockId),
    })
    if (!parsed.ok) fail('class_review_candidate_conflict')
    workspace.report = parsed.value
  }

  function collectCurrentSystemBlocks(
    issueWorkspace: InternalIssueWorkspace,
    pendingSuppressedBlock?: ClassReviewIssueBlockV1,
  ): ClassReviewIssueBlockV1[] {
    const byTopic = new Map<string, ClassReviewIssueBlockV1>()
    for (const block of issueWorkspace.visible) {
      if (block.origin === 'ai') byTopic.set(block.topicKey, block)
    }
    for (const variant of issueWorkspace.suppressed.values()) {
      byTopic.set(variant.block.topicKey, variant.block)
    }
    if (pendingSuppressedBlock) {
      byTopic.set(pendingSuppressedBlock.topicKey, pendingSuppressedBlock)
    }
    return [...byTopic.values()]
  }

  function addTeacherIssue(workspace: Workspace, command: Extract<TeacherIssueCommand, { kind: 'add' }>): void {
    if (
      !command.blockId
      || !command.topicKey
      || !command.title
      || !command.diagnosis
      || !command.teachingAction
      || command.evidence.length === 0
    ) {
      fail('class_review_candidate_conflict')
    }
    const evidenceIds = new Set<string>()
    const facts: TeacherEvidenceFact[] = command.evidence.map((item) => {
      const invalidEvidence = item.ref.selectionOrigin !== 'teacher_selected'
        || evidenceIds.has(item.ref.evidenceId)
        || !item.essayIdentity
        || !Number.isSafeInteger(item.occurrenceCount)
        || item.occurrenceCount < 0
      if (invalidEvidence) fail('class_review_candidate_conflict')
      evidenceIds.add(item.ref.evidenceId)
      return {
        topicKey: command.topicKey,
        evidenceId: item.ref.evidenceId,
        essayIdentity: item.essayIdentity,
        occurrenceCount: item.occurrenceCount,
        evidenceRef: structuredClone(item.ref),
      }
    })
    facts.forEach((fact) => workspace.issueWorkspace.teacherFacts.set(fact.evidenceId, fact))
    const existing = workspace.issueWorkspace.visible.find((block) => block.topicKey === command.topicKey)
    const topicFacts = [...workspace.issueWorkspace.teacherFacts.values()]
      .filter((fact) => fact.topicKey === command.topicKey)
    const teacherEssays = new Set(topicFacts.map((fact) => fact.essayIdentity))
    const teacherRefs = topicFacts.flatMap((fact) => fact.evidenceRef ? [fact.evidenceRef] : [])
    const occurrenceCount = topicFacts.reduce(
      (sum, fact) => checkedAdd(sum, fact.occurrenceCount),
      0,
    )
    const teacherBlock: ClassReviewIssueBlockV1 = {
      blockId: existing?.blockId ?? command.blockId,
      topicKey: command.topicKey,
      origin: 'teacher',
      title: command.title,
      diagnosis: command.diagnosis,
      teachingAction: command.teachingAction,
      severity: command.severity,
      teacherStudentCount: teacherEssays.size,
      systemStudentCount: 0,
      combinedStudentCount: teacherEssays.size,
      occurrenceCount,
      supportDenominator: null,
      anonymousExamples: existing?.anonymousExamples ?? [],
      evidenceRefs: teacherRefs,
    }
    if (existing) {
      workspace.issueWorkspace.visible = workspace.issueWorkspace.visible.map((block) =>
        block.blockId === existing.blockId ? teacherBlock : block,
      )
    } else {
      workspace.issueWorkspace.visible.push(teacherBlock)
    }
    if (existing?.origin === 'ai') {
      const generation = readWorkspaceGeneration(workspace)
      const systemFact = workspace.issueWorkspace.systemFacts.get(existing.topicKey)
      if (!generation || !systemFact) fail('class_review_candidate_conflict')
      workspace.issueWorkspace = mergeInternalIssueWorkspace({
        workspace: workspace.issueWorkspace,
        nextSystem: collectCurrentSystemBlocks(workspace.issueWorkspace, existing),
        generationId: generation.generationId,
        invalidationEpoch: generation.invalidationFence,
        createOpaqueId: options.createOpaqueId,
        systemEvidenceFacts: [...workspace.issueWorkspace.systemFacts.values()],
      })
    } else if (existing?.origin === 'teacher') {
      const generation = readWorkspaceGeneration(workspace)
      const systemFact = workspace.issueWorkspace.systemFacts.get(existing.topicKey)
      const suppressed = workspace.issueWorkspace.suppressed.get(existing.topicKey)
      if (generation && systemFact && suppressed) {
        workspace.issueWorkspace = mergeInternalIssueWorkspace({
          workspace: workspace.issueWorkspace,
          nextSystem: collectCurrentSystemBlocks(
            workspace.issueWorkspace,
            suppressed.block,
          ),
          generationId: generation.generationId,
          invalidationEpoch: generation.invalidationFence,
          createOpaqueId: options.createOpaqueId,
          systemEvidenceFacts: [...workspace.issueWorkspace.systemFacts.values()],
        })
      }
    }
  }

  function validateSourceReplacement(input: ClassReviewSourceReplacement): {
    taskRevision: number
    rubricRevisionDigest: string
    report: ClassReviewReportV1
    projection: ReadyProjection
  } {
    const parsed = parseClassReviewReport(input.report)
    if (!parsed.ok || parsed.value.taskRevision !== input.taskRevision) fail('class_review_candidate_conflict')
    const projection = cloneReadyProjection(input.projection)
    const request = buildRequest(input.rubricRevisionDigest, projection, 'source-sync-validation')
    cloneAndFreezeClassReviewGenerationSnapshot({
      originalRequest: request,
      hidden: projection.hidden,
      generationId: 'source-sync-validation',
      invalidationEpoch: 0,
      executionIdentity: 'source-sync-validation',
      payloadDigest: 'source-sync-validation',
      taskRevision: input.taskRevision,
      reportRevision: parsed.value.reportRevision,
      aiTextEditRevision: parsed.value.aiTextEditRevision,
      sourceRevisionEpoch: 0,
      browserStatistics: parsed.value.statistics,
    })
    return {
      taskRevision: input.taskRevision,
      rubricRevisionDigest: input.rubricRevisionDigest,
      report: structuredClone(parsed.value),
      projection,
    }
  }

  function assertSourceSyncCas(workspace: Workspace, command: SourceSyncCas): void {
    if (workspace.taskDeleted) fail('class_review_task_invalidated')
    if (workspace.taskRevision !== command.expectedTaskRevision
      || workspace.report.reportRevision !== command.expectedReportRevision
      || workspace.sourceRevisionEpoch !== command.expectedSourceRevisionEpoch) {
      fail('active_generation_conflict')
    }
  }

  function parsedReport(value: unknown): ClassReviewReportV1 {
    const parsed = parseClassReviewReport(value)
    if (!parsed.ok) fail('class_review_candidate_conflict')
    return parsed.value
  }

  function syncSources(command: SourceSyncCommand): void {
    const workspace = getWorkspace(command.taskKey)
    const validatedReplacement = command.kind === 'task_deleted' || command.replacement === null
      ? null
      : validateSourceReplacement(command.replacement)
    assertSourceSyncCas(workspace, command)

    if (command.kind === 'ordinary_revision') {
      if (!validatedReplacement) fail('class_review_candidate_conflict')
      const issueWorkspace = createInternalIssueWorkspace(validatedReplacement.report.issueBlocks, {
        issueOrder: validatedReplacement.report.issueOrder,
        teacherEvidenceFacts: [...workspace.issueWorkspace.teacherFacts.values()],
        systemEvidenceFacts: [...workspace.issueWorkspace.systemFacts.values()],
        suppressed: workspace.issueWorkspace.suppressed,
      })
      workspace.taskRevision = validatedReplacement.taskRevision
      workspace.rubricRevisionDigest = validatedReplacement.rubricRevisionDigest
      workspace.report = validatedReplacement.report
      workspace.projection = validatedReplacement.projection
      workspace.issueWorkspace = issueWorkspace
      workspace.sourceReady = true
      workspace.sourceRevisionEpoch += 1
      return
    }

    workspace.invalidationEpoch += 1
    workspace.sourceRevisionEpoch += 1
    workspace.activeExecution = null
    workspace.providerSettlementKnown = false
    if (workspace.opaqueTaskScope) {
      registry.invalidateTaskScope({
        opaqueTaskScope: workspace.opaqueTaskScope,
        safeFailureCode: command.kind === 'task_deleted'
          ? 'class_review_task_invalidated'
          : 'class_review_source_invalidated',
      })
    }
    if (command.kind === 'task_deleted') {
      workspace.taskDeleted = true
      workspace.sourceReady = false
      workspace.projection = null
      workspace.issueWorkspace = invalidateInternalSystemVariants(
        workspace.issueWorkspace,
        workspace.invalidationEpoch,
      )
      workspace.undoIssueWorkspace = null
      return
    }

    workspace.issueWorkspace = invalidateInternalSystemVariants(
      workspace.issueWorkspace,
      workspace.invalidationEpoch,
      command.removedTeacherEvidenceIds,
    )
    workspace.undoIssueWorkspace = null
    const issueBlocks = projectInternalIssueWorkspace(workspace.issueWorkspace)
    const issueOrder = issueBlocks.map((block) => block.blockId)
    if (validatedReplacement) {
      workspace.taskRevision = validatedReplacement.taskRevision
      workspace.rubricRevisionDigest = validatedReplacement.rubricRevisionDigest
      workspace.projection = validatedReplacement.projection
      workspace.sourceReady = true
      const replacementReport = validatedReplacement.report.workspaceState === 'ai_available'
        ? {
            contractVersion: 'class-review-report-v1' as const,
            workspaceState: 'ai_removed' as const,
            taskRevision: validatedReplacement.report.taskRevision,
            reportRevision: validatedReplacement.report.reportRevision + 1,
            aiTextEditRevision: validatedReplacement.report.aiTextEditRevision,
            currentGeneration: null,
            statistics: validatedReplacement.report.statistics,
            issueBlocks,
            issueOrder,
            clearSpellingItems: validatedReplacement.report.clearSpellingItems,
            selectedMaterials: validatedReplacement.report.selectedMaterials,
          }
        : {
            ...validatedReplacement.report,
            currentGeneration: null,
            issueBlocks,
            issueOrder,
          }
      workspace.report = parsedReport(replacementReport)
      return
    }

    workspace.sourceReady = false
    workspace.projection = null
    if (workspace.report.workspaceState === 'none') return
    const nextRevision = workspace.report.reportRevision + 1
    const unavailableReport = workspace.report.workspaceState === 'ai_available'
      ? {
          contractVersion: 'class-review-report-v1' as const,
          workspaceState: 'ai_removed' as const,
          taskRevision: workspace.report.taskRevision,
          reportRevision: nextRevision,
          aiTextEditRevision: workspace.report.aiTextEditRevision,
          currentGeneration: null,
          statistics: workspace.report.statistics,
          issueBlocks,
          issueOrder,
          clearSpellingItems: workspace.report.clearSpellingItems,
          selectedMaterials: workspace.report.selectedMaterials,
        }
      : { ...workspace.report, currentGeneration: null, reportRevision: nextRevision, issueBlocks, issueOrder }
    workspace.report = parsedReport(unavailableReport)
  }

  return {
    registerWorkspace(input) {
      if (workspaces.has(input.taskKey)) fail('class_review_workspace_already_registered')
      const parsed = parseClassReviewReport(input.report)
      if (!parsed.ok) fail('class_review_candidate_conflict')
      const report = structuredClone(parsed.value)
      workspaces.set(input.taskKey, {
        taskKey: input.taskKey,
        taskRevision: input.taskRevision,
        rubricRevisionDigest: input.rubricRevisionDigest,
        report,
        projection: cloneReadyProjection(input.projection),
        issueWorkspace: createInternalIssueWorkspace(report.issueBlocks, {
          issueOrder: report.issueOrder,
          teacherEvidenceFacts: input.teacherEvidenceFacts,
        }),
        opaqueTaskScope: null,
        lastGenerationId: null,
        activeExecution: null,
        inFlight: null,
        providerSettlementKnown: false,
        sourceRevisionEpoch: 0,
        invalidationEpoch: 0,
        sourceReady: true,
        taskDeleted: false,
        undoIssueWorkspace: null,
      })
    },
    generate,
    getSnapshot(taskKey) {
      const workspace = getWorkspace(taskKey)
      const generation = readWorkspaceGeneration(workspace)
      return frozenClone({
        report: workspace.report,
        generation,
        candidate: generation?.candidateAvailable
          ? { available: true as const, generationId: generation.generationId }
          : null,
        requestId: workspace.activeExecution?.request.requestId ?? null,
        boundedRequeueCount: generation?.boundedRequeueCount ?? 0,
        providerSettlementKnown: workspace.providerSettlementKnown,
        sourceReady: workspace.sourceReady,
        taskDeleted: workspace.taskDeleted,
        sourceRevisionEpoch: workspace.sourceRevisionEpoch,
      })
    },
    applyCandidate(command) {
      const workspace = getWorkspace(command.taskKey)
      const opaqueTaskScope = workspace.opaqueTaskScope
      const record = opaqueTaskScope ? registry.readGeneration({
        opaqueTaskScope,
        generationId: command.generationId,
      }) : null
      const candidateApplies = opaqueTaskScope !== null && record !== null
        && record.state === 'succeeded_unapplied'
        && record.candidateAvailable
        && workspace.taskRevision === command.expectedTaskRevision
        && workspace.report.reportRevision === command.expectedReportRevision
        && record.generationRevision === command.expectedGenerationRevision
        && workspace.report.aiTextEditRevision === command.expectedAiTextEditRevision
      if (!candidateApplies) fail('class_review_candidate_conflict')
      const applied = registry.applyCandidate({
        opaqueTaskScope,
        generationId: record.generationId,
        expectedRevision: record.generationRevision,
        apply: (handle) => applyMaterializedClassReviewCandidate({
          handle,
          currentReport: workspace.report,
          currentIssueWorkspace: workspace.issueWorkspace,
        }),
      })
      workspace.report = applied.value.report
      workspace.issueWorkspace = applied.value.issueWorkspace
    },
    discardCandidate(command) {
      const workspace = getWorkspace(command.taskKey)
      if (!workspace.opaqueTaskScope) fail('class_review_candidate_conflict')
      registry.discardCandidate({
        opaqueTaskScope: workspace.opaqueTaskScope,
        generationId: command.generationId,
        expectedRevision: command.expectedGenerationRevision,
      })
    },
    syncSources(command) {
      syncSources(command)
    },
    beginAiTextEdit(taskKey) {
      if (activeLocksAiText(getWorkspace(taskKey))) fail('ai_text_edit_locked')
    },
    saveAiTextEdit(taskKey, summary) {
      const workspace = getWorkspace(taskKey)
      if (activeLocksAiText(workspace)) fail('ai_text_edit_locked')
      if (workspace.report.workspaceState !== 'ai_available') fail('class_review_candidate_conflict')
      const candidate = {
        ...workspace.report,
        reportRevision: workspace.report.reportRevision + 1,
        aiTextEditRevision: workspace.report.aiTextEditRevision + 1,
        aiSummary: structuredClone(summary),
      }
      const parsed = parseClassReviewReport(candidate)
      if (!parsed.ok) fail('class_review_candidate_conflict')
      workspace.report = parsed.value
    },
    cancelAiTextEdit(taskKey) {
      getWorkspace(taskKey)
    },
    applyIssueCommand(taskKey, command) {
      const workspace = getWorkspace(taskKey)
      if (workspace.report.workspaceState === 'none') fail('class_review_candidate_conflict')
      const priorReport = workspace.report
      const priorIssues = workspace.issueWorkspace
      const priorUndo = workspace.undoIssueWorkspace
      workspace.issueWorkspace = cloneInternal(priorIssues)
      try {
        if (command.kind === 'add') {
          addTeacherIssue(workspace, command)
        } else if (command.kind === 'remove') {
          if (!workspace.issueWorkspace.teacherFacts.has(command.evidenceId)) {
            fail('class_review_candidate_conflict')
          }
          workspace.undoIssueWorkspace = cloneInternal(workspace.issueWorkspace)
      const generation = readWorkspaceGeneration(workspace)
          workspace.issueWorkspace = removeTeacherEvidence(
            workspace.issueWorkspace,
            command.evidenceId,
            generation
              ? {
                  generationId: generation.generationId,
                  invalidationEpoch: generation.invalidationFence,
                }
              : undefined,
          )
        } else if (command.kind === 'undo') {
          if (!workspace.undoIssueWorkspace) fail('class_review_candidate_conflict')
          workspace.issueWorkspace = cloneInternal(workspace.undoIssueWorkspace)
          workspace.undoIssueWorkspace = null
        } else {
          const invalidIndex = !Number.isSafeInteger(command.toIndex)
            || command.toIndex < 0
            || command.toIndex >= workspace.issueWorkspace.visible.length
          if (invalidIndex) fail('class_review_candidate_conflict')
          const index = workspace.issueWorkspace.visible.findIndex((block) => block.blockId === command.blockId)
          if (index < 0) fail('class_review_candidate_conflict')
          const [block] = workspace.issueWorkspace.visible.splice(index, 1)
          workspace.issueWorkspace.visible.splice(command.toIndex, 0, block)
          const parsed = parseClassReviewReport({
            ...workspace.report,
            reportRevision: workspace.report.reportRevision + 1,
            issueOrder: workspace.issueWorkspace.visible.map((item) => item.blockId),
          })
          if (!parsed.ok) fail('class_review_candidate_conflict')
          workspace.report = parsed.value
          return
        }
        syncReportIssues(workspace)
      } catch (error) {
        workspace.report = priorReport
        workspace.issueWorkspace = priorIssues
        workspace.undoIssueWorkspace = priorUndo
        throw error
      }
    },
  }
}
