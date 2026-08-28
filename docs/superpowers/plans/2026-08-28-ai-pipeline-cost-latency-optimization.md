# AI Pipeline Cost, Latency, and Bounded Throughput Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变“每篇作文由 `kimi-k3` 一次多模态请求完成正文识别、评分与反馈”的前提下，消除评分标准与逐篇批改中的重复调用、重复上下文和重复输出；建立安全 usage 观测、单进程幂等复用、Gateway 全局硬准入和教师一键启动全班的自适应有界队列，以更少 token 和更短全班关键路径完成同等质量的批改。

**Architecture:** 网站继续发送完整 `multimodal-grading-request-v2`，Gateway 在严格验证后投影唯一 canonical 模型上下文，并在服务端计算内容型逻辑幂等身份。Kimi transport 返回受控 completion envelope；单篇 registry 与全局 admission controller 共同确保同一逻辑版本只有一个 Provider 调用、未知调用持续占槽且不会被自动重发。前端只维护任务队列、稳定 caller request ID 和单调 generation，用有界 worker 自动补槽；结果仍由 Gateway 归一化并输出完整 `grading-result-v2`。真实质量、token 和并发结论由独立的授权 benchmark 产生，图片默认路径不重采样、不缩放、不重新编码。

**Tech Stack:** React 19、TypeScript 6、Vite 8、Vitest 4、Testing Library、Express 4、Multer 2、Node `crypto`、Kimi Chat Completions strict JSON Schema；不新增 OCR 服务、Batch API、流式响应或模型路由器。

**Spec:** [AI 调用成本、延迟与全班吞吐优化设计](../specs/2026-08-28-ai-pipeline-cost-latency-optimization-design.md)

## Global Constraints

- 每个实施回合在规划、命令或编辑前，完整阅读仓库根目录 `AGENTS.md` 与 `docs/current_development_status.md`，并在进度说明中复述与当轮相关的核心决策。
- 唯一作文主流程保持为：学生有序图片、PDF 转换页或设备照片直接交给 `kimi-k3`，同一次多模态 completion 完成正文识别、评分和反馈。不得启动、接入、建议或实现 OCR 主流程、OCR 降级、批改前 OCR 文本确认或 OCR 故障绕行。
- 教师修改模型正文后的重批继续使用 `POST /grading/grade-images`，只发送精确 `confirmedTranscript`，`pages=[]`；这不是 OCR 阶段。
- 外部 `multimodal-grading-request-v2`、`grading-result-v2` 和 `POST /grading/grade-images` 保持不变。新增的 retry/admission 信息只能来自标准或白名单响应头、既有安全失败对象，或网站内部状态；不得把 Provider telemetry 塞进公开成功结果。
- 外部 `requestId` 是 caller trace。内容型 `logicalRequestId`、rubric/source digest 和 payload hash 只在 Gateway 内部生成和保存，不写日志、不返回浏览器、不复用为 `prompt_cache_key`。
- 原题材料只在创建任务阶段理解一次。逐篇 Prompt 禁止包含原始材料图片、PDF、DOCX、提取全文、文件名、学生姓名或 `sourceEvidence`。
- Kimi 运行基线保持 `https://api.moonshot.cn/v1`、`kimi-k3`、`reasoning_effort=low`、每阶段 completion 上限不超过 `16384`。K3 不使用 Batch API，也不把多个学生合并进一个请求。
- 生产或真实 Kimi 必须显式配置 Provider、四个阶段预算、Gateway 并发硬上限和 opaque cache-key secret；缺失或非法时 fail closed，绝不静默回退 mock。mock 只允许显式本地模式或测试注入。
- 所有日志和 benchmark aggregate 禁止包含学生姓名、文件名、作文正文、确认文本、图片、Base64、完整 Prompt、完整材料、API Key、Authorization、Provider 原始响应、普通业务 ID、内容 digest、完整本机路径或 stack。
- usage 缺失、非法、负数、非整数或内部矛盾时用 `unknown`/缺失值表示，绝不补成 0。一次唯一 Provider completion 只聚合一次 token；多个 HTTP attachment 不重复计费。
- 自适应并发必须始终受显式硬上限约束：默认安全目标从 1 开始，稳定成功小步增加，`429` 乘性降低并遵守 `Retry-After`。不得使用无界 `Promise.all`，不得把官方账户等级表硬编码成额度。
- `in_flight` 和仍有底层 promise 的 `orphaned_unknown` 不受 TTL/LRU 淘汰；orphan 继续占用 Provider 槽位，只有底层明确结算或可信运维确认终止后才能释放。宁可暂停准入，也不得超卖真实上游槽位。
- 实际 Provider 尝试最多 2 次；`429` 在未获得 completion 时最多重新准入 5 次；指数 full-jitter 从 2 秒开始、普通上限 60 秒，合法 `Retry-After` 是等待下限，超过 15 分钟则暂停任务。网络/abort 结果未知时不得自动开第二次 Provider 调用。
- 第一阶段只删除可确定性重建的 Provider `correctedText`/`improvedText`。其他反馈字段、字段级上限和任何有损图片变化均须等待授权 A/B 数据，不得凭空收紧或默认启用。
- 所有自动化实现和验证使用 fake transport、fake Provider、合成 fixture；未经单独确认样本范围、调用数和费用，不读取本地 Key、不运行真实 Kimi、不使用真实学生数据。
- 网站与 Gateway 对 failure code/headers、队列行为和 v2 结果的变更必须在同一发布窗口部署。首版 registry 仅保证同一 Gateway 进程连续可用；多实例、滚动部署或重启前不得宣称跨进程严格幂等。

## Rollout Switches and Safe Defaults

真实配置在完成本计划后使用以下显式值；测试可直接注入对应 typed config，不依赖 `process.env`：

```text
GRADING_PROVIDER=kimi
GRADING_RUBRIC_STRATEGY=single-pass-v1
GRADING_ESSAY_PROMPT_PROFILE=optimized-v1
GRADING_EXECUTION_REGISTRY=memory-v1
GRADING_MAX_CONCURRENT_PROVIDER_CALLS=4
GRADING_HTTP_DEADLINE_MS=360000
GRADING_PROVIDER_FINAL_DEADLINE_MS=420000
GRADING_PROVIDER_SETTLEMENT_GRACE_MS=30000
GRADING_REGISTRY_TERMINAL_TTL_MS=86400000
GRADING_REGISTRY_MAX_ENTRIES=2000
GRADING_PROVIDER_MAX_ATTEMPTS=2
GRADING_RATE_LIMIT_MAX_REQUEUES=5
GRADING_RETRY_BASE_MS=2000
GRADING_RETRY_CAP_MS=60000
GRADING_RETRY_AFTER_PAUSE_MS=900000
GRADING_PROMPT_CACHE_HMAC_SECRET=
KIMI_MAX_COMPLETION_TOKENS_MATERIAL_CONTEXT=16384
KIMI_MAX_COMPLETION_TOKENS_RUBRIC_GENERATION=16384
KIMI_MAX_COMPLETION_TOKENS_ESSAY_GRADING_IMAGES=16384
KIMI_MAX_COMPLETION_TOKENS_ESSAY_REGRADING_TEXT=16384
VITE_GRADING_MODE=real
VITE_GRADING_QUEUE_MODE=adaptive-v1
VITE_GRADING_MAX_IN_FLIGHT=4
```

- `two-pass-legacy` 只保留为 rubric 单阶段回滚开关；默认示例与真实候选配置使用 `single-pass-v1`。
- `legacy` essay prompt profile 只用于冻结 A 基线和单阶段回滚；候选使用 `optimized-v1`。prompt profile 必须进入 Provider schema version 和逻辑身份。
- `direct-legacy` execution 只用于受控基线/紧急回滚，不得作为生产示例；候选使用 `memory-v1`。
- `single-legacy` 网站队列模式可将 worker 上限固定为 1 以隔离回滚；候选使用 `adaptive-v1`。
- 图片产品路径只有 `original`；实验 CLI 的显式授权开关不能改变生产上传或批改路径。

## Dirty Worktree Guard

计划撰写时工作区为 clean，但执行者必须假设后续可能出现用户改动。每个任务开始和提交前运行：

```powershell
Set-Location D:\wenjie-writewise-ai
git status --short
git diff --check
git diff --cached --stat
```

只暂存当前任务列出的文件。不得 reset、checkout、覆盖或提交无关改动；若同一文件存在无法安全分离的用户修改，停止该任务并报告具体重叠。

## Planned File Structure

### Gateway transport, prompt and runtime

- Create `grading-gateway/src/gatewayRuntimeConfig.ts` and `.test.ts`.
- Create `grading-gateway/src/providerTelemetry.ts` and `.test.ts`.
- Create `grading-gateway/src/imageMetadata.ts` and `.test.ts`.
- Create `grading-gateway/src/multimodal/modelTaskContext.ts` and `.test.ts`.
- Modify `grading-gateway/src/providers/providerTypes.ts`.
- Modify `grading-gateway/src/providers/multimodalProviderTypes.ts`.
- Modify `grading-gateway/src/providers/kimiTransport.ts` and `.test.ts`.
- Modify `grading-gateway/src/providers/kimiMultimodalProvider.ts` and `.test.ts`.
- Modify `grading-gateway/src/providers/index.ts` and `.test.ts`.
- Modify `grading-gateway/src/multimodal/gradingPrompt.ts` and `.test.ts`.
- Modify `grading-gateway/src/multimodal/rubricPrompts.ts` and `.test.ts`.
- Modify `grading-gateway/src/multimodal/providerResultContract.ts`.
- Modify `grading-gateway/src/multimodal/normalizeMultimodalResult.ts` and `.test.ts`.
- Modify `grading-gateway/src/index.ts`, `server.ts`, `server.test.ts`, `types.ts`, and `.env.example`.

### Gateway identity, admission and registry

- Create `grading-gateway/src/multimodal/logicalRequestIdentity.ts` and `.test.ts`.
- Create `grading-gateway/src/providerAdmissionController.ts` and `.test.ts`.
- Create `grading-gateway/src/essayGradingRegistry.ts` and `.test.ts`.
- Create `grading-gateway/src/oneShotProviderExecution.ts` and `.test.ts`.

### Website queue and UI

