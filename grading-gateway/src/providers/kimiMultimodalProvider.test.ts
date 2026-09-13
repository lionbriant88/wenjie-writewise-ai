import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { GatewayTaskMaterial } from '../multipartTaskMaterials.js'
import { ESSAY_PROVIDER_SCHEMA_VERSION, LEGACY_ESSAY_PROVIDER_SCHEMA_VERSION } from '../multimodal/modelTaskContext.js'
import type { GeneratedRubricV1, TaskMaterialContextV1 } from '../multimodal/types.js'
import { KimiMultimodalProvider } from './kimiMultimodalProvider.js'
import type { KimiTransport } from './kimiTransport.js'
import { GradingProviderError } from './providerTypes.js'

const pages = [
  { pageId: 'page-1', mimeType: 'image/png' as const, buffer: Buffer.from('first page') },
  { pageId: 'page-2', mimeType: 'image/jpeg' as const, buffer: Buffer.from('second page') },
]

const promptCacheSecret = 'test-only-cache-secret-at-least-32-bytes'

const materials: GatewayTaskMaterial[] = [
  { kind: 'text', unitId: 'text-1', displayName: 'prompt.docx', text: 'Source text one.' },
  { kind: 'image', unitId: 'image-1', mimeType: 'image/webp', buffer: Buffer.from('task image') },
  { kind: 'text', unitId: 'text-2', displayName: 'notes.docx', text: 'Source text two.' },
]

const draft: GeneratedRubricV1 = {
  taskName: 'Draft task', materialSummary: 'Draft summary', writingRequirements: ['Draft requirement'],
  constraints: ['Draft constraint'], dimensions: [
    {
      id: 'content', name: 'Content', weight: 95, description: 'Draft dimension',
      deductionFocus: ['Draft deduction'], sourceEvidence: ['Draft evidence'],
    },
    {
      id: 'legibility', name: 'Legibility', weight: 5, description: 'Handwriting is legible.',
      deductionFocus: [], sourceEvidence: [],
    },
  ], reviewWarnings: [],
}

const reviewed: GeneratedRubricV1 = {
  ...draft,
  taskName: 'Reviewed task',
  materialSummary: 'Reviewed summary',
  writingRequirements: ['Reviewed requirement'],
  constraints: ['Reviewed constraint'],
  dimensions: [{ ...draft.dimensions[0], description: 'Reviewed dimension' }, draft.dimensions[1]],
  reviewWarnings: ['Reviewed warning'],
}

const context: TaskMaterialContextV1 = {
  materialSummary: 'Material summary',
  writingRequirements: ['Model-inferred requirement.', 'Teacher requirement.'],
  constraints: ['Use English.'],
  reviewWarnings: ['Check ambiguous source text.'],
}

function transportReturning(...results: unknown[]) {
  let attempt = 0
  const complete = vi.fn().mockImplementation(async () => ({
    value: results.shift(),
    observation: {
      attemptDiagnosticId: `attempt-${++attempt}`, finishReason: 'stop', providerElapsedMs: 1,
      usage: {
        promptTokens: { status: 'unknown', reason: 'absent' }, completionTokens: { status: 'unknown', reason: 'absent' },
        totalTokens: { status: 'unknown', reason: 'absent' }, cachedTokens: { status: 'unknown', reason: 'absent' },
      },
    },
  }))
  return { maxCompletionTokens: 8192, complete } satisfies KimiTransport
}

const attempts = (count: number) => Array.from({ length: count }, (_, index) => ({
  attemptDiagnosticId: `attempt-${index + 1}`, finishReason: 'stop' as const, providerElapsedMs: 1,
  usage: {
    promptTokens: { status: 'unknown' as const, reason: 'absent' as const }, completionTokens: { status: 'unknown' as const, reason: 'absent' as const },
    totalTokens: { status: 'unknown' as const, reason: 'absent' as const }, cachedTokens: { status: 'unknown' as const, reason: 'absent' as const },
  },
}))

