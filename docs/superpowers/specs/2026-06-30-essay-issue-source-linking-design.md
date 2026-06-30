# Essay Issue Source Linking Design

## Goal

Improve the essay detail page's teacher verification efficiency by linking right-side issue correction cards to the matching sentence in the left-side student essay source text.

## Scope

This iteration only changes the single essay result detail page.

In scope:

- Select an issue correction card.
- Highlight the matching `ErrorAnnotation.original` text in the left source text panel.
- Keep the selected issue card visually active.
- Show a lightweight fallback message when exact source matching fails.
- Keep diagnostic summary, dimension score editing, original image preview, teacher comments, and navigation intact.
- Add focused unit, page, and browser verification.

Out of scope:

- Complex NLP sentence splitting.
- OCR coordinate positioning.
- Drawing boxes on original images.
- Two-way synchronized scrolling.
- Student feedback views.
- Word or PDF export.
- Real AI regeneration.
- Upload page or progress page changes.

## Approach

Add a small pure utility module for source text matching and splitting. It will prefer direct substring matching, then retry with simple whitespace normalization so copied issue text can still locate a sentence when spacing differs.

Extract the left-side essay source area into `EssaySourcePanel`. The panel keeps the existing OCR text editing and original image action, but adds a read-only locating preview below the editable text when an issue is active. This avoids breaking the current textarea editing behavior.

Update `IssueCorrectionList` to accept `activeIssueId` and `onIssueSelect`. Each issue card can be selected by clicking the card, while the existing "加入班级总览" action remains an independent button and stops event propagation.

## Data Flow

1. `EssayResultPage` owns `activeIssueId`.
2. `IssueCorrectionList` calls `onIssueSelect(issue.id)` when a card is selected.
3. `EssayResultPage` derives `activeIssue` from `result.errorAnnotations`.
4. `EssaySourcePanel` receives `activeHighlightText={activeIssue?.original}`.
5. `EssaySourcePanel` uses `findTextMatch(essay.ocrText, activeHighlightText)` and `splitTextByMatch(...)`.
6. Matching text is rendered with a subtle `<mark>`.
7. If an active issue cannot be located, the source panel shows: `未在原文中精确定位，请手动核对`.

## Visual Behavior

- Selected issue card: blue/cyan border, very light blue background, and a small `正在定位原文` chip.
- Highlighted source text: light amber background, dark amber text, no heavy animation.
- Fallback message: small amber inline notice, non-blocking.
- No layout restructuring.

## Testing

Utility tests:

- Exact match.
- Target trim match.
- Empty source or target returns `null`.
- Unmatched target returns `null`.
- Splitting returns before/highlight/after parts.
- Newline text remains intact.

Page tests:

- Selecting an issue card shows selected state.
- Selecting an issue highlights source preview text.
- "加入班级总览" still works.
- Existing score editing and teacher comment saving still work.
- Navigation and diagnostic summary still exist.

Final verification:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/utils/textHighlight.test.ts
npm.cmd test -- src/pages/EssayResultPage.test.tsx
npm.cmd test
npm.cmd run lint
npm.cmd run build
```
