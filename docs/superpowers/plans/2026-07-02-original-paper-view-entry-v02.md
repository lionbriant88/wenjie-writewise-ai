# Original Paper View Entry v0.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight `原卷视图` mode to the essay detail source panel, showing a stage-three placeholder and original image preview without implementing image-level review.

**Architecture:** Keep the change local to the essay detail left source panel. Extend the existing source panel mode from `read | edit` to `read | paper | edit`, reuse `EssayPageSorter` for image preview, and preserve all existing OCR text marker behavior in `read` mode only.

**Tech Stack:** React, TypeScript, React Testing Library, Vitest, Tailwind utility classes, existing mock essay page data.

---

## File Structure

- Modify: `app/src/components/EssaySourcePanel.tsx`
  - Owns the left-side source panel modes.
  - Add `paper` mode and render the `原卷视图 · 阶段三预留` placeholder.
  - Reuse `EssayPageSorter` to preview `essay.pages`.

- Modify: `app/src/pages/EssayResultPage.test.tsx`
  - Add regression coverage for the new `原卷视图` mode.
  - Confirm read-mode issue markers are hidden in `原卷视图`.
  - Confirm switching back to `阅读定位` restores text markers.

- Modify: `docs/current_development_status.md`
  - Record the completed `原卷视图入口与原卷批阅路线占位 v0.2` progress and verification commands.

No AppState, data model, upload page, progress page, class review page, OCR coordinate, or image anchor files change in this round.

---

### Task 1: Add Failing Tests for `原卷视图`

**Files:**
- Modify: `app/src/pages/EssayResultPage.test.tsx`

- [ ] **Step 1: Extend the source mode helper**

Replace the existing helper:

```ts
function getSourceModeButton(mode: 'read' | 'edit') {
  const keyword = mode === 'read' ? '闃呰' : 'OCR'
  const modeButton = screen.getAllByRole('button').find((button) => button.textContent?.includes(keyword))

  if (!modeButton) {
    throw new Error(`Source mode button not found: ${mode}`)
  }

  return modeButton
}
```

With this implementation:

```ts
function getSourceModeButton(mode: 'read' | 'paper' | 'edit') {
  const keywordByMode = {
    read: '阅读定位',
    paper: '原卷视图',
    edit: '编辑 OCR',
  }
  const keyword = keywordByMode[mode]
  const modeButton = screen.getAllByRole('button').find((button) => button.textContent?.includes(keyword))

  if (!modeButton) {
    throw new Error(`Source mode button not found: ${mode}`)
  }

  return modeButton
}
```

- [ ] **Step 2: Update the existing source mode assertion**

In the test `highlights the matching source text when an issue card is selected`, replace:

```ts
expect(screen.getByRole('button', { name: '闃呰瀹氫綅' })).toBeInTheDocument()
expect(screen.getByRole('button', { name: '缂栬緫 OCR' })).toBeInTheDocument()
```

With:

```ts
expect(getSourceModeButton('read')).toBeInTheDocument()
expect(getSourceModeButton('paper')).toBeInTheDocument()
expect(getSourceModeButton('edit')).toBeInTheDocument()
```

- [ ] **Step 3: Add the placeholder rendering test**

Add this test near the end of the existing `describe('EssayResultPage teacher decision workflow', () => {` block, before the closing `})`:

```ts
it('shows the original paper view placeholder without text issue markers', async () => {
  const user = userEvent.setup()
  const view = renderEssayDetail()

  expect(view.container.querySelector('[data-issue-source="language"]')).not.toBeNull()
  expect(view.container.querySelector('[data-issue-source="logic"]')).not.toBeNull()

  await user.click(getSourceModeButton('paper'))

  expect(screen.getByRole('heading', { name: '原卷视图 · 阶段三预留' })).toBeInTheDocument()
  expect(screen.getByText(/卷面定位/)).toBeInTheDocument()
  expect(screen.getByText(/图片区域高亮/)).toBeInTheDocument()
  expect(screen.getByText(/批注卡片联动/)).toBeInTheDocument()
  expect(screen.getByText('暂不支持')).toBeInTheDocument()
  expect(screen.getByText(/图片批注/)).toBeInTheDocument()
  expect(screen.getByText(/框选/)).toBeInTheDocument()
  expect(screen.getByText(/手写痕迹/)).toBeInTheDocument()
  expect(screen.getByText(/拖拽批注/)).toBeInTheDocument()
  expect(screen.getByText(/OCR 坐标定位/)).toBeInTheDocument()
  expect(screen.getByText('Page 1')).toBeInTheDocument()
  expect(view.container.querySelector('[data-issue-source="language"]')).toBeNull()
  expect(view.container.querySelector('[data-issue-source="logic"]')).toBeNull()
  expect(screen.queryByLabelText('学生作文原文')).not.toBeInTheDocument()
  expect(screen.queryByText(/旁批/)).not.toBeInTheDocument()
})
```