const rubricInput = {
  requestId: 'request-rubric',
  fullScore: 15,
  writingRequirement: 'Teacher requirement.',
  materials,
  signal: new AbortController().signal,
}

describe('KimiMultimodalProvider', () => {
  it('requires an explicit rubric strategy in its constructor contract', () => {
    expectTypeOf<ConstructorParameters<typeof KimiMultimodalProvider>>().toEqualTypeOf<[
      transport: KimiTransport,
      rubricStrategy: 'single-pass-v1' | 'two-pass-legacy',
      essayPromptProfile: 'optimized-v1' | 'legacy',
      promptCacheSecret: string,
    ]>()
  })

  it('validates material context once and puts the exact teacher requirement first without duplicates', async () => {
    const transport = transportReturning(context)
    const provider = new KimiMultimodalProvider(transport, 'single-pass-v1', 'optimized-v1', promptCacheSecret)

    await expect(provider.generateMaterialContext({
      requestId: 'request-context',
      fullScore: 15,
      writingRequirement: '  Teacher requirement.  ',
      materials,
      signal: new AbortController().signal,
    })).resolves.toEqual({
      value: { ...context, writingRequirements: ['Teacher requirement.', 'Model-inferred requirement.'] },
      attempts: attempts(1),
    })
    expect(transport.complete).toHaveBeenCalledTimes(1)
    expect(transport.complete.mock.calls[0]?.[0]).toMatchObject({ schemaName: 'material-context' })
    expect(transport.complete.mock.calls[0]?.[0]).toMatchObject({ maxCompletionTokens: 8192 })
  })

  it('rejects an invalid material context after one call', async () => {
    const transport = transportReturning({ ...context, unexpected: true })

    await expect(new KimiMultimodalProvider(transport, 'single-pass-v1', 'optimized-v1', promptCacheSecret).generateMaterialContext({
      requestId: 'request-context-invalid',
      fullScore: 15,
      writingRequirement: 'Teacher requirement.',
      materials,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'provider_invalid_response',
      details: { termination: 'confirmed', attemptObservations: attempts(1) },
    })
    expect(transport.complete).toHaveBeenCalledTimes(1)
  })

  it('propagates a material-context transport failure without retrying', async () => {
    const failure = new Error('transport unavailable')
    const transport: KimiTransport = { complete: vi.fn().mockRejectedValue(failure) }

    await expect(new KimiMultimodalProvider(transport, 'single-pass-v1', 'optimized-v1', promptCacheSecret).generateMaterialContext({
      requestId: 'request-context-failure',
      fullScore: 15,
      writingRequirement: 'Teacher requirement.',
      materials,
      signal: new AbortController().signal,
    })).rejects.toBe(failure)
    expect(transport.complete).toHaveBeenCalledTimes(1)
  })

  it('single-pass-v1 validates one final rubric, sends each ordered material once, and preserves one observation', async () => {
    const transport = transportReturning(draft)
    const provider = new KimiMultimodalProvider(transport, 'single-pass-v1', 'optimized-v1', promptCacheSecret)

    await expect(provider.generateRubric(rubricInput)).resolves.toEqual({
      value: { ...draft, writingRequirements: ['Teacher requirement.', 'Draft requirement'] },
      attempts: attempts(1),
    })
    expect(transport.complete).toHaveBeenCalledTimes(1)
    expect(transport.complete.mock.calls[0]?.[0]).toMatchObject({ schemaName: 'generated-rubric' })
    const messageJson = JSON.stringify(transport.complete.mock.calls[0]?.[0].messages)
    const firstTextIndex = messageJson.indexOf('Source text one.')
    const imageIndex = messageJson.indexOf('data:image/webp;base64,dGFzayBpbWFnZQ==')
    const secondTextIndex = messageJson.indexOf('Source text two.')
    expect(firstTextIndex).toBeGreaterThanOrEqual(0)
    expect(imageIndex).toBeGreaterThan(firstTextIndex)
    expect(secondTextIndex).toBeGreaterThan(imageIndex)
    expect(messageJson.match(/Source text one\./g)).toHaveLength(1)
    expect(messageJson.match(/data:image\/webp;base64,dGFzayBpbWFnZQ==/g)).toHaveLength(1)
    expect(messageJson.match(/Source text two\./g)).toHaveLength(1)
  })

  it('does not create an empty requirement when the optional teacher requirement is blank', async () => {
    const transport = transportReturning(draft)

    await expect(new KimiMultimodalProvider(transport, 'single-pass-v1', 'optimized-v1', promptCacheSecret).generateRubric({
      ...rubricInput,
      writingRequirement: '   ',
    })).resolves.toEqual({ value: draft, attempts: attempts(1) })
  })

  it.each(['single-pass-v1', 'two-pass-legacy'] as const)(
    '%s rejects an invalid first completed rubric without a hidden review or repair call',
    async (rubricStrategy) => {
      const invalidDraft = { ...draft, dimensions: [{ ...draft.dimensions[0], weight: 99 }, draft.dimensions[1]] }
      const transport = transportReturning(invalidDraft, reviewed)

      await expect(new KimiMultimodalProvider(transport, rubricStrategy, 'optimized-v1', promptCacheSecret).generateRubric(rubricInput))
        .rejects.toMatchObject({
          code: 'provider_invalid_response',
          details: { termination: 'confirmed', attemptObservations: attempts(1) },
        })
      expect(transport.complete).toHaveBeenCalledTimes(1)
    },
  )

  it('two-pass-legacy preserves the historical review and both completion observations', async () => {
    const transport = transportReturning(draft, reviewed)

    await expect(new KimiMultimodalProvider(transport, 'two-pass-legacy', 'optimized-v1', promptCacheSecret).generateRubric(rubricInput)).resolves.toEqual({
      value: { ...reviewed, writingRequirements: ['Teacher requirement.', 'Reviewed requirement'] },
      attempts: attempts(2),
    })
    expect(transport.complete).toHaveBeenCalledTimes(2)
    expect(transport.complete.mock.calls.map(([input]) => input.schemaName)).toEqual([
      'generated-rubric', 'reviewed-rubric',
    ])
  })

  it('two-pass-legacy keeps both completed observations when review business validation fails', async () => {
    const invalidReviewed = { ...reviewed, dimensions: [{ ...reviewed.dimensions[0], weight: 99 }, reviewed.dimensions[1]] }
    const transport = transportReturning(draft, invalidReviewed)

    await expect(new KimiMultimodalProvider(transport, 'two-pass-legacy', 'optimized-v1', promptCacheSecret).generateRubric(rubricInput))
      .rejects.toMatchObject({
        code: 'provider_invalid_response',
        details: { termination: 'confirmed', attemptObservations: attempts(2) },
      })
    expect(transport.complete).toHaveBeenCalledTimes(2)
  })

  it('merges the completed draft observation with a second-call failure without duplicate IDs', async () => {
    const first = attempts(1)[0]!
    const second = { ...first, attemptDiagnosticId: 'attempt-2' }
    const failure = new GradingProviderError('provider_rate_limited', 'safe transport failure', true, undefined, {
      termination: 'confirmed', attemptObservations: [second, second],
    })
    const complete = vi.fn()
      .mockResolvedValueOnce({ value: draft, observation: first })
      .mockRejectedValueOnce(failure)
    const transport = { maxCompletionTokens: 8192, complete } satisfies KimiTransport

    await expect(new KimiMultimodalProvider(transport, 'two-pass-legacy', 'optimized-v1', promptCacheSecret).generateRubric(rubricInput)).rejects.toMatchObject({
      code: 'provider_rate_limited',
      details: { termination: 'confirmed', attemptObservations: [first, second] },
    })
    expect(transport.complete).toHaveBeenCalledTimes(2)
  })

  it('single-pass-v1 preserves a completed schema-failure observation without a hidden review call', async () => {
    const failure = new GradingProviderError('provider_invalid_response', 'safe schema failure', true, undefined, {
      termination: 'confirmed', attemptObservations: attempts(1),
    })
    const transport: KimiTransport = { complete: vi.fn().mockRejectedValue(failure) }

    await expect(new KimiMultimodalProvider(transport, 'single-pass-v1', 'optimized-v1', promptCacheSecret).generateRubric(rubricInput)).rejects.toBe(failure)
    expect(transport.complete).toHaveBeenCalledTimes(1)
  })

  it('keeps essay grading at one essay-grading call and never includes raw task materials', async () => {
    const result = { transcript: 'Student text.', transcriptionWarnings: [], printedTextExcluded: true }
    const transport = transportReturning(result)
    const provider = new KimiMultimodalProvider(transport, 'single-pass-v1', 'optimized-v1', promptCacheSecret)
    const task = {
      taskId: 'task-grade', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], rubric: reviewed,
    }
    const rawTaskMaterials: GatewayTaskMaterial[] = [
      { kind: 'text', unitId: 'raw-task', displayName: 'private.docx', text: 'RAW-TASK-MATERIAL-SENTINEL' },
    ]
    const gradeInput = {
      requestId: 'request-grade', task, essayId: 'essay-grade', pages,
      materials: rawTaskMaterials, signal: new AbortController().signal,
    }

    await expect(provider.gradeEssay(gradeInput)).resolves.toEqual({ value: result, attempts: attempts(1) })
    expect(transport.complete).toHaveBeenCalledTimes(1)
    expect(transport.complete.mock.calls[0]?.[0]).toMatchObject({
      schemaName: ESSAY_PROVIDER_SCHEMA_VERSION,
      stage: 'essay_grading_images',
      promptCacheKey: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    })
    expect(transport.complete.mock.calls[0]?.[0].schema).toHaveProperty(
      'properties.fullTextRevision.required',
      ['sentencePairs', 'logicNotes', 'logicIssues'],
    )
    expect(transport.complete.mock.calls[0]?.[0].schema)
      .not.toHaveProperty('properties.fullTextRevision.properties.correctedText')
    expect(transport.complete.mock.calls[0]?.[0].schema)
      .not.toHaveProperty('properties.fullTextRevision.properties.improvedText')
    const messageJson = JSON.stringify(transport.complete.mock.calls[0]?.[0].messages)
    expect(messageJson.indexOf('data:image/png;base64,Zmlyc3QgcGFnZQ==')).toBeLessThan(messageJson.indexOf('data:image/jpeg;base64,c2Vjb25kIHBhZ2U='))
    expect(messageJson).not.toContain('RAW-TASK-MATERIAL-SENTINEL')
    expect(messageJson).not.toContain('task-grade')
    expect(messageJson).not.toContain('essay-grade')
    expect(messageJson).not.toContain('Reviewed task')
    expect(messageJson).not.toContain('Draft evidence')
  })

  it('passes teacher-confirmed text to the single essay grading call', async () => {
    const result = { transcript: 'Teacher corrected transcript.' }
    const transport = transportReturning(result)
    const provider = new KimiMultimodalProvider(transport, 'single-pass-v1', 'optimized-v1', promptCacheSecret)
    const task = { taskId: 'task-grade', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], rubric: reviewed }
    await expect(provider.gradeEssay({ requestId: 'request-grade', task, essayId: 'essay-grade', pages, confirmedTranscript: 'Teacher corrected transcript.', signal: new AbortController().signal })).resolves.toEqual({ value: result, attempts: attempts(1) })
    expect(transport.complete).toHaveBeenCalledTimes(1)
    expect(transport.complete.mock.calls[0]?.[0]).toMatchObject({
      schemaName: ESSAY_PROVIDER_SCHEMA_VERSION,
      stage: 'essay_regrading_text',
      promptCacheKey: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    })
    expect(transport.complete.mock.calls[0]?.[0].messages.at(-1)?.content).toEqual([
      { type: 'text', text: 'Teacher corrected transcript.' },
    ])
    expect(JSON.stringify(transport.complete.mock.calls[0]?.[0].messages)).not.toContain('image_url')
  })

  it('reuses one opaque cache key for the same task revision across image grading and text regrading', async () => {
    const result = { transcript: 'Student text.' }
    const transport = transportReturning(result, result)
    const provider = new KimiMultimodalProvider(transport, 'single-pass-v1', 'optimized-v1', promptCacheSecret)
    const task = { taskId: 'stable-task', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], rubric: reviewed }

    await provider.gradeEssay({ requestId: 'image-request', task, essayId: 'student-a', pages, signal: new AbortController().signal })
    await provider.gradeEssay({ requestId: 'text-request', task, essayId: 'student-b', pages: [], confirmedTranscript: 'Exact text.', signal: new AbortController().signal })

    const [imageCall, textCall] = transport.complete.mock.calls.map(([input]) => input)
    expect(imageCall?.promptCacheKey).toBe(textCall?.promptCacheKey)
    expect(imageCall?.stage).toBe('essay_grading_images')
    expect(textCall?.stage).toBe('essay_regrading_text')
  })

  it('keeps the legacy profile isolated with a distinct schema identity and no prompt cache key', async () => {
    const result = { transcript: 'Legacy student text.' }
    const transport = transportReturning(result)
    const provider = new KimiMultimodalProvider(transport, 'single-pass-v1', 'legacy', '')
    const task = { taskId: 'legacy-task', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], rubric: reviewed }

    await provider.gradeEssay({ requestId: 'legacy-request', task, essayId: 'legacy-essay', pages, signal: new AbortController().signal })

    expect(transport.complete.mock.calls[0]?.[0]).toMatchObject({
      schemaName: LEGACY_ESSAY_PROVIDER_SCHEMA_VERSION,
      stage: 'essay_grading_images',
    })
    expect(transport.complete.mock.calls[0]?.[0].schema).toHaveProperty(
      'properties.fullTextRevision.required',
      ['correctedText', 'improvedText', 'sentencePairs', 'logicNotes', 'logicIssues'],
    )
    expect(transport.complete.mock.calls[0]?.[0].schema)
      .toHaveProperty('properties.fullTextRevision.properties.correctedText')
    expect(transport.complete.mock.calls[0]?.[0].schema)
      .toHaveProperty('properties.fullTextRevision.properties.improvedText')
    expect(transport.complete.mock.calls[0]?.[0]).not.toHaveProperty('promptCacheKey')
    const messageJson = JSON.stringify(transport.complete.mock.calls[0]?.[0].messages)
    expect(messageJson).not.toContain('legacy-task')
    expect(messageJson).not.toContain('legacy-essay')
    expect(messageJson).not.toContain('Reviewed task')
    expect(messageJson).not.toContain('Draft evidence')
    expect(messageJson).not.toContain('Draft deduction')
    expect(messageJson).not.toContain('taskId')
    expect(messageJson).not.toContain('essayId')
    expect(messageJson).not.toContain('taskName')
    expect(messageJson).not.toContain('sourceEvidence')
    expect(messageJson).not.toContain('deductionFocus')
  })

  it('does not retry a failed essay grading transport call', async () => {
    const transport: KimiTransport = { complete: vi.fn().mockRejectedValue(new Error('unavailable')) }
    const provider = new KimiMultimodalProvider(transport, 'single-pass-v1', 'optimized-v1', promptCacheSecret)
    const task = { taskId: 'task-grade', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], rubric: reviewed }
    await expect(provider.gradeEssay({ requestId: 'request-grade', task, essayId: 'essay-grade', pages, signal: new AbortController().signal })).rejects.toThrow('unavailable')
    expect(transport.complete).toHaveBeenCalledTimes(1)
  })
})
