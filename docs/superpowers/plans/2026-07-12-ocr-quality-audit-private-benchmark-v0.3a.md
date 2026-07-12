# OCR Quality Audit and Private Benchmark v0.3a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an invisible, versioned OCR transcript audit lifecycle and a one-shot private PaddleOCR benchmark that produces anonymous quality metrics without changing the teacher UI, confirmation flow, queue behavior, OCR Provider, or machine-wide environment.

**Architecture:** The frontend captures the final unified text delivered to `UploadPage` by the existing OCR Client as `sourceText`, keeps teacher-confirmed faithful transcription in `confirmedTranscript`, and preserves `ocrText` as the downstream compatibility field. Provider-independent pure functions under `app/src/services/ocr/audit/` own all edit distance, CER, WER, and shadow assessment logic. A one-shot TypeScript benchmark under `ocr-gateway/scripts/` constructs the existing `NodePaddleRunner` and `PaddleLocalOcrProvider` directly, reaches `normalizeProviderResult` through the production Provider path, reads only an explicitly user-run ignored private sample directory, writes only anonymous results to an ignored private results directory, never starts port 8787, and exits with a fixed code.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest 4, React Testing Library, Node.js, `tsx`, existing OCR Gateway Provider interfaces, `NodePaddleRunner`, `PaddleLocalOcrProvider`, Node `fs/promises`, Unicode-aware Levenshtein distance.

## Global Constraints

- Implement the confirmed design in `docs/superpowers/specs/2026-07-12-ocr-quality-audit-private-benchmark-v0.3a-design.md` without widening scope.
- `sourceText` means exactly: the final unified text that the existing frontend OCR Client hands to `UploadPage`, before any teacher edit. It is not PaddleOCR raw text, Python stdout, or unnormalized Provider output.
- `OcrTranscriptAudit.auditVersion` is fixed to `ocr-audit-v1`.
- `OcrShadowAssessment.assessmentVersion` is fixed to `ocr-shadow-v1`.
- Text metrics use `ocr-text-metrics-v1` and the exact projection, edit distance, CER, and WER rules from the design.
- `assessOcrShadow` must receive `expectedPageIds` and detect missing pages by `pageId` set difference, never by array length alone.
- `assessedAt` and `confirmedAt` are required injected ISO strings in pure functions; audit functions must never call `Date` internally.
- Runtime text length must never be labeled as a missing line. Only manual comparison with a faithful benchmark reference can confirm missing lines.
- All metric calculations live in Provider-independent pure function services. `UploadPage` and benchmark orchestration must import them and must not duplicate their algorithms.
- Shadow assessment is invisible: no card, badge, tooltip, text, filter, automatic pass, automatic block, or queue behavior change.
- Preserve the existing mock, real, failure fallback, teacher confirmation, and queue-entry behavior.
- Do not add `normalizedText`, automatic hyphen merging, character-level `correctionEvents`, AI OCR, another Provider, PaddleOCR tuning, or real AI grading.
- The benchmark must not start Express or listen on 8787. It must instantiate the current `NodePaddleRunner` and `PaddleLocalOcrProvider`; `normalizeProviderResult` must be reached inside the Provider.
- Benchmark exit codes are fixed: `0` = every sample completed without sample failure; `1` = command-level fatal failure; `2` = the run completed but at least one sample failed.
- `partial` is a completed OCR sample and does not by itself cause exit code 2. An unreadable sample, invalid sample manifest/reference, or Provider result with `status: 'failed'` is a sample failure and causes exit code 2 after remaining samples are processed.
- Real private samples live only in ignored `ocr-gateway/local-private-samples/` and use anonymous `sampleId` values matching `sample-<3 or 4 digits>`.
- Anonymous result files live only in ignored `ocr-gateway/local-private-results/`.
- Results and logs must not contain essay text, reference text, text snippets, local absolute paths, original identity-bearing filenames, environment values, Python tracebacks, or student identity information.
- Codex must not list, inspect, read, summarize, or run the benchmark against `local-private-samples/` unless the user explicitly names that directory and authorizes that exact access in a later request.
- Automated tests use synthetic fixture content and fake runners only. `npm test` must not require Python or PaddleOCR.
- Do not install global packages, modify machine `PATH`, persist user/system environment variables, create services, or create scheduled tasks.
- Stage files by explicit path. Do not use `git add .`, `git add -A`, or automatic push.

## OCR Source Lifecycle Truth Table

| Scenario | Final `sourceKind` | Final `sourceText` | Shadow outcome | `confirmedTranscript` at confirmation | `ocrText` after confirmation | Earlier attempt retained? |
| --- | --- | --- | --- | --- | --- | --- |
| Mock OCR success | `mock` | Final mock OCR Client result handed to UploadPage | `insufficient_evidence` | Current teacher-edited draft | Same as `confirmedTranscript` | No |
| Remote OCR success | `remote` | Final remote OCR Client result handed to UploadPage | `no_obvious_risk` or `review_recommended` from structural signals | Current teacher-edited draft | Same as `confirmedTranscript` | No |
| Manual input without successful OCR | `manual` | Empty string | `insufficient_evidence` | Current manual textarea content | Same as `confirmedTranscript` | No |
| Remote failure then mock fallback | `mock` | Mock fallback result handed to UploadPage | `insufficient_evidence` | Current teacher-edited fallback draft | Same as `confirmedTranscript` | Failed remote text/result not retained in final Essay audit |
| Remote failure then manual fallback | `manual` | Empty string | `insufficient_evidence` | Current manual textarea content | Same as `confirmedTranscript` | Failed remote text/result not retained in final Essay audit |
| Remote partial result | `remote` | Final partial unified text handed to UploadPage | `review_recommended` | Current teacher-edited draft if existing confirm rules allow confirmation | Same as `confirmedTranscript` | No |
| Remote success, then another successful retry | `remote` | Result from the latest applied retry | Recomputed from latest result and latest expected page IDs | Draft derived from latest retry, then teacher-edited | Same as `confirmedTranscript` | Previous successful result not retained |
| Remote success, then failed retry | No confirmable source until fallback/manual/new success | No earlier result may be silently reused | Failure behavior remains current UI behavior | Set only after fallback/manual/new success | Set only on final confirmation | Previous success not retained |
| Multiple sequential retries | Kind of latest applied confirmable path | Text from latest applied confirmable path | Recomputed each time with a new injected `assessedAt` | Current final draft | Same as `confirmedTranscript` | No run history in v0.3a |

The table is normative. Implementation tests must cover every row that can be reached through the current UI.

---

## File Structure

- Create: `app/src/services/ocr/audit/textMetrics.ts`
  Owns the metric comparison projection, Unicode code-point Levenshtein implementation, deterministic backtrace, review edit metrics, CER, and WER. It has no React, DOM, Vite, Gateway, or Provider imports.

- Create: `app/src/services/ocr/audit/textMetrics.test.ts`
  Covers the fixed `ocr-text-metrics-v1` contract with synthetic strings.

- Create: `app/src/services/ocr/audit/types.ts`
  Defines version literals, source kinds, shadow reasons/outcomes, pending audit, final audit, and review outcome types.

- Create: `app/src/services/ocr/audit/assessOcrShadow.ts`
  Computes invisible structural assessment from unified `OcrEssayResult`, explicit `expectedPageIds`, source kind, and injected `assessedAt`.

- Create: `app/src/services/ocr/audit/assessOcrShadow.test.ts`
  Covers page-ID set comparison, partial/failed/empty behavior, confidence observation, hyphen observation, mock/manual handling, and fixed time.

- Create: `app/src/services/ocr/audit/transcriptAudit.ts`
  Creates pending audit records and confirms them using the shared text metric service and injected timestamps.

- Create: `app/src/services/ocr/audit/transcriptAudit.test.ts`
  Covers source immutability, confirmation, later faithful correction, fixed timestamps, and the lifecycle truth table independent of UI.

