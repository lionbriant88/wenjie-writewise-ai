# 教师云端 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 教师在现有网站完成创建任务、上传作文、后台批改、修改确认，刷新或重新登录后恢复原图及已保存结果。

**Architecture:** 复用现有教师页面，新增独立云端状态适配，不把演示数据带入生产。Supabase 私有 Storage 保存图片，私有 PostgreSQL schema 保存业务、版本、作业和全局执行占位；Vercel Queues 只负责唤醒，Gateway 原有 v2 校验与模型执行服务复用。

**Tech Stack:** Node 24、TypeScript、React 19、Express 5（平台）、Express 4（Gateway）、PostgreSQL/PGlite、Supabase Storage、Vercel Queues、Vitest/Testing Library。

**Spec:** `docs/superpowers/specs/2026-09-27-teacher-cloud-mvp-design.md`（用户已确认）。

## Global Constraints

- 实际工作树 `.worktrees/codex-teacher-pilot-accounts`，分支 `codex/teacher-pilot-accounts`；沿用已有隔离工作树，不改根目录旧 main。
- 固定官方 `deepseek-flash`，不经 OpenRouter；不引入 OCR、生产 mock 或自动模型回退。
- 保留 `multimodal-grading-request-v2`、`grading-result-v2`、Gateway `POST /grading/grade-images`；单篇一次多模态请求，确认文本重批零图片。
- 所有 Provider 阶段共享数据库硬上限 **1**。结果未知保留占位；不按 TTL 解锁，不盲目重试。
- 30 教师 + 1 独立账号管理员；现有不可改密、会话、CSRF 和教师隔离不退化；管理员不自动获得作文访问权。
- 创建页单页单路径，材料选填、默认维度 40/40/15/5，评分标准可用即可创建；材料失败不阻断合法人工评分标准。
- 原图私有，不新增未经验证的有损压缩；复用现有图片/材料限制，错误时保持未提交状态。
- 测试数据保留至教师主动删除；未关联临时上传满 24 小时进入清理；未知执行保留最小墓碑。
- 使用现有新加坡 Supabase 和 Vercel 项目，不升级套餐。仅合成/自编材料；不把技术验收写成教学质量或 30×50 吞吐验收。
- 新凭据仅 ignored 本地配置与指定 Vercel Secret；不回显、不进入源码/日志/前端。云端操作在本地完整验证后进行。

## Review Focus

1. 另一教师的 ID 混入本人的图片、任务或作业命令：统一拒绝且不连出存储/模型（任务 1、2、6）。
2. 上传已成功但提交响应丢失，或旧上传凭证被重放：可恢复同一记录，篡改原图不得进入模型（任务 2、7）。
3. 调用模型前后、写结果前后和确认队列消息时崩溃：不丢成功结果、不重复收费，未知保持占位（任务 4、5）。
4. 两标签页修改与迟到批改交错：冲突明确，旧结果不覆盖新正文或教师修订（任务 4、6、8）。
5. 上传或轮询期间退出、换号、会话失效：清空旧账号数据，迟到回调不能重新显示（任务 6、7、8）。

---

## 文件分工与接口约定

新增 `shared/pilotContracts.ts` 只包含 JSON DTO 和类型；不得依赖 React、File、Node 运行时或 Secret。v2 类型通过 `import type` 引用 Gateway 现有纯类型。平台输入校验位于 `platform-api/src/pilot/validation.ts`，浏览器投影位于 `app/src/pilot/projection.ts`。

后端按责任分为 `tasks.ts`（草稿/确认）、`uploads.ts` + `storage.ts`（上传与对象存储）、`essays.ts`（作文/教师修订）、`jobs.ts` + `admission.ts`（持久状态）、`worker.ts` + `queue.ts`（执行/投递）、`cleanup.ts`（删除）、`routes.ts`（HTTP）和 `runtime.ts`（装配）。共享依赖沿用 `Database/Queryable`，不重写账号库。

公共类型统一：`Id = string`（服务端 UUID）；`Revision = number`（正安全整数）；`Command<T> = {commandId: Id; expectedRevision?: Revision; value: T}`；`Page<T> = {items:T[]; nextCursor:string|null}`，列表 limit 为 1–50、默认 50。所有更新要求 expectedRevision，创建不要求。commandId 由浏览器产生并在传输重发时复用；同 owner/操作/key 不同 payload 返回 409。

