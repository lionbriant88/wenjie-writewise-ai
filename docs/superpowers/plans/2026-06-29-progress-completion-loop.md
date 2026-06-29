# Progress Completion Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the phase 2 mock grading loop so queued essays can be completed from the progress page and opened in the existing detail page with generated mock review results.

**Architecture:** Reuse `AppStateContext` as the in-memory state boundary. Keep the existing `/tasks/:taskId/essays/:essayId` detail route, add a lightweight progress indicator in `ProgressPage`, and make `completeEssayWithMockResult` generate reusable mock results for any queued essay.

**Tech Stack:** React, TypeScript, React Router, Vitest, Testing Library, Vite.

---

### Task 1: Progress Completion Behavior

**Files:**
- Modify: `app/src/pages/ProgressPage.test.tsx`
- Modify: `app/src/pages/ProgressPage.tsx`
- Modify: `app/src/context/AppStateContext.tsx`

- [ ] **Step 1: Write failing tests**
  - Verify a queued essay shows lightweight processing progress.
  - Verify clicking `模拟完成下一篇` completes a queued essay, shows a success message, and reveals `查看结果`.
  - Verify clicking `查看结果` opens the existing essay detail page with a mock review result.

- [ ] **Step 2: Run focused tests and confirm failure**

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/ProgressPage.test.tsx
```

- [ ] **Step 3: Implement minimal behavior**
  - Add stable progress text/bar for active queued essays.
  - Add completion feedback state in `ProgressPage`.
  - Ensure `completeEssayWithMockResult` creates a complete `GradingResult` for newly uploaded essays.

- [ ] **Step 4: Verify**

```powershell
npm.cmd test -- src/pages/ProgressPage.test.tsx
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

- [ ] **Step 5: Browser check**
  - Upload/OCR/group confirm.
  - Go to progress.
  - Click `模拟完成下一篇`.
  - Confirm success feedback, `查看结果`, and detail page result.
