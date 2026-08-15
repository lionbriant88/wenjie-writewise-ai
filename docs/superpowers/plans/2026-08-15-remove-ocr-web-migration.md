# OCR Retirement and Website State Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将网站和 Grading Gateway 收敛到唯一的“图片直接批改 / 教师确认文本重批”链路，彻底移除活动代码中的 OCR 服务、状态、字段、页面和文案，同时保留学生原文审计层与现有页面布局。

**Architecture:** 先用新领域类型和状态机替换 `ocrText` 兼容模型，再迁移 AppState 和页面，最后删除旧客户端、旧 Gateway 路由与整个 OCR Gateway。活动数据使用 `transcript`、`recognitionWarnings` 和 `vision_model | teacher_confirmed`；历史设计文档保留归档，不参与运行时扫描。

**Tech Stack:** React 19、TypeScript 6、Vite、Vitest 4、Testing Library、Express、Multer。

## Global Constraints

- 唯一作文状态集合为 `uploaded | queued | grading | review_ready | completed | failed | manual`。
- 首次批改必须包含有序图片；教师确认文本重批不得包含图片。
- 批改前不展示或要求确认学生原文，不调用任何独立 OCR 服务。
- 批改后保留学生原文、证据定位、教师修订和显式重批能力。
- 原“异常复核”页面改为“待确认队列”，复用现有路由 `/tasks/:taskId/exceptions` 和主要卡片布局。
- 网站侧边栏、任务流程导航、上传分组、进度表格、详情页左右结构和四个结果 Tab 保持稳定。
- 不删除历史 `docs/superpowers/specs` 和 `docs/superpowers/plans` 中的 OCR 归档记录。
- 不保留 `ocrText`、`ocrConfidence`、`ocrAudit`、`ExceptionReason` 或任何 `pending_ocr` 兼容字段。
- 不保留 `/grading/grade` 旧文本入口；确认文本重批继续使用 `/grading/grade-images` 且图片列表为空。
- 不静默自动发起模型请求或重试可能计费的请求。

---

## File Structure

### Domain and state

- Modify `app/src/types/index.ts`: 新 Essay 字段与状态集合。
- Modify `app/src/context/gradingStateTransitions.ts`: 新状态机。
- Modify `app/src/context/gradingStateTransitions.test.ts`: 全转换矩阵。
- Modify `app/src/context/appStateContextValue.ts`: 删除 mock OCR API，重命名 transcript API。
- Modify `app/src/context/AppStateContext.tsx`: 唯一多模态请求路径。
- Modify `app/src/context/AppStateContext.test.tsx`: 状态、幂等和重批回归。
- Modify `app/src/data/mockData.ts`: 新领域数据。
- Modify `app/src/data/mockData.test.ts`: 禁止 OCR 字段。

### Website UI

- Modify `app/src/pages/UploadPage.tsx` and tests: 只负责图片分组并进入队列。
- Modify `app/src/pages/ProgressPage.tsx` and tests: 新状态与“待确认”入口。
- Modify `app/src/pages/ExceptionsPage.tsx`: 结果级待确认队列。
- Create `app/src/pages/ExceptionsPage.test.tsx`: 队列行为回归。
- Modify `app/src/pages/EssayResultPage.tsx` and tests: `updateEssayTranscript`。
- Modify `app/src/components/EssaySourcePanel.tsx` and tests: “学生原文 / 修订学生原文 / 识图说明”。
- Modify `app/src/components/EssayStatusChip.tsx`: 新状态文案。
- Delete `app/src/components/OcrTextEditor.tsx`.
- Modify `app/src/utils/progress.ts`, `progressQueue.ts`, `workflow.ts` and tests: 新状态聚合。

### Grading clients and Gateway

