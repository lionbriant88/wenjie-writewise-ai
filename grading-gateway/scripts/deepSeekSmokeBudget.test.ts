import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { estimateReservation, reserveSmokeCall } from './deepSeekSmokeBudget.js'

const body = { model: 'deepseek-flash', max_tokens: 16384, messages: [{ role: 'user', content: [
  { type: 'text', text: 'Synthetic JSON task' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,eA==' } },
] }] }
const directory = () => mkdtempSync(join(tmpdir(), 'ww-deepseek-budget-'))
it('reserves peak uncached input, maximum output and conservative image/overhead costs', () => {
  const estimate = estimateReservation(body)
  expect(estimate.inputTokenBound).toBeGreaterThan(2048)
  expect(estimate.reservedCnyMicros).toBeGreaterThan(16384 * 8)
  expect(estimate.reservedUsdMicros).toBeGreaterThanOrEqual(Math.ceil(estimate.reservedCnyMicros / 6))
  expect(() => estimateReservation({ ...body, max_tokens: 16385 })).toThrow()
  expect(() => estimateReservation({ ...body, model: 'other' })).toThrow()
})
it('retains uncertain reservations and refuses duplicate cases or a fourth completion', () => {
  const dir = directory()
  reserveSmokeCall(dir, 'single-image', body)
  expect(() => reserveSmokeCall(dir, 'single-image', body)).toThrow()
  reserveSmokeCall(dir, 'rubric-image', body)
  reserveSmokeCall(dir, 'cloud-image', body)
  expect(() => reserveSmokeCall(dir, 'fourth', body)).toThrow()
  expect(JSON.parse(readFileSync(join(dir, 'attempt-1.json'), 'utf8')).caseId).toBe('single-image')
})
it('rejects oversized requests before reservation and fails closed on corrupt accounting', () => {
  const dir = directory()
  expect(() => reserveSmokeCall(dir, 'huge', { ...body, messages: [{ role: 'user', content: 'x'.repeat(300000) }] })).toThrow()
  writeFileSync(join(dir, 'attempt-1.json'), '{}')
  expect(() => reserveSmokeCall(dir, 'single-image', body)).toThrow()
})
it('settles only known bounded token usage and keeps unknown outcomes fully reserved', () => {
  const dir = directory()
  const larger = { ...body, messages: [{ role: 'user', content: 'x'.repeat(30000) }] }
  reserveSmokeCall(dir, 'single-image', larger)
  reserveSmokeCall(dir, 'diagnostic-image', larger)
  expect(() => reserveSmokeCall(dir, 'cloud-image', larger)).toThrow()
  writeFileSync(join(dir, 'result-1.json'), JSON.stringify({ usage: { uniqueAttempts: 1, totals: {
    promptTokens: { status: 'known', value: 100 }, completionTokens: { status: 'known', value: 20 }, totalTokens: { status: 'known', value: 120 },
  } } }))
  expect(() => reserveSmokeCall(dir, 'cloud-image', larger)).not.toThrow()
})
it('stops new calls when known usage exceeds a reservation instead of undercounting it', () => {
  const dir = directory()
  const entry = reserveSmokeCall(dir, 'single-image', body)
  const prompt = entry.inputTokenBound + 1
  writeFileSync(join(dir, 'result-1.json'), JSON.stringify({ usage: { uniqueAttempts: 1, totals: {
    promptTokens: { status: 'known', value: prompt }, completionTokens: { status: 'known', value: 20 }, totalTokens: { status: 'known', value: prompt + 20 },
  } } }))
  expect(() => reserveSmokeCall(dir, 'diagnostic-image', body)).toThrow()
})
it.each([{ inputTokenBound: undefined }, { inputTokenBound: -1 }, { outputTokenBound: 16385 }, { reservedCnyMicros: 1 }, { reservedUsdMicros: 1 }])('rejects inconsistent reservation fields %j', (change) => {
  const dir = directory()
  const entry = reserveSmokeCall(dir, 'single-image', body)
  writeFileSync(join(dir, 'attempt-1.json'), JSON.stringify({ ...entry, ...change }))
  expect(() => reserveSmokeCall(dir, 'diagnostic-image', body)).toThrow()
})
