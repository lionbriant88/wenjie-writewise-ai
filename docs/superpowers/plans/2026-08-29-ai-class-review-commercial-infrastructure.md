# AI Class Review Commercial Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立班级总览达到商业发布所需的教师认证、租户授权、权威任务/结果仓库、事务化 report 与 generation registry、删除级联、服务间认证和多实例 Provider 准入，使刷新、重启、并发标签页和多设备操作不再依赖 React 内存。

**Architecture:** 推荐新增 `platform-api` 作为唯一浏览器业务边界，使用 PostgreSQL 保存教师、租户、任务、结果历史、班级报告和 generation 状态，使用 S3-compatible object storage 保存作文页；一个数据库租约 worker 固定快照并调用 Grading Gateway。Gateway 继续只负责 Provider 边界，并把现有内存 admission 抽象成可选 PostgreSQL 共享 admission store。浏览器只发命令与 expected revisions，绝不提交统计、证据或 Prompt。

**Tech Stack:** Node.js 24、TypeScript 6、Express 4、PostgreSQL 17、官方 `pg`、S3-compatible object storage、AWS SDK v3、Node `crypto.scrypt`、Vitest、Supertest；不引入 ORM、GraphQL、事件总线、Redis、OCR 或模型路由器。

**Spec:** [AI 班级总览生成与共性问题沉淀设计](../specs/2026-08-29-ai-class-review-generation-design.md)

## Global Constraints

- 每个实施回合先完整阅读 `AGENTS.md` 与 `docs/current_development_status.md`。当前唯一作文主流程仍是直接 `kimi-k3` 多模态；不启动或接入 OCR Gateway。
- `platform-api` 是浏览器的唯一业务安全边界。Grading Gateway 不是教师/租户权限服务，内部 synthesis 路由不得暴露给浏览器 CORS。
- 浏览器请求体不允许 teacher/tenant ID、结果数组、统计、证据或 Provider Prompt。认证 principal、tenant 和 task scope 全部从受保护 session 与服务器关系推导。
- 业务合同严格使用 `class-review-generation-command-v1`、`class-review-generation-status-v1`、`class-review-report-v1`；平台到 Gateway 使用 `class-review-synthesis-request-v1` / `result-v1`；Kimi 使用 `kimi-class-review-output-v1`。三层命名和字段不得混用。
- 每个写命令带幂等键和 expected revision。任务级 partial unique index 必须先于 Provider 准入阻止第二个 active 或 unapplied generation；这是唯一 actionable generation 的数据库约束，`succeeded_unapplied` 只代表待处理 candidate，绝不占用 Provider admission lease。
- `ClassReviewReport.issueOrder` 是唯一显示顺序真源；issue block 不保存第二个 order。`aiTextEditRevision` 与普通 report revision 分离。
- 平台服务从权威 result revisions 重新计算 `N_success`、`N_issue`、门槛、人数、次数、例句与明确拼写；浏览器和模型声明均不可信。
- Provider 正常调用每 generation 最多一次。只有本地准入前失败或可证明零 completion 的 429 可在同 generation 有界重挂；结果未知不得重发或创建新 generation。
- 删除优先于普通快照保留：任务/作文/学生数据删除必须先 tombstone 内容并提高写入 fence，再清除派生内容、失效未应用 run；最终 purge 必须删除 Gateway execution key/payload hash，迟到结果只能独立结算随机 lease token 的安全 usage，不能复活内容。
- 数据库测试、对象存储测试和日志测试只使用合成数据。日志禁止姓名、正文、图片、Base64、材料、完整 Prompt、Provider 原始响应、Key、cookie、普通业务 ID或可回连 digest。
- 本计划不执行真实 Kimi；真实 framing 校准和 smoke 属于独立集成发布计划，并需另行费用授权。

## Shared Execution Guard

- 每个 Task 开始前从仓库根解析路径并运行下列 guard；存在不属于当前 Task `Files` 清单的改动时停止，不覆盖、不格式化、不暂存用户改动。
- 每个命令块必须独立设置 `$repoRoot` 和 package 路径。新 package 先创建 manifest/测试脚本并安装锁定的测试工具链，再执行有意义的 RED；不得把“命令不存在”当成 RED。
- 提交前以 `git diff --name-only` / `git diff --cached --name-only` 对照当前 Task 的完整文件清单，只暂存完整文件路径，禁止目录、glob 和 `git add -A`。

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location $repoRoot
$unexpected = git status --short
if ($unexpected) { $unexpected; throw 'Dirty worktree: classify every existing change before this Task.' }
```

## Architecture Review Gate

本规格批准了“必须有权威服务与持久化”的方向，但没有批准数据库托管、登录方式、租户组织和数据保留期限。执行本计划前必须单独向用户审查并获得以下七项基线的书面批准；当前对功能规格的“确认”不能替代该基础设施决策：

1. PostgreSQL 17 为权威数据库，生产使用托管实例；应用与 Gateway admission 使用分离数据库角色和 schema。
2. 首版网站认证为“管理员发放租户邀请码 + 教师邮箱/密码”，密码使用 Node `scrypt`，登录后使用服务端存储的 opaque HttpOnly session；未来学校 SSO/微信只通过 `IdentityVerifier` 扩展，不进入首版。
3. 租户为学校或独立教师空间；角色固定为 `owner | editor | viewer`。owner/editor 可创建与编辑，viewer 只读，只有 owner 可执行租户级成员与保留策略操作。
4. 作文页使用厂商中立的 S3-compatible adapter；测试使用本地 MinIO，生产厂商、区域、KMS 和备份策略另行批准。
5. 首版跨设备恢复使用读取 API + 有界轮询，不引入 WebSocket；实时协作不在范围内。
6. 工程删除默认使用规格中的 fail-closed 级联；内容保留期限、备份清除 SLA、未成年人授权和去关联 usage 保留期限仍是商业发布阻断项，不由工程默认值代替。
7. 首版部署拓扑为经反向代理暴露的网站与 Platform API、独立 worker、至少两个 Gateway 实例和托管 PostgreSQL/S3-compatible storage；提案使用 Caddy 与 Docker Compose，但 ADR 必须逐字批准“Caddy”或记录获批替代品。若选择其他反向代理、托管或编排平台，必须在执行 Task 1 前同步改写第三份计划中的确切部署文件路径、健康检查和回滚命令。

若任一项被用户修改，先更新本计划的 Architecture、File Structure、schema 和测试，再开始 Task 1。不得一边实现一边把未批准选择当成既定事实。

## File Structure

### Portable contracts and domain

- Create `packages/contracts/package.json`, `package-lock.json`, `tsconfig.json` and `src/`.
- Create `packages/contracts/src/auth.ts`, `tasks.ts`, `grading.ts`, `classReview.ts`, `errors.ts`, `index.ts` and tests.
- Create `packages/class-review-domain/package.json`, `package-lock.json`, `tsconfig.json` and `src/`.
- Create `packages/class-review-domain/src/aggregate.ts`, `spelling.ts`, `topicKey.ts`, `redaction.ts`, `projection.ts`, `merge.ts`, `index.ts` and tests.

### Platform API

- Create `platform-api/package.json`, `package-lock.json`, `tsconfig.json`, `.env.example`, `compose.yaml`.
- Create `platform-api/src/index.ts`, `server.ts`, `config.ts`, `logging.ts` and tests.
- Create `platform-api/src/http/authMiddleware.ts`, `csrfMiddleware.ts`, `idempotencyMiddleware.ts`, `serviceAuthMiddleware.ts`, `errorHandler.ts` and tests.
- Create `platform-api/src/db/pool.ts`, `transaction.ts`, `migrate.ts`, `testDatabase.ts`.
- Create migrations `001_identity_and_tasks.sql`, `002_class_review.sql`, `003_generation_jobs.sql`, `004_deletion_and_retention.sql`.
- Create repositories for tenants, teachers/sessions, tasks, task-draft AI operations, essays/pages, grading results, class review reports, generations, Provider-execution cleanup outbox, deletion and idempotency.
- Create modules `auth`, `tasks`, `gradingResults`, `classReview`, `deletion`, `operations`.
- Create adapters `objectStore.ts`, `s3ObjectStore.ts`, `fakeObjectStore.ts`, `gradingGatewayClient.ts`, `fakeGradingGatewayClient.ts`.
- Create workers `classReviewGenerationWorker.ts`, `providerExecutionCleanupWorker.ts`, `draftRetentionWorker.ts` and tests.

### Gateway durable execution and distributed admission

- Create `grading-gateway/src/admission/providerAdmissionStore.ts`.
- Create `grading-gateway/src/admission/memoryProviderAdmissionStore.ts`.
- Create `grading-gateway/src/admission/postgresProviderAdmissionStore.ts` and integration test.
- Create `grading-gateway/src/admission/providerCallFence.ts` and test.
- Create `grading-gateway/src/db/migrate.ts` and `grading-gateway/src/db/migrations/001_provider_runtime.sql`.
- Create `grading-gateway/src/execution/providerExecutionStages.ts`, `providerExecutionStore.ts`, memory/PostgreSQL implementations and tests for exactly `material_context | rubric_generation | essay_grading_images | essay_regrading_text | class_review_generation`.
- Create `grading-gateway/src/execution/providerExecutionRegistry.ts`, encrypted-result codec, de-identified usage aggregate stores and tests.
- Modify `grading-gateway/src/providerAdmissionController.ts` and test.
- Modify `grading-gateway/src/essayGradingRegistry.ts`, `oneShotProviderExecution.ts` and tests.
- Modify `grading-gateway/src/gatewayRuntimeConfig.ts` and test.
- Modify `grading-gateway/src/server.ts`, `index.ts`, `package.json`, `package-lock.json`, `.env.example`.

---

## Task 0: Approve and record the infrastructure architecture

**Files:**

- Create: `docs/superpowers/specs/2026-08-29-platform-infrastructure-architecture.md`
- Modify: `docs/current_development_status.md`

**Interfaces:**

- Produces an approved ADR covering the seven Architecture Review Gate decisions（第 7 项必须记录机器可核对的 `reverse_proxy = caddy-v1` 或 `reverse_proxy = approved-alternative:<versioned-id>`，不得留作默认值）and named production owners for retention/legal approval.
- Does not create runtime code or contact external services.

- [ ] **Step 1: Present the seven decisions with costs and alternatives**

The review must explicitly compare managed PostgreSQL vs other stores, built-in invite/password vs SSO, tenant role choices, S3-compatible storage, polling vs realtime sync, unresolved retention/legal policy, and Caddy vs the approved reverse-proxy alternative within the proposed container/deployment topology.

- [ ] **Step 2: Stop and obtain written user approval**

Do not infer approval from the class-review feature confirmation. Record the exact accepted choices and any modifications. Without an explicit reverse-proxy value, Task 0 remains incomplete and Task 1 must not start; choosing an alternative removes Caddy-specific files/commands from the integration plan rather than silently retaining them.

- [ ] **Step 3: Write the ADR and update status**

The ADR marks infrastructure design `approved`, implementation `not started`, and lists release-blocking policy decisions separately from engineering defaults.

- [ ] **Step 4: Review and commit**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location $repoRoot
git -C $repoRoot diff --check
git -C $repoRoot add -- docs/superpowers/specs/2026-08-29-platform-infrastructure-architecture.md docs/current_development_status.md
git -C $repoRoot commit -m "docs: approve platform infrastructure architecture"
```

