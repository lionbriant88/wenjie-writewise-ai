# Essay Detail Teacher Decision Design

Last updated: 2026-06-29

## Goal

Improve the single-essay grading result detail page so it works more like a teacher review workstation than a static grading report. The page should help a teacher quickly judge the essay, adjust scores/comments lightly, and identify the most important correction points without expanding the scope into student views, export, real AI, or permissions.

## Scope

This round focuses on one small Phase 2 loop:

- Add a compact diagnostic scoring summary at the top of the right-side work area.
- Integrate dimension scores into that diagnostic summary.
- Keep dimension scores editable.
- Recompute the total score from dimension scores immediately after edits.
- Derive grade band, main deduction dimensions, and review recommendation from the latest score state.
- Strengthen issue/correction cards so teachers can scan issue type, severity impact, original sentence, suggested revision, and explanation.
- Add lightweight teacher comment adjustment controls and success feedback.

This round does not include:

- Student feedback view switching.
- Word/PDF export.
- Real backend persistence.
- Real AI generation.
- Student/parent portals.
- Permission systems.
- A complex class-review material library.
- Left-side original essay highlighting or click-to-locate behavior.

## Layout Decision

The existing left column should remain stable in this round:

- Keep `学生作文原文` in the left column.
- Keep `查看原图` in the left column.
- Keep OCR text editing behavior unchanged.
- Keep original image preview behavior unchanged.

The right-side work area should become:

1. `诊断摘要 / 分项评分`
2. `问题与修改建议`
3. `表达升级建议`
4. `AI 总评 / 教师补充建议`

The existing large standalone `分项评分` card should be removed after its content is integrated into the diagnostic summary. The same dimension score data must not appear twice on the page.

Future layout work can focus on an original-text-to-issue comparison loop:

- Click an issue and locate the original sentence.
- Highlight the related source sentence in the left column.
- Consider synchronized scrolling only after issue locating is useful.

## Diagnostic Summary

The new top summary should appear in the right-side work area, above issue corrections. It should be compact enough to fit in the first screen together with the left original text panel.

Required content:

- Total score, displayed as calculated score `/ 15`.
- Grade band:
  - `优秀`: 13.5-15
  - `良好`: 11-13.4
  - `合格`: 9-10.9
  - `待提升`: 0-8.9
- AI confidence as a percentage.
- Main deduction dimensions, based on the 1-2 lowest dimension score rates.
- Review recommendation:
  - Score >= 13.5: `可作为优秀范例`
  - Score >= 11 and < 13.5: `普通反馈`
  - Score >= 9 and < 11: `建议关注主要问题`
  - Score < 9: `建议教师复核`
  - Low AI confidence should also show `建议教师复核`.
  - Multiple high-severity issues can show `建议重点讲评`.
- Compact editable dimension score rows.

The summary should feel simple, professional, and lightly technical. Use concise chips, restrained borders, and inline status feedback rather than decorative effects.

## Score Editing

Dimension scores remain editable. Total score should be derived from dimension scores, not edited independently.

Rules:

- Each score input is clamped between `0` and that dimension's `maxScore`.
- Decimal values are supported.
- Display scores with one decimal place where appropriate.
- The total score is the sum of all dimension scores.
- After any dimension score edit, update the grading result state with:
  - the updated `dimensionScores`
  - the recomputed `totalScore`
  - `teacherAdjusted: true` through the existing app state update path
- Show lightweight feedback such as `分数已更新`.
- Do not use `alert`.

This removes the current independent total-score input because independent total editing can create a mismatch between total score and dimension scores.

## Issue And Correction Cards

`问题与修改建议` should remain below the diagnostic summary, but each issue card should be more decision-oriented and compact.

Each issue should show:

- Issue type.
- Deduction impact mapped from severity:
  - `high` -> `高`
  - `medium` -> `中`
  - `low` -> `低`
- Original text.
- Suggested revision.
- Explanation.
- `加入班级总览` button with mock inline feedback.

This round should not add complex issue editing, issue ignoring, or real class-review data persistence.

## Teacher Comment Adjustment

The final right-side module should become `AI 总评 / 教师补充建议`.

Required behavior:

- Keep the existing overall comment editable.
- Add a teacher supplemental suggestion text area.
- Use frontend state only.
- A `保存调整` action should show a success cue such as `已保存教师调整`.
- After saving, show a persistent status chip such as `已由教师调整`.

Recommended data fields:

- `teacherComment?: string`
- `teacherSuggestion?: string`
- `teacherAdjusted?: boolean`

If adding fields creates unnecessary data-model churn, it is acceptable to store the supplemental suggestion in local component state for this prototype round, as long as the teacher can edit it and receive clear save feedback.

## Navigation And Existing Flows

The following must keep working:

- Return to progress page.
- Previous essay.
- Next essay.
- Open detail page from progress page.
- Manual review/progress completion behavior.
- Mock completed essays created from OCR upload.
- Original image preview.

This round should not modify the progress page or upload page except where tests need to navigate through them.

## Testing Requirements

Add focused tests for the detail page:

- Diagnostic summary appears with total score, grade band, AI confidence, main deduction dimensions, and review recommendation.
- Dimension score edit updates total score immediately.
- Editing a dimension clamps values above max score and below zero.
- Grade band updates after dimension score edits.
- The old standalone `分项评分` card is not duplicated below the summary.
- Issue cards show type, impact, original sentence, suggested revision, and explanation.
- `加入班级总览` shows lightweight feedback.
- Teacher comment/supplement save shows success feedback and `已由教师调整`.
- Return/previous/next controls remain available.

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Browser verification should cover:

1. Open a completed essay detail page.
2. Check the new diagnostic summary.
3. Edit one dimension score.
4. Confirm total score, grade band, and main deduction dimensions update.
5. Confirm old standalone dimension score card is gone.
6. Check issue cards.
7. Save teacher comment/supplement.
8. Confirm success feedback.
9. Use return, previous, and next controls.

## Acceptance Criteria

- Detail page first screen shows a compact diagnostic scoring summary.
- Total score, grade band, AI confidence, main deduction dimensions, and review recommendation are visible near the top.
- Dimension scores are integrated into the summary and remain editable.
- Total score updates from dimension scores.
- Dimension score input is clamped to valid ranges.
- Grade band and main deduction dimensions update after score edits.
- The old standalone `分项评分` card no longer duplicates the same data.
- `问题与修改建议` is more structured and still compact.
- `表达升级建议` remains after issue corrections.
- `AI 总评 / 教师补充建议` supports lightweight editing and save feedback.
- The left-side original essay and original image preview are unchanged.
- Existing detail navigation remains intact.
- Tests, lint, build, and browser verification pass.
