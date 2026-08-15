# Shared Platform Backend and Website Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建设网站与微信小程序共用的教师账号、任务、作文图片、批改队列、结果版本、班级学生、批注、导出和设置后端，并把现有网站从内存状态迁移到该后端。

**Architecture:** 新增独立 `platform-api`，使用 PostgreSQL 保存业务状态、S3-compatible 对象存储保存作文图片和导出文件、数据库租约驱动显式批改队列。`grading-gateway` 继续只负责模型边界；平台 Worker 从对象存储读取图片并调用 Gateway。网站通过共享契约包和注入式 API 客户端读写数据，使用版本号拒绝跨端覆盖，并通过 change feed + WebSocket 同步变更。

**Tech Stack:** Node.js 24、TypeScript 6、Express、PostgreSQL、`pg`、S3-compatible storage、AWS SDK v3、`ws`、Vitest、Supertest、React 19、Vite、`docx`、PDFKit。

## Global Constraints

- 网站与微信小程序必须共享同一后端、同一数据模型、同一状态机、同一评分规则和同一权限边界。
- 图片二进制存放对象存储；数据库只保存受控元数据和对象键。
- 日志不得包含作文正文、学生身份、图片内容、Base64、Provider 原始响应或密钥。
- 上传、提交分组、启动批改、重试、确认和导出必须接受幂等键。
- 可能产生模型费用的请求不得静默自动重试；失败只影响当前作文。
- 教师修改学生原文后，旧结果保留为历史版本，当前结果失效，只有显式操作才重新入队。
- 所有修改、确认、重批、批注和导出都携带整数版本号；版本冲突返回 HTTP 409 和最新版本摘要。
- 网站与小程序使用 WebSocket 变更通知，并保留 `GET /sync?after=` 作为断线恢复通道。
- 第一版只有教师账号，不开放学生端和家长端登录。
- 网站保留现有路由、侧边栏形态、卡片风格、上传/进度/详情/班级讲评主布局。
- 自动化数据库测试只使用合成数据；真实未成年学生数据必须经过另行的数据治理准入。

---

## File Structure

### Shared contracts

- Create `packages/contracts/package.json`.
- Create `packages/contracts/tsconfig.json`.
- Create `packages/contracts/src/index.ts`.
- Create `packages/contracts/src/auth.ts`.
- Create `packages/contracts/src/entities.ts`.
- Create `packages/contracts/src/commands.ts`.
- Create `packages/contracts/src/events.ts`.
- Create `packages/contracts/src/errors.ts`.
- Create `packages/contracts/src/contracts.test.ts`.

### Platform API foundation

- Create `platform-api/package.json`, `package-lock.json`, `tsconfig.json`, `.env.example`, `compose.yaml`.
- Create `platform-api/src/index.ts`, `server.ts`, `config.ts`, `logging.ts`.
- Create `platform-api/src/db/pool.ts`, `migrate.ts`, `transaction.ts`.
- Create `platform-api/src/db/migrations/001_platform.sql`.
- Create `platform-api/src/db/testDatabase.ts`.
- Create `platform-api/src/http/authMiddleware.ts`, `idempotencyMiddleware.ts`, `errorHandler.ts`.
- Create `platform-api/src/repositories/` with one repository per aggregate.

### Platform modules

- Create `platform-api/src/modules/auth/`.
- Create `platform-api/src/modules/classes/`.
- Create `platform-api/src/modules/tasks/`.
- Create `platform-api/src/modules/uploads/`.
- Create `platform-api/src/modules/grading/`.
- Create `platform-api/src/modules/results/`.
- Create `platform-api/src/modules/review/`.
- Create `platform-api/src/modules/annotations/`.
- Create `platform-api/src/modules/exports/`.
- Create `platform-api/src/modules/settings/`.
- Create `platform-api/src/modules/sync/`.

### Website migration and missing teacher capabilities

- Create `app/src/services/platform/platformClient.ts`, `types.ts`, `fakePlatformClient.ts` and tests.
- Create `app/src/context/PlatformStateProvider.tsx` and tests.
- Modify `app/src/App.tsx` and `app/src/layout/AppLayout.tsx`.
- Modify current task/upload/progress/result/class-review pages to use server commands.
- Create `app/src/pages/LoginPage.tsx` and test.
- Create `app/src/pages/ClassesPage.tsx` and test.
- Create `app/src/pages/ClassDetailPage.tsx` and test.
- Create `app/src/pages/ExportsPage.tsx` and test.
- Create `app/src/pages/SettingsPage.tsx` and test.
- Modify `app/src/components/OriginalPaperWorkspace.tsx` and test for persisted annotations.

---

### Task 1: Create portable shared contracts and the Platform API skeleton

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/auth.ts`
- Create: `packages/contracts/src/entities.ts`
- Create: `packages/contracts/src/commands.ts`
- Create: `packages/contracts/src/events.ts`
- Create: `packages/contracts/src/errors.ts`
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
- Produces: `@writewise/contracts` as a source TypeScript package.
- Produces: `createPlatformServer(options): Express` and `GET /health`.
- Produces: DTOs with `id`, `version`, `createdAt`, `updatedAt`.

- [ ] **Step 1: Write failing contract and health tests**

```ts
const essay: EssayDto = {
  id: 'essay-1', taskId: 'task-1', essayNumber: '作文 1', status: 'queued',
  version: 1, transcript: '', transcriptSource: null, recognitionWarnings: [],
  printedTextExcluded: null, pageCount: 2, currentResultId: null,
  createdAt: now, updatedAt: now,
}
expect(essay.status).toBe('queued')
```

```ts
await request(createPlatformServer(testOptions)).get('/health').expect(200, {
  ok: true,
  service: 'platform-api',
})
```

- [ ] **Step 2: Run tests and verify RED**

Run from `packages/contracts`, then `platform-api`:

```powershell
npm.cmd test
npm.cmd test
```

Expected: FAIL because both packages are absent.

- [ ] **Step 3: Define exact portable entity unions**

```ts
export type EssayStatus =
  | 'uploaded' | 'queued' | 'grading' | 'review_ready'
  | 'completed' | 'failed' | 'manual'

