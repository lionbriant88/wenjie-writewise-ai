import { matchTranscriptQuote } from '../matchTranscriptQuote.js'
import { normalizeGradingResult } from '../normalizeGradingResult.js'
import { calculateDimensionMaxScore } from '../../../app/src/services/grading/scoringRules.js'
import type { AiGradingResultV1, GradingRequestV1, GradingProviderName } from '../types.js'
import { validateGeneratedRubric } from './validateRubric.js'
import type { ConfirmedTaskPackageV2 } from './types.js'

export interface MultimodalGradingResult extends AiGradingResultV1 { transcript: string; transcriptionWarnings: string[]; printedTextExcluded: boolean }
export type MultimodalNormalizationResult = { ok: true; result: MultimodalGradingResult } | { ok: false; error: { code: 'provider_invalid_response'; message: string; retryable: true } }
export interface MultimodalNormalizationContext { requestId: string; essayId: string; task: ConfirmedTaskPackageV2; provider: GradingProviderName; createdAt: string; confirmedTranscript?: string }

const INVALID_MESSAGE = 'AI grading result cannot be used safely.'
const CHANGE_TYPES = new Set(['grammar', 'spelling', 'word_choice', 'sentence_upgrade', 'coherence', 'logic_bridge', 'delete_suggestion', 'replace_sentence', 'reference_clarification'])
function invalid(): MultimodalNormalizationResult { return { ok: false, error: { code: 'provider_invalid_response', message: INVALID_MESSAGE, retryable: true } } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function text(value: unknown, maxLength = 10_000): string | null { if (typeof value !== 'string') return null; const trimmed = value.trim(); return trimmed && trimmed.length <= maxLength ? trimmed : null }
function textArray(value: unknown, maxItems: number, maxLength: number): string[] | null { if (!Array.isArray(value) || value.length > maxItems) return null; const result = value.map((item) => text(item, maxLength)); return result.every((item): item is string => item !== null) ? result : null }

function requestFor(context: MultimodalNormalizationContext, transcript: string): GradingRequestV1 | null {
  const rubric = validateGeneratedRubric(context.task.rubric)
  if (!rubric.ok || !Number.isInteger(context.task.fullScore) || context.task.fullScore < 1 || context.task.fullScore > 100) return null
  return { requestVersion: 'grading-request-v1', requestId: context.requestId, task: { taskId: context.task.taskId, writingGenre: 'practical_writing', fullScore: context.task.fullScore, prompt: { writingGenre: 'practical_writing', taskRequirement: context.task.materialSummary }, rubric: { status: 'confirmed', writingGoal: context.task.materialSummary, offTopicCriteria: [], dimensions: rubric.value.dimensions.map(({ id, name, weight, description, deductionFocus }) => ({ id, name, weight, description, deductionFocus })), excellentFeatures: [], reviewTriggers: [] } }, essay: { essayId: context.essayId, confirmedTranscript: transcript, ocrContext: { sourceKind: 'manual', hasKnownOcrRisk: false, riskCodes: [] } } }
}

interface CitationSplit<T> { grounded: unknown[]; ungrounded: T[] }

function splitIssues(value: unknown, transcript: string, essayId: string): CitationSplit<AiGradingResultV1['issues'][number]> | null {
  if (!Array.isArray(value)) return null
  const grounded: unknown[] = []; const ungrounded: AiGradingResultV1['issues'] = []; const seen = new Set<string>()
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) return null
    const type = text(item.type, 32), severity = text(item.severity, 16), originalText = text(item.originalText), suggestion = text(item.suggestion), explanation = text(item.explanation)
    if (!type || !['grammar', 'spelling', 'word_choice', 'structure'].includes(type) || !severity || !['low', 'medium', 'high'].includes(severity) || !originalText || !suggestion || !explanation || typeof item.requiresTeacherReview !== 'boolean') return null
    const signature = `${type}\u0000${severity}\u0000${originalText}\u0000${suggestion}`
    if (seen.has(signature)) return null
    seen.add(signature)
    if (matchTranscriptQuote(transcript, originalText)) grounded.push(item)
    else ungrounded.push({ id: `${essayId}-issue-unmatched-${index + 1}`, type: type as AiGradingResultV1['issues'][number]['type'], severity: severity as AiGradingResultV1['issues'][number]['severity'], originalText, suggestion, explanation, requiresTeacherReview: true })
  }
  return { grounded, ungrounded }
}

function splitRevisions(value: unknown, transcript: string, essayId: string): CitationSplit<AiGradingResultV1['sentenceRevisions'][number]> | null {
  if (!Array.isArray(value)) return null
  const grounded: unknown[] = []; const ungrounded: AiGradingResultV1['sentenceRevisions'] = []
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) return null
    const originalText = text(item.originalText), revisedText = text(item.revisedText), note = text(item.note)
    if (!originalText || !revisedText || !note) return null
    if (matchTranscriptQuote(transcript, originalText)) grounded.push(item)
    else ungrounded.push({ id: `${essayId}-revision-unmatched-${index + 1}`, originalText, revisedText, note, requiresTeacherReview: true })
  }
  return { grounded, ungrounded }
}

function splitUpgrades(value: unknown, transcript: string, essayId: string): CitationSplit<AiGradingResultV1['expressionUpgrades'][number]> | null {
  if (!Array.isArray(value)) return null
  const grounded: unknown[] = []; const ungrounded: AiGradingResultV1['expressionUpgrades'] = []
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) return null
    const originalText = text(item.originalText), upgradedText = text(item.upgradedText), note = text(item.note)
    if (!originalText || !upgradedText || !note) return null
    if (matchTranscriptQuote(transcript, originalText)) grounded.push(item)
    else ungrounded.push({ id: `${essayId}-upgrade-unmatched-${index + 1}`, originalText, upgradedText, note, requiresTeacherReview: true })
  }
  return { grounded, ungrounded }
}

