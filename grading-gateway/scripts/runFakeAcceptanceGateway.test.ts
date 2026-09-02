import { readFileSync } from 'node:fs'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FAKE_ACCEPTANCE_SCENARIOS,
  FAKE_CLASS_REVIEW_ACCEPTANCE_SCENARIOS,
  FAKE_CLASS_REVIEW_SERVICE_BEARER,
  createFakeAcceptanceGateway,
  createFakeAcceptanceGatewayFromEnvironment,
  type FakeClassReviewSemanticVariant,
  parseFakeClassReviewScenario,
  parseFakeAcceptanceScenario,
} from './runFakeAcceptanceGateway.js'
import type { GatewayExecutionTimers } from '../src/server.js'
import type { ClassReviewSynthesisRequestV1 } from '../src/classReviewSynthesis/types.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UPLOAD_UUID = '88781e92-1573-4429-9034-3670a9a518f7'
const REMOTE_CLIENT_MODULE = '../../app/src/services/grading/remoteGradingClient.ts'
const TASK_SCHEDULER_MODULE = '../../app/src/services/grading/taskGradingScheduler.ts'
const CLASS_REVIEW_MERGE_MODULE = '../../app/src/services/classReview/classReviewMerge.ts'
const classReviewFixture = JSON.parse(readFileSync(
  new URL('../../test-fixtures/class-review/synthesis-contracts.json', import.meta.url),
  'utf8',
)) as {
  requests: {
    pureStatistics: ClassReviewSynthesisRequestV1
    withGroups: ClassReviewSynthesisRequestV1
  }
}

interface SyntheticRemoteRequest {
  requestVersion: 'multimodal-grading-request-v2'
  requestId: string
  essayId: string
  pageIds: readonly string[]
  confirmedTranscript: string
  task: ReturnType<typeof task>
  pages: readonly []
}

interface SyntheticQueueSnapshot {
  status: string
  pauseReason?: string
  items: Record<string, { phase: string; errorCode?: string; retryable: boolean }>
}

interface GatewaySemanticGroupInput {
  groupId: string
  type: ClassReviewSynthesisRequestV1['groups'][number]['type']
  subtype: ClassReviewSynthesisRequestV1['groups'][number]['subtype']
  severity: ClassReviewSynthesisRequestV1['groups'][number]['severity']
  title: string
  mustCover: boolean
  essayIds: string[]
  occurrenceCount: number
  excerpt: ClassReviewSynthesisRequestV1['groups'][number]['excerpt']
}

interface ClassReviewMergeApi {
  cloneAndFreezeClassReviewGenerationSnapshot(input: {
    originalRequest: unknown
    hidden: unknown
    generationId: string
    invalidationEpoch: number
    executionIdentity: string
    payloadDigest: string
    taskRevision: number
    reportRevision: number | null
    aiTextEditRevision: number
    sourceRevisionEpoch: number
    browserStatistics: unknown
  }): unknown
  createInternalIssueWorkspace(blocks: readonly unknown[], options?: { issueOrder?: readonly string[] }): unknown
  materializeClassReviewCandidate(input: {
    snapshot: unknown
    untrustedResult: unknown
    currentReport: unknown
    currentIssueWorkspace: unknown
    topicHmac: unknown
    createOpaqueId: () => string
    now: () => string
  }): Promise<unknown>
  applyMaterializedClassReviewCandidate(input: {
    handle: unknown
    currentReport: unknown
    currentIssueWorkspace: unknown
  }): { report: { issueBlocks: Array<Record<string, unknown>> } }
}

function uploadedEssayId(index: number): string {
  return `task-1787796179807-uploaded-upload-${UPLOAD_UUID}-${index}`
}

function task() {
  return {
    taskId: 'task-fake-acceptance', fullScore: 15,
    materialSummary: 'Synthetic task context.', writingRequirements: ['Write a synthetic response.'], constraints: ['Use English.'],
    rubric: {
      taskName: 'Synthetic task', materialSummary: 'Synthetic task context.',
      writingRequirements: ['Write a synthetic response.'], constraints: ['Use English.'],
      dimensions: [
        { id: 'content', name: 'Content', weight: 95, description: 'Address the task.', deductionFocus: [], sourceEvidence: [] },
        { id: 'legibility', name: 'Legibility', weight: 5, description: 'Remain readable.', deductionFocus: [], sourceEvidence: [] },
      ],
      reviewWarnings: [],
    },
  }
}

function metadata(requestId: string, essayId: string, confirmedTranscript = 'Synthetic confirmed response.') {
  return {
    requestVersion: 'multimodal-grading-request-v2', requestId, essayId,
    pageIds: [], confirmedTranscript, task: task(),
  }
}

function grade(
  app: ReturnType<typeof createFakeAcceptanceGateway>['app'],
  requestId: string,
  essayId: string,
  confirmedTranscript = 'Synthetic confirmed response.',
) {
  return request(app)
    .post('/grading/grade-images')
    .field('metadata', JSON.stringify(metadata(requestId, essayId, confirmedTranscript)))
}

function synthesizeClassReview(
  app: ReturnType<typeof createFakeAcceptanceGateway>['app'],
  body: object = classReviewFixture.requests.withGroups,
  bearer = FAKE_CLASS_REVIEW_SERVICE_BEARER,
) {
  return request(app)
    .post('/grading/class-review-syntheses')
    .set('Authorization', `Bearer ${bearer}`)
    .send(body)
}

function remoteRequest(requestId: string, essayId: string): SyntheticRemoteRequest {
  return {
    ...metadata(requestId, essayId),
    requestVersion: 'multimodal-grading-request-v2',
    pages: [],
  }
}

function fetchThroughGateway(
  app: ReturnType<typeof createFakeAcceptanceGateway>['app'],
  receivedMetadata: Array<{ requestId: string; essayId: string }> = [],
): typeof fetch {
  return (async (_input: string | URL | Request, init?: RequestInit) => {
    if (!(init?.body instanceof FormData)) throw new Error('Expected synthetic multipart body.')
    const rawMetadata = init.body.get('metadata')
    if (typeof rawMetadata !== 'string') throw new Error('Expected synthetic metadata field.')
    const parsed = JSON.parse(rawMetadata) as { requestId: string; essayId: string }
    receivedMetadata.push({ requestId: parsed.requestId, essayId: parsed.essayId })
    const gatewayResponse = await request(app)
      .post('/grading/grade-images')
      .field('metadata', rawMetadata)
    const headers = new Headers()
    const retryAfter = gatewayResponse.headers['retry-after']
    if (typeof retryAfter === 'string') headers.set('Retry-After', retryAfter)
    return new Response(JSON.stringify(gatewayResponse.body), {
      status: gatewayResponse.status,
      headers,
    })
  }) as typeof fetch
}