- Create `app/src/services/grading/gradingRuntimeConfig.ts` and `.test.ts`.
- Create `app/src/services/grading/taskGradingScheduler.ts` and `.test.ts`.
- Create `app/src/context/gradingQueueTransitions.ts` and `.test.ts`.
- Modify `app/src/services/grading/types.ts`.
- Modify `app/src/services/grading/gradingClient.ts` and `.test.ts`.
- Modify `app/src/services/grading/remoteGradingClient.ts` and `.test.ts`.
- Modify `app/src/services/taskMaterial/materialClient.ts` and `.test.ts`.
- Modify `app/src/services/taskRubric/rubricClient.ts` and `.test.ts`.
- Modify `app/src/types/index.ts`.
- Modify `app/src/context/gradingStateTransitions.ts` and `.test.ts`.
- Modify `app/src/context/AppStateContext.tsx`, `appStateContextValue.ts`, and `AppStateContext.test.tsx`.
- Modify `app/src/utils/progressQueue.ts`, `progressQueue.test.ts`, `workflow.ts`, and `workflow.test.ts`.
- Modify `app/src/components/EssayStatusChip.tsx` and `ProgressSummary.tsx`.
- Modify `app/src/pages/ProgressPage.tsx`, `ProgressPage.test.tsx`, and `MultimodalUploadFlow.test.tsx`.
- Modify `app/.env.example`.

### Offline and authorized quality evidence

- Create `grading-gateway/scripts/gradingBenchmark/types.ts`.
- Create `grading-gateway/scripts/gradingBenchmark/manifest.ts` and `.test.ts`.
- Create `grading-gateway/scripts/gradingBenchmark/metrics.ts` and `.test.ts`.
- Create `grading-gateway/scripts/gradingBenchmark/qualityGates.ts` and `.test.ts`.
- Create `grading-gateway/scripts/gradingBenchmark/runner.ts` and `.test.ts`.
- Create `grading-gateway/scripts/gradingBenchmark/cli.ts` and `.test.ts`.
- Create `grading-gateway/scripts/gradingBenchmark/imageVariants.ts` and `.test.ts`.
- Create `grading-gateway/scripts/runFakeAcceptanceGateway.ts` and `.test.ts`.
- Modify `grading-gateway/package.json` and `tsconfig.json` only as required for scripts/tests.

---

## Task 1: Preserve Kimi completion usage, finish reason, timing, and retry metadata

**Files:**

- Modify: `grading-gateway/src/providers/providerTypes.ts`
- Modify: `grading-gateway/src/providers/multimodalProviderTypes.ts`
- Modify: `grading-gateway/src/providers/kimiTransport.ts`
- Modify: `grading-gateway/src/providers/kimiTransport.test.ts`

**Interfaces:**

```ts
export type ProviderCallStage =
  | 'material_context'
  | 'rubric_generation'
  | 'essay_grading_images'
  | 'essay_regrading_text'

export type ObservedTokenCount =
  | { status: 'known'; value: number }
  | { status: 'unknown'; reason: 'absent' | 'invalid' | 'inconsistent' }

export interface ProviderUsageSnapshot {
  promptTokens: ObservedTokenCount
  completionTokens: ObservedTokenCount
  totalTokens: ObservedTokenCount
  cachedTokens: ObservedTokenCount
}

export interface ProviderAttemptObservation {
  attemptDiagnosticId: string
  finishReason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'unknown'
  usage: ProviderUsageSnapshot
  providerElapsedMs: number
}

export interface ProviderCompletion<T> {
  value: T
  observation: ProviderAttemptObservation
}

export interface ProviderCallResult<T> {
  value: T
  attempts: readonly ProviderAttemptObservation[]
}

export interface ProviderErrorDetails {
  diagnosticCode?: ProviderDiagnosticCode
  finishReason?: 'length' | 'content_filter' | 'tool_calls' | 'unknown'
  retryAfterMs?: number
  termination: 'confirmed' | 'unknown'
  providerElapsedMs?: number
  usage?: ProviderUsageSnapshot
  attemptObservations?: readonly ProviderAttemptObservation[]
}
```

- [ ] **Step 1: Write RED transport tests**

Add cases that assert:

- valid `prompt_tokens`, `completion_tokens`, `total_tokens`, optional `prompt_tokens_details.cached_tokens`, `finish_reason` and elapsed time are returned in one `ProviderCompletion`;
- absent fields become explicit `status='unknown', reason='absent'` values;
- negative, fractional, non-finite, `cached > prompt`, or contradictory `total` usage becomes `unknown` with `invalid`/`inconsistent`, never 0 and never raw upstream data;
- a legitimate numeric 0 remains `status='known', value=0` and is never mistaken for absence;
- `length`, `content_filter`, tool calls and malformed JSON still fail closed while preserving only safe finish/timing metadata;
- a valid finite non-negative integer or HTTP-date `Retry-After` on `429` is parsed without shortening the Provider delay before policy evaluation; malformed, negative or implementation-overflow values are ignored;
- HTTP responses prove `termination='confirmed'`; fetch/abort failures conservatively use `termination='unknown'`.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
Set-Location D:\wenjie-writewise-ai\grading-gateway
npm.cmd test -- src/providers/kimiTransport.test.ts
```

Expected: FAIL because `complete()` still returns parsed JSON only and `GradingProviderError` has no controlled details.

- [ ] **Step 3: Implement the completion envelope**

Change `KimiCompletionInput` to carry `stage`, per-call `maxCompletionTokens`, optional `promptCacheKey`, attempt number and random content-free diagnostic context. Change `KimiTransport.complete()` to return `ProviderCompletion<unknown>` with a fresh random `attemptDiagnosticId`. Measure elapsed time with an injected monotonic clock/ID factory in tests. Parse only allowlisted usage/finish fields and never retain the raw response. Multimodal Provider methods wrap one or more transport attempts in `ProviderCallResult<T>`; this lets the explicit two-pass legacy rubric report two unique accounting events while every normal path reports one.

Send these values in the Kimi body:

```ts
{
  model,
  reasoning_effort: reasoningEffort,
  max_completion_tokens: input.maxCompletionTokens,
  ...(input.promptCacheKey ? { prompt_cache_key: input.promptCacheKey } : {}),
  response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
  messages: input.messages,
}
```

- [ ] **Step 4: Run tests and typecheck**

```powershell
npm.cmd test -- src/providers/kimiTransport.test.ts
npm.cmd run typecheck
```

Expected: PASS; no raw Provider body appears in thrown errors or snapshots.

- [ ] **Step 5: Commit Task 1**

```powershell
git add grading-gateway/src/providers/providerTypes.ts grading-gateway/src/providers/multimodalProviderTypes.ts grading-gateway/src/providers/kimiTransport.ts grading-gateway/src/providers/kimiTransport.test.ts
git commit -m "feat: preserve safe Kimi completion telemetry"
```

---

## Task 2: Add strict runtime configuration, stage budgets, safe telemetry, and health

**Files:**

- Create: `grading-gateway/src/gatewayRuntimeConfig.ts`
- Create: `grading-gateway/src/gatewayRuntimeConfig.test.ts`
- Create: `grading-gateway/src/providerTelemetry.ts`
- Create: `grading-gateway/src/providerTelemetry.test.ts`
- Create: `grading-gateway/src/imageMetadata.ts`
- Create: `grading-gateway/src/imageMetadata.test.ts`
- Modify: `grading-gateway/src/providers/index.ts`
- Modify: `grading-gateway/src/providers/index.test.ts`
- Modify: `grading-gateway/src/index.ts`
- Modify: `grading-gateway/src/server.ts`
- Modify: `grading-gateway/src/server.test.ts`
- Modify: `grading-gateway/.env.example`

**Interfaces:**

```ts
export interface GatewayRuntimeConfig {
  provider: 'kimi' | 'mock'
  rubricStrategy: 'single-pass-v1' | 'two-pass-legacy'
  essayPromptProfile: 'optimized-v1' | 'legacy'
  executionRegistry: 'memory-v1' | 'direct-legacy'
  deadlines: { httpMs: number; providerFinalMs: number; settlementGraceMs: number }
  admission: { hardLimit: number }
  registry: { terminalTtlMs: number; maxEntries: number }
  retry: { maxProviderAttempts: 2; maxRateLimitRequeues: 5; baseMs: 2000; capMs: 60000; pauseAfterMs: 900000 }
  kimi: {
    apiBase: string
    model: string
    reasoningEffort: 'low'
    stageBudgets: Record<ProviderCallStage, number>
    promptCacheSecret: string
  }
}
```

- [ ] **Step 1: Write RED config and health tests**

Cover explicit Provider selection, the verified China K3 baseline, all four independent `1..16384` budgets, positive capacities, `providerFinalMs >= httpMs + 30_000`, positive grace, exact retry limits, and a cache HMAC secret of at least 32 UTF-8 bytes for optimized Kimi. `terminalTtlMs` starts only when a terminal state is produced and must be at least the configured reattachment window; neither `in_flight` nor an orphan that still owns a promise/lease receives a TTL or becomes an LRU victim. Assert invalid values throw a content-free startup configuration error rather than falling back.

Replace the minimal health expectation with a safe runtime snapshot containing Provider, model, reasoning effort, deadline values, stage budgets, hard limit, execution modes and pause status—never Key, secret, raw IDs, usage, content or digest.

- [ ] **Step 2: Write RED telemetry and image metadata tests**

`SafeProviderMetric` may contain stage, model, reasoning effort, random diagnostic IDs, queue/provider/parse/normalize/total durations, valid usage, finish reason, attempt, outcome, page count, total bytes, safe dimensions and confirmed-text code-unit count. Test that serialization rejects or omits unknown keys and known sensitive marker values. The Provider-attempt accounting sink deduplicates on random `attemptDiagnosticId`; only an attempt that returned valid usage contributes token totals, and operation/attachment timing events never carry usage, so no later layer can count the same tokens again.

`readSafeImageDimensions()` must parse bounded PNG/JPEG/WebP headers without decoding pixels; malformed input returns `unknown`. No image bytes are retained in metrics. This module is telemetry-only: it cannot alter buffers, MIME, page order, source digests, upload validation or Provider input, and it is not an image normalizer or OCR preprocessing hook.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/gatewayRuntimeConfig.test.ts src/providerTelemetry.test.ts src/imageMetadata.test.ts src/providers/index.test.ts src/server.test.ts
```

Expected: FAIL because the modules and strict runtime snapshot do not exist.

- [ ] **Step 4: Implement config and telemetry boundaries**

Make `index.ts` call `parseGatewayRuntimeConfig(process.env)` once and pass typed config to `getMultimodalProvider()` and `createServer()`. Remove `process.env.GRADING_PROVIDER ?? 'mock'` and all invalid-timeout fallback behavior. Tests continue to inject fake providers/config directly.

Keep error diagnostics in `safeDiagnostics.ts`; emit usage/timing through the separate `providerTelemetry.ts` sink. Generate random per-process diagnostic IDs with `node:crypto.randomUUID()` or a per-process keyed HMAC; never hash content or log ordinary task/essay IDs. Successful `ProviderCallResult<T>` and `GradingProviderError.details.attemptObservations` pass through one `recordUniqueProviderAttempts()` boundary before normalization/terminal caching; this preserves billing evidence even when strict business validation rejects an otherwise completed response.

- [ ] **Step 5: Update `.env.example` with non-secret explicit settings**

