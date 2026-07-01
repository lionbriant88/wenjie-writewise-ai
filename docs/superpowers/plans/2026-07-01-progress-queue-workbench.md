# Progress Queue Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the progress page into a clearer teacher-facing grading queue workbench while preserving the existing upload, exception review, essay detail, and class review flows.

**Architecture:** Keep `ProgressSummary` and the current route structure intact. Add focused queue stat/filter helpers in `app/src/utils/progressQueue.ts`, then update `ProgressPage` with a page-specific queue action bar, latest completed entry, status tabs, and review-row emphasis.

**Tech Stack:** React, TypeScript, React Router, Vitest, Testing Library, Tailwind CSS, existing in-memory `AppStateProvider` mock state.

---

## File Structure

- Create: `app/src/utils/progressQueue.ts`
  - Owns progress queue classification, tab filtering, and count calculation.
- Create: `app/src/utils/progressQueue.test.ts`
  - Unit tests for queue stats, processable status detection, and tab filtering.
- Modify: `app/src/pages/ProgressPage.tsx`
  - Replaces the current middle `NextActionPanel` usage with a progress-page queue action bar.
  - Adds latest-completed entry, tabs, filtered desktop table, filtered mobile cards, empty states, and batch mock completion.
- Modify: `app/src/pages/ProgressPage.test.tsx`
  - Expands current upload-to-progress regression and adds focused queue-workbench tests.
- Optional Modify: `docs/current_development_status.md`
  - Update only after implementation verification, recording the new progress-page queue workbench status.

No changes should be made to upload, detail, exception review, class review core logic, or global backend-like behavior.

---

### Task 1: Add Queue Stats And Filtering Utilities

**Files:**
- Create: `app/src/utils/progressQueue.test.ts`
- Create: `app/src/utils/progressQueue.ts`

- [ ] **Step 1: Write the failing utility tests**

Create `app/src/utils/progressQueue.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Essay, EssayStatus } from '../types'
import {
  filterEssaysByProgressTab,
  getProgressQueueStats,
  isProcessableEssayStatus,
} from './progressQueue'

function essay(id: string, status: EssayStatus): Essay {
  return {
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
    teacherReviewed: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}

describe('progressQueue', () => {
  it('calculates queue stats from current essay statuses', () => {
    const essays = [
      essay('作文 1', 'completed'),
      essay('作文 2', 'manual'),
      essay('作文 3', 'needs_review'),
      essay('作文 4', 'pending_grading'),
      essay('作文 5', 'grading'),
      essay('作文 6', 'pending_ocr'),
      essay('作文 7', 'ocr_running'),
    ]

    expect(getProgressQueueStats(essays)).toEqual({
      total: 7,
      completed: 1,
      processing: 4,
      reviewNeeded: 1,
      pending: 2,
      completionRate: 14,
      processable: 4,
    })
  })

  it('identifies only mock-processable statuses', () => {
    expect(isProcessableEssayStatus('pending_ocr')).toBe(true)
    expect(isProcessableEssayStatus('ocr_running')).toBe(true)
    expect(isProcessableEssayStatus('pending_grading')).toBe(true)
    expect(isProcessableEssayStatus('grading')).toBe(true)
    expect(isProcessableEssayStatus('completed')).toBe(false)
    expect(isProcessableEssayStatus('needs_review')).toBe(false)
    expect(isProcessableEssayStatus('manual')).toBe(false)
  })

  it('filters essays by progress tab without treating manual as completed', () => {
    const essays = [
      essay('作文 1', 'completed'),
      essay('作文 2', 'manual'),
      essay('作文 3', 'needs_review'),
      essay('作文 4', 'pending_grading'),
      essay('作文 5', 'grading'),
    ]

    expect(filterEssaysByProgressTab(essays, 'all').map((item) => item.id)).toEqual([
      '作文 1',
      '作文 2',
      '作文 3',
      '作文 4',
      '作文 5',
    ])
    expect(filterEssaysByProgressTab(essays, 'processing').map((item) => item.id)).toEqual([
      '作文 4',
      '作文 5',
    ])
    expect(filterEssaysByProgressTab(essays, 'review').map((item) => item.id)).toEqual(['作文 3'])
    expect(filterEssaysByProgressTab(essays, 'completed').map((item) => item.id)).toEqual(['作文 1'])
  })
})
```

