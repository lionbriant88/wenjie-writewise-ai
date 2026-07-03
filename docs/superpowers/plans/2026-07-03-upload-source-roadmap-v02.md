# Upload Source Roadmap v0.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact upload-source selector placeholder to the upload organizer page without changing the existing image upload, grouping, OCR mock, or queue flow.

**Architecture:** Create a focused presentational `UploadSourceSelector` component that owns only the multi-source UI. `UploadPage` continues to own all upload state and passes existing `addLocalFiles` and `addPage` handlers into the selector. Tests verify the new source-entry semantics and re-run existing upload/grouping/OCR behaviors.

**Tech Stack:** React, TypeScript, React Testing Library, Vitest, Tailwind utility classes, existing Vite app and mock AppState.

---

## File Structure

- Create: `app/src/components/UploadSourceSelector.tsx`
  - Presentational selector for four entries: `图片 / 文件导入`, `拍照采集`, `扫描件导入`, `希沃展台采集`.
  - Owns the hidden image input and calls `onSelectImages(files)`.
  - Calls `onAddMockImage()` for the existing mock image action.
  - Does not read or write AppState.
  - Does not own upload state, OCR draft state, grouping state, navigation, or queue creation.

- Modify: `app/src/pages/UploadPage.tsx`
  - Replace `UploadPanel` with `UploadSourceSelector`.
  - Continue passing `addLocalFiles` and `addPage`.
  - Keep every organizer, grouping, OCR mock, and queue-confirmation function unchanged.

- Modify: `app/src/pages/UploadPage.test.tsx`
  - Add tests for the new source selector and prohibited fake hardware controls.
  - Update the file upload test to use the new `选择图片` input label.
  - Keep existing grouping, sorting, deletion, OCR, and progress-flow tests.

- Modify: `docs/current_development_status.md`
  - Record the upload-source selector placeholder and verification results.

No AppStateContext, routing, data type, PDF parsing, camera, scanner, Seewo stream, OCR, AI, or queue API changes in this round.

---

## Task 1: Add Upload Source Selector Tests

**Files:**
- Modify: `app/src/pages/UploadPage.test.tsx`

- [ ] **Step 1: Import `within`**

Update the testing-library import:

```ts
import { render, screen, within } from '@testing-library/react'
```

- [ ] **Step 2: Add a failing test for source entries**

Add this test near the top of `describe('UploadPage', ...)`, before the existing local-image upload test:

```ts
it('shows compact upload source entries with stage-three placeholders', () => {
  renderUploadPage()

  const sourceRegion = screen.getByRole('region', { name: '选择导入方式' })

  expect(within(sourceRegion).getByRole('heading', { name: '选择导入方式' })).toBeInTheDocument()
  expect(within(sourceRegion).getByText('当前版本支持图片 / 文件导入。拍照采集、扫描件导入和希沃展台采集将在阶段三接入。')).toBeInTheDocument()

  const fileImport = within(sourceRegion).getByRole('group', { name: '图片 / 文件导入' })
  expect(within(fileImport).getByText('当前可用')).toBeInTheDocument()
  expect(within(fileImport).getByText(/从当前设备选择已经存在的作文图片或文件/)).toBeInTheDocument()
  expect(within(fileImport).getByLabelText('选择图片')).toBeInTheDocument()
  expect(within(fileImport).getByRole('button', { name: '添加模拟图片' })).toBeInTheDocument()

  const cameraCapture = within(sourceRegion).getByRole('group', { name: '拍照采集' })
  expect(within(cameraCapture).getByText('阶段三接入')).toBeInTheDocument()
  expect(within(cameraCapture).getByText(/未来可在软件内调用手机、平板或电脑摄像头现场拍摄作文/)).toBeInTheDocument()

  const scannerImport = within(sourceRegion).getByRole('group', { name: '扫描件导入' })
  expect(within(scannerImport).getByText('阶段三接入')).toBeInTheDocument()
  expect(within(scannerImport).getByText(/学校扫描仪或阅卷系统已经生成的作文图片、PDF 或文件夹/)).toBeInTheDocument()

  const seewoCapture = within(sourceRegion).getByRole('group', { name: '希沃展台采集' })
  expect(within(seewoCapture).getByText('阶段三接入')).toBeInTheDocument()
  expect(within(seewoCapture).getByText('课堂即时批改')).toBeInTheDocument()
  expect(within(seewoCapture).getByText('批量采集上传')).toBeInTheDocument()
  expect(within(seewoCapture).getAllByText('阶段三接入').length).toBeGreaterThanOrEqual(3)

  expect(screen.queryByRole('button', { name: '打开摄像头' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '连接扫描仪' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '开始展台采集' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '展台截图' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '选择扫描件' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '使用本地图片模拟' })).not.toBeInTheDocument()
})
```

- [ ] **Step 3: Update file upload tests to target `选择图片`**

In both existing tests that upload a local image, replace:

```ts
screen.getByLabelText('选择本地图片')
```

with:

```ts
screen.getByLabelText('选择图片')
```

- [ ] **Step 4: Run focused test and verify RED**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/UploadPage.test.tsx
```

Expected:

```text
FAIL src/pages/UploadPage.test.tsx
```

Expected reason: the new `选择导入方式` region and `选择图片` label do not exist yet.

Do not commit yet.

---

## Task 2: Create `UploadSourceSelector`

**Files:**
- Create: `app/src/components/UploadSourceSelector.tsx`

- [ ] **Step 1: Add the component**

Create `app/src/components/UploadSourceSelector.tsx`:

```tsx
import { Camera, FileImage, FileScan, MonitorUp } from 'lucide-react'

interface UploadSourceSelectorProps {
  onSelectImages: (files: File[]) => void
  onAddMockImage: () => void
}

function statusClass(available: boolean) {
  return available
    ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
    : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200'
}

export function UploadSourceSelector({ onSelectImages, onAddMockImage }: UploadSourceSelectorProps) {
  return (
    <section
      role="region"
      aria-label="选择导入方式"
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-950">选择导入方式</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            当前版本支持图片 / 文件导入。拍照采集、扫描件导入和希沃展台采集将在阶段三接入。
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div
          role="group"
          aria-label="图片 / 文件导入"
          className="rounded-lg border border-blue-200 bg-blue-50/70 p-4 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileImage className="h-5 w-5 text-blue-700" />
              <h4 className="font-semibold text-slate-950">图片 / 文件导入</h4>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(true)}`}>当前可用</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            从当前设备选择已经存在的作文图片或文件，例如相册照片、电脑文件夹图片、扫描仪或阅卷系统导出的图片 / PDF。
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <label className="tech-focus inline-flex cursor-pointer rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100">
              选择图片
              <input
                type="file"
                accept="image/*"
                multiple
                aria-label="选择图片"
                className="sr-only"
                onChange={(event) => {
                  onSelectImages(Array.from(event.target.files ?? []))
                  event.target.value = ''
                }}
              />
            </label>
            <button
              type="button"
              onClick={onAddMockImage}
              className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"
            >
              添加模拟图片
            </button>
          </div>
        </div>

        <div role="group" aria-label="拍照采集" className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-slate-500" />
              <h4 className="font-semibold text-slate-950">拍照采集</h4>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(false)}`}>阶段三接入</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            未来可在软件内调用手机、平板或电脑摄像头现场拍摄作文，预览确认后加入上传整理页图片列表。
          </p>
          <p className="mt-3 text-xs font-semibold text-slate-500">当前可先通过图片 / 文件导入使用已有照片。</p>
        </div>

        <div role="group" aria-label="扫描件导入" className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileScan className="h-5 w-5 text-slate-500" />
              <h4 className="font-semibold text-slate-950">扫描件导入</h4>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(false)}`}>阶段三接入</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            用于学校扫描仪或阅卷系统已经生成的作文图片、PDF 或文件夹导入，适合大型考试后的批量作文批改。
          </p>
          <p className="mt-3 text-xs font-semibold text-slate-500">当前不解析 PDF、文件夹或自动拆页。</p>
        </div>

        <div role="group" aria-label="希沃展台采集" className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <MonitorUp className="h-5 w-5 text-slate-500" />
              <h4 className="font-semibold text-slate-950">希沃展台采集</h4>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(false)}`}>阶段三接入</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            未来可通过希沃白板视频展台采集作文画面，既可用于课堂即时批改，也可用于批量采集上传。
          </p>
          <div className="mt-3 space-y-2">
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-800">课堂即时批改</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass(false)}`}>阶段三接入</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">采集单篇作文后直接进入 OCR、AI 批改和单篇详情页。</p>
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-800">批量采集上传</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass(false)}`}>阶段三接入</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">连续采集多张作文图片后进入上传整理、OCR 和批改队列。</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Run focused test and verify still RED**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/UploadPage.test.tsx
```

Expected: still FAIL because `UploadPage` has not rendered the component yet.

Do not commit yet.

---

## Task 3: Wire Selector Into `UploadPage`

**Files:**
- Modify: `app/src/pages/UploadPage.tsx`
- Optionally delete later: `app/src/components/UploadPanel.tsx` only if no imports remain.

- [ ] **Step 1: Replace the import**

In `app/src/pages/UploadPage.tsx`, replace:

```ts
import { UploadPanel } from '../components/UploadPanel'
```

with:

```ts
import { UploadSourceSelector } from '../components/UploadSourceSelector'
```

- [ ] **Step 2: Replace the top upload panel JSX**

Replace:

```tsx
<UploadPanel
  onAddPage={addPage}
  onSelectFiles={addLocalFiles}
  onSubmit={() => navigate(`/tasks/${task.id}/progress`)}
