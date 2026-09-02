import type { AddClassReviewIssueInput } from '../context/appStateContextValue'
import type {
  ErrorAnnotation,
  LegibilityIssue,
  LogicIssue,
  LogicIssueSubType,
  LogicSuggestionAction,
  SentenceRevision,
} from '../types'

export interface ReviewIssueCardItem {
  id: string
  source: 'language' | 'logic' | 'legibility'
  typeLabel: string
  categoryLabel?: string
  title?: string
  severity: 'low' | 'medium' | 'high'
  original: string
  suggestion?: string
  explanation?: string
  diagnosis?: string
  suggestedActionLabel?: string
  conservativeSuggestion?: string
  needsTeacherReview?: boolean
  sourceLocator: string
  pageReference?: {
    kind: 'page-description'
    pageNumber: number
    regionDescription: string
  }
}

interface BuildReviewIssueItemsInput {
  annotations: ErrorAnnotation[]
  revisions: SentenceRevision[]
  logicIssues?: LogicIssue[]
  legibilityIssues?: LegibilityIssue[]
}

const logicSubtypeLabel: Record<LogicIssueSubType, string> = {
  weak_connection: '上下文关联度差',
  unclear_logic: '语句逻辑不清',
  missing_cause_effect: '因果关系缺失',
  unclear_transition: '转折关系不明确',
  topic_drift: '主题偏移',
  irrelevant_sentence: '无关句',
  unclear_reference: '指代不清',
  missing_motivation: '人物动机缺失',
  plot_gap: '情节衔接断裂',
}

const logicActionLabel: Record<LogicSuggestionAction, string> = {
  add_connector: '增加连接词',
  add_bridge_sentence: '补充过渡句',
  delete_sentence: '建议删除该句',
  replace_sentence: '建议替换该句',
  clarify_reference: '明确指代对象',
  ask_student_to_explain: '建议学生补充说明',
}

function opaqueSegment(value: string): string {
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, '-')
  const safe = normalized.replace(/[^A-Za-z0-9._~-]/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return safe.slice(0, 80) || 'unknown'
}

function sourceLocator(kind: 'language' | 'logic' | 'legibility', id: string): string {
  return `${kind}.${opaqueSegment(id)}`
}

function trimForClassReview(value: string | undefined, fallback: string, maxLength: number): string {
  const normalized = (value ?? fallback).normalize('NFC').trim().replace(/\s+/gu, ' ')
  const source = normalized.length > 0 ? normalized : fallback
  return [...source].slice(0, maxLength).join('')
}

export function buildReviewIssueItems({
  annotations,
  revisions,
  logicIssues = [],
  legibilityIssues = [],
}: BuildReviewIssueItemsInput): ReviewIssueCardItem[] {
  const revisionByErrorId = new Map(revisions.flatMap((item) => item.relatedErrorIds.map((id) => [id, item] as const)))

  const languageItems = annotations.filter((annotation) => annotation.type !== 'spelling').map((annotation): ReviewIssueCardItem => {
    const revision = revisionByErrorId.get(annotation.id)

    return {
      id: annotation.id,
      source: 'language',
      typeLabel: annotation.type,
      categoryLabel: annotation.type,
      severity: annotation.severity,
      original: annotation.original,
      suggestion: revision?.revised ?? annotation.suggestion,
      explanation: revision?.note ?? annotation.explanation,
      needsTeacherReview: annotation.needsTeacherReview,
      sourceLocator: sourceLocator('language', annotation.id),
    }
  })

  const logicItems = logicIssues.map((issue): ReviewIssueCardItem => ({
    id: issue.id,
    source: 'logic',
    typeLabel: logicSubtypeLabel[issue.subType],
    categoryLabel: logicSubtypeLabel[issue.subType],
    severity: issue.severity,
    original: issue.original,
    diagnosis: issue.diagnosis,
    suggestedActionLabel: logicActionLabel[issue.suggestedAction],
    conservativeSuggestion: issue.conservativeSuggestion ?? issue.polishedSuggestion,
    needsTeacherReview: issue.needsTeacherReview,
    sourceLocator: sourceLocator('logic', issue.id),
  }))

  const legibilityItems = legibilityIssues.map((issue): ReviewIssueCardItem => ({
    id: issue.id,
    source: 'legibility',
    typeLabel: '卷面与可读性',
    categoryLabel: '卷面与可读性',
    title: '字迹不清导致语义无法确认',
    severity: 'medium',
    original: issue.transcriptText,
    diagnosis: issue.explanation,
    suggestedActionLabel: '字迹不清导致语义无法确认',
    suggestion: `系统默认按错误处理；可能读法：${issue.possibleReadings.join(' / ')}`,
    conservativeSuggestion: `系统默认按错误处理；可能读法：${issue.possibleReadings.join(' / ')}`,
    sourceLocator: sourceLocator('legibility', issue.id),
    pageReference: {
      kind: 'page-description',
      pageNumber: issue.pageNumber,
      regionDescription: issue.regionDescription,
    },
  }))

  const highCertaintySpellingItems = annotations
    .filter((annotation) => annotation.type === 'spelling' && annotation.evidenceCertainty === 'certain')
    .map((annotation): ReviewIssueCardItem => {
      const revision = revisionByErrorId.get(annotation.id)
      return {
        id: annotation.id,
        source: 'language',
        typeLabel: annotation.type,
        categoryLabel: annotation.type,
        severity: annotation.severity,
        original: annotation.original,
        suggestion: revision?.revised ?? annotation.suggestion,
        explanation: revision?.note ?? annotation.explanation,
        needsTeacherReview: annotation.needsTeacherReview,
        sourceLocator: sourceLocator('language', annotation.id),
      }
    })

  return [...languageItems, ...logicItems, ...legibilityItems, ...highCertaintySpellingItems]
}

export function buildClassReviewIssueInputFromReviewIssue({
  taskId,
  essayId,
  resultRevision,
  issue,
}: {
  taskId: string
  essayId: string
  resultRevision: number
  issue: ReviewIssueCardItem
}): AddClassReviewIssueInput {
  const isLanguage = issue.source === 'language'
  const diagnosis = isLanguage
    ? trimForClassReview(issue.explanation, '教师确认该语言问题值得进入班级总览。', 500)
    : trimForClassReview(issue.diagnosis, '教师确认该问题值得进入班级总览。', 500)
  const teachingAction = isLanguage
    ? trimForClassReview(
        issue.suggestion ? `建议改为：${issue.suggestion}` : issue.explanation,
        '讲评时引导学生比较原句和修改句。',
        500,
      )
    : trimForClassReview(
        [issue.suggestedActionLabel, issue.conservativeSuggestion].filter(Boolean).join('：'),
        '讲评时引导学生说明修改理由。',
        500,
      )
  return {
    taskId,
    essayId,
    sourceLocator: issue.sourceLocator,
    sourceResultRevision: resultRevision,
    title: trimForClassReview(issue.title ?? issue.categoryLabel ?? issue.typeLabel, '班级共性问题', 100),
    diagnosis,
    teachingAction,
    severity: issue.severity,
    anonymousExample: trimForClassReview(issue.original, '', 200) || null,
  }
}
