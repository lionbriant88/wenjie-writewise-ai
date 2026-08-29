# AI Class Review Local Functional Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变逐篇 `kimi-k3` 多模态批改合同的前提下，完成可自动化验证的班级总览本地功能原型：确定性成绩/问题/明确拼写聚合、一次 fake synthesis、教师编辑与排序、单篇加入/移出、严格合同、安全投影、共享 Gateway 准入和单页交互。

**Architecture:** React 侧新增一个明确标注为本地原型的内存 `ClassReviewCoordinator`，在当前会话中承担快照、report workspace、generation registry 和确定性合并；它只把去身份化、有界的 `class-review-synthesis-request-v1` 交给注入式 fake synthesis client。Grading Gateway 独立实现同一内部合同、Kimi strict Schema、一次 completion 和共享 admission，但浏览器不直接调用内部路由。两边通过合同 fixture 验证一致性；持久化、认证、租户和多实例保证留给独立商业基础设施计划。

**Tech Stack:** React 19、TypeScript 6、Vite 8、Vitest 4、Testing Library、Express 4、Multer 2、Node `crypto`、Kimi Chat Completions strict JSON Schema；自动化与本地验收只使用 fake/loopback，不调用真实 Kimi。

**Spec:** [AI 班级总览生成与共性问题沉淀设计](../specs/2026-08-29-ai-class-review-generation-design.md)

## Global Constraints

- 每个实施回合在规划、命令或编辑前，完整阅读仓库根目录 `AGENTS.md` 与 `docs/current_development_status.md`，并在进度说明中复述当轮相关核心决策。
- 逐篇主流程继续使用 `multimodal-grading-request-v2`、`grading-result-v2` 和 `POST /grading/grade-images`；不得启动、接入或建议 OCR Gateway，不得把多名学生合并进一次逐篇评分请求。
- 班级总结只在逐篇队列 settled 且 `N_success >= 2` 后由教师显式触发。正常 generation 恰好一次 synthesis completion；统计、拼写、查看、排序、双击、重挂、apply 和 discard 都是零 completion。
- 普通共性问题门槛固定为 `max(N_issue < 10 ? 2 : 3, ceil(N_issue * 0.2))`。同一作文同一原子组只计一名学生，出现次数单独累计；问题通道不完整的 partial 只进入成绩通道，不进入 `N_issue`。
- 明确拼写只接受 certain、单词级、修正唯一、无字迹歧义且无需教师复核的 `spelling`，以及通过同一严格规则的近形 `word_choice`（包括合格的 `filling -> feeling`）；语义改写、远距离替换、重叠问题、多词或整句改写必须拒绝。
- 原题材料、学生图片、作文全文、姓名、班级/任务名、普通业务 ID、完整逐篇结果、教师备注和精选素材不得进入班级 Prompt。人数、比例、次数、排序和例句由确定性代码计算，不能由模型声明。
- Prompt 采用 `class-review-prompt-budget-v1`：可控 payload 最多 15,872 tokens，总 Prompt 最多 16,384 tokens并预留至少 512 framing tokens；v1 准入计数固定取 `max(modelTokenizerCount, utf8ByteCount)`。真实 framing 校准尚未完成时 Kimi 班级 synthesis 必须 fail closed。
- 页面收口为一个纵向工作页，不保留旧四 Tab、不默认生成改写练习、不增加独立“主要不足”“教学重点”或 pinned 状态；教师排序就是重难点顺序。
- 教师精选素材继续独立存在，不能与班级 issue block 混为一种实体。现有包含原句的 `ClassReviewMaterial` key 只允许作为本地迁移兼容，不得成为生产 topic/ID。
- 本计划完成后只能称为“已实现并验证的本地功能原型”。页面与文档必须明确刷新、重启、多设备、权限和长期保存不受保证。
- 所有测试、fixture、日志和验收数据使用合成内容。未经单独确认样本、调用数和费用，不读取本地 Key、不发送真实学生数据、不运行真实 Kimi。

## Shared Execution Guard

- 每个 Task 开始前都从仓库根目录执行以下 guard；若有不属于当前 Task `Files` 清单的改动，立即停止并先与用户确认，绝不覆盖、格式化或暂存它们。
- 每个命令块都必须自行解析 `$repoRoot`，不得依赖上一个 Step 遗留的当前目录。RED 之前先确认该 package 的既有测试工具链可运行；新 package 必须先 scaffold/安装测试工具链，再写首个有意义的 failing test。
- 每次提交前执行 `git diff --name-only` 与 `git diff --cached --name-only`，逐项等于当前 Task `Files` 清单中的实际改动；只用完整文件路径暂存，不使用目录、glob 或 `git add -A`。

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location $repoRoot
$unexpected = git status --short
if ($unexpected) { $unexpected; throw 'Dirty worktree: classify every existing change before this Task.' }
```

## File Structure

### Browser domain and prototype coordinator

- Create `app/src/services/classReview/types.ts`.
- Create `app/src/services/classReview/classReviewContracts.ts` and test.
- Create `app/src/services/classReview/synthesisContracts.ts` and test.
- Create `app/src/services/classReview/aggregateClassReview.ts` and test.
- Create `app/src/services/classReview/classReviewSpelling.ts` and test.
- Create `app/src/services/classReview/classReviewTopicKey.ts` and test.
- Create `app/src/services/classReview/classReviewRedaction.ts` and test.
- Create `app/src/services/classReview/classReviewProjection.ts` and test.
- Create `app/src/services/classReview/classReviewMerge.ts` and test.
- Create `app/src/services/classReview/classReviewRegistry.ts` and test.
- Create `app/src/services/classReview/classReviewCoordinator.ts` and test.
- Create `app/src/services/classReview/fakeClassReviewSynthesisClient.ts` and test.
- Create `app/src/services/classReview/classReviewTelemetry.ts` and test.
- Create `app/src/services/classReview/classReviewRuntimeConfig.ts` and test.
- Create `test-fixtures/class-review/browser-contracts.json` and `test-fixtures/class-review/synthesis-contracts.json` as the one shared fixture source.
- Create `app/src/services/classReview/fixtures/loadContractFixtures.ts`; App and Gateway tests load the same root JSON fixtures instead of copying them.

### Gateway internal synthesis boundary

- Create `grading-gateway/src/classReviewSynthesis/types.ts`.
- Create `grading-gateway/src/classReviewSynthesis/validateRequest.ts` and test.
- Create `grading-gateway/src/classReviewSynthesis/providerContract.ts` and test.
- Create `grading-gateway/src/classReviewSynthesis/prompt.ts` and test.
- Create `grading-gateway/src/classReviewSynthesis/limits.ts` and test.
- Create `grading-gateway/src/classReviewSynthesis/promptBudget.ts` and test.
- Create `grading-gateway/src/classReviewSynthesis/promptCacheKey.ts` and test.
- Create `grading-gateway/src/classReviewSynthesis/framingCalibrations.ts` and test.
- Create `grading-gateway/src/classReviewSynthesis/serviceAuth.ts` and test.
- Create `grading-gateway/src/classReviewSynthesis/service.ts` and test.
- Create `grading-gateway/src/classReviewSynthesis/runtimeInvariant.ts` and test.
- Create `grading-gateway/src/providers/kimiClassReviewProvider.ts` and test.
- Create `grading-gateway/src/providers/classReviewSynthesisProviderTypes.ts`.
- Modify `grading-gateway/src/providers/providerTypes.ts`.
- Modify `grading-gateway/src/providers/index.ts` and test.
- Modify `grading-gateway/src/providerTelemetry.ts` and test.
- Modify `grading-gateway/src/gatewayRuntimeConfig.ts` and test.
- Modify `grading-gateway/src/server.ts` and test.
- Modify `grading-gateway/src/index.ts`.
- Modify `grading-gateway/scripts/runFakeAcceptanceGateway.ts` and test.

### React state and interaction

- Modify `app/src/types/index.ts`.
- Modify `app/src/context/appStateContextValue.ts`.
- Modify `app/src/context/AppStateContext.tsx`.
- Create `app/src/context/AppStateContext.classReview.test.tsx`.
- Modify `app/src/components/IssueCorrectionList.tsx` and create `app/src/components/IssueCorrectionList.test.tsx`.
- Create `app/src/components/ClassReviewReportPanel.tsx` and test.
- Create `app/src/components/ClassReviewGenerationStatus.tsx` and test.
- Create `app/src/components/ClassReviewIssueList.tsx` and test.
- Create `app/src/components/ClassReviewSpellingList.tsx` and test.
- Modify `app/src/components/ClassReviewMaterialsPanel.tsx` and create `app/src/components/ClassReviewMaterialsPanel.test.tsx`.
- Rewrite `app/src/pages/ClassReviewPage.tsx` and `ClassReviewPage.test.tsx`.
- Modify `app/src/pages/EssayResultPage.tsx` and `EssayResultPage.test.tsx`.
- Modify `app/src/pages/ProgressPage.tsx` and `ProgressPage.test.tsx`.
- Modify `app/src/utils/classOverview.ts` and test.
- Modify `app/src/utils/classReviewMaterials.ts` and test.
- Modify `app/.env.example`.
- Modify `grading-gateway/.env.example`.
- Modify `docs/current_development_status.md` only after all prototype gates pass.

---

## Task 1: Define exact browser contracts and local domain types

**Files:**

- Create: `app/src/services/classReview/types.ts`
- Create: `app/src/services/classReview/classReviewContracts.ts`
- Create: `app/src/services/classReview/classReviewContracts.test.ts`
- Create: `app/src/services/classReview/synthesisContracts.ts`
- Create: `app/src/services/classReview/synthesisContracts.test.ts`
- Create: `test-fixtures/class-review/browser-contracts.json`
- Create: `test-fixtures/class-review/synthesis-contracts.json`
- Create: `app/src/services/classReview/fixtures/loadContractFixtures.ts`
- Modify: `app/src/types/index.ts`

**Interfaces:**

- Produces exact-key parsers for `class-review-generation-command-v1`, `class-review-generation-status-v1` and `class-review-report-v1`.
- Produces discriminated unions for report states `none | draft | ai_available | ai_removed` and generation states `queued | running | result_unknown | succeeded | succeeded_unapplied | failed | discarded | invalidated`.
- Adds local `resultRevision?: number` to `GradingResult`; legacy fixtures normalize missing revision to `0`, while every subsequent teacher edit increments it.

- [ ] **Step 1: Write failing exact-key and discriminated-union tests**

```ts
const validRegenerate = browserFixtures.commands.regenerate
expect(parseClassReviewGenerationCommand({
  ...validRegenerate,
  expectedReportRevision: null, // the only illegal field/value
}).ok).toBe(false)

