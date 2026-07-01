# Essay Detail Full Text Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full-text revision and logic/coherence diagnostics to the single-essay detail page without implementing the deferred original-paper annotation view.

**Architecture:** Extend `GradingResult` with optional `fullTextRevision` data and keep `upgradedExpressions` for compatibility. Convert language issues and logic issues into a display-layer `ReviewIssueCardItem[]` before rendering `IssueCorrectionList`, avoiding a wide optional-field `ErrorAnnotation`. Add a focused `FullTextRevisionPanel` component that owns its internal tabs and renders corrected text, polished text, sentence comparison, logic notes, and existing expression upgrades as `本文重点提升点`.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing Tailwind utility classes, existing mock state provider.

---

## Files

- Modify: `app/src/types/index.ts`
- Modify: `app/src/data/mockData.ts`
- Modify: `app/src/data/mockData.test.ts`
- Create: `app/src/utils/reviewIssueItems.ts`
- Create: `app/src/utils/reviewIssueItems.test.ts`
- Modify: `app/src/components/IssueCorrectionList.tsx`
- Create: `app/src/components/FullTextRevisionPanel.tsx`
- Create: `app/src/components/FullTextRevisionPanel.test.tsx`
- Modify: `app/src/pages/EssayResultPage.tsx`
- Modify: `app/src/pages/EssayResultPage.test.tsx`
- Modify: `app/src/pages/DetailNavigation.test.tsx` only if existing assertions need copy updates after the visible module change
- Modify: `docs/current_development_status.md`

## Scope Guard

Do not implement in this plan:

- `工作台视图 / 原卷批注视图` switcher.
- Original-paper annotation view.
- Image coordinate annotation.
- Clipboard copy buttons unless every earlier task is already complete and adding them is trivial.
- Upload page changes.
- Progress page queue redesign.
- Real AI or OCR calls.
- Backend persistence.

## Task 1: Add Full Text Revision Types

**Files:**
- Modify: `app/src/types/index.ts`
- Test: `app/src/data/mockData.test.ts`

- [ ] **Step 1: Write the failing mock-data type/shape test**

Add this test to `app/src/data/mockData.test.ts`:

```ts
it('provides full text revision data for completed mock grading results', () => {
  for (const result of mockGradingResults) {
    expect(result.fullTextRevision, `${result.id} should include full text revision`).toBeDefined()
    expect(result.fullTextRevision?.correctedText).toContain('I suggest you join the club.')
    expect(result.fullTextRevision?.polishedText).toContain('I suggest that you join the club.')
    expect(result.fullTextRevision?.sentencePairs.length).toBeGreaterThanOrEqual(3)
    expect(result.fullTextRevision?.logicNotes.join(' ')).toContain('上下文关联度差')
    expect(
      result.fullTextRevision?.logicIssues.some((issue) => issue.needsTeacherReview),
      `${result.id} should include a teacher-review logic issue`,
    ).toBe(true)
  }
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/data/mockData.test.ts
```

Expected: fail with a TypeScript or assertion error because `fullTextRevision` is not on `GradingResult`.

- [ ] **Step 3: Add full-text revision and logic issue types**

In `app/src/types/index.ts`, replace the `ErrorAnnotation` type union and add the new types near the grading result types:

```ts
export interface ErrorAnnotation {
  id: string
  type: 'grammar' | 'spelling' | 'word_choice' | 'structure' | 'logic' | 'coherence'
  original: string
  suggestion: string
  explanation: string
  severity: 'low' | 'medium' | 'high'
}

export type FullTextChangeType =
  | 'grammar'
  | 'spelling'
  | 'word_choice'
  | 'sentence_upgrade'
  | 'coherence'
  | 'logic_bridge'
  | 'delete_suggestion'
  | 'replace_sentence'
  | 'reference_clarification'

export type LogicIssueSubType =
  | 'weak_connection'
  | 'unclear_logic'
  | 'missing_cause_effect'
  | 'unclear_transition'
  | 'topic_drift'
  | 'irrelevant_sentence'
  | 'unclear_reference'
  | 'missing_motivation'
  | 'plot_gap'

export type LogicSuggestionAction =
  | 'add_connector'
  | 'add_bridge_sentence'
  | 'delete_sentence'
  | 'replace_sentence'
  | 'clarify_reference'
  | 'ask_student_to_explain'

export interface LogicIssue {
  id: string
  sentenceId?: string
  original: string
  contextBefore?: string
  contextAfter?: string
  subType: LogicIssueSubType
  severity: 'low' | 'medium' | 'high'
  diagnosis: string
  suggestedAction: LogicSuggestionAction
  conservativeSuggestion?: string
  polishedSuggestion?: string
  needsTeacherReview?: boolean
}

export interface FullTextSentencePair {
  id: string
  original: string
  corrected: string
  polished: string
  changeTypes: FullTextChangeType[]
  explanation: string
  preservesOriginalIntent: boolean
  needsTeacherReview?: boolean
}

export interface FullTextRevision {
  originalText: string
  correctedText: string
  polishedText: string
  sentencePairs: FullTextSentencePair[]
  logicIssues: LogicIssue[]
  logicNotes: string[]
}
```