export interface VersionedEntity {
  id: string
  version: number
  createdAt: string
  updatedAt: string
}

export interface ApiError {
  code: 'invalid_request' | 'unauthorized' | 'forbidden' | 'not_found'
    | 'version_conflict' | 'idempotency_conflict' | 'upload_invalid'
    | 'wechat_unlinked' | 'grading_failed' | 'export_failed' | 'internal_error'
  message: string
  retryable: boolean
  latest?: { id: string; version: number; updatedAt: string }
}
```

Define `TeacherDto`, `ClassDto`, `StudentDto`, `TaskDto`, `EssayDto`, `EssayPageDto`, `GradingResultDto`, `ClassReviewMaterialDto`, `AnnotationDto`, `ExportJobDto`, `TeacherSettingsDto` and command inputs in separate source files. Use JSON-safe values only; never expose storage credentials or Provider payloads.

- [ ] **Step 4: Scaffold Platform API with explicit configuration**

Require `DATABASE_URL`, `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, `GRADING_GATEWAY_BASE_URL`, `GRADING_GATEWAY_SERVICE_TOKEN`, `SESSION_SECRET`, `TEACHER_REGISTRATION_INVITE_HASH`, `WECHAT_APP_ID`, `WECHAT_APP_SECRET`, `WEB_ORIGIN`. Fail startup with variable names only, never values.

- [ ] **Step 5: Add safe structured logging**

Log `requestId`, `teacherId`, route, status code, duration, entity IDs and stable error code. Redact request bodies and the headers `authorization`, `cookie`, `x-service-token` and `x-wechat-code`.

- [ ] **Step 6: Run tests and typecheck**

```powershell
npm.cmd test
npm.cmd run typecheck
```

Expected: PASS in both new packages.

- [ ] **Step 7: Commit Task 1**

```powershell
git add packages/contracts platform-api
git commit -m "feat: scaffold shared platform API contracts"
```

### Task 2: Add PostgreSQL migrations, aggregate repositories and change feed

**Files:**
- Create: `platform-api/compose.yaml`
- Create: `platform-api/src/db/pool.ts`
- Create: `platform-api/src/db/migrate.ts`
- Create: `platform-api/src/db/transaction.ts`
- Create: `platform-api/src/db/migrations/001_platform.sql`
- Create: `platform-api/src/db/testDatabase.ts`
- Create: `platform-api/src/repositories/teacherRepository.ts`
- Create: `platform-api/src/repositories/classRepository.ts`
- Create: `platform-api/src/repositories/taskRepository.ts`
- Create: `platform-api/src/repositories/essayRepository.ts`
- Create: `platform-api/src/repositories/resultRepository.ts`
- Create: `platform-api/src/repositories/repository.test.ts`

**Interfaces:**
- Produces: `withTransaction<T>(pool, work): Promise<T>`.
- Produces: repository methods that require `teacherId` on every read and write.
- Produces: monotonically increasing `change_events.seq`.

- [ ] **Step 1: Write failing repository isolation and version tests**

```ts
await repositories.tasks.insert(teacherA, taskInput)
expect(await repositories.tasks.findById(teacherB, taskInput.id)).toBeNull()

const updated = await repositories.essays.updateTranscript({
  teacherId: teacherA,
  essayId: essay.id,
  expectedVersion: 1,
  transcript: 'Teacher-confirmed text',
})
expect(updated.version).toBe(2)
await expect(repositories.essays.updateTranscript({
  teacherId: teacherA,
  essayId: essay.id,
  expectedVersion: 1,
  transcript: 'Stale write',
})).rejects.toMatchObject({ code: 'version_conflict' })
```

- [ ] **Step 2: Run repository tests and verify RED**

```powershell
npm.cmd run db:test:up
npm.cmd run db:migrate:test
npm.cmd test -- src/repositories/repository.test.ts
```

Expected: FAIL because schema and repositories are absent.

- [ ] **Step 3: Create the exact database aggregates**

The initial migration creates:

```sql
create table teachers (id uuid primary key, display_name text not null, version integer not null default 1, created_at timestamptz not null, updated_at timestamptz not null);
create table teacher_identities (teacher_id uuid not null references teachers(id), provider text not null, provider_subject text not null, password_hash text, primary key (provider, provider_subject));
create table sessions (id_hash text primary key, teacher_id uuid not null references teachers(id), expires_at timestamptz not null, created_at timestamptz not null);
create table classes (id uuid primary key, teacher_id uuid not null references teachers(id), name text not null, version integer not null, created_at timestamptz not null, updated_at timestamptz not null);
create table students (id uuid primary key, teacher_id uuid not null references teachers(id), class_id uuid not null references classes(id), display_name text not null, student_number text, version integer not null, created_at timestamptz not null, updated_at timestamptz not null);
create table upload_batches (id uuid primary key, teacher_id uuid not null references teachers(id), kind text not null, task_id uuid, status text not null, full_score integer, rubric_payload jsonb, submitted_at timestamptz, version integer not null, created_at timestamptz not null, updated_at timestamptz not null);
create table uploaded_pages (id uuid primary key, teacher_id uuid not null references teachers(id), batch_id uuid not null references upload_batches(id), client_page_id text not null, object_key text not null, mime_type text not null, byte_size integer not null, checksum_sha256 text not null, created_at timestamptz not null, unique (batch_id, client_page_id));
create table tasks (id uuid primary key, teacher_id uuid not null references teachers(id), class_id uuid references classes(id), material_batch_id uuid not null references upload_batches(id), name text not null, full_score integer not null, status text not null, material_context jsonb not null, confirmed_rubric jsonb not null, version integer not null, created_at timestamptz not null, updated_at timestamptz not null);
create table essays (id uuid primary key, teacher_id uuid not null references teachers(id), task_id uuid not null references tasks(id), student_id uuid references students(id), essay_number text not null, status text not null, transcript text not null default '', transcript_source text, recognition_warnings jsonb not null default '[]', printed_text_excluded boolean, current_result_id uuid, version integer not null, created_at timestamptz not null, updated_at timestamptz not null);
create table essay_pages (id uuid primary key, teacher_id uuid not null references teachers(id), essay_id uuid not null references essays(id), page_number integer not null, object_key text not null, mime_type text not null, byte_size integer not null, checksum_sha256 text not null, version integer not null, created_at timestamptz not null, updated_at timestamptz not null, unique (essay_id, page_number));
create table grading_jobs (id uuid primary key, teacher_id uuid not null references teachers(id), essay_id uuid not null references essays(id), request_id text not null unique, status text not null, attempt_kind text not null, lease_until timestamptz, safe_error_code text, safe_error_message text, created_at timestamptz not null, started_at timestamptz, completed_at timestamptz);
create table grading_results (id uuid primary key, teacher_id uuid not null references teachers(id), essay_id uuid not null references essays(id), result_version integer not null, payload jsonb not null, source_result_id uuid, created_at timestamptz not null, unique (essay_id, result_version));
create table teacher_result_overrides (id uuid primary key, teacher_id uuid not null references teachers(id), result_id uuid not null references grading_results(id), base_result_version integer not null, patch jsonb not null, version integer not null, created_at timestamptz not null, updated_at timestamptz not null);
create table class_review_materials (id uuid primary key, teacher_id uuid not null references teachers(id), task_id uuid not null references tasks(id), essay_id uuid not null references essays(id), payload jsonb not null, version integer not null, created_at timestamptz not null, updated_at timestamptz not null);
create table annotations (id uuid primary key, teacher_id uuid not null references teachers(id), essay_page_id uuid not null references essay_pages(id), kind text not null, geometry jsonb not null, content text not null, color text not null, version integer not null, created_at timestamptz not null, updated_at timestamptz not null);
create table export_jobs (id uuid primary key, teacher_id uuid not null references teachers(id), task_id uuid references tasks(id), essay_id uuid references essays(id), format text not null, status text not null, object_key text, safe_error_code text, version integer not null, created_at timestamptz not null, updated_at timestamptz not null);
create table teacher_settings (teacher_id uuid primary key references teachers(id), payload jsonb not null, version integer not null, created_at timestamptz not null, updated_at timestamptz not null);
create table idempotency_records (teacher_id uuid not null references teachers(id), scope text not null, key text not null, request_hash text not null, response_status integer not null, response_body jsonb not null, created_at timestamptz not null, primary key (teacher_id, scope, key));
create table change_events (seq bigserial primary key, teacher_id uuid not null references teachers(id), entity_type text not null, entity_id uuid not null, entity_version integer not null, occurred_at timestamptz not null);
alter table upload_batches add constraint upload_batches_task_fk foreign key (task_id) references tasks(id);
alter table essays add constraint essays_current_result_fk foreign key (current_result_id) references grading_results(id);
```

Add indexes on every `(teacher_id, updated_at)`, uploaded-page batch, task/essay foreign key, job status and change-feed teacher/sequence pair. Add checks for positive versions, page numbers, full score, `upload_batches.kind in ('material', 'essay')` and all known status strings.

- [ ] **Step 4: Implement repository optimistic writes**

Every update uses `where id = $id and teacher_id = $teacherId and version = $expectedVersion`, increments version and inserts one change event in the same transaction. Zero updated rows triggers a scoped re-read and returns `not_found` or `version_conflict`.

- [ ] **Step 5: Run migration, repository tests and typecheck**

```powershell
npm.cmd run db:reset:test
npm.cmd test -- src/repositories/repository.test.ts
npm.cmd run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```powershell
git add platform-api/compose.yaml platform-api/src/db platform-api/src/repositories platform-api/package.json platform-api/package-lock.json
git commit -m "feat: persist platform aggregates in Postgres"
```

### Task 3: Add teacher authentication and request idempotency

**Files:**
- Create: `platform-api/src/modules/auth/authService.ts`
- Create: `platform-api/src/modules/auth/wechatCodeExchange.ts`
- Create: `platform-api/src/modules/auth/authRoutes.ts`
- Create: `platform-api/src/modules/auth/authRoutes.test.ts`
- Create: `platform-api/src/http/authMiddleware.ts`
- Create: `platform-api/src/http/idempotencyMiddleware.ts`
- Create: `platform-api/src/http/idempotencyMiddleware.test.ts`
- Create: `platform-api/src/http/errorHandler.ts`
- Modify: `platform-api/src/server.ts`

**Interfaces:**
- Produces: `POST /auth/web/register`, `POST /auth/web/login`, `POST /auth/wechat/login`, `POST /auth/wechat/link`, `POST /auth/logout`, `GET /me`.
- Produces: opaque bearer sessions stored as SHA-256 hashes.
- Produces: `withIdempotency(scope, handler)` for mutation routes.

- [ ] **Step 1: Write failing authentication tests**

Cover invitation-based web registration, valid web password, invalid password, known WeChat identity, unknown WeChat identity returning `wechat_unlinked`, linking a WeChat code to an existing web account, expired token, logout, cross-teacher isolation and safe logs. The response returns an opaque token and `TeacherDto`; it never returns password hash, OpenID or session hash.

- [ ] **Step 2: Write failing idempotency tests**

```ts
const first = await postCommand('same-key', bodyA).expect(201)
const repeated = await postCommand('same-key', bodyA).expect(201)
expect(repeated.body).toEqual(first.body)
await postCommand('same-key', bodyB).expect(409)
```

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/modules/auth/authRoutes.test.ts src/http/idempotencyMiddleware.test.ts
```

