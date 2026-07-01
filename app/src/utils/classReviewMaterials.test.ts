import { describe, expect, it } from 'vitest'
import type { ClassReviewMaterial, ClassReviewMaterialInput } from '../types'
import type { ReviewIssueCardItem } from './reviewIssueItems'
import {
  buildClassReviewMaterialFromIssue,
  filterClassReviewMaterials,
  getClassReviewMaterialKey,
  getVisibleClassReviewMaterialTabs,
} from './classReviewMaterials'

const baseMaterial: ClassReviewMaterial = {
  id: 'material-1',
  taskId: 'task-1',
  essayId: 'essay-1',
  essayLabel: '作文 1',
  type: 'typical_error',
  categoryLabel: 'grammar',
  original: 'I suggest you joins the club.',
  revised: 'I suggest you join the club.',
  explanation: 'suggest 后使用动词原形。',
  severity: 'high',
  sourceIssueId: 'issue-1',
  createdAt: '2026-07-01T00:00:00.000Z',
}

describe('classReviewMaterials', () => {
  it('uses source issue id before the fallback material fields for dedupe keys', () => {
    const withIssueId: ClassReviewMaterialInput = {
      taskId: 'task-1',
      essayId: 'essay-1',
      essayLabel: '作文 1',
      type: 'typical_error',
      categoryLabel: 'grammar',
      original: 'Original A',
      sourceIssueId: 'issue-1',
    }
    const withoutIssueId: ClassReviewMaterialInput = {
      taskId: 'task-1',
      essayId: 'essay-1',
      essayLabel: '作文 1',
      type: 'logic_issue',
      categoryLabel: '上下文关联度差',
      original: 'Original B',
    }

    expect(getClassReviewMaterialKey(withIssueId)).toBe('task-1::essay-1::issue-1')
    expect(getClassReviewMaterialKey(withoutIssueId)).toBe('task-1::essay-1::logic_issue::Original B')
  })

  it('maps language issue cards into typical error materials', () => {
    const issue: ReviewIssueCardItem = {
      id: 'issue-1',
      source: 'language',
      typeLabel: 'grammar',
      severity: 'high',
      original: 'I suggest you joins the club.',
      suggestion: 'I suggest you join the club.',
      explanation: '修正 suggest 后的动词形式。',
    }

    expect(
      buildClassReviewMaterialFromIssue({
        taskId: 'task-1',
        essayId: 'essay-1',
        essayLabel: '作文 1',
        issue,
      }),
    ).toEqual({
      taskId: 'task-1',
      essayId: 'essay-1',
      essayLabel: '作文 1',
      type: 'typical_error',
      categoryLabel: 'grammar',
      original: 'I suggest you joins the club.',
      revised: 'I suggest you join the club.',
      explanation: '修正 suggest 后的动词形式。',
      severity: 'high',
      sourceIssueId: 'issue-1',
    })
  })

  it('maps logic issue cards into logic issue materials', () => {
    const issue: ReviewIssueCardItem = {
      id: 'logic-1',
      source: 'logic',
      typeLabel: '上下文关联度差',
      severity: 'high',
      original: 'My mother was angry.',
      diagnosis: '该句与上下文关联度差。',
      suggestedActionLabel: '建议学生补充说明',
      conservativeSuggestion: '建议学生补充这句话与阅读节的关系。',
      needsTeacherReview: true,
    }

    expect(
      buildClassReviewMaterialFromIssue({
        taskId: 'task-1',
        essayId: 'essay-3',
        essayLabel: '作文 3',
        issue,
      }),
    ).toEqual({
      taskId: 'task-1',
      essayId: 'essay-3',
      essayLabel: '作文 3',
      type: 'logic_issue',
      categoryLabel: '上下文关联度差',
      original: 'My mother was angry.',
      diagnosis: '该句与上下文关联度差。',
      teachingSuggestion: '建议学生补充说明：建议学生补充这句话与阅读节的关系。',
      severity: 'high',
      needsTeacherReview: true,
      sourceIssueId: 'logic-1',
    })
  })

  it('filters materials by tab and hides empty expression tabs', () => {
    const logicMaterial: ClassReviewMaterial = {
      ...baseMaterial,
      id: 'material-2',
      type: 'logic_issue',
      categoryLabel: '上下文关联度差',
      sourceIssueId: 'logic-1',
    }

    expect(filterClassReviewMaterials([baseMaterial, logicMaterial], 'all')).toHaveLength(2)
    expect(filterClassReviewMaterials([baseMaterial, logicMaterial], 'typical_error')).toEqual([baseMaterial])
    expect(filterClassReviewMaterials([baseMaterial, logicMaterial], 'logic_issue')).toEqual([logicMaterial])
    expect(getVisibleClassReviewMaterialTabs([baseMaterial, logicMaterial]).map((tab) => tab.id)).toEqual([
      'all',
      'typical_error',
      'logic_issue',
    ])
    expect(
      getVisibleClassReviewMaterialTabs([
        baseMaterial,
        {
          ...baseMaterial,
          id: 'material-3',
          type: 'expression_upgrade',
          categoryLabel: '表达提升',
          sourceIssueId: 'upgrade-1',
        },
      ]).map((tab) => tab.id),
    ).toContain('expression_upgrade')
  })
})