Then extend `GradingResult`:

```ts
export interface GradingResult {
  id: string
  essayId: string
  totalScore: number
  dimensionScores: ScoreDimension[]
  errorAnnotations: ErrorAnnotation[]
  sentenceRevisions: SentenceRevision[]
  upgradedExpressions: UpgradedExpression[]
  fullTextRevision?: FullTextRevision
  overallComment: string
  teacherSuggestion?: string
  aiConfidence: number
  teacherAdjusted: boolean
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 4: Run test to verify current expected failure**

Run:

```powershell
npm.cmd test -- src/data/mockData.test.ts
```

Expected: fail because mock grading results do not yet populate `fullTextRevision`.

- [ ] **Step 5: Commit**

```powershell
git add app/src/types/index.ts app/src/data/mockData.test.ts
git commit -m "test: specify full text revision grading data"
```

## Task 2: Add Mock Full Text Revision Data

**Files:**
- Modify: `app/src/data/mockData.ts`
- Modify: `app/src/data/mockData.test.ts`

- [ ] **Step 1: Add source-phrase coverage test for full-text revision**

Add this block inside the existing `keeps issue and expression source phrases visible in the mock essay text` test in `app/src/data/mockData.test.ts`, after the upgrade loop:

```ts
      for (const pair of result.fullTextRevision?.sentencePairs ?? []) {
        expect(
          essay?.ocrText,
          `${result.id}/${pair.id} sentence pair original should be present in source text`,
        ).toContain(pair.original)
      }

      for (const logicIssue of result.fullTextRevision?.logicIssues ?? []) {
        expect(
          essay?.ocrText,
          `${result.id}/${logicIssue.id} logic issue original should be present in source text`,
        ).toContain(logicIssue.original)
      }
```

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
npm.cmd test -- src/data/mockData.test.ts
```

Expected: fail because mock result data is not populated yet.

- [ ] **Step 3: Update mock essay source text**

In `app/src/data/mockData.ts`, update the `ocrText` in the `essay()` helper to include one safe logic/coherence example while preserving existing source phrases:

```ts
    ocrText:
      'Dear Peter,\n\nI am glad to hear that you are interested in our reading festival. I suggest you joins the club. We should protect the enviroment when we read in public places. It can make you know many knowledge.\n\nI think you can join the English corner and share your favorite book with classmates. This activity is very important because it will help you learn more words and make friends. My mother was angry.\n\nI hope my advice can help you.',
```

- [ ] **Step 4: Add a helper for full-text revision mock data**

In `app/src/data/mockData.ts`, add this helper above `resultFor`:

```ts
const fullTextRevisionFor = (essayId: string) => ({
  originalText:
    'Dear Peter,\n\nI am glad to hear that you are interested in our reading festival. I suggest you joins the club. We should protect the enviroment when we read in public places. It can make you know many knowledge.\n\nI think you can join the English corner and share your favorite book with classmates. This activity is very important because it will help you learn more words and make friends. My mother was angry.\n\nI hope my advice can help you.',
  correctedText:
    'Dear Peter,\n\nI am glad to hear that you are interested in our reading festival. I suggest you join the club. We should protect the environment when we read in public places. It can help you gain a lot of knowledge.\n\nI think you can join the English corner and share your favorite book with classmates. This activity is very important because it will help you learn more words and make friends. My mother was angry.\n\nI hope my advice can help you.',
  polishedText:
    'Dear Peter,\n\nI am glad to hear that you are interested in our reading festival. I suggest that you join the club. We should protect the environment when reading in public places. It can help you gain a lot of knowledge.\n\nFrom my point of view, you can join the English corner and share your favorite book with classmates. This activity is of great importance because it will help you learn more words and make friends. The sentence about your mother needs teacher review because it is not clearly connected to the reading festival.\n\nI hope my advice can help you.',
  sentencePairs: [
    {
      id: `${essayId}-pair-1`,
      original: 'I suggest you joins the club.',
      corrected: 'I suggest you join the club.',
      polished: 'I suggest that you join the club.',
      changeTypes: ['grammar', 'sentence_upgrade'] as const,
      explanation: 'suggest 后的宾语从句使用动词原形；提升版让句式更自然。',
      preservesOriginalIntent: true,
    },
    {
      id: `${essayId}-pair-2`,
      original: 'We should protect the enviroment when we read in public places.',
      corrected: 'We should protect the environment when we read in public places.',
      polished: 'We should protect the environment when reading in public places.',
      changeTypes: ['spelling', 'sentence_upgrade'] as const,
      explanation: '修正 environment 拼写，并让时间状语表达更简洁。',
      preservesOriginalIntent: true,
    },
    {
      id: `${essayId}-pair-3`,
      original: 'It can make you know many knowledge.',
      corrected: 'It can help you gain a lot of knowledge.',
      polished: 'It can help you gain a lot of knowledge.',
      changeTypes: ['word_choice'] as const,
      explanation: 'knowledge 是不可数名词，搭配 gain a lot of knowledge 更自然。',
      preservesOriginalIntent: true,
    },
    {
      id: `${essayId}-pair-4`,
      original: 'My mother was angry.',
      corrected: 'My mother was angry.',
      polished: 'The sentence about your mother needs teacher review because it is not clearly connected to the reading festival.',
      changeTypes: ['coherence', 'replace_sentence'] as const,
      explanation: '该句与上下文关联度差，不能擅自补写原因，建议教师复核。',
      preservesOriginalIntent: false,
      needsTeacherReview: true,
    },
  ],
  logicIssues: [
    {
      id: `${essayId}-logic-1`,
      sentenceId: `${essayId}-pair-4`,
      original: 'My mother was angry.',
      contextBefore:
        'This activity is very important because it will help you learn more words and make friends.',
      contextAfter: 'I hope my advice can help you.',
      subType: 'weak_connection' as const,
      severity: 'high' as const,
      diagnosis: '上下文关联度差：该句与阅读节建议之间缺少明确关系，读者难以判断学生想表达的原因。',
      suggestedAction: 'ask_student_to_explain' as const,
      conservativeSuggestion: '建议学生补充这句话与阅读节的关系，或由教师判断是否删除。',
      polishedSuggestion:
        'The sentence about your mother needs teacher review because it is not clearly connected to the reading festival.',
      needsTeacherReview: true,
    },
  ],
  logicNotes: [
    '第 4 句与上下文关联度差，提升版没有擅自编造新情节，而是提示教师复核。',
    '其余修改主要是语法纠错、拼写纠错和表达升级，保留学生原文思路。',
  ],
})
```

- [ ] **Step 5: Attach full-text revision to result data**

In the `resultFor()` object in `app/src/data/mockData.ts`, add this property after `upgradedExpressions`:

```ts
  fullTextRevision: fullTextRevisionFor(essayId),
```

- [ ] **Step 6: Run tests to verify GREEN**

Run:

```powershell
npm.cmd test -- src/data/mockData.test.ts
```

Expected: all mock-data tests pass.

- [ ] **Step 7: Commit**

```powershell
git add app/src/data/mockData.ts app/src/data/mockData.test.ts
git commit -m "feat: add mock full text revisions"
```

## Task 3: Build Review Issue Display Items

**Files:**
- Create: `app/src/utils/reviewIssueItems.ts`
- Create: `app/src/utils/reviewIssueItems.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Create `app/src/utils/reviewIssueItems.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ErrorAnnotation, LogicIssue, SentenceRevision } from '../types'
import { buildReviewIssueItems } from './reviewIssueItems'

