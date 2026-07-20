import type { Essay, Task } from '../../types'
import { hasValidRubricWeights } from './scoringRules'
import type { GradingRequestV1 } from './types'

export type BuildGradingRequestResult =
  | { ok: true; request: GradingRequestV1 }
  | { ok: false; error: { code: 'invalid_request' | 'confirmed_transcript_required'; message: string } }

function invalid(message: string): BuildGradingRequestResult {
  return { ok: false, error: { code: 'invalid_request', message } }
}

export function buildGradingRequest(
  task: Task,
  essay: Essay,
  requestId: string,
  transcriptPolicy: 'confirmed_only' | 'allow_legacy_mock' = 'confirmed_only',
): BuildGradingRequestResult {
  const transcript = essay.ocrAudit?.confirmedTranscript.trim()
    || (transcriptPolicy === 'allow_legacy_mock' ? essay.ocrText.trim() : '')
  if (!transcript) {
    return {
      ok: false,
      error: { code: 'confirmed_transcript_required', message: '请先确认忠实 OCR 文本。' },
    }
  }

  if (
    !requestId.trim()
    || !task.writingGenre
    || !task.promptInfo
    || task.rubricDraft?.status !== 'confirmed'
    || !Number.isFinite(task.fullScore)
    || task.fullScore <= 0
    || !hasValidRubricWeights(task.rubricDraft.dimensions.map(({ weight }) => weight))
  ) {
    return invalid('题目信息或评分标准尚未确认。')
  }

  const prompt = task.writingGenre === 'practical_writing'
    ? {
        writingGenre: 'practical_writing' as const,
        taskRequirement: task.promptInfo.manualPromptText.trim(),
        practicalWritingType: task.promptInfo.practicalWritingType,
        teacherRequirements: task.promptInfo.teacherRequirements,
        deductionFocus: task.promptInfo.deductionFocus,
        excellentFocus: task.promptInfo.excellentFocus,
      }
    : task.promptInfo.continuationPrompt
      ? {
          writingGenre: 'continuation_writing' as const,
          sourceText: task.promptInfo.continuationPrompt.sourceText.trim(),
          paragraph1Opening: task.promptInfo.continuationPrompt.paragraph1Opening.trim(),
          paragraph2Opening: task.promptInfo.continuationPrompt.paragraph2Opening.trim(),
          teacherRequirements: task.promptInfo.teacherRequirements,
          deductionFocus: task.promptInfo.deductionFocus,
          excellentFocus: task.promptInfo.excellentFocus,
        }
      : null

  if (!prompt || (prompt.writingGenre === 'practical_writing' && !prompt.taskRequirement)) {
    return invalid('题目信息不完整。')
  }
  if (
    prompt.writingGenre === 'continuation_writing'
    && (!prompt.sourceText || !prompt.paragraph1Opening || !prompt.paragraph2Opening)
  ) {
    return invalid('读后续写题目信息不完整。')
  }

  return {
    ok: true,
    request: {
      requestVersion: 'grading-request-v1',
      requestId,
      task: {
        taskId: task.id,
        writingGenre: task.writingGenre,
        fullScore: task.fullScore,
        prompt,
        rubric: {
          status: 'confirmed',
          writingGoal: task.rubricDraft.writingGoal,
          offTopicCriteria: [...task.rubricDraft.offTopicCriteria],
          dimensions: task.rubricDraft.dimensions.map((dimension) => ({
            id: dimension.id,
            name: dimension.name,
            weight: dimension.weight,
            description: dimension.description,
            deductionFocus: [...dimension.deductionFocus],
          })),
          excellentFeatures: [...task.rubricDraft.excellentFeatures],
          reviewTriggers: [...task.rubricDraft.reviewTriggers],
          teacherEditableNotes: task.rubricDraft.teacherEditableNotes,
        },
      },
      essay: {
        essayId: essay.id,
        confirmedTranscript: transcript,
        ocrContext: essay.ocrAudit
          ? {
              sourceKind: essay.ocrAudit.sourceKind,
              hasKnownOcrRisk: essay.ocrAudit.shadowAssessment.outcome !== 'no_obvious_risk',
              riskCodes: essay.ocrAudit.shadowAssessment.reasons.map(({ code }) => code),
            }
          : { sourceKind: 'mock', hasKnownOcrRisk: false, riskCodes: [] },
      },
    },
  }
}