- [ ] **Step 2: Run the utility tests and verify they fail**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/utils/progressQueue.test.ts
```

Expected: FAIL because `./progressQueue` does not exist.

- [ ] **Step 3: Implement the queue utility**

Create `app/src/utils/progressQueue.ts`:

```ts
import type { Essay, EssayStatus } from '../types'

export type ProgressQueueTab = 'all' | 'processing' | 'review' | 'completed'

export interface ProgressQueueStats {
  total: number
  completed: number
  processing: number
  reviewNeeded: number
  pending: number
  completionRate: number
  processable: number
}

const processableStatuses = new Set<EssayStatus>([
  'pending_ocr',
  'ocr_running',
  'pending_grading',
  'grading',
])

const pendingStatuses = new Set<EssayStatus>(['pending_ocr', 'pending_grading'])

export function isProcessableEssayStatus(status: EssayStatus): boolean {
  return processableStatuses.has(status)
}

export function getProgressQueueStats(essays: Essay[]): ProgressQueueStats {
  const total = essays.length
  const completed = essays.filter((essay) => essay.status === 'completed').length
  const processing = essays.filter((essay) => isProcessableEssayStatus(essay.status)).length
  const reviewNeeded = essays.filter((essay) => essay.status === 'needs_review').length
  const pending = essays.filter((essay) => pendingStatuses.has(essay.status)).length

  return {
    total,
    completed,
    processing,
    reviewNeeded,
    pending,
    completionRate: total === 0 ? 0 : Math.round((completed / total) * 100),
    processable: processing,
  }
}

export function filterEssaysByProgressTab(essays: Essay[], tab: ProgressQueueTab): Essay[] {
  if (tab === 'processing') {
    return essays.filter((essay) => isProcessableEssayStatus(essay.status))
  }

  if (tab === 'review') {
    return essays.filter((essay) => essay.status === 'needs_review')
  }

  if (tab === 'completed') {
    return essays.filter((essay) => essay.status === 'completed')
  }

  return essays
}
```

- [ ] **Step 4: Run utility tests and verify they pass**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/utils/progressQueue.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit utility work**

Run:

```powershell
git add app/src/utils/progressQueue.ts app/src/utils/progressQueue.test.ts
git commit -m "feat: add progress queue helpers"
```

---

### Task 2: Add Queue Workbench Rendering Tests

**Files:**
- Modify: `app/src/pages/ProgressPage.test.tsx`

- [ ] **Step 1: Add route coverage for exceptions and class review**

Extend the test imports:

```ts
import { ClassReviewPage } from './ClassReviewPage'
import { ExceptionsPage } from './ExceptionsPage'
```

Add these routes inside the existing `Routes` tree:

```tsx
<Route path="/tasks/:taskId/exceptions" element={<ExceptionsPage />} />
<Route path="/tasks/:taskId/class-review" element={<ClassReviewPage />} />
```

- [ ] **Step 2: Add a focused render helper for the existing mock task**

Add below the existing helper:

```tsx
function renderProgressFlow() {
  render(
    <AppStateProvider>
      <MemoryRouter initialEntries={['/tasks/task-1/progress']}>
        <Routes>
          <Route path="/tasks/:taskId/progress" element={<ProgressPage />} />
          <Route path="/tasks/:taskId/exceptions" element={<ExceptionsPage />} />
          <Route path="/tasks/:taskId/class-review" element={<ClassReviewPage />} />
          <Route path="/tasks/:taskId/essays/:essayId" element={<EssayResultPage />} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
}
```

- [ ] **Step 3: Add failing tests for operation bar, tabs, and filtering**

Add:

```ts
it('shows queue operation bar and status tabs without replacing the summary cards', async () => {
  renderProgressFlow()

  expect(screen.getByText('作文总数')).toBeInTheDocument()
  expect(screen.getByText('已完成')).toBeInTheDocument()
  expect(screen.getByText('需复核')).toBeInTheDocument()
  expect(screen.getByText('整体进度')).toBeInTheDocument()

  expect(screen.getByText(/当前队列：/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '模拟完成下一篇' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '模拟完成全部可处理' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '查看异常队列' })).toBeInTheDocument()

  expect(screen.getByRole('tab', { name: /全部/ })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: /处理中/ })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: /需复核/ })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: /已完成/ })).toBeInTheDocument()
})

