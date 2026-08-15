import { matchTranscriptQuote } from '../matchTranscriptQuote.js'
import { normalizeGradingResultFromPolicyOutcome } from '../normalizeGradingResult.js'
import { strictlyGroundTranscriptQuote } from '../strictTranscriptQuote.js'
import { calculateDimensionMaxScore, calculateTotalScore, roundScore2 } from '../../../app/src/services/grading/scoringRules.js'
import type { AiGradingResultV1, GradingRequestV1, GradingProviderName } from '../types.js'
import { validateGeneratedRubric } from './validateRubric.js'
import { applyResultPolicy } from './resultPolicy.js'
import { rebuildCorrectedText } from './resultPolicy.js'
import type { ResultPolicyInput } from './resultPolicy.js'
import type { ConfirmedTaskPackageV2 } from './types.js'
import type { RawLegibilityIssueV1, RawLogicIssueV1, RawMultimodalIssueV1, RawSentencePairV1, RawSentenceRevisionV1 } from './types.js'
import type { LegibilityIssueV1 } from '../types.js'
import { LEGIBILITY_DIMENSION_ID } from './gradingPolicy.js'

export interface MultimodalGradingResult extends AiGradingResultV1 { transcript: string; recognitionWarnings: string[]; printedTextExcluded: boolean }
export type MultimodalNormalizationResult = { ok: true; result: MultimodalGradingResult } | { ok: false; error: { code: 'provider_invalid_response'; message: string; retryable: true } }
export interface MultimodalNormalizationContext { requestId: string; essayId: string; task: ConfirmedTaskPackageV2; provider: GradingProviderName; createdAt: string; pageCount: number; confirmedTranscript?: string }