Expected: FAIL because authentication and idempotency middleware are absent.

- [ ] **Step 4: Implement opaque sessions**

Generate 32 random bytes, send base64url plaintext once, store only `sha256(token)`, and expire sessions after 30 days. Hash web passwords with Argon2id. `wechatCodeExchange` accepts `{ code }`, calls the configured WeChat endpoint server-side, and maps the returned stable subject to a teacher identity; tests inject a fake exchange.

`/auth/web/register` requires an invite code whose SHA-256 hash matches `TEACHER_REGISTRATION_INVITE_HASH`. `/auth/wechat/link` accepts `{ code, phone, password }`, validates the existing web identity, then adds the WeChat identity to the same teacher in one transaction. An unknown code sent to `/auth/wechat/login` returns `wechat_unlinked` and never creates a second teacher silently.

- [ ] **Step 5: Implement request-hash idempotency**

Canonicalize method, route params and parsed JSON body; hash with SHA-256. For the same teacher/scope/key, return the stored response only when hashes match. Never cache 401, 403, 409 or 5xx responses.

- [ ] **Step 6: Run focused and full API checks**

```powershell
npm.cmd test -- src/modules/auth/authRoutes.test.ts src/http/idempotencyMiddleware.test.ts
npm.cmd test
npm.cmd run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```powershell
git add platform-api/src/modules/auth platform-api/src/http platform-api/src/server.ts platform-api/package.json platform-api/package-lock.json
git commit -m "feat: authenticate teachers and enforce idempotency"
```

### Task 4: Implement class, student, task and settings APIs

**Files:**
- Create: `platform-api/src/modules/classes/classRoutes.ts`
- Create: `platform-api/src/modules/classes/classRoutes.test.ts`
- Create: `platform-api/src/modules/tasks/taskRoutes.ts`
- Create: `platform-api/src/modules/tasks/taskRoutes.test.ts`
- Create: `platform-api/src/modules/settings/settingsRoutes.ts`
- Create: `platform-api/src/modules/settings/settingsRoutes.test.ts`
- Modify: `platform-api/src/server.ts`

**Interfaces:**
- Produces: CRUD `/classes`, `/classes/:classId/students`, `/tasks`, `/tasks/:taskId`.
- Produces: `GET/PATCH /settings`.
- Consumes: bearer auth, `If-Match` version and idempotency middleware.

- [ ] **Step 1: Write failing CRUD and ownership tests**

Test list/create/update/archive classes, add/update/remove students, create/update tasks with confirmed rubric, and teacher ownership on every route. Mutations require `Idempotency-Key`; updates require `If-Match: "<version>"`.

- [ ] **Step 2: Write failing settings validation tests**

Use this exact payload:

```ts
const settings: TeacherSettingsDto['grading'] = {
  strictness: 'balanced',
  feedbackDetail: 'detailed',
  ratingMode: 'score',
  enabledFeedback: ['grammar', 'logic', 'task_completion', 'expression', 'spelling'],
  exportStyle: 'teacher_report',
}
```

Reject unknown values, duplicate feedback items and disabling grammar or logic. Spelling may be disabled but remains conservative when enabled.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/modules/classes/classRoutes.test.ts src/modules/tasks/taskRoutes.test.ts src/modules/settings/settingsRoutes.test.ts
```

Expected: FAIL because routes are absent.

- [ ] **Step 4: Implement routes with stable envelopes**

List responses use `{ items, nextCursor }`; single responses use `{ data }`; create returns 201; update returns 200; archive returns 204. Task creation requires a teacher-owned `materialBatchId` in `rubric_ready`, stores the exact confirmed rubric and material context after validating dimensions total 100 and contain one `legibility` dimension, changes the batch to `attached`, and associates it with the new task in one transaction.

- [ ] **Step 5: Run tests and typecheck**

```powershell
npm.cmd test -- src/modules/classes/classRoutes.test.ts src/modules/tasks/taskRoutes.test.ts src/modules/settings/settingsRoutes.test.ts
npm.cmd run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```powershell
git add platform-api/src/modules/classes platform-api/src/modules/tasks platform-api/src/modules/settings platform-api/src/server.ts
git commit -m "feat: manage teacher classes tasks and settings"
```

### Task 5: Store images and finalize idempotent essay submissions

**Files:**
- Create: `platform-api/src/modules/uploads/objectStorage.ts`
- Create: `platform-api/src/modules/uploads/uploadRoutes.ts`
- Create: `platform-api/src/modules/uploads/submissionService.ts`
- Create: `platform-api/src/modules/uploads/uploadRoutes.test.ts`
- Modify: `platform-api/src/server.ts`

**Interfaces:**
- Produces: `POST /tasks/:taskId/upload-batches`.
- Produces: `POST /material-batches`, `POST /material-batches/:batchId/pages`, `POST /material-batches/:batchId/rubric`.
- Produces: `POST /upload-batches/:batchId/pages` multipart field `page`.
- Produces: `POST /upload-batches/:batchId/submit` with ordered essay groups.
- Produces: authenticated `GET /essay-pages/:pageId/image` returning a short-lived signed image URL.
- Consumes: S3-compatible `ObjectStorage.put/get/delete`.

- [ ] **Step 1: Write failing upload validation tests**

Cover PNG/JPEG/WebP, 8 MB maximum, duplicate checksum within a batch, wrong teacher, invalid page ID, page-order duplication, more than 10 pages per essay, material-page ordering, rubric generation idempotency, partial page failure, repeated submit key and teacher-scoped signed image access.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/modules/uploads/uploadRoutes.test.ts
```