List every setting from “Rollout Switches and Safe Defaults”. Leave both `KIMI_API_KEY=` and `GRADING_PROMPT_CACHE_HMAC_SECRET=` blank. Do not inspect or edit the ignored real `.env` in this task.

- [ ] **Step 6: Run tests and typecheck**

```powershell
npm.cmd test -- src/gatewayRuntimeConfig.test.ts src/providerTelemetry.test.ts src/imageMetadata.test.ts src/providers/index.test.ts src/server.test.ts
npm.cmd run typecheck
```

Expected: PASS; starting with missing/invalid real config fails before listening, while injected tests remain deterministic.

**Phase 0 release gate:** verify or deploy only explicit runtime configuration plus usage, finish-reason and timing observation with `two-pass-legacy`, `legacy`, `direct-legacy` and `single-legacy` active. Do not enable canonical prompt reduction, single-pass rubric, memory registry/admission, adaptive queue or image variants at this checkpoint. This gate produces fake evidence only; a real baseline still requires Task 16 authorization.

- [ ] **Step 7: Commit Task 2**

```powershell
git add grading-gateway/src/gatewayRuntimeConfig.ts grading-gateway/src/gatewayRuntimeConfig.test.ts grading-gateway/src/providerTelemetry.ts grading-gateway/src/providerTelemetry.test.ts grading-gateway/src/imageMetadata.ts grading-gateway/src/imageMetadata.test.ts grading-gateway/src/providers/index.ts grading-gateway/src/providers/index.test.ts grading-gateway/src/index.ts grading-gateway/src/server.ts grading-gateway/src/server.test.ts grading-gateway/.env.example
git commit -m "feat: require explicit safe grading runtime config"
```

---

## Task 3: Collapse AI rubric generation to one normal completion

**Files:**

- Modify: `grading-gateway/src/multimodal/rubricPrompts.ts`
- Modify: `grading-gateway/src/multimodal/rubricPrompts.test.ts`
- Modify: `grading-gateway/src/providers/kimiMultimodalProvider.ts`
- Modify: `grading-gateway/src/providers/kimiMultimodalProvider.test.ts`
- Modify: `grading-gateway/src/server.test.ts`

- [ ] **Step 1: Replace old two-call expectations with RED single-pass cases**

Assert `single-pass-v1`:

- calls transport exactly once;
- includes every ordered material exactly once;
- carries the teacher writing requirement with highest authority;
- requests one final strict object containing summary, requirements, constraints, dimensions and warnings;
- validates locally and never makes a hidden review/repair call after schema/business failure.

Keep one explicit `two-pass-legacy` test proving the isolated rollback flag still performs the historical review; it must not be the default example or normal config.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/multimodal/rubricPrompts.test.ts src/providers/kimiMultimodalProvider.test.ts src/server.test.ts
```

Expected: FAIL because `generateRubric()` still always performs draft and review completions.

- [ ] **Step 3: Implement strategy selection**

Add a final self-check instruction to the generation prompt and return the validated first completion in `single-pass-v1`. Preserve `prioritizeRubricContext()` and `validateGeneratedRubric()` as deterministic local safeguards. Do not alter teacher input or weights after validation.

Return `ProviderCallResult<GeneratedRubricV1>` while preserving the normal call’s one completion observation. Legacy review returns two distinct observations and must be recorded twice only when the explicit legacy flag is used. If draft/review business validation fails after an HTTP completion, attach the already-finished observation(s) to the controlled Provider error so cost is still counted once without preserving raw output.

- [ ] **Step 4: Verify one-call behavior**

```powershell
npm.cmd test -- src/multimodal/rubricPrompts.test.ts src/providers/kimiMultimodalProvider.test.ts src/server.test.ts
npm.cmd run typecheck
```

Expected: PASS; the normal rubric route has one transport call and one copy of each material.

The rubric strategy remains independently switchable. Rollback selects `two-pass-legacy` without changing the teacher-visible rubric contract; no hidden second call may occur while `single-pass-v1` is selected.

- [ ] **Step 5: Commit Task 3**

```powershell
git add grading-gateway/src/multimodal/rubricPrompts.ts grading-gateway/src/multimodal/rubricPrompts.test.ts grading-gateway/src/providers/kimiMultimodalProvider.ts grading-gateway/src/providers/kimiMultimodalProvider.test.ts grading-gateway/src/server.test.ts
git commit -m "feat: generate rubrics with one Kimi completion"
```

---

## Task 4: Project one canonical task context and stable opaque prompt prefix

**Files:**

- Create: `grading-gateway/src/multimodal/modelTaskContext.ts`
- Create: `grading-gateway/src/multimodal/modelTaskContext.test.ts`
- Modify: `grading-gateway/src/multimodal/gradingPrompt.ts`
- Modify: `grading-gateway/src/multimodal/gradingPrompt.test.ts`
- Modify: `grading-gateway/src/providers/kimiMultimodalProvider.ts`
- Modify: `grading-gateway/src/providers/kimiMultimodalProvider.test.ts`

**Interfaces:**

```ts
export const MODEL_TASK_CONTEXT_VERSION = 'model-task-context-v1'
export const ESSAY_PROVIDER_SCHEMA_VERSION = 'essay-grading-provider-v2'

export interface ModelTaskContextV1 {
  fullScore: number
  materialSummary: string
  writingRequirements: string[]
  constraints: string[]
  reviewWarnings: string[]
  dimensions: Array<{ id: string; name: string; description: string; weight: number }>
}

export function projectModelTaskContext(task: ConfirmedTaskPackageV2): ModelTaskContextV1
export function canonicalTaskContextJson(context: ModelTaskContextV1): string
export function derivePromptCacheKey(input: {
  taskId: string
  rubricRevisionDigest: string
  gradingPolicyVersion: string
  providerSchemaVersion: string
  hmacSecret: string
}): string
```

- [ ] **Step 1: Write RED projection and cache-key tests**

Verify the projection contains exactly the approved fields, preserves dimension IDs and business order, keeps normalized/deduplicated/bounded `reviewWarnings` once, and omits `taskName`, `sourceEvidence`, duplicate rubric context, student/essay identity and materials.

Verify the HMAC-based base64url cache key changes with task/rubric/policy/schema revision, is stable for equivalent canonical input, and contains none of the raw task ID, teacher task name or context text.

- [ ] **Step 2: Write RED prompt-order tests**

Assert message order is:

1. stable grading policy;
2. stable canonical task context;
3. essay-specific instruction;
4. ordered pages, or exact teacher-confirmed text with zero images.

Assert `essayId` and student name never enter Provider messages. The full external v2 task must still be validated before projection.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/multimodal/modelTaskContext.test.ts src/multimodal/gradingPrompt.test.ts src/providers/kimiMultimodalProvider.test.ts
```

Expected: FAIL because the prompt currently serializes the complete duplicate task and has no opaque cache key.

- [ ] **Step 4: Implement canonical messages and cache binding**

Use canonical JSON only for deterministic digest/cache input; do not log it. `KimiMultimodalProvider.gradeEssay()` chooses stage `essay_grading_images` or `essay_regrading_text`, passes that stage’s budget, and attaches the opaque `prompt_cache_key` only in `optimized-v1`.

The legacy prompt profile remains isolated for A baseline/rollback and must carry a distinct provider schema version so registry results cannot cross profiles.

- [ ] **Step 5: Verify prompt privacy and type safety**

```powershell
npm.cmd test -- src/multimodal/modelTaskContext.test.ts src/multimodal/gradingPrompt.test.ts src/providers/kimiMultimodalProvider.test.ts
npm.cmd run typecheck
```

Expected: PASS; current external task package remains unchanged, but Provider sees one minimal stable context.

- [ ] **Step 6: Commit Task 4**

```powershell
git add grading-gateway/src/multimodal/modelTaskContext.ts grading-gateway/src/multimodal/modelTaskContext.test.ts grading-gateway/src/multimodal/gradingPrompt.ts grading-gateway/src/multimodal/gradingPrompt.test.ts grading-gateway/src/providers/kimiMultimodalProvider.ts grading-gateway/src/providers/kimiMultimodalProvider.test.ts
git commit -m "feat: canonicalize Kimi grading context"
```

---

## Task 5: Remove Provider-authored aggregate revisions without changing public results

**Files:**

- Modify: `grading-gateway/src/multimodal/providerResultContract.ts`
- Modify: `grading-gateway/src/multimodal/gradingPrompt.ts`
- Modify: `grading-gateway/src/multimodal/gradingPrompt.test.ts`
- Modify: `grading-gateway/src/multimodal/normalizeMultimodalResult.ts`
- Modify: `grading-gateway/src/multimodal/normalizeMultimodalResult.test.ts`
- Modify: `grading-gateway/src/multimodal/resultPolicy.test.ts`
- Modify: `grading-gateway/src/server.test.ts`
- Verify only: `app/src/services/grading/gatewayContract.test.ts`
- Verify only: `app/src/services/grading/projectGradingClientResponse.test.ts`

- [ ] **Step 1: Write RED internal-schema and public-result tests**

Assert the optimized Provider schema’s `fullTextRevision` requires only `sentencePairs`, `logicNotes` and `logicIssues`, with no `correctedText` or `improvedText` properties. Assert a raw Provider payload without those aggregates is accepted, while Gateway reconstructs both full texts from transcript plus safe sentence pairs.

Keep tests proving the final `grading-result-v2.fullTextRevision.correctedText/improvedText` remain required and compatible with website projection.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
Set-Location D:\wenjie-writewise-ai\grading-gateway
npm.cmd test -- src/multimodal/gradingPrompt.test.ts src/multimodal/normalizeMultimodalResult.test.ts src/multimodal/resultPolicy.test.ts src/server.test.ts
```

Expected: FAIL because the Provider schema still requires both aggregates and the normalizer marks their absence degraded.

- [ ] **Step 3: Implement the internal-only contract reduction**

Remove only the two raw aggregate keys from the optimized strict schema and parser. Delete the `auxiliaryInputDegraded` branch that treats those two absent values as degradation. Continue using existing `resultPolicy.ts` reconstruction; do not change external app types or final result keys.

The legacy prompt profile may still request the aggregates for frozen baseline comparison, but the normalizer must ignore them as non-authoritative.

- [ ] **Step 4: Run Gateway and website contract tests**

```powershell
npm.cmd test -- src/multimodal/gradingPrompt.test.ts src/multimodal/normalizeMultimodalResult.test.ts src/multimodal/resultPolicy.test.ts src/server.test.ts
Set-Location D:\wenjie-writewise-ai\app
npm.cmd test -- src/services/grading/gatewayContract.test.ts src/services/grading/projectGradingClientResponse.test.ts
npm.cmd run typecheck
```

Expected: PASS; teacher-visible corrected and improved full texts remain complete.

The optimized essay profile remains independently switchable. Rollback selects `legacy` without changing the public v2 contract, without enabling OCR, and without adding a second essay Provider call.

- [ ] **Step 5: Commit Task 5**

```powershell
Set-Location D:\wenjie-writewise-ai
git add grading-gateway/src/multimodal/providerResultContract.ts grading-gateway/src/multimodal/gradingPrompt.ts grading-gateway/src/multimodal/gradingPrompt.test.ts grading-gateway/src/multimodal/normalizeMultimodalResult.ts grading-gateway/src/multimodal/normalizeMultimodalResult.test.ts grading-gateway/src/multimodal/resultPolicy.test.ts grading-gateway/src/server.test.ts
git commit -m "feat: rebuild aggregate revisions in gateway"
```

---

## Task 6: Compute deterministic Gateway-only logical request identities

**Files:**

- Create: `grading-gateway/src/multimodal/logicalRequestIdentity.ts`
- Create: `grading-gateway/src/multimodal/logicalRequestIdentity.test.ts`
- Reuse: `grading-gateway/src/multimodal/modelTaskContext.ts`

**Interfaces:**

```ts
export interface CanonicalGradeIdentity {
  rubricRevisionDigest: string
  essaySourceRevisionDigest: string
  logicalRequestId: string
  payloadHash: string
}

