import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createServer, MAX_IMAGE_GRADING_METADATA_BYTES } from './server.js'
import { MAX_TASK_MATERIAL_TEXT_FIELD_BYTES } from './multipartTaskMaterials.js'
import { GradingProviderError } from './providers/providerTypes.js'
import type { MultimodalProvider } from './providers/multimodalProviderTypes.js'
import type { TaskMaterialContextV1 } from './multimodal/types.js'

function fakeMultimodalProvider(
  overrides: Partial<MultimodalProvider> = {},
): MultimodalProvider {
  return {
    async generateMaterialContext() { throw new Error('not used') },
    async generateRubric() { throw new Error('not used') },
    async gradeEssay() { throw new Error('not used') },
    ...overrides,
  }
}

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

function generatedRubricFixture() {
  return {
    taskName: 'Synthetic task', materialSummary: 'A synthetic task material summary.',
    writingRequirements: ['Write clearly.'], constraints: ['Use English.'],
    dimensions: [
      { id: 'content', name: 'Content', weight: 95, description: 'Cover the task.', deductionFocus: ['Missing task coverage.'], sourceEvidence: ['Prompt heading.'] },
      { id: 'legibility', name: 'Legibility', weight: 5, description: 'Handwriting is legible.', deductionFocus: [], sourceEvidence: [] },
    ],
    reviewWarnings: ['Verify source material.'],
  }
}

function materialContextFixture(): TaskMaterialContextV1 {
  return {
    materialSummary: 'A strict synthetic material summary.',
    writingRequirements: ['Teacher requirement.', 'Model-inferred requirement.'],
    constraints: ['Use English.'],
    reviewWarnings: ['Verify ambiguous source text.'],
  }
}

