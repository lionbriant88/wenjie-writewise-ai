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
