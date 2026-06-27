# Phase 1 Information Architecture Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the phase 1 teacher workflow information architecture so task cards have one entry, task navigation has four clear destinations, detail flows can return, and class review becomes a compact class overview.

**Architecture:** Keep existing routes and component boundaries where possible. Make navigation label/path changes in `utils/workflow.ts`, keep progress-page drilldowns as existing routes, and add a small class-overview stats helper so scoring calculations stay out of the page component.

**Tech Stack:** React, TypeScript, React Router, Tailwind CSS, Vitest, Testing Library, oxlint, Vite.

---

## File Structure

- `app/src/pages/TaskListPage.tsx`: simplify each task card to one `查看` button linking to the task progress page.
- `app/src/utils/workflow.ts`: reduce workflow steps to upload/progress/class overview, keep `class-review` route id, and update next action labels from “讲评” to “总览”.
- `app/src/utils/workflow.test.ts`: update workflow expectations and next action labels.
- `app/src/components/WorkflowNav.tsx`: remove unused icons for removed step ids if needed.
- `app/src/components/WorkflowNav.test.tsx`: update navigation tests to assert the four-item information architecture.
- `app/src/layout/AppLayout.tsx`: derive `progress` for essay result and exception detail contexts, and keep class overview highlighting.
- `app/src/pages/EssayResultPage.tsx`: add `← 返回` link to current task progress page.
- `app/src/pages/ExceptionsPage.tsx`: add `← 返回` link to current task progress page.
- `app/src/pages/ClassReviewPage.tsx`: rename visible copy to `班级总览`, remove the `课堂讲评模式` chip, and render compact score distribution before existing insight panels.
- `app/src/utils/classOverview.ts`: create stats helper for total essays, scored essays, average, high, low, and score bands.
- `app/src/utils/classOverview.test.ts`: cover score stats, high-school-style bands, and missing-score cases.

---

### Task 1: Simplify Task Card Entry

**Files:**
- Modify: `app/src/pages/TaskListPage.tsx`
- Test: existing visual/browser verification only; no unit test currently covers task card links.

- [ ] **Step 1: Inspect current task card actions**

Run:

```bash
rg -n "查看讲评|nextAction|primaryTo|class-review|ArrowRight" app/src/pages/TaskListPage.tsx
```

Expected: find the secondary `查看讲评` link and the dynamic primary action driven by `getProgressNextAction`.

- [ ] **Step 2: Replace duplicated actions with one stable entry**

In `app/src/pages/TaskListPage.tsx`, remove `ArrowRight` and `TriangleAlert` imports and stop deriving `nextAction`. Keep the task status summary text simple and use a single button:

```tsx
<div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
  <p className="text-sm text-slate-600">
    进入任务后可继续上传整理、查看批改进度和班级总览。
  </p>
  <Link
    to={`/tasks/${task.id}/progress`}
    className="tech-focus inline-flex items-center rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
  >
    查看
  </Link>
</div>
```

Also remove unused imports:

```tsx
import { Link } from 'react-router-dom'
```

The page should no longer import `ArrowRight`, `TriangleAlert`, or `getProgressNextAction`.

- [ ] **Step 3: Run focused checks**

Run:

```bash
npm.cmd test
npm.cmd run lint
```

Expected: all tests and lint pass.

- [ ] **Step 4: Browser verify task card entry**

Open `http://127.0.0.1:5173/`.

