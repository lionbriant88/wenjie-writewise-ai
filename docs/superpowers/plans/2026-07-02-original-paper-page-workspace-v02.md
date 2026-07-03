# Original Paper Page Workspace v0.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `原卷视图` out of `EssaySourcePanel` and implement it as a page-level `paper` workspace inside `EssayResultPage`.

**Architecture:** `EssayResultPage` owns local `workspaceMode: 'grading' | 'paper'`. The existing grading workspace remains intact. `EssaySourcePanel` returns to source-only modes (`read | edit`), while a new `OriginalPaperWorkspace` component renders the page-level canvas with a large original-paper stage and left/right/bottom reserved annotation areas.

**Important constraints:**

- Do not add AppStateContext fields.
- Do not change upload, progress, class review, or route structure.
- Do not rewrite `activeDetailTab`, `activeIssueId`, OCR clickable source markers, class review material flow, full-text revision, or teacher feedback logic.
- `paper` mode is only a page-level conditional render in `EssayResultPage`.
- Runtime UI must not use the term `旁批`; use `原卷视图 / 原卷批阅 / 卷面批阅 / 图片区域高亮 / 批注联动`.
- Prioritize true original image URLs from the essay page (`previewUrl`, `imageUrl`, `imageUrls[0]`, `url`). Show the large placeholder only when no image is available.
- Multi-page support stays light: page counter and simple previous/next page buttons only.
- Do not commit failing tests. Tests may be written first, but Tasks 1-4 are committed together only after the focused test is green.

**Tech Stack:** React, TypeScript, React Router, React Testing Library, Vitest, Tailwind utility classes, existing `Essay` / `EssayPage` mock data.

---

## File Structure

- Create: `app/src/components/OriginalPaperWorkspace.tsx`
  - Renders the `paper` workspace only.
  - Shows top navigation, large paper image/placeholder stage, page counter, and left/right/bottom reserved annotation areas.
  - Uses local component state for the current paper page only.
  - Resets page index to `0` when `essay.id` changes.
  - Does not read or write AppState.

- Modify: `app/src/components/EssaySourcePanel.tsx`
  - Remove the `paper` source mode, `EssayPageSorter` import, and paper placeholder branch.
  - Keep only `read | edit`.
  - Preserve OCR marker and edit textarea behavior.

- Modify: `app/src/pages/EssayResultPage.tsx`
  - Add `EssayWorkspaceMode = 'grading' | 'paper'`.
  - Add local `workspaceMode` state.
  - Add page-level switch `批改工作台 / 原卷视图`.
  - Conditionally render grading workspace or `OriginalPaperWorkspace`.
  - Preserve existing grading-state variables and handlers.

- Modify: `app/src/pages/EssayResultPage.test.tsx`
  - Replace the old source-panel paper tests with page-level workspace tests.
  - Confirm `EssaySourcePanel` no longer exposes `原卷视图` as a source mode.
  - Confirm paper workspace hides grading content and returning restores existing workflows.

- Modify: `docs/current_development_status.md`
  - Record that `原卷视图` was corrected from left-side small tab to page-level workspace.
  - Record verification results.

---

## Task 1: Replace Tests for Page-Level Paper Workspace

**Files:**

- Modify: `app/src/pages/EssayResultPage.test.tsx`

- [ ] **Step 1: Narrow source mode helper**

Update `getSourceModeButton` to accept only:

```ts
function getSourceModeButton(mode: 'read' | 'edit') {
```

Remove the `paper` keywords from this helper.

- [ ] **Step 2: Add a page workspace helper**

Add a separate helper for the page-level workspace switch:

```ts
function getWorkspaceModeButton(mode: 'grading' | 'paper') {
  const keywordsByMode = {
    grading: ['批改工作台', '鎵规敼宸ヤ綔鍙?'],
    paper: ['原卷视图', '鍘熷嵎瑙嗗浘'],
  } satisfies Record<typeof mode, string[]>

  const modeButton = screen
    .getAllByRole('button')
    .find((button) => keywordsByMode[mode].some((keyword) => button.textContent?.includes(keyword)))

  if (!modeButton) {
    throw new Error(`Workspace mode button not found: ${mode}`)
  }

  return modeButton
}
```