Expected: FAIL because storage and routes are absent.

- [ ] **Step 3: Implement the storage boundary**

```ts
export interface ObjectStorage {
  put(input: { key: string; contentType: string; body: Buffer; checksumSha256: string }): Promise<void>
  get(key: string): Promise<{ body: Buffer; contentType: string }>
  delete(key: string): Promise<void>
  createDownloadUrl(key: string, expiresInSeconds: number): Promise<string>
}
```

Object keys use `teachers/{teacherId}/materials/{batchId}/{pageId}` for material batches and `teachers/{teacherId}/tasks/{taskId}/uploads/{batchId}/{pageId}` for essay batches. Never accept an object key from the client.

- [ ] **Step 4: Implement material rubric generation**

`POST /material-batches/:batchId/rubric` accepts `{ fullScore, pageIds }`, validates ordered ownership, loads the exact stored pages and calls the internal Gateway `/tasks/rubric` with the service token. The command requires `Idempotency-Key`; a failure is returned safely and never retried automatically. A successful response saves the safe draft rubric/material context, changes the batch to `rubric_ready`, and returns the draft without creating a task.

- [ ] **Step 5: Implement final essay submission transaction**

`submit` accepts `{ classId, essays: [{ clientEssayId, studentId, pageIds }] }`. Validate ownership and unique uploaded-page use, insert essays and copy controlled uploaded-page metadata into `essay_pages` with contiguous page numbers, set essays to `queued`, emit change events, and mark the batch submitted in one transaction. A repeated idempotency key returns the same essay IDs.

- [ ] **Step 6: Run tests and typecheck**

```powershell
npm.cmd test -- src/modules/uploads/uploadRoutes.test.ts
npm.cmd run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```powershell
git add platform-api/src/modules/uploads platform-api/src/server.ts platform-api/package.json platform-api/package-lock.json
git commit -m "feat: persist essay image submissions"
```

### Task 6: Add explicit, persistent grading jobs and the Gateway worker

**Files:**
- Create: `platform-api/src/modules/grading/gradingRoutes.ts`
- Create: `platform-api/src/modules/grading/gradingRoutes.test.ts`
- Create: `platform-api/src/modules/grading/gradingGatewayClient.ts`
- Create: `platform-api/src/modules/grading/gradingGatewayClient.test.ts`
- Create: `platform-api/src/modules/grading/gradingWorker.ts`
- Create: `platform-api/src/modules/grading/gradingWorker.test.ts`
- Modify: `platform-api/src/index.ts`
- Modify: `platform-api/src/server.ts`
- Modify: `grading-gateway/src/server.ts`
- Modify: `grading-gateway/src/server.test.ts`

**Interfaces:**
- Produces: `POST /essays/:essayId/grading-attempts`, `POST /essays/:essayId/retry` and `POST /tasks/:taskId/grading-batches`.
- Produces: `leaseNextJob(workerId, leaseSeconds): Promise<GradingJob | null>`.
- Consumes: internal Gateway service token and object storage pages.

- [ ] **Step 1: Write failing queue command tests**

Assert one explicit command creates one job, repeated key returns that job, another key while queued/running returns 409, retry is allowed only from `failed`, and no route invokes the Gateway synchronously. The batch command accepts unique teacher-owned essay IDs, creates one job per eligible essay in one transaction, rejects a mixed invalid selection without partial creation, and returns the ordered job IDs.

- [ ] **Step 2: Write failing worker lease tests**

Test `FOR UPDATE SKIP LOCKED`, one worker per job, configurable concurrency default 1, expired lease recovery without automatically calling the Provider, ordered page loading, confirmed transcript mode with no images, and failure isolation.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/modules/grading/gradingRoutes.test.ts src/modules/grading/gradingGatewayClient.test.ts src/modules/grading/gradingWorker.test.ts
```

Expected: FAIL because queue and worker are absent.

- [ ] **Step 4: Protect the Gateway as an internal service**

Require `X-Service-Token` on `/tasks/rubric` and `/grading/grade-images` when `GRADING_GATEWAY_SERVICE_TOKEN` is configured. Compare tokens with constant-time equality. The browser and mini program never receive this token.

- [ ] **Step 5: Implement explicit job creation and leasing**

Create `requestId = grading-${jobId}` once. Initial jobs use ordered object-storage pages; regrades use the current teacher-confirmed transcript and no pages. Gateway metadata contains task/rubric, essay ID and page bytes or confirmed transcript only; it never contains teacher, class, student, phone or student-number fields. A network/provider failure writes safe code/message, sets essay/job `failed`, and stops. It never creates another job.

- [ ] **Step 6: Persist a successful result transactionally**

Insert immutable `grading_results`, set `essays.current_result_id`, copy transcript/recognition fields to the essay, change essay to `review_ready`, finish the job and emit change events in one transaction.

- [ ] **Step 7: Run API, Gateway and type checks**