Expected:
- Each task card has only one primary action named `查看`.
- No `查看讲评` or `查看班级讲评` appears on task cards.
- Clicking `查看` enters `/tasks/<taskId>/progress`.
- Task status badges and progress summaries still render.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/TaskListPage.tsx
git commit -m "chore: simplify task card entry"
```

---

### Task 2: Streamline Task Navigation

**Files:**
- Modify: `app/src/utils/workflow.ts`
- Modify: `app/src/utils/workflow.test.ts`
- Modify: `app/src/components/WorkflowNav.tsx`
- Modify: `app/src/components/WorkflowNav.test.tsx`
- Modify: `app/src/layout/AppLayout.tsx`

- [ ] **Step 1: Write failing workflow helper tests**

In `app/src/utils/workflow.test.ts`, update the workflow step expectation to exactly three task-internal links, because `任务列表` is owned by `AppLayout`:

```tsx
expect(getWorkflowSteps(task.id, 'progress')).toEqual([
  { id: 'upload', label: '上传整理', to: '/tasks/task-1/upload', current: false },
  { id: 'progress', label: '批改进度', to: '/tasks/task-1/progress', current: true },
  { id: 'class-review', label: '班级总览', to: '/tasks/task-1/class-review', current: false },
])
```

Update next-action expectations:

```tsx
expect(next).toMatchObject({
  tone: 'success',
  title: '本批作文已完成',
  primaryLabel: '查看班级总览',
  primaryTo: '/tasks/task-1/class-review',
})
```

For the exception case, expect:

```tsx
secondaryLabel: '查看总览'
```

- [ ] **Step 2: Update WorkflowNav component test**

In `app/src/components/WorkflowNav.test.tsx`, replace the old `结果检查` duplicate-route scenario with a four-item IA scenario:

```tsx
const steps: WorkflowStep[] = [
  { id: 'upload', label: '上传整理', to: '/tasks/task-1/upload', current: false },
  { id: 'progress', label: '批改进度', to: '/tasks/task-1/progress', current: true },
  { id: 'class-review', label: '班级总览', to: '/tasks/task-1/class-review', current: false },
]
```

Assert:

```tsx
expect(screen.queryByRole('link', { name: /异常复核/ })).not.toBeInTheDocument()
expect(screen.queryByRole('link', { name: /结果检查/ })).not.toBeInTheDocument()
expect(screen.queryByRole('link', { name: /班级讲评/ })).not.toBeInTheDocument()
expect(screen.getByRole('link', { name: /批改进度/ })).toHaveAttribute('aria-current', 'page')
expect(screen.getByRole('link', { name: /班级总览/ })).toHaveAttribute('href', '/tasks/task-1/class-review')
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
npm.cmd test -- app/src/utils/workflow.test.ts app/src/components/WorkflowNav.test.tsx
```

Expected: tests fail because workflow still exposes `exceptions`, `results`, and `班级讲评`.

- [ ] **Step 4: Implement navigation changes**

In `app/src/utils/workflow.ts`, change the type and labels:

```ts
export type WorkflowStepId = 'upload' | 'progress' | 'class-review'

const workflowLabels: Array<{ id: WorkflowStepId; label: string; path: string }> = [
  { id: 'upload', label: '上传整理', path: 'upload' },
  { id: 'progress', label: '批改进度', path: 'progress' },
  { id: 'class-review', label: '班级总览', path: 'class-review' },
]
```

Update next-action labels:

```ts
secondaryLabel: '查看总览'
primaryLabel: '查看班级总览'
```

In `app/src/components/WorkflowNav.tsx`, remove unused icon map entries:

```tsx
import { ClipboardList, Presentation, Upload } from 'lucide-react'

const iconMap = {
  upload: Upload,
  progress: ClipboardList,
  'class-review': Presentation,
}
```

In `app/src/layout/AppLayout.tsx`, update derived step logic:

```ts
const derivedCurrentStep: WorkflowStepId = pathname.includes('/upload')
  ? 'upload'
  : pathname.includes('/class-review')
    ? 'class-review'
    : 'progress'
```

Do not remove the existing top-level `任务列表` `NavLink`; it remains the fourth visible navigation item when a task is open.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm.cmd test -- app/src/utils/workflow.test.ts app/src/components/WorkflowNav.test.tsx
```

Expected: focused tests pass.

- [ ] **Step 6: Run full checks**

Run:

```bash
npm.cmd test
npm.cmd run lint
```

Expected: all tests and lint pass.

- [ ] **Step 7: Browser verify navigation**

From `http://127.0.0.1:5173/`, click `查看`.

Expected:
- Left navigation shows only `任务列表`, `上传整理`, `批改进度`, `班级总览`.
- `异常复核`, `结果检查`, and `班级讲评` are absent from navigation.
- `任务列表` returns to `/`.
- `上传整理`, `批改进度`, and `班级总览` route correctly.
- Highlight state matches the current page.

- [ ] **Step 8: Commit**

```bash
git add app/src/utils/workflow.ts app/src/utils/workflow.test.ts app/src/components/WorkflowNav.tsx app/src/components/WorkflowNav.test.tsx app/src/layout/AppLayout.tsx
git commit -m "refactor: streamline task navigation"
```

---

