# Original Paper Page Workspace v0.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `原卷视图` out of `EssaySourcePanel` and implement it as a page-level `paper` workspace inside `EssayResultPage`.

**Architecture:** `EssayResultPage` owns a local `workspaceMode: 'grading' | 'paper'`. The existing grading workspace remains largely intact. `EssaySourcePanel` returns to source-only modes (`read | edit`), while a new focused `OriginalPaperWorkspace` component renders the page-level canvas with a large original-paper stage and left/right/bottom annotation placeholders.

**Tech Stack:** React, TypeScript, React Router, React Testing Library, Vitest, Tailwind utility classes, existing `Essay` / `EssayPage` mock data.

---

## File Structure

- Create: `app/src/components/OriginalPaperWorkspace.tsx`
  - Renders the `paper` workspace only.
  - Shows top navigation, large paper image/placeholder stage, page counter, and annotation placeholder rails.
  - Uses local component state for current paper page only.
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
  - Preserve existing `activeDetailTab`, `activeIssueId`, class review material flow, full-text revision, teacher feedback, original-image modal, and previous/next essay navigation.

- Modify: `app/src/pages/EssayResultPage.test.tsx`
  - Replace the old source-panel paper tests with page-level workspace tests.
  - Confirm `EssaySourcePanel` no longer exposes `原卷视图` as a source mode.
  - Confirm paper workspace hides grading content and returning restores existing workflows.

- Modify: `docs/current_development_status.md`
  - Record that `原卷视图` was corrected from left-side small tab to page-level workspace.
  - Record verification results.

No AppStateContext, upload page, progress page, class review page, OCR coordinate model, image anchor model, or route changes in this round.

---

### Task 1: Replace Tests for Page-Level Paper Workspace

**Files:**
- Modify: `app/src/pages/EssayResultPage.test.tsx`

- [ ] **Step 1: Narrow source mode helper**

Replace:

```ts
function getSourceModeButton(mode: 'read' | 'paper' | 'edit') {
  const keywordsByMode = {
    read: ['阅读定位', '阅读', '闃呰'],
    paper: ['原卷视图', '原卷', '鍘熷嵎', '瑙嗗浘'],
    edit: ['编辑 OCR', '缂栬緫 OCR', 'OCR'],
  } satisfies Record<typeof mode, string[]>
  const modeButton = screen
    .getAllByRole('button')
    .find((button) => keywordsByMode[mode].some((keyword) => button.textContent?.includes(keyword)))

  if (!modeButton) {
    throw new Error(`Source mode button not found: ${mode}`)
  }

  return modeButton
}
```

With:

```ts
function getSourceModeButton(mode: 'read' | 'edit') {
  const keywordsByMode = {
    read: ['阅读定位', '阅读', '闃呰'],
    edit: ['编辑 OCR', '缂栬緫 OCR', 'OCR'],
  } satisfies Record<typeof mode, string[]>
  const modeButton = screen
    .getAllByRole('button')
    .find((button) => keywordsByMode[mode].some((keyword) => button.textContent?.includes(keyword)))

  if (!modeButton) {
    throw new Error(`Source mode button not found: ${mode}`)
  }

  return modeButton
}
```

- [ ] **Step 2: Add a page workspace helper**

Add below `getSourceModeButton`:

