# AI Class Review Integration and Commercial Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已验证的班级总览本地原型接到已批准并完成的权威 Platform API，迁移网站的任务/作文/结果主状态，验证刷新、多设备、权限、删除、并发与回滚；最后在用户另行确认样本、调用数和费用后完成真实 `kimi-k3` framing 校准与班级总结 smoke，并据证据进行商业发布评审。

**Architecture:** 网站生产模式只通过注入式 `PlatformClient` 调用 Platform API，`AppStateContext` 降为服务端状态缓存和 UI orchestration，不再是权威仓库。Platform API 持久化任务、作文页、结果 revisions 和班级 generation，worker 通过服务认证调用 Gateway；Gateway 使用共享持久 admission 并保持逐篇 v2 与班级 synthesis 合同独立。开发环境可显式保留 local prototype，生产构建遇到 fake/memory/未校准配置一律 fail closed。

**Tech Stack:** React 19、TypeScript 6、React Router 7、Vite 8、Vitest 4、Testing Library、Express 4、PostgreSQL 17、S3-compatible storage、Kimi `kimi-k3`、现有 Grading Gateway；部署平台与托管厂商按已批准基础设施 ADR 执行。

**Spec:** [AI 班级总览生成与共性问题沉淀设计](../specs/2026-08-29-ai-class-review-generation-design.md)

## Global Constraints

- Task 1 前必须验证两份前置计划的完成门；本地原型通过不能代替持久化基础设施，基础设施通过也不能代替真实页面/Provider 验收。
- 每个实施回合完整阅读 `AGENTS.md` 与 `docs/current_development_status.md`。逐篇主流程继续由一次 `kimi-k3` 多模态 completion 完成识别、评分和反馈；不接入 OCR，不改变 `multimodal-grading-request-v2`、`grading-result-v2` 或 `POST /grading/grade-images` 的 payload semantics。
- 生产浏览器不得直接访问 Grading Gateway。网站只访问 Platform API；Platform worker 以服务 token 调用 Gateway。
- 生产环境必须显式使用 `VITE_APP_DATA_MODE=platform-v1`、持久 repository、PostgreSQL shared admission 和授权后的 class-review framing calibration；任何缺失都阻止启动/发布，不静默回退 local fake。
- 平台 API 的 class-review 命令只接受 expected revisions 和用户动作；统计、证据、Prompt、teacher/tenant ID 始终由服务端推导。
- 页面必须恢复 `currentGeneration`，不能依赖浏览器记住 generation ID。轮询有界退避，终态停止；`result_unknown` 只检查原 run，不重发。
- 逐篇/班级费用操作必须使用稳定幂等身份。网络未知时宁可保持 unknown，也不能为了“恢复”产生第二次 Provider completion。
- 发布迁移是同一兼容窗口：数据库 migration 向后兼容，Platform API 和 Gateway 先部署兼容版本，网站最后切换。回滚不得复活删除内容或自动重发 unknown generation。
- 真实 Kimi 阶段是独立人工授权闸门。没有明确的样本范围、generation 数、最大 completion 数和费用上限时立即停止，不读取 Key、不调用网络。
- 真实测试默认只使用合成或明确授权的匿名样本；未成年人真实数据还需要单独的数据治理授权。日志和提交物不含 Prompt、正文、图片、姓名、Key、Provider 原始响应或普通业务 ID。
- 本计划的唯一静态反向代理产物是提案路径 `deploy/Caddyfile`。Task 0 必须先确认已批准 ADR 逐字记录 `reverse_proxy = caddy-v1`；在该确认前，商业基础设施计划和本计划全部实施均阻断。若批准的是其他代理，先同步改写两份计划的 Files、命令、健康检查和回滚路径，再执行 Task 1；不得把当前静态 Caddy 路径视为已获批准。

**Prerequisite Plans:** [本地功能原型](2026-08-29-ai-class-review-local-prototype.md) and [商业基础设施](2026-08-29-ai-class-review-commercial-infrastructure.md)

## Shared Execution Guard

- 每个 Task 开始前从仓库根运行下列 guard；任何不属于当前 Task `Files` 清单的改动都先停止并确认，不覆盖或暂存用户文件。
- 每个命令块独立解析 `$repoRoot`，不依赖之前的 `Set-Location`。提交前对照 `git diff --name-only` / `git diff --cached --name-only`，仅以完整路径暂存，禁止目录、glob 和 `git add -A`。
- 真实调用 Task 8 是额外授权闸门，不因 guard 或前置计划通过而获得网络、Key、样本或费用授权。

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location $repoRoot
$unexpected = git status --short
if ($unexpected) { $unexpected; throw 'Dirty worktree: classify every existing change before this Task.' }
```

## File Structure

### Website platform client and state migration

- Modify `app/package.json` and `app/package-lock.json` to lock `@writewise/contracts` as `file:../packages/contracts`; no other package lock changes in this plan.
- Create `app/src/services/platform/types.ts`.
- Create `app/src/services/platform/platformRuntimeConfig.ts` and test.
- Create `app/src/services/platform/platformClient.ts`.
- Create `app/src/services/platform/remotePlatformClient.ts` and test.
- Create `app/src/services/platform/fakePlatformClient.ts` and test.
- Create `app/src/services/platform/classReviewApi.ts` and test.
- Create `app/src/context/PlatformStateProvider.tsx` and tests.
- Create `app/src/context/createAppDataProvider.tsx` and test.
- Create `app/src/pages/LoginPage.tsx` and test.
- Modify `app/src/App.tsx`, `app/src/main.tsx`, `app/src/context/appStateContextValue.ts` and `app/src/context/AppStateContext.tsx`.
- Modify `app/src/pages/TaskListPage.tsx`, `app/src/pages/CreateTaskPage.tsx`, `app/src/pages/UploadPage.tsx`, `app/src/pages/ProgressPage.tsx`, `app/src/pages/EssayResultPage.tsx`, `app/src/pages/ClassReviewPage.tsx` and their exact tests listed by Tasks 2–5.

### Platform main-flow integration

- Modify `packages/contracts/src/tasks.ts`, `packages/contracts/src/grading.ts` and `packages/contracts/src/contracts.test.ts`.
- Create `platform-api/src/modules/tasks/taskDraftRoutes.ts`, `taskAiOperationRoutes.ts`, `taskRoutes.ts`, `uploadRoutes.ts` and their integration tests under the same directory; create `platform-api/src/modules/grading/gradingRoutes.ts` and its integration test.
- Create `platform-api/src/repositories/gradingJobRepository.ts` and its integration test; reuse the prerequisite task/essay/result repositories.
- Create `platform-api/src/workers/essayGradingWorker.ts` and integration test.
- Create `platform-api/src/adapters/gradingGatewayMultipartClient.ts` and test.
- Create `platform-api/src/modules/sync/snapshotRoutes.ts` and test.
- Modify `platform-api/src/modules/deletion/deletionRoutes.ts` and `platform-api/src/modules/deletion/deletionRoutes.test.ts` created by the prerequisite commercial plan.

### Release evidence and operations

- Create `docs/runbooks/class-review-rollout.md`.
- Create `docs/runbooks/class-review-result-unknown.md`.
- Create `app/Dockerfile`, `platform-api/Dockerfile` and `grading-gateway/Dockerfile`.
- Create `deploy/compose.production.yaml`, `deploy/Caddyfile`, `deploy/production.env.example`, `deploy/scripts/checkCompatibility.ps1` and its test. This static list is executable only after Task 0 verifies `reverse_proxy = caddy-v1`; an approved alternative requires a prior plan revision.
- Create `grading-gateway/scripts/classReviewFramingCalibration/` after authorization.
- Create `grading-gateway/scripts/classReviewSmoke/` after authorization.
- Create ignored local manifest/result paths and tracked schemas/examples without content.
- Modify `.gitignore`, service `.env.example` files, deployment manifests and `docs/current_development_status.md`.

---

## Task 0: Verify both prerequisite completion gates

**Files:**

- None (read-only gate; no file is created, modified, staged or committed).
- Read: `AGENTS.md`
- Read: `docs/current_development_status.md`
- Read: `docs/superpowers/specs/2026-08-29-ai-class-review-generation-design.md`
- Read: `docs/superpowers/specs/2026-08-29-platform-infrastructure-architecture.md`
- Read: `docs/superpowers/plans/2026-08-29-ai-class-review-local-prototype.md`
- Read: `docs/superpowers/plans/2026-08-29-ai-class-review-commercial-infrastructure.md`
- Read: `docs/superpowers/plans/2026-08-29-ai-class-review-integration-release.md`

**Interfaces:**

- Produces a written checkpoint in commentary: local prototype gate result, infrastructure gate result, branch/worktree, exact test evidence and unresolved blockers.

- [ ] **Step 1: Verify local prototype evidence**

Confirm real class page no longer reads `mockClassInsights`, fake call-count invariants pass, Gateway strict internal route passes, and UI explicitly labels local persistence limitations.

- [ ] **Step 2: Verify infrastructure evidence**

Confirm the approved ADR exists and explicitly records all seven infrastructure decisions, including the exact value `reverse_proxy = caddy-v1`; a different or missing proxy decision blocks this static plan until both infrastructure and integration plans are revised. Confirm PostgreSQL migrations/tests pass, tenant authorization is enforced, report/currentGeneration survive restart, the persistent payload-hash-bound Gateway execution/result registry survives two-instance restart/lost responses, distributed admission passes and deletion fencing/purge is implemented.

- [ ] **Step 3: Stop if either gate is incomplete**

Do not work around missing authority with localStorage, browser-to-Gateway calls, a single-process registry or fake production config. Resume the corresponding prerequisite plan first.

- [ ] **Step 4: Record the checkpoint**

No commit is required if all evidence already exists and the worktree remains clean.

---

## Task 1: Add strict Platform client configuration and authenticated app shell

**Files:**

- Create: `app/src/services/platform/types.ts`
- Create: `app/src/services/platform/platformRuntimeConfig.ts`
- Create: `app/src/services/platform/platformRuntimeConfig.test.ts`
- Create: `app/src/services/platform/platformClient.ts`
- Create: `app/src/services/platform/remotePlatformClient.ts`
- Create: `app/src/services/platform/remotePlatformClient.test.ts`
- Create: `app/src/services/platform/fakePlatformClient.ts`
- Create: `app/src/services/platform/fakePlatformClient.test.ts`
- Create: `app/src/context/createAppDataProvider.tsx`
- Create: `app/src/context/createAppDataProvider.test.tsx`
- Create: `app/src/context/PlatformStateProvider.tsx`
- Create: `app/src/context/PlatformStateProvider.test.tsx`
- Create: `app/src/pages/LoginPage.tsx`
- Create: `app/src/pages/LoginPage.test.tsx`
- Modify: `app/package.json`
- Modify: `app/package-lock.json`
- Modify: `app/src/App.tsx`
- Modify: `app/src/main.tsx`
- Modify: `app/.env.example`

**Interfaces:**

```ts
interface PlatformClient {
  getSession(): Promise<SessionSnapshot>
  login(input: LoginInput): Promise<SessionSnapshot>
  logout(): Promise<void>
  getAppSnapshot(): Promise<AppSnapshotV1>
  // Task, grading and class-review methods are added in later tasks.
}
```

- [ ] **Step 1: Lock the App to the portable contracts package**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd install --save-exact file:../packages/contracts
$manifest = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'app/package.json') | ConvertFrom-Json
if ($manifest.dependencies.'@writewise/contracts' -ne 'file:../packages/contracts') { throw 'App contracts dependency is not the approved locked file dependency.' }
```

