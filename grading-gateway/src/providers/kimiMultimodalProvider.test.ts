import { describe, expect, it, vi } from 'vitest'
import type { GatewayTaskMaterial } from '../multipartTaskMaterials.js'
import type { GeneratedRubricV1, TaskMaterialContextV1 } from '../multimodal/types.js'
import { KimiMultimodalProvider } from './kimiMultimodalProvider.js'
import type { KimiTransport } from './kimiTransport.js'

const pages = [
  { pageId: 'page-1', mimeType: 'image/png' as const, buffer: Buffer.from('first page') },
  { pageId: 'page-2', mimeType: 'image/jpeg' as const, buffer: Buffer.from('second page') },
]

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
  it('validates material context once and puts the exact teacher requirement first without duplicates', async () => {
    const transport = transportReturning(context)
    const provider = new KimiMultimodalProvider(transport)

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

    await expect(new KimiMultimodalProvider(transport).generateMaterialContext({
      requestId: 'request-context-invalid',
      fullScore: 15,
      writingRequirement: 'Teacher requirement.',
      materials,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'provider_invalid_response' })
    expect(transport.complete).toHaveBeenCalledTimes(1)
  })

  it('propagates a material-context transport failure without retrying', async () => {
    const failure = new Error('transport unavailable')
    const transport: KimiTransport = { complete: vi.fn().mockRejectedValue(failure) }

    await expect(new KimiMultimodalProvider(transport).generateMaterialContext({
      requestId: 'request-context-failure',
      fullScore: 15,
      writingRequirement: 'Teacher requirement.',
      materials,
      signal: new AbortController().signal,
    })).rejects.toBe(failure)
    expect(transport.complete).toHaveBeenCalledTimes(1)
  })

  it('validates draft and review, sends the same ordered materials twice, and preserves reviewed rubric identity fields', async () => {
    const transport = transportReturning(draft, reviewed)
    const provider = new KimiMultimodalProvider(transport)

    await expect(provider.generateRubric(rubricInput)).resolves.toEqual({
      value: { ...reviewed, writingRequirements: ['Teacher requirement.', 'Reviewed requirement'] },
      attempts: attempts(2),
    })
    expect(transport.complete).toHaveBeenCalledTimes(2)
    expect(transport.complete.mock.calls[0]?.[0]).toMatchObject({ schemaName: 'generated-rubric' })
    expect(transport.complete.mock.calls[1]?.[0]).toMatchObject({ schemaName: 'reviewed-rubric' })
    for (const call of transport.complete.mock.calls) {
      const messageJson = JSON.stringify(call[0].messages)
      const firstTextIndex = messageJson.indexOf('Source text one.')
      const imageIndex = messageJson.indexOf('data:image/webp;base64,dGFzayBpbWFnZQ==')
      const secondTextIndex = messageJson.indexOf('Source text two.')
      expect(firstTextIndex).toBeGreaterThanOrEqual(0)
      expect(imageIndex).toBeGreaterThan(firstTextIndex)
      expect(secondTextIndex).toBeGreaterThan(imageIndex)
    }
    const reviewMessages = transport.complete.mock.calls[1]?.[0].messages
    const reviewText = (reviewMessages?.[1]?.content as Array<{ type: string, text?: string }>)[0]?.text
    expect(reviewText).toContain('"writingRequirements":["Teacher requirement.","Draft requirement"]')
  })

  it('does not create an empty requirement when the optional teacher requirement is blank', async () => {
    const transport = transportReturning(draft, reviewed)

    await expect(new KimiMultimodalProvider(transport).generateRubric({
      ...rubricInput,
      writingRequirement: '   ',
    })).resolves.toEqual({ value: reviewed, attempts: attempts(2) })
  })

  it('rejects an invalid draft before making the review call', async () => {
    const invalidDraft = { ...draft, dimensions: [{ ...draft.dimensions[0], weight: 99 }, draft.dimensions[1]] }
    const transport = transportReturning(invalidDraft, reviewed)

    await expect(new KimiMultimodalProvider(transport).generateRubric(rubricInput))
      .rejects.toMatchObject({ code: 'provider_invalid_response' })
    expect(transport.complete).toHaveBeenCalledTimes(1)
  })

  it('fails safely when the reviewed rubric has invalid percentage weights', async () => {
    const invalidReviewed = { ...reviewed, dimensions: [{ ...reviewed.dimensions[0], weight: 99 }, reviewed.dimensions[1]] }
    const transport = transportReturning(draft, invalidReviewed)

    await expect(new KimiMultimodalProvider(transport).generateRubric(rubricInput))
      .rejects.toMatchObject({ code: 'provider_invalid_response' })
    expect(transport.complete).toHaveBeenCalledTimes(2)
  })

  it('does not automatically retry rubric transport failures', async () => {
    const failure = new Error('transport unavailable')
    const transport: KimiTransport = { complete: vi.fn().mockRejectedValue(failure) }

    await expect(new KimiMultimodalProvider(transport).generateRubric(rubricInput)).rejects.toBe(failure)
    expect(transport.complete).toHaveBeenCalledTimes(1)
  })

  it('keeps essay grading at one essay-grading call and never includes raw task materials', async () => {
    const result = { transcript: 'Student text.', transcriptionWarnings: [], printedTextExcluded: true }
    const transport = transportReturning(result)
    const provider = new KimiMultimodalProvider(transport)
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
    expect(transport.complete.mock.calls[0]?.[0]).toMatchObject({ schemaName: 'essay-grading' })
    const messageJson = JSON.stringify(transport.complete.mock.calls[0]?.[0].messages)
    expect(messageJson.indexOf('data:image/png;base64,Zmlyc3QgcGFnZQ==')).toBeLessThan(messageJson.indexOf('data:image/jpeg;base64,c2Vjb25kIHBhZ2U='))
    expect(messageJson).not.toContain('RAW-TASK-MATERIAL-SENTINEL')
  })

  it('passes teacher-confirmed text to the single essay grading call', async () => {
    const result = { transcript: 'Teacher corrected transcript.' }
    const transport = transportReturning(result)
    const provider = new KimiMultimodalProvider(transport)
    const task = { taskId: 'task-grade', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], rubric: reviewed }
    await expect(provider.gradeEssay({ requestId: 'request-grade', task, essayId: 'essay-grade', pages, confirmedTranscript: 'Teacher corrected transcript.', signal: new AbortController().signal })).resolves.toEqual({ value: result, attempts: attempts(1) })
    expect(transport.complete).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(transport.complete.mock.calls[0]?.[0].messages)).toContain('Teacher corrected transcript.')
  })

  it('does not retry a failed essay grading transport call', async () => {
    const transport: KimiTransport = { complete: vi.fn().mockRejectedValue(new Error('unavailable')) }
    const provider = new KimiMultimodalProvider(transport)
    const task = { taskId: 'task-grade', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], rubric: reviewed }
    await expect(provider.gradeEssay({ requestId: 'request-grade', task, essayId: 'essay-grade', pages, signal: new AbortController().signal })).rejects.toThrow('unavailable')
    expect(transport.complete).toHaveBeenCalledTimes(1)
  })
})
