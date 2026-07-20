import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createServer } from './server.js'
import type { GradingRequestV1 } from './types.js'
import { GradingProviderError, type GradingProvider } from './providers/providerTypes.js'

function validRequest(): GradingRequestV1 {
  return {
    requestVersion: 'grading-request-v1', requestId: 'request-route',
    task: {
      taskId: 'task-route', writingGenre: 'practical_writing', fullScore: 15,
      prompt: { writingGenre: 'practical_writing', taskRequirement: 'Synthetic.' },
      rubric: {
        status: 'confirmed', writingGoal: 'Synthetic.', offTopicCriteria: [],
        dimensions: [{ id: 'all', name: 'All', weight: 100, description: 'All', deductionFocus: [] }],
        excellentFeatures: [], reviewTriggers: [],
      },
    },
    essay: {
      essayId: 'essay-route', confirmedTranscript: 'Synthetic route transcript.',
      ocrContext: { sourceKind: 'manual', hasKnownOcrRisk: false, riskCodes: [] },
    },
  }
}

describe('grading gateway server boundary', () => {
  it('returns a minimal health response', async () => {
    const response = await request(createServer()).get('/health').expect(200)
    expect(response.body).toEqual({ ok: true, service: 'grading-gateway' })
    expect(JSON.stringify(response.body)).not.toMatch(/deepseek|model|key/i)
  })

  it('allows the configured local origin and trace header in preflight', async () => {
    const response = await request(createServer({ allowedOrigin: 'http://127.0.0.1:5173' }))
      .options('/grading/grade')
      .set('Origin', 'http://127.0.0.1:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-grading-request-id')
      .expect(204)
    expect(response.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173')
    expect(response.headers['access-control-allow-headers']).toContain('Content-Type')
    expect(response.headers['access-control-allow-headers']).toContain('X-Grading-Request-Id')
  })

  it('returns redacted JSON for malformed JSON', async () => {
    const response = await request(createServer())
      .post('/grading/grade')
      .set('Content-Type', 'application/json')
      .set('X-Grading-Request-Id', 'malformed-request')
      .send('{"essay":{"confirmedTranscript":"PRIVATE-MARKER"}')
      .expect(400)
      .expect('Content-Type', /json/)

    expect(response.body).toEqual({
      requestId: 'malformed-request',
      status: 'failed',
      error: { code: 'invalid_request', message: '批改请求 JSON 无效。', retryable: false },
    })
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE-MARKER|SyntaxError|<html|stack/i)
  })

  it('returns redacted JSON for a body larger than 256 KB', async () => {
    const oversizedBody = JSON.stringify({
      requestVersion: 'grading-request-v1',
      requestId: 'oversized-request',
      essay: { confirmedTranscript: `PRIVATE-MARKER-${'x'.repeat(257 * 1024)}` },
    })
    const response = await request(createServer())
      .post('/grading/grade')
      .set('Content-Type', 'application/json')
      .set('X-Grading-Request-Id', 'oversized-request')
      .send(oversizedBody)
      .expect(413)
      .expect('Content-Type', /json/)

    expect(response.body).toEqual({
      requestId: 'oversized-request',
      status: 'failed',
      error: { code: 'request_too_large', message: '批改请求超过 256 KB 限制。', retryable: false },
    })
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE-MARKER|entity\.too\.large|<html|stack/i)
  })

  it('uses an unavailable trace id when the parser header is missing or invalid', async () => {
    const response = await request(createServer())
      .post('/grading/grade')
      .set('Content-Type', 'application/json')
      .set('X-Grading-Request-Id', 'x'.repeat(129))
      .send('{')
      .expect(400)
    expect(response.body.requestId).toBe('unavailable')
  })

  it('runs a valid request through the Gateway mock and production normalizer', async () => {
    const response = await request(createServer({ providerName: 'mock', now: () => '2026-07-20T00:00:00.000Z' }))
      .post('/grading/grade')
      .send(validRequest())
      .expect(200)
    expect(response.body).toMatchObject({
      resultVersion: 'grading-result-v1', requestId: 'request-route', essayId: 'essay-route',
      provider: 'mock', status: 'success', totalScore: 12, maxScore: 15,
    })
    expect(JSON.stringify(response.body)).not.toMatch(/deepseek|model|stack|SECRET|rawOnly/i)
  })

  it('returns a bound redacted 400 for invalid requests', async () => {
    const body = { ...validRequest(), studentName: 'PRIVATE-MARKER' }
    const response = await request(createServer())
      .post('/grading/grade')
      .send(body)
      .expect(400)
    expect(response.body).toMatchObject({
      requestId: body.requestId, status: 'failed', error: { code: 'invalid_request', retryable: false },
    })
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE-MARKER|stack|<html/i)
  })

  it('maps a controlled Provider failure without leaking request data', async () => {
    const response = await request(createServer({ providerName: 'mock_failure' }))
      .post('/grading/grade')
      .send(validRequest())
      .expect(503)
    expect(response.body).toEqual({
      requestId: 'request-route', status: 'failed',
      error: { code: 'provider_unavailable', message: 'AI 批改服务暂时不可用。', retryable: true },
    })
    expect(JSON.stringify(response.body)).not.toContain(validRequest().essay.confirmedTranscript)
  })

  it('maps an injected Provider error and an invalid Provider payload safely', async () => {
    const throwing: GradingProvider = {
      publicName: 'remote',
      async grade() {
        throw new GradingProviderError('provider_rate_limited', 'AI 服务请求过于频繁。', true)
      },
    }
    const thrown = await request(createServer({ provider: throwing })).post('/grading/grade').send(validRequest()).expect(503)
    expect(thrown.body.error).toEqual({
      code: 'provider_rate_limited', message: 'AI 服务请求过于频繁。', retryable: true,
    })

    const invalid: GradingProvider = {
      publicName: 'remote',
      async grade() { return { rawOnly: 'SECRET' } },
    }
    const normalized = await request(createServer({ provider: invalid })).post('/grading/grade').send(validRequest()).expect(503)
    expect(normalized.body).toMatchObject({
      requestId: 'request-route', status: 'failed', error: { code: 'provider_invalid_response', retryable: true },
    })
    expect(JSON.stringify(normalized.body)).not.toMatch(/SECRET|rawOnly/)
  })
})
