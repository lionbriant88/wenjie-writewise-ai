import {
  calculateDimensionMaxScore,
  calculateTotalScore,
  roundScore2,
} from '../../app/src/services/grading/scoringRules.js'
import { matchTranscriptQuote } from './matchTranscriptQuote.js'
import type {
  AiGradingResultV1,
  GradingChangeType,
  GradingProviderName,
  GradingRequestV1,
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

function stringArrayOrEmpty(value: unknown) {
  if (value === undefined) return []
  if (!Array.isArray(value)) return null
  const projected = value.map(text)
  return projected.every((item): item is string => item !== null) ? projected : null
}

function logicNotesOrEmpty(value: unknown) {
  if (value === undefined) return []
  if (!Array.isArray(value)) return null
  const projected = value.map((item) => isRecord(item) ? { quote: text(item.quote), note: text(item.note) } : null)
  return projected.every((item): item is { quote: string; note: string } => item !== null) ? projected : null
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

  const rawIssues = payload.issues === undefined ? [] : payload.issues
  if (!Array.isArray(rawIssues)) return invalidResponse()
  const issues: AiGradingResultV1['issues'] = []
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
    const requiresTeacherReview = item.requiresTeacherReview === undefined ? false : item.requiresTeacherReview
    if (
      !type || !issueTypes.has(type) || !severity || !severities.has(severity)
      || !originalText || !suggestion || !explanation || typeof requiresTeacherReview !== 'boolean'
    ) {
      reviewReasons.add('部分问题项结构无效，已移除。')
      return
    }
    const matched = matchTranscriptQuote(request.essay.confirmedTranscript, originalText)
    if (!matched) {
      reviewReasons.add('部分问题原句无法在确认文本中定位，已移除。')
      return
    }
    issues.push({
      id: `${request.essay.essayId}-issue-${index + 1}`,
      type: type as AiGradingResultV1['issues'][number]['type'],
      severity: severity as AiGradingResultV1['issues'][number]['severity'],
      originalText: matched,
      suggestion,
      explanation,
      requiresTeacherReview,
    })
  })

  const rawRevisions = payload.sentenceRevisions === undefined ? [] : payload.sentenceRevisions
  if (!Array.isArray(rawRevisions)) return invalidResponse()
  const sentenceRevisions: AiGradingResultV1['sentenceRevisions'] = []
  rawRevisions.forEach((item, index) => {
    if (!isRecord(item)) {
      reviewReasons.add('部分句子修改结构无效，已移除。')
      return
    }
    const originalText = text(item.originalText)
    const revisedText = text(item.revisedText)
    const note = text(item.note)
    const matched = originalText ? matchTranscriptQuote(request.essay.confirmedTranscript, originalText) : null
    if (!matched || !revisedText || !note) {
      reviewReasons.add('部分句子修改缺少有效原句或修改稿，已移除。')
      return
    }
    const relatedIssue = issues.find((issue) => issue.originalText === matched)
    sentenceRevisions.push({
      id: `${request.essay.essayId}-revision-${index + 1}`,
      ...(relatedIssue ? { relatedIssueId: relatedIssue.id } : {}),
      originalText: matched,
      revisedText,
      note,
    })
  })

  const rawUpgrades = payload.expressionUpgrades === undefined ? [] : payload.expressionUpgrades
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
    const correctedText = text(payload.fullTextRevision.correctedText)
    if (!correctedText) {
      reviewReasons.add('全文纠错稿缺失。')
    } else {
      const candidateImproved = text(payload.fullTextRevision.improvedText)
      const improvedText = candidateImproved ?? correctedText
      if (!candidateImproved) reviewReasons.add('全文提升稿缺失，已使用纠错稿回退。')
      const rawPairs = payload.fullTextRevision.sentencePairs === undefined ? [] : payload.fullTextRevision.sentencePairs
      const rawLogicNotes = logicNotesOrEmpty(payload.fullTextRevision.logicNotes)
      if (!Array.isArray(rawPairs) || rawLogicNotes === null) return invalidResponse()
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
        const requiresTeacherReview = item.requiresTeacherReview === undefined ? false : item.requiresTeacherReview
        const matched = originalText ? matchTranscriptQuote(request.essay.confirmedTranscript, originalText) : null
        const rawChangeTypes = Array.isArray(item.changeTypes) ? item.changeTypes : null
        const projectedChangeTypes = rawChangeTypes?.filter(
          (entry): entry is GradingChangeType => typeof entry === 'string' && changeTypes.has(entry as GradingChangeType),
        )
        if (
          !matched || !pairCorrected || !pairImproved || !explanation
          || typeof requiresTeacherReview !== 'boolean' || !rawChangeTypes
          || projectedChangeTypes?.length !== rawChangeTypes.length
        ) {
          reviewReasons.add('部分全文对照项无法安全使用，已移除。')
          return
        }
        sentencePairs.push({
          id: `${request.essay.essayId}-pair-${index + 1}`,
          originalText: matched,
          correctedText: pairCorrected,
          improvedText: pairImproved,
          changeTypes: projectedChangeTypes,
          explanation,
          requiresTeacherReview,
        })
      })
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
        logicIssues: [],
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
  const providerReviewReasons = stringArrayOrEmpty(payload.reviewReasons)
  if (providerReviewReasons === null) return invalidResponse()
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
      ...(fullTextRevision ? { fullTextRevision } : {}),
      legibilityIssues: [],
      overallComment,
      ...(confidence === undefined ? {} : { modelSelfConfidence: confidence }),
      reviewReasons: normalizedReviewReasons,
      createdAt: context.createdAt,
    },
  }
}