Verify `app/package-lock.json` resolves exactly one local `@writewise/contracts` package from `../packages/contracts`. If the prerequisite package has another name or is not buildable/importable, stop and repair the prerequisite plan; do not add a second contract copy, TypeScript path alias or another lockfile.

- [ ] **Step 2: Write failing runtime configuration tests**

Production accepts only `VITE_APP_DATA_MODE=platform-v1` with an HTTPS/same-origin approved Platform API base. `local-prototype` is allowed only in development/test. Missing/unknown mode and production fake mode throw a content-free config error.

- [ ] **Step 3: Write failing session/client tests**

Use `credentials: 'include'`, obtain CSRF through `/me`, attach it only to mutations, reject non-JSON/wrong-version/unknown-key responses, map 401 to signed-out and never expose cookie/session token to JavaScript.

- [ ] **Step 4: Write failing route-guard tests**

Unauthenticated users see login; authenticated viewer/teacher reaches existing routes; logout clears cached task/report data. Return-to route is local path only and cannot be an open redirect.

- [ ] **Step 5: Run and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/services/platform src/context/createAppDataProvider.test.tsx src/context/PlatformStateProvider.test.tsx src/pages/LoginPage.test.tsx
```

- [ ] **Step 6: Implement injected app-data selection**

`createAppDataProvider()` chooses `PlatformStateProvider` only for platform mode and the existing local provider only for explicit local prototype. Platform DTOs and exact-key parsers are imported from `@writewise/contracts`; no copied browser contract is introduced. No runtime catch falls back from a Platform API error to memory data.

- [ ] **Step 7: Run tests/typecheck and commit**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/services/platform src/context/createAppDataProvider.test.tsx src/context/PlatformStateProvider.test.tsx src/pages/LoginPage.test.tsx
npm.cmd run typecheck
git -C $repoRoot add -- app/package.json app/package-lock.json app/src/services/platform/types.ts app/src/services/platform/platformRuntimeConfig.ts app/src/services/platform/platformRuntimeConfig.test.ts app/src/services/platform/platformClient.ts app/src/services/platform/remotePlatformClient.ts app/src/services/platform/remotePlatformClient.test.ts app/src/services/platform/fakePlatformClient.ts app/src/services/platform/fakePlatformClient.test.ts app/src/context/createAppDataProvider.tsx app/src/context/createAppDataProvider.test.tsx app/src/context/PlatformStateProvider.tsx app/src/context/PlatformStateProvider.test.tsx app/src/pages/LoginPage.tsx app/src/pages/LoginPage.test.tsx app/src/App.tsx app/src/main.tsx app/.env.example
git -C $repoRoot commit -m "feat: connect authenticated platform app shell"
```

---

## Task 2: Migrate task creation, optional AI assistance and essay uploads to Platform API

**Files:**

- Modify: `packages/contracts/src/tasks.ts`
- Modify: `packages/contracts/src/contracts.test.ts`
- Create: `platform-api/src/modules/tasks/taskDraftRoutes.ts`
- Create: `platform-api/src/modules/tasks/taskDraftRoutes.integration.test.ts`
- Create: `platform-api/src/modules/tasks/taskAiOperationRoutes.ts`
- Create: `platform-api/src/modules/tasks/taskAiOperationRoutes.integration.test.ts`
- Create: `platform-api/src/modules/tasks/taskRoutes.ts`
- Create: `platform-api/src/modules/tasks/taskRoutes.integration.test.ts`
- Create: `platform-api/src/modules/tasks/uploadRoutes.ts`
- Create: `platform-api/src/modules/tasks/uploadRoutes.integration.test.ts`
- Create: `platform-api/src/adapters/taskCreationGatewayClient.ts`
- Create: `platform-api/src/adapters/taskCreationGatewayClient.test.ts`
- Create: `platform-api/src/workers/taskCreationAiWorker.ts`
- Create: `platform-api/src/workers/taskCreationAiWorker.integration.test.ts`
- Modify: `platform-api/src/repositories/taskDraftRepository.ts`
- Read: `platform-api/src/adapters/gradingGatewayClient.ts`
- Modify: `platform-api/src/server.ts`
- Modify: `grading-gateway/src/server.ts`
- Modify: `grading-gateway/src/server.test.ts`
- Modify: `app/src/services/platform/platformClient.ts`
- Modify: `app/src/services/platform/remotePlatformClient.ts`
- Modify: `app/src/context/PlatformStateProvider.tsx`
- Create: `app/src/context/PlatformStateProvider.tasks.test.tsx`
- Modify: `app/src/pages/TaskListPage.tsx`
- Modify: `app/src/pages/TaskListPage.test.tsx`
- Modify: `app/src/pages/CreateTaskPage.tsx`
- Modify: `app/src/pages/CreateTaskPage.test.tsx`
- Modify: `app/src/pages/UploadPage.tsx`
- Modify: `app/src/pages/UploadPage.test.tsx`

**Interfaces:**

```ts
interface TaskAiOperationApi {
  readTaskAiOperation(draftId: string, operationId: string): Promise<TaskAiOperationStatusV1>
  checkTaskAiOperation(input: {
    draftId: string
    operationId: string
    expectedDraftRevision: number
    idempotencyKey: string
  }): Promise<TaskAiOperationStatusV1>
  abandonTaskAiOperation(input: {
    draftId: string
    operationId: string
    expectedDraftRevision: number
    idempotencyKey: string
  }): Promise<TaskAiOperationStatusV1>
}
```

- `POST /task-drafts`, `GET/PATCH /task-drafts/:draftId`.
- `POST /task-drafts/:draftId/material-upload-intents`, direct object-store upload, `POST /task-drafts/:draftId/material-submissions`.
- `POST /task-drafts/:draftId/ai-operations` accepts exactly `generate_rubric | analyze_material_context`; `GET /task-drafts/:draftId/ai-operations/:operationId` is a side-effect-free persisted-state read.
- `POST /task-drafts/:draftId/ai-operations/:operationId/check` performs only a durable lookup of that operation's original Gateway execution identity/hash; `POST /task-drafts/:draftId/ai-operations/:operationId/abandon` is allowed only for `result_unknown` when a teacher-authored rubric is currently valid and means “按写作要求继续”. Neither endpoint submits a Provider request.
- `POST /task-drafts/:draftId/finalize`, then `GET /tasks`, `GET /tasks/:taskId`.
- `POST /tasks/:taskId/essay-upload-intents`, direct object-store upload, `POST /tasks/:taskId/essay-submissions`.
- Every mutation carries `Idempotency-Key`, CSRF and expected draft/task revision; identities, file objects and Provider payloads are server-derived.