---

## Task 1: Create portable contracts and the Platform API skeleton

**Files:**

- Create: `packages/contracts/package.json`
- Create: `packages/contracts/package-lock.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/auth.ts`
- Create: `packages/contracts/src/tasks.ts`
- Create: `packages/contracts/src/grading.ts`
- Create: `packages/contracts/src/classReview.ts`
- Create: `packages/contracts/src/errors.ts`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/contracts.test.ts`
- Create: `platform-api/package.json`
- Create: `platform-api/package-lock.json`
- Create: `platform-api/tsconfig.json`
- Create: `platform-api/.env.example`
- Create: `platform-api/src/index.ts`
- Create: `platform-api/src/server.ts`
- Create: `platform-api/src/config.ts`
- Create: `platform-api/src/logging.ts`
- Create: `platform-api/src/server.test.ts`

**Interfaces:**

```ts
createPlatformServer(options: PlatformServerOptions): Express
parsePlatformConfig(env: Record<string, string | undefined>): PlatformConfig
```

Contracts export JSON-safe DTOs and strict runtime parsers, including `task-draft-v1`, `task-ai-operation-command-v1` (`generate_rubric | analyze_material_context`), `task-ai-operation-resolution-command-v1` (`abandon_result_unknown` plus operation/draft/operation expected revisions), `task-ai-operation-status-v1`, task/upload/grading DTOs and all class-review contracts. Browser DTOs contain only actions, upload metadata and expected revisions; they never contain Gateway material/rubric payloads, service identity or Provider results. Source packages cannot import React, Express, Node filesystem or Provider types.

- [ ] **Step 1: Scaffold and lock both test toolchains**

Create both manifests, `test`/`typecheck` scripts, TypeScript configs and empty source entry points first. Name the portable package `@writewise/contracts`, set the Platform manifest dependency to exactly `"@writewise/contracts": "file:../packages/contracts"`, install from `platform-api`, and review that `platform-api/package-lock.json` pins that local file dependency. `platform-api` also installs exact semver-ranged Express, `pg`, AWS SDK S3/client signing and test/type dependencies, while `packages/contracts` installs only TypeScript/Vitest development dependencies. Do not introduce a repository-root workspace, path alias, copied parser, floating Git dependency or a second Platform-owned contract implementation.

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'packages/contracts')
npm.cmd install
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd install
```

- [ ] **Step 2: Write failing contract and health tests**

Assert task-draft/AI-operation/resolution/task/upload/grading contracts and every class-review union fixture parse exact keys; unknown/state-specific keys fail. The Platform test imports the parser from `@writewise/contracts` and proves it is the same exported implementation/fixtures rather than a copied parser. `GET /health` returns only service/schema/migration readiness—not credentials or database URLs.

- [ ] **Step 3: Run and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'packages/contracts')
npm.cmd test
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd test
```

Expected: the runner starts and tests fail because strict parsers, config and `/health` behavior are not implemented—not because a package, script or module is missing.

- [ ] **Step 4: Implement exact contracts and fail-closed config**

Require `DATABASE_URL`, object-store endpoint/region/bucket credentials, `SESSION_SECRET`, `INVITE_HMAC_SECRET`, `CLASS_REVIEW_TOPIC_HMAC_SECRET`, `GRADING_GATEWAY_BASE_URL`, `GRADING_GATEWAY_SERVICE_TOKEN`, `WEB_ORIGIN`, cookie security mode and migration version. Errors name missing variables only, never values.

- [ ] **Step 5: Add safe structured logging**

Allow request diagnostic ID, route template, status, duration and safe error code. Redact request/response bodies and `authorization`, `cookie`, `set-cookie`, CSRF, service token and object-store credentials. Do not log raw entity IDs; use per-request opaque diagnostic IDs.

- [ ] **Step 6: Run tests/typecheck and commit**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'packages/contracts')
npm.cmd test
npm.cmd run typecheck
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd test
npm.cmd run typecheck
git -C $repoRoot add -- packages/contracts/package.json packages/contracts/package-lock.json packages/contracts/tsconfig.json packages/contracts/src/auth.ts packages/contracts/src/tasks.ts packages/contracts/src/grading.ts packages/contracts/src/classReview.ts packages/contracts/src/errors.ts packages/contracts/src/index.ts packages/contracts/src/contracts.test.ts platform-api/package.json platform-api/package-lock.json platform-api/tsconfig.json platform-api/.env.example platform-api/src/index.ts platform-api/src/server.ts platform-api/src/config.ts platform-api/src/logging.ts platform-api/src/server.test.ts
git -C $repoRoot commit -m "feat: scaffold authoritative platform contracts"
```

---

## Task 2: Extract the deterministic class-review domain for server authority

**Files:**

- Create: `packages/class-review-domain/package.json`
- Create: `packages/class-review-domain/package-lock.json`
- Create: `packages/class-review-domain/tsconfig.json`
- Create: `packages/class-review-domain/src/aggregate.ts`
- Create: `packages/class-review-domain/src/aggregate.test.ts`
- Create: `packages/class-review-domain/src/spelling.ts`
- Create: `packages/class-review-domain/src/spelling.test.ts`
- Create: `packages/class-review-domain/src/topicKey.ts`
- Create: `packages/class-review-domain/src/topicKey.test.ts`
- Create: `packages/class-review-domain/src/redaction.ts`
- Create: `packages/class-review-domain/src/redaction.test.ts`
- Create: `packages/class-review-domain/src/projection.ts`
- Create: `packages/class-review-domain/src/projection.test.ts`
- Create: `packages/class-review-domain/src/merge.ts`
- Create: `packages/class-review-domain/src/merge.test.ts`
- Create: `packages/class-review-domain/src/index.ts`
- Modify: `platform-api/package.json`
- Modify: `platform-api/package-lock.json`
- Create: `platform-api/src/classReviewDomainDependency.test.ts`

**Interfaces:**

- Produces deterministic, side-effect-free functions equivalent to the approved local prototype behavior, but accepts server-owned task/result revision records and injected HMAC/redaction dependencies.
- No browser object, `File`, React state or Provider transport appears in the package.

```ts
interface SpillableClassReviewAccumulator {
  addPage(records: readonly ServerResultRevision[], spill: ClassReviewAggregateSpill): Promise<void>
  finalize(spill: ClassReviewAggregateSpill): Promise<ClassReviewAggregateSummary>
}
```

- [ ] **Step 1: Scaffold and lock the domain test toolchain**

Create the manifest, `test`/`typecheck` scripts, TypeScript config and empty entry point; name it `@writewise/class-review-domain`, install TypeScript/Vitest development dependencies and review its `package-lock.json` before RED. Then set the Platform manifest dependency to exactly `"@writewise/class-review-domain": "file:../packages/class-review-domain"`, run `npm install` in `platform-api`, and review the locked local dependency in `platform-api/package-lock.json`. The runtime package remains dependency-light and adds no React, Express or Provider SDK. Do not create a root workspace/path alias or copy the domain algorithms into Platform.

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'packages/class-review-domain')
npm.cmd install
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd install
```

- [ ] **Step 2: Port exact local/spec golden tests before implementation**

Copy semantic cases—not code imports—for thresholds, partial denominators, definite spelling, topic collision, redaction, projection and merge. The projection suite repeats every equality/+1 constant: 10 dimensions, 20 score bands, at most 32 fixed count entries total including `other`, 8 KiB statistics, 64 groups, one excerpt, 160/160/48/360 code points, 32 KiB evidence, deterministic `mustCover` precedence and all three semantic coverage measures. Provider post-processing tests require hidden support/occurrence recomputation, threshold filtering, single/multi-member topic keys, at most three examples that reuse the same stored scrubbed strings, and deterministic fallback for every omitted/unconsumed `mustCover`. Add a parity fixture that serializes local and server aggregate outputs and compares canonical JSON; `platform-api/src/classReviewDomainDependency.test.ts` must import these implementations from `@writewise/class-review-domain` and fail if Platform owns a duplicate implementation.

- [ ] **Step 3: Run and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'packages/class-review-domain')
npm.cmd test
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd test -- src/classReviewDomainDependency.test.ts
```

Expected: the runner starts and semantic tests fail on missing algorithms, never on a missing script/toolchain.

- [ ] **Step 4: Implement the server package from the approved algorithms**

All clocks, IDs, HMAC and tokenizer counts are injected. The package returns no database IDs. Its accumulator keeps at most one configured page plus a bounded group buffer in memory and spills canonical partial aggregates through the injected `ClassReviewAggregateSpill`; it never owns an unbounded result/group array. Keep `topic-key-v1`, `class-review-redaction-v1` and `class-review-projection-v1` as explicit constants.

- [ ] **Step 5: Run parity, boundary tests and typecheck**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'packages/class-review-domain')
npm.cmd test
npm.cmd run typecheck
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd test -- src/classReviewDomainDependency.test.ts
npm.cmd run typecheck
```

- [ ] **Step 6: Commit Task 2**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location $repoRoot
git -C $repoRoot add -- packages/class-review-domain/package.json packages/class-review-domain/package-lock.json packages/class-review-domain/tsconfig.json packages/class-review-domain/src/aggregate.ts packages/class-review-domain/src/aggregate.test.ts packages/class-review-domain/src/spelling.ts packages/class-review-domain/src/spelling.test.ts packages/class-review-domain/src/topicKey.ts packages/class-review-domain/src/topicKey.test.ts packages/class-review-domain/src/redaction.ts packages/class-review-domain/src/redaction.test.ts packages/class-review-domain/src/projection.ts packages/class-review-domain/src/projection.test.ts packages/class-review-domain/src/merge.ts packages/class-review-domain/src/merge.test.ts packages/class-review-domain/src/index.ts platform-api/package.json platform-api/package-lock.json platform-api/src/classReviewDomainDependency.test.ts
git -C $repoRoot commit -m "feat: centralize authoritative class review domain"
```

---

## Task 3: Add PostgreSQL identity, tenant, task and result repositories

**Files:**

- Create: `platform-api/compose.yaml`
- Create: `platform-api/src/db/pool.ts`
- Create: `platform-api/src/db/transaction.ts`
- Create: `platform-api/src/db/migrate.ts`
- Create: `platform-api/src/db/testDatabase.ts`
- Create: `platform-api/src/db/migrations/001_identity_and_tasks.sql`
- Create: `platform-api/src/repositories/tenantRepository.ts`
- Create: `platform-api/src/repositories/teacherRepository.ts`
- Create: `platform-api/src/repositories/sessionRepository.ts`
- Create: `platform-api/src/repositories/taskRepository.ts`
- Create: `platform-api/src/repositories/taskDraftRepository.ts`
- Create: `platform-api/src/repositories/taskAiOperationRepository.ts`
- Create: `platform-api/src/repositories/taskAiOperationRepository.integration.test.ts`
- Create: `platform-api/src/repositories/providerExecutionCleanupOutboxRepository.ts`
- Create: `platform-api/src/repositories/providerExecutionCleanupOutboxRepository.integration.test.ts`
- Create: `platform-api/src/repositories/essayRepository.ts`
- Create: `platform-api/src/repositories/gradingResultRepository.ts`
- Create: `platform-api/src/repositories/coreRepositories.integration.test.ts`
- Create: `platform-api/src/adapters/objectStore.ts`
- Create: `platform-api/src/adapters/s3ObjectStore.ts`
- Create: `platform-api/src/adapters/fakeObjectStore.ts`
- Create: `platform-api/src/adapters/objectStore.test.ts`
- Modify: `platform-api/package.json`
- Modify: `platform-api/package-lock.json`

