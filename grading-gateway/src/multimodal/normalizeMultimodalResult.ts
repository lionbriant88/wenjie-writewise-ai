import { normalizeGradingResultFromPolicyOutcome } from '../normalizeGradingResult.js'
import { calculateDimensionMaxScore, calculateTotalScore, capTotalScoreForVisibleLegibilityDeduction, roundScore2 } from '../../../app/src/services/grading/scoringRules.js'
import type { AiGradingResultV1, GradingRequestV1, GradingProviderName } from '../types.js'
import { validateConfirmedRubric } from './validateRubric.js'
import { applyResultPolicy, explicitlyReferencesFilteredSpelling, explicitlyReferencesFilteredSpellingWithCue } from './resultPolicy.js'
import type { ResultPolicyInput, ResultPolicyOutcome, ResultPolicyRejectionReason } from './resultPolicy.js'
import { containsBoundedTerm, exactUniqueTranscriptRange, isWellFormedUnicode, narrativeExplicitlyReferencesLocalLegibility, transcriptRangesOverlap } from './transcriptRange.js'
import type { ConfirmedTaskPackageV2 } from './types.js'
import type { RawDimensionScoreV1, RawExpressionUpgradeV1, RawLegibilityIssueV1, RawLogicIssueV1, RawMultimodalIssueV1, RawRecognitionWarningV1, RawSentencePairV1, RawSentenceRevisionV1 } from './types.js'
import type { LegibilityIssueV1 } from '../types.js'
import { PROVIDER_RESULT_KEYS as KEYS, PROVIDER_RESULT_LIMITS as LIMITS, hasExactProviderKeys } from './providerResultContract.js'
import { GRADING_REVIEW_REASONS, hasDistinctNormalizedText } from '../../../app/src/services/grading/gradingResultSemantics.js'
import { normalizePageAssessments } from './normalizePageAssessments.js'

export interface MultimodalGradingResult extends AiGradingResultV1 { transcript: string; recognitionWarnings: string[]; printedTextExcluded: boolean }
export type MultimodalNormalizationDiagnosticCode =
  | 'result_shape'
  | 'transcript'
  | 'recognition_warnings'
  | 'printed_text_excluded'
  | 'confirmed_transcript_invariants'
  | 'task_context'
  | 'issues'
  | 'sentence_revisions'
  | 'expression_upgrades'
  | 'full_text_revision'
  | 'sentence_pairs'
  | 'logic_notes'
  | 'logic_issues'
  | 'legibility_issues'
  | 'dimension_scores'
  | 'full_text_fields'
  | 'logic_note_grounding'
  | 'logic_issue_context'
  | 'legibility_page_scope'
  | 'dimension_set'
  | 'dimension_fields'
  | 'reported_total'
  | `result_policy_${ResultPolicyRejectionReason | 'unknown'}`
  | 'result_projection'
export type MultimodalNormalizationResult = { ok: true; result: MultimodalGradingResult } | { ok: false; error: { code: 'provider_invalid_response'; message: string; retryable: true; diagnosticCode: MultimodalNormalizationDiagnosticCode } }
export interface MultimodalNormalizationContext { requestId: string; essayId: string; task: ConfirmedTaskPackageV2; provider: GradingProviderName; createdAt: string; pageCount: number; confirmedTranscript?: string }

const INVALID_MESSAGE = 'AI grading result cannot be used safely.'
const CHANGE_TYPES = new Set(['grammar', 'spelling', 'word_choice', 'sentence_upgrade', 'coherence', 'logic_bridge', 'delete_suggestion', 'replace_sentence', 'reference_clarification'])
const GENUINE_LANGUAGE_OR_LOGIC_CUE = /\b(?:agreement|article|coherence|coherent|connector|grammar|grammatical|logic|logical|pronoun|reference|relevance|relevant|structure|subject[- ]verb|tense|transition|verb form|word choice)\b|主谓|语法|时态|冠词|代词|逻辑|衔接|连贯|结构|指代|相关性|用词/iu
const UNCERTAIN_SPELLING_ATTRIBUTION_CUE = /\b(?:handwriting|illegible|misspell|misspelled|spell|spelling|uncertain|unreadable)\b|拼写|字迹|辨认|难辨|不清/iu
function invalid(diagnosticCode: MultimodalNormalizationDiagnosticCode): MultimodalNormalizationResult { return { ok: false, error: { code: 'provider_invalid_response', message: INVALID_MESSAGE, retryable: true, diagnosticCode } } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function text(value: unknown, maxLength: number = LIMITS.publicText): string | null { if (typeof value !== 'string' || value.length > maxLength || !isWellFormedUnicode(value)) return null; const trimmed = value.trim(); return trimmed || null }
function quote(value: unknown, maxLength: number = LIMITS.publicText): string | null { return typeof value === 'string' && value.length > 0 && value.length <= maxLength && value.trim().length > 0 && isWellFormedUnicode(value) ? value : null }
function rawContext(value: unknown, maxLength: number = LIMITS.publicText): string | null { return typeof value === 'string' && value.length <= maxLength && isWellFormedUnicode(value) && (value.length === 0 || value.trim().length > 0) ? value : null }
function textArray(value: unknown, maxItems: number, maxLength: number): string[] | null { if (!Array.isArray(value) || value.length > maxItems) return null; const result = value.map((item) => text(item, maxLength)); return result.every((item): item is string => item !== null) ? result : null }

interface ParsedAuxiliary<T> { items: T[]; omittedMalformed: boolean }
interface ParsedKeyedAuxiliary<T> extends ParsedAuxiliary<T> { claimedKeys: string[] }
interface SuppressedReference {
  claimedIssueKey: string | null
  originalText: string | null
  texts: string[]
}
interface SuppressedIssueReference extends SuppressedReference {
  suggestion: string | null
  issueType: string | null
  severity: string | null
  evidenceCertainty: string | null
  requiresTeacherReview: boolean | null
  safelyClassifiedUncertainSpelling: boolean
  silent: boolean
}
interface ParsedIssues extends ParsedKeyedAuxiliary<RawMultimodalIssueV1> { suppressedReferences: SuppressedIssueReference[] }
interface ParsedReferencedKeyedAuxiliary<T> extends ParsedKeyedAuxiliary<T> { suppressedReferences: SuppressedReference[] }

function sameSuppressedReference(left: SuppressedReference, right: SuppressedReference): boolean {
  return left.claimedIssueKey === right.claimedIssueKey
    && left.originalText === right.originalText
    && left.texts.length === right.texts.length
    && left.texts.every((value, index) => value === right.texts[index])
}

function sameSuppressedIssueClassification(left: SuppressedIssueReference, right: SuppressedIssueReference): boolean {
  return left.issueType === right.issueType
    && left.severity === right.severity
    && left.evidenceCertainty === right.evidenceCertainty
    && left.requiresTeacherReview === right.requiresTeacherReview
}

function sameSuppressedIssueReference(left: SuppressedIssueReference, right: SuppressedIssueReference): boolean {
  return sameSuppressedReference(left, right)
    && left.suggestion === right.suggestion
    && sameSuppressedIssueClassification(left, right)
}

function boundedAuxiliaryItems(value: unknown, maxItems: number): { items: unknown[]; omittedMalformed: boolean } {
  if (!Array.isArray(value)) return { items: [], omittedMalformed: true }
  return { items: value.slice(0, maxItems), omittedMalformed: value.length > maxItems }
}

function parseRecognitionWarnings(value: unknown): ParsedAuxiliary<RawRecognitionWarningV1> {
  const source = boundedAuxiliaryItems(value, LIMITS.recognitionWarnings)
  const warnings: RawRecognitionWarningV1[] = []
  let omittedMalformed = source.omittedMalformed
  for (const item of source.items) {
    if (!isRecord(item) || !hasExactProviderKeys(item, KEYS.recognitionWarning)) {
      omittedMalformed = true
      continue
    }
    const message = text(item.message, LIMITS.recognitionMessage)
    if ((item.scope !== 'global_unreadable' && item.scope !== 'printed_boundary' && item.scope !== 'image_clipped') || !message) {
      omittedMalformed = true
      continue
    }
    warnings.push({ scope: item.scope, message })
  }
  return { items: warnings, omittedMalformed }
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

function issueIsUncertainSpelling(issue: RawMultimodalIssueV1): boolean {
  return issue.type === 'spelling' && (issue.evidenceCertainty !== 'certain' || issue.requiresTeacherReview)
}

function parseIssueFields(value: Record<string, unknown>): RawMultimodalIssueV1 | null {
  const issueKey = text(value.issueKey, LIMITS.issueKey), type = text(value.type, 32), severity = text(value.severity, 16)
  const originalText = quote(value.originalText), suggestion = text(value.suggestion), explanation = text(value.explanation)
  if (!issueKey || !type || !['grammar', 'spelling', 'word_choice', 'structure'].includes(type) || !severity || !['low', 'medium', 'high'].includes(severity) || !originalText || !suggestion || !explanation || !['certain', 'uncertain'].includes(String(value.evidenceCertainty)) || typeof value.requiresTeacherReview !== 'boolean') return null
  return { issueKey, type: type as RawMultimodalIssueV1['type'], severity: severity as RawMultimodalIssueV1['severity'], originalText, suggestion, explanation, evidenceCertainty: value.evidenceCertainty as RawMultimodalIssueV1['evidenceCertainty'], requiresTeacherReview: value.requiresTeacherReview }
}

function suppressedIssueReference(value: Record<string, unknown>, parsedFields: RawMultimodalIssueV1 | null): SuppressedIssueReference | null {
  const originalText = quote(value.originalText)
  const suggestion = text(value.suggestion)
  if (!originalText && !suggestion) return null
  const claimedIssueKey = text(value.issueKey, LIMITS.issueKey)
  const explanation = text(value.explanation)
  const safelyClassifiedUncertainSpelling = value.type === 'spelling'
    && (value.evidenceCertainty === 'uncertain' || value.requiresTeacherReview === true)
    && originalText !== null
    && !Boolean(explanation && GENUINE_LANGUAGE_OR_LOGIC_CUE.test(explanation))
  return {
    claimedIssueKey,
    originalText,
    suggestion,
    issueType: text(value.type, 32),
    severity: text(value.severity, 16),
    evidenceCertainty: text(value.evidenceCertainty, 16),
    requiresTeacherReview: typeof value.requiresTeacherReview === 'boolean' ? value.requiresTeacherReview : null,
    texts: [originalText, suggestion, explanation].filter((entry): entry is string => entry !== null),
    safelyClassifiedUncertainSpelling,
    silent: Boolean(parsedFields && issueIsUncertainSpelling(parsedFields) && safelyClassifiedUncertainSpelling),
  }
}

function suppressedReferenceFromIssue(issue: RawMultimodalIssueV1, silent: boolean): SuppressedIssueReference {
  return {
    claimedIssueKey: issue.issueKey,
    originalText: issue.originalText,
    suggestion: issue.suggestion,
    issueType: issue.type,
    severity: issue.severity,
    evidenceCertainty: issue.evidenceCertainty,
    requiresTeacherReview: issue.requiresTeacherReview,
    texts: [issue.originalText, issue.suggestion, issue.explanation],
    safelyClassifiedUncertainSpelling: issueIsUncertainSpelling(issue),
    silent,
  }
}

function suppressedReferenceFromLogicIssue(issue: RawLogicIssueV1): SuppressedReference {
  return {
    claimedIssueKey: issue.issueKey,
    originalText: issue.originalText,
    texts: uniqueSafeTexts([
      issue.originalText, issue.contextBefore || null, issue.contextAfter || null,
      issue.diagnosis, issue.conservativeSuggestion, issue.polishedSuggestion,
    ]),
  }
}

function suppressedReferenceFromLegibilityIssue(issue: RawLegibilityIssueV1): SuppressedReference {
  return {
    claimedIssueKey: issue.issueKey,
    originalText: issue.transcriptText,
    texts: uniqueSafeTexts([issue.transcriptText, ...issue.possibleReadings, issue.regionDescription, issue.explanation]),
  }
}

function policySuppressedReferenceFromIssue(issue: RawMultimodalIssueV1): SuppressedReference {
  return { claimedIssueKey: issue.issueKey, originalText: null, texts: uniqueSafeTexts([issue.suggestion, issue.explanation]) }
}

function policySuppressedReferenceFromLogicIssue(issue: RawLogicIssueV1): SuppressedReference {
  return {
    claimedIssueKey: issue.issueKey,
    originalText: null,
    texts: uniqueSafeTexts([issue.diagnosis, issue.conservativeSuggestion, issue.polishedSuggestion]),
  }
}

function policySuppressedReferenceFromLegibilityIssue(issue: RawLegibilityIssueV1): SuppressedReference {
  return {
    claimedIssueKey: issue.issueKey,
    originalText: null,
    texts: uniqueSafeTexts([...issue.possibleReadings, issue.regionDescription, issue.explanation]),
  }
}

function parseRawIssues(value: unknown): ParsedIssues {
  const source = boundedAuxiliaryItems(value, LIMITS.issues)
  const parsed: RawMultimodalIssueV1[] = []
  const suppressedReferences: SuppressedIssueReference[] = []
  let omittedMalformed = source.omittedMalformed
  for (const item of source.items) {
    if (!isRecord(item)) {
      omittedMalformed = true
      continue
    }
    const parsedFields = parseIssueFields(item)
    if (!hasExactProviderKeys(item, KEYS.issue) || !parsedFields) {
      const reference = suppressedIssueReference(item, parsedFields)
      if (reference) suppressedReferences.push(reference)
      if (!reference?.silent) omittedMalformed = true
      continue
    }
    parsed.push(parsedFields)
  }
  return { items: parsed, claimedKeys: parsed.map(({ issueKey }) => issueKey), suppressedReferences, omittedMalformed }
}

function parseRawSentenceRevisions(value: unknown): ParsedAuxiliary<RawSentenceRevisionV1> {
  const source = boundedAuxiliaryItems(value, LIMITS.revisions)
  const parsed: RawSentenceRevisionV1[] = []
  let omittedMalformed = source.omittedMalformed
  for (const item of source.items) {
    if (!isRecord(item) || !hasExactProviderKeys(item, KEYS.sentenceRevision) || !Array.isArray(item.relatedIssueKeys) || !Array.isArray(item.changeTypes)) {
      omittedMalformed = true
      continue
    }
    const originalText = quote(item.originalText), revisedText = text(item.revisedText), note = text(item.note)
    const relatedIssueKeys = textArray(item.relatedIssueKeys, LIMITS.relationships, LIMITS.relationshipKey)
    if (!originalText || !revisedText || !note || !relatedIssueKeys || new Set(relatedIssueKeys).size !== relatedIssueKeys.length || item.changeTypes.length === 0 || item.changeTypes.length > LIMITS.changeTypes || new Set(item.changeTypes).size !== item.changeTypes.length || !item.changeTypes.every((entry) => typeof entry === 'string' && CHANGE_TYPES.has(entry))) {
      omittedMalformed = true
      continue
    }
    parsed.push({ originalText, revisedText, note, relatedIssueKeys, changeTypes: [...item.changeTypes] as RawSentenceRevisionV1['changeTypes'] })
  }
  return { items: parsed, omittedMalformed }
}

function parseRawSentencePairs(value: unknown): ParsedAuxiliary<RawSentencePairV1> {
  const source = boundedAuxiliaryItems(value, LIMITS.sentencePairs)
  const parsed: RawSentencePairV1[] = []
  let omittedMalformed = source.omittedMalformed
  for (const item of source.items) {
    if (!isRecord(item) || !hasExactProviderKeys(item, KEYS.sentencePair) || !Array.isArray(item.relatedIssueKeys) || !Array.isArray(item.changeTypes)) {
      omittedMalformed = true
      continue
    }
    const originalText = quote(item.originalText), correctedText = text(item.correctedText), improvedText = text(item.improvedText), explanation = text(item.explanation)
    const relatedIssueKeys = textArray(item.relatedIssueKeys, LIMITS.relationships, LIMITS.relationshipKey)
    if (!originalText || !correctedText || !improvedText || !explanation || !relatedIssueKeys || new Set(relatedIssueKeys).size !== relatedIssueKeys.length || typeof item.requiresTeacherReview !== 'boolean' || item.changeTypes.length === 0 || item.changeTypes.length > LIMITS.changeTypes || new Set(item.changeTypes).size !== item.changeTypes.length || !item.changeTypes.every((entry) => typeof entry === 'string' && CHANGE_TYPES.has(entry))) {
      omittedMalformed = true
      continue
    }
    parsed.push({ originalText, correctedText, improvedText, relatedIssueKeys, changeTypes: [...item.changeTypes] as RawSentencePairV1['changeTypes'], explanation, requiresTeacherReview: item.requiresTeacherReview })
  }
  return { items: parsed, omittedMalformed }
}

function uniqueSafeTexts(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))]
}

