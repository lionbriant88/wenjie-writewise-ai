import { readFileSync } from 'node:fs'
import { parse } from 'dotenv'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { parseGatewayRuntimeConfig, GatewayRuntimeConfigError } from '../gatewayRuntimeConfig.js'
import { createServer } from '../server.js'
import { getMultimodalProvider } from './index.js'

function environment(overrides: Record<string, string | undefined> = {}) {
  const base = parse(readFileSync(new URL('../../config/openrouter.env.example', import.meta.url)))
  return { ...base, GRADING_PROVIDER: 'deepseek', DEEPSEEK_MODEL: 'deepseek-flash',
    DEEPSEEK_MAX_COMPLETION_TOKENS: '16384', ...overrides }
}
const rubric = {
  taskName: 'Synthetic activity', materialSummary: 'Recommend a school club.',
  writingRequirements: ['Use clear English.'], constraints: [], reviewWarnings: [],
  dimensions: [
    { id: 'content', name: 'Content', weight: 95, description: 'Recommend a club.', deductionFocus: [], sourceEvidence: [] },
    { id: 'legibility', name: 'Legibility', weight: 5, description: 'Readable writing.', deductionFocus: [], sourceEvidence: [] },
  ],
}
const essay = { requestId: 'synthetic', essayId: 'private-student',
  task: { taskId: 'private-task', fullScore: 15, ...rubric, rubric },
  pages: [{ pageId: 'first', mimeType: 'image/png' as const, buffer: Buffer.from('first') },
    { pageId: 'second', mimeType: 'image/png' as const, buffer: Buffer.from('second') }],
  signal: new AbortController().signal }
function reply(value: unknown, finishReason = 'stop') {
  return new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(value) } }],
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, prompt_cache_hit_tokens: 100 } }))
}
describe('DeepSeek official direct integration', () => {
  it('uses official JSON mode with the schema in the prompt, one completion, and no router parameters', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply(rubric))
    const provider = getMultimodalProvider(parseGatewayRuntimeConfig(environment()), { apiKey: 'synthetic-secret', fetchImpl })
    const result = await provider.generateRubric({ requestId: 'synthetic', fullScore: 15, writingRequirement: 'Use clear English.', materials: [], signal: essay.signal })
    expect(result.value).toEqual(rubric)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.deepseek.com/chat/completions')
    const init = fetchImpl.mock.calls[0]![1]!
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({ model: 'deepseek-flash', max_tokens: 16384, stream: false,
      thinking: { type: 'disabled' }, response_format: { type: 'json_object' } })
    expect(init.redirect).toBe('error')
    expect(JSON.stringify(body.messages)).toContain('JSON Schema')
    expect(JSON.stringify(body.messages)).toContain('required')
    for (const field of ['provider', 'models', 'reasoning', 'prompt_cache_key', 'max_completion_tokens']) expect(body).not.toHaveProperty(field)
    expect(result.attempts[0]?.usage.cachedTokens).toEqual({ status: 'known', value: 100 })
    expect(JSON.stringify(result)).not.toContain('synthetic-secret')
  })
  it('preserves image order in one request, then supports zero-image confirmed text', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply({ transcript: 'Synthetic.' }))
    const provider = getMultimodalProvider(parseGatewayRuntimeConfig(environment()), { apiKey: 'synthetic-secret', fetchImpl })
    await provider.gradeEssay(essay)
    await provider.gradeEssay({ ...essay, pages: [], confirmedTranscript: 'Teacher confirmed text.' })
    const bodies = fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init!.body)))
    const images = (body: any) => body.messages.flatMap((m: any) => Array.isArray(m.content) ? m.content.filter((p: any) => p.type === 'image_url').map((p: any) => p.image_url.url) : [])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(images(bodies[0])).toEqual(['data:image/png;base64,Zmlyc3Q=', 'data:image/png;base64,c2Vjb25k'])
    expect(images(bodies[1])).toEqual([])
    expect(JSON.stringify(bodies)).not.toMatch(/private-student|private-task/)
  })
  it.each([
    { DEEPSEEK_MODEL: undefined }, { DEEPSEEK_MODEL: 'deepseek-v4-pro' },
    { DEEPSEEK_API_BASE: 'https://example.invalid' },
    { DEEPSEEK_MAX_COMPLETION_TOKENS: '0' }, { DEEPSEEK_MAX_COMPLETION_TOKENS: '16385' },
    { GRADING_RUBRIC_STRATEGY: 'two-pass-legacy' }, { GRADING_ESSAY_PROMPT_PROFILE: 'legacy' },
    { GRADING_EXECUTION_REGISTRY: 'direct-legacy' }, { CLASS_REVIEW_SYNTHESIS_MODE: 'kimi' },
  ])('fails closed for unsupported configuration %j', (overrides) => {
    expect(() => parseGatewayRuntimeConfig(environment(overrides))).toThrow(GatewayRuntimeConfigError)
  })
  it('requires its own valid credential', () => {
    const config = parseGatewayRuntimeConfig(environment())
    const fetchImpl = vi.fn()
    for (const apiKey of [undefined, '', 'bad\nkey']) expect(() => getMultimodalProvider(config, { apiKey, fetchImpl })).toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('rejects truncation without retries and preserves unknown network outcomes', async () => {
    const config = parseGatewayRuntimeConfig(environment())
    const fetchImpl = vi.fn<typeof fetch>(async () => reply({}, 'length'))
    await expect(getMultimodalProvider(config, { apiKey: 'synthetic-secret', fetchImpl }).gradeEssay(essay)).rejects.toMatchObject({ diagnosticCode: 'completion_truncated' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await expect(getMultimodalProvider(config, { apiKey: 'synthetic-secret', fetchImpl: async () => { throw Error('PRIVATE') } }).gradeEssay(essay)).rejects.toMatchObject({ details: { termination: 'unknown' } })
  })
  it('reports the selected model without legacy Kimi settings or credentials', async () => {
    const config = parseGatewayRuntimeConfig(environment())
    const health = await request(createServer({ runtimeConfig: config, multimodalProvider: getMultimodalProvider(config, { apiKey: 'synthetic-secret', fetchImpl: vi.fn() }) })).get('/health')
    expect(health.body.runtime).toMatchObject({ provider: 'deepseek', model: 'deepseek-flash', hardLimit: 1 })
    expect(JSON.stringify(health.body)).not.toMatch(/kimi-k3|synthetic-secret|reasoningEffort/)
  })
})