const validNone = browserFixtures.reports.none
expect(parseClassReviewReport({
  ...validNone,
  appliedGenerationId: 'forbidden', // the only illegal field
}).ok).toBe(false)
```

Cover every legal variant and reject unknown keys, non-integer revisions, `regenerate + null`, state-specific fields on the wrong state, missing `currentGeneration`, and `ai_available` missing any required AI snapshot field.

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/services/classReview/classReviewContracts.test.ts src/services/classReview/synthesisContracts.test.ts
```

Expected: FAIL because the types and parsers do not exist.

- [ ] **Step 3: Implement JSON-safe types and constant-memory boundary helpers**

Use `hasOnlyKeys`, well-formed Unicode, early-exit code-point counting, integer guards and explicit union branches. Do not use unchecked type assertions at HTTP or storage boundaries. Keep issue IDs, generation IDs and topic keys opaque; no raw sentence may be embedded in an ID.

- [ ] **Step 4: Add canonical positive and negative fixtures**

Store `none`, `draft`, `ai_available`, `ai_removed`, every generation state and all four command intents in `browser-contracts.json`; only App/business-contract tests read it. Store internal request/result examples in `synthesis-contracts.json`; App synthesis boundary tests and Gateway tests parse those exact same bytes. Every negative case mutates exactly one otherwise-valid fixture and asserts a fixed error code/path so a pass proves the intended rule. All fixtures are synthetic.

- [ ] **Step 5: Run focused tests and typecheck**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/services/classReview/classReviewContracts.test.ts src/services/classReview/synthesisContracts.test.ts src/data/mockData.test.ts
npm.cmd run typecheck
```

Expected: PASS; existing grading types still compile.

- [ ] **Step 6: Commit Task 1**

```powershell
$repoRoot = git rev-parse --show-toplevel
git -C $repoRoot add -- app/src/types/index.ts app/src/services/classReview/types.ts app/src/services/classReview/classReviewContracts.ts app/src/services/classReview/classReviewContracts.test.ts app/src/services/classReview/synthesisContracts.ts app/src/services/classReview/synthesisContracts.test.ts app/src/services/classReview/fixtures/loadContractFixtures.ts test-fixtures/class-review/browser-contracts.json test-fixtures/class-review/synthesis-contracts.json
git -C $repoRoot commit -m "feat: define class review prototype contracts"
```

---

## Task 2: Implement deterministic aggregation and the strict spelling channel

**Files:**

- Create: `app/src/services/classReview/aggregateClassReview.ts`
- Create: `app/src/services/classReview/aggregateClassReview.test.ts`
- Create: `app/src/services/classReview/classReviewSpelling.ts`
- Create: `app/src/services/classReview/classReviewSpelling.test.ts`
- Modify: `app/src/utils/classOverview.ts`
- Modify: `app/src/utils/classOverview.test.ts`

**Interfaces:**

```ts
aggregateClassReviewSnapshot(input: {
  task: Task
  essays: readonly Essay[]
  results: readonly GradingResult[]
}): ClassReviewAggregate

classReviewSupportThreshold(issueEligibleEssayCount: number): number
classifyDefiniteSpellingCandidate(input: SpellingCandidateInput): DefiniteSpellingItem | null
```

- [ ] **Step 1: Write failing threshold, denominator and occurrence tests**

Cover `N_issue=2 -> 2`, `9 -> 2`, `10 -> 3`, ceiling at 20%, duplicate issues in one essay counting one student, repeated occurrences counting separately, valid partial results entering `N_success` but not `N_issue`, failed/manual essays excluded, and a legal empty common-issue result.

- [ ] **Step 2: Write failing spelling certainty tests**

Accept a certain `feelling -> feeling` spelling correction and a certain near-form `filling -> feeling` word choice only when merging `sentenceRevisions` with `sentencePairs` yields exactly one legal source-location association and one single-token change exactly equal to the issue original/correction. A `spelling` candidate may not overlap grammar/word-choice; a near-form `word_choice` may not overlap grammar/spelling; neither path may overlap logic, presentation, handwriting or recognition warnings. For `word_choice`, require two legal English tokens, `maxLength >= 4`, and versioned unrestricted Damerau–Levenshtein over Unicode code points `<= min(2, floor(maxLength / 3))`; test adjacent transposition plus equality/+1 at lengths 4, 6 and 9. Reject missing/multiple associations, uncertainty/review flags, multiple targets, attached punctuation/case changes, multi-token/sentence changes and distant semantic replacement.

- [ ] **Step 3: Run tests and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/services/classReview/aggregateClassReview.test.ts src/services/classReview/classReviewSpelling.test.ts src/utils/classOverview.test.ts
```

- [ ] **Step 4: Implement one-pass result indexing and separated denominators**

Build maps by essay/result once. Derive score bands and rubric dimension means from `N_success`; derive problem groups only from issue-complete results. Return explicit `totalEssayCount`, `includedEssayCount`, `issueEligibleEssayCount`, `excludedEssayCount`, `partialIssueChannelCount` and exclusion reasons.

- [ ] **Step 5: Implement conservative single-token spelling classification**

Normalize only Unicode NFKC, surrounding/duplicate whitespace and English case for comparison. Require a unique aligned correction and single English tokens containing letters plus only internal apostrophe/hyphen. Implement the exact versioned unrestricted Damerau–Levenshtein predicate above only as an eligibility test for already-returned `word_choice`; it must never invent a correction target. Spelling aggregation fingerprints use normalized original, correction and source subtype—not edit distance—so near forms are never merged across items. Do not introduce dictionaries, OCR, embeddings or semantic guesses.

- [ ] **Step 6: Run focused tests**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/services/classReview/aggregateClassReview.test.ts src/services/classReview/classReviewSpelling.test.ts src/utils/classOverview.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```powershell
$repoRoot = git rev-parse --show-toplevel
git -C $repoRoot add -- app/src/services/classReview/aggregateClassReview.ts app/src/services/classReview/aggregateClassReview.test.ts app/src/services/classReview/classReviewSpelling.ts app/src/services/classReview/classReviewSpelling.test.ts app/src/utils/classOverview.ts app/src/utils/classOverview.test.ts
git -C $repoRoot commit -m "feat: aggregate class review evidence deterministically"
```

---

## Task 3: Add opaque topic keys and content-level redaction

**Files:**

- Create: `app/src/services/classReview/classReviewTopicKey.ts`
- Create: `app/src/services/classReview/classReviewTopicKey.test.ts`
- Create: `app/src/services/classReview/classReviewRedaction.ts`
- Create: `app/src/services/classReview/classReviewRedaction.test.ts`