- `TaskDraftInput`：taskName、fullScore、writingRequirement、dimensions（现有 `GeneratedRubricDimensionV1[]`）、source、materialContext、materialProcessingStatus、materialRefs。草稿允许业务字段未填完；确认必须通过现有评分标准规则。
- `MaterialRef`：`{kind:'image';uploadId:Id}` 或 `{kind:'text';id:Id;displayName:string;text:string;warnings:string[]}`；只允许现有 DOCX 警告枚举。上传外部 URL、owner、服务器状态等未知字段拒绝。
- `TaskDto`：id、revision、rubricRevision、state（draft/confirmed）、draft、confirmedPackage、服务端 counts、createdAt、updatedAt。
- `PageDto`：id、uploadId、pageNumber、label、mimeType、size；不含对象路径、凭证、永久地址或 File。
- `EssayDto`：id、taskId、revision、sourceRevision、studentName、essayNumber、pages、confirmedTranscript、currentJob、currentResult、teacherReviewed、manualReviewRequired。currentResult 为不可变 v2 AI 结果及当前教师修订的投影，含 sourceRevision/rubricRevision/resultRevision；复用 Gateway `AiGradingResultV1` 类型并限定 resultVersion 为 `grading-result-v2`。
- `TeacherReviewInput`：dimensionScores（dimensionId/score）、overallComment、teacherSuggestion、confirm；服务端校验维度集合和各维上限，派生总分。其他 AI 字段不可由浏览器提交为可信结果。
- `JobDto`：id、kind（grade/material_context/rubric）、state（queued/running/succeeded/partial/failed/result_unknown/cancelled）、安全错误码、retryable、revision、retryAt、createdAt、updatedAt；终态成功通过种类对应的已校验结果返回，不含租约、原始 Provider 响应或用量日志。

`PilotCapabilities` 含 teacherMvp、aiAvailable、queueState（ready/paused/waiting），不暴露其他教师身份。内部 `maintenance_jobs` 单独存放不含正文的全站恢复游标和随机 ID，不属于教师 JobDto；只有私有消费者可处理。

任务 1 定义上述 DTO 的精确字段和运行时投影测试，此后不得在前端、队列和数据库各写一套同义合同。各任务新增同名 `.test.ts`，组件测试使用 `.test.tsx`。下面命令从工作树根目录执行。

### Task 1: 教师业务 schema、草稿与版本保存

**Files:** 新增 `shared/pilotContracts.ts`、`platform-api/src/pilot/{validation,commands,tasks}.ts`、`platform-api/src/migrations/002_pilot_grading.sql`、`platform-api/scripts/pilotMigrate.ts`；修改 `platform-api/src/privileges.ts`、`platform-api/package.json`。测试新增 `platform-api/src/pilot/{validation,tasks,privileges}.test.ts`。

**Interfaces:** `PilotTaskRepository(db:Database)` 提供 `list(ownerId,query):Promise<Page<TaskDto>>`、`get(ownerId,taskId):Promise<TaskDto>`、`createDraft(ownerId,command:Command<TaskDraftInput>):Promise<TaskDto>`、`saveDraft(ownerId,taskId,command):Promise<TaskDto>`、`confirm(ownerId,taskId,command):Promise<TaskDto>`。`runCommand<T>(tx,ownerId,operation,command,payloadHash,apply):Promise<T>` 原子记命令回执；重放必须先校验归属。

- [x] **1. 写失败测试。** `isolatesOwnersAndRejectsCompositeForeignKeys`：A 不能取得 B 草稿；复合关联错误触发约束。`replaysCommittedCommandAfterLostResponse`：相同命令只建一个任务，异 payload 409。`confirmsOnlyValidRubric`：40/40/15/5 通过、缺卷面/权重错误/空要求失败；材料失败但合法要求可通过。`doesNotBroadenAuthPrivileges`：密码仍不可写。
- [x] **2. 验证红灯。** `npm.cmd --prefix platform-api test -- src/pilot/validation.test.ts src/pilot/tasks.test.ts src/pilot/privileges.test.ts`，新接口缺失导致失败。
- [x] **3. 实施 schema 和接口。** 新建 `pilot_grading`：tasks、task_revisions、essays、essay_revisions、uploads、essay_pages、results、teacher_reviews、jobs、executions、outbox、provider_gate、command_receipts、cleanup_items、maintenance_jobs。教师实体含 owner_id，采用带 owner/版本的复合外键；gate 和 maintenance 为内部全站记录。数据库约束修订、页面顺序、逻辑作业身份和执行令牌。撤销 PUBLIC/anon/authenticated 权限，不暴露 Data API；运行角色仅加业务必需权限。确认生成固定 v2 task package，递增 rubricRevision；草稿保存不调用 AI。
- [x] **4. 验证绿灯和可重放迁移。** 重跑步骤 2、`npm.cmd --prefix platform-api run typecheck`。PGlite 两次迁移后结构一致，现有账号 fixture 不变；新增 `db:migrate:pilot` 明确使用管理连接，生产运行时不执行它。
- [x] **5. 提交。** 仅暂存本任务文件，提交 `feat: persist owned pilot tasks and revisions`。

