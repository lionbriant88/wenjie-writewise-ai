# Whole-branch fix A report

## Scope

Implemented the Gateway-only grading-policy contamination fix from `whole-branch-fix-a-brief.md`. No website route, layout, result-version, or UI behavior was changed. The only app change is migration of the cross-boundary synthetic contract fixture to the new Provider-only dimension relationship contract.

## RED evidence

Before production changes, the focused command

```text
npm test -- src/multimodal/normalizeMultimodalResult.test.ts src/normalizeGradingResult.test.ts src/multimodal/gradingPrompt.test.ts src/promptBuilder.test.ts
```

reported 15 expected failures and 72 passes. The failures reproduced both reviewed unsafe-success classes:

- a filtered `wark -> work` spelling issue could leave a lower language score and still return success;
- a single original or suggestion mention could leak because the old scan required both strings;
- Provider `improvedText` and an overlapping expression upgrade survived filtering;
- `can` inside `I can come.` was not treated as an intersecting legibility range;
- full legibility score, missing legibility relation, and a non-legibility relation were accepted;
- ungrounded, whitespace-folded, and non-unique dimension evidence was accepted or merely marked partial;
- the Provider schema and prompt did not require dimension `relatedIssueKeys` or local/global ambiguity separation.

The prompt test initially had one fixture error (`pages` was undefined). After correcting only that fixture, the prompt test still failed for the two intended missing contracts. A later self-review RED run added local/global narrative isolation: 1 expected failure and 47 passes before the extra defense was implemented.

## Implementation

- Added one shared exact unique `[start,end)` transcript-range utility and one overlap predicate. Strict quote grounding, generic logic context, multimodal logic context, policy filtering, evidence validation, and aggregate reconstruction now use the same exact semantics.
- Extended the Provider-only dimension contract with bounded, unique `relatedIssueKeys`. Every key must exist in the raw language, logic, or legibility issue set. Maximum scores require no keys; deductions require at least one key.
- Moved raw dimension scores/relationships, expression upgrades, recognition warnings, and all structured diagnostics into the shared policy boundary before filtering.
- Unified uncertain-spelling and local-legibility contamination around exact ranges plus raw issue keys. Intersecting issues, logic issues/notes, revisions, pairs, and expression upgrades are removed. A dimension related to a removed or filtered key is rejected because its score cannot be safely restored.
- Rejects any surviving filtered-spelling narrative containing either the original or suggestion. Also rejects a local legibility quote repeated in non-legibility narratives or recognition warnings while allowing an independent global warning to produce partial status.
- Requires dimension evidence to be an exact, unique transcript quote. Non-legibility evidence cannot intersect a legibility range.
- Requires every local legibility finding to have a below-maximum `legibility` score related to its key; non-legibility dimensions cannot cite or relate to the range.
- Rebuilds both `correctedText` and `improvedText` independently from retained, uniquely grounded, non-overlapping sentence pairs. Provider aggregate strings are never projected.
- Updated multimodal schema/prompt, generic prompt/type, mock Provider, server fixtures, and app Gateway contract fixtures consistently.
- Reworded image grading instructions so localizable ambiguity belongs only in `legibilityIssues`; only global, unlocalizable, or printed/student-boundary uncertainty may use recognition warnings.

## Verification

Fresh final verification:

```text
Gateway focused: 5 files passed, 114 tests passed
Gateway full: 19 files passed, 239 tests passed
Gateway typecheck: tsc --noEmit passed
Shared scoring runtime: shared scoring runtime ok
App full: 45 files passed, 287 tests passed
App typecheck: tsc -b passed
git diff --check: passed (only Git line-ending notices)
```

## Self-review

- Confirmed both generic and multimodal active normalizers call the same policy with raw dimension relationships before projection.
- Confirmed public `AiGradingResultV1` remains unchanged; `relatedIssueKeys` is Provider-only.
- Confirmed no score is repaired or increased after filtering. Unsafe deductions reject with `provider_invalid_response`.
- Confirmed local legibility alone remains success with no `recognition_uncertain`, while a separate global warning remains partial.
- Confirmed Provider corrected/improved aggregates are required only as schema fields and are not trusted as output content.
- Confirmed no website route, version, layout, or UI production file changed.
- Confirmed the diff contains no whitespace errors or raw Provider/transcript leakage in failure payloads.

## Review fix round 1 (2026-08-16)

