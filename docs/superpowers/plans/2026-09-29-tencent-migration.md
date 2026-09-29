# 腾讯云迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 在保留旧站、全部数据和并发1的前提下，交付可在Ubuntu24.04/Node24/PG17运行并可安全预演、冻结、切换和回退的部署。

**Architecture:** 同源Nginx/API，PG持久投递，独立worker/maintenance，私有磁盘文件与签名接口。保留旧Vercel/Supabase实现作为显式选项。先完成本地和合成预演，不自动启用复制来的队列或公开未备案网站。

**Tech Stack:** TypeScript、Express5、pg8、PostgreSQL17、Node24、Nginx、systemd。

**Spec:** `docs/superpowers/specs/2026-09-29-tencent-migration-design.md`（用户已确认并要求继续细化及实施）。

## Global Constraints

- 工作树 `D:\wenjie-writewise-ai\.worktrees\codex-teacher-pilot-accounts`，分支 `codex/tencent-migration`；不推送旧生产分支。
- DeepSeek官方直连、v2、无OCR、模型并发1、未知不重试、账号及禁改密规则不变。
- 私有原图8MiB/张；读签名60秒、写签名7200秒；原图额度20GiB、磁盘余量10GiB、上传并行2。
- 不新增付费云资源，不输出秘密/学生内容，不改变源数据；恢复和预演不得调用真实模型或消费历史任务。
- 旧Vercel配置默认兼容；新磁盘、PG队列、迁移冻结由显式环境选择，配置错误要拒绝就绪。
- 签名、会话、密码、模型密钥不进入日志/前端。生产PG严格TLS，API/PG只监听loopback。
- 产品变更遵守有意义的先失败后通过测试；提交仅包含本任务文件，禁止 `git add .`、推送或自动部署。

## Review Focus

- 同名/重放/中断/超长文件上传与符号链接逃逸；Task1/4必须验证原字节从未覆盖。
- 延迟投递、进程死亡、过期租约、旧token ACK及两个worker争抢；Task2/6必须验证持久性及模型峰值1。
- 冻结检查与真实写入之间的竞态，认证GET和已签发上传令牌；Task3/6必须覆盖排空及阻断，不能只检查布尔标志。
- API启动成功但业务runtime/存储/worker不就绪；Task5/6必须检查完整能力且不发模型请求。
- 迁移后已产生新写入的回退；Task7必须先冻结新端并验证反向恢复，不能仅回退DNS。

### Task 1: 私有磁盘存储与签名原语

**Files:** Create `platform-api/src/pilot/fileTickets.ts`, `diskStorage.ts`, corresponding `.test.ts` files. 不修改runtime/routes/前端。

**Interfaces:**
- Consumes existing `PrivateStorage`, image validation helpers and `PilotError`.
- Produces `createDiskStorage(config): DiskStorage`, where config contains `root`, `origin`, `signingKey`, optional `now`, optional disk-space reader for tests; `DiskStorage extends PrivateStorage` and has `put(path, stream: AsyncIterable<Uint8Array>, expected: {size:number;contentType:string}, signal:AbortSignal):Promise<void>`, `verifyTicket(method:'GET'|'PUT',path:string,expires:string,signature:string):void`.
- URLs use `${origin}/api/pilot/files/${UUID}/${UUID}?expires=<unix-seconds>&signature=<hex>`; HMAC-SHA256 canonical message binds version, method, exact path and expiry. Reading and signing reject malformed paths and invalid TTL. Invalid signatures fail closed with a safe error.

- [ ] Write failing tests for round-trip bytes/MIME, HMAC method/path/expiry tamper, exact deadline, 8MiB+1 streaming abort, wrong length/MIME/dimensions, duplicate upload unchanged, interrupted stream cleanup, symlink path rejection and 10GiB free-space threshold (including pending incoming bytes).
- [ ] Implement bounded stream-to-temp then validated atomic no-overwrite publication; root outside static directory, opaque UUID paths, refuse symlinks, MIME derived from verified file bytes, no sidecar partial-publish window. Filesystem exceptions become safe PilotError codes. remove is idempotent only for valid private paths.
- [ ] Run `npm.cmd --prefix platform-api test -- src/pilot/fileTickets.test.ts src/pilot/diskStorage.test.ts` and `npm.cmd --prefix platform-api run typecheck`; expected all pass. Record red and green evidence in report.
- [ ] Self-review and commit only Task1 files.

### Task 2: PostgreSQL持久投递仓库

**Files:** Create `platform-api/src/migrations/003_pilot_deliveries.sql`, `platform-api/src/pilot/postgresQueue.ts`, `postgresQueue.test.ts`. No edits to existing runtime or worker in this task.

