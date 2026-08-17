# Whole-branch final fix report

Date: 2026-08-17

Base: `83fbe2a`

Outcome: all eight Important findings and all three concrete Minors are implemented. The public request/result field sets, `/grading/grade-images` route, website layout, conservative spelling behavior, local-legibility isolation, teacher-confirmed zero-image regrade, evaluator privacy, and atomic-deployment rule are unchanged.

## Finding evidence

1. **Filtered-spelling warning leakage:** RED reproduced an explicitly linked recognition warning surviving policy, while benign positive prose and an independent global warning were controls. A later cue-coverage mutation also reproduced an unreadability wording leak. GREEN uses cue-aware bounded terms, includes legibility prose in contamination checks, rejects explicitly linked warnings, and preserves independent warnings.
2. **Bare legibility substrings:** RED showed a short local quote rejecting ordinary positive prose and a longer word containing that quote. GREEN uses a shared bounded-term/readability-cue helper; explicit local-readability prose rejects, while ordinary linguistic usage passes in Gateway and browser validation.
3. **Distinct readings:** RED produced six failures across schema/runtime/policy coverage, including exact, trimmed, and NFC-equivalent duplicates. GREEN adds schema `uniqueItems` plus trim+NFC uniqueness in Gateway and the public projector, preserving the 2–4 limit.
4. **Unified language+logic IDs:** RED Gateway normalization rejected a valid logic-linked revision/pair. GREEN validates unique source keys across language+logic, assigns stable public IDs before link projection, accepts logic-only and mixed links through Gateway → website → adapter, and rejects unknown, legibility, filtered, and cross-namespace collisions.
5. **Website semantic parity:** RED projector mutations produced 13 failures (56 controls passed), covering grounding, UTF-16, rubric drift, logic order, overlap/reconstruction, unified links, page mode, reasons, and status. An additional RED proved local-legibility narrative isolation was absent. GREEN binds projection to the submitted task and mode and reuses browser-safe helpers for exact unique ranges, ordered context, non-overlap, reconstruction, reading uniqueness, bounded local narratives, and stable review-reason constants.
6. **Nested markers:** RED had two failures because the inner interval disappeared. GREEN segments on all interval boundaries, retains every covering ID, chooses one click owner by severity then input order, and renders flat sibling buttons. Both outer and inner selection activate the correct segments.
7. **Legacy conversion:** RED had five failures for dropped semantics and whitespace-only optionals. GREEN provides one documented stable trim/dedupe map for practical and continuation tasks, falls back from blank teacher requirements, keeps positive excellence criteria out of hard constraints, and preserves only the existing 95%+5% compatibility weighting.
8. **Multer:** RED on `multer@1.4.5-lts.2` timed out on an aborted upload. GREEN on exact `multer@2.2.0` and `@types/multer@2.2.0` settles once; multipart count/size/malformed/abort/error and redaction tests pass. Manifest/lock changes contain only the requested packages and their required transitive graph; no audit fix was run.

## Minor evidence

- Remote and mock call one shared request-mode validator before configuration/fetch/work; mixed confirmed-text+image input rejects instead of being rewritten.
- App builder/client and Gateway metadata preflight reject either lone UTF-16 surrogate before fetch/Provider invocation; a valid astral pair passes.
- `docs/current_development_status.md` marks the old v1 `/grading/grade`/DeepSeek section historical, preserves the v2 evaluator/atomic notes, and records the deterministic legacy map.

## TDD and focused verification

- Initial policy/schema/runtime RED: 3 files, 130 tests, 6 failed / 124 passed. Final policy slice, including the corrected unmasked legibility fixture and readability-cue mutation: GREEN.
- Unified-ID RED: 1 failed / 37 passed. Projector semantic RED: 13 failed / 56 passed. Marker RED: 2 failed. Legacy RED: 5 failed. Request RED: app 6 failed / 27 passed; Gateway 1 failed / 14 passed. Multer 1.x abort RED: 1 timeout failure.
- Final focused app: `npm.cmd test -- <8 changed suites> --reporter=dot` → 8 files, 122/122.
- Final focused Gateway: `npm.cmd test -- <7 changed suites> --reporter=dot` → 7 files, 196/196.

## Complete verification

- Gateway `npm.cmd test -- --reporter=dot` → 20 files, 388/388.
- Gateway `npm.cmd run typecheck` → pass.
- Gateway `npm.cmd run verify:shared-scoring-runtime` → `shared scoring runtime ok`.
- Gateway `npm.cmd run verify:grading-policy-fixtures` → pass.
- App `npm.cmd test -- --reporter=dot` → 46 files, 321/321. Existing `ProgressPage` React `act(...)` warnings remain non-failing and were present before this wave.
- App `npm.cmd run typecheck`, `npm.cmd run lint`, and `npm.cmd run build` → pass; production build transformed 110 modules.
- `npm.cmd ls multer @types/multer --depth=0` → `multer@2.2.0`, `@types/multer@2.2.0`.
- `git diff --check` → pass (Git emitted only repository line-ending notices).

## Production audit evidence and residual concern

`npm.cmd audit --omit=dev` was run once but the sandbox blocked the npm advisory endpoint:

```text
npm warn audit request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed, reason: connect EACCES 198.18.0.26:443
undefined
npm error audit endpoint returned an error
```

The request to rerun outside the sandbox was denied because it would upload the production dependency graph; it was not retried or bypassed. The install command reported two all-dependency findings (one moderate, one high), which is not a production-only result. Therefore the exact installed versions and multipart behavior are verified, but a successful current production-audit result remains an environment/authorization concern.

## Self-review

- Cross-layer parity: Gateway and browser share UTF-16/range/overlap/reconstruction, bounded local-reference, normalized-reading, and review-reason primitives; browser imports no server/provider module.
- Privacy: failures remain allowlisted and do not return essay content, image bytes, raw Provider data, local paths, environment values, credentials, or stack/parser details. New reports and tests use synthetic content only.
- Wire/layout/deployment: no v2 field, route, or page-layout change; teacher-confirmed mode remains zero-image; the atomic website+Gateway deployment warning remains explicit.