**Interfaces:**

```ts
withTransaction<T>(pool: Pool, work: (tx: PoolClient) => Promise<T>): Promise<T>
findTaskForPrincipal(tx, principal, taskId): Promise<AuthorizedTask | null>
streamCurrentResultRevisions(tx, principal, taskId, options: {
  cursor?: OpaqueCursor
  batchSize: number // 1..200
}): AsyncIterable<readonly GradingResultRevisionRecord[]>
createOrAttachTaskAiOperation(tx, principal, draftId, command): Promise<TaskAiOperationAttach>
abandonTaskAiOperation(tx, principal, input: {
  draftId: string
  operationId: string
  expectedDraftRevision: number
  expectedOperationRevision: number
}): Promise<TaskAiOperationStatus>
invalidateTaskAiOperationsForDraftChange(tx, input: {
  draftId: string
  previousDraftRevision: number
  nextDraftRevision: number
  nextMaterialRevisionDigest: string
}): Promise<readonly ProviderExecutionCleanupRequest[]>
enqueueProviderExecutionCleanup(tx, request: ProviderExecutionCleanupRequest): Promise<void>
```

- [ ] **Step 1: Create the isolated test-database harness**

Create `compose.yaml`, pool/migration/test helpers and exact `db:test:up`, `db:test:down`, `db:migrate:test`, `db:reset:test` scripts first. Every command targets only the named synthetic test database and refuses a non-test database name. Run an empty migration smoke so later RED cannot be caused by a missing script or database connection.

- [ ] **Step 2: Write failing repository, AI-operation lifecycle and object-store tests**

Tenant A cannot read or mutate Tenant B by guessed UUID. viewer cannot write. Every task/result update uses `expectedRevision`; stale writes return `version_conflict` with only safe latest revision metadata. Cursor tests stream a large synthetic task in pages of at most 200 and assert repository instrumentation never materializes all result payloads at once.

Write the object-store adapter suite before implementing it: random tenant-scoped keys contain neither names nor filenames, signed URLs are short-lived and authorized per request, one tenant cannot address another tenant's key, delete is idempotent, and logs never contain keys or signed URLs. Write AI-operation races for create/attach, abandon and invalidation: only the teacher-authorized `result_unknown` operation may be abandoned by draft/operation CAS; abandonment permits continuing with a valid teacher rubric but never authorizes a replacement Provider call. Any draft/material revision change increments the draft `invalidation_epoch`, invalidates every nonterminal operation from the old epoch and enqueues `tombstone_then_finalize` cleanup. A late success may update the draft only when operation state, execution identity/hash, input/material revisions and invalidation epoch all still match; otherwise it discards content and only advances the cleanup outbox/independent lease settlement.

- [ ] **Step 3: Run database and object-store tests and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd run db:test:up
npm.cmd run db:migrate:test
npm.cmd test -- src/repositories/coreRepositories.integration.test.ts src/repositories/taskAiOperationRepository.integration.test.ts src/repositories/providerExecutionCleanupOutboxRepository.integration.test.ts src/adapters/objectStore.test.ts
```

Expected: migration harness succeeds; tests fail on missing repository/AI-operation/object-store behavior, not missing Docker, scripts, drivers or test dependencies.

- [ ] **Step 4: Create the core schema and scoped repositories**

Create `tenants`, `teachers`, `tenant_memberships`, `teacher_identities`, `sessions`, `tenant_invites`, `task_drafts`, `task_draft_materials`, `task_ai_operations`, `provider_execution_cleanup_outbox`, `tasks`, `task_rubric_revisions`, `essays`, `essay_pages`, `grading_jobs`, `grading_result_revisions`, `idempotency_records` and `change_events`. `task_ai_operations.state` is constrained to `queued | running | result_unknown | succeeded | failed_confirmed_zero | failed_terminal | abandoned | invalidated`; each row persists intent, positive operation revision, draft/input revision, material revision digest, `invalidation_epoch`, opaque Gateway execution identity/hash and safe terminal code, but no Provider raw response. Drafts have positive revision/invalidation epoch and `unfinished | finalized | pending_deletion` lifecycle. Finalization atomically adopts only the materials referenced by the created task; unadopted draft materials remain draft-owned for Task 9 retention/deletion.

`provider_execution_cleanup_outbox` is the one named temporary cleanup artifact used by Tasks 3, 8 and 9. It stores a tenant-scoped temporary resource relation, opaque execution identity/key and payload hash, `acknowledge | tombstone_then_finalize` action, phase/fence and retry metadata; unique action/identity rows make enqueue idempotent. It is not an audit table: the worker must delete the row and every resource/execution/hash association after acknowledge or final purge. Every business row carries `tenant_id`; every mutable aggregate carries a positive integer revision. Store page bytes only in object storage; database rows store opaque object key, MIME type, byte count and checksum. Index current-result scans by `(tenant_id, task_id, essay_id, revision)` so the server cursor reads a fixed repeatable snapshot without an unbounded JSON aggregate.

Updates use `where tenant_id=$tenant and id=$id and revision=$expected`, increment revision and append a change event in the same transaction. Historical result payloads are immutable and addressable by `(essay_id, result_revision)` until the approved retention process deletes them.

- [ ] **Step 5: Implement scoped repositories and the object-store adapters**

Implement the repositories and object-store adapters against the Step 2 tests. Every operation/result write uses `where tenant_id=$tenant and id=$id and revision=$expected`; abandon additionally requires `state='result_unknown'`, matching execution identity/hash and the current draft/material epoch in the same transaction. Draft/material mutations call invalidation before commit. A late callback that loses this fence must not write draft/rubric/material content and must enqueue or attach the same cleanup request. Object keys remain random and tenant-scoped without names or filenames; authorization is checked before sign/read/delete.

- [ ] **Step 6: Run and commit**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd run db:reset:test
npm.cmd test -- src/repositories/coreRepositories.integration.test.ts src/repositories/taskAiOperationRepository.integration.test.ts src/repositories/providerExecutionCleanupOutboxRepository.integration.test.ts src/adapters/objectStore.test.ts
npm.cmd run typecheck
git -C $repoRoot add -- platform-api/compose.yaml platform-api/src/db/pool.ts platform-api/src/db/transaction.ts platform-api/src/db/migrate.ts platform-api/src/db/testDatabase.ts platform-api/src/db/migrations/001_identity_and_tasks.sql platform-api/src/repositories/tenantRepository.ts platform-api/src/repositories/teacherRepository.ts platform-api/src/repositories/sessionRepository.ts platform-api/src/repositories/taskRepository.ts platform-api/src/repositories/taskDraftRepository.ts platform-api/src/repositories/taskAiOperationRepository.ts platform-api/src/repositories/taskAiOperationRepository.integration.test.ts platform-api/src/repositories/providerExecutionCleanupOutboxRepository.ts platform-api/src/repositories/providerExecutionCleanupOutboxRepository.integration.test.ts platform-api/src/repositories/essayRepository.ts platform-api/src/repositories/gradingResultRepository.ts platform-api/src/repositories/coreRepositories.integration.test.ts platform-api/src/adapters/objectStore.ts platform-api/src/adapters/s3ObjectStore.ts platform-api/src/adapters/fakeObjectStore.ts platform-api/src/adapters/objectStore.test.ts platform-api/package.json platform-api/package-lock.json
git -C $repoRoot commit -m "feat: persist tenant tasks and grading revisions"
```

---

## Task 4: Implement teacher sessions, tenant roles, CSRF and service authentication

**Files:**

- Create: `platform-api/src/modules/auth/passwordHash.ts`
- Create: `platform-api/src/modules/auth/authService.ts`
- Create: `platform-api/src/modules/auth/authRoutes.ts`
- Create: `platform-api/src/modules/auth/authRoutes.test.ts`
- Create: `platform-api/src/http/authMiddleware.ts`
- Create: `platform-api/src/http/authMiddleware.test.ts`
- Create: `platform-api/src/http/csrfMiddleware.ts`
- Create: `platform-api/src/http/csrfMiddleware.test.ts`
- Create: `platform-api/src/http/serviceAuthMiddleware.ts`
- Create: `platform-api/src/http/serviceAuthMiddleware.test.ts`
- Create: `platform-api/src/http/idempotencyMiddleware.ts`
- Create: `platform-api/src/http/idempotencyMiddleware.test.ts`
- Create: `platform-api/src/http/errorHandler.ts`
- Modify: `platform-api/src/server.ts`

**Interfaces:**

- Produces `POST /auth/register-with-invite`, `POST /auth/login`, `POST /auth/logout`, `GET /me`.
- Session cookie is opaque, `HttpOnly`, `Secure` in production, `SameSite=Lax`, path `/`; database stores only SHA-256 token hash and expiry.
- Every mutation requires allowed Origin and session-bound CSRF token.

- [ ] **Step 1: Write failing auth and role tests**

Cover invite single-use, scrypt password verification, generic invalid-login response, session rotation, expiration, logout, owner/editor/viewer permissions, disabled membership, cross-tenant denial and safe logs.

- [ ] **Step 2: Write failing CSRF/idempotency tests**

Same key + same canonical request returns the stored response; same key + different hash returns 409. Missing/bad Origin or CSRF rejects before mutation. Never hash multipart bytes by reading them into logs.

- [ ] **Step 3: Run and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd test -- src/modules/auth/authRoutes.test.ts src/http/authMiddleware.test.ts src/http/csrfMiddleware.test.ts src/http/serviceAuthMiddleware.test.ts src/http/idempotencyMiddleware.test.ts
```

- [ ] **Step 4: Implement constant-time credential checks and rate limits**

Use Node `scrypt` with versioned parameters and random salt; compare derived values with `timingSafeEqual`. Apply bounded per-IP and per-identity login attempts without disclosing account existence. Service tokens are separate from teacher sessions and accepted only on internal routes.

- [ ] **Step 5: Run tests/typecheck and commit**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd test -- src/modules/auth src/http
npm.cmd run typecheck
git -C $repoRoot add -- platform-api/src/modules/auth/passwordHash.ts platform-api/src/modules/auth/authService.ts platform-api/src/modules/auth/authRoutes.ts platform-api/src/modules/auth/authRoutes.test.ts platform-api/src/http/authMiddleware.ts platform-api/src/http/authMiddleware.test.ts platform-api/src/http/csrfMiddleware.ts platform-api/src/http/csrfMiddleware.test.ts platform-api/src/http/serviceAuthMiddleware.ts platform-api/src/http/serviceAuthMiddleware.test.ts platform-api/src/http/idempotencyMiddleware.ts platform-api/src/http/idempotencyMiddleware.test.ts platform-api/src/http/errorHandler.ts platform-api/src/server.ts
git -C $repoRoot commit -m "feat: authenticate tenant-scoped teachers"
```

---

## Task 5: Persist class-review reports, issues, evidence and generation state

**Files:**

- Create: `platform-api/src/db/migrations/002_class_review.sql`
- Create: `platform-api/src/repositories/classReviewRepository.ts`
- Create: `platform-api/src/repositories/classReviewRepository.integration.test.ts`
- Create: `platform-api/src/repositories/generationRepository.ts`
- Create: `platform-api/src/repositories/generationRepository.integration.test.ts`

