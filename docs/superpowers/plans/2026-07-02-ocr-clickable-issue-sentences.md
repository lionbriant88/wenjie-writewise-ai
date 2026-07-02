# OCR 原文可点击问题句 v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有右侧问题卡片定位左侧 OCR 原文的基础上，增加左侧 OCR 原文可点击问题句，点击后切到“问题批改”Tab 并选中对应问题卡片。

**Architecture:** 新增一个纯工具函数模块负责把 `reviewIssueItems + essay.ocrText + findTextMatch()` 转成轻量 marker 和文本片段；`EssayResultPage` 继续作为联动中枢，持有 `activeIssueId` 和 `activeDetailTab`；`EssaySourcePanel` 只接收 markers 并在阅读模式渲染可点击句子，编辑模式隐藏 markers。

**Tech Stack:** React, TypeScript, React Router, Vitest, Testing Library, Tailwind CSS, Vite。

---

## File Structure

- Create: `app/src/utils/sourceIssueMarkers.ts`
  - 定义 `SourceIssueMarker`、`SourceIssueMarkerPart`。
  - 基于现有 `findTextMatch()` 生成左侧 OCR 可点击 marker。
  - 处理同句多个 issue 的左侧主 marker 选择。
  - 切分 OCR 文本为普通文本与 marker 片段。
- Create: `app/src/utils/sourceIssueMarkers.test.ts`
  - 验证 `findTextMatch()` 可批量调用的纯函数前提。
  - 验证语言/逻辑 markers、未匹配跳过、同句主问题选择、右侧 issue 列表不被改变。
- Modify: `app/src/components/EssaySourcePanel.tsx`
  - 新增 `issueMarkers`、`activeIssueId`、`onIssueMarkerSelect` props。
  - 阅读模式渲染可点击 marker。
  - Marker 添加 `data-issue-source`、`data-active`。
  - 编辑模式隐藏 marker。
- Modify: `app/src/pages/EssayResultPage.tsx`
  - 计算 issue markers。
  - 点击左侧 marker 时设置 `activeIssueId` 并切到 `issues` Tab。
  - 保留现有右侧卡片点击左侧高亮能力。
- Modify: `app/src/pages/EssayResultPage.test.tsx`
  - 覆盖左侧 marker 显示、点击切换 Tab、选中问题卡片、编辑 OCR 隐藏 marker、修改 OCR 后重新匹配。
- Modify: `app/src/pages/DetailNavigation.test.tsx` and `app/src/pages/ProgressPage.test.tsx`
  - 只在必要时调整断言，确保新 marker 不破坏已有导航与进度入口。
- Modify: `docs/current_development_status.md`
  - 记录本轮完成内容与验证结果。

---

### Task 1: Source Issue Marker Utility

**Files:**
- Create: `app/src/utils/sourceIssueMarkers.ts`
- Create: `app/src/utils/sourceIssueMarkers.test.ts`
- Read: `app/src/utils/textHighlight.ts`

- [ ] **Step 1: Write failing utility tests**