- [ ] **Step 1: Write failing teacher-only and AI-assisted creation tests**

Cover teacher-only valid rubric with no materials (zero completion), teacher-only rubric with materials (one `material_context` completion), and AI rubric with or without materials (exactly one normal `rubric_generation` completion). In the AI path, ordered materials are streamed to `/tasks/rubric` once; its returned material summary/context is stored with the draft and finalization must not call `/tasks/material-context`. Teacher writing requirements override inferred material text. Material parsing failure remains non-blocking for a valid teacher rubric and finalizes with the approved “仅按已填写的写作要求评分” warning. At least one `task*Routes.integration.test.ts` case must instantiate the real Platform `createServer()`, call every Task 2 route through its production path and prove authenticated reachability plus unauthenticated/cross-tenant rejection; directly mounting a route factory is insufficient.

- [ ] **Step 2: Write failing persistent idempotency and result-unknown tests**

Persist an opaque AI operation identity, input/material revision digest, invalidation epoch and Gateway payload hash before dispatch. Double-click, HTTP replay, worker restart and a lost success response attach/query the commercial-plan Gateway execution registry and add zero completions. `check` may recover and persist a cached strict result but never submits; `abandon` invalidates the operation and purges its cached envelope without freeing a still-running Provider admission lease. A new Provider operation is allowed only after a proven terminal failure and a new explicit teacher action. Material/rubric operation results are exact-key validated and never supplied by the browser.

- [ ] **Step 3: Write failing task/material/upload isolation tests**

Cover optional task name and JPEG/PNG/WebP/PDF/DOCX material draft uploads, confirmed structured rubric, multi-page student image/PDF-converted pages, editable/default student names, page order, checksum/size/MIME verification, tenant isolation and idempotent finalize. Add/remove/reorder/replace/retry of a material and any teacher draft field that participates in the operation digest atomically increments the appropriate draft/material revision and invalidates queued/running/result-unknown operations built from the old digest. DOCX extraction stays server-side; original material bytes/context are not copied into essay pages or replayed in per-essay prompts.

Complete a stale operation after invalidation and after explicit abandonment. The worker's joint fence over operation state, invalidation epoch and draft/material digest must reject the late result, write no material context/rubric into the draft, invoke the shared `gradingGatewayClient` content purge exactly once and retain only safe usage. Poll/read/check must never resurrect it or produce another completion.

- [ ] **Step 4: Write failing website boundary and remount tests**

`CreateTaskPage` calls only `PlatformClient`; production browser network assertions show zero requests to `/tasks/rubric`, `/tasks/material-context` or any Gateway origin. AI failure preserves teacher input; material changes invalidate only the cached draft operation and never auto-call. Create a task, upload two students with multiple pages and remount the provider; IDs/revisions reload from the server, and React retains no `File`, object-store credential, service token or material bytes after finalization.

- [ ] **Step 5: Run and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'packages/contracts')
npm.cmd test -- src/contracts.test.ts
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd test -- src/modules/tasks src/adapters/taskCreationGatewayClient.test.ts src/workers/taskCreationAiWorker.integration.test.ts
Set-Location (Join-Path $repoRoot 'grading-gateway')
npm.cmd test -- src/server.test.ts
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/context/PlatformStateProvider.tasks.test.tsx src/pages/TaskListPage.test.tsx src/pages/CreateTaskPage.test.tsx src/pages/UploadPage.test.tsx
```

Expected: runners start and fail on the missing draft/operation/client behavior; fake counters remain zero until an explicitly tested operation reaches Gateway admission.

- [ ] **Step 6: Implement authoritative draft operations and optimistic UI cache**

PlatformStateProvider may display pending form/upload/AI state, but only server responses update authoritative draft IDs/revisions. Implement `read/check/abandon` with exact state and revision parsers in `packages/contracts/src/tasks.ts`; implement all invalidation transitions in `taskDraftRepository.ts` under the same draft-row lock used by material/draft mutation. Register `taskDraftRoutes`, `taskAiOperationRoutes`, `taskRoutes` and `uploadRoutes` exactly once in `platform-api/src/server.ts` behind the established session/tenant middleware; the full-server integration test written in Step 1 must turn GREEN only after all production endpoints are reachable with correct authorization. The worker reads tenant-scoped object keys, streams each stored material exactly once in manifest order, calls the service-authenticated existing Gateway route through the durable execution identity, and stores only validated context/rubric after the joint fence succeeds. `taskCreationGatewayClient` delegates lookup/ack/purge to the prerequisite `gradingGatewayClient` execution-cleanup contract and does not duplicate those HTTP schemas. Failed uploads remain retryable client selections; no phantom task/essay is created. Gateway material/rubric routes reject browser Origin, require Platform service auth in production and retain their approved response contracts.

- [ ] **Step 7: Run adjacent regressions and commit only exact files**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'packages/contracts')
npm.cmd test
npm.cmd run typecheck
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd test -- src/modules/tasks src/adapters/taskCreationGatewayClient.test.ts src/workers/taskCreationAiWorker.integration.test.ts
npm.cmd run typecheck
Set-Location (Join-Path $repoRoot 'grading-gateway')
npm.cmd test -- src/server.test.ts
npm.cmd run typecheck
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/pages/CreateTaskFlow.test.tsx src/pages/MultimodalUploadFlow.test.tsx src/pages/TaskListPage.test.tsx src/pages/CreateTaskPage.test.tsx src/pages/UploadPage.test.tsx src/context/PlatformStateProvider.tasks.test.tsx
npm.cmd run typecheck
```

```powershell
$repoRoot = git rev-parse --show-toplevel
git -C $repoRoot add -- packages/contracts/src/tasks.ts packages/contracts/src/contracts.test.ts platform-api/src/modules/tasks/taskDraftRoutes.ts platform-api/src/modules/tasks/taskDraftRoutes.integration.test.ts platform-api/src/modules/tasks/taskAiOperationRoutes.ts platform-api/src/modules/tasks/taskAiOperationRoutes.integration.test.ts platform-api/src/modules/tasks/taskRoutes.ts platform-api/src/modules/tasks/taskRoutes.integration.test.ts platform-api/src/modules/tasks/uploadRoutes.ts platform-api/src/modules/tasks/uploadRoutes.integration.test.ts platform-api/src/adapters/taskCreationGatewayClient.ts platform-api/src/adapters/taskCreationGatewayClient.test.ts platform-api/src/workers/taskCreationAiWorker.ts platform-api/src/workers/taskCreationAiWorker.integration.test.ts platform-api/src/repositories/taskDraftRepository.ts platform-api/src/server.ts grading-gateway/src/server.ts grading-gateway/src/server.test.ts app/src/services/platform/platformClient.ts app/src/services/platform/remotePlatformClient.ts app/src/context/PlatformStateProvider.tsx app/src/context/PlatformStateProvider.tasks.test.tsx app/src/pages/TaskListPage.tsx app/src/pages/TaskListPage.test.tsx app/src/pages/CreateTaskPage.tsx app/src/pages/CreateTaskPage.test.tsx app/src/pages/UploadPage.tsx app/src/pages/UploadPage.test.tsx
git -C $repoRoot commit -m "feat: persist task creation and AI assistance"
```

---

## Task 3: Route the existing multimodal grading queue through durable Platform jobs

**Files:**

- Modify: `packages/contracts/src/grading.ts`
- Modify: `packages/contracts/src/contracts.test.ts`
- Create: `platform-api/src/repositories/gradingJobRepository.ts`
- Create: `platform-api/src/repositories/gradingJobRepository.integration.test.ts`
- Modify: `platform-api/src/repositories/essayRepository.ts`
- Modify: `platform-api/src/repositories/gradingResultRepository.ts`
- Create: `platform-api/src/modules/grading/gradingRoutes.ts`
- Create: `platform-api/src/modules/grading/gradingRoutes.integration.test.ts`
- Create: `platform-api/src/adapters/gradingGatewayMultipartClient.ts`
- Create: `platform-api/src/adapters/gradingGatewayMultipartClient.test.ts`
- Read: `platform-api/src/adapters/gradingGatewayClient.ts`
- Create: `platform-api/src/workers/essayGradingWorker.ts`
- Create: `platform-api/src/workers/essayGradingWorker.integration.test.ts`
- Modify: `platform-api/src/server.ts`
- Read: `grading-gateway/src/execution/providerExecutionStore.ts`
- Modify: `grading-gateway/src/server.ts`
- Modify: `grading-gateway/src/server.test.ts`
- Modify: `grading-gateway/src/gatewayRuntimeConfig.ts`
- Modify: `grading-gateway/src/gatewayRuntimeConfig.test.ts`
- Modify: `app/src/services/platform/platformClient.ts`
- Modify: `app/src/services/platform/remotePlatformClient.ts`
- Modify: `app/src/context/PlatformStateProvider.tsx`
- Create: `app/src/context/PlatformStateProvider.grading.test.tsx`
- Modify: `app/src/pages/ProgressPage.tsx`
- Modify: `app/src/pages/ProgressPage.test.tsx`
- Modify: `app/src/pages/EssayResultPage.tsx`
- Modify: `app/src/pages/EssayResultPage.test.tsx`