function suppressedLogicReference(value: Record<string, unknown>): SuppressedReference | null {
  const originalText = quote(value.originalText)
  const texts = uniqueSafeTexts([
    originalText,
    rawContext(value.contextBefore), rawContext(value.contextAfter),
    text(value.diagnosis), text(value.conservativeSuggestion), text(value.polishedSuggestion),
  ].filter((entry) => entry !== ''))
  if (texts.length === 0) return null
  return { claimedIssueKey: text(value.issueKey, LIMITS.issueKey), originalText, texts }
}

function parseRawLogicIssues(value: unknown): ParsedReferencedKeyedAuxiliary<RawLogicIssueV1> {
  const source = boundedAuxiliaryItems(value, LIMITS.logicIssues)
  const parsed: RawLogicIssueV1[] = []
  const suppressedReferences: SuppressedReference[] = []
  let omittedMalformed = source.omittedMalformed
  const subTypes = new Set<RawLogicIssueV1['subType']>(['weak_connection', 'unclear_logic', 'missing_cause_effect', 'unclear_transition', 'topic_drift', 'irrelevant_sentence', 'unclear_reference', 'missing_motivation', 'plot_gap'])
  const actions = new Set<RawLogicIssueV1['suggestedAction']>(['add_connector', 'add_bridge_sentence', 'delete_sentence', 'replace_sentence', 'clarify_reference', 'ask_student_to_explain'])
  for (const item of source.items) {
    if (!isRecord(item) || !hasExactProviderKeys(item, KEYS.logicIssue)) {
      if (isRecord(item)) {
        const reference = suppressedLogicReference(item)
        if (reference) suppressedReferences.push(reference)
      }
      omittedMalformed = true
      continue
    }
    const issueKey = text(item.issueKey, LIMITS.issueKey), originalText = quote(item.originalText), contextBefore = rawContext(item.contextBefore), contextAfter = rawContext(item.contextAfter), subType = text(item.subType, 32), severity = text(item.severity, 16), diagnosis = text(item.diagnosis), suggestedAction = text(item.suggestedAction, 32), conservativeSuggestion = text(item.conservativeSuggestion), polishedSuggestion = text(item.polishedSuggestion)
    if (!issueKey || !originalText || contextBefore === null || contextAfter === null || !subType || !subTypes.has(subType as RawLogicIssueV1['subType']) || !severity || !['low', 'medium', 'high'].includes(severity) || !diagnosis || !suggestedAction || !actions.has(suggestedAction as RawLogicIssueV1['suggestedAction']) || !conservativeSuggestion || !polishedSuggestion || typeof item.requiresTeacherReview !== 'boolean') {
      const reference = suppressedLogicReference(item)
      if (reference) suppressedReferences.push(reference)
      omittedMalformed = true
      continue
    }
    parsed.push({ issueKey, originalText, contextBefore, contextAfter, subType: subType as RawLogicIssueV1['subType'], severity: severity as RawLogicIssueV1['severity'], diagnosis, suggestedAction: suggestedAction as RawLogicIssueV1['suggestedAction'], conservativeSuggestion, polishedSuggestion, requiresTeacherReview: item.requiresTeacherReview })
  }
  return { items: parsed, claimedKeys: parsed.map(({ issueKey }) => issueKey), suppressedReferences, omittedMalformed }
}

function suppressedLegibilityReference(value: Record<string, unknown>): SuppressedReference | null {
  const originalText = quote(value.transcriptText)
  const possibleReadings = Array.isArray(value.possibleReadings)
    ? value.possibleReadings.slice(0, 4).map((reading) => text(reading, LIMITS.possibleReading))
    : []
  const texts = uniqueSafeTexts([
    originalText, ...possibleReadings, text(value.regionDescription), text(value.explanation),
  ])
  if (texts.length === 0) return null
  return { claimedIssueKey: text(value.issueKey, LIMITS.issueKey), originalText, texts }
}