**Interfaces:**

```ts
deriveAtomicTopicKey(input: AtomicTopicFingerprint, hmac: TopicHmac): Promise<TopicIdentity>
deriveCompositeTopicKey(members: readonly TopicIdentity[], hmac: TopicHmac): Promise<TopicIdentity>
redactClassReviewExcerpt(input: RedactionInput): RedactionResult
```

- [ ] **Step 1: Write failing topic identity tests**

Assert single-member composite equals its atomic identity; duplicate/sorted member sets are stable; changed membership yields a new key; the same atomic evidence is stable across generations. Reject members with mixed task scopes or key versions. When a test HMAC forces the same shortened key for different canonical fingerprint digests, derive a separate collision-suffixed opaque key and never auto-merge. The atomic canonical fingerprint includes `topic-key-v1`, injected opaque task scope, type/subtype/changeTypes and exact normalized correction/signature; identical evidence in two task scopes differs. Neither key nor digest exposes raw task/essay ID or source text.

- [ ] **Step 2: Write failing redaction tests**

Cover student/default-label/teacher/class/school/task names, email, phone, student or identity number, social account, URL, continuous identity digits, deterministic person/entity hits, uncertain entity detection and prompt-injection phrases. Exact known-name/structured-PII/certain-entity spans may be replaced with one fixed placeholder only when the evidence remains meaningful; uncertain entities, instruction-like text, residual planted identifiers or meaning-destroying replacement omit the whole visible excerpt. Every omission keeps the hidden evidence ref, leaves the group eligible, excludes it from projected coverage and never includes source text in logs/errors.

- [ ] **Step 3: Run tests and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/services/classReview/classReviewTopicKey.test.ts src/services/classReview/classReviewRedaction.test.ts
```

- [ ] **Step 4: Implement HMAC-SHA-256 keys through a browser-safe injected crypto adapter**

The domain function receives an async `TopicHmac` adapter and an opaque task-scope component derived through that adapter; tests inject a deterministic fake and the coordinator injects Web Crypto. Canonical fingerprints contain version, opaque task scope, type/subtype/change-type and exact normalized correction/signature. Never concatenate a raw task ID or raw source text into returned IDs/digests.

- [ ] **Step 5: Implement `class-review-redaction-v1` as a fail-closed pipeline**

Inject a versioned local `PersonEntityDetector` and apply exact known-name dictionaries first, then structured PII patterns, then entity detection. Omit—not strip—any injection-bearing, uncertain or residually unsafe excerpt. Return `{ status: 'kept', text, redactionVersion, scrubbedEvidenceKey } | { status: 'omitted', reason, redactionVersion }`; reasons are fixed enums and never contain rejected text. Projection and later UI example materialization must reuse the same kept `text`/`scrubbedEvidenceKey`; no later layer reopens raw source text to recreate an “anonymous” example.

- [ ] **Step 6: Run focused tests and commit**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/services/classReview/classReviewTopicKey.test.ts src/services/classReview/classReviewRedaction.test.ts
git -C $repoRoot add -- app/src/services/classReview/classReviewTopicKey.ts app/src/services/classReview/classReviewTopicKey.test.ts app/src/services/classReview/classReviewRedaction.ts app/src/services/classReview/classReviewRedaction.test.ts
git -C $repoRoot commit -m "feat: derive opaque class topics and redact evidence"
```

---

## Task 4: Build bounded authoritative projection before synthesis

**Files:**

- Create: `app/src/services/classReview/classReviewProjection.ts`
- Create: `app/src/services/classReview/classReviewProjection.test.ts`
- Modify: `app/src/services/classReview/types.ts`

**Interfaces:**

```ts
buildClassReviewProjection(input: {
  aggregate: ClassReviewAggregate
  redactionContext: RedactionContext
  limits: ClassReviewProjectionLimits
}): ClassReviewProjectionResult
```

- [ ] **Step 1: Write failing projection ordering and coverage tests**

Cover the exact selector order `mustCover first -> repeated support -> type/severity strata -> distinct-essay round-robin -> stable atomic key`, at most 64 atomic groups and exactly zero or one representative excerpt per group. Require `mustCover` on every atomic group that independently reaches the common threshold; budget/redaction omissions remain eligible and are queued for deterministic fallback. Assert generation-local dimension/group aliases and that no ordinary task/essay/result ID appears.

- [ ] **Step 2: Write exact byte and payload boundary tests**

Test equality and plus-one independently for: 10 rubric dimensions, 20 score bands, at most 32 fixed issue/severity counter entries total (the literal `other` consumes one of those 32 slots), 8 KiB statistics JSON, 64 groups and 32 KiB evidence JSON. Test 160-code-point original excerpt, 160-code-point suggestion/diagnosis, 48-code-point title/type and 360-code-point per-group visible total at equality/+1 without splitting surrogate pairs. Dynamic labels are rejected. Also cover zero eligible groups and “eligible groups exist but none fit” returning `class_review_projection_too_large` before a synthesis client call. The 16 KiB fixed-prefix and 48 KiB final-message limits are intentionally tested only against actual serialized messages/schema in Task 6.

- [ ] **Step 3: Run and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/services/classReview/classReviewProjection.test.ts
```

- [ ] **Step 4: Implement deterministic projection without token claims**

The browser-side prototype enforces the request-side structural/code-point/statistics/evidence limits and records a three-part `semanticCoverage`: `(projectedGroupCount, eligibleGroupCount, groupCoverage)`, projected/all distinct-essay-support sums with `supportWeightedCoverage`, and projected/all occurrence sums with `occurrenceWeightedCoverage`. Support/occurrence are signal weights, never students covered. Selection order is `mustCover -> repeated support -> fixed type/severity strata -> distinct-essay round-robin -> stable atomic key`; accept groups in that order until the next group would cross the request-side group/evidence budget, then stop—no random skip and no recompression of accepted text. It makes no final Kimi token/prefix claim; Gateway owns actual serialized message/schema admission. Every unprojected `mustCover` remains in hidden coordinator state for Task 8 fallback, using a fixed safe template when no visible excerpt survives.

- [ ] **Step 5: Run tests and commit**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/services/classReview/classReviewProjection.test.ts
git -C $repoRoot add -- app/src/services/classReview/classReviewProjection.ts app/src/services/classReview/classReviewProjection.test.ts app/src/services/classReview/types.ts
git -C $repoRoot commit -m "feat: bound class review synthesis projection"
```

---

## Task 5: Add Gateway strict internal request and Provider output contracts

**Files:**

- Create: `grading-gateway/src/classReviewSynthesis/types.ts`
- Create: `grading-gateway/src/classReviewSynthesis/validateRequest.ts`
- Create: `grading-gateway/src/classReviewSynthesis/validateRequest.test.ts`
- Create: `grading-gateway/src/classReviewSynthesis/providerContract.ts`
- Create: `grading-gateway/src/classReviewSynthesis/providerContract.test.ts`
- Create: `grading-gateway/src/providers/classReviewSynthesisProviderTypes.ts`
- Modify: `grading-gateway/src/providers/index.ts`
- Modify: `grading-gateway/src/providers/index.test.ts`
- Read: `test-fixtures/class-review/synthesis-contracts.json`

**Interfaces:**

```ts
validateClassReviewSynthesisRequest(value: unknown): ValidationResult<ClassReviewSynthesisRequestV1>
validateClassReviewProviderOutput(value: unknown, request: ClassReviewSynthesisRequestV1): ValidationResult<ClassReviewProviderOutputV1>

interface ClassReviewSynthesisProvider {
  synthesize(input: ClassReviewSynthesisProviderInput): Promise<ProviderCallResult<ClassReviewProviderOutputV1>>
}
```

- [ ] **Step 1: Write failing request exact-key tests**

Reject unknown fields, browser task/essay/result IDs, names, images, Base64, material text, full transcripts, full grading results, teacher notes, unbounded strings, duplicate aliases and unknown dimension/group aliases. Defensively repeat internal request boundaries: 10 dimensions, 20 score bands, at most 32 fixed counters total including `other`, 8 KiB statistics, 64 groups, one excerpt/group, 160/160/48/360 code points and 32 KiB evidence. Each has equality/+1 fixtures. Accept a pure-statistics request with zero groups. Do not claim the validator has checked the not-yet-built fixed prefix or final Provider message; Task 6 performs those checks after serialization.

- [ ] **Step 2: Write failing output tests**