export function createCanonicalGradeIdentity(
  input: {
    task: ConfirmedTaskPackageV2
    essayId: string
    pageIds: readonly string[]
    pages: readonly GatewayImageInput[]
    confirmedTranscript?: string
  },
  versions: { gradingPolicyVersion: string; providerSchemaVersion: string },
): CanonicalGradeIdentity
```

- [ ] **Step 1: Write exhaustive RED canonicalization tests**

Cover:

- object key order does not change a digest;
- business array order does change the relevant digest;
- finite numbers have one representation and non-finite values are rejected;
- `reviewWarnings` use the same normalize/dedupe/bounds as model context;
- image mode includes ordered page index, MIME, byte length and exact per-page SHA-256; filename is excluded;
- confirmed-text mode hashes exact validated UTF-8 bytes without trim, correction, case conversion or Unicode normalization;
- task ID, essay ID, policy and schema versions all bind the final logical ID;
- payload hash excludes caller `requestId` but covers the complete validated external payload: `requestVersion`, `essayId`, ordered `pageIds`, full `ConfirmedTaskPackageV2` including non-Prompt fields such as `taskName`, `deductionFocus` and `sourceEvidence`, mode/exact confirmed text, ordered MIME/byte lengths and exact page bytes;
- changing only a non-Prompt field can keep the logical ID stable while changing `payloadHash`, which must produce a safe conflict rather than unsafe cache reuse;
- legacy versus optimized prompt profile is bound through the actual `providerSchemaVersion` call site and can never share a logical ID;
- none of the digests are included in safe thrown messages.

- [ ] **Step 2: Run test and verify RED**

```powershell
Set-Location D:\wenjie-writewise-ai\grading-gateway
npm.cmd test -- src/multimodal/logicalRequestIdentity.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement with `node:crypto` SHA-256/base64url**

Keep caller `requestId` separate. The registry key is the version-prefixed `logicalRequestId`; `payloadHash` is stored only inside the in-memory registry. Do not export either in HTTP or telemetry.

- [ ] **Step 4: Verify deterministic identities**

```powershell
npm.cmd test -- src/multimodal/logicalRequestIdentity.test.ts
npm.cmd run typecheck
```

Expected: PASS on both image and confirmed-text modes.

- [ ] **Step 5: Commit Task 6**

```powershell
git add grading-gateway/src/multimodal/logicalRequestIdentity.ts grading-gateway/src/multimodal/logicalRequestIdentity.test.ts
git commit -m "feat: derive deterministic grading identities"
```

---

## Task 7: Implement global adaptive Provider admission with a real hard cap

**Files:**

- Create: `grading-gateway/src/providerAdmissionController.ts`
- Create: `grading-gateway/src/providerAdmissionController.test.ts`

**Interfaces:**

```ts
export type AdmissionPauseReason =
  | 'provider_auth_failed'
  | 'provider_balance_unavailable'
  | 'provider_not_configured'
  | 'long_retry_after'

export interface AdmissionLease {
  readonly id: string
  release(outcome:
    | { kind: 'success' }
    | { kind: 'rate_limited'; notBeforeMs: number }
    | { kind: 'confirmed_failure' }
  ): void
}

export type AdmissionDecision =
  | { accepted: true; lease: AdmissionLease; queueWaitMs: 0 }
  | { accepted: false; reason: 'target_busy' | 'hard_limit' | 'paused'; retryAfterMs?: number }

export class ProviderAdmissionController {
  tryAcquire(now?: number): AdmissionDecision
  pause(reason: AdmissionPauseReason): void
  resume(): void
  snapshot(): AdmissionSnapshot
}
```

- [ ] **Step 1: Write RED controller tests with an injected clock**

Assert:

- target starts at 1 and never exceeds configured hard limit;
- a bounded stable-success window increments target by exactly 1;
- a confirmed `429` release receives the absolute `notBeforeMs` precomputed by the registry, halves target with floor 1, and blocks every task/caller before that time; the controller does not compute jitter;
- the controller enforces a registry-provided `long_retry_after` pause and otherwise blocks only until the supplied absolute `notBeforeMs`; it does not inspect Provider `Retry-After` or compute retry timing;
- auth/balance/config pause all new admission until explicit resume;
- unrelated confirmed single-item failures release only their lease;
- a lease can be retained indefinitely for an orphan and hard-limit exhaustion rejects new admission rather than releasing or oversubscribing;
- double release and unknown lease IDs fail closed in tests;
- multiple tasks/callers share the same global controller.

- [ ] **Step 2: Run test and verify RED**

```powershell
npm.cmd test -- src/providerAdmissionController.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement additive increase/multiplicative decrease**

Use no background polling and no official account-tier table. `tryAcquire()` either returns a counted lease synchronously or a safe bounded rejection. Registry/frontend reattachment handles later attempts; queue wait never consumes a Provider execution deadline. The registry alone validates Provider `Retry-After`, computes jitter and supplies either an absolute `notBeforeMs` or an explicit `long_retry_after` pause to this controller.

- [ ] **Step 4: Verify controller invariants**

```powershell
npm.cmd test -- src/providerAdmissionController.test.ts
npm.cmd run typecheck
```

Expected: PASS; observed active leases are always `<= hardLimit`.

- [ ] **Step 5: Commit Task 7**

```powershell
git add grading-gateway/src/providerAdmissionController.ts grading-gateway/src/providerAdmissionController.test.ts
git commit -m "feat: add bounded adaptive provider admission"
```

---

## Task 8: Implement the single-process essay registry, retry state machine, and dual deadlines

**Files:**

- Create: `grading-gateway/src/essayGradingRegistry.ts`
- Create: `grading-gateway/src/essayGradingRegistry.test.ts`
- Reuse: `grading-gateway/src/providerAdmissionController.ts`
- Reuse: `grading-gateway/src/providerTelemetry.ts`

**State model:**

```ts
export type RegistryState =
  | 'in_flight'
  | 'succeeded'
  | 'failed_retryable'
  | 'failed_final'
  | 'orphaned_unknown'

export interface EssayGradingRegistryOptions {
  admission: ProviderAdmissionController
  providerFinalDeadlineMs: number
  settlementGraceMs: number
  terminalTtlMs: number
  maxEntries: number
  maxProviderAttempts: 2
  maxRateLimitRequeues: 5
  retryBaseMs: 2000
  retryCapMs: 60000
  retryAfterPauseMs: 900000
  now?: () => number
  random?: () => number
  timers?: RegistryTimers
  onMetric?: SafeProviderMetricSink
}

interface AttemptCounters {
  nonRateLimitedProviderAttempts: number
  rateLimitRequeues: number
}

type RegistryResultTemplate =
  | { kind: 'success'; result: Omit<AiGradingResultV1, 'requestId'> }
  | { kind: 'failure'; failure: Omit<GradingFailureV1, 'requestId'> }
