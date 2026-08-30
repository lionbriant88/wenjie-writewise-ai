import type { KimiMessage } from '../providers/kimiTransport.js'
import { classReviewProviderOutputSchema } from './providerContract.js'
import {
  isExactClassReviewFramingCalibration,
  type ClassReviewFramingCalibration,
} from './framingCalibrations.js'
import {
  CONTROLLABLE_PROMPT_TOKENS_V1,
  FINAL_PROVIDER_TEXT_UTF8_BYTES_V1,
  FIXED_PREFIX_UTF8_BYTES_V1,
  TOTAL_PROMPT_TOKENS_V1,
} from './limits.js'
import {
  buildClassReviewMessages,
  serializeClassReviewFixedPrefixWire,
  serializeClassReviewPromptWire,
} from './prompt.js'
import type {
  ClassReviewSynthesisRequestV1,
  SemanticCoverageV1,
  SynthesisGroupV1,
} from './types.js'

export interface ClassReviewPromptTokenizer {
  count(serializedControllablePayload: string): number
}

export type ClassReviewPromptBudgetFailureReason =
  | 'calibration'
  | 'fixed_prefix_utf8_bytes'
  | 'final_wire_utf8_bytes'
  | 'controllable_units'
  | 'total_prompt_tokens'

interface ClassReviewPromptBudgetMetrics {
  fixedPrefixUtf8Bytes: number
  finalWireUtf8Bytes: number
  tokenizerCount: number | null
  controllableUnits: number
  framingTokens: number | null
  totalPromptTokens: number | null
}

export interface ClassReviewPromptBudgetSuccess extends ClassReviewPromptBudgetMetrics {
  ok: true
  framingTokens: number
  totalPromptTokens: number
}

export interface ClassReviewPromptBudgetFailure extends ClassReviewPromptBudgetMetrics {
  ok: false
  code: 'class_review_prompt_too_large' | 'class_review_prompt_calibration_missing'
  reason: ClassReviewPromptBudgetFailureReason
}

export type ClassReviewPromptBudgetResult =
  | ClassReviewPromptBudgetSuccess
  | ClassReviewPromptBudgetFailure

export function checkClassReviewUtf8ByteLimit(
  serialized: string,
  limit: number,
): { ok: boolean; utf8Bytes: number } {
  const utf8Bytes = Buffer.byteLength(serialized, 'utf8')
  return { ok: utf8Bytes <= limit, utf8Bytes }
}

function countWithTokenizer(
  tokenizer: ClassReviewPromptTokenizer | undefined,
  serialized: string,
): number | null {
  if (!tokenizer) return null
  try {
    const count = tokenizer.count(serialized)
    return Number.isSafeInteger(count) && count >= 0 ? count : null
  } catch {
    return null
  }
}

export function preflightClassReviewPrompt(input: {
  messages: readonly KimiMessage[]
  schema: unknown
  tokenizer?: ClassReviewPromptTokenizer
  calibration: ClassReviewFramingCalibration | null
}): ClassReviewPromptBudgetResult {
  const fixedPrefix = serializeClassReviewFixedPrefixWire(input.messages, input.schema)
  const finalWire = serializeClassReviewPromptWire(input.messages, input.schema)
  const fixedPrefixUtf8Bytes = Buffer.byteLength(fixedPrefix, 'utf8')
  const finalWireUtf8Bytes = Buffer.byteLength(finalWire, 'utf8')

  if (!isExactClassReviewFramingCalibration(input.calibration)) {
    return {
      ok: false,
      code: 'class_review_prompt_calibration_missing',
      reason: 'calibration',
      fixedPrefixUtf8Bytes,
      finalWireUtf8Bytes,
      tokenizerCount: null,
      controllableUnits: finalWireUtf8Bytes,
      framingTokens: null,
      totalPromptTokens: null,
    }
  }

  const tokenizerCount = countWithTokenizer(input.tokenizer, finalWire)
  const controllableUnits = Math.max(tokenizerCount ?? 0, finalWireUtf8Bytes)
  const framingTokens = input.calibration.framingTokens
  const totalPromptTokens = controllableUnits + framingTokens
  const metrics = {
    fixedPrefixUtf8Bytes,
    finalWireUtf8Bytes,
    tokenizerCount,
    controllableUnits,
    framingTokens,
    totalPromptTokens,
  }

  if (fixedPrefixUtf8Bytes > FIXED_PREFIX_UTF8_BYTES_V1) {
    return { ok: false, code: 'class_review_prompt_too_large', reason: 'fixed_prefix_utf8_bytes', ...metrics }
  }
  if (finalWireUtf8Bytes > FINAL_PROVIDER_TEXT_UTF8_BYTES_V1) {
    return { ok: false, code: 'class_review_prompt_too_large', reason: 'final_wire_utf8_bytes', ...metrics }
  }
  if (controllableUnits > CONTROLLABLE_PROMPT_TOKENS_V1) {
    return { ok: false, code: 'class_review_prompt_too_large', reason: 'controllable_units', ...metrics }
  }
  if (totalPromptTokens > TOTAL_PROMPT_TOKENS_V1) {
    return { ok: false, code: 'class_review_prompt_too_large', reason: 'total_prompt_tokens', ...metrics }
  }
  return { ok: true, ...metrics }
}