```ts
function getWorkspaceModeButton(mode: 'grading' | 'paper') {
  const keywordsByMode = {
    grading: ['批改工作台', '鎵规敼宸ヤ綔鍙?],
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

- [ ] **Step 3: Update the source mode assertion**

In `highlights the matching source text when an issue card is selected`, replace:

```ts
expect(getSourceModeButton('read')).toBeInTheDocument()
expect(getSourceModeButton('paper')).toBeInTheDocument()
expect(getSourceModeButton('edit')).toBeInTheDocument()
```

With:

```ts
expect(getWorkspaceModeButton('grading')).toHaveAttribute('aria-pressed', 'true')
expect(getWorkspaceModeButton('paper')).toHaveAttribute('aria-pressed', 'false')
expect(getSourceModeButton('read')).toBeInTheDocument()
expect(getSourceModeButton('edit')).toBeInTheDocument()
expect(
  screen
    .getAllByRole('button')
    .filter((button) => button.textContent?.includes('原卷视图') || button.textContent?.includes('鍘熷嵎瑙嗗浘')),
).toHaveLength(1)
```

- [ ] **Step 4: Remove old source-panel paper tests**

Delete the entire test block named `shows the original paper view placeholder without text issue markers`.

Delete the entire test block named `restores OCR reading markers after switching away from original paper view`.

- [ ] **Step 5: Add page-level paper workspace test**

Add this test before `saves teacher comment adjustments with lightweight feedback`:

```ts
it('switches to a page-level original paper workspace without grading content', async () => {
  const user = userEvent.setup()
  const view = renderEssayDetail()

  expect(getWorkspaceModeButton('grading')).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('tab', { name: '评分诊断' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: '问题批改' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: '全文优化' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: '教师反馈' })).toBeInTheDocument()
  expect(getSourceModeButton('read')).toBeInTheDocument()
  expect(getSourceModeButton('edit')).toBeInTheDocument()
  expect(view.container.querySelector('[data-issue-source="language"]')).not.toBeNull()

  await user.click(getWorkspaceModeButton('paper'))

  expect(getWorkspaceModeButton('paper')).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('heading', { name: '原卷视图 · 阶段三预留' })).toBeInTheDocument()
  expect(screen.getByText('左侧批注区')).toBeInTheDocument()
  expect(screen.getByText('右侧批注区')).toBeInTheDocument()
  expect(screen.getByText('底部批注区')).toBeInTheDocument()
  expect(screen.getByText('第 1 / 1 页')).toBeInTheDocument()
  expect(screen.getByTestId('paper-image-stage')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '返回批改工作台' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '返回批改进度' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '上一篇' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '下一篇' })).toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: '评分诊断' })).not.toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: '问题批改' })).not.toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: '全文优化' })).not.toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: '教师反馈' })).not.toBeInTheDocument()
  expect(screen.queryByLabelText('学生作文原文')).not.toBeInTheDocument()
  expect(view.container.querySelector('[data-issue-source="language"]')).toBeNull()
  expect(screen.queryByText('诊断摘要')).not.toBeInTheDocument()
  expect(screen.queryByText('/ 15')).not.toBeInTheDocument()
  expect(screen.queryByText(/AI 置信度/)).not.toBeInTheDocument()
  expect(screen.queryByText(/假坐标|假批注|图片框选/)).not.toBeInTheDocument()
})
```

If the test file still uses mojibake visible labels, use the actual rendered strings from existing tests for `评分诊断 / 问题批改 / 全文优化 / 教师反馈 / 学生作文原文 / AI 置信度`. For new UI text, use clear Chinese strings.

- [ ] **Step 6: Add return-to-grading regression test**

Add this test after the page-level paper workspace test:

```ts
it('returns from original paper workspace with grading workflows intact', async () => {
  const user = userEvent.setup()
  const view = renderEssayDetail()

  await user.click(getWorkspaceModeButton('paper'))
  await user.click(screen.getByRole('button', { name: '返回批改工作台' }))

  expect(getWorkspaceModeButton('grading')).toHaveAttribute('aria-pressed', 'true')
  expect(getSourceModeButton('read')).toBeInTheDocument()
  expect(getSourceModeButton('edit')).toBeInTheDocument()
  expect(view.container.querySelector('[data-issue-source="language"]')).not.toBeNull()

  await user.click(screen.getByRole('tab', { name: '问题批改' }))
  await user.click(getIssueCardButton(/I suggest you joins the club\./))
  expect(screen.getByText('已定位')).toBeInTheDocument()

  await user.click(getSourceModeButton('edit'))
  expect(screen.getByLabelText('学生作文原文')).toBeInTheDocument()

  await user.click(getSourceModeButton('read'))
  await user.click(screen.getAllByRole('button', { name: '加入班级总览' })[0])
  expect(screen.getByRole('button', { name: '已加入班级总览' })).toBeInTheDocument()

  await user.click(screen.getByRole('tab', { name: '全文优化' }))
  expect(screen.getByRole('heading', { name: '全文优化稿' })).toBeInTheDocument()

  await user.click(screen.getByRole('tab', { name: '教师反馈' }))
  expect(screen.getByLabelText('AI 总评')).toBeInTheDocument()
})
```

Use the actual rendered mojibake strings if existing tests require them. The behavioral checks should remain the same.

- [ ] **Step 7: Run the focused test and verify it fails for the expected reason**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected:

```text
FAIL src/pages/EssayResultPage.test.tsx
```

The expected failure is missing page-level workspace controls and old source panel still containing `paper`.

- [ ] **Step 8: Commit failing tests**

Run:

```powershell
git add app/src/pages/EssayResultPage.test.tsx
git commit -m "test: cover page-level original paper workspace"
```

---

### Task 2: Restore `EssaySourcePanel` to OCR Source Modes Only

**Files:**
- Modify: `app/src/components/EssaySourcePanel.tsx`

- [ ] **Step 1: Remove unused paper workspace imports and constants**

Remove:

```ts
import { EssayPageSorter } from './EssayPageSorter'
```

Replace:

```ts
type SourcePanelMode = 'read' | 'paper' | 'edit'

