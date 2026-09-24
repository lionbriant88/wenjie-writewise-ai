import { readFileSync } from 'node:fs'
import { parse } from 'dotenv'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { parseGatewayRuntimeConfig, GatewayRuntimeConfigError } from '../gatewayRuntimeConfig.js'
import { createServer } from '../server.js'
import { getMultimodalProvider } from './index.js'

function environment(overrides: Record<string, string | undefined> = {}) {
  const base = parse(readFileSync(new URL('../../.env.example', import.meta.url)))
  for (const key of Object.keys(base)) if (key.startsWith('KIMI_')) delete base[key]
  return {
    ...base,
    GRADING_PROVIDER: 'openrouter',
    GRADING_RUBRIC_STRATEGY: 'single-pass-v1',
    GRADING_ESSAY_PROMPT_PROFILE: 'optimized-v1',
    GRADING_EXECUTION_REGISTRY: 'memory-v1',
    GRADING_MAX_CONCURRENT_PROVIDER_CALLS: '1',
    OPENROUTER_MODEL: 'dots-studio/dots-3-note-preview:free',
    OPENROUTER_MAX_COMPLETION_TOKENS: '16384',
    ...overrides,
  }
}

const rubric = {
  taskName: 'Synthetic activity', materialSummary: 'Recommend a school club.',
  writingRequirements: ['Use clear English.'], constraints: [], reviewWarnings: [],
  dimensions: [
    { id: 'content', name: 'Content', weight: 95, description: 'Recommend a club.', deductionFocus: [], sourceEvidence: [] },
    { id: 'legibility', name: 'Legibility', weight: 5, description: 'Readable writing.', deductionFocus: [], sourceEvidence: [] },
  ],
}
const task = { taskId: 'private-task-id', fullScore: 15, ...rubric, rubric }
const rubricInput = {
  requestId: 'rubric-test', fullScore: 15, writingRequirement: 'Use clear English.',
  materials: [], signal: new AbortController().signal,
}
const essayInput = {
  requestId: 'essay-test', essayId: 'private-student-name', task,
  pages: [
    { pageId: 'page-1', mimeType: 'image/png' as const, buffer: Buffer.from('synthetic-first-page') },
    { pageId: 'page-2', mimeType: 'image/png' as const, buffer: Buffer.from('synthetic-second-page') },
  ],
  signal: new AbortController().signal,
}

function reply(value: unknown, finishReason = 'stop') {
  return new Response(JSON.stringify({
    choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(value) } }],
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
  }), { status: 200 })
}

