import { matchTranscriptQuote } from '../matchTranscriptQuote.js'
import { normalizeGradingResult } from '../normalizeGradingResult.js'
import { calculateDimensionMaxScore } from '../../../app/src/services/grading/scoringRules.js'
import type { AiGradingResultV1, GradingRequestV1, GradingProviderName } from '../types.js'
import { validateGeneratedRubric } from './validateRubric.js'
import { applyResultPolicy } from './resultPolicy.js'
import type { ResultPolicyInput } from './resultPolicy.js'
import type { ConfirmedTaskPackageV2 } from './types.js'
import type { RawLegibilityIssueV1, RawLogicIssueV1, RawMultimodalIssueV1, RawSentencePairV1, RawSentenceRevisionV1 } from './types.js'

export interface MultimodalGradingResult extends AiGradingResultV1 { transcript: string; recognitionWarnings: string[]; printedTextExcluded: boolean }
export type MultimodalNormalizationResult = { ok: true; result: MultimodalGradingResult } | { ok: false; error: { code: 'provider_invalid_response'; message: string; retryable: true } }
export interface MultimodalNormalizationContext { requestId: string; essayId: string; task: ConfirmedTaskPackageV2; provider: GradingProviderName; createdAt: string; confirmedTranscript?: string }

const INVALID_MESSAGE = 'AI grading result cannot be used safely.'
const CHANGE_TYPES = new Set(['grammar', 'spelling', 'word_choice', 'sentence_upgrade', 'coherence', 'logic_bridge', 'delete_suggestion', 'replace_sentence', 'reference_clarification'])
function invalid(): MultimodalNormalizationResult { return { ok: false, error: { code: 'provider_invalid_response', message: INVALID_MESSAGE, retryable: true } } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function text(value: unknown, maxLength = 10_000): string | null { if (typeof value !== 'string') return null; const trimmed = value.trim(); return trimmed && trimmed.length <= maxLength ? trimmed : null }
function textArray(value: unknown, maxItems: number, maxLength: number): string[] | null { if (!Array.isArray(value) || value.length > maxItems) return null; const result = value.map((item) => text(item, maxLength)); return result.every((item): item is string => item !== null) ? result : null }

function hasUniqueQuote(transcript: string, quote: string): boolean {
  const start = transcript.indexOf(quote)
  return start >= 0 && transcript.indexOf(quote, start + quote.length) < 0
}

function parseRawIssues(value: unknown): RawMultimodalIssueV1[] | null {
  if (!Array.isArray(value)) return null
  const parsed: RawMultimodalIssueV1[] = []
  for (const item of value) {
    if (!isRecord(item)) return null
    const issueKey = text(item.issueKey, 200), type = text(item.type, 32), severity = text(item.severity, 16)
    const originalText = text(item.originalText), suggestion = text(item.suggestion), explanation = text(item.explanation)
    if (!issueKey || !type || !['grammar', 'spelling', 'word_choice', 'structure'].includes(type) || !severity || !['low', 'medium', 'high'].includes(severity) || !originalText || !suggestion || !explanation || !['certain', 'uncertain'].includes(String(item.evidenceCertainty)) || typeof item.requiresTeacherReview !== 'boolean') return null
    parsed.push({ issueKey, type: type as RawMultimodalIssueV1['type'], severity: severity as RawMultimodalIssueV1['severity'], originalText, suggestion, explanation, evidenceCertainty: item.evidenceCertainty as RawMultimodalIssueV1['evidenceCertainty'], requiresTeacherReview: item.requiresTeacherReview })
  }
  return parsed
}

function parseRawSentenceRevisions(value: unknown): RawSentenceRevisionV1[] | null {
  if (!Array.isArray(value)) return null
  const parsed: RawSentenceRevisionV1[] = []
  for (const item of value) {
    if (!isRecord(item) || !Array.isArray(item.relatedIssueKeys) || !Array.isArray(item.changeTypes)) return null
    const originalText = text(item.originalText), revisedText = text(item.revisedText), note = text(item.note)
    const relatedIssueKeys = textArray(item.relatedIssueKeys, 50, 200)
    if (!originalText || !revisedText || !note || !relatedIssueKeys || !item.changeTypes.every((entry) => typeof entry === 'string' && CHANGE_TYPES.has(entry))) return null
    parsed.push({ originalText, revisedText, note, relatedIssueKeys, changeTypes: [...item.changeTypes] as RawSentenceRevisionV1['changeTypes'] })
  }
  return parsed
}

function parseRawSentencePairs(value: unknown): RawSentencePairV1[] | null {
  if (!Array.isArray(value)) return null
  const parsed: RawSentencePairV1[] = []
  for (const item of value) {
    if (!isRecord(item) || !Array.isArray(item.relatedIssueKeys) || !Array.isArray(item.changeTypes)) return null
    const originalText = text(item.originalText), correctedText = text(item.correctedText), improvedText = text(item.improvedText), explanation = text(item.explanation)
    const relatedIssueKeys = textArray(item.relatedIssueKeys, 50, 200)
    if (!originalText || !correctedText || !improvedText || !explanation || !relatedIssueKeys || typeof item.requiresTeacherReview !== 'boolean' || !item.changeTypes.every((entry) => typeof entry === 'string' && CHANGE_TYPES.has(entry))) return null
    parsed.push({ originalText, correctedText, improvedText, relatedIssueKeys, changeTypes: [...item.changeTypes] as RawSentencePairV1['changeTypes'], explanation, requiresTeacherReview: item.requiresTeacherReview })
  }
  return parsed
}

function parseRawLogicIssues(value: unknown): RawLogicIssueV1[] | null {
  if (!Array.isArray(value)) return null
  const parsed: RawLogicIssueV1[] = []
  const subTypes = new Set<RawLogicIssueV1['subType']>(['weak_connection', 'unclear_logic', 'missing_cause_effect', 'unclear_transition', 'topic_drift', 'irrelevant_sentence', 'unclear_reference', 'missing_motivation', 'plot_gap'])
  const actions = new Set<RawLogicIssueV1['suggestedAction']>(['add_connector', 'add_bridge_sentence', 'delete_sentence', 'replace_sentence', 'clarify_reference', 'ask_student_to_explain'])
  for (const item of value) {
    if (!isRecord(item)) return null
    const issueKey = text(item.issueKey, 200), originalText = text(item.originalText), contextBefore = text(item.contextBefore), contextAfter = text(item.contextAfter), subType = text(item.subType, 32), severity = text(item.severity, 16), diagnosis = text(item.diagnosis), suggestedAction = text(item.suggestedAction, 32), conservativeSuggestion = text(item.conservativeSuggestion), polishedSuggestion = text(item.polishedSuggestion)
    if (!issueKey || !originalText || !contextBefore || !contextAfter || !subType || !subTypes.has(subType as RawLogicIssueV1['subType']) || !severity || !['low', 'medium', 'high'].includes(severity) || !diagnosis || !suggestedAction || !actions.has(suggestedAction as RawLogicIssueV1['suggestedAction']) || !conservativeSuggestion || !polishedSuggestion || typeof item.requiresTeacherReview !== 'boolean') return null
    parsed.push({ issueKey, originalText, contextBefore, contextAfter, subType: subType as RawLogicIssueV1['subType'], severity: severity as RawLogicIssueV1['severity'], diagnosis, suggestedAction: suggestedAction as RawLogicIssueV1['suggestedAction'], conservativeSuggestion, polishedSuggestion, requiresTeacherReview: item.requiresTeacherReview })
  }
  return parsed
}

function parseRawLegibilityIssues(value: unknown): RawLegibilityIssueV1[] | null {
  if (!Array.isArray(value)) return null
  const parsed: RawLegibilityIssueV1[] = []
  for (const item of value) {
    if (!isRecord(item)) return null
    const issueKey = text(item.issueKey, 200), transcriptText = text(item.transcriptText), possibleReadings = textArray(item.possibleReadings, 4, 1_000), regionDescription = text(item.regionDescription), explanation = text(item.explanation), defaultOutcome = text(item.defaultOutcome, 64)
    if (!issueKey || !transcriptText || !possibleReadings || possibleReadings.length < 2 || typeof item.pageNumber !== 'number' || !Number.isInteger(item.pageNumber) || item.pageNumber < 1 || !regionDescription || !explanation || defaultOutcome !== 'count_as_legibility_error') return null
    parsed.push({ issueKey, transcriptText, possibleReadings, pageNumber: item.pageNumber, regionDescription, explanation, defaultOutcome })
  }
  return parsed
}

function parseLogicNotes(value: unknown): Array<{ quote: string; note: string }> | null {
  if (!Array.isArray(value)) return null
  const parsed: Array<{ quote: string; note: string }> = []
  for (const item of value) {
    if (!isRecord(item)) return null
    const quote = text(item.quote), note = text(item.note)
    if (!quote || !note) return null
    parsed.push({ quote, note })
  }
  return parsed
}

function dimensionReasons(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const reasons: string[] = []
  for (const item of value) {
    if (!isRecord(item)) return null
    const reason = text(item.reason)
    if (!reason) return null
    reasons.push(reason)
  }
  return reasons
}

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

function splitLogicNotes(value: unknown, transcript: string): CitationSplit<{ quote: string; note: string }> | null {
  if (!Array.isArray(value)) return null
  const grounded: { quote: string; note: string }[] = []; const ungrounded: { quote: string; note: string }[] = []
  for (const item of value) {
    if (!isRecord(item)) return null
    const quote = text(item.quote), note = text(item.note)
    if (!quote || !note) return null
    if (matchTranscriptQuote(transcript, quote)) grounded.push({ quote, note })
    else ungrounded.push({ quote, note })
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
  const recognitionWarnings = textArray(payload.recognitionWarnings, 50, 1_000)
  if (!transcript || !recognitionWarnings || typeof payload.printedTextExcluded !== 'boolean') return invalid()
  const request = requestFor(context, transcript)
  const issues = parseRawIssues(payload.issues)
  const revisions = parseRawSentenceRevisions(payload.sentenceRevisions)
  const upgrades = splitUpgrades(payload.expressionUpgrades, transcript, context.essayId)
  const pairs = isRecord(payload.fullTextRevision) ? parseRawSentencePairs(payload.fullTextRevision.sentencePairs) : null
  const logicNotes = isRecord(payload.fullTextRevision) ? parseLogicNotes(payload.fullTextRevision.logicNotes) : null
  const logicIssues = isRecord(payload.fullTextRevision) ? parseRawLogicIssues(payload.fullTextRevision.logicIssues) : null
  const legibilityIssues = parseRawLegibilityIssues(payload.legibilityIssues)
  const scoreReasons = dimensionReasons(payload.dimensionScores)
  const overallComment = text(payload.overallComment) ?? ''
  if (!request || !issues || !revisions || !upgrades || !pairs || !logicNotes || !logicIssues || !legibilityIssues || !scoreReasons || !rawScoresAreBounded(payload.dimensionScores, context) || !isRecord(payload.fullTextRevision) || logicNotes.some(({ quote }) => !hasUniqueQuote(transcript, quote))) return invalid()
  const policyInput: ResultPolicyInput = { issues, sentenceRevisions: revisions, sentencePairs: pairs, logicIssues, legibilityIssues, dimensionReasons: scoreReasons, overallComment, logicNotes: logicNotes.map(({ note }) => note) }
  const policy = applyResultPolicy(policyInput, transcript)
  if (!policy) return invalid()
  const keptLogicNotes = logicNotes.filter(({ quote }) => !legibilityIssues.some(({ transcriptText }) => transcriptText === quote))
  const basePayload = { ...payload, issues: policy.issues, sentenceRevisions: policy.sentenceRevisions, expressionUpgrades: upgrades.grounded, fullTextRevision: { ...payload.fullTextRevision, correctedText: policy.correctedText, sentencePairs: policy.sentencePairs, logicNotes: keptLogicNotes } }
  const normalized = normalizeGradingResult(basePayload, request, { provider: context.provider, createdAt: context.createdAt })
  if (!normalized.ok) return invalid()
  const reviewReasons = new Set(normalized.result.reviewReasons)
  if (recognitionWarnings.length) reviewReasons.add('recognition_uncertain')
  if (!payload.printedTextExcluded) reviewReasons.add('printed_text_exclusion_uncertain')
  if (upgrades.ungrounded.length) reviewReasons.add('expression_upgrade_quote_unmatched')
  const dimensionScores = normalized.result.dimensionScores.map((item) => matchTranscriptQuote(transcript, item.evidence) ? item : { ...item, requiresTeacherReview: true })
  if (dimensionScores.some(({ requiresTeacherReview }) => requiresTeacherReview)) reviewReasons.add('dimension_evidence_unmatched')
  const fullTextRevision = normalized.result.fullTextRevision
  return { ok: true, result: { ...normalized.result, status: reviewReasons.size ? 'partial' : 'success', dimensionScores, expressionUpgrades: [...normalized.result.expressionUpgrades, ...upgrades.ungrounded], ...(fullTextRevision ? { fullTextRevision } : {}), reviewReasons: [...reviewReasons], transcript, recognitionWarnings, printedTextExcluded: payload.printedTextExcluded } }
}
