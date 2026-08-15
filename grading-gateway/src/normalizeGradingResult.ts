import {
  calculateDimensionMaxScore,
  calculateTotalScore,
  roundScore2,
} from '../../app/src/services/grading/scoringRules.js'
import { applyResultPolicy } from './multimodal/resultPolicy.js'
import type { ResultPolicyInput, ResultPolicyOutcome } from './multimodal/resultPolicy.js'
import type {
  AiGradingResultV1,
  GradingChangeType,
  GradingProviderName,
  GradingRequestV1,
  RawLogicIssueV1,
  RawMultimodalIssueV1,
  RawSentencePairV1,
  RawSentenceRevisionV1,
} from './types.js'

export type NormalizationResult =
  | { ok: true; result: AiGradingResultV1 }
  | {
      ok: false
      error: {
        code: 'provider_invalid_response'
        message: 'AI 批改结果无法安全使用，请重试或使用 mock 回退。'
        retryable: true
      }
    }

interface NormalizationContext {
  provider: GradingProviderName
  createdAt: string
}

const issueTypes = new Set(['grammar', 'spelling', 'word_choice', 'structure'])
const severities = new Set(['low', 'medium', 'high'])
const evidenceCertainties = new Set(['certain', 'uncertain'])
const logicSubTypes = new Set(['weak_connection', 'unclear_logic', 'missing_cause_effect', 'unclear_transition', 'topic_drift', 'irrelevant_sentence', 'unclear_reference', 'missing_motivation', 'plot_gap'])
const logicSuggestedActions = new Set(['add_connector', 'add_bridge_sentence', 'delete_sentence', 'replace_sentence', 'clarify_reference', 'ask_student_to_explain'])
const changeTypes = new Set<GradingChangeType>([
  'grammar', 'spelling', 'word_choice', 'sentence_upgrade', 'coherence', 'logic_bridge',
  'delete_suggestion', 'replace_sentence', 'reference_clarification',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function requiredStringArray(value: unknown) {
  if (!Array.isArray(value)) return null
  const projected = value.map(text)
  return projected.every((item): item is string => item !== null) ? projected : null
}
function quote(value: unknown) { return typeof value === 'string' && value.length > 0 && value.length <= 10_000 ? value : null }

function uniqueQuoteIndex(transcript: string, quote: string): number | null { const start = transcript.indexOf(quote); return start >= 0 && transcript.indexOf(quote, start + 1) < 0 ? start : null }

function parsePolicyInput(payload: Record<string, unknown>, transcript: string): ResultPolicyInput | null {
  if (!Array.isArray(payload.issues) || !Array.isArray(payload.sentenceRevisions) || !Array.isArray(payload.legibilityIssues) || payload.legibilityIssues.length !== 0 || !isRecord(payload.fullTextRevision) || !Array.isArray(payload.fullTextRevision.sentencePairs) || !Array.isArray(payload.fullTextRevision.logicNotes) || !Array.isArray(payload.fullTextRevision.logicIssues)) return null
  const overallComment = text(payload.overallComment)
  if (!overallComment || !text(payload.fullTextRevision.correctedText) || !text(payload.fullTextRevision.improvedText)) return null
  const issues: RawMultimodalIssueV1[] = []
  for (const value of payload.issues) {
    if (!isRecord(value)) return null
    const issueKey = text(value.issueKey), type = text(value.type), severity = text(value.severity), originalText = quote(value.originalText), suggestion = text(value.suggestion), explanation = text(value.explanation), evidenceCertainty = text(value.evidenceCertainty)
    if (!issueKey || !type || !issueTypes.has(type) || !severity || !severities.has(severity) || !originalText || !suggestion || !explanation || !evidenceCertainty || !evidenceCertainties.has(evidenceCertainty) || typeof value.requiresTeacherReview !== 'boolean') return null
    issues.push({ issueKey, type: type as RawMultimodalIssueV1['type'], severity: severity as RawMultimodalIssueV1['severity'], originalText, suggestion, explanation, evidenceCertainty: evidenceCertainty as RawMultimodalIssueV1['evidenceCertainty'], requiresTeacherReview: value.requiresTeacherReview })
  }
  const parseLinks = (value: Record<string, unknown>) => { const relatedIssueKeys = Array.isArray(value.relatedIssueKeys) ? value.relatedIssueKeys : null; const changes = Array.isArray(value.changeTypes) ? value.changeTypes : null; return relatedIssueKeys && relatedIssueKeys.length > 0 && relatedIssueKeys.every((key) => typeof key === 'string' && key.trim()) && changes && changes.length > 0 && changes.every((change) => typeof change === 'string' && changeTypes.has(change as GradingChangeType)) && new Set(relatedIssueKeys).size === relatedIssueKeys.length ? { relatedIssueKeys: relatedIssueKeys as string[], changeTypes: changes as GradingChangeType[] } : null }
  const sentenceRevisions: RawSentenceRevisionV1[] = []
  for (const value of payload.sentenceRevisions) { if (!isRecord(value)) return null; const originalText = quote(value.originalText), revisedText = text(value.revisedText), note = text(value.note), links = parseLinks(value); if (!originalText || !revisedText || !note || !links) return null; sentenceRevisions.push({ originalText, revisedText, note, ...links }) }
  const sentencePairs: RawSentencePairV1[] = []
  for (const value of payload.fullTextRevision.sentencePairs) { if (!isRecord(value)) return null; const originalText = quote(value.originalText), correctedText = text(value.correctedText), improvedText = text(value.improvedText), explanation = text(value.explanation), links = parseLinks(value); if (!originalText || !correctedText || !improvedText || !explanation || !links || typeof value.requiresTeacherReview !== 'boolean') return null; sentencePairs.push({ originalText, correctedText, improvedText, explanation, requiresTeacherReview: value.requiresTeacherReview, ...links }) }
  const logicNotes: string[] = []; const logicNoteRecords: Array<{ quote: string; note: string }> = []
  for (const value of payload.fullTextRevision.logicNotes) { if (!isRecord(value)) return null; const rawQuote = quote(value.quote), note = text(value.note); if (!rawQuote || !note) return null; logicNotes.push(note); logicNoteRecords.push({ quote: rawQuote, note }) }
  const logicIssues: RawLogicIssueV1[] = []
  for (const value of payload.fullTextRevision.logicIssues) {
    if (!isRecord(value)) return null
    const issueKey = text(value.issueKey), originalText = quote(value.originalText), subType = text(value.subType), severity = text(value.severity), diagnosis = text(value.diagnosis), suggestedAction = text(value.suggestedAction), conservativeSuggestion = text(value.conservativeSuggestion), polishedSuggestion = text(value.polishedSuggestion)
    const originalStart = originalText ? uniqueQuoteIndex(transcript, originalText) : null, beforeStart = typeof value.contextBefore === 'string' && value.contextBefore ? uniqueQuoteIndex(transcript, value.contextBefore) : null, afterStart = typeof value.contextAfter === 'string' && value.contextAfter ? uniqueQuoteIndex(transcript, value.contextAfter) : null
    if (!issueKey || !originalText || originalStart === null || typeof value.contextBefore !== 'string' || typeof value.contextAfter !== 'string' || (value.contextBefore && (beforeStart === null || beforeStart + value.contextBefore.length > originalStart)) || (value.contextAfter && (afterStart === null || afterStart < originalStart + originalText.length)) || !subType || !logicSubTypes.has(subType) || !severity || !severities.has(severity) || !diagnosis || !suggestedAction || !logicSuggestedActions.has(suggestedAction) || !conservativeSuggestion || !polishedSuggestion || typeof value.requiresTeacherReview !== 'boolean') return null
    logicIssues.push({ issueKey, originalText, contextBefore: value.contextBefore, contextAfter: value.contextAfter, subType: subType as RawLogicIssueV1['subType'], severity: severity as RawLogicIssueV1['severity'], diagnosis, suggestedAction: suggestedAction as RawLogicIssueV1['suggestedAction'], conservativeSuggestion, polishedSuggestion, requiresTeacherReview: value.requiresTeacherReview })
  }
  return { issues, sentenceRevisions, sentencePairs, logicIssues, legibilityIssues: [], dimensionReasons: [], overallComment, logicNotes, logicNoteRecords }
}

function parseExpressionUpgrades(value: unknown, transcript: string): AiGradingResultV1['expressionUpgrades'] | null {
  if (!Array.isArray(value)) return null
  const result: AiGradingResultV1['expressionUpgrades'] = []
  for (const [index, item] of value.entries()) { if (!isRecord(item)) return null; const originalText = quote(item.originalText), upgradedText = text(item.upgradedText), note = text(item.note); if (!originalText || uniqueQuoteIndex(transcript, originalText) === null || !upgradedText || !note) return null; result.push({ id: `${index + 1}`, originalText, upgradedText, note }) }
  return result
}

export function normalizeGradingResultFromPolicyOutcome(input: { request: GradingRequestV1; context: NormalizationContext; policy: ResultPolicyOutcome; dimensionScores: AiGradingResultV1['dimensionScores']; totalScore: number; expressionUpgrades: AiGradingResultV1['expressionUpgrades']; improvedText: string; reviewReasons: string[] }): AiGradingResultV1 {
  const { request, context, policy, dimensionScores, totalScore, improvedText } = input
  const issueIdByKey = new Map(policy.issues.map((issue, index) => [issue.issueKey, `${request.essay.essayId}-issue-${index + 1}`]))
  const issues: AiGradingResultV1['issues'] = policy.issues.map((issue) => ({ id: issueIdByKey.get(issue.issueKey)!, type: issue.type, severity: issue.severity, originalText: issue.originalText, suggestion: issue.suggestion, explanation: issue.explanation, evidenceCertainty: issue.evidenceCertainty, requiresTeacherReview: issue.requiresTeacherReview }))
  const sentenceRevisions: AiGradingResultV1['sentenceRevisions'] = policy.sentenceRevisions.map((revision, index) => ({ id: `${request.essay.essayId}-revision-${index + 1}`, relatedIssueIds: revision.relatedIssueKeys.map((key) => issueIdByKey.get(key)!), originalText: revision.originalText, revisedText: revision.revisedText, note: revision.note, changeTypes: revision.changeTypes }))
  const sentencePairs: NonNullable<AiGradingResultV1['fullTextRevision']>['sentencePairs'] = policy.sentencePairs.map((pair, index) => ({ id: `${request.essay.essayId}-pair-${index + 1}`, originalText: pair.originalText, correctedText: pair.correctedText, improvedText: pair.improvedText, relatedIssueIds: pair.relatedIssueKeys.map((key) => issueIdByKey.get(key)!), changeTypes: pair.changeTypes, explanation: pair.explanation, requiresTeacherReview: pair.requiresTeacherReview }))
  const logicIssues = policy.logicIssues.map((issue, index) => ({ id: `${request.essay.essayId}-logic-${index + 1}`, originalText: issue.originalText, contextBefore: issue.contextBefore, contextAfter: issue.contextAfter, subType: issue.subType, severity: issue.severity, diagnosis: issue.diagnosis, suggestedAction: issue.suggestedAction, conservativeSuggestion: issue.conservativeSuggestion, polishedSuggestion: issue.polishedSuggestion, requiresTeacherReview: issue.requiresTeacherReview }))
  return { resultVersion: 'grading-result-v1', requestId: request.requestId, essayId: request.essay.essayId, provider: context.provider, status: input.reviewReasons.length ? 'partial' : 'success', totalScore, maxScore: request.task.fullScore, dimensionScores, issues, sentenceRevisions, expressionUpgrades: input.expressionUpgrades.map((item) => ({ ...item, id: item.id.startsWith(`${request.essay.essayId}-`) ? item.id : `${request.essay.essayId}-upgrade-${item.id}` })), fullTextRevision: { originalText: request.essay.confirmedTranscript, correctedText: policy.correctedText, improvedText, sentencePairs, logicNotes: policy.logicNotes, logicIssues }, recognitionWarnings: [], legibilityIssues: [], overallComment: policy.overallComment, reviewReasons: [...input.reviewReasons], createdAt: context.createdAt }
}

function invalidResponse(): NormalizationResult {
  return {
    ok: false,
    error: {
      code: 'provider_invalid_response',
      message: 'AI 批改结果无法安全使用，请重试或使用 mock 回退。',
      retryable: true,
    },
  }
}

export function normalizeGradingResult(
  payload: unknown,
  request: GradingRequestV1,
  context: NormalizationContext,
): NormalizationResult {
  if (!isRecord(payload) || !Array.isArray(payload.dimensionScores)) return invalidResponse()
  const reviewReasons = new Set<string>()
  const candidateDimensions = new Map<string, { score: number; reason: string; evidence: string }>()
  for (const item of payload.dimensionScores) {
    if (!isRecord(item)) return invalidResponse()
    const dimensionId = text(item.dimensionId)
    const reason = text(item.reason)
    const evidence = text(item.evidence)
    if (!dimensionId || !reason || !evidence || typeof item.score !== 'number' || !Number.isFinite(item.score)) {
      return invalidResponse()
    }
    if (candidateDimensions.has(dimensionId)) return invalidResponse()
    candidateDimensions.set(dimensionId, { score: item.score, reason, evidence })
  }

  const rubricIds = new Set(request.task.rubric.dimensions.map(({ id }) => id))
  if (candidateDimensions.size !== rubricIds.size || [...candidateDimensions.keys()].some((id) => !rubricIds.has(id))) {
    return invalidResponse()
  }

  const dimensionScores: AiGradingResultV1['dimensionScores'] = []
  for (const dimension of request.task.rubric.dimensions) {
    const candidate = candidateDimensions.get(dimension.id)
    if (!candidate) return invalidResponse()
    const maxScore = calculateDimensionMaxScore(request.task.fullScore, dimension.weight)
    const score = roundScore2(candidate.score)
    if (!Number.isFinite(score) || score < 0 || score > maxScore) return invalidResponse()
    dimensionScores.push({
      dimensionId: dimension.id,
      name: dimension.name,
      score,
      maxScore,
      weight: dimension.weight,
      reason: candidate.reason,
      evidence: candidate.evidence,
    })
  }

  const totalScore = calculateTotalScore(dimensionScores.map(({ score }) => score), request.task.fullScore)
  if ('reportedTotalScore' in payload) {
    if (typeof payload.reportedTotalScore !== 'number' || !Number.isFinite(payload.reportedTotalScore)) return invalidResponse()
    if (payload.reportedTotalScore !== totalScore) reviewReasons.add('AI 自报总分与产品重算总分不一致。')
  }

  const providerReviewReasons = requiredStringArray(payload.reviewReasons)
  const recognitionWarnings = requiredStringArray(payload.recognitionWarnings)
  if (providerReviewReasons === null || recognitionWarnings === null || recognitionWarnings.length !== 0) return invalidResponse()
  const rawPolicy = parsePolicyInput(payload, request.essay.confirmedTranscript)
  const expressionUpgrades = parseExpressionUpgrades(payload.expressionUpgrades, request.essay.confirmedTranscript)
  if (!rawPolicy || !expressionUpgrades) return invalidResponse()
  rawPolicy.dimensionReasons = dimensionScores.map(({ reason }) => reason)
  const policy = applyResultPolicy(rawPolicy, request.essay.confirmedTranscript)
  if (!policy) return invalidResponse()
  const providerImproved = isRecord(payload.fullTextRevision) ? text(payload.fullTextRevision.improvedText) : null
  if (!providerImproved) return invalidResponse()
  const result = normalizeGradingResultFromPolicyOutcome({ request, context, policy, dimensionScores, totalScore, expressionUpgrades, improvedText: providerImproved, reviewReasons: [...reviewReasons] })
  if (typeof payload.modelSelfConfidence === 'number' && Number.isFinite(payload.modelSelfConfidence) && payload.modelSelfConfidence >= 0 && payload.modelSelfConfidence <= 1) result.modelSelfConfidence = payload.modelSelfConfidence
  return { ok: true, result }

  /* Legacy projection retained only as migration reference; generic results return above from the shared policy output.
  const rawIssues = payload.issues
  if (!Array.isArray(rawIssues)) return invalidResponse()
  const issues: AiGradingResultV1['issues'] = []
  const policyIssues: RawMultimodalIssueV1[] = []
  const policyRevisions: RawSentenceRevisionV1[] = []
  const policyPairs: RawSentencePairV1[] = []
  const policyLogicIssues: RawLogicIssueV1[] = []
  const issueIdByKey = new Map<string, string>()
  const filteredSpellingKeys = new Set<string>()
  rawIssues.forEach((item, index) => {
    if (!isRecord(item)) {
      reviewReasons.add('部分问题项结构无效，已移除。')
      return
    }
    const type = text(item.type)
    const severity = text(item.severity)
    const originalText = text(item.originalText)
    const suggestion = text(item.suggestion)
    const explanation = text(item.explanation)
    const issueKey = text(item.issueKey)
    const evidenceCertainty = text(item.evidenceCertainty)
    const requiresTeacherReview = item.requiresTeacherReview
    if (
      !type || !issueTypes.has(type) || !severity || !severities.has(severity)
      || !issueKey || issueIdByKey.has(issueKey) || !originalText || !suggestion || !explanation || !evidenceCertainty || !evidenceCertainties.has(evidenceCertainty) || typeof requiresTeacherReview !== 'boolean'
    ) {
      reviewReasons.add('部分问题项结构无效，已移除。')
      return
    }
    const matched = matchTranscriptQuote(request.essay.confirmedTranscript, originalText)
    if (!matched) {
      reviewReasons.add('部分问题原句无法在确认文本中定位，已移除。')
      return
    }
    policyIssues.push({ issueKey, type: type as RawMultimodalIssueV1['type'], severity: severity as RawMultimodalIssueV1['severity'], originalText: matched, suggestion, explanation, evidenceCertainty: evidenceCertainty as RawMultimodalIssueV1['evidenceCertainty'], requiresTeacherReview })
    if (type === 'spelling' && (evidenceCertainty !== 'certain' || requiresTeacherReview)) {
      filteredSpellingKeys.add(issueKey)
      return
    }
    const id = `${request.essay.essayId}-issue-${index + 1}`
    issueIdByKey.set(issueKey, id)
    issues.push({
      id,
      type: type as AiGradingResultV1['issues'][number]['type'],
      severity: severity as AiGradingResultV1['issues'][number]['severity'],
      originalText: matched,
      suggestion,
      explanation,
      evidenceCertainty: evidenceCertainty as AiGradingResultV1['issues'][number]['evidenceCertainty'],
      requiresTeacherReview,
    })
  })

  const rawRevisions = payload.sentenceRevisions
  if (!Array.isArray(rawRevisions)) return invalidResponse()
  if (rawRevisions.some((item) => !isRecord(item) || !Array.isArray(item.changeTypes) || item.changeTypes.length === 0)) return invalidResponse()
  const sentenceRevisions: AiGradingResultV1['sentenceRevisions'] = []
  rawRevisions.forEach((item, index) => {
    if (!isRecord(item)) {
      reviewReasons.add('部分句子修改结构无效，已移除。')
      return
    }
    const originalText = text(item.originalText)
    const revisedText = text(item.revisedText)
    const note = text(item.note)
    const relatedIssueKeys = Array.isArray(item.relatedIssueKeys) ? item.relatedIssueKeys : null
    const rawChangeTypes = Array.isArray(item.changeTypes) ? item.changeTypes : null
    if (relatedIssueKeys?.length && relatedIssueKeys.every((key) => typeof key === 'string' && filteredSpellingKeys.has(key))) return
    const relatedIssueIds = relatedIssueKeys?.every((key) => typeof key === 'string' && issueIdByKey.has(key)) && new Set(relatedIssueKeys).size === relatedIssueKeys.length
      ? relatedIssueKeys.map((key) => issueIdByKey.get(key)!)
      : null
    const projectedChangeTypes = rawChangeTypes?.every((entry) => typeof entry === 'string' && changeTypes.has(entry as GradingChangeType))
      ? rawChangeTypes as GradingChangeType[]
      : null
    const matched = originalText ? matchTranscriptQuote(request.essay.confirmedTranscript, originalText) : null
    if (!matched || !revisedText || !note || !relatedIssueIds?.length || !projectedChangeTypes?.length) {
      reviewReasons.add('部分句子修改缺少有效原句或修改稿，已移除。')
      return
    }
    sentenceRevisions.push({
      id: `${request.essay.essayId}-revision-${index + 1}`,
      relatedIssueIds,
      originalText: matched,
      revisedText,
      note,
      changeTypes: projectedChangeTypes,
    })
    policyRevisions.push({ originalText: matched, revisedText, note, relatedIssueKeys: [...relatedIssueKeys!], changeTypes: [...projectedChangeTypes] })
  })

  const rawUpgrades = payload.expressionUpgrades
  if (!Array.isArray(rawUpgrades)) return invalidResponse()
  const expressionUpgrades: AiGradingResultV1['expressionUpgrades'] = []
  rawUpgrades.forEach((item, index) => {
    if (!isRecord(item)) {
      reviewReasons.add('部分表达升级结构无效，已移除。')
      return
    }
    const originalText = text(item.originalText)
    const upgradedText = text(item.upgradedText)
    const note = text(item.note)
    const matched = originalText ? matchTranscriptQuote(request.essay.confirmedTranscript, originalText) : null
    if (!matched || !upgradedText || !note) {
      reviewReasons.add('部分表达升级无法安全定位，已移除。')
      return
    }
    expressionUpgrades.push({
      id: `${request.essay.essayId}-upgrade-${index + 1}`,
      originalText: matched,
      upgradedText,
      note,
    })
  })

  let fullTextRevision: AiGradingResultV1['fullTextRevision']
  if (isRecord(payload.fullTextRevision)) {
    const providedCorrected = text(payload.fullTextRevision.correctedText)
    if (!providedCorrected) {
      reviewReasons.add('全文纠错稿缺失。')
    } else {
      const candidateImproved = text(payload.fullTextRevision.improvedText)
      if (!candidateImproved) return invalidResponse()
      const improvedText = candidateImproved
      const rawPairs = payload.fullTextRevision.sentencePairs
      const rawLogicNotes = logicNotesOrEmpty(payload.fullTextRevision.logicNotes)
      if (!improvedText || !Array.isArray(rawPairs) || rawLogicNotes === null) return invalidResponse()
      if (rawPairs.some((item) => !isRecord(item) || !Array.isArray(item.changeTypes) || item.changeTypes.length === 0)) return invalidResponse()
      const sentencePairs: NonNullable<AiGradingResultV1['fullTextRevision']>['sentencePairs'] = []
      rawPairs.forEach((item, index) => {
        if (!isRecord(item)) {
          reviewReasons.add('部分全文对照项结构无效，已移除。')
          return
        }
        const originalText = text(item.originalText)
        const pairCorrected = text(item.correctedText)
        const pairImproved = text(item.improvedText)
        const explanation = text(item.explanation)
        const requiresTeacherReview = item.requiresTeacherReview
        const matched = originalText ? matchTranscriptQuote(request.essay.confirmedTranscript, originalText) : null
        const rawChangeTypes = Array.isArray(item.changeTypes) ? item.changeTypes : null
        const relatedIssueKeys = Array.isArray(item.relatedIssueKeys) ? item.relatedIssueKeys : null
        if (relatedIssueKeys?.length && relatedIssueKeys.every((key) => typeof key === 'string' && filteredSpellingKeys.has(key))) return
        const relatedIssueIds = relatedIssueKeys?.every((key) => typeof key === 'string' && issueIdByKey.has(key)) && new Set(relatedIssueKeys).size === relatedIssueKeys.length
          ? relatedIssueKeys.map((key) => issueIdByKey.get(key)!)
          : null
        const projectedChangeTypes = rawChangeTypes?.filter(
          (entry): entry is GradingChangeType => typeof entry === 'string' && changeTypes.has(entry as GradingChangeType),
        )
        if (
          !matched || !pairCorrected || !pairImproved || !explanation
          || typeof requiresTeacherReview !== 'boolean' || !rawChangeTypes || rawChangeTypes.length === 0
          || projectedChangeTypes?.length !== rawChangeTypes.length || !relatedIssueIds?.length
        ) {
          reviewReasons.add('部分全文对照项无法安全使用，已移除。')
          return
        }
        sentencePairs.push({
          id: `${request.essay.essayId}-pair-${index + 1}`,
          originalText: matched,
          correctedText: pairCorrected,
          improvedText: pairImproved,
          relatedIssueIds,
          changeTypes: projectedChangeTypes,
          explanation,
          requiresTeacherReview,
        })
        policyPairs.push({ originalText: matched, correctedText: pairCorrected, improvedText: pairImproved, relatedIssueKeys: [...relatedIssueKeys!], changeTypes: [...projectedChangeTypes], explanation, requiresTeacherReview })
      })
      const rawLogicIssues = Array.isArray(payload.fullTextRevision.logicIssues) ? payload.fullTextRevision.logicIssues : null
      if (!rawLogicIssues) return invalidResponse()
      const logicIssues = rawLogicIssues.map((item, index): NonNullable<AiGradingResultV1['fullTextRevision']>['logicIssues'][number] | null => {
        if (!isRecord(item)) return null
        const issueKey = text(item.issueKey), originalText = text(item.originalText), diagnosis = text(item.diagnosis), conservativeSuggestion = text(item.conservativeSuggestion), polishedSuggestion = text(item.polishedSuggestion), subType = text(item.subType), suggestedAction = text(item.suggestedAction)
        const originalStart = originalText ? uniqueQuoteIndex(request.essay.confirmedTranscript, originalText) : null
        const beforeStart = typeof item.contextBefore === 'string' && item.contextBefore ? uniqueQuoteIndex(request.essay.confirmedTranscript, item.contextBefore) : null
        const afterStart = typeof item.contextAfter === 'string' && item.contextAfter ? uniqueQuoteIndex(request.essay.confirmedTranscript, item.contextAfter) : null
        if (!issueKey || !originalText || originalStart === null || typeof item.contextBefore !== 'string' || typeof item.contextAfter !== 'string' || (item.contextBefore && (beforeStart === null || beforeStart + item.contextBefore.length > originalStart)) || (item.contextAfter && (afterStart === null || afterStart < originalStart + originalText.length)) || !subType || !logicSubTypes.has(subType) || !diagnosis || !suggestedAction || !logicSuggestedActions.has(suggestedAction) || !conservativeSuggestion || !polishedSuggestion || !severities.has(String(item.severity)) || typeof item.requiresTeacherReview !== 'boolean') return null
        policyLogicIssues.push({ issueKey, originalText, contextBefore: item.contextBefore, contextAfter: item.contextAfter, subType: subType as RawLogicIssueV1['subType'], severity: item.severity as RawLogicIssueV1['severity'], diagnosis, suggestedAction: suggestedAction as RawLogicIssueV1['suggestedAction'], conservativeSuggestion, polishedSuggestion, requiresTeacherReview: item.requiresTeacherReview })
        return { id: `${request.essay.essayId}-logic-${index + 1}`, originalText, contextBefore: item.contextBefore, contextAfter: item.contextAfter, subType: subType as NonNullable<AiGradingResultV1['fullTextRevision']>['logicIssues'][number]['subType'], severity: item.severity as 'low' | 'medium' | 'high', diagnosis, suggestedAction: suggestedAction as NonNullable<AiGradingResultV1['fullTextRevision']>['logicIssues'][number]['suggestedAction'], conservativeSuggestion, polishedSuggestion, requiresTeacherReview: item.requiresTeacherReview }
      })
      if (logicIssues.some((item) => item === null)) return invalidResponse()
      const resolvedLogicIssues = logicIssues as NonNullable<AiGradingResultV1['fullTextRevision']>['logicIssues']
      const correctedText = rebuildCorrectedText(request.essay.confirmedTranscript, sentencePairs.map(({ originalText, correctedText: pairCorrected }) => ({ originalText, correctedText: pairCorrected })))
      if (correctedText === null) return invalidResponse()
      fullTextRevision = {
        originalText: request.essay.confirmedTranscript,
        correctedText,
        improvedText,
        sentencePairs,
        logicNotes: rawLogicNotes.flatMap(({ quote, note }) => {
          if (matchTranscriptQuote(request.essay.confirmedTranscript, quote)) return [note]
          reviewReasons.add('部分逻辑诊断原文引文无法定位，已移除。')
          return []
        }),
        logicIssues: resolvedLogicIssues,
      }
    }
  } else {
    reviewReasons.add('全文修改稿缺失。')
  }

  let overallComment = text(payload.overallComment)
  if (!overallComment) {
    overallComment = 'AI 总评缺失，请教师补充。'
    reviewReasons.add('AI 总评缺失。')
  }
  const providerReviewReasons = requiredStringArray(payload.reviewReasons)
  if (providerReviewReasons === null) return invalidResponse()
  const recognitionWarnings = requiredStringArray(payload.recognitionWarnings)
  if (recognitionWarnings === null || recognitionWarnings.length > 0 || !Array.isArray(payload.legibilityIssues) || payload.legibilityIssues.length > 0) return invalidResponse()
  const policy = applyResultPolicy({ issues: policyIssues, sentenceRevisions: policyRevisions, sentencePairs: policyPairs, logicIssues: policyLogicIssues, legibilityIssues: [], dimensionReasons: dimensionScores.map(({ reason }) => reason), overallComment, logicNotes: fullTextRevision?.logicNotes ?? [], logicNoteRecords: [] }, request.essay.confirmedTranscript)
  if (!policy) return invalidResponse()
  providerReviewReasons.forEach((reason) => reviewReasons.add(reason))

  const confidence = typeof payload.modelSelfConfidence === 'number'
    && Number.isFinite(payload.modelSelfConfidence)
    && payload.modelSelfConfidence >= 0
    && payload.modelSelfConfidence <= 1
    ? payload.modelSelfConfidence
    : undefined
  const normalizedReviewReasons = [...reviewReasons]
  return {
    ok: true,
    result: {
      resultVersion: 'grading-result-v1',
      requestId: request.requestId,
      essayId: request.essay.essayId,
      provider: context.provider,
      status: normalizedReviewReasons.length > 0 ? 'partial' : 'success',
      totalScore,
      maxScore: request.task.fullScore,
      dimensionScores,
      issues,
      sentenceRevisions,
      expressionUpgrades,
      recognitionWarnings,
      ...(fullTextRevision ? { fullTextRevision } : {}),
      legibilityIssues: [],
      overallComment,
      ...(confidence === undefined ? {} : { modelSelfConfidence: confidence }),
      reviewReasons: normalizedReviewReasons,
      createdAt: context.createdAt,
    },
  }
*/
}
