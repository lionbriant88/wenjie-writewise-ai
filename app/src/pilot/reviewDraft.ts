import type {
  Command,
  TeacherReviewInput,
} from '../../../shared/pilotContracts'
import type { GradingResult } from '../types'
export interface ReviewDraft {
  essayId: string
  revision: number
  result: GradingResult
  dirty: boolean
  saveId: string
  confirmId: string
}
export function createReviewDraft(
  essayId: string,
  revision: number,
  result: GradingResult,
): ReviewDraft {
  return {
    essayId,
    revision,
    result: structuredClone(result),
    dirty: false,
    saveId: crypto.randomUUID(),
    confirmId: crypto.randomUUID(),
  }
}
export function changeReviewDraft(
  draft: ReviewDraft,
  patch: Partial<GradingResult>,
): ReviewDraft {
  return {
    ...draft,
    result: { ...draft.result, ...patch },
    dirty: true,
    saveId: crypto.randomUUID(),
    confirmId: crypto.randomUUID(),
  }
}
export function reviewCommand(
  draft: ReviewDraft,
  confirm: boolean,
): Command<TeacherReviewInput> {
  return {
    commandId: confirm ? draft.confirmId : draft.saveId,
    expectedRevision: draft.revision,
    value: {
      dimensionScores: draft.result.dimensionScores.map((d) => ({
        dimensionId: d.id,
        score: d.score,
      })),
      overallComment: draft.result.overallComment,
      teacherSuggestion: draft.result.teacherSuggestion ?? '',
      confirm,
    },
  }
}
