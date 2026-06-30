# Manual OCR Grouping Design

## Goal

Build a small but realistic manual grouping flow on the upload page so a teacher can decide how uploaded images form essays before confirming OCR text into the grading queue.

## User Problem

The current upload page supports two simple grouping modes:

- merge all images into one multi-page essay
- split each image into one essay

Real submissions often sit between those two extremes. A student essay may span pages 1-2, another may be page 3 only, and a third may span pages 4-5. Teachers need a lightweight way to confirm that grouping before the queue is created.

## Scope

This iteration adds one new upload grouping mode: manual grouping.

In manual grouping:

- The teacher can create multiple essay groups.
- Every uploaded page belongs to exactly one group.
- Each group displays its essay number, page count, and page previews.
- The teacher can move a page to the previous or next group.
- Empty groups are removed automatically after moving pages away.
- The OCR preview shows one editable text area per group.
- Confirming OCR submits one queued essay per group.

Out of scope:

- Drag and drop between groups.
- Real OCR.
- Persisting upload state after page refresh.
- Complex page split markers inside one textarea.
- Manual editing of group titles.

## UX Design

The upload page keeps the existing software-like layout and adds a third grouping button: `手动分组`.

When `手动分组` is selected, the image organizer changes from one flat sorter into grouped panels:

- Each panel is titled `作文组 N`.
- The panel subtitle shows `M 张图片`.
- The panel contains page thumbnails.
- Each thumbnail has compact controls:
  - `移到上一篇`
  - `移到下一篇`
  - `删除`
- A button `新增作文组` appends an empty group. It is disabled while there are no pages.

The summary text at the top still says how many uploaded images will produce how many essays.

After `开始模拟 OCR`, the OCR section shows `作文组 N OCR 文本` for each group instead of one global textarea. Teachers can edit each group independently before clicking `确认 OCR 文本`.

## Data Flow

Upload page local state owns manual grouping:

- `pages`: the canonical uploaded page list.
- `manualGroups`: an array of page id arrays.
- Existing modes derive essay groups from `pages` and `mockOcrDraft`.
- Manual mode derives essay groups from `manualGroups`, `pages`, and per-group OCR drafts.

The app state API does not change. Upload page continues to call:

```ts
confirmMockOcrEssay({
  taskId,
  essayGroups: [{ pages, ocrText }],
})
```

This keeps the feature local to upload/OCR and avoids touching progress/detail page data contracts.

## Edge Cases

- Removing a page removes it from its manual group.
- Empty manual groups are removed automatically.
- If all pages are removed, manual grouping resets to one empty group.
- Adding pages appends them to the last manual group.
- Switching grouping modes resets OCR draft state.
- Confirm OCR is disabled if there are no non-empty groups or all OCR drafts are blank.

## Testing

Add upload page tests for:

- Selecting manual grouping reveals grouped panels and the add group control.
- Moving pages between groups updates the essay count.
- Starting mock OCR in manual mode shows one textarea per group.
- Confirming manual grouped OCR creates one queued essay per group on the progress page.

Existing tests for merged mode, split mode, upload previews, and queue creation must continue to pass.
