import { describe, expect, it } from 'vitest'
import type { ErrorAnnotation, LegibilityIssue, LogicIssue, SentenceRevision } from '../types'
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
      evidenceCertainty: 'certain',
    },
  ]

  const revisions: SentenceRevision[] = [
    {
      id: 'rev-1',
      relatedErrorIds: ['err-1'],
      original: 'I suggest you joins the club.',
      revised: 'I suggest you join the club.',
      note: '修正 suggest 句型。',
      changeTypes: ['grammar'],
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

  const legibilityIssues: LegibilityIssue[] = [{
    id: 'legibility-1',
    transcriptText: 'cant',
    possibleReadings: ['cant', "can't"],
    pageNumber: 1,
    regionDescription: 'Synthetic final line.',
    explanation: 'The handwriting does not establish the intended word.',
    defaultOutcome: 'count_as_legibility_error',
  }]

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

  it('orders language and logic before legibility, then certain spelling', () => {
    const items = buildReviewIssueItems({
      annotations: [
        ...annotations,
        {
          id: 'spell-1', type: 'spelling', original: 'enviroment', suggestion: 'environment',
          explanation: 'Synthetic spelling correction.', severity: 'medium', evidenceCertainty: 'certain',
        },
        {
          id: 'spell-uncertain', type: 'spelling', original: 'cant', suggestion: "can't",
          explanation: 'Synthetic uncertain spelling.', severity: 'medium', evidenceCertainty: 'uncertain',
        },
      ],
      revisions,
      logicIssues,
      legibilityIssues,
    })

    expect(items.map(({ id }) => id)).toEqual(['err-1', 'logic-1', 'legibility-1', 'spell-1'])
    expect(items[2]).toMatchObject({
      source: 'legibility',
      categoryLabel: '卷面与可读性',
      title: '字迹不清导致语义无法确认',
      original: 'cant',
      diagnosis: 'The handwriting does not establish the intended word.',
      suggestion: "系统默认按错误处理；可能读法：cant / can't",
      severity: 'medium',
    })
  })
})
