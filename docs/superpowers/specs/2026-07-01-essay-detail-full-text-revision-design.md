# Essay Detail Full Text Revision Design

## Goal

Upgrade the single-essay detail page from local correction cards into a more complete teacher review workspace. The first implementation should help teachers see how the whole essay can be corrected and moderately improved while preserving the student's original intent.

This round focuses on `全文优化稿` and `逻辑连贯性诊断`. The `原卷批注视图` idea is valid, but it should be deferred to a later round so the detail page does not absorb too much new interaction at once.

## Current Baseline

The single-essay detail page already has:

- Diagnostic summary with integer total score, grade band, AI confidence, main deductions, and review recommendations.
- Editable dimension scores with total-score linkage.
- Student source panel with `阅读定位 / 编辑 OCR` modes.
- Issue correction cards that can locate matching source text.
- Expression upgrade cards.
- Editable AI overall comment and teacher supplementary suggestion.
- Previous/next essay navigation and return to progress.
- Focused review layout with collapsible global navigation on desktop.

The page is already a teacher decision workspace. The next improvement should not add generic content. It should make the teacher answer two practical questions faster:

- What would a safer corrected version of the full essay look like?
- Which parts are not only language errors, but logic or coherence problems that need teacher judgment?

## Product Decision

Adopt:

- Add full-text revision data to grading results.
- Add a `全文优化稿` module to the workstation view.
- Replace the current visible `表达升级建议` section with `全文优化稿`.
- Keep `upgradedExpressions` in the data model for compatibility, but make it a source that can feed the full-text revision experience later.
- Add logic/coherence issues into issue cards.
- Use conservative copy when student intent is unclear.

Defer:

- `工作台视图 / 原卷批注视图` switching.
- Original-paper annotation view.
- Image coordinate-level annotations.
- Handwritten or drawn annotations.
- Export to Word or PDF.
- Real AI generation.
- Real OCR coordinate mapping.

## Scope

In scope for the first round:

- Extend the type model with `FullTextRevision`, `FullTextSentencePair`, and `LogicIssue`.
- Add `fullTextRevision?: FullTextRevision` to `GradingResult`.
- Extend issue typing to support logic and coherence issues.
- Add mock full-text revision data for completed mock essays.
- Add one logic issue that requires teacher review.
- Add a `FullTextRevisionPanel` component.
- Render `全文优化稿` in the right-side workstation flow where `表达升级建议` currently appears.
- Support three internal views inside the panel:
  - `纠错版`
  - `提升版`
  - `逐句对照`
- Show `逻辑优化说明` in the panel.
- Optionally support `复制纠错版` and `复制提升版` if implementation remains simple.
- Preserve all existing detail page behavior.

Out of scope for this round:

- Original-paper annotation view.
- Page/image-level annotation filters.
- Exact image-coordinate matching.
- Backend persistence.
- Upload or progress page changes.
- Student or parent-facing views.
- Export features.
- Large layout rewrite.

## Safety Principle

The full-text revision feature must communicate a clear boundary:

```text
本优化稿保留学生原文思路，只纠正语言错误、优化表达，并在必要时提示逻辑衔接问题。
```

The system should not pretend to know missing student intent. When the original text has a serious logic gap, the product should show a teacher-review prompt instead of inventing content.

Examples:

- Safe: add a connector when the relationship is already clear.
- Risky: invent a missing event, reason, or new opinion that the student never wrote.
- Preferred for unclear intent: mark `建议教师复核` and suggest that the student add an explanation.

## Data Model

Add these types:

```ts
export interface FullTextRevision {
  originalText: string
  correctedText: string
  polishedText: string
  sentencePairs: FullTextSentencePair[]
  logicIssues: LogicIssue[]
  logicNotes: string[]
}

export interface FullTextSentencePair {
  id: string
  original: string
  corrected: string
  polished: string
  changeTypes: FullTextChangeType[]
  explanation: string
  preservesOriginalIntent: boolean
  needsTeacherReview?: boolean
}

export type FullTextChangeType =
  | 'grammar'
  | 'spelling'
  | 'word_choice'
  | 'sentence_upgrade'
  | 'coherence'
  | 'logic_bridge'
  | 'delete_suggestion'
  | 'replace_sentence'
  | 'reference_clarification'

export type LogicIssueSubType =
  | 'weak_connection'
  | 'unclear_logic'
  | 'missing_cause_effect'
  | 'unclear_transition'
  | 'topic_drift'
  | 'irrelevant_sentence'
  | 'unclear_reference'

export type LogicSuggestionAction =
  | 'add_connector'
  | 'add_bridge_sentence'
  | 'delete_sentence'
  | 'replace_sentence'
  | 'clarify_reference'
  | 'ask_student_to_explain'

export interface LogicIssue {
  id: string
  sentenceId?: string
  original: string
  contextBefore?: string
  contextAfter?: string
  subType: LogicIssueSubType
  severity: 'low' | 'medium' | 'high'
  diagnosis: string
  suggestedAction: LogicSuggestionAction
  conservativeSuggestion?: string
  polishedSuggestion?: string
  needsTeacherReview?: boolean
}
```

Extend:

```ts
export interface GradingResult {
  // existing fields
  fullTextRevision?: FullTextRevision
}
```

Extend `ErrorAnnotation['type']` conservatively:

