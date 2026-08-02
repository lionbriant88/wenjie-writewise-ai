import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createServer } from './server.js'
import type { GradingRequestV1 } from './types.js'
import { GradingProviderError, type GradingProvider } from './providers/providerTypes.js'
import type { MultimodalProvider } from './providers/multimodalProviderTypes.js'

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
  it('accepts a confirmed task metadata payload above the rubric upload field limit', async () => {
    const provider: MultimodalProvider = {
      async generateRubric() { throw new Error('not used') },
      async gradeEssay() { return { transcript: 'Student text.', transcriptionWarnings: [], printedTextExcluded: true, reportedTotalScore: 15, dimensionScores: [{ dimensionId: 'content', score: 15, reason: 'Relevant.', evidence: 'Student text.' }], issues: [], sentenceRevisions: [], expressionUpgrades: [], fullTextRevision: { correctedText: 'Student text.', improvedText: 'Student text.', sentencePairs: [], logicNotes: [] }, overallComment: 'Synthetic.', reviewReasons: [] } },
    }
    const materialSummary = `Synthetic ${'x'.repeat(17 * 1024)}`
    const metadata = { requestId: 'large-metadata', essayId: 'large-essay', pageIds: ['essay-1'], task: { taskId: 'large-task', fullScore: 15, rubric: { taskName: 'Synthetic task', materialSummary, writingRequirements: ['Write.'], constraints: ['English.'], dimensions: [{ id: 'content', name: 'Content', weight: 100, description: 'Relevant.', deductionFocus: [], sourceEvidence: [] }], reviewWarnings: [] } } }
    await request(createServer({ multimodalProvider: provider }))
      .post('/grading/grade-images').field('metadata', JSON.stringify(metadata))
      .attach('pages', Buffer.from('essay-page'), { filename: 'essay.png', contentType: 'image/png' }).expect(200)
  })

  it('rejects metadata above the image grading limit without echoing its contents', async () => {
    const privateMarker = 'PRIVATE-METADATA-MARKER'
    const response = await request(createServer())
      .post('/grading/grade-images').field('metadata', `${privateMarker}${'x'.repeat(32 * 1024 * 1024)}`)
      .attach('pages', Buffer.from('essay-page'), { filename: 'essay.png', contentType: 'image/png' }).expect(413)
    expect(response.body).toMatchObject({ requestId: 'unavailable', status: 'failed', error: { code: 'request_too_large' } })
    expect(JSON.stringify(response.body)).not.toContain(privateMarker)
  })
  it('grades uploaded essay images once with stable metadata IDs and returns the normalized transcript', async () => {
    const calls: Parameters<MultimodalProvider['gradeEssay']>[] = []
    const provider: MultimodalProvider = {
      async generateRubric() { throw new Error('not used') },
      async gradeEssay(input) {
        calls.push([input])
        return {
          transcript: 'I has a pen.', transcriptionWarnings: [], printedTextExcluded: true,
          reportedTotalScore: 15,
          dimensionScores: [{ dimensionId: 'content', score: 15, reason: 'Relevant.', evidence: 'I has a pen.' }],
          issues: [], sentenceRevisions: [], expressionUpgrades: [],
          fullTextRevision: { correctedText: 'I have a pen.', improvedText: 'I have a pen.', sentencePairs: [], logicNotes: [] },
          overallComment: 'Synthetic.', reviewReasons: [],
        }
      },
    }
    const metadata = {
      requestId: 'image-request', essayId: 'image-essay', pageIds: ['essay-2', 'essay-1'],
      task: {
        taskId: 'image-task', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'],
        rubric: { taskName: 'Synthetic task', materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], dimensions: [{ id: 'content', name: 'Content', weight: 100, description: 'Relevant.', deductionFocus: [], sourceEvidence: [] }], reviewWarnings: [] },
      },
    }
    const response = await request(createServer({ multimodalProvider: provider, now: () => '2026-08-02T00:00:00.000Z' }))
      .post('/grading/grade-images')
      .field('metadata', JSON.stringify(metadata))
      .attach('pages', Buffer.from('second-page'), { filename: 'second.png', contentType: 'image/png' })
      .attach('pages', Buffer.from('first-page'), { filename: 'first.jpg', contentType: 'image/jpeg' })
      .expect(200)

    expect(response.body).toMatchObject({ requestId: 'image-request', essayId: 'image-essay', transcript: 'I has a pen.', printedTextExcluded: true, totalScore: 15 })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toMatchObject({ requestId: 'image-request', essayId: 'image-essay', pages: [{ pageId: 'essay-2' }, { pageId: 'essay-1' }] })
  })

  it('forwards teacher-confirmed text once and rejects a different model transcript without exposing either text', async () => {
    const teacherText = 'Teacher corrected transcript.'
    const metadata = {
      requestId: 'confirmed-image-request', essayId: 'confirmed-image-essay', pageIds: ['essay-1'], confirmedTranscript: teacherText,
      task: { taskId: 'image-task', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], rubric: { taskName: 'Synthetic task', materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], dimensions: [{ id: 'content', name: 'Content', weight: 100, description: 'Relevant.', deductionFocus: [], sourceEvidence: [] }], reviewWarnings: [] } },
    }
    const calls: Parameters<MultimodalProvider['gradeEssay']>[] = []
    const matchingProvider: MultimodalProvider = {
      async generateRubric() { throw new Error('not used') },
      async gradeEssay(input) { calls.push([input]); return { transcript: teacherText, transcriptionWarnings: [], printedTextExcluded: true, reportedTotalScore: 15, dimensionScores: [{ dimensionId: 'content', score: 15, reason: 'Relevant.', evidence: teacherText }], issues: [], sentenceRevisions: [], expressionUpgrades: [], fullTextRevision: { correctedText: teacherText, improvedText: teacherText, sentencePairs: [], logicNotes: [] }, overallComment: 'Synthetic.', reviewReasons: [] } },
    }
    await request(createServer({ multimodalProvider: matchingProvider }))
      .post('/grading/grade-images').field('metadata', JSON.stringify(metadata))
      .attach('pages', Buffer.from('essay-page'), { filename: 'essay.png', contentType: 'image/png' }).expect(200)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0].confirmedTranscript).toBe(teacherText)

    let mismatchCalls = 0
    const differentProvider: MultimodalProvider = {
      async generateRubric() { throw new Error('not used') },
      async gradeEssay() { mismatchCalls += 1; return { transcript: 'MODEL-DIFFERENT', transcriptionWarnings: [], printedTextExcluded: true, reportedTotalScore: 15, dimensionScores: [], issues: [], sentenceRevisions: [], expressionUpgrades: [], fullTextRevision: { correctedText: '', improvedText: '', sentencePairs: [], logicNotes: [] }, overallComment: 'Synthetic.', reviewReasons: [] } },
    }
    const response = await request(createServer({ multimodalProvider: differentProvider }))
      .post('/grading/grade-images').field('metadata', JSON.stringify(metadata))
      .attach('pages', Buffer.from('essay-page'), { filename: 'essay.png', contentType: 'image/png' }).expect(503)
    expect(response.body).toMatchObject({ status: 'failed', error: { code: 'provider_invalid_response' } })
    expect(JSON.stringify(response.body)).not.toMatch(/Teacher corrected transcript|MODEL-DIFFERENT/)
    expect(mismatchCalls).toBe(1)
  })

  it('accepts exactly 50,000 confirmed transcript code units and safely rejects 50,001', async () => {
    const exactly50k = `\n${'x'.repeat(49_997)} \n`
    expect(exactly50k).toHaveLength(50_000)
    let calls = 0
    const provider: MultimodalProvider = {
      async generateRubric() { throw new Error('not used') },
      async gradeEssay(input) {
        calls += 1
        const transcript = input.confirmedTranscript ?? ''
        return { transcript, transcriptionWarnings: [], printedTextExcluded: true, reportedTotalScore: 15, dimensionScores: [{ dimensionId: 'content', score: 15, reason: 'Relevant.', evidence: transcript }], issues: [], sentenceRevisions: [], expressionUpgrades: [], fullTextRevision: { correctedText: transcript, improvedText: transcript, sentencePairs: [], logicNotes: [] }, overallComment: 'Synthetic.', reviewReasons: [] }
      },
    }
    const task = { taskId: 'image-task', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], rubric: { taskName: 'Synthetic task', materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], dimensions: [{ id: 'content', name: 'Content', weight: 100, description: 'Relevant.', deductionFocus: [], sourceEvidence: [] }], reviewWarnings: [] } }
    const app = createServer({ multimodalProvider: provider })
    await request(app).post('/grading/grade-images')
      .field('metadata', JSON.stringify({ requestId: 'boundary-50k', essayId: 'boundary-essay', pageIds: ['essay-1'], task, confirmedTranscript: exactly50k }))
      .attach('pages', Buffer.from('essay-page'), { filename: 'essay.png', contentType: 'image/png' }).expect(200)
    expect(calls).toBe(1)

    const marker = 'PRIVATE-TOO-LONG-'
    const response = await request(app).post('/grading/grade-images')
      .field('metadata', JSON.stringify({ requestId: 'boundary-50k-plus', essayId: 'boundary-essay', pageIds: ['essay-1'], task, confirmedTranscript: `${marker}${'x'.repeat(50_001 - marker.length)}` }))
      .attach('pages', Buffer.from('essay-page'), { filename: 'essay.png', contentType: 'image/png' }).expect(400)
    expect(response.body).toMatchObject({ requestId: 'unavailable', status: 'failed', error: { code: 'invalid_request', retryable: false } })
    expect(JSON.stringify(response.body)).not.toContain(marker)
    expect(calls).toBe(1)
  })

  it('isolates image grading failures without retrying or exposing the raw essay', async () => {
    let calls = 0
    const provider: MultimodalProvider = {
      async generateRubric() { throw new Error('not used') },
      async gradeEssay() { calls += 1; throw new GradingProviderError('provider_unavailable', 'safe failure', true) },
    }
    const metadata = { requestId: 'image-failure', essayId: 'essay-failure', pageIds: ['essay-1'], task: { taskId: 'image-task', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], rubric: { taskName: 'Synthetic task', materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], dimensions: [{ id: 'content', name: 'Content', weight: 100, description: 'Relevant.', deductionFocus: [], sourceEvidence: [] }], reviewWarnings: [] } } }
    const response = await request(createServer({ multimodalProvider: provider }))
      .post('/grading/grade-images').field('metadata', JSON.stringify(metadata))
      .attach('pages', Buffer.from('PRIVATE-ESSAY'), { filename: 'essay.png', contentType: 'image/png' }).expect(503)
    expect(response.body).toMatchObject({ requestId: 'image-failure', status: 'failed', error: { code: 'provider_unavailable' } })
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE-ESSAY')
    expect(calls).toBe(1)
  })
  it('sends ordered rubric page data to the injected multimodal provider', async () => {
    const generatedRubric = {
      taskName: 'Synthetic task', materialSummary: 'A synthetic task material summary.',
      writingRequirements: ['Write clearly.'], constraints: ['Use English.'],
      dimensions: [{ id: 'content', name: 'Content', weight: 100, description: 'Cover the task.', deductionFocus: ['Missing task coverage.'], sourceEvidence: ['Prompt heading.'] }],
      reviewWarnings: ['Verify source material.'],
    }
    const calls: Parameters<MultimodalProvider['generateRubric']>[] = []
    const provider: MultimodalProvider = {
      async generateRubric(input) { calls.push([input]); return generatedRubric },
      async gradeEssay() { throw new Error('not used') },
    }

    const response = await request(createServer({ multimodalProvider: provider }))
      .post('/tasks/rubric')
      .field('requestId', 'rubric-route-1')
      .field('fullScore', '15')
      .field('pageIds', JSON.stringify(['material-2', 'material-1']))
      .attach('pages', Buffer.from('second-page'), { filename: 'second.png', contentType: 'image/png' })
      .attach('pages', Buffer.from('first-page'), { filename: 'first.jpg', contentType: 'image/jpeg' })
      .expect(200)

    expect(response.body).toEqual({ requestId: 'rubric-route-1', status: 'success', rubric: generatedRubric })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toMatchObject({
      requestId: 'rubric-route-1', fullScore: 15,
      pages: [
        { pageId: 'material-2', mimeType: 'image/png', buffer: Buffer.from('second-page') },
        { pageId: 'material-1', mimeType: 'image/jpeg', buffer: Buffer.from('first-page') },
      ],
    })
  })

  it('maps a rubric provider timeout without returning partial task state', async () => {
    const provider: MultimodalProvider = {
      async generateRubric(input) {
        await new Promise<void>((_resolve, reject) => {
          input.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
        throw new Error('unreachable')
      },
      async gradeEssay() { throw new Error('not used') },
    }
    const response = await request(createServer({ multimodalProvider: provider, timeoutMs: 1 }))
      .post('/tasks/rubric')
      .field('requestId', 'rubric-timeout')
      .field('fullScore', '15')
      .field('pageIds', JSON.stringify(['material-1']))
      .attach('pages', Buffer.from('synthetic-image'), { filename: 'material.png', contentType: 'image/png' })
      .expect(503)

    expect(response.body).toMatchObject({
      requestId: 'rubric-timeout', status: 'failed',
      error: { code: 'provider_timeout', retryable: true },
    })
    expect(response.body).not.toHaveProperty('rubric')
  })

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