- [ ] **Step 4: Add the mode round-trip test**

Add this test in the same describe block:

```ts
it('restores OCR reading markers after switching away from original paper view', async () => {
  const user = userEvent.setup()
  const view = renderEssayDetail()

  await user.click(getSourceModeButton('paper'))
  expect(view.container.querySelector('[data-issue-source="language"]')).toBeNull()

  await user.click(getSourceModeButton('read'))

  expect(view.container.querySelector('[data-issue-source="language"]')).not.toBeNull()
  expect(view.container.querySelector('[data-issue-source="logic"]')).not.toBeNull()
})
```

- [ ] **Step 5: Run focused test and verify it fails for the expected reason**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected:

```text
FAIL src/pages/EssayResultPage.test.tsx
Source mode button not found: paper
```

- [ ] **Step 6: Commit the failing test**

Run:

```powershell
git add app/src/pages/EssayResultPage.test.tsx
git commit -m "test: cover original paper view entry"
```

---

### Task 2: Implement `原卷视图` in the Source Panel

**Files:**
- Modify: `app/src/components/EssaySourcePanel.tsx`

- [ ] **Step 1: Import the image preview list component**

Change the import section from:

```ts
import { Image } from 'lucide-react'
import type { Essay } from '../types'
```

To:

```ts
import { Image } from 'lucide-react'
import type { Essay } from '../types'
import { EssayPageSorter } from './EssayPageSorter'
```

- [ ] **Step 2: Add a mode type and option list**

Add these declarations after the props interface:

```ts
type SourcePanelMode = 'read' | 'paper' | 'edit'

const sourcePanelModes: Array<{ id: SourcePanelMode; label: string }> = [
  { id: 'read', label: '阅读定位' },
  { id: 'paper', label: '原卷视图' },
  { id: 'edit', label: '编辑 OCR' },
]
```

- [ ] **Step 3: Update the mode state**

Replace:

```ts
const [mode, setMode] = useState<'read' | 'edit'>('read')
```

With:

```ts
const [mode, setMode] = useState<SourcePanelMode>('read')
```

- [ ] **Step 4: Render three source mode buttons**

Replace the existing mode button block:

```tsx
{(['read', 'edit'] as const).map((modeOption) => (
  <button
    key={modeOption}
    type="button"
    onClick={() => setMode(modeOption)}
    className={`tech-focus rounded-md px-3 py-1.5 text-xs font-semibold transition ${
      mode === modeOption ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'
    }`}
  >
    {modeOption === 'read' ? '闃呰瀹氫綅' : '缂栬緫 OCR'}
  </button>
))}
```

With:

```tsx
{sourcePanelModes.map((modeOption) => (
  <button
    key={modeOption.id}
    type="button"
    onClick={() => setMode(modeOption.id)}
    className={`tech-focus rounded-md px-3 py-1.5 text-xs font-semibold transition ${
      mode === modeOption.id ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'
    }`}
  >
    {modeOption.label}
  </button>
))}
```

- [ ] **Step 5: Add the original paper placeholder branch**

Replace the current conditional rendering block:

```tsx
{mode === 'edit' ? (
  <textarea
    aria-label="瀛︾敓浣滄枃鍘熸枃"
    value={essay.ocrText}
    onChange={(event) => onOcrTextChange(essay.id, event.target.value)}
    className="mt-4 min-h-[320px] w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-800 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
  />
) : (
  <div className="mt-4 max-h-[520px] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
    {/* Current read-mode source text branch is here before this task. */}
  </div>
)}
```

With a three-way branch:

```tsx
{mode === 'edit' ? (
  <textarea
    aria-label="学生作文原文"
    value={essay.ocrText}
    onChange={(event) => onOcrTextChange(essay.id, event.target.value)}
    className="mt-4 min-h-[320px] w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-800 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
  />
) : mode === 'paper' ? (
  <div className="mt-4 max-h-[520px] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
    <div className="rounded-lg border border-blue-100 bg-white p-4">
      <h4 className="text-sm font-semibold text-slate-950">原卷视图 · 阶段三预留</h4>
      <p className="mt-2 text-xs leading-6 text-slate-600">
        后续接入 OCR 坐标后，这里将支持卷面定位、图片区域高亮和批注卡片联动。当前仅展示原卷图片预览，不在图片上生成问题区域。
      </p>
    </div>

    <div className="mt-4">
      {essay.pages.length > 0 ? (
        <EssayPageSorter pages={essay.pages} />
      ) : (
        <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          当前作文暂无原卷图片预览。后续接入 OCR 坐标后，将在此处展示原卷批阅能力。
        </div>
      )}
    </div>

    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold text-slate-700">暂不支持</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
        {['图片批注', '框选', '手写痕迹', '拖拽批注', '自由绘图', 'OCR 坐标定位', '图片与问题卡片联动'].map((item) => (
          <span key={item} className="rounded-full bg-slate-100 px-2.5 py-1">
            {item}
          </span>
        ))}
      </div>
    </div>
  </div>
) : (
  <div className="mt-4 max-h-[520px] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
    {/* Keep the current read-mode source text branch here unchanged during implementation. */}
  </div>
)}
```