/>
```

with:

```tsx
<UploadSourceSelector onAddMockImage={addPage} onSelectImages={addLocalFiles} />
```

Do not move any other upload organizer, grouping, OCR, or progress navigation code.

- [ ] **Step 3: Remove the now-unused `UploadPanel` file if safe**

Run:

```powershell
cd D:\wenjie-writewise-ai
rg -n "UploadPanel" app\src
```

Expected:

```text
app\src\components\UploadPanel.tsx
```

If the only match is the component file itself, delete `app/src/components/UploadPanel.tsx` with `apply_patch`.

- [ ] **Step 4: Run focused test and verify GREEN**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/UploadPage.test.tsx
```

Expected:

```text
PASS src/pages/UploadPage.test.tsx
```

- [ ] **Step 5: Run lint**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd run lint
```

Expected: lint passes without errors.

- [ ] **Step 6: Commit feature and tests**

Run:

```powershell
cd D:\wenjie-writewise-ai
git add app/src/pages/UploadPage.test.tsx app/src/pages/UploadPage.tsx app/src/components/UploadSourceSelector.tsx app/src/components/UploadPanel.tsx
git commit -m "feat: add upload source selector placeholder"
```

If `UploadPanel.tsx` was not deleted, omit it from `git add`.

---

## Task 4: Update Development Status Memory

**Files:**
- Modify: `docs/current_development_status.md`

- [ ] **Step 1: Add progress entry**

Near the top of `docs/current_development_status.md`, after the last-updated line, add:

```markdown
## 本次新增进展：上传整理页多来源导入入口占位 v0.2

- 在上传整理页新增“选择导入方式”区域。
- 保留当前图片 / 文件导入为当前可用入口，当前实际按钮为“选择图片”和“添加模拟图片”。
- 新增拍照采集、扫描件导入、希沃展台采集三个阶段三入口占位。
- 明确希沃展台采集未来支持两种模式：课堂即时批改和批量采集上传。
- 当前版本不接入真实摄像头、扫描仪、视频展台、PDF 解析、即时 OCR 或即时 AI 批改。
- 所有批量处理来源未来都会汇入现有上传整理、作文组整理、OCR 和批改队列流程。
- 本轮验证结果：
  - `npm.cmd test -- src/pages/UploadPage.test.tsx`：通过。
  - `npm.cmd run lint`：通过。
```

- [ ] **Step 2: Run focused verification**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/UploadPage.test.tsx
npm.cmd run lint
```

Expected:

```text
PASS src/pages/UploadPage.test.tsx
Lint passes without errors
```

- [ ] **Step 3: Commit memory update**

Run:

```powershell
cd D:\wenjie-writewise-ai
git add docs/current_development_status.md
git commit -m "docs: record upload source selector"
```

---

## Task 5: Final Verification

**Files:**
- Verify only; no planned file edits.

- [ ] **Step 1: Run full regression commands**

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

- [ ] **Step 2: Run scope scan**

Run:

```powershell
cd D:\wenjie-writewise-ai
rg -n "打开摄像头|连接扫描仪|开始展台采集|展台截图|选择扫描件|使用本地图片模拟|navigator\.mediaDevices|getUserMedia|scanner|seewo|pdf" app\src
```

Expected:

- No fake hardware UI strings.
- No camera API usage.
- No scanner API usage.
- No PDF parsing implementation.
- `seewo` may appear only as an internal semantic name if introduced; this plan does not require introducing runtime type constants.

- [ ] **Step 3: Confirm git state**

Run:

```powershell
cd D:\wenjie-writewise-ai
git status --short --branch
git log --oneline -8
```

Expected:

```text
## codex/upload-source-roadmap-v02
```

with no uncommitted files.

- [ ] **Step 4: Final response**

Report:

```text
已完成“上传整理页多来源导入入口占位 v0.2”。
已验证：npm.cmd test、npm.cmd run lint、npm.cmd run build。
未 push。
```

Do not push unless the user explicitly asks.

---

## Self-Review

- Spec coverage:
  - Four entries are covered by Task 1 tests and Task 2 component.
  - `图片 / 文件导入` current actual support is image-only with `选择图片`, covered by Task 1 and Task 2.
  - No `选择文件`, `选择扫描件`, or `使用本地图片模拟` buttons are covered by Task 1 negative assertions.
  - `UploadSourceSelector` as display-only props component is covered by Task 2 and Task 3.
  - Existing upload, grouping, deletion, OCR, and queue behavior are protected by existing `UploadPage.test.tsx` plus the focused suite in Tasks 3-4.
  - No AppState, camera, scanner, Seewo stream, PDF parsing, OCR, AI, or route changes are included.

- Placeholder scan:
  - No `TBD`, `TODO`, or unspecified implementation steps remain.
  - Every file, command, and expected verification result is concrete.

- Type consistency:
  - Component props are consistently named `onSelectImages` and `onAddMockImage`.
  - `UploadPage` passes existing `addLocalFiles` and `addPage` handlers without changing their signatures.