- Modify: `app/src/types/index.ts`
  Adds optional `ocrAudit` to `Essay` while preserving `ocrText`.

- Modify: `app/src/context/appStateContextValue.ts`
  Extends OCR confirmation input with a completed audit and allows later OCR text updates to carry an injected `confirmedAt`.

- Modify: `app/src/context/AppStateContext.tsx`
  Persists the audit in React memory state, keeps `ocrText` synchronized with `confirmedTranscript`, and never modifies `sourceText`.

- Create: `app/src/context/AppStateContext.test.tsx`
  Uses synthetic data to verify state lifecycle and injected confirmation time.

- Modify: `app/src/pages/UploadPage.tsx`
  Tracks a pending audit beside each OCR draft, replaces it on retry/fallback/manual selection, passes explicit expected page IDs into shadow assessment, and confirms the final audit without rendering it.

- Modify: `app/src/pages/UploadPage.test.tsx`
  Covers mock, remote, manual, fallback, partial, retry, source replacement, unchanged visible UI, and unchanged queue entry.

- Create: `ocr-gateway/scripts/privateOcrBenchmark/types.ts`
  Defines private manifest input and anonymous output types without text fields.

- Create: `ocr-gateway/scripts/privateOcrBenchmark/benchmark.ts`
  Reads explicitly supplied private sample entries, calls an injected production-compatible Provider, imports shared pure text metrics, and returns anonymous sample summaries.

- Create: `ocr-gateway/scripts/privateOcrBenchmark/benchmark.test.ts`
  Uses synthetic temporary fixtures and a `PaddleLocalOcrProvider` with a fake runner; it never reads `local-private-samples/`.

- Create: `ocr-gateway/scripts/privateOcrBenchmark/cli.ts`
  Uses fixed ignored directories, constructs `NodePaddleRunner` and `PaddleLocalOcrProvider`, writes anonymous results, maps exit codes, and never starts HTTP.

- Create: `ocr-gateway/scripts/privateOcrBenchmark/cli.test.ts`
  Covers exit codes, fixed output directory, fatal vs sample failure, sanitized logs, and no-listen behavior with synthetic dependencies.

- Modify: `ocr-gateway/tsconfig.json`
  Includes `scripts/**/*.ts` and the imported frontend pure metric module so `npm run typecheck` validates benchmark TypeScript.

- Modify: `ocr-gateway/package.json`
  Adds `benchmark:private` and `test:benchmark` scripts without adding dependencies.

- Modify: `.gitignore`
  Explicitly ignores `local-private-samples/` and `local-private-results/`.

- Modify: `docs/ocr_provider_evaluation_paddle_v02.md`
  Documents only anonymous metrics and the v0.3a decision boundary.

- Modify: `docs/current_development_status.md`
  Records implementation and verification only after all tasks pass.

---

### Task 1: Add Versioned Provider-Independent Text Metrics

**Files:**
- Create: `app/src/services/ocr/audit/textMetrics.ts`
- Create: `app/src/services/ocr/audit/textMetrics.test.ts`

**Interfaces:**
- Produces: `OCR_TEXT_METRICS_VERSION`, `toMetricProjection`, `calculateReviewTextMetrics`, `calculateBenchmarkMetrics`.
- Consumes: no project modules; standard JavaScript string and array APIs only.

- [ ] **Step 1: Write failing metric contract tests**

Create `app/src/services/ocr/audit/textMetrics.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  OCR_TEXT_METRICS_VERSION,
  calculateBenchmarkMetrics,
  calculateReviewTextMetrics,
  toMetricProjection,
} from './textMetrics'

describe('OCR text metrics v1', () => {
  it('uses the fixed comparison projection without correcting student language', () => {
    expect(toMetricProjection('  i  think\r\n\r\n\r\nIt\tis useful.  ')).toBe('i think\n\nIt is useful.')
    expect(toMetricProjection('pur-\npose')).toBe('pur-\npose')
  })

  it('counts Unicode code points with deterministic unit-cost edits', () => {
    expect(calculateReviewTextMetrics('a😀c', 'a😃c', '2026-07-12T00:00:00.000Z')).toEqual({
      metricsVersion: OCR_TEXT_METRICS_VERSION,
      actualTeacherAction: 'confirmed_after_edit',
      editDistance: 1,
      changedCharacterCount: 1,
      confirmedAt: '2026-07-12T00:00:00.000Z',
    })
  })

  it('preserves case, punctuation, hyphens, and line breaks in CER and WER', () => {
    const result = calculateBenchmarkMetrics('Hello, pur-\npose', 'hello purpose')

    expect(result.metricsVersion).toBe(OCR_TEXT_METRICS_VERSION)
    expect(result.cer).not.toBe(0)
    expect(result.wer).toBe(1.5)
    expect(result.invalidReason).toBeUndefined()
  })

  it('returns null CER and WER for an empty reference', () => {
    expect(calculateBenchmarkMetrics('extra', '')).toEqual({
      metricsVersion: OCR_TEXT_METRICS_VERSION,
      cer: null,
      wer: null,
      invalidReason: 'empty_reference',
    })
  })

  it('does not clamp CER or WER to one', () => {
    const result = calculateBenchmarkMetrics('a b c d', 'a')
    expect(result.cer).toBeGreaterThan(1)
    expect(result.wer).toBeGreaterThan(1)
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/services/ocr/audit/textMetrics.test.ts
```

Expected: FAIL because `textMetrics.ts` does not exist.

- [ ] **Step 3: Implement the fixed projection and metric functions**

Create `app/src/services/ocr/audit/textMetrics.ts` with these public contracts and the complete deterministic algorithm:

```ts
export const OCR_TEXT_METRICS_VERSION = 'ocr-text-metrics-v1' as const

export type OcrTextMetricsVersion = typeof OCR_TEXT_METRICS_VERSION

export interface OcrReviewTextMetrics {
  metricsVersion: OcrTextMetricsVersion
  actualTeacherAction: 'confirmed_without_edit' | 'confirmed_after_edit'
  editDistance: number
  changedCharacterCount: number
  confirmedAt: string
}

export interface OcrBenchmarkMetrics {
  metricsVersion: OcrTextMetricsVersion
  cer: number | null
  wer: number | null
  invalidReason?: 'empty_reference'
}

interface EditBreakdown {
  distance: number
  insertions: number
  deletions: number
  substitutions: number
}

export function toMetricProjection(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\u00a0]/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function calculateEditBreakdown<T>(source: readonly T[], target: readonly T[]): EditBreakdown {
  const rows = source.length + 1
  const columns = target.length + 1
  const costs = Array.from({ length: rows }, () => Array<number>(columns).fill(0))

  for (let row = 1; row < rows; row += 1) costs[row][0] = row
  for (let column = 1; column < columns; column += 1) costs[0][column] = column

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const substitutionCost = Object.is(source[row - 1], target[column - 1]) ? 0 : 1
      costs[row][column] = Math.min(
        costs[row - 1][column] + 1,
        costs[row][column - 1] + 1,
        costs[row - 1][column - 1] + substitutionCost,
      )
    }
  }

  let row = source.length
  let column = target.length
  let insertions = 0
  let deletions = 0
  let substitutions = 0

  while (row > 0 || column > 0) {
    if (
      row > 0 &&
      column > 0 &&
      Object.is(source[row - 1], target[column - 1]) &&
      costs[row][column] === costs[row - 1][column - 1]
    ) {
      row -= 1
      column -= 1
      continue
    }

    if (row > 0 && column > 0 && costs[row][column] === costs[row - 1][column - 1] + 1) {
      substitutions += 1
      row -= 1
      column -= 1
      continue
    }

    if (row > 0 && costs[row][column] === costs[row - 1][column] + 1) {
      deletions += 1
      row -= 1
      continue
    }

    insertions += 1
    column -= 1
  }

  return {
    distance: costs[source.length][target.length],
    insertions,
    deletions,
    substitutions,
  }
}

function codePoints(text: string): string[] {
  return Array.from(text)
}

function wordTokens(text: string): string[] {
  return text.length === 0 ? [] : text.split(/\s+/u)
}

export function calculateReviewTextMetrics(
  sourceText: string,
  confirmedTranscript: string,
  confirmedAt: string,
): OcrReviewTextMetrics {
  const source = codePoints(toMetricProjection(sourceText))
  const confirmed = codePoints(toMetricProjection(confirmedTranscript))
  const edits = calculateEditBreakdown(source, confirmed)

  return {
    metricsVersion: OCR_TEXT_METRICS_VERSION,
    actualTeacherAction: edits.distance === 0 ? 'confirmed_without_edit' : 'confirmed_after_edit',
    editDistance: edits.distance,
    changedCharacterCount: edits.insertions + edits.deletions + edits.substitutions,
    confirmedAt,
  }
}

export function calculateBenchmarkMetrics(ocrText: string, referenceText: string): OcrBenchmarkMetrics {
  const ocrProjection = toMetricProjection(ocrText)
  const referenceProjection = toMetricProjection(referenceText)
  const referenceCharacters = codePoints(referenceProjection)
  const referenceWords = wordTokens(referenceProjection)

  if (referenceCharacters.length === 0 || referenceWords.length === 0) {
    return {
      metricsVersion: OCR_TEXT_METRICS_VERSION,
      cer: null,
      wer: null,
      invalidReason: 'empty_reference',
    }
  }

  const characterEdits = calculateEditBreakdown(codePoints(ocrProjection), referenceCharacters)
  const wordEdits = calculateEditBreakdown(wordTokens(ocrProjection), referenceWords)

  return {
    metricsVersion: OCR_TEXT_METRICS_VERSION,
    cer: characterEdits.distance / referenceCharacters.length,
    wer: wordEdits.distance / referenceWords.length,
  }
}
```