```ts
type: 'grammar' | 'spelling' | 'word_choice' | 'structure' | 'logic' | 'coherence'
```

Do not delete `UpgradedExpression` yet.

## Mock Data Requirements

The mock result should include:

- `correctedText`
- `polishedText`
- `sentencePairs`
- `logicIssues`
- `logicNotes`
- At least one grammar correction.
- At least one spelling correction.
- At least one word-choice improvement.
- At least one expression upgrade.
- At least one logic/coherence issue.
- At least one `needsTeacherReview: true` logic issue.

The polished text should remain recognizably based on the student's original essay. It should not become an overly polished model essay.

The mock source text should include the phrases used by:

- Issue correction cards.
- Full-text sentence pairs.
- Logic issue cards.
- Existing source-highlighting tests.

## Full Text Revision Panel

Create a new component:

```text
app/src/components/FullTextRevisionPanel.tsx
```

Panel title:

```text
全文优化稿
```

Header description:

```text
保留学生原文思路，只纠正语言错误、优化表达，并在必要时提示逻辑衔接问题。
```

Internal tabs:

- `纠错版`
- `提升版`
- `逐句对照`

Default tab:

- `提升版`

Panel behavior:

- `纠错版`: show corrected full text with necessary language fixes.
- `提升版`: show moderately polished full text with safer expression and coherence improvements.
- `逐句对照`: show rows containing original, corrected, polished, change type, explanation, original-intent status, and teacher-review status.
- `逻辑优化说明`: show below the tab content as a concise list.
- If copy buttons are included, show lightweight success feedback after copying.

Design constraints:

- Keep the panel compact.
- Do not use nested cards inside cards.
- Use tabs or segmented controls instead of expanding all content by default.
- Keep the visual style quiet, professional, and light-tech.

## Logic Issue Cards

`IssueCorrectionList` should support both language issues and logic/coherence issues.

For normal language issues, keep current fields:

- 问题类型
- 扣分影响
- 原句
- 推荐改法
- 原因
- 加入班级总览
- 定位状态

For logic/coherence issues, show:

- 问题类型
- 扣分影响
- 原句
- 诊断
- 建议处理
- 保守改法 or 提升建议
- `建议教师复核` when `needsTeacherReview` is true
- 加入班级总览
- 定位状态

Logic cards should still participate in existing source-text locating when the `original` text is present in the OCR text.

## Workstation Layout

The default detail page remains the workstation view. In the right-side column, the intended order is:

1. Diagnostic summary and editable dimension scores.
2. 问题与修改建议.
3. 全文优化稿.
4. AI 总评 / 教师补充建议.

The existing left-side source panel remains unchanged in this round.

`表达升级建议` is no longer a standalone visible section once `全文优化稿` is present. Its data remains in the model for compatibility and possible future use.

## Deferred Original-Paper Annotation View

The original-paper annotation view is a good second-round feature. The preferred later scope is:

- Add `工作台视图 / 原卷批注视图` switcher.
- Default to `工作台视图`.
- In `原卷批注视图`, show original essay image and a side annotation list.
- Support multi-page essay page switching.
- Annotation list can include language issues, logic issues, and full-text revision highlights.
- Clicking an annotation marks it selected.
- Do not attempt exact image-coordinate annotation in the first version.

This is deferred because the page already has a source panel and original image modal. Full-text revision is more central to teacher decision efficiency right now.

## Testing

Add or update tests for:

- `GradingResult` supports `fullTextRevision`.
- Mock data includes full-text revision data.
- Full-text revision data keeps source phrases visible in mock OCR text.
- Detail page renders `全文优化稿`.
- `全文优化稿` shows the safety description about preserving student intent.
- Default full-text tab is `提升版`.
- `纠错版` tab shows corrected text.
- `提升版` tab shows polished text.
- `逐句对照` tab shows original, corrected, polished, change type, explanation, and teacher-review status.
- Logic optimization notes are visible.
- Logic/coherence issue appears in `问题与修改建议`.
- Logic issue can show `建议教师复核`.
- Clicking a logic issue still attempts source locating.
- Existing diagnostic summary remains visible.
- Existing dimension score editing still updates total score.
- Existing teacher comment saving still works.
- Existing return/previous/next navigation still works.

Final verification:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/data/mockData.test.ts
npm.cmd test -- src/pages/EssayResultPage.test.tsx
npm.cmd test -- src/pages/DetailNavigation.test.tsx
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

## Acceptance Criteria

- The single-essay detail page shows `全文优化稿` in the workstation view.
- `表达升级建议` is not shown as a separate primary section when full-text revision exists.
- Full-text revision includes `纠错版`, `提升版`, and `逐句对照`.
- The module explicitly says it preserves the student's original intent.
- The corrected version only performs necessary language corrections.
- The polished version moderately improves expression and coherence without inventing new content.
- Sentence-by-sentence comparison explains what changed.
- Logic/coherence issues can appear in issue cards.
- Logic issues can show conservative suggestions and teacher-review prompts.
- Source locating still works for issue cards when text exists in OCR text.
- Existing diagnostic scoring, editable dimensions, teacher comments, source panel, original image modal, and navigation remain usable.
- No real AI generation, real OCR coordinate mapping, export, backend persistence, or original-paper annotation view is added in this round.