Create `app/src/utils/sourceIssueMarkers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { findTextMatch } from './textHighlight'
import { buildSourceIssueMarkers, splitTextByIssueMarkers } from './sourceIssueMarkers'
import type { ReviewIssueCardItem } from './reviewIssueItems'

const issues: ReviewIssueCardItem[] = [
  {
    id: 'language-1',
    source: 'language',
    typeLabel: 'grammar',
    severity: 'high',
    original: 'I suggest you joins the club.',
    suggestion: 'I suggest you join the club.',
    explanation: 'suggest 后使用动词原形。',
  },
  {
    id: 'logic-1',
    source: 'logic',
    typeLabel: '上下文关联度差',
    severity: 'medium',
    original: 'My mother was angry.',
    diagnosis: '上下文关联度差。',
    suggestedActionLabel: '建议学生补充说明',
  },
  {
    id: 'missing-1',
    source: 'language',
    typeLabel: 'spelling',
    severity: 'low',
    original: 'not in source',
    suggestion: 'not in source',
    explanation: 'missing',
  },
]

describe('sourceIssueMarkers', () => {
  it('uses findTextMatch as a stable batchable pure matcher', () => {
    const source = 'A sentence. I suggest you joins the club.'
    const first = findTextMatch(source, 'I suggest you joins the club.')
    const second = findTextMatch(source, 'I suggest you joins the club.')

    expect(first).toEqual(second)
    expect(source).toBe('A sentence. I suggest you joins the club.')
  })

  it('builds language and logic markers from matched review issues only', () => {
    const source = 'I suggest you joins the club. My mother was angry.'
    const markers = buildSourceIssueMarkers(source, issues)

    expect(markers).toHaveLength(2)
    expect(markers[0]).toMatchObject({
      issueId: 'language-1',
      source: 'language',
      severity: 'high',
      matchedText: 'I suggest you joins the club.',
    })
    expect(markers[1]).toMatchObject({
      issueId: 'logic-1',
      source: 'logic',
      severity: 'medium',
      matchedText: 'My mother was angry.',
    })
    expect(markers.some((marker) => marker.issueId === 'missing-1')).toBe(false)
  })

  it('keeps one source marker for duplicated sentence matches without changing the issue list', () => {
    const duplicateIssues: ReviewIssueCardItem[] = [
      { ...issues[1], id: 'logic-low', severity: 'low', original: 'My mother was angry.' },
      { ...issues[1], id: 'logic-high', severity: 'high', original: 'My mother was angry.' },
    ]

    const markers = buildSourceIssueMarkers('My mother was angry.', duplicateIssues)

    expect(markers).toHaveLength(1)
    expect(markers[0].issueId).toBe('logic-high')
    expect(duplicateIssues).toHaveLength(2)
  })

  it('splits source text into normal and issue marker parts', () => {
    const source = 'Before. I suggest you joins the club. After.'
    const markers = buildSourceIssueMarkers(source, [issues[0]])
    const parts = splitTextByIssueMarkers(source, markers)

    expect(parts).toEqual([
      { text: 'Before. ', marker: null },
      { text: 'I suggest you joins the club.', marker: markers[0] },
      { text: ' After.', marker: null },
    ])
  })
})
```

- [ ] **Step 2: Run utility test to verify it fails**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/utils/sourceIssueMarkers.test.ts
```

Expected: FAIL because `sourceIssueMarkers.ts` does not exist.

- [ ] **Step 3: Implement utility module**

Create `app/src/utils/sourceIssueMarkers.ts`:

```ts
import type { ReviewIssueCardItem } from './reviewIssueItems'
import { findTextMatch } from './textHighlight'

export interface SourceIssueMarker {
  issueId: string
  source: ReviewIssueCardItem['source']
  severity: ReviewIssueCardItem['severity']
  original: string
  matchedText: string
  start: number
  end: number
}

export interface SourceIssueMarkerPart {
  text: string
  marker: SourceIssueMarker | null
}

const severityRank: Record<ReviewIssueCardItem['severity'], number> = {
  low: 1,
  medium: 2,
  high: 3,
}

function shouldReplaceMarker(current: SourceIssueMarker, next: SourceIssueMarker) {
  return severityRank[next.severity] > severityRank[current.severity]
}

export function buildSourceIssueMarkers(sourceText: string, issues: ReviewIssueCardItem[]): SourceIssueMarker[] {
  const markerByRange = new Map<string, SourceIssueMarker>()

  for (const issue of issues) {
    const match = findTextMatch(sourceText, issue.original)

    if (!match) {
      continue
    }

    const marker: SourceIssueMarker = {
      issueId: issue.id,
      source: issue.source,
      severity: issue.severity,
      original: issue.original,
      matchedText: match.matchedText,
      start: match.start,
      end: match.end,
    }
    const rangeKey = `${marker.start}:${marker.end}`
    const current = markerByRange.get(rangeKey)

    if (!current || shouldReplaceMarker(current, marker)) {
      markerByRange.set(rangeKey, marker)
    }
  }

  return [...markerByRange.values()].sort((first, second) => first.start - second.start)
}