```powershell
Set-Location platform-api
npm.cmd test -- src/modules/grading
npm.cmd run typecheck
Set-Location ..\grading-gateway
npm.cmd test -- src/server.test.ts
npm.cmd run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit Task 6**

```powershell
git add platform-api/src/modules/grading platform-api/src/index.ts platform-api/src/server.ts grading-gateway/src/server.ts grading-gateway/src/server.test.ts
git commit -m "feat: run persistent explicit grading jobs"
```

### Task 7: Persist result versions, teacher decisions and class-review materials

**Files:**
- Create: `platform-api/src/modules/results/resultRoutes.ts`
- Create: `platform-api/src/modules/results/resultRoutes.test.ts`
- Create: `platform-api/src/modules/results/resultVersionService.ts`
- Create: `platform-api/src/modules/review/reviewRoutes.ts`
- Create: `platform-api/src/modules/review/reviewRoutes.test.ts`
- Modify: `platform-api/src/server.ts`

**Interfaces:**
- Produces: result read/patch, transcript revision, ambiguity override, confirm/manual commands.
- Produces: class statistics and selected teaching-material routes.
- Preserves: immutable AI result versions plus separate teacher overrides.

- [ ] **Step 1: Write failing version-history tests**

Cover `GET /essays/:id/result`, `GET /essays/:id/result-history`, `PATCH /results/:id`, `PATCH /essays/:id/transcript`, `POST /essays/:id/confirm`, `POST /essays/:id/manual`. Assert `If-Match` conflict, immutable old results, result invalidation and no implicit regrade.

- [ ] **Step 2: Write failing class-review tests**

Statistics must include only `completed` essays. Selected materials deduplicate by task/essay/source issue. Logic issues use the structured payload from Plan 1; spelling frequency includes only certain spelling issues.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/modules/results/resultRoutes.test.ts src/modules/review/reviewRoutes.test.ts
```

Expected: FAIL because routes are absent.

- [ ] **Step 4: Implement result composition**

`GET /essays/:id/result` returns the immutable AI payload merged with the latest teacher patch, plus `baseResultVersion`, `overrideVersion` and essay `version`. Score edits recompute the total server-side and enforce dimension bounds.

- [ ] **Step 5: Implement transcript and ambiguity decisions**

Transcript edit writes `transcript_source = 'teacher_confirmed'`, clears recognition warnings, sets essay `uploaded`, clears `current_result_id` and increments version. `按正确处理` removes the selected legibility deduction through a teacher override; when the text changes, it uses the same transcript invalidation path.

- [ ] **Step 6: Implement confirmation and class-review material commands**

Confirmation requires a current result and changes `review_ready` to `completed`. Class statistics and materials always check teacher ownership and task membership.

- [ ] **Step 7: Run tests and typecheck**

```powershell
npm.cmd test -- src/modules/results src/modules/review
npm.cmd run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 7**

```powershell
git add platform-api/src/modules/results platform-api/src/modules/review platform-api/src/server.ts
git commit -m "feat: version teacher grading decisions"
```

### Task 8: Persist normalized original-paper annotations

**Files:**
- Create: `platform-api/src/modules/annotations/annotationRoutes.ts`
- Create: `platform-api/src/modules/annotations/annotationRoutes.test.ts`
- Create: `packages/contracts/src/annotations.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `platform-api/src/server.ts`

**Interfaces:**
- Produces: CRUD `/essay-pages/:pageId/annotations`.
- Produces: normalized geometry independent of display size.

- [ ] **Step 1: Write failing geometry and conflict tests**

```ts
const annotation: CreateAnnotationInput = {
  kind: 'freehand',
  geometry: { points: [{ x: 0.12, y: 0.20 }, { x: 0.18, y: 0.27 }] },
  content: '',
  color: '#ef4444',
}
```

Reject coordinates outside 0–1, empty point arrays, unsupported colors, cross-teacher pages and stale versions. Cover `highlight`, `freehand` and `text` geometry.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/modules/annotations/annotationRoutes.test.ts
```

Expected: FAIL because routes and shared types are absent.

- [ ] **Step 3: Implement shared geometry unions and routes**

Use `HighlightGeometry { x, y, width, height }`, `FreehandGeometry { points }`, and `TextGeometry { x, y }`. Every write requires `Idempotency-Key`; update/delete also require `If-Match`.

- [ ] **Step 4: Run tests and typecheck in both packages**

```powershell
Set-Location packages/contracts
npm.cmd test
npm.cmd run typecheck
Set-Location ..\..\platform-api
npm.cmd test -- src/modules/annotations/annotationRoutes.test.ts
npm.cmd run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 8**

```powershell
git add packages/contracts/src platform-api/src/modules/annotations platform-api/src/server.ts
git commit -m "feat: persist original-paper annotations"
```

### Task 9: Generate cloud Word and PDF exports

**Files:**
- Create: `platform-api/src/modules/exports/exportRoutes.ts`
- Create: `platform-api/src/modules/exports/exportRoutes.test.ts`
- Create: `platform-api/src/modules/exports/exportWorker.ts`
- Create: `platform-api/src/modules/exports/exportWorker.test.ts`
- Create: `platform-api/src/modules/exports/renderEssayReport.ts`
- Create: `platform-api/src/modules/exports/renderEssayReport.test.ts`
- Create: `platform-api/assets/fonts/NotoSansSC-Regular.otf`
- Create: `platform-api/assets/fonts/OFL.txt`
- Modify: `platform-api/src/index.ts`
- Modify: `platform-api/src/server.ts`

**Interfaces:**
- Produces: `POST /exports`, `GET /exports`, `GET /exports/:id`, `GET /exports/:id/preview`, `GET /exports/:id/download`.
- Produces: Word/PDF stored in object storage.
- Consumes: completed or review-ready composed results and teacher export style.

- [ ] **Step 1: Write failing export command tests**

Cover single essay, task batch, `docx | pdf`, idempotent duplicate, unsupported status, teacher ownership, explicit failed state, structured preview and signed download only after completion.

- [ ] **Step 2: Write failing renderer tests**