it('filters progress table by review and completed tabs', async () => {
  const user = userEvent.setup()
  renderProgressFlow()

  await user.click(screen.getByRole('tab', { name: /需复核/ }))
  expect(screen.getByText('当前显示：需复核')).toBeInTheDocument()
  expect(screen.getAllByText('去复核').length).toBeGreaterThan(0)
  expect(screen.queryByText('模拟进度')).not.toBeInTheDocument()

  await user.click(screen.getByRole('tab', { name: /已完成/ }))
  expect(screen.getByText('当前显示：已完成')).toBeInTheDocument()
  expect(screen.getAllByRole('link', { name: '查看结果' }).length).toBeGreaterThan(0)
  expect(screen.queryByRole('link', { name: '去复核' })).not.toBeInTheDocument()
})
```

- [ ] **Step 4: Run the ProgressPage tests and verify they fail**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/ProgressPage.test.tsx
```

Expected: FAIL because queue operation bar, tabs, and filtering are not implemented.

---

### Task 3: Implement Queue Operation Bar And Tabs

**Files:**
- Modify: `app/src/pages/ProgressPage.tsx`

- [ ] **Step 1: Replace local status constants with utility imports**

Update imports:

```ts
import { ArrowRight, CheckCircle2, ListFilter, TriangleAlert } from 'lucide-react'
import {
  filterEssaysByProgressTab,
  getProgressQueueStats,
  isProcessableEssayStatus,
  type ProgressQueueTab,
} from '../utils/progressQueue'
```

Remove the local `processableStatuses` constant.

- [ ] **Step 2: Add tab labels and empty-state copy**

Add near the helper functions:

```ts
const progressTabs: Array<{ id: ProgressQueueTab; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'processing', label: '处理中' },
  { id: 'review', label: '需复核' },
  { id: 'completed', label: '已完成' },
]

const emptyTabText: Record<ProgressQueueTab, string> = {
  all: '当前还没有作文进入批改队列。',
  processing: '当前没有处理中作文。',
  review: '当前没有需复核作文。',
  completed: '当前没有已完成作文。',
}
```

- [ ] **Step 3: Add tab state and derived data**

Inside `ProgressPage`:

```ts
const [activeTab, setActiveTab] = useState<ProgressQueueTab>('all')
const queueStats = getProgressQueueStats(taskEssays)
const filteredEssays = filterEssaysByProgressTab(taskEssays, activeTab)
const processableEssays = taskEssays.filter((essay) => isProcessableEssayStatus(essay.status))
const nextProcessableEssay = processableEssays[0]
const hasExceptions = queueStats.reviewNeeded > 0
```

Remove the old `nextAction`, `panelAction`, and old `hasExceptions` calculations.

- [ ] **Step 4: Add a page-specific queue operation bar**

Add before the `return`:

```tsx
const queueTone = hasExceptions ? 'border-rose-100 bg-rose-50/60' : 'border-blue-100 bg-white'
const queueIconClass = hasExceptions ? 'bg-rose-100 text-rose-700' : 'bg-blue-50 text-blue-700'
const QueueIcon = hasExceptions ? TriangleAlert : ListFilter
```

Replace the current `NextActionPanel` render with:

```tsx
<section className={`rounded-lg border p-4 shadow-sm ${queueTone}`}>
  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
    <div className="flex gap-3">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${queueIconClass}`}>
        <QueueIcon className="h-5 w-5" />
      </div>
      <div>
        <h3 className="font-semibold text-slate-950">
          当前队列：{queueStats.processing} 篇处理中，{queueStats.reviewNeeded} 篇需人工复核。
        </h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
          {queueStats.processing > 0
            ? '可以逐篇或批量模拟完成批改，完成后会生成可查看的 mock 批改结果。'
            : queueStats.reviewNeeded > 0
              ? `所有可处理作文已完成，仍有 ${queueStats.reviewNeeded} 篇需要人工复核。`
              : queueStats.total > 0
                ? '全部作文已完成批改，可以进入班级总览查看整体表现。'
                : '等待作文进入批改队列。'}
        </p>
      </div>
    </div>
    <div className="flex flex-wrap gap-2">
      {nextProcessableEssay ? (
        <button
          type="button"
          onClick={completeNextEssay}
          className="tech-focus inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 active:scale-[0.99]"
        >
          模拟完成下一篇
          <ArrowRight className="h-4 w-4" />
        </button>
      ) : null}
      {processableEssays.length > 1 ? (
        <button
          type="button"
          onClick={completeAllProcessableEssays}
          className="tech-focus inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-800 transition hover:bg-blue-100"
        >
          模拟完成全部可处理
        </button>
      ) : null}
      {hasExceptions ? (
        <Link
          to={`/tasks/${task.id}/exceptions`}
          className="tech-focus inline-flex items-center rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
        >
          查看异常队列
        </Link>
      ) : null}
      {!nextProcessableEssay && !hasExceptions && queueStats.total > 0 ? (
        <Link
          to={`/tasks/${task.id}/class-review`}
          className="tech-focus inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800"
        >
          进入班级总览
          <CheckCircle2 className="h-4 w-4" />
        </Link>
      ) : null}
      {queueStats.total === 0 ? (
        <Link
          to={`/tasks/${task.id}/upload`}
          className="tech-focus inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800"
        >
          去上传作文
          <ArrowRight className="h-4 w-4" />
        </Link>
      ) : null}
    </div>
  </div>