- [ ] **Step 4: Run the metric tests and verify they pass**

Run:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/services/ocr/audit/textMetrics.test.ts
```

Expected: PASS with 5 tests.

- [ ] **Step 5: Commit Task 1**

```powershell
cd D:\wenjie-writewise-ai
git add app/src/services/ocr/audit/textMetrics.ts app/src/services/ocr/audit/textMetrics.test.ts
git diff --cached --check
git commit -m "feat: add versioned ocr text metrics"
```

---

### Task 2: Add Versioned Shadow Assessment With Expected Page IDs

**Files:**
- Create: `app/src/services/ocr/audit/types.ts`
- Create: `app/src/services/ocr/audit/assessOcrShadow.ts`
- Create: `app/src/services/ocr/audit/assessOcrShadow.test.ts`

**Interfaces:**
- Consumes: frontend `OcrEssayResult` and explicit `expectedPageIds`.
- Produces: `OcrShadowAssessment`, `assessOcrShadow(input)`.
- Time contract: caller supplies `assessedAt`; the function never reads system time.

- [ ] **Step 1: Create the versioned audit type contract**

Create `app/src/services/ocr/audit/types.ts`:

```ts
import type { OcrReviewTextMetrics } from './textMetrics'

export const OCR_AUDIT_VERSION = 'ocr-audit-v1' as const
export const OCR_SHADOW_ASSESSMENT_VERSION = 'ocr-shadow-v1' as const

export type OcrAuditSourceKind = 'mock' | 'remote' | 'manual'
export type OcrShadowOutcome = 'no_obvious_risk' | 'review_recommended' | 'insufficient_evidence'

export type OcrShadowReasonCode =
  | 'empty_text'
  | 'page_result_missing'
  | 'partial_page_failure'
  | 'failed_result'
  | 'confidence_observed'
  | 'confidence_unavailable'
  | 'suspected_hyphen_break_observed'

export interface OcrShadowReason {
  code: OcrShadowReasonCode
  severity: 'info' | 'warning' | 'critical'
  value?: number
}

export interface OcrShadowAssessment {
  assessmentVersion: typeof OCR_SHADOW_ASSESSMENT_VERSION
  outcome: OcrShadowOutcome
  reasons: OcrShadowReason[]
  assessedAt: string
}

export interface PendingOcrTranscriptAudit {
  auditVersion: typeof OCR_AUDIT_VERSION
  sourceKind: OcrAuditSourceKind
  sourceText: string
  shadowAssessment: OcrShadowAssessment
}

export type OcrReviewOutcome = OcrReviewTextMetrics

export interface OcrTranscriptAudit extends PendingOcrTranscriptAudit {
  confirmedTranscript: string
  reviewOutcome: OcrReviewOutcome
}
```

- [ ] **Step 2: Write failing shadow assessment tests**

Create `app/src/services/ocr/audit/assessOcrShadow.test.ts` with synthetic results:

```ts
import { describe, expect, it } from 'vitest'
import type { OcrEssayResult } from '../types'
import { assessOcrShadow } from './assessOcrShadow'
import { OCR_SHADOW_ASSESSMENT_VERSION } from './types'

const assessedAt = '2026-07-12T01:02:03.000Z'

function result(overrides: Partial<OcrEssayResult> = {}): OcrEssayResult {
  return {
    essayGroupId: 'group-1',
    text: 'Essay text',
    pages: [{ pageId: 'page-1', text: 'Essay text', confidence: 0.9 }],
    provider: 'remote',
    status: 'success',
    ...overrides,
  }
}

describe('assessOcrShadow', () => {
  it('detects a missing page by pageId set difference, not page count', () => {
    const assessment = assessOcrShadow({
      sourceKind: 'remote',
      result: result({ pages: [{ pageId: 'wrong-page', text: 'Essay text' }] }),
      expectedPageIds: ['page-1'],
      assessedAt,
    })

    expect(assessment.outcome).toBe('review_recommended')
    expect(assessment.reasons).toContainEqual({ code: 'page_result_missing', severity: 'critical', value: 1 })
  })

  it('recommends review for partial, failed, and empty unified results', () => {
    expect(
      assessOcrShadow({
        sourceKind: 'remote',
        result: result({ status: 'partial' }),
        expectedPageIds: ['page-1'],
        assessedAt,
      }).outcome,
    ).toBe('review_recommended')

    expect(
      assessOcrShadow({
        sourceKind: 'remote',
        result: result({ status: 'failed', text: '' }),
        expectedPageIds: ['page-1'],
        assessedAt,
      }).outcome,
    ).toBe('review_recommended')
  })

  it('returns insufficient evidence for mock and manual sources', () => {
    expect(
      assessOcrShadow({ sourceKind: 'mock', result: result(), expectedPageIds: ['page-1'], assessedAt }).outcome,
    ).toBe('insufficient_evidence')
    expect(
      assessOcrShadow({ sourceKind: 'manual', expectedPageIds: ['page-1'], assessedAt }).outcome,
    ).toBe('insufficient_evidence')
  })

  it('records finite confidence average and suspected hyphen count without changing outcome', () => {
    const assessment = assessOcrShadow({
      sourceKind: 'remote',
      result: result({
        text: 'pur-\npose',
        pages: [
          { pageId: 'page-1', text: 'pur-', confidence: 0.8 },
          { pageId: 'page-2', text: 'pose', confidence: 1 },
        ],
      }),
      expectedPageIds: ['page-1', 'page-2'],
      assessedAt,
    })

    expect(assessment).toMatchObject({
      assessmentVersion: OCR_SHADOW_ASSESSMENT_VERSION,
      outcome: 'no_obvious_risk',
      assessedAt,
    })
    expect(assessment.reasons).toContainEqual({ code: 'confidence_observed', severity: 'info', value: 0.9 })
    expect(assessment.reasons).toContainEqual({
      code: 'suspected_hyphen_break_observed',
      severity: 'info',
      value: 1,
    })
  })
})
```

- [ ] **Step 3: Run the focused test and verify it fails**

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/services/ocr/audit/assessOcrShadow.test.ts
```