### Task 2: 私有上传、恢复和原图校验

**Files:** 新增 `platform-api/src/pilot/{storage,uploads}.ts`、对应测试；修改 `shared/pilotContracts.ts`、`platform-api/package.json` 及 lockfile。

**Interfaces:** `PrivateStorage` 提供 `signUpload(path):Promise<{url:string;expiresAt:string}>`、`read(path,signal):Promise<{bytes:Uint8Array;contentType:string}>`、`signRead(path,ttlSeconds):Promise<string>`、`remove(paths:string[]):Promise<void>`。`PilotUploadService(db,storage)` 提供 `reserve(ownerId,taskId,command:Command<UploadInput>):Promise<UploadTicket>`、`complete(ownerId,uploadId,command):Promise<PageDto>`、`list(ownerId,taskId,query):Promise<Page<UploadDto>>`、`readUrl(ownerId,uploadId):Promise<{url:string;expiresAt:string}>`、`loadVerified(ownerId,uploadId,signal):Promise<GatewayImageInput>`。UploadInput 只含 purpose（material/essay）、mimeType、size、label；ticket 含 uploadId 与上传签名，不含服务凭据。

- [x] **1. 写失败测试。** `rejectsForeignUploadBeforeStorageAccess`；`reusesUploadRegistrationAfterLostResponse`；`rejectsMimeSizeAndDigestMismatch`；`doesNotGradeIncompleteUpload`；`rechecksBytesAfterSignedUploadReplay`。模拟签名 URL 仍有效时替换字节，worker 加载必须拒绝且 Provider 调用数为 0。
- [x] **2. 验证红灯。** `npm.cmd --prefix platform-api test -- src/pilot/uploads.test.ts src/pilot/storage.test.ts`。
- [x] **3. 实施接口。** 使用官方 `@supabase/supabase-js` 签名；固定私有 bucket 与随机路径，禁止 upsert/浏览器路径。字节直传 Storage；服务端只从固定项目存储地址流式限量读取，校验图片签名/尺寸、现有 MIME/大小限制和 SHA-256，记录不可变摘要，worker 再验摘要。原图读取需活跃归属，签名 60 秒，不持久化或记录签名。保留上传登记供刷新恢复；过期且未完成可重新预留，不假报成功。
- [x] **4. 验证绿灯。** 重跑步骤 2 和平台 typecheck；用 fake storage 确认流式读取在超过允许字节数时停止，跨租户请求不调用 SDK。
- [x] **5. 提交。** `feat: add private verified pilot uploads`。

### Task 3: 提取 Gateway 单次执行服务

**Files:** 新增 `grading-gateway/src/multimodal/executeOperation.ts`、对应测试；修改 `grading-gateway/src/server.ts`、`platform-api/src/grading.ts` 和既有相关测试。

**Interfaces:** `executeMultimodalOperation(provider:MultimodalProvider,operation:MultimodalOperation,services:OperationServices):Promise<OperationResult>`。operation 为 grade/输入 `GradeEssayProviderInput`、material_context/输入 `GenerateMaterialContextProviderInput`、rubric/输入 `GenerateRubricProviderInput` 的判别联合。result 为同种类严格归一化 value + 现有安全 attempts。OperationServices 含 now、既有 telemetry/diagnostic hooks；不包含 HTTP、数据库、队列或幂等 registry。`createPilotProvider(env):{provider,runtimeConfig}` 仅接受现有官方 DeepSeek 配置，缺失时 fail closed。

- [x] **1. 写失败测试。** `preservesV2ResultAndNormalization`、`runsOneRubricCompletion`、`usesZeroImagesForConfirmedText`、`keepsUnknownTerminationAndSafeDiagnostics`：比较现有 fixture 的外部结果、attempts 和错误分类，确认没有第二次调用。
- [x] **2. 验证红灯。** `npm.cmd --prefix grading-gateway test -- src/multimodal/executeOperation.test.ts`。
- [x] **3. 实施提取。** 把现有 server 内 Provider 调用、归一化、阶段观测移到上述纯执行边界；原 HTTP registry/admission 仍由原路由持有，云端持久 worker 自行占位。保留严格评分校验、canonical task context、去重输出、printed boundary/字迹策略及安全日志。不复制第二套 Prompt 或 normalizer，不在执行服务添加自动重试。
- [x] **4. 验证绿灯及合同回归。** 重跑新测试、Gateway 全量测试、typecheck、`npm.cmd --prefix grading-gateway run verify:shared-scoring-runtime`、平台 grading.test；原 `POST /grading/grade-images` 行为一致。
- [x] **5. 提交。** `refactor: share validated multimodal execution service`。