**Interfaces:**

```ts
type EssayProviderExecutionStage = 'essay_grading_images' | 'essay_regrading_text'

interface GradingGatewayMultipartClient {
  submitOnce(input: DurableEssayExecution): Promise<EssayExecutionSubmitResult>
  inspectOriginalExecution(input: DurableEssayExecutionIdentity): Promise<EssayExecutionLookupResult>
  acknowledgePersistedResult(input: DurableEssayExecutionIdentity): Promise<void>
}

interface EssayGradingCommands {
  startInitialGrading(input: {
    taskId: string
    expectedTaskRevision: number
    idempotencyKey: string
  }): Promise<TaskGradingStatusV1>
  startConfirmedTextRegrade(input: {
    taskId: string
    essayId: string
    confirmedTranscriptRevision: number
    expectedResultRevision: number
    idempotencyKey: string
  }): Promise<EssayGradingJobStatusV1>
  checkOriginalGradingExecution(input: {
    taskId: string
    essayId: string
    jobId: string
    expectedJobRevision: number
    idempotencyKey: string
  }): Promise<EssayGradingJobStatusV1>
}
```

- `POST /tasks/:taskId/grading-runs` creates or attaches all current initial-image jobs; `GET /tasks/:taskId/grading-status` reads persisted state only.
- `POST /tasks/:taskId/essays/:essayId/regrades` creates or attaches one explicitly authorized confirmed-text revision; `POST /tasks/:taskId/essays/:essayId/grading-jobs/:jobId/check` only looks up the original execution and never submits.
- `PATCH /tasks/:taskId/essays/:essayId/result` creates an immutable teacher-edited result revision with exact expected revision; `POST /tasks/:taskId/essays/:essayId/confirm` confirms a current revision without regrading.
- Initial images and confirmed-text regrades both retain `multimodal-grading-request-v2`, `grading-result-v2` and `POST /grading/grade-images`; the former supplies all ordered current pages and no confirmed transcript, while the latter supplies `pages=[]`, `pageIds=[]` and the exact confirmed transcript.

- [ ] **Step 1: Write failing stage-specific durable queue and identity tests**

One teacher action enqueues all actionable initial essay versions. Two workers never claim the same job. Under a task/essay row lock, create or attach one logical job for `(essay source revision, rubric revision, policy/schema/profile versions, essay_grading_images)` and persist its random opaque Gateway identity plus canonical multipart payload hash before dispatch. An explicit confirmed-text command similarly creates or attaches one job for `(confirmed transcript revision, rubric revision, policy/schema/profile versions, essay_regrading_text)`. Caller request IDs, retries and worker IDs are not part of either logical identity; a new source/transcript or rubric revision creates a new identity.

Use `N=3` current initial-image versions and `R=2` explicitly authorized confirmed-text revisions. Fake stage counters must finish at exactly `essay_grading_images=N`, `essay_regrading_text=R`, total `N+R`; double-clicks, HTTP replay, polling, checks, worker restart, 429-before-completion reattachment and acknowledgement add zero. One final failure does not block other essays. `gradingRoutes.integration.test.ts` must instantiate the real Platform `createServer()`, exercise each Task 3 endpoint through its registered production path and prove authenticated reachability plus unauthenticated/cross-tenant rejection; a directly mounted router cannot satisfy RED or GREEN.

- [ ] **Step 2: Write failing Gateway service-boundary tests**

In `GRADING_CLIENT_MODE=platform-v1`, `/grading/grade-images` requires the platform service token and rejects browser Origin while preserving its v2 multipart/result contract. Explicit local prototype mode retains current test harness access; production cannot enable it.

Lose one successful HTTP response from `essay_grading_images` and one from `essay_regrading_text`, restart the worker and first Gateway, and route lookup through the second Gateway. The production multipart adapter delegates lookup/ack to the prerequisite `gradingGatewayClient` execution contract; each cached strict v2 result is recovered and acknowledged with zero new completions. It never treats a GET/status/inspect failure as authority to POST again. Payload-hash mismatch, purged content or unresolved unknown are safe terminal/action-required states, not silent retries.

- [ ] **Step 3: Write failing result revision/edit tests**

Teacher score/comment/transcript edits use expected revision, create immutable history, increment current revision and never confirm implicitly. A strict Provider success is inserted as a new immutable result revision in the same Platform transaction that settles the job; only after that commit may the worker acknowledge the Gateway envelope. A failed acknowledgement enters the existing cleanup outbox and never repeats Provider work. Confirmed transcript regrade still uses `pages=[]` through the same route and is not OCR.

- [ ] **Step 4: Run and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'packages/contracts')
npm.cmd test -- src/contracts.test.ts
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd test -- src/modules/grading src/repositories/gradingJobRepository.integration.test.ts src/workers/essayGradingWorker.integration.test.ts src/adapters/gradingGatewayMultipartClient.test.ts
Set-Location (Join-Path $repoRoot 'grading-gateway')
npm.cmd test -- src/server.test.ts src/gatewayRuntimeConfig.test.ts
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

- [ ] **Step 5: Implement the complete server, Gateway boundary and result-revision path**

Implement the strict grading DTOs/parsers in `packages/contracts/src/grading.ts`. Implement tenant/role/revision/idempotency validation in `gradingRoutes.ts` and register it exactly once in `platform-api/src/server.ts` behind the established session/tenant middleware; logical-version uniqueness, claim fencing and durable opaque identity/hash persistence in `gradingJobRepository.ts`; ordered object-page reads in `essayRepository.ts`; and immutable result insert/current-pointer CAS in `gradingResultRepository.ts`. The full-server integration test written in Step 1 must turn GREEN only after the production endpoints are actually registered.

`gradingGatewayMultipartClient.ts` owns only construction/streaming of the existing v2 multipart submit. It selects exactly `essay_grading_images` or `essay_regrading_text`, then delegates execution lookup, acknowledgement and purge to the prerequisite `gradingGatewayClient.ts`; it does not duplicate the internal execution protocol. `essayGradingWorker.ts` claims one fenced job, submits at most once, converts timeout/connection loss to `result_unknown`, checks only the original identity/hash, validates the strict v2 result, commits the job and result revision atomically, and acknowledges only after commit. The Gateway route derives the same two exact stages from image versus confirmed-text mode, enforces service auth/no browser CORS in production and passes the stage/identity/hash to the persistent registry. No code path turns an unknown lookup failure into another submit.

- [ ] **Step 6: Run focused server/Gateway/result GREEN**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'packages/contracts')
npm.cmd test -- src/contracts.test.ts
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd test -- src/modules/grading src/repositories/gradingJobRepository.integration.test.ts src/workers/essayGradingWorker.integration.test.ts src/adapters/gradingGatewayMultipartClient.test.ts
Set-Location (Join-Path $repoRoot 'grading-gateway')
npm.cmd test -- src/server.test.ts src/gatewayRuntimeConfig.test.ts
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/pages/EssayResultPage.test.tsx
```

Expected: PASS with exact fake counters `N + R`, both lost-success lookups recovering through the second Gateway, and acknowledgement occurring only after the Platform result transaction commits.

- [ ] **Step 7: Write failing polling and remount tests**

Mount a fresh `PlatformStateProvider` with queued/running/result-unknown/succeeded/failed jobs and no browser execution identity. Assert it reads server status before scheduling a poll, uses capped exponential delay only while actionable, pauses while hidden, resumes with an immediate read when visible, stops at terminal state and never invokes initial/regrade/check mutations from the timer. Remount and prove all progress/result revisions come from Platform state.

- [ ] **Step 8: Run polling tests and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/context/PlatformStateProvider.grading.test.tsx src/pages/ProgressPage.test.tsx
```

Expected: FAIL on the missing bounded server-status poller, not on the already-green Platform/Gateway job path.

- [ ] **Step 9: Implement bounded status polling**

The website polls while jobs are actionable with capped exponential delay and pauses when the tab is hidden; a fresh page reads server state first. Polling never submits a grading or generation command.