**Interfaces:**

```ts
readClassReviewWorkspace(tx, principal, taskId): Promise<ClassReviewReportV1>
applyReportCommand(tx, principal, command): Promise<ClassReviewReportV1>
createOrAttachGeneration(tx, principal, command): Promise<GenerationAttachResult>
```

- [ ] **Step 1: Write failing schema/state/CAS tests**

Cover report `none/draft/ai_available/ai_removed`, separate `ai_text_edit_revision`, `issue_order` as sole order, exact teacher/system evidence, suppressed system variant, currentGeneration precedence, illegal generation transitions, task/report/generation CAS and collision-safe topic identity. Race every pair among `queued`, `running`, `result_unknown` and `succeeded_unapplied`; any existing actionable row must prevent insertion/transition of another actionable row, including active-versus-unapplied in both orders. Race different incoming generation/request identities with the same fixed task/rubric/result revisions, snapshot digest and payload hash and require attachment to the already actionable run; race any fixed-revision/snapshot/hash difference and require `active_generation_conflict`. An existing `succeeded_unapplied` always returns its pending candidate and never becomes a new run.

- [ ] **Step 2: Run and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd run db:reset:test
npm.cmd test -- src/repositories/classReviewRepository.integration.test.ts src/repositories/generationRepository.integration.test.ts
```

- [ ] **Step 3: Create exact class-review tables**

Create `class_review_reports`, `class_review_issue_blocks`, `class_review_evidence_refs`, `class_review_selected_materials`, `class_review_generation_runs`, `class_review_generation_sources`, `class_review_generation_candidates`, `class_review_snapshot_accumulators` and `class_review_snapshot_atomic_groups`. The last two are tenant/task/generation-scoped spill tables used by the bounded cursor accumulator and are cleared after terminal merge/discard/invalidation or deletion. Store `issue_order` only on report. Candidate content is isolated from active report and removed after apply/discard/invalidation.

Add one partial unique index for the entire actionable set; two separate indexes are forbidden because they would permit one active run and one unapplied candidate simultaneously:

```sql
create unique index one_actionable_class_review_generation_per_task
  on class_review_generation_runs(tenant_id, task_id)
  where state in ('queued','running','result_unknown','succeeded_unapplied');
```

This is the single actionable database constraint. `succeeded_unapplied` remains in the index so a pending candidate blocks a new generation, but it is terminal with respect to Provider transport and occupies no `provider_admission_leases` row.

- [ ] **Step 4: Implement transactional workspace projection**

One read transaction returns report plus at most one actionable generation using `succeeded_unapplied > queued/running/result_unknown`. `none` does not require a report row; all variants include task revision and `aiTextEditRevision`. `createOrAttachGeneration` begins a transaction, locks the task row, reads the actionable row and wraps the insert in a savepoint. If the insert raises PostgreSQL `23505`, map it only when `constraint === 'one_actionable_class_review_generation_per_task'`, roll back to that savepoint (not the task transaction), and reload the actionable row while the task-row lock is still held; rethrow every other uniqueness error. If the existing row is `queued | running | result_unknown` and its fixed task/rubric/result revisions, snapshot digest and canonical payload hash equal the newly computed values, return that existing generation ID even when the incoming generation ID, request identity or idempotency key differs. If any fixed revision/digest/hash differs, return safe `active_generation_conflict` before Provider admission. If the existing row is `succeeded_unapplied`, return its existing generation ID plus `pending_candidate`; never attach it as a new run, requeue it or acquire admission.

- [ ] **Step 5: Run tests and commit**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd test -- src/repositories/classReviewRepository.integration.test.ts src/repositories/generationRepository.integration.test.ts
npm.cmd run typecheck
git -C $repoRoot add -- platform-api/src/db/migrations/002_class_review.sql platform-api/src/repositories/classReviewRepository.ts platform-api/src/repositories/classReviewRepository.integration.test.ts platform-api/src/repositories/generationRepository.ts platform-api/src/repositories/generationRepository.integration.test.ts
git -C $repoRoot commit -m "feat: persist class review workspace and generations"
```

---

## Task 6: Implement authoritative class-review business routes

**Files:**

- Create: `platform-api/src/modules/classReview/classReviewService.ts`
- Create: `platform-api/src/modules/classReview/classReviewRoutes.ts`
- Create: `platform-api/src/modules/classReview/classReviewRoutes.test.ts`
- Create: `platform-api/src/modules/classReview/classReviewCommands.integration.test.ts`
- Modify: `platform-api/src/server.ts`

**Interfaces:**

- `POST /tasks/:taskId/class-review-generations`
- `GET /tasks/:taskId/class-review-generations/:generationId`
- `GET /tasks/:taskId/class-review-report`
- `PATCH /tasks/:taskId/class-review-report`

- [ ] **Step 1: Write failing authorization and exact-contract tests**

Reject unauthenticated, viewer mutation, cross-tenant, body-provided identity/statistics/evidence, unknown fields and stale revisions. Allow authorized reads without exposing internal result revisions, snapshot digest, ordinary IDs or Provider metadata.

- [ ] **Step 2: Write failing generation-command tests**

Cover no workspace initial, draft initial, ai_removed initial, legal regenerate, invalid `regenerate + null`, different generation/request identities racing with equal fixed revisions/snapshot/hash and attaching the existing generation, stale fixed revisions returning `active_generation_conflict`, same idempotency key attach, `succeeded_unapplied` returning only `pending_candidate`, candidate apply/discard, AI text overwrite confirmation/CAS and candidate remaining intact after conflict.

- [ ] **Step 3: Run and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd test -- src/modules/classReview/classReviewRoutes.test.ts src/modules/classReview/classReviewCommands.integration.test.ts
```

- [ ] **Step 4: Implement snapshot creation inside one transaction**

Lock task/report; verify queue settled and `N_success >= 2`; pin current rubric/result revisions under a repeatable-read snapshot. Consume result revisions through the <=200-row cursor and spill bounded partial statistics/atomic groups to snapshot work tables; never call an unbounded `listResults`. Stream eligible groups in deterministic order into the <=64-group Provider projection, retain all `mustCover` rows for deterministic fallback, create draft workspace if absent, persist sources/digest and insert the queued run in one transaction before worker dispatch.

- [ ] **Step 5: Implement PATCH as commands, never whole-object replacement**

`PATCH /tasks/:taskId/class-review-report` supports only AI-text edit, add/remove/undo teacher evidence, promote spelling and move issue with exact expected revisions. All four generation intents—`initial`, `regenerate`, `apply_candidate`, `discard_candidate`—go only through `POST /tasks/:taskId/class-review-generations`; apply/discard reuse the existing generation ID and perform zero Provider calls. Recompute counts from valid evidence in the transaction.

- [ ] **Step 6: Run tests and commit**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd test -- src/modules/classReview
npm.cmd run typecheck
git -C $repoRoot add -- platform-api/src/modules/classReview/classReviewService.ts platform-api/src/modules/classReview/classReviewRoutes.ts platform-api/src/modules/classReview/classReviewRoutes.test.ts platform-api/src/modules/classReview/classReviewCommands.integration.test.ts platform-api/src/server.ts
git -C $repoRoot commit -m "feat: expose authoritative class review commands"
```

---

## Task 7: Persist Provider executions and admission across Gateway instances

**Files:**

- Create: `grading-gateway/src/db/migrate.ts`
- Create: `grading-gateway/src/db/testDatabase.ts`
- Create: `grading-gateway/src/db/migrations/001_provider_runtime.sql`
- Create: `grading-gateway/src/execution/providerExecutionStages.ts`
- Create: `grading-gateway/src/execution/providerExecutionStages.test.ts`
- Create: `grading-gateway/src/execution/providerExecutionStore.ts`
- Create: `grading-gateway/src/execution/memoryProviderExecutionStore.ts`
- Create: `grading-gateway/src/execution/postgresProviderExecutionStore.ts`
- Create: `grading-gateway/src/execution/postgresProviderExecutionStore.integration.test.ts`
- Create: `grading-gateway/src/execution/providerUsageAggregateStore.ts`
- Create: `grading-gateway/src/execution/memoryProviderUsageAggregateStore.ts`
- Create: `grading-gateway/src/execution/postgresProviderUsageAggregateStore.ts`
- Create: `grading-gateway/src/execution/postgresProviderUsageAggregateStore.integration.test.ts`
- Create: `grading-gateway/src/execution/providerExecutionRegistry.ts`
- Create: `grading-gateway/src/execution/providerExecutionRegistry.test.ts`
- Create: `grading-gateway/src/execution/providerResultCipher.ts`
- Create: `grading-gateway/src/execution/providerResultCipher.test.ts`
- Create: `grading-gateway/src/admission/providerAdmissionStore.ts`
- Create: `grading-gateway/src/admission/memoryProviderAdmissionStore.ts`
- Create: `grading-gateway/src/admission/postgresProviderAdmissionStore.ts`
- Create: `grading-gateway/src/admission/postgresProviderAdmissionStore.integration.test.ts`
- Create: `grading-gateway/src/admission/providerCallFence.ts`
- Create: `grading-gateway/src/admission/providerCallFence.test.ts`
- Modify: `grading-gateway/src/providerAdmissionController.ts`
- Modify: `grading-gateway/src/providerAdmissionController.test.ts`
- Modify: `grading-gateway/src/providers/providerTypes.ts`
- Modify: `grading-gateway/src/providerTelemetry.ts`
- Modify: `grading-gateway/src/providerTelemetry.test.ts`
- Modify: `grading-gateway/src/essayGradingRegistry.ts`
- Modify: `grading-gateway/src/essayGradingRegistry.test.ts`
- Modify: `grading-gateway/src/oneShotProviderExecution.ts`
- Modify: `grading-gateway/src/oneShotProviderExecution.test.ts`
- Modify: `grading-gateway/src/classReviewSynthesis/service.ts`
- Modify: `grading-gateway/src/classReviewSynthesis/service.test.ts`
- Modify: `grading-gateway/src/classReviewSynthesis/runtimeInvariant.ts`
- Modify: `grading-gateway/src/classReviewSynthesis/runtimeInvariant.test.ts`
- Modify: `grading-gateway/src/gatewayRuntimeConfig.ts`
- Modify: `grading-gateway/src/gatewayRuntimeConfig.test.ts`
- Modify: `grading-gateway/src/server.ts`
- Modify: `grading-gateway/src/server.test.ts`
- Modify: `grading-gateway/src/index.ts`
- Modify: `grading-gateway/package.json`
- Modify: `grading-gateway/package-lock.json`
- Modify: `grading-gateway/.env.example`

**Interfaces:**

