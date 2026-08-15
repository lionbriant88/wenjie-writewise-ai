# Full-Feature WeChat Mini Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在共享 Platform API 上交付教师端完整功能微信小程序，使任务、上传、批改、确认、班级讲评、班级学生、原卷批注、导出和设置与网站功能对等。

**Architecture:** 新建独立 `mini-program` Taro React TypeScript 客户端，复用 `@writewise/contracts` 和同一 Platform API，但不复制网站 DOM 组件或业务规则。小程序按移动端交互拆分页面，使用微信登录、拍照/相册、分片式上传、Canvas/SVG 原卷批注、WebSocket + cursor 恢复同步、云端导出下载与转发。

**Tech Stack:** Taro React、TypeScript、微信小程序、Jest、`@tarojs/test-utils-react`、`@writewise/contracts`、Platform API。

## Global Constraints

- 小程序是教师端完整产品，不是网站精简版。
- 小程序与网站共享账号、任务、班级、学生、图片、状态、批改结果、教师修改、批注、导出和设置。
- 小程序不直连 Grading Gateway，不持有模型密钥、对象存储密钥或 service token。
- 所有付费批改和重试必须由教师显式点击；网络恢复不得自动创建新批改任务。
- 所有写操作携带幂等键；所有更新携带版本号；HTTP 409 不得静默覆盖。
- 原文修改使当前结果失效，只在教师再次显式操作后入队。
- 复杂功能不得因移动端而删除；应改为全屏原图、手势缩放、触控批注、结果分层 Tab、底部操作栏和批量选择面板。
- 第一版不提供学生端或家长端入口。
- 不使用 WebView 包装现有网站作为主实现。
- 页面文案使用“学生原文、修订学生原文、识图说明”，不得出现 OCR 产品术语。
- 自动化测试使用合成数据；小程序调试包和截图不得包含真实学生身份或作文。

## Technical Decision

使用 Taro React，而不是把网站塞进 WebView，也不直接复制网站组件。Taro 官方支持 React 页面组件、微信小程序构建、行为导向测试工具，以及 `uploadFile`、`downloadFile`、`openDocument`、`shareFileMessage` 和 WebSocket API。业务 DTO 和纯函数共享，视图与平台 API 适配独立。