- Delete `app/src/services/grading/buildGradingRequest.ts` and test.
- Modify `app/src/services/grading/types.ts`: `GradingClient` 只保留 `gradeImages`。
- Modify `app/src/services/grading/remoteGradingClient.ts` and test: 删除 `/grading/grade`。
- Modify `app/src/services/grading/mockGradingClient.ts` and test: 只实现多模态接口。
- Delete `grading-gateway/src/promptBuilder.ts` and test.
- Delete `grading-gateway/src/normalizeGradingResult.ts` and test after moving shared score normalization into multimodal code.
- Delete `grading-gateway/src/validateGradingRequest.ts` and test.
- Delete `grading-gateway/src/providers/deepseekGradingProvider.ts` and test.
- Delete `grading-gateway/src/providers/deepseekTransport.ts` and test.
- Delete `grading-gateway/src/providers/providerTypes.ts`.
- Delete `grading-gateway/src/providers/failureGradingProvider.ts`.
- Modify `grading-gateway/src/providers/index.ts` and test: 只导出多模态 Provider。
- Modify `grading-gateway/src/server.ts` and test: 删除 `/grading/grade`。
- Modify `grading-gateway/src/types.ts`: 删除 `GradingRequestV1.essay.ocrContext` 和旧请求类型。

### OCR deletion and active documentation

- Delete `app/src/services/ocr/` in full.
- Delete `ocr-gateway/` in full.
- Modify `app/.env.example`, `README.md`, `docs/current_development_status.md`, `docs/how_to_create_codex_project_wenjie.md`.

---

### Task 1: Replace OCR-named domain fields and define the final essay status model

**Files:**
- Modify: `app/src/types/index.ts`
- Modify: `app/src/data/mockData.ts`
- Modify: `app/src/data/mockData.test.ts`

**Interfaces:**
- Produces: `EssayStatus = 'uploaded' | 'queued' | 'grading' | 'review_ready' | 'completed' | 'failed' | 'manual'`.
- Produces: `TranscriptSource = 'vision_model' | 'teacher_confirmed'`.
- Produces: `Essay.transcript`, `recognitionWarnings`, `printedTextExcluded` and no OCR fields.
- Consumes: grading policy result fields from the preceding plan.

- [ ] **Step 1: Write a failing domain-shape test**

```ts
for (const essay of mockEssays) {
  expect(essay).toHaveProperty('transcript')
  expect(essay).toHaveProperty('recognitionWarnings')
  expect(essay).not.toHaveProperty('ocrText')
  expect(essay).not.toHaveProperty('ocrConfidence')
  expect(essay).not.toHaveProperty('ocrAudit')
  expect(['uploaded', 'queued', 'grading', 'review_ready', 'completed', 'failed', 'manual'])
    .toContain(essay.status)
}
```

- [ ] **Step 2: Run the mock-data test and verify RED**

```powershell
npm.cmd test -- src/data/mockData.test.ts
```

Expected: FAIL because mock essays still expose OCR fields and old statuses.

- [ ] **Step 3: Replace the exact domain interfaces**

```ts
export type EssayStatus =
  | 'uploaded'
  | 'queued'
  | 'grading'
  | 'review_ready'
  | 'completed'
  | 'failed'
  | 'manual'

export type TranscriptSource = 'vision_model' | 'teacher_confirmed'

export interface Essay {
  id: string
  taskId: string
  essayNumber: string
  pages: EssayPage[]
  pageCount: number
  pageOrder: string[]
  transcript: string
  transcriptSource?: TranscriptSource
  recognitionWarnings: string[]
  printedTextExcluded?: boolean
  status: EssayStatus
  aiResultId?: string
  gradingRun?: GradingRunState
  teacherReviewed: boolean
  createdAt: string
  updatedAt: string
}
```

Delete the `OcrTranscriptAudit` import, `ExceptionReason`, `exceptionReasons`, `ocrText`, `ocrAudit` and `ocrConfidence`.

- [ ] **Step 4: Migrate all tracked mock essays**

Map old `pending_grading` to `queued`, `grading_ready` to `review_ready`, old `needs_review` recognition fixtures to `failed`, and preserve completed/manual states. Copy meaningful mock original text into `transcript`; use `recognitionWarnings: []` unless the fixture demonstrates a result-level warning.

- [ ] **Step 5: Run the test and frontend typecheck to reveal remaining call sites**

```powershell
npm.cmd test -- src/data/mockData.test.ts
npm.cmd run typecheck
```

Expected: mock-data test PASS; typecheck FAIL only at old call sites scheduled in later tasks.

