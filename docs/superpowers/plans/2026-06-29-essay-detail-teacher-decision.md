# Essay Detail Teacher Decision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-essay result detail page into a compact teacher decision workstation with diagnostic scoring, linked total score, structured issue cards, and lightweight teacher feedback controls.

**Architecture:** Put score/diagnostic rules in a pure utility module with focused unit tests, then render those rules through a new compact summary component. Keep the left-side source essay panel stable, and only reorganize the right-side work area in `EssayResultPage`.

**Tech Stack:** React, TypeScript, React Router, Vitest, Testing Library, Tailwind CSS, existing in-memory `AppStateProvider`.

---

## File Structure

- Create `app/src/utils/gradingDiagnostics.ts`
  - Pure helpers for score clamping, total score calculation, grade band, main deduction dimensions, severity labels, and review recommendation.
- Create `app/src/utils/gradingDiagnostics.test.ts`
  - Unit tests for all diagnostic rules.
- Create `app/src/components/DiagnosticScoreSummary.tsx`
  - Compact top-right summary that renders total score, grade band, AI confidence, main deduction dimensions, review recommendation, and editable dimension score rows.
- Modify `app/src/components/IssueCorrectionList.tsx`
  - Make cards more structured and translate severity into teacher-facing impact labels.
- Modify `app/src/types/index.ts`
  - Add optional `teacherSuggestion?: string` to `GradingResult`.
- Modify `app/src/pages/EssayResultPage.tsx`
  - Replace standalone total card and `ScoreBreakdown` usage with `DiagnosticScoreSummary`.
  - Keep left-side original essay panel unchanged.
  - Keep issue corrections, expression upgrades, and final comment area in the agreed order.
  - Add teacher supplemental suggestion editing and save feedback.
- Create `app/src/pages/EssayResultPage.test.tsx`
  - Integration tests for the detail-page teacher workflow.

## Task 1: Add Diagnostic Rule Helpers

**Files:**
- Create: `app/src/utils/gradingDiagnostics.test.ts`
- Create: `app/src/utils/gradingDiagnostics.ts`

- [ ] **Step 1: Write failing utility tests**