function gradingJob(
  requestValue: SyntheticRemoteRequest,
  run: () => Promise<unknown>,
) {
  return {
    taskId: requestValue.task.taskId,
    essayId: requestValue.essayId,
    requestId: requestValue.requestId,
    sourceGeneration: 0,
    rubricGeneration: 0,
    run,
  }
}

function createGatewayWithClassReviewSemanticVariant(
  variant: FakeClassReviewSemanticVariant,
): ReturnType<typeof createFakeAcceptanceGateway> {
  return createFakeAcceptanceGateway({
    scenario: 'success',
    classReviewScenario: 'success',
    successDelayMs: 0,
    classReviewSemanticVariant: variant,
  })
}

function topicIdentity(ordinal: number) {
  const suffix = ordinal.toString(16).padStart(16, '0')
  return {
    kind: 'atomic',
    keyVersion: 'topic-key-v1',
    taskScope: `scope_v1_${'1'.repeat(32)}`,
    key: `tk1.${suffix}`,
    fingerprintDigest: `fp1.${suffix.padEnd(64, 'a')}`,
  }
}

function kept(text: string, scrubbedEvidenceKey: string) {
  return {
    status: 'kept',
    text,
    redactionVersion: 'class-review-redaction-v1',
    scrubbedEvidenceKey,
  }
}

function semanticRequest(
  groups: readonly GatewaySemanticGroupInput[],
  explicitIssueEligibleEssayCount?: number,
): ClassReviewSynthesisRequestV1 {
  const issueEligibleEssayCount = explicitIssueEligibleEssayCount ?? Math.max(
    ...groups.flatMap((group) => group.essayIds.map((essayId) => Number(essayId.replace(/\D/gu, '')))),
  )
  const projectedDistinctEssaySupportSum = groups.reduce((sum, group) => sum + group.essayIds.length, 0)
  const projectedOccurrenceSum = groups.reduce((sum, group) => sum + group.occurrenceCount, 0)
  return {
    contractVersion: 'class-review-synthesis-request-v1',
    requestId: 'gateway-semantic-request',
    rubricRevisionDigest: 'r'.repeat(43),
    policyVersion: 'class-review-policy-v1',
    schemaVersion: 'kimi-class-review-output-v1',
    projectionVersion: 'class-review-projection-v1',
    budgetVersion: 'class-review-prompt-budget-v1',
    statistics: {
      includedEssayCount: issueEligibleEssayCount,
      issueEligibleEssayCount,
      totalEssayCount: issueEligibleEssayCount,
      excludedEssayCount: 0,
      score: {
        fullScore: 15,
        averageScore: 10,
        medianScore: 10,
        lowestScore: 8,
        highestScore: 12,
      },
      scoreBands: [],
      dimensions: [],
      issueCounters: [],
    },
    groups: groups.map((group) => ({
      groupId: group.groupId,
      type: group.type,
      subtype: group.subtype,
      severity: group.severity,
      title: group.title,
      mustCover: group.mustCover,
      distinctEssaySupport: group.essayIds.length,
      occurrenceCount: group.occurrenceCount,
      excerpt: group.excerpt,
    })),
    semanticCoverage: {
      projectedGroupCount: groups.length,
      eligibleGroupCount: groups.length,
      groupCoverage: 1,
      projectedDistinctEssaySupportSum,
      eligibleDistinctEssaySupportSum: projectedDistinctEssaySupportSum,
      supportWeightedCoverage: 1,
      projectedOccurrenceSum,
      eligibleOccurrenceSum: projectedOccurrenceSum,
      occurrenceWeightedCoverage: 1,
    },
    outputLimits: { maxCompletionTokens: 3072, maxVisibleCodePoints: 2200, maxJsonUtf8Bytes: 16384 },
  }
}

function hiddenForSemanticRequest(groups: readonly GatewaySemanticGroupInput[]) {
  return {
    dimensionAliases: new Map(),
    selectedGroups: new Map(groups.map((group, index) => [group.groupId, {
      atomicTopic: topicIdentity(index + 1),
      title: kept(group.title, `title-${index + 1}`),
      excerpt: group.excerpt === null
        ? null
        : {
            originalText: kept(group.excerpt.originalText, `original-${index + 1}`),
            suggestionOrDiagnosis: kept(group.excerpt.suggestionOrDiagnosis, `suggestion-${index + 1}`),
          },
      essayIds: group.essayIds,
      occurrenceCount: group.occurrenceCount,
    }])),
    unprojectedMustCover: [],
  }
}

function browserReportForSemanticRequest(requestValue: ClassReviewSynthesisRequestV1) {
  return {
    contractVersion: 'class-review-report-v1',
    workspaceState: 'draft',
    taskRevision: 1,
    reportRevision: 1,
    aiTextEditRevision: 0,
    currentGeneration: null,
    statistics: {
      totalEssayCount: requestValue.statistics.totalEssayCount,
      includedEssayCount: requestValue.statistics.includedEssayCount,
      issueEligibleEssayCount: requestValue.statistics.issueEligibleEssayCount,
      excludedEssayCount: requestValue.statistics.excludedEssayCount,
      issueCoverageRate: 1,
      fullScore: requestValue.statistics.score.fullScore,
      scoreSummary: {
        averageScore: requestValue.statistics.score.averageScore,
        highestScore: requestValue.statistics.score.highestScore,
        lowestScore: requestValue.statistics.score.lowestScore,
      },
      scoreBands: [],
      dimensions: [],
    },
    issueBlocks: [],
    issueOrder: [],
    clearSpellingItems: [],
    selectedMaterials: [],
  }
}

function topicHmac() {
  const claims = new Map<string, string>()
  return {
    registry: {
      async claim(input: {
        taskScope: string
        kind: string
        shortenedKey: string
        fingerprintDigest: string
      }): Promise<string> {
        const key = JSON.stringify([input.taskScope, input.kind, input.shortenedKey, input.fingerprintDigest])
        if (!claims.has(key)) claims.set(key, input.shortenedKey)
        return claims.get(key)!
      },
    },
    digest: async (_domain: string, bytes: Uint8Array): Promise<Uint8Array> => {
      const out = new Uint8Array(32)
      bytes.forEach((byte, index) => {
        out[index % out.length] = (out[index % out.length] + byte + index) % 256
      })
      return out
    },
  }
}

