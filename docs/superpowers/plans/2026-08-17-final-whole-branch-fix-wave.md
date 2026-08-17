# Final Whole-Branch Fix Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every release blocker and concrete minor in the binding final-fix brief without changing the multimodal v2 wire shape or website layout.

**Architecture:** Put UTF-16, exact-range, overlap, reconstruction, and review-reason primitives in a browser-safe grading module that both Gateway and website code can execute. Keep Provider-only policy filtering in the Gateway, bind public-response validation to the submitted task and input mode in the website, and make UI/legacy/dependency changes at their existing boundaries.

**Tech Stack:** TypeScript 6, Vitest, React Testing Library, Express, Multer 2.2.0, npm lockfile v3.

**Execution status:** Completed on 2026-08-17; command counts and the one audit-environment limitation are recorded in `.superpowers/sdd/2026-08-15-direct-multimodal-grading-policy/whole-branch-final-fix-report.md`.

## Global Constraints

- Preserve `multimodal-grading-request-v2` and `grading-result-v2` field shapes.
- Preserve conservative spelling, local-legibility isolation, zero-image teacher-confirmed regrade, exact grounding/reconstruction, website layout, privacy redaction, and atomic deployment.
- Write and run behavioral RED tests before each production behavior change; do not use source-grep tests.
- Upgrade only `multer`, required `@types/multer`, and their lockfile entries; do not run an automated audit fix.
- Verification output and reports must not expose essay text, image bytes, raw Provider responses, absolute local paths, environment values, or credentials.

---

### Task 1: Shared semantic primitives and Gateway policy

**Files:**
- Create: `app/src/services/grading/gradingResultSemantics.ts`
- Modify: `grading-gateway/src/multimodal/transcriptRange.ts`
- Modify: `grading-gateway/src/multimodal/resultPolicy.ts`
- Modify: `grading-gateway/src/multimodal/normalizeMultimodalResult.ts`
- Modify: `grading-gateway/src/multimodal/gradingPrompt.ts`
- Test: `grading-gateway/src/multimodal/resultPolicy.test.ts`
- Test: `grading-gateway/src/multimodal/normalizeMultimodalResult.test.ts`
- Test: `grading-gateway/src/multimodal/gradingPrompt.test.ts`

**Interfaces:**
- Produces: `isWellFormedUnicode`, `exactUniqueTranscriptRange`, `transcriptRangesOverlap`, non-overlapping reconstruction, ordered-context validation, normalized-reading uniqueness, and stable review-reason constants.
- Consumes: existing UTF-16 code-unit range semantics and unchanged Provider/public result fields.

- [ ] **Step 1: Write RED tests for a filtered `wark -> work` warning, a benign `Good work` phrase, and an independent global warning.**
- [ ] **Step 2: Write RED tests proving `can` does not match `cannot` or ordinary positive prose, while `the word can is unclear` is rejected outside the legibility issue.**
- [ ] **Step 3: Write RED schema/runtime tests for exact, trimmed, and NFC-equivalent duplicate readings.**
- [ ] **Step 4: Run the three focused Gateway test files and retain the expected assertion failures as report evidence.**
- [ ] **Step 5: Extract the pure helpers, make warning/legibility checks cue-aware and term-bounded, and reject normalized duplicate readings.**
- [ ] **Step 6: Re-run the focused files GREEN.**

### Task 2: Unified finding IDs and request-bound website validation

**Files:**
- Modify: `grading-gateway/src/normalizeGradingResult.ts`
- Create: `app/src/services/grading/validateGradingResultSemantics.ts`
- Modify: `app/src/services/grading/projectGradingClientResponse.ts`
- Modify: `app/src/services/grading/remoteGradingClient.ts`
- Modify: `grading-gateway/tsconfig.json`
- Test: `app/src/services/grading/projectGradingClientResponse.test.ts`
- Test: `app/src/services/grading/gatewayContract.test.ts`
- Test: `app/src/services/grading/remoteGradingClient.test.ts`

**Interfaces:**
- Consumes: the exact submitted `ConfirmedTaskPackageV2`, transcript, page mode/count, and projected public result.
- Produces: stable language and logic public IDs in one relationship namespace plus a boolean fail-closed semantic validator.

