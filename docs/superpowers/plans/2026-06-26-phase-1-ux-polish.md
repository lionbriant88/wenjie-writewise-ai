# Phase 1 UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the phase 1 Wenjie WriteWise AI prototype so teachers can scan workflow state, find the next action, and feel a concise light-technology interface.

**Architecture:** Keep the existing Vite React SPA and mock-data state model. Add small shared UI components for workflow navigation, next-action guidance, essay status chips, responsive essay rows, and save feedback; update page components to use them without route or data-model churn. Add a small context action for simulated grading completion so progress-page status chips can demonstrate lightweight state transitions.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS, React Router, lucide-react, Vitest, Testing Library.

---

## File Structure

- Create: `app/src/utils/workflow.ts`
  - Owns workflow step metadata and next-action decision logic.
- Create: `app/src/utils/workflow.test.ts`
  - Tests next-action and workflow metadata behavior.
- Create: `app/src/components/WorkflowNav.tsx`
  - Renders compact workflow shortcuts for task pages, including narrow-screen top navigation.
- Create: `app/src/components/NextActionPanel.tsx`
  - Renders the page-level recommendation and primary actions for teacher workflow decisions.
- Create: `app/src/components/EssayStatusChip.tsx`
  - Renders essay status labels with subtle transitions, pulse for active states, and checkmark for completed states.
- Create: `app/src/components/SaveFeedback.tsx`
  - Renders a compact inline success message for score/OCR/comment changes.
- Modify: `app/src/context/appStateContextValue.ts`
  - Add `completeEssayWithMockResult(essayId)` to the context contract.
- Modify: `app/src/context/AppStateContext.tsx`
  - Implement the simulated completion action and mock result creation.
- Modify: `app/src/layout/AppLayout.tsx`
  - Add workflow navigation and light technology styling to the shared shell.
- Modify: `app/src/pages/TaskListPage.tsx`
  - Make task cards denser and surface the strongest next action.
- Modify: `app/src/pages/ProgressPage.tsx`
  - Add next-action panel, responsive cards for narrow screens, status chips, and simulated completion interaction.
- Modify: `app/src/pages/ExceptionsPage.tsx`
  - Group exception actions and show OCR/manual-save feedback.
- Modify: `app/src/pages/EssayResultPage.tsx`
  - Add score summary, grouped save feedback, and clearer score hierarchy.
- Modify: `app/src/pages/ClassReviewPage.tsx`
  - Refine the whiteboard page into a cleaner presentation surface with subtle technology accents.
- Modify: `app/src/index.css`
  - Add reusable transition and reduced-motion utilities.

## Task 1: Add Workflow And Status Helper Tests

**Files:**
- Create: `app/src/utils/workflow.test.ts`
- Create: `app/src/utils/workflow.ts`

- [ ] **Step 1: Write failing tests for workflow decisions**

Create `app/src/utils/workflow.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Essay, Task } from '../types'
import {
  getEssayStatusMeta,
  getProgressNextAction,
  getWorkflowSteps,
} from './workflow'

const task = {
  id: 'task-1',
  taskName: '九年级建议信单元测',
  className: '九年级 3 班',
  essayType: '建议信',
  fullScore: 15,
  scoringTemplateId: 'default-15',
  status: 'needs_review',
  totalEssayCount: 3,
  completedEssayCount: 1,
  exceptionEssayCount: 1,
  createdAt: '2026-06-25T09:00:00.000Z',
  updatedAt: '2026-06-25T09:00:00.000Z',
  generateClassReview: true,
} satisfies Task

const essay = (id: string, status: Essay['status']) =>
  ({
    id,
    taskId: task.id,
    essayNumber: id,
    pages: [],
    pageCount: 1,
    pageOrder: [],
    ocrText: '',
    ocrConfidence: 0.88,
    status,
    exceptionReasons: [],
    teacherReviewed: status === 'completed',
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }) as Essay

describe('workflow helpers', () => {
  it('returns stable task workflow steps with current step marked', () => {
    expect(getWorkflowSteps(task.id, 'progress')).toEqual([
      { id: 'upload', label: '上传整理', to: '/tasks/task-1/upload', current: false },
      { id: 'progress', label: '批改进度', to: '/tasks/task-1/progress', current: true },
      { id: 'exceptions', label: '异常复核', to: '/tasks/task-1/exceptions', current: false },
      { id: 'results', label: '结果检查', to: '/tasks/task-1/progress', current: false },
      { id: 'class-review', label: '班级讲评', to: '/tasks/task-1/class-review', current: false },
    ])
  })

  it('prioritizes exception review when exceptions exist', () => {
    const next = getProgressNextAction(task, [
      essay('作文 1', 'completed'),
      essay('作文 2', 'needs_review'),
      essay('作文 3', 'grading'),
    ])

    expect(next).toMatchObject({
      tone: 'danger',
      title: '先处理 1 篇异常作文',
      primaryLabel: '去复核',
      primaryTo: '/tasks/task-1/exceptions',
    })
  })

  it('points to class review when all essays are completed', () => {
    const next = getProgressNextAction({ ...task, status: 'ready' }, [
      essay('作文 1', 'completed'),
      essay('作文 2', 'completed'),
    ])

    expect(next).toMatchObject({
      tone: 'success',
      title: '本批作文已完成',
      primaryLabel: '查看班级讲评',
      primaryTo: '/tasks/task-1/class-review',
    })
  })

  it('labels active and completed essay statuses for animated chips', () => {
    expect(getEssayStatusMeta('grading')).toMatchObject({
      label: '批改中',
      animated: true,
    })
    expect(getEssayStatusMeta('completed')).toMatchObject({
      label: '已完成',
      showCheck: true,
    })
  })
})
```