function parseRawLegibilityIssues(value: unknown): ParsedReferencedKeyedAuxiliary<RawLegibilityIssueV1> {
  const source = boundedAuxiliaryItems(value, LIMITS.legibilityIssues)
  const parsed: RawLegibilityIssueV1[] = []
  const suppressedReferences: SuppressedReference[] = []
  let omittedMalformed = source.omittedMalformed
  for (const item of source.items) {
    if (!isRecord(item) || (!hasExactProviderKeys(item, KEYS.legibilityIssue) && !hasExactProviderKeys(item, KEYS.legacyLegibilityIssue))) {
      if (isRecord(item)) {
        const reference = suppressedLegibilityReference(item)
        if (reference) suppressedReferences.push(reference)
      }
      omittedMalformed = true
      continue
    }
    const issueKey = text(item.issueKey, LIMITS.issueKey), transcriptText = quote(item.transcriptText), possibleReadings = textArray(item.possibleReadings, 4, LIMITS.possibleReading), regionDescription = text(item.regionDescription), explanation = text(item.explanation), defaultOutcome = text(item.defaultOutcome, 64)
    const hasResolution = 'resolution' in item || 'deductionPoints' in item
    const validResolution = typeof item.deductionPoints === 'number' && Number.isFinite(item.deductionPoints)
      && ((item.resolution === 'resolved_correct' && item.deductionPoints === 0)
        || (item.resolution === 'unresolved' && item.deductionPoints > 0 && roundScore2(item.deductionPoints) === item.deductionPoints))
    if (!issueKey || !transcriptText || !possibleReadings || possibleReadings.length < 2 || !hasDistinctNormalizedText(possibleReadings) || typeof item.pageNumber !== 'number' || !Number.isInteger(item.pageNumber) || item.pageNumber < 1 || !regionDescription || !explanation || defaultOutcome !== 'count_as_legibility_error' || (hasResolution && !validResolution)) {
      const reference = suppressedLegibilityReference(item)
      if (reference) suppressedReferences.push(reference)
      omittedMalformed = true
      continue
    }
    parsed.push({ issueKey, transcriptText, possibleReadings, pageNumber: item.pageNumber, regionDescription, explanation, defaultOutcome, ...(hasResolution ? { resolution: item.resolution as 'resolved_correct' | 'unresolved', deductionPoints: item.deductionPoints as number } : {}) })
  }
  return { items: parsed, claimedKeys: parsed.map(({ issueKey }) => issueKey), suppressedReferences, omittedMalformed }
}

function parseLogicNotes(value: unknown): ParsedAuxiliary<{ quote: string; note: string }> {
  const source = boundedAuxiliaryItems(value, LIMITS.logicNotes)
  const parsed: Array<{ quote: string; note: string }> = []
  let omittedMalformed = source.omittedMalformed
  for (const item of source.items) {
    if (!isRecord(item) || !hasExactProviderKeys(item, KEYS.logicNote)) {
      omittedMalformed = true
      continue
    }
    const rawQuote = quote(item.quote), note = text(item.note)
    if (!rawQuote || !note) {
      omittedMalformed = true
      continue
    }
    parsed.push({ quote: rawQuote, note })
  }
  return { items: parsed, omittedMalformed }
}

function requestFor(context: MultimodalNormalizationContext, transcript: string): GradingRequestV1 | null {
  const rubric = validateConfirmedRubric(context.task.rubric)
  if (!rubric.ok || !Number.isInteger(context.task.fullScore) || context.task.fullScore < 1 || context.task.fullScore > 100) return null
  return { requestVersion: 'grading-request-v1', requestId: context.requestId, task: { taskId: context.task.taskId, writingGenre: 'practical_writing', fullScore: context.task.fullScore, prompt: { writingGenre: 'practical_writing', taskRequirement: context.task.materialSummary }, rubric: { status: 'confirmed', writingGoal: context.task.materialSummary, offTopicCriteria: [], dimensions: rubric.value.dimensions.map(({ id, name, weight, description, deductionFocus }) => ({ id, name, weight, description, deductionFocus })), excellentFeatures: [], reviewTriggers: [] } }, essay: { essayId: context.essayId, confirmedTranscript: transcript, ocrContext: { sourceKind: 'manual', hasKnownOcrRisk: false, riskCodes: [] } } }
}

function parseExpressionUpgrades(value: unknown, transcript: string): { items: RawExpressionUpgradeV1[]; omittedUngroundedItems: RawExpressionUpgradeV1[]; omittedMalformed: boolean } {
  if (!Array.isArray(value) || value.length > LIMITS.upgrades) return { items: [], omittedUngroundedItems: [], omittedMalformed: true }
  const upgrades: RawExpressionUpgradeV1[] = []
  const omittedUngroundedItems: RawExpressionUpgradeV1[] = []
  let omittedMalformed = false
  for (const item of value) {
    if (!isRecord(item) || !hasExactProviderKeys(item, KEYS.expressionUpgrade)) {
      omittedMalformed = true
      continue
    }
    const originalText = quote(item.originalText), upgradedText = text(item.upgradedText), note = text(item.note)
    if (!originalText || !upgradedText || !note) {
      omittedMalformed = true
      continue
    }
    if (!exactUniqueTranscriptRange(transcript, originalText)) {
      omittedUngroundedItems.push({ originalText, upgradedText, note })
      continue
    }
    upgrades.push({ originalText, upgradedText, note })
  }
  return { items: upgrades, omittedUngroundedItems, omittedMalformed }
}


type ParsedRawScores =
  | { ok: true; scores: Map<string, Record<string, unknown>>; omittedAuxiliaryRows: boolean }
  | { ok: false }

function parseBoundedRawScores(value: unknown, context: MultimodalNormalizationContext): ParsedRawScores {
  if (!Array.isArray(value)) return { ok: false }
  const dimensions = new Map(context.task.rubric.dimensions.map((dimension) => [dimension.id, dimension]))
  const seen = new Set<string>()
  const scores = new Map<string, Record<string, unknown>>()
  let omittedAuxiliaryRows = false
  for (const item of value) {
    if (!isRecord(item) || typeof item.dimensionId !== 'string' || !dimensions.has(item.dimensionId)) {
      omittedAuxiliaryRows = true
      continue
    }
    if (seen.has(item.dimensionId)) return { ok: false }
    seen.add(item.dimensionId)
    if (!hasExactProviderKeys(item, KEYS.dimensionScore)) omittedAuxiliaryRows = true
    const dimension = dimensions.get(item.dimensionId)!
    if (typeof item.score !== 'number' || !Number.isFinite(item.score) || item.score < 0 || item.score > calculateDimensionMaxScore(context.task.fullScore, dimension.weight)) return { ok: false }
    scores.set(item.dimensionId, item)
  }
  if (seen.size !== dimensions.size) return { ok: false }
  return { ok: true, scores, omittedAuxiliaryRows }
}