</section>
```

- [ ] **Step 5: Add status tabs above the table and mobile cards**

Place after the latest-completed area and before the list/table:

```tsx
<section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="批改队列筛选">
      {progressTabs.map((tab) => {
        const count =
          tab.id === 'all'
            ? queueStats.total
            : tab.id === 'processing'
              ? queueStats.processing
              : tab.id === 'review'
                ? queueStats.reviewNeeded
                : queueStats.completed
        const selected = activeTab === tab.id
        const selectedClass =
          tab.id === 'review'
            ? 'border-rose-200 bg-rose-50 text-rose-700'
            : 'border-blue-200 bg-blue-50 text-blue-700'

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => setActiveTab(tab.id)}
            className={[
              'tech-focus rounded-lg border px-3 py-2 text-sm font-semibold transition',
              selected ? selectedClass : 'border-slate-200 bg-white text-slate-600 hover:border-cyan-200 hover:bg-cyan-50',
            ].join(' ')}
          >
            {tab.label} {count}
          </button>
        )
      })}
    </div>
    <p className="text-sm font-medium text-slate-500">
      当前显示：{progressTabs.find((tab) => tab.id === activeTab)?.label}
    </p>
  </div>
</section>
```

- [ ] **Step 6: Render filtered essays and empty states**

Replace `taskEssays.map` in mobile and desktop sections with `filteredEssays.map`.

Before the mobile card grid, add:

```tsx
{filteredEssays.length === 0 ? (
  <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm font-medium text-slate-500">
    {emptyTabText[activeTab]}
  </div>
) : null}
```

Only render the mobile grid and desktop table when `filteredEssays.length > 0`.

- [ ] **Step 7: Run ProgressPage tests**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/ProgressPage.test.tsx
```

Expected: Existing and new tests pass except tests for latest completed and batch completion, which are added in Task 4.

- [ ] **Step 8: Commit operation bar and tabs**

Run:

```powershell
git add app/src/pages/ProgressPage.tsx app/src/pages/ProgressPage.test.tsx
git commit -m "feat: add progress queue tabs and action bar"
```

---

### Task 4: Add Latest Completed Entry And Batch Completion

**Files:**
- Modify: `app/src/pages/ProgressPage.test.tsx`
- Modify: `app/src/pages/ProgressPage.tsx`

- [ ] **Step 1: Add failing tests for latest-completed entry**

Add:

```ts
it('shows the latest completed essay entry after completing one essay', async () => {
  const user = userEvent.setup()
  renderProgressFlow()

  await user.click(screen.getByRole('button', { name: '模拟完成下一篇' }))

  expect(screen.getByRole('status')).toHaveTextContent(/已生成批改结果/)
  const latestLink = screen.getByRole('link', { name: '查看详情' })
  await user.click(latestLink)

  expect(screen.getByRole('heading', { name: /批改结果/ })).toBeInTheDocument()
})
```

- [ ] **Step 2: Add failing tests for batch completion**

Add:

```ts
it('batch-completes all processable essays without completing review-needed essays', async () => {
  const user = userEvent.setup()
  renderProgressFlow()

  await user.click(screen.getByRole('button', { name: '模拟完成全部可处理' }))

  expect(screen.getByRole('status')).toHaveTextContent(/已完成 \d+ 篇作文的模拟批改/)
  expect(screen.queryByRole('button', { name: '模拟完成下一篇' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '模拟完成全部可处理' })).not.toBeInTheDocument()

  await user.click(screen.getByRole('tab', { name: /需复核/ }))
  expect(screen.getAllByRole('link', { name: '去复核' }).length).toBeGreaterThan(0)
})
```

