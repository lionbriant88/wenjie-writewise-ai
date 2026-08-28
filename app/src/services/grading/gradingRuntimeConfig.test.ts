import { describe, expect, it } from 'vitest'
import { parseGradingRuntimeConfig } from './gradingRuntimeConfig'

describe('parseGradingRuntimeConfig', () => {
  it('parses the explicit real adaptive profile without retaining unrelated or secret fields', () => {
    const result = parseGradingRuntimeConfig({
      VITE_GRADING_MODE: 'real',
      VITE_GRADING_API_BASE: 'http://127.0.0.1:8790/',
      VITE_GRADING_QUEUE_MODE: 'adaptive-v1',
      VITE_GRADING_MAX_IN_FLIGHT: '4',
      VITE_KIMI_API_KEY: 'PRIVATE-NOT-A-REAL-KEY',
    })
    expect(result).toEqual({
      ok: true,
      value: {
        mode: 'real', apiBase: 'http://127.0.0.1:8790',
        queueMode: 'adaptive-v1', maxInFlight: 4,
      },
    })
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
  })

  it('keeps explicit mock mode local and defaults its queue to the one-worker legacy profile', () => {
    expect(parseGradingRuntimeConfig({ VITE_GRADING_MODE: 'mock' })).toEqual({
      ok: true,
      value: { mode: 'mock', queueMode: 'single-legacy', maxInFlight: 1 },
    })
  })

  it('fixes the explicit single-legacy profile to one worker even when a larger valid cap remains configured', () => {
    expect(parseGradingRuntimeConfig({
      VITE_GRADING_MODE: 'real',
      VITE_GRADING_API_BASE: 'https://gateway.example.test/base/',
      VITE_GRADING_QUEUE_MODE: 'single-legacy',
      VITE_GRADING_MAX_IN_FLIGHT: '9',
    })).toEqual({
      ok: true,
      value: {
        mode: 'real', apiBase: 'https://gateway.example.test/base',
        queueMode: 'single-legacy', maxInFlight: 1,
      },
    })
  })

  it.each([
    ['missing mode', {}],
    ['unknown mode', { VITE_GRADING_MODE: 'automatic' }],
    ['case-shifted mode', { VITE_GRADING_MODE: 'REAL' }],
    ['real without API base', { VITE_GRADING_MODE: 'real', VITE_GRADING_QUEUE_MODE: 'single-legacy' }],
    ['real with relative API base', { VITE_GRADING_MODE: 'real', VITE_GRADING_API_BASE: '/gateway', VITE_GRADING_QUEUE_MODE: 'single-legacy' }],
    ['real with credentialed API base', { VITE_GRADING_MODE: 'real', VITE_GRADING_API_BASE: 'https://user:pass@gateway.test', VITE_GRADING_QUEUE_MODE: 'single-legacy' }],
    ['real without queue mode', { VITE_GRADING_MODE: 'real', VITE_GRADING_API_BASE: 'https://gateway.test' }],
    ['unknown queue mode', { VITE_GRADING_MODE: 'real', VITE_GRADING_API_BASE: 'https://gateway.test', VITE_GRADING_QUEUE_MODE: 'unbounded' }],
    ['adaptive without hard cap', { VITE_GRADING_MODE: 'real', VITE_GRADING_API_BASE: 'https://gateway.test', VITE_GRADING_QUEUE_MODE: 'adaptive-v1' }],
    ['adaptive zero cap', { VITE_GRADING_MODE: 'real', VITE_GRADING_API_BASE: 'https://gateway.test', VITE_GRADING_QUEUE_MODE: 'adaptive-v1', VITE_GRADING_MAX_IN_FLIGHT: '0' }],
    ['adaptive fractional cap', { VITE_GRADING_MODE: 'real', VITE_GRADING_API_BASE: 'https://gateway.test', VITE_GRADING_QUEUE_MODE: 'adaptive-v1', VITE_GRADING_MAX_IN_FLIGHT: '1.5' }],
    ['adaptive unsafe cap', { VITE_GRADING_MODE: 'real', VITE_GRADING_API_BASE: 'https://gateway.test', VITE_GRADING_QUEUE_MODE: 'adaptive-v1', VITE_GRADING_MAX_IN_FLIGHT: '9007199254740992' }],
    ['invalid optional legacy cap', { VITE_GRADING_MODE: 'real', VITE_GRADING_API_BASE: 'https://gateway.test', VITE_GRADING_QUEUE_MODE: 'single-legacy', VITE_GRADING_MAX_IN_FLIGHT: '-1' }],
  ])('fails closed for %s', (_label, env) => {
    expect(parseGradingRuntimeConfig(env)).toEqual({ ok: false })
  })
})