- [ ] **Step 10: Run full grading regression and commit**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'packages/contracts')
npm.cmd test
npm.cmd run typecheck
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd test -- src/modules/grading src/repositories/gradingJobRepository.integration.test.ts src/workers/essayGradingWorker.integration.test.ts src/adapters/gradingGatewayMultipartClient.test.ts
npm.cmd run typecheck
Set-Location (Join-Path $repoRoot 'grading-gateway')
npm.cmd test
npm.cmd run typecheck
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/services/grading src/context/PlatformStateProvider.grading.test.tsx src/context/gradingStateTransitions.test.ts src/context/gradingQueueTransitions.test.ts src/pages/ProgressPage.test.tsx src/pages/EssayResultPage.test.tsx
npm.cmd run typecheck
git -C $repoRoot add -- packages/contracts/src/grading.ts packages/contracts/src/contracts.test.ts platform-api/src/repositories/gradingJobRepository.ts platform-api/src/repositories/gradingJobRepository.integration.test.ts platform-api/src/repositories/essayRepository.ts platform-api/src/repositories/gradingResultRepository.ts platform-api/src/modules/grading/gradingRoutes.ts platform-api/src/modules/grading/gradingRoutes.integration.test.ts platform-api/src/adapters/gradingGatewayMultipartClient.ts platform-api/src/adapters/gradingGatewayMultipartClient.test.ts platform-api/src/workers/essayGradingWorker.ts platform-api/src/workers/essayGradingWorker.integration.test.ts platform-api/src/server.ts grading-gateway/src/server.ts grading-gateway/src/server.test.ts grading-gateway/src/gatewayRuntimeConfig.ts grading-gateway/src/gatewayRuntimeConfig.test.ts app/src/services/platform/platformClient.ts app/src/services/platform/remotePlatformClient.ts app/src/context/PlatformStateProvider.tsx app/src/context/PlatformStateProvider.grading.test.tsx app/src/pages/ProgressPage.tsx app/src/pages/ProgressPage.test.tsx app/src/pages/EssayResultPage.tsx app/src/pages/EssayResultPage.test.tsx
git -C $repoRoot commit -m "feat: persist multimodal grading workflow"
```

---

## Task 4: Replace local class-review state with authoritative API commands

**Files:**

- Create: `app/src/services/platform/classReviewApi.ts`
- Create: `app/src/services/platform/classReviewApi.test.ts`
- Modify: `app/src/services/platform/platformClient.ts`
- Modify: `app/src/services/platform/remotePlatformClient.ts`
- Modify: `app/src/context/PlatformStateProvider.tsx`
- Create: `app/src/context/PlatformStateProvider.classReview.test.tsx`
- Modify: `app/src/pages/ClassReviewPage.tsx`
- Modify: `app/src/pages/ClassReviewPage.test.tsx`
- Modify: `app/src/pages/EssayResultPage.tsx`
- Modify: `app/src/pages/EssayResultPage.test.tsx`
- Modify: `app/src/components/ClassReviewReportPanel.tsx`
- Modify: `app/src/components/ClassReviewReportPanel.test.tsx`
- Modify: `app/src/components/ClassReviewGenerationStatus.tsx`
- Modify: `app/src/components/ClassReviewGenerationStatus.test.tsx`
- Modify: `app/src/components/ClassReviewIssueList.tsx`
- Modify: `app/src/components/ClassReviewIssueList.test.tsx`

**Interfaces:**

`PlatformClient` adds exact methods for report read, read generation, patch report edits and one `sendClassReviewGenerationCommand` covering `initial | regenerate | apply_candidate | discard_candidate` at `POST /tasks/:taskId/class-review-generations`. Apply/discard never use report PATCH and never create a new run. The browser never sees internal projection or Gateway request types.

- [ ] **Step 1: Write failing fresh-load recovery tests**

Mount the page and each report/status/issue component with no local generation ID and server states queued, running, result_unknown and succeeded_unapplied. Assert every component renders only DTO fields from `class-review-report-v1`, follows `currentGeneration`, exposes exactly one primary action and resumes polling/check/apply paths correctly. Component callbacks receive command intent plus expected revisions only; they never receive an internal synthesis payload or Gateway URL.

- [ ] **Step 2: Write failing CAS/conflict tests**

Two provider instances edit/sort/generate concurrently. Stale report/generation/AI-text revisions return 409, preserve local drafts, refresh safe server state and never auto-resubmit. Applying an AI-text-conflict candidate requires explicit overwrite confirmation and a still-current `expectedAiTextEditRevision`.

- [ ] **Step 3: Write failing fee-action tests**

Initial, regenerate and explicit post-terminal-failure retry are the only intents allowed to authorize a Provider completion. Apply/discard still use the generation-command POST with the existing generation ID/revisions, but fake Gateway count remains zero; page reads, polling, spelling refresh and report edit/add/remove/sort never call that POST. Any apply/discard-shaped key in report PATCH is rejected by the exact parser.

- [ ] **Step 4: Run and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/services/platform/classReviewApi.test.ts src/context/PlatformStateProvider.classReview.test.tsx src/components/ClassReviewReportPanel.test.tsx src/components/ClassReviewGenerationStatus.test.tsx src/components/ClassReviewIssueList.test.tsx src/pages/ClassReviewPage.test.tsx src/pages/EssayResultPage.test.tsx
```

Expected: FAIL on the missing authoritative client/component wiring and safe conflict behavior; the local prototype coordinator tests remain green and are not used as production authority.

- [ ] **Step 5: Implement server-driven state without dual truth**

Remove class report/generation mutation authority from production AppState. Local prototype coordinator remains behind explicit dev mode only. Wire `ClassReviewReportPanel`, `ClassReviewGenerationStatus`, `ClassReviewIssueList`, `ClassReviewPage` and the add-from-essay action to the typed Platform callbacks; keep unsaved textarea state local and make every saved change use server revisions. Components must not infer a second current generation, submit on polling/render or convert apply/discard into report PATCH.

- [ ] **Step 6: Run focused GREEN, then typecheck and commit**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/services/platform/classReviewApi.test.ts src/context/PlatformStateProvider.classReview.test.tsx src/components/ClassReviewReportPanel.test.tsx src/components/ClassReviewGenerationStatus.test.tsx src/components/ClassReviewIssueList.test.tsx src/pages/ClassReviewPage.test.tsx src/pages/EssayResultPage.test.tsx
npm.cmd run typecheck
git -C $repoRoot add -- app/src/services/platform/classReviewApi.ts app/src/services/platform/classReviewApi.test.ts app/src/services/platform/platformClient.ts app/src/services/platform/remotePlatformClient.ts app/src/context/PlatformStateProvider.tsx app/src/context/PlatformStateProvider.classReview.test.tsx app/src/pages/ClassReviewPage.tsx app/src/pages/ClassReviewPage.test.tsx app/src/pages/EssayResultPage.tsx app/src/pages/EssayResultPage.test.tsx app/src/components/ClassReviewReportPanel.tsx app/src/components/ClassReviewReportPanel.test.tsx app/src/components/ClassReviewGenerationStatus.tsx app/src/components/ClassReviewGenerationStatus.test.tsx app/src/components/ClassReviewIssueList.tsx app/src/components/ClassReviewIssueList.test.tsx
git -C $repoRoot commit -m "feat: connect class review to authoritative service"
```

---

## Task 5: Integrate exact historical sources and privacy deletion

**Files:**

- Create: `platform-api/src/modules/gradingResults/resultRevisionRoutes.ts`
- Create: `platform-api/src/modules/gradingResults/resultRevisionRoutes.test.ts`
- Modify: `platform-api/src/modules/deletion/deletionRoutes.ts`
- Modify: `platform-api/src/modules/deletion/deletionRoutes.test.ts`
- Modify: `platform-api/src/server.ts`
- Modify: `app/src/services/platform/platformClient.ts`
- Modify: `app/src/services/platform/remotePlatformClient.ts`
- Modify: `app/src/pages/EssayResultPage.tsx`
- Modify: `app/src/pages/DetailNavigation.test.tsx`
- Modify: `app/src/pages/TaskListPage.tsx`
- Create: `app/src/pages/TaskDeletion.test.tsx`

**Interfaces:**

- `GET /tasks/:taskId/essays/:essayId/result-revisions/:revision` returns a scoped historical display projection or `source_revision_unavailable`.
- Task/essay deletion commands require owner/editor permission, expected revision, explicit confirmation and idempotency key.

- [ ] **Step 1: Write failing historical-source tests**

Open the exact evidence revision, locate the bound issue, return to the report with scroll/focus restored, and refuse to display current result as a substitute after retention/deletion removes the old revision.

- [ ] **Step 2: Write failing deletion-through-UI tests**

Task deletion is in a task management menu, not a class-report primary button. Confirm dialog states scope. On success, cached data is cleared and navigation returns to task list. Essay deletion removes corresponding evidence/AI content after server response, invalidates Platform runs and idempotently purges related Gateway cached execution envelopes; late Provider success does not reappear on polling. If Gateway purge is temporarily unavailable, a durable deletion-outbox row blocks release completion and retries purge only—it never repeats a Provider call or restores content.

- [ ] **Step 3: Run and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd test -- src/modules/gradingResults src/modules/deletion
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/pages/DetailNavigation.test.tsx src/pages/TaskDeletion.test.tsx
```

- [ ] **Step 4: Implement exact-revision display projection**

Return only fields needed for the source workspace and a signed, short-lived page URL when authorized. Do not expose object keys, other revisions or raw repository payloads. Register `resultRevisionRoutes` in `platform-api/src/server.ts` behind the existing authenticated tenant/task middleware; a direct route test must prove the GET is reachable only for an authorized teacher and remains unavailable for another tenant. Deletion obtains opaque Gateway execution identities only from server-owned relations and sends content-free service-authenticated purge commands through the existing adapter/outbox.

