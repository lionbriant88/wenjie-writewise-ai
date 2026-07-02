# 核心批改工作台信息架构优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将单篇详情页和班级总览页从长报告式堆叠改为更高效的教师工作台 Tabs，同时保留素材池闭环、评分编辑、问题定位、全文优化稿和教师反馈。

**Architecture:** 班级总览页使用本地 `useState` 管理页面内 Tabs，并把现有统计、素材池、高频问题、改写练习拆到不同内容区。单篇详情页保留左侧 `EssaySourcePanel` 常驻，右侧用本地 Tabs 切换 `DiagnosticScoreSummary`、`IssueCorrectionList`、`FullTextRevisionPanel` 和教师反馈表单，不新增路由、不改 AppState 数据结构。

**Tech Stack:** React, TypeScript, React Router, Vitest, Testing Library, Tailwind CSS, Vite。

---

## File Structure

- Modify: `app/src/pages/ClassReviewPage.tsx`
  - 删除黑色 hero。
  - 新增班级总览内部 Tabs：概览、教师精选素材、高频问题、改写练习。
  - 新增紧凑高频问题和改写练习渲染 helper。
- Modify: `app/src/pages/ClassReviewPage.test.tsx`
  - 更新默认页断言。
  - 覆盖 Tabs 切换、素材池闭环、来源跳转、移除。
- Modify: `app/src/pages/EssayResultPage.tsx`
  - 新增右侧内部 Tabs：评分诊断、问题批改、全文优化、教师反馈。
  - 保留左侧原文面板常驻。
- Modify: `app/src/pages/EssayResultPage.test.tsx`
  - 更新默认页断言。
  - 在需要的问题、全文优化、反馈场景中先切换对应 Tab。
- Modify: `docs/current_development_status.md`
  - 记录本轮工作台 IA 优化进度和验证结果。

No new global components are required. If helper JSX in `ClassReviewPage.tsx` becomes bulky, split a small local component file only after tests define the behavior.

---

### Task 1: 班级总览 Tabs 测试

**Files:**
- Modify: `app/src/pages/ClassReviewPage.test.tsx`

- [ ] **Step 1: Write failing tests for default overview and hidden hero**

Add assertions to the first class review test so it expects page tabs, overview as the default tab, score stats visible, the old hero description absent, and the materials panel hidden until its tab is selected.

```tsx
expect(screen.getByRole('tab', { name: '概览' })).toHaveAttribute('aria-selected', 'true')
expect(screen.getByRole('tab', { name: '教师精选素材' })).toHaveAttribute('aria-selected', 'false')
expect(screen.getByRole('heading', { name: '分数分布' })).toBeInTheDocument()
expect(screen.getByText('作文总数')).toBeInTheDocument()
expect(screen.getByText('平均分')).toBeInTheDocument()
expect(screen.queryByRole('heading', { name: '教师精选讲评素材' })).not.toBeInTheDocument()
expect(screen.queryByText('先看全班分数结构，再看高频问题和课堂讲评素材。')).not.toBeInTheDocument()
```

- [ ] **Step 2: Write failing tests for class review tab switching**

Extend the same test or add a new test that clicks each tab and verifies the right content is shown.

```tsx
const user = userEvent.setup()

await user.click(screen.getByRole('tab', { name: '教师精选素材' }))
expect(screen.getByRole('tab', { name: '教师精选素材' })).toHaveAttribute('aria-selected', 'true')
expect(screen.getByRole('heading', { name: '教师精选讲评素材' })).toBeInTheDocument()
expect(screen.getByText('还没有教师精选讲评素材。')).toBeInTheDocument()
expect(screen.queryByRole('tab', { name: '表达提升' })).not.toBeInTheDocument()

await user.click(screen.getByRole('tab', { name: '高频问题' }))
expect(screen.getByRole('heading', { name: '高频语法错误' })).toBeInTheDocument()
expect(screen.getByRole('heading', { name: '高频拼写错误' })).toBeInTheDocument()
expect(screen.getByRole('heading', { name: '典型问题句' })).toBeInTheDocument()

await user.click(screen.getByRole('tab', { name: '改写练习' }))
expect(screen.getByRole('heading', { name: '可上课改写练习' })).toBeInTheDocument()
```

- [ ] **Step 3: Update material-loop test to open materials tab**

After navigating from essay detail to class review, click `教师精选素材` before asserting material cards.

```tsx
await user.click(screen.getByRole('link', { name: '班级总览' }))
await user.click(screen.getByRole('tab', { name: '教师精选素材' }))
expect(screen.getByRole('heading', { name: '教师精选讲评素材' })).toBeInTheDocument()
```