**Interfaces:**
- Produces `createPostgresQueue(db:Database): PostgresJobQueue`, extends existing `JobQueue` with `lease():Promise<DeliveryLease|undefined>`, `acknowledge(lease):Promise<boolean>`, `defer(lease,delaySeconds):Promise<boolean>`.
- `DeliveryLease={deliveryKey:string;jobId:string;token:string}`. Table `pilot_grading.deliveries` stores unique delivery key, job UUID, available_at, lease token/expiry, completion time and attempts. Runtime only SELECT/INSERT/UPDATE; migration is transactional/idempotent and revokes PUBLIC/anon/authenticated.
- Same existing UUID:generation delivery key semantics; delay integer0..86399; lease600seconds; no model invocation in repository. Duplicate publish preserves one logical delivery. Token-fenced ACK/defer cannot affect a newer lease.

- [ ] Write failing PGlite repository tests for idempotent publish, delay, release/defer, expired lease recovery, stale ACK, completed delivery, invalid input and persisted re-open state. Real two-connection contention is Task6.
- [ ] Implement atomic `FOR UPDATE SKIP LOCKED` leasing and bounded parameterized SQL; no in-memory queue. Unexpected db errors propagate safely to higher-level worker.
- [ ] Run `npm.cmd --prefix platform-api test -- src/pilot/postgresQueue.test.ts` and typecheck; expected all pass.
- [ ] Self-review and commit Task2 files only.

### Task 3: 全局维护冻结与排空

**Files:** Create `platform-api/src/migrations/004_pilot_migration_control.sql`, `platform-api/src/pilot/migrationGate.ts`, `migrationGate.test.ts`; modify `database.ts` only as needed for safe connection-bound transactions. Create dedicated `platform-api/scripts/migrationControl.ts`.

**Interfaces:**
- Produces `MigrationGate` with `assertOpen():Promise<void>`, `run<T>(operation:()=>Promise<T>):Promise<T>`, `guardDatabase(db:Database):Database`; `createMigrationGate(db:Database):MigrationGate`.
- A singleton `pilot_grading.migration_control` stores frozen state; normal runtime can only read. Admin CLI may freeze/thaw and returns static/count-only status. A fixed documented PG advisory-lock key serializes freezing against admitted side effects. Use transaction/session-bound connection handling, not pooled arbitrary unlock calls.
- `guardDatabase` prevents new ordinary SQL effects after frozen; `run` holds admission through the full async side effect, including upload signing, file publication, worker/model call and maintenance. Nested calls must not deadlock or exhaust the same pool. Freeze first rejects new admissions, then drains existing admissions. Connection loss fails closed and never silently thaws.
- CLI freeze does not finish until admitted operations are drained, active model executions are resolved, unknown-state check passes, and the maximum source upload signing expiry (7200s plus bounded signing/clock margin) has passed. It may report waiting/blocked without altering unknown jobs. Thaw is explicit.

- [ ] Write failing tests for frozen ordinary queries, whole async operation draining, concurrent freeze/admit, nested gate, error/abort cleanup without premature release, no implicit thaw, and rejection of unknown/active execution cutover.
- [ ] Implement safe shared admission with bounded waiting and admin-only state mutation. Record concrete lock and connection ownership semantics in code comments. Do not change source cloud state.
- [ ] Run focused tests/typecheck. Real PG contention/termination cases are additionally required in Task6; fake SQL evidence alone cannot complete that claim.
- [ ] Commit Task3 files only after scoped tests pass.

### Task 4: 私有文件HTTP接口、配额及前端连接

**Files:** Create `platform-api/src/pilot/fileRoutes.ts`, `fileRoutes.test.ts`, `storageQuota.ts`, `storageQuota.test.ts`; modify `pilot/uploads.ts`, `pilot/routes.ts`, `app/src/pilot/client.ts` and their focused tests.

**Interfaces:**
- Uses DiskStorage and MigrationGate. File router at `/api/pilot/files/:first/:second` is mounted before JSON body parser, behind teacher session/Origin/CSRF protection. GET requires teacher ownership and existing verified image; PUT requires valid reserved upload/active task plus matching signed ticket and exact metadata.
- `StorageQuota.reserve(tx:Queryable,bytes:number):Promise<void>` serializes global quota calculation and reservation in the same upload transaction; count nonpurged retained objects/reservations, maximum20GiB. Repeated command receipt cannot reserve twice. Disk free-space minimum10GiB is also checked by DiskStorage. Simultaneous PUT limiter2 releases on all exit paths.
- Existing Supabase paths remain compatible. Same-origin file requests carry cookies, PUT includes CSRF; reject lookalike hosts/protocols/paths. 409 duplicate may continue to normal completion/hash validation, never overwrite.

- [ ] Add failing tests for teacher isolation, logout/disabled teacher, expired/method-tampered ticket, bad Origin/CSRF, invalid dimensions, aborted and duplicate upload, concurrent quota reservation and overload2. Frontend tests verify URL allowlist, headers and credentials for both supported backends.
- [ ] Integrate only these routes and reservation policy; maintain prior upload completion/CAS and original JPEG metadata behavior.
- [ ] Run platform focused tests, frontend client tests and both typechecks; expected all pass. Commit scoped files.