const INVALID_MESSAGE = 'AI grading result cannot be used safely.'
const CHANGE_TYPES = new Set(['grammar', 'spelling', 'word_choice', 'sentence_upgrade', 'coherence', 'logic_bridge', 'delete_suggestion', 'replace_sentence', 'reference_clarification'])
function invalid(): MultimodalNormalizationResult { return { ok: false, error: { code: 'provider_invalid_response', message: INVALID_MESSAGE, retryable: true } } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function text(value: unknown, maxLength = 10_000): string | null { if (typeof value !== 'string') return null; const trimmed = value.trim(); return trimmed && trimmed.length <= maxLength ? trimmed : null }
function quote(value: unknown, maxLength = 10_000): string | null { return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : null }
function rawContext(value: unknown, maxLength = 10_000): string | null { return typeof value === 'string' && value.length <= maxLength ? value : null }
function textArray(value: unknown, maxItems: number, maxLength: number): string[] | null { if (!Array.isArray(value) || value.length > maxItems) return null; const result = value.map((item) => text(item, maxLength)); return result.every((item): item is string => item !== null) ? result : null }

function uniqueQuoteIndex(transcript: string, quote: string): number | null {
  const start = transcript.indexOf(quote)
  return start >= 0 && transcript.indexOf(quote, start + 1) < 0 ? start : null
}
function hasUniqueQuote(transcript: string, quote: string): boolean { return uniqueQuoteIndex(transcript, quote) !== null }

function hasOrderedLogicContext(transcript: string, { originalText, contextBefore, contextAfter }: RawLogicIssueV1): boolean {
  const originalStart = uniqueQuoteIndex(transcript, originalText)
  if (originalStart === null) return false
  if (contextBefore) {
    const beforeStart = uniqueQuoteIndex(transcript, contextBefore)
    if (beforeStart === null || beforeStart + contextBefore.length > originalStart) return false
  }
  if (contextAfter) {
    const afterStart = uniqueQuoteIndex(transcript, contextAfter)
    if (afterStart === null || afterStart < originalStart + originalText.length) return false
  }
  return true
}

function parseRawIssues(value: unknown): RawMultimodalIssueV1[] | null {
  if (!Array.isArray(value)) return null
  const parsed: RawMultimodalIssueV1[] = []
  for (const item of value) {
    if (!isRecord(item)) return null
    const issueKey = text(item.issueKey, 200), type = text(item.type, 32), severity = text(item.severity, 16)
    const originalText = quote(item.originalText), suggestion = text(item.suggestion), explanation = text(item.explanation)
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
    const originalText = quote(item.originalText), revisedText = text(item.revisedText), note = text(item.note)
    const relatedIssueKeys = textArray(item.relatedIssueKeys, 50, 200)
    if (!originalText || !revisedText || !note || !relatedIssueKeys || item.changeTypes.length === 0 || !item.changeTypes.every((entry) => typeof entry === 'string' && CHANGE_TYPES.has(entry))) return null
    parsed.push({ originalText, revisedText, note, relatedIssueKeys, changeTypes: [...item.changeTypes] as RawSentenceRevisionV1['changeTypes'] })
  }
  return parsed
}

function parseRawSentencePairs(value: unknown): RawSentencePairV1[] | null {
  if (!Array.isArray(value)) return null
  const parsed: RawSentencePairV1[] = []
  for (const item of value) {
    if (!isRecord(item) || !Array.isArray(item.relatedIssueKeys) || !Array.isArray(item.changeTypes)) return null
    const originalText = quote(item.originalText), correctedText = text(item.correctedText), improvedText = text(item.improvedText), explanation = text(item.explanation)
    const relatedIssueKeys = textArray(item.relatedIssueKeys, 50, 200)
    if (!originalText || !correctedText || !improvedText || !explanation || !relatedIssueKeys || typeof item.requiresTeacherReview !== 'boolean' || item.changeTypes.length === 0 || !item.changeTypes.every((entry) => typeof entry === 'string' && CHANGE_TYPES.has(entry))) return null
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
    const issueKey = text(item.issueKey, 200), originalText = quote(item.originalText), contextBefore = rawContext(item.contextBefore), contextAfter = rawContext(item.contextAfter), subType = text(item.subType, 32), severity = text(item.severity, 16), diagnosis = text(item.diagnosis), suggestedAction = text(item.suggestedAction, 32), conservativeSuggestion = text(item.conservativeSuggestion), polishedSuggestion = text(item.polishedSuggestion)
    if (!issueKey || !originalText || contextBefore === null || contextAfter === null || !subType || !subTypes.has(subType as RawLogicIssueV1['subType']) || !severity || !['low', 'medium', 'high'].includes(severity) || !diagnosis || !suggestedAction || !actions.has(suggestedAction as RawLogicIssueV1['suggestedAction']) || !conservativeSuggestion || !polishedSuggestion || typeof item.requiresTeacherReview !== 'boolean') return null
    parsed.push({ issueKey, originalText, contextBefore, contextAfter, subType: subType as RawLogicIssueV1['subType'], severity: severity as RawLogicIssueV1['severity'], diagnosis, suggestedAction: suggestedAction as RawLogicIssueV1['suggestedAction'], conservativeSuggestion, polishedSuggestion, requiresTeacherReview: item.requiresTeacherReview })
  }
  return parsed
}

function parseRawLegibilityIssues(value: unknown): RawLegibilityIssueV1[] | null {
  if (!Array.isArray(value)) return null
  const parsed: RawLegibilityIssueV1[] = []
  for (const item of value) {
    if (!isRecord(item)) return null
    const issueKey = text(item.issueKey, 200), transcriptText = quote(item.transcriptText), possibleReadings = textArray(item.possibleReadings, 4, 1_000), regionDescription = text(item.regionDescription), explanation = text(item.explanation), defaultOutcome = text(item.defaultOutcome, 64)
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
    const rawQuote = quote(item.quote), note = text(item.note)
    if (!rawQuote || !note) return null
    parsed.push({ quote: rawQuote, note })
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

function parseExpressionUpgrades(value: unknown, transcript: string, essayId: string): AiGradingResultV1['expressionUpgrades'] | null {
  if (!Array.isArray(value)) return null
  const upgrades: AiGradingResultV1['expressionUpgrades'] = []
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) return null
    const originalText = strictlyGroundTranscriptQuote(transcript, item.originalText), upgradedText = text(item.upgradedText), note = text(item.note)
    if (!originalText || !upgradedText || !note) return null
    upgrades.push({ id: `${essayId}-upgrade-${index + 1}`, originalText, upgradedText, note })
  }
  return upgrades
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
    : quote(payload.transcript, 50_000)
  const recognitionWarnings = textArray(payload.recognitionWarnings, 50, 1_000)
  if (!transcript || !recognitionWarnings || typeof payload.printedTextExcluded !== 'boolean') return invalid()
  const request = requestFor(context, transcript)
  const issues = parseRawIssues(payload.issues)
  const revisions = parseRawSentenceRevisions(payload.sentenceRevisions)
  const upgrades = parseExpressionUpgrades(payload.expressionUpgrades, transcript, context.essayId)
  const pairs = isRecord(payload.fullTextRevision) ? parseRawSentencePairs(payload.fullTextRevision.sentencePairs) : null
  const logicNotes = isRecord(payload.fullTextRevision) ? parseLogicNotes(payload.fullTextRevision.logicNotes) : null
  const logicIssues = isRecord(payload.fullTextRevision) ? parseRawLogicIssues(payload.fullTextRevision.logicIssues) : null
  const legibilityIssues = parseRawLegibilityIssues(payload.legibilityIssues)
  const scoreReasons = dimensionReasons(payload.dimensionScores)
  const overallComment = text(payload.overallComment) ?? ''
  if (!request || !issues || !revisions || !upgrades || !pairs || !logicNotes || !logicIssues || !legibilityIssues || !scoreReasons || !rawScoresAreBounded(payload.dimensionScores, context) || !isRecord(payload.fullTextRevision) || logicNotes.some(({ quote }) => !hasUniqueQuote(transcript, quote)) || logicIssues.some((issue) => !hasOrderedLogicContext(transcript, issue)) || (logicIssues.length > 0 && !text(payload.fullTextRevision.correctedText))) return invalid()
  if ((context.confirmedTranscript !== undefined && legibilityIssues.length > 0) || (context.confirmedTranscript === undefined && legibilityIssues.some(({ pageNumber }) => pageNumber > context.pageCount))) return invalid()
  if ((payload.dimensionScores as Array<Record<string, unknown>>).some((score) => {
    const dimensionId = score.dimensionId
    const evidence = score.evidence
    return typeof dimensionId === 'string' && dimensionId !== LEGIBILITY_DIMENSION_ID && typeof evidence === 'string' && legibilityIssues.some(({ transcriptText }) => evidence.includes(transcriptText))
  })) return invalid()
  const policyInput: ResultPolicyInput = { issues, sentenceRevisions: revisions, sentencePairs: pairs, logicIssues, legibilityIssues, dimensionReasons: scoreReasons, overallComment, logicNotes: logicNotes.map(({ note }) => note), logicNoteRecords: logicNotes }
  const policy = applyResultPolicy(policyInput, transcript)
  if (!policy) return invalid()
  const legibilityQuotes = new Set(legibilityIssues.map(({ transcriptText }) => transcriptText))
  const safeIssues = policy.issues.filter(({ originalText }) => !legibilityQuotes.has(originalText))
  const safeIssueKeys = new Set(safeIssues.map(({ issueKey }) => issueKey))
  const safeRevisions = policy.sentenceRevisions.filter(({ originalText, relatedIssueKeys }) => !legibilityQuotes.has(originalText) && relatedIssueKeys.every((key) => safeIssueKeys.has(key)))
  const safePairs = policy.sentencePairs.filter(({ originalText, relatedIssueKeys }) => !legibilityQuotes.has(originalText) && relatedIssueKeys.every((key) => safeIssueKeys.has(key)))
  const correctedText = rebuildCorrectedText(transcript, safePairs)
  if (correctedText === null) return invalid()
  const keptLogicNotes = logicNotes.filter(({ quote }) => !legibilityIssues.some(({ transcriptText }) => transcriptText === quote))
  const rawScores = new Map((payload.dimensionScores as Array<Record<string, unknown>>).map((score) => [score.dimensionId, score]))
  if (rawScores.size !== request.task.rubric.dimensions.length || request.task.rubric.dimensions.some((dimension) => !rawScores.has(dimension.id))) return invalid()
  const dimensionScoreCandidates = request.task.rubric.dimensions.map((dimension) => {
    const score = rawScores.get(dimension.id)
    if (!score || typeof score.score !== 'number' || typeof score.reason !== 'string' || typeof score.evidence !== 'string') return null
    return { dimensionId: dimension.id, name: dimension.name, score: roundScore2(score.score), maxScore: calculateDimensionMaxScore(request.task.fullScore, dimension.weight), weight: dimension.weight, reason: score.reason, evidence: score.evidence }
  })
  if (dimensionScoreCandidates.some((item) => item === null)) return invalid()
  const dimensionScores = dimensionScoreCandidates as AiGradingResultV1['dimensionScores']
  const totalScore = calculateTotalScore(dimensionScores.map(({ score }) => score), request.task.fullScore)
  if (typeof payload.reportedTotalScore !== 'number' || !Number.isFinite(payload.reportedTotalScore)) return invalid()
  const improvedText = isRecord(payload.fullTextRevision) ? text(payload.fullTextRevision.improvedText) : null
  if (!improvedText) return invalid()
  const safePolicy = { ...policy, issues: safeIssues, sentenceRevisions: safeRevisions, sentencePairs: safePairs, correctedText, logicNotes: keptLogicNotes.map(({ note }) => note) }
  const normalized = normalizeGradingResultFromPolicyOutcome({ request, context: { provider: context.provider, createdAt: context.createdAt }, policy: safePolicy, dimensionScores, totalScore, reportedTotalScore: payload.reportedTotalScore, expressionUpgrades: upgrades, improvedText, reviewReasons: [] })
  if (!normalized) return invalid()
  const reviewReasons = new Set(normalized.reviewReasons)
  if (recognitionWarnings.length) reviewReasons.add('recognition_uncertain')
  if (!payload.printedTextExcluded) reviewReasons.add('printed_text_exclusion_uncertain')
  const reviewedDimensionScores = normalized.dimensionScores.map((item) => matchTranscriptQuote(transcript, item.evidence) ? item : { ...item, requiresTeacherReview: true })
  if (reviewedDimensionScores.some(({ requiresTeacherReview }) => requiresTeacherReview)) reviewReasons.add('dimension_evidence_unmatched')
  const normalizedLegibilityIssues: LegibilityIssueV1[] = legibilityIssues.map(({ issueKey: _issueKey, ...issue }, index) => ({ id: `${context.essayId}-legibility-${index + 1}`, ...issue }))
  const fullTextRevision = normalized.fullTextRevision
  return { ok: true, result: { ...normalized, status: reviewReasons.size ? 'partial' : 'success', dimensionScores: reviewedDimensionScores, ...(fullTextRevision ? { fullTextRevision } : {}), legibilityIssues: normalizedLegibilityIssues, reviewReasons: [...reviewReasons], transcript, recognitionWarnings, printedTextExcluded: payload.printedTextExcluded } }
}
