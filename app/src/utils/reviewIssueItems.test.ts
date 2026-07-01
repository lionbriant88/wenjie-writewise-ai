import { describe, expect, it } from 'vitest'
import type { ErrorAnnotation, LogicIssue, SentenceRevision } from '../types'
import { buildReviewIssueItems } from './reviewIssueItems'

describe('buildReviewIssueItems', () => {
  const annotations: ErrorAnnotation[] = [
    {
      id: 'err-1',
      type: 'grammar',
      original: 'I suggest you joins the club.',
      suggestion: 'I suggest you join the club.',
      explanation: 'suggest 后使用动词原形。',
      severity: 'high',
    },
  ]

  const revisions: SentenceRevision[] = [
    {
      id: 'rev-1',
      relatedErrorId: 'err-1',
      original: 'I suggest you joins the club.',
      revised: 'I suggest you join the club.',
      note: '修正 suggest 句型。',
    },
  ]

  const logicIssues: LogicIssue[] = [
    {
      id: 'logic-1',
      original: 'My mother was angry.',
      subType: 'weak_connection',
      severity: 'high',
      diagnosis: '上下文关联度差：与前后文缺少明确关系。',
      suggestedAction: 'ask_student_to_explain',
      conservativeSuggestion: '建议学生补充原因，或由教师判断是否删除。',
      needsTeacherReview: true,
    },
  ]

  it('adapts language issues into display items', () => {
    const items = buildReviewIssueItems({ annotations, revisions, logicIssues: [] })

    expect(items).toEqual([
      expect.objectContaining({
        id: 'err-1',
        source: 'language',
        typeLabel: 'grammar',
        original: 'I suggest you joins the club.',
        suggestion: 'I suggest you join the club.',
        explanation: '修正 suggest 句型。',
      }),
    ])
  })

  it('adapts logic issues with teacher-review metadata', () => {
    const items = buildReviewIssueItems({ annotations: [], revisions: [], logicIssues })

    expect(items).toEqual([
      expect.objectContaining({
        id: 'logic-1',
        source: 'logic',
        typeLabel: '上下文关联度差',
        diagnosis: '上下文关联度差：与前后文缺少明确关系。',
        suggestedActionLabel: '建议学生补充说明',
        conservativeSuggestion: '建议学生补充原因，或由教师判断是否删除。',
        needsTeacherReview: true,
      }),
    ])
  })
})
