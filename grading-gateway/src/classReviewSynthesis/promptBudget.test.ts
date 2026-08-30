import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { KimiMessage } from '../providers/kimiTransport.js'
import type { ClassReviewFramingCalibration } from './framingCalibrations.js'
import {
  checkClassReviewUtf8ByteLimit,
  preflightClassReviewPrompt,
  prepareClassReviewSynthesisRequest,
} from './promptBudget.js'
import { serializeClassReviewPromptWire } from './prompt.js'
import type { ClassReviewSynthesisRequestV1 } from './types.js'
import { validateClassReviewSynthesisRequest } from './validateRequest.js'

const calibration: ClassReviewFramingCalibration = {
  apiBase: 'https://api.moonshot.cn/v1', model: 'kimi-k3', reasoningEffort: 'low',
  policyVersion: 'class-review-policy-v1', schemaVersion: 'kimi-class-review-output-v1',
  projectionVersion: 'class-review-projection-v1', budgetVersion: 'class-review-prompt-budget-v1',
  wireSerializationVersion: 'class-review-wire-serialization-v1', framingTokens: 512,
}

const fixtures = JSON.parse(readFileSync(
  new URL('../../../test-fixtures/class-review/synthesis-contracts.json', import.meta.url), 'utf8',
)) as { requests: { pureStatistics: unknown; withGroups: unknown } }

function request(name: keyof typeof fixtures.requests): ClassReviewSynthesisRequestV1 {
  const parsed = validateClassReviewSynthesisRequest(fixtures.requests[name])
  if (!parsed.ok) throw new Error(`invalid fixture ${parsed.error.path}`)
  return parsed.value
}

function wireSizedMessages(target: number, count: 2 | 3): KimiMessage[] {
  const messages: KimiMessage[] = Array.from({ length: count }, (_, index) => ({
    role: index === 0 ? 'system' : 'user', content: '',
  }))
  const base = Buffer.byteLength(serializeClassReviewPromptWire(messages, {}), 'utf8')
  if (base > target) throw new Error('target below wire base')
  messages.at(-1)!.content = 'x'.repeat(target - base)
  expect(Buffer.byteLength(serializeClassReviewPromptWire(messages, {}), 'utf8')).toBe(target)
  return messages
}