const SOURCE_PANEL_MODE_OPTIONS: Array<{ mode: SourcePanelMode; label: string }> = [
  { mode: 'read', label: '阅读定位' },
  { mode: 'paper', label: '原卷视图' },
  { mode: 'edit', label: '编辑 OCR' },
]

const UNSUPPORTED_PAPER_FEATURES = [
  '图片批注',
  '框选',
  '手写痕迹',
  '拖拽批注',
  '自由绘图',
  'OCR 坐标定位',
  '图片与问题卡片联动',
]
```

With:

```ts
type SourcePanelMode = 'read' | 'edit'

const SOURCE_PANEL_MODE_OPTIONS: Array<{ mode: SourcePanelMode; label: string }> = [
  { mode: 'read', label: '阅读定位' },
  { mode: 'edit', label: '编辑 OCR' },
]
```

- [ ] **Step 2: Remove the `paper` rendering branch**

Remove the full branch that starts with:

```tsx
) : mode === 'paper' ? (
```

That branch currently renders the small in-panel paper placeholder. Delete that entire branch, including the wrapping scroll container whose class list starts with `mt-4 max-h-[520px] overflow-y-auto`.

Then keep the conditional as a two-way edit/read branch:

```tsx
{mode === 'edit' ? (
  <textarea
    aria-label="学生作文原文"
    value={essay.ocrText}
    onChange={(event) => onOcrTextChange(essay.id, event.target.value)}
    className="mt-4 min-h-[320px] w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-800 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
  />
) : (
  <div className="mt-4 max-h-[520px] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
    {/* keep the existing read-mode source text branch unchanged */}
  </div>
)}
```

The read-mode source text branch must still include the fallback message, `splitTextByIssueMarkers`, `data-issue-source`, and `data-active`.

- [ ] **Step 3: Run focused test**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected: still FAIL, because page-level workspace is not implemented yet.

- [ ] **Step 4: Commit source panel cleanup**

Run:

```powershell
git add app/src/components/EssaySourcePanel.tsx
git commit -m "refactor: keep source panel to OCR modes"
```

---

### Task 3: Add Page-Level `OriginalPaperWorkspace`

**Files:**
- Create: `app/src/components/OriginalPaperWorkspace.tsx`

- [ ] **Step 1: Create the component file**

Add:

```tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Essay, EssayPage } from '../types'

