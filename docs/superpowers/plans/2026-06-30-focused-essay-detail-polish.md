# Focused Essay Detail Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the single-essay detail page denser and more focused by collapsing global navigation, merging source highlighting into the source panel, and compacting correction and expression cards.

**Architecture:** Extend `AppLayout` with a focused sidebar option used only by `EssayResultPage`. Refine `EssaySourcePanel`, `IssueCorrectionList`, and `ExpressionUpgradeList` in place with focused tests before implementation.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Tailwind CSS.

---

### Task 1: Focused Detail Layout

**Files:**
- Modify: `app/src/layout/AppLayout.tsx`
- Modify: `app/src/pages/EssayResultPage.tsx`
- Modify: `app/src/pages/DetailNavigation.test.tsx`

- [ ] Write failing tests for collapsed detail sidebar and expand control.
- [ ] Run `npm.cmd test -- src/pages/DetailNavigation.test.tsx` and confirm RED.
- [ ] Add a focused-review layout prop to `AppLayout`.
- [ ] Pass that prop from `EssayResultPage`.
- [ ] Run focused tests and commit `feat: add focused essay review layout`.

### Task 2: Reading Locate And OCR Edit Modes

**Files:**
- Modify: `app/src/components/EssaySourcePanel.tsx`
- Modify: `app/src/pages/EssayResultPage.test.tsx`

- [ ] Write failing tests for `阅读定位`, `编辑 OCR`, direct source highlight, and no standalone `定位预览`.
- [ ] Run `npm.cmd test -- src/pages/EssayResultPage.test.tsx` and confirm RED.
- [ ] Implement source panel modes and direct highlight rendering.
- [ ] Run focused tests and commit `refactor: merge source highlight into essay panel`.

### Task 3: Compact Review Cards

**Files:**
- Modify: `app/src/components/IssueCorrectionList.tsx`
- Modify: `app/src/components/ExpressionUpgradeList.tsx`
- Modify: `app/src/pages/EssayResultPage.tsx`
- Modify: `app/src/pages/EssayResultPage.test.tsx`
- Modify: `app/src/pages/DetailNavigation.test.tsx`

- [ ] Write failing tests for `已定位`, `未精确定位`, issue card feedback, and expression upgrade feedback.
- [ ] Run focused tests and confirm RED.
- [ ] Pass locate status to `IssueCorrectionList`.
- [ ] Compact issue and expression cards.
- [ ] Run focused tests and commit `refactor: compact essay detail suggestion cards`.

### Task 4: Mock Data Correspondence

**Files:**
- Modify: `app/src/data/mockData.ts`
- Modify: `app/src/data/mockData.test.ts`

- [ ] Write failing mock-data test that checks the primary essay source contains issue originals and expression upgrade originals.
- [ ] Run `npm.cmd test -- src/data/mockData.test.ts` and confirm RED if data is incomplete.
- [ ] Update the primary mock essay text to include all relevant source phrases.
- [ ] Run tests and commit `test: align mock essay source with suggestions`.

### Task 5: Verification, Browser Check, Docs

**Files:**
- Modify: `docs/current_development_status.md`

- [ ] Run full verification.
- [ ] Walk the detail page in the browser.
- [ ] Update development status docs.
- [ ] Commit `docs: update focused essay detail polish status`.
