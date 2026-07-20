import { describe, expect, it, vi } from 'vitest'
import type { GradingRequestV1 } from '../types.js'
import { DeepSeekGradingProvider } from './deepseekGradingProvider.js'
import type { DeepSeekTransport } from './deepseekTransport.js'

const practicalRequest: GradingRequestV1 = {
  requestVersion: 'grading-request-v1', requestId: 'request-deepseek',
  task: {
    taskId: 'task-deepseek', writingGenre: 'practical_writing', fullScore: 15,
    prompt: { writingGenre: 'practical_writing', taskRequirement: 'Synthetic.' },
    rubric: {
      status: 'confirmed', writingGoal: 'Synthetic.', offTopicCriteria: [],
      dimensions: [{ id: 'all', name: 'All', weight: 100, description: 'All', deductionFocus: [] }],
      excellentFeatures: [], reviewTriggers: [],
    },
  },
  essay: {
    essayId: 'essay-deepseek', confirmedTranscript: 'Synthetic transcript.',
    ocrContext: { sourceKind: 'manual', hasKnownOcrRisk: false, riskCodes: [] },
  },
}

const prompt = { system: 'Return json only.', user: 'Synthetic data.' }

function transportReturning(response: unknown) {
  return { complete: vi.fn().mockResolvedValue(response) } satisfies DeepSeekTransport
}

function completed(content = '{"dimensionScores":[]}') {
  return { choices: [{ finish_reason: 'stop', message: { content } }] }
}

describe('DeepSeekGradingProvider', () => {
  it('sends explicit disabled-thinking generation settings by default', async () => {
    const transport = transportReturning(completed())
    const provider = new DeepSeekGradingProvider(transport)
    await provider.grade({ request: practicalRequest, prompt, signal: new AbortController().signal })
    expect(transport.complete).toHaveBeenCalledWith({
      model: 'deepseek-v4-flash', stream: false, thinking: { type: 'disabled' }, temperature: 0,
      max_tokens: 8192, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
    }, expect.any(AbortSignal))
  })

  it('omits temperature while explicitly enabling thinking', async () => {
    const transport = transportReturning(completed())
    const provider = new DeepSeekGradingProvider(transport, 'deepseek-v4-flash', {
      thinkingMode: 'enabled', temperature: 0.7, maxTokens: 4096,
    })
    await provider.grade({ request: practicalRequest, prompt, signal: new AbortController().signal })
    const body = transport.complete.mock.calls[0][0]
    expect(body).toMatchObject({ thinking: { type: 'enabled' }, max_tokens: 4096 })
    expect(body).not.toHaveProperty('temperature')
  })

  it('returns only parsed message content and discards raw response metadata', async () => {
    const transport = transportReturning({
      ...completed('{"safe":"value"}'), usage: { secret: 'SECRET' }, reasoning_content: 'SECRET',
    })
    await expect(new DeepSeekGradingProvider(transport).grade({
      request: practicalRequest, prompt, signal: new AbortController().signal,
    })).resolves.toEqual({ safe: 'value' })
  })

  it.each([
    ['missing', undefined],
    ['null', null],
    ['unknown', 'future_vendor_reason'],
    ['length', 'length'],
  ] as const)('rejects %s finish_reason as retryable invalid response', async (_label, finishReason) => {
    const choice: Record<string, unknown> = { message: { content: '{not parsed' } }
    if (finishReason !== undefined) choice.finish_reason = finishReason
    const transport = transportReturning({ choices: [choice] })
    await expect(new DeepSeekGradingProvider(transport).grade({
      request: practicalRequest, prompt, signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'provider_invalid_response', retryable: true })
  })

  it.each([
    ['content_filter', 'provider_content_filtered', false],
    ['insufficient_system_resource', 'provider_unavailable', true],
    ['tool_calls', 'provider_unexpected_tool_call', false],
  ] as const)('maps finish_reason %s', async (finishReason, code, retryable) => {
    const transport = transportReturning({
      choices: [{ finish_reason: finishReason, message: { content: '{"safe":true}' } }],
    })
    await expect(new DeepSeekGradingProvider(transport).grade({
      request: practicalRequest, prompt, signal: new AbortController().signal,
    })).rejects.toMatchObject({ code, retryable })
  })

  it.each([
    ['empty choices', { choices: [] }],
    ['null content', { choices: [{ finish_reason: 'stop', message: { content: null } }] }],
    ['empty content', { choices: [{ finish_reason: 'stop', message: { content: '  ' } }] }],
    ['missing content', { choices: [{ finish_reason: 'stop', message: {} }] }],
  ])('rejects %s', async (_label, response) => {
    await expect(new DeepSeekGradingProvider(transportReturning(response)).grade({
      request: practicalRequest, prompt, signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'provider_invalid_response', retryable: true })
  })

  it('rejects non-empty tool calls even when finish_reason is stop', async () => {
    const transport = transportReturning({
      choices: [{ finish_reason: 'stop', message: { content: '{"safe":true}', tool_calls: [{ id: 'tool' }] } }],
    })
    await expect(new DeepSeekGradingProvider(transport).grade({
      request: practicalRequest, prompt, signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'provider_unexpected_tool_call', retryable: false })
  })

  it('rejects malformed content JSON', async () => {
    await expect(new DeepSeekGradingProvider(transportReturning(completed('{invalid'))).grade({
      request: practicalRequest, prompt, signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'provider_invalid_response', retryable: true })
  })

  it('rejects continuation writing before transport invocation', async () => {
    const transport = transportReturning(completed())
    const request = {
      ...practicalRequest,
      task: {
        ...practicalRequest.task,
        writingGenre: 'continuation_writing' as const,
        prompt: {
          writingGenre: 'continuation_writing' as const,
          sourceText: 'Source.', paragraph1Opening: 'Then,', paragraph2Opening: 'Finally,',
        },
      },
    }
    await expect(new DeepSeekGradingProvider(transport).grade({
      request, prompt, signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'unsupported_genre', retryable: false })
    expect(transport.complete).not.toHaveBeenCalled()
  })
})
