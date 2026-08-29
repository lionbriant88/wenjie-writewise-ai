import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FAKE_ACCEPTANCE_SCENARIOS,
  createFakeAcceptanceGateway,
  createFakeAcceptanceGatewayFromEnvironment,
  parseFakeAcceptanceScenario,
} from './runFakeAcceptanceGateway.js'
import type { GatewayExecutionTimers } from '../src/server.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UPLOAD_UUID = '88781e92-1573-4429-9034-3670a9a518f7'

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

  it('pauses admission after auth failure and resumes only through the explicit fake control', async () => {
    const gateway = createFakeAcceptanceGateway({ scenario: 'pause-auth', successDelayMs: 0 })

    await grade(gateway.app, 'request-auth-1', 'sample-auth').expect(503, {
      requestId: 'request-auth-1', status: 'failed',
      error: { code: 'provider_auth_failed', message: 'AI 批改服务认证失败。', retryable: false },
    })
    await grade(gateway.app, 'request-auth-blocked', 'sample-after-auth').expect(503)
    expect(gateway.snapshot()).toMatchObject({ providerCalls: 1, admission: { pauseReason: 'provider_auth_failed' } })

    await request(gateway.app).post('/fake-acceptance/resume').expect(200, { status: 'resumed' })
    await grade(gateway.app, 'request-auth-resumed', 'sample-after-auth').expect(200)
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
    await grade(gateway.app, 'request-mixed-resumed', 'sample-after-auth').expect(200)
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

    const lateRequest = Promise.resolve(grade(gateway.app, 'request-browser-role-5-a', uploadedEssayId(5)))
    await waitFor(() => gateway.snapshot().providerCalls === 6)
    clock.advanceBy(10)
    const unknown = await lateRequest
    expect(unknown.status).toBe(503)
    expect(unknown.body).toMatchObject({ error: { code: 'provider_result_unknown', retryable: false } })
    clock.advanceBy(70)
    await waitFor(() => gateway.snapshot().providerCompletions === 3)
    await grade(gateway.app, 'request-browser-role-5-b', uploadedEssayId(5)).expect(200)
    await grade(gateway.app, 'request-browser-role-6', uploadedEssayId(6)).expect(200)

    expect(gateway.snapshot()).toMatchObject({
      providerCalls: 7, providerCompletions: 4, ignoredAbortSignals: 1,
      outcomes: { rateLimited: 1, authFailed: 1, rejected: 1, succeeded: 4 },
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