This fixes the previous plan typo where the mojibake fallback string was not closed correctly.

- [ ] **Step 3: Update existing source mode assertions**

In the source-marker tests:

- Assert `getWorkspaceModeButton('grading')` is pressed.
- Assert `getWorkspaceModeButton('paper')` exists and is not pressed.
- Assert only `read` and `edit` source mode buttons are present inside the source panel.
- Assert there is only one `原卷视图` button on the page, and it belongs to the page-level workspace switch.

- [ ] **Step 4: Remove old source-panel paper tests**

Delete tests that expect `原卷视图` to be a mode inside `EssaySourcePanel`.

- [ ] **Step 5: Add page-level paper workspace test**

Add a test that:

- Renders the essay detail page in grading mode by default.
- Confirms grading tabs are visible before switching.
- Clicks `getWorkspaceModeButton('paper')`.
- Confirms the paper workspace appears.
- Confirms paper top navigation is present: `返回批改工作台`, `返回批改进度`, essay label, previous essay, next essay.
- Confirms the large paper stage exists via a stable selector such as `data-testid="paper-image-stage"`.
- Confirms the page counter exists.
- Confirms grading-only UI is absent in paper mode:
  - scoring diagnosis container/heading
  - AI confidence text
  - dimension score controls or score input groups
  - grading tabs
  - OCR textarea/source panel
  - OCR issue markers
  - issue correction cards
  - full-text revision
  - teacher feedback

Do not use brittle assertions such as `queryByText('/ 15')`.

- [ ] **Step 6: Add return-to-grading regression test**

Add a test that:

- Switches to paper workspace.
- Clicks `返回批改工作台`.
- Confirms grading mode is pressed again.
- Confirms OCR read/edit modes exist.
- Confirms OCR clickable issue markers return.
- Confirms selecting an issue card still updates active state/location status.
- Confirms adding a material to class review still works.
- Confirms full-text revision tab still renders.
- Confirms teacher feedback tab still renders.

- [ ] **Step 7: Run focused test for feedback only**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected at this point:

```text
FAIL src/pages/EssayResultPage.test.tsx
```

This failure is expected because implementation is not complete. Do not commit yet.

---

## Task 2: Restore `EssaySourcePanel` to OCR Source Modes Only

**Files:**

- Modify: `app/src/components/EssaySourcePanel.tsx`

- [ ] **Step 1: Remove paper source mode**

Remove:

- `EssayPageSorter` import.
- `SourcePanelMode = 'read' | 'paper' | 'edit'`.
- `paper` option from `SOURCE_PANEL_MODE_OPTIONS`.
- unsupported paper feature constants used only by the old in-panel placeholder.

Use:

```ts
type SourcePanelMode = 'read' | 'edit'
```

- [ ] **Step 2: Remove the paper rendering branch**

Delete the `mode === 'paper'` branch that renders the small in-panel paper placeholder.

Keep a two-way branch:

- `edit`: textarea OCR editing.
- `read`: existing source text rendering with `splitTextByIssueMarkers`, `data-issue-source`, and `data-active`.

- [ ] **Step 3: Run focused test for feedback only**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected: still failing until Tasks 3-4 are complete. Do not commit yet.

---

## Task 3: Add Page-Level `OriginalPaperWorkspace`

**Files:**

- Create: `app/src/components/OriginalPaperWorkspace.tsx`

- [ ] **Step 1: Create component and props**

Use:

```tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Essay, EssayPage } from '../types'

type EssayPageWithPossibleImages = EssayPage & {
  previewUrl?: string
  imageUrl?: string
  imageUrls?: string[]
  url?: string
}

interface OriginalPaperWorkspaceProps {
  essay: Essay
  taskId: string
  previousEssayId?: string
  nextEssayId?: string
  onBackToGrading: () => void
}
```

- [ ] **Step 2: Add image URL helper**

Use a small helper that prioritizes real image fields:

```ts
function getOriginalImageUrl(page?: EssayPage) {
  if (!page) return undefined
  const pageWithImages = page as EssayPageWithPossibleImages
  return pageWithImages.previewUrl ?? pageWithImages.imageUrl ?? pageWithImages.imageUrls?.[0] ?? pageWithImages.url
}
```

- [ ] **Step 3: Add local page state and reset on essay change**

Inside `OriginalPaperWorkspace`:

```tsx
const [pageIndex, setPageIndex] = useState(0)

useEffect(() => {
  setPageIndex(0)
}, [essay.id])
```

This prevents stale page index when switching previous/next essays while staying in the paper workspace.

- [ ] **Step 4: Render top navigation**

Top navigation should include:

- `返回批改工作台` button.
- `返回批改进度` link.
- essay label and `原卷视图`.
- previous/next essay links or disabled buttons.

Do not show:

- total score
- AI confidence
- scoring tags
- dimension scores
- major deduction items
- diagnostic summary

- [ ] **Step 5: Render paper canvas**

Render a page-level canvas:

- left reserved annotation area
- center large original paper stage
- right reserved annotation area
- bottom reserved annotation area

Use a responsive layout equivalent to:

```css
grid-template-columns: 220px minmax(520px, 1fr) 280px;
grid-template-rows: minmax(560px, 70vh) auto;
```

The center stage must:

- show `<img>` with the real image URL when available
- use `object-contain`
- target a large visual area, around `70vh`
- expose `data-testid="paper-image-stage"`
- show only the large no-image placeholder when no real image exists

The no-image placeholder copy should be:

```text
当前作文暂无原卷图片预览。后续接入 OCR 坐标后，将在此处展示原卷批阅能力。
```

- [ ] **Step 6: Add light page controls**

Show `第 X / N 页`.

If `N > 1`, simple previous/next page buttons are allowed. Do not add thumbnails, drag sorting, or complex multi-page management.

- [ ] **Step 7: Run focused test for feedback only**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected: still failing until Task 4 wires the component. Do not commit yet.

---

## Task 4: Wire Page-Level Workspace Mode in `EssayResultPage`

**Files:**

- Modify: `app/src/pages/EssayResultPage.tsx`

- [ ] **Step 1: Import the new component**

```ts
import { OriginalPaperWorkspace } from '../components/OriginalPaperWorkspace'
```

- [ ] **Step 2: Add local workspace mode**

After `type EssayDetailTab = ...`, add:

```ts
type EssayWorkspaceMode = 'grading' | 'paper'
```

Inside `EssayResultPage`, add local state:

```ts
const [workspaceMode, setWorkspaceMode] = useState<EssayWorkspaceMode>('grading')
```

- [ ] **Step 3: Add page-level mode switch**

Add a switch with two buttons:

- `批改工作台`
- `原卷视图`

Each button should use `aria-pressed={workspaceMode === modeOption.mode}` for stable tests.

- [ ] **Step 4: Conditionally render paper before grading content**

Structure the page as:

```tsx
{workspaceMode === 'paper' ? (
  <OriginalPaperWorkspace
    essay={essay}
    taskId={task.id}
    previousEssayId={previousEssayId}
    nextEssayId={nextEssayId}
    onBackToGrading={() => setWorkspaceMode('grading')}
  />
) : (
  <>
    {/* existing top action region, grading grid, and ReviewActionBar */}
  </>
)}
```

Keep the existing original-image modal outside this conditional if needed so grading mode behavior is unchanged.

- [ ] **Step 5: Preserve grading behavior**

Do not move or rewrite:

- `activeDetailTab`
- `activeIssueId`
- `reviewIssueItems`
- `sourceIssueMarkers`
- `getMaterialInput`
- `addClassReviewMaterial`
- `isClassReviewMaterialAdded`
- `EssaySourcePanel`
- `IssueCorrectionList`
- `FullTextRevisionPanel`
- teacher-feedback JSX

Only wrap the existing grading workspace in the `grading` fragment.

- [ ] **Step 6: Run focused test and verify green**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected:

```text
PASS src/pages/EssayResultPage.test.tsx
```

- [ ] **Step 7: Commit the green feature set**

Only after the focused test passes, commit Tasks 1-4 together:

```powershell
git add app/src/pages/EssayResultPage.test.tsx app/src/components/EssaySourcePanel.tsx app/src/components/OriginalPaperWorkspace.tsx app/src/pages/EssayResultPage.tsx
git commit -m "feat: add page-level original paper workspace"
```

---

## Task 5: Update Progress Memory and Run Focused Verification

**Files:**

- Modify: `docs/current_development_status.md`

- [ ] **Step 1: Add the new progress entry**

Near the top of `docs/current_development_status.md`, add a short entry:

```markdown
## 本次新增进展：原卷视图修正为页面级卷面批阅画布 v0.2

- `原卷视图` 已从左侧 OCR 原文卡片的小 Tab 调整为单篇详情页页面级 workspace。
- 单篇详情页现在默认进入 `批改工作台`，并可切换到 `原卷视图`。
- `EssaySourcePanel` 内部恢复为 `阅读定位 / 编辑 OCR`，不再承载原卷视图。
- `原卷视图` 当前为阶段三预留卷面批阅画布：原卷区域为视觉中心，左侧、右侧、底部预留未来批注空间。
- 当前不实现 OCR 坐标、图片框选、图片区域高亮、真实批注、假坐标或 AppState 数据结构变更。
- 本轮验证结果：
  - `npm.cmd test -- src/pages/EssayResultPage.test.tsx`：通过。
  - `npm.cmd run lint`：通过。
```

- [ ] **Step 2: Run focused verification**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
npm.cmd run lint
```

Expected:

```text
PASS src/pages/EssayResultPage.test.tsx
Lint passes without errors
```

- [ ] **Step 3: Commit status update**

Run:

```powershell
git add docs/current_development_status.md
git commit -m "docs: record page-level paper workspace"
```

---

## Task 6: Final Verification Before Completion

**Files:**

- Verify only; no planned file edits.

- [ ] **Step 1: Run final regression commands**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected:

```text
All test files pass
Lint passes without errors
Build completes successfully
```

- [ ] **Step 2: Confirm implementation scope**

Run:

```powershell
cd D:\wenjie-writewise-ai
git status --short --branch
git log --oneline -8
rg -n "IssueImageAnchor|OcrPage|OcrTextBlock|bbox|fake|假坐标|假批注|旁批" app\src
```

Expected:

```text
## codex/original-paper-view-roadmap-v02
```

The `rg` command should not find runtime OCR coordinate types, fake annotation implementation, fake coordinate UI, fake annotation UI, or unsupported naming in `app/src`.

- [ ] **Step 3: Final response**

Report:

```text
已完成“原卷视图修正为页面级卷面批阅画布 v0.2”。
已验证：npm.cmd test、npm.cmd run lint、npm.cmd run build。
未 push。
```

Do not push unless the user explicitly asks.

---

## Self-Review

- Spec coverage:
  - Page-level `批改工作台 / 原卷视图` switch is covered in Task 4.
  - `EssaySourcePanel` removing paper mode is covered in Task 2.
  - Local `workspaceMode` state is covered in Task 4.
  - Large image/placeholder canvas, reserved annotation areas, top navigation, and page counter are covered in Task 3.
  - True image URL priority is covered in Task 3.
  - Page index reset on essay switch is covered in Task 3.
  - No AppState, route, upload, progress, class review, OCR coordinate, fake overlay, or fake annotation changes are included.
  - Tests cover hidden grading content in paper mode and restored grading workflows after return.

- Review feedback incorporated:
  - Fixed `getWorkspaceModeButton` grading fallback string.
  - Added `previewUrl?: string` to `EssayPageWithPossibleImages`.
  - Added `useEffect(() => setPageIndex(0), [essay.id])`.
  - Removed red-test commit steps.
  - Replaced brittle score-text assertion with absence checks for grading UI.
  - Reaffirmed real image priority and large placeholder fallback.
  - Reaffirmed no large grading workspace refactor.
  - Reaffirmed no unsupported naming in runtime UI.

- Placeholder scan:
  - The plan contains concrete files, commands, expected results, and commit messages.
  - No unresolved placeholders are present.
