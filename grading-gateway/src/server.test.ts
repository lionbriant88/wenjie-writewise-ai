import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createServer } from './server.js'
import { GradingProviderError } from './providers/providerTypes.js'
import type { MultimodalProvider } from './providers/multimodalProviderTypes.js'

function imageRubricDimensions() {
  return [
    { id: 'content', name: 'Content', weight: 95, description: 'Relevant.', deductionFocus: [], sourceEvidence: [] },
    { id: 'legibility', name: 'Legibility', weight: 5, description: 'Handwriting is legible.', deductionFocus: [], sourceEvidence: [] },
  ]
}

function strictMultimodalPayload(transcript: string) {
  return {
    transcript, recognitionWarnings: [], printedTextExcluded: true, reportedTotalScore: 15,
    dimensionScores: [
      { dimensionId: 'content', score: 14.25, reason: 'Relevant.', evidence: transcript, relatedIssueKeys: [] },
      { dimensionId: 'legibility', score: 0.75, reason: 'Handwriting is legible.', evidence: transcript, relatedIssueKeys: [] },
    ],
    issues: [], sentenceRevisions: [], expressionUpgrades: [],
    fullTextRevision: { correctedText: transcript, improvedText: 'Improved synthetic version.', sentencePairs: [], logicNotes: [], logicIssues: [] },
    legibilityIssues: [], overallComment: 'Synthetic.',
  }
}