async function materializeGatewayClassReviewResult(
  requestValue: ClassReviewSynthesisRequestV1,
  responseBody: unknown,
  groups: readonly GatewaySemanticGroupInput[],
): Promise<Array<Record<string, unknown>>> {
  const merge = await vi.importActual(CLASS_REVIEW_MERGE_MODULE) as ClassReviewMergeApi
  const currentReport = browserReportForSemanticRequest(requestValue)
  const currentIssueWorkspace = merge.createInternalIssueWorkspace([], { issueOrder: [] })
  const snapshot = merge.cloneAndFreezeClassReviewGenerationSnapshot({
    originalRequest: requestValue,
    hidden: hiddenForSemanticRequest(groups),
    generationId: 'gateway-semantic-generation',
    invalidationEpoch: 0,
    executionIdentity: 'gateway-semantic-execution',
    payloadDigest: 'gateway-semantic-payload',
    taskRevision: 1,
    reportRevision: 1,
    aiTextEditRevision: 0,
    sourceRevisionEpoch: 0,
    browserStatistics: currentReport.statistics,
  })
  const handle = await merge.materializeClassReviewCandidate({
    snapshot,
    untrustedResult: responseBody,
    currentReport,
    currentIssueWorkspace,
    topicHmac: topicHmac(),
    createOpaqueId: (() => {
      let next = 0
      return () => `gateway-semantic-block-${++next}`
    })(),
    now: () => '2026-09-02T00:00:00.000Z',
  })
  return merge.applyMaterializedClassReviewCandidate({
    handle,
    currentReport,
    currentIssueWorkspace,
  }).report.issueBlocks
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('Timed out waiting for fake acceptance state.')
}

class FakeAcceptanceClock implements GatewayExecutionTimers {
  now = 0
  #nextId = 0
  #timers = new Map<number, { at: number; callback: () => void }>()

  setTimeout(callback: () => void, delayMs: number): unknown {
    const id = ++this.#nextId
    this.#timers.set(id, { at: this.now + delayMs, callback })
    return id
  }

  clearTimeout(handle: unknown): void {
    this.#timers.delete(handle as number)
  }

