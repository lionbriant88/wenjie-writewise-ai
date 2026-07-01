# Focused Essay Detail Polish Design

## Goal

Turn the single-essay detail page into a denser focused review workspace without adding new product surfaces. The page should use more horizontal space for grading, remove duplicated source text, and make both issue corrections and expression upgrades easier to scan.

## Scope

In scope:

- Default the single-essay detail page into a focused layout with the global sidebar collapsed on desktop.
- Keep a visible control to expand and collapse the global sidebar.
- Leave task list, upload, progress, exceptions, and class review pages unchanged.
- Replace the duplicated source textarea plus standalone locating preview with one student source panel.
- Add `阅读定位 / 编辑 OCR` modes in the student source panel.
- Highlight selected issue text directly inside the source panel in reading mode.
- Keep OCR editing in edit mode.
- Compact both `问题与修改建议` cards and `表达升级建议` cards.
- Change issue locate status from process wording to result wording: `已定位` or `未精确定位`.
- Update mock essay text so source text, issue corrections, and expression upgrades visibly correspond.
- Preserve diagnostic summary, dimension score editing, teacher comment editing, image preview, class-overview feedback, and previous/next navigation.

Out of scope:

- Student feedback views.
- Export features.
- Real AI generation or backend persistence.
- Upload or progress page logic changes.
- Image coordinate annotation.
- OCR region selection.
- Complex NLP sentence splitting.
- Full layout rewrite.
- Remembering sidebar state across sessions.

## Layout Behavior

`AppLayout` will accept a focused-review option. When enabled, the desktop sidebar starts collapsed, freeing the full main width. A small `展开导航` button remains available near the left edge. When expanded, the sidebar shows the existing brand, task list link, workflow nav, and task summary. The detail page's internal `返回批改进度 / 上一篇 / 下一篇` controls remain unchanged.

Mobile behavior stays close to the current responsive layout. The workflow navigation already appears in the header on small screens, so this iteration focuses on desktop.

## Source Panel Behavior

`EssaySourcePanel` becomes a two-mode card:

- `阅读定位`: default mode. Displays OCR text as read-only rich text and highlights the selected issue's matching original sentence directly in the source text.
- `编辑 OCR`: displays the editable textarea using the existing OCR update path.

There is no separate `定位预览` card. If an issue cannot be matched, the source card shows `未在原文中精确定位，请手动核对`. The OCR confidence and original image button stay in the card header.

## Card Density

`IssueCorrectionList` cards become compact review rows:

- Top row: issue type, severity, locate status, class overview button.
- Body rows: `原句`, `改法`, `原因` with tighter spacing.
- Selected card keeps a restrained blue state.

`ExpressionUpgradeList` gets similar density, but keeps green styling to show these are optional improvements, not errors. It should display original expression, upgraded expression, note, and class-overview action without excessive vertical spacing.

## Mock Data

The primary mock essay should include source text that visibly corresponds to:

- `I suggest you joins the club.`
- `enviroment`
- `It can make you know many knowledge.`
- `I think`
- `very important`

The fallback matching behavior remains covered by tests that edit the OCR text, not by making the default demo data inconsistent.

## Testing And Verification

Focused page tests should cover:

- Focused detail layout defaults to collapsed global navigation.
- Sidebar can be expanded.
- Other detail controls still exist.
- Source panel defaults to `阅读定位`.
- `编辑 OCR` mode exposes the editable textarea.
- Selecting an issue highlights source text directly, without showing a standalone `定位预览`.
- Matching success shows `已定位`.
- Matching failure shows `未精确定位` and the fallback message.
- Issue and expression cards retain class-overview feedback.
- Existing score editing and teacher comment saving still work.

Final verification:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
npm.cmd test -- src/pages/DetailNavigation.test.tsx
npm.cmd test
npm.cmd run lint
npm.cmd run build
```