Inspect generated DOCX zip entries and PDF page text metadata. Each report and `ExportPreviewDto` must contain essay label, score, dimensions, certain language issues, logic issues, legibility issues, corrected/improved text, total comment and teacher suggestion. It must not contain storage keys, session data or Provider metadata.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/modules/exports
```

Expected: FAIL because export modules are absent.

- [ ] **Step 4: Implement explicit export jobs**

Creating an export only inserts `queued`. The export worker leases jobs separately from grading, renders once, uploads to `teachers/{teacherId}/exports/{exportId}.{format}`, sets `completed`, and emits a change event. A failure sets `failed`; no automatic retry job is created.

- [ ] **Step 5: Render deterministic Word and PDF files**

Use the checked-in OFL-licensed font for Chinese PDF headings. Page headers use task name and essay label; filenames use sanitized task/essay labels and never student contact fields. Batch exports produce one ZIP containing individual reports. Build the report from one `ExportPreviewDto`; `/preview`, DOCX and PDF must consume that same DTO so visible preview and downloaded files cannot diverge.

- [ ] **Step 6: Run focused tests, typecheck and inspect generated fixtures**

```powershell
npm.cmd test -- src/modules/exports
npm.cmd run typecheck
```

Expected: PASS; test output files are written only under the ignored temporary test directory.

- [ ] **Step 7: Commit Task 9**

```powershell
git add platform-api/src/modules/exports platform-api/assets/fonts platform-api/src/index.ts platform-api/src/server.ts platform-api/package.json platform-api/package-lock.json
git commit -m "feat: generate cloud grading exports"
```

### Task 10: Add sync recovery, WebSocket notifications and the website API client

**Files:**
- Create: `platform-api/src/modules/sync/syncRoutes.ts`
- Create: `platform-api/src/modules/sync/syncSocket.ts`
- Create: `platform-api/src/modules/sync/sync.test.ts`
- Modify: `platform-api/src/index.ts`
- Create: `app/src/services/platform/types.ts`
- Create: `app/src/services/platform/platformClient.ts`
- Create: `app/src/services/platform/platformClient.test.ts`
- Create: `app/src/services/platform/fakePlatformClient.ts`
- Create: `app/src/services/platform/syncClient.ts`
- Create: `app/src/services/platform/syncClient.test.ts`

**Interfaces:**
- Produces: `GET /sync?after=<seq>` and authenticated `/events` WebSocket.
- Produces: `PlatformClient` used unchanged by website and later Taro client adapter.
- Produces: event-driven invalidation with cursor recovery.

- [ ] **Step 1: Write failing sync tests**

Assert events are teacher-scoped, ordered by sequence, reconnect catches missed events, invalid tokens are rejected, and event payload contains only entity type/id/version/sequence.

- [ ] **Step 2: Write failing browser client tests**

Test bearer injection, idempotency key generation supplied by caller, `If-Match`, safe 409 projection, multipart upload, binary download URL, reconnect and `GET /sync` recovery.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
Set-Location platform-api
npm.cmd test -- src/modules/sync/sync.test.ts
Set-Location ..\app
npm.cmd test -- src/services/platform
```

Expected: FAIL because sync and client modules are absent.

- [ ] **Step 4: Implement the change feed and notification socket**

After every committed change event, publish its safe envelope to connected sessions for that teacher. Socket messages are hints; clients advance the durable cursor only from `GET /sync`. Keep at most 500 events per recovery response and return `nextCursor`.

- [ ] **Step 5: Implement the website PlatformClient**

Expose typed methods grouped as `auth`, `classes`, `tasks`, `uploads`, `essays`, `results`, `review`, `annotations`, `exports`, `settings`, `sync`. The fake client implements the same interface with deterministic in-memory data for isolated page tests.

- [ ] **Step 6: Run tests and typechecks**

Run both Task 10 test commands plus `npm.cmd run typecheck` in each package. Expected: PASS.

- [ ] **Step 7: Commit Task 10**

```powershell
git add platform-api/src/modules/sync platform-api/src/index.ts app/src/services/platform
git commit -m "feat: sync platform changes to web clients"
```

### Task 11: Migrate the website to server state and complete teacher management pages

**Files:**
- Create: `app/src/context/PlatformStateProvider.tsx`
- Create: `app/src/context/PlatformStateProvider.test.tsx`
- Modify: `app/src/App.tsx`
- Modify: `app/src/layout/AppLayout.tsx`
- Modify: `app/src/context/useAppState.ts`
- Modify: existing page tests and pages under `app/src/pages/`
- Create: `app/src/pages/LoginPage.tsx`
- Create: `app/src/pages/LoginPage.test.tsx`
- Create: `app/src/pages/ClassesPage.tsx`
- Create: `app/src/pages/ClassesPage.test.tsx`
- Create: `app/src/pages/ClassDetailPage.tsx`
- Create: `app/src/pages/ClassDetailPage.test.tsx`
- Create: `app/src/pages/ExportsPage.tsx`
- Create: `app/src/pages/ExportsPage.test.tsx`
- Create: `app/src/services/platform/exportFileService.ts`
- Create: `app/src/services/platform/exportFileService.test.ts`
- Create: `app/src/pages/SettingsPage.tsx`
- Create: `app/src/pages/SettingsPage.test.tsx`
- Modify: `app/src/components/OriginalPaperWorkspace.tsx`
- Create: `app/src/components/OriginalPaperWorkspace.test.tsx`

**Interfaces:**
- Consumes: `PlatformClient`, sync events and versioned DTOs from Task 10.
- Produces: complete website teacher workflow backed by durable data.
- Preserves: existing route paths and layouts; only adds `/login`, `/classes`, `/classes/:classId`, `/exports`, `/settings`.

- [ ] **Step 1: Write failing provider hydration and conflict tests**

