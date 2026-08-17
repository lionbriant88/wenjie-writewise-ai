# Whole-branch Fix B report

## Status

DONE. The website and Gateway now have one active grading path and one v2 wire contract. The pre-existing controller update to `whole-branch-fix-a-report.md` was preserved and excluded from this change.

## Compatibility decision

Repository callers and the migration plan were inspected before implementation. No active website caller used `POST /grading/grade`; the only active client path is now `gradeImages`. The smallest safe choice was deprecation by removal: `/grading/grade` returns 404, while reachable legacy tasks are converted to the v2 confirmed task package and sent to `/grading/grade-images` with an exact teacher transcript and no images. This avoids retaining a second provider/policy bypass. The compatibility consequence is intentionally breaking and is covered by the atomic deployment note below.

## TDD RED evidence

- App focused contract run: 6 files, 12 failed / 77 passed. Failures covered the generic AppState call, zero-page confirmed mock flow, v2 projection/metadata, decimal weights and 50,000 limits, review flags, and same-range markers.
- Gateway focused contract run: 5 files, 11 failed / 93 passed. Failures covered exact metadata, generic route removal, raw Provider `reviewReasons`, confirmed invariants, bounded unique `changeTypes`, rubric trust modes, and prompts.
- Added relationship-array regressions failed 1/1 in both app and Gateway before empty-but-bounded unique relationships were accepted.
- `npm.cmd test -- src/services/grading/buildMultimodalGradingRequest.test.ts -t "oversized constraint item"` failed 1/1 before the website package boundary was aligned to the Gateway's 5,000-code-unit item limit.
- The injected-rubric route regression failed 1/1 (expected 503, received 200) before the server independently enforced generated-rubric trust after every provider return.

## Implementation

- `AppStateContext` builds only `MultimodalGradingRequestV2` and calls only `gradeImages`. Image mode preserves page order; confirmed-text mode sends the exact teacher transcript with `pages: []` and `pageIds: []`.
- A shared confirmed-task-package builder converts material and reachable legacy task data. Generated rubrics require one 5% legibility dimension; teacher-confirmed rubrics accept one positive decimal legibility weight totaling 100 within tolerance. Legacy teacher rubrics receive the compatibility legibility dimension during conversion.
- Remote and local mock clients expose one grading method. Multipart metadata requires `multimodal-grading-request-v2`; results require `grading-result-v2`. The generic production route is removed.
- Gateway and website enforce aligned bounds: 50,000-code-unit transcript/public feedback, 10 dimensions, 100 issues/revisions/pairs/upgrades/logic notes, 50 logic/legibility/warnings, and 100 review reasons. Decimal weights, bounded unique enum-only `changeTypes`, unique relationship IDs, and duplicate object IDs are validated.
- Raw multimodal and generic Provider contracts no longer accept or request `reviewReasons`; the Gateway derives them from normalization and policy evidence.
- Confirmed mode fails closed unless the Provider transcript is exact, recognition warnings and legibility issues are empty, and printed text exclusion is true.
- Language/certain-spelling review cards retain `needsTeacherReview`; one visual source marker retains all IDs for same-range issues and chooses the primary deterministically by severity and input order.

## Verification

- `grading-gateway: npm.cmd test` — PASS, 20 files / 270 tests.
- `grading-gateway: npm.cmd run typecheck` — PASS.
- `grading-gateway: npm.cmd run verify:shared-scoring-runtime` — PASS, `shared scoring runtime ok`.
- `app: npm.cmd test` — PASS, 45 files / 282 tests.
- `app: npm.cmd run typecheck` — PASS.
- `app: npm.cmd run lint` — PASS.
- `app: npm.cmd run build` — PASS, 107 modules transformed; production assets emitted.
- `git diff --check` — PASS (line-ending conversion warnings only; no whitespace errors).

## Deployment note

`docs/current_development_status.md`, section `2026-08-17：多模态批改 v2 原子部署要求`, records that the Gateway and website must be deployed atomically for `multimodal-grading-request-v2` / `grading-result-v2`; mixed v1/v2 operation is unsupported.

## Self-review

Checked the exact v2 request/result values, zero-page confirmed mock flow, decimal weights and tolerance, 50,000 boundaries, array bounds, unique nonempty `changeTypes`, relationship uniqueness, raw Provider review-reason removal, confirmed runtime invariants, generated-vs-teacher rubric rules, preserved review flags, and same-range issue relationships. No essay text, image content, Provider payload, or credential was logged or placed in failures.

## Review round 1 (2026-08-17)

### RED evidence and minimal fixes

1. Saved confirmed rubrics and decimal editing:
   - `app: npm.cmd test -- src/services/grading/buildMultimodalGradingRequest.test.ts -t "decimal weights even when rubric originated from AI"` — RED: expected `ok: true`, received `ok: false` for a positive decimal teacher edit totaling 100.
   - `app: npm.cmd test -- src/pages/CreateTaskPage.test.tsx -t "allows decimal teacher edits"` — RED: the weight input had no decimal `step`.
   - The confirmed-package builder now treats every saved confirmed rubric as teacher-confirmed; exact 5% remains solely in generated Provider-return validation. The existing UI layout is unchanged and the number input uses `step="any"`.