Keep the existing read-mode `<div>` content unchanged inside the final branch. The read branch must still render `data-issue-source` and `data-active` markers exactly as before.

- [ ] **Step 6: Run the focused test and verify it passes**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected:

```text
PASS src/pages/EssayResultPage.test.tsx
```

- [ ] **Step 7: Commit the implementation**

Run:

```powershell
git add app/src/components/EssaySourcePanel.tsx
git commit -m "feat: add original paper view placeholder"
```

---

### Task 3: Update Progress Memory and Verify Regression Scope

**Files:**
- Modify: `docs/current_development_status.md`

- [ ] **Step 1: Add the new progress entry**

Near the top of `docs/current_development_status.md`, after the `最后更新：2026-07-02` line, add this section:

```markdown
## 本次新增进展：原卷视图入口与原卷批阅路线占位 v0.2

- 单篇作文详情页左侧模式从 `阅读定位 / 编辑 OCR` 扩展为 `阅读定位 / 原卷视图 / 编辑 OCR`，默认仍进入 `阅读定位`。
- `原卷视图` 当前只展示阶段三预留说明和原卷图片预览，明确后续方向为卷面定位、图片区域高亮和批注卡片联动。
- 当前占位视图不展示 OCR 文本层 marker，不生成图片问题框，不接 OCR 坐标，不新增 AppState 数据结构。
- 保留 `查看原图` 弹窗、OCR 文本编辑、左右问题定位、加入班级总览素材池、全文优化稿和进度页最新完成入口。
- 本轮验证结果：
  - `npm.cmd test -- src/pages/EssayResultPage.test.tsx`：通过。
  - `npm.cmd run lint`：通过。
```

- [ ] **Step 2: Update repository status if needed**

If the status section still says the current branch is `main`, replace that line with the actual branch state used for this work:

```markdown
- 当前本地开发分支：`codex/original-paper-view-roadmap-v02`
```

Leave the existing `origin/main` and historical notes intact unless the branch has been merged later in the session.

- [ ] **Step 3: Run focused test, lint, and full build guard**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
npm.cmd run lint
npm.cmd run build
```

Expected:

```text
PASS src/pages/EssayResultPage.test.tsx
Lint passes without errors
Build completes successfully
```

- [ ] **Step 4: Commit status update**

Run:

```powershell
git add docs/current_development_status.md
git commit -m "docs: record original paper view placeholder"
```

---

### Task 4: Final Verification Before Completion

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

- [ ] **Step 2: Confirm the diff scope**

Run:

```powershell
cd D:\wenjie-writewise-ai
git status --short --branch
git log --oneline -3
```

Expected:

```text
## codex/original-paper-view-roadmap-v02
```

The latest commits should include:

```text
docs: record original paper view placeholder
feat: add original paper view placeholder
test: cover original paper view entry
```

- [ ] **Step 3: Report completion without pushing**

Final response should include:

```text
已完成“原卷视图入口与原卷批阅路线占位 v0.2”。
已验证：npm.cmd test、npm.cmd run lint、npm.cmd run build。
未 push，等待你确认是否预览、合并或推送。
```

Do not push unless the user explicitly asks.

---

## Self-Review

- Spec coverage:
  - `原卷视图` entry is implemented in Task 2.
  - Default `阅读定位` mode remains unchanged in Task 2.
  - Original image preview reuses `EssayPageSorter` in Task 2.
  - Stage-three placeholder copy and unsupported list are covered in Task 1 tests and Task 2 implementation.
  - OCR text markers are hidden in `原卷视图` by rendering a separate branch in Task 2 and testing it in Task 1.
  - No AppState, OCR coordinates, upload, progress, class review, or runtime image anchor changes are included.
  - Progress memory update is covered in Task 3.

- Placeholder scan:
  - The plan contains concrete file paths, commands, expected outputs, and code snippets.
  - No unresolved implementation placeholders are present.

- Type consistency:
  - `SourcePanelMode` is defined once and reused by state and mode option ids.
  - `paper` is only a UI mode; it is not added to app state or persisted data.
  - `EssayPageSorter` receives the existing `essay.pages` array and needs no prop changes.