- [ ] **Step 4: Run test to verify it fails**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/ClassReviewPage.test.tsx
```

Expected: FAIL because `ClassReviewPage` does not yet render page-level tabs and still renders the hero/materials on the default view.

---

### Task 2: Implement 班级总览 Tabs and Compact Lists

**Files:**
- Modify: `app/src/pages/ClassReviewPage.tsx`

- [ ] **Step 1: Add local tab state and tab metadata**

Add React state and local tab definitions.

```tsx
import { useState } from 'react'

type ClassReviewTab = 'overview' | 'materials' | 'issues' | 'exercises'

const classReviewTabs: Array<{ id: ClassReviewTab; label: string }> = [
  { id: 'overview', label: '概览' },
  { id: 'materials', label: '教师精选素材' },
  { id: 'issues', label: '高频问题' },
  { id: 'exercises', label: '改写练习' },
]
```

Inside `ClassReviewPage`:

```tsx
const [activeTab, setActiveTab] = useState<ClassReviewTab>('overview')
```

- [ ] **Step 2: Add compact insight helpers**

Add helpers above `ClassReviewPage`.

```tsx
type CompactInsightItem = {
  title: string
  detail: string
  count?: number
  examples?: string[]
}

function CompactInsightGroup({ title, items }: { title: string; items: CompactInsightItem[] }) {
  if (items.length === 0) {
    return null
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-slate-950">{title}</h3>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          {items.length} 项
        </span>
      </div>
      <div className="divide-y divide-slate-100">
        {items.map((item) => (
          <article key={item.title} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-950">{item.title}</h4>
              {typeof item.count === 'number' ? (
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                  {item.count} 次
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm leading-6 text-slate-600">{item.detail}</p>
            {item.examples?.length ? (
              <div className="mt-2 space-y-1">
                {item.examples.map((example) => (
                  <p key={example} className="text-xs leading-5 text-slate-500">
                    例句：{example}
                  </p>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Render tabs and conditional content**

Remove the black hero block and render:

```tsx
<div className="rounded-lg border border-slate-200 bg-white p-1 shadow-sm" role="tablist" aria-label="班级总览内容">
  {classReviewTabs.map((tab) => (
    <button
      key={tab.id}
      type="button"
      role="tab"
      aria-selected={activeTab === tab.id}
      onClick={() => setActiveTab(tab.id)}
      className={`tech-focus rounded-md px-4 py-2 text-sm font-semibold transition ${
        activeTab === tab.id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
      }`}
    >
      {tab.label}
    </button>
  ))}
</div>
```

Render score distribution only when `activeTab === 'overview'`, `ClassReviewMaterialsPanel` only when `activeTab === 'materials'`, compact grammar/spelling/typical groups only when `activeTab === 'issues'`, and rewrite exercises only when `activeTab === 'exercises'`.

- [ ] **Step 4: Run focused class review test**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/ClassReviewPage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit class review page changes**

```powershell
git add app/src/pages/ClassReviewPage.tsx app/src/pages/ClassReviewPage.test.tsx
git commit -m "feat: add class review workspace tabs"
```

---

### Task 3: 单篇详情页 Tabs 测试

**Files:**
- Modify: `app/src/pages/EssayResultPage.test.tsx`

- [ ] **Step 1: Update default page test**

Assert the default right-side tab is `评分诊断`, the left source is still visible, and modules from other tabs are hidden until selected.

```tsx
expect(screen.getByRole('tab', { name: '评分诊断' })).toHaveAttribute('aria-selected', 'true')
expect(screen.getByRole('tab', { name: '问题批改' })).toHaveAttribute('aria-selected', 'false')
expect(screen.getByText('学生作文原文')).toBeInTheDocument()
expect(screen.getByText('分项评分')).toBeInTheDocument()
expect(screen.queryByRole('heading', { name: '问题与修改建议' })).not.toBeInTheDocument()
expect(screen.queryByRole('heading', { name: '全文优化稿' })).not.toBeInTheDocument()
expect(screen.queryByText('教师补充建议')).not.toBeInTheDocument()
```

- [ ] **Step 2: Update issue tests to switch tab first**

Before asserting issue cards or clicking issue locate/add buttons:

```tsx
await user.click(screen.getByRole('tab', { name: '问题批改' }))
expect(screen.getByRole('heading', { name: '问题与修改建议' })).toBeInTheDocument()
```

- [ ] **Step 3: Update full-text revision tests to switch tab first**

Before asserting `FullTextRevisionPanel`:

```tsx
await user.click(screen.getByRole('tab', { name: '全文优化' }))
expect(screen.getByRole('heading', { name: '全文优化稿' })).toBeInTheDocument()
```

- [ ] **Step 4: Update teacher feedback tests to switch tab first**

Before editing AI comment or teacher suggestion:

```tsx
await user.click(screen.getByRole('tab', { name: '教师反馈' }))
expect(screen.getByLabelText('AI 总评')).toBeInTheDocument()
expect(screen.getByLabelText('教师补充建议')).toBeInTheDocument()
```

- [ ] **Step 5: Run test to verify it fails**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected: FAIL because `EssayResultPage` does not yet render right-side tabs.

---

### Task 4: Implement 单篇详情页 Right-Side Tabs

**Files:**
- Modify: `app/src/pages/EssayResultPage.tsx`

- [ ] **Step 1: Add local tab state and tab metadata**

Add local types and metadata near the top of the file.

```tsx
type EssayDetailTab = 'scoring' | 'issues' | 'revision' | 'feedback'

const essayDetailTabs: Array<{ id: EssayDetailTab; label: string }> = [
  { id: 'scoring', label: '评分诊断' },
  { id: 'issues', label: '问题批改' },
  { id: 'revision', label: '全文优化' },
  { id: 'feedback', label: '教师反馈' },
]
```

Inside `EssayResultPage`:

```tsx
const [activeDetailTab, setActiveDetailTab] = useState<EssayDetailTab>('scoring')
```

- [ ] **Step 2: Add right-side tablist**

Place this below the save notice and above tab content.

```tsx
<div className="rounded-lg border border-slate-200 bg-white p-1 shadow-sm" role="tablist" aria-label="单篇批改内容">
  {essayDetailTabs.map((tab) => (
    <button
      key={tab.id}
      type="button"
      role="tab"
      aria-selected={activeDetailTab === tab.id}
      onClick={() => setActiveDetailTab(tab.id)}
      className={`tech-focus rounded-md px-4 py-2 text-sm font-semibold transition ${
        activeDetailTab === tab.id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
      }`}
    >
      {tab.label}
    </button>
  ))}
</div>
```

- [ ] **Step 3: Gate existing right-side panels by active tab**

Render exactly one main panel at a time:

```tsx
{activeDetailTab === 'scoring' ? (
  <DiagnosticScoreSummary ... />
) : null}

{activeDetailTab === 'issues' ? (
  <IssueCorrectionList ... />
) : null}

{activeDetailTab === 'revision' ? (
  <FullTextRevisionPanel revision={result.fullTextRevision} upgrades={result.upgradedExpressions} />
) : null}

{activeDetailTab === 'feedback' ? (
  <div className="rounded-lg border border-slate-200 bg-white p-4">...</div>
) : null}
```

Keep existing callbacks unchanged so score edit, material add, source highlighting, OCR edit, and feedback save keep working.

- [ ] **Step 4: Run focused essay detail test**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit essay detail changes**

```powershell
git add app/src/pages/EssayResultPage.tsx app/src/pages/EssayResultPage.test.tsx
git commit -m "feat: add essay review workspace tabs"
```

---

### Task 5: Regression, Browser Check, and Memory Update

**Files:**
- Modify: `docs/current_development_status.md`

- [ ] **Step 1: Run focused regression tests**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/ClassReviewPage.test.tsx
npm.cmd test -- src/pages/EssayResultPage.test.tsx
npm.cmd test -- src/pages/ProgressPage.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run final verification**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected: PASS.

- [ ] **Step 3: Browser check**

Open or refresh:

```text
http://127.0.0.1:5173/tasks/task-1/class-review
http://127.0.0.1:5173/tasks/task-1/essays/task-1-essay-1
```

Verify:

- Class review defaults to `概览`.
- Black hero is gone.
- Class review tabs switch to materials, high-frequency issues, and rewrite exercises.
- Essay detail keeps the source panel visible while right-side tabs switch.
- Problem locate, add to class review, full text revision, and feedback save remain usable.

- [ ] **Step 4: Update project memory**

Append a short section to `docs/current_development_status.md`:

```markdown
## 2026-07-02：核心批改工作台信息架构优化

- 班级总览删除冗余黑色横幅，改为页内 Tabs：概览、教师精选素材、高频问题、改写练习。
- 单篇详情页保留左侧作文原文常驻，右侧改为 Tabs：评分诊断、问题批改、全文优化、教师反馈。
- 素材池闭环、查看来源、移除、问题定位、全文优化稿、教师反馈保存和进度页最新完成入口保持可用。
- 验证：`npm.cmd test`、`npm.cmd run lint`、`npm.cmd run build`。
```

- [ ] **Step 5: Commit regression and memory update**

```powershell
git add docs/current_development_status.md
git commit -m "docs: record workbench ia polish progress"
```

---

## Self-Review

- Spec coverage: 班级总览 hero 删除、页内 Tabs、素材池独立 Tab、高频问题紧凑化、改写练习独立 Tab、单篇详情右侧 Tabs、左侧原文常驻、既有闭环保留，均有对应任务。
- Placeholder scan: Plan does not rely on future-only placeholders; all commands and expected outcomes are explicit.
- Type consistency: `ClassReviewTab` and `EssayDetailTab` IDs are used consistently across tests and implementation.
