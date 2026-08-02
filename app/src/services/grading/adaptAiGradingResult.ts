import type { GradingResult } from '../../types'
import type { AiGradingResultV1, GradingRequestV1, MultimodalGradingRequestV2 } from './types'

export function adaptAiGradingResult(
  result: AiGradingResultV1,
  request: GradingRequestV1 | MultimodalGradingRequestV2,
): GradingResult {
  return {
    id: `${result.essayId}-result`,
    essayId: result.essayId,
    resultVersion: result.resultVersion,
    source: result.provider,
    reviewReasons: [...result.reviewReasons],
    totalScore: result.totalScore,
    dimensionScores: result.dimensionScores.map((dimension) => ({
      id: dimension.dimensionId,
      name: dimension.name,
      score: dimension.score,
      maxScore: dimension.maxScore,
      weight: dimension.weight,
      reason: dimension.reason,
      evidence: dimension.evidence,
    })),
    errorAnnotations: result.issues.map((issue) => ({
      id: issue.id,
      type: issue.type,
      original: issue.originalText,
      suggestion: issue.suggestion,
      explanation: issue.explanation,
      severity: issue.severity,
    })),
    sentenceRevisions: result.sentenceRevisions.map((revision) => ({
      id: revision.id,
      relatedErrorId: revision.relatedIssueId ?? '',
      original: revision.originalText,
      revised: revision.revisedText,
      note: revision.note,
    })),
    upgradedExpressions: result.expressionUpgrades.map((upgrade) => ({
      id: upgrade.id,
      original: upgrade.originalText,
      upgraded: upgrade.upgradedText,
      note: upgrade.note,
    })),
    fullTextRevision: result.fullTextRevision
      ? {
          originalText: result.transcript ?? ('essay' in request ? request.essay.confirmedTranscript : ''),
          correctedText: result.fullTextRevision.correctedText,
          polishedText: result.fullTextRevision.improvedText,
          sentencePairs: result.fullTextRevision.sentencePairs.map((pair) => ({
            id: pair.id,
            original: pair.originalText,
            corrected: pair.correctedText,
            polished: pair.improvedText,
            changeTypes: [...pair.changeTypes],
            explanation: pair.explanation,
            needsTeacherReview: pair.requiresTeacherReview,
          })),
          logicIssues: [],
          logicNotes: [...result.fullTextRevision.logicNotes],
        }
      : undefined,
    overallComment: result.overallComment,
    teacherAdjusted: false,
    createdAt: result.createdAt,
    updatedAt: result.createdAt,
  }
}