Test authenticated boot, task/essay hydration, loading/error states, sync-event refresh, 409 conflict banner, no silent overwrite and logout. Inject `fakePlatformClient` in tests.

- [ ] **Step 2: Replace page tests with async server commands**

For existing pages, assert create/upload/single-grade/batch-grade/retry/edit/confirm/material actions call the exact typed API method with idempotency key and version. Keep current headings, workflow navigation and primary layout selectors; add checkboxes and a compact batch action bar inside the existing progress card rather than redesigning the page.

- [ ] **Step 3: Write failing new-page tests**

Cover invitation-based web registration, web login, class CRUD, student roster, archive, export creation/status/structured preview/download/share, settings edits and validation. `exportFileService` fetches the completed file as a Blob, uses `navigator.share({ files })` when file sharing is supported, and presents a clear download fallback otherwise. Sidebar additions use the current white aside and `NavLink` styling rather than a new navigation design.

- [ ] **Step 4: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/context/PlatformStateProvider.test.tsx src/pages/LoginPage.test.tsx src/pages/ClassesPage.test.tsx src/pages/ClassDetailPage.test.tsx src/pages/ExportsPage.test.tsx src/pages/SettingsPage.test.tsx src/services/platform/exportFileService.test.ts
```

Expected: FAIL because provider and pages are absent.

- [ ] **Step 5: Implement authenticated routing and server-backed state**

Use a route guard that redirects unauthenticated users to `/login`. The login page offers `登录` and `邀请码注册`; registration sends phone, password, display name and invite code only to `/auth/web/register`. `PlatformStateProvider` keeps normalized entity maps, applies optimistic UI only for reversible non-billable edits, and refreshes affected entities after change events. Grading and export commands wait for the server response and never simulate success.

- [ ] **Step 6: Migrate existing pages without re-layout**

Keep current components and CSS classes. Replace direct array mutation with async provider actions; add compact saving/error feedback in existing action areas. Use object-storage-backed image URLs supplied by the API.

- [ ] **Step 7: Implement persisted web annotations**

Overlay an SVG on the existing original-paper image stage. Convert pointer coordinates to 0–1 before API writes; render highlights, freehand paths and text notes from normalized geometry. Keep existing left/right/bottom annotation regions and page navigation.

- [ ] **Step 8: Run all website checks**

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Expected: all commands exit 0.

- [ ] **Step 9: Commit Task 11**

```powershell
git add app/src app/package.json app/package-lock.json
git commit -m "feat: connect teacher website to shared platform"
```

### Task 12: Verify the complete cloud-backed website workflow

**Files:**
- Create: `platform-api/src/e2e/teacherWorkflow.test.ts`
- Modify: `README.md`
- Modify: `docs/current_development_status.md`
- Create: `docs/platform-api-operations.md`

**Interfaces:**
- Consumes: all prior tasks in this plan plus the Grading Gateway.
- Produces: a verified backend contract ready for the full-feature mini program.

- [ ] **Step 1: Add a synthetic end-to-end API test**

The test logs in a teacher, creates class/student/task, uploads two pages, submits one essay, queues grading with a fake Gateway, receives review-ready result, edits/versions a score, adds an annotation and class material, confirms, exports PDF and verifies sync events in order.

- [ ] **Step 2: Run the clean backend matrix**

```powershell
Set-Location platform-api
npm.cmd run db:reset:test
npm.cmd test
npm.cmd run typecheck
Set-Location ..\grading-gateway
npm.cmd test
npm.cmd run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 3: Run the clean website matrix**

```powershell
Set-Location ..\app
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Expected: all commands exit 0.

- [ ] **Step 4: Run local infrastructure and browser acceptance**

Start PostgreSQL/Object Storage from `platform-api/compose.yaml`, Platform API, Grading Gateway and website. Complete the same workflow through the browser. Refresh during upload, after review edits and after export; state must survive. Open a second browser session for the same teacher and verify WebSocket-driven refresh plus a deliberate stale-version 409.

- [ ] **Step 5: Verify privacy, idempotency and billable-call boundaries**

Inspect sanitized logs and database metadata. Confirm no body/image/transcript/secret logging, one stored image per page, one grading job per command key, no automatic retry after a fake failure, immutable old result versions and one export object per export job.

- [ ] **Step 6: Update operations and status documentation**

Document environment variable names, migration/start/backup commands, service ports, health checks, worker concurrency, explicit retry behavior and object-storage lifecycle. Do not include credential values or real student data.

- [ ] **Step 7: Run final scope checks and commit Task 12**

```powershell
git diff --check
git status --short
git add platform-api/src/e2e README.md docs/current_development_status.md docs/platform-api-operations.md
git commit -m "test: verify shared teacher platform workflow"
```

---

## Plan Self-Review

- Spec coverage: 账号、班级、学生、任务、图片、队列、结果版本、跨端冲突、讲评素材、批注、导出、设置和同步均映射到独立可验收任务。
- Placeholder scan: 数据表、DTO、路由、版本规则、幂等行为、测试命令和预期结果均已明确。
- Type consistency: `@writewise/contracts` 是网站、Platform API 和后续小程序的唯一网络 DTO 来源；Essay 状态与前两阶段完全一致。
- Architecture boundary: Platform API 持久化业务，Grading Gateway 只处理模型请求；客户端永远不接触 Gateway service token。
- Cost control: 只有显式 grading-attempt/retry 命令创建任务，Worker 失败后不自动产生新任务。
- Layout constraint: 网站复用已有页面和组件，只新增账号、班级、导出、设置所需路由及侧边栏入口。
- Handoff: 本计划完成后执行 `2026-08-15-full-feature-wechat-mini-program.md`；小程序不得在 Platform API 完成前复制内存状态逻辑。