Create `app/src/utils/gradingDiagnostics.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ErrorAnnotation, ScoreDimension } from '../types'
import {
  calculateTotalScore,
  clampDimensionScore,
  formatScore,
  getGradeBand,
  getMainDeductionDimensions,
  getReviewRecommendation,
  getSeverityImpactLabel,
} from './gradingDiagnostics'

const dimensions: ScoreDimension[] = [
  {
    id: 'content',
    name: '内容完成度',
    score: 3.4,
    maxScore: 3.75,
    weight: 25,
    reason: '信息点完整',
    evidence: 'Suggestion is clear.',
  },
  {
    id: 'accuracy',
    name: '语言准确性',
    score: 2.4,
    maxScore: 3.75,
    weight: 25,
    reason: '基础语法错误较多',
    evidence: 'joins',
  },
  {
    id: 'handwriting',
    name: '卷面/字迹',
    score: 0.9,
    maxScore: 1.5,
    weight: 10,
    reason: '识别受影响',
    evidence: 'messy words',
  },
]

const highIssues: ErrorAnnotation[] = [
  {
    id: 'err-1',
    type: 'grammar',
    original: 'I suggest you joins.',
    suggestion: 'I suggest you join.',
    explanation: 'suggest 后用动词原形。',
    severity: 'high',
  },
  {
    id: 'err-2',
    type: 'structure',
    original: 'No closing sentence.',
    suggestion: 'Add a closing sentence.',
    explanation: '结尾不完整。',
    severity: 'high',
  },
]

describe('grading diagnostics', () => {
  it('calculates and formats total score from dimensions', () => {
    expect(calculateTotalScore(dimensions)).toBe(6.7)
    expect(formatScore(13)).toBe('13')
    expect(formatScore(13.1)).toBe('13.1')
  })

  it('clamps dimension score to a valid range', () => {
    expect(clampDimensionScore(9, 3.75)).toBe(3.75)
    expect(clampDimensionScore(-1, 3.75)).toBe(0)
    expect(clampDimensionScore(Number.NaN, 3.75)).toBe(0)
    expect(clampDimensionScore(3.16, 3.75)).toBe(3.2)
  })

  it('returns grade bands from total score', () => {
    expect(getGradeBand(14).label).toBe('优秀')
    expect(getGradeBand(12.8).label).toBe('良好')
    expect(getGradeBand(10).label).toBe('合格')
    expect(getGradeBand(8.5).label).toBe('待提升')
  })

  it('returns the lowest score-rate dimensions as main deductions', () => {
    expect(getMainDeductionDimensions(dimensions).map((item) => item.name)).toEqual([
      '卷面/字迹',
      '语言准确性',
    ])
  })

  it('maps severity into teacher-facing impact labels', () => {
    expect(getSeverityImpactLabel('high')).toBe('高')
    expect(getSeverityImpactLabel('medium')).toBe('中')
    expect(getSeverityImpactLabel('low')).toBe('低')
  })

  it('builds review recommendations from score, confidence, and issue severity', () => {
    expect(getReviewRecommendation({ totalScore: 14, aiConfidence: 0.9, issues: [] })).toBe('可作为优秀范例')
    expect(getReviewRecommendation({ totalScore: 12, aiConfidence: 0.9, issues: [] })).toBe('普通反馈')
    expect(getReviewRecommendation({ totalScore: 10, aiConfidence: 0.9, issues: [] })).toBe('建议关注主要问题')
    expect(getReviewRecommendation({ totalScore: 8, aiConfidence: 0.9, issues: [] })).toBe('建议教师复核')
    expect(getReviewRecommendation({ totalScore: 12, aiConfidence: 0.66, issues: [] })).toBe('建议教师复核')
    expect(getReviewRecommendation({ totalScore: 12, aiConfidence: 0.9, issues: highIssues })).toBe('建议重点讲评')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/utils/gradingDiagnostics.test.ts
```

Expected: fail because `app/src/utils/gradingDiagnostics.ts` does not exist.

- [ ] **Step 3: Implement diagnostic helpers**

Create `app/src/utils/gradingDiagnostics.ts`:

```ts
import type { ErrorAnnotation, ScoreDimension } from '../types'

export interface GradeBand {
  label: '优秀' | '良好' | '合格' | '待提升'
  tone: 'excellent' | 'good' | 'pass' | 'weak'
}

export function clampDimensionScore(value: number, maxScore: number) {
  if (!Number.isFinite(value)) return 0
  const clamped = Math.min(Math.max(value, 0), maxScore)
  return Math.round(clamped * 10) / 10
}

export function calculateTotalScore(dimensions: ScoreDimension[]) {
  const total = dimensions.reduce((sum, dimension) => sum + dimension.score, 0)
  return Math.round(total * 10) / 10
}

export function formatScore(score: number) {
  return Number.isInteger(score) ? String(score) : score.toFixed(1)
}

export function getGradeBand(totalScore: number): GradeBand {
  if (totalScore >= 13.5) return { label: '优秀', tone: 'excellent' }
  if (totalScore >= 11) return { label: '良好', tone: 'good' }
  if (totalScore >= 9) return { label: '合格', tone: 'pass' }
  return { label: '待提升', tone: 'weak' }
}

export function getMainDeductionDimensions(dimensions: ScoreDimension[], limit = 2) {
  return [...dimensions]
    .sort((left, right) => left.score / left.maxScore - right.score / right.maxScore)
    .slice(0, limit)
}

export function getSeverityImpactLabel(severity: ErrorAnnotation['severity']) {
  if (severity === 'high') return '高'
  if (severity === 'medium') return '中'
  return '低'
}

export function getReviewRecommendation({
  totalScore,
  aiConfidence,
  issues,
}: {
  totalScore: number
  aiConfidence: number
  issues: ErrorAnnotation[]
}) {
  const highSeverityCount = issues.filter((issue) => issue.severity === 'high').length

  if (aiConfidence < 0.7 || totalScore < 9) return '建议教师复核'
  if (highSeverityCount >= 2) return '建议重点讲评'
  if (totalScore >= 13.5) return '可作为优秀范例'
  if (totalScore >= 11) return '普通反馈'
  return '建议关注主要问题'
}
```