describe('OpenRouter configuration and real provider boundary', () => {
  it('selects a configurable free model without requiring Kimi settings or cache credentials', async () => {
    const config = parseGatewayRuntimeConfig(environment())
    const fetchImpl = vi.fn<typeof fetch>(async () => reply(rubric))
    const provider = getMultimodalProvider(config, { apiKey: 'synthetic-secret', fetchImpl })
    const result = await provider.generateRubric(rubricInput)
    expect(result.value.taskName).toBe('Synthetic activity')
    expect(result.attempts).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://openrouter.ai/api/v1/chat/completions')
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({
      model: 'dots-studio/dots-3-note-preview:free', max_tokens: 16384, stream: false,
      reasoning: { enabled: false },
      provider: {
        allow_fallbacks: false, require_parameters: true, data_collection: 'deny',
        max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
      },
      response_format: { type: 'json_schema', json_schema: { strict: true } },
    })
    expect(init.redirect).toBe('error')
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(body).not.toHaveProperty('prompt_cache_key')
    expect(body).not.toHaveProperty('max_completion_tokens')
    expect(body).not.toHaveProperty('models')
    expect(body).not.toHaveProperty('plugins')
    expect(JSON.stringify(result)).not.toContain('synthetic-secret')

    const replacement = parseGatewayRuntimeConfig(environment({ OPENROUTER_MODEL: 'qwen/qwen3.8-27b:free' }))
    const replacementFetch = vi.fn<typeof fetch>(async () => reply(rubric))
    await getMultimodalProvider(replacement, { apiKey: 'synthetic-secret', fetchImpl: replacementFetch }).generateRubric(rubricInput)
    expect(JSON.parse(String((replacementFetch.mock.calls[0]?.[1] as RequestInit).body)).model).toBe('qwen/qwen3.8-27b:free')
    expect(JSON.parse(String((replacementFetch.mock.calls[0]?.[1] as RequestInit).body))).not.toHaveProperty('reasoning')
  })

  it.each([
    { OPENROUTER_MODEL: undefined }, { OPENROUTER_MODEL: '' },
    { OPENROUTER_MODEL: 'dots-studio/dots-3-note-preview' },
    { OPENROUTER_MODEL: 'openrouter/free' }, { OPENROUTER_MODEL: 'vendor/model:free,paid' },
    { OPENROUTER_API_BASE: 'https://example.invalid/v1' },
    { OPENROUTER_MAX_COMPLETION_TOKENS: '0' }, { OPENROUTER_MAX_COMPLETION_TOKENS: '16385' },
    { GRADING_RUBRIC_STRATEGY: 'two-pass-legacy' }, { GRADING_ESSAY_PROMPT_PROFILE: 'legacy' },
    { GRADING_EXECUTION_REGISTRY: 'direct-legacy' }, { CLASS_REVIEW_SYNTHESIS_MODE: 'kimi' },
  ])('fails closed for unsafe configuration %j', (overrides) => {
    expect(() => parseGatewayRuntimeConfig(environment(overrides))).toThrow(GatewayRuntimeConfigError)
  })

  it('refuses missing credentials before making a network request', () => {
    const fetchImpl = vi.fn()
    expect(() => getMultimodalProvider(parseGatewayRuntimeConfig(environment()), { fetchImpl })).toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends all ordered pages in one grading call and sends zero images for confirmed-text regrading', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply({ transcript: 'Synthetic transcript.' }))
    const provider = getMultimodalProvider(parseGatewayRuntimeConfig(environment()), { apiKey: 'synthetic-secret', fetchImpl })
    await provider.gradeEssay(essayInput)
    await provider.gradeEssay({ ...essayInput, pages: [], confirmedTranscript: 'Teacher corrected synthetic text.' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const bodies = fetchImpl.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)))
    const imageUrls = (body: typeof bodies[number]) => body.messages.flatMap((message: { content: unknown }) => Array.isArray(message.content)
      ? message.content.filter((part: { type: string }) => part.type === 'image_url').map((part: { image_url: { url: string } }) => part.image_url.url) : [])
    expect(imageUrls(bodies[0])).toEqual([
      'data:image/png;base64,c3ludGhldGljLWZpcnN0LXBhZ2U=',
      'data:image/png;base64,c3ludGhldGljLXNlY29uZC1wYWdl',
    ])
    expect(imageUrls(bodies[1])).toEqual([])
    expect(JSON.stringify(bodies)).not.toMatch(/private-student-name|private-task-id|prompt_cache_key/)
    expect(JSON.stringify(bodies[1])).toContain('Teacher corrected synthetic text.')
  })

  it.each([
    [401, 'provider_auth_failed', false], [402, 'provider_balance_unavailable', false],
    [429, 'provider_rate_limited', true], [400, 'provider_request_rejected', false],
    [503, 'provider_unavailable', true],
  ] as const)('maps HTTP %s without leaking upstream content or retrying inside the transport', async (status, code, retryable) => {
    const fetchImpl = vi.fn(async () => new Response('PRIVATE-UPSTREAM-RESPONSE', { status, headers: { 'Retry-After': '7' } }))
    const provider = getMultimodalProvider(parseGatewayRuntimeConfig(environment()), { apiKey: 'synthetic-secret', fetchImpl })
    const error = await provider.gradeEssay(essayInput).catch((error: unknown) => error)
    expect(error).toMatchObject({ code, retryable, details: { termination: 'confirmed' } })
    if (status === 429) expect(error).toMatchObject({ details: { retryAfterMs: 7000 } })
    expect(String(error)).not.toMatch(/PRIVATE|synthetic-secret/)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('maps OpenRouter error envelopes even when the HTTP status is 200', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: 402, message: 'PRIVATE-MARKER' } }), { status: 200 }))
    const provider = getMultimodalProvider(parseGatewayRuntimeConfig(environment()), { apiKey: 'synthetic-secret', fetchImpl })
    await expect(provider.gradeEssay(essayInput)).rejects.toMatchObject({ code: 'provider_balance_unavailable', retryable: false })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects truncated output and preserves unknown termination on network loss', async () => {
    const config = parseGatewayRuntimeConfig(environment())
    const truncated = getMultimodalProvider(config, { apiKey: 'synthetic-secret', fetchImpl: vi.fn<typeof fetch>(async () => reply({}, 'length')) })
    await expect(truncated.gradeEssay(essayInput)).rejects.toMatchObject({ diagnosticCode: 'completion_truncated' })
    const lost = getMultimodalProvider(config, { apiKey: 'synthetic-secret', fetchImpl: vi.fn(async () => { throw new TypeError('PRIVATE-MARKER') }) })
    await expect(lost.gradeEssay(essayInput)).rejects.toMatchObject({ code: 'provider_unavailable', details: { termination: 'unknown' } })
  })

  it('reports the selected model in health without reporting Kimi settings or credentials', async () => {
    const config = parseGatewayRuntimeConfig(environment())
    const provider = getMultimodalProvider(config, { apiKey: 'synthetic-secret', fetchImpl: vi.fn() })
    const health = await request(createServer({ runtimeConfig: config, multimodalProvider: provider })).get('/health')
    expect(health.status).toBe(200)
    expect(JSON.stringify(health.body)).toContain('dots-studio/dots-3-note-preview:free')
    expect(JSON.stringify(health.body)).not.toMatch(/kimi-k3|synthetic-secret/)
  })
})
