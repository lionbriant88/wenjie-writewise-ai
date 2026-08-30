import { createLocalClassReviewRegistry, type LocalGenerationRecord } from './classReviewRegistry'
import { parseClassReviewReport } from './classReviewContracts'
import { cloneAndFreezeClassReviewGenerationSnapshot, materializeClassReviewCandidate, type GenerationSnapshot } from './classReviewMerge'
import type { ClassReviewProjectionResult } from './classReviewProjection'
import { createInMemoryTopicKeyRegistry, type TopicHmac, type TopicHmacDomain } from './classReviewTopicKey'
import { parseClassReviewSynthesisResult } from './synthesisContracts'
import type { ClassReviewReportV1, ClassReviewSynthesisRequestV1 } from './types'
import type { ClassReviewSynthesisClient } from './fakeClassReviewSynthesisClient'
export type { ClassReviewSynthesisClient } from './fakeClassReviewSynthesisClient'

type ReadyProjection = Extract<ClassReviewProjectionResult, { status: 'ready' }>
interface Workspace {
  taskKey: string
  taskRevision: number
  rubricRevisionDigest: string
  report: ClassReviewReportV1
  projection: ReadyProjection
  opaqueTaskScope: string | null
  lastGenerationId: string | null
  snapshot: Readonly<GenerationSnapshot> | null
  request: ClassReviewSynthesisRequestV1 | null
  inFlight: Promise<LocalGenerationRecord> | null
  providerSettlementKnown: boolean
  sourceRevisionEpoch: number
}

export interface LocalClassReviewCoordinator {
  registerWorkspace(input: { taskKey: string; taskRevision: number; rubricRevisionDigest: string; report: ClassReviewReportV1; projection: ReadyProjection }): void
  generate(command: { taskKey: string; generationId: string; intent: 'initial' | 'regenerate'; expectedTaskRevision: number; expectedReportRevision: number | null }): Promise<LocalGenerationRecord>
  getSnapshot(taskKey: string): { report: ClassReviewReportV1; generation: LocalGenerationRecord | null; candidate: ClassReviewReportV1 | null; requestId: string | null; boundedRequeueCount: number; providerSettlementKnown: boolean }
  applyCandidate(command: { taskKey: string; generationId: string; expectedTaskRevision: number; expectedReportRevision: number; expectedGenerationRevision: number; expectedAiTextEditRevision: number }): void
  discardCandidate(command: { taskKey: string; generationId: string; expectedGenerationRevision: number }): void
  invalidateSources(taskKey: string, code: 'class_review_source_invalidated' | 'class_review_task_invalidated'): void
  resumeQueued(taskKey: string): Promise<void>
  beginAiTextEdit(taskKey: string): void
  saveAiTextEdit(taskKey: string, text: string): void
  applyIssueCommand(taskKey: string, command: unknown): void
  syncExternalReport(taskKey: string, report: ClassReviewReportV1): void
  bumpAiTextRevision(taskKey: string): void
  noteOrdinaryResultRevisionAdvance(taskKey: string): void
}