- [ ] **Step 4: Run utility tests**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/utils/gradingDiagnostics.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add app/src/utils/gradingDiagnostics.ts app/src/utils/gradingDiagnostics.test.ts
git commit -m "feat: add grading diagnostic helpers"
```

## Task 2: Add Compact Diagnostic Score Summary

**Files:**
- Create: `app/src/components/DiagnosticScoreSummary.tsx`
- Modify: `app/src/pages/EssayResultPage.tsx`
- Test: `app/src/pages/EssayResultPage.test.tsx`

- [ ] **Step 1: Write failing detail-page test for summary**

Create `app/src/pages/EssayResultPage.test.tsx` with the first test:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import { EssayResultPage } from './EssayResultPage'

function renderEssayDetail(path = '/tasks/task-1/essays/task-1-essay-1') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppStateProvider>
        <Routes>
          <Route path="/tasks/:taskId/essays/:essayId" element={<EssayResultPage />} />
        </Routes>
      </AppStateProvider>
    </MemoryRouter>,
  )
}

describe('EssayResultPage', () => {
  it('shows a compact diagnostic summary with editable dimension scores', () => {
    renderEssayDetail()

    expect(screen.getByRole('heading', { name: '诊断摘要' })).toBeInTheDocument()
    expect(screen.getByText('AI 置信度')).toBeInTheDocument()
    expect(screen.getByText('主要扣分项')).toBeInTheDocument()
    expect(screen.getByText('讲评建议')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /语言准确性/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '分项评分' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected: fail because `诊断摘要` does not exist yet.

- [ ] **Step 3: Create summary component**

Create `app/src/components/DiagnosticScoreSummary.tsx`:

```tsx
import type { ErrorAnnotation, ScoreDimension } from '../types'
import {
  calculateTotalScore,
  formatScore,
  getGradeBand,
  getMainDeductionDimensions,
  getReviewRecommendation,
} from '../utils/gradingDiagnostics'

const gradeToneClass = {
  excellent: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  good: 'bg-blue-50 text-blue-700 border-blue-100',
  pass: 'bg-amber-50 text-amber-700 border-amber-100',
  weak: 'bg-rose-50 text-rose-700 border-rose-100',
}

interface DiagnosticScoreSummaryProps {
  aiConfidence: number
  dimensions: ScoreDimension[]
  fullScore: number
  issues: ErrorAnnotation[]
  onDimensionScoreChange: (dimensionId: string, score: number) => void
}