```

- [ ] **Step 1: Write RED idempotency and cache tests**

Assert concurrent same logical ID/same payload attaches call the executor once; same logical ID/different payload returns a content-free conflict with zero second calls; succeeded results are cached within TTL and rebound to each caller `requestId`; caller IDs never participate in registry identity.

- [ ] **Step 2: Write RED lifecycle, deadline and capacity tests**

Cover every approved edge:

- only terminal entries past minimum retention may be evicted;
- `in_flight` and unresolved orphan entries survive TTL and capacity pressure;
- full capacity with no safe victim rejects new admission;
- Provider final deadline starts only after admission and actual dispatch; it aborts, settlement grace waits, then unresolved work becomes `orphaned_unknown` while retaining its original admission lease;
- an executor that rejects with `termination='unknown'` transitions immediately to `orphaned_unknown`, retains its lease and never retries—even when the local fetch promise has already rejected and can no longer deliver late success;
- late success becomes cached success and releases exactly once;
- late confirmed final failure becomes terminal and releases exactly once;
- no timer or ordinary management API releases an unresolved orphan;
- caller HTTP deadline is not owned by this registry and cannot abort/release the shared attempt.

- [ ] **Step 3: Write RED retry tests**

Assert a confirmed transient non-429 failure allows at most two `nonRateLimitedProviderAttempts` with exponential full jitter. Confirmed `429` does not consume that counter; it increments `rateLimitRequeues`, may schedule at most five same-entry requeues, and honors Provider `Retry-After` as a lower bound. Five 429 responses may still be followed by the fifth requeue’s first non-429 success; a sixth consecutive 429 schedules no seventh call. `Retry-After > 15 minutes` pauses instead of requeueing. Auth/balance/config pauses global admission; unknown network/abort increments neither retry counter and never opens new work; failed-final and orphan states are reattachable but cannot start another Provider call.

Use this exact delay calculation after a confirmed 429 whose delay does not trigger pause:

```ts
const exponentialCap = Math.min(retryCapMs, retryBaseMs * 2 ** rateLimitRequeues)
const fullJitterMs = Math.floor(random() * exponentialCap)
const retryDelayMs = Math.max(providerRetryAfterMs ?? 0, fullJitterMs)
const notBeforeMs = now() + retryDelayMs
lease.release({ kind: 'rate_limited', notBeforeMs })
```

Add attach-state assertions: before `retryAt`, `failed_retryable` returns a bound safe failure plus remaining Retry-After without dispatch; at/after `retryAt`, concurrent attaches perform exactly one atomic reacquire/transition; `failed_final` and `orphaned_unknown` return caller-bound cached failure templates without Provider work.

- [ ] **Step 4: Run test and verify RED**

```powershell
npm.cmd test -- src/essayGradingRegistry.test.ts
```

Expected: FAIL because the registry does not exist.

- [ ] **Step 5: Implement atomic transitions and result templates**

Because Node executes a synchronous section atomically between awaits, perform lookup, payload comparison, admission and state replacement before starting/awaiting the executor. Cache `Omit<AiGradingResultV1, 'requestId'>`; clone and bind the caller ID only at attachment response time.

Record each actual Provider HTTP attempt at most once through its random `attemptDiagnosticId`; valid usage is attached at most once when returned. A legal second confirmed transient attempt receives a new diagnostic ID and is counted separately, while HTTP attachments emit only no-usage wait events. Internal dedupe may bind logical ID plus attempt ordinal, but neither value is written to logs.

The registry does not create an unbounded background retry loop. It stores `retryAt` and counters in `failed_retryable`; the website scheduler reattaches the same job after the bounded delay, and that attachment atomically performs `failed_retryable → in_flight` only after admission succeeds. Thus a closed browser does not silently spend more tokens, while an active task still retries automatically under the approved policy.

- [ ] **Step 6: Run deterministic registry tests**

```powershell
npm.cmd test -- src/essayGradingRegistry.test.ts src/providerAdmissionController.test.ts src/providerTelemetry.test.ts
npm.cmd run typecheck
```

Expected: PASS without sleeps; all clocks, timers and jitter are injected.

- [ ] **Step 7: Commit Task 8**

```powershell
git add grading-gateway/src/essayGradingRegistry.ts grading-gateway/src/essayGradingRegistry.test.ts
git commit -m "feat: deduplicate essay grading executions"
```

---

## Task 9: Integrate admission, registry, safe reattachment, and one-shot route tracking

**Files:**

- Create: `grading-gateway/src/oneShotProviderExecution.ts`
- Create: `grading-gateway/src/oneShotProviderExecution.test.ts`
- Modify: `grading-gateway/src/providers/kimiTransport.ts`
- Modify: `grading-gateway/src/providers/kimiTransport.test.ts`
- Modify: `grading-gateway/src/server.ts`
- Modify: `grading-gateway/src/server.test.ts`
- Modify: `grading-gateway/src/index.ts`
- Modify: `grading-gateway/src/types.ts`

- [ ] **Step 1: Write RED grade-route integration tests**

Using real multipart validation plus fake Provider, prove:

- two concurrent same-content requests with different caller IDs execute one Provider call and each receive its own bound caller ID;
- same logical ID/payload mismatch is a safe HTTP 409/`invalid_request` with no content/digest leakage;
- caller HTTP deadline starts at route receipt, before attach/admission; when it expires while the entry is `in_flight` or `orphaned_unknown`, it returns `provider_result_unknown` without aborting registry work or releasing the lease;
- identical reattachment later receives the late cached success;
- unresolved orphan consumes the hard cap and causes new work to receive safe rate-limit/capacity semantics;
- normalized external `grading-result-v2` contains no telemetry or registry fields;
- `Retry-After` is exposed only on rate-limit responses and CORS exposes that header.

Add `provider_result_unknown` only as a documented, content-free v2 failure-code extension. Update Gateway and website validators, fixtures, status mapping and atomic-release checks across Tasks 9–10. It adds no success fields and no telemetry to the body; `retryable=false` plus website-only `reattachOnly=true` means “check the same logical version,” never “create a new completion.” Task 9 and Task 10 must be released atomically; do not enable `memory-v1` before Task 10 is deployed.

Specify HTTP mapping: identity conflict is HTTP 409 + existing `invalid_request`/`retryable=false`; upstream 429 or controller block with a known not-before time is HTTP 429 + `provider_rate_limited` + standard `Retry-After`; hard-cap/orphan capacity uses a content-free capacity/rate-limit failure and sets `Retry-After` only when a truthful retry time exists. Admission rejection, a `failed_retryable` not-before response, and a cached final failure are never mislabeled `provider_result_unknown`.

- [ ] **Step 2: Write RED one-shot material/rubric tracking tests**

Material and rubric calls do not use essay result caching, but must share the global admission controller. Their caller deadline also starts at route receipt; Provider-final timing starts only after a lease is acquired and dispatch occurs. If the HTTP caller times out while the Provider ignores abort, `oneShotProviderExecution` continues tracking the promise and retains its lease until settlement. A late usage event is recorded once and never writes a second HTTP response. No automatic second completion is created.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/oneShotProviderExecution.test.ts src/server.test.ts src/providers/kimiTransport.test.ts
```

Expected: FAIL because routes still use local `Promise.race` and no shared registry/admission.

- [ ] **Step 4: Integrate after all existing validation boundaries**

For `/grading/grade-images`:

1. capture `receivedAt = monotonicNow()` and finish existing metadata/mode/file/task validation;
2. derive internal identity;
3. attach to registry;
4. executor invokes Provider and normalizer once, producing a result template;
5. race only the caller attachment against the absolute `receivedAt + httpMs` deadline without canceling shared work;
6. bind caller `requestId` to success/failure.

Inject monotonic clock, timers, registry and one-shot tracker through `CreateServerOptions` so all route deadline tests use fake time rather than sleeps. Settlement grace starts only after Provider-final abort. `provider_result_unknown` applies only to genuinely dispatched in-flight/orphan work.

Add `exposedHeaders: ['Retry-After']` to CORS. Write that header only for responses with a truthful retry time; never synthesize it for unknown orphan/capacity state.

For material/rubric routes, wrap the single Provider completion with global admission and one-shot tracking. Queue/admission wait must not consume `providerFinalMs`.

- [ ] **Step 5: Verify route invariants and full Gateway tests**

```powershell
npm.cmd test -- src/oneShotProviderExecution.test.ts src/server.test.ts src/essayGradingRegistry.test.ts src/providerAdmissionController.test.ts src/providers/kimiTransport.test.ts
npm.cmd run typecheck
npm.cmd test
npm.cmd run verify:shared-scoring-runtime
```

Expected: all Gateway tests pass; old tests that expected a timeout to discard late work are replaced by reattachment/orphan assertions.

The `memory-v1` execution profile remains independently switchable. Rollback selects `direct-legacy` while retaining explicit Provider selection and the public v2 contract; it must be documented as losing registry deduplication and may not be described as equally safe for public multi-client traffic.

- [ ] **Step 6: Commit Task 9**

```powershell
git add grading-gateway/src/oneShotProviderExecution.ts grading-gateway/src/oneShotProviderExecution.test.ts grading-gateway/src/providers/kimiTransport.ts grading-gateway/src/providers/kimiTransport.test.ts grading-gateway/src/server.ts grading-gateway/src/server.test.ts grading-gateway/src/index.ts grading-gateway/src/types.ts
git commit -m "feat: track and reattach bounded grading calls"
```

---

## Task 10: Make all website AI clients explicit and preserve safe retry metadata

**Files:**

- Create: `app/src/services/grading/gradingRuntimeConfig.ts`
- Create: `app/src/services/grading/gradingRuntimeConfig.test.ts`
- Modify: `app/src/services/grading/types.ts`
- Modify: `app/src/services/grading/gradingClient.ts`
- Modify: `app/src/services/grading/gradingClient.test.ts`
- Modify: `app/src/services/grading/remoteGradingClient.ts`
- Modify: `app/src/services/grading/remoteGradingClient.test.ts`
- Modify: `app/src/services/grading/projectGradingClientResponse.ts`
- Modify: `app/src/services/grading/projectGradingClientResponse.test.ts`
- Modify: `app/src/services/taskMaterial/materialClient.ts`
- Modify: `app/src/services/taskMaterial/materialClient.test.ts`
- Modify: `app/src/services/taskRubric/rubricClient.ts`
- Modify: `app/src/services/taskRubric/rubricClient.test.ts`
- Modify: `app/.env.example`

- [ ] **Step 1: Write RED explicit-mode tests**

Replace tests that map undefined/invalid mode to mock. Require exact `mock` or `real`; missing/invalid real config returns a fixed `provider_not_configured` client failure without network access. Apply the same rule to grading, task-material and rubric clients.

Parse `VITE_GRADING_QUEUE_MODE=adaptive-v1|single-legacy` and positive `VITE_GRADING_MAX_IN_FLIGHT`; real adaptive mode requires an explicit hard limit. Frontend config contains no Provider Key/model secret.

- [ ] **Step 2: Write RED `Retry-After` and unknown-result tests**

Keep strict JSON body projection. After a valid failure body is projected, parse a finite non-negative standard `Retry-After` without shortening it into a local-only optional `retryAfterMs`; malformed, negative or implementation-overflow values are ignored. Do not require or accept it in Gateway JSON. Compare the full delay against the scheduler pause threshold. Preserve `provider_result_unknown` as non-retryable Provider work with an explicit internal `reattachOnly=true` classification.

Use an explicit type split:

```ts
export interface GradingFailureV1 {
  requestId: string
  status: 'failed'
  error: { code: GradingErrorCode; message: string; retryable: boolean }
}

export interface GradingClientFailure extends GradingFailureV1 {
  clientMeta?: { retryAfterMs?: number; reattachOnly?: true }
}

export type GradingClientResponse = AiGradingResultV1 | GradingClientFailure
```

`projectGradingClientResponse()` validates and returns only the body-derived failure. `remoteGradingClient` then calls a pure `attachSafeFailureMetadata(failure, response.headers, now)` to add local metadata. Add `provider_result_unknown` to `GradingErrorCode`, `safeMessages` and exact projection tests. `clientMeta` never appears in Gateway JSON, multipart metadata or a public success result.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
Set-Location D:\wenjie-writewise-ai\app
npm.cmd test -- src/services/grading/gradingRuntimeConfig.test.ts src/services/grading/gradingClient.test.ts src/services/grading/remoteGradingClient.test.ts src/services/grading/projectGradingClientResponse.test.ts src/services/taskMaterial/materialClient.test.ts src/services/taskRubric/rubricClient.test.ts
```

Expected: FAIL because missing modes silently create mock clients and no response metadata is preserved.

- [ ] **Step 4: Implement shared explicit config and local metadata**

Do not loosen exact response-body key validation. Only `GradingClientFailure` may receive local `clientMeta` after `remoteGradingClient` has completed strict projection; `GradingFailureV1`, Gateway JSON and Gateway fixtures remain the pure public response shape.

- [ ] **Step 5: Update `.env.example` and verify**

Add only `VITE_GRADING_QUEUE_MODE=adaptive-v1` and `VITE_GRADING_MAX_IN_FLIGHT=4`; retain real API base and warning against secrets in `VITE_*`.

```powershell
npm.cmd test -- src/services/grading/gradingRuntimeConfig.test.ts src/services/grading/gradingClient.test.ts src/services/grading/remoteGradingClient.test.ts src/services/grading/projectGradingClientResponse.test.ts src/services/taskMaterial/materialClient.test.ts src/services/taskRubric/rubricClient.test.ts
npm.cmd run typecheck
```

- [ ] **Step 6: Commit Task 10**

```powershell
Set-Location D:\wenjie-writewise-ai
git add app/src/services/grading/gradingRuntimeConfig.ts app/src/services/grading/gradingRuntimeConfig.test.ts app/src/services/grading/types.ts app/src/services/grading/gradingClient.ts app/src/services/grading/gradingClient.test.ts app/src/services/grading/remoteGradingClient.ts app/src/services/grading/remoteGradingClient.test.ts app/src/services/grading/projectGradingClientResponse.ts app/src/services/grading/projectGradingClientResponse.test.ts app/src/services/taskMaterial/materialClient.ts app/src/services/taskMaterial/materialClient.test.ts app/src/services/taskRubric/rubricClient.ts app/src/services/taskRubric/rubricClient.test.ts app/.env.example
git commit -m "feat: fail closed website AI configuration"
```

---

## Task 11: Build a pure task scheduler for adaptive bounded HTTP concurrency

**Files:**

- Create: `app/src/services/grading/taskGradingScheduler.ts`
- Create: `app/src/services/grading/taskGradingScheduler.test.ts`

**Interfaces:**

```ts
export type QueueItemPhase =
  | 'queued'
  | 'running'
  | 'rate_limit_wait'
  | 'result_unknown'
  | 'retryable_failure'
  | 'final_failure'
  | 'succeeded'