function splitSentencePairs(value: unknown, transcript: string, essayId: string): CitationSplit<NonNullable<AiGradingResultV1['fullTextRevision']>['sentencePairs'][number]> | null {
  if (!isRecord(value) || !Array.isArray(value.sentencePairs)) return null
  const grounded: unknown[] = []; const ungrounded: NonNullable<AiGradingResultV1['fullTextRevision']>['sentencePairs'] = []
  for (const [index, item] of value.sentencePairs.entries()) {
    if (!isRecord(item)) return null
    const originalText = text(item.originalText), correctedText = text(item.correctedText), improvedText = text(item.improvedText), explanation = text(item.explanation)
    const changeTypes = item.changeTypes
    if (!originalText || !correctedText || !improvedText || !explanation || !Array.isArray(changeTypes) || !changeTypes.every((entry) => typeof entry === 'string' && CHANGE_TYPES.has(entry)) || typeof item.requiresTeacherReview !== 'boolean') return null
    if (matchTranscriptQuote(transcript, originalText)) grounded.push(item)
    else ungrounded.push({ id: `${essayId}-pair-unmatched-${index + 1}`, originalText, correctedText, improvedText, changeTypes: changeTypes as NonNullable<AiGradingResultV1['fullTextRevision']>['sentencePairs'][number]['changeTypes'], explanation, requiresTeacherReview: true })
  }
  return { grounded, ungrounded }
}

function rawScoresAreBounded(value: unknown, context: MultimodalNormalizationContext) {
  if (!Array.isArray(value)) return false
  const dimensions = new Map(context.task.rubric.dimensions.map((dimension) => [dimension.id, dimension]))
  return value.every((item) => {
    if (!isRecord(item) || typeof item.dimensionId !== 'string' || typeof item.score !== 'number' || !Number.isFinite(item.score)) return false
    const dimension = dimensions.get(item.dimensionId)
    return !dimension || (item.score >= 0 && item.score <= calculateDimensionMaxScore(context.task.fullScore, dimension.weight))
  })
}

export function normalizeMultimodalResult(payload: unknown, context: MultimodalNormalizationContext): MultimodalNormalizationResult {
  if (!isRecord(payload)) return invalid()
  const transcript = context.confirmedTranscript !== undefined
    ? typeof payload.transcript === 'string' && payload.transcript === context.confirmedTranscript
      ? context.confirmedTranscript
      : null
    : text(payload.transcript, 50_000)
  const transcriptionWarnings = textArray(payload.transcriptionWarnings, 50, 1_000)
  if (!transcript || !transcriptionWarnings || typeof payload.printedTextExcluded !== 'boolean') return invalid()
  const request = requestFor(context, transcript)
  const issues = splitIssues(payload.issues, transcript, context.essayId)
  const revisions = splitRevisions(payload.sentenceRevisions, transcript, context.essayId)
  const upgrades = splitUpgrades(payload.expressionUpgrades, transcript, context.essayId)
  const pairs = splitSentencePairs(payload.fullTextRevision, transcript, context.essayId)
  if (!request || !issues || !revisions || !upgrades || !pairs || !rawScoresAreBounded(payload.dimensionScores, context) || !isRecord(payload.fullTextRevision)) return invalid()
  const basePayload = { ...payload, issues: issues.grounded, sentenceRevisions: revisions.grounded, expressionUpgrades: upgrades.grounded, fullTextRevision: { ...payload.fullTextRevision, sentencePairs: pairs.grounded } }
  const normalized = normalizeGradingResult(basePayload, request, { provider: context.provider, createdAt: context.createdAt })
  if (!normalized.ok) return invalid()
  const reviewReasons = new Set(normalized.result.reviewReasons)
  if (transcriptionWarnings.length) reviewReasons.add('transcription_uncertain')
  if (!payload.printedTextExcluded) reviewReasons.add('printed_text_exclusion_uncertain')
  if (issues.ungrounded.length) reviewReasons.add('issue_quote_unmatched')
  if (revisions.ungrounded.length) reviewReasons.add('sentence_revision_quote_unmatched')
  if (upgrades.ungrounded.length) reviewReasons.add('expression_upgrade_quote_unmatched')
  if (pairs.ungrounded.length) reviewReasons.add('sentence_pair_quote_unmatched')
  const dimensionScores = normalized.result.dimensionScores.map((item) => matchTranscriptQuote(transcript, item.evidence) ? item : { ...item, requiresTeacherReview: true })
  if (dimensionScores.some(({ requiresTeacherReview }) => requiresTeacherReview)) reviewReasons.add('dimension_evidence_unmatched')
  const fullTextRevision = normalized.result.fullTextRevision ? { ...normalized.result.fullTextRevision, sentencePairs: [...normalized.result.fullTextRevision.sentencePairs, ...pairs.ungrounded] } : undefined
  return { ok: true, result: { ...normalized.result, status: reviewReasons.size ? 'partial' : 'success', dimensionScores, issues: [...normalized.result.issues, ...issues.ungrounded], sentenceRevisions: [...normalized.result.sentenceRevisions, ...revisions.ungrounded], expressionUpgrades: [...normalized.result.expressionUpgrades, ...upgrades.ungrounded], ...(fullTextRevision ? { fullTextRevision } : {}), reviewReasons: [...reviewReasons], transcript, transcriptionWarnings, printedTextExcluded: payload.printedTextExcluded } }
}