function fail(code: string): never {
  throw new Error(code)
}
const encoder = new TextEncoder()
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
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
      const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      const prefix = encoder.encode(`${domain}\0`)
      const message = new Uint8Array(prefix.byteLength + bytes.byteLength)
      message.set(prefix)
      message.set(bytes, prefix.byteLength)
      return new Uint8Array(await crypto.subtle.sign('HMAC', key, message))
    } catch {
      return fail('class_review_crypto_unavailable')
    }
  }
  const topicHmac: TopicHmac = { registry: topicRegistry, digest: (domain: TopicHmacDomain, bytes: Uint8Array) => hmac(domain, bytes) }
  const compareCodePoints = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0

  function getWorkspace(taskKey: string): Workspace {
    const workspace = workspaces.get(taskKey)
    if (!workspace) fail('class_review_not_eligible')
    return workspace
  }
  function asDraft(report: ClassReviewReportV1): ClassReviewReportV1 {
    if (report.workspaceState !== 'none') return report
    return { ...report, workspaceState: 'draft', reportRevision: 0 }
  }
  function updateReportRevisions(report: ClassReviewReportV1, reportRevision: number, aiTextEditRevision = report.aiTextEditRevision): ClassReviewReportV1 {
    if (report.workspaceState === 'none') return report
    return { ...report, reportRevision, aiTextEditRevision }
  }
  function lastGeneration(workspace: Workspace): LocalGenerationRecord | null {
    return workspace.lastGenerationId ? registry.get(workspace.lastGenerationId) : null
  }

  function requireRequest(workspace: Workspace): ClassReviewSynthesisRequestV1 {
    if (!workspace.request) fail('class_review_generation_not_prepared')
    return workspace.request
  }

  function requireSnapshot(workspace: Workspace): Readonly<GenerationSnapshot> {
    if (!workspace.snapshot) fail('class_review_generation_not_prepared')
    return workspace.snapshot
  }

  function parseStoredCandidate(value: unknown): ClassReviewReportV1 {
    const parsed = parseClassReviewReport(value)
    if (!parsed.ok) fail('provider_invalid_response')
    return parsed.value
  }

  function buildRequest(workspace: Workspace, requestId: string): ClassReviewSynthesisRequestV1 {
    return {
      contractVersion: 'class-review-synthesis-request-v1',
      requestId,
      rubricRevisionDigest: workspace.rubricRevisionDigest,
      policyVersion: 'class-review-policy-v1',
      schemaVersion: 'kimi-class-review-output-v1',
      projectionVersion: 'class-review-projection-v1',
      budgetVersion: 'class-review-prompt-budget-v1',
      ...structuredClone(workspace.projection.projection),
      outputLimits: { maxCompletionTokens: 3072, maxVisibleCodePoints: 2200, maxJsonUtf8Bytes: 16384 },
    }
  }

  function serializeHidden(projection: ReadyProjection): string {
    const hidden = projection.hidden
    return JSON.stringify({
      dimensionAliases: [...hidden.dimensionAliases].sort(([left], [right]) => compareCodePoints(left, right)),
      selectedGroups: [...hidden.selectedGroups]
        .sort(([left], [right]) => compareCodePoints(left, right))
        .map(([alias, group]) => ({
          alias,
          atomicTopic: group.atomicTopic,
          title: group.title,
          excerpt: group.excerpt,
          essayIds: [...group.essayIds].sort(compareCodePoints),
          occurrenceCount: group.occurrenceCount,
        })),
      unprojectedMustCover: [...hidden.unprojectedMustCover].sort((left, right) => {
        const leftTopic = JSON.stringify([
          left.atomicTopic.taskScope,
          left.atomicTopic.keyVersion,
          left.atomicTopic.key,
          left.atomicTopic.fingerprintDigest,
        ])
        const rightTopic = JSON.stringify([
          right.atomicTopic.taskScope,
          right.atomicTopic.keyVersion,
          right.atomicTopic.key,
          right.atomicTopic.fingerprintDigest,
        ])
        return compareCodePoints(leftTopic, rightTopic)
      }),
    })
  }

  function cloneReadyProjection(input: ReadyProjection): ReadyProjection {
    return {
      status: 'ready',
      projection: structuredClone(input.projection),
      hidden: {
        dimensionAliases: new Map([...input.hidden.dimensionAliases].map(([key, value]) => [key, value])),
        selectedGroups: new Map([...input.hidden.selectedGroups].map(([key, value]) => [key, structuredClone(value)])),
        unprojectedMustCover: structuredClone([...input.hidden.unprojectedMustCover]),
      },
    }
  }

  async function prepareReservation(workspace: Workspace, proposedGenerationId: string, expectedReportRevision: number | null) {
    const serviceGenerationId = options.createOpaqueId()
    const requestId = options.createOpaqueId()
    const request = buildRequest(workspace, requestId)
    const canonicalRequest = { ...request, requestId: undefined }
    const fixedRevisions = JSON.stringify({
      taskRevision: workspace.taskRevision,
      reportRevision: expectedReportRevision,
      aiTextEditRevision: workspace.report.aiTextEditRevision,
      sourceRevisionEpoch: workspace.sourceRevisionEpoch,
      rubricRevisionDigest: workspace.rubricRevisionDigest,
    })
    const requestBytes = JSON.stringify(request)
    const hiddenBytes = encoder.encode(serializeHidden(workspace.projection))
    const snapshotTuple = `snapshot_v1_${bytesToHex(await hmac('class-review-snapshot-v1', hiddenBytes))}`
    const payloadBytes = encoder.encode(JSON.stringify({ fixedRevisions, snapshotTuple, request: canonicalRequest }))
    const payloadDigest = bytesToHex(await hmac('class-review-payload-v1', payloadBytes))
    const scopeDigest = bytesToHex(await hmac('class-review-task-scope-v1', encoder.encode(workspace.taskKey)))
    const opaqueTaskScope = `scope_v1_${scopeDigest}`
    const executionIdentity = `execution_v1_${bytesToHex(await hmac('class-review-execution-v1', encoder.encode(payloadDigest)))}`
    return {
      proposedGenerationId,
      serviceGenerationId,
      requestId,
      request,
      requestBytes,
      payloadDigest,
      opaqueTaskScope,
      executionIdentity,
      fixedRevisions,
      snapshotTuple,
    }
  }

  async function dispatch(workspace: Workspace, record: LocalGenerationRecord, startAiRevision: number): Promise<LocalGenerationRecord> {
    if (record.state === 'queued') registry.markRunning(record.generationId, record.generationRevision)
    const runningRevision = record.generationRevision
    const fence = record.invalidationFence
    const request = requireRequest(workspace)
    const snapshot = requireSnapshot(workspace)
    let untrusted: unknown
    try {
      untrusted = await options.synthesisClient.synthesize(request)
    } catch {
      const current = registry.get(record.generationId)
      if (current?.state === 'running' && current.invalidationFence === fence) {
        registry.markResultUnknown(record.generationId, current.generationRevision)
      }
      return registry.get(record.generationId) ?? record
    }
    workspace.providerSettlementKnown = true
    const current = registry.get(record.generationId)
    if (!current || current.state === 'invalidated' || current.generationRevision !== runningRevision || current.invalidationFence !== fence) {
      return current ?? record
    }
    const parsed = parseClassReviewSynthesisResult(untrusted, request)
    if (!parsed.ok) {
      registry.markFailed(record.generationId, current.generationRevision)
      current.safeFailureCode = 'provider_invalid_response'
      return current
    }
    const result = parsed.value
    if (result.status === 'result_unknown') {
      registry.markResultUnknown(record.generationId, current.generationRevision)
      current.safeFailureCode = 'provider_result_unknown'
      return current
    }
    if (result.status === 'failed') {
      const retryAfterMs = result.retryAfterMs
      const bounded429 = result.safeFailureCode === 'provider_rate_limited'
        && result.retryable
        && result.completionDisposition === 'confirmed_zero_completion'
        && retryAfterMs !== null
        && retryAfterMs <= 60_000
        && current.boundedRequeueCount < 1
      if (bounded429) {
        registry.requeueConfirmedZero({
          generationId: current.generationId,
          expectedRevision: current.generationRevision,
          executionIdentity: current.executionIdentity,
          payloadHash: current.payloadDigest,
          localCallSettled: true,
        })
        await new Promise<void>((resolve) => setTimeout(resolve, retryAfterMs))
        if (current.state === 'queued') return dispatch(workspace, current, startAiRevision)
        return current
      }
      registry.markFailed(current.generationId, current.generationRevision)
      current.safeFailureCode = result.safeFailureCode
      return current
    }
    try {
      const candidate = await materializeClassReviewCandidate({
        snapshot,
        untrustedResult: result,
        currentReport: workspace.report,
        topicHmac,
        createOpaqueId: options.createOpaqueId,
        now: options.now,
      })
      const unapplied = workspace.report.aiTextEditRevision !== startAiRevision
      const committed = registry.commitSucceeded({
        generationId: current.generationId,
        expectedRevision: current.generationRevision,
        expectedFence: fence,
        candidate: unapplied ? candidate.report : null,
        unapplied,
      })
      if (!committed) return registry.get(current.generationId) ?? current
      if (!unapplied) workspace.report = candidate.report
      return current
    } catch {
      registry.markFailed(current.generationId, current.generationRevision)
      current.safeFailureCode = 'provider_invalid_response'
      return current
    }
  }

  function generate(command: { taskKey: string; generationId: string; intent: 'initial' | 'regenerate'; expectedTaskRevision: number; expectedReportRevision: number | null }): Promise<LocalGenerationRecord> {
    const workspace = getWorkspace(command.taskKey)
    const active = workspace.opaqueTaskScope ? registry.getActionable(workspace.opaqueTaskScope) : null
    if (active?.state === 'succeeded_unapplied') return Promise.resolve(active)
    if (!active && (command.expectedTaskRevision !== workspace.taskRevision || command.expectedReportRevision !== workspace.report.reportRevision)) {
      return Promise.reject(new Error('active_generation_conflict'))
    }
    return (async (): Promise<LocalGenerationRecord> => {
      const prepared = await prepareReservation(workspace, command.generationId, command.expectedReportRevision)
      const record = registry.reserveOrAttach({
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
      })
      if (record.requestId !== prepared.requestId) return workspace.inFlight ?? record

      workspace.opaqueTaskScope = prepared.opaqueTaskScope
      workspace.request = prepared.request
      workspace.report = asDraft(workspace.report)
      workspace.lastGenerationId = record.generationId
      workspace.snapshot = cloneAndFreezeClassReviewGenerationSnapshot({
        originalRequest: prepared.request,
        hidden: workspace.projection.hidden,
        generationId: record.generationId,
        invalidationEpoch: record.invalidationFence,
        executionIdentity: record.executionIdentity,
        payloadDigest: record.payloadDigest,
        taskRevision: workspace.taskRevision,
        reportRevision: command.expectedReportRevision,
        aiTextEditRevision: workspace.report.aiTextEditRevision,
        sourceRevisionEpoch: workspace.sourceRevisionEpoch,
        browserStatistics: workspace.report.statistics,
      })
      workspace.providerSettlementKnown = false
      const ownerPromise = dispatch(workspace, record, workspace.report.aiTextEditRevision)
      workspace.inFlight = ownerPromise
      return ownerPromise.finally(() => {
        if (workspace.inFlight === ownerPromise) workspace.inFlight = null
      })
    })()
  }

  return {
    registerWorkspace(input) {
      workspaces.set(input.taskKey, {
        ...input,
        report: structuredClone(input.report),
        projection: cloneReadyProjection(input.projection),
        opaqueTaskScope: null,
        lastGenerationId: null,
        snapshot: null,
        request: null,
        inFlight: null,
        providerSettlementKnown: false,
        sourceRevisionEpoch: 0,
      })
    },
    generate,
    getSnapshot(taskKey) {
      const workspace = getWorkspace(taskKey)
      const generation = lastGeneration(workspace)
      const candidate = generation?.candidate === null || generation?.candidate === undefined
        ? null
        : structuredClone(parseStoredCandidate(generation.candidate))
      return {
        report: structuredClone(workspace.report),
        generation: generation ? structuredClone(generation) : null,
        candidate,
        requestId: workspace.request?.requestId ?? null,
        boundedRequeueCount: generation?.boundedRequeueCount ?? 0,
        providerSettlementKnown: workspace.providerSettlementKnown,
      }
    },
    applyCandidate(command) {
      const workspace = getWorkspace(command.taskKey)
      const record = registry.get(command.generationId)
      if (!record
        || record.state !== 'succeeded_unapplied'
        || record.candidate === null
        || workspace.taskRevision !== command.expectedTaskRevision
        || workspace.report.reportRevision !== command.expectedReportRevision
        || record.generationRevision !== command.expectedGenerationRevision
        || workspace.report.aiTextEditRevision !== command.expectedAiTextEditRevision) {
        fail('class_review_candidate_conflict')
      }
      const candidate = parseStoredCandidate(record.candidate)
      registry.applyCandidate(record.generationId, record.generationRevision)
      workspace.report = structuredClone(candidate)
    },
    discardCandidate(command) {
      getWorkspace(command.taskKey)
      const record = registry.get(command.generationId)
      if (!record || record.state !== 'succeeded_unapplied' || record.generationRevision !== command.expectedGenerationRevision) {
        fail('class_review_candidate_conflict')
      }
      registry.discardCandidate(record.generationId, record.generationRevision)
    },
    invalidateSources(taskKey, code) {
      const workspace = getWorkspace(taskKey)
      if (workspace.opaqueTaskScope) registry.invalidateTaskScope(workspace.opaqueTaskScope, code)
    },
    async resumeQueued(taskKey) {
      const workspace = getWorkspace(taskKey)
      const record = lastGeneration(workspace)
      if (record?.state === 'queued') {
        await dispatch(workspace, record, workspace.report.aiTextEditRevision)
      }
    },
    beginAiTextEdit(taskKey) {
      const record = lastGeneration(getWorkspace(taskKey))
      if (record && ['queued', 'running', 'result_unknown'].includes(record.state)) {
        fail('ai_text_edit_locked')
      }
    },
    saveAiTextEdit(taskKey, _text) {
      const workspace = getWorkspace(taskKey)
      const record = lastGeneration(workspace)
      if (record && ['queued', 'running', 'result_unknown'].includes(record.state)) {
        fail('ai_text_edit_locked')
      }
      workspace.report = updateReportRevisions(
        workspace.report,
        (workspace.report.reportRevision ?? 0) + 1,
        workspace.report.aiTextEditRevision + 1,
      )
    },
    applyIssueCommand(taskKey, _command) {
      const workspace = getWorkspace(taskKey)
      workspace.report = updateReportRevisions(workspace.report, (workspace.report.reportRevision ?? 0) + 1)
    },
    syncExternalReport(taskKey, report) {
      getWorkspace(taskKey).report = structuredClone(report)
    },
    bumpAiTextRevision(taskKey) {
      const workspace = getWorkspace(taskKey)
      workspace.report = updateReportRevisions(
        workspace.report,
        workspace.report.reportRevision ?? 0,
        workspace.report.aiTextEditRevision + 1,
      )
    },
    noteOrdinaryResultRevisionAdvance(taskKey) {
      getWorkspace(taskKey).sourceRevisionEpoch += 1
    },
  }
}
