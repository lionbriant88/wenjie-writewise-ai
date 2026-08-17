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