describe('class-review prompt budget', () => {
  it('accepts byte equality and rejects +1 at both independent wire boundaries', () => {
    const prefixExact = serializeClassReviewPromptWire(wireSizedMessages(16_384, 2), {})
    const prefixOver = serializeClassReviewPromptWire(wireSizedMessages(16_385, 2), {})
    const finalExact = serializeClassReviewPromptWire(wireSizedMessages(49_152, 3), {})
    const finalOver = serializeClassReviewPromptWire(wireSizedMessages(49_153, 3), {})

    expect(checkClassReviewUtf8ByteLimit(prefixExact, 16_384)).toEqual({ ok: true, utf8Bytes: 16_384 })
    expect(checkClassReviewUtf8ByteLimit(prefixOver, 16_384)).toEqual({ ok: false, utf8Bytes: 16_385 })
    expect(checkClassReviewUtf8ByteLimit(finalExact, 49_152)).toEqual({ ok: true, utf8Bytes: 49_152 })
    expect(checkClassReviewUtf8ByteLimit(finalOver, 49_152)).toEqual({ ok: false, utf8Bytes: 49_153 })

    expect(preflightClassReviewPrompt({
      messages: wireSizedMessages(16_384, 2), schema: {}, calibration,
    })).toMatchObject({ ok: false, reason: 'controllable_units', fixedPrefixUtf8Bytes: 16_384 })
    expect(preflightClassReviewPrompt({
      messages: wireSizedMessages(16_385, 2), schema: {}, calibration,
    })).toMatchObject({ ok: false, reason: 'fixed_prefix_utf8_bytes', fixedPrefixUtf8Bytes: 16_385 })
    expect(preflightClassReviewPrompt({
      messages: wireSizedMessages(49_152, 3), schema: {}, calibration,
    })).toMatchObject({ ok: false, reason: 'controllable_units', finalWireUtf8Bytes: 49_152 })
    expect(preflightClassReviewPrompt({
      messages: wireSizedMessages(49_153, 3), schema: {}, calibration,
    })).toMatchObject({ ok: false, reason: 'final_wire_utf8_bytes', finalWireUtf8Bytes: 49_153 })
  })

  it('admits exactly 15,872 controllable plus 512 framing units and rejects +1', () => {
    const messages: KimiMessage[] = [{ role: 'system', content: 'policy' }, { role: 'user', content: '{}' }]
    const exact = preflightClassReviewPrompt({
      messages, schema: {}, tokenizer: { count: () => 15_872 }, calibration,
    })
    expect(exact).toMatchObject({
      ok: true, tokenizerCount: 15_872, controllableUnits: 15_872,
      framingTokens: 512, totalPromptTokens: 16_384,
    })
    const over = preflightClassReviewPrompt({
      messages, schema: {}, tokenizer: { count: () => 15_873 }, calibration,
    })
    expect(over).toMatchObject({
      ok: false, code: 'class_review_prompt_too_large', reason: 'controllable_units',
      controllableUnits: 15_873, totalPromptTokens: 16_385,
    })
  })

  it('always uses the conservative UTF-8 branch and treats invalid tokenizers as unavailable', () => {
    const byteHeavy = wireSizedMessages(15_873, 2)
    expect(preflightClassReviewPrompt({
      messages: byteHeavy, schema: {}, tokenizer: { count: () => 1 }, calibration,
    })).toMatchObject({ ok: false, reason: 'controllable_units', controllableUnits: 15_873 })

    const small: KimiMessage[] = [{ role: 'system', content: 'p' }, { role: 'user', content: '{}' }]
    const expectedBytes = Buffer.byteLength(serializeClassReviewPromptWire(small, {}), 'utf8')
    for (const count of [
      () => Number.NaN, () => Number.POSITIVE_INFINITY, () => -1, () => 1.5,
      () => Number.MAX_SAFE_INTEGER + 1, () => { throw new Error('synthetic tokenizer failure') },
    ]) {
      expect(preflightClassReviewPrompt({ messages: small, schema: {}, tokenizer: { count }, calibration }))
        .toMatchObject({ ok: true, tokenizerCount: null, controllableUnits: expectedBytes })
    }
  })

  it('fails closed on missing, mismatched, or over-reserve calibration without exposing wire text', () => {
    const messages: KimiMessage[] = [{ role: 'system', content: 'private policy' }, { role: 'user', content: '{}' }]
    for (const candidate of [
      null,
      { ...calibration, model: 'other-model' },
      { ...calibration, framingTokens: 513 },
    ]) {
      const result = preflightClassReviewPrompt({
        messages,
        schema: {},
        calibration: candidate as ClassReviewFramingCalibration | null,
      })
      expect(result).toMatchObject({ ok: false, code: 'class_review_prompt_calibration_missing' })
      expect(JSON.stringify(result)).not.toContain('private policy')
    }
  })

  it('packs the deterministic longest prefix without skipping and recomputes honest coverage', () => {
    const input = request('withGroups')
    const count = vi.fn((wire: string) => wire.includes('logic.bridge') ? 20_000 : 100)
    const prepared = prepareClassReviewSynthesisRequest({ request: input, tokenizer: { count }, calibration })

    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.request.groups.map(({ groupId }) => groupId)).toEqual(['grammar.tense'])
    expect(prepared.request.semanticCoverage).toEqual({
      projectedGroupCount: 1,
      eligibleGroupCount: 3,
      groupCoverage: 1 / 3,
      projectedDistinctEssaySupportSum: 2,
      eligibleDistinctEssaySupportSum: 4,
      supportWeightedCoverage: 1 / 2,
      projectedOccurrenceSum: 3,
      eligibleOccurrenceSum: 6,
      occurrenceWeightedCoverage: 1 / 2,
    })
    expect(count.mock.calls.some(([wire]) => String(wire).includes('logic.bridge'))).toBe(true)
  })

  it('distinguishes fixed-prefix failure from an eligible group that cannot fit', () => {
    const withGroups = request('withGroups')
    expect(prepareClassReviewSynthesisRequest({
      request: withGroups,
      tokenizer: { count: (wire) => wire.includes('grammar.tense') ? 20_000 : 100 },
      calibration,
    })).toMatchObject({ ok: false, code: 'class_review_projection_too_large' })

    expect(prepareClassReviewSynthesisRequest({
      request: withGroups, tokenizer: { count: () => 20_000 }, calibration,
    })).toMatchObject({ ok: false, code: 'class_review_prompt_too_large' })

    expect(prepareClassReviewSynthesisRequest({
      request: request('pureStatistics'), calibration: null,
    })).toMatchObject({ ok: false, code: 'class_review_prompt_calibration_missing' })
  })
})
