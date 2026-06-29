# Confirm OCR To Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a confirmed mock OCR handoff from the upload page into the progress queue.

**Architecture:** Reuse the existing in-memory `AppStateContext`. Add one context action that creates a `pending_grading` essay from organized pages and OCR text, then let existing task summary logic update counts and status.

**Tech Stack:** React, TypeScript, React Router, Vitest, Testing Library, Vite.

---

### Task 1: Add State Action And Upload Flow

**Files:**
- Modify: `app/src/context/appStateContextValue.ts`
- Modify: `app/src/context/AppStateContext.tsx`
- Modify: `app/src/pages/UploadPage.tsx`
- Test: `app/src/pages/UploadPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Add a test that renders upload and progress routes inside one provider, starts mock OCR, confirms the draft, and expects progress to show the new queued essay.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- src/pages/UploadPage.test.tsx`

Expected: FAIL because `确认 OCR 文本` does not exist yet.

- [ ] **Step 3: Add context API**

Add `confirmMockOcrEssay(input)` to `AppState`. The method accepts `taskId`, `pages`, and `ocrText`, creates one `Essay` with `pending_grading`, and updates the task summary through `updateTasksFromEssays`.

- [ ] **Step 4: Wire upload page**

Render `确认 OCR 文本` below the mock OCR draft. On click, call `confirmMockOcrEssay`, reset local OCR state, and navigate to the task progress route.

- [ ] **Step 5: Verify**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/UploadPage.test.tsx
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected: all commands pass.
