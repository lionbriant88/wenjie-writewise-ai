# Whole-branch Fix C report

## Status

DONE. Findings 8 and 9 and the directly related evaluator/privacy/reproducibility minors are closed without changing the v2 wire contract, grading policy, routes, or website layout.

## RED evidence

- Baseline evaluator/fixture coverage passed 17 tests but demonstrated only shallow field-presence predicates and ambient-font re-render comparison.
- The first meaningful predicate/CLI run produced 43 expected failures and 10 passes. Failures covered A01 leakage and deductions, A02 exactness/priority/certainty, A03 local-legibility isolation, A04 exact grounding, missing-key exit semantics, and per-case independence.
- Canonical fixture verification initially failed all 7 tests because no hash/signature/dimension verifier existed.
- The rubric boundary test failed with observed weights `[50, 40, 10]` against the hand-derived product default `[55, 40, 5]`.
- Three additional exactness mutations failed for the wrong A01 transcript, wrong A03 page, and partial A04 status. A final A04 mutation proved that merely containing the expected verb was insufficient.
- Independent review found five further predicate mutations: nonempty logic notes in A01/A02/A03, an A02 unrelated-dimension deduction, and an A01 alternate-reading-only narrative trace. All five failed before the predicate tightening and pass afterward.
- The vertical integration coverage passed on first execution because Fixes A/B already implemented the behavior; this slice added missing release evidence and required no UI production change.
- The first full Gateway typecheck found one test-only environment-map inference error. Adding the explicit standard environment-map type made the rerun pass.

## Implementation

- Golden predicates now enforce the complete case-specific outcomes and use hand-derived literals after production multimodal normalization.
- Predicate fixtures are typed from the real normalized result fields, and runner coverage includes the four-pass exit-0 branch.
- Each case owns its read, single Provider invocation, normalization, assertion, and sanitized result. One failure cannot convert another normalized success into an assertion failure.
- Output status is an allowlisted `pass`, `fail`, or `not_run`; missing credentials return 2, evaluated failures return 1, and full pass returns 0.
- Direct subprocess tests capture stdout, stderr, exit status, and a local HTTP request counter. They prove four sanitized missing-key lines, empty stderr, exit 2, zero calls, and a failure path that does not reveal its injected upstream marker.
- The real vertical chain covers raw Provider payload → Gateway normalizer/policy → website projector → domain adapter → review-card/source-marker consumer. It includes three issue categories, plural relationships, teacher-review metadata, v2 full-text revision, local-legibility success without recognition review, and the real builder/client zero-page confirmed-text boundary.
- Committed PNGs are canonical. Verification uses fixed signature, 1200×700 dimensions, length, and SHA-256; the ambient-font renderer dependency and byte-identity claim were removed. SVGs remain non-authoritative design sources.

## Verification

- `npm.cmd test -- scripts/runPolicyGoldenEval.test.ts scripts/verifyPolicyGoldenFixtures.test.ts`: 2 files, 74 tests passed.
- `npm.cmd test -- src/services/grading/gatewayContract.test.ts`: 1 file, 3 tests passed.
- Gateway `npm.cmd test`: 20 files, 343 tests passed.
- Gateway `npm.cmd run typecheck`: passed after the test-only typing correction noted above.
- Gateway `npm.cmd run verify:shared-scoring-runtime`: `shared scoring runtime ok`.
- Gateway `npm.cmd run verify:grading-policy-fixtures`: exit 0 with no renderer or font dependency.
- Website `npm.cmd test`: 45 files, 289 tests passed.
- Website `npm.cmd run typecheck`: passed.
- Website `npm.cmd run lint`: passed.
- Website `npm.cmd run build`: 107 modules transformed; production build passed.
- `git diff --check`: passed.

## Evaluator outcome and privacy review

- Key presence was checked without printing its value. No local credential was present.
- The direct evaluator emitted exactly four allowlisted `not_run_missing_local_credentials` case lines and its captured exit code was 2. No real Provider evaluation ran; external call count was zero. This outcome is recorded as `not_run`, not pass.
- The evaluator and this report contain no essay/transcript, image data, raw Provider response, credential, environment dump, exception text, or absolute local path.
- Fixtures contain only synthetic body content. Their sole visible identifier is the synthetic case ID.

## Self-review

- A01: checked success, exact synthetic fixture transcript, zero findings/warnings/review/revision output, full dimension scores, unchanged aggregate revisions, and no ambiguous-word score or narrative trace.
- A02: checked exactly one bounded, certain, low-priority, non-review spelling finding with the exact correction, with no unrelated issue, logic, legibility, recognition, or review output.
- A03: checked success, one page-local two-reading legibility issue, exact default outcome, related below-max legibility evidence, max non-legibility dimensions, no recognition/review/overlapping structured output, and unchanged aggregate revisions.
- A04: checked success and the exact grounded grammar correction plus exact structured logic target; arbitrary objects and unrelated corrections fail.
- Privacy mutation review covers malicious metadata tokens, configuration/read/Provider failures, missing credentials, raw upstream failure bodies, and one-line output framing.
- Independent review reported no Critical findings. All Important predicate findings were corrected; its report-staging reminder is handled in the final commit.

## Non-blocking note

The lockfile refresh reported two existing dependency advisories (one moderate and one high). No broad dependency upgrade or automated audit fix was performed because it is outside Fix C scope.