function coverageForPrefix(
  original: SemanticCoverageV1,
  groups: readonly SynthesisGroupV1[],
): SemanticCoverageV1 {
  const projectedDistinctEssaySupportSum = groups.reduce(
    (sum, group) => sum + group.distinctEssaySupport,
    0,
  )
  const projectedOccurrenceSum = groups.reduce(
    (sum, group) => sum + group.occurrenceCount,
    0,
  )
  return {
    projectedGroupCount: groups.length,
    eligibleGroupCount: original.eligibleGroupCount,
    groupCoverage: original.eligibleGroupCount === 0
      ? 1
      : groups.length / original.eligibleGroupCount,
    projectedDistinctEssaySupportSum,
    eligibleDistinctEssaySupportSum: original.eligibleDistinctEssaySupportSum,
    supportWeightedCoverage: original.eligibleDistinctEssaySupportSum === 0
      ? 1
      : projectedDistinctEssaySupportSum / original.eligibleDistinctEssaySupportSum,
    projectedOccurrenceSum,
    eligibleOccurrenceSum: original.eligibleOccurrenceSum,
    occurrenceWeightedCoverage: original.eligibleOccurrenceSum === 0
      ? 1
      : projectedOccurrenceSum / original.eligibleOccurrenceSum,
  }
}

function requestForPrefix(
  request: ClassReviewSynthesisRequestV1,
  groups: readonly SynthesisGroupV1[],
): ClassReviewSynthesisRequestV1 {
  return {
    ...request,
    groups: [...groups],
    semanticCoverage: coverageForPrefix(request.semanticCoverage, groups),
  }
}

export type ClassReviewPreparationErrorCode =
  | 'class_review_prompt_too_large'
  | 'class_review_projection_too_large'
  | 'class_review_prompt_calibration_missing'

export type ClassReviewPromptPreparationResult =
  | {
    ok: true
    request: ClassReviewSynthesisRequestV1
    messages: KimiMessage[]
    budget: ClassReviewPromptBudgetSuccess
  }
  | { ok: false; code: ClassReviewPreparationErrorCode }

export function prepareClassReviewSynthesisRequest(input: {
  request: ClassReviewSynthesisRequestV1
  tokenizer?: ClassReviewPromptTokenizer
  calibration: ClassReviewFramingCalibration | null
}): ClassReviewPromptPreparationResult {
  let admittedRequest = requestForPrefix(input.request, [])
  let messages = buildClassReviewMessages(admittedRequest)
  let budget = preflightClassReviewPrompt({
    messages,
    schema: classReviewProviderOutputSchema,
    tokenizer: input.tokenizer,
    calibration: input.calibration,
  })
  if (!budget.ok) {
    return {
      ok: false,
      code: budget.code === 'class_review_prompt_calibration_missing'
        ? budget.code
        : 'class_review_prompt_too_large',
    }
  }

  for (let index = 0; index < input.request.groups.length; index += 1) {
    const candidateRequest = requestForPrefix(input.request, input.request.groups.slice(0, index + 1))
    const candidateMessages = buildClassReviewMessages(candidateRequest)
    const candidateBudget = preflightClassReviewPrompt({
      messages: candidateMessages,
      schema: classReviewProviderOutputSchema,
      tokenizer: input.tokenizer,
      calibration: input.calibration,
    })
    if (!candidateBudget.ok) break
    admittedRequest = candidateRequest
    messages = candidateMessages
    budget = candidateBudget
  }

  if (input.request.semanticCoverage.eligibleGroupCount > 0 && admittedRequest.groups.length === 0) {
    return { ok: false, code: 'class_review_projection_too_large' }
  }
  return { ok: true, request: admittedRequest, messages, budget }
}