- [ ] **Step 5: Run tests and commit**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd test -- src/modules/gradingResults src/modules/deletion
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/pages/DetailNavigation.test.tsx src/pages/TaskDeletion.test.tsx
git -C $repoRoot add -- platform-api/src/modules/gradingResults/resultRevisionRoutes.ts platform-api/src/modules/gradingResults/resultRevisionRoutes.test.ts platform-api/src/modules/deletion/deletionRoutes.ts platform-api/src/modules/deletion/deletionRoutes.test.ts platform-api/src/server.ts app/src/services/platform/platformClient.ts app/src/services/platform/remotePlatformClient.ts app/src/pages/EssayResultPage.tsx app/src/pages/DetailNavigation.test.tsx app/src/pages/TaskListPage.tsx app/src/pages/TaskDeletion.test.tsx
git -C $repoRoot commit -m "feat: integrate exact sources and data deletion"
```

---

## Task 6: Run fake end-to-end, multi-device and accessibility acceptance

**Files:**

- Modify: `packages/contracts/src/tasks.ts`
- Modify: `packages/contracts/src/contracts.test.ts`
- Create: `platform-api/src/modules/sync/snapshotRoutes.ts`
- Create: `platform-api/src/modules/sync/snapshotRoutes.test.ts`
- Modify: `platform-api/src/server.ts`
- Modify: `app/src/services/platform/platformClient.ts`
- Modify: `app/src/services/platform/remotePlatformClient.ts`
- Modify: `app/src/services/platform/remotePlatformClient.test.ts`
- Modify: `app/src/context/PlatformStateProvider.tsx`
- Create: `app/src/context/PlatformStateProvider.snapshot.test.tsx`
- Create: `app/src/pages/PlatformEndToEnd.test.tsx`
- Create: `docs/runbooks/class-review-result-unknown.md`
- Modify: `docs/current_development_status.md`

**Interfaces:**

- `GET /app-snapshot` returns exact `app-snapshot-v1` from one tenant-scoped repeatable-read transaction; `PlatformClient.getAppSnapshot()` strictly parses it before replacing cached server state.
- One synthetic acceptance environment runs Platform API, task/essay/class workers, two Gateway instances, PostgreSQL, object storage and website with fake Provider.
- Snapshot contracts/routes/state replacement follow the explicit RED/GREEN Steps 1–4. `PlatformEndToEnd.test.tsx` in Steps 5–7 is a final conformance gate over Tasks 1–5 plus that now-green snapshot path, not a second implementation stream: it should pass on its first run, and any failure returns to the owning Task for RED/fix/GREEN rather than adding hidden behavior in the acceptance step.

- [ ] **Step 1: Write strict snapshot failing tests**

Define exact `app-snapshot-v1` contract fixtures and reject unknown keys, cross-tenant rows, mixed revision watermarks, internal object keys, signed URLs, Gateway execution identities/hashes, service credentials and full result/source payloads. The route returns only the authenticated session's task/essay summaries, current grading status/revision pointers, report summaries and each task's authoritative `currentGeneration`; historical/source content remains behind scoped detail routes. Simulate a concurrent task/result/report change and prove one response comes from one repeatable-read snapshot rather than a torn mixture. Assert an unauthenticated request is 401 and a viewer receives no mutation capability field.

- [ ] **Step 2: Run snapshot tests and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'packages/contracts')
npm.cmd test -- src/contracts.test.ts
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd test -- src/modules/sync/snapshotRoutes.test.ts
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/services/platform/remotePlatformClient.test.ts src/context/PlatformStateProvider.snapshot.test.tsx
```

Expected: FAIL on the missing strict snapshot parser, transactional route registration and authoritative cache replacement.

- [ ] **Step 3: Implement and register the strict snapshot path**

Add the exact DTO/parser to `packages/contracts/src/tasks.ts`. Implement `snapshotRoutes.ts` with authenticated tenant scope and one repeatable-read transaction, register it exactly once in `platform-api/src/server.ts`, and expose only bounded summaries plus revision pointers/currentGeneration. Implement `remotePlatformClient.getAppSnapshot()` with the shared parser. `PlatformStateProvider` replaces its server cache only after the whole response validates; a failed or stale response preserves the last safe cache and surfaces a content-free retry state. No snapshot read starts a grading, task-AI or class-generation command.

- [ ] **Step 4: Run focused snapshot GREEN**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'packages/contracts')
npm.cmd test -- src/contracts.test.ts
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd test -- src/modules/sync/snapshotRoutes.test.ts
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/services/platform/remotePlatformClient.test.ts src/context/PlatformStateProvider.snapshot.test.tsx
```

Expected: PASS, including the concurrent-write snapshot test and exact-key browser parser.

- [ ] **Step 5: Add a complete synthetic scenario**

Create one teacher-only task without material (zero creation completion) and one AI-assisted task with synthetic material (one rubric completion and material bytes sent once). Upload at least six students with multiple pages, start all initial grading, inject success/partial/final failure/429, edit and confirm selected results, explicitly run at least one confirmed-text regrade, generate class review, manually add/reorder one issue, edit AI summary, refresh in a second browser context, force an unapplied candidate, apply it and delete one source.

- [ ] **Step 6: Assert cross-device and completion invariants**

Both contexts first hydrate from `GET /app-snapshot` and converge after later reads; stale writes conflict safely. `A` authorized task-creation AI operations produce exactly `A` completions, `N` initial image essay versions produce exactly `N` `essay_grading_images` completions, `R` explicit confirmed-text revisions produce exactly `R` `essay_regrading_text` completions, and `G` authorized class generations produce exactly `G` synthesis completions, excluding confirmed pre-admission failures. Total fake fee-producing completions are `A + N + R + G`. Lose one successful HTTP response in material/rubric, initial-image, confirmed-text and class stages, restart the responsible worker and first Gateway, and route lookup through the second Gateway; cached strict results recover with zero duplicate calls. Polling, snapshot refresh, check, apply/discard, content purge and acknowledgement add zero.

- [ ] **Step 7: Run full automated suites**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'packages/contracts')
npm.cmd test
npm.cmd run typecheck
Set-Location (Join-Path $repoRoot 'packages/class-review-domain')
npm.cmd test
npm.cmd run typecheck
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd test
npm.cmd run typecheck
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

- [ ] **Step 8: Perform browser acceptance**

At `1440x900` and `390x844`, cover login, teacher-only and AI-assisted task creation, multi-page upload, initial grading, confirmed-text regrade, progress, result confirmation, class report, source round-trip, edit, sorting, undo, regenerate dialog, new-device snapshot recovery and deletion. Verify 44x44 touch targets, no horizontal overflow, no hover-only actions, focus restoration and zero console warnings/errors. Capture network/bundle evidence that the browser contacts only Platform API and makes zero direct `/tasks/rubric`, `/tasks/material-context`, `/grading/grade-images`, `/grading/class-review-syntheses` or provider-execution lookup/ack/purge requests; no service token exists in browser env/bundle.

- [ ] **Step 9: Verify logs and database restart**

Plant synthetic names/email/phone/injection strings, then assert they do not appear in Platform/Gateway logs or safe errors. Restart both API/Gateway instances, workers and browsers; reports, actionable generations, shared leases and strict cached Provider executions recover from PostgreSQL. A purged/deleted execution never returns content.

- [ ] **Step 10: Write the result-unknown runbook**

Document how operators inspect the original payload-hash-bound execution, distinguish confirmed failure from unknown, retrieve/acknowledge cached success, why no automatic resend is allowed, how shared leases remain occupied, the approved resolution/purge commands, audit evidence and teacher-facing message. Never instruct operators to use OCR or change model architecture.

- [ ] **Step 11: Request code review, fix findings and commit**

```powershell
$repoRoot = git rev-parse --show-toplevel
git -C $repoRoot add -- packages/contracts/src/tasks.ts packages/contracts/src/contracts.test.ts platform-api/src/modules/sync/snapshotRoutes.ts platform-api/src/modules/sync/snapshotRoutes.test.ts platform-api/src/server.ts app/src/services/platform/platformClient.ts app/src/services/platform/remotePlatformClient.ts app/src/services/platform/remotePlatformClient.test.ts app/src/context/PlatformStateProvider.tsx app/src/context/PlatformStateProvider.snapshot.test.tsx app/src/pages/PlatformEndToEnd.test.tsx docs/runbooks/class-review-result-unknown.md docs/current_development_status.md
git -C $repoRoot commit -m "test: verify authoritative class review integration"
```

---

## Task 7: Prepare atomic rollout, compatibility checks and rollback

**Files:**

- Create: `docs/runbooks/class-review-rollout.md`
- Create: `app/Dockerfile`
- Create: `platform-api/Dockerfile`
- Create: `grading-gateway/Dockerfile`
- Create: `deploy/compose.production.yaml`
- Create: `deploy/Caddyfile`
- Create: `deploy/production.env.example`
- Create: `deploy/scripts/checkCompatibility.ps1`
- Create: `deploy/scripts/checkCompatibility.test.ps1`
- Create: `platform-api/src/versionCompatibility.ts`
- Modify: `platform-api/.env.example`
- Modify: `platform-api/src/server.ts`
- Modify: `grading-gateway/.env.example`
- Create: `grading-gateway/src/classReviewSynthesis/versionCompatibility.ts`
- Modify: `grading-gateway/src/server.ts`
- Modify: `app/.env.example`
- Create: `app/src/services/platform/versionCompatibility.ts`
- Create: `platform-api/src/tests/versionCompatibility.test.ts`
- Create: `grading-gateway/src/classReviewSynthesis/versionCompatibility.test.ts`
- Create: `app/src/services/platform/versionCompatibility.test.ts`

**Interfaces:**

- Health/readiness exposes only compatible business/synthesis/result schemas, Platform/Gateway migration versions, durable execution-registry/admission versions, calibration identifiers and safe service state.
- Production feature flag can enable authoritative class review only when all required versions match.

- [ ] **Step 1: Write failing compatibility tests**

Reject mismatched browser business contract, Platform/Gateway synthesis contract, Platform or `provider_runtime` DB migration, execution-result cipher/schema, projection/schema/policy version and missing calibration. `checkCompatibility.test.ps1` supplies only synthetic compatible/mismatched health snapshots and asserts content-free exit codes; it never reads credentials. Do not start fee-producing workers during incompatibility.

- [ ] **Step 2: Run compatibility tests and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd test -- src/tests/versionCompatibility.test.ts
Set-Location (Join-Path $repoRoot 'grading-gateway')
npm.cmd test -- src/classReviewSynthesis/versionCompatibility.test.ts
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/services/platform/versionCompatibility.test.ts
powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'deploy/scripts/checkCompatibility.test.ps1')
```