  advanceBy(milliseconds: number): void {
    const target = this.now + milliseconds
    while (true) {
      const next = [...this.#timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0]
      if (!next) break
      this.#timers.delete(next[0])
      this.now = next[1].at
      next[1].callback()
    }
    this.now = target
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('scripted fake acceptance Gateway', () => {
  it('accepts exactly the five approved scenario names', () => {
    expect(FAKE_ACCEPTANCE_SCENARIOS).toEqual([
      'success', 'rate-limit', 'pause-auth', 'result-unknown', 'mixed',
    ])
    for (const scenario of FAKE_ACCEPTANCE_SCENARIOS) {
      expect(parseFakeAcceptanceScenario(scenario)).toBe(scenario)
    }
    expect(() => parseFakeAcceptanceScenario('failure')).toThrow(TypeError)
    expect(() => parseFakeAcceptanceScenario('kimi')).toThrow(TypeError)
    expect(() => parseFakeAcceptanceScenario(undefined)).toThrow(TypeError)
  })

  it('accepts exactly the approved class-review fake scenarios', () => {
    expect(FAKE_CLASS_REVIEW_ACCEPTANCE_SCENARIOS).toEqual([
      'success',
      'empty',
      'rate-limit',
      'pause-auth',
      'result-unknown',
      'invalid-schema',
    ])
    for (const scenario of FAKE_CLASS_REVIEW_ACCEPTANCE_SCENARIOS) {
      expect(parseFakeClassReviewScenario(scenario)).toBe(scenario)
    }
    expect(() => parseFakeClassReviewScenario('kimi')).toThrow(TypeError)
    expect(() => parseFakeClassReviewScenario('browser')).toThrow(TypeError)
    expect(() => parseFakeClassReviewScenario(undefined)).toThrow(TypeError)
  })

  it('exercises the class-review loopback route as server-only fake synthesis with one completion metric', async () => {
    const gateway = createFakeAcceptanceGateway({
      scenario: 'success',
      classReviewScenario: 'success',
      successDelayMs: 0,
    })

    const browserOrigin = await synthesizeClassReview(gateway.app)
      .set('Origin', 'http://127.0.0.1:5174')
      .expect(403)
    expect(browserOrigin.body).toEqual({
      error: {
        code: 'browser_origin_forbidden',
        message: 'Browser-origin requests are not allowed.',
      },
    })
    expect(browserOrigin.headers).not.toHaveProperty('access-control-allow-origin')
    expect(gateway.snapshot().classReviewProviderCalls).toBe(0)

    const missingAuth = await request(gateway.app)
      .post('/grading/class-review-syntheses')
      .send(classReviewFixture.requests.withGroups)
      .expect(401)
    expect(missingAuth.headers['www-authenticate']).toBe('Bearer')
    expect(missingAuth.body).toEqual({
      error: {
        code: 'service_auth_required',
        message: 'Internal service authentication failed.',
      },
    })

    const response = await synthesizeClassReview(gateway.app).expect(200)
    expect(response.body).toMatchObject({
      contractVersion: 'class-review-synthesis-result-v1',
      requestId: classReviewFixture.requests.withGroups.requestId,
      status: 'succeeded',
      output: {
        overallComment: 'Synthetic class-review summary.',
        patterns: [{
          groupIds: ['grammar.tense'],
          title: 'Gateway common issue',
        }],
      },
      finishReason: 'stop',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, cachedTokens: 20 },
    })
    expect(gateway.snapshot()).toMatchObject({
      providerCalls: 0,
      providerCompletions: 0,
      classReviewProviderCalls: 1,
      classReviewProviderCompletions: 1,
      telemetry: {
        uniqueAttempts: 1,
        totals: { totalTokens: { status: 'known', value: 150 } },
      },
    })
  })

  it('shares the hard provider cap between essay grading and class-review synthesis', async () => {
    const gateway = createFakeAcceptanceGateway({
      scenario: 'success',
      classReviewScenario: 'success',
      hardLimit: 1,
      successDelayMs: 1_000,
    })
    const essay = Promise.resolve(grade(gateway.app, 'request-shared-cap-essay', 'sample-shared-cap'))
    await waitFor(() => gateway.snapshot().activeProviderCalls === 1)

    const blocked = await synthesizeClassReview(gateway.app).expect(429)
    expect(blocked.body).toMatchObject({
      status: 'failed',
      safeFailureCode: 'provider_rate_limited',
      retryable: true,
      completionDisposition: 'not_started',
    })
    expect(gateway.snapshot()).toMatchObject({
      providerCalls: 1,
      classReviewProviderCalls: 0,
      maxActiveProviderCalls: 1,
    })

    await essay
  })

  it('keeps class-review Provider calls at zero for invalid and budget-rejected input', async () => {
    const invalid = createFakeAcceptanceGateway({
      scenario: 'success',
      classReviewScenario: 'success',
      successDelayMs: 0,
    })

    const callerCacheKey = await synthesizeClassReview(invalid.app, {
      ...classReviewFixture.requests.withGroups,
      promptCacheKey: 'PRIVATE-CALLER-CACHE-KEY',
    }).expect(400)
    expect(callerCacheKey.body).toEqual({
      error: { code: 'invalid_request', message: 'Class review synthesis request is invalid.' },
    })
    expect(JSON.stringify(callerCacheKey.body)).not.toMatch(/PRIVATE|CACHE|KEY/)
    expect(invalid.snapshot().classReviewProviderCalls).toBe(0)

    const budgetRejected = createFakeAcceptanceGateway({
      scenario: 'success',
      classReviewScenario: 'success',
      successDelayMs: 0,
      classReviewTokenizer: { count: () => 16_385 },
    })
    const response = await synthesizeClassReview(budgetRejected.app).expect(503)
    expect(response.body).toMatchObject({
      status: 'failed',
      safeFailureCode: 'class_review_prompt_too_large',
      completionDisposition: 'not_started',
    })
    expect(budgetRejected.snapshot().classReviewProviderCalls).toBe(0)
  })

  it('exposes class-review fake failure scenarios without leaking Provider text', async () => {
    const cases = [
      ['empty', 200, { status: 'succeeded', output: { patterns: [] } }],
      ['rate-limit', 429, {
        status: 'failed',
        safeFailureCode: 'provider_rate_limited',
        retryable: true,
        completionDisposition: 'confirmed_zero_completion',
      }],
      ['pause-auth', 503, {
        status: 'failed',
        safeFailureCode: 'provider_auth_failed',
        retryable: false,
        completionDisposition: 'confirmed_zero_completion',
      }],
      ['result-unknown', 503, {
        status: 'result_unknown',
        safeFailureCode: 'provider_result_unknown',
        completionDisposition: 'unknown',
      }],
      ['invalid-schema', 503, {
        status: 'failed',
        safeFailureCode: 'provider_invalid_response',
        retryable: false,
        completionDisposition: 'completed',
      }],
    ] as const

    for (const [classReviewScenario, status, body] of cases) {
      const gateway = createFakeAcceptanceGateway({
        scenario: 'success',
        classReviewScenario,
        successDelayMs: 0,
      })
      const response = await synthesizeClassReview(
        gateway.app,
        classReviewScenario === 'empty'
          ? classReviewFixture.requests.pureStatistics
          : classReviewFixture.requests.withGroups,
      ).expect(status)
      expect(response.body).toMatchObject(body)
      expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE|AUTH|RATE-LIMIT|INVALID-SCHEMA/)
      expect(gateway.snapshot().classReviewProviderCalls).toBe(1)
    }
  })

  it('accepts a class-review pattern that combines individually low-frequency groups above the support threshold', async () => {
    const groups: GatewaySemanticGroupInput[] = [
      {
        groupId: 'rare.structure',
        type: 'structure',
        subtype: null,
        severity: 'medium',
        title: 'Rare structure',
        mustCover: false,
        essayIds: ['e1'],
        occurrenceCount: 1,
        excerpt: null,
      },
      {
        groupId: 'rare.logic',
        type: 'logic',
        subtype: 'weak_connection',
        severity: 'medium',
        title: 'Rare logic',
        mustCover: false,
        essayIds: ['e2'],
        occurrenceCount: 1,
        excerpt: null,
      },
    ]
    const body = semanticRequest(groups)
    const gateway = createGatewayWithClassReviewSemanticVariant('combine-low-frequency')

    const response = await synthesizeClassReview(gateway.app, body).expect(200)

    expect(response.body.output.patterns).toEqual([{
      groupIds: ['rare.structure', 'rare.logic'],
      title: 'Gateway combined low-frequency issue',
      diagnosis: 'Separate rare issues become common when their hidden essay support is unioned.',
      teachingAction: 'Teach them together with one focused comparison.',
      severity: 'medium',
    }])
    const blocks = await materializeGatewayClassReviewResult(body, response.body, groups)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      origin: 'ai',
      title: 'Gateway combined low-frequency issue',
      systemStudentCount: 2,
      combinedStudentCount: 2,
      occurrenceCount: 2,
      supportDenominator: 2,
    })
    expect(gateway.snapshot()).toMatchObject({
      classReviewProviderCalls: 1,
      classReviewProviderCompletions: 1,
    })
  })

  it('drops a returned below-threshold class-review pattern while preserving omitted mustCover fallback with zero extra calls', async () => {
    const groups: GatewaySemanticGroupInput[] = [
      {
        groupId: 'rare.wording',
        type: 'word_choice',
        subtype: null,
        severity: 'low',
        title: 'Rare wording',
        mustCover: false,
        essayIds: ['e1'],
        occurrenceCount: 1,
        excerpt: null,
      },
      {
        groupId: 'must.grammar',
        type: 'grammar',
        subtype: null,
        severity: 'high',
        title: 'Must cover grammar',
        mustCover: true,
        essayIds: ['e2', 'e3'],
        occurrenceCount: 2,
        excerpt: {
          originalText: 'He go to school.',
          suggestionOrDiagnosis: 'Subject-verb agreement appears repeatedly.',
        },
      },
    ]
    const body = semanticRequest(groups, 4)
    const gateway = createGatewayWithClassReviewSemanticVariant('subthreshold-and-omitted-must-cover')

    const response = await synthesizeClassReview(gateway.app, body).expect(200)

    expect(response.body.output.patterns).toEqual([{
      groupIds: ['rare.wording'],
      title: 'Gateway below-threshold issue',
      diagnosis: 'This should be dropped by deterministic support validation.',
      teachingAction: 'This action should not survive materialization.',
      severity: 'low',
    }])
    const blocks = await materializeGatewayClassReviewResult(body, response.body, groups)
    expect(blocks).toEqual([expect.objectContaining({
      origin: 'ai',
      title: 'Must cover grammar',
      diagnosis: 'Subject-verb agreement appears repeatedly.',
      systemStudentCount: 2,
      combinedStudentCount: 2,
      occurrenceCount: 2,
      supportDenominator: 4,
    })])
    expect(blocks.some((block) => block.title === 'Gateway below-threshold issue')).toBe(false)
    expect(gateway.snapshot()).toMatchObject({
      classReviewProviderCalls: 1,
      classReviewProviderCompletions: 1,
    })
  })