- [ ] **Step 2: Run the workflow tests and verify RED**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/utils/workflow.test.ts
```

Expected: fails because `app/src/utils/workflow.ts` does not exist.

- [ ] **Step 3: Implement workflow helpers**

Create `app/src/utils/workflow.ts`:

```ts
import type { Essay, EssayStatus, Task } from '../types'

export type WorkflowStepId = 'upload' | 'progress' | 'exceptions' | 'results' | 'class-review'

export interface WorkflowStep {
  id: WorkflowStepId
  label: string
  to: string
  current: boolean
}

export interface NextAction {
  tone: 'info' | 'danger' | 'success'
  title: string
  description: string
  primaryLabel: string
  primaryTo: string
  secondaryLabel?: string
  secondaryTo?: string
}

export interface EssayStatusMeta {
  label: string
  className: string
  animated?: boolean
  showCheck?: boolean
}

const workflowLabels: Array<{ id: WorkflowStepId; label: string; path: string }> = [
  { id: 'upload', label: '上传整理', path: 'upload' },
  { id: 'progress', label: '批改进度', path: 'progress' },
  { id: 'exceptions', label: '异常复核', path: 'exceptions' },
  { id: 'results', label: '结果检查', path: 'progress' },
  { id: 'class-review', label: '班级讲评', path: 'class-review' },
]

export function getWorkflowSteps(taskId: string, current: WorkflowStepId): WorkflowStep[] {
  return workflowLabels.map((step) => ({
    id: step.id,
    label: step.label,
    to: `/tasks/${taskId}/${step.path}`,
    current: step.id === current,
  }))
}

export function getProgressNextAction(task: Task, essays: Essay[]): NextAction {
  const exceptionCount = essays.filter((essay) => essay.status === 'needs_review').length
  const completedCount = essays.filter((essay) => essay.status === 'completed').length
  const activeCount = essays.filter((essay) =>
    ['pending_ocr', 'ocr_running', 'pending_grading', 'grading'].includes(essay.status),
  ).length

  if (exceptionCount > 0) {
    return {
      tone: 'danger',
      title: `先处理 ${exceptionCount} 篇异常作文`,
      description: '系统已经把低置信度或图像质量不稳定的作文集中到复核队列。',
      primaryLabel: '去复核',
      primaryTo: `/tasks/${task.id}/exceptions`,
      secondaryLabel: '查看讲评',
      secondaryTo: `/tasks/${task.id}/class-review`,
    }
  }

  if (essays.length > 0 && completedCount === essays.length) {
    return {
      tone: 'success',
      title: '本批作文已完成',
      description: '可以直接查看班级共性问题，用于课堂讲评或白板展示。',
      primaryLabel: '查看班级讲评',
      primaryTo: `/tasks/${task.id}/class-review`,
    }
  }

  return {
    tone: 'info',
    title: activeCount > 0 ? `${activeCount} 篇作文仍在模拟处理中` : '等待作文进入批改队列',
    description: '阶段一原型使用本地 mock 数据模拟 OCR 与 AI 批改状态。',
    primaryLabel: '模拟完成下一篇',
    primaryTo: `/tasks/${task.id}/progress`,
    secondaryLabel: '查看异常队列',
    secondaryTo: `/tasks/${task.id}/exceptions`,
  }
}

