# Manual OCR Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual upload grouping mode that lets teachers split uploaded images into custom essay groups before confirming OCR into the grading queue.

**Architecture:** Keep the feature local to `UploadPage.tsx`. The page owns manual group state as page-id arrays, derives non-empty groups from current pages, and still submits through the existing `confirmMockOcrEssay({ essayGroups })` API.

**Tech Stack:** React, TypeScript, React Router, Vitest, Testing Library, existing Tailwind utility classes.

---

## Files

- Modify: `app/src/pages/UploadPage.tsx`
- Modify: `app/src/pages/UploadPage.test.tsx`
- Modify: `docs/current_development_status.md`

## Task 1: Manual Grouping UI State

- [ ] **Step 1: Write the failing test**

Add this test to `app/src/pages/UploadPage.test.tsx`:

```tsx
it('shows manual essay groups and updates essay count when pages move between groups', async () => {
  const user = userEvent.setup()
  renderUploadPage()

  await user.click(screen.getByRole('button', { name: '手动分组' }))

  expect(screen.getByText('作文组 1')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '新增作文组' })).toBeInTheDocument()
  expect(screen.getByText('确认 OCR 后将提交 1 篇作文')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '新增作文组' }))
  await user.click(screen.getByRole('button', { name: '将 Page 3 移到下一篇' }))

  expect(screen.getByText('作文组 2')).toBeInTheDocument()
  expect(screen.getByText('确认 OCR 后将提交 2 篇作文')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/UploadPage.test.tsx
```

Expected: fail because the `手动分组` button and manual group controls do not exist.

- [ ] **Step 3: Implement the minimal UI state**

In `UploadPage.tsx`:

- Extend `EssayGroupingMode` to include `'manual'`.
- Add `manualGroups` state initialized with all current pages in group 1.
- Add helpers:
  - `getNonEmptyManualGroups`
  - `syncManualGroupsAfterPageChange`
  - `addManualGroup`
  - `movePageToManualGroup`
- Add a third grouping button labeled `手动分组`.
- Render manual group panels when selected.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```powershell
npm.cmd test -- src/pages/UploadPage.test.tsx
```

Expected: all upload page tests pass.

- [ ] **Step 5: Commit**

```powershell
git add app/src/pages/UploadPage.tsx app/src/pages/UploadPage.test.tsx
git commit -m "feat: add manual upload grouping controls"
```

## Task 2: Manual OCR Drafts And Queue Creation

- [ ] **Step 1: Write the failing test**

Add this test to `app/src/pages/UploadPage.test.tsx`:

```tsx
it('confirms manually grouped OCR drafts as separate queued essays', async () => {
  const user = userEvent.setup()
  renderUploadToProgressFlow()

  await user.click(screen.getByRole('button', { name: '手动分组' }))
  await user.click(screen.getByRole('button', { name: '新增作文组' }))
  await user.click(screen.getByRole('button', { name: '将 Page 3 移到下一篇' }))
  await user.click(screen.getByRole('button', { name: '开始模拟 OCR' }))

  expect(screen.getByRole('textbox', { name: '作文组 1 OCR 文本' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: '作文组 2 OCR 文本' })).toBeInTheDocument()

  await user.clear(screen.getByRole('textbox', { name: '作文组 1 OCR 文本' }))
  await user.type(screen.getByRole('textbox', { name: '作文组 1 OCR 文本' }), 'Manual group one text')
  await user.clear(screen.getByRole('textbox', { name: '作文组 2 OCR 文本' }))
  await user.type(screen.getByRole('textbox', { name: '作文组 2 OCR 文本' }), 'Manual group two text')
  await user.click(screen.getByRole('button', { name: '确认 OCR 文本' }))

  expect(screen.getByRole('heading', { name: '批改进度' })).toBeInTheDocument()
  expect(screen.getAllByText('作文 11').length).toBeGreaterThan(0)
  expect(screen.getAllByText('作文 12').length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npm.cmd test -- src/pages/UploadPage.test.tsx
```

Expected: fail because manual OCR draft textareas do not exist.

- [ ] **Step 3: Implement manual OCR draft flow**

In `UploadPage.tsx`:

- Replace single-purpose `mockOcrDraft` usage with manual draft derivation when in manual mode.
- Add `manualOcrDrafts: Record<string, string>`.
- `startMockOcr` should populate one draft per non-empty manual group.
- OCR section should render one textarea per manual group in manual mode.
- `getEssayGroups` should return one group per non-empty manual group using the matching OCR draft.
- Disable confirm when every manual draft is blank.

- [ ] **Step 4: Run upload tests**

Run:

```powershell
npm.cmd test -- src/pages/UploadPage.test.tsx
```

Expected: all upload page tests pass.

- [ ] **Step 5: Commit**

```powershell
git add app/src/pages/UploadPage.tsx app/src/pages/UploadPage.test.tsx
git commit -m "feat: submit manual ocr groups"
```

## Task 3: Verification And Memory Update

- [ ] **Step 1: Run focused tests**

```powershell
npm.cmd test -- src/pages/UploadPage.test.tsx
npm.cmd test -- src/pages/ProgressPage.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 2: Run full verification**

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected: all pass.

- [ ] **Step 3: Browser verification**

Open:

```text
http://127.0.0.1:5173/tasks/task-1/upload
```

Verify:

- `手动分组` button appears beside the existing grouping buttons.
- `新增作文组` creates another group.
- Page controls can move a page to another group.
- Summary count updates.
- Starting OCR shows one editable textarea per non-empty group.
- Confirming OCR navigates to progress and creates multiple queued essays.

- [ ] **Step 4: Update memory file**

Update `docs/current_development_status.md` with the manual grouping feature and latest verification results.

- [ ] **Step 5: Commit docs**

```powershell
git add docs/current_development_status.md
git commit -m "docs: update manual ocr grouping status"
```