```ts
type ProviderExecutionStage =
  | 'material_context'
  | 'rubric_generation'
  | 'essay_grading_images'
  | 'essay_regrading_text'
  | 'class_review_generation'

type ProviderExecutionState =
  | 'reserved' | 'running' | 'result_unknown'
  | 'succeeded' | 'failed_confirmed_zero' | 'failed_terminal'
  | 'acknowledged' | 'content_tombstoned'

interface ProviderExecutionStore {
  reserveOrAttach(input: {
    stage: ProviderExecutionStage
    opaqueExecutionIdentity: string
    canonicalPayloadHash: string
  }): Promise<ReserveOrAttachDecision>
  commitStrictSuccess(input: StrictSuccessWrite): Promise<void>
  markResultUnknown(input: UnknownWrite): Promise<void>
  lookup(input: ExecutionLookup): Promise<StrictExecutionSnapshot>
  acknowledgePersisted(input: ExecutionLookup): Promise<void>
  tombstoneContent(input: FencedExecutionCleanup): Promise<void>
  finalizeContentPurge(input: FencedExecutionCleanup): Promise<void>
}

interface ProviderAdmissionStore {
  tryAcquire(input: AcquireInput): Promise<AcquireDecision>
  heartbeat(input: LeaseHeartbeatInput): Promise<void>
  markUnknown(input: LeaseUnknownInput): Promise<void>
  settle(input: SettleInput): Promise<void>
  pause(input: ProviderPauseInput): Promise<void>
  snapshot(scope: string): Promise<SafeAdmissionSnapshot>
}
```

All admission APIs are asynchronous and transaction-backed. `AcquireDecision` returns a cryptographically random `leaseToken`, random `ownerInstanceId` and monotonically increasing execution `fenceEpoch`; no business ID is accepted as a lease credential. `SettleInput` requires all three values. The five stage strings above are the only persisted/billed values—no generic essay-stage alias is permitted.

- [ ] **Step 1: Install and lock the existing Gateway PostgreSQL dependency**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'grading-gateway')
npm.cmd install pg
npm.cmd install --save-dev @types/pg
```

Review the lockfile and add `db:migrate:test` / `db:reset:test` scripts that refuse non-test database names before writing integration tests.

- [ ] **Step 2: Write failing durable execution/lookup tests**

For all five fee-producing stages, bind an opaque HMAC execution key to one canonical payload hash. Same identity/hash/stage across two Gateway instances attaches; a hash or stage mismatch returns content-free 409. `material_context` fixes draft/input revision, ordered material digests and parser/schema revision; `rubric_generation` fixes draft/input/material-context revisions plus rubric policy/schema; `essay_grading_images` fixes essay version, page checksums/order and rubric/policy/schema revisions; `essay_regrading_text` separately fixes essay version, confirmed-transcript revision/hash and rubric/policy/schema revisions; `class_review_generation` fixes its snapshot digest, payload hash and task/rubric/result revisions. Lost-response lookup/ack tests for both essay stages prove one initial image completion plus one separately authorized text regrade (`I=1`, `R=1`), and that retry/refresh/restart adds neither charge. The other three stages get the same identity/hash/lookup/ack coverage.

Only `failed_confirmed_zero` may transition back to `reserved` for the same identity/hash under the existing bounded 429 policy; `running`, `result_unknown`, `succeeded`, `failed_terminal`, `acknowledged` and `content_tombstoned` never start Provider again. Store a strict normalized result, safe usage and terminal state transactionally before writing the HTTP response. Simulate a lost success response, restart both instances, then retrieve the encrypted cached result through service-authenticated `POST /grading/provider-executions/lookup` with zero new Provider calls. After Platform commits the result, `POST /grading/provider-executions/acknowledge` clears the encrypted envelope and marks `acknowledged`. Cleanup routes reject browser Origin and expose only service-authenticated lookup/ack/tombstone/final-purge operations.

- [ ] **Step 3: Write failing crash, late-success and shared-admission tests**

An expired owner heartbeat changes the Gateway execution/lease to `result_unknown/unknown`, never to a retryable reservation; the Platform run remains `running` until its same-identity lookup projects `result_unknown`, and no TTL releases the Provider lease or creates another completion. A Platform worker must first claim `queued`, persist the execution identity/hash and transition the run to `running` in one Platform transaction, then call Gateway submit/attach. Platform `running` therefore covers pre-submit, waiting for Gateway admission, `active` Provider execution, attach/lookup and result-commit windows and is never a capacity counter; only Gateway `active | unknown` leases consume Provider slots. Crash after the Platform transition but before/during Gateway transport recovers through the same persistent execution identity/hash: reserved/not-started may submit once, while active/unknown/succeeded only attach or lookup. A late response may transition the Gateway execution from unknown to success only with the same execution key, payload hash, random lease token, owner and unchanged fence epoch; otherwise content is discarded while safe usage can still settle that lease. Two controllers mix all five stages and never exceed the shared hard/target limit. Unknown leases count against capacity until explicit fenced settlement. A confirmed-zero 429 settles/releases its lease and may transition the same Platform run `running -> queued` under the existing bounded policy; timeout, connection loss or unknown outcome never requeues. 429 lowers the shared target, stable success raises only within the hard limit, auth/balance/config pauses all instances, and duplicate/failed settlement never locally frees capacity.

Exercise two-phase erasure: tombstone raises the execution fence and deletes the encrypted envelope so late content cannot land. If an `active | unknown` lease remains, final purge must return `pending_provider_settlement`, preserve the minimal tombstoned execution key/hash plus random-token lease needed for trusted settlement, and leave the deletion receipt pending; it must not delete the execution row or release capacity. Only after the lease is fenced-settled may final purge move present safe usage exactly once into a de-identified aggregate and delete the execution row, execution key and payload hash. `ON DELETE SET NULL` is a defensive referential rule for already-settled historical leases, never permission to detach an unsettled lease. No aggregate row may contain execution, tenant, task, essay, request, snapshot or payload identity. Test absent, invalid and known-zero token fields separately: absent/invalid increments only `attempt_count`, while known zero also increments that field's `known_count`; none may be silently coerced into known zero. Any real class attempt observation with `prompt_tokens > 16_384` writes a shared `class_review_prompt_contract_drift` pause in the same runtime schema—even when final output validation fails—so a second Gateway instance rejects before admission/transport until a reviewed versioned resolution.

- [ ] **Step 4: Run and verify RED before implementing runtime storage**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'grading-gateway')
npm.cmd run db:reset:test
npm.cmd test -- src/execution src/admission src/providerAdmissionController.test.ts src/providerTelemetry.test.ts src/essayGradingRegistry.test.ts src/oneShotProviderExecution.test.ts src/classReviewSynthesis/service.test.ts src/classReviewSynthesis/runtimeInvariant.test.ts src/gatewayRuntimeConfig.test.ts src/server.test.ts
```

Expected: the prepared runner/database harness starts and tests fail on missing five-stage registry, tables, async lease transactions, tombstone/final-purge and call-site behavior—not on a missing script, dependency or database connection.

- [ ] **Step 5: Create the isolated runtime schema and encrypted result cache**

`001_provider_runtime.sql` creates all four runtime tables under a Gateway-only role. `provider_scope` is a static Provider/account/config scope, never a tenant or request identity. Execution rows contain only an HMAC-derived execution key, one exact stage, canonical payload hash, state/fence/revision, encrypted strict result with key version, safe usage, finish reason and timestamps. They contain no Platform task/essay/result ID and cannot read Platform tables. PostgreSQL mode requires separate `GRADING_EXECUTION_IDENTITY_HMAC_KEY` and `GRADING_EXECUTION_RESULT_KEY` values; neither may be logged or reused. The migration includes these non-negotiable tables/constraints (additional timestamps/indexes may be added without weakening them):

```sql
create schema if not exists provider_runtime;
revoke all on schema provider_runtime from public;

create table provider_runtime.provider_admission_state (
  provider_scope varchar(80) primary key,
  hard_limit integer not null check (hard_limit > 0),
  target_limit integer not null check (target_limit > 0 and target_limit <= hard_limit),
  pause_reason varchar(80) check (pause_reason is null or pause_reason in
    ('provider_rate_limited','provider_auth_failed','provider_balance_unavailable',
     'provider_access_denied','provider_not_configured',
     'class_review_prompt_contract_drift','operator_pause')),
  pause_until timestamptz,
  pause_policy_version varchar(80),
  success_streak integer not null default 0 check (success_streak >= 0),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (pause_reason is not null or
    (pause_until is null and pause_policy_version is null))
);

create table provider_runtime.provider_executions (
  execution_key char(43) primary key check (execution_key ~ '^[A-Za-z0-9_-]{43}$'),
  provider_scope varchar(80) not null
    references provider_runtime.provider_admission_state(provider_scope),
  stage varchar(40) not null check (stage in
    ('material_context','rubric_generation','essay_grading_images',
     'essay_regrading_text','class_review_generation')),
  payload_hash char(43) not null check (payload_hash ~ '^[A-Za-z0-9_-]{43}$'),
  result_schema_version varchar(80) not null,
  state varchar(32) not null check (state in
    ('reserved','running','result_unknown','succeeded','failed_confirmed_zero',
     'failed_terminal','acknowledged','content_tombstoned')),
  revision bigint not null default 1 check (revision > 0),
  fence_epoch bigint not null default 1 check (fence_epoch > 0),
  encrypted_result bytea,
  result_nonce bytea,
  result_auth_tag bytea,
  result_key_version varchar(40),
  prompt_tokens bigint check (prompt_tokens is null or prompt_tokens >= 0),
  completion_tokens bigint check (completion_tokens is null or completion_tokens >= 0),
  total_tokens bigint check (total_tokens is null or total_tokens >= 0),
  cached_tokens bigint check (cached_tokens is null or cached_tokens >= 0),
  finish_reason varchar(80),
  safe_failure_code varchar(80),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((state = 'succeeded') = (encrypted_result is not null)),
  check (state <> 'succeeded' or
    (result_nonce is not null and result_auth_tag is not null and result_key_version is not null)),
  check (state = 'succeeded' or
    (encrypted_result is null and result_nonce is null and result_auth_tag is null
     and result_key_version is null))
);

create table provider_runtime.provider_usage_aggregates (
  usage_day date not null,
  provider_scope varchar(80) not null
    references provider_runtime.provider_admission_state(provider_scope),
  stage varchar(40) not null check (stage in
    ('material_context','rubric_generation','essay_grading_images',
     'essay_regrading_text','class_review_generation')),
  outcome varchar(32) not null check (outcome in
    ('succeeded','failed_confirmed_zero','failed_terminal','late_after_tombstone')),
  finish_reason varchar(80) not null default '',
  safe_failure_code varchar(80) not null default '',
  attempt_count bigint not null check (attempt_count > 0),
  prompt_tokens_known_count bigint not null default 0
    check (prompt_tokens_known_count between 0 and attempt_count),
  prompt_tokens_sum bigint not null default 0 check (prompt_tokens_sum >= 0),
  completion_tokens_known_count bigint not null default 0
    check (completion_tokens_known_count between 0 and attempt_count),
  completion_tokens_sum bigint not null default 0 check (completion_tokens_sum >= 0),
  total_tokens_known_count bigint not null default 0
    check (total_tokens_known_count between 0 and attempt_count),
  total_tokens_sum bigint not null default 0 check (total_tokens_sum >= 0),
  cached_tokens_known_count bigint not null default 0
    check (cached_tokens_known_count between 0 and attempt_count),
  cached_tokens_sum bigint not null default 0 check (cached_tokens_sum >= 0),
  updated_at timestamptz not null default clock_timestamp(),
  check (prompt_tokens_known_count > 0 or prompt_tokens_sum = 0),
  check (completion_tokens_known_count > 0 or completion_tokens_sum = 0),
  check (total_tokens_known_count > 0 or total_tokens_sum = 0),
  check (cached_tokens_known_count > 0 or cached_tokens_sum = 0),
  primary key
    (usage_day, provider_scope, stage, outcome, finish_reason, safe_failure_code)
);

create table provider_runtime.provider_admission_leases (
  lease_token uuid primary key,
  provider_scope varchar(80) not null
    references provider_runtime.provider_admission_state(provider_scope),
  execution_key char(43)
    references provider_runtime.provider_executions(execution_key) on delete set null,
  stage varchar(40) not null check (stage in
    ('material_context','rubric_generation','essay_grading_images',
     'essay_regrading_text','class_review_generation')),
  owner_instance_id uuid not null,
  fence_epoch bigint not null check (fence_epoch > 0),
  state varchar(16) not null check (state in ('active','unknown','settled')),
  acquired_at timestamptz not null default clock_timestamp(),
  heartbeat_at timestamptz not null default clock_timestamp(),
  unknown_at timestamptz,
  settled_at timestamptz,
  check ((state = 'active' and unknown_at is null and settled_at is null) or
         (state = 'unknown' and unknown_at is not null and settled_at is null) or
         (state = 'settled' and settled_at is not null))
);

create unique index one_unsettled_lease_per_execution
  on provider_runtime.provider_admission_leases(execution_key)
  where execution_key is not null and state in ('active','unknown');

create index provider_admission_capacity_by_scope
  on provider_runtime.provider_admission_leases(provider_scope, state)
  where state in ('active','unknown');
```

