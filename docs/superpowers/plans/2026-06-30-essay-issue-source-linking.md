# Essay Issue Source Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link right-side issue correction cards to matching highlighted text in the left essay source panel.

**Architecture:** Add pure text matching helpers, extract a focused source panel component, then connect selected issue state through the detail page. Keep all existing detail-page workflows intact.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Tailwind CSS.

---

### Task 1: Text Highlight Helpers

**Files:**
- Create: `app/src/utils/textHighlight.ts`
- Create: `app/src/utils/textHighlight.test.ts`

- [ ] **Step 1: Write failing utility tests**

Cover exact match, trim match, empty values, no match, splitting before/highlight/after, and newline preservation.

- [ ] **Step 2: Run RED**

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/utils/textHighlight.test.ts
```

Expected: fail because `textHighlight.ts` does not exist.

- [ ] **Step 3: Implement helpers**

Export:

```ts
export interface HighlightMatch {
  start: number
  end: number
  matchedText: string
}

export interface HighlightPart {
  text: string
  highlighted: boolean
}

export function findTextMatch(sourceText: string, targetText: string): HighlightMatch | null
export function splitTextByMatch(sourceText: string, match: HighlightMatch | null): HighlightPart[]
```

- [ ] **Step 4: Run GREEN**

```powershell
npm.cmd test -- src/utils/textHighlight.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add app/src/utils/textHighlight.ts app/src/utils/textHighlight.test.ts
git commit -m "feat: add text highlight matching helpers"
```

### Task 2: Selectable Issue Cards

**Files:**
- Modify: `app/src/components/IssueCorrectionList.tsx`
- Modify: `app/src/pages/EssayResultPage.test.tsx`

- [ ] **Step 1: Write failing page test**

Add a test that clicks the first issue card and expects a selected-state label such as `正在定位原文`.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

- [ ] **Step 3: Implement selectable issue props**

Add optional `activeIssueId` and `onIssueSelect`, selected card styling, and `event.stopPropagation()` for "加入班级总览".

- [ ] **Step 4: Run GREEN**

```powershell
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

- [ ] **Step 5: Commit**

```powershell
git add app/src/components/IssueCorrectionList.tsx app/src/pages/EssayResultPage.test.tsx
git commit -m "feat: support active issue selection"
```

### Task 3: Source Panel Highlighting

**Files:**
- Create: `app/src/components/EssaySourcePanel.tsx`
- Modify: `app/src/pages/EssayResultPage.tsx`
- Modify: `app/src/pages/EssayResultPage.test.tsx`

- [ ] **Step 1: Write failing page test**

Add a test that clicks an issue card and expects the source panel locating preview to contain highlighted matching text.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

- [ ] **Step 3: Implement `EssaySourcePanel`**

Move the existing left source panel UI into the component. Preserve textarea editing and image button behavior. Add a read-only source locating preview when `activeHighlightText` is present.

- [ ] **Step 4: Wire active issue state**

In `EssayResultPage`, add `activeIssueId`, derive `activeIssue`, pass props to `IssueCorrectionList` and `EssaySourcePanel`.

- [ ] **Step 5: Run GREEN**

```powershell
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

- [ ] **Step 6: Commit**

```powershell
git add app/src/components/EssaySourcePanel.tsx app/src/pages/EssayResultPage.tsx app/src/pages/EssayResultPage.test.tsx
git commit -m "feat: highlight source text from selected issue"
```

### Task 4: Fallback Feedback And Regression

**Files:**
- Modify: `app/src/components/EssaySourcePanel.tsx`
- Modify: `app/src/pages/EssayResultPage.test.tsx`

- [ ] **Step 1: Add fallback coverage**

Use the utility tests for missing matches and add page-level coverage only if it can be done without broad mock-data rewrites.

- [ ] **Step 2: Run focused tests**

```powershell
npm.cmd test -- src/utils/textHighlight.test.ts
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

- [ ] **Step 3: Commit**

```powershell
git add app/src/components/EssaySourcePanel.tsx app/src/pages/EssayResultPage.test.tsx
git commit -m "feat: add issue locate fallback feedback"
```

### Task 5: Verification, Browser Check, And Docs

**Files:**
- Modify: `docs/current_development_status.md`

- [ ] **Step 1: Run full verification**

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

- [ ] **Step 2: Browser walk-through**

Open `http://127.0.0.1:5173/tasks/task-1/essays/task-1-essay-1`, select issue cards, confirm source highlighting, confirm class-overview button, score editing, teacher comment save, and navigation still work.

- [ ] **Step 3: Update memory**

Record completed issue-to-source linking and latest verification results in `docs/current_development_status.md`.

- [ ] **Step 4: Commit docs**

```powershell
git add docs/current_development_status.md
git commit -m "docs: update issue source linking status"
```
