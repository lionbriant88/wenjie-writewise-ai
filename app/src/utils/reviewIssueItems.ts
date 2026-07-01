import type {
  ErrorAnnotation,
  LogicIssue,
  LogicIssueSubType,
  LogicSuggestionAction,
  SentenceRevision,
} from '../types'

export interface ReviewIssueCardItem {
  id: string
  source: 'language' | 'logic'
  typeLabel: string
  severity: 'low' | 'medium' | 'high'
  original: string
  suggestion?: string
  explanation?: string
  diagnosis?: string
  suggestedActionLabel?: string
  conservativeSuggestion?: string
  needsTeacherReview?: boolean
}

interface BuildReviewIssueItemsInput {
  annotations: ErrorAnnotation[]
  revisions: SentenceRevision[]
  logicIssues?: LogicIssue[]
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

export function buildReviewIssueItems({
  annotations,
  revisions,
  logicIssues = [],
}: BuildReviewIssueItemsInput): ReviewIssueCardItem[] {
  const revisionByErrorId = new Map(revisions.map((item) => [item.relatedErrorId, item]))

  const languageItems = annotations.map((annotation): ReviewIssueCardItem => {
    const revision = revisionByErrorId.get(annotation.id)

    return {
      id: annotation.id,
      source: 'language',
      typeLabel: annotation.type,
      severity: annotation.severity,
      original: annotation.original,
      suggestion: revision?.revised ?? annotation.suggestion,
      explanation: revision?.note ?? annotation.explanation,
    }
  })

  const logicItems = logicIssues.map((issue): ReviewIssueCardItem => ({
    id: issue.id,
    source: 'logic',
    typeLabel: logicSubtypeLabel[issue.subType],
    severity: issue.severity,
    original: issue.original,
    diagnosis: issue.diagnosis,
    suggestedActionLabel: logicActionLabel[issue.suggestedAction],
    conservativeSuggestion: issue.conservativeSuggestion ?? issue.polishedSuggestion,
    needsTeacherReview: issue.needsTeacherReview,
  }))

  return [...languageItems, ...logicItems]
}