- [ ] **Step 6: Commit Task 1**

```powershell
git add app/src/types/index.ts app/src/data/mockData.ts app/src/data/mockData.test.ts
git commit -m "refactor: rename transcript domain and essay states"
```

### Task 2: Rebuild the grading transition matrix around queued, review-ready and failed

**Files:**
- Modify: `app/src/context/gradingStateTransitions.ts`
- Modify: `app/src/context/gradingStateTransitions.test.ts`

**Interfaces:**
- Produces: `queueEssayTransition`, `beginGradingAttempt`, `settleGradingSuccess`, `settleGradingFailure`, `invalidateGradingAfterTranscriptEdit`, `confirmGradingTransition`, `markEssayManualTransition`.
- Consumes: final `EssayStatus` and `TranscriptSource` from Task 1.

- [ ] **Step 1: Replace transition tests with the final state matrix**

```ts
expect(queueEssayTransition(uploadedEssay, now).essays[0].status).toBe('queued')
expect(beginGradingAttempt([queuedEssay], id, requestId, now).essays[0].status).toBe('grading')
expect(settleGradingSuccess([runningEssay], id, requestId, resultId, response).essays[0].status)
  .toBe('review_ready')
expect(settleGradingFailure([runningEssay], id, requestId, failure, now).essays[0].status)
  .toBe('failed')
expect(confirmGradingTransition([reviewReadyEssay], id, now).essays[0].status)
  .toBe('completed')
```

Add stale request-ID rejection, double start rejection, failed explicit retry, manual override and transcript invalidation from both `review_ready` and `completed`.

- [ ] **Step 2: Run transition tests and verify RED**

```powershell
npm.cmd test -- src/context/gradingStateTransitions.test.ts
```

Expected: FAIL against the old pending/grading-ready model.

- [ ] **Step 3: Implement the exact allowed transitions**

```ts
const allowedStarts = new Set<EssayStatus>(['queued', 'failed'])

export function invalidateGradingAfterTranscriptEdit(
  essays: Essay[],
  essayId: string,
  timestamp: string,
): EssayTransition {
  const target = essays.find((essay) => essay.id === essayId)
  if (!target || !['review_ready', 'completed'].includes(target.status)) {
    return { applied: false, essays }
  }
  return {
    applied: true,
    taskId: target.taskId,
    essays: essays.map((essay) => essay.id === essayId
      ? {
          ...essay,
          status: 'uploaded',
          aiResultId: undefined,
          teacherReviewed: false,
          gradingRun: { status: 'idle' },
          updatedAt: timestamp,
        }
      : essay),
  }
}
```

`uploaded` after a transcript edit means “source is ready but no paid request has been queued.” Only the explicit regrade action calls `queueEssayTransition`.

- [ ] **Step 4: Ensure failure remains a top-level status**

`settleGradingFailure` sets `status: 'failed'` while preserving `gradingRun.errorCode`, safe message, retryable flag and attempt timestamps. Retrying calls `beginGradingAttempt` from `failed`; it never starts automatically.

- [ ] **Step 5: Run transition tests and verify GREEN**

```powershell
npm.cmd test -- src/context/gradingStateTransitions.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```powershell
git add app/src/context/gradingStateTransitions.ts app/src/context/gradingStateTransitions.test.ts
git commit -m "refactor: finalize essay grading state machine"
```

### Task 3: Make AppState use the multimodal client exclusively

**Files:**
- Modify: `app/src/context/appStateContextValue.ts`
- Modify: `app/src/context/AppStateContext.tsx`
- Modify: `app/src/context/AppStateContext.test.tsx`
- Modify: `app/src/services/grading/types.ts`
- Modify: `app/src/services/grading/remoteGradingClient.ts`
- Modify: `app/src/services/grading/remoteGradingClient.test.ts`
- Modify: `app/src/services/grading/mockGradingClient.ts`
- Modify: `app/src/services/grading/mockGradingClient.test.ts`
- Delete: `app/src/services/grading/buildGradingRequest.ts`
- Delete: `app/src/services/grading/buildGradingRequest.test.ts`

**Interfaces:**
- Produces: `enqueueImageEssays`, `queueEssay`, `gradeEssay`, `retryGradeEssay`, `updateEssayTranscript`.
- Produces: `GradingClient.gradeImages(request): Promise<GradingClientResponse>` as the only client method.
- Consumes: `buildMultimodalGradingRequest` for image and confirmed-text modes.

- [ ] **Step 1: Write failing AppState tests for the only two request shapes**

```ts
expect(firstCall.request.pages).toHaveLength(2)
expect(firstCall.request.confirmedTranscript).toBeUndefined()