export interface TaskQueueSnapshot {
  taskId: string
  status: 'idle' | 'running' | 'paused' | 'settled'
  pauseReason?: 'auth' | 'balance' | 'configuration' | 'long_retry_after'
  targetConcurrency: number
  activeCount: number
  queuedCount: number
  items: Readonly<Record<string, QueueItemSnapshot>>
}

export interface QueueItemSnapshot {
  essayId: string
  phase: QueueItemPhase
  requestId: string
  sourceGeneration: number
  rubricGeneration: number
  retryAt?: number
  retryable: boolean
  reattachOnly: boolean
  errorCode?: string
  errorMessage?: string
}

export interface GradingJob {
  taskId: string
  essayId: string
  requestId: string
  sourceGeneration: number
  rubricGeneration: number
  run(): Promise<GradingClientResponse>
}

export interface TaskGradingSchedulerOptions {
  mode: 'adaptive-v1' | 'single-legacy'
  hardLimit: number
  stableSuccessWindow: number
  now?: () => number
  random?: () => number
  timers?: SchedulerTimers
}

export interface TaskGradingScheduler {
  startTask(taskId: string, jobs: readonly GradingJob[]): void
  retryEssay(taskId: string, essayId: string): void
  checkUnknownEssay(taskId: string, essayId: string): void
  resumeTask(taskId: string): void
  getSnapshot(taskId: string): TaskQueueSnapshot
  subscribe(listener: (snapshot: TaskQueueSnapshot) => void): () => void
  dispose(): void
}

export function createTaskGradingScheduler(
  options: TaskGradingSchedulerOptions,
): TaskGradingScheduler
```

- [ ] **Step 1: Write RED scheduler tests**

With injected clock/timers/randomness, prove:

- one `startTask()` action enqueues every supplied pending essay in stable student order;
- duplicate start/attach reuses the same job/request ID;
- active HTTP jobs never exceed dynamic target or configured hard limit;
- stable success increments target by 1 after a bounded success window, and completion immediately fills an available slot;
- rate limit halves target, waits at least `retryAfterMs`, and re-runs the same job/request ID;
- one essay failure does not block unrelated essays;
- auth/balance/config pauses new jobs while preserving success;
- pausing stops only new dispatch/requeue; already running HTTP jobs continue to settle and may update their own item, but may not refill a slot until explicit resume;
- a registry-supplied bounded `retryAfterMs` automatically reattaches the same job and lets Gateway enforce its remaining attempt/requeue budget; a retryable client failure with no scheduled registry retry (for example, Gateway transport unavailable before a classified Provider outcome) waits for an explicit teacher retry; a final non-retryable failure has no retry action;
- `result_unknown` never creates new Provider work and only permits same-job reattachment/check;
- `single-legacy` fixes target and hard limit at 1 without a second scheduler implementation.

- [ ] **Step 2: Run test and verify RED**

```powershell
npm.cmd test -- src/services/grading/taskGradingScheduler.test.ts
```

Expected: FAIL because the scheduler does not exist.

- [ ] **Step 3: Implement event-driven pumping**

Use a bounded loop that starts at most the currently available slots. Do not call `Promise.all` across the class. Retain last safe target in the scheduler instance so later tasks in the same app session can reuse it; no Key/hash is stored in logs or browser storage.

- [ ] **Step 4: Verify pure scheduler behavior**

```powershell
npm.cmd test -- src/services/grading/taskGradingScheduler.test.ts
npm.cmd run typecheck
```

- [ ] **Step 5: Commit Task 11**

```powershell
git add app/src/services/grading/taskGradingScheduler.ts app/src/services/grading/taskGradingScheduler.test.ts
git commit -m "feat: schedule bounded whole-task grading"
```

---

## Task 12: Integrate queue generations, stable caller IDs, and stale-result guards into AppState

**Files:**

- Create: `app/src/context/gradingQueueTransitions.ts`
- Create: `app/src/context/gradingQueueTransitions.test.ts`
- Create: `app/src/services/grading/gradingJobIdentity.ts`
- Create: `app/src/services/grading/gradingJobIdentity.test.ts`
- Modify: `app/src/types/index.ts`
- Modify: `app/src/data/mockData.ts`
- Modify: `app/src/data/mockData.test.ts`
- Modify: `app/src/context/gradingStateTransitions.ts`
- Modify: `app/src/context/gradingStateTransitions.test.ts`
- Modify: `app/src/context/appStateContextValue.ts`
- Modify: `app/src/context/AppStateContext.tsx`
- Modify: `app/src/context/AppStateContext.test.tsx`
- Modify: `app/src/services/grading/buildMultimodalGradingRequest.test.ts`

- [ ] **Step 1: Write RED generation and transition tests**

Add backward-compatible `sourceGeneration?: number` to Essay and `rubricGeneration?: number` to Task, interpreting absent legacy/mock values as 0. All newly created tasks/essays and canonical mock fixtures explicitly initialize 0. A content/order change increments the relevant generation before invalidating old results. Extend begin/settle transitions to require matching caller request ID plus captured generations, so a late old response cannot overwrite a newer source/rubric version.

Create a memory-only caller-ID registry:

```ts
export interface GradingJobVersion {
  taskId: string
  essayId: string
  sourceGeneration: number
  rubricGeneration: number
}

export interface GradingJobIdentityStore {
  getOrCreate(version: GradingJobVersion): string
  invalidateEssay(essayId: string): void
}

export function createGradingJobIdentityStore(
  randomId?: () => string,
): GradingJobIdentityStore
```

The store keys exact task/essay/generation tuples and returns one opaque `grading-${UUID}` for every attachment/retry of that version. A source/rubric generation change yields a new ID. IDs contain no student name or content; the Gateway still computes the authoritative content digest. App remount may create a new caller ID, but Gateway content identity still deduplicates the same payload inside a continuously running process.

Queue state remains separate from core `EssayStatus`; `pending_grading → grading → grading_ready → completed` stays the result lifecycle. Temporary queued/rate-limit/unknown/failure presentation lives in queue snapshots.

- [ ] **Step 2: Write RED AppState whole-task tests**

Replace historical tests that assert a fresh request ID on retry or block every second essay. Cover:

- `startTaskGrading(taskId)` enqueues all current actionable essays once;
- configured fake hard limit is never exceeded and completion fills a slot;
- each job gets one caller request ID that is reused for reattachment/retry of unchanged content;
- task-level auth/config pause stops new jobs and `resumeTaskGrading(taskId)` resumes explicitly;
- failed single essay does not stop others;
- teacher-confirmed text regrade still sends zero files and exact text;
- saving changed text increments generation, invalidates old result, creates a new job identity, and rejects a late old response;
- AppState remount still documents loss of in-memory queue/registry guarantees.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/services/grading/gradingJobIdentity.test.ts src/context/gradingQueueTransitions.test.ts src/context/gradingStateTransitions.test.ts src/context/AppStateContext.test.tsx src/data/mockData.test.ts src/services/grading/buildMultimodalGradingRequest.test.ts
```

Expected: FAIL because AppState still has one global lock and random ID per attempt.

- [ ] **Step 4: Integrate one scheduler instance**

Create one `GradingJobIdentityStore` and one `TaskGradingScheduler` in refs. `startTaskGrading()` snapshots current Task/Essay objects, reads generations with `?? 0`, obtains each stable caller ID, builds the existing v2 request once, and submits bounded jobs. Queue callbacks first compare captured/current generations and request ID, then reuse existing settle transitions. Expose:

```ts
taskGradingQueues: Readonly<Record<string, TaskQueueSnapshot>>
startTaskGrading(taskId: string): void
retryTaskEssay(essayId: string): void
checkUnknownTaskEssay(essayId: string): void
resumeTaskGrading(taskId: string): void
```

Remove `isGradingInFlight` as a global blocker and remove the production `fallbackToMockGrading` action. Explicit app mock mode already routes all work to the mock client; a real-mode failure must never silently switch providers.

- [ ] **Step 5: Run AppState tests and typecheck**

```powershell
npm.cmd test -- src/services/grading/gradingJobIdentity.test.ts src/context/gradingQueueTransitions.test.ts src/context/gradingStateTransitions.test.ts src/context/AppStateContext.test.tsx src/data/mockData.test.ts src/services/grading/buildMultimodalGradingRequest.test.ts
npm.cmd run typecheck
```

- [ ] **Step 6: Commit Task 12**

```powershell
Set-Location D:\wenjie-writewise-ai
git add app/src/services/grading/gradingJobIdentity.ts app/src/services/grading/gradingJobIdentity.test.ts app/src/context/gradingQueueTransitions.ts app/src/context/gradingQueueTransitions.test.ts app/src/types/index.ts app/src/data/mockData.ts app/src/data/mockData.test.ts app/src/context/gradingStateTransitions.ts app/src/context/gradingStateTransitions.test.ts app/src/context/appStateContextValue.ts app/src/context/AppStateContext.tsx app/src/context/AppStateContext.test.tsx app/src/services/grading/buildMultimodalGradingRequest.test.ts
git commit -m "feat: integrate version-safe class grading queue"
```

---

## Task 13: Update progress UI for one-click class grading and actionable states

**Files:**