type EssayPageWithPossibleImages = EssayPage & {
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

const unsupportedPaperFeatures = [
  '图片批注',
  '图片框选',
  '手写痕迹',
  '拖拽批注',
  '自由绘图',
  'OCR 坐标定位',
  '点击批注定位图片区域',
  '点击图片区域定位批注',
  '右侧问题卡片定位到图片区域',
]

function getOriginalImageUrl(page?: EssayPage) {
  if (!page) return undefined
  const pageWithImages = page as EssayPageWithPossibleImages
  return pageWithImages.previewUrl ?? pageWithImages.imageUrl ?? pageWithImages.imageUrls?.[0] ?? pageWithImages.url
}

function PaperEssaySwitchLink({
  direction,
  essayId,
  taskId,
}: {
  direction: 'previous' | 'next'
  essayId?: string
  taskId: string
}) {
  const label = direction === 'previous' ? '上一篇' : '下一篇'
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight
  const className = 'tech-focus inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-semibold transition'

  if (!essayId) {
    return (
      <button
        type="button"
        disabled
        className={`${className} cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400`}
      >
        {direction === 'previous' ? <Icon className="h-4 w-4" /> : null}
        {label}
        {direction === 'next' ? <Icon className="h-4 w-4" /> : null}
      </button>
    )
  }

  return (
    <Link
      to={`/tasks/${taskId}/essays/${essayId}`}
      className={`${className} border-slate-200 bg-white text-slate-700 hover:border-cyan-200 hover:bg-cyan-50`}
    >
      {direction === 'previous' ? <Icon className="h-4 w-4" /> : null}
      {label}
      {direction === 'next' ? <Icon className="h-4 w-4" /> : null}
    </Link>
  )
}

export function OriginalPaperWorkspace({
  essay,
  taskId,
  previousEssayId,
  nextEssayId,
  onBackToGrading,
}: OriginalPaperWorkspaceProps) {
  const [pageIndex, setPageIndex] = useState(0)
  const pages = essay.pages
  const currentPage = pages[pageIndex]
  const originalImageUrl = getOriginalImageUrl(currentPage)
  const pageCount = Math.max(pages.length, 1)

  return (
    <section data-testid="paper-workspace" className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onBackToGrading}
              className="tech-focus inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50"
            >
              <ArrowLeft className="h-4 w-4" />
              返回批改工作台
            </button>
            <Link
              to={`/tasks/${taskId}/progress`}
              className="tech-focus inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50"
            >
              返回批改进度
            </Link>
          </div>
          <div className="text-center">
            <h2 className="text-base font-semibold text-slate-950">{essay.essayNumber} · 原卷视图</h2>
            <p className="mt-0.5 text-xs text-slate-500">原卷视图 · 阶段三预留</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PaperEssaySwitchLink direction="previous" essayId={previousEssayId} taskId={taskId} />
            <PaperEssaySwitchLink direction="next" essayId={nextEssayId} taskId={taskId} />
          </div>
        </div>
      </div>

      <div
        data-testid="paper-canvas"
        className="grid gap-3 rounded-lg border border-slate-200 bg-slate-100 p-3 xl:grid-cols-[220px_minmax(520px,1fr)_280px] xl:grid-rows-[minmax(560px,70vh)_auto]"
      >
        <aside className="rounded-lg border border-dashed border-slate-300 bg-white/80 p-4">
          <h3 className="text-sm font-semibold text-slate-800">左侧批注区</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">后续用于显示靠近卷面左侧的批注。</p>
        </aside>

        <div
          data-testid="paper-image-stage"
          className="flex min-h-[560px] items-center justify-center overflow-hidden rounded-lg border border-slate-300 bg-white p-5"
        >
          {originalImageUrl ? (
            <img
              src={originalImageUrl}
              alt={`${essay.essayNumber} 原卷第 ${pageIndex + 1} 页`}
              className="max-h-[72vh] w-full object-contain"
            />
          ) : (
            <div
              className="flex min-h-[520px] w-full max-w-3xl flex-col items-center justify-center rounded-lg border border-slate-300 bg-white p-8 text-center"
              style={{
                background: currentPage?.accent
                  ? `linear-gradient(135deg, ${currentPage.accent}22, #ffffff)`
                  : undefined,
              }}
            >
              <h3 className="text-lg font-semibold text-slate-800">当前作文暂无原卷图片预览</h3>
              <p className="mt-3 max-w-md text-sm leading-6 text-slate-500">
                后续接入 OCR 坐标后，将在此处展示原卷批阅能力。
              </p>
            </div>
          )}
        </div>

        <aside className="rounded-lg border border-dashed border-slate-300 bg-white/80 p-4">
          <h3 className="text-sm font-semibold text-slate-800">右侧批注区</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            后续用于显示语言问题、逻辑问题和表达问题的批注卡片。
          </p>
          <p className="mt-4 text-xs font-semibold text-slate-500">当前不支持</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {unsupportedPaperFeatures.map((feature) => (
              <span
                key={feature}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600"
              >
                {feature}
              </span>
            ))}
          </div>
        </aside>

        <section className="rounded-lg border border-dashed border-slate-300 bg-white/80 p-4 xl:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">底部批注区</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                后续用于显示综合批注、跨句批注或较长说明。
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-600">
              <button
                type="button"
                disabled={pageIndex === 0}
                onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
                className="tech-focus rounded-lg border border-slate-200 bg-white px-3 py-2 disabled:cursor-not-allowed disabled:text-slate-300"
              >
                上一页
              </button>
              <span>第 {pageIndex + 1} / {pageCount} 页</span>
              <button
                type="button"
                disabled={pageIndex >= pages.length - 1}
                onClick={() => setPageIndex((current) => Math.min(pages.length - 1, current + 1))}
                className="tech-focus rounded-lg border border-slate-200 bg-white px-3 py-2 disabled:cursor-not-allowed disabled:text-slate-300"
              >
                下一页
              </button>
            </div>
          </div>
        </section>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Run focused test**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected: still FAIL, because `EssayResultPage` does not render the component yet.

- [ ] **Step 3: Commit component**

Run:

```powershell
git add app/src/components/OriginalPaperWorkspace.tsx
git commit -m "feat: add original paper workspace canvas"
```

---

### Task 4: Wire Page-Level Workspace Mode in `EssayResultPage`

**Files:**
- Modify: `app/src/pages/EssayResultPage.tsx`

- [ ] **Step 1: Import the new component**

Add:

```ts
import { OriginalPaperWorkspace } from '../components/OriginalPaperWorkspace'
```

- [ ] **Step 2: Add workspace mode type and state**

After `type EssayDetailTab = 'scoring' | 'issues' | 'revision' | 'feedback'`, add:

```ts
type EssayWorkspaceMode = 'grading' | 'paper'
```

Inside `EssayResultPage`, after `activeDetailTab` state, add:

```ts
const [workspaceMode, setWorkspaceMode] = useState<EssayWorkspaceMode>('grading')
```

- [ ] **Step 3: Add the page-level mode switch**

Inside the returned `<div className="space-y-5">`, immediately before the existing top action region, add:

```tsx
<div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
  {[
    { mode: 'grading' as const, label: '批改工作台' },
    { mode: 'paper' as const, label: '原卷视图' },
  ].map((modeOption) => (
    <button
      key={modeOption.mode}
      type="button"
      aria-pressed={workspaceMode === modeOption.mode}
      onClick={() => setWorkspaceMode(modeOption.mode)}
      className={`tech-focus rounded-md px-4 py-2 text-sm font-semibold transition ${
        workspaceMode === modeOption.mode ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'
      }`}
    >
      {modeOption.label}
    </button>
  ))}
</div>
```

- [ ] **Step 4: Conditionally render paper workspace before grading content**

After the workspace switch, render:

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
    {/* existing top action region, grading grid, and bottom ReviewActionBar */}
  </>
)}
```

Move the existing top action region, grading grid, and bottom `ReviewActionBar` inside the `grading` fragment without changing their internals. Keep the `showOriginalImage` modal outside this conditional so the existing original image modal still works in grading mode.

- [ ] **Step 5: Preserve grading behavior**

Do not change the existing `EssaySourcePanel`, `IssueCorrectionList`, `FullTextRevisionPanel`, or teacher-feedback JSX blocks except for indentation needed to wrap them in the grading fragment.

Do not move `activeDetailTab`, `activeIssueId`, `reviewIssueItems`, `sourceIssueMarkers`, `getMaterialInput`, `addClassReviewMaterial`, or `isClassReviewMaterialAdded` into the paper component.

- [ ] **Step 6: Run focused test**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected:

```text
PASS src/pages/EssayResultPage.test.tsx
```

- [ ] **Step 7: Commit page wiring**

Run:

```powershell
git add app/src/pages/EssayResultPage.tsx
git commit -m "feat: switch essay detail to paper workspace"
```

---

### Task 5: Update Progress Memory and Run Focused Verification

**Files:**
- Modify: `docs/current_development_status.md`

- [ ] **Step 1: Add the new progress entry**

Near the top of `docs/current_development_status.md`, after the `最后更新：2026-07-02` line, add:

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

### Task 6: Final Verification Before Completion

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
rg -n "旁批|IssueImageAnchor|OcrPage|OcrTextBlock|bbox|fake|假坐标|假批注" app\src
```

Expected:

```text
## codex/original-paper-view-roadmap-v02
```

The `rg` command may find existing design-doc content only if run outside `app\src`; within `app\src` it should not find runtime OCR coordinate types or fake annotation implementation. Chinese strings `假坐标` and `假批注` should not appear in runtime UI.

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
  - Large image/placeholder canvas, annotation rails, top navigation, and page counter are covered in Task 3.
  - No AppState, route, upload, progress, class review, OCR coordinate, fake overlay, or fake annotation changes are included.
  - Tests cover hidden grading content in paper mode and restored grading workflows after return.

- Placeholder scan:
  - The plan contains concrete files, code, commands, expected results, and commit messages.
  - No unresolved placeholders are present.

- Type consistency:
  - `EssayWorkspaceMode` is local to `EssayResultPage`.
  - `SourcePanelMode` is local to `EssaySourcePanel`.
  - `OriginalPaperWorkspace` uses existing `Essay` and `EssayPage` types and a local non-persistent type guard for possible image URL fields.
