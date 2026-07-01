# 班级总览讲评素材池闭环 v0.1 设计规格

## Goal

打通“完成批改 -> 单篇详情 -> 加入班级总览 -> 班级讲评素材沉淀”的第一版闭环。教师在单篇详情页看到典型语言问题或逻辑问题后，可以加入当前任务的班级总览，并在班级总览页查看、筛选、移除这些教师精选素材。

## Current Baseline

- 单篇详情页已经有“问题与修改建议”，包括语言问题和逻辑连贯性问题。
- `IssueCorrectionList` 目前只用组件内 `Set` 显示“已加入班级总览”，没有写入全局状态。
- 班级总览页已经有分数分布、`classInsights` 高频语法错误、高频拼写错误、典型问题句、可上课改写练习。
- `classInsights` 是系统生成的 mock 班级洞察，不应与教师手动精选素材混在同一个数据结构里。

## Product Decision

采用独立的 `classReviewMaterials` 素材池：

- `classInsights` 继续表示系统生成的班级统计与高频问题。
- `classReviewMaterials` 表示教师在详情页手动精选的讲评素材。
- `IssueCorrectionList` 保持受控组件，只接收加入状态和回调，不直接读取或写入 `AppStateContext`。
- 本轮只支持从问题卡片加入：
  - 语言问题 -> `typical_error`
  - 逻辑问题 -> `logic_issue`
- 类型层预留 `expression_upgrade`，但本轮不从全文优化稿加入表达提升素材。
- 班级总览页不显示空的“表达提升”tab；只有存在真实 `expression_upgrade` 素材时才显示。

## Data Model

新增类型：

```ts
export type ClassReviewMaterialType =
  | 'typical_error'
  | 'logic_issue'
  | 'expression_upgrade'
  | 'excellent_expression'
  | 'teacher_note'

export interface ClassReviewMaterial {
  id: string
  taskId: string
  essayId: string
  essayLabel: string
  type: ClassReviewMaterialType
  categoryLabel: string
  original: string
  revised?: string
  diagnosis?: string
  explanation?: string
  teachingSuggestion?: string
  severity?: 'low' | 'medium' | 'high'
  needsTeacherReview?: boolean
  sourceIssueId?: string
  createdAt: string
}
```

去重 key：

1. 如果有 `sourceIssueId`，使用 `taskId + essayId + sourceIssueId`。
2. 如果没有 `sourceIssueId`，使用 `taskId + essayId + type + original`。

重复加入时不新增素材，详情页按钮保持“已加入班级总览”。

## Detail Page Flow

`EssayResultPage` 根据当前 `task`、`essay` 和 `ReviewIssueCardItem` 构造素材输入：

- 语言问题：
  - `type: 'typical_error'`
  - `original`: 原句
  - `revised`: 推荐改法
  - `explanation`: 原因
  - `severity`: 扣分影响
  - `sourceIssueId`: `ReviewIssueCardItem.id`
- 逻辑问题：
  - `type: 'logic_issue'`
  - `original`: 原句
  - `diagnosis`: 逻辑诊断
  - `teachingSuggestion`: 建议处理或保守建议
  - `needsTeacherReview`: 是否建议教师复核
  - `sourceIssueId`: `ReviewIssueCardItem.id`

移除素材后，回到详情页时对应按钮应恢复为“加入班级总览”，因为按钮状态从全局素材池派生。

## Class Review Page

新增“教师精选讲评素材”模块，放在分数分布之后、高频问题模块之前，避免埋得太深。

模块能力：

- 显示素材总数。
- 显示 tabs：全部、典型错误、逻辑问题；表达提升只在存在真实素材时显示。
- 空状态说明可从单篇作文详情页加入素材。
- 每条素材显示来源作文、素材类型、原句、改法/诊断/讲评建议。
- 每条素材提供“查看来源”和“移除”。
- “查看来源”只跳转 `/tasks/:taskId/essays/:essayId`，本轮不做 query param 自动定位。

## Non-Goals

- 不接真实 AI。
- 不接真实 OCR。
- 不做后端数据库。
- 不做导出 Word / PDF。
- 不做学生端 / 家长端。
- 不做复杂课堂播放模式。
- 不重构上传整理页、批改进度页或单篇详情页整体布局。
- 不从全文优化稿里加入表达提升素材。
- 不做详情页来源自动定位。

## Testing

需要覆盖：

- 详情页点击语言问题“加入班级总览”后按钮变为“已加入班级总览”。
- 重复点击或再次渲染不会重复新增素材。
- 详情页点击逻辑问题后，班级总览显示逻辑诊断、建议教师复核和来源作文。
- 班级总览素材 tabs 能按类型筛选。
- 没有 `expression_upgrade` 素材时不显示“表达提升”tab。
- 移除素材后数量更新；回到详情页对应按钮恢复为“加入班级总览”。
- 空状态显示正确。
- 查看来源进入对应单篇详情页。
- 班级总览现有分数统计和 `classInsights` 保持显示。
- 单篇详情页全文优化稿保持显示。
- 批改进度页最新完成入口保持可用。

## Acceptance Criteria

- 教师能从单篇详情页把语言问题和逻辑问题加入当前任务的班级总览素材池。
- 素材按任务隔离，并记录来源作文。
- 同一素材不会重复加入。
- 班级总览页能展示、筛选、移除素材。
- 从班级总览移除素材后，详情页按钮状态同步恢复。
- 现有班级统计、高频错误、全文优化稿、批改进度页功能不被破坏。