export function getEssayStatusMeta(status: EssayStatus): EssayStatusMeta {
  const map: Record<EssayStatus, EssayStatusMeta> = {
    pending_ocr: {
      label: '待识别',
      className: 'border-slate-200 bg-slate-100 text-slate-600',
    },
    ocr_running: {
      label: '识别中',
      className: 'border-cyan-200 bg-cyan-50 text-cyan-700',
      animated: true,
    },
    pending_grading: {
      label: '待批改',
      className: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    },
    grading: {
      label: '批改中',
      className: 'border-blue-200 bg-blue-50 text-blue-700',
      animated: true,
    },
    completed: {
      label: '已完成',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      showCheck: true,
    },
    needs_review: {
      label: '需人工复核',
      className: 'border-rose-200 bg-rose-50 text-rose-700',
    },
    manual: {
      label: '人工批改',
      className: 'border-amber-200 bg-amber-50 text-amber-700',
    },
  }

  return map[status]
}
```

- [ ] **Step 4: Run the workflow tests and verify GREEN**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/utils/workflow.test.ts
```

Expected: workflow tests pass.

- [ ] **Step 5: Commit Task 1**

Run:

```powershell
cd D:\wenjie-writewise-ai
git add app/src/utils/workflow.ts app/src/utils/workflow.test.ts
git commit -m "test: add workflow polish helpers"
```

## Task 2: Add Shared Workflow, Status, And Feedback Components

**Files:**
- Create: `app/src/components/WorkflowNav.tsx`
- Create: `app/src/components/NextActionPanel.tsx`
- Create: `app/src/components/EssayStatusChip.tsx`
- Create: `app/src/components/SaveFeedback.tsx`
- Modify: `app/src/components/TaskStatusBadge.tsx`
- Modify: `app/src/index.css`

- [ ] **Step 1: Create `WorkflowNav`**

Create `app/src/components/WorkflowNav.tsx`:

```tsx
import { BookOpenCheck, ClipboardList, FileCheck2, Presentation, Upload } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import type { WorkflowStep } from '../utils/workflow'

const iconMap = {
  upload: Upload,
  progress: ClipboardList,
  exceptions: BookOpenCheck,
  results: FileCheck2,
  'class-review': Presentation,
}

export function WorkflowNav({ steps }: { steps: WorkflowStep[] }) {
  return (
    <nav className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
      {steps.map((step) => {
        const Icon = iconMap[step.id]
        return (
          <NavLink
            key={step.id}
            to={step.to}
            className={({ isActive }) =>
              [
                'tech-focus inline-flex min-w-max items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition',
                isActive || step.current
                  ? 'border-blue-200 bg-blue-50 text-blue-800 shadow-[0_0_0_1px_rgba(37,99,235,0.08)]'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-cyan-200 hover:bg-cyan-50/60 hover:text-slate-900',
              ].join(' ')
            }
          >
            <Icon className="h-4 w-4" />
            {step.label}
          </NavLink>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 2: Create `NextActionPanel`**

Create `app/src/components/NextActionPanel.tsx`:

```tsx
import { ArrowRight, CheckCircle2, Sparkles, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { NextAction } from '../utils/workflow'

const toneStyles = {
  info: {
    icon: Sparkles,
    panel: 'border-blue-100 bg-white',
    iconBox: 'bg-blue-50 text-blue-700',
    button: 'bg-blue-700 text-white hover:bg-blue-800',
  },
  danger: {
    icon: TriangleAlert,
    panel: 'border-rose-100 bg-rose-50/50',
    iconBox: 'bg-rose-100 text-rose-700',
    button: 'bg-rose-600 text-white hover:bg-rose-700',
  },
  success: {
    icon: CheckCircle2,
    panel: 'border-emerald-100 bg-emerald-50/50',
    iconBox: 'bg-emerald-100 text-emerald-700',
    button: 'bg-emerald-700 text-white hover:bg-emerald-800',
  },
}

interface NextActionPanelProps {
  action: NextAction
  onPrimaryClick?: () => void
}

export function NextActionPanel({ action, onPrimaryClick }: NextActionPanelProps) {
  const styles = toneStyles[action.tone]
  const Icon = styles.icon

  const primaryClasses = `tech-focus inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition active:scale-[0.99] ${styles.button}`

  return (
    <section className={`rounded-lg border p-4 shadow-sm ${styles.panel}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${styles.iconBox}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-950">{action.title}</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">{action.description}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {onPrimaryClick ? (
            <button type="button" onClick={onPrimaryClick} className={primaryClasses}>
              {action.primaryLabel}
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <Link to={action.primaryTo} className={primaryClasses}>
              {action.primaryLabel}
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
          {action.secondaryLabel && action.secondaryTo ? (
            <Link
              to={action.secondaryTo}
              className="tech-focus inline-flex items-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50"
            >
              {action.secondaryLabel}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Create `EssayStatusChip`**

Create `app/src/components/EssayStatusChip.tsx`:

```tsx
import { Check } from 'lucide-react'
import type { EssayStatus } from '../types'
import { getEssayStatusMeta } from '../utils/workflow'

export function EssayStatusChip({ status }: { status: EssayStatus }) {
  const meta = getEssayStatusMeta(status)

  return (
    <span
      className={[
        'status-chip inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
        meta.className,
        meta.animated ? 'status-chip-active' : '',
      ].join(' ')}
    >
      {meta.animated ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {meta.showCheck ? <Check className="h-3.5 w-3.5" /> : null}
      {meta.label}
    </span>
  )
}
```

- [ ] **Step 4: Create `SaveFeedback`**

Create `app/src/components/SaveFeedback.tsx`:

```tsx
import { CheckCircle2 } from 'lucide-react'

interface SaveFeedbackProps {
  show: boolean
  label?: string
}

export function SaveFeedback({ show, label = '已保存调整' }: SaveFeedbackProps) {
  return (
    <span
      aria-live="polite"
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition',
        show
          ? 'translate-y-0 bg-emerald-50 text-emerald-700 opacity-100'
          : 'pointer-events-none translate-y-1 text-emerald-700 opacity-0',
      ].join(' ')}
    >
      <CheckCircle2 className="h-3.5 w-3.5" />
      {label}
    </span>
  )
}
```

- [ ] **Step 5: Refine `TaskStatusBadge` transitions**

Modify `app/src/components/TaskStatusBadge.tsx` so the returned `span` includes transition classes:

```tsx
export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const item = statusMap[status]
  return (
    <span
      className={`status-chip inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${item.className}`}
    >
      {item.label}
    </span>
  )
}
```

- [ ] **Step 6: Add global motion utilities**

Append to `app/src/index.css`:

```css
.status-chip {
  transition:
    background-color 180ms ease,
    border-color 180ms ease,
    color 180ms ease,
    transform 180ms ease,
    opacity 180ms ease;
}

.status-chip-active {
  animation: status-chip-pulse 1.6s ease-in-out infinite;
}

.tech-focus:focus-visible {
  outline: 2px solid #22d3ee;
  outline-offset: 2px;
}

@keyframes status-chip-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgb(37 99 235 / 0);
  }

  50% {
    box-shadow: 0 0 0 4px rgb(37 99 235 / 0.08);
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

- [ ] **Step 7: Run tests and lint**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test
npm.cmd run lint
```

Expected: all tests pass; lint passes.

- [ ] **Step 8: Commit Task 2**

Run:

```powershell
cd D:\wenjie-writewise-ai
git add app/src/components/WorkflowNav.tsx app/src/components/NextActionPanel.tsx app/src/components/EssayStatusChip.tsx app/src/components/SaveFeedback.tsx app/src/components/TaskStatusBadge.tsx app/src/index.css
git commit -m "feat: add workflow polish components"
```

## Task 3: Add Simulated Completion State Action

**Files:**
- Modify: `app/src/context/appStateContextValue.ts`
- Modify: `app/src/context/AppStateContext.tsx`

- [ ] **Step 1: Add context contract**

Modify `app/src/context/appStateContextValue.ts`:

```ts
export interface AppState {
  tasks: Task[]
  essays: Essay[]
  gradingResults: GradingResult[]
  classInsights: ClassInsight[]
  createTask: (input: CreateTaskInput) => string
  updateEssayOcrText: (essayId: string, text: string) => void
  markEssayManual: (essayId: string) => void
  completeEssayWithMockResult: (essayId: string) => void
  updateGradingResult: (essayId: string, patch: Partial<GradingResult>) => void
}
```

- [ ] **Step 2: Add a local mock-result builder**

In `app/src/context/AppStateContext.tsx`, add this helper above `AppStateProvider`:

```tsx
function createMockResultForEssay(essayId: string): GradingResult {
  const timestamp = new Date().toISOString()

  return {
    id: `${essayId}-result`,
    essayId,
    totalScore: 12.4,
    dimensionScores: [
      {
        id: 'content',
        name: '内容完成度',
        score: 3.4,
        maxScore: 3.75,
        weight: 25,
        reason: '主要信息点完整，细节仍可补充。',
        evidence: 'The student gives a clear suggestion and one reason.',
      },
      {
        id: 'accuracy',
        name: '语言准确性',
        score: 3,
        maxScore: 3.75,
        weight: 25,
        reason: '有少量基础语法错误。',
        evidence: 'I suggest you joins the club.',
      },
      {
        id: 'clarity',
        name: '表达清晰度',
        score: 2.1,
        maxScore: 2.25,
        weight: 15,
        reason: '文章结构清楚，衔接可更自然。',
        evidence: 'The paragraph order is easy to follow.',
      },
      {
        id: 'vocabulary',
        name: '词汇句式',
        score: 1.9,
        maxScore: 2.25,
        weight: 15,
        reason: '词汇准确，但高级表达较少。',
        evidence: 'Uses good and important repeatedly.',
      },
      {
        id: 'intention',
        name: '意图表达清晰度',
        score: 1.4,
        maxScore: 1.5,
        weight: 10,
        reason: '读者能理解学生的建议意图。',
        evidence: 'The recommendation is direct.',
      },
      {
        id: 'handwriting',
        name: '卷面/字迹',
        score: 0.9,
        maxScore: 1.5,
        weight: 10,
        reason: '个别单词连写影响识别。',
        evidence: 'Several words need manual OCR confirmation.',
      },
    ],
    errorAnnotations: [
      {
        id: `${essayId}-err-1`,
        type: 'grammar',
        original: 'I suggest you joins the club.',
        suggestion: 'I suggest you join the club.',
        explanation: 'suggest 后的宾语从句使用动词原形。',
        severity: 'high',
      },
    ],
    sentenceRevisions: [
      {
        id: `${essayId}-rev-1`,
        relatedErrorId: `${essayId}-err-1`,
        original: 'I suggest you joins the club.',
        revised: 'I suggest you join the club.',
        note: '修正 suggest 后的动词形式。',
      },
    ],
    upgradedExpressions: [
      {
        id: `${essayId}-up-1`,
        original: 'very important',
        upgraded: 'of great importance',
        note: '适合正式建议信表达。',
      },
    ],
    overallComment: '文章结构完整，建议继续减少基础语法错误，并补充更具体的行动细节。',
    aiConfidence: 0.84,
    teacherAdjusted: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}
```

- [ ] **Step 3: Implement `completeEssayWithMockResult`**

Inside `AppStateProvider`, add:

```tsx
const completeEssayWithMockResult = useCallback((essayId: string) => {
  const timestamp = new Date().toISOString()

  setEssays((current) =>
    current.map((essay) =>
      essay.id === essayId
        ? {
            ...essay,
            status: 'completed',
            aiResultId: `${essayId}-result`,
            teacherReviewed: true,
            updatedAt: timestamp,
          }
        : essay,
    ),
  )

  setGradingResults((current) =>
    current.some((result) => result.essayId === essayId)
      ? current
      : [createMockResultForEssay(essayId), ...current],
  )
}, [])
```

Add `completeEssayWithMockResult` to the context value and `useMemo` dependencies.

- [ ] **Step 4: Run tests and lint**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test
npm.cmd run lint
```

Expected: all tests pass; lint passes.

- [ ] **Step 5: Commit Task 3**

Run:

```powershell
cd D:\wenjie-writewise-ai
git add app/src/context/appStateContextValue.ts app/src/context/AppStateContext.tsx
git commit -m "feat: simulate essay completion"
```

## Task 4: Polish Layout, Task List, And Progress Page

**Files:**
- Modify: `app/src/layout/AppLayout.tsx`
- Modify: `app/src/pages/TaskListPage.tsx`
- Modify: `app/src/pages/ProgressPage.tsx`

- [ ] **Step 1: Add workflow navigation to layout**

Modify imports in `app/src/layout/AppLayout.tsx`:

```tsx
import { ArrowLeft, Sparkles } from 'lucide-react'
import { WorkflowNav } from '../components/WorkflowNav'
import { getWorkflowSteps, type WorkflowStepId } from '../utils/workflow'
```

Update `AppLayoutProps`:

```tsx
interface AppLayoutProps {
  children: ReactNode
  task?: Task
  title: string
  description?: string
  currentStep?: WorkflowStepId
}
```

Inside `AppLayout`, compute steps:

```tsx
const workflowSteps = task && currentStep ? getWorkflowSteps(task.id, currentStep) : []
```

Replace the sidebar task-link mapping with:

```tsx
{workflowSteps.length > 0 ? <WorkflowNav steps={workflowSteps} /> : null}
```

Add the narrow-screen workflow nav below the header title block:

```tsx
{workflowSteps.length > 0 ? (
  <div className="mt-4 lg:hidden">
    <WorkflowNav steps={workflowSteps} />
  </div>
) : null}
```

Refine the product mark block by adding a small technology accent:

```tsx
<div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
  <Sparkles className="h-3.5 w-3.5 text-cyan-500" />
  文阶
</div>
```

- [ ] **Step 2: Pass current steps from task pages**

Update `app/src/pages/ProgressPage.tsx` layout call:

```tsx
<AppLayout
  task={task}
  title="批改进度"
  currentStep="progress"
  description="模拟后台 OCR 与 AI 批改队列，让教师不用逐篇等待。"
>
```

Task list has no task workflow step and should not pass `currentStep`.

- [ ] **Step 3: Polish task list cards**

In `app/src/pages/TaskListPage.tsx`, use `getProgressNextAction` to choose each task's strongest next action:

```tsx
import { ArrowRight, TriangleAlert } from 'lucide-react'
import { getProgressNextAction } from '../utils/workflow'
```

Within each task card:

```tsx
const nextAction = getProgressNextAction(task, taskEssays)
```

Render a compact action row:

```tsx
<div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
  <div className="flex items-center gap-2 text-sm text-slate-600">
    {task.exceptionEssayCount > 0 ? <TriangleAlert className="h-4 w-4 text-rose-600" /> : null}
    <span>{nextAction.title}</span>
  </div>
  <Link
    to={nextAction.primaryTo}
    className="tech-focus inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
  >
    {nextAction.primaryLabel}
    <ArrowRight className="h-4 w-4" />
  </Link>
</div>
```

Keep `ProgressSummary`, but reduce the card padding from `p-5` to `p-4` and the gap between cards from `gap-4` to `gap-3`.

- [ ] **Step 4: Polish progress page actions and rows**

In `app/src/pages/ProgressPage.tsx`, import:

```tsx
import { Link, useParams } from 'react-router-dom'
import { EssayStatusChip } from '../components/EssayStatusChip'
import { NextActionPanel } from '../components/NextActionPanel'
import { getProgressNextAction } from '../utils/workflow'
```

Read the new context action:

```tsx
const { tasks, essays, completeEssayWithMockResult } = useAppState()
```

Add derived values:

```tsx
const nextAction = task ? getProgressNextAction(task, taskEssays) : undefined
const nextProcessableEssay = taskEssays.find((essay) =>
  ['pending_ocr', 'ocr_running', 'pending_grading', 'grading'].includes(essay.status),
)
```

Render the panel after `ProgressSummary`:

```tsx
{nextAction ? (
  <NextActionPanel
    action={nextAction}
    onPrimaryClick={
      nextAction.primaryLabel === '模拟完成下一篇' && nextProcessableEssay
        ? () => completeEssayWithMockResult(nextProcessableEssay.id)
        : undefined
    }
  />
) : null}
```

Replace status text in the table with:

```tsx
<EssayStatusChip status={essay.status} />
```

Add a mobile card list before the table:

```tsx
<div className="grid gap-3 md:hidden">
  {taskEssays.map((essay) => (
    <article key={essay.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-950">{essay.essayNumber}</p>
          <p className="mt-1 text-sm text-slate-500">
            {essay.pageCount} 页 · OCR {Math.round(essay.ocrConfidence * 100)}%
          </p>
        </div>
        <EssayStatusChip status={essay.status} />
      </div>
      <div className="mt-3">
        {essay.status === 'completed' ? (
          <Link to={`/tasks/${task.id}/essays/${essay.id}`} className="text-sm font-semibold text-blue-700">
            查看结果
          </Link>
        ) : essay.status === 'needs_review' ? (
          <Link to={`/tasks/${task.id}/exceptions`} className="text-sm font-semibold text-rose-700">
            去复核
          </Link>
        ) : (
          <span className="text-sm text-slate-400">处理中</span>
        )}
      </div>
    </article>
  ))}
</div>
```

Hide the table on narrow screens:

```tsx
<div className="hidden overflow-hidden rounded-lg border border-slate-200 bg-white md:block">
```

- [ ] **Step 5: Run tests, lint, and build**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected: all pass.

- [ ] **Step 6: Commit Task 4**

Run:

```powershell
cd D:\wenjie-writewise-ai
git add app/src/layout/AppLayout.tsx app/src/pages/TaskListPage.tsx app/src/pages/ProgressPage.tsx
git commit -m "feat: polish workflow navigation and progress"
```

## Task 5: Polish Exception Review And Essay Result Feedback

**Files:**
- Modify: `app/src/pages/ExceptionsPage.tsx`
- Modify: `app/src/pages/EssayResultPage.tsx`

- [ ] **Step 1: Add save feedback state to exception page**

In `app/src/pages/ExceptionsPage.tsx`, import:

```tsx
import { useState } from 'react'
import { CheckCircle2, RotateCcw } from 'lucide-react'
import { SaveFeedback } from '../components/SaveFeedback'
```

Add local state inside the component:

```tsx
const [savedEssayId, setSavedEssayId] = useState<string | null>(null)

const showSaved = (essayId: string) => {
  setSavedEssayId(essayId)
  window.setTimeout(() => setSavedEssayId(null), 900)
}
```

Update OCR `onChange`:

```tsx
onChange={(value) => {
  updateEssayOcrText(essay.id, value)
  showSaved(essay.id)
}}
```

- [ ] **Step 2: Group exception actions**

Replace the button row with:

```tsx
<div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
  <div>
    <p className="text-sm font-semibold text-slate-900">复核动作</p>
    <p className="mt-1 text-xs text-slate-500">修改 OCR 后可重新触发模拟批改，或转入人工批改。</p>
  </div>
  <div className="flex flex-wrap items-center gap-2">
    <SaveFeedback show={savedEssayId === essay.id} label="OCR 已保存" />
    <button className="tech-focus inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 active:scale-[0.99]">
      <RotateCcw className="h-4 w-4" />
      重新批改
    </button>
    <button
      onClick={() => markEssayManual(essay.id)}
      className="tech-focus inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-amber-200 hover:bg-amber-50"
    >
      <CheckCircle2 className="h-4 w-4" />
      标记人工批改
    </button>
  </div>
</div>
```

- [ ] **Step 3: Add result-page feedback state**

In `app/src/pages/EssayResultPage.tsx`, import:

```tsx
import { useState } from 'react'
import { SaveFeedback } from '../components/SaveFeedback'
```

Add local feedback helper:

```tsx
const [saveNotice, setSaveNotice] = useState(false)

const showSaveNotice = () => {
  setSaveNotice(true)
  window.setTimeout(() => setSaveNotice(false), 900)
}
```

Wrap score update calls:

```tsx
onChange={(event) => {
  updateGradingResult(essay.id, {
    totalScore: Number.parseFloat(event.target.value) || 0,
  })
  showSaveNotice()
}}
```

Do the same after dimension score and overall comment updates.

- [ ] **Step 4: Add score summary and feedback**

Replace the total score card body with:

```tsx
<div className="rounded-lg border border-blue-100 bg-white p-5 shadow-sm">
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
      <p className="text-sm font-medium text-slate-500">总分</p>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <input
          type="number"
          min={0}
          max={task.fullScore}
          step={0.1}
          value={result.totalScore}
          onChange={(event) => {
            updateGradingResult(essay.id, {
              totalScore: Number.parseFloat(event.target.value) || 0,
            })
            showSaveNotice()
          }}
          className="tech-focus w-32 rounded-lg border border-slate-200 px-3 py-2 text-3xl font-semibold text-slate-950"
        />
        <span className="pb-2 text-slate-500">/ {task.fullScore}</span>
      </div>
    </div>
    <div className="text-right">
      <SaveFeedback show={saveNotice} />
      <p className="mt-2 text-xs text-slate-500">AI 置信度 {Math.round(result.aiConfidence * 100)}%</p>
    </div>
  </div>
  {result.teacherAdjusted ? (
    <span className="mt-4 inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
      教师已调整
    </span>
  ) : null}
</div>
```

- [ ] **Step 5: Pass current steps**

Update `app/src/pages/ExceptionsPage.tsx` layout call:

```tsx
<AppLayout
  task={task}
  title="异常复核"
  currentStep="exceptions"
  description="教师只处理 OCR 或图像质量不可靠的作文。"
>
```

For `app/src/pages/EssayResultPage.tsx`, use:

```tsx
<AppLayout
  task={task}
  title={`${essay.essayNumber} 批改结果`}
  currentStep="results"
  description="教师可检查 AI 评分、错误标注和修改建议，并进行模拟调整。"
>
```

- [ ] **Step 6: Run tests, lint, and build**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected: all pass.

- [ ] **Step 7: Commit Task 5**

Run:

```powershell
cd D:\wenjie-writewise-ai
git add app/src/pages/ExceptionsPage.tsx app/src/pages/EssayResultPage.tsx
git commit -m "feat: polish review feedback"
```

## Task 6: Polish Class Review And Browser Verification

**Files:**
- Modify: `app/src/pages/ClassReviewPage.tsx`
- Modify: `app/src/components/ClassInsightPanel.tsx`

- [ ] **Step 1: Refine class review hero panel**

In `app/src/pages/ClassReviewPage.tsx`, update `AppLayout`:

```tsx
<AppLayout
  task={task}
  title="班级共性问题讲评"
  currentStep="class-review"
  description="适合电脑端或白板横屏展示，不依赖学生姓名。"
>
```

Replace the dark top panel with:

```tsx
<div className="rounded-lg border border-slate-800 bg-slate-950 p-6 text-white shadow-[0_16px_40px_rgba(15,23,42,0.18)]">
  <div className="flex flex-wrap items-center justify-between gap-4">
    <div>
      <p className="text-sm font-medium text-cyan-200">{task.className}</p>
      <h3 className="mt-2 text-3xl font-semibold">{task.taskName}</h3>
    </div>
    <span className="rounded-full border border-cyan-300/40 bg-cyan-300/10 px-3 py-1 text-sm font-semibold text-cyan-100">
      课堂讲评模式
    </span>
  </div>
  <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-200">
    先看高频错误，再看典型句，最后用改写练习带学生即时修正。
  </p>
</div>
```

- [ ] **Step 2: Add subtle section accents**

Keep the insight grid in `app/src/pages/ClassReviewPage.tsx` as:

```tsx
<div className="grid gap-5 xl:grid-cols-2">
```

Update `app/src/components/ClassInsightPanel.tsx` section container:

```tsx
<section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
```

Add a small accent bar before the heading:

```tsx
<div className="mb-4 h-1 w-12 rounded-full bg-cyan-400" />
```

- [ ] **Step 3: Run full verification commands**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected:

- Tests pass.
- Lint passes.
- Build passes.

- [ ] **Step 4: Start local dev server**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd run dev -- --host 127.0.0.1
```

Expected: Vite serves `http://127.0.0.1:5173/` or the next available port.

- [ ] **Step 5: Verify desktop pages in browser**

Open:

```text
http://127.0.0.1:5173/
http://127.0.0.1:5173/tasks/task-1/progress
http://127.0.0.1:5173/tasks/task-1/exceptions
http://127.0.0.1:5173/tasks/task-1/essays/task-1-essay-1
http://127.0.0.1:5173/tasks/task-1/class-review
```

Verify:

- Task list cards show clear next actions.
- Task pages show workflow navigation.
- Progress page status chips are readable and subtle.
- Clicking "模拟完成下一篇" turns one active essay into "已完成" and shows the completed chip.
- Exception review has grouped primary and secondary actions.
- Essay result score edits show a lightweight saved confirmation.
- Class review still fits a whiteboard-style landscape viewport.

- [ ] **Step 6: Verify narrow viewport**

Set the browser viewport to approximately `390x844` and verify:

- Top workflow shortcuts are visible on task pages.
- Progress rows render as cards, not a squeezed table.
- Buttons do not overlap or crop text.
- Page content remains readable without horizontal scrolling.

- [ ] **Step 7: Clean generated build output**

If `app/dist` exists after build, remove it:

```powershell
Remove-Item -Recurse -Force -LiteralPath D:\wenjie-writewise-ai\app\dist
```

Expected: `app/dist` is removed and not committed.

- [ ] **Step 8: Commit Task 6**

Run:

```powershell
cd D:\wenjie-writewise-ai
git status --short --branch
git add app/src/pages/ClassReviewPage.tsx app/src/components/ClassInsightPanel.tsx
git commit -m "feat: polish class review presentation"
```

## Final Verification

- [ ] **Step 1: Run final checks**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected: all pass.

- [ ] **Step 2: Clean build output**

Run:

```powershell
if (Test-Path -LiteralPath D:\wenjie-writewise-ai\app\dist) {
  Remove-Item -Recurse -Force -LiteralPath D:\wenjie-writewise-ai\app\dist
}
```

Expected: `app/dist` is absent.

- [ ] **Step 3: Review git status**

Run:

```powershell
cd D:\wenjie-writewise-ai
git status --short --branch
```

Expected: only intended source and test files are changed or the tree is clean after commits.

- [ ] **Step 4: Optional push after user approval**

Run only after the user asks to push:

```powershell
git push
```