describe('grading gateway server boundary', () => {
  it('requires exact v2 multipart metadata and rejects missing, v1, or unexpected fields before Provider use', async () => {
    let calls = 0
    const provider = fakeMultimodalProvider({
      async gradeEssay(input) { calls += 1; return strictMultimodalPayload(input.confirmedTranscript ?? '') },
    })
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
      {
        ...base,
        writingRequirement: 'PRIVATE-TASK-MATERIAL-REQUIREMENT',
        materialManifest: 'PRIVATE-TASK-MATERIAL-MANIFEST',
        textMaterials: 'PRIVATE-TASK-MATERIAL-TEXT',
      },
    ]
    for (const metadata of invalidMetadata) {
      const response = await request(createServer({ multimodalProvider: provider }))
        .post('/grading/grade-images').field('metadata', JSON.stringify(metadata)).expect(400)
      expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE-(?:METADATA|TASK-MATERIAL)/)
    }
    expect(calls).toBe(1)
  })

  it('accepts a confirmed task metadata payload above the rubric upload field limit', async () => {
    const provider = fakeMultimodalProvider({
      async gradeEssay() { return strictMultimodalPayload('Student text.') },
    })
    const materialSummary = `Synthetic ${'x'.repeat(17 * 1024)}`
    const metadata = { requestVersion: 'multimodal-grading-request-v2', requestId: 'large-metadata', essayId: 'large-essay', pageIds: ['essay-1'], task: { taskId: 'large-task', fullScore: 15, materialSummary, writingRequirements: ['Write.'], constraints: ['English.'], rubric: { taskName: 'Synthetic task', materialSummary, writingRequirements: ['Write.'], constraints: ['English.'], dimensions: imageRubricDimensions(), reviewWarnings: [] } } }
    await request(createServer({ multimodalProvider: provider }))
      .post('/grading/grade-images').field('metadata', JSON.stringify(metadata))
      .attach('pages', Buffer.from('essay-page'), { filename: 'essay.png', contentType: 'image/png' }).expect(200)
  })

  it('grades a no-material task whose 10,000-code-point requirement produces a non-BMP summary, while rejecting 10,001 before Provider use', async () => {
    const teacherText = 'Teacher-confirmed synthetic text.'
    const requirement = '😀'.repeat(10_000)
    const materialSummary = `教师确认的写作要求：${requirement}`
    expect(materialSummary).toHaveLength(20_010)
    expect(Array.from(materialSummary)).toHaveLength(10_010)
    const calls: Parameters<MultimodalProvider['gradeEssay']>[] = []
    const provider = fakeMultimodalProvider({
      async gradeEssay(input) {
        calls.push([input])
        return strictMultimodalPayload(teacherText)
      },
    })
    const task = {
      taskId: 'unicode-no-material-task',
      fullScore: 15,
      materialSummary,
      writingRequirements: [requirement],
      constraints: [],
      rubric: {
        taskName: 'Unicode no-material task',
        materialSummary,
        writingRequirements: [requirement],
        constraints: [],
        dimensions: imageRubricDimensions(),
        reviewWarnings: [],
      },
    }
    const app = createServer({ multimodalProvider: provider })

    const accepted = await request(app)
      .post('/grading/grade-images')
      .field('metadata', JSON.stringify({
        requestVersion: 'multimodal-grading-request-v2',
        requestId: 'unicode-no-material-boundary',
        essayId: 'unicode-no-material-essay',
        pageIds: [],
        confirmedTranscript: teacherText,
        task,
      }))
      .expect(200)

    expect(accepted.body).toMatchObject({
      resultVersion: 'grading-result-v2',
      requestId: 'unicode-no-material-boundary',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0].task).toMatchObject({
      materialSummary,
      writingRequirements: [requirement],
    })

    const overRequirement = `${requirement}😀`
    const overMaterialSummary = `教师确认的写作要求：${overRequirement}`
    const rejected = await request(app)
      .post('/grading/grade-images')
      .field('metadata', JSON.stringify({
        requestVersion: 'multimodal-grading-request-v2',
        requestId: 'unicode-no-material-over-limit',
        essayId: 'unicode-no-material-essay',
        pageIds: [],
        confirmedTranscript: teacherText,
        task: {
          ...task,
          materialSummary: overMaterialSummary,
          writingRequirements: [overRequirement],
          rubric: {
            ...task.rubric,
            materialSummary: overMaterialSummary,
            writingRequirements: [overRequirement],
          },
        },
      }))
      .expect(400)

    expect(rejected.body).toMatchObject({
      status: 'failed',
      error: { code: 'invalid_request', retryable: false },
    })
    expect(calls).toHaveLength(1)
  })

  it('bounds Unicode iteration for an oversized metadata ID and rejects it before Provider use', async () => {
    const privateMarker = 'PRIVATE-OVERSIZED-METADATA-ID-'
    const oversizedRequestId = `${privateMarker}${'x'.repeat(1024 * 1024)}`
    const metadataField = JSON.stringify({
      requestVersion: 'multimodal-grading-request-v2',
      requestId: oversizedRequestId,
      essayId: 'bounded-metadata-essay',
      pageIds: [],
      confirmedTranscript: 'Teacher-confirmed synthetic text.',
      task: {
        taskId: 'bounded-metadata-task',
        fullScore: 15,
        materialSummary: 'Synthetic material.',
        writingRequirements: ['Write.'],
        constraints: ['English.'],
        rubric: {
          taskName: 'Synthetic task',
          materialSummary: 'Synthetic material.',
          writingRequirements: ['Write.'],
          constraints: ['English.'],
          dimensions: imageRubricDimensions(),
          reviewWarnings: [],
        },
      },
    })
    expect(Buffer.byteLength(metadataField, 'utf8')).toBeLessThan(MAX_IMAGE_GRADING_METADATA_BYTES)

    let providerCalls = 0
    const provider = fakeMultimodalProvider({
      async gradeEssay() {
        providerCalls += 1
        throw new Error('must not run')
      },
    })
    const originalIteratorDescriptor = Object.getOwnPropertyDescriptor(String.prototype, Symbol.iterator)
    if (!originalIteratorDescriptor?.value) throw new Error('String iterator is unavailable')
    const originalIterator = String.prototype[Symbol.iterator]
    let targetNextCalls = 0
    Object.defineProperty(String.prototype, Symbol.iterator, {
      ...originalIteratorDescriptor,
      value: function observedStringIterator(this: string) {
        const value = String(this)
        const iterator = originalIterator.call(value)
        if (value !== oversizedRequestId) return iterator
        return {
          next() {
            targetNextCalls += 1
            return iterator.next()
          },
          [Symbol.iterator]() { return this },
        }
      },
    })

    try {
      const response = await request(createServer({ multimodalProvider: provider }))
        .post('/grading/grade-images')
        .field('metadata', metadataField)
        .expect(400)

      expect(response.body).toMatchObject({
        requestId: 'unavailable',
        status: 'failed',
        error: { code: 'invalid_request', retryable: false },
      })
      expect(JSON.stringify(response.body)).not.toContain(privateMarker)
      expect(targetNextCalls).toBe(129)
      expect(providerCalls).toBe(0)
    } finally {
      Object.defineProperty(String.prototype, Symbol.iterator, originalIteratorDescriptor)
    }
  })

  it('rejects metadata above the image grading limit without echoing its contents', async () => {
    const privateMarker = 'PRIVATE-METADATA-MARKER'
    const response = await request(createServer())
      .post('/grading/grade-images').field('metadata', `${privateMarker}${'x'.repeat(32 * 1024 * 1024)}`)
      .attach('pages', Buffer.from('essay-page'), { filename: 'essay.png', contentType: 'image/png' }).expect(413)
    expect(response.body).toMatchObject({
      requestId: 'unavailable', status: 'failed',
      error: { code: 'request_too_large', message: 'Rubric upload exceeds the allowed limit.' },
    })
    expect(JSON.stringify(response.body)).not.toContain(privateMarker)
  })
  it('grades uploaded essay images once with stable metadata IDs and returns the normalized transcript', async () => {
    const calls: Parameters<MultimodalProvider['gradeEssay']>[] = []
    const provider = fakeMultimodalProvider({
      async gradeEssay(input) {
        calls.push([input])
        return {
          ...strictMultimodalPayload('I has a pen.'),
        }
      },
    })
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

    expect(response.body).toMatchObject({ resultVersion: 'grading-result-v2', requestId: 'image-request', essayId: 'image-essay', transcript: 'I has a pen.', printedTextExcluded: true, totalScore: 15 })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toMatchObject({ requestId: 'image-request', essayId: 'image-essay', pages: [{ pageId: 'essay-2' }, { pageId: 'essay-1' }] })
  })

  it('keeps essay image parsing on the rubric multipart validator and rejects unsupported media before Provider use', async () => {
    let calls = 0
    const provider = fakeMultimodalProvider({
      async gradeEssay() { calls += 1; return strictMultimodalPayload('Student text.') },
    })
    const metadata = {
      requestVersion: 'multimodal-grading-request-v2', requestId: 'image-validator', essayId: 'image-validator-essay', pageIds: ['essay-1'],
      task: { taskId: 'image-task', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], rubric: { taskName: 'Synthetic task', materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], dimensions: imageRubricDimensions(), reviewWarnings: [] } },
    }
    const response = await request(createServer({ multimodalProvider: provider }))
      .post('/grading/grade-images')
      .field('metadata', JSON.stringify(metadata))
      .attach('pages', Buffer.from('PRIVATE-ESSAY-GIF'), { filename: 'private-essay.gif', contentType: 'image/gif' })
      .expect(400)

    expect(response.body).toMatchObject({ requestId: 'image-validator', status: 'failed', error: { code: 'invalid_request', retryable: false } })
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE|private-essay|gif/i)
    expect(calls).toBe(0)
  })

  it('forwards teacher-confirmed text once and rejects a different model transcript without exposing either text', async () => {
    const teacherText = 'Teacher corrected transcript.'
    const metadata = {
      requestVersion: 'multimodal-grading-request-v2', requestId: 'confirmed-image-request', essayId: 'confirmed-image-essay', pageIds: [], confirmedTranscript: teacherText,
      task: { taskId: 'image-task', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], rubric: { taskName: 'Synthetic task', materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], dimensions: imageRubricDimensions(), reviewWarnings: [] } },
    }
    const calls: Parameters<MultimodalProvider['gradeEssay']>[] = []
    const matchingProvider = fakeMultimodalProvider({
      async gradeEssay(input) { calls.push([input]); return strictMultimodalPayload(teacherText) },
    })
    await request(createServer({ multimodalProvider: matchingProvider }))
      .post('/grading/grade-images').field('metadata', JSON.stringify(metadata)).expect(200)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toMatchObject({ confirmedTranscript: teacherText, pages: [] })

    let mismatchCalls = 0
    const differentProvider = fakeMultimodalProvider({
      async gradeEssay() { mismatchCalls += 1; return strictMultimodalPayload('MODEL-DIFFERENT') },
    })
    const diagnostics: unknown[] = []
    const response = await request(createServer({
      multimodalProvider: differentProvider,
      onDiagnostic: (diagnostic: unknown) => diagnostics.push(diagnostic),
    }))
      .post('/grading/grade-images').field('metadata', JSON.stringify(metadata)).expect(503)
    expect(response.body).toMatchObject({ status: 'failed', error: { code: 'provider_invalid_response' } })
    expect(response.body.error).not.toHaveProperty('diagnosticCode')
    expect(diagnostics).toEqual([{ stage: 'normalization', diagnosticCode: 'confirmed_transcript_invariants' }])
    expect(JSON.stringify(diagnostics)).not.toMatch(/Teacher corrected transcript|MODEL-DIFFERENT/)
    expect(JSON.stringify(response.body)).not.toMatch(/Teacher corrected transcript|MODEL-DIFFERENT/)
    expect(mismatchCalls).toBe(1)
  })

  it('rejects image files attached to a teacher-confirmed text regrade', async () => {
    let calls = 0
    const provider = fakeMultimodalProvider({
      async gradeEssay() { calls += 1; throw new Error('must not run') },
    })
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
    const provider = fakeMultimodalProvider({
      async gradeEssay(input) {
        calls += 1
        const transcript = input.confirmedTranscript ?? ''
        return strictMultimodalPayload(transcript)
      },
    })
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

  it('rejects either lone surrogate before Provider use while accepting a valid astral pair', async () => {
    let calls = 0
    const provider = fakeMultimodalProvider({
      async gradeEssay(input) {
        calls += 1
        return strictMultimodalPayload(input.confirmedTranscript ?? '')
      },
    })
    const task = { taskId: 'unicode-task', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: [], rubric: { taskName: 'Synthetic task', materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: [], dimensions: imageRubricDimensions(), reviewWarnings: [] } }
    const app = createServer({ multimodalProvider: provider })

    for (const confirmedTranscript of [`Teacher ${'\uD800'} text.`, `Teacher ${'\uDC00'} text.`]) {
      const response = await request(app).post('/grading/grade-images').field('metadata', JSON.stringify({
        requestVersion: 'multimodal-grading-request-v2', requestId: 'malformed-unicode', essayId: 'unicode-essay', pageIds: [], task, confirmedTranscript,
      })).expect(400)
      expect(response.body).toMatchObject({ status: 'failed', error: { code: 'invalid_request', retryable: false } })
    }
    expect(calls).toBe(0)

    const astralText = 'Teacher \u{1F600} text.'
    await request(app).post('/grading/grade-images').field('metadata', JSON.stringify({
      requestVersion: 'multimodal-grading-request-v2', requestId: 'valid-unicode', essayId: 'unicode-essay', pageIds: [], task, confirmedTranscript: astralText,
    })).expect(200)
    expect(calls).toBe(1)
  })

  it('isolates image grading failures without retrying or exposing the raw essay', async () => {
    let calls = 0
    const provider = fakeMultimodalProvider({
      async gradeEssay() { calls += 1; throw new GradingProviderError('provider_unavailable', 'safe failure', true) },
    })
    const metadata = { requestVersion: 'multimodal-grading-request-v2', requestId: 'image-failure', essayId: 'essay-failure', pageIds: ['essay-1'], task: { taskId: 'image-task', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], rubric: { taskName: 'Synthetic task', materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], dimensions: imageRubricDimensions(), reviewWarnings: [] } } }
    const response = await request(createServer({ multimodalProvider: provider }))
      .post('/grading/grade-images').field('metadata', JSON.stringify(metadata))
      .attach('pages', Buffer.from('PRIVATE-ESSAY'), { filename: 'essay.png', contentType: 'image/png' }).expect(503)
    expect(response.body).toMatchObject({ requestId: 'image-failure', status: 'failed', error: { code: 'provider_unavailable' } })
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE-ESSAY')
    expect(calls).toBe(1)
  })

  it('enforces the grade-images hard deadline when the Provider ignores abort and later resolves', async () => {
    const teacherText = 'Teacher-confirmed synthetic text.'
    let calls = 0
    let observedSignal: AbortSignal | undefined
    let providerSettled = false
    const diagnostics: unknown[] = []
    const provider = fakeMultimodalProvider({
      async gradeEssay(input) {
        calls += 1
        observedSignal = input.signal
        return new Promise((resolve) => {
          setTimeout(() => {
            providerSettled = true
            resolve(strictMultimodalPayload(teacherText))
          }, 50)
        })
      },
    })
    const metadata = {
      requestVersion: 'multimodal-grading-request-v2',
      requestId: 'image-hard-deadline-resolve',
      essayId: 'image-hard-deadline-essay',
      pageIds: [],
      confirmedTranscript: teacherText,
      task: {
        taskId: 'image-task', fullScore: 15, materialSummary: 'Synthetic material.',
        writingRequirements: ['Write.'], constraints: ['English.'],
        rubric: {
          taskName: 'Synthetic task', materialSummary: 'Synthetic material.',
          writingRequirements: ['Write.'], constraints: ['English.'],
          dimensions: imageRubricDimensions(), reviewWarnings: [],
        },
      },
    }

    const response = await request(createServer({
      multimodalProvider: provider,
      timeoutMs: 5,
      onDiagnostic: (diagnostic: unknown) => diagnostics.push(diagnostic),
    }))
      .post('/grading/grade-images')
      .field('metadata', JSON.stringify(metadata))
      .expect(503)

    expect(response.body).toMatchObject({
      requestId: 'image-hard-deadline-resolve',
      status: 'failed',
      error: { code: 'provider_timeout', retryable: true },
    })
    expect(response.body).not.toHaveProperty('resultVersion')
    expect(calls).toBe(1)
    expect(observedSignal?.aborted).toBe(true)
    expect(providerSettled).toBe(false)
    const responseSnapshot = JSON.stringify(response.body)

    await new Promise((resolve) => setTimeout(resolve, 70))

    expect(providerSettled).toBe(true)
    expect(JSON.stringify(response.body)).toBe(responseSnapshot)
    expect(diagnostics).toEqual([{ stage: 'provider', diagnosticCode: 'provider_timeout' }])
  })

  it('absorbs a late grade-images rejection after returning the hard-deadline failure', async () => {
    const teacherText = 'Teacher-confirmed synthetic text.'
    let observedSignal: AbortSignal | undefined
    let providerSettled = false
    const diagnostics: unknown[] = []
    const provider = fakeMultimodalProvider({
      async gradeEssay(input) {
        observedSignal = input.signal
        return new Promise<never>((_resolve, reject) => {
          setTimeout(() => {
            providerSettled = true
            reject(new Error('PRIVATE-LATE-PROVIDER-REJECTION'))
          }, 50)
        })
      },
    })
    const metadata = {
      requestVersion: 'multimodal-grading-request-v2',
      requestId: 'image-hard-deadline-reject',
      essayId: 'image-hard-deadline-essay',
      pageIds: [],
      confirmedTranscript: teacherText,
      task: {
        taskId: 'image-task', fullScore: 15, materialSummary: 'Synthetic material.',
        writingRequirements: ['Write.'], constraints: ['English.'],
        rubric: {
          taskName: 'Synthetic task', materialSummary: 'Synthetic material.',
          writingRequirements: ['Write.'], constraints: ['English.'],
          dimensions: imageRubricDimensions(), reviewWarnings: [],
        },
      },
    }

    const response = await request(createServer({
      multimodalProvider: provider,
      timeoutMs: 5,
      onDiagnostic: (diagnostic: unknown) => diagnostics.push(diagnostic),
    }))
      .post('/grading/grade-images')
      .field('metadata', JSON.stringify(metadata))
      .expect(503)

    expect(response.body).toMatchObject({
      requestId: 'image-hard-deadline-reject',
      status: 'failed',
      error: { code: 'provider_timeout', retryable: true },
    })
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE-LATE-PROVIDER-REJECTION')
    expect(observedSignal?.aborted).toBe(true)
    expect(providerSettled).toBe(false)
    const responseSnapshot = JSON.stringify(response.body)

    await new Promise((resolve) => setTimeout(resolve, 70))

    expect(providerSettled).toBe(true)
    expect(JSON.stringify(response.body)).toBe(responseSnapshot)
    expect(diagnostics).toEqual([{ stage: 'provider', diagnosticCode: 'provider_timeout' }])
  })

  it('emits a provider-stage parse diagnostic without adding internal fields to the HTTP response', async () => {
    const diagnostics: unknown[] = []
    const provider = fakeMultimodalProvider({
      async gradeEssay() {
        throw new GradingProviderError(
          'provider_invalid_response',
          'PRIVATE-PROVIDER-ERROR-MESSAGE',
          true,
          'completion_content_json_malformed',
        )
      },
    })
    const metadata = { requestVersion: 'multimodal-grading-request-v2', requestId: 'provider-diagnostic', essayId: 'provider-diagnostic-essay', pageIds: ['essay-1'], task: { taskId: 'image-task', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], rubric: { taskName: 'Synthetic task', materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], dimensions: imageRubricDimensions(), reviewWarnings: [] } } }

    const response = await request(createServer({
      multimodalProvider: provider,
      onDiagnostic: (diagnostic: unknown) => diagnostics.push(diagnostic),
    }))
      .post('/grading/grade-images').field('metadata', JSON.stringify(metadata))
      .attach('pages', Buffer.from('PRIVATE-ESSAY'), { filename: 'private-name.png', contentType: 'image/png' }).expect(503)

    expect(response.body).toMatchObject({ status: 'failed', error: { code: 'provider_invalid_response' } })
    expect(response.body.error).not.toHaveProperty('diagnosticCode')
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE|ERROR-MESSAGE/)
    expect(diagnostics).toEqual([{ stage: 'provider', diagnosticCode: 'completion_content_json_malformed' }])
    expect(JSON.stringify(diagnostics)).not.toMatch(/PRIVATE|private-name|ERROR-MESSAGE/)
  })

  it('builds strict material context once from mixed image/text/image materials and preserves the teacher requirement', async () => {
    const calls: Parameters<MultimodalProvider['generateMaterialContext']>[] = []
    const context = materialContextFixture()
    const teacherRequirement = 'Continue the story in English and preserve the supplied opening.'
    const provider = fakeMultimodalProvider({
      async generateMaterialContext(input) { calls.push([input]); return context },
    })
    const response = await request(createServer({ multimodalProvider: provider }))
      .post('/tasks/material-context')
      .field('requestId', 'context-route-1')
      .field('fullScore', '15')
      .field('writingRequirement', teacherRequirement)
      .field('materialManifest', JSON.stringify([
        { id: 'image-1', kind: 'image', imageIndex: 0 },
        { id: 'text-1', kind: 'text', textIndex: 0 },
        { id: 'image-2', kind: 'image', imageIndex: 1 },
      ]))
      .field('textMaterials', JSON.stringify([{ displayName: 'prompt.docx', text: 'Synthetic source text.' }]))
      .attach('images', Buffer.from('first-image'), { filename: 'first.png', contentType: 'image/png' })
      .attach('images', Buffer.from('second-image'), { filename: 'second.webp', contentType: 'image/webp' })
      .expect(200)

    expect(response.body).toEqual({ requestId: 'context-route-1', status: 'success', materialContext: context })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toMatchObject({
      requestId: 'context-route-1',
      fullScore: 15,
      writingRequirement: teacherRequirement,
      materials: [
        { kind: 'image', unitId: 'image-1', mimeType: 'image/png', buffer: Buffer.from('first-image') },
        { kind: 'text', unitId: 'text-1', displayName: 'prompt.docx', text: 'Synthetic source text.' },
        { kind: 'image', unitId: 'image-2', mimeType: 'image/webp', buffer: Buffer.from('second-image') },
      ],
    })
  })

  it.each([
    ['multibyte UTF-8 text', '汉'],
    ['JSON-escaped control characters', '\u0000'],
  ] as const)('admits the semantic maximum of ten 30,000-code-point text materials with %s', async (_label, character) => {
    const calls: Parameters<MultimodalProvider['generateMaterialContext']>[] = []
    const provider = fakeMultimodalProvider({
      async generateMaterialContext(input) {
        calls.push([input])
        return materialContextFixture()
      },
    })
    const materialManifest = Array.from({ length: 10 }, (_, index) => ({
      id: `text-${index}`,
      kind: 'text',
      textIndex: index,
    }))
    const textMaterials = Array.from({ length: 10 }, (_, index) => ({
      displayName: `material-${index}.docx`,
      text: character.repeat(30_000),
    }))

    const response = await request(createServer({ multimodalProvider: provider }))
      .post('/tasks/material-context')
      .field('requestId', `context-semantic-max-${character.codePointAt(0)?.toString(16)}`)
      .field('fullScore', '15')
      .field('writingRequirement', 'Teacher requirement.')
      .field('materialManifest', JSON.stringify(materialManifest))
      .field('textMaterials', JSON.stringify(textMaterials))
      .expect(200)

    expect(response.body).toMatchObject({ status: 'success' })
    expect(calls).toHaveLength(1)
    const received = calls[0]?.[0].materials ?? []
    expect(received).toHaveLength(10)
    expect(received.every((material) => (
      material.kind === 'text'
      && Array.from(material.text).length === 30_000
      && material.text === character.repeat(30_000)
    ))).toBe(true)
  })

  it('keeps the task-material text field bounded and returns a content-free 413 above it', async () => {
    let calls = 0
    const privateMarker = 'PRIVATE-OVERSIZED-TEXT-MATERIAL'
    const provider = fakeMultimodalProvider({
      async generateMaterialContext() {
        calls += 1
        return materialContextFixture()
      },
    })
    const oversizedField = `${privateMarker}${'x'.repeat(
      MAX_TASK_MATERIAL_TEXT_FIELD_BYTES + 1 - privateMarker.length,
    )}`

    const response = await request(createServer({ multimodalProvider: provider }))
      .post('/tasks/material-context')
      .field('requestId', 'context-transport-too-large')
      .field('fullScore', '15')
      .field('writingRequirement', 'Teacher requirement.')
      .field('materialManifest', JSON.stringify([{ id: 'text-1', kind: 'text', textIndex: 0 }]))
      .field('textMaterials', oversizedField)
      .expect(413)

    expect(response.body).toMatchObject({
      requestId: 'context-transport-too-large',
      status: 'failed',
      error: { code: 'request_too_large', retryable: false },
    })
    expect(JSON.stringify(response.body)).not.toContain(privateMarker)
    expect(calls).toBe(0)
  })

  it('rejects an invalid material manifest before resolving or calling the Provider', async () => {
    let calls = 0
    const provider = fakeMultimodalProvider({
      async generateMaterialContext() { calls += 1; return materialContextFixture() },
    })
    const response = await request(createServer({ multimodalProvider: provider }))
      .post('/tasks/material-context')
      .field('requestId', 'context-invalid-manifest')
      .field('fullScore', '15')
      .field('writingRequirement', 'Teacher requirement.')
      .field('materialManifest', JSON.stringify([{ id: 'image-1', kind: 'image', imageIndex: 1 }]))
      .field('textMaterials', JSON.stringify([]))
      .attach('images', Buffer.from('PRIVATE-MATERIAL-BYTES'), { filename: 'private-material.png', contentType: 'image/png' })
      .expect(400)

    expect(response.body).toMatchObject({ requestId: 'context-invalid-manifest', status: 'failed', error: { code: 'invalid_request', retryable: false } })
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE|private-material|filename|bytes|stack/i)
    expect(calls).toBe(0)
  })

  it('maps one material-context timeout to the stable safe timeout failure', async () => {
    let calls = 0
    const provider = fakeMultimodalProvider({
      async generateMaterialContext(input) {
        calls += 1
        await new Promise<void>((_resolve, reject) => {
          input.signal.addEventListener('abort', () => reject(new Error('PRIVATE-ABORT-CONTENT')), { once: true })
        })
        throw new Error('unreachable')
      },
    })
    const response = await request(createServer({ multimodalProvider: provider, timeoutMs: 1 }))
      .post('/tasks/material-context')
      .field('requestId', 'context-timeout')
      .field('fullScore', '15')
      .field('writingRequirement', 'Teacher requirement.')
      .field('materialManifest', JSON.stringify([{ id: 'text-1', kind: 'text', textIndex: 0 }]))
      .field('textMaterials', JSON.stringify([{ displayName: 'prompt.docx', text: 'PRIVATE-TIMEOUT-MATERIAL' }]))
      .expect(503)

    expect(response.body).toMatchObject({ requestId: 'context-timeout', status: 'failed', error: { code: 'provider_timeout', retryable: true } })
    expect(response.body).not.toHaveProperty('materialContext')
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE|ABORT|TIMEOUT-MATERIAL/)
    expect(calls).toBe(1)
  })

  it('enforces the material-context hard deadline when the Provider ignores abort and later resolves', async () => {
    let calls = 0
    let observedSignal: AbortSignal | undefined
    let providerSettled = false
    const diagnostics: unknown[] = []
    const provider = fakeMultimodalProvider({
      async generateMaterialContext(input) {
        calls += 1
        observedSignal = input.signal
        return new Promise<TaskMaterialContextV1>((resolve) => {
          setTimeout(() => {
            providerSettled = true
            resolve(materialContextFixture())
          }, 50)
        })
      },
    })
    const response = await request(createServer({
      multimodalProvider: provider,
      timeoutMs: 5,
      onDiagnostic: (diagnostic: unknown) => diagnostics.push(diagnostic),
    }))
      .post('/tasks/material-context')
      .field('requestId', 'context-hard-deadline')
      .field('fullScore', '15')
      .field('writingRequirement', 'Teacher requirement.')
      .field('materialManifest', JSON.stringify([{ id: 'text-1', kind: 'text', textIndex: 0 }]))
      .field('textMaterials', JSON.stringify([{ displayName: 'prompt.docx', text: 'Synthetic source text.' }]))
      .expect(503)

    expect(response.body).toMatchObject({
      requestId: 'context-hard-deadline', status: 'failed',
      error: { code: 'provider_timeout', retryable: true },
    })
    expect(response.body).not.toHaveProperty('materialContext')
    expect(calls).toBe(1)
    expect(observedSignal?.aborted).toBe(true)
    expect(providerSettled).toBe(false)
    const responseSnapshot = JSON.stringify(response.body)

    await new Promise((resolve) => setTimeout(resolve, 70))

    expect(providerSettled).toBe(true)
    expect(JSON.stringify(response.body)).toBe(responseSnapshot)
    expect(diagnostics).toEqual([{ stage: 'provider', diagnosticCode: 'provider_timeout' }])
  })

  it('maps material-context authentication errors without exposing Provider or material content', async () => {
    let calls = 0
    const diagnostics: unknown[] = []
    const provider = fakeMultimodalProvider({
      async generateMaterialContext() {
        calls += 1
        throw new GradingProviderError('provider_auth_failed', 'PRIVATE-AUTH-CONTENT', false)
      },
    })
    const response = await request(createServer({
      multimodalProvider: provider,
      onDiagnostic: (diagnostic: unknown) => diagnostics.push(diagnostic),
    }))
      .post('/tasks/material-context')
      .field('requestId', 'context-auth')
      .field('fullScore', '15')
      .field('writingRequirement', 'PRIVATE-TEACHER-CONTENT')
      .field('materialManifest', JSON.stringify([{ id: 'text-1', kind: 'text', textIndex: 0 }]))
      .field('textMaterials', JSON.stringify([{ displayName: 'private.docx', text: 'PRIVATE-MATERIAL-CONTENT' }]))
      .expect(503)

    expect(response.body).toEqual({
      requestId: 'context-auth', status: 'failed',
      error: { code: 'provider_auth_failed', message: 'AI 批改服务认证失败。', retryable: false },
    })
    expect(diagnostics).toEqual([{ stage: 'provider', diagnosticCode: 'provider_auth_failed' }])
    expect(JSON.stringify({ response: response.body, diagnostics })).not.toMatch(/PRIVATE|private\.docx|AUTH-CONTENT|MATERIAL-CONTENT/)
    expect(calls).toBe(1)
  })

  it('revalidates material context at the route boundary and emits content-free diagnostics', async () => {
    const diagnostics: unknown[] = []
    const invalidContext = { ...materialContextFixture(), unexpected: 'PRIVATE-PROVIDER-CONTEXT' } as unknown as TaskMaterialContextV1
    const provider = fakeMultimodalProvider({
      async generateMaterialContext() { return invalidContext },
    })
    const response = await request(createServer({
      multimodalProvider: provider,
      onDiagnostic: (diagnostic: unknown) => diagnostics.push(diagnostic),
    }))
      .post('/tasks/material-context')
      .field('requestId', 'context-invalid-provider')
      .field('fullScore', '15')
      .field('writingRequirement', 'Teacher requirement.')
      .field('materialManifest', JSON.stringify([{ id: 'text-1', kind: 'text', textIndex: 0 }]))
      .field('textMaterials', JSON.stringify([{ displayName: 'prompt.docx', text: 'PRIVATE-REQUEST-CONTENT' }]))
      .expect(503)

    expect(response.body).toMatchObject({ requestId: 'context-invalid-provider', status: 'failed', error: { code: 'provider_invalid_response', retryable: true } })
    expect(response.body).not.toHaveProperty('materialContext')
    expect(diagnostics).toEqual([{ stage: 'normalization', diagnosticCode: 'material_context_validation' }])
    expect(JSON.stringify({ response: response.body, diagnostics })).not.toMatch(/PRIVATE|REQUEST-CONTENT|PROVIDER-CONTEXT/)
  })

  it('sends optional empty teacher input and mixed materials to the rubric Provider in manifest order', async () => {
    const generatedRubric = generatedRubricFixture()
    const calls: Parameters<MultimodalProvider['generateRubric']>[] = []
    const provider = fakeMultimodalProvider({
      async generateRubric(input) { calls.push([input]); return generatedRubric },
    })

    const response = await request(createServer({ multimodalProvider: provider }))
      .post('/tasks/rubric')
      .field('requestId', 'rubric-route-1')
      .field('fullScore', '15')
      .field('writingRequirement', '   ')
      .field('materialManifest', JSON.stringify([
        { id: 'image-1', kind: 'image', imageIndex: 0 },
        { id: 'text-1', kind: 'text', textIndex: 0 },
        { id: 'image-2', kind: 'image', imageIndex: 1 },
      ]))
      .field('textMaterials', JSON.stringify([{ displayName: 'prompt.docx', text: 'Synthetic source text.' }]))
      .attach('images', Buffer.from('first-image'), { filename: 'first.png', contentType: 'image/png' })
      .attach('images', Buffer.from('second-image'), { filename: 'second.jpg', contentType: 'image/jpeg' })
      .expect(200)

    expect(response.body).toEqual({ requestId: 'rubric-route-1', status: 'success', rubric: generatedRubric })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toMatchObject({
      requestId: 'rubric-route-1', fullScore: 15,
      materials: [
        { kind: 'image', unitId: 'image-1', mimeType: 'image/png', buffer: Buffer.from('first-image') },
        { kind: 'text', unitId: 'text-1', displayName: 'prompt.docx', text: 'Synthetic source text.' },
        { kind: 'image', unitId: 'image-2', mimeType: 'image/jpeg', buffer: Buffer.from('second-image') },
      ],
    })
    expect(calls[0]?.[0]).not.toHaveProperty('writingRequirement')
    expect(calls[0]?.[0]).not.toHaveProperty('pages')
  })

  it('maps a rubric provider timeout without returning partial task state', async () => {
    const provider = fakeMultimodalProvider({
      async generateRubric(input) {
        await new Promise<void>((_resolve, reject) => {
          input.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
        throw new Error('unreachable')
      },
    })
    const response = await request(createServer({ multimodalProvider: provider, timeoutMs: 1 }))
      .post('/tasks/rubric')
      .field('requestId', 'rubric-timeout')
      .field('fullScore', '15')
      .field('materialManifest', JSON.stringify([{ id: 'text-1', kind: 'text', textIndex: 0 }]))
      .field('textMaterials', JSON.stringify([{ displayName: 'prompt.docx', text: 'Synthetic source text.' }]))
      .expect(503)

    expect(response.body).toMatchObject({
      requestId: 'rubric-timeout', status: 'failed',
      error: { code: 'provider_timeout', retryable: true },
    })
    expect(response.body).not.toHaveProperty('rubric')
  })

  it('enforces the rubric hard deadline when the Provider ignores abort and later resolves', async () => {
    let calls = 0
    let observedSignal: AbortSignal | undefined
    let providerSettled = false
    const diagnostics: unknown[] = []
    const provider = fakeMultimodalProvider({
      async generateRubric(input) {
        calls += 1
        observedSignal = input.signal
        return new Promise((resolve) => {
          setTimeout(() => {
            providerSettled = true
            resolve(generatedRubricFixture())
          }, 50)
        })
      },
    })
    const response = await request(createServer({
      multimodalProvider: provider,
      timeoutMs: 5,
      onDiagnostic: (diagnostic: unknown) => diagnostics.push(diagnostic),
    }))
      .post('/tasks/rubric')
      .field('requestId', 'rubric-hard-deadline')
      .field('fullScore', '15')
      .field('materialManifest', JSON.stringify([{ id: 'text-1', kind: 'text', textIndex: 0 }]))
      .field('textMaterials', JSON.stringify([{ displayName: 'prompt.docx', text: 'Synthetic source text.' }]))
      .expect(503)

    expect(response.body).toMatchObject({
      requestId: 'rubric-hard-deadline', status: 'failed',
      error: { code: 'provider_timeout', retryable: true },
    })
    expect(response.body).not.toHaveProperty('rubric')
    expect(calls).toBe(1)
    expect(observedSignal?.aborted).toBe(true)
    expect(providerSettled).toBe(false)
    const responseSnapshot = JSON.stringify(response.body)

    await new Promise((resolve) => setTimeout(resolve, 70))

    expect(providerSettled).toBe(true)
    expect(JSON.stringify(response.body)).toBe(responseSnapshot)
    expect(diagnostics).toEqual([{ stage: 'provider', diagnosticCode: 'provider_timeout' }])
  })

  it('fails closed when an injected rubric provider returns a generated rubric without the exact 5% legibility dimension', async () => {
    const diagnostics: unknown[] = []
    const provider = fakeMultimodalProvider({
      async generateRubric() {
        return {
          taskName: 'Synthetic task', materialSummary: 'Synthetic material.', writingRequirements: ['Write clearly.'], constraints: [],
          dimensions: [{ id: 'content', name: 'Content', weight: 100, description: 'Cover the task.', deductionFocus: [], sourceEvidence: [] }],
          reviewWarnings: [],
        }
      },
    })
    const response = await request(createServer({
      multimodalProvider: provider,
      onDiagnostic: (diagnostic: unknown) => diagnostics.push(diagnostic),
    }))
      .post('/tasks/rubric')
      .field('requestId', 'rubric-invalid-generated')
      .field('fullScore', '15')
      .field('materialManifest', JSON.stringify([{ id: 'text-1', kind: 'text', textIndex: 0 }]))
      .field('textMaterials', JSON.stringify([{ displayName: 'prompt.docx', text: 'Synthetic source text.' }]))
      .expect(503)

    expect(response.body).toMatchObject({ requestId: 'rubric-invalid-generated', status: 'failed', error: { code: 'provider_invalid_response', retryable: true } })
    expect(response.body).not.toHaveProperty('rubric')
    expect(diagnostics).toEqual([{ stage: 'normalization', diagnosticCode: 'rubric_validation' }])
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

  it('creates a sanitized stderr diagnostic sink only for the exact opt-in flag', async () => {
    const diagnosticsModule = await import('./safeDiagnostics.js') as Record<string, unknown>
    const createSink = diagnosticsModule.createSafeDiagnosticStderrSink
    expect(createSink).toBeTypeOf('function')
    if (typeof createSink !== 'function') return
    const lines: string[] = []
    const write = (line: string) => lines.push(line)
    const factory = createSink as (flag: string | undefined, output: (line: string) => void) => ((diagnostic: { stage: 'provider' | 'normalization'; diagnosticCode: string }) => void) | undefined

    expect(factory(undefined, write)).toBeUndefined()
    expect(factory('true', write)).toBeUndefined()
    const sink = factory('1', write)
    expect(sink).toBeTypeOf('function')
    sink?.({ stage: 'normalization', diagnosticCode: 'result_policy' })
    sink?.({ stage: 'provider', diagnosticCode: 'PRIVATE PROVIDER MESSAGE' })

    expect(lines).toEqual([
      '{"event":"grading_safe_diagnostic","stage":"normalization","diagnosticCode":"result_policy"}',
      '{"event":"grading_safe_diagnostic","stage":"provider","diagnosticCode":"diagnostic_unavailable"}',
    ])
    expect(lines.join('\n')).not.toMatch(/PRIVATE|MESSAGE/)
  })

})