- [ ] **Step 3: Run ProgressPage tests and verify they fail**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/ProgressPage.test.tsx
```

Expected: FAIL because latest-completed entry and batch completion are not implemented.

- [ ] **Step 4: Add latest-completed state**

Inside `ProgressPage`:

```ts
const [latestCompletedEssayId, setLatestCompletedEssayId] = useState<string | null>(null)
const [latestCompletionCount, setLatestCompletionCount] = useState(0)
const latestCompletedEssay = latestCompletedEssayId
  ? taskEssays.find((essay) => essay.id === latestCompletedEssayId)
  : undefined
```

- [ ] **Step 5: Update complete-next logic**

Replace `completeNextEssay` body:

```ts
const completeNextEssay = () => {
  if (!nextProcessableEssay) return

  completeEssayWithMockResult(nextProcessableEssay.id)
  setLatestCompletedEssayId(nextProcessableEssay.id)
  setLatestCompletionCount(1)
  setCompletionNotice(`${nextProcessableEssay.essayNumber} 已生成批改结果`)
  if (noticeTimerRef.current) {
    window.clearTimeout(noticeTimerRef.current)
  }
  noticeTimerRef.current = window.setTimeout(() => {
    setCompletionNotice('')
    noticeTimerRef.current = null
  }, 3000)
}
```

- [ ] **Step 6: Add batch completion logic**

Add:

```ts
const completeAllProcessableEssays = () => {
  if (processableEssays.length === 0) return

  processableEssays.forEach((essay) => completeEssayWithMockResult(essay.id))
  const lastCompletedEssay = processableEssays[processableEssays.length - 1]
  setLatestCompletedEssayId(lastCompletedEssay.id)
  setLatestCompletionCount(processableEssays.length)
  setCompletionNotice(`已完成 ${processableEssays.length} 篇作文的模拟批改`)
  if (noticeTimerRef.current) {
    window.clearTimeout(noticeTimerRef.current)
  }
  noticeTimerRef.current = window.setTimeout(() => {
    setCompletionNotice('')
    noticeTimerRef.current = null
  }, 3000)
}
```

- [ ] **Step 7: Render latest-completed entry**

Place after the transient `completionNotice` block:

```tsx
{latestCompletedEssay ? (
  <div
    role="status"
    className="flex flex-col gap-3 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-sm md:flex-row md:items-center md:justify-between"
  >
    <div>
      <p className="font-semibold">
        {latestCompletionCount > 1
          ? `已完成 ${latestCompletionCount} 篇作文的模拟批改`
          : `最新完成：${latestCompletedEssay.essayNumber} 已生成批改结果`}
      </p>
      <p className="mt-1 text-emerald-700">可直接进入刚完成的作文详情页查看 mock 批改结果。</p>
    </div>
    <Link
      to={`/tasks/${task.id}/essays/${latestCompletedEssay.id}`}
      className="tech-focus inline-flex items-center justify-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800"
    >
      {latestCompletionCount > 1 ? '查看最新完成作文' : '查看详情'}
    </Link>
  </div>
) : null}
```

If duplicate `role="status"` creates ambiguous tests, keep only the latest-completed entry as `role="status"` and remove `role="status"` from the short auto-dismiss notice.

- [ ] **Step 8: Run ProgressPage tests**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/ProgressPage.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit latest-completed and batch completion**

Run:

```powershell
git add app/src/pages/ProgressPage.tsx app/src/pages/ProgressPage.test.tsx
git commit -m "feat: add progress queue batch completion"
```

---

### Task 5: Emphasize Review Needed Rows And Preserve Navigation

**Files:**
- Modify: `app/src/pages/ProgressPage.test.tsx`
- Modify: `app/src/pages/ProgressPage.tsx`

- [ ] **Step 1: Add navigation and visual-state tests**

Add:

```ts
it('keeps exception, detail, and class review navigation available', async () => {
  const user = userEvent.setup()
  renderProgressFlow()

  await user.click(screen.getByRole('link', { name: '查看异常队列' }))
  expect(screen.getByRole('heading', { name: '异常复核' })).toBeInTheDocument()
})

