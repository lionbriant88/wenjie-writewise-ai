import { readFileSync } from 'node:fs'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import {
  createGatewayExecutionServices,
  createServer,
  MAX_CLASS_REVIEW_JSON_BYTES,
  MAX_IMAGE_GRADING_METADATA_BYTES,
  type GatewayExecutionTimers,
} from './server.js'
import { MAX_TASK_MATERIAL_TEXT_FIELD_BYTES } from './multipartTaskMaterials.js'
import { GradingProviderError } from './providers/providerTypes.js'
import type { MultimodalProvider } from './providers/multimodalProviderTypes.js'
import type { GeneratedRubricV1, TaskMaterialContextV1 } from './multimodal/types.js'
import type { GatewayRuntimeConfig } from './gatewayRuntimeConfig.js'
import { createProviderTelemetryRecorder } from './providerTelemetry.js'
import { KimiMultimodalProvider } from './providers/kimiMultimodalProvider.js'
import { createKimiTransport, type KimiCompletionInput, type KimiTransport } from './providers/kimiTransport.js'
import type { ClassReviewSynthesisProvider } from './providers/classReviewSynthesisProviderTypes.js'
import type { ClassReviewFramingCalibration } from './classReviewSynthesis/framingCalibrations.js'
import type { ClassReviewProviderOutputV1 } from './classReviewSynthesis/types.js'

const classReviewFixture = JSON.parse(readFileSync(
  new URL('../../test-fixtures/class-review/synthesis-contracts.json', import.meta.url),
  'utf8',
)) as {
  requests: { withGroups: Record<string, unknown> }
  results: { succeeded: Record<string, unknown> & { output: ClassReviewProviderOutputV1 } }
}
const CLASS_REVIEW_TOKEN = 'class-review-service-token-0123456789'
const classReviewCalibration: ClassReviewFramingCalibration = {
  apiBase: 'https://api.moonshot.cn/v1', model: 'kimi-k3', reasoningEffort: 'low',
  policyVersion: 'class-review-policy-v1', schemaVersion: 'kimi-class-review-output-v1',
  projectionVersion: 'class-review-projection-v1', budgetVersion: 'class-review-prompt-budget-v1',
  wireSerializationVersion: 'class-review-wire-serialization-v1', framingTokens: 512,
}

function classReviewObservation(id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') {
  return {
    attemptDiagnosticId: id,
    finishReason: 'stop' as const,
    usage: {
      promptTokens: { status: 'known' as const, value: 100 },
      completionTokens: { status: 'known' as const, value: 50 },
      totalTokens: { status: 'known' as const, value: 150 },
      cachedTokens: { status: 'unknown' as const, reason: 'absent' as const },
    },
    providerElapsedMs: 2,
  }
}

function fakeClassReviewProvider(
  implementation?: ClassReviewSynthesisProvider['synthesize'],
): ClassReviewSynthesisProvider {
  return {
    synthesize: implementation ?? (async () => ({
      value: classReviewFixture.results.succeeded.output,
      attempts: [classReviewObservation()],
    })),
  }
}

interface RawMultimodalProvider {
  generateMaterialContext(input: Parameters<MultimodalProvider['generateMaterialContext']>[0]): Promise<TaskMaterialContextV1>
  generateRubric(input: Parameters<MultimodalProvider['generateRubric']>[0]): Promise<GeneratedRubricV1>
  gradeEssay(input: Parameters<MultimodalProvider['gradeEssay']>[0]): Promise<unknown>
}

