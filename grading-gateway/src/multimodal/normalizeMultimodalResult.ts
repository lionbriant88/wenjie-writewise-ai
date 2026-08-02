import { matchTranscriptQuote } from '../matchTranscriptQuote.js'
import { normalizeGradingResult } from '../normalizeGradingResult.js'
import type { AiGradingResultV1, GradingRequestV1, GradingProviderName } from '../types.js'
import { validateGeneratedRubric } from './validateRubric.js'
import type { ConfirmedTaskPackageV2 } from './types.js'

export interface MultimodalGradingResult extends AiGradingResultV1 { transcript: string; transcriptionWarnings: string[]; printedTextExcluded: boolean }
export type MultimodalNormalizationResult = { ok: true; result: MultimodalGradingResult } | { ok: false; error: { code: 'provider_invalid_response'; message: string; retryable: true } }
export interface MultimodalNormalizationContext { requestId: string; essayId: string; task: ConfirmedTaskPackageV2; provider: GradingProviderName; createdAt: string }

const INVALID_MESSAGE = 'AI grading result cannot be used safely.'
function invalid(): MultimodalNormalizationResult { return { ok: false, error: { code: 'provider_invalid_response', message: INVALID_MESSAGE, retryable: true } } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function text(value: unknown, maxLength = 10_000): string | null { if (typeof value !== 'string') return null; const trimmed = value.trim(); return trimmed && trimmed.length <= maxLength ? trimmed : null }
function textArray(value: unknown, maxItems: number, maxLength: number): string[] | null { if (!Array.isArray(value) || value.length > maxItems) return null; const result = value.map((item) => text(item, maxLength)); return result.every((item): item is string => item !== null) ? result : null }

function requestFor(context: MultimodalNormalizationContext, transcript: string): GradingRequestV1 | null {
  const rubric = validateGeneratedRubric(context.task.rubric)
  if (!rubric.ok || !Number.isInteger(context.task.fullScore) || context.task.fullScore < 1 || context.task.fullScore > 100) return null
  return { requestVersion: 'grading-request-v1', requestId: context.requestId, task: { taskId: context.task.taskId, writingGenre: 'practical_writing', fullScore: context.task.fullScore, prompt: { writingGenre: 'practical_writing', taskRequirement: context.task.materialSummary }, rubric: { status: 'confirmed', writingGoal: context.task.materialSummary, offTopicCriteria: [], dimensions: rubric.value.dimensions.map(({ id, name, weight, description, deductionFocus }) => ({ id, name, weight, description, deductionFocus })), excellentFeatures: [], reviewTriggers: [] } }, essay: { essayId: context.essayId, confirmedTranscript: transcript, ocrContext: { sourceKind: 'manual', hasKnownOcrRisk: false, riskCodes: [] } } }
}

function unmatchedIssues(payload: Record<string, unknown>, transcript: string, essayId: string): AiGradingResultV1['issues'] | null {
  if (!Array.isArray(payload.issues)) return null
  const result: AiGradingResultV1['issues'] = []; const seen = new Set<string>()
  for (const [index, value] of payload.issues.entries()) {
    if (!isRecord(value)) return null
    const type = text(value.type, 32), severity = text(value.severity, 16), originalText = text(value.originalText), suggestion = text(value.suggestion), explanation = text(value.explanation)
    if (!type || !['grammar', 'spelling', 'word_choice', 'structure'].includes(type) || !severity || !['low', 'medium', 'high'].includes(severity) || !originalText || !suggestion || !explanation || typeof value.requiresTeacherReview !== 'boolean') return null
    const signature = `${type}\u0000${severity}\u0000${originalText}\u0000${suggestion}`
    if (seen.has(signature)) return null
    seen.add(signature)
    if (!matchTranscriptQuote(transcript, originalText)) result.push({ id: `${essayId}-issue-unmatched-${index + 1}`, type: type as AiGradingResultV1['issues'][number]['type'], severity: severity as AiGradingResultV1['issues'][number]['severity'], originalText, suggestion, explanation, requiresTeacherReview: true })
  }
  return result
}

export function normalizeMultimodalResult(payload: unknown, context: MultimodalNormalizationContext): MultimodalNormalizationResult {
  if (!isRecord(payload)) return invalid()
  const transcript = text(payload.transcript, 50_000), transcriptionWarnings = textArray(payload.transcriptionWarnings, 50, 1_000)
  if (!transcript || !transcriptionWarnings || typeof payload.printedTextExcluded !== 'boolean') return invalid()
  const request = requestFor(context, transcript), ungroundedIssues = unmatchedIssues(payload, transcript, context.essayId)
  if (!request || !ungroundedIssues || !Array.isArray(payload.issues)) return invalid()
  const basePayload = { ...payload, issues: payload.issues.filter((issue) => isRecord(issue) && text(issue.originalText) && matchTranscriptQuote(transcript, text(issue.originalText)!)) }
  const normalized = normalizeGradingResult(basePayload, request, { provider: context.provider, createdAt: context.createdAt })
  if (!normalized.ok) return invalid()
  const reviewReasons = new Set(normalized.result.reviewReasons)
  if (transcriptionWarnings.length) reviewReasons.add('transcription_uncertain')
  if (!payload.printedTextExcluded) reviewReasons.add('printed_text_exclusion_uncertain')
  if (ungroundedIssues.length) reviewReasons.add('issue_quote_unmatched')
  if (normalized.result.dimensionScores.some(({ evidence }) => !matchTranscriptQuote(transcript, evidence))) reviewReasons.add('dimension_evidence_unmatched')
  return { ok: true, result: { ...normalized.result, status: reviewReasons.size ? 'partial' : 'success', issues: [...normalized.result.issues, ...ungroundedIssues], reviewReasons: [...reviewReasons], transcript, transcriptionWarnings, printedTextExcluded: payload.printedTextExcluded } }
}
