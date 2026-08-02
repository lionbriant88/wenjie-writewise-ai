import { describe, expect, it, vi } from 'vitest'
import type { GeneratedRubricV1 } from '../multimodal/types.js'
import { KimiMultimodalProvider } from './kimiMultimodalProvider.js'
import type { KimiTransport } from './kimiTransport.js'

const pages = [
  { pageId: 'page-1', mimeType: 'image/png' as const, buffer: Buffer.from('first page') },
  { pageId: 'page-2', mimeType: 'image/jpeg' as const, buffer: Buffer.from('second page') },
]

const draft: GeneratedRubricV1 = {
  taskName: 'Draft task', materialSummary: 'Draft summary', writingRequirements: ['Draft requirement'],
  constraints: ['Draft constraint'], dimensions: [{
    id: 'content', name: 'Content', weight: 100, description: 'Draft dimension',
    deductionFocus: ['Draft deduction'], sourceEvidence: ['Draft evidence'],
  }], reviewWarnings: [],
}

const reviewed: GeneratedRubricV1 = {
  ...draft,
  taskName: 'Reviewed task',
  dimensions: [{ ...draft.dimensions[0], description: 'Reviewed dimension' }],
}

function transportReturning(...results: unknown[]) {
  const complete = vi.fn().mockImplementation(async () => results.shift())
  return { complete } satisfies KimiTransport
}

const input = {
  requestId: 'request-rubric', fullScore: 15, pages, signal: new AbortController().signal,
}

describe('KimiMultimodalProvider', () => {
  it('returns only the independently reviewed rubric and sends ordered original images twice', async () => {
    const transport = transportReturning(draft, reviewed)
    const provider = new KimiMultimodalProvider(transport)

    await expect(provider.generateRubric(input)).resolves.toEqual(reviewed)
    expect(transport.complete).toHaveBeenCalledTimes(2)
    expect(transport.complete.mock.calls[0]?.[0]).toMatchObject({ schemaName: 'generated-rubric' })
    expect(transport.complete.mock.calls[1]?.[0]).toMatchObject({ schemaName: 'reviewed-rubric' })
    for (const call of transport.complete.mock.calls) {
      expect(JSON.stringify(call[0].messages)).toContain('data:image/png;base64,Zmlyc3QgcGFnZQ==')
      expect(JSON.stringify(call[0].messages)).toContain('data:image/jpeg;base64,c2Vjb25kIHBhZ2U=')
    }
    const reviewMessages = transport.complete.mock.calls[1]?.[0].messages
    const reviewText = (reviewMessages?.[1]?.content as Array<{ type: string, text?: string }>)[0]?.text
    expect(reviewText).toContain(JSON.stringify(draft))
  })

  it('fails safely when the reviewed rubric has invalid percentage weights', async () => {
    const invalidReviewed = { ...reviewed, dimensions: [{ ...reviewed.dimensions[0], weight: 99 }] }
    const transport = transportReturning(draft, invalidReviewed)

    await expect(new KimiMultimodalProvider(transport).generateRubric(input))
      .rejects.toMatchObject({ code: 'provider_invalid_response' })
    expect(transport.complete).toHaveBeenCalledTimes(2)
  })

  it('does not automatically retry provider failures', async () => {
    const failure = new Error('transport unavailable')
    const transport: KimiTransport = { complete: vi.fn().mockRejectedValue(failure) }

    await expect(new KimiMultimodalProvider(transport).generateRubric(input)).rejects.toBe(failure)
    expect(transport.complete).toHaveBeenCalledTimes(1)
  })

  it('grades each essay with exactly one strict-schema transport call in original page order', async () => {
    const result = { transcript: 'Student text.', transcriptionWarnings: [], printedTextExcluded: true }
    const transport = transportReturning(result)
    const provider = new KimiMultimodalProvider(transport)
    const task = {
      taskId: 'task-grade', fullScore: 15, materialSummary: 'Synthetic material.', writingRequirements: ['Write.'], constraints: ['English.'], rubric: reviewed,
    }

    await expect(provider.gradeEssay({ requestId: 'request-grade', task, essayId: 'essay-grade', pages, signal: new AbortController().signal })).resolves.toEqual(result)
    expect(transport.complete).toHaveBeenCalledTimes(1)
    expect(transport.complete.mock.calls[0]?.[0]).toMatchObject({ schemaName: 'essay-grading' })
    const messageJson = JSON.stringify(transport.complete.mock.calls[0]?.[0].messages)
    expect(messageJson.indexOf('data:image/png;base64,Zmlyc3QgcGFnZQ==')).toBeLessThan(messageJson.indexOf('data:image/jpeg;base64,c2Vjb25kIHBhZ2U='))
  })
})