### Task 3: Add Back Navigation For Detail Flows

**Files:**
- Modify: `app/src/pages/EssayResultPage.tsx`
- Modify: `app/src/pages/ExceptionsPage.tsx`

- [ ] **Step 1: Inspect current page headers**

Run:

```bash
rg -n "AppLayout|currentStep|SaveFeedback|markEssayManual|updateGradingResult" app/src/pages/EssayResultPage.tsx app/src/pages/ExceptionsPage.tsx
```

Expected: both pages use `AppLayout`; result page uses `currentStep="results"` before Task 2 and should now use or derive `progress`.

- [ ] **Step 2: Add back link to essay result page**

In `app/src/pages/EssayResultPage.tsx`, import `ArrowLeft` if not already imported:

```tsx
import { ArrowLeft } from 'lucide-react'
```

Inside the main `AppLayout` content, before the existing grid/content wrapper, add:

```tsx
<Link
  to={`/tasks/${task.id}/progress`}
  className="tech-focus inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50"
>
  <ArrowLeft className="h-4 w-4" />
  返回
</Link>
```

Set or keep the layout current step as progress:

```tsx
currentStep="progress"
```

- [ ] **Step 3: Add back link to exceptions page**

In `app/src/pages/ExceptionsPage.tsx`, import `ArrowLeft` and add the same link near the top of the page body:

```tsx
<Link
  to={`/tasks/${task.id}/progress`}
  className="tech-focus inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50"
>
  <ArrowLeft className="h-4 w-4" />
  返回
</Link>
```

Keep existing OCR save, manual review, and feedback logic unchanged.

- [ ] **Step 4: Run checks**

Run:

```bash
npm.cmd test
npm.cmd run lint
```

Expected: all tests and lint pass.

- [ ] **Step 5: Browser verify back links**

Use the browser:
- Open `/tasks/task-1/progress`.
- Click `查看结果` for a completed essay.
- Confirm `← 返回` is visible and returns to `/tasks/task-1/progress`.
- Click `去复核`.
- Confirm `← 返回` is visible and returns to `/tasks/task-1/progress`.
- On the exceptions page, mark one essay manual and confirm progress still updates when returning through the link.

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/EssayResultPage.tsx app/src/pages/ExceptionsPage.tsx
git commit -m "feat: add back navigation for review detail flows"
```

---

### Task 4: Upgrade Class Overview Statistics

**Files:**
- Create: `app/src/utils/classOverview.ts`
- Create: `app/src/utils/classOverview.test.ts`
- Modify: `app/src/pages/ClassReviewPage.tsx`

- [ ] **Step 1: Write failing class overview stats tests**

Create `app/src/utils/classOverview.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Essay, GradingResult } from '../types'
import { getClassOverviewStats } from './classOverview'

const essay = (id: string, status: Essay['status'] = 'completed') =>
  ({
    id,
    taskId: 'task-1',
    essayNumber: id,
    pages: [],
    pageCount: 1,
    pageOrder: [],
    ocrText: '',
    ocrConfidence: 0.9,
    status,
    exceptionReasons: [],
    teacherReviewed: status === 'completed' || status === 'manual',
    createdAt: '2026-06-25T09:00:00.000Z',
    updatedAt: '2026-06-25T09:00:00.000Z',
  }) as Essay

const result = (essayId: string, totalScore: number) =>
  ({
    id: `${essayId}-result`,
    essayId,
    totalScore,
    dimensionScores: [],
    errorAnnotations: [],
    sentenceRevisions: [],
    upgradedExpressions: [],
    overallComment: '',
    aiConfidence: 0.9,
    teacherAdjusted: false,
    createdAt: '2026-06-25T09:00:00.000Z',
    updatedAt: '2026-06-25T09:00:00.000Z',
  }) as GradingResult