2. Complete confirmed mock projection:
   - `app: npm.cmd test -- src/services/grading/mockGradingClient.test.ts -t "accepts the real zero-page"` — RED: one failed test; body-derived evidence used the image-mode placeholder and `fullTextRevision` was missing (payload text redacted here).
   - Mock mode now selects the authoritative transcript first and uses it for evidence and complete `originalText`/`correctedText`/`improvedText` revision fields.
3. Nonempty writing requirements:
   - `grading-gateway: npm.cmd test -- src/multimodal/validateRubric.test.ts src/multimodal/rubricPrompts.test.ts` — RED: two assertions failed because empty `writingRequirements` validated and the schema lacked `minItems: 1`.
   - `app: npm.cmd test -- src/services/taskRubric/rubricClient.test.ts -t "empty writingRequirements"` — RED: one assertion failed because the response projected as success.
   - Generated/reviewed schemas, both Gateway trust-mode validators, and the app rubric projector now require at least one writing requirement.
4. Provider schema/runtime parity:
   - `grading-gateway: npm.cmd test -- src/multimodal/normalizeMultimodalResult.test.ts -t "unexpected nested"` — RED: 9 failed / 1 passed; unexpected keys were accepted in every tested nested structure except recognition warnings.
   - `grading-gateway: npm.cmd test -- src/multimodal/gradingPrompt.test.ts` — RED: 1 failed / 8 passed; the first missing bound was `issueKey.maxLength`.
   - `grading-gateway: npm.cmd test -- src/multimodal/normalizeMultimodalResult.test.ts -t "measures bounded identifiers"` — RED: the 201-code-unit padded identifier was accepted after trimming.
   - Staged-diff review found a remaining minima gap. `grading-gateway: npm.cmd test -- src/multimodal/gradingPrompt.test.ts -t "nonempty and numeric minima"` — RED: 1 failed / 9 skipped; `transcript.minLength` was absent, followed by the missing nonblank and score/array minima assertions.
   - A follow-up RED on the same command additionally showed the nonblank pattern absent from transcript/evidence/comment fields. Shared exact-key and limit constants now drive the Provider schema and runtime parser. Separate bounded allow-empty, nonempty, and nonblank schemas match runtime field semantics; transcript, dimension evidence, and overall comment are nonblank; only context and ignored aggregate rewrite fields allow empty; `dimensionScores` requires one item and score has minimum 0. Nested extras reject; raw length is measured before trimming; 50,000 is accepted and 50,001 rejects.
5. Required and transcript-bound full-text revision:
   - `app: npm.cmd test -- src/services/grading/projectGradingClientResponse.test.ts -t "requires fullTextRevision"` — RED: 1 failed / 49 skipped; a v2 result missing the revision projected as success.
   - Gateway/app public result types and projector now require the complete revision, and multimodal projection requires `fullTextRevision.originalText === transcript` (including confirmed mode). Mocks and fixtures were aligned.
6. Shared-range active marker:
   - `app: npm.cmd test -- src/components/EssaySourcePanel.test.tsx -t "secondary issue"` — RED: expected `data-active="true"`, received `data-active="false"`.
   - Active state now uses `marker.issueIds.includes(activeIssueId)` while clicks retain the deterministic primary `marker.issueId` and the existing layout.

### Focused GREEN evidence

```text
grading-gateway> npm.cmd test -- src/multimodal/normalizeMultimodalResult.test.ts src/multimodal/gradingPrompt.test.ts src/multimodal/rubricPrompts.test.ts src/multimodal/validateRubric.test.ts
Test Files  4 passed (4)
Tests       104 passed (104)

app> npm.cmd test -- src/services/grading/buildMultimodalGradingRequest.test.ts src/pages/CreateTaskPage.test.tsx src/services/grading/mockGradingClient.test.ts src/services/taskRubric/rubricClient.test.ts src/services/grading/projectGradingClientResponse.test.ts src/components/EssaySourcePanel.test.tsx
Test Files  6 passed (6)
Tests       95 passed (95)
```

The first full app integration run then exposed one stale remote-client fixture (`1 failed / 286 passed`); the fixture omitted the newly required revision. After aligning that fixture and the typed state-transition fixtures to the v2 contract, the focused remote-client run passed `1 file / 4 tests`.

### Final exact verification

```text
grading-gateway> npm.cmd test
Test Files  20 passed (20)
Tests       286 passed (286)

grading-gateway> npm.cmd run typecheck
> tsc --noEmit

grading-gateway> npm.cmd run verify:shared-scoring-runtime
shared scoring runtime ok

app> npm.cmd test
Test Files  45 passed (45)
Tests       287 passed (287)

app> npm.cmd run typecheck
> tsc -b

app> npm.cmd run lint
> oxlint .

app> npm.cmd run build
> tsc -b && vite build
107 modules transformed.
dist/index.html                   0.41 kB | gzip:   0.29 kB
dist/assets/index-CJx8tR0j.css   35.88 kB | gzip:   7.36 kB
dist/assets/index-D4c2xr4g.js   391.51 kB | gzip: 115.73 kB
built in 189ms
```

### Review-round self-review and deferred minor

Rechecked saved-teacher versus generated rubric trust, decimal inputs, complete confirmed mock body derivation, nonempty writing requirements, every Provider nested exact-key set and public bound, required transcript-bound revisions, and secondary same-range activation. Failures remain bounded/redacted; no essay or image content is logged. Reviewer Minor intentionally remains for controller triage: `remoteGradingClient` discards supplied pages when `confirmedTranscript` is present while the mock rejects a malformed mixed-mode request; this round did not change that behavior.