state.updateEssayTranscript(essayId, 'Teacher-confirmed text', editedAt)
expect(state.essays[0].status).toBe('uploaded')
state.queueEssay(essayId)
await state.gradeEssay(essayId)
expect(secondCall.request.pages).toEqual([])
expect(secondCall.request.confirmedTranscript).toBe('Teacher-confirmed text')
```

Assert duplicate `submissionId`, duplicate starts and the global paid-call lock remain blocked.

- [ ] **Step 2: Write failing remote client tests**

Assert the client object has no `grade` method, never fetches `/grading/grade`, sends ordered pages for first grading, sends no page fields for confirmed-text regrading, and preserves the safe error projection.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/context/AppStateContext.test.tsx src/services/grading/remoteGradingClient.test.ts src/services/grading/mockGradingClient.test.ts
```

Expected: FAIL while legacy text grading and OCR actions remain.

- [ ] **Step 4: Replace the AppState public API**

Delete `ConfirmMockOcrEssayInput`, `confirmMockOcrEssay` and `updateEssayOcrText`. Add:

```ts
queueEssay: (essayId: string) => void
updateEssayTranscript: (essayId: string, transcript: string, confirmedAt?: string) => void
```

`enqueueImageEssays` creates essays in `queued` with empty transcript and warnings. A teacher edit writes `transcriptSource: 'teacher_confirmed'`, clears recognition warnings, invalidates the result and does not call the Provider.

- [ ] **Step 5: Collapse `runGrading` to one builder and one client method**

```ts
const built = buildMultimodalGradingRequest(task, targetEssay, requestId)
if (!built.ok) {
  const completedAt = new Date().toISOString()
  commitEssayTransition(
    recordGradingPreflightFailure(essaysRef.current, essayId, requestId, built.error, completedAt),
    completedAt,
  )
  return
}
const response = await client.gradeImages(built.request)
```

Delete `transcriptPolicy`, `buildGradingRequest`, and `client.grade`. The mock fallback builds the same request and calls a mock implementation of `gradeImages`.

- [ ] **Step 6: Run focused tests and typecheck**

```powershell
npm.cmd test -- src/context/AppStateContext.test.tsx src/services/grading/remoteGradingClient.test.ts src/services/grading/mockGradingClient.test.ts
npm.cmd run typecheck
```

Expected: focused tests PASS; remaining type errors are limited to pages migrated in Task 4.

- [ ] **Step 7: Commit Task 3**

```powershell
git add app/src/context app/src/services/grading app/src/types/index.ts
git commit -m "refactor: use multimodal grading exclusively"
```

### Task 4: Repurpose the existing review flow and update website copy

**Files:**
- Modify: `app/src/pages/UploadPage.tsx`
- Modify: `app/src/pages/UploadPage.test.tsx`
- Modify: `app/src/pages/MultimodalUploadFlow.test.tsx`
- Modify: `app/src/pages/ProgressPage.tsx`
- Modify: `app/src/pages/ProgressPage.test.tsx`
- Modify: `app/src/pages/ExceptionsPage.tsx`
- Create: `app/src/pages/ExceptionsPage.test.tsx`
- Modify: `app/src/components/EssayStatusChip.tsx`
- Modify: `app/src/utils/progress.ts`
- Modify: `app/src/utils/progress.test.ts`
- Modify: `app/src/utils/progressQueue.ts`
- Modify: `app/src/utils/progressQueue.test.ts`
- Modify: `app/src/utils/workflow.ts`
- Modify: `app/src/utils/workflow.test.ts`
- Delete: `app/src/components/OcrTextEditor.tsx`