Require exact `kimi-class-review-output-v1` keys, known aliases only and unique group ownership. Test every equality/+1 bound: `overallComment <= 300`; `strengths` 1–3 with title 40, detail 120 and 0–3 known `dimensionIds`; `patterns` 0–8 with title 40, diagnosis 100, teachingAction 100 and 1–12 known `groupIds`; `learningRecommendations` 1–3 with title 40 and action 120; all visible strings <=2,200 code points; JSON <=16 KiB. Reject model-generated counts, percentages, examples, database IDs, ordering/source fields, `weaknesses`, `teachingPriorities`, rewrite exercises and per-essay feedback.

- [ ] **Step 3: Write failing independent Provider-factory tests**

In `grading-gateway/src/providers/index.test.ts`, prove the class-review factory is typed only as `ClassReviewSynthesisProvider`, does not change the essay/material/rubric `MultimodalProvider`, rejects unknown class modes and never silently selects fake. These tests must fail on the missing independent factory branch, not on fixture or module resolution.

- [ ] **Step 4: Run and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'grading-gateway')
npm.cmd test -- src/classReviewSynthesis/validateRequest.test.ts src/classReviewSynthesis/providerContract.test.ts src/providers/index.test.ts
```

- [ ] **Step 5: Implement independent internal and Provider schemas**

Do not reuse browser business contract names or `grading-result-v2`. Define the separate `ClassReviewSynthesisProvider.synthesize(...)` interface and factory branch; leave the existing essay/material/rubric `MultimodalProvider` and `GradeEssayProviderInput` unchanged. Both App and Gateway parser suites load the same root synthesis fixture bytes and fail if either accepts a different shape.

- [ ] **Step 6: Run focused tests and typecheck**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'grading-gateway')
npm.cmd test -- src/classReviewSynthesis/validateRequest.test.ts src/classReviewSynthesis/providerContract.test.ts src/providers/index.test.ts
npm.cmd run typecheck
```

- [ ] **Step 7: Commit Task 5**

```powershell
$repoRoot = git rev-parse --show-toplevel
git -C $repoRoot add -- grading-gateway/src/classReviewSynthesis/types.ts grading-gateway/src/classReviewSynthesis/validateRequest.ts grading-gateway/src/classReviewSynthesis/validateRequest.test.ts grading-gateway/src/classReviewSynthesis/providerContract.ts grading-gateway/src/classReviewSynthesis/providerContract.test.ts grading-gateway/src/providers/classReviewSynthesisProviderTypes.ts grading-gateway/src/providers/index.ts grading-gateway/src/providers/index.test.ts
git -C $repoRoot commit -m "feat: validate class review synthesis contracts"
```

---

## Task 6: Implement prompt budget and one-shot Kimi synthesis provider

**Files:**

- Create: `grading-gateway/src/classReviewSynthesis/prompt.ts`
- Create: `grading-gateway/src/classReviewSynthesis/prompt.test.ts`
- Create: `grading-gateway/src/classReviewSynthesis/limits.ts`
- Create: `grading-gateway/src/classReviewSynthesis/limits.test.ts`
- Create: `grading-gateway/src/classReviewSynthesis/promptBudget.ts`
- Create: `grading-gateway/src/classReviewSynthesis/promptBudget.test.ts`
- Create: `grading-gateway/src/classReviewSynthesis/promptCacheKey.ts`
- Create: `grading-gateway/src/classReviewSynthesis/promptCacheKey.test.ts`
- Create: `grading-gateway/src/classReviewSynthesis/framingCalibrations.ts`
- Create: `grading-gateway/src/classReviewSynthesis/framingCalibrations.test.ts`
- Create: `grading-gateway/src/providers/kimiClassReviewProvider.ts`
- Create: `grading-gateway/src/providers/kimiClassReviewProvider.test.ts`
- Modify: `grading-gateway/src/providers/index.ts`
- Modify: `grading-gateway/src/providers/index.test.ts`
- Modify: `grading-gateway/src/providers/providerTypes.ts`

**Interfaces:**

```ts
preflightClassReviewPrompt(input: {
  messages: readonly KimiMessage[]
  schema: unknown
  tokenizer?: { count(serializedControllablePayload: string): number }
  calibration: ClassReviewFramingCalibration | null
}): ClassReviewPromptBudgetResult

deriveClassReviewPromptCacheKey(input: {
  hmacSecret: string
  rubricRevisionDigest: string
  policyVersion: string
  schemaVersion: string
  projectionVersion: string
}): string

class KimiClassReviewProvider implements ClassReviewSynthesisProvider {
  synthesize(input: ClassReviewSynthesisProviderInput): Promise<ProviderCallResult<ClassReviewProviderOutputV1>>
}
```

- [ ] **Step 1: Write failing budget tests**

Define one constant module: `CONTROLLABLE_PROMPT_TOKENS_V1=15_872`, `FRAMING_RESERVE_TOKENS_V1=512`, `TOTAL_PROMPT_TOKENS_V1=16_384`, `MAX_COMPLETION_TOKENS_V1=3_072`, fixed prefix 16 KiB and final Provider text 48 KiB. Against the actual serialized `messages + schema + wire text`, test equality/+1 for 16 KiB prefix, 48 KiB final text, 15,872 controllable tokens and 16,384 total; defeat tokenizer undercount with the UTF-8 byte branch. Fixed prefix too large returns `class_review_prompt_too_large`, no group fitting returns `class_review_projection_too_large`, and missing real framing calibration rejects before `transport.complete`.

- [ ] **Step 2: Write failing prompt-cache-key derivation tests**

Define the canonical tuple exactly as `["class-review-prompt-cache-key-v1", rubricRevisionDigest, policyVersion, schemaVersion, projectionVersion]`, JSON-serialize it in that fixed order and derive a 43-character base64url HMAC-SHA-256 with the existing `GRADING_PROMPT_CACHE_HMAC_SECRET`. Assert stable output for identical tuples and a different output when any of the four revisions changes. The input and output must contain no task/tenant/teacher/student ID, task/class/name, excerpt, evidence or other personal/business content; adding or changing such excluded values cannot be an API option. Missing, blank or fewer than 32 UTF-8 bytes of secret in real Kimi mode fails closed before Provider admission or transport. The cache key is only a Provider prefix-cache hint: it is never an execution identity, generation ID, payload hash or registry key, and cache availability/hit/miss cannot change correctness or call-count decisions.

- [ ] **Step 3: Write failing provider call-count tests**

With a fake transport, injected test calibration and test-only HMAC secret, assert one `complete()` call, stage `class_review_generation`, `reasoning_effort=low`, `maxCompletionTokens=3072`, exact schema name, the derived opaque prompt cache key and no hidden review/repair. Two separately authorized generation executions with the same cache key still make two calls; duplicate attach/lookup behavior is governed only by execution/generation identity and never by this key. Type-check fake and Kimi implementations against the separate interface. Test essay Kimi + class disabled, essay mock + class fake, class Kimi missing key secret, and class Kimi missing calibration; none may silently choose fake. Truncated, unknown finish reason, tool call, content filter, malformed JSON and illegal alias each fail without a second call.

- [ ] **Step 4: Run and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'grading-gateway')
npm.cmd test -- src/classReviewSynthesis/prompt.test.ts src/classReviewSynthesis/limits.test.ts src/classReviewSynthesis/promptBudget.test.ts src/classReviewSynthesis/promptCacheKey.test.ts src/classReviewSynthesis/framingCalibrations.test.ts src/providers/kimiClassReviewProvider.test.ts src/providers/index.test.ts
```

- [ ] **Step 5: Build stable policy-first messages and derive the cache key**

Place versioned policy, output constraints, strict Schema and stable statistics before variable evidence. Use only generation-local aliases. Derive `prompt_cache_key` from the fixed revision-only canonical tuple with `GRADING_PROMPT_CACHE_HMAC_SECRET`; never add task, tenant, teacher, student, name, excerpt or ordinary business ID to that tuple. Pass the opaque result only to Provider transport and keep all idempotency/execution decisions independent. The Provider prompt asks for summary prose and controlled group selections; it never asks for counts, examples, student-level judgements or a second critique. `getClassReviewSynthesisProvider()` reads only `CLASS_REVIEW_SYNTHESIS_MODE` and produces the independent provider; `CreateServerOptions` injects it separately from the unchanged essay/material/rubric `MultimodalProvider`.

- [ ] **Step 6: Implement fail-closed calibration and secret requirements**

Ship no production-verified Kimi framing entry in this plan. Unit tests inject a synthetic calibration; fake mode is allowed. Real `kimi` class synthesis returns/config-fails with `class_review_prompt_calibration_missing` until the integration/release plan records an authorized current-model calibration. It also requires the already-established `GRADING_PROMPT_CACHE_HMAC_SECRET` to contain at least 32 UTF-8 bytes; missing, blank or shorter input returns a content-free configuration failure before admission/transport and never falls back to an unhashed or ordinary-ID key.

- [ ] **Step 7: Run focused tests and typecheck**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'grading-gateway')
npm.cmd test -- src/classReviewSynthesis/prompt.test.ts src/classReviewSynthesis/limits.test.ts src/classReviewSynthesis/promptBudget.test.ts src/classReviewSynthesis/promptCacheKey.test.ts src/classReviewSynthesis/framingCalibrations.test.ts src/providers/kimiClassReviewProvider.test.ts src/providers/index.test.ts
npm.cmd run typecheck
```

