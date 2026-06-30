# Upload Batch Grouping Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current blocking manual upload grouping flow with batch image grouping: default single-page essays, fixed two-page grouping, mixed-pages selection/merge, per-group split, and OCR by essay group.

**Architecture:** Extract grouping behavior into `app/src/utils/essayGrouping.ts` so upload page rendering can derive essay groups from current pages and selected grouping mode. Keep the existing `confirmMockOcrEssay({ essayGroups })` app-state contract and keep all upload organizing state local to `UploadPage.tsx`.

**Tech Stack:** React, TypeScript, React Router, Vitest, Testing Library, localStorage for the mixed-pages guide preference, existing Tailwind utility classes.

---

## Files

- Create: `app/src/utils/essayGrouping.ts`
- Create: `app/src/utils/essayGrouping.test.ts`
- Modify: `app/src/pages/UploadPage.tsx`
- Modify: `app/src/pages/UploadPage.test.tsx`
- Modify: `docs/current_development_status.md`

## Task 1: Essay Grouping Utility

**Files:**
- Create: `app/src/utils/essayGrouping.ts`
- Create: `app/src/utils/essayGrouping.test.ts`

- [ ] **Step 1: Write the failing utility tests**

Create `app/src/utils/essayGrouping.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { EssayPage } from '../types'
import { createEssayImageGroups } from './essayGrouping'

const page = (index: number): EssayPage => ({
  id: `page-${index}`,
  label: `Page ${index}`,
  pageNumber: index,
  quality: 'clear',
  accent: '#2563eb',
})

describe('createEssayImageGroups', () => {
  it('creates one essay group per page in single mode', () => {
    const groups = createEssayImageGroups([page(1), page(2), page(3)], 'single')

    expect(groups.map((group) => group.pageIds)).toEqual([['page-1'], ['page-2'], ['page-3']])
  })

  it('creates fixed two-page groups and preserves page order', () => {
    const groups = createEssayImageGroups([page(1), page(2), page(3), page(4)], 'fixed-2')

    expect(groups.map((group) => group.pageIds)).toEqual([
      ['page-1', 'page-2'],
      ['page-3', 'page-4'],
    ])
  })

  it('keeps an odd final page as a single-page group in fixed two-page mode', () => {
    const groups = createEssayImageGroups([page(1), page(2), page(3), page(4), page(5)], 'fixed-2')

    expect(groups.map((group) => group.pageIds)).toEqual([
      ['page-1', 'page-2'],
      ['page-3', 'page-4'],
      ['page-5'],
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/utils/essayGrouping.test.ts
```

Expected: fail because `essayGrouping.ts` does not exist.

- [ ] **Step 3: Add the grouping utility**

Create `app/src/utils/essayGrouping.ts`:

```ts
import type { EssayPage } from '../types'

export type UploadGroupingMode = 'single' | 'fixed-2' | 'mixed'

export interface UploadEssayGroup {
  id: string
  pageIds: string[]
}

export function createEssayImageGroups(
  pages: EssayPage[],
  mode: Exclude<UploadGroupingMode, 'mixed'>,
): UploadEssayGroup[] {
  if (mode === 'single') {
    return pages.map((page, index) => ({
      id: `group-${index + 1}`,
      pageIds: [page.id],
    }))
  }

  const groups: UploadEssayGroup[] = []
  for (let index = 0; index < pages.length; index += 2) {
    groups.push({
      id: `group-${groups.length + 1}`,
      pageIds: pages.slice(index, index + 2).map((page) => page.id),
    })
  }
  return groups
}

export function renumberEssayGroups(groups: UploadEssayGroup[]): UploadEssayGroup[] {
  return groups
    .filter((group) => group.pageIds.length > 0)
    .map((group, index) => ({
      ...group,
      id: `group-${index + 1}`,
    }))
}
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```powershell
npm.cmd test -- src/utils/essayGrouping.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add app/src/utils/essayGrouping.ts app/src/utils/essayGrouping.test.ts
git commit -m "feat: add upload essay grouping helpers"
```

## Task 2: Upload Page Mode Selector

**Files:**
- Modify: `app/src/pages/UploadPage.tsx`
- Modify: `app/src/pages/UploadPage.test.tsx`

- [ ] **Step 1: Write the failing mode selector test**

Add this test to `app/src/pages/UploadPage.test.tsx`:

```tsx
it('shows batch grouping modes and removes old top-level grouping actions', () => {
  renderUploadPage()

  expect(screen.getByRole('button', { name: '一张一篇' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '每 2 张一篇' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '混合页数' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '开始模拟 OCR（预计 6 篇）' })).toBeInTheDocument()

  expect(screen.queryByRole('button', { name: '合并为多页作文' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '拆分页' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '手动分组' })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
npm.cmd test -- src/pages/UploadPage.test.tsx
```

Expected: fail because old controls are still present and new labels are missing.

- [ ] **Step 3: Replace the top-level grouping controls**

In `UploadPage.tsx`:

- Import `UploadGroupingMode`, `UploadEssayGroup`, `createEssayImageGroups`, and `renumberEssayGroups`.
- Replace `EssayGroupingMode = 'merged' | 'perPage' | 'manual'` with `UploadGroupingMode`.
- Initialize grouping mode as `'single'`.
- Replace old buttons with `一张一篇`, `每 2 张一篇`, `混合页数`.
- Render the primary OCR button as `开始模拟 OCR（预计 ${essaySubmissionCount} 篇）`.
- Remove top-level `合并为多页作文`, `拆分页`, and `手动分组` buttons.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```powershell
npm.cmd test -- src/pages/UploadPage.test.tsx
```

Expected: upload page tests pass after updating old expectations that referenced removed controls.

- [ ] **Step 5: Commit**

```powershell
git add app/src/pages/UploadPage.tsx app/src/pages/UploadPage.test.tsx
git commit -m "feat: add batch grouping mode selector"
```

## Task 3: Fixed Two-Page Grouping Preview And OCR

**Files:**
- Modify: `app/src/pages/UploadPage.tsx`
- Modify: `app/src/pages/UploadPage.test.tsx`

- [ ] **Step 1: Write the failing fixed-2 workflow test**

Add this test to `app/src/pages/UploadPage.test.tsx`:

```tsx
it('groups images into fixed two-page essays before OCR', async () => {
  const user = userEvent.setup()
  renderUploadToProgressFlow()

  await user.click(screen.getByRole('button', { name: '每 2 张一篇' }))

  expect(screen.getByText('当前 6 张图片，预计生成 3 篇作文')).toBeInTheDocument()
  expect(screen.getByText('作文 1 · 共 2 页')).toBeInTheDocument()
  expect(screen.getByText('作文 3 · 共 2 页')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '开始模拟 OCR（预计 3 篇）' }))
  await user.click(screen.getByRole('button', { name: '确认 OCR 文本' }))

  expect(screen.getByRole('heading', { name: '批改进度' })).toBeInTheDocument()
  expect(screen.getAllByText('作文 11').length).toBeGreaterThan(0)
  expect(screen.getAllByText('作文 13').length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
npm.cmd test -- src/pages/UploadPage.test.tsx
```

Expected: fail until preview and OCR use derived essay groups.

- [ ] **Step 3: Render essay group preview from derived groups**

In `UploadPage.tsx`:

- Derive `essayGroups` from `pages` and grouping mode.
- Render group cards titled `作文 N · 共 M 页`.
- In fixed-2 mode, show note if final group has one page and total page count is odd:

```text
最后 1 张图片未满 2 张，已作为单页作文保留。
```

- Build OCR drafts from `essayGroups` instead of raw `pages`.
- Keep one textarea per group after OCR starts.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```powershell
npm.cmd test -- src/pages/UploadPage.test.tsx
```

Expected: fixed-2 workflow passes and existing upload flows still pass.

- [ ] **Step 5: Commit**

```powershell
git add app/src/pages/UploadPage.tsx app/src/pages/UploadPage.test.tsx
git commit -m "feat: run upload ocr by essay groups"
```

## Task 4: Mixed Pages Guide

**Files:**
- Modify: `app/src/pages/UploadPage.tsx`
- Modify: `app/src/pages/UploadPage.test.tsx`

- [ ] **Step 1: Write the failing guide tests**

Add these tests to `app/src/pages/UploadPage.test.tsx`:

```tsx
it('shows a mixed-pages guide with dismiss and never-remind actions', async () => {
  const user = userEvent.setup()
  localStorage.removeItem('wenjie-hide-mixed-grouping-guide')
  renderUploadPage()

  await user.click(screen.getByRole('button', { name: '混合页数' }))

  expect(screen.getByText('混合页数模式：未合并的图片会默认作为单页作文。')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '知道了' }))
  expect(screen.queryByText('混合页数模式：未合并的图片会默认作为单页作文。')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '查看操作提示' })).toBeInTheDocument()
})