### RED evidence

The six-file focused regression run first reported 24 expected failures and 114 passes. It reproduced both dimension overwrite orders, logic-context contamination, lone-surrogate acceptance, half-surrogate quote matching, filtered-spelling narrative false negatives and false positives, legacy/unscoped warning acceptance, and mock rounded-full-score key mismatch. A later direct-policy scope test reported 1 expected failure and 32 passes before policy-level scope validation was added.

### Implementation

- Both normalizers now require the raw dimension array length to equal the rubric dimension count and reject every duplicate, unknown, or missing ID with a seen set before constructing a raw score map.
- Logic issue `originalText`, non-empty `contextBefore`, and non-empty `contextAfter` each receive exact unique ranges. Ordering/non-overlap is enforced, contamination of any range removes the entire logic issue, and its removed key cascades through linked revisions, pairs, and dimension validation.
- The shared transcript-range utility rejects ill-formed UTF-16 in either transcript or quote. A quote cannot select half of a surrogate pair; astral symbols retain complete UTF-16 `[start,end)` ranges for overlap and uniqueness checks.
- Filtered-spelling narrative defense is centralized over every retained projectable feedback field. It rejects an explicit original reference or an original-plus-suggestion correction in one field, while no longer rejecting a common suggestion or common original used as ordinary evaluation text. Exact raw keys and source ranges remain the primary relationship model.
- Provider-only recognition warnings are strict `{ scope, message }` objects with only `global_unreadable` and `printed_boundary` scopes. Schema and runtime reject legacy strings, local scopes, extra relationship fields, oversized/empty messages, and extra properties. The public response still projects messages as `string[]`; recognition messages are no longer scanned as local legibility text.
- Mock dimension scores are rounded first, then receive an empty relationship list when the rounded score equals that dimension's maximum.

### Verification

Fresh verification after the review fixes:

```text
Gateway focused: 6 files passed, 139 tests passed
Gateway full: 20 files passed, 264 tests passed
Gateway typecheck: tsc --noEmit passed
Shared scoring runtime: shared scoring runtime ok
App full: 45 files passed, 287 tests passed
App typecheck: tsc -b passed
git diff --check: passed (only Git line-ending notices)
```

### Self-review

- Confirmed duplicate raw dimensions cannot hide a filtered spelling deduction or replace the legibility dimension in either array order.
- Confirmed filtered deductions remain invalid; no score is restored or increased after filtering.
- Confirmed the Provider aggregate corrected/improved strings remain untrusted and both outputs are rebuilt solely from retained structured pairs.
- Confirmed scoped global warning text may contain ordinary English substrings such as `can` without colliding with a local legibility range, while no Provider-local warning representation exists.
- Confirmed no website version, route, layout, or UI production code changed in this round.

## Review fix round 2 (2026-08-16)

### RED evidence

Before the production change, the focused policy test reported 1 expected failure and 34 passes. It reproduced the remaining bypass: a filtered `wark -> work` spelling item with the bare projectable overall comment `wark` returned a successful policy outcome because the predicate required a suggestion or a correction cue in addition to the original token.

### Implementation

- The shared filtered-spelling narrative predicate now rejects an exact whole-token occurrence of the filtered original by itself. A suggestion remains allowed when used naturally, but a suggestion paired with a correction cue remains rejected.
- Added regression coverage for the original-plus-cue gate (`wark`) and for a benign suggestion-only phrase (`Good work overall.`). Updated the prior common-original assertion to match the binding policy: an exact original token is always contamination, even when it is an ordinary English word.

### Verification

```text
RED focused policy: 1 failed, 34 passed (expected bare-original failure)
GREEN focused policy: 1 file passed, 35 tests passed
Gateway focused: 6 files passed, 140 tests passed
Gateway full: 20 files passed, 266 tests passed
Gateway typecheck: tsc --noEmit passed
Shared scoring runtime: shared scoring runtime ok
```

### Self-review

- The existing `containsTerm` helper still enforces word/token boundaries, so `work` does not match an embedded substring such as `workbook`.
- Confirmed the predicate remains applied to the complete retained projectable narrative list: dimension reason/evidence, overall comment, language/logic/revision/pair/upgrade text, and logic notes. The existing range/key defenses and aggregate reconstruction were not changed.
- No public result contract changed, so app tests were not required for this Gateway-only correction.