- [ ] **Step 8: Commit Task 6**

```powershell
$repoRoot = git rev-parse --show-toplevel
git -C $repoRoot add -- grading-gateway/src/classReviewSynthesis/prompt.ts grading-gateway/src/classReviewSynthesis/prompt.test.ts grading-gateway/src/classReviewSynthesis/limits.ts grading-gateway/src/classReviewSynthesis/limits.test.ts grading-gateway/src/classReviewSynthesis/promptBudget.ts grading-gateway/src/classReviewSynthesis/promptBudget.test.ts grading-gateway/src/classReviewSynthesis/promptCacheKey.ts grading-gateway/src/classReviewSynthesis/promptCacheKey.test.ts grading-gateway/src/classReviewSynthesis/framingCalibrations.ts grading-gateway/src/classReviewSynthesis/framingCalibrations.test.ts grading-gateway/src/providers/kimiClassReviewProvider.ts grading-gateway/src/providers/kimiClassReviewProvider.test.ts grading-gateway/src/providers/index.ts grading-gateway/src/providers/index.test.ts grading-gateway/src/providers/providerTypes.ts
git -C $repoRoot commit -m "feat: synthesize class review in one bounded completion"
```

---

## Task 7: Expose an authenticated internal route on shared admission

**Files:**

- Create: `grading-gateway/src/classReviewSynthesis/serviceAuth.ts`
- Create: `grading-gateway/src/classReviewSynthesis/serviceAuth.test.ts`
- Create: `grading-gateway/src/classReviewSynthesis/service.ts`
- Create: `grading-gateway/src/classReviewSynthesis/service.test.ts`
- Create: `grading-gateway/src/classReviewSynthesis/runtimeInvariant.ts`
- Create: `grading-gateway/src/classReviewSynthesis/runtimeInvariant.test.ts`
- Modify: `grading-gateway/src/gatewayRuntimeConfig.ts`
- Modify: `grading-gateway/src/gatewayRuntimeConfig.test.ts`
- Modify: `grading-gateway/src/providerTelemetry.ts`
- Modify: `grading-gateway/src/providerTelemetry.test.ts`
- Modify: `grading-gateway/src/server.ts`
- Modify: `grading-gateway/src/server.test.ts`
- Modify: `grading-gateway/src/index.ts`
- Modify: `grading-gateway/.env.example`

**Interfaces:**

- Produces internal-only `POST /grading/class-review-syntheses` using `class-review-synthesis-request-v1` / `class-review-synthesis-result-v1`.
- Uses the same `GatewayExecutionServices.admission` and `oneShot` instance as essay grading.
- Requires a constant-time checked bearer service token and rejects any request carrying an `Origin` header; register the internal route before browser CORS middleware so it never receives CORS allow headers.

- [ ] **Step 1: Write failing service-auth, runtime-config and CORS tests**

Cover missing/wrong token, browser Origin, normal public CORS routes remaining unchanged, safe 401/403 bodies and no token/body in diagnostics. In `gatewayRuntimeConfig.test.ts`, cover every legal class mode, unknown mode, missing Kimi key/cache secret/calibration and exact `KIMI_MAX_COMPLETION_TOKENS_CLASS_REVIEW=3072` equality/+1/-1 before implementation. The internal request and result tests also consume `test-fixtures/class-review/synthesis-contracts.json`; fixture drift on either side is RED.

- [ ] **Step 2: Write failing shared-admission tests**

Prove prompt/schema/framing/cache-key preflight completes before shared-admission acquisition. Then hold an essay-grading lease, submit class synthesis and prove total active Provider calls never exceed the existing hard limit. Cover confirmed-zero 429 returning truthful `Retry-After` while lowering shared admission; the task-service/coordinator—not this route—owns bounded requeue of the same generation. Also cover auth/balance/config pause, caller timeout before dispatch, Provider result unknown and one usage record per actual completion. In `runtimeInvariant.test.ts`, plant a failed-schema real attempt with `prompt_tokens=16_385` and prove the next request stops before admission/transport.

- [ ] **Step 3: Run and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'grading-gateway')
npm.cmd test -- src/classReviewSynthesis/serviceAuth.test.ts src/classReviewSynthesis/service.test.ts src/classReviewSynthesis/runtimeInvariant.test.ts src/gatewayRuntimeConfig.test.ts src/server.test.ts src/providerTelemetry.test.ts
```

- [ ] **Step 4: Add explicit runtime switches**

Add `CLASS_REVIEW_SYNTHESIS_MODE=disabled|fake|kimi`, `CLASS_REVIEW_SERVICE_TOKEN`, and exact `KIMI_MAX_COMPLETION_TOKENS_CLASS_REVIEW=3072`. Kimi mode rejects 3071, 3073, non-integer or any attempt to widen this value before Provider admission; limit changes require a version/spec update. `reasoning_effort` remains fixed `low`. Existing real essay grading keeps working when class synthesis is disabled; missing class config never silently selects fake.

- [ ] **Step 5: Record only safe `class_review_generation` telemetry**

Record diagnostic ID, state/outcome, included/excluded/group counts, all three semantic coverage numerators/denominators, queue/provider/validation/total duration, exact `prompt_tokens`, `completion_tokens`, `total_tokens`, optional `cached_tokens`, `finish_reason` and a boolean token-invariant result. Never record prompt, aliases that can be joined to business IDs, excerpts, names, ordinary IDs or raw Provider payload.

`runtimeInvariant.ts` owns a process-safe class-synthesis circuit breaker. Inspect every real Kimi attempt observation, including attempts whose final outcome is JSON/Schema/alias/truncation failure. If any reports `prompt_tokens > 16_384`, record only `class_review_prompt_contract_drift`, discard any candidate, pause all subsequent real class synthesis before admission/transport, and require a reviewed tokenizer/budget/calibration version plus restart/explicit operations reset. Tests prove the next Kimi request makes zero `transport.complete()` calls; fake/loopback cannot trigger, clear or satisfy this real-provider invariant.

- [ ] **Step 6: Run Gateway focused and regression tests**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'grading-gateway')
npm.cmd test -- src/classReviewSynthesis src/gatewayRuntimeConfig.test.ts src/server.test.ts src/providerTelemetry.test.ts src/providers
npm.cmd run typecheck
npm.cmd run verify:shared-scoring-runtime
```

- [ ] **Step 7: Commit Task 7**

```powershell
$repoRoot = git rev-parse --show-toplevel
git -C $repoRoot add -- grading-gateway/src/classReviewSynthesis/serviceAuth.ts grading-gateway/src/classReviewSynthesis/serviceAuth.test.ts grading-gateway/src/classReviewSynthesis/service.ts grading-gateway/src/classReviewSynthesis/service.test.ts grading-gateway/src/classReviewSynthesis/runtimeInvariant.ts grading-gateway/src/classReviewSynthesis/runtimeInvariant.test.ts grading-gateway/src/gatewayRuntimeConfig.ts grading-gateway/src/gatewayRuntimeConfig.test.ts grading-gateway/src/providerTelemetry.ts grading-gateway/src/providerTelemetry.test.ts grading-gateway/src/server.ts grading-gateway/src/server.test.ts grading-gateway/src/index.ts grading-gateway/.env.example
git -C $repoRoot commit -m "feat: add internal class review synthesis route"
```

---

## Task 8: Implement local report merge, generation registry and fake scenarios

**Files:**

