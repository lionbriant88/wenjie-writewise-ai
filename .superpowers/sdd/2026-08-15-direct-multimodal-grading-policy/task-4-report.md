# Task 4 report — Normalize structured logic and important handwriting ambiguity

## TDD record

### RED

Added normalizer contract coverage for:

- projection of a grounded structured logic issue into `fullTextRevision.logicIssues` with the stable `essayId-logic-N` ID;
- rejection when a logic issue's `originalText`, `contextBefore`, or `contextAfter` is not uniquely grounded in the transcript;
- a local important handwriting ambiguity with a stable `essayId-legibility-N` ID, fixed `count_as_legibility_error` outcome, no `recognition_uncertain`, and no overlapping grammar, spelling, or logic output;
- rejection of an image-mode legibility page number beyond the uploaded page count and of any legibility item in confirmed-transcript mode.

Ran before implementation:

```powershell
npm.cmd test -- src/multimodal/normalizeMultimodalResult.test.ts src/server.test.ts
```

Result: **RED** — the six new normalizer contracts failed because structured logic and legibility were parsed but not projected or bounded. The five known server-boundary fixtures also failed with HTTP 400 because they still used `transcriptionWarnings` and one-dimension rubrics.

### GREEN implementation

- Extended the public result contract so `fullTextRevision` contains `logicIssues` and each result has top-level `legibilityIssues`.
- Added strict unique transcript grounding for structured logic original/context fields, image `pageCount` validation, and confirmed-text rejection of all legibility findings.
- Projects retained policy logic issues and raw legibility items with stable IDs. Local legibility alone remains `success`; only global `recognitionWarnings`, printed-text boundary uncertainty, or unmatched evidence make the result partial.
- Removes every grammar/spelling issue, linked revision/pair, logic issue, and logic note that overlaps a local legibility quote. A non-legibility rubric dimension attempting to cite that quote safely fails normalization, preserving the rule that only the `legibility` dimension may deduct for it.
- Passed `pages.length` from the server to the normalizer for image-mode bounds.
- Migrated the owned server fixtures to the strict Provider shape (`recognitionWarnings`, `logicIssues`, `legibilityIssues`) and valid 95/5 content/legibility rubrics. Migrated the remaining Kimi rubric fixture to the same required rubric contract.
- Added empty structured findings in the generic result normalizer so the public type remains complete for text-only grading paths.

## Verification

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run verify:shared-scoring-runtime
git diff --check
```

Result: **PASS** — Gateway tests: 17 files, 187 tests; TypeScript typecheck exited 0; shared scoring runtime reported `ok`; diff check exited 0.

## Commit

`feat: normalize logic and legibility findings`
