# Class Review Materials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v0.1 class review materials loop from essay issue cards into the class review page.

**Architecture:** Add a separate in-memory `classReviewMaterials` collection to `AppStateProvider`, keeping generated `classInsights` unchanged. Keep `IssueCorrectionList` controlled by passing material status and callbacks from `EssayResultPage`. Render teacher-selected materials in a new `ClassReviewMaterialsPanel` on `ClassReviewPage`.

**Tech Stack:** React, TypeScript, React Router, Vitest, Testing Library, Tailwind CSS, existing in-memory app state.

---

## File Structure

- Modify `app/src/types/index.ts`: add `ClassReviewMaterialType`, `ClassReviewMaterial`, and input type.
- Create `app/src/utils/classReviewMaterials.ts`: material labels, dedupe key, tab filtering, and issue-to-material mapping helpers.
- Create `app/src/utils/classReviewMaterials.test.ts`: unit tests for dedupe, filtering, and mapping.
- Modify `app/src/context/appStateContextValue.ts`: expose materials and add/remove/is-added operations.
- Modify `app/src/context/AppStateContext.tsx`: manage in-memory material state and dedupe writes.
- Modify `app/src/components/IssueCorrectionList.tsx`: convert local added state to controlled `isIssueAdded` and `onAddIssue`.
- Create `app/src/components/ClassReviewMaterialsPanel.tsx`: render tabs, cards, empty state, remove, and source links.
- Create `app/src/components/ClassReviewMaterialsPanel.test.tsx`: component behavior tests.
- Modify `app/src/pages/EssayResultPage.tsx`: wire issue cards to global material state.
- Modify `app/src/pages/EssayResultPage.test.tsx`: assert controlled add behavior and full-text revision preservation.
- Modify `app/src/pages/ClassReviewPage.tsx`: render selected materials above generated insights.
- Modify `app/src/pages/ClassReviewPage.test.tsx`: integration tests for display, filtering, removal, source navigation, empty state, and existing stats.
- Modify `app/src/pages/ProgressPage.test.tsx`: focused regression for latest completed entry remains available.
- Modify `docs/current_development_status.md`: record completed v0.1 status after verification.

## Task 1: Add Material Types And Pure Helpers

- [ ] Write failing tests in `app/src/utils/classReviewMaterials.test.ts` for dedupe key priority, issue item mapping, tab filtering, and hiding empty expression tab.
- [ ] Run `npm.cmd test -- src/utils/classReviewMaterials.test.ts` and verify RED.
- [ ] Add `ClassReviewMaterial` types in `app/src/types/index.ts`.
- [ ] Implement helper functions in `app/src/utils/classReviewMaterials.ts`.
- [ ] Run `npm.cmd test -- src/utils/classReviewMaterials.test.ts` and verify GREEN.

## Task 2: Add App State Material Operations

- [ ] Write failing page-level tests showing detail add state persists through navigation to class review and does not duplicate.
- [ ] Run `npm.cmd test -- src/pages/EssayResultPage.test.tsx src/pages/ClassReviewPage.test.tsx` and verify RED.
- [ ] Add `classReviewMaterials`, `addClassReviewMaterial`, `removeClassReviewMaterial`, and `isClassReviewMaterialAdded` to app state.
- [ ] Run focused tests and verify the state operations are usable.

## Task 3: Control IssueCorrectionList From EssayResultPage

- [ ] Update `IssueCorrectionList` tests through `EssayResultPage.test.tsx` so clicking language and logic issues writes real materials.
- [ ] Run the focused detail tests and verify RED.
- [ ] Replace local `addedIds` in `IssueCorrectionList` with `isIssueAdded` and `onAddIssue`.
- [ ] Wire `EssayResultPage` to build materials from `ReviewIssueCardItem` and call app state operations.
- [ ] Run `npm.cmd test -- src/pages/EssayResultPage.test.tsx` and verify GREEN.

## Task 4: Render Class Review Materials Panel

- [ ] Write failing tests for empty state, material cards, tabs, no empty expression tab, remove, and source link.
- [ ] Run `npm.cmd test -- src/components/ClassReviewMaterialsPanel.test.tsx src/pages/ClassReviewPage.test.tsx` and verify RED.
- [ ] Implement `ClassReviewMaterialsPanel`.
- [ ] Render it in `ClassReviewPage` between score distribution and generated insight panels.
- [ ] Run component and class review tests and verify GREEN.

## Task 5: Regression And Memory Update

- [ ] Run focused tests:
  - `npm.cmd test -- src/utils/classReviewMaterials.test.ts`
  - `npm.cmd test -- src/pages/EssayResultPage.test.tsx`
  - `npm.cmd test -- src/pages/ClassReviewPage.test.tsx`
  - `npm.cmd test -- src/pages/ProgressPage.test.tsx`
- [ ] Run full verification:
  - `npm.cmd test`
  - `npm.cmd run lint`
  - `npm.cmd run build`
- [ ] Update `docs/current_development_status.md` with the v0.1 materials loop.
- [ ] Run `git status --short --branch` and confirm only intended files changed.

## Self-Review Checklist

- Spec coverage: language and logic issue materials, dedupe, controlled issue list, class review display, removal, no empty expression tab, and regressions are covered.
- Scope check: no real AI/OCR/backend/export/query-param location work is included.
- Type consistency: `ClassReviewMaterial`, `ClassReviewMaterialType`, and helper names match across tasks.
