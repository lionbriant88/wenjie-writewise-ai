# Upload Batch Grouping Redesign Design

## Goal

Redesign the upload organizing flow from a blocking manual-grouping workflow into a batch image organizing workflow. Teachers should upload all essay images once, choose a lightweight grouping rule, fix only the exceptions, and start batch OCR by essay group.

## Product Decision

The previous `手动分组` mode solved the multi-page essay problem, but it made grouping feel like a required step before OCR. This redesign makes the default faster:

- Unmerged images are single-page essays by default.
- Teachers only merge pages when several images belong to the same essay.
- Batch OCR always runs by essay group.

## Adopted Ideas

- Keep `一张一篇` as the default mode.
- Add `每 2 张一篇` for classes where every student's essay is usually two photos.
- Add `混合页数` for mixed single-page and multi-page submissions.
- Replace the top-level `手动分组` button with the `混合页数` mode.
- Replace `合并为多页作文` with contextual `合并为一篇作文`.
- Replace top-level `拆分页` with per-group `拆分此作文`.
- Show a mixed-pages guide when users first enter `混合页数`.
- Allow users to close the guide for the current session or choose `不再提醒`.
- Keep `开始模拟 OCR` as the primary action, with expected essay count in the label.
- Keep upload state local to the upload page and continue using `confirmMockOcrEssay({ essayGroups })`.

## Rejected Or Deferred Ideas

- Do not add `每 3 张一篇` in this iteration. It is low-frequency and makes the mode selector heavier.
- Do not rely only on Ctrl-click. Support ordinary click-to-select; Ctrl-click can remain a convenience if easy.
- Do not add a merge confirmation dialog in this iteration. Use current display order as merge order.
- Do not add file-name or photo-time sorting in this iteration. Keep current upload/display order.
- Do not introduce a new global upload image model unless the existing `EssayPage` and `essayGroups` API cannot support the feature.

## Target UX

The upload page grouping area should become:

```text
整理方式
[一张一篇] [每 2 张一篇] [混合页数]

当前 6 张图片，预计生成 4 篇作文
[开始模拟 OCR（预计 4 篇）]
```

The top-level `合并为多页作文`、`拆分页`、`手动分组` controls should disappear.

## Group Preview

The page should show essay groups, not only raw images:

```text
作文 1 · 共 1 页
Page 1

作文 2 · 共 2 页
Page 2
Page 3
[拆分此作文]
```

Rules:

- Single-page groups do not show `拆分此作文`.
- Multi-page groups show `拆分此作文`.
- Group numbering is regenerated from display order.
- OCR uses the page order shown inside each group.

## Mixed Pages Mode

When the teacher enters `混合页数`, the system starts from single-page groups.

The teacher can select pages and merge them:

- Click a page to select it.
- Selecting at least two pages shows a contextual action bar:

```text
已选 2 张图片
[合并为一篇作文] [取消选择]
```

After merging:

- The selected pages become one essay group.
- The merge order follows the current display order.
- The selected pages no longer appear as independent essays.
- Selection is cleared.

## Mixed Pages Guide

When users first click `混合页数`, show a lightweight inline guide near the grouping controls:

```text
混合页数模式：未合并的图片会默认作为单页作文。点击图片可选中，多选 2 张以上后可合并为一篇作文；多页作文卡片内可拆分。
[知道了] [不再提醒]
```

Behavior:

- `知道了` hides the guide for the current page session.
- `不再提醒` writes `wenjie-hide-mixed-grouping-guide=true` to `localStorage`.
- When the guide is hidden, `混合页数` mode still shows a small `查看操作提示` control.
- Clicking `查看操作提示` shows the guide again, even if `不再提醒` was previously selected.

## Fixed Two-Page Mode

`每 2 张一篇` groups images by current display order:

```text
Page 1 + Page 2 -> 作文 1
Page 3 + Page 4 -> 作文 2
Page 5 -> 作文 3
```

If one image remains at the end, keep it as a single-page essay and show a light note:

```text
最后 1 张图片未满 2 张，已作为单页作文保留。
```

## OCR Flow

`开始模拟 OCR` should always operate by essay group:

- Single-page group: one page draft becomes one essay draft.
- Multi-page group: page drafts are concatenated in group order.
- Confirming OCR submits one queued essay per group.

The existing app-state contract remains:

```ts
confirmMockOcrEssay({
  taskId,
  essayGroups: [{ pages, ocrText }],
})
```

## Testing

Add or update tests for:

- Grouping utility: single-page grouping.
- Grouping utility: fixed two-page grouping, including odd remainder.
- Upload page mode selector.
- Top-level old grouping buttons removed.
- Mixed-pages guide shown on first entry.
- `不再提醒` suppresses automatic guide display.
- Mixed-pages selection only shows merge action at two or more selected pages.
- Merge creates a multi-page essay group.
- Split restores a multi-page group to single-page groups.
- Batch OCR submits by essay group.

## Non-Goals

- Real OCR integration.
- Student name detection.
- AI automatic grouping.
- Drag-and-drop sorting.
- Backend queue restructuring.