Expected: FAIL because `assessOcrShadow.ts` does not exist.

- [ ] **Step 4: Implement page-ID-aware invisible assessment**

Create `app/src/services/ocr/audit/assessOcrShadow.ts`:

```ts
import type { OcrEssayResult } from '../types'
import {
  OCR_SHADOW_ASSESSMENT_VERSION,
  type OcrAuditSourceKind,
  type OcrShadowAssessment,
  type OcrShadowReason,
} from './types'

interface AssessOcrShadowInput {
  sourceKind: OcrAuditSourceKind
  result?: OcrEssayResult
  expectedPageIds: readonly string[]
  assessedAt: string
}

export function assessOcrShadow({
  sourceKind,
  result,
  expectedPageIds,
  assessedAt,
}: AssessOcrShadowInput): OcrShadowAssessment {
  if (sourceKind !== 'remote' || !result) {
    return {
      assessmentVersion: OCR_SHADOW_ASSESSMENT_VERSION,
      outcome: 'insufficient_evidence',
      reasons: [],
      assessedAt,
    }
  }

  const reasons: OcrShadowReason[] = []
  const expectedPageIdSet = new Set(expectedPageIds)
  const actualPageIdSet = new Set(result.pages.map((page) => page.pageId))
  const missingPageCount = [...expectedPageIdSet].filter((pageId) => !actualPageIdSet.has(pageId)).length

  if (missingPageCount > 0) {
    reasons.push({ code: 'page_result_missing', severity: 'critical', value: missingPageCount })
  }
  if (result.text.trim().length === 0) {
    reasons.push({ code: 'empty_text', severity: 'critical' })
  }
  if (result.status === 'partial') {
    reasons.push({ code: 'partial_page_failure', severity: 'critical' })
  }
  if (result.status === 'failed') {
    reasons.push({ code: 'failed_result', severity: 'critical' })
  }

  const confidences = result.pages
    .map((page) => page.confidence)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (confidences.length === 0) {
    reasons.push({ code: 'confidence_unavailable', severity: 'info' })
  } else {
    reasons.push({
      code: 'confidence_observed',
      severity: 'info',
      value: confidences.reduce((sum, value) => sum + value, 0) / confidences.length,
    })
  }

  const suspectedHyphenCount = Array.from(result.text.matchAll(/-\n(?=[a-z])/g)).length
  if (suspectedHyphenCount > 0) {
    reasons.push({
      code: 'suspected_hyphen_break_observed',
      severity: 'info',
      value: suspectedHyphenCount,
    })
  }

  return {
    assessmentVersion: OCR_SHADOW_ASSESSMENT_VERSION,
    outcome: reasons.some((reason) => reason.severity === 'critical') ? 'review_recommended' : 'no_obvious_risk',
    reasons,
    assessedAt,
  }
}
```

- [ ] **Step 5: Run focused audit tests**

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/services/ocr/audit
```

Expected: all Task 1 and Task 2 audit tests pass.

- [ ] **Step 6: Commit Task 2**

```powershell
cd D:\wenjie-writewise-ai
git add app/src/services/ocr/audit/types.ts app/src/services/ocr/audit/assessOcrShadow.ts app/src/services/ocr/audit/assessOcrShadow.test.ts
git diff --cached --check
git commit -m "feat: add invisible ocr shadow assessment"
```

---

### Task 3: Add Transcript Audit Lifecycle Pure Functions

**Files:**
- Create: `app/src/services/ocr/audit/transcriptAudit.ts`
- Create: `app/src/services/ocr/audit/transcriptAudit.test.ts`

**Interfaces:**
- Consumes: `OcrEssayResult`, explicit `expectedPageIds`, explicit ISO timestamps, shared metric service.
- Produces: `createPendingOcrAudit`, `createManualPendingOcrAudit`, `confirmOcrAudit`.
- No function in this file may call `Date`.

- [ ] **Step 1: Write lifecycle truth-table tests**

Create `app/src/services/ocr/audit/transcriptAudit.test.ts` with parameterized synthetic cases:

```ts
import { describe, expect, it } from 'vitest'
import type { OcrEssayResult } from '../types'
import { confirmOcrAudit, createManualPendingOcrAudit, createPendingOcrAudit } from './transcriptAudit'

const assessedAt = '2026-07-12T02:00:00.000Z'
const confirmedAt = '2026-07-12T02:05:00.000Z'

const remoteResult: OcrEssayResult = {
  essayGroupId: 'group-1',
  text: 'Client final source',
  pages: [{ pageId: 'page-1', text: 'Client final source', confidence: 0.9 }],
  provider: 'remote',
  status: 'success',
}

describe('OCR transcript audit lifecycle', () => {
  it.each([
    ['remote', 'Client final source', 'no_obvious_risk'],
    ['mock', 'Client final source', 'insufficient_evidence'],
  ] as const)('captures %s client output before teacher edits', (sourceKind, sourceText, outcome) => {
    const pending = createPendingOcrAudit({
      sourceKind,
      result: remoteResult,
      expectedPageIds: ['page-1'],
      assessedAt,
    })

    expect(pending).toMatchObject({ sourceKind, sourceText, shadowAssessment: { outcome, assessedAt } })
  })

  it('uses an empty immutable source for manual input', () => {
    expect(createManualPendingOcrAudit(['page-1'], assessedAt)).toMatchObject({
      sourceKind: 'manual',
      sourceText: '',
      shadowAssessment: { outcome: 'insufficient_evidence', assessedAt },
    })
  })

  it('confirms a faithful transcript without overwriting source text', () => {
    const pending = createPendingOcrAudit({
      sourceKind: 'remote',
      result: remoteResult,
      expectedPageIds: ['page-1'],
      assessedAt,
    })
    const audit = confirmOcrAudit(pending, 'Teacher faithful transcript', confirmedAt)

    expect(audit.sourceText).toBe('Client final source')
    expect(audit.confirmedTranscript).toBe('Teacher faithful transcript')
    expect(audit.reviewOutcome.confirmedAt).toBe(confirmedAt)
    expect(audit.reviewOutcome.actualTeacherAction).toBe('confirmed_after_edit')
  })

  it('replaces pending source on retry instead of retaining run history', () => {
    const first = createPendingOcrAudit({
      sourceKind: 'remote',
      result: remoteResult,
      expectedPageIds: ['page-1'],
      assessedAt,
    })
    const retry = createPendingOcrAudit({
      sourceKind: 'remote',
      result: { ...remoteResult, text: 'Latest retry', pages: [{ pageId: 'page-1', text: 'Latest retry' }] },
      expectedPageIds: ['page-1'],
      assessedAt: '2026-07-12T02:01:00.000Z',
    })

    expect(first.sourceText).toBe('Client final source')
    expect(retry.sourceText).toBe('Latest retry')
    expect(retry).not.toHaveProperty('previousRuns')
  })
})
```

- [ ] **Step 2: Run the lifecycle test and verify it fails**

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/services/ocr/audit/transcriptAudit.test.ts
```

Expected: FAIL because `transcriptAudit.ts` does not exist.

- [ ] **Step 3: Implement lifecycle builders with injected timestamps**

Create `app/src/services/ocr/audit/transcriptAudit.ts`:

```ts
import type { OcrEssayResult } from '../types'
import { assessOcrShadow } from './assessOcrShadow'
import { calculateReviewTextMetrics } from './textMetrics'
import {
  OCR_AUDIT_VERSION,
  type OcrAuditSourceKind,
  type OcrTranscriptAudit,
  type PendingOcrTranscriptAudit,
} from './types'

interface CreatePendingOcrAuditInput {
  sourceKind: Exclude<OcrAuditSourceKind, 'manual'>
  result: OcrEssayResult
  expectedPageIds: readonly string[]
  assessedAt: string
}

export function createPendingOcrAudit({
  sourceKind,
  result,
  expectedPageIds,
  assessedAt,
}: CreatePendingOcrAuditInput): PendingOcrTranscriptAudit {
  return {
    auditVersion: OCR_AUDIT_VERSION,
    sourceKind,
    sourceText: result.text,
    shadowAssessment: assessOcrShadow({ sourceKind, result, expectedPageIds, assessedAt }),
  }
}

export function createManualPendingOcrAudit(
  expectedPageIds: readonly string[],
  assessedAt: string,
): PendingOcrTranscriptAudit {
  return {
    auditVersion: OCR_AUDIT_VERSION,
    sourceKind: 'manual',
    sourceText: '',
    shadowAssessment: assessOcrShadow({
      sourceKind: 'manual',
      expectedPageIds,
      assessedAt,
    }),
  }
}

export function confirmOcrAudit(
  pending: PendingOcrTranscriptAudit | OcrTranscriptAudit,
  confirmedTranscript: string,
  confirmedAt: string,
): OcrTranscriptAudit {
  return {
    ...pending,
    confirmedTranscript,
    reviewOutcome: calculateReviewTextMetrics(pending.sourceText, confirmedTranscript, confirmedAt),
  }
}
```

- [ ] **Step 4: Run all audit service tests**

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/services/ocr/audit
```

Expected: all audit service tests pass.

- [ ] **Step 5: Commit Task 3**

```powershell
cd D:\wenjie-writewise-ai
git add app/src/services/ocr/audit/transcriptAudit.ts app/src/services/ocr/audit/transcriptAudit.test.ts
git diff --cached --check
git commit -m "feat: add ocr transcript audit lifecycle"
```

---

### Task 4: Integrate Audit State Without Changing UI or Queue Behavior

**Files:**
- Modify: `app/src/types/index.ts`
- Modify: `app/src/context/appStateContextValue.ts`
- Modify: `app/src/context/AppStateContext.tsx`
- Create: `app/src/context/AppStateContext.test.tsx`
- Modify: `app/src/pages/UploadPage.tsx`
- Modify: `app/src/pages/UploadPage.test.tsx`

**Interfaces:**
- Consumes: Task 2 and Task 3 audit services.
- Produces: `Essay.ocrAudit`, synchronized `Essay.ocrText`, pending UploadPage audit state.
- Compatibility: all existing consumers continue to read `ocrText`.

- [ ] **Step 1: Add failing AppState lifecycle tests**

Create `app/src/context/AppStateContext.test.tsx`. Render `AppStateProvider` with a small test consumer that calls context actions and displays the created Essay as JSON. Cover these assertions with synthetic data:

```ts
expect(createdEssay.ocrText).toBe('Teacher faithful text')
expect(createdEssay.ocrAudit.sourceText).toBe('Client final source')
expect(createdEssay.ocrAudit.confirmedTranscript).toBe('Teacher faithful text')
expect(createdEssay.ocrAudit.reviewOutcome.confirmedAt).toBe('2026-07-12T03:00:00.000Z')
```

Then call:

```ts
updateEssayOcrText(createdEssay.id, 'Later faithful correction', '2026-07-12T03:05:00.000Z')
```

Assert:

```ts
expect(updatedEssay.ocrText).toBe('Later faithful correction')
expect(updatedEssay.ocrAudit.sourceText).toBe('Client final source')
expect(updatedEssay.ocrAudit.confirmedTranscript).toBe('Later faithful correction')
expect(updatedEssay.ocrAudit.reviewOutcome.confirmedAt).toBe('2026-07-12T03:05:00.000Z')
```

- [ ] **Step 2: Add failing UploadPage lifecycle tests**

Extend `app/src/pages/UploadPage.test.tsx` with synthetic cases that cover the normative truth table:

1. remote success captures the OCR Client result before textarea edits;
2. mock success records `sourceKind: 'mock'`;
3. real failure then mock fallback records only the mock source;
4. real failure then manual input records empty `sourceText`;
5. partial result is confirmable only under existing text rules and receives invisible `review_recommended`;
6. two sequential remote runs retain only the latest applied result;
7. failed retry does not silently restore the earlier successful result;
8. no visible text matching `OCR 质量`, `建议复核`, `影子评估`, or `自动放行` is rendered;
9. confirmation still navigates to the existing progress queue.

Use `vi.setSystemTime(new Date('2026-07-12T03:00:00.000Z'))` only for the integration boundary. Pure service tests continue passing explicit timestamps.

- [ ] **Step 3: Run the focused tests and verify they fail**

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/context/AppStateContext.test.tsx src/pages/UploadPage.test.tsx
```

Expected: new audit assertions fail because Essay and confirmation inputs do not yet contain audit data.

- [ ] **Step 4: Extend Essay and context contracts**

In `app/src/types/index.ts`, import and add the optional audit field:

```ts
import type { OcrTranscriptAudit } from '../services/ocr/audit/types'

export interface Essay {
  // existing fields unchanged
  ocrText: string
  ocrAudit?: OcrTranscriptAudit
  // remaining fields unchanged
}
```

In `app/src/context/appStateContextValue.ts`, change the confirmation group and update action contracts:

```ts
import type { OcrTranscriptAudit } from '../services/ocr/audit/types'

export interface ConfirmMockOcrEssayGroup {
  pages: EssayPage[]
  ocrText: string
  ocrAudit: OcrTranscriptAudit
}

export interface AppState {
  // existing fields unchanged
  updateEssayOcrText: (essayId: string, text: string, confirmedAt?: string) => void
}
```

The optional `confirmedAt` is a test and integration seam. Production callers that omit it use one timestamp created at the action boundary; metric functions still receive a concrete string and never call `Date`.

- [ ] **Step 5: Persist audit and synchronize later faithful corrections**

In `app/src/context/AppStateContext.tsx`, set the created Essay fields from the confirmed group:

```ts
ocrText: group.ocrText,
ocrAudit: group.ocrAudit,
```

Update `updateEssayOcrText` to preserve source text and recompute the latest essay-level outcome:

```ts
import { confirmOcrAudit } from '../services/ocr/audit/transcriptAudit'

const updateEssayOcrText = useCallback((essayId: string, text: string, confirmedAt?: string) => {
  const timestamp = confirmedAt ?? new Date().toISOString()

  setEssays((current) =>
    current.map((essay) => {
      if (essay.id !== essayId) return essay

      return {
        ...essay,
        ocrText: text,
        ocrAudit: essay.ocrAudit ? confirmOcrAudit(essay.ocrAudit, text, timestamp) : undefined,
        updatedAt: timestamp,
      }
    }),
  )
}, [])
```

- [ ] **Step 6: Track pending audit records in UploadPage**

In `app/src/pages/UploadPage.tsx`:

1. add `pendingOcrAudits` state aligned with visible groups;
2. clear it in `resetOcrDraft` and at OCR start;
3. change `applyOcrResults` to receive `sourceKind`, the exact `groupsSnapshot`, and an explicit `assessedAt`;
4. build each pending audit from the final `OcrEssayResult.text` handed to UploadPage;
5. pass `group.pageIds` as `expectedPageIds`;
6. replace the entire pending audit collection on every retry, fallback, or manual path;
7. create final audits with one injected `confirmedAt` when the teacher confirms.

Use this exact orchestration shape:

```ts
const applyOcrResults = (
  results: OcrEssayResult[],
  sourceKind: 'mock' | 'remote',
  groupsSnapshot: UploadEssayGroup[],
  assessedAt: string,
) => {
  setOcrResults(results)
  setOcrDrafts(buildOcrDraftsFromResults(results, groupsSnapshot.map((group) => group.id)))

  const resultsByGroupId = new Map(results.map((result) => [result.essayGroupId, result]))
  setPendingOcrAudits(
    groupsSnapshot.map((group) => {
      const result = resultsByGroupId.get(group.id) ?? {
        essayGroupId: group.id,
        text: '',
        pages: [],
        provider: sourceKind,
        status: 'failed' as const,
        warnings: ['missing_result'],
      }

      return createPendingOcrAudit({ sourceKind, result, expectedPageIds: group.pageIds, assessedAt })
    }),
  )

  // Keep the existing status, error, and empty-text behavior unchanged below this point.
}
```

For manual input:

```ts
const assessedAt = new Date().toISOString()
setPendingOcrAudits(visibleEssayGroups.map((group) => createManualPendingOcrAudit(group.pageIds, assessedAt)))
```

For confirmation:

```ts
const confirmedAt = new Date().toISOString()
const essayGroups = visibleEssayGroups.map((group, groupIndex) => {
  const confirmedTranscript = ocrDrafts[groupIndex] ?? ''
  const pendingAudit = pendingOcrAudits[groupIndex]
  if (!pendingAudit) throw new Error('OCR audit source is missing.')

  return {
    pages: getGroupPages(group),
    ocrText: confirmedTranscript,
    ocrAudit: confirmOcrAudit(pendingAudit, confirmedTranscript, confirmedAt),
  }
})
```

Do not render `pendingOcrAudits` or `shadowAssessment` anywhere.

- [ ] **Step 7: Run focused lifecycle tests**

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/services/ocr/audit src/context/AppStateContext.test.tsx src/pages/UploadPage.test.tsx
```

Expected: all audit, context, and UploadPage tests pass; existing visible flow assertions remain unchanged.

- [ ] **Step 8: Run frontend regression checks**

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected: all tests pass, lint exits 0, and build exits 0.

- [ ] **Step 9: Commit Task 4**

```powershell
cd D:\wenjie-writewise-ai
git add app/src/types/index.ts app/src/context/appStateContextValue.ts app/src/context/AppStateContext.tsx app/src/context/AppStateContext.test.tsx app/src/pages/UploadPage.tsx app/src/pages/UploadPage.test.tsx
git diff --cached --check
git commit -m "feat: preserve ocr transcript audit lifecycle"
```

---

### Task 5: Add One-Shot Private Benchmark With Fixed Exit Codes

**Files:**
- Create: `ocr-gateway/scripts/privateOcrBenchmark/types.ts`
- Create: `ocr-gateway/scripts/privateOcrBenchmark/benchmark.ts`
- Create: `ocr-gateway/scripts/privateOcrBenchmark/benchmark.test.ts`
- Create: `ocr-gateway/scripts/privateOcrBenchmark/cli.ts`
- Create: `ocr-gateway/scripts/privateOcrBenchmark/cli.test.ts`
- Modify: `ocr-gateway/tsconfig.json`
- Modify: `ocr-gateway/package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: existing `OcrProvider`, `PaddleLocalOcrProvider`, `NodePaddleRunner`, and Task 1 `calculateBenchmarkMetrics`.
- Produces: anonymous benchmark summaries and exit code `0 | 1 | 2`.
- Production Provider path: `NodePaddleRunner -> PaddleLocalOcrProvider.recognize -> normalizeProviderResult`.
- The benchmark imports `app/src/services/ocr/audit/textMetrics.ts`; it never defines another Levenshtein, CER, WER, or metric projection function.

- [ ] **Step 1: Add ignored private directories before any benchmark fixture work**

Append to the local-environment section of `.gitignore`:

```gitignore
local-private-samples/
local-private-results/
```

Verify:

```powershell
cd D:\wenjie-writewise-ai
git check-ignore -v ocr-gateway/local-private-samples/sample-001/page-1.jpg
git check-ignore -v ocr-gateway/local-private-results/benchmark-summary.json
```

Expected: both paths are ignored by the new rules.

- [ ] **Step 2: Define text-free manifest and result types**

Create `ocr-gateway/scripts/privateOcrBenchmark/types.ts`:

```ts
import type { OcrStatus } from '../../src/types.js'
import type { OcrTextMetricsVersion } from '../../../app/src/services/ocr/audit/textMetrics.js'

export type PrivateSampleCategory =
  | 'clear'
  | 'general_handwriting'
  | 'messy_handwriting'
  | 'tilted'
  | 'dark'
  | 'corrected'
  | 'multi_page'

export interface PrivateSampleManifest {
  sampleId: string
  category: PrivateSampleCategory
  pages: string[]
  reference: string
  confirmedMissingLineCount?: number
}

export interface AnonymousSampleResult {
  sampleId: string
  category: string
  pageCount: number
  benchmarkStatus: 'completed' | 'failed'
  ocrStatus?: OcrStatus
  warningCodes: string[]
  averageConfidence?: number
  cer: number | null
  wer: number | null
  invalidReason?: 'empty_reference' | 'invalid_manifest' | 'unreadable_sample' | 'provider_failed'
  confirmedMissingLineCount?: number
  durationMs: number
  metricsVersion: OcrTextMetricsVersion
}

export interface AnonymousBenchmarkSummary {
  benchmarkVersion: 'private-ocr-benchmark-v1'
  completedSampleCount: number
  failedSampleCount: number
  samples: AnonymousSampleResult[]
}

export const BENCHMARK_EXIT_SUCCESS = 0 as const
export const BENCHMARK_EXIT_FATAL = 1 as const
export const BENCHMARK_EXIT_SAMPLE_FAILURE = 2 as const
export type BenchmarkExitCode = 0 | 1 | 2
```

The anonymous result types intentionally contain no OCR text, reference text, source filename, absolute path, name, class, or student number fields.

- [ ] **Step 3: Write failing benchmark orchestration tests**

Create `ocr-gateway/scripts/privateOcrBenchmark/benchmark.test.ts`. Use a synthetic temporary root created by the test, never `local-private-samples/`. Construct a real `PaddleLocalOcrProvider` with a fake `PaddleRunner` that writes synthetic output JSON to the supplied output path.

Required assertions:

```ts
expect(summary.benchmarkVersion).toBe('private-ocr-benchmark-v1')
expect(summary.samples[0]).toMatchObject({
  sampleId: 'sample-001',
  benchmarkStatus: 'completed',
  ocrStatus: 'success',
  metricsVersion: 'ocr-text-metrics-v1',
})
expect(JSON.stringify(summary)).not.toContain('Synthetic faithful essay text')
expect(JSON.stringify(summary)).not.toContain(testRoot)
```

Add separate synthetic cases for:

- Provider `partial` produces a completed sample;
- Provider `failed` produces a failed sample but later samples still run;
- invalid `sampleId` produces `invalid_manifest`;
- empty reference produces null CER/WER without exposing text;
- manually supplied `confirmedMissingLineCount` is passed through and is never inferred from text length.

- [ ] **Step 4: Implement benchmark orchestration without metric duplication**

Create `ocr-gateway/scripts/privateOcrBenchmark/benchmark.ts` with these public dependencies:

```ts
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { calculateBenchmarkMetrics, OCR_TEXT_METRICS_VERSION } from '../../../app/src/services/ocr/audit/textMetrics.js'
import type { GatewayPageInput } from '../../src/types.js'
import type { OcrProvider } from '../../src/providers/providerTypes.js'
import type {
  AnonymousBenchmarkSummary,
  AnonymousSampleResult,
  PrivateSampleCategory,
  PrivateSampleManifest,
} from './types.js'

const anonymousSampleIdPattern = /^sample-\d{3,4}$/
const privateSampleCategories = new Set<PrivateSampleCategory>([
  'clear',
  'general_handwriting',
  'messy_handwriting',
  'tilted',
  'dark',
  'corrected',
  'multi_page',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseManifest(rawText: string): PrivateSampleManifest {
  const value: unknown = JSON.parse(rawText)
  if (
    !isRecord(value) ||
    typeof value.sampleId !== 'string' ||
    !anonymousSampleIdPattern.test(value.sampleId) ||
    typeof value.category !== 'string' ||
    !privateSampleCategories.has(value.category as PrivateSampleCategory) ||
    !Array.isArray(value.pages) ||
    value.pages.length === 0 ||
    !value.pages.every((page) => typeof page === 'string' && page.length > 0) ||
    typeof value.reference !== 'string' ||
    value.reference.length === 0 ||
    (value.confirmedMissingLineCount !== undefined &&
      (typeof value.confirmedMissingLineCount !== 'number' ||
        !Number.isInteger(value.confirmedMissingLineCount) ||
        value.confirmedMissingLineCount < 0))
  ) {
    throw new Error('invalid_manifest')
  }

  return value as unknown as PrivateSampleManifest
}

function resolveWithin(root: string, relativePath: string): string {
  const candidate = resolve(root, relativePath)
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`
  if (candidate !== root && !candidate.startsWith(prefix)) throw new Error('invalid_manifest')
  return candidate
}

function mimeTypeFor(path: string): GatewayPageInput['mimeType'] {
  const extension = extname(path).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.png') return 'image/png'
  throw new Error('unsupported_image_type')
}

export interface RunPrivateBenchmarkInput {
  samplesRoot: string
  manifests: readonly string[]
  provider: OcrProvider
  nowMs?: () => number
}

export async function runPrivateBenchmark({
  samplesRoot,
  manifests,
  provider,
  nowMs = () => performance.now(),
}: RunPrivateBenchmarkInput): Promise<AnonymousBenchmarkSummary> {
  const samples: AnonymousSampleResult[] = []

  for (const manifestName of manifests) {
    const startedAt = nowMs()
    let manifest: PrivateSampleManifest | undefined

    try {
      manifest = parseManifest(await readFile(resolveWithin(samplesRoot, manifestName), 'utf8'))

      const sampleRoot = resolve(samplesRoot, manifest.sampleId)
      const pages = await Promise.all(
        manifest.pages.map(async (relativePath, index): Promise<GatewayPageInput> => {
          const imagePath = resolveWithin(sampleRoot, relativePath)
          const buffer = await readFile(imagePath)
          return {
            pageId: `page-${index + 1}`,
            originalName: `page-${index + 1}${extname(relativePath).toLowerCase()}`,
            mimeType: mimeTypeFor(relativePath),
            size: buffer.byteLength,
            buffer,
          }
        }),
      )
      const referenceText = await readFile(resolveWithin(sampleRoot, manifest.reference), 'utf8')
      const result = await provider.recognize({ essayGroupId: manifest.sampleId, pages })
      const metrics = calculateBenchmarkMetrics(result.text, referenceText)
      const warningCodes = [...new Set(result.pages.flatMap((page) => page.warnings ?? []))]
      const confidences = result.pages
        .map((page) => page.confidence)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

      samples.push({
        sampleId: manifest.sampleId,
        category: manifest.category,
        pageCount: pages.length,
        benchmarkStatus: result.status === 'failed' ? 'failed' : 'completed',
        ocrStatus: result.status,
        warningCodes,
        averageConfidence:
          confidences.length > 0 ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : undefined,
        cer: metrics.cer,
        wer: metrics.wer,
        invalidReason: result.status === 'failed' ? 'provider_failed' : metrics.invalidReason,
        confirmedMissingLineCount: manifest.confirmedMissingLineCount,
        durationMs: nowMs() - startedAt,
        metricsVersion: OCR_TEXT_METRICS_VERSION,
      })
    } catch (error) {
      const invalidReason = error instanceof Error && error.message === 'invalid_manifest'
        ? 'invalid_manifest'
        : 'unreadable_sample'
      samples.push({
        sampleId: manifest?.sampleId && anonymousSampleIdPattern.test(manifest.sampleId) ? manifest.sampleId : 'sample-000',
        category: manifest?.category ?? 'unknown',
        pageCount: manifest?.pages?.length ?? 0,
        benchmarkStatus: 'failed',
        warningCodes: [],
        cer: null,
        wer: null,
        invalidReason,
        durationMs: nowMs() - startedAt,
        metricsVersion: OCR_TEXT_METRICS_VERSION,
      })
    }
  }

  return {
    benchmarkVersion: 'private-ocr-benchmark-v1',
    completedSampleCount: samples.filter((sample) => sample.benchmarkStatus === 'completed').length,
    failedSampleCount: samples.filter((sample) => sample.benchmarkStatus === 'failed').length,
    samples,
  }
}
```

The tests must prove both page and reference `../` traversal are rejected without printing the path.

- [ ] **Step 5: Write failing CLI tests for exit codes and sanitized output**

Create `ocr-gateway/scripts/privateOcrBenchmark/cli.test.ts` around an exported `runCli(dependencies)` function. Assert:

```ts
expect(await runCli(depsForAllCompleted)).toBe(0)
expect(await runCli(depsForFatalRootFailure)).toBe(1)
expect(await runCli(depsWithOneFailedSample)).toBe(2)
```

Also assert:

- output is written only below the injected `local-private-results` directory;
- logs contain only sample ID, status, CER, and WER;
- no log or JSON output contains synthetic essay/reference text or absolute paths;
- the CLI dependency set has no `listen` function and does not import `src/index.ts` or Express.

- [ ] **Step 6: Implement fixed-directory CLI and production Provider construction**

Create `ocr-gateway/scripts/privateOcrBenchmark/cli.ts` with:

```ts
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PaddleLocalOcrProvider } from '../../src/providers/paddleLocalOcrProvider.js'
import { NodePaddleRunner } from '../../src/providers/paddleRunner.js'
import { runPrivateBenchmark } from './benchmark.js'
import {
  BENCHMARK_EXIT_FATAL,
  BENCHMARK_EXIT_SAMPLE_FAILURE,
  BENCHMARK_EXIT_SUCCESS,
  type AnonymousBenchmarkSummary,
  type BenchmarkExitCode,
} from './types.js'

interface CliDependencies {
  samplesRoot: string
  resultsRoot: string
  listManifests: () => Promise<string[]>
  runBenchmark: () => Promise<AnonymousBenchmarkSummary>
  writeSummary: (summary: AnonymousBenchmarkSummary) => Promise<void>
  log: (message: string) => void
}

export async function runCli(deps: CliDependencies): Promise<BenchmarkExitCode> {
  try {
    const manifests = await deps.listManifests()
    if (manifests.length === 0) return BENCHMARK_EXIT_FATAL
    const summary = await deps.runBenchmark()
    await deps.writeSummary(summary)
    for (const sample of summary.samples) {
      deps.log(`sampleId=${sample.sampleId} status=${sample.benchmarkStatus} cer=${sample.cer ?? 'null'} wer=${sample.wer ?? 'null'}`)
    }
    return summary.failedSampleCount > 0 ? BENCHMARK_EXIT_SAMPLE_FAILURE : BENCHMARK_EXIT_SUCCESS
  } catch {
    deps.log('benchmark_status=fatal')
    return BENCHMARK_EXIT_FATAL
  }
}

const gatewayRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const samplesRoot = resolve(gatewayRoot, 'local-private-samples')
const resultsRoot = resolve(gatewayRoot, 'local-private-results')