- Modify: `app/src/utils/progressQueue.ts`
- Modify: `app/src/utils/progressQueue.test.ts`
- Modify: `app/src/utils/workflow.ts`
- Modify: `app/src/utils/workflow.test.ts`
- Modify: `app/src/components/EssayStatusChip.tsx`
- Modify: `app/src/components/ProgressSummary.tsx`
- Modify: `app/src/pages/ProgressPage.tsx`
- Modify: `app/src/pages/ProgressPage.test.tsx`
- Modify: `app/src/pages/MultimodalUploadFlow.test.tsx`

- [ ] **Step 1: Write RED UI/state tests**

Replace “one at a time / no automatic concurrency / new retry fee / mock fallback” assertions. Verify the page displays:

- one task-level “开始批改全部待处理作文” action;
- queue counts and per-essay “排队中”“批改中”“因限流等待”“结果确认中”“待教师复核”“可重试失败”“不可重试失败”“已完成” states;
- current bounded concurrency without RPM/TPM/token/cache jargon;
- a task pause banner and explicit resume action for auth/balance/config/long Retry-After;
- retry button only for `retryable=true` final client failures;
- “检查结果” rather than “重试” for `provider_result_unknown`;
- a single essay failure while another essay completes;
- direct-upload multi-student flow lands with every essay available to one task start action.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/utils/progressQueue.test.ts src/utils/workflow.test.ts src/pages/ProgressPage.test.tsx src/pages/MultimodalUploadFlow.test.tsx
```

Expected: FAIL because the page starts only one next essay and shows mock fallback for every failure.

- [ ] **Step 3: Implement concise teacher-facing UI**

Use queue snapshot as presentation data without adding queue phases to the durable Essay result lifecycle. Extend `EssayStatusChip` with an optional queue-phase presentation input (or add an equally small `GradingQueueStatusChip`) and make `getProgressQueueStats()` accept the current task snapshot; do not encode `queued` or `rate_limit_wait` as durable Essay status values. Keep the existing memory-only warning. Update stale OCR-era progress copy to describe direct multimodal Kimi grading; do not delete historical compatibility types outside this focused path.

Use distinct labels consistently: `provider_result_unknown` is “结果确认中” because Provider settlement is unknown; `grading_ready` remains “待教师确认” because a valid result is already available for teacher review.

- [ ] **Step 4: Run UI tests and browser-independent quality gates**

```powershell
npm.cmd test -- src/utils/progressQueue.test.ts src/utils/workflow.test.ts src/pages/ProgressPage.test.tsx src/pages/MultimodalUploadFlow.test.tsx src/pages/EssayResultPage.test.tsx
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

The website queue profile remains independently switchable. Rollback selects `single-legacy`, which reuses the same scheduler and stable caller IDs with a hard limit of 1; it does not restore the old global random-ID lock or mock fallback.

- [ ] **Step 5: Commit Task 13**

```powershell
Set-Location D:\wenjie-writewise-ai
git add app/src/utils/progressQueue.ts app/src/utils/progressQueue.test.ts app/src/utils/workflow.ts app/src/utils/workflow.test.ts app/src/components/EssayStatusChip.tsx app/src/components/ProgressSummary.tsx app/src/pages/ProgressPage.tsx app/src/pages/ProgressPage.test.tsx app/src/pages/MultimodalUploadFlow.test.tsx
git commit -m "feat: expose actionable bounded grading progress"
```

---

## Task 14: Build an offline-safe quality, cost, soak, and image-experiment harness

**Files:**

- Create: `grading-gateway/scripts/gradingBenchmark/types.ts`
- Create: `grading-gateway/scripts/gradingBenchmark/manifest.ts`
- Create: `grading-gateway/scripts/gradingBenchmark/manifest.test.ts`
- Create: `grading-gateway/scripts/gradingBenchmark/metrics.ts`
- Create: `grading-gateway/scripts/gradingBenchmark/metrics.test.ts`
- Create: `grading-gateway/scripts/gradingBenchmark/qualityGates.ts`
- Create: `grading-gateway/scripts/gradingBenchmark/qualityGates.test.ts`
- Create: `grading-gateway/scripts/gradingBenchmark/runner.ts`
- Create: `grading-gateway/scripts/gradingBenchmark/runner.test.ts`
- Create: `grading-gateway/scripts/gradingBenchmark/cli.ts`
- Create: `grading-gateway/scripts/gradingBenchmark/cli.test.ts`
- Create: `grading-gateway/scripts/gradingBenchmark/imageVariants.ts`
- Create: `grading-gateway/scripts/gradingBenchmark/imageVariants.test.ts`
- Create: `grading-gateway/scripts/runFakeAcceptanceGateway.ts`
- Create: `grading-gateway/scripts/runFakeAcceptanceGateway.test.ts`
- Modify: `grading-gateway/package.json`
- Modify: `grading-gateway/tsconfig.json` if the existing scripts glob is insufficient

**Private roots already ignored by Git:**

```text
grading-gateway/local-private-samples/
grading-gateway/local-private-results/
```

- [ ] **Step 1: Write RED manifest privacy/composition tests**

Require anonymous `sample-*` IDs, relative paths resolved strictly inside the private root, ordered pages, confirmed teacher transcript, full-score reference, teacher score, important-issue labels and important-legibility labels. Reject path traversal, identity-like fields and missing references.

`validateDatasetComposition()` requires at least 40 distinct essays, at least 8 single-page, 8 multi-page/PDF-page, 8 clear, 8 difficult, and 8 each in low/middle/high score bands. Strata may overlap but every sample appears once.

- [ ] **Step 2: Write RED metric and release-gate tests**

Implement and test:

- Unicode code-point CER macro/micro;
- `abs(modelScore - teacherScore) / fullScore`;
- important issue and legibility recall;
- unique-completion token aggregation with unknown kept unknown;
- deterministic paired bootstrap 95% confidence intervals;
- token median reduction gate `>=25%`;
- CER degradation upper bound `<=0.005`;
- normalized score-error degradation upper bound `<=0.01`;
- important recall drop `<=0.05`;
- evidence location exactly `100%` for accepted results;
- zero tolerance for student mix, wrong task context, high-risk legibility miss or PII leakage;
- 100-call soak with at most one schema/contract failure;
- 30-essay throughput improvement `>=60%` only when measured effective concurrency is at least 4.

- [ ] **Step 3: Write RED runner/CLI authorization tests**

The runner must isolate failed samples, exercise the real Provider→normalizer→v2 semantic path through injected fakes, and write only anonymous aggregates/provenance. The CLI exit contract is:

```text
0 = complete and all requested gates pass
1 = fatal manifest/config/output error; no quality conclusion
2 = complete but one or more quality/soak gates fail
3 = not_run because authorization or local credentials are absent; zero Provider calls
```

Require exact `GRADING_BENCHMARK_AUTHORIZATION=approved` before constructing a real Provider. Missing Key or authorization must make zero HTTP calls and output one allowlisted status line.

- [ ] **Step 4: Write RED image-experiment isolation tests**

When `GRADING_IMAGE_EXPERIMENT` is absent/disabled, `imageVariants.ts` returns original ordered Buffer references only. Any resize/re-encode variant is rejected without explicit experiment authorization, never enters `server.ts`, and cannot change the default source digest. Do not add an image processing dependency or production transform in this task.

- [ ] **Step 5: Run benchmark tests and verify RED**

```powershell
Set-Location D:\wenjie-writewise-ai\grading-gateway
npm.cmd test -- scripts/gradingBenchmark
```

Expected: FAIL because the benchmark modules do not exist.

- [ ] **Step 6: Implement offline harness and scripts**

Add:

```json
{
  "test:grading-benchmark": "vitest run scripts/gradingBenchmark",
  "eval:grading-baseline": "tsx scripts/gradingBenchmark/cli.ts --variant baseline",
  "eval:grading-candidate": "tsx scripts/gradingBenchmark/cli.ts --variant candidate",
  "eval:grading-soak": "tsx scripts/gradingBenchmark/cli.ts --mode soak --calls 100",
  "eval:grading-throughput": "tsx scripts/gradingBenchmark/cli.ts --mode throughput --essays 30",
  "eval:image-variants": "tsx scripts/gradingBenchmark/cli.ts --mode image-variants",
  "dev:fake-acceptance-gateway": "tsx scripts/runFakeAcceptanceGateway.ts"
}
```

The fake-acceptance script creates the real Express `createServer()` with an injected scripted fake multimodal Provider and short injected deadlines. It accepts only allowlisted scenarios `success`, `rate-limit`, `pause-auth`, `result-unknown`, and `mixed`; outcomes depend on call ordinal and anonymous fixture ID, never essay text. Its tests prove zero network access and deterministic one-time 429, auth pause, ignored-abort/late-success, and normal success behavior. It is not imported by `src/index.ts` or a production build.

Freeze provenance: benchmark version, git commit, model, low reasoning, policy/schema versions, phase budgets, feature profiles and manifest SHA-256. Never save raw Provider responses or visible content.

`eval:grading-throughput` must run serial and candidate scenarios through one Gateway process and the real `/grading/grade-images` execution boundary, or an injected equivalent containing the production admission controller and registry. It reports maximum active admission leases and unique Provider attempt/completion counts. Direct transport fan-out cannot satisfy the hard-cap or idempotency acceptance gate.

The harness may report field count/length distributions for `issues`, revisions, upgrades, pairs, logic and legibility using field names plus anonymous numbers. It must not auto-change production limits; limit tightening remains blocked until real authorized distributions and quality gates exist.

- [ ] **Step 7: Verify no-call behavior and fixture regression**

```powershell
npm.cmd test -- scripts/runPolicyGoldenEval.test.ts scripts/verifyPolicyGoldenFixtures.test.ts scripts/gradingBenchmark
npm.cmd run verify:grading-policy-fixtures
npm.cmd run typecheck
```

Expected: PASS; no credential path performs zero Provider calls with exit code 3 for the new CLI.

- [ ] **Step 8: Commit Task 14**

```powershell
Set-Location D:\wenjie-writewise-ai
git add grading-gateway/scripts/gradingBenchmark grading-gateway/scripts/runFakeAcceptanceGateway.ts grading-gateway/scripts/runFakeAcceptanceGateway.test.ts grading-gateway/package.json grading-gateway/tsconfig.json
git commit -m "test: add private grading quality benchmark"
```

---

## Task 15: Run full fake verification, browser acceptance, security scans, and update memory

**Files:**

- Modify: `AGENTS.md`
- Modify: `docs/current_development_status.md`

**Guard:** Do not modify the approved design to accommodate an implementation deviation. If implementation materially differs, stop, record the mismatch in `docs/current_development_status.md`, and obtain a new user decision before amending the design.

- [ ] **Step 1: Run Gateway full verification**

```powershell
Set-Location D:\wenjie-writewise-ai\grading-gateway
npm.cmd test
npm.cmd run typecheck
npm.cmd run verify:shared-scoring-runtime
npm.cmd run verify:grading-policy-fixtures
```

Expected: all fake/fixture tests pass; no real Kimi call occurs.