- [ ] **Step 6: Implement fenced acquire/heartbeat/unknown/settle transactions and async callers**

Implement each admission transition as one Gateway-database transaction with the common lock order `provider_admission_state -> provider_admission_leases -> provider_executions` (acquire has no prior lease, so locks state then execution). `reserveOrAttach` first inserts/locks and validates the configured state row, then inserts the FK-bound execution. Acquire counts both `active` and `unknown`, rejects a paused/full scope, generates random lease/owner values, increments the execution fence, inserts the lease and changes the Gateway `provider_executions` row to `running` before commit; this is distinct from the earlier Platform run state. Heartbeat is a lease-token/owner/fence CAS. An ambiguous transport return atomically changes its lease `active -> unknown` and matching Gateway execution `running -> result_unknown`; expiry reaping first locks each scope state row, then claims that scope's leases with `for update skip locked` and performs the same transition. Neither path decrements capacity, and unknown is never freed by TTL.

Settlement locks admission state, lease and execution in that order, verifies the random token, owner and submitted fence against the lease row, and is idempotent only for an identical already-settled outcome. It stores strict success/terminal state and safe usage before the HTTP response, marks the lease settled, then updates shared success streak/target/pause under the same lock. Normally the lease fence must also equal the execution fence for any content transition. Tombstone deliberately increments only the execution content fence while preserving the old fence on the active/unknown lease: a late response whose credential still matches that lease may therefore perform the one explicit `content_tombstoned` exception—discard all result content, settle capacity and retain only safe usage for the later final-purge aggregate—but can never restore an execution result. Aggregate `attempt_count` always advances once for a settled observation, while each token `*_known_count`/`*_sum` advances only when that Provider field was actually present (a known zero increments known-count with sum unchanged); missing or invalid usage never becomes a fabricated zero. Any mismatch against the lease token/owner/fence or database failure leaves capacity occupied. Tombstone and final purge use the same lock order: tombstone raises the execution fence and clears every cipher column including `result_key_version`; final purge first refuses any `active | unknown` lease with `pending_provider_settlement`, then aggregates settled safe usage exactly once and deletes the execution row so `execution_key`/`payload_hash` disappear. `ON DELETE SET NULL` may detach only settled historical leases, which may then be deleted by retention policy. A repeated final purge that finds no execution returns `already_purged` and never increments aggregates.

Refactor `providerAdmissionController.tryAcquire/heartbeat/markUnknown/settle/snapshot`, `essayGradingRegistry`, `oneShotProviderExecution`, material-context/rubric routes, both image-grading and confirmed-text regrading paths, class synthesis service/runtime invariant and all `server.ts` health/submit/lookup/ack/tombstone/final-purge call sites to `await` the shared stores. `providerTypes.ts` and telemetry expose only the five exact stages. Essay v2 remains byte-for-byte compatible; material/rubric routes retain existing contracts. A store/settlement failure fails closed, leaves the durable lease/execution unresolved and never falls back to memory. Production requires `GRADING_PROVIDER_RUNTIME_STORE=postgres-v1`; `memory-v1` is explicit local/test only.

- [ ] **Step 7: Run migration, focused, restart and full regression tests**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'grading-gateway')
npm.cmd run db:reset:test
npm.cmd test -- src/execution src/admission src/providerAdmissionController.test.ts src/providerTelemetry.test.ts src/essayGradingRegistry.test.ts src/oneShotProviderExecution.test.ts src/classReviewSynthesis/service.test.ts src/classReviewSynthesis/runtimeInvariant.test.ts src/gatewayRuntimeConfig.test.ts src/server.test.ts
npm.cmd test
npm.cmd run typecheck
npm.cmd run verify:shared-scoring-runtime
```

- [ ] **Step 8: Commit Task 7 with only listed files**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location $repoRoot
git -C $repoRoot diff --name-only
git -C $repoRoot add -- grading-gateway/src/db/migrate.ts grading-gateway/src/db/testDatabase.ts grading-gateway/src/db/migrations/001_provider_runtime.sql grading-gateway/src/execution/providerExecutionStages.ts grading-gateway/src/execution/providerExecutionStages.test.ts grading-gateway/src/execution/providerExecutionStore.ts grading-gateway/src/execution/memoryProviderExecutionStore.ts grading-gateway/src/execution/postgresProviderExecutionStore.ts grading-gateway/src/execution/postgresProviderExecutionStore.integration.test.ts grading-gateway/src/execution/providerUsageAggregateStore.ts grading-gateway/src/execution/memoryProviderUsageAggregateStore.ts grading-gateway/src/execution/postgresProviderUsageAggregateStore.ts grading-gateway/src/execution/postgresProviderUsageAggregateStore.integration.test.ts grading-gateway/src/execution/providerExecutionRegistry.ts grading-gateway/src/execution/providerExecutionRegistry.test.ts grading-gateway/src/execution/providerResultCipher.ts grading-gateway/src/execution/providerResultCipher.test.ts grading-gateway/src/admission/providerAdmissionStore.ts grading-gateway/src/admission/memoryProviderAdmissionStore.ts grading-gateway/src/admission/postgresProviderAdmissionStore.ts grading-gateway/src/admission/postgresProviderAdmissionStore.integration.test.ts grading-gateway/src/admission/providerCallFence.ts grading-gateway/src/admission/providerCallFence.test.ts grading-gateway/src/providerAdmissionController.ts grading-gateway/src/providerAdmissionController.test.ts grading-gateway/src/providers/providerTypes.ts grading-gateway/src/providerTelemetry.ts grading-gateway/src/providerTelemetry.test.ts grading-gateway/src/essayGradingRegistry.ts grading-gateway/src/essayGradingRegistry.test.ts grading-gateway/src/oneShotProviderExecution.ts grading-gateway/src/oneShotProviderExecution.test.ts grading-gateway/src/classReviewSynthesis/service.ts grading-gateway/src/classReviewSynthesis/service.test.ts grading-gateway/src/classReviewSynthesis/runtimeInvariant.ts grading-gateway/src/classReviewSynthesis/runtimeInvariant.test.ts grading-gateway/src/gatewayRuntimeConfig.ts grading-gateway/src/gatewayRuntimeConfig.test.ts grading-gateway/src/server.ts grading-gateway/src/server.test.ts grading-gateway/src/index.ts grading-gateway/package.json grading-gateway/package-lock.json grading-gateway/.env.example
git -C $repoRoot diff --cached --name-only
git -C $repoRoot commit -m "feat: persist gateway provider executions"
```

---

## Task 8: Execute durable Platform generation jobs through the persistent Gateway

**Files:**

- Create: `platform-api/src/db/migrations/003_generation_jobs.sql`
- Create: `platform-api/src/adapters/gradingGatewayClient.ts`
- Create: `platform-api/src/adapters/gradingGatewayClient.test.ts`
- Create: `platform-api/src/adapters/fakeGradingGatewayClient.ts`
- Create: `platform-api/src/workers/classReviewGenerationWorker.ts`
- Create: `platform-api/src/workers/classReviewGenerationWorker.integration.test.ts`
- Create: `platform-api/src/modules/operations/generationOperations.ts`
- Create: `platform-api/src/modules/operations/generationOperations.test.ts`
- Modify: `platform-api/src/repositories/providerExecutionCleanupOutboxRepository.ts`
- Modify: `platform-api/src/repositories/providerExecutionCleanupOutboxRepository.integration.test.ts`

**Interfaces:**

```ts
claimNextClassReviewGeneration(workerId: string): Promise<ClaimedGeneration | null>
executeClaimedGeneration(claim: ClaimedGeneration): Promise<void>
recoverOriginalProviderExecution(
  run: RunningOrResultUnknownGeneration,
  expectedClaimFence: number,
): Promise<ProviderExecutionRecoveryDecision>
acknowledgePersistedProviderExecution(run: PersistedGeneration): Promise<void>
tombstoneProviderExecutionContent(run: InvalidatedGeneration): Promise<void>
finalizeProviderExecutionPurge(run: TombstonedGeneration): Promise<void>
```

- [ ] **Step 1: Write failing worker claim, lost-response and call-count tests**

Two workers race one queued run; exactly one Platform transaction claims it, persists the `class_review_generation` opaque execution identity plus canonical payload hash and changes `queued -> running` before dispatch. Crash immediately before Gateway submit, after Gateway reserve/acquire and after Provider success are recovered against that same identity/hash; fake counters prove at most one completion in every window. RED cases require a trusted recovery CAS over the durable claim owner/fence, followed by Gateway lookup before any transport decision: neither wall-clock TTL nor a replacement identity may authorize a submit, and recovery must never call the normal blind-submit branch. Assert the Platform-state split explicitly: only `running + absent|reserved_not_started` can continue the original first submit, while `result_unknown + absent|reserved_not_started` remains fenced for trusted resolution and makes zero submit calls; only `running + failed_confirmed_zero` may requeue, while the same Gateway outcome discovered from `result_unknown` resolves to a safe `failed` terminal state and never transitions to queued. `running` may have zero or one Gateway active lease and is not used for capacity accounting. Success submits once and atomically applies or stores an unapplied candidate, then acknowledges Gateway content only after the Platform transaction commits; failed acknowledgement enqueues the Task 3 `provider_execution_cleanup_outbox` action `acknowledge` and never repeats Provider work. Confirmed-zero 429 first settles/releases the lease, then requeues the same running run within inherited limits; add the explicit legal `running -> queued` transition test. Auth/balance/config pauses claims. A timeout/connection loss becomes `result_unknown`; “检查结果” calls only Gateway lookup for the original identity/hash. A cached success is applied with zero new completion, while running/unknown remains fenced. No unknown code path resubmits the synthesis POST automatically, and `succeeded_unapplied` never enters Provider admission.

- [ ] **Step 2: Write failing bounded merge and late-result tests**