async function main(): Promise<BenchmarkExitCode> {
  const runner = new NodePaddleRunner()
  const provider = new PaddleLocalOcrProvider({ runner })
  const manifests = async () => (await readdir(samplesRoot)).filter((name) => name.endsWith('.json')).sort()

  return runCli({
    samplesRoot,
    resultsRoot,
    listManifests: manifests,
    runBenchmark: async () => runPrivateBenchmark({ samplesRoot, manifests: await manifests(), provider }),
    writeSummary: async (summary) => {
      await mkdir(resultsRoot, { recursive: true })
      await writeFile(resolve(resultsRoot, 'benchmark-summary.json'), JSON.stringify(summary, null, 2), 'utf8')
    },
    log: (message) => process.stderr.write(`${message}\n`),
  })
}

export function isMainModule(importMetaUrl: string, argvEntry: string | undefined): boolean {
  return argvEntry !== undefined && importMetaUrl === pathToFileURL(resolve(argvEntry)).href
}

if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = await main()
}
```

- [ ] **Step 7: Include benchmark TypeScript in typecheck and tests**

Modify `ocr-gateway/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "types": ["node", "vitest"]
  },
  "include": [
    "src/**/*.ts",
    "scripts/**/*.ts",
    "../app/src/services/ocr/audit/textMetrics.ts"
  ]
}
```

This makes `npm.cmd run typecheck` compile the CLI, benchmark orchestration, benchmark tests, and the imported shared pure metric module. `vitest run` already discovers `scripts/**/*.test.ts`; add an explicit focused script to make that scope visible.

Modify `ocr-gateway/package.json` scripts:

```json
{
  "scripts": {
    "dev": "tsx src/index.ts",
    "benchmark:private": "tsx scripts/privateOcrBenchmark/cli.ts",
    "test": "vitest run",
    "test:benchmark": "vitest run scripts/privateOcrBenchmark",
    "typecheck": "tsc --noEmit"
  }
}
```

No dependency or lockfile change is expected because `tsx`, TypeScript, and Vitest already exist.

- [ ] **Step 8: Run focused benchmark verification with synthetic fixtures only**

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd run test:benchmark
npm.cmd run typecheck
```

Expected: benchmark tests pass and typecheck exits 0. Do not run `npm.cmd run benchmark:private`; that command would read real private samples and requires a separate explicit user request.

- [ ] **Step 9: Run Gateway regression tests**

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd test
npm.cmd run typecheck
```

Expected: all Gateway and benchmark tests pass; typecheck exits 0; no Python or PaddleOCR process is started.

- [ ] **Step 10: Commit Task 5**

```powershell
cd D:\wenjie-writewise-ai
git add .gitignore ocr-gateway/package.json ocr-gateway/tsconfig.json ocr-gateway/scripts/privateOcrBenchmark/types.ts ocr-gateway/scripts/privateOcrBenchmark/benchmark.ts ocr-gateway/scripts/privateOcrBenchmark/benchmark.test.ts ocr-gateway/scripts/privateOcrBenchmark/cli.ts ocr-gateway/scripts/privateOcrBenchmark/cli.test.ts
git diff --cached --check
git commit -m "feat: add private ocr benchmark runner"
```

---

### Task 6: Document, Audit, and Verify v0.3a

**Files:**
- Modify: `docs/ocr_provider_evaluation_paddle_v02.md`
- Modify: `docs/current_development_status.md`

**Interfaces:**
- Consumes: verified behavior from Tasks 1-5.
- Produces: accurate status and anonymous evaluation instructions; no real sample content.

- [ ] **Step 1: Update evaluation documentation without private text**

Add a v0.3a section to `docs/ocr_provider_evaluation_paddle_v02.md` that records:

- invisible shadow assessment exists but is not shown in teacher UI;
- `sourceText` is the final unified frontend OCR Client text handed to UploadPage before teacher edit;
- `sourceText` is not PaddleOCR raw text or Python output;
- the private command is one-shot and does not listen on 8787;
- private inputs/results use ignored directories;
- CER/WER use `ocr-text-metrics-v1`;
- 20-40 samples are only a direction-decision set;
- no real sample metrics are claimed until the user explicitly runs and reviews the private benchmark.

Do not paste any essay, reference, image filename, absolute path, or student identity.

- [ ] **Step 2: Update current development status**

Add a top entry to `docs/current_development_status.md` only after verification passes. State exactly what was implemented and retain these negatives:

```text
未新增 normalizedText、自动断词合并、字符级 correctionEvents、可见质量卡片、自动放行、AI OCR、Provider 更换或真实 AI 批改。
```

State that the app remains in-memory and that the private benchmark was not run against real samples during automated verification.

- [ ] **Step 3: Run complete frontend verification**

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/services/ocr/audit
npm.cmd test -- src/context/AppStateContext.test.tsx
npm.cmd test -- src/pages/UploadPage.test.tsx
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Expected: all focused and full frontend tests pass, lint exits 0, and build exits 0.

- [ ] **Step 4: Run complete Gateway verification**

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd run test:benchmark
npm.cmd test
npm.cmd run typecheck
```

Expected: all benchmark and Gateway tests pass and typecheck exits 0 without starting real PaddleOCR.

- [ ] **Step 5: Run privacy and Provider-boundary scans**

```powershell
cd D:\wenjie-writewise-ai
rg "PaddleOCR|paddle_local|PADDLE_OCR|Python runner|NodePaddleRunner|PaddleLocalOcrProvider" app/src --glob "!**/*.test.*"
rg -n "listen\(|8787" ocr-gateway/scripts/privateOcrBenchmark
rg -n "sourceText|confirmedTranscript|referenceText|absolutePath|originalName" ocr-gateway/scripts/privateOcrBenchmark
git status --short
git diff --stat
git diff
```

Expected:

- frontend production scan has no Provider-specific matches;
- benchmark has no HTTP listener;
- any `sourceText`/`referenceText` matches are in-memory variables only and are not assigned to anonymous result objects or logs;
- `originalName` is a generated anonymous page name, never the private source filename;
- no `local-private-samples/`, `local-private-results/`, `.env`, `.venv`, model cache, log, OCR JSON, or `app/dist` file is staged.

- [ ] **Step 6: Inspect the final staged scope**

Stage only the two documentation files after all prior task commits:

```powershell
cd D:\wenjie-writewise-ai
git add docs/ocr_provider_evaluation_paddle_v02.md docs/current_development_status.md
git diff --cached --name-only
git diff --cached --check
git diff --cached
```

Expected: only the two documentation files are staged and no private content appears.

- [ ] **Step 7: Commit Task 6**

```powershell
git commit -m "docs: record ocr audit benchmark status"
```

- [ ] **Step 8: Final branch audit without push**

```powershell
cd D:\wenjie-writewise-ai
git status --short --branch
git log --oneline --decorate -8
git diff origin/codex/real-ocr-gateway-v01...HEAD --stat
```

Expected: working tree is clean, only intentional task commits are ahead of the remote branch, and no push has occurred.

## Execution Stop Conditions

Stop implementation and ask the user before continuing if any of these occur:

- a real private sample must be read to make an automated test pass;
- a test or tool would print essay/reference text or an absolute path;
- the benchmark requires an HTTP server or persistent machine configuration;
- Vite or NodeNext cannot safely import the shared pure metric module without adding a new package boundary;
- preserving `ocrText` compatibility would require changing visible teacher behavior;
- a hidden shadow assessment becomes visible in any UI snapshot;
- an unexpected file, sample, credential, environment file, cache, build output, or log appears in staged changes;
- implementation would require AI OCR, Provider replacement, automatic text correction, or automatic pass behavior.

## Implementation Completion Report

After execution, report only:

1. files changed and commits created;
2. source/confirmed/compatibility lifecycle behavior;
3. shadow assessment inputs and page-ID missing detection;
4. fixed metric versions and test coverage;
5. benchmark TypeScript/typecheck/test inclusion;
6. fixed exit-code behavior;
7. privacy and Provider-boundary scan results;
8. focused/full test, lint, build, and typecheck results;
9. Git status and whether anything was pushed;
10. explicit confirmation that no real private sample was read during automated implementation and verification.