describe('class overview stats', () => {
  it('calculates summary and 15-point score bands from task essays', () => {
    const stats = getClassOverviewStats(
      [
        essay('e1'),
        essay('e2'),
        essay('e3'),
        essay('e4'),
        essay('e5', 'manual'),
      ],
      [result('e1', 2.5), result('e2', 5), result('e3', 8.5), result('e4', 12.6)],
    )

    expect(stats.total).toBe(5)
    expect(stats.scoredCount).toBe(4)
    expect(stats.averageScore).toBe('7.2')
    expect(stats.highestScore).toBe('12.6')
    expect(stats.lowestScore).toBe('2.5')
    expect(stats.bands).toEqual([
      { label: '1-3', count: 1, percent: 25 },
      { label: '4-6', count: 1, percent: 25 },
      { label: '7-9', count: 1, percent: 25 },
      { label: '10-12', count: 0, percent: 0 },
      { label: '13-15', count: 1, percent: 25 },
    ])
  })

  it('uses dashes and zero distribution when no scores are available', () => {
    const stats = getClassOverviewStats([essay('e1', 'manual')], [])

    expect(stats).toMatchObject({
      total: 1,
      scoredCount: 0,
      averageScore: '-',
      highestScore: '-',
      lowestScore: '-',
    })
    expect(stats.bands.every((band) => band.count === 0 && band.percent === 0)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm.cmd test -- app/src/utils/classOverview.test.ts
```

Expected: fail because `app/src/utils/classOverview.ts` does not exist.

- [ ] **Step 3: Implement stats helper**

Create `app/src/utils/classOverview.ts`:

```ts
import type { Essay, GradingResult } from '../types'

interface ScoreBand {
  label: string
  min: number
  max: number
}

const scoreBands: ScoreBand[] = [
  { label: '1-3', min: 1, max: 3 },
  { label: '4-6', min: 4, max: 6 },
  { label: '7-9', min: 7, max: 9 },
  { label: '10-12', min: 10, max: 12 },
  { label: '13-15', min: 13, max: 15 },
]

export interface ClassOverviewBand {
  label: string
  count: number
  percent: number
}

export interface ClassOverviewStats {
  total: number
  scoredCount: number
  averageScore: string
  highestScore: string
  lowestScore: string
  bands: ClassOverviewBand[]
}

function formatScore(score: number) {
  return score.toFixed(1)
}

function getBandForScore(score: number) {
  return scoreBands.find((band) => score >= band.min && score <= band.max)
}

export function getClassOverviewStats(
  essays: Essay[],
  gradingResults: GradingResult[],
): ClassOverviewStats {
  const essayIds = new Set(essays.map((essay) => essay.id))
  const scores = gradingResults
    .filter((result) => essayIds.has(result.essayId))
    .map((result) => result.totalScore)
    .filter((score) => Number.isFinite(score))

  const bands = scoreBands.map((band) => {
    const count = scores.filter((score) => getBandForScore(score)?.label === band.label).length
    return {
      label: band.label,
      count,
      percent: scores.length === 0 ? 0 : Math.round((count / scores.length) * 100),
    }
  })

  if (scores.length === 0) {
    return {
      total: essays.length,
      scoredCount: 0,
      averageScore: '-',
      highestScore: '-',
      lowestScore: '-',
      bands,
    }
  }

  const totalScore = scores.reduce((sum, score) => sum + score, 0)

  return {
    total: essays.length,
    scoredCount: scores.length,
    averageScore: formatScore(totalScore / scores.length),
    highestScore: formatScore(Math.max(...scores)),
    lowestScore: formatScore(Math.min(...scores)),
    bands,
  }
}
```

- [ ] **Step 4: Run helper tests to verify GREEN**

Run:

```bash
npm.cmd test -- app/src/utils/classOverview.test.ts
```

Expected: helper tests pass.

- [ ] **Step 5: Update ClassReviewPage to class overview copy**

In `app/src/pages/ClassReviewPage.tsx`:
- import `getClassOverviewStats`
- include `essays` and `gradingResults` from `useAppState`
- derive task essays by task id
- remove `课堂讲评模式` chip
- change title to `班级总览`
- change description to `先看全班分数结构，再看高频问题和课堂讲评素材。`

Use:

```tsx
const { tasks, essays, gradingResults, classInsights } = useAppState()
const taskEssays = essays.filter((essay) => essay.taskId === taskId)
const stats = getClassOverviewStats(taskEssays, gradingResults)
```

- [ ] **Step 6: Add compact distribution module**

Place this before the existing insight grid:

```tsx
<section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
  <div className="flex flex-wrap items-center justify-between gap-4">
    <div>
      <p className="text-sm font-medium text-blue-700">班级作文整体表现</p>
      <h3 className="mt-1 text-xl font-semibold text-slate-950">分数分布</h3>
    </div>
    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      <div>
        <p className="text-slate-500">作文总数</p>
        <p className="mt-1 text-2xl font-semibold text-slate-950">{stats.total}</p>
      </div>
      <div>
        <p className="text-slate-500">平均分</p>
        <p className="mt-1 text-2xl font-semibold text-slate-950">{stats.averageScore}</p>
      </div>
      <div>
        <p className="text-slate-500">最高分</p>
        <p className="mt-1 text-2xl font-semibold text-slate-950">{stats.highestScore}</p>
      </div>
      <div>
        <p className="text-slate-500">最低分</p>
        <p className="mt-1 text-2xl font-semibold text-slate-950">{stats.lowestScore}</p>
      </div>
    </div>
  </div>
  <div className="mt-4 grid gap-3 md:grid-cols-5">
    {stats.bands.map((band) => (
      <div key={band.label} className="min-w-0">
        <div className="mb-1 flex items-center justify-between gap-2 text-xs text-slate-500">
          <span>{band.label} 分</span>
          <span>{band.count} 篇</span>
        </div>
        <div className="h-2 rounded-full bg-slate-100">
          <div
            className="h-2 rounded-full bg-cyan-500 transition-all"
            style={{ width: `${band.percent}%` }}
          />
        </div>
      </div>
    ))}
  </div>
</section>
```

Keep existing `ClassInsightPanel` grid unchanged.

- [ ] **Step 7: Run full checks**

Run:

```bash
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected: all pass.

- [ ] **Step 8: Browser verify class overview**

Open `/tasks/task-1/class-review`.

Expected:
- Page title is `班级总览`.
- No `课堂讲评模式` text appears.
- Top compact module shows `作文总数`, `平均分`, `最高分`, `最低分`.
- Distribution bands are `1-3`, `4-6`, `7-9`, `10-12`, `13-15`.
- Existing high-frequency grammar, spelling, typical sentence, and rewrite panels still appear.
- Desktop and mobile widths have no horizontal overflow.

- [ ] **Step 9: Clean build output**

If `app/dist` exists after build:

```powershell
$dist = Join-Path (Get-Location).Path 'dist'; if (Test-Path -LiteralPath $dist) { $target = Resolve-Path -LiteralPath $dist; if ($target.Path -like (Join-Path (Get-Location).Path '*')) { Remove-Item -LiteralPath $target.Path -Recurse -Force } else { throw "Refusing to remove unexpected path $($target.Path)" } }
```

- [ ] **Step 10: Commit**

```bash
git add app/src/utils/classOverview.ts app/src/utils/classOverview.test.ts app/src/pages/ClassReviewPage.tsx
git commit -m "feat: upgrade class overview statistics"
```

---

### Task 5: Final Regression Verification

**Files:**
- No production files expected.
- If a final verification note is desired, update `docs/current_development_status.md`; otherwise do not create a verification-only commit.

- [ ] **Step 1: Run final command verification**

Run:

```bash
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected: all pass.

- [ ] **Step 2: Browser full regression**

Use `http://127.0.0.1:5173/` and verify:
- Task cards only show `查看`.
- `查看` enters the task progress page.
- Task internal navigation shows only `任务列表`, `上传整理`, `批改进度`, `班级总览`.
- Upload page opens.
- Progress page still shows totals, exceptions, status chips, and the completion flow.
- Completed essay `查看结果` opens result page and `← 返回` returns to progress.
- Needs-review essay `去复核` opens exceptions page and `← 返回` returns to progress.
- Marking manual review still updates progress and can reach 10/10.
- Result score edit still shows inline save feedback and auto-dismisses.
- Class overview shows compact distribution and existing insight panels.
- Desktop and mobile widths have no incoherent overlap or horizontal overflow.

- [ ] **Step 3: Clean build output**

If `app/dist` exists, remove it safely:

```powershell
$dist = Join-Path (Get-Location).Path 'dist'; if (Test-Path -LiteralPath $dist) { $target = Resolve-Path -LiteralPath $dist; if ($target.Path -like (Join-Path (Get-Location).Path '*')) { Remove-Item -LiteralPath $target.Path -Recurse -Force } else { throw "Refusing to remove unexpected path $($target.Path)" } }
```

- [ ] **Step 4: Report verification**

Summarize:
- commands run
- browser pages checked
- any residual risks
- current branch and git status

No commit is required unless files changed.