- [ ] **Step 2: Run website full verification**

```powershell
Set-Location D:\wenjie-writewise-ai\app
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Expected: all tests and production build pass.

- [ ] **Step 3: Run repository safety checks**

```powershell
Set-Location D:\wenjie-writewise-ai
git diff --check
git check-ignore grading-gateway/.env app/.env
git grep -n -I -E "Authorization: Bearer|KIMI_API_KEY=.+|GRADING_PROMPT_CACHE_HMAC_SECRET=.+" -- . ":(exclude)grading-gateway/.env.example"
rg -n "ocr|OCR" app/src/context/AppStateContext.tsx app/src/pages/ProgressPage.tsx grading-gateway/src/server.ts grading-gateway/src/providers/kimiMultimodalProvider.ts
```

Expected: ignored env files remain ignored; no committed secret value; active grading path contains no OCR call/route/client. Classify any historical label hit rather than deleting unrelated compatibility code.

- [ ] **Step 4: Start fake local services and perform browser acceptance**

Use two dedicated terminal sessions so their exact session IDs can be stopped with Ctrl+C after acceptance. Do not load `grading-gateway/.env` and do not set a real Key.

Terminal A — real Gateway boundary with the scripted fake Provider:

```powershell
Set-Location D:\wenjie-writewise-ai\grading-gateway
$env:HOST='127.0.0.1'
$env:PORT='8792'
$env:FAKE_ACCEPTANCE_SCENARIO='mixed'
$env:FAKE_HTTP_DEADLINE_MS='500'
$env:FAKE_PROVIDER_FINAL_DEADLINE_MS='1200'
$env:FAKE_SETTLEMENT_GRACE_MS='200'
$env:FAKE_PROVIDER_HARD_LIMIT='3'
npm.cmd run dev:fake-acceptance-gateway
```

The `mixed` sequence is fixed by `runFakeAcceptanceGateway.test.ts`: ordinary success, one 429 with a 1-second Retry-After then success, one non-retryable single-essay failure, one auth pause whose later calls succeed after explicit task resume, and one ignored-abort call that passes the 500ms caller deadline but settles successfully before 1200ms.

Terminal B — website using the Gateway as a real client with bounded queue mode:

```powershell
Set-Location D:\wenjie-writewise-ai\app
$env:VITE_GRADING_MODE='real'
$env:VITE_GRADING_API_BASE='http://127.0.0.1:8792'
$env:VITE_GRADING_QUEUE_MODE='adaptive-v1'
$env:VITE_GRADING_MAX_IN_FLIGHT='3'
npm.cmd run dev -- --host 127.0.0.1 --port 5174
```

Wait until `http://127.0.0.1:8792/health` and `http://127.0.0.1:5174/` respond, then use the in-app browser control skill. Verify at desktop `1440×900` and mobile `390×844`:

1. a task with at least five synthetic students offers one start-all action;
2. queued/running/success automatically refill slots without exceeding configured fake hard limit;
3. one fake rate limit shows wait then continues;
4. one fake auth/config error pauses new work and explicit resume works;
5. one single-essay final failure does not block others and only retryable failures show retry;
6. result-unknown shows “检查结果,” never mock fallback;
7. completed essays still open the unchanged teacher review/result pages;
8. browser console has no warning/error and mobile has no horizontal overflow.

After acceptance, send Ctrl+C to the exact two terminal sessions, remove only the variables listed above from those sessions, and verify neither test port is listening:

```powershell
Get-NetTCPConnection -LocalPort 8792,5174 -State Listen -ErrorAction SilentlyContinue
```

Expected: no rows. Do not stop unrelated Node/npm processes by name.

- [ ] **Step 5: Update current project memory with evidence, not claims**

Record exact test counts/commands and implemented feature switches. State clearly:

- fake queue/idempotency/telemetry verification is complete;
- real token reduction, 99% structured rate, CER/score non-degradation and 60% throughput have not been proven until Task 16;
- memory registry does not survive restart or support multi-instance guarantees;
- image bytes are still original and no OCR was introduced.

- [ ] **Step 6: Request an independent code review**

Use `superpowers:requesting-code-review` against the approved spec and this plan. Resolve Critical/Important findings with focused RED tests before claiming completion.

- [ ] **Step 7: Re-run all affected gates after review fixes**

Repeat Steps 1–3 and the browser scenario touched by any fix. Capture fresh outputs.

- [ ] **Step 8: Commit Task 15**

```powershell
Set-Location D:\wenjie-writewise-ai
git add AGENTS.md docs/current_development_status.md
git commit -m "docs: record bounded AI pipeline implementation"
```

---

## Task 16: Manual authorization gate for real Kimi baseline, A/B, soak, and throughput

**This task must stop and ask the user before every numbered real-call round. Do not combine the rounds into one implicit authorization.**

**Private inputs:** only `grading-gateway/local-private-samples/` and ignored local environment/process variables.

- [ ] **Step 1: Present Round A authorization request**

State the exact frozen manifest hash, sample provenance, model/config, and expected request count. Minimum quality A/B is 40 baseline + 40 candidate essay completions = 80 real calls, plus any separately itemized rubric/material smoke calls. Do not start until the user approves the sample scope, count and possible cost.

- [ ] **Step 2: Run baseline and candidate only after approval**

```powershell
Set-Location D:\wenjie-writewise-ai\grading-gateway
$env:GRADING_BENCHMARK_AUTHORIZATION='approved'
npm.cmd run eval:grading-baseline
npm.cmd run eval:grading-candidate
Remove-Item Env:GRADING_BENCHMARK_AUTHORIZATION
```

Expected: anonymous aggregate reports with frozen provenance. The 40 baseline and 40 candidate essay calls use a byte-equivalent, pre-frozen, teacher-confirmed `multimodal-grading-request-v2.task`, the same ordered pages, the same model and `reasoning_effort=low`; these 80 essay calls do not regenerate a rubric. A uses legacy essay prompt/direct single concurrency; B uses optimized essay prompt/memory registry. `two-pass-legacy` versus `single-pass-v1` rubric completion/material cost is measured only in a separately itemized and separately authorized rubric smoke, and never changes the confirmed task package used by the quality A/B. Teacher blind review and the required second-review/7-day rule remain human evidence; the script must not fabricate them.

- [ ] **Step 3: Evaluate Round A gates**

Candidate must meet every spec threshold. If any quality gate fails, leave the corresponding optimization disabled and report the failing metric. Do not compensate with a second model call.

Field-level bounds are not automatically changed. If the authorized A/B plus later soak provides safe distributions, prepare a separate reviewed change using the observed maximum and p99 plus explicit margin; otherwise retain current bounds.

- [ ] **Step 4: Present Round B authorization request for the 100-call soak**

Explain that the soak intentionally creates 100 distinct completion identities so registry cache hits cannot fake stability. Obtain a separate 100-call/cost authorization.

- [ ] **Step 5: Run soak only after Round B approval**

```powershell
$env:GRADING_BENCHMARK_AUTHORIZATION='approved'
npm.cmd run eval:grading-soak
Remove-Item Env:GRADING_BENCHMARK_AUTHORIZATION
```

Expected: at least 99/100 strict schema+normalizer+v2 semantic successes, zero PII/cross-student/task mismatch, and 100% evidence location among accepted results.

- [ ] **Step 6: Present Round C authorization request for throughput**

Itemize 30 serial baseline + 30 bounded candidate completions = 60 real calls. Confirm the account can safely test effective concurrency at least 4; if not, report throughput as not measurable rather than failing or increasing unboundedly.

- [ ] **Step 7: Run throughput only after Round C approval**

```powershell
$env:GRADING_BENCHMARK_AUTHORIZATION='approved'
npm.cmd run eval:grading-throughput
Remove-Item Env:GRADING_BENCHMARK_AUTHORIZATION
```

Expected: when measured effective concurrency is at least 4, 30-essay candidate wall time improves by at least 60% and retries/429s remain bounded. Report serial-baseline and candidate first-success latency on the same frozen 30-essay recipe; candidate first-success latency must be no greater than baseline. If it is greater, throughput may be reported, but the latency objective is not met unless the user separately approves an explicit tolerance.

- [ ] **Step 8: Keep image experiments separately gated**

Do not run `eval:image-variants` under any of the above approvals. A later request must enumerate variants × sample count and cost. No variant may enter the product until all CER, scoring, important-legibility, structure and latency gates pass under an independently reviewed feature flag.

- [ ] **Step 9: Commit only an anonymous aggregate report if all privacy checks pass**

The preferred default is to keep private reports ignored and update `docs/current_development_status.md` with aggregate counts/rates only. Never commit the manifest, filenames, text, images, raw responses or Key.

```powershell
Set-Location D:\wenjie-writewise-ai
git diff --check
git add docs/current_development_status.md AGENTS.md
git commit -m "docs: record authorized AI optimization evidence"
```

Expected: documentation distinguishes measured results, failed/not-run rounds and remaining production limits. If no tracked documentation changed, skip the commit rather than creating an empty commit.

---

## Final Acceptance Matrix

| Requirement | Automated/fake evidence | Real authorized evidence |
| --- | --- | --- |
| Rubric normal path is one completion/material copy | Provider + server tests | Round A rubric smoke if separately authorized |
| Each normal essay version maps to one unique completion | Registry/server concurrency tests | A/B unique completion ledger |
| Canonical context and Provider output are smaller | Prompt/schema snapshots | Median token reduction `>=25%` |
| Public v2 result remains complete | Gateway-to-app contract tests | Blind-review sample results |
| No OCR, Batch, multi-student request or image transform | source scans + multipart tests | request ledger/provenance |
| Usage and timing are safe/unique | transport/telemetry/registry tests | anonymous aggregate report |
| Hard concurrency cannot be exceeded | admission/scheduler tests | Round C measured active calls |
| Timeout/duplicate requests do not double call | registry late-settlement tests | controlled reattachment case |
| Queue pauses and isolates failures | scheduler/AppState/UI tests | controlled 429/auth only if authorized |
| CER, score, important issue and evidence quality | metric/gate unit tests | Round A teacher-reviewed A/B |
| Structured stability `>=99%` | fake strict-contract suite | Round B 100-call soak |
| 30-essay wall time improves `>=60%` at effective concurrency `>=4` | deterministic scheduler timing tests | Round C throughput run |
| Image optimization remains disabled | image experiment guard tests | separate future authorization only |

## Execution Handoff

After this plan is reviewed, choose one execution mode:

1. **Subagent-Driven Development (recommended):** execute one task at a time in this session with fresh implementing/reviewing subagents, TDD checkpoints, and a commit after every task.
2. **Inline Execution:** execute the same tasks sequentially in the main thread with the stated RED/GREEN/verification checkpoints.

Neither mode authorizes Task 16 real calls. Implementation must stop after fake/browser verification and obtain the separate round authorization described above.