Expected: FAIL on missing fail-closed compatibility projections/checker behavior; no deployment or Provider worker is started.

- [ ] **Step 3: Implement readiness compatibility and `checkCompatibility.ps1`**

Implement exact safe version projections in all three services and one `checkCompatibility.ps1` that accepts either the test's synthetic snapshot files or explicit App/Platform/Gateway base URLs. It requires every declared contract, migration, cipher, registry/admission, projection/policy/schema and calibration identifier to match the rollout manifest; network errors, missing/unknown keys and mismatches exit non-zero with safe codes only. A compatible set exits zero. The checker never enables a feature, starts a worker, reads a secret value or prints a response body.

- [ ] **Step 4: Run focused compatibility GREEN**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd test -- src/tests/versionCompatibility.test.ts
Set-Location (Join-Path $repoRoot 'grading-gateway')
npm.cmd test -- src/classReviewSynthesis/versionCompatibility.test.ts
Set-Location (Join-Path $repoRoot 'app')
npm.cmd test -- src/services/platform/versionCompatibility.test.ts
powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'deploy/scripts/checkCompatibility.test.ps1')
```

Expected: PASS for the compatible fixture and content-free non-zero results for every mismatch fixture.

- [ ] **Step 5: Define exact deployment order and the ADR-approved topology**

1. Take backup and verify restore in staging.
2. Apply forward-compatible database migrations.
3. Deploy Platform API/worker with feature disabled.
4. Deploy Gateway with internal route and shared admission, class Kimi mode still disabled.
5. Deploy website in platform mode with CTA gated by server readiness.
6. Run fake synthetic smoke.
7. After real-provider authorization/evidence, enable class synthesis for a controlled tenant cohort.

Build unprivileged, pinned-base container images for App, Platform API/worker and Gateway. `deploy/compose.production.yaml` defines separate API/worker roles, at least two Gateway replicas behind the ADR-approved private Caddy proxy, no public Gateway port, separate least-privilege Platform/Gateway database roles, read-only container filesystems where practical and secret values supplied only by the deployment environment—not the tracked example file. Because Task 0 has already verified `reverse_proxy = caddy-v1`, `deploy/Caddyfile` implements TLS termination, upload limits, a >6-minute upstream timeout, health checks and content-free access logs. If that exact ADR value is absent, no Task 7 file may be created: revise both plans to a new single static proxy artifact list first.

- [ ] **Step 6: Define rollback without destructive migration**

Rollback website/API/Gateway as one compatible set; keep forward migrations unless an independently reviewed inverse migration exists. Stop new generation claims, preserve queued/unknown/unapplied states, never auto-retry unknown and never restore deleted content. Local prototype is not a production rollback path.

- [ ] **Step 7: Run `checkCompatibility` and the fake rollout/rollback rehearsal**

Use staging/fake only. Run `deploy/scripts/checkCompatibility.ps1` against the live fake App/Platform/two-Gateway set before enabling workers and require exit zero; run one deliberate mismatch and require non-zero while fee-producing workers remain stopped. Exercise one rollback while a generation is queued and one while result unknown; verify no duplicate completion and correct state after redeploy.

- [ ] **Step 8: Commit Task 7 with the one static artifact list**

```powershell
$repoRoot = git rev-parse --show-toplevel
git -C $repoRoot add -- docs/runbooks/class-review-rollout.md app/Dockerfile platform-api/Dockerfile grading-gateway/Dockerfile deploy/compose.production.yaml deploy/Caddyfile deploy/production.env.example deploy/scripts/checkCompatibility.ps1 deploy/scripts/checkCompatibility.test.ps1 platform-api/src/versionCompatibility.ts platform-api/.env.example platform-api/src/server.ts grading-gateway/src/classReviewSynthesis/versionCompatibility.ts grading-gateway/.env.example grading-gateway/src/server.ts app/src/services/platform/versionCompatibility.ts app/.env.example platform-api/src/tests/versionCompatibility.test.ts grading-gateway/src/classReviewSynthesis/versionCompatibility.test.ts app/src/services/platform/versionCompatibility.test.ts
git -C $repoRoot commit -m "ops: prepare class review atomic rollout"
```

---

## Task 8: Obtain explicit authorization for real Kimi calibration and smoke

**Files:**

- None (authorization-only gate; no file is created, modified, staged or committed).
- Read: `AGENTS.md`
- Read: `docs/current_development_status.md`
- Read: `docs/superpowers/specs/2026-08-29-ai-class-review-generation-design.md`
- Read: `docs/superpowers/specs/2026-08-29-platform-infrastructure-architecture.md`
- Read: `docs/superpowers/plans/2026-08-29-ai-class-review-integration-release.md`

**Interfaces:**

- Produces a written approval record in the active task specifying sample class, source authorization, maximum generation/completion count, cost ceiling, endpoint/model and allowed telemetry.

- [ ] **Step 1: Present the proposed real-call manifest without reading it**

Describe each planned framing/smoke case, whether it is synthetic or anonymous, expected maximum one completion per generation, worst-case completion-token cap and stop conditions. Do not open ignored samples or `.env` yet.

- [ ] **Step 2: Ask for separate approval of scope, calls and fees**

Approval must explicitly authorize the real Kimi calls. A previously supplied API key or earlier essay-grading test is not authorization for this class-review run.

- [ ] **Step 3: Stop on any ambiguity**

If sample rights, minor-data status, call count or cost cap is unclear, do not proceed to Task 9. Fake evidence remains valid only for integration behavior.

---

## Task 9: Calibrate framing and run the authorized real Kimi smoke

**Files:**

- Create: `grading-gateway/scripts/classReviewFramingCalibration/types.ts`
- Create: `grading-gateway/scripts/classReviewFramingCalibration/manifest.ts`
- Create: `grading-gateway/scripts/classReviewFramingCalibration/runner.ts`
- Create: `grading-gateway/scripts/classReviewFramingCalibration/runner.test.ts`
- Create: `grading-gateway/scripts/classReviewFramingCalibration/cli.ts`
- Create: `grading-gateway/scripts/classReviewSmoke/types.ts`
- Create: `grading-gateway/scripts/classReviewSmoke/qualityGates.ts`
- Create: `grading-gateway/scripts/classReviewSmoke/qualityGates.test.ts`
- Create: `grading-gateway/scripts/classReviewSmoke/runner.ts`
- Create: `grading-gateway/scripts/classReviewSmoke/runner.test.ts`
- Create: `grading-gateway/scripts/classReviewSmoke/cli.ts`
- Modify: `grading-gateway/src/classReviewSynthesis/framingCalibrations.ts`
- Modify: `grading-gateway/package.json`
- Modify: `.gitignore`

**Interfaces:**

- Calibration output stores only case ID, model, controllable byte/token counts, Provider `prompt_tokens`, derived framing upper bound, finish reason, usage totals, latency and pass/fail.
- Smoke output stores only aggregate structure/coverage/usage/latency and human review verdict; no Prompt, excerpt, response prose, names or IDs.

- [ ] **Step 1: Write fake-transport runner, authorization and privacy tests**

Write tests for manifest schema, exact authorization token/call cap, dry-run output, no dotenv/sample read before authorization, stop on first invariant breach, aggregate-only output and no raw error serialization. Fake observations cover success and a failed-schema attempt with `prompt_tokens=16_385`; both trigger the same drift gate and prove the next real-mode request stops before admission/transport. Tests inject the transport, clock, sample reader and result writer; they must not read `.env`, `.local` or network.

- [ ] **Step 2: Run fake tests and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'grading-gateway')
npm.cmd test -- scripts/classReviewFramingCalibration/runner.test.ts scripts/classReviewSmoke/qualityGates.test.ts scripts/classReviewSmoke/runner.test.ts
```