执行时以官方文档为准：[Taro React](https://docs.taro.zone/en/docs/react-overall)、[Taro 测试工具](https://docs.taro.zone/docs/test-utils/)、[uploadFile](https://docs.taro.zone/en/docs/3.x/apis/network/upload/uploadFile)、[downloadFile](https://docs.taro.zone/docs/apis/network/download/downloadFile)、[openDocument](https://docs.taro.zone/docs/3.x/apis/files/openDocument)、[shareFileMessage](https://docs.taro.zone/docs/apis/share/shareFileMessage)。

---

## File Structure

### Application shell

- Create `mini-program/package.json`, `package-lock.json`, `tsconfig.json`, `project.config.json`, `.env.example`.
- Create `mini-program/config/index.ts`, `dev.ts`, `prod.ts`.
- Create `mini-program/src/app.config.ts`, `app.tsx`, `app.scss`.
- Create `mini-program/src/styles/tokens.scss`.
- Create `mini-program/src/components/AppPage.tsx`, `LoadingState.tsx`, `ErrorState.tsx`, `VersionConflictSheet.tsx`.

### Platform integration

- Create `mini-program/src/services/storage/sessionStore.ts`.
- Create `mini-program/src/services/platform/taroPlatformClient.ts` and tests.
- Create `mini-program/src/services/platform/taroUploadClient.ts` and tests.
- Create `mini-program/src/services/platform/taroSyncClient.ts` and tests.
- Create `mini-program/src/context/PlatformProvider.tsx` and tests.

### Pages

- Main package: login, home, task list, class list, export list, settings.
- Task subpackage: create task/rubric, upload/group, progress, review queue, essay result, original paper, class review.
- Class subpackage: class detail and student roster.

### Mobile-specific capabilities

- Create upload draft/grouping utilities and components.
- Create touch annotation utilities, canvas component and gesture controller.
- Create export download/open/share service.
- Create parity manifest and contract tests.

---

### Task 1: Scaffold a Taro React mini program with shared contracts and tests

**Files:**
- Create: `mini-program/package.json`
- Create: `mini-program/package-lock.json`
- Create: `mini-program/tsconfig.json`
- Create: `mini-program/jest.config.cjs`
- Create: `mini-program/project.config.json`
- Create: `mini-program/.env.example`
- Create: `mini-program/config/index.ts`
- Create: `mini-program/config/dev.ts`
- Create: `mini-program/config/prod.ts`
- Create: `mini-program/src/app.config.ts`
- Create: `mini-program/src/app.tsx`
- Create: `mini-program/src/app.scss`
- Create: `mini-program/src/styles/tokens.scss`
- Create: `mini-program/src/app.test.tsx`

**Interfaces:**
- Produces: `npm.cmd run dev:weapp`, `build:weapp`, `test`, `typecheck`, `lint`.
- Consumes: `@writewise/contracts` via `file:../packages/contracts`.
- Produces: main pages and task/class subpackage registration.

- [ ] **Step 1: Create the package from the current official Taro React TypeScript template**

Keep all `@tarojs/*` package versions identical in `package.json` and lock them in `package-lock.json`. Add `@tarojs/test-utils-react`, Jest and the H5 peer dependency used by the test environment. Do not add a second component framework.

- [ ] **Step 2: Write a failing app-shell test**

```ts
const testUtils = new TestUtils()
await testUtils.createApp()
await testUtils.PageLifecycle.onShow('/pages/home/index')
expect(testUtils.queries.queryByText('教师工作台')).not.toBeNull()
```

- [ ] **Step 3: Register the exact page topology**

Main package:

```ts
pages: [
  'pages/login/index',
  'pages/home/index',
  'pages/tasks/index',
  'pages/classes/index',
  'pages/exports/index',
  'pages/settings/index',
]
```

Subpackages contain task workspace pages and class detail. Configure a four-item tab bar: `工作台 / 班级 / 导出 / 设置`.

- [ ] **Step 4: Add shared visual tokens**

Use the website’s blue/cyan/slate palette, 8px rounded cards and compact typography, translated to rpx. Do not copy Tailwind classes; define SCSS variables and component classes.

- [ ] **Step 5: Run shell tests, typecheck and build**

```powershell
npm.cmd test -- src/app.test.tsx
npm.cmd run typecheck
npm.cmd run build:weapp
```

Expected: PASS and a WeChat build under `mini-program/dist`.

- [ ] **Step 6: Commit Task 1**

```powershell
git add mini-program
git commit -m "feat: scaffold teacher WeChat mini program"
```

### Task 2: Implement WeChat authentication, typed requests and durable sync

**Files:**
- Create: `mini-program/src/services/storage/sessionStore.ts`
- Create: `mini-program/src/services/storage/sessionStore.test.ts`
- Create: `mini-program/src/services/platform/taroPlatformClient.ts`
- Create: `mini-program/src/services/platform/taroPlatformClient.test.ts`
- Create: `mini-program/src/services/platform/taroSyncClient.ts`
- Create: `mini-program/src/services/platform/taroSyncClient.test.ts`
- Create: `mini-program/src/context/PlatformProvider.tsx`
- Create: `mini-program/src/context/PlatformProvider.test.tsx`
- Create: `mini-program/src/pages/login/index.tsx`
- Create: `mini-program/src/pages/login/index.config.ts`
- Create: `mini-program/src/pages/login/index.scss`
- Create: `mini-program/src/pages/login/index.test.tsx`

**Interfaces:**
- Produces: `TaroPlatformClient` implementing the same logical method groups as the website client.
- Produces: `loginWithWechat(): Promise<TeacherDto | { status: 'wechat_unlinked' }>` and `linkExistingWebAccount(input): Promise<TeacherDto>`; the client obtains a fresh one-use WeChat code inside each method and never exposes it to page state.
- Produces: `TaroSyncClient.start(token, afterCursor, onHint)` and `recover()`.

- [ ] **Step 1: Write failing session and request tests**

Assert token storage uses one private storage key, request headers include bearer token, mutation callers provide `Idempotency-Key`, updates provide quoted `If-Match`, JSON parse errors become safe `ApiError`, and 409 preserves `latest` without retry.

- [ ] **Step 2: Write failing login tests**

Mock `Taro.login` to return a code, assert only that code is sent to `/auth/wechat/login`, store the returned session, load `/me`, and navigate to home. For `wechat_unlinked`, show `绑定已有网站账号`, accept phone/password locally, call `/auth/wechat/link` with the fresh WeChat code, and then enter the same teacher account. Test cancelled/failed login and invalid binding without logging the code or password.

- [ ] **Step 3: Write failing socket recovery tests**

Mock `Taro.connectSocket`. A message triggers entity invalidation; close schedules reconnect with bounded backoff; reconnect first calls `GET /sync?after=<cursor>`; no sync event replays a mutation.

- [ ] **Step 4: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/services/storage src/services/platform src/context/PlatformProvider.test.tsx src/pages/login/index.test.tsx
```

Expected: FAIL because integration modules are absent.

- [ ] **Step 5: Implement authentication and provider boot**

`PlatformProvider` exposes `teacher`, normalized entity maps, loading/error state, `refreshEntity`, `handleVersionConflict`, `logout`. On `useDidShow`, recover missed changes; on `useDidHide`, keep the cursor and close the socket cleanly.

- [ ] **Step 6: Implement safe reconnect**

Reconnect delays are 1s, 2s, 5s, then 10s while the app remains visible. Socket hints never mutate data directly; each hint schedules one deduplicated entity refresh. Billable commands are not retried.

- [ ] **Step 7: Run focused tests and build**

```powershell
npm.cmd test -- src/services/storage src/services/platform src/context/PlatformProvider.test.tsx src/pages/login/index.test.tsx
npm.cmd run typecheck
npm.cmd run build:weapp
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```powershell
git add mini-program/src/services mini-program/src/context mini-program/src/pages/login
git commit -m "feat: connect mini program authentication and sync"
```

### Task 3: Build the complete teacher workbench, task list, class list and settings shell

**Files:**
- Create: `mini-program/src/components/AppPage.tsx`
- Create: `mini-program/src/components/LoadingState.tsx`
- Create: `mini-program/src/components/ErrorState.tsx`
- Create: `mini-program/src/components/VersionConflictSheet.tsx`
- Create: `mini-program/src/components/components.test.tsx`
- Create: `mini-program/src/pages/home/index.tsx`
- Create: `mini-program/src/pages/home/index.test.tsx`
- Create: `mini-program/src/pages/tasks/index.tsx`
- Create: `mini-program/src/pages/tasks/index.test.tsx`
- Create: `mini-program/src/pages/classes/index.tsx`
- Create: `mini-program/src/pages/classes/index.test.tsx`
- Create: `mini-program/src/pages/settings/index.tsx`
- Create: `mini-program/src/pages/settings/index.test.tsx`

**Interfaces:**
- Consumes: task/class/settings collections from `PlatformProvider`.
- Produces: mobile equivalents of website workbench, task list, class management entry and grading settings.

- [ ] **Step 1: Write failing behavior tests for all four pages**

Home shows counts for queued, grading, review-ready, failed and recent completed. Task list supports status filtering, rename, archive, create and opening progress. Class list supports create/archive and opens roster. Settings edits strictness, feedback detail, rating mode, enabled feedback and export style with version.

- [ ] **Step 2: Write the version-conflict interaction test**

```ts
fakeClient.settings.patch.mockRejectedValue(versionConflict)
await testUtils.fireEvent.click(saveButton)
expect(testUtils.queries.queryByText('内容已在网站或另一台设备更新')).not.toBeNull()
expect(fakeClient.settings.patch).toHaveBeenCalledTimes(1)
```

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/components src/pages/home src/pages/tasks src/pages/classes src/pages/settings
```

Expected: FAIL because components and pages are absent.

- [ ] **Step 4: Implement mobile page composition**

Use a fixed page header, scrollable card list and safe-area-aware bottom spacing. Long task lists paginate through API cursors. Keep task card data equivalent to the website: name, class, full score, status counts and updated time.

- [ ] **Step 5: Implement settings validation**

Grammar and logic cannot both be disabled; weight/rubric editing remains in task creation, not global settings. Save once with current version and show the shared conflict sheet on 409.

- [ ] **Step 6: Run tests, typecheck and build**

```powershell
npm.cmd test -- src/components src/pages/home src/pages/tasks src/pages/classes src/pages/settings
npm.cmd run typecheck
npm.cmd run build:weapp
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```powershell
git add mini-program/src/components mini-program/src/pages/home mini-program/src/pages/tasks mini-program/src/pages/classes mini-program/src/pages/settings
git commit -m "feat: add mobile teacher workbench"
```

### Task 4: Implement material upload, rubric generation and task creation

**Files:**
- Create: `mini-program/src/task-pages/create/index.tsx`
- Create: `mini-program/src/task-pages/create/index.config.ts`
- Create: `mini-program/src/task-pages/create/index.scss`
- Create: `mini-program/src/task-pages/create/index.test.tsx`
- Create: `mini-program/src/components/RubricEditor.tsx`
- Create: `mini-program/src/components/RubricEditor.test.tsx`
- Create: `mini-program/src/services/platform/taroUploadClient.ts`
- Create: `mini-program/src/services/platform/taroUploadClient.test.ts`

**Interfaces:**
- Produces: material image selection/order, remote rubric generation/review, editable dimensions and explicit task confirmation.
- Consumes: Platform API task/rubric routes and `Taro.chooseMedia`, `Taro.uploadFile`.

- [ ] **Step 1: Write failing creation-flow tests**

Test camera/album/message-file choice, 10-page limit, MIME/size rejection, reorder/remove, full score validation, generation loading/failure, exact 100% weights, required `legibility` dimension and explicit confirmation before navigation. Camera/album uses `Taro.chooseMedia`; chat-file import uses `Taro.chooseMessageFile` and accepts only supported image files.

- [ ] **Step 2: Write failing upload adapter tests**

Mock `Taro.uploadFile`; assert field name `page`, bearer header, batch/page IDs, progress callback, single-file retry and safe JSON projection. A failed page retry must not re-upload successful pages.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/task-pages/create src/components/RubricEditor.test.tsx src/services/platform/taroUploadClient.test.ts
```

Expected: FAIL because page, editor and adapter are absent.

- [ ] **Step 4: Implement the step-based mobile screen**

Use three sections on one route: `题目图片 → 评分标准 → 确认任务`. Keep generated rubric fields editable. Image/full-score/rubric edits reset confirmation but do not erase the draft. The final button creates one server task with one idempotency key.

- [ ] **Step 5: Run tests, typecheck and build**

```powershell
npm.cmd test -- src/task-pages/create src/components/RubricEditor.test.tsx src/services/platform/taroUploadClient.test.ts
npm.cmd run typecheck
npm.cmd run build:weapp
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```powershell
git add mini-program/src/task-pages/create mini-program/src/components/RubricEditor* mini-program/src/services/platform/taroUploadClient*
git commit -m "feat: create grading tasks in mini program"
```

### Task 5: Implement mobile essay capture, grouping, ordering and submission

**Files:**
- Create: `mini-program/src/task-pages/upload/index.tsx`
- Create: `mini-program/src/task-pages/upload/index.config.ts`
- Create: `mini-program/src/task-pages/upload/index.scss`
- Create: `mini-program/src/task-pages/upload/index.test.tsx`
- Create: `mini-program/src/features/upload/uploadDraft.ts`
- Create: `mini-program/src/features/upload/uploadDraft.test.ts`
- Create: `mini-program/src/features/upload/EssayGroupCard.tsx`
- Create: `mini-program/src/features/upload/EssayGroupCard.test.tsx`

**Interfaces:**
- Produces: `UploadDraft` with local images, remote page IDs, group IDs and contiguous order.
- Consumes: class/student data, `Taro.chooseMedia`, upload client and submit endpoint.

- [ ] **Step 1: Write failing pure grouping tests**

Cover single-page, fixed-two-page and mixed grouping, drag/button reorder, merge, split, delete, retry state, unique page use and deterministic renumbering.

```ts
expect(finalizeDraft(draft)).toEqual({
  essays: [
    { clientEssayId: 'group-1', studentId: null, pageIds: ['page-a', 'page-b'] },
    { clientEssayId: 'group-2', studentId: null, pageIds: ['page-c'] },
  ],
})
```

- [ ] **Step 2: Write failing page behavior tests**

Test class selection, optional student assignment, camera/album/message-file append, per-page progress, failed-page retry, group controls, submit confirmation, duplicate tap lock and navigation to progress.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/features/upload src/task-pages/upload
```

Expected: FAIL because grouping and page are absent.

- [ ] **Step 4: Implement resilient draft state**

Persist only non-sensitive draft metadata and temporary file paths in mini-program storage until submit or logout. Upload each page once; keep successful remote page IDs when another page fails. Final submit uses one idempotency key and does not upload again.

- [ ] **Step 5: Implement touch-friendly grouping UI**

Each group is a card with page thumbnails and large `上移 / 下移 / 拆分 / 合并 / 删除` controls. Use a bottom sticky summary and `确认分组并进入批改`. Do not introduce a pre-grading transcript screen.

- [ ] **Step 6: Run tests, typecheck and build**

```powershell
npm.cmd test -- src/features/upload src/task-pages/upload
npm.cmd run typecheck
npm.cmd run build:weapp
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```powershell
git add mini-program/src/features/upload mini-program/src/task-pages/upload
git commit -m "feat: upload and group essays on mobile"
```

### Task 6: Implement grading progress, explicit retry and the result review queue

**Files:**
- Create: `mini-program/src/task-pages/progress/index.tsx`
- Create: `mini-program/src/task-pages/progress/index.config.ts`
- Create: `mini-program/src/task-pages/progress/index.scss`
- Create: `mini-program/src/task-pages/progress/index.test.tsx`
- Create: `mini-program/src/task-pages/review-queue/index.tsx`
- Create: `mini-program/src/task-pages/review-queue/index.test.tsx`
- Create: `mini-program/src/features/progress/progressModel.ts`
- Create: `mini-program/src/features/progress/progressModel.test.ts`

**Interfaces:**
- Consumes: final essay status model, grading commands and sync notifications.
- Produces: all/processing/review/completed filters and result-level safety queue.

- [ ] **Step 1: Write failing progress-model tests**

Assert exact counts for all seven statuses, safe next action, no start while another local command is pending, failed retry eligibility and manual transition.

- [ ] **Step 2: Write failing page behavior tests**

Test explicit single start, multi-select batch start, duplicate tap protection, fee warning on retry, no automatic retry after socket reconnect, review-ready link, failed/manual action sheet and latest-completed link. Batch start shows the selected count, requires one confirmation and calls the platform batch command once.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/features/progress src/task-pages/progress src/task-pages/review-queue
```

Expected: FAIL because models and pages are absent.

- [ ] **Step 4: Implement progress and review pages**

Use compact cards rather than a wide table. Selection mode adds checkboxes and a safe-area bottom batch action panel without removing any row action. The review queue lists all `review_ready` essays with safe review reasons, score and `进入单篇确认`. It does not contain transcript editing or recognition confidence.

- [ ] **Step 5: Run tests, typecheck and build**

```powershell
npm.cmd test -- src/features/progress src/task-pages/progress src/task-pages/review-queue
npm.cmd run typecheck
npm.cmd run build:weapp
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```powershell
git add mini-program/src/features/progress mini-program/src/task-pages/progress mini-program/src/task-pages/review-queue
git commit -m "feat: review grading progress on mobile"
```

### Task 7: Implement complete single-essay grading and teacher confirmation

**Files:**
- Create: `mini-program/src/task-pages/essay-result/index.tsx`
- Create: `mini-program/src/task-pages/essay-result/index.config.ts`
- Create: `mini-program/src/task-pages/essay-result/index.scss`
- Create: `mini-program/src/task-pages/essay-result/index.test.tsx`
- Create: `mini-program/src/features/results/ScorePanel.tsx`
- Create: `mini-program/src/features/results/IssuePanel.tsx`
- Create: `mini-program/src/features/results/RevisionPanel.tsx`
- Create: `mini-program/src/features/results/FeedbackPanel.tsx`
- Create: `mini-program/src/features/results/StudentTranscriptSheet.tsx`
- Create: `mini-program/src/features/results/results.test.tsx`

**Interfaces:**
- Consumes: composed versioned result and result/transcript/confirm/material commands.
- Produces: mobile equivalents of `评分诊断 / 问题批改 / 全文优化 / 教师反馈`.

- [ ] **Step 1: Write failing result behavior tests**

Cover score editing and total recomputation, language and structured logic cards, legibility default-error card, certain spelling ordered last, source quote location, corrected/improved/sentence-pair tabs, comment edits, class-material toggle and confirm.

- [ ] **Step 2: Write failing transcript-edit tests**

Open a full-screen sheet, show `学生原文` and `识图说明`, edit/save with the current essay version, verify the current result disappears, and show `请显式重新批改`. A 409 displays the conflict sheet and keeps the local draft unsent.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/features/results src/task-pages/essay-result
```

Expected: FAIL because result UI is absent.

- [ ] **Step 4: Implement the layered result interface**

Keep score summary at top, horizontally scrollable four-tab selector, one active panel and a safe-area bottom bar with `原卷 / 保存调整 / 确认完成`. Do not render all dense website panels simultaneously.

- [ ] **Step 5: Implement teacher decisions with version guards**

Score/comment edits save as result overrides; legibility `按正确处理` saves the server decision; transcript text changes use the invalidation endpoint. Confirmation uses the latest essay version and current result ID.

- [ ] **Step 6: Run tests, typecheck and build**

```powershell
npm.cmd test -- src/features/results src/task-pages/essay-result
npm.cmd run typecheck
npm.cmd run build:weapp
```

Expected: PASS.

- [ ] **Step 7: Commit Task 7**

```powershell
git add mini-program/src/features/results mini-program/src/task-pages/essay-result
git commit -m "feat: complete essay review in mini program"
```

### Task 8: Implement full-screen original paper gestures and persisted touch annotations

**Files:**
- Create: `mini-program/src/task-pages/original-paper/index.tsx`
- Create: `mini-program/src/task-pages/original-paper/index.config.ts`
- Create: `mini-program/src/task-pages/original-paper/index.scss`
- Create: `mini-program/src/task-pages/original-paper/index.test.tsx`
- Create: `mini-program/src/features/annotations/geometry.ts`
- Create: `mini-program/src/features/annotations/geometry.test.ts`
- Create: `mini-program/src/features/annotations/AnnotationCanvas.tsx`
- Create: `mini-program/src/features/annotations/AnnotationCanvas.test.tsx`
- Create: `mini-program/src/features/annotations/gestureController.ts`
- Create: `mini-program/src/features/annotations/gestureController.test.ts`

**Interfaces:**
- Consumes: normalized annotation DTOs and CRUD routes.
- Produces: zoom/pan and `highlight | freehand | text` touch annotations.

- [ ] **Step 1: Write failing coordinate tests**

Test device-pixel ratio, contain-fit image bounds, pan/zoom transforms, 0–1 conversion, clamping, page switching and round-trip rendering within one physical pixel.

- [ ] **Step 2: Write failing gesture-state tests**

One finger draws only in annotation mode; two fingers pinch/zoom and never create a stroke; pan is bounded; switching tools commits/cancels correctly; duplicate save is locked; 409 keeps the remote annotation and offers refresh.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/features/annotations src/task-pages/original-paper
```

Expected: FAIL because geometry and workspace are absent.

- [ ] **Step 4: Implement the mobile paper workspace**

Use a full-screen image stage with a Canvas overlay, page thumbnail strip, tool palette and collapsible annotation list. Convert all saved geometry to normalized coordinates; never save screen pixels.

- [ ] **Step 5: Persist annotation actions**

Create uses idempotency key; update/delete uses annotation version. Load annotations per page. Website-created annotations must render identically; mini-created annotations must appear on website after sync.

- [ ] **Step 6: Run tests, typecheck and build**

```powershell
npm.cmd test -- src/features/annotations src/task-pages/original-paper
npm.cmd run typecheck
npm.cmd run build:weapp
```

Expected: PASS.

- [ ] **Step 7: Commit Task 8**

```powershell
git add mini-program/src/features/annotations mini-program/src/task-pages/original-paper
git commit -m "feat: annotate original papers by touch"
```

### Task 9: Complete classes, class review, exports and file forwarding

**Files:**
- Create: `mini-program/src/class-pages/detail/index.tsx`
- Create: `mini-program/src/class-pages/detail/index.test.tsx`
- Create: `mini-program/src/task-pages/class-review/index.tsx`
- Create: `mini-program/src/task-pages/class-review/index.test.tsx`
- Create: `mini-program/src/pages/exports/index.tsx`
- Create: `mini-program/src/pages/exports/index.test.tsx`
- Create: `mini-program/src/services/exports/exportFileService.ts`
- Create: `mini-program/src/services/exports/exportFileService.test.ts`

**Interfaces:**
- Produces: full class/student CRUD, task history, class insights/materials and export create/preview/download/share.
- Consumes: Platform API class/review/export modules and Taro file APIs.

- [ ] **Step 1: Write failing class and review tests**

Class detail supports rename/archive, student add/edit/remove, task history and opening a task. Class review provides score overview, distribution, selected materials, grammar, logic, typical sentences and rewrite exercises with source navigation.

- [ ] **Step 2: Write failing export service tests**

```ts
const localPath = await exportFileService.download(exportJob)
await exportFileService.preview(localPath, 'pdf')
await exportFileService.share(localPath, '任务-作文1.pdf')

expect(Taro.downloadFile).toHaveBeenCalledTimes(1)
expect(Taro.openDocument).toHaveBeenCalledWith(expect.objectContaining({ showMenu: true }))
expect(Taro.shareFileMessage).toHaveBeenCalledWith(expect.objectContaining({ filePath: localPath }))
```

Cover non-200 download, wrong MIME, expired URL refresh, file larger than the server limit and unavailable share capability with a clear fallback message.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/class-pages/detail src/task-pages/class-review src/pages/exports src/services/exports
```

Expected: FAIL because pages and service are absent.

- [ ] **Step 4: Implement class and class-review pages**

Use separate tabs for overview, teacher selections, frequent issues and rewrite practice. Preserve server ordering and only count confirmed essays. Student mutations use idempotency/version guards.

- [ ] **Step 5: Implement export lifecycle and file actions**

Create jobs explicitly, show queued/running/completed/failed, refresh from sync, obtain a fresh download URL, call `Taro.downloadFile`, preview via `Taro.openDocument({ showMenu: true })`, and forward via `Taro.shareFileMessage` with a local temp path.

- [ ] **Step 6: Run tests, typecheck and build**

```powershell
npm.cmd test -- src/class-pages/detail src/task-pages/class-review src/pages/exports src/services/exports
npm.cmd run typecheck
npm.cmd run build:weapp
```

Expected: PASS.

- [ ] **Step 7: Commit Task 9**

```powershell
git add mini-program/src/class-pages mini-program/src/task-pages/class-review mini-program/src/pages/exports mini-program/src/services/exports
git commit -m "feat: complete mobile classes review and exports"
```

### Task 10: Prove website–mini-program functional parity and prepare WeChat acceptance

**Files:**
- Create: `mini-program/src/parity/featureManifest.ts`
- Create: `mini-program/src/parity/featureManifest.test.ts`
- Create: `mini-program/src/e2e/teacherWorkflow.test.ts`
- Create: `docs/mini-program-operations.md`
- Create: `docs/mini-program-parity.md`
- Modify: `README.md`
- Modify: `docs/current_development_status.md`

**Interfaces:**
- Consumes: every preceding mini-program task and the shared Platform API.
- Produces: explicit, machine-checked parity inventory and release handoff.

- [ ] **Step 1: Define the exact parity manifest**

```ts
export const teacherFeatureManifest = [
  'workbench', 'task_create', 'rubric_edit', 'task_manage',
  'essay_capture', 'essay_group', 'essay_order', 'grading_queue',
  'grading_retry', 'manual_processing', 'review_queue', 'single_review',
  'transcript_edit', 'score_edit', 'logic_review', 'legibility_decision',
  'full_revision', 'teacher_feedback', 'result_confirm',
  'original_paper', 'paper_annotations', 'class_review',
  'class_manage', 'student_manage', 'task_history',
  'export_create', 'export_preview', 'export_download', 'export_share',
  'grading_settings', 'cross_device_sync', 'version_conflict',
] as const
```

Map every feature to one website route/test and one mini-program route/test. The test fails if either side is missing.

- [ ] **Step 2: Add an application-level synthetic teacher workflow test**

Using `@tarojs/test-utils-react` and a fake Platform client, log in, create task, upload/group pages, start grading, receive sync, review/edit/confirm, add annotation/material, open class review, create/export/share and verify a simulated website version conflict.

- [ ] **Step 3: Run the complete mini-program matrix**

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build:weapp
```

Expected: all commands exit 0.

- [ ] **Step 4: Run shared backend and website regressions**

```powershell
Set-Location ..\packages\contracts
npm.cmd test
npm.cmd run typecheck
Set-Location ..\..\platform-api
npm.cmd test
npm.cmd run typecheck
Set-Location ..\app
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Expected: all commands exit 0.

- [ ] **Step 5: Verify in WeChat Developer Tools on real device sizes**

Import `mini-program/dist`, configure the approved AppID and HTTPS/WSS request domains, then verify login, camera/album permissions, multi-page upload, progress sync, result tabs, transcript edit/regrade, two-finger zoom, touch annotation, Word/PDF preview, file forwarding, class/student edits and settings on one iOS and one Android device class.

- [ ] **Step 6: Verify cross-device consistency**

Open the website and mini program under the same teacher. Make one score edit, transcript edit, annotation, class material selection and settings edit on alternating clients. Confirm WebSocket refresh, durable cursor recovery after backgrounding, version conflict on a deliberate stale write and no silent overwrite.

- [ ] **Step 7: Document release operations and privacy checks**

Document AppID/domain configuration, environment names, build command, upload/review workflow, API health requirements, privacy declaration inputs, permission prompts, logging policy, failure handling and rollback. Do not include secret values or real student data.

- [ ] **Step 8: Inspect scope and commit Task 10**

```powershell
git diff --check
git status --short
git add mini-program/src/parity mini-program/src/e2e docs/mini-program-operations.md docs/mini-program-parity.md README.md docs/current_development_status.md
git commit -m "test: verify website and mini program parity"
```

---

## Plan Self-Review

- Spec coverage: 工作台、任务、评分标准、上传分组、队列、重试、人工处理、待确认、单篇结果、原文、原卷批注、班级讲评、班级学生、导出和设置均有页面与测试。
- Placeholder scan: 页面路径、服务接口、移动交互、版本规则、测试命令和验收设备类别均已明确。
- Type consistency: 小程序只消费 `@writewise/contracts`；Essay 状态、结果字段、批注 geometry、版本和错误码与 Platform API 相同。
- Full parity: `featureManifest` 将网站与小程序逐项绑定，防止把移动端悄悄降级为查看器。
- Platform adaptation: 网站布局不被复制；小程序用全屏、Tab、底部栏、触控和手势实现同一能力。
- Cost and conflict safety: 网络重连只恢复读取；付费调用不自动重试；409 永远要求刷新或重新应用修改。
- Product boundary: 只建设教师小程序，不包含学生端、家长端或独立桌面软件。