export function splitTextByIssueMarkers(sourceText: string, markers: SourceIssueMarker[]): SourceIssueMarkerPart[] {
  if (markers.length === 0) {
    return [{ text: sourceText, marker: null }]
  }

  const parts: SourceIssueMarkerPart[] = []
  let cursor = 0

  for (const marker of markers) {
    if (marker.start < cursor) {
      continue
    }

    if (marker.start > cursor) {
      parts.push({ text: sourceText.slice(cursor, marker.start), marker: null })
    }

    parts.push({ text: sourceText.slice(marker.start, marker.end), marker })
    cursor = marker.end
  }

  if (cursor < sourceText.length) {
    parts.push({ text: sourceText.slice(cursor), marker: null })
  }

  return parts.filter((part) => part.text.length > 0)
}
```

- [ ] **Step 4: Run utility test to verify it passes**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/utils/sourceIssueMarkers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit utility**

```powershell
git add app/src/utils/sourceIssueMarkers.ts app/src/utils/sourceIssueMarkers.test.ts
git commit -m "feat: build source issue markers"
```

---

### Task 2: Essay Detail Interaction Tests

**Files:**
- Modify: `app/src/pages/EssayResultPage.test.tsx`

- [ ] **Step 1: Write failing tests for clickable source markers**

Add a test to `EssayResultPage.test.tsx`:

```tsx
it('lets the teacher click a marked source sentence to open and select the matching issue', async () => {
  const user = userEvent.setup()
  renderEssayDetail()

  const languageMarker = screen.getByRole('button', { name: '查看问题：I suggest you joins the club.' })
  expect(languageMarker).toHaveAttribute('data-issue-source', 'language')
  expect(languageMarker).toHaveAttribute('data-active', 'false')
  expect(screen.getByRole('button', { name: '查看问题：My mother was angry.' })).toHaveAttribute(
    'data-issue-source',
    'logic',
  )
  expect(screen.getByRole('tab', { name: '评分诊断' })).toHaveAttribute('aria-selected', 'true')

  await user.click(languageMarker)

  expect(screen.getByRole('tab', { name: '问题批改' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('button', { name: /I suggest you joins the club\./ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(screen.getByRole('button', { name: '查看问题：I suggest you joins the club.' })).toHaveAttribute(
    'data-active',
    'true',
  )
  expect(screen.getByText('已定位')).toBeInTheDocument()
})
```

- [ ] **Step 2: Write failing tests for edit mode and rematching**

Add a test:

```tsx
it('hides source issue markers while editing OCR and recalculates them after text changes', async () => {
  const user = userEvent.setup()
  renderEssayDetail()

  expect(screen.getByRole('button', { name: '查看问题：I suggest you joins the club.' })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '编辑 OCR' }))
  expect(screen.queryByRole('button', { name: '查看问题：I suggest you joins the club.' })).not.toBeInTheDocument()

  await user.clear(screen.getByLabelText('学生作文原文'))
  await user.type(screen.getByLabelText('学生作文原文'), 'This edited OCR text no longer contains the issue sentence.')
  await user.click(screen.getByRole('button', { name: '阅读定位' }))

  expect(screen.queryByRole('button', { name: '查看问题：I suggest you joins the club.' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: '问题批改' }))
  await user.click(screen.getByText('I suggest you joins the club.'))

  expect(screen.getByText('未精确定位')).toBeInTheDocument()
  expect(screen.getByText('未在原文中精确定位，请手动核对')).toBeInTheDocument()
})
```

- [ ] **Step 3: Run essay test to verify it fails**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected: FAIL because source markers are not yet rendered.

---

### Task 3: Implement Clickable Source Markers

**Files:**
- Modify: `app/src/components/EssaySourcePanel.tsx`
- Modify: `app/src/pages/EssayResultPage.tsx`

- [ ] **Step 1: Add marker props to EssaySourcePanel**

Update imports and props:

```tsx
import type { SourceIssueMarker } from '../utils/sourceIssueMarkers'
import { splitTextByIssueMarkers } from '../utils/sourceIssueMarkers'

interface EssaySourcePanelProps {
  essay: Essay
  activeHighlightText?: string
  issueMarkers?: SourceIssueMarker[]
  activeIssueId?: string | null
  onIssueMarkerSelect?: (issueId: string) => void
  onOcrTextChange: (essayId: string, nextText: string) => void
  onViewOriginalImage: () => void
}
```

- [ ] **Step 2: Render clickable marker parts in read mode**

Inside `EssaySourcePanel`, derive parts:

```tsx
const markerParts = useMemo(
  () => splitTextByIssueMarkers(essay.ocrText, issueMarkers),
  [essay.ocrText, issueMarkers],
)
```

Render marker buttons in read mode when markers exist; keep current highlight fallback for selected issue:

```tsx
{markerParts.map((part, index) => {
  if (!part.marker) {
    return <span key={`${part.text}-${index}`}>{part.text}</span>
  }

  const isActive = activeIssueId === part.marker.issueId
  const markerTone =
    part.marker.source === 'logic'
      ? isActive
        ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-200'
        : 'bg-amber-50 text-slate-800 hover:bg-amber-100'
      : isActive
        ? 'bg-cyan-100 text-cyan-950 ring-1 ring-cyan-200'
        : 'bg-cyan-50 text-slate-800 hover:bg-cyan-100'

  return (
    <button
      key={`${part.marker.issueId}-${part.marker.start}-${index}`}
      type="button"
      data-issue-source={part.marker.source}
      data-active={isActive ? 'true' : 'false'}
      onClick={() => onIssueMarkerSelect?.(part.marker.issueId)}
      className={`tech-focus inline rounded px-1 text-left font-inherit leading-inherit transition ${markerTone}`}
      aria-label={`查看问题：${part.marker.matchedText}`}
    >
      {part.text}
    </button>
  )
})}
```

- [ ] **Step 3: Preserve fallback for no markers**

If `issueMarkers` is empty, keep rendering `highlightParts` exactly as before so existing right-to-left behavior remains unchanged for pages without marker data.

- [ ] **Step 4: Wire markers in EssayResultPage**

Import utility:

```tsx
import { buildSourceIssueMarkers } from '../utils/sourceIssueMarkers'
```

Create memoized markers:

```tsx
const sourceIssueMarkers = useMemo(
  () => buildSourceIssueMarkers(essay?.ocrText ?? '', reviewIssueItems),
  [essay?.ocrText, reviewIssueItems],
)
```

Pass to `EssaySourcePanel`:

```tsx
<EssaySourcePanel
  essay={essay}
  activeHighlightText={activeIssue?.original}
  issueMarkers={sourceIssueMarkers}
  activeIssueId={activeIssueId}
  onIssueMarkerSelect={(issueId) => {
    setActiveIssueId(issueId)
    setActiveDetailTab('issues')
  }}
  onOcrTextChange={updateEssayOcrText}
  onViewOriginalImage={() => setShowOriginalImage(true)}
/>
```

- [ ] **Step 5: Run essay test to verify it passes**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit clickable marker implementation**

```powershell
git add app/src/components/EssaySourcePanel.tsx app/src/pages/EssayResultPage.tsx app/src/pages/EssayResultPage.test.tsx
git commit -m "feat: add clickable ocr issue sentences"
```

---

### Task 4: Regression and Memory Update

**Files:**
- Modify: `app/src/pages/DetailNavigation.test.tsx` only if needed.
- Modify: `app/src/pages/ProgressPage.test.tsx` only if needed.
- Modify: `docs/current_development_status.md`

- [ ] **Step 1: Run focused regressions**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/utils/sourceIssueMarkers.test.ts
npm.cmd test -- src/pages/EssayResultPage.test.tsx
npm.cmd test -- src/pages/DetailNavigation.test.tsx
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

- [ ] **Step 3: Browser verification**

Open:

```text
http://127.0.0.1:5173/tasks/task-1/essays/task-1-essay-1
```

Verify:

- 左侧原文阅读模式显示非常轻的问题句标记。
- 点击语言问题 marker 后右侧切到“问题批改”，对应卡片选中。
- 点击逻辑问题 marker 后右侧切到“问题批改”，对应卡片选中。
- 编辑 OCR 时 marker 隐藏。
- 视觉没有变成满屏重高亮。

- [ ] **Step 4: Update project memory**

Add to `docs/current_development_status.md`:

```markdown
## 2026-07-02：OCR 原文可点击问题句 v0.1

- 左侧 OCR 原文阅读模式新增轻量问题句 marker，不显示编号，不做图片批注。
- Marker 只来自当前 `reviewIssueItems` 的语言问题和逻辑问题，不从全文优化稿或班级总览素材反推。
- 点击左侧 marker 会切到“问题批改”Tab 并选中对应问题卡片。
- OCR 编辑模式隐藏 marker，回到阅读模式后按最新文本重新计算。
- 现有右侧问题卡片到左侧高亮、加入班级总览、全文优化稿、教师反馈和进度页入口保持可用。
- 验证：`npm.cmd test`、`npm.cmd run lint`、`npm.cmd run build`。
```

- [ ] **Step 5: Commit memory update**

```powershell
git add docs/current_development_status.md
git commit -m "docs: record clickable ocr issue sentence progress"
```

---

## Self-Review

- Spec coverage: 轻量 marker、无编号、只使用语言/逻辑 `reviewIssueItems`、同句只绑定主 marker、右侧列表完整保留、`findTextMatch()` 复用与纯函数确认、稳定测试属性、点击左侧 marker 切 Tab 并选中卡片、编辑 OCR 隐藏 marker，均有对应任务。
- Placeholder scan: Plan contains no TODO/TBD placeholders.
- Type consistency: `SourceIssueMarker`, `SourceIssueMarkerPart`, `issueMarkers`, `activeIssueId`, `onIssueMarkerSelect` naming is consistent across utility, component, page, and tests.