- Create: `app/src/services/classReview/classReviewMerge.ts`
- Create: `app/src/services/classReview/classReviewMerge.test.ts`
- Create: `app/src/services/classReview/classReviewRegistry.ts`
- Create: `app/src/services/classReview/classReviewRegistry.test.ts`
- Create: `app/src/services/classReview/classReviewCoordinator.ts`
- Create: `app/src/services/classReview/classReviewCoordinator.test.ts`
- Create: `app/src/services/classReview/fakeClassReviewSynthesisClient.ts`
- Create: `app/src/services/classReview/fakeClassReviewSynthesisClient.test.ts`
- Create: `app/src/services/classReview/classReviewTelemetry.ts`
- Create: `app/src/services/classReview/classReviewTelemetry.test.ts`
- Create: `app/src/services/classReview/classReviewRuntimeConfig.ts`
- Create: `app/src/services/classReview/classReviewRuntimeConfig.test.ts`

**Interfaces:**

```ts
interface ClassReviewSynthesisClient {
  synthesize(request: ClassReviewSynthesisRequestV1): Promise<ClassReviewSynthesisResultV1>
}

createLocalClassReviewCoordinator(options: {
  synthesisClient: ClassReviewSynthesisClient
  topicKeySecret: Uint8Array
  now: () => string
  createOpaqueId: () => string
}): LocalClassReviewCoordinator
```

- [ ] **Step 1: Write failing merge tests**

Cover teacher items and relative order preserved, surviving exact topic keys retaining position, missing old AI topics removed, new AI topics appended, teacher topic suppressing duplicate AI text while keeping separate teacher/system evidence, active system variant restoration after the last teacher source is manually removed, and no restoration after source deletion invalidates that generation.

For each legal Provider pattern, resolve aliases only against the fixed generation snapshot; union hidden essay identities to recompute `studentCount`, sum source occurrences, set denominator to `N_issue`, and reapply `requiredSupport=max(N_issue < 10 ? 2 : 3, ceil(N_issue*0.2))`. Drop sub-threshold patterns. A single member reuses its atomic topic identity; 2+ unique/sorted members derive the composite key. Refill at most three anonymous examples deterministically from the exact stored scrubbed strings—never raw source. Every `mustCover` group omitted by projection, left unreferenced, or contained only in a dropped pattern becomes one deterministic system fallback with zero extra completion; safe scrubbed text is preferred, otherwise fixed type/subtype templates contain no example. A legal zero-pattern result still succeeds. Assert every `mustCover` key is consumed or has exactly one fallback.

- [ ] **Step 2: Write failing lifecycle and call-count tests**

Cover no workspace, teacher-created draft, initial failure preserving draft, one initial completion, double-click attach, task-scoped actionable uniqueness across `queued|running|result_unknown|succeeded_unapplied`, explicit regenerate adding exactly one call, result unknown blocking a new generation, an unapplied candidate blocking a new generation, apply/discard adding zero calls, AI-text revision conflict yielding `succeeded_unapplied`, and source deletion invalidating queued/running/unknown/unapplied runs. A confirmed-zero 429 must settle its local admission lease before the same generation transitions `running -> queued`, then bounded requeue may use the same execution identity/hash; timeout/unknown can never take that transition. Coordinator commands must reject starting or saving AI-text edits in `queued|running|result_unknown` without changing `aiTextEditRevision`, while issue add/remove/undo/sort remains legal.

- [ ] **Step 3: Write failing safe-telemetry and runtime-mode tests**

`classReviewTelemetry.test.ts` accepts only fixed lifecycle/outcome enums, aggregate included/excluded/group counts and bounded durations; exact emitted keys reject or omit task/student/teacher names, ordinary IDs, aliases, excerpts, report prose, Prompt and raw Provider errors. `classReviewRuntimeConfig.test.ts` accepts `VITE_CLASS_REVIEW_MODE=local-prototype|platform`, allows local prototype only through explicit development/test injection, and proves production missing/unknown/fake configuration fails closed without a network fallback.

- [ ] **Step 4: Write failing deterministic fake-scenario tests**

Support `success`, `empty`, `rate_limited_before_completion`, `auth_failed`, `result_unknown`, `invalid_schema` and `regeneration_failed`. Add multi-group semantic merge, sub-threshold pattern, omitted `mustCover` and duplicate group-ownership scenarios. Expose a test-only counter; do not put call counts in production UI contracts.

- [ ] **Step 5: Run and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/services/classReview/classReviewMerge.test.ts src/services/classReview/classReviewRegistry.test.ts src/services/classReview/classReviewCoordinator.test.ts src/services/classReview/fakeClassReviewSynthesisClient.test.ts src/services/classReview/classReviewTelemetry.test.ts src/services/classReview/classReviewRuntimeConfig.test.ts
```

- [ ] **Step 6: Implement deterministic merge, CAS and actionable-generation precedence**

Implement the exact Step 1 merge: rebuild system evidence from the fixed generation snapshot, reapply support thresholds, resolve generation-local aliases, preserve teacher content/order, suppress and restore legal system variants, and emit exactly one deterministic fallback for every unconsumed `mustCover`. Use separate monotonic `reportRevision`, `generationRevision` and `aiTextEditRevision`. `currentGeneration` projection precedence is `succeeded_unapplied > queued/running/result_unknown > null`. Candidate application rechecks all revisions and never silently overwrites changed AI text.

- [ ] **Step 7: Implement fake scenarios, safe telemetry and explicit local runtime mode**

Implement every named fake scenario behind the injected `ClassReviewSynthesisClient`. Emit only the exact content-free telemetry keys proven by the tests. Parse only `VITE_CLASS_REVIEW_MODE=local-prototype|platform`; enable `local-prototype` only in explicit dev/test injection and return a visible unavailable state otherwise. There is no silent fake or network fallback in a production build.

- [ ] **Step 8: Run focused tests, typecheck and commit**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/services/classReview
npm.cmd run typecheck
git -C $repoRoot add -- app/src/services/classReview/classReviewMerge.ts app/src/services/classReview/classReviewMerge.test.ts app/src/services/classReview/classReviewRegistry.ts app/src/services/classReview/classReviewRegistry.test.ts app/src/services/classReview/classReviewCoordinator.ts app/src/services/classReview/classReviewCoordinator.test.ts app/src/services/classReview/fakeClassReviewSynthesisClient.ts app/src/services/classReview/fakeClassReviewSynthesisClient.test.ts app/src/services/classReview/classReviewTelemetry.ts app/src/services/classReview/classReviewTelemetry.test.ts app/src/services/classReview/classReviewRuntimeConfig.ts app/src/services/classReview/classReviewRuntimeConfig.test.ts
git -C $repoRoot commit -m "feat: coordinate class review prototype generations"
```

---

## Task 9: Connect the prototype coordinator to AppState without changing essay v2

**Files:**

- Modify: `app/src/context/appStateContextValue.ts`
- Modify: `app/src/context/AppStateContext.tsx`
- Create: `app/src/context/AppStateContext.classReview.test.tsx`
- Modify: `app/src/data/mockData.ts`
- Modify: `app/src/data/mockData.test.ts`
- Modify: `app/.env.example`

**Interfaces:**

Add state selectors and commands matching the business contract: read report/current generation; add/remove/undo/move teacher issue; edit/save/cancel AI text; generate/check/apply/discard; and an internal source-deletion transition used by deletion tests. Keep `classReviewMaterials` as a separate selected-material collection.

- [ ] **Step 1: Write a failing AppState report-lifecycle test**

Start with a teacher issue before any generation and assert a draft workspace exists while the primary CTA remains initial generation. Generate with two valid synthetic results; while running, AppState rejects AI-text start/save but accepts issue sorting. After success edit AI text, reorder issues, regenerate, force an AI-text CAS conflict, apply the existing candidate with confirmation, and assert the fake completion count is exactly two.

- [ ] **Step 2: Write failing result-revision tests**

Assert every `updateGradingResult` increments `resultRevision`; a generation snapshot captures the exact revision; a later ordinary result edit leaves the applied report visible; source deletion removes AI-derived content and moves the report to `ai_removed` without an automatic call.

- [ ] **Step 3: Run and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/context/AppStateContext.classReview.test.tsx src/context/AppStateContext.test.tsx src/data/mockData.test.ts
```

- [ ] **Step 4: Replace `mockClassInsights` state with coordinator projections**

Stop initializing real page state from `mockClassInsights`. Keep static insight data only in explicit demo/test fixtures. Remove the material-context-derived `generateClassReview` eligibility; derive eligibility from settled queue and aggregate counts.

- [ ] **Step 5: Run AppState and grading regression tests**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/context/AppStateContext.classReview.test.tsx src/context/AppStateContext.test.tsx src/data/mockData.test.ts src/services/grading src/context/gradingStateTransitions.test.ts src/context/gradingQueueTransitions.test.ts
npm.cmd run typecheck
```

- [ ] **Step 6: Commit Task 9**