### Task 5: 运行时、worker、反向代理与部署包

**Files:** Modify `platform-api/src/{config,runtime,server,index}.ts`, `pilot/{runtime,queue}.ts`, `api/pilot-maintenance.ts`; create `platform-api/src/standalone/{worker,maintenance}.ts`, focused runtime/worker tests, `tsconfig.standalone.json`, `deploy/tencent/` build/installation/systemd/Nginx templates and runbook. Adjust package scripts/lockfiles only when required.

**Interfaces:**
- Explicit `PILOT_STORAGE_BACKEND=supabase|disk`, `PILOT_QUEUE_BACKEND=vercel|postgres`, `PILOT_MIGRATION_GATE_ENABLED=1`, disk root/key and bounded defaults; existing environment defaults stay Supabase/Vercel.
- New standalone API rejects startup/readiness when required business storage/queue/gate is missing. Health checks cover runtime, PG grants and storage/worker heartbeat without invoking provider. Before session middleware all ordinary requests consult migration gate; business DB uses guarded wrapper. Source Vercel worker and maintenance entries use same gate when explicitly enabled.
- worker processes one leased delivery at a time via existing `runPilotJob`, ACK on done, bounded defer on failure/deferred; SIGTERM stops new claims, waits active job, never clears provider gate or invents retry identity. maintenance entry uses existing recovery/cleanup within gate.
- Trust proxy only explicit loopback Nginx; overwrite XFF/X-Real-IP at Nginx and ignore client supplied values from untrusted peers. Secure cookies/CSRF remain. File route8MiB, private responses no-store; query strings and secrets excluded from logs.
- Produce versioned standalone build including emitted platform/gateway/shared JS, correctly located SQL migrations and production dependencies. systemd runs nonroot, API/PG loopback only, worker disabled by default after restore. No source secrets in artifact.

- [ ] Add failing tests for explicit backend routing, invalid config fail-closed, pre-auth freeze (including session GET/admin/login), source header spoof, worker duplicate/restart/termination, readiness incomplete dependencies and build resource lookup.
- [ ] Build and run fake-provider synthetic localhost workflow. Do not connect to source cloud while testing.
- [ ] Run relevant full suites, typecheck, lint/build and shared scoring checks; expected all pass. Commit only deployment/runtime files.

### Task 6: 真实PG合成竞争与完整本地验收

**Files:** Create `platform-api/scripts/verifyStandalonePostgres.ts` plus focused integration tests; update backup/restore tools to account for added delivery/control tables and deployed storage backend without deleting historical evidence.

**Interfaces:** Uses explicit isolated-empty-database opt-in; refuses existing business data and fails if model credentials are present. Real PG17 strict TLS, two independent connections, synthetic accounts/files only. Success report is count/status-only.

- [ ] Prove two consumers lease safely, stale ACK is fenced, model peak1 under fake provider, redelivery adds0 calls, unknown holds gate, process termination recovers delivery without repeating unknown calls, and maintenance freeze drains rather than races.
- [ ] Prove all ordinary auth/admin/session/GET paths and file publication stop after freeze; active operations finish or abort safely, queued/model state stays intact, thaw resumes only when explicit. Test aborted clients as well as normal response finish.
- [ ] Verify login→task/rubric→upload→fake grading→teacher edit→refresh/relogin, isolation, retained hashes, restart persistence, and package/systemd config with worker disabled on restored copies.
- [ ] Save evidence in this plan's ignored workspace; run one whole-branch independent review and fix substantive findings before server staging.

### Task 7: 服务器私下部署预演与最终切换准备

**Files:** Update deployment runbook and `docs/2026-09-29-tencent-server-preparation.md`; actual credentials/artifacts only under ignored private paths.

**Interfaces:** Consume verified release and backup; transfer only over authenticated encrypted channel with verified host identity. New security-sensitive SSH access is concretely prepared then approved if the UI tool requires it. No passwords/secrets in TAT command history.

- [ ] Inventory server again, preserve base state; create least-privileged app directories/PG runtime role and strict TLS, restore fresh snapshot into staging DB, import objects, verify all expected schemas/rows/hash/ACL. Do not run copied jobs.
- [ ] Run private/tunneled synthetic acceptance with fake provider first; configure Nginx/systemd and verify restart, logs/permissions and readiness. Keep unfiled public site closed.
- [ ] Prepare explicit source gate deployment, freeze/drain/last-upload expiry checklist, final snapshot and rollback artifacts. New-write rollback must freeze target, export/import both data and images to source backend and verify before unfreezing old site.
- [ ] Only when ICP, HTTPS and necessary concrete permissions are ready, perform cutover with one live writer. Any required real-model synthetic smoke must state its exact scope before action; never use historical student essays.
- [ ] Record achieved stage honestly; final domestic Wi-Fi/mobile no-VPN acceptance requires user observation and cannot be inferred from localhost or cloud HTTP200.