  it('rejects duplicate cross-pattern class-review group ownership through the Gateway loopback route', async () => {
    const body = semanticRequest([
      {
        groupId: 'must.grammar',
        type: 'grammar',
        subtype: null,
        severity: 'high',
        title: 'Must cover grammar',
        mustCover: true,
        essayIds: ['e1', 'e2'],
        occurrenceCount: 2,
        excerpt: {
          originalText: 'He go to school.',
          suggestionOrDiagnosis: 'Subject-verb agreement appears repeatedly.',
        },
      },
      {
        groupId: 'rare.structure',
        type: 'structure',
        subtype: null,
        severity: 'low',
        title: 'Rare structure',
        mustCover: false,
        essayIds: ['e3'],
        occurrenceCount: 1,
        excerpt: null,
      },
    ])
    const gateway = createGatewayWithClassReviewSemanticVariant('duplicate-cross-pattern-ownership')

    const response = await synthesizeClassReview(gateway.app, body).expect(503)

    expect(response.body).toMatchObject({
      status: 'failed',
      safeFailureCode: 'provider_invalid_response',
      retryable: false,
      completionDisposition: 'completed',
      finishReason: 'stop',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, cachedTokens: 20 },
    })
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE|AUTH|RATE-LIMIT|INVALID-SCHEMA/)
    expect(gateway.snapshot()).toMatchObject({
      classReviewProviderCalls: 1,
      classReviewProviderCompletions: 1,
    })
  })

  it('requires result-unknown late success to settle after the orphan boundary', () => {
    expect(() => createFakeAcceptanceGateway({
      scenario: 'result-unknown', httpDeadlineMs: 10, providerFinalDeadlineMs: 20,
      settlementGraceMs: 50, lateSuccessDelayMs: 70,
    })).toThrow(TypeError)
    expect(() => createFakeAcceptanceGateway({
      scenario: 'mixed', httpDeadlineMs: 10, providerFinalDeadlineMs: 20,
      settlementGraceMs: 50, lateSuccessDelayMs: 71,
    })).not.toThrow()
  })

  it('grants browser CORS only to the exact default fake-acceptance UI origin', async () => {
    const gateway = createFakeAcceptanceGateway({ scenario: 'success', successDelayMs: 0 })
    const preflight = (origin: string) => request(gateway.app)
      .options('/grading/grade-images')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-grading-request-id')

    const allowed = await preflight('http://127.0.0.1:5174').expect(204)
    expect(allowed.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5174')
    const resumed = await request(gateway.app)
      .post('/fake-acceptance/resume')
      .set('Origin', 'http://127.0.0.1:5174')
      .expect(200, { status: 'resumed' })
    expect(resumed.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5174')
    const denied = await preflight('http://127.0.0.1:5173').expect(403)
    expect(denied.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('accepts only an exact credential-free loopback HTTP origin from fake environment configuration', async () => {
    const configured = createFakeAcceptanceGatewayFromEnvironment({
      FAKE_ACCEPTANCE_SCENARIO: 'success',
      FAKE_ALLOWED_ORIGIN: 'http://127.0.0.1:6123',
    }).gateway
    const allowed = await request(configured.app)
      .options('/grading/grade-images')
      .set('Origin', 'http://127.0.0.1:6123')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204)
    expect(allowed.headers['access-control-allow-origin']).toBe('http://127.0.0.1:6123')

    for (const unsafeOrigin of [
      '*',
      'http://localhost:5174',
      'https://127.0.0.1:5174',
      'http://example.com:5174',
      'http://user:secret@127.0.0.1:5174',
      'http://127.0.0.1:5174/path',
      'http://127.0.0.1:5174?query=1',
      'http://127.0.0.1:0',
      'http://127.0.0.1:65536',
    ]) {
      expect(() => createFakeAcceptanceGatewayFromEnvironment({
        FAKE_ACCEPTANCE_SCENARIO: 'success',
        FAKE_ALLOWED_ORIGIN: unsafeOrigin,
      })).toThrow(TypeError)
    }
  })

  it('uses the real Gateway boundary without fetch and emits legal synthetic observations', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('External network is forbidden.'))
    const gateway = createFakeAcceptanceGateway({ scenario: 'success', successDelayMs: 0 })

    const first = await grade(gateway.app, 'request-success-a', 'sample-success-a', 'First synthetic text.').expect(200)
    const second = await grade(gateway.app, 'request-success-b', 'sample-success-b', 'Completely different synthetic text.').expect(200)

    expect(first.body).toMatchObject({
      resultVersion: 'grading-result-v2', requestId: 'request-success-a', essayId: 'sample-success-a', status: 'success',
    })
    expect(second.body).toMatchObject({
      resultVersion: 'grading-result-v2', requestId: 'request-success-b', essayId: 'sample-success-b', status: 'success',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    const snapshot = gateway.snapshot()
    expect(snapshot).toMatchObject({ providerCalls: 2, providerCompletions: 2, maxActiveProviderCalls: 1 })
    expect(snapshot.observations).toHaveLength(2)
    expect(snapshot.observations.every((item) => UUID.test(item.attemptDiagnosticId))).toBe(true)
    expect(snapshot.observations.every((item) => item.finishReason === 'stop')).toBe(true)
    expect(snapshot.telemetry).toMatchObject({
      uniqueAttempts: 2,
      usageCoverage: { knownAttempts: 2, unknownAttempts: 0 },
      totals: { totalTokens: { status: 'known', value: 72 } },
    })
  })

  it('accepts the anonymous essay IDs produced by the browser upload flow without exposing them in status', async () => {
    const gateway = createFakeAcceptanceGateway({ scenario: 'success', successDelayMs: 0 })
    const essayId = uploadedEssayId(1)

    const response = await grade(gateway.app, 'request-browser-upload', essayId).expect(200)

    expect(response.body).toMatchObject({ requestId: 'request-browser-upload', essayId, status: 'success' })
    const serializedStatus = JSON.stringify(gateway.snapshot())
    expect(serializedStatus).not.toContain(essayId)
    expect(serializedStatus).not.toContain(UPLOAD_UUID)
  })

  it('rejects identity-bearing and prose-like fixture IDs instead of branching on essay content', async () => {
    const gateway = createFakeAcceptanceGateway({ scenario: 'success', successDelayMs: 0 })
    const unsafeIds = [
      'student-alice',
      'yesterday-i-went-to-school',
      `${uploadedEssayId(1)}-alice`,
    ]

    for (const [index, essayId] of unsafeIds.entries()) {
      const response = await grade(gateway.app, `request-unsafe-id-${index + 1}`, essayId).expect(503)
      expect(response.body).toMatchObject({
        status: 'failed', error: { code: 'provider_request_rejected', retryable: false },
      })
    }
    expect(gateway.snapshot()).toMatchObject({
      providerCalls: unsafeIds.length, providerCompletions: 0, outcomes: { rejected: unsafeIds.length },
    })
  })

  it('returns one truthful 429 and succeeds on the next attachment after Retry-After', async () => {
    const clock = new FakeAcceptanceClock()
    const gateway = createFakeAcceptanceGateway({
      scenario: 'rate-limit', rateLimitRetryAfterMs: 5, successDelayMs: 0,
      monotonicNow: () => clock.now, executionTimers: clock,
    })

    const limited = await grade(gateway.app, 'request-rate-limit-1', 'sample-rate-limit').expect(429)
    expect(limited.headers['retry-after']).toBe('1')
    expect(limited.body).toMatchObject({
      status: 'failed', error: { code: 'provider_rate_limited', retryable: true },
    })

    clock.advanceBy(5)
    const succeeded = await grade(gateway.app, 'request-rate-limit-2', 'sample-rate-limit').expect(200)
    expect(succeeded.body).toMatchObject({ requestId: 'request-rate-limit-2', essayId: 'sample-rate-limit' })
    expect(gateway.snapshot()).toMatchObject({
      providerCalls: 2, providerCompletions: 1,
      outcomes: { rateLimited: 1, succeeded: 1 },
    })
  })

  it('simulates a Gateway execution-layer restart so the same auth-failed identity can run after explicit fake resume', async () => {
    const gateway = createFakeAcceptanceGateway({ scenario: 'pause-auth', successDelayMs: 0 })

    await grade(gateway.app, 'request-auth-1', 'sample-auth').expect(503, {
      requestId: 'request-auth-1', status: 'failed',
      error: { code: 'provider_auth_failed', message: 'AI 批改服务认证失败。', retryable: false },
    })
    await grade(gateway.app, 'request-auth-blocked', 'sample-after-auth').expect(503)
    expect(gateway.snapshot()).toMatchObject({ providerCalls: 1, admission: { pauseReason: 'provider_auth_failed' } })

    await request(gateway.app).post('/fake-acceptance/resume').expect(200, { status: 'resumed' })
    await grade(gateway.app, 'request-auth-1', 'sample-auth').expect(200)
    expect(gateway.snapshot()).toMatchObject({
      providerCalls: 2, providerCompletions: 1, admission: { pauseReason: null },
      outcomes: { authFailed: 1, succeeded: 1 },
    })
  })

  it('returns result-unknown, ignores abort, then serves the late success without another Provider call', async () => {
    const clock = new FakeAcceptanceClock()
    const gateway = createFakeAcceptanceGateway({
      scenario: 'result-unknown', httpDeadlineMs: 10, providerFinalDeadlineMs: 20,
      settlementGraceMs: 50, lateSuccessDelayMs: 80,
      monotonicNow: () => clock.now, executionTimers: clock,
    })

    const firstRequest = Promise.resolve(grade(gateway.app, 'request-late-1', 'sample-late-success'))
    await waitFor(() => gateway.snapshot().providerCalls === 1)
    clock.advanceBy(10)
    const unknown = await firstRequest
    expect(unknown.status).toBe(503)
    expect(unknown.body).toMatchObject({
      requestId: 'request-late-1', status: 'failed',
      error: { code: 'provider_result_unknown', retryable: false },
    })
    expect(gateway.snapshot()).toMatchObject({ providerCalls: 1, activeProviderCalls: 1 })

    clock.advanceBy(60)
    expect(gateway.snapshot()).toMatchObject({
      providerCalls: 1, providerCompletions: 0, activeProviderCalls: 1,
      registry: { states: { orphaned_unknown: 1 } },
      admission: { activeLeases: 1 },
    })
    const orphaned = await grade(gateway.app, 'request-late-2', 'sample-late-success').expect(503)
    expect(orphaned.body).toMatchObject({
      requestId: 'request-late-2', status: 'failed',
      error: { code: 'provider_result_unknown', retryable: false },
    })
    expect(gateway.snapshot().providerCalls).toBe(1)

    clock.advanceBy(10)
    await waitFor(() => gateway.snapshot().providerCompletions === 1)
    expect(gateway.snapshot()).toMatchObject({
      providerCalls: 1, providerCompletions: 1, ignoredAbortSignals: 1,
      activeProviderCalls: 0, admission: { activeLeases: 0 },
    })
    const cached = await grade(gateway.app, 'request-late-3', 'sample-late-success').expect(200)
    expect(cached.body).toMatchObject({ requestId: 'request-late-3', essayId: 'sample-late-success' })
    expect(gateway.snapshot().providerCalls).toBe(1)
  })

  it('fixes the mixed sample sequence while isolating failures and preserving late success', async () => {
    const clock = new FakeAcceptanceClock()
    const gateway = createFakeAcceptanceGateway({
      scenario: 'mixed', successDelayMs: 0, rateLimitRetryAfterMs: 5,
      httpDeadlineMs: 10, providerFinalDeadlineMs: 20, settlementGraceMs: 50, lateSuccessDelayMs: 80,
      monotonicNow: () => clock.now, executionTimers: clock,
    })

    await grade(gateway.app, 'request-mixed-success', 'sample-success').expect(200)
    await grade(gateway.app, 'request-mixed-rate-1', 'sample-rate-limit').expect(429)
    clock.advanceBy(5)
    await grade(gateway.app, 'request-mixed-rate-2', 'sample-rate-limit').expect(200)
    const failed = await grade(gateway.app, 'request-mixed-failure', 'sample-failure').expect(503)
    expect(failed.body).toMatchObject({
      status: 'failed', error: { code: 'provider_request_rejected', retryable: false },
    })
    await grade(gateway.app, 'request-mixed-auth', 'sample-auth').expect(503)
    await grade(gateway.app, 'request-mixed-blocked', 'sample-after-auth').expect(503)
    expect(gateway.snapshot().providerCalls).toBe(5)
    gateway.resume()
    await grade(gateway.app, 'request-mixed-auth', 'sample-auth').expect(200)
    const firstLateRequest = Promise.resolve(grade(gateway.app, 'request-mixed-late-1', 'sample-result-unknown'))
    await waitFor(() => gateway.snapshot().providerCalls === 7)
    clock.advanceBy(10)
    const firstUnknown = await firstLateRequest
    expect(firstUnknown.body).toMatchObject({ error: { code: 'provider_result_unknown', retryable: false } })
    clock.advanceBy(60)
    const orphaned = await grade(gateway.app, 'request-mixed-late-2', 'sample-result-unknown').expect(503)
    expect(orphaned.body).toMatchObject({ error: { code: 'provider_result_unknown', retryable: false } })
    expect(gateway.snapshot()).toMatchObject({
      providerCalls: 7, providerCompletions: 3,
      registry: { states: { orphaned_unknown: 1 } }, admission: { activeLeases: 1 },
    })
    clock.advanceBy(10)
    await waitFor(() => gateway.snapshot().providerCompletions === 4)
    await grade(gateway.app, 'request-mixed-late-3', 'sample-result-unknown').expect(200)
    expect(gateway.snapshot()).toMatchObject({
      providerCalls: 7, providerCompletions: 4, ignoredAbortSignals: 1,
      outcomes: { rateLimited: 1, authFailed: 1, rejected: 1, succeeded: 4 },
    })
  })

  it('assigns fixed mixed roles to anonymous browser essays by first-seen unique ordinal', async () => {
    const clock = new FakeAcceptanceClock()
    const gateway = createFakeAcceptanceGateway({
      scenario: 'mixed', successDelayMs: 0, rateLimitRetryAfterMs: 5,
      httpDeadlineMs: 10, providerFinalDeadlineMs: 20, settlementGraceMs: 50, lateSuccessDelayMs: 80,
      monotonicNow: () => clock.now, executionTimers: clock,
    })

    await grade(gateway.app, 'request-browser-role-1', uploadedEssayId(1)).expect(200)
    await grade(gateway.app, 'request-browser-role-2-a', uploadedEssayId(2)).expect(429)
    clock.advanceBy(5)
    await grade(gateway.app, 'request-browser-role-2-b', uploadedEssayId(2)).expect(200)
    const rejected = await grade(gateway.app, 'request-browser-role-3', uploadedEssayId(3)).expect(503)
    expect(rejected.body).toMatchObject({ error: { code: 'provider_request_rejected', retryable: false } })
    const authFailed = await grade(gateway.app, 'request-browser-role-4', uploadedEssayId(4)).expect(503)
    expect(authFailed.body).toMatchObject({ error: { code: 'provider_auth_failed', retryable: false } })
    await request(gateway.app).post('/fake-acceptance/resume').expect(200, { status: 'resumed' })
    await grade(gateway.app, 'request-browser-role-4', uploadedEssayId(4)).expect(200)

    const lateRequest = Promise.resolve(grade(gateway.app, 'request-browser-role-5-a', uploadedEssayId(5)))
    await waitFor(() => gateway.snapshot().providerCalls === 7)
    clock.advanceBy(10)
    const unknown = await lateRequest
    expect(unknown.status).toBe(503)
    expect(unknown.body).toMatchObject({ error: { code: 'provider_result_unknown', retryable: false } })
    clock.advanceBy(70)
    await waitFor(() => gateway.snapshot().providerCompletions === 4)
    await grade(gateway.app, 'request-browser-role-5-b', uploadedEssayId(5)).expect(200)
    await grade(gateway.app, 'request-browser-role-6', uploadedEssayId(6)).expect(200)

    expect(gateway.snapshot()).toMatchObject({
      providerCalls: 8, providerCompletions: 5, ignoredAbortSignals: 1,
      outcomes: { rateLimited: 1, authFailed: 1, rejected: 1, succeeded: 5 },
    })
  })

  it('runs the full mixed Gateway-client-scheduler queue through auth restart and same-ID resume', async () => {
    const { createRemoteGradingClient } = await vi.importActual(REMOTE_CLIENT_MODULE) as {
      createRemoteGradingClient(options: {
        apiBase: string
        fetchImpl: typeof fetch
        now: () => number
      }): { gradeImages(requestValue: SyntheticRemoteRequest): Promise<unknown> }
    }
    const { createTaskGradingScheduler } = await vi.importActual(TASK_SCHEDULER_MODULE) as {
      createTaskGradingScheduler(options: {
        mode: 'adaptive-v1'
        hardLimit: number
        stableSuccessWindow: number
        now: () => number
        timers: GatewayExecutionTimers
      }): {
        startTask(taskId: string, jobs: Array<ReturnType<typeof gradingJob>>): void
        resumeTask(taskId: string): void
        checkUnknownEssay(taskId: string, essayId: string): void
        getSnapshot(taskId: string): SyntheticQueueSnapshot
      }
    }
    const clock = new FakeAcceptanceClock()
    const gateway = createFakeAcceptanceGateway({
      scenario: 'mixed', hardLimit: 3, successDelayMs: 0, rateLimitRetryAfterMs: 5,
      httpDeadlineMs: 10, providerFinalDeadlineMs: 20, settlementGraceMs: 5, lateSuccessDelayMs: 30,
      monotonicNow: () => clock.now, executionTimers: clock,
    })
    const receivedMetadata: Array<{ requestId: string; essayId: string }> = []
    const client = createRemoteGradingClient({
      apiBase: 'http://gateway.test',
      fetchImpl: fetchThroughGateway(gateway.app, receivedMetadata),
      now: () => clock.now,
    })
    const scheduler = createTaskGradingScheduler({
      mode: 'adaptive-v1', hardLimit: 1, stableSuccessWindow: 8,
      now: () => clock.now, timers: clock,
    })
    const requests = Array.from({ length: 6 }, (_, index) => remoteRequest(
      `request-browser-queue-${index + 1}`,
      uploadedEssayId(index + 1),
    ))
    scheduler.startTask(task().taskId, requests.map((requestValue) => gradingJob(
      requestValue,
      () => client.gradeImages(requestValue),
    )))

    await waitFor(() => scheduler.getSnapshot(task().taskId).items[uploadedEssayId(2)]?.phase === 'rate_limit_wait')
    clock.advanceBy(1_000)
    await waitFor(() => scheduler.getSnapshot(task().taskId).pauseReason === 'auth')
    expect(gateway.snapshot()).toMatchObject({
      providerCalls: 5,
      admission: { pauseReason: 'provider_auth_failed' },
    })
    expect(scheduler.getSnapshot(task().taskId).items[uploadedEssayId(5)]?.phase).toBe('queued')

    await request(gateway.app).post('/fake-acceptance/resume').expect(200, { status: 'resumed' })
    scheduler.resumeTask(task().taskId)
    await waitFor(() => gateway.snapshot().providerCalls === 7)
    expect(receivedMetadata.filter(({ essayId }) => essayId === uploadedEssayId(4))).toEqual([
      { requestId: 'request-browser-queue-4', essayId: uploadedEssayId(4) },
      { requestId: 'request-browser-queue-4', essayId: uploadedEssayId(4) },
    ])
    expect(scheduler.getSnapshot(task().taskId).items[uploadedEssayId(4)]?.phase).toBe('succeeded')

    clock.advanceBy(10)
    await waitFor(() => (
      scheduler.getSnapshot(task().taskId).items[uploadedEssayId(5)]?.phase === 'result_unknown'
      && scheduler.getSnapshot(task().taskId).items[uploadedEssayId(6)]?.phase === 'rate_limit_wait'
    ))
    clock.advanceBy(20)
    await waitFor(() => gateway.snapshot().providerCompletions === 4)
    scheduler.checkUnknownEssay(task().taskId, uploadedEssayId(5))
    expect(scheduler.getSnapshot(task().taskId).items[uploadedEssayId(5)]?.phase).toBe('queued')
    clock.advanceBy(980)
    await waitFor(() => scheduler.getSnapshot(task().taskId).status === 'settled')

    const snapshot = scheduler.getSnapshot(task().taskId)
    expect(snapshot.items[uploadedEssayId(3)]).toMatchObject({
      phase: 'final_failure', errorCode: 'provider_request_rejected', retryable: false,
    })
    for (const index of [1, 2, 4, 5, 6]) {
      expect(snapshot.items[uploadedEssayId(index)]?.phase).toBe('succeeded')
    }
    expect(gateway.snapshot()).toMatchObject({
      providerCalls: 8, providerCompletions: 5, maxActiveProviderCalls: 1,
      outcomes: { rateLimited: 1, authFailed: 1, rejected: 1, succeeded: 5 },
      admission: { pauseReason: null, activeLeases: 0 },
    })
  })

  it('keeps first-seen mixed roles deterministic while browser essays overlap at the hard limit', async () => {
    const gateway = createFakeAcceptanceGateway({
      scenario: 'mixed', hardLimit: 2, successDelayMs: 30, rateLimitRetryAfterMs: 5,
    })

    for (let ordinal = 1; ordinal <= 8; ordinal += 1) {
      await grade(gateway.app, `request-browser-warm-${ordinal}`, `sample-warm-${ordinal}`).expect(200)
    }
    expect(gateway.snapshot().admission).toMatchObject({ hardLimit: 2, target: 2 })

    const first = Promise.resolve(grade(gateway.app, 'request-browser-concurrent-1', uploadedEssayId(1)))
    await waitFor(() => gateway.snapshot().providerCalls === 9)
    const second = Promise.resolve(grade(gateway.app, 'request-browser-concurrent-2-a', uploadedEssayId(2)))
    await waitFor(() => gateway.snapshot().providerCalls === 10)

    const limited = await second
    expect(limited.status).toBe(429)
    expect((await first).status).toBe(200)
    await new Promise<void>((resolve) => setTimeout(resolve, 12))
    await grade(gateway.app, 'request-browser-concurrent-2-b', uploadedEssayId(2)).expect(200)

    expect(gateway.snapshot()).toMatchObject({
      providerCalls: 11, providerCompletions: 10, maxActiveProviderCalls: 2,
      outcomes: { rateLimited: 1, succeeded: 10 },
    })
    expect(gateway.snapshot().maxActiveProviderCalls).toBeLessThanOrEqual(2)
  })

  it('enforces the real hard cap for distinct work and reuses one completion for duplicate work', async () => {
    const capped = createFakeAcceptanceGateway({ scenario: 'success', hardLimit: 1, successDelayMs: 30 })
    const distinct = await Promise.all([
      grade(capped.app, 'request-cap-1', 'sample-cap-1'),
      grade(capped.app, 'request-cap-2', 'sample-cap-2'),
      grade(capped.app, 'request-cap-3', 'sample-cap-3'),
    ])
    expect(distinct.filter((response) => response.status === 200)).toHaveLength(1)
    expect(distinct.filter((response) => response.status === 429)).toHaveLength(2)
    expect(capped.snapshot()).toMatchObject({ providerCalls: 1, providerCompletions: 1, maxActiveProviderCalls: 1 })

    const deduplicated = createFakeAcceptanceGateway({ scenario: 'success', hardLimit: 1, successDelayMs: 30 })
    const duplicate = await Promise.all([
      grade(deduplicated.app, 'request-duplicate-1', 'sample-duplicate'),
      grade(deduplicated.app, 'request-duplicate-2', 'sample-duplicate'),
      grade(deduplicated.app, 'request-duplicate-3', 'sample-duplicate'),
    ])
    expect(duplicate.map((response) => response.status)).toEqual([200, 200, 200])
    expect(duplicate.map((response) => response.body.requestId)).toEqual([
      'request-duplicate-1', 'request-duplicate-2', 'request-duplicate-3',
    ])
    expect(deduplicated.snapshot()).toMatchObject({
      providerCalls: 1, providerCompletions: 1, maxActiveProviderCalls: 1,
      telemetry: { uniqueAttempts: 1 },
    })
  })
})