describe('buildReviewIssueItems', () => {
  const annotations: ErrorAnnotation[] = [
    {
      id: 'err-1',
      type: 'grammar',
      original: 'I suggest you joins the club.',
      suggestion: 'I suggest you join the club.',
      explanation: 'suggest 后使用动词原形。',
      severity: 'high',
    },
  ]

  const revisions: SentenceRevision[] = [
    {
      id: 'rev-1',
      relatedErrorId: 'err-1',
      original: 'I suggest you joins the club.',
      revised: 'I suggest you join the club.',
      note: '修正 suggest 句型。',
    },
  ]

  const logicIssues: LogicIssue[] = [
    {
      id: 'logic-1',
      original: 'My mother was angry.',
      subType: 'weak_connection',
      severity: 'high',
      diagnosis: '上下文关联度差：与前后文缺少明确关系。',
      suggestedAction: 'ask_student_to_explain',
      conservativeSuggestion: '建议学生补充原因，或由教师判断是否删除。',
      needsTeacherReview: true,
    },
  ]

  it('adapts language issues into display items', () => {
    const items = buildReviewIssueItems({ annotations, revisions, logicIssues: [] })

    expect(items).toEqual([
      expect.objectContaining({
        id: 'err-1',
        source: 'language',
        typeLabel: 'grammar',
        original: 'I suggest you joins the club.',
        suggestion: 'I suggest you join the club.',
        explanation: '修正 suggest 句型。',
      }),
    ])
  })

  it('adapts logic issues with teacher-review metadata', () => {
    const items = buildReviewIssueItems({ annotations: [], revisions: [], logicIssues })

    expect(items).toEqual([
      expect.objectContaining({
        id: 'logic-1',
        source: 'logic',
        typeLabel: '上下文关联度差',
        diagnosis: '上下文关联度差：与前后文缺少明确关系。',
        suggestedActionLabel: '建议学生补充说明',
        conservativeSuggestion: '建议学生补充原因，或由教师判断是否删除。',
        needsTeacherReview: true,
      }),
    ])
  })
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
npm.cmd test -- src/utils/reviewIssueItems.test.ts
```

Expected: fail because `reviewIssueItems.ts` does not exist.

- [ ] **Step 3: Implement review issue display adapter**

Create `app/src/utils/reviewIssueItems.ts`:

```ts
import type { ErrorAnnotation, LogicIssue, LogicIssueSubType, LogicSuggestionAction, SentenceRevision } from '../types'

export interface ReviewIssueCardItem {
  id: string
  source: 'language' | 'logic'
  typeLabel: string
  severity: 'low' | 'medium' | 'high'
  original: string
  suggestion?: string
  explanation?: string
  diagnosis?: string
  suggestedActionLabel?: string
  conservativeSuggestion?: string
  needsTeacherReview?: boolean
}

interface BuildReviewIssueItemsInput {
  annotations: ErrorAnnotation[]
  revisions: SentenceRevision[]
  logicIssues?: LogicIssue[]
}

const logicSubtypeLabel: Record<LogicIssueSubType, string> = {
  weak_connection: '上下文关联度差',
  unclear_logic: '语句逻辑不清',
  missing_cause_effect: '因果关系缺失',
  unclear_transition: '转折关系不明确',
  topic_drift: '主题偏移',
  irrelevant_sentence: '无关句',
  unclear_reference: '指代不清',
  missing_motivation: '人物动机缺失',
  plot_gap: '情节衔接断裂',
}

const logicActionLabel: Record<LogicSuggestionAction, string> = {
  add_connector: '增加连接词',
  add_bridge_sentence: '补充过渡句',
  delete_sentence: '建议删除该句',
  replace_sentence: '建议替换该句',
  clarify_reference: '明确指代对象',
  ask_student_to_explain: '建议学生补充说明',
}

export function buildReviewIssueItems({
  annotations,
  revisions,
  logicIssues = [],
}: BuildReviewIssueItemsInput): ReviewIssueCardItem[] {
  const revisionByErrorId = new Map(revisions.map((item) => [item.relatedErrorId, item]))

  const languageItems = annotations.map((annotation): ReviewIssueCardItem => {
    const revision = revisionByErrorId.get(annotation.id)

    return {
      id: annotation.id,
      source: 'language',
      typeLabel: annotation.type,
      severity: annotation.severity,
      original: annotation.original,
      suggestion: revision?.revised ?? annotation.suggestion,
      explanation: revision?.note ?? annotation.explanation,
    }
  })

  const logicItems = logicIssues.map((issue): ReviewIssueCardItem => ({
    id: issue.id,
    source: 'logic',
    typeLabel: logicSubtypeLabel[issue.subType],
    severity: issue.severity,
    original: issue.original,
    diagnosis: issue.diagnosis,
    suggestedActionLabel: logicActionLabel[issue.suggestedAction],
    conservativeSuggestion: issue.conservativeSuggestion ?? issue.polishedSuggestion,
    needsTeacherReview: issue.needsTeacherReview,
  }))

  return [...languageItems, ...logicItems]
}
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```powershell
npm.cmd test -- src/utils/reviewIssueItems.test.ts
```

Expected: adapter tests pass.

- [ ] **Step 5: Commit**

```powershell
git add app/src/utils/reviewIssueItems.ts app/src/utils/reviewIssueItems.test.ts
git commit -m "feat: adapt review issue card items"
```

## Task 4: Update IssueCorrectionList For Logic Issues

**Files:**
- Modify: `app/src/components/IssueCorrectionList.tsx`
- Modify: `app/src/pages/EssayResultPage.tsx`
- Modify: `app/src/pages/EssayResultPage.test.tsx`

- [ ] **Step 1: Add failing detail-page tests for logic issue cards**

Add these tests to `app/src/pages/EssayResultPage.test.tsx`:

```tsx
it('shows logic coherence issues in the issue correction module', async () => {
  const user = userEvent.setup()
  renderEssayDetail()

  expect(screen.getByRole('heading', { name: '问题与修改建议' })).toBeInTheDocument()
  expect(screen.getByText('上下文关联度差')).toBeInTheDocument()
  expect(screen.getByText('建议教师复核')).toBeInTheDocument()
  expect(screen.getByText('建议学生补充说明')).toBeInTheDocument()

  await user.click(screen.getByText('My mother was angry.'))

  expect(screen.getByText('已定位')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
npm.cmd test -- src/pages/EssayResultPage.test.tsx -t "shows logic coherence issues"
```

Expected: fail because the issue list does not yet receive logic issues.

- [ ] **Step 3: Update IssueCorrectionList props and rendering**

In `app/src/components/IssueCorrectionList.tsx`:

1. Replace imports:

```ts
import { useState } from 'react'
import type { ReviewIssueCardItem } from '../utils/reviewIssueItems'
import { getSeverityImpactLabel } from '../utils/gradingDiagnostics'
```

2. Replace props:

```ts
interface IssueCorrectionListProps {
  items: ReviewIssueCardItem[]
  activeIssueId?: string | null
  activeIssueLocateStatus?: 'idle' | 'located' | 'missing'
  onIssueSelect?: (issueId: string) => void
}
```

3. Replace severity tone type:

```ts
const severityTone: Record<ReviewIssueCardItem['severity'], string> = {
  low: 'bg-slate-100 text-slate-600',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-rose-100 text-rose-700',
}
```

4. Inside the component, remove `revisionByErrorId` and map over `items`.

5. Replace type chip text:

```tsx
问题类型：{item.typeLabel}
```

6. Replace the body `<dl>` with:

```tsx
<dl className="mt-2 grid gap-1.5 text-sm">
  <div className="grid gap-1 md:grid-cols-[72px_minmax(0,1fr)]">
    <dt className="text-xs font-semibold text-slate-500">原句</dt>
    <dd className="text-slate-600 line-through">{item.original}</dd>
  </div>
  {item.source === 'language' ? (
    <>
      <div className="grid gap-1 md:grid-cols-[72px_minmax(0,1fr)]">
        <dt className="text-xs font-semibold text-slate-500">推荐改法</dt>
        <dd className="font-medium text-slate-950">{item.suggestion}</dd>
      </div>
      <div className="grid gap-1 md:grid-cols-[72px_minmax(0,1fr)]">
        <dt className="text-xs font-semibold text-slate-500">原因</dt>
        <dd className="text-xs leading-5 text-slate-500">{item.explanation}</dd>
      </div>
    </>
  ) : (
    <>
      <div className="grid gap-1 md:grid-cols-[72px_minmax(0,1fr)]">
        <dt className="text-xs font-semibold text-slate-500">诊断</dt>
        <dd className="text-xs leading-5 text-slate-600">{item.diagnosis}</dd>
      </div>
      <div className="grid gap-1 md:grid-cols-[72px_minmax(0,1fr)]">
        <dt className="text-xs font-semibold text-slate-500">建议处理</dt>
        <dd className="font-medium text-slate-950">{item.suggestedActionLabel}</dd>
      </div>
      {item.conservativeSuggestion ? (
        <div className="grid gap-1 md:grid-cols-[72px_minmax(0,1fr)]">
          <dt className="text-xs font-semibold text-slate-500">保守建议</dt>
          <dd className="text-xs leading-5 text-slate-500">{item.conservativeSuggestion}</dd>
        </div>
      ) : null}
      {item.needsTeacherReview ? (
        <div className="grid gap-1 md:grid-cols-[72px_minmax(0,1fr)]">
          <dt className="text-xs font-semibold text-slate-500">状态</dt>
          <dd className="text-xs font-semibold text-amber-700">建议教师复核</dd>
        </div>
      ) : null}
    </>
  )}
</dl>
```

- [ ] **Step 4: Wire the adapter in EssayResultPage**

In `app/src/pages/EssayResultPage.tsx`:

1. Add import:

```ts
import { buildReviewIssueItems } from '../utils/reviewIssueItems'
```

2. Add derived issue items after `activeIssueLocateStatus`:

```ts
  const reviewIssueItems = buildReviewIssueItems({
    annotations: result.errorAnnotations,
    revisions: result.sentenceRevisions,
    logicIssues: result.fullTextRevision?.logicIssues,
  })
```

3. Replace active issue lookup:

```ts
  const reviewIssueItems = buildReviewIssueItems({
    annotations: result.errorAnnotations,
    revisions: result.sentenceRevisions,
    logicIssues: result.fullTextRevision?.logicIssues,
  })
  const activeIssue = reviewIssueItems.find((issue) => issue.id === activeIssueId) ?? null
```

4. Update `IssueCorrectionList` usage:

```tsx
<IssueCorrectionList
  items={reviewIssueItems}
  activeIssueId={activeIssueId}
  activeIssueLocateStatus={activeIssueLocateStatus}
  onIssueSelect={setActiveIssueId}
/>
```

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```powershell
npm.cmd test -- src/utils/reviewIssueItems.test.ts
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected: adapter and detail-page tests pass.

- [ ] **Step 6: Commit**

```powershell
git add app/src/components/IssueCorrectionList.tsx app/src/pages/EssayResultPage.tsx app/src/pages/EssayResultPage.test.tsx
git commit -m "feat: show logic issues in essay detail"
```

## Task 5: Add FullTextRevisionPanel

**Files:**
- Create: `app/src/components/FullTextRevisionPanel.tsx`
- Create: `app/src/components/FullTextRevisionPanel.test.tsx`
- Modify: `app/src/pages/EssayResultPage.test.tsx`

- [ ] **Step 1: Add failing full-text revision panel tests**

Create `app/src/components/FullTextRevisionPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FullTextRevisionPanel } from './FullTextRevisionPanel'

describe('FullTextRevisionPanel', () => {
  it('shows an empty state when full text revision data is missing', () => {
    render(<FullTextRevisionPanel upgrades={[]} />)

    expect(screen.getByRole('heading', { name: '全文优化稿' })).toBeInTheDocument()
    expect(screen.getByText('暂无全文优化稿')).toBeInTheDocument()
  })
})
```

Add this test to `app/src/pages/EssayResultPage.test.tsx`:

```tsx
it('shows full text revision with safe correction and sentence comparison views', async () => {
  const user = userEvent.setup()
  renderEssayDetail()

  expect(screen.getByRole('heading', { name: '全文优化稿' })).toBeInTheDocument()
  expect(screen.getByText(/保留学生原文思路/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '纠错版' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '提升版' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: '逐句对照' })).toBeInTheDocument()
  expect(screen.getByText('逻辑优化说明')).toBeInTheDocument()
  expect(screen.getByText('本文重点提升点')).toBeInTheDocument()
  expect(screen.getByText('From my point of view')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '纠错版' }))
  expect(screen.getByText('I suggest you join the club.')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '逐句对照' }))
  expect(screen.getByText('是否保留原意')).toBeInTheDocument()
  expect(screen.getAllByText('建议教师复核').length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
npm.cmd test -- src/components/FullTextRevisionPanel.test.tsx
npm.cmd test -- src/pages/EssayResultPage.test.tsx -t "shows full text revision"
```

Expected: fail because `FullTextRevisionPanel` is not implemented or rendered.

- [ ] **Step 3: Create FullTextRevisionPanel**

Create `app/src/components/FullTextRevisionPanel.tsx`:

```tsx
import { useState } from 'react'
import type { FullTextRevision, UpgradedExpression } from '../types'

interface FullTextRevisionPanelProps {
  revision?: FullTextRevision
  upgrades: UpgradedExpression[]
}

type RevisionTab = 'corrected' | 'polished' | 'comparison'

const tabLabels: Record<RevisionTab, string> = {
  corrected: '纠错版',
  polished: '提升版',
  comparison: '逐句对照',
}

const changeTypeLabel: Record<string, string> = {
  grammar: '语法纠错',
  spelling: '拼写纠错',
  word_choice: '词汇搭配',
  sentence_upgrade: '句式提升',
  coherence: '逻辑衔接',
  logic_bridge: '补充衔接',
  delete_suggestion: '建议删除',
  replace_sentence: '建议替换',
  reference_clarification: '指代明确',
}

export function FullTextRevisionPanel({ revision, upgrades }: FullTextRevisionPanelProps) {
  const [activeTab, setActiveTab] = useState<RevisionTab>('polished')

  if (!revision) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="font-semibold text-slate-950">全文优化稿</h3>
        <p className="mt-2 text-sm text-slate-500">暂无全文优化稿</p>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h3 className="font-semibold text-slate-950">全文优化稿</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          保留学生原文思路，只纠正语言错误、优化表达，并在必要时提示逻辑衔接问题。
        </p>
      </div>

      <div className="mt-4 inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
        {(Object.keys(tabLabels) as RevisionTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            aria-pressed={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`tech-focus rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              activeTab === tab ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {tabLabels[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'corrected' ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="whitespace-pre-wrap text-sm leading-7 text-slate-800">{revision.correctedText}</p>
        </div>
      ) : null}

      {activeTab === 'polished' ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="whitespace-pre-wrap text-sm leading-7 text-slate-800">{revision.polishedText}</p>
        </div>
      ) : null}

      {activeTab === 'comparison' ? (
        <div className="mt-4 space-y-3">
          {revision.sentencePairs.map((pair) => (
            <div key={pair.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap gap-2">
                {pair.changeTypes.map((type) => (
                  <span key={type} className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-blue-700">
                    {changeTypeLabel[type] ?? type}
                  </span>
                ))}
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    pair.preservesOriginalIntent ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  是否保留原意：{pair.preservesOriginalIntent ? '是' : '需复核'}
                </span>
                {pair.needsTeacherReview ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                    建议教师复核
                  </span>
                ) : null}
              </div>
              <dl className="mt-3 grid gap-2 text-sm">
                <div className="grid gap-1 md:grid-cols-[72px_minmax(0,1fr)]">
                  <dt className="text-xs font-semibold text-slate-500">原句</dt>
                  <dd className="text-slate-600">{pair.original}</dd>
                </div>
                <div className="grid gap-1 md:grid-cols-[72px_minmax(0,1fr)]">
                  <dt className="text-xs font-semibold text-slate-500">纠错版</dt>
                  <dd className="text-slate-800">{pair.corrected}</dd>
                </div>
                <div className="grid gap-1 md:grid-cols-[72px_minmax(0,1fr)]">
                  <dt className="text-xs font-semibold text-slate-500">提升版</dt>
                  <dd className="font-medium text-slate-950">{pair.polished}</dd>
                </div>
                <div className="grid gap-1 md:grid-cols-[72px_minmax(0,1fr)]">
                  <dt className="text-xs font-semibold text-slate-500">说明</dt>
                  <dd className="text-xs leading-5 text-slate-500">{pair.explanation}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/60 p-3">
        <h4 className="text-sm font-semibold text-slate-950">逻辑优化说明</h4>
        <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-600">
          {revision.logicNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>

      {upgrades.length > 0 ? (
        <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
          <h4 className="text-sm font-semibold text-slate-950">本文重点提升点</h4>
          <div className="mt-2 grid gap-2 lg:grid-cols-2">
            {upgrades.map((upgrade) => (
              <div key={upgrade.id} className="rounded-md bg-white p-2 text-xs leading-5">
                <p className="font-semibold text-slate-600">{upgrade.original}</p>
                <p className="mt-1 text-slate-950">{upgrade.upgraded}</p>
                <p className="mt-1 text-slate-500">{upgrade.note}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}
```

- [ ] **Step 4: Run focused component type check through page test**

Run:

```powershell
npm.cmd test -- src/components/FullTextRevisionPanel.test.tsx
npm.cmd test -- src/pages/EssayResultPage.test.tsx -t "shows full text revision"
```

Expected: component empty-state test passes; page test still fails because the panel is not rendered in `EssayResultPage`.

- [ ] **Step 5: Commit**

```powershell
git add app/src/components/FullTextRevisionPanel.tsx app/src/components/FullTextRevisionPanel.test.tsx app/src/pages/EssayResultPage.test.tsx
git commit -m "test: specify full text revision panel"
```

## Task 6: Integrate FullTextRevisionPanel Into EssayResultPage

**Files:**
- Modify: `app/src/pages/EssayResultPage.tsx`
- Modify: `app/src/pages/EssayResultPage.test.tsx`
- Modify: `app/src/pages/DetailNavigation.test.tsx`

- [ ] **Step 1: Run tests to verify RED/GREEN status**

Run:

```powershell
npm.cmd test -- src/components/FullTextRevisionPanel.test.tsx
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected: the component empty-state test passes; the full-text page test fails until integration; existing tests should continue passing.

- [ ] **Step 2: Import and render the panel**

In `app/src/pages/EssayResultPage.tsx`:

1. Remove import:

```ts
import { ExpressionUpgradeList } from '../components/ExpressionUpgradeList'
```

2. Add import:

```ts
import { FullTextRevisionPanel } from '../components/FullTextRevisionPanel'
```

3. Replace:

```tsx
<ExpressionUpgradeList upgrades={result.upgradedExpressions} />
```

with:

```tsx
<FullTextRevisionPanel revision={result.fullTextRevision} upgrades={result.upgradedExpressions} />
```

- [ ] **Step 3: Update any test copy that expects standalone expression module**

In `app/src/pages/DetailNavigation.test.tsx`, if a test currently asserts `表达升级建议`, update that assertion to:

```tsx
expect(screen.getByText('全文优化稿')).toBeInTheDocument()
expect(screen.getByText('本文重点提升点')).toBeInTheDocument()
```

Do not remove tests for issue corrections or existing navigation.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```powershell
npm.cmd test -- src/components/FullTextRevisionPanel.test.tsx
npm.cmd test -- src/pages/EssayResultPage.test.tsx
npm.cmd test -- src/pages/DetailNavigation.test.tsx
```

Expected: both detail-page focused suites pass.

- [ ] **Step 5: Commit**

```powershell
git add app/src/pages/EssayResultPage.tsx app/src/pages/EssayResultPage.test.tsx app/src/pages/DetailNavigation.test.tsx
git commit -m "feat: integrate full text revision panel"
```

## Task 7: Regression Verification And Status Memory

**Files:**
- Modify: `docs/current_development_status.md`

- [ ] **Step 1: Run focused verification**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/data/mockData.test.ts
npm.cmd test -- src/utils/reviewIssueItems.test.ts
npm.cmd test -- src/pages/EssayResultPage.test.tsx
npm.cmd test -- src/pages/DetailNavigation.test.tsx
```

Expected:

- Mock data tests pass.
- Review issue adapter tests pass.
- Essay detail tests pass.
- Detail navigation tests pass.

- [ ] **Step 2: Run full verification**

Run:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected:

- Full test suite passes.
- Lint exits 0.
- Build exits 0.

- [ ] **Step 3: Browser verification**

Open:

```text
http://127.0.0.1:5173/tasks/task-1/essays/task-1-essay-1
```

Verify:

- `诊断摘要` still appears.
- Left-side source panel still shows `阅读定位 / 编辑 OCR`.
- `问题与修改建议` still appears.
- Logic issue card shows `上下文关联度差` and `建议教师复核`.
- Clicking `My mother was angry.` attempts source locating and shows a locate status.
- `全文优化稿` appears.
- Default tab is `提升版`.
- `纠错版` and `逐句对照` switch correctly.
- `逻辑优化说明` appears.
- `本文重点提升点` appears.
- Standalone `表达升级建议` is not shown as the primary separate module.
- AI overall comment and teacher suggestion remain editable.
- Return to progress, previous essay, and next essay still work.
- `原卷批注视图` is not present.

- [ ] **Step 4: Update current development status**

Add this section near the top of `docs/current_development_status.md`:

```markdown
## 本次新增进展：单篇详情页全文优化稿与逻辑诊断

- 单篇详情页新增全文优化稿能力：
  - 纠错版：只做必要语言修正。
  - 提升版：在保留学生原文思路的前提下优化表达与衔接。
  - 逐句对照：展示原句、纠错版、提升版、修改类型、说明和是否需要教师复核。
- 逻辑连贯性诊断进入问题卡片：
  - 支持上下文关联度差、人物动机缺失、情节衔接断裂等类型。
  - 对不确定学生原意的内容显示“建议教师复核”，不擅自编造新内容。
- 原来的表达升级建议不再作为独立主模块展示，已整合为全文优化稿中的“本文重点提升点”。
- 本轮未实现原卷批注视图、图片坐标级批注、真实 AI、真实 OCR 或导出功能。
```

- [ ] **Step 5: Commit docs**

```powershell
git add docs/current_development_status.md
git commit -m "docs: update full text revision status"
```

## Plan Self-Review Checklist

- [ ] Spec coverage: Full-text revision, logic/coherence diagnostics, missing-data behavior, existing expression upgrade integration, deferred original-paper annotation view, and existing detail flow preservation are all mapped to tasks.
- [ ] Placeholder scan: The plan avoids unresolved placeholder language in implementation steps.
- [ ] Type consistency: `FullTextRevision`, `LogicIssue`, `ReviewIssueCardItem`, and `FullTextRevisionPanel` names are consistent across tasks.
- [ ] Scope check: No upload, progress, backend, real AI/OCR, export, or original-paper annotation work is included.