function fakeMultimodalProvider(
  overrides: Partial<RawMultimodalProvider> = {},
): MultimodalProvider {
  return {
    async generateMaterialContext(input) {
      if (!overrides.generateMaterialContext) throw new Error('not used')
      return { value: await overrides.generateMaterialContext(input), attempts: [] }
    },
    async generateRubric(input) {
      if (!overrides.generateRubric) throw new Error('not used')
      return { value: await overrides.generateRubric(input), attempts: [] }
    },
    async gradeEssay(input) {
      if (!overrides.gradeEssay) throw new Error('not used')
      return { value: await overrides.gradeEssay(input), attempts: [] }
    },
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
    fullTextRevision: { sentencePairs: [], logicNotes: [], logicIssues: [] },
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

function legacyRuntimeConfig(): GatewayRuntimeConfig {
  return {
    provider: 'kimi', rubricStrategy: 'two-pass-legacy', essayPromptProfile: 'legacy', executionRegistry: 'direct-legacy',
    deadlines: { httpMs: 360_000, providerFinalMs: 420_000, settlementGraceMs: 30_000 },
    admission: { hardLimit: 4 }, registry: { terminalTtlMs: 86_400_000, maxEntries: 2_000 },
    retry: { maxProviderAttempts: 2, maxRateLimitRequeues: 5, baseMs: 2_000, capMs: 60_000, pauseAfterMs: 900_000 },
    classReviewSynthesis: { mode: 'disabled' },
    kimi: {
      apiBase: 'https://api.moonshot.cn/v1', model: 'kimi-k3', reasoningEffort: 'low', promptCacheSecret: '',
      stageBudgets: { material_context: 16_384, rubric_generation: 16_384, essay_grading_images: 16_384, essay_regrading_text: 16_384 },
    },
  }
}

function fakeClassReviewRuntimeConfig(): GatewayRuntimeConfig {
  return memoryRuntimeConfig({
    classReviewSynthesis: {
      mode: 'fake',
      serviceToken: CLASS_REVIEW_TOKEN,
      maxCompletionTokens: 3_072,
    },
  })
}

function memoryRuntimeConfig(overrides: Partial<GatewayRuntimeConfig> = {}): GatewayRuntimeConfig {
  const legacy = legacyRuntimeConfig()
  return {
    ...legacy,
    rubricStrategy: 'single-pass-v1',
    essayPromptProfile: 'optimized-v1',
    executionRegistry: 'memory-v1',
    deadlines: { httpMs: 100, providerFinalMs: 200, settlementGraceMs: 20 },
    registry: { terminalTtlMs: 1_000, maxEntries: 100 },
    ...overrides,
  }
}

class GatewayManualClock implements GatewayExecutionTimers {
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error('Timed out waiting for synthetic test state.')
}

function imageGradeMetadata(requestId: string, essayId = 'memory-essay', confirmedTranscript = 'Teacher-confirmed synthetic text.') {
  return {
    requestVersion: 'multimodal-grading-request-v2' as const,
    requestId,
    essayId,
    pageIds: [],
    confirmedTranscript,
    task: {
      taskId: 'memory-task', fullScore: 15, materialSummary: 'Synthetic material.',
      writingRequirements: ['Write.'], constraints: ['English.'],
      rubric: {
        taskName: 'Synthetic task', materialSummary: 'Synthetic material.',
        writingRequirements: ['Write.'], constraints: ['English.'],
        dimensions: imageRubricDimensions(), reviewWarnings: [],
      },
    },
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
    const accepted = await request(createServer({ multimodalProvider: provider }))
      .post('/grading/grade-images').field('metadata', JSON.stringify(base)).expect(200)
    expect(accepted.body).toMatchObject({
      resultVersion: 'grading-result-v2',
      status: 'success',
      fullTextRevision: {
        correctedText: base.confirmedTranscript,
        improvedText: base.confirmedTranscript,
      },
    })

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

  it('serves a normal single-pass rubric with one transport completion and one copy of each material', async () => {
    const completionInputs: KimiCompletionInput[] = []
    const transport: KimiTransport = {
      async complete(input) {
        completionInputs.push(input)
        return {
          value: generatedRubricFixture(),
          observation: {
            attemptDiagnosticId: `rubric-route-attempt-${completionInputs.length}`,
            finishReason: 'stop',
            providerElapsedMs: 1,
            usage: {
              promptTokens: { status: 'unknown', reason: 'absent' },
              completionTokens: { status: 'unknown', reason: 'absent' },
              totalTokens: { status: 'unknown', reason: 'absent' },
              cachedTokens: { status: 'unknown', reason: 'absent' },
            },
          },
        }
      },
    }
    const provider = new KimiMultimodalProvider(transport, 'single-pass-v1', 'legacy', '')

    const response = await request(createServer({ multimodalProvider: provider }))
      .post('/tasks/rubric')
      .field('requestId', 'single-pass-rubric-route')
      .field('fullScore', '15')
      .field('writingRequirement', 'Teacher requirement.')
      .field('materialManifest', JSON.stringify([
        { id: 'text-1', kind: 'text', textIndex: 0 },
        { id: 'image-1', kind: 'image', imageIndex: 0 },
      ]))
      .field('textMaterials', JSON.stringify([{ displayName: 'prompt.docx', text: 'UNIQUE-TEXT-MATERIAL' }]))
      .attach('images', Buffer.from('unique-image-material'), { filename: 'prompt.png', contentType: 'image/png' })
      .expect(200)

    expect(response.body.rubric.writingRequirements).toEqual(['Teacher requirement.', 'Write clearly.'])
    expect(completionInputs).toHaveLength(1)
    const messages = JSON.stringify(completionInputs[0]?.messages)
    expect(messages.match(/UNIQUE-TEXT-MATERIAL/g)).toHaveLength(1)
    expect(messages.match(/dW5pcXVlLWltYWdlLW1hdGVyaWFs/g)).toHaveLength(1)
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

  it('returns the safe Phase 0 runtime snapshot without secrets, IDs, usage, or content', async () => {
    const response = await request(createServer({ runtimeConfig: legacyRuntimeConfig() })).get('/health').expect(200)
    expect(response.body).toEqual({
      ok: true,
      service: 'grading-gateway',
      runtime: {
        provider: 'kimi', model: 'kimi-k3', reasoningEffort: 'low',
        deadlines: { httpMs: 360_000, providerFinalMs: 420_000, settlementGraceMs: 30_000 },
        stageBudgets: { material_context: 16_384, rubric_generation: 16_384, essay_grading_images: 16_384, essay_regrading_text: 16_384 },
        hardLimit: 4,
        modes: { rubricStrategy: 'two-pass-legacy', essayPromptProfile: 'legacy', executionRegistry: 'direct-legacy' },
        classReviewSynthesis: { mode: 'disabled' },
        admission: { managed: false },
      },
    })
    expect(JSON.stringify(response.body)).not.toMatch(/key|secret|requestId|essayId|taskId|usage|token|content|digest/i)
  })

  it('exposes only safe class-review mode, budget and invariant status in health', async () => {
    const response = await request(createServer({
      runtimeConfig: fakeClassReviewRuntimeConfig(),
      classReviewProvider: fakeClassReviewProvider(),
      classReviewFramingCalibration: classReviewCalibration,
    })).get('/health').expect(200)
    expect(response.body.runtime.classReviewSynthesis).toEqual({
      mode: 'fake', maxCompletionTokens: 3_072, promptInvariant: 'not_applicable',
    })
    expect(JSON.stringify(response.body.runtime.classReviewSynthesis)).not.toMatch(
      /serviceToken|secret|apiKey|calibration/i,
    )
  })

  it('reports the live redacted memory admission state and exposes no anonymous resume route', async () => {
    const runtimeConfig = memoryRuntimeConfig()
    const executionServices = createGatewayExecutionServices(runtimeConfig)
    for (let successIndex = 0; successIndex < 8; successIndex += 1) {
      const decision = executionServices.admission.tryAcquire()
      if (!decision.accepted) throw new Error('Expected synthetic admission')
      decision.lease.release({ kind: 'success' })
    }
    const active = executionServices.admission.tryAcquire()
    if (!active.accepted) throw new Error('Expected synthetic active lease')
    executionServices.admission.pause('provider_access_denied')

    const app = createServer({ runtimeConfig, executionServices })
    const response = await request(app).get('/health').expect(200)
    expect(response.body.runtime.admission).toEqual({
      managed: true,
      paused: true,
      pauseReason: 'provider_access_denied',
      rateLimited: false,
      hardLimit: 4,
      target: 2,
      active: 1,
      stableSuccesses: 0,
    })
    expect(JSON.stringify(response.body)).not.toMatch(/key|secret|requestId|essayId|taskId|usage|token|content|digest/i)
    await request(app).post('/health/resume').expect(404)
    active.lease.release({ kind: 'confirmed_failure' })
  })

  it('maps a real Kimi HTTP 403 through registry admission to one public auth pause without dispatching later essays', async () => {
    const runtimeConfig = memoryRuntimeConfig()
    const executionServices = createGatewayExecutionServices(runtimeConfig)
    let upstreamCalls = 0
    const transport = createKimiTransport({
      apiKey: 'test-only-not-a-real-key',
      apiBase: 'https://provider.invalid/v1',
      model: 'kimi-k3',
      reasoningEffort: 'low',
      maxCompletionTokens: 16_384,
      monotonicNow: () => 0,
      fetchImpl: async () => {
        upstreamCalls += 1
        return new Response('{"error":"PRIVATE-UPSTREAM-BODY"}', { status: 403 })
      },
    })
    const provider = new KimiMultimodalProvider(
      transport,
      runtimeConfig.rubricStrategy,
      runtimeConfig.essayPromptProfile,
      'synthetic-cache-secret',
    )
    const app = createServer({ multimodalProvider: provider, runtimeConfig, executionServices })

    const first = await request(app)
      .post('/grading/grade-images')
      .field('metadata', JSON.stringify(imageGradeMetadata('kimi-403-first', 'kimi-403-essay-1')))
      .expect(503)
    expect(first.body).toEqual({
      requestId: 'kimi-403-first', status: 'failed',
      error: { code: 'provider_auth_failed', message: 'AI 批改服务认证失败。', retryable: false },
    })
    expect(JSON.stringify(first.body)).not.toContain('PRIVATE-UPSTREAM-BODY')
    expect(executionServices.admission.snapshot().pauseReason).toBe('provider_auth_failed')

    const blocked = await request(app)
      .post('/grading/grade-images')
      .field('metadata', JSON.stringify(imageGradeMetadata('kimi-403-blocked', 'kimi-403-essay-2')))
      .expect(503)
    expect(blocked.body).toEqual({
      requestId: 'kimi-403-blocked', status: 'failed',
      error: { code: 'provider_auth_failed', message: 'AI 批改服务认证失败。', retryable: false },
    })
    expect(upstreamCalls).toBe(1)
  })

  it('projects nested health configuration through strict allowlists under hostile type escape', async () => {
    const base = legacyRuntimeConfig()
    const hostile = {
      ...base,
      deadlines: {
        ...base.deadlines,
        apiKey: 'PRIVATE-DEADLINE-API-KEY',
        requestId: 'PRIVATE-DEADLINE-REQUEST-ID',
      },
      kimi: {
        ...base.kimi,
        stageBudgets: {
          ...base.kimi.stageBudgets,
          secret: 'PRIVATE-STAGE-SECRET',
          essayId: 'PRIVATE-STAGE-ESSAY-ID',
        },
      },
    } as unknown as GatewayRuntimeConfig

    const response = await request(createServer({ runtimeConfig: hostile })).get('/health').expect(200)

    expect(response.body.runtime.deadlines).toEqual({
      httpMs: 360_000,
      providerFinalMs: 420_000,
      settlementGraceMs: 30_000,
    })
    expect(response.body.runtime.stageBudgets).toEqual({
      material_context: 16_384,
      rubric_generation: 16_384,
      essay_grading_images: 16_384,
      essay_regrading_text: 16_384,
    })
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE|apiKey|secret|requestId|essayId/i)
  })

  it('accounts for a completed attempt before strict normalization rejects its business payload', async () => {
    const metrics: unknown[] = []
    const telemetry = createProviderTelemetryRecorder({
      emit: (metric) => metrics.push(metric),
      processDiagnosticIdFactory: () => '11111111-1111-4111-8111-111111111111',
    })
    const provider = fakeMultimodalProvider()
    provider.gradeEssay = async () => ({
      value: { malformed: true },
      attempts: [{
        attemptDiagnosticId: '22222222-2222-4222-8222-222222222222', finishReason: 'stop', providerElapsedMs: 11,
        usage: {
          promptTokens: { status: 'known', value: 10 }, completionTokens: { status: 'known', value: 5 },
          totalTokens: { status: 'known', value: 15 }, cachedTokens: { status: 'known', value: 2 },
        },
      }],
    })
    const metadata = {
      requestVersion: 'multimodal-grading-request-v2', requestId: 'telemetry-normalization', essayId: 'telemetry-essay', pageIds: [], confirmedTranscript: 'Synthetic confirmed text.',
      task: { taskId: 'telemetry-task', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], rubric: { taskName: 'Synthetic task', materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], dimensions: imageRubricDimensions(), reviewWarnings: [] } },
    }
    const response = await request(createServer({ multimodalProvider: provider, runtimeConfig: legacyRuntimeConfig(), providerTelemetry: telemetry }))
      .post('/grading/grade-images').field('metadata', JSON.stringify(metadata)).expect(503)

    expect(metrics.filter((metric) => (metric as { event?: string }).event === 'provider_attempt')).toHaveLength(1)
    expect(telemetry.snapshot()).toMatchObject({
      uniqueAttempts: 1,
      totals: { totalTokens: { status: 'known', value: 15 } },
    })
    expect(JSON.stringify(response.body)).not.toMatch(/token|usage|attemptDiagnosticId/i)
  })

  it('accounts for controlled error attempt observations without exposing them in failure JSON', async () => {
    const metrics: unknown[] = []
    const telemetry = createProviderTelemetryRecorder({
      emit: (metric) => metrics.push(metric),
      processDiagnosticIdFactory: () => '33333333-3333-4333-8333-333333333333',
    })
    const provider = fakeMultimodalProvider()
    provider.gradeEssay = async () => {
      throw new GradingProviderError('provider_invalid_response', 'PRIVATE-RAW-RESPONSE', true, undefined, {
        termination: 'confirmed',
        attemptObservations: [{
          attemptDiagnosticId: '44444444-4444-4444-8444-444444444444', finishReason: 'length', providerElapsedMs: 19,
          usage: {
            promptTokens: { status: 'known', value: 12 }, completionTokens: { status: 'known', value: 8 },
            totalTokens: { status: 'known', value: 20 }, cachedTokens: { status: 'unknown', reason: 'absent' },
          },
        }],
      })
    }
    const metadata = {
      requestVersion: 'multimodal-grading-request-v2', requestId: 'telemetry-error', essayId: 'telemetry-error-essay', pageIds: [], confirmedTranscript: 'Synthetic confirmed text.',
      task: { taskId: 'telemetry-error-task', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], rubric: { taskName: 'Synthetic task', materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], dimensions: imageRubricDimensions(), reviewWarnings: [] } },
    }
    const response = await request(createServer({ multimodalProvider: provider, runtimeConfig: legacyRuntimeConfig(), providerTelemetry: telemetry }))
      .post('/grading/grade-images').field('metadata', JSON.stringify(metadata)).expect(503)

    expect(metrics.filter((metric) => (metric as { event?: string }).event === 'provider_attempt')).toHaveLength(1)
    expect(telemetry.snapshot()).toMatchObject({
      uniqueAttempts: 1,
      totals: { totalTokens: { status: 'known', value: 20 } },
    })
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE|token|usage|attemptDiagnosticId/i)
  })

  it('accounts once for a completed Provider attempt that settles after the HTTP deadline', async () => {
    const telemetry = createProviderTelemetryRecorder({
      processDiagnosticIdFactory: () => '55555555-5555-4555-8555-555555555555',
    })
    const provider = fakeMultimodalProvider()
    provider.gradeEssay = async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      return {
        value: strictMultimodalPayload('Synthetic confirmed text.'),
        attempts: [{
          attemptDiagnosticId: '66666666-6666-4666-8666-666666666666', finishReason: 'stop', providerElapsedMs: 29,
          usage: {
            promptTokens: { status: 'known', value: 18 }, completionTokens: { status: 'known', value: 7 },
            totalTokens: { status: 'known', value: 25 }, cachedTokens: { status: 'unknown', reason: 'absent' },
          },
        }],
      }
    }
    const metadata = {
      requestVersion: 'multimodal-grading-request-v2', requestId: 'telemetry-late', essayId: 'telemetry-late-essay', pageIds: [], confirmedTranscript: 'Synthetic confirmed text.',
      task: { taskId: 'telemetry-late-task', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], rubric: { taskName: 'Synthetic task', materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], dimensions: imageRubricDimensions(), reviewWarnings: [] } },
    }
    await request(createServer({ multimodalProvider: provider, runtimeConfig: legacyRuntimeConfig(), providerTelemetry: telemetry, timeoutMs: 5 }))
      .post('/grading/grade-images').field('metadata', JSON.stringify(metadata)).expect(503)
    expect(telemetry.snapshot().uniqueAttempts).toBe(0)

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(telemetry.snapshot()).toMatchObject({
      uniqueAttempts: 1,
      totals: { totalTokens: { status: 'known', value: 25 } },
    })
  })

  it('deduplicates concurrent memory-v1 grading while binding each caller request ID', async () => {
    const providerResult = deferred<ReturnType<typeof strictMultimodalPayload>>()
    let calls = 0
    const provider = fakeMultimodalProvider({
      async gradeEssay() {
        calls += 1
        return providerResult.promise
      },
    })
    const app = createServer({ multimodalProvider: provider, runtimeConfig: memoryRuntimeConfig() })
    const first = request(app).post('/grading/grade-images')
      .field('metadata', JSON.stringify(imageGradeMetadata('memory-caller-a')))
    const second = request(app).post('/grading/grade-images')
      .field('metadata', JSON.stringify(imageGradeMetadata('memory-caller-b')))
    const responses = Promise.all([first, second])

    await waitFor(() => calls === 1)
    providerResult.resolve(strictMultimodalPayload('Teacher-confirmed synthetic text.'))
    const [firstResponse, secondResponse] = await responses

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    expect(new Set([firstResponse.body.requestId, secondResponse.body.requestId]))
      .toEqual(new Set(['memory-caller-a', 'memory-caller-b']))
    expect(calls).toBe(1)
    expect(JSON.stringify([firstResponse.body, secondResponse.body]))
      .not.toMatch(/logicalRequestId|payloadHash|attempts|telemetry|registry/i)
  })

  it('returns a content-free 409 when one memory-v1 logical request ID is reused with another payload', async () => {
    const providerResult = deferred<ReturnType<typeof strictMultimodalPayload>>()
    let calls = 0
    const provider = fakeMultimodalProvider({
      async gradeEssay() {
        calls += 1
        return providerResult.promise
      },
    })
    const app = createServer({ multimodalProvider: provider, runtimeConfig: memoryRuntimeConfig() })
    const firstMetadata = imageGradeMetadata('identity-first')
    const first = request(app).post('/grading/grade-images')
      .field('metadata', JSON.stringify(firstMetadata))
    const firstPromise = Promise.resolve(first)
    await waitFor(() => calls === 1)

    const privateMarker = 'PRIVATE-CONFLICTING-NONPROMPT-FIELD'
    const conflicting = {
      ...imageGradeMetadata('identity-conflict'),
      task: {
        ...firstMetadata.task,
        rubric: { ...firstMetadata.task.rubric, taskName: privateMarker },
      },
    }
    const conflict = await request(app).post('/grading/grade-images')
      .field('metadata', JSON.stringify(conflicting))
      .expect(409)
    expect(conflict.body).toMatchObject({
      requestId: 'identity-conflict', status: 'failed',
      error: { code: 'invalid_request', retryable: false },
    })
    expect(JSON.stringify(conflict.body)).not.toMatch(/PRIVATE|digest|hash|logical/i)
    expect(calls).toBe(1)

    providerResult.resolve(strictMultimodalPayload(firstMetadata.confirmedTranscript))
    await firstPromise
  })

  it('returns result-unknown at the absolute caller deadline and reattaches to one late cached success', async () => {
    const clock = new GatewayManualClock()
    const runtimeConfig = memoryRuntimeConfig()
    const executionServices = createGatewayExecutionServices(runtimeConfig, {
      now: () => clock.now,
      timers: clock,
      random: () => 0,
    })
    const providerResult = deferred<ReturnType<typeof strictMultimodalPayload>>()
    let calls = 0
    let signal: AbortSignal | undefined
    const provider = fakeMultimodalProvider({
      async gradeEssay(input) {
        calls += 1
        signal = input.signal
        return providerResult.promise
      },
    })
    const app = createServer({
      multimodalProvider: provider,
      runtimeConfig,
      executionServices,
      monotonicNow: () => clock.now,
      executionTimers: clock,
    })
    const firstPromise = Promise.resolve(request(app).post('/grading/grade-images')
      .field('metadata', JSON.stringify(imageGradeMetadata('deadline-first'))))
    await waitFor(() => calls === 1)

    clock.advanceBy(runtimeConfig.deadlines.httpMs)
    const first = await firstPromise
    expect(first.status).toBe(503)
    expect(first.body).toEqual({
      requestId: 'deadline-first', status: 'failed',
      error: {
        code: 'provider_result_unknown',
        message: '批改结果状态暂时未知，请稍后检查同一任务。',
        retryable: false,
      },
    })
    expect(signal?.aborted).toBe(false)
    expect(executionServices.admission.snapshot().activeLeases).toBe(1)

    providerResult.resolve(strictMultimodalPayload('Teacher-confirmed synthetic text.'))
    await waitFor(() => executionServices.admission.snapshot().activeLeases === 0)
    const reattached = await request(app).post('/grading/grade-images')
      .field('metadata', JSON.stringify(imageGradeMetadata('deadline-reattach')))
      .expect(200)
    expect(reattached.body.requestId).toBe('deadline-reattach')
    expect(calls).toBe(1)
  })

  it('retains an unresolved orphan against the hard cap without inventing a Retry-After time', async () => {
    const clock = new GatewayManualClock()
    const runtimeConfig = memoryRuntimeConfig({ admission: { hardLimit: 1 } })
    const executionServices = createGatewayExecutionServices(runtimeConfig, {
      now: () => clock.now,
      timers: clock,
      random: () => 0,
    })
    let calls = 0
    const never = deferred<ReturnType<typeof strictMultimodalPayload>>()
    const provider = fakeMultimodalProvider({
      async gradeEssay() {
        calls += 1
        return never.promise
      },
    })
    const app = createServer({
      multimodalProvider: provider,
      runtimeConfig,
      executionServices,
      monotonicNow: () => clock.now,
      executionTimers: clock,
    })
    const firstPromise = Promise.resolve(request(app).post('/grading/grade-images')
      .field('metadata', JSON.stringify(imageGradeMetadata('orphan-first'))))
    await waitFor(() => calls === 1)
    clock.advanceBy(runtimeConfig.deadlines.httpMs)
    await firstPromise
    clock.advanceBy(
      runtimeConfig.deadlines.providerFinalMs
      + runtimeConfig.deadlines.settlementGraceMs
      - runtimeConfig.deadlines.httpMs,
    )

    expect(executionServices.registry.snapshot().states.orphaned_unknown).toBe(1)
    expect(executionServices.admission.snapshot().activeLeases).toBe(1)
    const blocked = await request(app).post('/grading/grade-images')
      .field('metadata', JSON.stringify(imageGradeMetadata('orphan-blocked', 'another-essay')))
      .expect(429)
    expect(blocked.body).toMatchObject({
      requestId: 'orphan-blocked', status: 'failed',
      error: { code: 'provider_rate_limited' },
    })
    expect(blocked.headers).not.toHaveProperty('retry-after')
    expect(calls).toBe(1)
  })

  it('projects truthful rate-limit timing only into Retry-After and exposes the header through CORS', async () => {
    const runtimeConfig = memoryRuntimeConfig()
    const executionServices = createGatewayExecutionServices(runtimeConfig, { random: () => 0 })
    const provider = fakeMultimodalProvider({
      async gradeEssay() {
        throw new GradingProviderError('provider_rate_limited', 'PRIVATE-UPSTREAM-BODY', true, undefined, {
          termination: 'confirmed', retryAfterMs: 2_500,
        })
      },
    })
    const response = await request(createServer({
      multimodalProvider: provider,
      runtimeConfig,
      executionServices,
    }))
      .post('/grading/grade-images')
      .set('Origin', 'http://127.0.0.1:5173')
      .field('metadata', JSON.stringify(imageGradeMetadata('rate-limit-header')))
      .expect(429)

    expect(response.headers['retry-after']).toBe('3')
    expect(response.headers['access-control-expose-headers']).toContain('Retry-After')
    expect(response.body).toMatchObject({
      requestId: 'rate-limit-header', status: 'failed',
      error: { code: 'provider_rate_limited' },
    })
    expect(response.body).not.toHaveProperty('retryAfterMs')
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE-UPSTREAM-BODY')
  })

  it('projects retry timing for a retryable non-429 registry result into Retry-After', async () => {
    const runtimeConfig = memoryRuntimeConfig()
    const executionServices = createGatewayExecutionServices(runtimeConfig, { random: () => 0.5 })
    const provider = fakeMultimodalProvider({
      async gradeEssay() {
        throw new GradingProviderError('provider_unavailable', 'PRIVATE-UPSTREAM-BODY', true, undefined, {
          termination: 'confirmed',
        })
      },
    })
    const response = await request(createServer({
      multimodalProvider: provider,
      runtimeConfig,
      executionServices,
    }))
      .post('/grading/grade-images')
      .field('metadata', JSON.stringify(imageGradeMetadata('transient-retry-header')))
      .expect(503)

    expect(response.headers['retry-after']).toBe('1')
    expect(response.body).toMatchObject({
      requestId: 'transient-retry-header', status: 'failed',
      error: { code: 'provider_unavailable', retryable: true },
    })
    expect(response.body).not.toHaveProperty('retryAfterMs')
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE-UPSTREAM-BODY')
  })

  it('preserves Retry-After on an exhausted final 429 registry result', async () => {
    const runtimeConfig = memoryRuntimeConfig()
    const executionServices = createGatewayExecutionServices(runtimeConfig, { random: () => 0 })
    let calls = 0
    const provider = fakeMultimodalProvider({
      async gradeEssay() {
        calls += 1
        throw new GradingProviderError('provider_rate_limited', 'PRIVATE-UPSTREAM-BODY', true, undefined, {
          termination: 'confirmed',
          ...(calls === 6 ? { retryAfterMs: 2_500 } : {}),
        })
      },
    })
    const app = createServer({ multimodalProvider: provider, runtimeConfig, executionServices })

    for (let attempt = 1; attempt < 6; attempt += 1) {
      await request(app).post('/grading/grade-images')
        .field('metadata', JSON.stringify(imageGradeMetadata(`rate-limit-requeue-${attempt}`)))
        .expect(429)
    }
    const exhausted = await request(app).post('/grading/grade-images')
      .field('metadata', JSON.stringify(imageGradeMetadata('rate-limit-exhausted')))
      .expect(429)

    expect(calls).toBe(6)
    expect(exhausted.headers['retry-after']).toBe('3')
    expect(exhausted.body).toMatchObject({
      requestId: 'rate-limit-exhausted', status: 'failed',
      error: { code: 'provider_rate_limited', retryable: false },
    })
    expect(JSON.stringify(exhausted.body)).not.toContain('PRIVATE-UPSTREAM-BODY')
  })

  it('tracks one-shot material work after HTTP timeout and shares its hard admission cap with rubric work', async () => {
    const clock = new GatewayManualClock()
    const runtimeConfig = memoryRuntimeConfig({ admission: { hardLimit: 1 } })
    const executionServices = createGatewayExecutionServices(runtimeConfig, {
      now: () => clock.now,
      timers: clock,
      random: () => 0,
    })
    const materialResult = deferred<Awaited<ReturnType<MultimodalProvider['generateMaterialContext']>>>()
    const providerTelemetry = createProviderTelemetryRecorder()
    let materialCalls = 0
    let rubricCalls = 0
    let materialSignal: AbortSignal | undefined
    const provider: MultimodalProvider = {
      async generateMaterialContext(input) {
        materialCalls += 1
        materialSignal = input.signal
        return materialResult.promise
      },
      async generateRubric() {
        rubricCalls += 1
        return { value: generatedRubricFixture(), attempts: [] }
      },
      async gradeEssay() { throw new Error('not used') },
    }
    const app = createServer({
      multimodalProvider: provider,
      runtimeConfig,
      executionServices,
      monotonicNow: () => clock.now,
      executionTimers: clock,
      providerTelemetry,
    })
    const materialPromise = Promise.resolve(request(app).post('/tasks/material-context')
      .field('requestId', 'one-shot-material')
      .field('fullScore', '15')
      .field('writingRequirement', 'Teacher requirement.')
      .field('materialManifest', JSON.stringify([{ id: 'text-1', kind: 'text', textIndex: 0 }]))
      .field('textMaterials', JSON.stringify([{ displayName: 'prompt.docx', text: 'Synthetic source.' }])))
    await waitFor(() => materialCalls === 1)
    clock.advanceBy(runtimeConfig.deadlines.httpMs)
    const timedOut = await materialPromise
    expect(timedOut.status).toBe(503)
    expect(timedOut.body).toMatchObject({
      requestId: 'one-shot-material', status: 'failed',
      error: { code: 'provider_result_unknown', retryable: false },
    })
    expect(materialSignal?.aborted).toBe(false)
    expect(executionServices.admission.snapshot().activeLeases).toBe(1)
    expect(providerTelemetry.snapshot().uniqueAttempts).toBe(0)

    const blockedRubric = await request(app).post('/tasks/rubric')
      .field('requestId', 'one-shot-rubric')
      .field('fullScore', '15')
      .field('writingRequirement', 'Teacher requirement.')
      .field('materialManifest', JSON.stringify([{ id: 'text-1', kind: 'text', textIndex: 0 }]))
      .field('textMaterials', JSON.stringify([{ displayName: 'prompt.docx', text: 'Synthetic source.' }]))
      .expect(429)
    expect(blockedRubric.body.error.code).toBe('provider_rate_limited')
    expect(blockedRubric.headers).not.toHaveProperty('retry-after')
    expect(rubricCalls).toBe(0)

    materialResult.resolve({
      value: materialContextFixture(),
      attempts: [{
        attemptDiagnosticId: '11111111-1111-4111-8111-111111111111',
        finishReason: 'stop',
        providerElapsedMs: 123,
        usage: {
          promptTokens: { status: 'known', value: 12 },
          completionTokens: { status: 'known', value: 8 },
          totalTokens: { status: 'known', value: 20 },
          cachedTokens: { status: 'unknown', reason: 'absent' },
        },
      }],
    })
    await waitFor(() => executionServices.admission.snapshot().activeLeases === 0)
    expect(materialCalls).toBe(1)
    expect(providerTelemetry.snapshot()).toMatchObject({
      uniqueAttempts: 1,
      totals: { totalTokens: { status: 'known', value: 20 } },
    })
  })

  it('does not expose the deprecated generic grading policy bypass', async () => {
    await request(createServer({ runtimeConfig: legacyRuntimeConfig() }))
      .post('/grading/grade')
      .send({ requestId: 'deprecated-request' })
      .expect(404)
  })

  it('enforces enabled/disabled class-review Provider and calibration construction invariants', () => {
    const enabled = fakeClassReviewRuntimeConfig()
    const classProvider = fakeClassReviewProvider()
    expect(() => createServer({ runtimeConfig: enabled })).toThrow(/class review/i)
    expect(() => createServer({
      runtimeConfig: enabled,
      classReviewProvider: classProvider,
    })).toThrow(/class review/i)
    expect(() => createServer({
      runtimeConfig: legacyRuntimeConfig(),
      classReviewProvider: classProvider,
      classReviewFramingCalibration: classReviewCalibration,
    })).toThrow(/class review/i)
  })

  it('reserves the disabled exact path as the same fixed no-CORS 404 for every method and header', async () => {
    const app = createServer({
      runtimeConfig: legacyRuntimeConfig(),
      allowedOrigin: 'http://127.0.0.1:5173',
    })
    for (const invoke of [
      () => request(app).get('/grading/class-review-syntheses'),
      () => request(app).post('/grading/class-review-syntheses')
        .set('Origin', 'http://127.0.0.1:5173')
        .set('Authorization', `Bearer ${CLASS_REVIEW_TOKEN}`)
        .send(classReviewFixture.requests.withGroups),
      () => request(app).options('/grading/class-review-syntheses')
        .set('Origin', 'http://127.0.0.1:5173')
        .set('Access-Control-Request-Method', 'POST'),
    ]) {
      const response = await invoke().expect(404)
      expect(response.body).toEqual({ error: { code: 'not_found', message: 'Not found.' } })
      expect(response.headers).not.toHaveProperty('access-control-allow-origin')
      expect(response.headers).not.toHaveProperty('access-control-allow-headers')
    }
  })

  it('consumes trailing-slash and case aliases as fixed no-CORS 404s in both class modes while preserving query identity', async () => {
    let providerCalls = 0
    const allowedOrigin = 'http://127.0.0.1:5173'
    const disabledApp = createServer({
      runtimeConfig: legacyRuntimeConfig(),
      allowedOrigin,
    })
    const enabledApp = createServer({
      runtimeConfig: fakeClassReviewRuntimeConfig(),
      classReviewProvider: fakeClassReviewProvider(async () => {
        providerCalls += 1
        return {
          value: classReviewFixture.results.succeeded.output,
          attempts: [classReviewObservation()],
        }
      }),
      classReviewFramingCalibration: classReviewCalibration,
      allowedOrigin,
    })

    for (const app of [disabledApp, enabledApp]) {
      for (const alias of [
        '/grading/class-review-syntheses/',
        '/grading/Class-Review-Syntheses',
      ]) {
        const response = await request(app).post(alias)
          .set('Origin', allowedOrigin)
          .set('Authorization', `Bearer ${CLASS_REVIEW_TOKEN}`)
          .set('Content-Type', 'application/json')
          .send('{"PRIVATE-ALIAS-BODY":')
          .expect(404)
        expect(response.body).toEqual({ error: { code: 'not_found', message: 'Not found.' } })
        expect(response.headers).not.toHaveProperty('access-control-allow-origin')
        expect(response.headers).not.toHaveProperty('access-control-allow-headers')
        expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE|ALIAS|BODY/)
      }
    }

    const queriedExactPath = await request(enabledApp)
      .post('/grading/class-review-syntheses?probe=1')
      .set('Origin', allowedOrigin)
      .set('Authorization', `Bearer ${CLASS_REVIEW_TOKEN}`)
      .set('Content-Type', 'application/json')
      .send('{"PRIVATE-QUERY-BODY":')
      .expect(403)
    expect(queriedExactPath.body).toEqual({
      error: {
        code: 'browser_origin_forbidden',
        message: 'Browser-origin requests are not allowed.',
      },
    })
    expect(queriedExactPath.headers).not.toHaveProperty('access-control-allow-origin')
    expect(providerCalls).toBe(0)
  })

  it('orders enabled Origin, method, bearer and bounded JSON guards before global browser CORS', async () => {
    let providerCalls = 0
    const diagnostics: unknown[] = []
    const app = createServer({
      runtimeConfig: fakeClassReviewRuntimeConfig(),
      classReviewProvider: fakeClassReviewProvider(async () => {
        providerCalls += 1
        return {
          value: classReviewFixture.results.succeeded.output,
          attempts: [classReviewObservation()],
        }
      }),
      classReviewFramingCalibration: classReviewCalibration,
      allowedOrigin: 'http://127.0.0.1:5173',
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    })

    for (const origin of ['', 'http://127.0.0.1:5173']) {
      const forbidden = await request(app).post('/grading/class-review-syntheses')
        .set('Origin', origin)
        .set('Authorization', `Bearer ${CLASS_REVIEW_TOKEN}`)
        .set('Content-Type', 'application/json')
        .send('{"PRIVATE-BODY-MARKER":')
        .expect(403)
      expect(forbidden.body).toEqual({
        error: {
          code: 'browser_origin_forbidden',
          message: 'Browser-origin requests are not allowed.',
        },
      })
      expect(forbidden.headers).not.toHaveProperty('access-control-allow-origin')
      expect(JSON.stringify(forbidden.body)).not.toMatch(/PRIVATE|TOKEN|BODY/)
    }

    const wrongMethod = await request(app).get('/grading/class-review-syntheses')
      .set('Authorization', `Bearer ${CLASS_REVIEW_TOKEN}`)
      .expect(404)
    expect(wrongMethod.body).toEqual({ error: { code: 'not_found', message: 'Not found.' } })
    expect(wrongMethod.headers).not.toHaveProperty('access-control-allow-origin')

    for (const authorization of [undefined, 'Bearer wrong-token-that-is-at-least-32-bytes', `Bearer  ${CLASS_REVIEW_TOKEN}`]) {
      let call = request(app).post('/grading/class-review-syntheses')
        .send({ privateBody: 'PRIVATE-AUTH-BODY-MARKER' })
      if (authorization !== undefined) call = call.set('Authorization', authorization)
      const unauthorized = await call.expect(401)
      expect(unauthorized.headers['www-authenticate']).toBe('Bearer')
      expect(unauthorized.body).toEqual({
        error: {
          code: 'service_auth_required',
          message: 'Internal service authentication failed.',
        },
      })
      expect(unauthorized.headers).not.toHaveProperty('access-control-allow-origin')
      expect(JSON.stringify(unauthorized.body)).not.toMatch(/PRIVATE|TOKEN|BODY/)
    }

    const malformed = await request(app).post('/grading/class-review-syntheses')
      .set('Authorization', `Bearer ${CLASS_REVIEW_TOKEN}`)
      .set('Content-Type', 'application/json')
      .send('{"PRIVATE-JSON-MARKER":')
      .expect(400)
    expect(malformed.body).toEqual({
      error: { code: 'invalid_json', message: 'Request body must be valid JSON.' },
    })
    expect(JSON.stringify(malformed.body)).not.toMatch(/PRIVATE|JSON-MARKER/)

    const prefix = '{"padding":"'
    const suffix = '"}'
    const atLimitBody = `${prefix}${'P'.repeat(MAX_CLASS_REVIEW_JSON_BYTES - prefix.length - suffix.length)}${suffix}`
    expect(Buffer.byteLength(atLimitBody, 'utf8')).toBe(MAX_CLASS_REVIEW_JSON_BYTES)
    const atLimit = await request(app).post('/grading/class-review-syntheses')
      .set('Authorization', `Bearer ${CLASS_REVIEW_TOKEN}`)
      .set('Content-Type', 'application/json')
      .send(atLimitBody)
      .expect(400)
    expect(atLimit.body).toEqual({
      error: { code: 'invalid_request', message: 'Class review synthesis request is invalid.' },
    })
    expect(atLimit.headers).not.toHaveProperty('access-control-allow-origin')

    const callerCacheKey = await request(app).post('/grading/class-review-syntheses')
      .set('Authorization', `Bearer ${CLASS_REVIEW_TOKEN}`)
      .send({
        ...(classReviewFixture.requests.withGroups as Record<string, unknown>),
        promptCacheKey: 'PRIVATE-CALLER-CACHE-KEY',
      })
      .expect(400)
    expect(callerCacheKey.body).toEqual({
      error: { code: 'invalid_request', message: 'Class review synthesis request is invalid.' },
    })
    expect(JSON.stringify(callerCacheKey.body)).not.toMatch(/PRIVATE|CACHE|KEY/)

    const aboveLimit = await request(app).post('/grading/class-review-syntheses')
      .set('Authorization', `Bearer ${CLASS_REVIEW_TOKEN}`)
      .set('Content-Type', 'application/json')
      .send(`${atLimitBody}P`)
      .expect(413)
    expect(aboveLimit.body).toEqual({
      error: { code: 'request_too_large', message: 'Class review synthesis request is too large.' },
    })
    expect(aboveLimit.headers).not.toHaveProperty('access-control-allow-origin')
    expect(JSON.stringify(aboveLimit.body)).not.toMatch(/PRIVATE|padding|P{8}/)
    expect(providerCalls).toBe(0)
    expect(diagnostics).toEqual([])

    const publicCors = await request(app).get('/health')
      .set('Origin', 'http://127.0.0.1:5173')
      .expect(200)
    expect(publicCors.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173')
  })

  it('returns the shared strict success fixture and remains stateless across repeated requestIds', async () => {
    let providerCalls = 0
    const runtimeConfig = fakeClassReviewRuntimeConfig()
    const executionServices = createGatewayExecutionServices(runtimeConfig)
    const app = createServer({
      runtimeConfig,
      executionServices,
      classReviewProvider: fakeClassReviewProvider(async () => {
        providerCalls += 1
        return {
          value: classReviewFixture.results.succeeded.output,
          attempts: [classReviewObservation(`bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${providerCalls}`)],
        }
      }),
      classReviewFramingCalibration: classReviewCalibration,
    })
    for (let index = 0; index < 2; index += 1) {
      const response = await request(app).post('/grading/class-review-syntheses')
        .set('Authorization', `Bearer ${CLASS_REVIEW_TOKEN}`)
        .send(classReviewFixture.requests.withGroups)
        .expect(200)
      expect(response.body).toEqual({
        ...classReviewFixture.results.succeeded,
        timingsMs: response.body.timingsMs,
      })
    }
    expect(providerCalls).toBe(2)
    expect(executionServices.registry.inspect('request.groups')).toBeNull()
  })

  it('shares the exact essay admission and returns target-busy delay without starting class Provider', async () => {
    const runtimeConfig = fakeClassReviewRuntimeConfig()
    const executionServices = createGatewayExecutionServices(runtimeConfig)
    const pendingEssay = deferred<ReturnType<typeof strictMultimodalPayload>>()
    let activeCalls = 0
    let maximumActive = 0
    let classCalls = 0
    const multimodalProvider = fakeMultimodalProvider({
      async gradeEssay() {
        activeCalls += 1
        maximumActive = Math.max(maximumActive, activeCalls)
        const value = await pendingEssay.promise
        activeCalls -= 1
        return value
      },
    })
    const app = createServer({
      runtimeConfig,
      executionServices,
      multimodalProvider,
      classReviewProvider: fakeClassReviewProvider(async () => {
        classCalls += 1
        activeCalls += 1
        maximumActive = Math.max(maximumActive, activeCalls)
        activeCalls -= 1
        return {
          value: classReviewFixture.results.succeeded.output,
          attempts: [classReviewObservation()],
        }
      }),
      classReviewFramingCalibration: classReviewCalibration,
    })
    const essay = Promise.resolve(request(app).post('/grading/grade-images')
      .field('metadata', JSON.stringify(imageGradeMetadata('shared-essay-request'))))
    await waitFor(() => activeCalls === 1)

    const blocked = await request(app).post('/grading/class-review-syntheses')
      .set('Authorization', `Bearer ${CLASS_REVIEW_TOKEN}`)
      .send(classReviewFixture.requests.withGroups)
      .expect(429)
    expect(blocked.body).toMatchObject({
      status: 'failed', safeFailureCode: 'provider_rate_limited', retryable: true,
      retryAfterMs: 1_000, completionDisposition: 'not_started',
    })
    expect(blocked.headers['retry-after']).toBe('1')
    expect(classCalls).toBe(0)
    expect(maximumActive).toBe(1)

    pendingEssay.resolve(strictMultimodalPayload('Teacher-confirmed synthetic text.'))
    await essay
  })

  it('projects confirmed-zero Provider 429 milliseconds into one truthful ceil-second header', async () => {
    const app = createServer({
      runtimeConfig: fakeClassReviewRuntimeConfig(),
      classReviewProvider: fakeClassReviewProvider(async () => {
        throw new GradingProviderError('provider_rate_limited', 'PRIVATE-RATE-LIMIT', true, undefined, {
          termination: 'confirmed', retryAfterMs: 1_001,
        })
      }),
      classReviewFramingCalibration: classReviewCalibration,
    })
    const response = await request(app).post('/grading/class-review-syntheses')
      .set('Authorization', `Bearer ${CLASS_REVIEW_TOKEN}`)
      .send(classReviewFixture.requests.withGroups)
      .expect(429)
    expect(response.body).toMatchObject({
      status: 'failed', safeFailureCode: 'provider_rate_limited', retryable: true,
      retryAfterMs: 1_001, completionDisposition: 'confirmed_zero_completion',
    })
    expect(response.headers['retry-after']).toBe('2')
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE|RATE-LIMIT/)
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
