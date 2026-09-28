import { expect, it } from 'vitest'
import {
  createReviewDraft,
  changeReviewDraft,
  reviewCommand,
} from './reviewDraft'
import type { GradingResult } from '../types'
const result: GradingResult = {
  id: 'result',
  essayId: 'essay',
  totalScore: 5,
  dimensionScores: [
    {
      id: 'content',
      name: 'Content',
      score: 5,
      maxScore: 15,
      weight: 100,
      reason: 'Synthetic',
      evidence: '',
    },
  ],
  errorAnnotations: [],
  sentenceRevisions: [],
  upgradedExpressions: [],
  overallComment: 'Original',
  recognitionWarnings: [],
  legibilityIssues: [],
  teacherAdjusted: false,
  createdAt: 'now',
  updatedAt: 'now',
}
it('keeps edits local and sends only editable fields against the captured revision', () => {
  const initial = createReviewDraft('essay', 7, result),
    edited = changeReviewDraft(initial, { overallComment: 'Teacher draft' })
  expect(initial.result.overallComment).toBe('Original')
  expect(edited.result.overallComment).toBe('Teacher draft')
  expect(edited.revision).toBe(7)
  const command = reviewCommand(edited, false)
  expect(command.expectedRevision).toBe(7)
  expect(Object.keys(command.value).sort()).toEqual([
    'confirm',
    'dimensionScores',
    'overallComment',
    'teacherSuggestion',
  ])
  expect(reviewCommand(edited, false)).toEqual(command)
  expect(reviewCommand(edited, true).commandId).not.toBe(command.commandId)
  expect(edited.dirty).toBe(true)
})