### Task 4: 持久作业、全局占位和结果落库

**Files:** 新增 `platform-api/src/pilot/{essays,jobs,admission}.ts` 和测试、`platform-api/scripts/resumePilotQueue.ts`；补充迁移约束与 shared DTO。

**Interfaces:** `PilotEssayRepository(db)` 提供 `attach(ownerId,taskId,Command<{groups:{studentName:string;uploadIds:Id[]}[]}>):Promise<Page<EssayDto>>`、`list(ownerId,taskId,query)`、`get(ownerId,essayId)`、`saveTranscript(ownerId,essayId,Command<{text:string}>):Promise<EssayDto>`、`saveReview(ownerId,essayId,Command<TeacherReviewInput>):Promise<EssayDto>`。`PilotJobRepository(db)` 提供 `enqueueTask(ownerId,taskId,command):Promise<{accepted:number}>`、`enqueueMaterial(ownerId,taskId,Command<{kind:'material_context'|'rubric'}>):Promise<JobDto>`、`get(ownerId,jobId):Promise<JobDto>`、`retryKnown(ownerId,jobId,command):Promise<JobDto>`。`PersistentAdmission(db)` 提供 `claim(jobId):Promise<ClaimOutcome>`、`beginCall(lease):Promise<boolean>`、`complete(lease,result):Promise<void>`、`fail(lease,error):Promise<void>`。ClaimOutcome 为 terminal/busy/paused/claimed，claimed 含内部 job snapshot 与 `{executionId,token,fence}`。

另有 `markManual(ownerId,essayId,command:Command<{manualReviewRequired:true}>):Promise<EssayDto>`，只改人工处理标记；`resumeKnownPause(db,expectedPauseRevision:number):Promise<void>` 仅由维护脚本调用，要求 gate 无活动/未知执行、暂停原因明确且配置合法，CAS 恢复；绝不提供未知占位强制解锁参数。

- [x] **1. 写失败测试。** 两个 repository 竞争相同 source/rubric 仅一个作业；两个不同阶段只能一个 claim；`lateResultDoesNotReplaceEditedTranscriptOrReview`；`successfulPersistenceSurvivesAckFailure`；`unknownLeaseNeverExpiresIntoRetry`；`onlyDirectEaccesConnectReleasesSlot`（Abort 优先）；维度分数越界/旧 expectedRevision 拒绝。
- [x] **2. 验证红灯。** `npm.cmd --prefix platform-api test -- src/pilot/essays.test.ts src/pilot/jobs.test.ts src/pilot/admission.test.ts`。
- [x] **3. 实施事务状态机。** enqueue 锁任务与当前版本，保存不可变输入快照、唯一逻辑身份和 outbox 同事务；客户端不用自报结果。claim 锁 singleton gate，产生单调 fence + 随机令牌。beginCall 必须持久标为调用可能发出后才连出；预检期间崩溃可在 fence 撤销后重新预检，旧 worker 的 beginCall 必须失败。beginCall 后失联只能 result_unknown，保留 gate；完整结果在同事务保存规范化结果、作业终态和释放 gate。迟到结果只能原 token/fence，旧版本可保存历史但不可成为当前结果。job 活跃或未知时，即使正文变更也不得给同作文开启第二个并行调用；不因删除而释放未知占位。

  记录 call_started_at/deadline；超过函数截止仍为 calling 的执行在读取/恢复时标为 result_unknown，不能释放。若任务已删除，原令牌的已确认迟到结果只更新终止墓碑并释放 gate，不重新保存正文或结果内容。
- [x] **4. 完成明确失败策略并验证绿灯。** auth/balance/config 暂停全局准入，维护者修复配置后运行 resumeKnownPause；前端显示联系维护者，不能假称恢复。明确 429 依现有常量退避，最多 5 次重排；其他明确单篇失败不阻断后续。显式重试要求确认终止且可重试，沿用 maxAttempts=2。claim/beginCall 检查账号 active 与任务未删除；停用取消未发出的作业，已发出的仍按原令牌收尾。添加维护恢复/停用测试并重跑步骤 2 和 typecheck。
- [x] **5. 提交。** `feat: add persistent grading jobs and shared admission`。

### Task 5: Vercel 队列 worker、恢复与删除