it('stores the mixed-pages never-remind preference locally', async () => {
  const user = userEvent.setup()
  localStorage.removeItem('wenjie-hide-mixed-grouping-guide')
  renderUploadPage()

  await user.click(screen.getByRole('button', { name: '混合页数' }))
  await user.click(screen.getByRole('button', { name: '不再提醒' }))

  expect(localStorage.getItem('wenjie-hide-mixed-grouping-guide')).toBe('true')
  expect(screen.queryByText('混合页数模式：未合并的图片会默认作为单页作文。')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
npm.cmd test -- src/pages/UploadPage.test.tsx
```

Expected: fail because guide controls do not exist.

- [ ] **Step 3: Implement the inline guide**

In `UploadPage.tsx`:

- Add `const mixedGuideStorageKey = 'wenjie-hide-mixed-grouping-guide'`.
- Add state `showMixedGuide`.
- When entering mixed mode, show guide unless localStorage value is `true`.
- `知道了` sets `showMixedGuide` to false.
- `不再提醒` writes to localStorage and hides the guide.
- `查看操作提示` sets `showMixedGuide` to true.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```powershell
npm.cmd test -- src/pages/UploadPage.test.tsx
```

Expected: guide tests pass.

- [ ] **Step 5: Commit**

```powershell
git add app/src/pages/UploadPage.tsx app/src/pages/UploadPage.test.tsx
git commit -m "feat: guide mixed upload grouping"
```

## Task 5: Mixed Pages Select, Merge, And Split

**Files:**
- Modify: `app/src/pages/UploadPage.tsx`
- Modify: `app/src/pages/UploadPage.test.tsx`

- [ ] **Step 1: Write the failing merge and split tests**

Add these tests to `app/src/pages/UploadPage.test.tsx`:

```tsx
it('merges selected pages into one essay group in mixed mode', async () => {
  const user = userEvent.setup()
  renderUploadPage()

  await user.click(screen.getByRole('button', { name: '混合页数' }))
  await user.click(screen.getByRole('button', { name: '选择 Page 2' }))
  await user.click(screen.getByRole('button', { name: '选择 Page 2' }))
  expect(screen.queryByRole('button', { name: '合并为一篇作文（已选 1 张）' })).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '选择 Page 2' }))
  await user.click(screen.getByRole('button', { name: '选择 Page 3' }))
  await user.click(screen.getByRole('button', { name: '合并为一篇作文（已选 2 张）' }))

  expect(screen.getByText('当前 6 张图片，预计生成 5 篇作文')).toBeInTheDocument()
  expect(screen.getByText('作文 2 · 共 2 页')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '拆分此作文 2' })).toBeInTheDocument()
})

it('splits a merged essay group back into single-page essays', async () => {
  const user = userEvent.setup()
  renderUploadPage()

  await user.click(screen.getByRole('button', { name: '混合页数' }))
  await user.click(screen.getByRole('button', { name: '选择 Page 2' }))
  await user.click(screen.getByRole('button', { name: '选择 Page 3' }))
  await user.click(screen.getByRole('button', { name: '合并为一篇作文（已选 2 张）' }))
  await user.click(screen.getByRole('button', { name: '拆分此作文 2' }))

  expect(screen.getByText('当前 6 张图片，预计生成 6 篇作文')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '拆分此作文 2' })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
npm.cmd test -- src/pages/UploadPage.test.tsx
```

Expected: fail because selection, merge, and split are not implemented.

- [ ] **Step 3: Implement mixed selection and merge**

In `UploadPage.tsx`:

- Track selected page ids with `selectedPageIds`.
- Page card button label should be `选择 ${page.label}`.
- Toggle selection on click.
- Show contextual action bar only when `selectedPageIds.length >= 2`.
- Merge selected pages by current display order into one group.
- Clear selection after merge.

- [ ] **Step 4: Implement group split**

In `UploadPage.tsx`:

- For groups with more than one page, render `拆分此作文 N`.
- Split turns that group into one single-page group per page id.
- Renumber groups after split.

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```powershell
npm.cmd test -- src/pages/UploadPage.test.tsx
```

Expected: merge and split tests pass.

- [ ] **Step 6: Commit**

```powershell
git add app/src/pages/UploadPage.tsx app/src/pages/UploadPage.test.tsx
git commit -m "feat: merge and split mixed upload groups"
```

## Task 6: Final Verification And Docs

**Files:**
- Modify: `docs/current_development_status.md`

- [ ] **Step 1: Run focused tests**

Run:

```powershell
npm.cmd test -- src/utils/essayGrouping.test.ts
npm.cmd test -- src/pages/UploadPage.test.tsx
npm.cmd test -- src/pages/ProgressPage.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 2: Run full verification**

Run:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected:

- 16 test files pass, with the new upload grouping tests included.
- Lint exits 0.
- Build exits 0.

- [ ] **Step 3: Browser verification**

Open:

```text
http://127.0.0.1:5173/tasks/task-1/upload
```

Verify:

- Top grouping modes are `一张一篇`, `每 2 张一篇`, `混合页数`.
- `每 2 张一篇` shows three groups for six current pages.
- `混合页数` shows the guide on first entry.
- `知道了`, `不再提醒`, and `查看操作提示` work.
- Selecting Page 2 and Page 3 shows `合并为一篇作文`.
- Merging Page 2 and Page 3 creates one two-page essay group.
- `拆分此作文` restores the pages to single-page groups.
- `开始模拟 OCR（预计 N 篇）` creates OCR drafts by group.
- Confirming OCR navigates to the progress page and queues essays.

- [ ] **Step 4: Update current status doc**

Update `docs/current_development_status.md` with:

```markdown
- Optimized upload organizing into batch grouping:
  - Default one image per essay.
  - Added fixed two-page grouping.
  - Replaced manual grouping with mixed-pages organizing.
  - Added mixed-pages guide with "知道了" and "不再提醒".
  - Added contextual merge and per-group split.
  - Batch OCR now runs by essay group.
```

- [ ] **Step 5: Commit docs**

Run:

```powershell
git add docs/current_development_status.md
git commit -m "docs: update batch upload grouping status"
```