**Interfaces:**
- Consumes: new status model and AppState actions from Tasks 1–3.
- Produces: result-level “待确认队列” at the existing exceptions route.
- Preserves: upload grouping, progress table and navigation layout.

- [ ] **Step 1: Replace visible-copy and queue tests**

Add assertions that the active pages contain no `/OCR/i` text. Upload submits grouped images directly. Progress tabs are `全部 / 处理中 / 待确认 / 已完成`; failed rows show explicit retry and manual actions.

```ts
expect(screen.getByRole('heading', { name: '待确认队列' })).toBeInTheDocument()
expect(screen.queryByText(/OCR/i)).not.toBeInTheDocument()
expect(screen.getByRole('link', { name: '进入单篇确认' })).toHaveAttribute(
  'href',
  `/tasks/${taskId}/essays/${essayId}`,
)
```

- [ ] **Step 2: Run focused page tests and verify RED**

```powershell
npm.cmd test -- src/pages/UploadPage.test.tsx src/pages/MultimodalUploadFlow.test.tsx src/pages/ProgressPage.test.tsx src/pages/ExceptionsPage.test.tsx src/utils/progress.test.ts src/utils/progressQueue.test.ts src/utils/workflow.test.ts
```

Expected: FAIL against old statuses and the OCR exception editor.

- [ ] **Step 3: Migrate status summaries and chips**

Count `uploaded`, `queued` and `grading` as processing; `review_ready` as review; `completed` as completed; `failed` separately; `manual` as terminal. Use labels `已上传 / 等待批改 / 批改中 / 待确认 / 已完成 / 批改失败 / 人工处理`.

- [ ] **Step 4: Repurpose ExceptionsPage without changing its route**

Filter `review_ready` essays. Show essay number, safe review-reason labels, score/status summary and the existing original-page preview. Remove inline transcript editing. The only primary action is `进入单篇确认`; keep `转人工处理` as secondary.

- [ ] **Step 5: Update Upload and Progress copy**

Use `图片已进入批改队列，可逐篇启动 AI 识图与批改；不会自动并发或重试。` for all tasks. Remove conditional legacy descriptions, OCR states and “mock OCR” actions.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Task 4 test command again. Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```powershell
git add app/src/pages app/src/components/EssayStatusChip.tsx app/src/utils app/src/components/OcrTextEditor.tsx
git commit -m "refactor: turn OCR exceptions into result review queue"
```

### Task 5: Rename the post-grading source panel while preserving evidence linking

**Files:**
- Modify: `app/src/components/EssaySourcePanel.tsx`
- Modify: `app/src/components/EssaySourcePanel.test.tsx`
- Modify: `app/src/pages/EssayResultPage.tsx`
- Modify: `app/src/pages/EssayResultPage.test.tsx`
- Modify: `app/src/pages/DetailNavigation.test.tsx`
- Modify: `app/src/services/grading/adaptAiGradingResult.ts`
- Modify: `app/src/services/grading/adaptAiGradingResult.test.ts`

**Interfaces:**
- Consumes: `Essay.transcript`, `recognitionWarnings`, `printedTextExcluded`, `updateEssayTranscript`.
- Preserves: quote highlighting, issue markers, original-image dialog, teacher edits and explicit regrade invalidation.

- [ ] **Step 1: Write failing neutral-copy tests**

```ts
expect(screen.getByRole('heading', { name: '学生原文' })).toBeInTheDocument()
expect(screen.getByRole('button', { name: '修订学生原文' })).toBeInTheDocument()
expect(screen.queryByText(/OCR|置信度/i)).not.toBeInTheDocument()
```