- [ ] **Step 1: Write a RED vertical test with a mixed language+logic revision and a logic-only `logic_bridge` pair; assert the adapter retains both public logic links and an unknown link fails.**
- [ ] **Step 2: Write RED projector mutation tests for every quote-bearing field, malformed surrogate halves, rubric ID/name/weight/max drift, unordered logic context, overlapping/drifted aggregate reconstruction, page/mode violations, arbitrary reasons, and warning/status contradictions.**
- [ ] **Step 3: Run the focused contract/projector/client files and capture the expected failures.**
- [ ] **Step 4: Generate IDs for retained language and logic findings, validate links against their union, and pass the submitted task from the remote client.**
- [ ] **Step 5: Apply shared grounding/reconstruction helpers and require the exact allowed/derived review-reason set with `success` only for an empty set.**
- [ ] **Step 6: Re-run the focused files GREEN.**

### Task 3: Request mode, UTF-16 preflight, marker segmentation, and legacy mapping

**Files:**
- Create: `app/src/services/grading/validateMultimodalGradingRequestMode.ts`
- Modify: `app/src/services/grading/mockGradingClient.ts`
- Modify: `app/src/services/grading/remoteGradingClient.ts`
- Modify: `app/src/services/grading/buildMultimodalGradingRequest.ts`
- Modify: `grading-gateway/src/server.ts`
- Modify: `app/src/utils/sourceIssueMarkers.ts`
- Modify: `app/src/components/EssaySourcePanel.tsx`
- Modify: `app/src/services/grading/buildConfirmedTaskPackage.ts`
- Test: corresponding client, builder, server, marker, panel, and new legacy-package test files.

**Interfaces:**
- Produces: `{ ok: true, mode: 'images' | 'confirmed_text' }` for valid requests; segmented marker parts whose `issueIds` contain every covering marker; deterministic v2 legacy package arrays.

- [ ] **Step 1: Write RED client/builder/server tests for mixed mode and malformed UTF-16, including zero Provider/fetch calls.**
- [ ] **Step 2: Write RED utility and rendered-component tests for nested outer/inner selection and deterministic severity click ownership.**
- [ ] **Step 3: Write RED legacy tests using `mockTasks`, a blank optional teacher requirement, and a continuation task containing every legacy semantic field.**
- [ ] **Step 4: Run the focused files and capture the expected failures.**
- [ ] **Step 5: Add one shared request-mode validator, preflight Unicode checks, boundary-point interval segmentation, and the documented legacy field map.**
- [ ] **Step 6: Re-run the focused files GREEN.**

### Task 4: Multipart dependency and operational documentation

**Files:**
- Modify: `grading-gateway/package.json`
- Modify: `grading-gateway/package-lock.json`
- Modify: `docs/current_development_status.md`

**Interfaces:**
- Consumes: official Multer metadata showing 2.2.0 as current and the release containing the cited advisory fixes.
- Produces: installed `multer@2.2.0`, matching current types, an unchanged upload contract, a historical label for obsolete v1/DeepSeek notes, and an explicit legacy mapping record.

- [ ] **Step 1: Record the pre-upgrade upload-boundary test result.**
- [ ] **Step 2: Install exact `multer@2.2.0` and `@types/multer@2.2.0` without an audit fix.**
- [ ] **Step 3: Inspect the manifest/lock diff and reject any unrelated dependency movement.**
- [ ] **Step 4: Re-run multipart/server limit, count, malformed, abort/error, and redaction coverage plus `npm audit --omit=dev`.**
- [ ] **Step 5: Mark the v1 `/grading/grade`/DeepSeek section historical and document the deterministic legacy field map.**

### Task 5: Final verification, report, and commit

**Files:**
- Create: `.superpowers/sdd/2026-08-15-direct-multimodal-grading-policy/whole-branch-final-fix-report.md`

**Interfaces:**
- Consumes: fresh focused/full command output and the final Git diff.
- Produces: per-finding RED/GREEN evidence, exact counts, audit/version evidence, privacy review, residual concerns, and one scoped commit.

- [ ] **Step 1: Run Gateway tests, typecheck, shared scoring runtime, and fixture verification once.**
- [ ] **Step 2: Run app tests, typecheck, lint, and build once.**
- [ ] **Step 3: Run production audit and `git diff --check`; inspect cross-layer parity, legacy mapping, overlapping markers, false positives, UTF-16, dependency scope, docs, and privacy.**
- [ ] **Step 4: Write the report using counts and outputs from those fresh commands.**
- [ ] **Step 5: Stage only scoped files, review the staged diff, and commit the complete wave.**

## Self-Review

- Every binding finding maps to a behavioral RED/GREEN step and a production boundary.
- No task changes the v2 field set, route set, page layout, Provider privacy boundary, or atomic deployment requirement.
- Shared helpers are browser-safe and contain no Express, Multer, filesystem, environment, or Provider imports.
- The dependency task names only Multer, its types, and lock entries; no broad audit fix is permitted.