Stream saved generation-source groups instead of loading an unbounded collection. For each Provider pattern, union hidden distinct-essay sets, sum occurrences, recompute `studentCount/percent/occurrenceCount`, reject below `requiredSupport`, derive a single-member atomic or sorted multi-member composite topic key, and attach at most three examples from the same scrubbed source used in the request. Every unprojected or rejected/unconsumed `mustCover` group gets one deterministic fallback. The worker holds at most the configured result page (<=200) and projection group page (<=64), spills partial aggregates, and clears spill rows after merge/discard/invalidation. Delete a source during execution and prove the joint fence (`state`, invalidation epoch, execution identity/hash, source revisions) blocks late content; enqueue `tombstone_then_finalize`, discard content and retain only the Gateway's de-identified safe usage.

- [ ] **Step 3: Run and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd run db:reset:test
npm.cmd test -- src/adapters/gradingGatewayClient.test.ts src/workers/classReviewGenerationWorker.integration.test.ts src/modules/operations/generationOperations.test.ts src/repositories/providerExecutionCleanupOutboxRepository.integration.test.ts
```

Expected: tests fail on missing claim/lookup/fence/merge behavior, with the fake Gateway counter proving no accidental second submit.

- [ ] **Step 4: Implement durable claims and trusted operations**

Use `for update skip locked` and a durable claim record with owner and monotonic claim fence. A crashed/unknown claim is never released by TTL into a Provider submit. Only a trusted startup reconciler or authorized operations command may recover it: lock the run, require `running | result_unknown`, CAS the recorded owner/fence to a new recovery fence, retain the exact execution identity/hash/stage, and call `recoverOriginalProviderExecution` before deciding anything. Its exhaustive decision table is fixed:

- `running + (absent | reserved_not_started)`: only the recovered owner/fence may submit or continue once with the same execution identity/hash; the Gateway registry still performs reserve-or-attach, so a concurrent recovery cannot create a second completion. `result_unknown + (absent | reserved_not_started)` never submits and remains fenced for trusted reconciliation because absence does not prove that no Provider call occurred;
- `active`: attach/wait only; `unknown`: persist/project `result_unknown` and expose check only; `succeeded`: validate, commit and acknowledge the cached result, all with zero new completion, regardless of whether Platform entered recovery from `running` or `result_unknown`;
- `running + failed_confirmed_zero`: after lease settlement, apply the bounded same-run `running -> queued` policy. `result_unknown + failed_confirmed_zero` resolves through the already-legal `result_unknown -> failed` terminal transition and requires a later explicit new generation for retry; it never becomes queued. `failed_terminal | acknowledged | content_tombstoned | purged`: resolve to the matching safe terminal/action-required state without submit;
- any stage/hash mismatch, stale claim fence, unauthorized caller or unrecognized state fails content-free and leaves the run fenced.

No branch relies on elapsed TTL, creates a new identity, accepts result content from a teacher browser, manufactures success or directly resends an unresolved request. Provider success/candidate merge and run/report revisions commit atomically; any validation/persistence failure leaves the prior report complete. The shared `gradingGatewayClient.ts` owns lookup/recovery/ack/tombstone/final-purge service contracts; route-specific integration adapters must delegate to it rather than copy its parsers or cleanup protocol.

- [ ] **Step 5: Run tests and commit exact files**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd test -- src/adapters/gradingGatewayClient.test.ts src/workers/classReviewGenerationWorker.integration.test.ts src/modules/operations/generationOperations.test.ts src/repositories/providerExecutionCleanupOutboxRepository.integration.test.ts
npm.cmd run typecheck
git -C $repoRoot add -- platform-api/src/db/migrations/003_generation_jobs.sql platform-api/src/adapters/gradingGatewayClient.ts platform-api/src/adapters/gradingGatewayClient.test.ts platform-api/src/adapters/fakeGradingGatewayClient.ts platform-api/src/workers/classReviewGenerationWorker.ts platform-api/src/workers/classReviewGenerationWorker.integration.test.ts platform-api/src/modules/operations/generationOperations.ts platform-api/src/modules/operations/generationOperations.test.ts platform-api/src/repositories/providerExecutionCleanupOutboxRepository.ts platform-api/src/repositories/providerExecutionCleanupOutboxRepository.integration.test.ts
git -C $repoRoot commit -m "feat: execute durable class review generations"
```

---

## Task 9: Implement deletion, invalidation and retention-policy enforcement

**Files:**

- Create: `platform-api/src/db/migrations/004_deletion_and_retention.sql`
- Create: `platform-api/src/modules/deletion/deletionService.ts`
- Create: `platform-api/src/modules/deletion/deletionRoutes.ts`
- Create: `platform-api/src/modules/deletion/deletionRoutes.test.ts`
- Create: `platform-api/src/modules/deletion/deletionService.integration.test.ts`
- Create: `platform-api/src/modules/deletion/retentionPolicy.ts`
- Create: `platform-api/src/modules/deletion/retentionPolicy.test.ts`
- Create: `platform-api/src/repositories/deletionRepository.ts`
- Create: `platform-api/src/repositories/deletionRepository.integration.test.ts`
- Create: `platform-api/src/workers/providerExecutionCleanupWorker.ts`
- Create: `platform-api/src/workers/providerExecutionCleanupWorker.integration.test.ts`
- Create: `platform-api/src/workers/draftRetentionWorker.ts`
- Create: `platform-api/src/workers/draftRetentionWorker.integration.test.ts`
- Modify: `platform-api/src/repositories/taskDraftRepository.ts`
- Modify: `platform-api/src/repositories/taskAiOperationRepository.ts`
- Modify: `platform-api/src/repositories/taskAiOperationRepository.integration.test.ts`
- Modify: `platform-api/src/repositories/providerExecutionCleanupOutboxRepository.ts`
- Modify: `platform-api/src/repositories/providerExecutionCleanupOutboxRepository.integration.test.ts`
- Modify: `platform-api/src/adapters/gradingGatewayClient.ts`
- Modify: `platform-api/src/adapters/gradingGatewayClient.test.ts`
- Modify: `platform-api/src/adapters/fakeGradingGatewayClient.ts`
- Modify: `platform-api/src/server.ts`

**Interfaces:**

```ts
deleteTaskDraftData(principal, draftId, expectedRevision): Promise<DeletionReceipt>
deleteEssayData(principal, essayId, expectedRevision): Promise<DeletionReceipt>
deleteTaskData(principal, taskId, expectedRevision): Promise<DeletionReceipt>
claimProviderExecutionCleanup(workerId: string): Promise<ClaimedExecutionCleanup | null>
runDraftRetentionSweep(policyVersion: string, cursor?: OpaqueCursor): Promise<RetentionSweepResult>
```

- [ ] **Step 1: Write failing cascade tests**

