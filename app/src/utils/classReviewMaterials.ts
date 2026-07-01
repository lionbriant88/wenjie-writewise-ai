import type {
  ClassReviewMaterial,
  ClassReviewMaterialInput,
  ClassReviewMaterialType,
} from '../types'
import type { ReviewIssueCardItem } from './reviewIssueItems'

export type ClassReviewMaterialTab = 'all' | 'typical_error' | 'logic_issue' | 'expression_upgrade'

export interface ClassReviewMaterialTabItem {
  id: ClassReviewMaterialTab
  label: string
}

interface BuildMaterialFromIssueInput {
  taskId: string
  essayId: string
  essayLabel: string
  issue: ReviewIssueCardItem
}

const tabLabels: Record<ClassReviewMaterialTab, string> = {
  all: '全部',
  typical_error: '典型错误',
  logic_issue: '逻辑问题',
  expression_upgrade: '表达提升',
}

export const classReviewMaterialTypeLabel: Record<ClassReviewMaterialType, string> = {
  typical_error: '典型错误',
  logic_issue: '逻辑问题',
  expression_upgrade: '表达提升',
  excellent_expression: '优秀表达',
  teacher_note: '教师备注',
}

export function getClassReviewMaterialKey(material: ClassReviewMaterialInput | ClassReviewMaterial): string {
  if (material.sourceIssueId) {
    return `${material.taskId}::${material.essayId}::${material.sourceIssueId}`
  }

  return `${material.taskId}::${material.essayId}::${material.type}::${material.original}`
}

export function buildClassReviewMaterialFromIssue({
  taskId,
  essayId,
  essayLabel,
  issue,
}: BuildMaterialFromIssueInput): ClassReviewMaterialInput {
  if (issue.source === 'logic') {
    const teachingSuggestion = [issue.suggestedActionLabel, issue.conservativeSuggestion].filter(Boolean).join('：')

    return {
      taskId,
      essayId,
      essayLabel,
      type: 'logic_issue',
      categoryLabel: issue.typeLabel,
      original: issue.original,
      diagnosis: issue.diagnosis,
      teachingSuggestion,
      severity: issue.severity,
      needsTeacherReview: issue.needsTeacherReview,
      sourceIssueId: issue.id,
    }
  }

  return {
    taskId,
    essayId,
    essayLabel,
    type: 'typical_error',
    categoryLabel: issue.typeLabel,
    original: issue.original,
    revised: issue.suggestion,
    explanation: issue.explanation,
    severity: issue.severity,
    sourceIssueId: issue.id,
  }
}

export function filterClassReviewMaterials(
  materials: ClassReviewMaterial[],
  tab: ClassReviewMaterialTab,
): ClassReviewMaterial[] {
  if (tab === 'all') {
    return materials
  }

  return materials.filter((material) => material.type === tab)
}

export function getVisibleClassReviewMaterialTabs(materials: ClassReviewMaterial[]): ClassReviewMaterialTabItem[] {
  const tabs: ClassReviewMaterialTabItem[] = [
    { id: 'all', label: tabLabels.all },
    { id: 'typical_error', label: tabLabels.typical_error },
    { id: 'logic_issue', label: tabLabels.logic_issue },
  ]

  if (materials.some((material) => material.type === 'expression_upgrade')) {
    tabs.push({ id: 'expression_upgrade', label: tabLabels.expression_upgrade })
  }

  return tabs
}
