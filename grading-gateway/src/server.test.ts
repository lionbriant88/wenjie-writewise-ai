import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createServer } from './server.js'

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
})