Unfinished draft deletion first changes the draft to `pending_deletion`, increments its invalidation epoch, invalidates every queued/running/unknown material-context or rubric operation, and enqueues all draft material objects plus `tombstone_then_finalize` cleanup for every execution identity/hash. (`abandoned` is reserved for the teacher's explicit result-unknown CAS command.) A finalized draft never deletes material adopted by its task; that content follows task deletion instead. The approved retention sweep performs the same operation for eligible unfinished drafts/materials and is cursor-bounded/idempotent.

Task deletion removes report, issues, evidence, candidates, edits, materials, order, snapshot spill rows, essays/results/page objects and content-bearing generation relationships. Essay deletion removes its evidence/excerpts, invalidates unclosed generations, moves applied report to `ai_removed`, retains legal teacher items with other sources, and performs zero automatic completions. Draft/task/essay deletions all enqueue the named Task 3 cleanup outbox. Tests require reads to fail closed after the database tombstone, late success to be content-discard-only, and the deletion receipt to remain `pending_provider_settlement` while any affected Gateway lease is active/unknown; completion requires object cleanup, trusted settlement and Gateway final purge.

- [ ] **Step 2: Write failing backup/retention config tests**

Production startup refuses to advertise commercial readiness unless a versioned retention-policy record exists. Engineering tests may use a synthetic policy. No default duration is invented; missing policy is a release blocker, not “keep forever”.

- [ ] **Step 3: Run and verify RED**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd run db:reset:test
npm.cmd test -- src/modules/deletion src/repositories/deletionRepository.integration.test.ts src/repositories/taskAiOperationRepository.integration.test.ts src/repositories/providerExecutionCleanupOutboxRepository.integration.test.ts src/adapters/gradingGatewayClient.test.ts src/workers/providerExecutionCleanupWorker.integration.test.ts src/workers/draftRetentionWorker.integration.test.ts
```

Expected: tests fail on missing tombstone transactions, retention cursor, cleanup worker and two-phase Gateway calls—not on missing scripts, migrations or adapters.

- [ ] **Step 4: Implement phase-one fail-closed deletion transactions**

`004_deletion_and_retention.sql` creates `deletion_tombstones`, `object_deletion_outbox`, `retention_policies` and bounded `retention_sweep_checkpoints`; it adds no Platform usage table. Under one Platform transaction, lock the draft/task/essay, set `pending_deletion`, increment its invalidation epoch, invalidate affected AI/generation rows, remove candidate applicability, and enqueue object deletion plus `provider_execution_cleanup_outbox` action `tombstone_then_finalize`. Outbox rows may temporarily carry the business relation, opaque execution key/hash and object key needed to perform deletion, but logs and receipts never expose them. No external call occurs inside this transaction. All reads check the tombstone and fail closed; late returns check state, epoch, identity/hash and fixed revisions before any content write.

- [ ] **Step 5: Implement phase-two cleanup and de-identified usage retention**

The cleanup worker claims rows with `for update skip locked`. For `tombstone_then_finalize` it first calls the service-authenticated Gateway tombstone route, which raises the execution fence and clears encrypted content; it then idempotently deletes object blobs and calls Gateway final purge. If an affected lease is still active/unknown, Gateway returns `pending_provider_settlement`; Platform keeps the content-free cleanup outbox and visible deletion receipt pending, and only the original fenced lookup/settlement or a trusted operator resolution may advance it—there is no Provider resubmit or TTL release. After trusted settlement, Gateway final purge moves safe usage exactly once to `provider_runtime.provider_usage_aggregates` and deletes the execution row, execution key and payload hash. Platform then clears/deletes execution identity/hash columns or rows in `task_ai_operations`, `grading_jobs` and `class_review_generation_runs`, removes cleanup/object outbox rows and every temporary business/identity link, and completes the deletion receipt. A crash at any phase retries only that idempotent phase and never submits Provider work.

While the receipt is pending, an active/unknown lease remains bound to the minimal tombstoned execution and addressable only by its random lease token, owner, Provider scope, exact stage, execution key/hash and fence. A matching late response can settle capacity and safe token counts/outcome but must discard all result content; a mismatch leaves the lease unresolved and the receipt pending. Tests inspect schemas to prove the final aggregate contains no execution key, payload hash, tenant/task/draft/essay/result/request/snapshot ID or reversible digest. After completion, execution identity/hash, content, candidate JSON, evidence, aliases and temporary outbox identifiers are absent. Retention behavior must match the approved policy version exactly; missing policy never implies “keep forever” or an invented duration.

- [ ] **Step 6: Run tests and commit**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd test -- src/modules/deletion src/repositories/deletionRepository.integration.test.ts src/repositories/taskAiOperationRepository.integration.test.ts src/repositories/providerExecutionCleanupOutboxRepository.integration.test.ts src/adapters/gradingGatewayClient.test.ts src/workers/providerExecutionCleanupWorker.integration.test.ts src/workers/draftRetentionWorker.integration.test.ts
npm.cmd run typecheck
Set-Location $repoRoot
git -C $repoRoot diff --name-only
git -C $repoRoot add -- platform-api/src/db/migrations/004_deletion_and_retention.sql platform-api/src/modules/deletion/deletionService.ts platform-api/src/modules/deletion/deletionRoutes.ts platform-api/src/modules/deletion/deletionRoutes.test.ts platform-api/src/modules/deletion/deletionService.integration.test.ts platform-api/src/modules/deletion/retentionPolicy.ts platform-api/src/modules/deletion/retentionPolicy.test.ts platform-api/src/repositories/deletionRepository.ts platform-api/src/repositories/deletionRepository.integration.test.ts platform-api/src/workers/providerExecutionCleanupWorker.ts platform-api/src/workers/providerExecutionCleanupWorker.integration.test.ts platform-api/src/workers/draftRetentionWorker.ts platform-api/src/workers/draftRetentionWorker.integration.test.ts platform-api/src/repositories/taskDraftRepository.ts platform-api/src/repositories/taskAiOperationRepository.ts platform-api/src/repositories/taskAiOperationRepository.integration.test.ts platform-api/src/repositories/providerExecutionCleanupOutboxRepository.ts platform-api/src/repositories/providerExecutionCleanupOutboxRepository.integration.test.ts platform-api/src/adapters/gradingGatewayClient.ts platform-api/src/adapters/gradingGatewayClient.test.ts platform-api/src/adapters/fakeGradingGatewayClient.ts platform-api/src/server.ts
git -C $repoRoot diff --cached --name-only
git -C $repoRoot commit -m "feat: enforce class review data deletion"
```

---

## Task 10: Verify permissions, concurrency, observability and infrastructure readiness

**Files:**

- Create: `platform-api/src/tests/tenantIsolation.integration.test.ts`
- Create: `platform-api/src/tests/classReviewConcurrency.integration.test.ts`
- Create: `platform-api/src/tests/classReviewDeletion.integration.test.ts`
- Create: `platform-api/src/tests/taskAiOperationLifecycle.integration.test.ts`
- Create: `platform-api/src/tests/providerExecutionLifecycle.integration.test.ts`
- Create: `platform-api/src/tests/safeTelemetry.integration.test.ts`
- Create: `platform-api/scripts/runFakeInfrastructureAcceptance.ts`
- Create: `platform-api/scripts/runFakeInfrastructureAcceptance.test.ts`
- Modify: `docs/current_development_status.md`

**Interfaces:**

- Acceptance spins up two Platform API instances, two workers and two Gateway instances against test PostgreSQL/MinIO, using synthetic data and fake Provider only.
- Task 10 is a final conformance gate over Tasks 1–9 and introduces no runtime behavior. The new acceptance tests should pass on their first run when the prerequisite tasks are truly complete; any failure must be returned to the owning earlier Task for its RED/fix/GREEN cycle. Do not add a hidden implementation step or manufacture an artificial RED in this acceptance-only Task.

- [ ] **Step 1: Add multi-instance acceptance scenarios**

Cover fresh read with no local generation ID, double-click, two different generation IDs with equal snapshot attaching the existing run, stale snapshot conflict, active-versus-`succeeded_unapplied` races in both orders, refresh/new device, teacher AI text edit conflict, apply/discard, result unknown, auth pause, one final essay failure, source deletion during Provider execution and full task deletion. Cover a result-unknown draft AI operation abandoned by CAS, draft/material edit invalidation, unfinished-draft manual deletion and retention deletion; late success must only settle/purge and never rewrite a draft.

For all five exact stages—`material_context`, `rubric_generation`, `essay_grading_images`, `essay_regrading_text`, `class_review_generation`—lose a success response, switch Gateway instance and restart; original execution lookup recovers the strict result once, Platform persistence acknowledges it, and deletion tombstones then finally removes every execution key/payload hash. Exercise an outstanding unknown lease during deletion: the first final-purge attempt must return `pending_provider_settlement` and preserve the receipt/slot; random-token late settlement then releases shared capacity, writes only de-identified aggregate usage, and a second final-purge attempt removes the execution key/hash and completes the receipt.

- [ ] **Step 2: Assert exact fee and persistence invariants**

For `M` authorized material-context operations, `U` authorized rubric generations, `I` authorized image-grading essay versions, `R` separately authorized confirmed-text regrades and `G` authorized class generations, fake completion counts are exactly `M`, `U`, `I`, `R` and `G` minus their own confirmed pre-admission failures. Every attach/lookup shares the original usage; acknowledgement, tombstone/final purge, abandon/invalidate, candidate apply/discard and deterministic recompute add zero. Platform `queued | running` and `succeeded_unapplied` remain task-level states, never capacity counters; only Gateway `active | unknown` leases consume shared Provider capacity. Acceptance covers running-before-submit with zero lease, running-with-active, crash recovery through the same identity/hash, result-unknown/unknown and confirmed-zero `running -> queued` after lease settlement. Restart all API/worker/Gateway instances and prove draft operations, report/currentGeneration and execution/lease/admission state recover from PostgreSQL. A 50,000-result synthetic task asserts `maxBufferedResults <= 200`, `maxBufferedProjectionGroups <= 64`, identical aggregate baselines and bounded Provider payload. A planted `prompt_tokens=16_385` observation durably pauses subsequent real-class-mode admission across both Gateway instances (fake call count for the next request remains zero).

- [ ] **Step 3: Run full infrastructure suites**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location (Join-Path $repoRoot 'packages/contracts')
npm.cmd test
npm.cmd run typecheck
Set-Location (Join-Path $repoRoot 'packages/class-review-domain')
npm.cmd test
npm.cmd run typecheck
Set-Location (Join-Path $repoRoot 'platform-api')
npm.cmd run db:test:up
npm.cmd run db:migrate:test
npm.cmd test
npm.cmd run typecheck
Set-Location (Join-Path $repoRoot 'grading-gateway')
npm.cmd test
npm.cmd run typecheck
npm.cmd run verify:shared-scoring-runtime
```

- [ ] **Step 4: Run security scans and migration checks**

Verify tracked files contain no credentials, Platform and Gateway SQL migrations are forward-only/repeatable on empty isolated test schemas, CORS excludes all internal submit/lookup/ack/tombstone/final-purge routes, logs contain no planted PII/content, and production config rejects memory/fake adapters. Read the approved Task 0 ADR: accept Caddy deployment artifacts only for `reverse_proxy = caddy-v1`, or the exact versioned alternative artifacts for `approved-alternative`; a missing/mismatched selection fails the commercial-readiness gate before deployment.

- [ ] **Step 5: Request security-oriented code review**

Use `superpowers:requesting-code-review`. Fix every Critical/Important issue and rerun the affected integration suites.

- [ ] **Step 6: Update status without claiming release**

Record exact evidence and remaining release gates: app integration, browser migration, real Kimi framing/smoke, production hosting, retention/legal approval and operations runbook.

- [ ] **Step 7: Commit Task 10**

```powershell
$repoRoot = git rev-parse --show-toplevel
Set-Location $repoRoot
git -C $repoRoot diff --name-only
git -C $repoRoot add -- platform-api/src/tests/tenantIsolation.integration.test.ts platform-api/src/tests/classReviewConcurrency.integration.test.ts platform-api/src/tests/classReviewDeletion.integration.test.ts platform-api/src/tests/taskAiOperationLifecycle.integration.test.ts platform-api/src/tests/providerExecutionLifecycle.integration.test.ts platform-api/src/tests/safeTelemetry.integration.test.ts platform-api/scripts/runFakeInfrastructureAcceptance.ts platform-api/scripts/runFakeInfrastructureAcceptance.test.ts docs/current_development_status.md
git -C $repoRoot diff --cached --name-only
git -C $repoRoot commit -m "test: verify class review commercial infrastructure"
```

## Spec-to-Test Traceability Gate

| Commercial invariant | Named evidence required before completion |
|---|---|
| Approved infrastructure choices | Task 0 ADR records database/auth/tenant/object store/polling/retention blockers and exact reverse proxy |
| Portable dependency authority | Tasks 1 and 2: Platform lockfile pins `file:../packages/contracts` and `file:../packages/class-review-domain`; import tests forbid copied parsers/domain or a root workspace |
| Strict browser contracts/auth | Tasks 1 and 4 contract, session, role, CSRF, idempotency and service-auth tests |
| Draft AI operation lifecycle | Tasks 3, 9 and 10: result-unknown abandon CAS, draft/material epoch invalidation, unfinished-draft retention, late-result discard/cleanup |
| Bounded authoritative aggregation | Tasks 2, 3, 6 and 10: cursor <=200, projection <=64, 50,000-result parity/buffer evidence |
| One actionable generation | Task 5: one partial index across all four states; exact task-lock/`23505` attach semantics; pending candidate uses zero admission |
| Generation commands/CAS | Task 6: all four intents on POST; report PATCH rejects candidate intents; apply/discard zero Provider calls |
| Persistent Provider execution | Task 7: all five exact stages, image/regrade identities, two-instance attach, encrypted success, lost response, restart and lookup/ack |
| Shared admission/token drift | Tasks 7 and 10: full state/lease DDL, async acquire/heartbeat/unknown/settle callers, hard limit, shared pauses/429, 16,385 drift pause |
| Candidate materialization | Task 8: hidden support/occurrence recompute, threshold, topic identity, same scrubbed examples, every `mustCover` fallback |
| Deletion/retention | Task 9: DB tombstone, object/Gateway cleanup outboxes, `pending_provider_settlement` before late settlement, Gateway final purge only after settlement, no identifying aggregate |
| Fee invariant | Task 10: exact `M/U/I/R/G` fake completion counts across replay/restart/lookup/apply/discard/deletion |

## Infrastructure Completion Gate

Infrastructure may be called implementation-complete only when:

1. Architecture Review Gate choices are explicitly approved and recorded.
2. Authenticated principal and tenant scope protect every task/report/result read and write.
3. Task, exact result revisions, report, issue order, evidence, candidate and generation state survive process restart.
4. Database constraints enforce at most one actionable generation total per `(tenant_id, task_id)` across `queued | running | result_unknown | succeeded_unapplied`.
5. Exactly `material_context | rubric_generation | essay_grading_images | essay_regrading_text | class_review_generation` use the payload-hash-bound persistent Gateway execution/result registry; lost responses/restarts attach or inspect the original execution and no duplicate Provider completion is possible across instances.
6. Platform workers and all Gateway instances use transactional shared acquire/heartbeat/unknown/settle with owner/token/fence; Platform `running` is a dispatch lifecycle rather than a capacity counter, only Gateway `active | unknown` leases consume slots, unknown calls never free capacity automatically, and token-contract drift durably pauses later class synthesis.
7. Draft abandon/invalidation/deletion and task/essay deletion pass with synthetic content: tombstone blocks late writes, an outstanding random-token lease keeps the receipt at `pending_provider_settlement`, trusted settlement precedes final purge, final purge deletes execution key/hash, and only a non-identifying usage aggregate remains.
8. Production configuration cannot select fake/memory modes or start without required security/policy and the exact reverse proxy approved in the Task 0 ADR.

Even after these pass, “commercially released” remains blocked until the separate integration/release plan passes browser, deployment, real-provider and legal/retention gates.