```powershell
$repoRoot = git rev-parse --show-toplevel
git -C $repoRoot add -- app/src/context/appStateContextValue.ts app/src/context/AppStateContext.tsx app/src/context/AppStateContext.classReview.test.tsx app/src/data/mockData.ts app/src/data/mockData.test.ts app/.env.example
git -C $repoRoot commit -m "feat: store class review prototype workspace in app state"
```

---

## Task 10: Make single-essay issue inclusion reversible and accessible

**Files:**

- Modify: `app/src/components/IssueCorrectionList.tsx`
- Create: `app/src/components/IssueCorrectionList.test.tsx`
- Modify: `app/src/pages/EssayResultPage.tsx`
- Modify: `app/src/pages/EssayResultPage.test.tsx`
- Modify: `app/src/utils/reviewIssueItems.ts`
- Modify: `app/src/utils/reviewIssueItems.test.ts`
- Modify: `app/src/utils/classReviewMaterials.ts`
- Modify: `app/src/utils/classReviewMaterials.test.ts`

**Interfaces:**

- A source-locate button and an add/remove button are separate controls; no clickable parent card wraps another button.
- States are `available`, `teacher_selected`, `system_included`. `system_included` renders a non-interactive “已自动归纳” label; `teacher_selected` exposes “移出班级总览”.

- [ ] **Step 1: Write failing interaction and focus tests**

Assert no nested interactive role, independent source locating, add, remove, visible persistent undo, focus moving to undo when the card disappears, focus returning after undo, and mixed teacher+system evidence degrading to AI without losing focus.

- [ ] **Step 2: Run and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/components/IssueCorrectionList.test.tsx src/pages/EssayResultPage.test.tsx src/utils/reviewIssueItems.test.ts src/utils/classReviewMaterials.test.ts
```

- [ ] **Step 3: Route issue actions to report issue blocks**

`EssayResultPage` must no longer turn a normal issue into `ClassReviewMaterial`. Preserve the separate teacher-selected-material flow only where the user explicitly selects a teaching material. Bind every teacher issue evidence to the current local `resultRevision` and locator.

- [ ] **Step 4: Implement non-expiring undo within the current view**

Do not auto-dismiss the undo action on a short timer. A subsequent incompatible mutation may replace the undo record, but must announce that change through `aria-live`.

- [ ] **Step 5: Run tests and commit**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/components/IssueCorrectionList.test.tsx src/pages/EssayResultPage.test.tsx src/utils/reviewIssueItems.test.ts src/utils/classReviewMaterials.test.ts
git -C $repoRoot add -- app/src/components/IssueCorrectionList.tsx app/src/components/IssueCorrectionList.test.tsx app/src/pages/EssayResultPage.tsx app/src/pages/EssayResultPage.test.tsx app/src/utils/reviewIssueItems.ts app/src/utils/reviewIssueItems.test.ts app/src/utils/classReviewMaterials.ts app/src/utils/classReviewMaterials.test.ts
git -C $repoRoot commit -m "feat: make class review issue selection reversible"
```

---

## Task 11: Replace the four-tab page with one class-review workspace

**Files:**

- Create: `app/src/components/ClassReviewReportPanel.tsx`
- Create: `app/src/components/ClassReviewReportPanel.test.tsx`
- Create: `app/src/components/ClassReviewGenerationStatus.tsx`
- Create: `app/src/components/ClassReviewGenerationStatus.test.tsx`
- Create: `app/src/components/ClassReviewIssueList.tsx`
- Create: `app/src/components/ClassReviewIssueList.test.tsx`
- Create: `app/src/components/ClassReviewSpellingList.tsx`
- Create: `app/src/components/ClassReviewSpellingList.test.tsx`
- Modify: `app/src/components/ClassReviewMaterialsPanel.tsx`
- Create: `app/src/components/ClassReviewMaterialsPanel.test.tsx`
- Modify: `app/src/pages/ClassReviewPage.tsx`
- Rewrite: `app/src/pages/ClassReviewPage.test.tsx`

**Interfaces:**

- Page order is: current score/coverage statistics, AI class summary, common issues and advice, definite spelling list, teacher-selected materials.
- Primary action precedence is exactly `succeeded_unapplied > queued/running/result_unknown > applied report > initial eligibility > waiting/insufficient`.

- [ ] **Step 1: Write failing single-page and CTA precedence tests**

Assert old tabs and mock notice are absent; draft workspace still shows only “生成班级总结”; `N_success < 2` shows no generation button; settled partial failures do not block; active run has no duplicate generation button; result unknown only offers “检查结果”; unapplied candidate only offers apply/discard; applied report offers explicit-cost “重新生成”.

- [ ] **Step 2: Write failing edit and dialog tests**

AI text has one “编辑” entry and edit mode only “保存/取消”. While generation is `queued|running|result_unknown`, the AI-text edit entry is disabled with an accessible reason, while issue add/remove/undo/sort remain available. Unsaved edit blocks regenerate. Regenerate dialog names the operation, warns of one new AI call and AI-text replacement, supports Escape, visible focus and trigger focus restoration.

- [ ] **Step 3: Write failing ordering/accessibility tests**

Cover desktop drag, mobile menu, keyboard up/down, `issueOrder` as the only source of order, revision conflict, 44x44 controls, `aria-live` status/sort/remove/undo messages, and source links with exact revision locators.

- [ ] **Step 4: Run and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/components/ClassReviewReportPanel.test.tsx src/components/ClassReviewGenerationStatus.test.tsx src/components/ClassReviewIssueList.test.tsx src/components/ClassReviewSpellingList.test.tsx src/components/ClassReviewMaterialsPanel.test.tsx src/pages/ClassReviewPage.test.tsx
```

- [ ] **Step 5: Implement the vertical workspace**

Display both “当前统计” and “AI 生成时纳入” metadata. Render `X / N_issue` only for system support. Limit visible anonymous examples to three. Keep definite spelling compact and deterministically sorted; promoting a spelling item creates a teacher issue block and then participates in manual order.

- [ ] **Step 6: Run focused tests and commit**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/components/ClassReviewReportPanel.test.tsx src/components/ClassReviewGenerationStatus.test.tsx src/components/ClassReviewIssueList.test.tsx src/components/ClassReviewSpellingList.test.tsx src/components/ClassReviewMaterialsPanel.test.tsx src/pages/ClassReviewPage.test.tsx
git -C $repoRoot add -- app/src/components/ClassReviewReportPanel.tsx app/src/components/ClassReviewReportPanel.test.tsx app/src/components/ClassReviewGenerationStatus.tsx app/src/components/ClassReviewGenerationStatus.test.tsx app/src/components/ClassReviewIssueList.tsx app/src/components/ClassReviewIssueList.test.tsx app/src/components/ClassReviewSpellingList.tsx app/src/components/ClassReviewSpellingList.test.tsx app/src/components/ClassReviewMaterialsPanel.tsx app/src/components/ClassReviewMaterialsPanel.test.tsx app/src/pages/ClassReviewPage.tsx app/src/pages/ClassReviewPage.test.tsx
git -C $repoRoot commit -m "feat: build single-page class review workspace"
```

---

## Task 12: Align progress eligibility and exact source navigation

**Files:**

- Modify: `app/src/pages/ProgressPage.tsx`
- Modify: `app/src/pages/ProgressPage.test.tsx`
- Modify: `app/src/pages/EssayResultPage.tsx`
- Modify: `app/src/pages/DetailNavigation.test.tsx`
- Modify: `app/src/utils/progressQueue.ts`
- Modify: `app/src/utils/progressQueue.test.ts`

**Interfaces:**

- A queue is class-review settled when no essay has an active or retry-wait phase; final failure/manual/valid success are terminal for this decision.
- Source links include a controlled locator and exact result revision. This non-persistent prototype does not invent a history repository: it navigates only when the bound revision still equals the current in-memory `resultRevision`; otherwise it renders “该来源版本已更新或不可用” and never applies the locator to current content.

- [ ] **Step 1: Write failing settled and eligibility tests**

Cover all-success, partial success, one final failure, result unknown not settled, rate-limit wait not settled, zero/one valid success, and a draft report created before settlement. Assert “进入班级总览” may be visible as navigation, while generation remains disabled until the coordinator says eligible.

- [ ] **Step 2: Write failing source round-trip tests**

Navigate when the evidence revision is still current, return to the same issue/scroll position and restore focus. Increment the result revision without changing the locator and assert the source becomes unavailable rather than opening current content as historical evidence.