export function normalizeMultimodalResult(payload: unknown, context: MultimodalNormalizationContext): MultimodalNormalizationResult {
  if (!isRecord(payload)) return invalid('result_shape')
  const transcript = context.confirmedTranscript !== undefined
    ? typeof payload.transcript === 'string' && payload.transcript === context.confirmedTranscript
      ? context.confirmedTranscript
      : null
    : quote(payload.transcript, LIMITS.publicText)
  if (!transcript || !isWellFormedUnicode(transcript)) return invalid(context.confirmedTranscript === undefined ? 'transcript' : 'confirmed_transcript_invariants')
  const request = requestFor(context, transcript)
  if (!request) return invalid('task_context')
  const parsedRawScores = parseBoundedRawScores(payload.dimensionScores, context)
  if (!parsedRawScores.ok) return invalid('dimension_scores')
  const rawScores = parsedRawScores.scores
  let auxiliaryInputDegraded = parsedRawScores.omittedAuxiliaryRows
  const parsedRecognitionWarnings = parseRecognitionWarnings(payload.recognitionWarnings)
  if (parsedRecognitionWarnings.omittedMalformed) auxiliaryInputDegraded = true
  const pageReview = normalizePageAssessments(payload.pageAssessments, { ...context, transcript })
  if (pageReview.degraded) auxiliaryInputDegraded = true
  const warningCandidates = [...pageReview.warnings, ...parsedRecognitionWarnings.items]
  const warningKeys = new Set<string>()
  const uniqueWarnings = warningCandidates.filter(({ scope, message }) => {
    const key = JSON.stringify([scope, message])
    if (warningKeys.has(key)) return false
    warningKeys.add(key)
    return true
  })
  if (uniqueWarnings.length > LIMITS.recognitionWarnings) auxiliaryInputDegraded = true
  const sourceRecognitionWarnings = context.confirmedTranscript === undefined ? uniqueWarnings.slice(0, LIMITS.recognitionWarnings) : []
  if (context.confirmedTranscript !== undefined && (parsedRecognitionWarnings.items.length > 0 || payload.printedTextExcluded !== true)) auxiliaryInputDegraded = true
  const printedTextExcluded = context.confirmedTranscript !== undefined
    ? true
    : typeof payload.printedTextExcluded === 'boolean'
      ? payload.printedTextExcluded
      : (auxiliaryInputDegraded = true, false)
  const parsedIssues = parseRawIssues(payload.issues)
  const parsedRevisions = parseRawSentenceRevisions(payload.sentenceRevisions)
  if (parsedIssues.omittedMalformed || parsedRevisions.omittedMalformed) auxiliaryInputDegraded = true
  const parsedUpgrades = parseExpressionUpgrades(payload.expressionUpgrades, transcript)
  const fullTextRevisionRecord = isRecord(payload.fullTextRevision) ? payload.fullTextRevision : null
  const parsedPairs = parseRawSentencePairs(fullTextRevisionRecord?.sentencePairs)
  const parsedLogicNotes = parseLogicNotes(fullTextRevisionRecord?.logicNotes)
  const parsedLogicIssues = parseRawLogicIssues(fullTextRevisionRecord?.logicIssues)
  if (!fullTextRevisionRecord || parsedPairs.omittedMalformed || parsedLogicNotes.omittedMalformed || parsedLogicIssues.omittedMalformed) auxiliaryInputDegraded = true
  const parsedLegibilityIssues = parseRawLegibilityIssues(payload.legibilityIssues)
  if (parsedLegibilityIssues.omittedMalformed) auxiliaryInputDegraded = true
  const claimedKeyCounts = new Map<string, number>()
  for (const key of [...parsedIssues.claimedKeys, ...parsedLogicIssues.claimedKeys, ...parsedLegibilityIssues.claimedKeys]) {
    claimedKeyCounts.set(key, (claimedKeyCounts.get(key) ?? 0) + 1)
  }
  const duplicatedClaimedKeys = new Set([...claimedKeyCounts].filter(([, count]) => count > 1).map(([key]) => key))
  if (duplicatedClaimedKeys.size > 0) auxiliaryInputDegraded = true
  const duplicateOmittedIssues = parsedIssues.items.filter(({ issueKey }) => duplicatedClaimedKeys.has(issueKey))
  const duplicateOmittedLogicIssues = parsedLogicIssues.items.filter(({ issueKey }) => duplicatedClaimedKeys.has(issueKey))
  const duplicateOmittedLegibilityIssues = parsedLegibilityIssues.items.filter(({ issueKey }) => duplicatedClaimedKeys.has(issueKey))
  const uniquelyKeyedIssues = parsedIssues.items.filter(({ issueKey }) => !duplicatedClaimedKeys.has(issueKey))
  const ungroundedIssues = uniquelyKeyedIssues.filter(({ originalText }) => exactUniqueTranscriptRange(transcript, originalText) === null)
  const issues = uniquelyKeyedIssues.filter((issue) => !ungroundedIssues.includes(issue))
  const parsedIssueReferences = parsedIssues.suppressedReferences.flatMap((reference) => {
    const matchingIssues = parsedIssues.items.filter(({ issueKey }) => issueKey === reference.claimedIssueKey)
    if (matchingIssues.length === 0) return [reference]
    if (matchingIssues.some((issue) => sameSuppressedIssueReference(reference, suppressedReferenceFromIssue(issue, false)))) return []
    const classificationMatches = matchingIssues.some((issue) => (
      sameSuppressedIssueClassification(reference, suppressedReferenceFromIssue(issue, false))
    ))
    if (!classificationMatches) {
      auxiliaryInputDegraded = true
      return [{ ...reference, safelyClassifiedUncertainSpelling: false, silent: false }]
    }
    const remainsSafelyClassifiedSpelling = reference.safelyClassifiedUncertainSpelling
      && matchingIssues.some(issueIsUncertainSpelling)
    if (!remainsSafelyClassifiedSpelling) auxiliaryInputDegraded = true
    const matchingTexts = new Set(matchingIssues.flatMap((issue) => suppressedReferenceFromIssue(issue, false).texts))
    const sharesGenuineOriginal = matchingIssues.some((issue) => (
      !issueIsUncertainSpelling(issue) && issue.originalText === reference.originalText
    ))
    return [{
      ...reference,
      originalText: sharesGenuineOriginal ? null : reference.originalText,
      texts: reference.texts.filter((value) => !matchingTexts.has(value)),
      safelyClassifiedUncertainSpelling: sharesGenuineOriginal ? false : reference.safelyClassifiedUncertainSpelling,
      silent: remainsSafelyClassifiedSpelling,
    }]
  })
  const issueReferenceCandidates: SuppressedIssueReference[] = [
    ...parsedIssueReferences,
    ...duplicateOmittedIssues.map((issue) => suppressedReferenceFromIssue(issue, false)),
    ...ungroundedIssues.map((issue) => suppressedReferenceFromIssue(issue, issueIsUncertainSpelling(issue))),
  ]
  const safelySuppressedSpellingReferences = issueReferenceCandidates.filter(({ safelyClassifiedUncertainSpelling }) => safelyClassifiedUncertainSpelling)
  const rejectedIssueReferences: SuppressedReference[] = issueReferenceCandidates.filter(({ safelyClassifiedUncertainSpelling }) => !safelyClassifiedUncertainSpelling)
  const omittedUngroundedIssues = ungroundedIssues.length > 0
  const reviewableUngroundedIssueOmitted = ungroundedIssues.some((issue) => !issueIsUncertainSpelling(issue))
  const revisions = parsedRevisions.items
  const pairs = parsedPairs.items
  const logicNotes = parsedLogicNotes.items
  const logicIssues = parsedLogicIssues.items.filter(({ issueKey }) => !duplicatedClaimedKeys.has(issueKey))
  const groundedLogicIssues = logicIssues.filter((issue) => hasOrderedLogicContext(transcript, issue))
  const ungroundedLogicIssues = logicIssues.filter((issue) => !groundedLogicIssues.includes(issue))
  const omittedUngroundedLogicIssues = ungroundedLogicIssues.length > 0
  const uniqueLegibilityIssues = parsedLegibilityIssues.items.filter(({ issueKey }) => !duplicatedClaimedKeys.has(issueKey))
  const legibilityDimension = request.task.rubric.dimensions.find(({ id }) => id === 'legibility')
  const legibilityMaxScore = legibilityDimension
    ? calculateDimensionMaxScore(request.task.fullScore, legibilityDimension.weight)
    : 0
  const groundedLegibilityAssessments = uniqueLegibilityIssues.filter(({ pageNumber, resolution, deductionPoints }) => (
    legibilityMaxScore > 0
      && context.confirmedTranscript === undefined
      && pageNumber <= context.pageCount
      && (resolution !== 'unresolved' || deductionPoints! <= legibilityMaxScore)
  )).filter(({ transcriptText }) => (
    exactUniqueTranscriptRange(transcript, transcriptText) !== null
  ))
  const conflictingLegibilityKeys = new Set<string>()
  for (let left = 0; left < groundedLegibilityAssessments.length; left += 1) {
    for (let right = left + 1; right < groundedLegibilityAssessments.length; right += 1) {
      const leftIssue = groundedLegibilityAssessments[left], rightIssue = groundedLegibilityAssessments[right]
      // Legacy output keeps its original normalization path. New declarations cannot
      // assign resolved and unresolved decisions (or two deductions) to one region.
      if ((leftIssue.resolution !== undefined || rightIssue.resolution !== undefined)
        && transcriptRangesOverlap(exactUniqueTranscriptRange(transcript, leftIssue.transcriptText)!, exactUniqueTranscriptRange(transcript, rightIssue.transcriptText)!)) {
        conflictingLegibilityKeys.add(leftIssue.issueKey)
        conflictingLegibilityKeys.add(rightIssue.issueKey)
      }
    }
  }
  const usableLegibilityAssessments = groundedLegibilityAssessments.filter(({ issueKey }) => !conflictingLegibilityKeys.has(issueKey))
  const resolvedLegibilityIssues = usableLegibilityAssessments.filter(({ resolution }) => resolution === 'resolved_correct')
  const resolvedLegibilityKeys = new Set(resolvedLegibilityIssues.map(({ issueKey }) => issueKey))
  const legibilityIssues = usableLegibilityAssessments.filter(({ resolution }) => resolution !== 'resolved_correct')
  const hasCompleteStructuredLegibility = parsedLegibilityIssues.items.length > 0
    && !parsedLegibilityIssues.omittedMalformed
    && usableLegibilityAssessments.length === parsedLegibilityIssues.items.length
    && usableLegibilityAssessments.every(({ resolution }) => resolution !== undefined)
  if (usableLegibilityAssessments.length !== uniqueLegibilityIssues.length) auxiliaryInputDegraded = true
  const rejectedLogicReferences: SuppressedReference[] = [
    ...parsedLogicIssues.suppressedReferences.filter((reference) => !parsedLogicIssues.items.some((validIssue) => (
      sameSuppressedReference(reference, suppressedReferenceFromLogicIssue(validIssue))
    ))),
    ...duplicateOmittedLogicIssues.map(suppressedReferenceFromLogicIssue),
    ...ungroundedLogicIssues.map(suppressedReferenceFromLogicIssue),
  ]
  const rejectedLegibilityReferences: SuppressedReference[] = [
    ...parsedLegibilityIssues.suppressedReferences.filter((reference) => !parsedLegibilityIssues.items.some((validIssue) => (
      sameSuppressedReference(reference, suppressedReferenceFromLegibilityIssue(validIssue))
    ))),
    ...duplicateOmittedLegibilityIssues.map(suppressedReferenceFromLegibilityIssue),
    ...uniqueLegibilityIssues.filter((issue) => !usableLegibilityAssessments.includes(issue)).map(suppressedReferenceFromLegibilityIssue),
  ]
  let suppressedReferences: SuppressedReference[] = [
    ...rejectedIssueReferences,
    ...rejectedLogicReferences,
    ...rejectedLegibilityReferences,
  ]
  let overallComment = text(payload.overallComment) ?? '已依据评分标准完成批改。'
  if (!text(payload.overallComment)) auxiliaryInputDegraded = true
  if (parsedIssues.omittedMalformed || omittedUngroundedIssues) overallComment = '已依据评分标准完成批改。'
  let upgrades = parsedUpgrades.items
  if (parsedUpgrades.omittedMalformed) auxiliaryInputDegraded = true
  const groundedLogicNotes = logicNotes.filter(({ quote }) => exactUniqueTranscriptRange(transcript, quote) !== null)
  const omittedUngroundedLogicNotes = groundedLogicNotes.length !== logicNotes.length
  const issueEvidenceByKey = new Map<string, string>([
    ...issues.map((issue): [string, string] => [issue.issueKey, issue.originalText]),
    ...groundedLogicIssues.map((issue): [string, string] => [issue.issueKey, issue.originalText]),
    ...legibilityIssues.map((issue): [string, string] => [issue.issueKey, issue.transcriptText]),
  ])
  const issueRangesByKey = new Map([
    ...issues.map((issue) => [issue.issueKey, exactUniqueTranscriptRange(transcript, issue.originalText)] as const),
    ...groundedLogicIssues.map((issue) => [issue.issueKey, exactUniqueTranscriptRange(transcript, issue.originalText)] as const),
    ...legibilityIssues.map((issue) => [issue.issueKey, exactUniqueTranscriptRange(transcript, issue.transcriptText)] as const),
  ])
  const resolvedReadingsWithoutIndependentLanguage = resolvedLegibilityIssues.filter((reading) => {
    const readingRange = exactUniqueTranscriptRange(transcript, reading.transcriptText)!
    const overlappingLanguage = issues.filter((issue) => (
      (issue.type === 'grammar' || issue.type === 'word_choice')
      && transcriptRangesOverlap(issueRangesByKey.get(issue.issueKey)!, readingRange)
    ))
    // Resolving letters does not certify grammar or word choice. A grounded,
    // independently classified correction may change the resolved word, unless
    // it merely substitutes a rejected visual reading. Conflicting declarations
    // keep the conservative path; genuine uncertain spelling is handled below.
    return overlappingLanguage.length === 0 || !overlappingLanguage.every((issue) => {
      const issueRange = issueRangesByKey.get(issue.issueKey)!
      return issue.evidenceCertainty === 'certain' && !issue.requiresTeacherReview
        && issueRange.start <= readingRange.start && issueRange.end >= readingRange.end
        && issue.suggestion !== issue.originalText
        && !reading.possibleReadings.some((alternative) => (
          alternative !== reading.transcriptText
          && !containsBoundedTerm(issue.originalText, alternative)
          && containsBoundedTerm(issue.suggestion, alternative)
        ))
    })
  })
  const uncertainSpellingIssues: RawMultimodalIssueV1[] = [
    ...uniquelyKeyedIssues.filter(issueIsUncertainSpelling),
    // Resolved-only observations still use the existing silent cleanup. Do not
    // turn independently grounded language errors into uncertain spelling.
    ...resolvedReadingsWithoutIndependentLanguage.map((issue): RawMultimodalIssueV1 => ({
      issueKey: issue.issueKey, type: 'spelling', severity: 'low',
      originalText: issue.transcriptText, suggestion: issue.transcriptText,
      explanation: 'Resolved correct reading.', evidenceCertainty: 'uncertain', requiresTeacherReview: true,
    })),
    ...safelySuppressedSpellingReferences
      .filter((reference): reference is SuppressedIssueReference & { originalText: string } => reference.originalText !== null)
      .map((reference, index) => ({
        issueKey: reference.claimedIssueKey ?? `suppressed-spelling-${index + 1}`,
        type: 'spelling' as const,
        severity: 'low' as const,
        originalText: reference.originalText,
        suggestion: reference.suggestion ?? reference.originalText,
        explanation: 'Suppressed uncertain spelling.',
        evidenceCertainty: 'uncertain' as const,
        requiresTeacherReview: true,
      })),
  ]
  const uncertainSpellingKeys = new Set([
    ...resolvedLegibilityKeys,
    ...uniquelyKeyedIssues.filter(issueIsUncertainSpelling).map(({ issueKey }) => issueKey),
    ...safelySuppressedSpellingReferences
      .map(({ claimedIssueKey }) => claimedIssueKey)
      .filter((key): key is string => key !== null && !issueEvidenceByKey.has(key)),
  ])
  const uncertainSpellingRanges = uncertainSpellingIssues
    .map(({ originalText }) => exactUniqueTranscriptRange(transcript, originalText))
    .filter((range): range is NonNullable<typeof range> => range !== null && range !== undefined)
  const suppressedReferenceRangeRecords = suppressedReferences
    .map(({ claimedIssueKey, originalText }) => ({ claimedIssueKey, originalText, range: originalText ? exactUniqueTranscriptRange(transcript, originalText) : null }))
    .filter((record): record is { claimedIssueKey: string | null; originalText: string; range: NonNullable<typeof record.range> } => record.range !== null && record.originalText !== null)
  const suppressedReferenceRanges = suppressedReferenceRangeRecords.map(({ range }) => range)
  const referencesSuppressedIssue = (value: string, _excludedClaimedKey?: string) => suppressedReferences.some(({ texts }) => (
    texts.some((candidate) => containsBoundedTerm(value, candidate))
  ))
  const rangeOverlapsSuppressedIssue = (range: NonNullable<ReturnType<typeof exactUniqueTranscriptRange>>, _excludedClaimedKey?: string) => (
    suppressedReferenceRangeRecords.some((candidate) => transcriptRangesOverlap(range, candidate.range))
  )
  const groundedTextOverlapsSuppressedIssue = (value: string, allowExactOriginal = false) => {
    const range = exactUniqueTranscriptRange(transcript, value)
    return Boolean(range && suppressedReferenceRangeRecords.some((candidate) => (
      (!allowExactOriginal || candidate.originalText !== value) && transcriptRangesOverlap(range, candidate.range)
    )))
  }
  const genuineLanguageOrLogicRanges = [
    ...issues
      .filter((issue) => !issueIsUncertainSpelling(issue))
      .map(({ issueKey }) => issueRangesByKey.get(issueKey)),
    ...groundedLogicIssues.flatMap((issue) => [issue.originalText, issue.contextBefore, issue.contextAfter]
      .filter(Boolean)
      .map((value) => exactUniqueTranscriptRange(transcript, value))),
  ].filter((range): range is NonNullable<typeof range> => range !== null && range !== undefined)
  const genuineLanguageOrLogicTexts = [
    ...issues.filter((issue) => !issueIsUncertainSpelling(issue)).map(({ originalText }) => originalText),
    ...groundedLogicIssues.flatMap(({ originalText, contextBefore, contextAfter }) => [originalText, contextBefore, contextAfter].filter(Boolean)),
  ]
  const referencesGenuineLanguageOrLogicSupport = (value: string) => (
    genuineLanguageOrLogicTexts.some((candidate) => containsBoundedTerm(value, candidate))
  )
  const rangeOverlapsGenuineLanguageOrLogicSupport = (range: NonNullable<ReturnType<typeof exactUniqueTranscriptRange>>) => (
    genuineLanguageOrLogicRanges.some((candidate) => transcriptRangesOverlap(range, candidate))
  )
  const referencesFilteredSpelling = (value: string) => explicitlyReferencesFilteredSpelling(value, uncertainSpellingIssues)
  let safeLegibilityIssues = legibilityIssues.filter((issue) => {
    const issueRange = issueRangesByKey.get(issue.issueKey)
    if (!issueRange || ![issue.transcriptText, ...issue.possibleReadings, issue.regionDescription, issue.explanation].every(isWellFormedUnicode)) return false
    if (rangeOverlapsSuppressedIssue(issueRange) || [issue.transcriptText, ...issue.possibleReadings, issue.regionDescription, issue.explanation].some((value) => referencesSuppressedIssue(value))) return false
    return uncertainSpellingIssues.every((spellingIssue) => {
      const spellingRange = exactUniqueTranscriptRange(transcript, spellingIssue.originalText)
      if (spellingRange && transcriptRangesOverlap(issueRange, spellingRange)) return true
      return ![...issue.possibleReadings, issue.regionDescription, issue.explanation]
        .some((value) => explicitlyReferencesFilteredSpelling(value, [spellingIssue]))
    })
  })
  const nonSpellingRanges = issues
    .filter(({ type }) => type !== 'spelling')
    .map(({ issueKey }) => issueRangesByKey.get(issueKey))
    .filter((range): range is NonNullable<typeof range> => range !== null && range !== undefined)
  const overlappingSpellingKeys = new Set(issues
    .filter((issue) => {
      if (issue.type !== 'spelling') return false
      const range = issueRangesByKey.get(issue.issueKey)
      return Boolean(range && nonSpellingRanges.some((candidate) => transcriptRangesOverlap(range, candidate)))
    })
    .map(({ issueKey }) => issueKey))
  const reviewableUngroundedExpressionUpgradeOmitted = parsedUpgrades.omittedUngroundedItems.some((upgrade) => (
    ![upgrade.originalText, upgrade.upgradedText, upgrade.note].some(referencesFilteredSpelling)
  ))
  const referencesLocalLegibility = (value: string) => narrativeExplicitlyReferencesLocalLegibility(value, safeLegibilityIssues)
  const replacementChangesUncertainSpelling = (source: string, replacement: string) => uncertainSpellingIssues.some((spellingIssue) => {
    if (!containsBoundedTerm(source, spellingIssue.originalText)) return false
    if (!containsBoundedTerm(replacement, spellingIssue.originalText)) return true
    return spellingIssue.suggestion !== spellingIssue.originalText
      && !containsBoundedTerm(source, spellingIssue.suggestion)
      && containsBoundedTerm(replacement, spellingIssue.suggestion)
  })
  const narrativeCorrectsUncertainSpelling = (value: string) => explicitlyReferencesFilteredSpellingWithCue(value, uncertainSpellingIssues)
  const itemNarrativesCorrectUncertainSpelling = (values: string[]) => (
    narrativeCorrectsUncertainSpelling(values.join('\n'))
  )
  const rangeIsOnlyUncertainSpelling = (range: NonNullable<ReturnType<typeof exactUniqueTranscriptRange>>) => uncertainSpellingRanges.some((candidate) => (
    range.start === candidate.start && range.end === candidate.end
  ))
  const unsafeIssueKeys = new Set(issues
    .filter((issue) => !issueIsUncertainSpelling(issue) && (
      groundedTextOverlapsSuppressedIssue(issue.originalText, true)
      || Boolean(exactUniqueTranscriptRange(transcript, issue.originalText)
        && rangeIsOnlyUncertainSpelling(exactUniqueTranscriptRange(transcript, issue.originalText)!))
      || replacementChangesUncertainSpelling(issue.originalText, issue.suggestion)
      || itemNarrativesCorrectUncertainSpelling([issue.suggestion, issue.explanation])
      || [issue.suggestion, issue.explanation].some((value) => referencesSuppressedIssue(value) || referencesLocalLegibility(value))
    ))
    .map(({ issueKey }) => issueKey))
  const unsafeLogicIssueKeys = new Set(groundedLogicIssues
    .filter((issue) => (
      [issue.originalText, issue.contextBefore, issue.contextAfter].filter(Boolean).some((value) => groundedTextOverlapsSuppressedIssue(value))
      || [issue.originalText, issue.contextBefore, issue.contextAfter]
        .filter(Boolean)
        .map((value) => exactUniqueTranscriptRange(transcript, value))
        .some((range) => Boolean(range && rangeIsOnlyUncertainSpelling(range)))
      || replacementChangesUncertainSpelling(issue.originalText, issue.conservativeSuggestion)
      || replacementChangesUncertainSpelling(issue.originalText, issue.polishedSuggestion)
      || itemNarrativesCorrectUncertainSpelling([issue.diagnosis, issue.conservativeSuggestion, issue.polishedSuggestion])
      || [issue.diagnosis, issue.conservativeSuggestion, issue.polishedSuggestion].some((value) => referencesSuppressedIssue(value) || referencesLocalLegibility(value))
    ))
    .map(({ issueKey }) => issueKey))
  const policyStageSuppressedReferences: SuppressedReference[] = [
    ...issues.filter(({ issueKey }) => unsafeIssueKeys.has(issueKey)).map(policySuppressedReferenceFromIssue),
    ...groundedLogicIssues.filter(({ issueKey }) => unsafeLogicIssueKeys.has(issueKey)).map(policySuppressedReferenceFromLogicIssue),
    ...legibilityIssues.filter((issue) => !safeLegibilityIssues.includes(issue)).map(policySuppressedReferenceFromLegibilityIssue),
  ]
  if (policyStageSuppressedReferences.length > 0) {
    suppressedReferences = [...suppressedReferences, ...policyStageSuppressedReferences]
  }
  let policyIssues = issues.filter((issue) => !unsafeIssueKeys.has(issue.issueKey) && !issueIsUncertainSpelling(issue))
  let policyLogicIssues = groundedLogicIssues.filter(({ issueKey }) => !unsafeLogicIssueKeys.has(issueKey))
  const maximumPolicySanitizationPasses = policyIssues.length + policyLogicIssues.length + safeLegibilityIssues.length
  for (let pass = 0; pass < maximumPolicySanitizationPasses; pass += 1) {
    const newlyUnsafeIssues = policyIssues.filter((issue) => (
      [issue.suggestion, issue.explanation].some((value) => referencesSuppressedIssue(value))
    ))
    const newlyUnsafeLogicIssues = policyLogicIssues.filter((issue) => (
      [issue.diagnosis, issue.conservativeSuggestion, issue.polishedSuggestion].some((value) => referencesSuppressedIssue(value))
    ))
    const newlyUnsafeLegibilityIssues = safeLegibilityIssues.filter((issue) => (
      [...issue.possibleReadings, issue.regionDescription, issue.explanation].some((value) => referencesSuppressedIssue(value))
    ))
    if (newlyUnsafeIssues.length === 0 && newlyUnsafeLogicIssues.length === 0 && newlyUnsafeLegibilityIssues.length === 0) break
    const newlyUnsafeIssueKeys = new Set(newlyUnsafeIssues.map(({ issueKey }) => issueKey))
    const newlyUnsafeLogicIssueKeys = new Set(newlyUnsafeLogicIssues.map(({ issueKey }) => issueKey))
    for (const key of newlyUnsafeIssueKeys) unsafeIssueKeys.add(key)
    for (const key of newlyUnsafeLogicIssueKeys) unsafeLogicIssueKeys.add(key)
    policyIssues = policyIssues.filter(({ issueKey }) => !newlyUnsafeIssueKeys.has(issueKey))
    policyLogicIssues = policyLogicIssues.filter(({ issueKey }) => !newlyUnsafeLogicIssueKeys.has(issueKey))
    const newlyUnsafeLegibilityIssueKeys = new Set(newlyUnsafeLegibilityIssues.map(({ issueKey }) => issueKey))
    safeLegibilityIssues = safeLegibilityIssues.filter(({ issueKey }) => !newlyUnsafeLegibilityIssueKeys.has(issueKey))
    suppressedReferences = [
      ...suppressedReferences,
      ...newlyUnsafeIssues.map(policySuppressedReferenceFromIssue),
      ...newlyUnsafeLogicIssues.map(policySuppressedReferenceFromLogicIssue),
      ...newlyUnsafeLegibilityIssues.map(policySuppressedReferenceFromLegibilityIssue),
    ]
  }
  const safeLegibilityKeys = new Set(safeLegibilityIssues.map(({ issueKey }) => issueKey))
  const omittedLegibilityKeys = new Set(legibilityIssues
    .filter(({ issueKey }) => !safeLegibilityKeys.has(issueKey))
    .map(({ issueKey }) => issueKey))
  const legibilityKeys = safeLegibilityKeys
  const legibilityRanges = [...legibilityKeys]
    .map((key) => issueRangesByKey.get(key))
    .filter((range): range is NonNullable<typeof range> => range !== null && range !== undefined)
  const contaminatedRanges = [...suppressedReferenceRanges, ...legibilityRanges]
  const publicRelationKeys = new Set([
    ...policyIssues.map(({ issueKey }) => issueKey),
    ...policyLogicIssues.map(({ issueKey }) => issueKey),
  ])
  let reviewableRelatedAuxiliaryOmitted = unsafeIssueKeys.size > 0 || unsafeLogicIssueKeys.size > 0
  const sanitizeRelatedItem = <T extends { originalText: string; relatedIssueKeys: string[]; changeTypes: RawSentenceRevisionV1['changeTypes'] }>(item: T, replacements: string[], narratives: string[]): T | null => {
    const sourceRange = exactUniqueTranscriptRange(transcript, item.originalText)
    const sourceOverlapsSuppressed = Boolean(sourceRange && rangeOverlapsSuppressedIssue(sourceRange))
    const sourceOverlapsUncertainSpelling = Boolean(sourceRange
      && uncertainSpellingRanges.some((candidate) => transcriptRangesOverlap(sourceRange, candidate)))
    const sourceIsOnlyUncertainSpelling = Boolean(sourceRange && rangeIsOnlyUncertainSpelling(sourceRange))
    const publicKeys = item.relatedIssueKeys.filter((key) => publicRelationKeys.has(key))
    const uncertainKeys = item.relatedIssueKeys.filter((key) => uncertainSpellingKeys.has(key))
    const relationsArePublic = publicKeys.length === item.relatedIssueKeys.length
    const allRelationsAreClassified = item.relatedIssueKeys.every((key) => (
      publicRelationKeys.has(key) || uncertainSpellingKeys.has(key)
    ))
    const spellingNarrativeIsUnsafe = replacements.some((replacement) => replacementChangesUncertainSpelling(item.originalText, replacement))
      || itemNarrativesCorrectUncertainSpelling([...replacements, ...narratives])
    const otherNarrativeIsUnsafe = narratives.some((value) => referencesSuppressedIssue(value) || referencesLocalLegibility(value))
      || replacements.some((value) => referencesSuppressedIssue(value) || referencesLocalLegibility(value))
    if (sourceRange && !sourceOverlapsSuppressed && !sourceIsOnlyUncertainSpelling && relationsArePublic && !spellingNarrativeIsUnsafe && !otherNarrativeIsUnsafe) return item

    const hasSpellingTaint = uncertainKeys.length > 0 || spellingNarrativeIsUnsafe || sourceOverlapsUncertainSpelling
    const hasGenuineAttribution = publicKeys.length > 0
      || Boolean(sourceRange && rangeOverlapsGenuineLanguageOrLogicSupport(sourceRange))
      || narratives.some(referencesGenuineLanguageOrLogicSupport)
    if (hasSpellingTaint && allRelationsAreClassified && !sourceOverlapsSuppressed && !otherNarrativeIsUnsafe) {
      const safeChangeTypes = item.changeTypes.filter((changeType) => changeType !== 'spelling')
      if (sourceRange && !sourceIsOnlyUncertainSpelling && publicKeys.length > 0 && !spellingNarrativeIsUnsafe && safeChangeTypes.length > 0) {
        reviewableRelatedAuxiliaryOmitted = true
        return { ...item, relatedIssueKeys: publicKeys, changeTypes: safeChangeTypes } as T
      }
      if (hasGenuineAttribution) reviewableRelatedAuxiliaryOmitted = true
      return null
    }
    reviewableRelatedAuxiliaryOmitted = true
    return null
  }
  let policyRevisions = revisions
    .map((revision) => sanitizeRelatedItem(revision, [revision.revisedText], [revision.note]))
    .filter((revision): revision is RawSentenceRevisionV1 => revision !== null)
  let policyPairs = pairs
    .map((pair) => sanitizeRelatedItem(pair, [pair.correctedText, pair.improvedText], [pair.explanation]))
    .filter((pair): pair is RawSentencePairV1 => pair !== null)
  const omitConflictingEditLocations = <T extends { originalText: string; relatedIssueKeys: string[] }>(items: T[]) => {
    const ranges = items.map(({ originalText }) => exactUniqueTranscriptRange(transcript, originalText)!)
    const conflictingIndexes = new Set<number>()
    for (let left = 0; left < ranges.length; left += 1) {
      for (let right = left + 1; right < ranges.length; right += 1) {
        if (transcriptRangesOverlap(ranges[left], ranges[right])) {
          conflictingIndexes.add(left)
          conflictingIndexes.add(right)
        }
      }
    }
    if ([...conflictingIndexes].some((index) => {
      const keys = items[index].relatedIssueKeys
      return keys.length === 0 || !keys.every((key) => uncertainSpellingKeys.has(key))
    })) reviewableRelatedAuxiliaryOmitted = true
    return items.filter((_item, index) => !conflictingIndexes.has(index))
  }
  policyRevisions = omitConflictingEditLocations(policyRevisions)
  policyPairs = omitConflictingEditLocations(policyPairs)
  upgrades = upgrades.filter((upgrade) => {
    const sourceRange = exactUniqueTranscriptRange(transcript, upgrade.originalText)
    const narratives = [upgrade.upgradedText, upgrade.note]
    const sourceIsSuppressed = groundedTextOverlapsSuppressedIssue(upgrade.originalText)
    const sourceIsOnlyUncertainSpelling = Boolean(sourceRange && rangeIsOnlyUncertainSpelling(sourceRange))
    const spellingIsUnsafe = replacementChangesUncertainSpelling(upgrade.originalText, upgrade.upgradedText)
      || itemNarrativesCorrectUncertainSpelling(narratives)
    const otherNarrativeIsUnsafe = narratives.some((value) => referencesSuppressedIssue(value) || referencesLocalLegibility(value))
    const itemIsUnsafe = sourceIsSuppressed || sourceIsOnlyUncertainSpelling || spellingIsUnsafe || otherNarrativeIsUnsafe
    if (itemIsUnsafe) {
      const hasSpellingTaint = Boolean(sourceRange && uncertainSpellingRanges.some((candidate) => transcriptRangesOverlap(sourceRange, candidate)))
        || spellingIsUnsafe
      const hasGenuineAttribution = Boolean(sourceRange && rangeOverlapsGenuineLanguageOrLogicSupport(sourceRange))
        || narratives.some(referencesGenuineLanguageOrLogicSupport)
      if (!hasSpellingTaint || hasGenuineAttribution) reviewableRelatedAuxiliaryOmitted = true
    }
    return !itemIsUnsafe
  })
  const policyLogicNoteRecords = groundedLogicNotes.filter(({ quote: logicQuote, note }) => {
    const quoteRange = exactUniqueTranscriptRange(transcript, logicQuote)
    const quoteIsSuppressed = groundedTextOverlapsSuppressedIssue(logicQuote)
    const spellingIsUnsafe = Boolean(quoteRange && rangeIsOnlyUncertainSpelling(quoteRange))
      || itemNarrativesCorrectUncertainSpelling([logicQuote, note])
    const noteIsUnsafe = spellingIsUnsafe || referencesSuppressedIssue(note) || referencesLocalLegibility(note)
    if (quoteIsSuppressed || noteIsUnsafe) {
      const hasSpellingTaint = Boolean(quoteRange && uncertainSpellingRanges.some((candidate) => transcriptRangesOverlap(quoteRange, candidate)))
        || spellingIsUnsafe
      const hasGenuineAttribution = Boolean(quoteRange && rangeOverlapsGenuineLanguageOrLogicSupport(quoteRange))
        || referencesGenuineLanguageOrLogicSupport(note)
      if (!hasSpellingTaint || hasGenuineAttribution) reviewableRelatedAuxiliaryOmitted = true
    }
    return !quoteIsSuppressed && !noteIsUnsafe
  })
  const referencesResolvedReading = (value: string) => resolvedLegibilityIssues.some(({ transcriptText, possibleReadings }) => (
    [transcriptText, ...possibleReadings].some((reading) => containsBoundedTerm(value, reading))
  ))
  const recognitionWarnings = sourceRecognitionWarnings.filter((warning) => {
    // Page completeness is independent of whether a visible word can be read.
    // In particular, candidate readings such as "1" must not erase "page 1".
    if (pageReview.warnings.includes(warning) || warning.scope === 'image_clipped' || warning.scope === 'printed_boundary') return true
    const { message } = warning
    return !explicitlyReferencesFilteredSpellingWithCue(message, uncertainSpellingIssues)
      && !referencesResolvedReading(message)
      && !referencesSuppressedIssue(message)
      && !referencesLocalLegibility(message)
  })
  if (referencesFilteredSpelling(overallComment) || referencesResolvedReading(overallComment) || referencesSuppressedIssue(overallComment) || referencesLocalLegibility(overallComment)) {
    overallComment = '已依据评分标准完成批改。'
  }
  const overlapsContaminatedRange = (key: string) => {
    const range = issueRangesByKey.get(key)
    return Boolean(range && contaminatedRanges.some((candidate) => transcriptRangesOverlap(range, candidate)))
  }
  const ignoredIssueKeys = new Set([
    ...uncertainSpellingKeys,
    ...overlappingSpellingKeys,
    ...unsafeIssueKeys,
    ...unsafeLogicIssueKeys,
    ...omittedLegibilityKeys,
    ...issues.filter(({ issueKey }) => overlapsContaminatedRange(issueKey)).map(({ issueKey }) => issueKey),
    ...groundedLogicIssues.filter((issue) => {
      const ranges = [issue.originalText, issue.contextBefore, issue.contextAfter]
        .filter(Boolean)
        .map((value) => exactUniqueTranscriptRange(transcript, value))
        .filter((range): range is NonNullable<typeof range> => range !== null)
      return ranges.some((range) => contaminatedRanges.some((candidate) => transcriptRangesOverlap(range, candidate)))
    }).map(({ issueKey }) => issueKey),
  ])
  const keptDimensionIssueKeys = new Set([...issueEvidenceByKey.keys()].filter((key) => !ignoredIssueKeys.has(key)))
  const rawDimensionScores: RawDimensionScoreV1[] = []
  let dimensionRelationAdjusted = false
  let dimensionEvidenceRegrounded = false
  let dimensionDeductionNeedsReview = false
  let conservativePolicyScoreAdjusted = false
  const dimensionScoreCandidates = request.task.rubric.dimensions.map((dimension) => {
    const score = rawScores.get(dimension.id)!
    const parsedReason = text(score.reason)
    const parsedEvidence = quote(score.evidence, LIMITS.publicText)
    const rawRelatedIssueKeys = Array.isArray(score.relatedIssueKeys) && score.relatedIssueKeys.length <= LIMITS.relationships
      ? score.relatedIssueKeys.map((key) => text(key, LIMITS.relationshipKey))
      : null
    const relationshipFieldsAreValid = rawRelatedIssueKeys !== null
      && rawRelatedIssueKeys.every((key): key is string => key !== null)
      && new Set(rawRelatedIssueKeys).size === rawRelatedIssueKeys.length
    let reason = parsedReason && isWellFormedUnicode(parsedReason) ? parsedReason : '该维度评分依据需教师复核。'
    let evidence = parsedEvidence ?? transcript
    let relatedIssueKeys = relationshipFieldsAreValid
      ? rawRelatedIssueKeys
      : [...new Set((rawRelatedIssueKeys ?? []).filter((key): key is string => key !== null))]
    const supportFieldsDegraded = !parsedReason || !isWellFormedUnicode(parsedReason) || !parsedEvidence || !relationshipFieldsAreValid
    if (supportFieldsDegraded) auxiliaryInputDegraded = true
    const maxScore = calculateDimensionMaxScore(request.task.fullScore, dimension.weight)
    let roundedScore = roundScore2(score.score as number)
    let requiresTeacherReview = supportFieldsDegraded
    if (supportFieldsDegraded) {
      dimensionDeductionNeedsReview = true
      if (!parsedEvidence) dimensionEvidenceRegrounded = true
    }
    let spellingPolicyAdjusted = false
    const canRebuildLegibilityScore = dimension.id === 'legibility'
      && hasCompleteStructuredLegibility
      && safeLegibilityIssues.length === legibilityIssues.length
      && relationshipFieldsAreValid
      && relatedIssueKeys.every((key) => usableLegibilityAssessments.some(({ issueKey }) => key === issueKey))
      && (roundedScore === maxScore || (relatedIssueKeys.length > 0 && usableLegibilityAssessments.some(({ issueKey, transcriptText }) => {
        if (!relatedIssueKeys.includes(issueKey) || !parsedEvidence) return false
        const evidenceRange = exactUniqueTranscriptRange(transcript, parsedEvidence)
        const issueRange = exactUniqueTranscriptRange(transcript, transcriptText)
        // Reversing an existing deduction requires local, linked evidence. A
        // whole-essay quote must not conceal a separate, unexplained deduction.
        return Boolean(evidenceRange && issueRange && evidenceRange.start >= issueRange.start && evidenceRange.end <= issueRange.end)
      })))
    if (canRebuildLegibilityScore) {
      const unresolvedDeduction = safeLegibilityIssues.reduce((sum, issue) => sum + issue.deductionPoints!, 0)
      const rebuiltScore = roundScore2(maxScore - Math.min(maxScore, unresolvedDeduction))
      if (rebuiltScore !== roundedScore) conservativePolicyScoreAdjusted = true
      roundedScore = rebuiltScore
      relatedIssueKeys = safeLegibilityIssues.map(({ issueKey }) => issueKey)
      reason = safeLegibilityIssues[0]?.explanation ?? '该维度未发现需扣分的问题。'
      evidence = safeLegibilityIssues[0]?.transcriptText ?? transcript
      spellingPolicyAdjusted = safeLegibilityIssues.length === 0
    } else if (dimension.id === 'legibility' && parsedLegibilityIssues.items.some(({ resolution }) => resolution !== undefined)) {
      // A valid sibling must not conceal a new assessment whose complete
      // deduction allocation cannot be established.
      dimensionDeductionNeedsReview = true
      requiresTeacherReview = true
    }
    const originalRelatedIssueKeys = [...relatedIssueKeys]
    const parsedEvidenceRange = parsedEvidence ? exactUniqueTranscriptRange(transcript, parsedEvidence) : null
    const evidenceIsOnlyUncertainSpelling = Boolean(parsedEvidenceRange && rangeIsOnlyUncertainSpelling(parsedEvidenceRange))
    const evidenceOverlapsConflictingGenuineSupport = Boolean(parsedEvidenceRange
      && genuineLanguageOrLogicRanges.some((candidate) => (
        transcriptRangesOverlap(parsedEvidenceRange, candidate)
        && !(evidenceIsOnlyUncertainSpelling
          && candidate.start <= parsedEvidenceRange.start
          && candidate.end >= parsedEvidenceRange.end
          && (candidate.start < parsedEvidenceRange.start || candidate.end > parsedEvidenceRange.end))
      )))
    const reasonReferencesGenuineLanguageOrLogicSupport = Boolean(parsedReason
      && (referencesGenuineLanguageOrLogicSupport(parsedReason) || GENUINE_LANGUAGE_OR_LOGIC_CUE.test(parsedReason)))
    const evidenceOverlapsRejectedReference = Boolean(parsedEvidenceRange && rangeOverlapsSuppressedIssue(parsedEvidenceRange))
    const reasonExplicitlyAttributesUncertainSpelling = Boolean(parsedReason && (
      referencesFilteredSpelling(parsedReason) || UNCERTAIN_SPELLING_ATTRIBUTION_CUE.test(parsedReason)
    ))
    const spellingSupportIsLocallyAttributable = evidenceIsOnlyUncertainSpelling
      && !evidenceOverlapsConflictingGenuineSupport
      && !evidenceOverlapsRejectedReference
      && !reasonReferencesGenuineLanguageOrLogicSupport
    const hasLocalizedUnlinkedUncertainSpellingSupport = originalRelatedIssueKeys.length === 0
      && spellingSupportIsLocallyAttributable
      && reasonExplicitlyAttributesUncertainSpelling
    const hasOnlyUncertainSpellingLinks = originalRelatedIssueKeys.length > 0
      && originalRelatedIssueKeys.every((key) => uncertainSpellingKeys.has(key))
    const linksAreUncertainOrStaleBroadSupport = originalRelatedIssueKeys.length > 0
      && originalRelatedIssueKeys.every((key) => {
        if (uncertainSpellingKeys.has(key)) return true
        const linkedRange = issueRangesByKey.get(key)
        return Boolean(evidenceIsOnlyUncertainSpelling
          && publicRelationKeys.has(key)
          && parsedEvidenceRange
          && linkedRange
          && linkedRange.start <= parsedEvidenceRange.start
          && linkedRange.end >= parsedEvidenceRange.end
          && (linkedRange.start < parsedEvidenceRange.start || linkedRange.end > parsedEvidenceRange.end))
      })
    const relatesOnlyToUncertainSpelling = linksAreUncertainOrStaleBroadSupport
      && spellingSupportIsLocallyAttributable
      && reasonExplicitlyAttributesUncertainSpelling
    const deductedOnlyForUncertainSpelling = dimension.id !== 'legibility'
      && roundedScore < maxScore
      && (relatesOnlyToUncertainSpelling || hasLocalizedUnlinkedUncertainSpellingSupport)
    if (deductedOnlyForUncertainSpelling) {
      roundedScore = maxScore
      relatedIssueKeys = []
      reason = '该维度未发现需扣分的问题。'
      evidence = transcript
      spellingPolicyAdjusted = true
      conservativePolicyScoreAdjusted = true
    } else if (dimension.id !== 'legibility' && roundedScore === maxScore && hasOnlyUncertainSpellingLinks && spellingSupportIsLocallyAttributable) {
      relatedIssueKeys = []
      reason = '该维度未发现需扣分的问题。'
      evidence = transcript
      spellingPolicyAdjusted = true
    } else {
      const safeRelatedIssueKeys = relatedIssueKeys.filter((key) => (
        issueEvidenceByKey.has(key)
        && keptDimensionIssueKeys.has(key)
        && (dimension.id === 'legibility' ? legibilityKeys.has(key) : !legibilityKeys.has(key))
      ))
      if (safeRelatedIssueKeys.length !== relatedIssueKeys.length) {
        relatedIssueKeys = safeRelatedIssueKeys
        reason = '该维度评分依据需教师复核。'
        dimensionDeductionNeedsReview = true
        requiresTeacherReview = true
      }
    }
    if (dimension.id === 'legibility' && legibilityKeys.size > 0) {
      if (roundedScore === maxScore) {
        roundedScore = 0
        reason = '该维度评分依据需教师复核。'
        dimensionDeductionNeedsReview = true
        requiresTeacherReview = true
      }
      const expectedLegibilityKeys = roundedScore < maxScore ? [...legibilityKeys] : []
      if (JSON.stringify(relatedIssueKeys) !== JSON.stringify(expectedLegibilityKeys)) {
        relatedIssueKeys = expectedLegibilityKeys
        reason = '该维度评分依据需教师复核。'
        dimensionDeductionNeedsReview = true
        requiresTeacherReview = true
      }
    }
    if (roundedScore === maxScore && relatedIssueKeys.length > 0) {
      relatedIssueKeys = []
      dimensionRelationAdjusted = true
      requiresTeacherReview = true
    }
    if (roundedScore < maxScore && relatedIssueKeys.length === 0) {
      dimensionDeductionNeedsReview = true
      requiresTeacherReview = true
    }
    const mustNeutralizeUnclassifiedIssueSupport = (parsedIssues.omittedMalformed || reviewableUngroundedIssueOmitted)
      && !spellingPolicyAdjusted
      && (dimension.id !== 'legibility' || legibilityKeys.size === 0)
    if (mustNeutralizeUnclassifiedIssueSupport) {
      if (evidence !== transcript) dimensionEvidenceRegrounded = true
      if (relatedIssueKeys.length > 0) dimensionRelationAdjusted = true
      relatedIssueKeys = []
      reason = '该维度评分依据需教师复核。'
      evidence = transcript
      dimensionDeductionNeedsReview = true
      requiresTeacherReview = true
    }
    if (referencesFilteredSpelling(reason)) {
      const canSilentlyReplaceReason = roundedScore === maxScore && relatedIssueKeys.length === 0
      reason = spellingPolicyAdjusted || canSilentlyReplaceReason ? '该维度未发现需扣分的问题。' : '该维度评分依据需教师复核。'
      if (canSilentlyReplaceReason) spellingPolicyAdjusted = true
      if (!spellingPolicyAdjusted && !canSilentlyReplaceReason) {
        dimensionDeductionNeedsReview = true
        requiresTeacherReview = true
      }
    }
    if (referencesSuppressedIssue(reason)) {
      reason = '该维度评分依据需教师复核。'
      dimensionDeductionNeedsReview = true
      requiresTeacherReview = true
    }
    if (dimension.id !== 'legibility' && referencesLocalLegibility(reason)) {
      reason = '该维度评分依据需教师复核。'
      dimensionDeductionNeedsReview = true
      requiresTeacherReview = true
    }
    const evidenceRange = exactUniqueTranscriptRange(transcript, evidence)
    const evidenceOverlapsUncertainSpelling = Boolean(evidenceRange
      && uncertainSpellingRanges.some((candidate) => transcriptRangesOverlap(evidenceRange, candidate)))
    const evidenceOverlapsSuppressedIssue = Boolean(evidenceRange && rangeOverlapsSuppressedIssue(evidenceRange))
    const evidenceOverlapsLocalLegibility = Boolean(evidenceRange
      && dimension.id !== 'legibility'
      && legibilityRanges.some((candidate) => transcriptRangesOverlap(evidenceRange, candidate)))
    const evidenceOverlapsFilteredContent = evidenceOverlapsUncertainSpelling || evidenceOverlapsSuppressedIssue || evidenceOverlapsLocalLegibility
    const legibilityEvidenceIsUnrelated = dimension.id === 'legibility'
      && legibilityRanges.length > 0
      && Boolean(evidenceRange)
      && !legibilityRanges.some((candidate) => transcriptRangesOverlap(evidenceRange!, candidate))
    const canSilentlyUseSpellingPolicyEvidence = evidenceOverlapsUncertainSpelling
      && !evidenceOverlapsLocalLegibility
      && roundedScore === maxScore
      && relatedIssueKeys.length === 0
    if (canSilentlyUseSpellingPolicyEvidence) {
      evidence = transcript
      spellingPolicyAdjusted = true
    } else if (!parsedEvidence || !evidenceRange || evidenceOverlapsFilteredContent || legibilityEvidenceIsUnrelated) {
      const linkedFallbackEvidence = relatedIssueKeys
        .map((key) => issueEvidenceByKey.get(key))
        .find((candidate): candidate is string => {
          if (!candidate) return false
          const candidateRange = exactUniqueTranscriptRange(transcript, candidate)
          return Boolean(candidateRange && (
            dimension.id === 'legibility'
              || !legibilityRanges.some((blocked) => transcriptRangesOverlap(candidateRange, blocked))
          ))
        })
      evidence = linkedFallbackEvidence ?? transcript
      dimensionEvidenceRegrounded = true
      if (!linkedFallbackEvidence && relatedIssueKeys.length > 0) {
        relatedIssueKeys = []
        dimensionRelationAdjusted = true
      }
      if (!spellingPolicyAdjusted) {
        reason = '该维度评分依据需教师复核。'
        dimensionDeductionNeedsReview = true
        requiresTeacherReview = true
      }
    }
    if (!exactUniqueTranscriptRange(transcript, evidence)) {
      evidence = transcript
      relatedIssueKeys = []
      reason = '该维度评分依据需教师复核。'
      dimensionEvidenceRegrounded = true
      dimensionDeductionNeedsReview = true
      requiresTeacherReview = true
    }
    const finalEvidenceRange = exactUniqueTranscriptRange(transcript, evidence)
    if (dimension.id !== 'legibility'
      && spellingPolicyAdjusted
      && evidence === transcript
      && finalEvidenceRange
      && legibilityRanges.some((candidate) => transcriptRangesOverlap(finalEvidenceRange, candidate))) {
      reason = '该维度评分依据需教师复核。'
      dimensionDeductionNeedsReview = true
      requiresTeacherReview = true
    }
    rawDimensionScores.push({ dimensionId: dimension.id, score: roundedScore, maxScore, reason, evidence, relatedIssueKeys, requiresTeacherReview, ...(spellingPolicyAdjusted ? { spellingPolicyAdjusted: true } : {}) })
    return {
      dimensionId: dimension.id,
      name: dimension.name,
      score: roundedScore,
      maxScore,
      weight: dimension.weight,
      reason,
      evidence,
      ...(requiresTeacherReview ? { requiresTeacherReview: true } : {}),
    }
  })
  const dimensionScores = dimensionScoreCandidates as AiGradingResultV1['dimensionScores']
  const roundedTotalScore = calculateTotalScore(dimensionScores.map(({ score }) => score), request.task.fullScore)
  const publicLegibilityDimension = dimensionScores.find(({ dimensionId }) => dimensionId === 'legibility')
  const totalScore = publicLegibilityDimension
    ? capTotalScoreForVisibleLegibilityDeduction(
      roundedTotalScore,
      request.task.fullScore,
      publicLegibilityDimension.score,
      publicLegibilityDimension.maxScore,
      safeLegibilityIssues.length > 0,
    )
    : roundedTotalScore
  const rawReportedTotalScore = typeof payload.reportedTotalScore === 'number' && Number.isFinite(payload.reportedTotalScore)
    ? payload.reportedTotalScore
    : undefined
  if (rawReportedTotalScore === undefined) auxiliaryInputDegraded = true
  const policyInput: ResultPolicyInput = { issues: policyIssues, sentenceRevisions: policyRevisions, sentencePairs: policyPairs, expressionUpgrades: upgrades, logicIssues: policyLogicIssues, legibilityIssues: safeLegibilityIssues, dimensionScores: rawDimensionScores, recognitionWarnings, overallComment, logicNotes: policyLogicNoteRecords.map(({ note }) => note), logicNoteRecords: policyLogicNoteRecords }
  let policy = applyResultPolicy(policyInput, transcript)
  let oversizedRebuiltTextOmitted = false
  if (policy && (policy.correctedText.length > LIMITS.publicText || policy.improvedText.length > LIMITS.publicText)) {
    policy = { ...policy, sentencePairs: [], correctedText: transcript, improvedText: transcript }
    oversizedRebuiltTextOmitted = true
  }
  const auxiliaryFeedbackOmitted = policy === null
    || safeLegibilityIssues.length !== legibilityIssues.length
    || reviewableUngroundedIssueOmitted
    || omittedUngroundedLogicIssues
    || reviewableRelatedAuxiliaryOmitted
    || oversizedRebuiltTextOmitted
    || auxiliaryInputDegraded
  if (!policy) {
    policy = {
      ...policyInput,
      issues: [], sentenceRevisions: [], sentencePairs: [], expressionUpgrades: [], logicIssues: [],
      logicNotes: [], logicNoteRecords: [],
      overallComment: '已完成评分，部分辅助反馈需教师复核。',
      correctedText: transcript,
      improvedText: transcript,
      reviewReasons: [],
    } satisfies ResultPolicyOutcome
  }
  const rawRoundedScores = request.task.rubric.dimensions.map((dimension) => roundScore2(Number(rawScores.get(dimension.id)?.score)))
  const rawRecomputedTotal = calculateTotalScore(rawRoundedScores, request.task.fullScore)
  const reportedTotalScore = conservativePolicyScoreAdjusted && rawReportedTotalScore === rawRecomputedTotal
    ? totalScore
    : rawReportedTotalScore
  const normalized = normalizeGradingResultFromPolicyOutcome({ request, context: { provider: context.provider, createdAt: context.createdAt }, policy, dimensionScores, totalScore, reportedTotalScore, reviewReasons: [] })
  if (!normalized) return invalid('result_projection')
  const modelSelfConfidence = typeof payload.modelSelfConfidence === 'number'
    && Number.isFinite(payload.modelSelfConfidence)
    && payload.modelSelfConfidence >= 0
    && payload.modelSelfConfidence <= 1
    ? payload.modelSelfConfidence
    : undefined
  const reviewReasons = new Set(normalized.reviewReasons)
  if (omittedUngroundedLogicNotes) reviewReasons.add(GRADING_REVIEW_REASONS.logicNoteGroundingOmitted)
  if (reviewableUngroundedExpressionUpgradeOmitted) reviewReasons.add(GRADING_REVIEW_REASONS.expressionUpgradeGroundingOmitted)
  if (parsedUpgrades.omittedMalformed) reviewReasons.add(GRADING_REVIEW_REASONS.expressionUpgradeInvalidOmitted)
  if (dimensionRelationAdjusted) reviewReasons.add(GRADING_REVIEW_REASONS.dimensionRelationAdjusted)
  if (dimensionEvidenceRegrounded) reviewReasons.add(GRADING_REVIEW_REASONS.dimensionEvidenceRegrounded)
  if (dimensionDeductionNeedsReview) reviewReasons.add(GRADING_REVIEW_REASONS.dimensionDeductionNeedsReview)
  if (auxiliaryFeedbackOmitted) reviewReasons.add(GRADING_REVIEW_REASONS.auxiliaryFeedbackOmitted)
  if (recognitionWarnings.length) reviewReasons.add(GRADING_REVIEW_REASONS.recognitionUncertain)
  if (!printedTextExcluded) reviewReasons.add(GRADING_REVIEW_REASONS.printedTextExclusionUncertain)
  const normalizedLegibilityIssues: LegibilityIssueV1[] = safeLegibilityIssues.map(({ transcriptText, possibleReadings, pageNumber, regionDescription, explanation, defaultOutcome }, index) => ({
    id: `${context.essayId}-legibility-${index + 1}`, transcriptText, possibleReadings, pageNumber, regionDescription, explanation, defaultOutcome,
  }))
  return { ok: true, result: { ...normalized, ...(modelSelfConfidence === undefined ? {} : { modelSelfConfidence }), status: reviewReasons.size ? 'partial' : 'success', legibilityIssues: normalizedLegibilityIssues, reviewReasons: [...reviewReasons], transcript, recognitionWarnings: recognitionWarnings.map(({ message }) => message), printedTextExcluded } }
}