Assert that a recognition warning appears under `识图说明`, clicking a language/logic marker still scrolls to its exact quote, and saving a transcript edit invalidates the old result.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/components/EssaySourcePanel.test.tsx src/pages/EssayResultPage.test.tsx src/pages/DetailNavigation.test.tsx src/services/grading/adaptAiGradingResult.test.ts
```

Expected: FAIL while the component still reads OCR fields and copy.

- [ ] **Step 3: Replace component props and local state**

Rename `onOcrTextChange` to `onTranscriptChange`; initialize and compare the draft against `essay.transcript`; use `vision_model` for the AI source label. Remove confidence formatting and the `gradingDiagnostics.formatConfidence` dependency.

- [ ] **Step 4: Preserve explicit invalidation copy**

Use `保存修订后，当前批改结果将失效；请返回进度页显式重新批改。` and button text `保存学生原文修订`. Do not queue or call grading from the component.

- [ ] **Step 5: Run focused and full frontend checks**

```powershell
npm.cmd test -- src/components/EssaySourcePanel.test.tsx src/pages/EssayResultPage.test.tsx src/pages/DetailNavigation.test.tsx src/services/grading/adaptAiGradingResult.test.ts
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit Task 5**

```powershell
git add app/src/components/EssaySourcePanel.tsx app/src/components/EssaySourcePanel.test.tsx app/src/pages/EssayResultPage.tsx app/src/pages/EssayResultPage.test.tsx app/src/pages/DetailNavigation.test.tsx app/src/services/grading/adaptAiGradingResult.ts app/src/services/grading/adaptAiGradingResult.test.ts app/src/utils/gradingDiagnostics.ts app/src/utils/gradingDiagnostics.test.ts
git commit -m "refactor: rename OCR review to student transcript"
```

### Task 6: Remove the legacy text grading route and providers

**Files:**
- Modify: `grading-gateway/src/multimodal/normalizeMultimodalResult.ts`
- Modify: `grading-gateway/src/multimodal/normalizeMultimodalResult.test.ts`
- Modify: `grading-gateway/src/providers/index.ts`
- Modify: `grading-gateway/src/providers/index.test.ts`
- Modify: `grading-gateway/src/server.ts`
- Modify: `grading-gateway/src/server.test.ts`
- Modify: `grading-gateway/src/types.ts`
- Delete: `grading-gateway/src/promptBuilder.ts`
- Delete: `grading-gateway/src/promptBuilder.test.ts`
- Delete: `grading-gateway/src/normalizeGradingResult.ts`
- Delete: `grading-gateway/src/normalizeGradingResult.test.ts`
- Delete: `grading-gateway/src/validateGradingRequest.ts`
- Delete: `grading-gateway/src/validateGradingRequest.test.ts`
- Delete: `grading-gateway/src/providers/deepseekGradingProvider.ts`
- Delete: `grading-gateway/src/providers/deepseekGradingProvider.test.ts`
- Delete: `grading-gateway/src/providers/deepseekTransport.ts`
- Delete: `grading-gateway/src/providers/deepseekTransport.test.ts`
- Delete: `grading-gateway/src/providers/providerTypes.ts`
- Delete: `grading-gateway/src/providers/failureGradingProvider.ts`

**Interfaces:**
- Produces: only `POST /tasks/rubric` and `POST /grading/grade-images` business routes.
- Preserves: confirmed-text regrading through `grade-images`.
- Consumes: multimodal normalization and scoring rules only.

- [ ] **Step 1: Write failing route-removal tests**

```ts
await request(app).post('/grading/grade').send(validLegacyRequest()).expect(404)
await request(app)
  .post('/grading/grade-images')
  .field('metadata', JSON.stringify(validConfirmedTextMetadata()))
  .expect(200)
```

Also assert the Provider factory exposes no DeepSeek text provider and that the confirmed-text path invokes `multimodalProvider.gradeEssay` with `pages: []`.

- [ ] **Step 2: Run focused Gateway tests and verify RED**

```powershell
npm.cmd test -- src/server.test.ts src/providers/index.test.ts src/multimodal/normalizeMultimodalResult.test.ts
```

Expected: legacy route still returns a non-404 response.

- [ ] **Step 3: Move remaining common score normalization into the multimodal module**

Create focused internal helpers inside `normalizeMultimodalResult.ts` for dimension completeness, max-score bounds, total recomputation and stable public IDs. Remove construction of `GradingRequestV1` and all `ocrContext` compatibility data.

- [ ] **Step 4: Delete the old route and exact legacy files**

Remove the `/grading/grade` handler and old Provider factory branch. Delete only the paths listed in this task; keep Kimi transport, Kimi multimodal provider, mock multimodal provider and shared scoring rules.