- [ ] **Step 3: Run and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/pages/ProgressPage.test.tsx src/pages/DetailNavigation.test.tsx src/utils/progressQueue.test.ts
```

- [ ] **Step 4: Implement selectors and navigation state**

Do not modify the grading scheduler or add a second per-essay queue. Keep class generation lifecycle separate from essay phases.

- [ ] **Step 5: Run tests and commit**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/pages/ProgressPage.test.tsx src/pages/DetailNavigation.test.tsx src/utils/progressQueue.test.ts
git -C $repoRoot add -- app/src/pages/ProgressPage.tsx app/src/pages/ProgressPage.test.tsx app/src/pages/EssayResultPage.tsx app/src/pages/DetailNavigation.test.tsx app/src/utils/progressQueue.ts app/src/utils/progressQueue.test.ts
git -C $repoRoot commit -m "feat: expose settled class review workflow"
```

---

## Task 13: Complete fake acceptance, regression, browser QA and prototype disclosure

**Files:**

- Modify: `grading-gateway/scripts/runFakeAcceptanceGateway.ts`
- Modify: `grading-gateway/scripts/runFakeAcceptanceGateway.test.ts`
- Create: `app/src/pages/ClassReviewFlow.test.tsx`
- Modify: `docs/current_development_status.md`

**Interfaces:**

- Fake acceptance scenarios: success, empty common issues, partial essay failures, confirmed-zero 429, auth pause, result unknown, invalid schema, regenerate failure and budget rejection.
- Prototype disclosure: “本地功能原型；刷新、重启、多设备和真实班级长期保存不受保证。”
- This is a final conformance gate over behavior implemented in Tasks 1–12, not a new production-behavior task. Its acceptance tests are expected to pass on their first run after those tasks are complete; a failure returns to the owning earlier Task for a RED/fix/GREEN cycle. Do not manufacture an artificial RED or add hidden feature behavior inside Task 13.

- [ ] **Step 1: Extend loopback Gateway acceptance tests**

Assert the Node/server-only loopback internal route rejects browser Origin, requires service auth, shares the global hard limit, emits one completion metric, returns strict result, and performs zero Provider calls for invalid/budget-rejected input. Include multiple individually-low-frequency groups combined above threshold, a returned pattern filtered below threshold, an omitted/unreferenced `mustCover` zero-call fallback, and duplicate/cross-pattern group ownership causing whole-result rejection.

- [ ] **Step 2: Add an application flow test**

Use six synthetic essays: five valid successes and one final failure. Generate once, verify deterministic stats/spelling plus fake prose, add a low-frequency teacher issue, reorder, edit summary, simulate regeneration failure and prove the old report/teacher content remains.

- [ ] **Step 3: Run both complete automated suites**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'grading-gateway')
npm.cmd test
npm.cmd run typecheck
npm.cmd run verify:shared-scoring-runtime
npm.cmd run verify:grading-policy-fixtures

Set-Location (Join-Path $repoRoot 'app')
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Expected: all pass. Any pre-existing unrelated failure is documented with exact evidence; no success claim is made until new and adjacent regressions pass.

- [ ] **Step 4: Run safety scans**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location $repoRoot
rg -n "mockClassInsights|仍为现有 mock 洞察|role=\"button\"" app/src/pages/ClassReviewPage.tsx app/src/components/IssueCorrectionList.tsx
rg -n "ocr-gateway|POST /ocr|VITE_OCR" app/src/services/classReview app/src/pages/ClassReviewPage.tsx grading-gateway/src/classReviewSynthesis
rg -n "studentName|className|taskName|materialContext|sourceFile|Base64|Authorization" grading-gateway/src/classReviewSynthesis
git -C $repoRoot diff --check
```

Expected: no active mock/OCR dependency; security-term matches are only explicit rejection/redaction tests or service-auth implementation, individually reviewed.

- [ ] **Step 5: Perform browser QA with explicit local-prototype mode**

At `1440x900` and `390x844`, verify no horizontal overflow, no hover-only action, reachable drag alternatives, dialogs/focus, source round-trip, persistent undo and generation status announcements. Browser QA injects `fakeClassReviewSynthesisClient` directly into the local coordinator. Network assertions require zero `/grading/class-review-syntheses` requests, and the browser bundle/env must contain neither `CLASS_REVIEW_SERVICE_TOKEN` nor a `VITE_*` equivalent. Separately, Node/server-only loopback acceptance exercises the fake Gateway route. Report evidence as “App in-process fake flow” and “Gateway loopback”, never as browser-through-Gateway E2E.

- [ ] **Step 6: Update current status truthfully**

Record exact test counts, commands and both separately named fake evidence sets. State that Kimi class synthesis, persistence, auth, cross-refresh/multi-device recovery, historical result-revision storage and commercial release have not been validated; rebuilding the local coordinator makes old evidence revisions unavailable. Do not change the formal spec’s architectural decisions.

- [ ] **Step 7: Request code review and fix all Critical/Important findings**

Use `superpowers:requesting-code-review`; repeat focused tests after every material fix.

- [ ] **Step 8: Commit Task 13**

```powershell
$repoRoot = git rev-parse --show-toplevel
git -C $repoRoot add -- grading-gateway/scripts/runFakeAcceptanceGateway.ts grading-gateway/scripts/runFakeAcceptanceGateway.test.ts app/src/pages/ClassReviewFlow.test.tsx docs/current_development_status.md
git -C $repoRoot commit -m "test: verify class review local prototype"
```

## Spec-to-Test Traceability Gate

Before claiming the prototype complete, the implementer checks every row against a named automated test; a prose assertion without the test is not evidence.

| Approved rule | Exact implementation/test evidence |
|---|---|
| Denominators and common threshold | Task 2 `aggregateClassReview.test.ts`: `N_success` vs `N_issue`, partial channel, `2/9/10`, 20% ceiling, per-essay support vs occurrence |
| Definite spelling | Task 2 `classReviewSpelling.test.ts`: certain/review/legibility gates, legal token grammar, exact Damerau–Levenshtein equality/+1 |
| Topic and redaction | Task 3 tests: opaque task scope, member-set identity/collision; names/PII/entities/injection omission and coverage decrement |
| Projection constants | Task 4 tests: 10/20, at most 32 counters total including `other`, 8/32 KiB, 64 groups, one excerpt, 160/160/48/360 equality/+1; Task 6 tests actual 16/48 KiB serialized prefix/final text |
| Semantic coverage and `mustCover` | Tasks 4 and 8: group/support/occurrence numerators and denominators; every omitted/unconsumed `mustCover` gets one zero-call fallback |
| Provider output constants | Task 5 `providerContract.test.ts`: 300; strengths 1–3/40/120/3; patterns 0–8/40/100/100/1–12; recommendations 1–3/40/120; 2,200/16 KiB equality/+1 |
| Prompt/call budget | Tasks 6–7: 15,872 controllable, 512 framing, 16,384 total, 3,072 completion, max(tokenizer, bytes), exactly one call, drift pause |
| Prompt cache key | Task 6 `promptCacheKey.test.ts`: revision-only canonical tuple, HMAC-SHA-256/base64url, existing >=32-byte `GRADING_PROMPT_CACHE_HMAC_SECRET`, every revision changes the key, no PII/ordinary ID, missing secret fail closed and no idempotency role |
| Lifecycle/CAS | Tasks 1, 8 and 11: every legal/illegal transition, one actionable run/candidate, `aiTextEditRevision`, edit disabled while active, apply/discard zero calls |
| Report merge and deletion | Tasks 8–10: teacher content/order, suppressed system variant, source deletion invalidation, late result cannot restore content |
| Exact source behavior | Task 12: navigate only when bound revision is current; otherwise explicit unavailable, never false historical fallback |
| Browser/internal boundary | Tasks 7 and 13: browser fake client only; internal service auth/no CORS; loopback Gateway is server-only |
| Main-flow regression | Task 13: unchanged essay v2 route/contracts, shared admission and no OCR dependency |

## Prototype Completion Gate

The local prototype is complete only when all of the following are evidenced:

1. Every approved threshold, spelling, snapshot, editing, sorting, candidate and deletion behavior has an automated test.
2. Initial success is exactly one fake completion; duplicates, statistics, apply/discard and page reads add zero.
3. Gateway rejects forbidden fields and over-budget payloads before Provider admission, and uses one shared hard concurrency limit.
4. The real class page contains no static `mockClassInsights` or old four-tab information architecture.
5. Existing essay v2 contracts and queue tests pass, and no OCR call/state is added.
6. Desktop/mobile accessibility QA passes with synthetic data.
7. UI and documentation label the result as a non-persistent local prototype.

Failure of any item blocks the phrase “本地功能完成”; real Kimi evidence is explicitly outside this plan.