it('marks review-needed rows for quick scanning', () => {
  renderProgressFlow()

  const reviewRows = screen.getAllByTestId('progress-review-row')
  expect(reviewRows.length).toBeGreaterThan(0)
  expect(reviewRows[0]).toHaveClass('bg-rose-50')
})
```

If `ExceptionsPage` heading uses a longer label, match with a regular expression:

```ts
expect(screen.getByRole('heading', { name: /异常/ })).toBeInTheDocument()
```

- [ ] **Step 2: Run tests and verify the visual-state test fails**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/ProgressPage.test.tsx
```

Expected: FAIL because review rows do not have `data-testid="progress-review-row"`.

- [ ] **Step 3: Add review-row styles to desktop table**

Update table row:

```tsx
<tr
  key={essay.id}
  data-testid={essay.status === 'needs_review' ? 'progress-review-row' : undefined}
  className={essay.status === 'needs_review' ? 'bg-rose-50/70' : undefined}
>
```

If the test expects exact `bg-rose-50`, use:

```tsx
className={essay.status === 'needs_review' ? 'bg-rose-50' : undefined}
```

- [ ] **Step 4: Add review emphasis to mobile cards**

Update mobile card class:

```tsx
className={[
  'rounded-lg border p-4 shadow-sm',
  essay.status === 'needs_review'
    ? 'border-rose-100 bg-rose-50'
    : 'border-slate-200 bg-white',
].join(' ')}
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/ProgressPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit review-row emphasis**

Run:

```powershell
git add app/src/pages/ProgressPage.tsx app/src/pages/ProgressPage.test.tsx
git commit -m "feat: emphasize review items in progress queue"
```

---

### Task 6: Full Regression, Browser Check, And Memory Update

**Files:**
- Optional Modify: `docs/current_development_status.md`

- [ ] **Step 1: Run focused utility and page tests**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/utils/progressQueue.test.ts src/pages/ProgressPage.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full verification**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected:

- All Vitest files pass.
- `oxlint` exits 0.
- TypeScript and Vite build exit 0.

- [ ] **Step 3: Browser-check the progress page**

Start or reuse the local preview:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd run dev
```

Open:

```text
http://127.0.0.1:5173/tasks/task-1/progress
```

Manually verify:

- Top summary cards still appear.
- Queue operation bar shows processing and review-needed counts.
- Tabs switch between all, processing, review, and completed.
- Review-needed rows are visually emphasized.
- “模拟完成下一篇” shows latest-completed entry.
- “模拟完成全部可处理” completes only processable essays.
- “查看异常队列” opens exceptions page.
- “查看结果” opens essay detail.
- “进入班级总览” appears once all processable essays are completed and no review-needed essays remain in that state scenario.

- [ ] **Step 4: Update memory file**

Append a concise section to `docs/current_development_status.md`:

```md
## 本次新增进展：批改进度页队列体验优化 v2

- 批改进度页保留顶部统计卡片，并新增队列操作条。
- 新增状态筛选 Tabs：全部、处理中、需复核、已完成。
- 新增最新完成作文入口，支持单篇完成和批量完成后的快速查看。
- 新增“模拟完成全部可处理”，只处理 pending/OCR/grading 类状态，不处理需复核或已完成作文。
- 需复核作文在表格和移动端卡片中更突出。
- 已验证上传、异常复核、详情页和班级总览入口未被破坏。
```

- [ ] **Step 5: Commit verification memory update**

Run:

```powershell
git add docs/current_development_status.md
git commit -m "docs: update progress queue status"
```

- [ ] **Step 6: Final status check**

Run:

```powershell
git status --short --branch
git log --oneline -5
```

Expected: working tree clean, current branch contains the implementation commits.

---

## Self-Review Checklist

- Spec coverage: queue operation bar, latest completed entry, status tabs, batch completion, review emphasis, and non-goals are mapped to tasks.
- Placeholder scan: the plan contains no unfinished placeholder markers or open-ended “handle later” instructions.
- Type consistency: `ProgressQueueTab`, `ProgressQueueStats`, `isProcessableEssayStatus`, `getProgressQueueStats`, and `filterEssaysByProgressTab` are defined before use.
- Scope check: implementation is limited to progress-page queue UX, progress queue utilities, tests, and memory documentation.
- Verification: focused tests, full tests, lint, build, and browser check are all required before completion.