export function DiagnosticScoreSummary({
  aiConfidence,
  dimensions,
  fullScore,
  issues,
  onDimensionScoreChange,
}: DiagnosticScoreSummaryProps) {
  const totalScore = calculateTotalScore(dimensions)
  const gradeBand = getGradeBand(totalScore)
  const mainDeductions = getMainDeductionDimensions(dimensions)
  const reviewRecommendation = getReviewRecommendation({ totalScore, aiConfidence, issues })

  return (
    <section className="rounded-lg border border-blue-100 bg-white p-4 shadow-sm" aria-labelledby="diagnostic-summary-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">AI 批改工作台</p>
          <h3 id="diagnostic-summary-title" className="mt-1 text-lg font-semibold text-slate-950">
            诊断摘要
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${gradeToneClass[gradeBand.tone]}`}>
            {gradeBand.label}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
            讲评建议：{reviewRecommendation}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-xs font-semibold text-slate-500">总分</p>
          <p className="mt-1 text-3xl font-semibold text-slate-950">
            {formatScore(totalScore)}
            <span className="ml-1 text-base font-medium text-slate-500">/ {fullScore}</span>
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-500">AI 置信度</p>
          <p className="mt-2 text-sm font-semibold text-slate-800">{Math.round(aiConfidence * 100)}%</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-500">主要扣分项</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {mainDeductions.map((dimension) => (
              <span key={dimension.id} className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
                {dimension.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3">
        <div className="grid gap-2 lg:grid-cols-2">
          {dimensions.map((dimension) => {
            const isMainDeduction = mainDeductions.some((item) => item.id === dimension.id)

            return (
              <label key={dimension.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md bg-slate-50 px-3 py-2">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
                    {dimension.name}
                    {isMainDeduction ? (
                      <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700">
                        主要扣分
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">{dimension.reason}</span>
                </span>
                <span className="flex items-center gap-1">
                  <input
                    aria-label={`${dimension.name} 分数`}
                    type="number"
                    min={0}
                    max={dimension.maxScore}
                    step={0.1}
                    value={dimension.score}
                    onChange={(event) => onDimensionScoreChange(dimension.id, Number.parseFloat(event.target.value))}
                    className="tech-focus w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-semibold text-slate-900"
                  />
                  <span className="text-xs font-medium text-slate-500">/ {dimension.maxScore}</span>
                </span>
              </label>
            )
          })}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Wire summary into detail page**

Modify `app/src/pages/EssayResultPage.tsx`:

- Remove `ScoreBreakdown` import.
- Add:

```ts
import { DiagnosticScoreSummary } from '../components/DiagnosticScoreSummary'
import { calculateTotalScore, clampDimensionScore } from '../utils/gradingDiagnostics'
```

- Replace the standalone total-score card and `<ScoreBreakdown />` with:

```tsx
<DiagnosticScoreSummary
  aiConfidence={result.aiConfidence}
  dimensions={result.dimensionScores}
  fullScore={task.fullScore}
  issues={result.errorAnnotations}
  onDimensionScoreChange={(dimensionId, nextScore) => {
    const nextDimensions = result.dimensionScores.map((dimension) =>
      dimension.id === dimensionId
        ? { ...dimension, score: clampDimensionScore(nextScore, dimension.maxScore) }
        : dimension,
    )

    updateGradingResult(essay.id, {
      dimensionScores: nextDimensions,
      totalScore: calculateTotalScore(nextDimensions),
    })
    showSaveNotice()
  }}
/>
```

- [ ] **Step 5: Run focused page test**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected: pass.

- [ ] **Step 6: Commit**

```powershell
git add app/src/components/DiagnosticScoreSummary.tsx app/src/pages/EssayResultPage.tsx app/src/pages/EssayResultPage.test.tsx
git commit -m "feat: add compact diagnostic scoring summary"
```

## Task 3: Verify Score Edits Sync Total And Grade Band

**Files:**
- Modify: `app/src/pages/EssayResultPage.test.tsx`
- Modify: `app/src/components/DiagnosticScoreSummary.tsx`
- Modify: `app/src/pages/EssayResultPage.tsx`

- [ ] **Step 1: Add failing score-edit tests**

Append tests to `app/src/pages/EssayResultPage.test.tsx`:

```tsx
import userEvent from '@testing-library/user-event'

it('syncs dimension score edits with total score and grade band', async () => {
  const user = userEvent.setup()
  renderEssayDetail()

  const accuracyInput = screen.getByRole('spinbutton', { name: /语言准确性/ })
  await user.clear(accuracyInput)
  await user.type(accuracyInput, '3.75')

  expect(screen.getByText('13.5')).toBeInTheDocument()
  expect(screen.getByText('优秀')).toBeInTheDocument()
  expect(screen.getByText('分数已更新')).toBeInTheDocument()
})

it('clamps invalid dimension score values', async () => {
  const user = userEvent.setup()
  renderEssayDetail()

  const accuracyInput = screen.getByRole('spinbutton', { name: /语言准确性/ })
  await user.clear(accuracyInput)
  await user.type(accuracyInput, '99')

  expect(accuracyInput).toHaveValue(3.75)

  await user.clear(accuracyInput)
  await user.type(accuracyInput, '-3')

  expect(accuracyInput).toHaveValue(0)
})
```

- [ ] **Step 2: Run tests to verify behavior**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected before implementation adjustments: fail if save feedback text or clamping is not reflected in the input value.

- [ ] **Step 3: Make save notice message-specific**

Modify `app/src/pages/EssayResultPage.tsx`:

- Change:

```ts
const [saveNotice, setSaveNotice] = useState(false)
```

to:

```ts
const [saveNotice, setSaveNotice] = useState('')
```

- Change `showSaveNotice` to accept a message:

```ts
const showSaveNotice = (message = '已保存教师调整') => {
  if (saveTimerRef.current) {
    window.clearTimeout(saveTimerRef.current)
  }

  setSaveNotice(message)
  saveTimerRef.current = window.setTimeout(() => {
    setSaveNotice('')
    saveTimerRef.current = null
  }, 1800)
}
```

- Render feedback near the right-side work area:

```tsx
{saveNotice ? (
  <div role="status" className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-sm">
    {saveNotice}
  </div>
) : null}
```

- For dimension score changes, call:

```ts
showSaveNotice('分数已更新')
```

- [ ] **Step 4: Ensure inputs reflect clamped values**

The summary input value should come from `result.dimensionScores`; after `updateGradingResult`, React will rerender with the clamped value. Keep `value={dimension.score}` and the `clampDimensionScore` call in the page handler.

- [ ] **Step 5: Run tests**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected: pass.

- [ ] **Step 6: Commit**

```powershell
git add app/src/pages/EssayResultPage.tsx app/src/pages/EssayResultPage.test.tsx app/src/components/DiagnosticScoreSummary.tsx
git commit -m "feat: sync dimension score edits with total"
```

## Task 4: Improve Issue Correction Cards

**Files:**
- Modify: `app/src/components/IssueCorrectionList.tsx`
- Modify: `app/src/pages/EssayResultPage.test.tsx`

- [ ] **Step 1: Add failing issue-card test**

Append to `app/src/pages/EssayResultPage.test.tsx`:

```tsx
it('shows structured issue correction details and class overview feedback', async () => {
  const user = userEvent.setup()
  renderEssayDetail()

  expect(screen.getByRole('heading', { name: '问题与修改建议' })).toBeInTheDocument()
  expect(screen.getByText('问题类型')).toBeInTheDocument()
  expect(screen.getByText('扣分影响')).toBeInTheDocument()
  expect(screen.getByText('原句')).toBeInTheDocument()
  expect(screen.getByText('推荐改法')).toBeInTheDocument()
  expect(screen.getByText('原因')).toBeInTheDocument()

  await user.click(screen.getAllByRole('button', { name: '加入班级总览' })[0])

  expect(screen.getByText('已加入班级总览')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected: fail if labels are not present in the card structure.

- [ ] **Step 3: Update issue card component**

Modify `app/src/components/IssueCorrectionList.tsx`:

- Import helper:

```ts
import { getSeverityImpactLabel } from '../utils/gradingDiagnostics'
```

- Replace the card heading/body with this structure inside the `annotations.map` block:

```tsx
<div key={item.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
  <div className="flex flex-wrap items-center gap-2">
    <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-semibold text-cyan-700">
      问题类型：{item.type}
    </span>
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${severityTone[item.severity]}`}>
      扣分影响：{getSeverityImpactLabel(item.severity)}
    </span>
  </div>
  <dl className="mt-3 grid gap-2 text-sm">
    <div>
      <dt className="text-xs font-semibold text-slate-500">原句</dt>
      <dd className="mt-1 text-slate-600 line-through">{item.original}</dd>
    </div>
    <div>
      <dt className="text-xs font-semibold text-slate-500">推荐改法</dt>
      <dd className="mt-1 font-medium text-slate-950">{revision?.revised ?? item.suggestion}</dd>
    </div>
    <div>
      <dt className="text-xs font-semibold text-slate-500">原因</dt>
      <dd className="mt-1 text-xs leading-5 text-slate-500">{revision?.note ?? item.explanation}</dd>
    </div>
  </dl>
  <button
    type="button"
    onClick={() => markAdded(item.id)}
    className={`tech-focus mt-3 inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
      isAdded
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-slate-200 bg-white text-slate-700 hover:border-cyan-200 hover:bg-cyan-50'
    }`}
  >
    {isAdded ? '已加入班级总览' : '加入班级总览'}
  </button>
</div>
```

- Keep the component title `问题与修改建议`.
- Keep local `addedIds` state.

- [ ] **Step 4: Run tests**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add app/src/components/IssueCorrectionList.tsx app/src/pages/EssayResultPage.test.tsx
git commit -m "refactor: improve issue correction cards"
```

## Task 5: Add Teacher Comment Adjustment Controls

**Files:**
- Modify: `app/src/types/index.ts`
- Modify: `app/src/pages/EssayResultPage.tsx`
- Modify: `app/src/pages/EssayResultPage.test.tsx`

- [ ] **Step 1: Add failing teacher-comment test**

Append to `app/src/pages/EssayResultPage.test.tsx`:

```tsx
it('saves teacher comment adjustments with lightweight feedback', async () => {
  const user = userEvent.setup()
  renderEssayDetail()

  await user.clear(screen.getByLabelText('AI 总评'))
  await user.type(screen.getByLabelText('AI 总评'), 'Teacher adjusted overall comment.')
  await user.type(screen.getByLabelText('教师补充建议'), 'Focus on subject-verb agreement before final submission.')
  await user.click(screen.getByRole('button', { name: '保存调整' }))

  expect(screen.getByText('已保存教师调整')).toBeInTheDocument()
  expect(screen.getByText('已由教师调整')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected: fail because the supplemental suggestion field and save button do not exist yet.

- [ ] **Step 3: Add optional teacher suggestion type**

Modify `app/src/types/index.ts`:

```ts
export interface GradingResult {
  id: string
  essayId: string
  totalScore: number
  dimensionScores: ScoreDimension[]
  errorAnnotations: ErrorAnnotation[]
  sentenceRevisions: SentenceRevision[]
  upgradedExpressions: UpgradedExpression[]
  overallComment: string
  teacherSuggestion?: string
  aiConfidence: number
  teacherAdjusted: boolean
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 4: Replace final comment card**

In `app/src/pages/EssayResultPage.tsx`, replace the existing `总评` card with:

```tsx
<div className="rounded-lg border border-slate-200 bg-white p-4">
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h3 className="font-semibold text-slate-950">AI 总评 / 教师补充建议</h3>
      <p className="mt-1 text-xs text-slate-500">老师可在 AI 总评基础上补充最终反馈。</p>
    </div>
    {result.teacherAdjusted ? (
      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
        已由教师调整
      </span>
    ) : null}
  </div>
  <label className="mt-4 block">
    <span className="text-xs font-semibold text-slate-600">AI 总评</span>
    <textarea
      aria-label="AI 总评"
      value={result.overallComment}
      onChange={(event) => updateGradingResult(essay.id, { overallComment: event.target.value })}
      className="mt-2 min-h-28 w-full rounded-lg border border-slate-200 p-3 text-sm leading-6 text-slate-700"
    />
  </label>
  <label className="mt-3 block">
    <span className="text-xs font-semibold text-slate-600">教师补充建议</span>
    <textarea
      aria-label="教师补充建议"
      value={result.teacherSuggestion ?? ''}
      onChange={(event) => updateGradingResult(essay.id, { teacherSuggestion: event.target.value })}
      className="mt-2 min-h-24 w-full rounded-lg border border-slate-200 p-3 text-sm leading-6 text-slate-700"
      placeholder="例如：建议先复习 suggest 后接动词原形，再重写第二段。"
    />
  </label>
  <button
    type="button"
    onClick={() => showSaveNotice('已保存教师调整')}
    className="tech-focus mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
  >
    保存调整
  </button>
</div>
```

- [ ] **Step 5: Run tests**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected: pass.

- [ ] **Step 6: Commit**

```powershell
git add app/src/types/index.ts app/src/pages/EssayResultPage.tsx app/src/pages/EssayResultPage.test.tsx
git commit -m "feat: add teacher comment adjustment controls"
```

## Task 6: Full Regression And Browser Verification

**Files:**
- Modify: `docs/current_development_status.md`

- [ ] **Step 1: Run focused and full verification**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected:

- `EssayResultPage.test.tsx` passes.
- Full test suite passes.
- Lint passes.
- Build passes.

- [ ] **Step 2: Start or reuse local preview**

If no dev server is running:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd run dev
```

Expected preview URL:

```text
http://127.0.0.1:5173/
```

- [ ] **Step 3: Browser walkthrough**

Use the in-app browser to verify:

```text
http://127.0.0.1:5173/tasks/task-1/essays/task-1-essay-1
```

Check:

- Left column still shows `学生作文原文`.
- Left column still has `查看原图`.
- Right column first module is `诊断摘要`.
- Dimension score inputs are inside the summary.
- Editing `语言准确性` changes total score.
- Main deduction chips remain reasonable after editing.
- Issue cards show `问题类型`, `扣分影响`, `原句`, `推荐改法`, and `原因`.
- `加入班级总览` changes to `已加入班级总览`.
- `表达升级建议` remains after issues.
- `AI 总评 / 教师补充建议` saves and shows `已保存教师调整`.
- `返回批改进度`, `上一篇`, and `下一篇` still work.

- [ ] **Step 4: Update memory file**

Modify `docs/current_development_status.md`:

- Update latest product commit after the final feature commit.
- Add completed work:

```markdown
- Completed phase 2 essay-detail teacher decision polish:
  - Added compact diagnostic summary with total score, grade band, AI confidence, main deduction dimensions, and review recommendation.
  - Integrated editable dimension scores into the summary.
  - Total score now syncs from dimension score edits.
  - Issue correction cards show issue type, impact, original text, suggested revision, and explanation.
  - Teacher comment and supplemental suggestion editing show lightweight save feedback.
```

- Update latest verified commands and test counts after running verification.
- Update next recommended step to the original-text-to-issue comparison loop.

- [ ] **Step 5: Commit docs**

Commit memory update:

```powershell
git add docs/current_development_status.md
git commit -m "docs: update essay detail workflow status"
```

Do not push during this task unless the user explicitly asks for GitHub sync after implementation.

## Self-Review Checklist

- Spec coverage:
  - Diagnostic summary: Task 2.
  - Dimension editing and total sync: Task 1, Task 2, Task 3.
  - Grade band/main deduction/recommendation derivation: Task 1, Task 2, Task 3.
  - Remove duplicate standalone score card: Task 2.
  - Structured issue cards: Task 4.
  - Teacher comment controls and feedback: Task 5.
  - Existing navigation and browser verification: Task 6.
- Placeholder scan:
  - No incomplete implementation instructions are used.
- Type consistency:
  - `teacherSuggestion?: string` is added to `GradingResult`.
  - `DiagnosticScoreSummary` receives `ScoreDimension[]` and `ErrorAnnotation[]`.
  - Score calculation uses `calculateTotalScore`.
  - Input clamping uses `clampDimensionScore`.