**Files:** 新增 `platform-api/src/pilot/{worker,queue,recovery,cleanup}.ts`、对应测试、`api/pilot-worker.ts`、`api/pilot-maintenance.ts`；修改 `vercel.json`、平台 package/lockfile。

**Interfaces:** `JobQueue.publish(jobId:Id,deliveryKey:string,delaySeconds?:number):Promise<void>`；`runPilotJob(jobId,deps):Promise<'done'|'deferred'>`（deps 为上述 repositories/admission/storage、executeMultimodalOperation、now）；`recoverPilotWork(deps,limit:number):Promise<{published:number;cleaned:number}>`；`deleteTask(ownerId,taskId,command):Promise<void>`。消息体严格只有 `{jobId}`，worker 根据 DB 确定 owner 和所有输入。

- [x] **1. 写失败测试。** 模拟 enqueue 提交后 publish 失败、publish 成功但 outbox 更新失败、结果提交后 ack 失败、消息过期、关闭浏览器后两篇依次执行；每篇一次 completion。`deleteDuringUnknownExecutionKeepsTombstone`；`cleanupNeverDeletesAttachedOrForeignUpload`；匿名访问 worker/maintenance 不执行。
- [x] **2. 验证红灯。** `npm.cmd --prefix platform-api test -- src/pilot/worker.test.ts src/pilot/queue.test.ts src/pilot/recovery.test.ts src/pilot/cleanup.test.ts`。
- [x] **3. 实施 worker。** 用官方 `@vercel/queue` 的 `QueueClient.handleNodeCallback` 私有触发器，topic `writewise-pilot`，region sin1、consumer 并发 1、函数最长 300 秒。claim 后按存储摘要加载、构造现有 v2 输入及 canonical identity，然后 beginCall；Provider 截止 290000ms、最后 10000ms 留给保存，截止需从函数开始计时扣除预检耗时。已成功/未知/删除的重复消息不再连出。数据库不可用先停止，原令牌迟到结果不被新消费者覆盖。共享 gate 繁忙只延迟消息，不增加 Provider attempt。
- [x] **4. 实施 outbox 恢复与删除。** 发布 key 用 jobId+持久投递代次；消息期限过后可换代次，数据库仍阻止重调。命令提交和 worker 结束有界补投，教师读取只补投自己的作业。每日 `0 0 * * *` maintenance 为无人访问时的恢复/24h 临时清理兜底，要求 `CRON_SECRET`；每次最多 50 条，剩余游标存入 maintenance_jobs 后投递同一私有队列。runPilotJob 识别内部 maintenance ID 时只做恢复/清理，不占 Provider gate；公网 jobs 路由从不读取该表。删除先隐藏与阻止新调用，再分批清理；未知执行仅留必要 ID/摘要/状态墓碑，执行预检中对象暂不删除。
- [x] **5. 验证绿灯。** 重跑步骤 2、平台/部署 typecheck，配置测试确认两个专用 api 路径不被 `/api/:path*` 重写吞掉。maintenance 每日运行只作故障兜底，不能向用户承诺精确恢复时刻。[Hobby cron 限制](https://vercel.com/docs/cron-jobs/usage-and-pricing)、[Queue SDK](https://vercel.com/docs/queues/sdk)。
- [x] **6. 提交。** `feat: run persistent pilot jobs with private queue triggers`。

### Task 6: 已认证业务 API 与生产执行边界

**Files:** 新增 `platform-api/src/pilot/{routes,runtime}.ts`、`platform-api/src/sessionMiddleware.ts`、对应测试；修改 `platform-api/src/{server,runtime,grading,privileges}.ts` 及相关测试。

**Interfaces:** `createPilotRouter(deps):Router`；`createPilotRuntime(db,env):PilotRuntime|undefined`。session middleware 从既有 AuthRepository 得到 PublicUser，业务路由只接受 teacher，所有写操作要求 Origin+CSRF。统一失败 `{error:{code,message}}`，404 隐藏他人 ID，409 `revision_conflict`/`command_conflict`。API 前缀 `/api/pilot`：

| 路由 | 对应方法 |
| --- | --- |
| GET/POST `/tasks` | list / createDraft |
| GET/PATCH/DELETE `/tasks/:id`；POST `/tasks/:id/confirm` | get/saveDraft/deleteTask/confirm |
| POST/GET `/tasks/:id/uploads`；POST `/uploads/:id/complete`；GET `/uploads/:id/read-url` | reserve/list/complete/readUrl |
| POST/GET `/tasks/:id/essays`；GET `/essays/:id` | attach/list/get |
| PATCH `/essays/:id/transcript`；PUT `/essays/:id/review` | saveTranscript/saveReview |
| PUT `/essays/:id/manual` | markManual，不释放运行或未知 lease |
| POST `/tasks/:id/grade`；POST `/tasks/:id/assist` | enqueueTask/enqueueMaterial |
| GET `/jobs/:id`；POST `/jobs/:id/retry` | get/retryKnown |
| GET `/capabilities` | teacherMvp/AI 可用性，不返回 Secret |

- [x] **1. 写失败测试。** 使用两个教师和一个管理员 cookie 完整测试上述跨账号矩阵；缺会话 401、外来 Origin/CSRF 403；`rawGatewayCannotBypassPersistentExecution`；超大 JSON/未知字段拒绝；服务器不信任 owner/status/count/result。上传预留、完成、读取和作业查询分别校验归属。
- [x] **2. 验证红灯。** `npm.cmd --prefix platform-api test -- src/pilot/routes.test.ts src/sessionMiddleware.test.ts src/runtime.test.ts`。
- [x] **3. 实施装配。** 账号 JSON 仍为 16 KiB；pilot JSON 为 2 MiB，同时执行现有材料字段限制，文件不走此入口。生产旧 `/api/grading/*`、`/api/tasks/*` 鉴权后固定返回 `409 persistent_job_required`，不连出；独立 Gateway v2 HTTP 合同保留。缺依赖时 capabilities=false、业务 503、账号可用；`PILOT_MVP_ENABLED` 关闭也不能重开旧付费旁路，不回退 fake。
- [x] **4. 验证绿灯与账号回归。** 重跑步骤 2 和平台全量测试/typecheck，确认 session/退出/禁改密/管理员管理测试保持通过。日志只记录请求 ID、固定错误码、阶段与必要安全用量；不得记录 DTO 正文、签名 URL 或数据库连接串。
- [x] **5. 提交。** `feat: expose authenticated persistent pilot APIs`。

### Task 7: 云端教师状态与创建上传页面

**Files:** 新增 `app/src/pilot/client.ts`、`projection.ts`、`CloudAppStateProvider.tsx`、`TeacherApp.tsx` 及同目录测试；修改 `app/src/auth/AccountApp.tsx`、`app/src/context/{appStateContextValue.ts,AppStateContext.tsx}`、`app/src/pages/{CreateTaskPage,UploadPage,TaskListPage}.tsx` 及测试、`app/src/layout/AppLayout.tsx`、`app/src/components/WorkflowNav.tsx`。

**Interfaces:** `createPilotClient({getCsrfToken,onSessionExpired,fetchImpl}):PilotClient` 对应任务 6 合同，所有调用支持 signal；`CloudAppStateProvider({children,userId,client})` 向现有 AppStateContext 投影云数据。createTask 返回 `Promise<string>`；enqueueImageEssays、start/retry/resume、updateEssayOcrText、markEssayManual、confirm/updateGradingResult 改为 `Promise<void>`；开发 provider 做等价 async 包装。新增 capabilities、loading/error/save 状态；持久化命令统一由云端适配实现，禁用本地 scheduler。

- [x] **1. 写失败测试。** 空账号首次无 demo；创建保存失败不跳转；双击/响应丢失复用 commandId；上传一页失败仅该页失败、已完成登记刷新恢复；换号时上传/列表迟到回调丢弃；图片重新读取短签名成功；管理员仍只有账号管理。
- [x] **2. 验证红灯。** `npm.cmd --prefix app test -- src/pilot src/pages/CreateTaskPage.test.tsx src/pages/UploadPage.test.tsx src/pages/TaskListPage.test.tsx`。
- [x] **3. 实施云客户端和页面适配。** 生产通过 capabilities 选择 TeacherApp，保持账号加载/退出状态；以 userId+会话世代卸载全部数据与 AbortController。草稿在首次保存/添加材料前建立，表单变更用有界防抖保存并显示未保存，确认前 await 最后一次保存；不在 localStorage 存老师正文/密钥。创建、上传关联成功后才能导航。上传每页先登记→直传→complete→按学生 attach；稳定 groups 命令允许恢复。分页载入服务器数据，server counts 不由已加载页数推算。
- [x] **4. 保留产品边界并验证绿灯。** 保持默认学生名、三个上传入口、多页 PDF 顺序。header 加当前账号/退出；云端导航不显示 fake 班级总结，相关命令明确不可用，不能返回假成功。重跑步骤 2、既有 CreateTaskFlow/MultimodalUploadFlow 测试和 app typecheck/lint。
- [x] **5. 提交。** `feat: connect teacher creation and uploads to cloud storage`。

### Task 8: 服务器进度、教师修订确认与删除页面

**Files:** 新增 `app/src/pilot/{polling,reviewDraft}.ts`、对应测试；修改 CloudAppStateProvider、`app/src/pages/{ProgressPage,EssayResultPage,TaskListPage,ExceptionsPage}.tsx` 及对应测试。

**Interfaces:** `startOwnedPolling({load,onSnapshot,onExpired,signal}):()=>void`，同一对象只有一个未完成读取、正常间隔 2 秒，错误退避最高 15 秒；页面停止只停轮询，不取消后台作业。`saveReview(essayId,command:Command<TeacherReviewInput>):Promise<EssayDto>` 由 PilotClient 提供；reviewDraft 仅管理当前未保存 UI 值，服务器结果 revision 是 CAS 基准。

- [x] **1. 写失败测试。** 点击一次启动全部待批改；刷新读取运行中/终态；检查未知结果只 GET；修改评论不在每个 keystroke 保存；保存失败保留编辑内容；两个标签页旧 revision 显示冲突，不覆盖；正文修订保存后旧评分失效、重批只使用确认文本；退出后迟到轮询结果不出现。
- [x] **2. 验证红灯。** `npm.cmd --prefix app test -- src/pilot/polling.test.ts src/pilot/reviewDraft.test.ts src/pages/ProgressPage.test.tsx src/pages/EssayResultPage.test.tsx src/pages/TaskListPage.test.tsx`。
- [x] **3. 实施进度与编辑。** 按持久 JobDto 映射原页面状态；资源等待用稳定“等待批改资源”，不把准入忙误写成 429；明确失败单篇可见。分数/评论先 local draft，点击保存/确认 await 服务端成功才显示“已保存”；冲突保留本地文字并提供加载最新版本。服务器校验修改维度并派生总分，不发送 Partial<GradingResult> 全对象。正文重批为显式操作，未知执行时禁止再开新请求。
- [x] **4. 实施显式删除并验证绿灯。** 任务删除前展示将删除任务、图片及结果的范围；成功后刷新列表并清理内存，失败保留可见状态。重跑步骤 2 和 app typecheck/lint，确认原图刷新地址失败时显示加载错误，不回退示例图片。
- [x] **5. 提交。** `feat: persist teacher review and recover grading progress`。

### Task 9: 可选 AI 评分标准的持久执行

**Files:** 新增 `app/src/pilot/materialClients.ts`、测试；修改 `app/src/hooks/useTaskMaterials.ts`、`app/src/pages/CreateTaskPage.tsx` 及测试，补充后端 jobs/worker 材料流程测试。

**Interfaces:** `createPilotMaterialClients({client,taskDraft}):{materialClient:MaterialContextClient;rubricClient:RubricClient}`，实现既有 analyze/generate 返回类型；先保存当前草稿/materialRefs，再 enqueueMaterial，轮询同一 JobDto；恢复页面时继续检查已有 job，不新建 completion。

- [x] **1. 写失败测试。** 上传材料分析和逐篇批改竞争同一 gate；点击 AI 生成只一次 rubric completion，原材料只发送一次；已生成 rubric 的 materialContext 直接复用，不暗中另做材料理解；刷新恢复进行中辅助任务；手动修改后迟到 AI 不覆盖；材料失败仍能以合法人工标准确认。
- [x] **2. 验证红灯。** `npm.cmd --prefix app test -- src/pilot/materialClients.test.ts src/hooks/useTaskMaterials.test.tsx src/pages/CreateTaskPage.test.tsx` 与 `npm.cmd --prefix platform-api test -- src/pilot/worker.test.ts src/pilot/jobs.test.ts`。
- [x] **3. 实施适配。** 图片使用任务归属下已验证 uploadId，DOCX 文本复用现有提取和 30000 字符限制。material/rubric job 身份绑定草稿 revision+材料摘要+kind；结果只作教师可接受建议，草稿新 revision 时不自动覆盖；拒绝旧请求的假 retryable 提示。合并以教师输入优先，保留 reviewWarnings，逐篇仅发送确认任务包而非原题材料。
- [x] **4. 验证绿灯。** 重跑步骤 2、app/平台 typecheck，现有一次 rubric 及可选材料流程回归通过。
- [x] **5. 提交。** `feat: connect optional rubric assistance to persistent jobs`。

### Task 10: 完整验收、云端准备与发布

**Files:** 新增 `platform-api/scripts/{verifyPilotLocal,verifyPilotPostgres,verifyPilotPublic}.ts`、`platform-api/src/pilot/acceptance.test.ts`、`docs/2026-09-27-teacher-cloud-mvp-validation.md`；修改 `docs/teacher-pilot-accounts-setup.md`、`AGENTS.md`、`docs/current_development_status.md`、vercel CSP 和必要脚本配置。账本和凭据仍在 ignored 私密目录。

**Interfaces:** `verifyPilotLocal` 只使用合成 fixture/fake Provider；`verifyPilotPostgres` 使用隔离 fixture 和两个真实 PG 连接测试争用；`verifyPilotPublic` 仅从 ignored 本地配置取账号，按 case 名原子预留一次性账本并记录安全摘要，已有未知预留不重发。

- [ ] **1. 写失败集成测试。** 串起双教师登录、草稿、私有图片、多页 attach、两次 enqueue、两 worker、成功保存、重投、修改确认、退出重登及删除；逐篇调用计数准确。故障注入覆盖 Review Focus 五项，明确 PGlite 不能替代多连接 PG 争用证据。
- [ ] **2. 验证红灯后补齐跨模块缺口。** `npm.cmd --prefix platform-api test -- src/pilot/acceptance.test.ts`；任何修复先复现失败，保持任务 1–9 合同，不削弱校验或未知处理。
- [ ] **3. 执行本地最终门槛。** `npm.cmd --prefix platform-api test`、`npm.cmd --prefix grading-gateway test`、`npm.cmd --prefix app test`、三端 typecheck、app lint、Gateway verify:shared-scoring-runtime、根目录 `npm.cmd run build`、`git diff --check`。浏览器合成流程检查桌面与手机视口，禁止把文件选择测试称真机拍照已通过。依执行方式进行一次独立整分支复核并关闭阻塞问题。
- [ ] **4. 准备具体云配置清单。** 同项目私有 bucket `pilot-originals`；新增服务端 `SUPABASE_URL`、`SUPABASE_STORAGE_BUCKET`、`SUPABASE_STORAGE_SERVICE_KEY`、`CRON_SECRET`、`PILOT_MVP_ENABLED`。确认 Queue beta 在现有账户可用且无需升级；列明实际 Secret 名称和目标 `wenjie-writewise-pilot`，按已有授权推进，未获授权的新 Secret 保存作为最后人工确认项，不能先输出值。CSP 仅增加 `https://wudbhdyqgnbnuorebhnu.supabase.co` 必需 img/connect 源；文档记录 60 秒已签发读取地址窗口、未知占位恢复限制及每日兜底延迟。
- [ ] **5. 云端顺序执行。** 先备份 schema/权限元数据并验证预期版本，仅加业务迁移/私有 bucket/必要凭据，不重建账号；运行真实 PG 双连接合成竞争测试并清理 fixture。再发布已验证提交并开启 teacherMvp，核实 Production Ready/Current、私有 worker 拒绝公网直接调用、维护鉴权以及无 raw Gateway 旁路。依赖不满足则保持账号站点可用，不宣称已上线；回滚只关闭新入口/消费者并保留未知墓碑，不把旧同步付费接口重新开放。
- [ ] **6. 一次性公网合成验收。** 每种 case 独立账本：人工标准单图、多页单篇、可选 AI rubric；先断言上传/会话/作业再等待原 job，不未知重发。记录实际 completion 数、耗时和安全 usage，检查刷新、退出重登、修改确认、第二账号隔离、原图读取、后台继续、重复投递；最后退出会话并删除可安全清理的测试内容。只在所有证据通过后报告教师 MVP 接通，30×50 吞吐与真实教学效果仍未验收。
- [ ] **7. 交付记录。** 更新工作树及根目录两份记忆，分开写代码/本地/PG/公网证据与未完成项；提交 `docs: record teacher cloud MVP validation`，按已授权部署流程推送并复核最终状态。

## 自查结果与执行交接

- 设计覆盖：页面流程→任务 7–9；所有权/版本→任务 1、4、6；私有图片→任务 2；v2 执行→任务 3；幂等/全局并发→任务 4–5；保存、删除、恢复→任务 4–8；云配置/验收→任务 10。
- 五个 Review Focus 均有明确测试；材料理解/rubric 与作文共用 gate，raw Gateway 生产旁路关闭，未知调用无 TTL 解锁，删除保留必要墓碑。
- 上述 DTO、commandId、revision、lease/fence 在任务间沿用同一合同；不使用浏览器 File 作为服务端持久类型。
- 执行建议：**Native**，在当前任务由同一实施者逐项开发，最后独立整分支复核。任务接口关联紧密，逐项更换实施者会增加重复理解；仍可按用户选择改用逐任务独立代理和复核。
- 状态：书面设计与 Native 执行方式已获用户确认；正在逐项实施。云端迁移、部署与公网验收另行记录。
