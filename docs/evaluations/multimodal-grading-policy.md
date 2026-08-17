# Multimodal grading-policy golden evaluation

This evaluation uses four fully synthetic, anonymous handwriting fixtures. The only visible identifier is the synthetic case ID (`CASE-A01` through `CASE-A04`); all visible body content is synthetic and identifies no person. This record excludes essay text, image data, model comments, Provider raw responses, identity information, credentials, environment values, and local paths.

The command calls the production Kimi transport and production multimodal normalization/policy projection once per case at most. It does not retry. Each normalized case is evaluated independently. Console output is limited to case ID, `pass` / `fail` / `not_run`, model token, policy version, and an allowlisted failure category. Full pass exits 0, any evaluated failure exits 1, and missing local credentials exits 2.

## Offline verification

Run from `grading-gateway`:

```powershell
npm.cmd run verify:grading-policy-fixtures
npm.cmd test
npm.cmd run typecheck
```

The committed PNGs are the canonical fixtures. Offline verification checks their fixed PNG signature, 1200×700 dimensions, byte length, and SHA-256 hash without loading system fonts. The paired SVGs remain editable design sources only; cross-machine SVG re-render byte identity is not claimed or used as release evidence.

The predicates require the complete intended behavior: A01 has no deductions, findings, warnings, review reasons, revisions, or ambiguous-word narrative trace; A02 has exactly the bounded low-priority certain `enviroment` → `environment` spelling finding; A03 has exactly one local `can` / `can't` legibility finding and only the related legibility deduction while aggregate revisions remain unchanged; A04 requires the exact grounded grammar correction and exact structured logic target.

## Evaluation status

| case_id | policy_version | model | run_date | pass | failure_category |
| --- | --- | --- | --- | --- | --- |
| CASE-A01 | grading-policy-v1 | unconfigured | 2026-08-17 | not_run | not_run_missing_local_credentials |
| CASE-A02 | grading-policy-v1 | unconfigured | 2026-08-17 | not_run | not_run_missing_local_credentials |
| CASE-A03 | grading-policy-v1 | unconfigured | 2026-08-17 | not_run | not_run_missing_local_credentials |
| CASE-A04 | grading-policy-v1 | unconfigured | 2026-08-17 | not_run | not_run_missing_local_credentials |

Local ignored credentials were not detected for this run. The direct CLI emitted four sanitized `not_run_missing_local_credentials` lines, exited 2, and made zero external calls; the subprocess regression test independently verifies that boundary. This is `not_run`, not a pass. When credentials are available, run `npm.cmd run eval:grading-policy` once after the offline checks. Record only the resulting anonymous status rows here. Do not request, copy, print, or persist a key.