Expected: FAIL on missing runner/manifest/quality-gate behavior. No Provider transport, dotenv loader, ignored manifest or sample reader is invoked.

- [ ] **Step 3: Implement the runners and register package scripts**

Implement the smallest code satisfying the fake tests. Add exact `class-review:framing` and `class-review:smoke` scripts to `grading-gateway/package.json`; no dependency changes are required, so `grading-gateway/package-lock.json` must remain unchanged and is not staged. Both CLIs validate the written authorization record and combined call cap before dotenv, manifest sample paths, Provider construction or output files. Output is aggregate-only and errors are mapped to fixed safe codes.

- [ ] **Step 4: Run fake GREEN and typecheck before any real CLI**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'grading-gateway')
npm.cmd test -- scripts/classReviewFramingCalibration/runner.test.ts scripts/classReviewSmoke/qualityGates.test.ts scripts/classReviewSmoke/runner.test.ts
npm.cmd run typecheck
```

Expected: PASS using only injected fake transports/readers. Stop if any test or typecheck fails; Task 8 authorization does not permit bypassing this gate.

- [ ] **Step 5: Run only the authorized framing cases**

Use the approved current `kimi-k3` endpoint/model only. Record exact `prompt_tokens`, `completion_tokens`, `total_tokens`, optional `cached_tokens`, finish reason and phase timings for every attempt, including invalid final responses. Confirm every observed `prompt_tokens <= 16,384` and derived framing overhead is at most 512 under `class-review-prompt-budget-v1`. Any breach writes the shared configuration pause, stops the manifest immediately and proves the next class request makes zero Provider calls; leave Kimi class mode disabled until a reviewed version change. Do not widen limits ad hoc.

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'grading-gateway')
npm.cmd run class-review:framing -- --manifest .local/class-review/approved-framing-manifest.json
```

- [ ] **Step 6: Register calibration only after evidence passes**

Add one immutable calibration entry bound to exact model identifier, policy/schema/budget versions, measurement date and aggregate maximum overhead. The entry contains no content and cannot be reused for a different model/version.

- [ ] **Step 7: Run only the authorized smoke generations**

Verify exact schema success, alias validity, group/support/occurrence-weighted semantic coverage, deterministic `mustCover` fallback, no model-generated stats/examples, one completion per generation, exact usage accounting and latency. A fake result or old essay smoke cannot substitute.

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'grading-gateway')
npm.cmd run class-review:smoke -- --manifest .local/class-review/approved-smoke-manifest.json
```

- [ ] **Step 8: Apply quality and privacy gates**

A designated teacher reviewer checks that summaries and advice are useful and grounded in the authorized synthetic/anonymous evidence. Any PII/prompt leakage, unsupported claim, invalid structure, truncation, token breach or duplicate completion fails the smoke and keeps the feature disabled.

The two ignored manifests must exactly match the written Task 8 authorization. The runners enforce one combined call cap across Steps 5 and 7; never rerun a failed real case without a new explicit authorization record.

- [ ] **Step 9: Commit code and aggregate evidence only**

```powershell
$repoRoot = git rev-parse --show-toplevel
git -C $repoRoot add -- .gitignore grading-gateway/scripts/classReviewFramingCalibration/types.ts grading-gateway/scripts/classReviewFramingCalibration/manifest.ts grading-gateway/scripts/classReviewFramingCalibration/runner.ts grading-gateway/scripts/classReviewFramingCalibration/runner.test.ts grading-gateway/scripts/classReviewFramingCalibration/cli.ts grading-gateway/scripts/classReviewSmoke/types.ts grading-gateway/scripts/classReviewSmoke/qualityGates.ts grading-gateway/scripts/classReviewSmoke/qualityGates.test.ts grading-gateway/scripts/classReviewSmoke/runner.ts grading-gateway/scripts/classReviewSmoke/runner.test.ts grading-gateway/scripts/classReviewSmoke/cli.ts grading-gateway/src/classReviewSynthesis/framingCalibrations.ts grading-gateway/package.json
git -C $repoRoot commit -m "test: calibrate Kimi class review synthesis"
```

Ignored manifests, prompts, responses and local result bundles must remain untracked.

---

## Task 10: Conduct the commercial release review

**Files:**

- Modify: `docs/current_development_status.md`
- Modify: `docs/runbooks/class-review-rollout.md`
- Create: `docs/releases/class-review-v1-release-evidence.md`

**Interfaces:**

- Produces a release decision `approved | blocked`, with exact evidence and named blockers; never equates passing tests with legal/data authorization.

- [ ] **Step 1: Re-run all quality gates on the release commit**

Run contracts, domain, Platform API, Gateway and App full tests/typechecks; App lint/build; shared scoring and policy verification; database migration/restart; fake multi-instance acceptance; desktop/mobile browser acceptance; secret/safety scans and `git diff --check`.

- [ ] **Step 2: Confirm non-code commercial gates**

Verify production database/object-store ownership, encryption and backups; approved retention periods; backup deletion SLA; minor-data authorization; incident response; operator access; service token rotation; monitoring/alerts; budget cap and rollback owner.

- [ ] **Step 3: Review real Kimi evidence**

Confirm the authorized call count did not exceed its cap, every generation had at most one completion, prompt-token invariant held, framing calibration matches the deployed model and quality/privacy reviewers signed off.

- [ ] **Step 4: Verify staged cohort rollout**

Enable one approved synthetic/internal tenant first, observe safe health/usage/latency and no unknown/duplicate behavior, then follow the approved cohort expansion. Do not use real student data before the data-governance gate.

- [ ] **Step 5: Request final code/security review**

Use `superpowers:requesting-code-review`; Critical or Important findings block release. Re-run affected gates after fixes.

- [ ] **Step 6: Record the truthful release decision**

If any gate is missing, write `blocked` with the exact owner/action and leave production feature disabled. If all pass, record deployed versions, migration/calibration IDs, test evidence, smoke call count/cost aggregate and rollback reference without content or secrets.

- [ ] **Step 7: Commit release evidence**

```powershell
$repoRoot = git rev-parse --show-toplevel
git -C $repoRoot add -- docs/current_development_status.md docs/runbooks/class-review-rollout.md docs/releases/class-review-v1-release-evidence.md
git -C $repoRoot commit -m "docs: record class review release decision"
```

## Spec-to-Test Traceability Gate

| Release invariant | Named evidence required before release |
|---|---|
| Browser authority | Tasks 1–4: production `PlatformClient` only; zero browser Gateway/material/rubric/class routes; no service secret in bundle |
| Task creation policy | Task 2: teacher/no-material 0 calls, teacher/material 1 context call, AI rubric exactly 1 call/material once; explicit check/abandon, digest invalidation and late-result purge are zero-call |
| Direct multimodal essay flow | Task 3: unchanged v2 route/contract; exact `essay_grading_images` and `essay_regrading_text` identities, ordered pages/confirmed text, no OCR, lost-response lookup/ack and exact `N + R` calls |
| Class report lifecycle | Task 4: server `currentGeneration`, all command intents, component-level authoritative callbacks, CAS/edit conflict, apply/discard zero Provider calls |
| History/privacy | Task 5: exact revision or unavailable; task/essay deletion plus Platform/Gateway content purge and late-result fence |
| Multi-instance/cost | Task 6: strict transactional snapshot, two devices/workers/Gateways, exact `A/N/R/G` counts, lost-response recovery in every stage, acknowledgement, restart and 50k bounded evidence inherited from infrastructure |
| Deployment compatibility | Tasks 0 and 7: ADR explicitly approves `reverse_proxy = caddy-v1`, one static Caddy artifact list, isolated DB roles, no public Gateway, executable compatibility RED/GREEN/check and atomic rollback rehearsal |
| Real-call authority | Tasks 8–9: separate sample/call/cost approval, tested manifest cap, prompt/framing invariant, one completion and teacher quality review |
| Final commercial decision | Task 10: code/security, retention/legal/backup/minor-data/operations and staged-cohort evidence all present |

## Commercial Release Gate

Release is approved only if all of the following are simultaneously true:

1. Production browser uses Platform API; no browser-to-Gateway or silent local-fake fallback exists.
2. Main task/upload/essay-grading/result/class-review flows survive refresh, process restart and a second device with correct revision conflicts.
3. Tenant roles, service auth, CSRF, object storage, exact historical sources and deletion pass security tests.
4. Persistent Platform generation/job state plus the payload-hash-bound Gateway execution/result registry and shared admission prove no duplicate fee-producing calls across workers/Gateway instances, including lost responses, restart, acknowledgement and deletion purge.
5. Real `kimi-k3` framing calibration and smoke were separately authorized and passed within call/cost/token limits.
6. Retention, backup deletion, minor-data authorization, incident response and operations owners are approved.
7. Atomic rollout and rollback rehearsal passed without retrying unknown calls or reviving deleted content.

If one item is missing, the correct status is “本地原型或预发布集成已验证，商业发布受阻”，不是“已上线”。
