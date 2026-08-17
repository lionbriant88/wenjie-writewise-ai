import { normalizeGradingResultFromPolicyOutcome } from '../normalizeGradingResult.js'
import { calculateDimensionMaxScore, calculateTotalScore, roundScore2 } from '../../../app/src/services/grading/scoringRules.js'
import type { AiGradingResultV1, GradingRequestV1, GradingProviderName } from '../types.js'
import { validateConfirmedRubric } from './validateRubric.js'
import { applyResultPolicy } from './resultPolicy.js'
import type { ResultPolicyInput } from './resultPolicy.js'
import { exactUniqueTranscriptRange } from './transcriptRange.js'
import type { ConfirmedTaskPackageV2 } from './types.js'
import type { RawDimensionScoreV1, RawExpressionUpgradeV1, RawLegibilityIssueV1, RawLogicIssueV1, RawMultimodalIssueV1, RawRecognitionWarningV1, RawSentencePairV1, RawSentenceRevisionV1 } from './types.js'
import type { LegibilityIssueV1 } from '../types.js'
import { PROVIDER_RESULT_KEYS as KEYS, PROVIDER_RESULT_LIMITS as LIMITS, hasExactProviderKeys } from './providerResultContract.js'

export interface MultimodalGradingResult extends AiGradingResultV1 { transcript: string; recognitionWarnings: string[]; printedTextExcluded: boolean }
export type MultimodalNormalizationResult = { ok: true; result: MultimodalGradingResult } | { ok: false; error: { code: 'provider_invalid_response'; message: string; retryable: true } }
export interface MultimodalNormalizationContext { requestId: string; essayId: string; task: ConfirmedTaskPackageV2; provider: GradingProviderName; createdAt: string; pageCount: number; confirmedTranscript?: string }