describe('grading gateway server boundary', () => {
  it('requires exact v2 multipart metadata and rejects missing, v1, or unexpected fields before Provider use', async () => {
    let calls = 0
    const provider: MultimodalProvider = {
      async generateRubric() { throw new Error('not used') },
      async gradeEssay(input) { calls += 1; return strictMultimodalPayload(input.confirmedTranscript ?? '') },
    }
    const base = {
      requestVersion: 'multimodal-grading-request-v2', requestId: 'versioned-request', essayId: 'versioned-essay',
      pageIds: [], confirmedTranscript: 'Teacher-confirmed synthetic text.',
      task: { taskId: 'image-task', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], rubric: { taskName: 'Synthetic task', materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], dimensions: imageRubricDimensions(), reviewWarnings: [] } },
    }
    await request(createServer({ multimodalProvider: provider }))
      .post('/grading/grade-images').field('metadata', JSON.stringify(base)).expect(200)

    const invalidMetadata = [
      (({ requestVersion: _version, ...metadata }) => metadata)(base),
      { ...base, requestVersion: 'multimodal-grading-request-v1' },
      { ...base, unexpected: 'PRIVATE-METADATA-MARKER' },
    ]
    for (const metadata of invalidMetadata) {
      const response = await request(createServer({ multimodalProvider: provider }))
        .post('/grading/grade-images').field('metadata', JSON.stringify(metadata)).expect(400)
      expect(JSON.stringify(response.body)).not.toContain('PRIVATE-METADATA-MARKER')
    }
    expect(calls).toBe(1)
  })

  it('accepts a confirmed task metadata payload above the rubric upload field limit', async () => {
    const provider: MultimodalProvider = {
      async generateRubric() { throw new Error('not used') },
      async gradeEssay() { return strictMultimodalPayload('Student text.') },
    }
    const materialSummary = `Synthetic ${'x'.repeat(17 * 1024)}`
    const metadata = { requestVersion: 'multimodal-grading-request-v2', requestId: 'large-metadata', essayId: 'large-essay', pageIds: ['essay-1'], task: { taskId: 'large-task', fullScore: 15, materialSummary, writingRequirements: ['Write.'], constraints: ['English.'], rubric: { taskName: 'Synthetic task', materialSummary, writingRequirements: ['Write.'], constraints: ['English.'], dimensions: imageRubricDimensions(), reviewWarnings: [] } } }
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
          ...strictMultimodalPayload('I has a pen.'),
        }
      },
    }
    const metadata = {
      requestVersion: 'multimodal-grading-request-v2', requestId: 'image-request', essayId: 'image-essay', pageIds: ['essay-2', 'essay-1'],
      task: {
        taskId: 'image-task', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'],
        rubric: { taskName: 'Synthetic task', materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], dimensions: imageRubricDimensions(), reviewWarnings: [] },
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
      requestVersion: 'multimodal-grading-request-v2', requestId: 'confirmed-image-request', essayId: 'confirmed-image-essay', pageIds: [], confirmedTranscript: teacherText,
      task: { taskId: 'image-task', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], rubric: { taskName: 'Synthetic task', materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], dimensions: imageRubricDimensions(), reviewWarnings: [] } },
    }
    const calls: Parameters<MultimodalProvider['gradeEssay']>[] = []
    const matchingProvider: MultimodalProvider = {
      async generateRubric() { throw new Error('not used') },
      async gradeEssay(input) { calls.push([input]); return strictMultimodalPayload(teacherText) },
    }
    await request(createServer({ multimodalProvider: matchingProvider }))
      .post('/grading/grade-images').field('metadata', JSON.stringify(metadata)).expect(200)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toMatchObject({ confirmedTranscript: teacherText, pages: [] })

    let mismatchCalls = 0
    const differentProvider: MultimodalProvider = {
      async generateRubric() { throw new Error('not used') },
      async gradeEssay() { mismatchCalls += 1; return strictMultimodalPayload('MODEL-DIFFERENT') },
    }
    const response = await request(createServer({ multimodalProvider: differentProvider }))
      .post('/grading/grade-images').field('metadata', JSON.stringify(metadata)).expect(503)
    expect(response.body).toMatchObject({ status: 'failed', error: { code: 'provider_invalid_response' } })
    expect(JSON.stringify(response.body)).not.toMatch(/Teacher corrected transcript|MODEL-DIFFERENT/)
    expect(mismatchCalls).toBe(1)
  })

  it('rejects image files attached to a teacher-confirmed text regrade', async () => {
    let calls = 0
    const provider: MultimodalProvider = {
      async generateRubric() { throw new Error('not used') },
      async gradeEssay() { calls += 1; throw new Error('must not run') },
    }
    const metadata = {
      requestVersion: 'multimodal-grading-request-v2', requestId: 'confirmed-with-image', essayId: 'confirmed-essay', pageIds: [], confirmedTranscript: 'Teacher-confirmed text.',
      task: { taskId: 'image-task', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], rubric: { taskName: 'Synthetic task', materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], dimensions: imageRubricDimensions(), reviewWarnings: [] } },
    }
    await request(createServer({ multimodalProvider: provider }))
      .post('/grading/grade-images').field('metadata', JSON.stringify(metadata))
      .attach('pages', Buffer.from('unexpected-image'), { filename: 'essay.png', contentType: 'image/png' }).expect(400)
    expect(calls).toBe(0)
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
        return strictMultimodalPayload(transcript)
      },
    }
    const task = { taskId: 'image-task', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], rubric: { taskName: 'Synthetic task', materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], dimensions: imageRubricDimensions(), reviewWarnings: [] } }
    const app = createServer({ multimodalProvider: provider })
    await request(app).post('/grading/grade-images')
      .field('metadata', JSON.stringify({ requestVersion: 'multimodal-grading-request-v2', requestId: 'boundary-50k', essayId: 'boundary-essay', pageIds: [], task, confirmedTranscript: exactly50k })).expect(200)
    expect(calls).toBe(1)

    const marker = 'PRIVATE-TOO-LONG-'
    const response = await request(app).post('/grading/grade-images')
      .field('metadata', JSON.stringify({ requestVersion: 'multimodal-grading-request-v2', requestId: 'boundary-50k-plus', essayId: 'boundary-essay', pageIds: [], task, confirmedTranscript: `${marker}${'x'.repeat(50_001 - marker.length)}` })).expect(400)
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
    const metadata = { requestVersion: 'multimodal-grading-request-v2', requestId: 'image-failure', essayId: 'essay-failure', pageIds: ['essay-1'], task: { taskId: 'image-task', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], rubric: { taskName: 'Synthetic task', materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], dimensions: imageRubricDimensions(), reviewWarnings: [] } } }
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
      dimensions: [
        { id: 'content', name: 'Content', weight: 95, description: 'Cover the task.', deductionFocus: ['Missing task coverage.'], sourceEvidence: ['Prompt heading.'] },
        { id: 'legibility', name: 'Legibility', weight: 5, description: 'Handwriting is legible.', deductionFocus: [], sourceEvidence: [] },
      ],
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

  it('fails closed when an injected rubric provider returns a generated rubric without the exact 5% legibility dimension', async () => {
    const provider: MultimodalProvider = {
      async generateRubric() {
        return {
          taskName: 'Synthetic task', materialSummary: 'Synthetic material.', writingRequirements: ['Write clearly.'], constraints: [],
          dimensions: [{ id: 'content', name: 'Content', weight: 100, description: 'Cover the task.', deductionFocus: [], sourceEvidence: [] }],
          reviewWarnings: [],
        }
      },
      async gradeEssay() { throw new Error('not used') },
    }
    const response = await request(createServer({ multimodalProvider: provider }))
      .post('/tasks/rubric')
      .field('requestId', 'rubric-invalid-generated')
      .field('fullScore', '15')
      .field('pageIds', JSON.stringify(['material-1']))
      .attach('pages', Buffer.from('synthetic-image'), { filename: 'material.png', contentType: 'image/png' })
      .expect(503)

    expect(response.body).toMatchObject({ requestId: 'rubric-invalid-generated', status: 'failed', error: { code: 'provider_invalid_response', retryable: true } })
    expect(response.body).not.toHaveProperty('rubric')
  })

  it('returns a minimal health response', async () => {
    const response = await request(createServer()).get('/health').expect(200)
    expect(response.body).toEqual({ ok: true, service: 'grading-gateway' })
    expect(JSON.stringify(response.body)).not.toMatch(/deepseek|model|key/i)
  })

  it('does not expose the deprecated generic grading policy bypass', async () => {
    await request(createServer({ providerName: 'kimi' }))
      .post('/grading/grade')
      .send({ requestId: 'deprecated-request' })
      .expect(404)
  })

  it('allows the configured local origin and trace header in preflight', async () => {
    const response = await request(createServer({ allowedOrigin: 'http://127.0.0.1:5173' }))
      .options('/grading/grade-images')
      .set('Origin', 'http://127.0.0.1:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-grading-request-id')
      .expect(204)
    expect(response.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173')
    expect(response.headers['access-control-allow-headers']).toContain('Content-Type')
    expect(response.headers['access-control-allow-headers']).toContain('X-Grading-Request-Id')
  })

})