- [ ] **Step 5: Run the full Gateway matrix**

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run verify:shared-scoring-runtime
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit Task 6**

```powershell
git add grading-gateway/src
git commit -m "refactor: remove legacy text grading route"
```

### Task 7: Delete the OCR services and clean active configuration

**Files:**
- Delete: `app/src/services/ocr/`
- Delete: `ocr-gateway/`
- Modify: `app/.env.example`
- Modify: `README.md`
- Modify: `docs/current_development_status.md`
- Modify: `docs/how_to_create_codex_project_wenjie.md`

**Interfaces:**
- Consumes: the clean runtime from Tasks 1–6.
- Produces: no active OCR package, configuration, import, route, UI copy or runtime script.

- [ ] **Step 1: Prove there are no remaining runtime imports before deletion**

```powershell
rg -n "services/ocr|ocr-gateway|VITE_OCR_|OCR_PROVIDER|OCR_API_BASE" app/src grading-gateway/src app/.env.example README.md docs/current_development_status.md docs/how_to_create_codex_project_wenjie.md
```

Expected: matches are limited to the exact files being deleted or edited in this task. If a runtime import remains, migrate it before deleting its dependency.

- [ ] **Step 2: Delete the exact OCR paths**

Remove `app/src/services/ocr` and `ocr-gateway` in full. Do not delete historical design and plan documents under `docs/superpowers`.

- [ ] **Step 3: Remove active OCR configuration and instructions**

Delete `VITE_OCR_MODE`, `VITE_OCR_API_BASE`, OCR health checks, OCR startup commands and statements that OCR is part of the current main flow. Replace the README workflow with:

```text
创建批改任务 → 上传并整理作文图片 → AI 识图与批改 → 待确认 → 单篇结果 → 班级讲评
```

- [ ] **Step 4: Run clean-name scans**

```powershell
rg -n "\bOCR\b|ocrText|ocrConfidence|ocrAudit|pending_ocr|ocr_running|low_ocr_confidence|confirmMockOcrEssay|updateEssayOcrText|/grading/grade\b" app/src grading-gateway/src app/.env.example README.md docs/current_development_status.md docs/how_to_create_codex_project_wenjie.md
```

Expected: zero matches. Archived `docs/superpowers` files are intentionally excluded.

- [ ] **Step 5: Run the final website and Gateway verification**

```powershell
Set-Location grading-gateway
npm.cmd test
npm.cmd run typecheck
npm.cmd run verify:shared-scoring-runtime
Set-Location ..\app
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Expected: all commands exit 0 while no OCR service is present or running.

- [ ] **Step 6: Verify the browser flow with the Gateway only**

Start the Grading Gateway and website. Open task creation, upload/group images, start one explicit grading attempt, inspect the student transcript, edit it, observe result invalidation, explicitly requeue and confirm. Network inspection must show no OCR endpoint and no `/grading/grade` request.

- [ ] **Step 7: Inspect scope and commit Task 7**

```powershell
git diff --check
git status --short
git add app/src/services/ocr ocr-gateway app/.env.example README.md docs/current_development_status.md docs/how_to_create_codex_project_wenjie.md
git commit -m "refactor: retire standalone OCR services"
```

---

## Plan Self-Review

- Spec coverage: OCR 服务、字段、状态、队列、置信度、旧文本入口和活动文档全部有删除步骤；学生原文、证据定位和确认文本重批被明确保留。
- Placeholder scan: 每个迁移步骤都有目标类型、状态、命令和预期结果。
- Type consistency: 页面、AppState 和工具函数统一使用 `uploaded | queued | grading | review_ready | completed | failed | manual`；所有原文接口统一使用 `transcript`。
- Destructive scope: 只删除已列出的 OCR 运行时代码和旧文本批改文件；历史 specs/plans 明确保留。
- Layout constraint: `/exceptions` 路由被复用，上传/进度/详情布局不重做。
- Handoff: 本计划完成后执行 `2026-08-15-shared-platform-backend-and-web-sync.md`，把当前内存状态迁移到双端共享云端。
