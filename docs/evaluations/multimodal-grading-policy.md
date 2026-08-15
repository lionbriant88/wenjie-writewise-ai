# Multimodal grading-policy golden evaluation

This evaluation uses four fully synthetic, anonymous handwriting fixtures. The fixture images display only their case IDs; this record excludes essay text, image data, model comments, Provider raw responses, identity information, and credentials.

The command calls the production Kimi transport and production multimodal normalization/policy projection once per case at most. It does not retry. Its console output is limited to case ID, pass/fail, model, policy version, and a short failure category.

## Offline verification

Run from `grading-gateway`:

```powershell
npm.cmd run render:grading-policy-fixtures
npm.cmd test
npm.cmd run typecheck
```

`render:grading-policy-fixtures` uses the locked `@resvg/resvg-js` renderer. The offline test suite verifies each committed PNG is byte-identical to rendering its paired SVG.

## Evaluation status

| case_id | policy_version | model | run_date | pass | failure_category |
| --- | --- | --- | --- | --- | --- |
| CASE-A01 | grading-policy-v1 | k3 | 2026-08-15 | not_run | not_run_missing_local_credentials |
| CASE-A02 | grading-policy-v1 | k3 | 2026-08-15 | not_run | not_run_missing_local_credentials |
| CASE-A03 | grading-policy-v1 | k3 | 2026-08-15 | not_run | not_run_missing_local_credentials |
| CASE-A04 | grading-policy-v1 | k3 | 2026-08-15 | not_run | not_run_missing_local_credentials |

Local ignored credentials were not detected for this run, so no Provider request was made. When credentials are available, run `npm.cmd run eval:grading-policy` once after the offline checks. Record only the resulting anonymous status rows here. Do not request, copy, print, or persist a key.