const INVALID_MESSAGE = 'AI grading result cannot be used safely.'
const CHANGE_TYPES = new Set(['grammar', 'spelling', 'word_choice', 'sentence_upgrade', 'coherence', 'logic_bridge', 'delete_suggestion', 'replace_sentence', 'reference_clarification'])
function invalid(): MultimodalNormalizationResult { return { ok: false, error: { code: 'provider_invalid_response', message: INVALID_MESSAGE, retryable: true } } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function text(value: unknown, maxLength: number = LIMITS.publicText): string | null { if (typeof value !== 'string' || value.length > maxLength) return null; const trimmed = value.trim(); return trimmed || null }
function quote(value: unknown, maxLength: number = LIMITS.publicText): string | null { return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : null }
function rawContext(value: unknown, maxLength: number = LIMITS.publicText): string | null { return typeof value === 'string' && value.length <= maxLength ? value : null }
function textArray(value: unknown, maxItems: number, maxLength: number): string[] | null { if (!Array.isArray(value) || value.length > maxItems) return null; const result = value.map((item) => text(item, maxLength)); return result.every((item): item is string => item !== null) ? result : null }

function parseRecognitionWarnings(value: unknown): RawRecognitionWarningV1[] | null {
  if (!Array.isArray(value) || value.length > LIMITS.recognitionWarnings) return null
  const warnings: RawRecognitionWarningV1[] = []
  for (const item of value) {
    if (!isRecord(item) || !hasExactProviderKeys(item, KEYS.recognitionWarning)) return null
    const message = text(item.message, LIMITS.recognitionMessage)
    if ((item.scope !== 'global_unreadable' && item.scope !== 'printed_boundary') || !message) return null
    warnings.push({ scope: item.scope, message })
  }
  return warnings
}

function hasOrderedLogicContext(transcript: string, { originalText, contextBefore, contextAfter }: RawLogicIssueV1): boolean {
  const originalRange = exactUniqueTranscriptRange(transcript, originalText)
  if (!originalRange) return false
  if (contextBefore) {
    const beforeRange = exactUniqueTranscriptRange(transcript, contextBefore)
    if (!beforeRange || beforeRange.end > originalRange.start) return false
  }
  if (contextAfter) {
    const afterRange = exactUniqueTranscriptRange(transcript, contextAfter)
    if (!afterRange || afterRange.start < originalRange.end) return false
  }
  return true
}

function parseRawIssues(value: unknown): RawMultimodalIssueV1[] | null {
  if (!Array.isArray(value) || value.length > LIMITS.issues) return null
  const parsed: RawMultimodalIssueV1[] = []
  for (const item of value) {
    if (!isRecord(item) || !hasExactProviderKeys(item, KEYS.issue)) return null
    const issueKey = text(item.issueKey, LIMITS.issueKey), type = text(item.type, 32), severity = text(item.severity, 16)
    const originalText = quote(item.originalText), suggestion = text(item.suggestion), explanation = text(item.explanation)
    if (!issueKey || !type || !['grammar', 'spelling', 'word_choice', 'structure'].includes(type) || !severity || !['low', 'medium', 'high'].includes(severity) || !originalText || !suggestion || !explanation || !['certain', 'uncertain'].includes(String(item.evidenceCertainty)) || typeof item.requiresTeacherReview !== 'boolean') return null
    parsed.push({ issueKey, type: type as RawMultimodalIssueV1['type'], severity: severity as RawMultimodalIssueV1['severity'], originalText, suggestion, explanation, evidenceCertainty: item.evidenceCertainty as RawMultimodalIssueV1['evidenceCertainty'], requiresTeacherReview: item.requiresTeacherReview })
  }
  return new Set(parsed.map(({ issueKey }) => issueKey)).size === parsed.length ? parsed : null
}

function parseRawSentenceRevisions(value: unknown): RawSentenceRevisionV1[] | null {
  if (!Array.isArray(value) || value.length > LIMITS.revisions) return null
  const parsed: RawSentenceRevisionV1[] = []
  for (const item of value) {
    if (!isRecord(item) || !hasExactProviderKeys(item, KEYS.sentenceRevision) || !Array.isArray(item.relatedIssueKeys) || !Array.isArray(item.changeTypes)) return null
    const originalText = quote(item.originalText), revisedText = text(item.revisedText), note = text(item.note)
    const relatedIssueKeys = textArray(item.relatedIssueKeys, LIMITS.relationships, LIMITS.relationshipKey)
    if (!originalText || !revisedText || !note || !relatedIssueKeys || new Set(relatedIssueKeys).size !== relatedIssueKeys.length || item.changeTypes.length === 0 || item.changeTypes.length > LIMITS.changeTypes || new Set(item.changeTypes).size !== item.changeTypes.length || !item.changeTypes.every((entry) => typeof entry === 'string' && CHANGE_TYPES.has(entry))) return null
    parsed.push({ originalText, revisedText, note, relatedIssueKeys, changeTypes: [...item.changeTypes] as RawSentenceRevisionV1['changeTypes'] })
  }
  return parsed
}

function parseRawSentencePairs(value: unknown): RawSentencePairV1[] | null {
  if (!Array.isArray(value) || value.length > LIMITS.sentencePairs) return null
  const parsed: RawSentencePairV1[] = []
  for (const item of value) {
    if (!isRecord(item) || !hasExactProviderKeys(item, KEYS.sentencePair) || !Array.isArray(item.relatedIssueKeys) || !Array.isArray(item.changeTypes)) return null
    const originalText = quote(item.originalText), correctedText = text(item.correctedText), improvedText = text(item.improvedText), explanation = text(item.explanation)
    const relatedIssueKeys = textArray(item.relatedIssueKeys, LIMITS.relationships, LIMITS.relationshipKey)
    if (!originalText || !correctedText || !improvedText || !explanation || !relatedIssueKeys || new Set(relatedIssueKeys).size !== relatedIssueKeys.length || typeof item.requiresTeacherReview !== 'boolean' || item.changeTypes.length === 0 || item.changeTypes.length > LIMITS.changeTypes || new Set(item.changeTypes).size !== item.changeTypes.length || !item.changeTypes.every((entry) => typeof entry === 'string' && CHANGE_TYPES.has(entry))) return null
    parsed.push({ originalText, correctedText, improvedText, relatedIssueKeys, changeTypes: [...item.changeTypes] as RawSentencePairV1['changeTypes'], explanation, requiresTeacherReview: item.requiresTeacherReview })
  }
  return parsed
}

function parseRawLogicIssues(value: unknown): RawLogicIssueV1[] | null {
  if (!Array.isArray(value) || value.length > LIMITS.logicIssues) return null
  const parsed: RawLogicIssueV1[] = []
  const subTypes = new Set<RawLogicIssueV1['subType']>(['weak_connection', 'unclear_logic', 'missing_cause_effect', 'unclear_transition', 'topic_drift', 'irrelevant_sentence', 'unclear_reference', 'missing_motivation', 'plot_gap'])
  const actions = new Set<RawLogicIssueV1['suggestedAction']>(['add_connector', 'add_bridge_sentence', 'delete_sentence', 'replace_sentence', 'clarify_reference', 'ask_student_to_explain'])
  for (const item of value) {
    if (!isRecord(item) || !hasExactProviderKeys(item, KEYS.logicIssue)) return null
    const issueKey = text(item.issueKey, LIMITS.issueKey), originalText = quote(item.originalText), contextBefore = rawContext(item.contextBefore), contextAfter = rawContext(item.contextAfter), subType = text(item.subType, 32), severity = text(item.severity, 16), diagnosis = text(item.diagnosis), suggestedAction = text(item.suggestedAction, 32), conservativeSuggestion = text(item.conservativeSuggestion), polishedSuggestion = text(item.polishedSuggestion)
    if (!issueKey || !originalText || contextBefore === null || contextAfter === null || !subType || !subTypes.has(subType as RawLogicIssueV1['subType']) || !severity || !['low', 'medium', 'high'].includes(severity) || !diagnosis || !suggestedAction || !actions.has(suggestedAction as RawLogicIssueV1['suggestedAction']) || !conservativeSuggestion || !polishedSuggestion || typeof item.requiresTeacherReview !== 'boolean') return null
    parsed.push({ issueKey, originalText, contextBefore, contextAfter, subType: subType as RawLogicIssueV1['subType'], severity: severity as RawLogicIssueV1['severity'], diagnosis, suggestedAction: suggestedAction as RawLogicIssueV1['suggestedAction'], conservativeSuggestion, polishedSuggestion, requiresTeacherReview: item.requiresTeacherReview })
  }
  return new Set(parsed.map(({ issueKey }) => issueKey)).size === parsed.length ? parsed : null
}

function parseRawLegibilityIssues(value: unknown): RawLegibilityIssueV1[] | null {
  if (!Array.isArray(value) || value.length > LIMITS.legibilityIssues) return null
  const parsed: RawLegibilityIssueV1[] = []
  for (const item of value) {
    if (!isRecord(item) || !hasExactProviderKeys(item, KEYS.legibilityIssue)) return null
    const issueKey = text(item.issueKey, LIMITS.issueKey), transcriptText = quote(item.transcriptText), possibleReadings = textArray(item.possibleReadings, 4, LIMITS.possibleReading), regionDescription = text(item.regionDescription), explanation = text(item.explanation), defaultOutcome = text(item.defaultOutcome, 64)
    if (!issueKey || !transcriptText || !possibleReadings || possibleReadings.length < 2 || typeof item.pageNumber !== 'number' || !Number.isInteger(item.pageNumber) || item.pageNumber < 1 || !regionDescription || !explanation || defaultOutcome !== 'count_as_legibility_error') return null
    parsed.push({ issueKey, transcriptText, possibleReadings, pageNumber: item.pageNumber, regionDescription, explanation, defaultOutcome })
  }
  return new Set(parsed.map(({ issueKey }) => issueKey)).size === parsed.length ? parsed : null
}

function parseLogicNotes(value: unknown): Array<{ quote: string; note: string }> | null {
  if (!Array.isArray(value) || value.length > LIMITS.logicNotes) return null
  const parsed: Array<{ quote: string; note: string }> = []
  for (const item of value) {
    if (!isRecord(item) || !hasExactProviderKeys(item, KEYS.logicNote)) return null
    const rawQuote = quote(item.quote), note = text(item.note)
    if (!rawQuote || !note) return null
    parsed.push({ quote: rawQuote, note })
  }
  return parsed
}

function requestFor(context: MultimodalNormalizationContext, transcript: string): GradingRequestV1 | null {
  const rubric = validateConfirmedRubric(context.task.rubric)
  if (!rubric.ok || !Number.isInteger(context.task.fullScore) || context.task.fullScore < 1 || context.task.fullScore > 100) return null
  return { requestVersion: 'grading-request-v1', requestId: context.requestId, task: { taskId: context.task.taskId, writingGenre: 'practical_writing', fullScore: context.task.fullScore, prompt: { writingGenre: 'practical_writing', taskRequirement: context.task.materialSummary }, rubric: { status: 'confirmed', writingGoal: context.task.materialSummary, offTopicCriteria: [], dimensions: rubric.value.dimensions.map(({ id, name, weight, description, deductionFocus }) => ({ id, name, weight, description, deductionFocus })), excellentFeatures: [], reviewTriggers: [] } }, essay: { essayId: context.essayId, confirmedTranscript: transcript, ocrContext: { sourceKind: 'manual', hasKnownOcrRisk: false, riskCodes: [] } } }
}

function parseExpressionUpgrades(value: unknown, transcript: string): RawExpressionUpgradeV1[] | null {
  if (!Array.isArray(value) || value.length > LIMITS.upgrades) return null
  const upgrades: RawExpressionUpgradeV1[] = []
  for (const item of value) {
    if (!isRecord(item) || !hasExactProviderKeys(item, KEYS.expressionUpgrade)) return null
    const originalText = quote(item.originalText), upgradedText = text(item.upgradedText), note = text(item.note)
    if (!originalText || !exactUniqueTranscriptRange(transcript, originalText) || !upgradedText || !note) return null
    upgrades.push({ originalText, upgradedText, note })
  }
  return upgrades
}


function rawScoresAreBounded(value: unknown, context: MultimodalNormalizationContext) {
  if (!Array.isArray(value) || value.length !== context.task.rubric.dimensions.length) return false
  const rubricIds = new Set(context.task.rubric.dimensions.map(({ id }) => id))
  const seen = new Set<string>()
  for (const item of value) {
    if (!isRecord(item) || !hasExactProviderKeys(item, KEYS.dimensionScore) || typeof item.dimensionId !== 'string' || !rubricIds.has(item.dimensionId) || seen.has(item.dimensionId)) return false
    seen.add(item.dimensionId)
  }
  if (seen.size !== rubricIds.size) return false
  const dimensions = new Map(context.task.rubric.dimensions.map((dimension) => [dimension.id, dimension]))
  return value.every((item) => {
    if (!isRecord(item) || typeof item.dimensionId !== 'string' || typeof item.score !== 'number' || !Number.isFinite(item.score)) return false
    const dimension = dimensions.get(item.dimensionId)
    return Boolean(dimension) && item.score >= 0 && item.score <= calculateDimensionMaxScore(context.task.fullScore, dimension!.weight)
  })
}

export function normalizeMultimodalResult(payload: unknown, context: MultimodalNormalizationContext): MultimodalNormalizationResult {
  if (!isRecord(payload) || !hasExactProviderKeys(payload, KEYS.result)) return invalid()
  const transcript = context.confirmedTranscript !== undefined
    ? typeof payload.transcript === 'string' && payload.transcript === context.confirmedTranscript
      ? context.confirmedTranscript
      : null
    : quote(payload.transcript, LIMITS.publicText)
  const recognitionWarnings = parseRecognitionWarnings(payload.recognitionWarnings)
  if (!transcript || !recognitionWarnings || typeof payload.printedTextExcluded !== 'boolean') return invalid()
  if (context.confirmedTranscript !== undefined && (recognitionWarnings.length > 0 || payload.printedTextExcluded !== true)) return invalid()
  const request = requestFor(context, transcript)
  const issues = parseRawIssues(payload.issues)
  const revisions = parseRawSentenceRevisions(payload.sentenceRevisions)
  const upgrades = parseExpressionUpgrades(payload.expressionUpgrades, transcript)
  const fullTextRevisionRecord = isRecord(payload.fullTextRevision) && hasExactProviderKeys(payload.fullTextRevision, KEYS.fullTextRevision) ? payload.fullTextRevision : null
  const pairs = fullTextRevisionRecord ? parseRawSentencePairs(fullTextRevisionRecord.sentencePairs) : null
  const logicNotes = fullTextRevisionRecord ? parseLogicNotes(fullTextRevisionRecord.logicNotes) : null
  const logicIssues = fullTextRevisionRecord ? parseRawLogicIssues(fullTextRevisionRecord.logicIssues) : null
  const legibilityIssues = parseRawLegibilityIssues(payload.legibilityIssues)
  const overallComment = text(payload.overallComment) ?? ''
  if (!request || !issues || !revisions || !upgrades || !pairs || !logicNotes || !logicIssues || !legibilityIssues || !rawScoresAreBounded(payload.dimensionScores, context) || !fullTextRevisionRecord || rawContext(fullTextRevisionRecord.correctedText) === null || rawContext(fullTextRevisionRecord.improvedText) === null || logicNotes.some(({ quote }) => !exactUniqueTranscriptRange(transcript, quote)) || logicIssues.some((issue) => !hasOrderedLogicContext(transcript, issue))) return invalid()
  if ((context.confirmedTranscript !== undefined && legibilityIssues.length > 0) || (context.confirmedTranscript === undefined && legibilityIssues.some(({ pageNumber }) => pageNumber > context.pageCount))) return invalid()
  const rawScores = new Map((payload.dimensionScores as Array<Record<string, unknown>>).map((score) => [score.dimensionId, score]))
  if (rawScores.size !== request.task.rubric.dimensions.length || request.task.rubric.dimensions.some((dimension) => !rawScores.has(dimension.id))) return invalid()
  const rawDimensionScores: RawDimensionScoreV1[] = []
  const dimensionScoreCandidates = request.task.rubric.dimensions.map((dimension) => {
    const score = rawScores.get(dimension.id)
    const reason = score ? text(score.reason) : null
    const evidence = score ? quote(score.evidence, LIMITS.publicText) : null
    const relatedIssueKeys = score ? textArray(score.relatedIssueKeys, LIMITS.relationships, LIMITS.relationshipKey) : null
    if (!score || typeof score.score !== 'number' || !reason || !evidence || !relatedIssueKeys || new Set(relatedIssueKeys).size !== relatedIssueKeys.length) return null
    const roundedScore = roundScore2(score.score)
    const maxScore = calculateDimensionMaxScore(request.task.fullScore, dimension.weight)
    rawDimensionScores.push({ dimensionId: dimension.id, score: roundedScore, maxScore, reason, evidence, relatedIssueKeys })
    return { dimensionId: dimension.id, name: dimension.name, score: roundedScore, maxScore, weight: dimension.weight, reason, evidence }
  })
  if (dimensionScoreCandidates.some((item) => item === null)) return invalid()
  const dimensionScores = dimensionScoreCandidates as AiGradingResultV1['dimensionScores']
  const totalScore = calculateTotalScore(dimensionScores.map(({ score }) => score), request.task.fullScore)
  if (typeof payload.reportedTotalScore !== 'number' || !Number.isFinite(payload.reportedTotalScore)) return invalid()
  const policyInput: ResultPolicyInput = { issues, sentenceRevisions: revisions, sentencePairs: pairs, expressionUpgrades: upgrades, logicIssues, legibilityIssues, dimensionScores: rawDimensionScores, recognitionWarnings, overallComment, logicNotes: logicNotes.map(({ note }) => note), logicNoteRecords: logicNotes }
  const policy = applyResultPolicy(policyInput, transcript)
  if (!policy) return invalid()
  const normalized = normalizeGradingResultFromPolicyOutcome({ request, context: { provider: context.provider, createdAt: context.createdAt }, policy, dimensionScores, totalScore, reportedTotalScore: payload.reportedTotalScore, reviewReasons: [] })
  if (!normalized) return invalid()
  const reviewReasons = new Set(normalized.reviewReasons)
  if (recognitionWarnings.length) reviewReasons.add('recognition_uncertain')
  if (!payload.printedTextExcluded) reviewReasons.add('printed_text_exclusion_uncertain')
  const normalizedLegibilityIssues: LegibilityIssueV1[] = legibilityIssues.map(({ issueKey: _issueKey, ...issue }, index) => ({ id: `${context.essayId}-legibility-${index + 1}`, ...issue }))
  return { ok: true, result: { ...normalized, status: reviewReasons.size ? 'partial' : 'success', legibilityIssues: normalizedLegibilityIssues, reviewReasons: [...reviewReasons], transcript, recognitionWarnings: recognitionWarnings.map(({ message }) => message), printedTextExcluded: payload.printedTextExcluded } }
}
