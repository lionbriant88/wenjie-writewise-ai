# 真实 OCR Gateway 接入 v0.1 设计规格

日期：2026-07-04

## Goal

阶段三第一刀选择“真实 OCR 接入 v0.1”。目标不是建设完整后端平台，也不是绑定某个 OCR 厂商，而是在现有上传整理页和 OCR mock 流程之上，建立一条可替换、可回退、不会泄露密钥的 OCR 适配链路。

本轮要让老师在上传作文图片并完成作文组整理后，可以选择 mock OCR 或 real OCR。real OCR 由前端统一 OCR Client 调用最小 OCR Gateway，Gateway 再调用具体 provider，并返回统一 OCR JSON。OCR 成功后回填现有可编辑 OCR 草稿区；OCR 失败时显示错误，并允许回退到 mock 草稿或手动编辑。教师确认 OCR 后，继续进入现有批改队列。

v0.1 第一版的 real OCR 链路先使用 Gateway mock provider 跑通，不要求立刻接入腾讯、百度、OpenAI、PaddleOCR 或其他真实厂商。也就是说，即使本地没有任何真实 OCR 密钥，`前端 real OCR -> Gateway -> 统一 OCR JSON -> UploadPage OCR 草稿区` 这条链路也必须可测。

## Current Baseline

当前产品已经完成：

- 创建任务与本任务评分标准确认。
- 上传整理页图片导入、模拟图片、图片排序、删除。
- 一张一篇、每 2 张一篇、混合页数作文组整理。
- OCR mock 草稿生成、可编辑、确认后进入批改队列。
- 批改队列、单篇详情页、班级总览素材池。
- 上传整理页多来源导入入口占位。

因此本轮不重写上传整理流程。真实 OCR 必须适配现有“作文组 -> OCR 草稿 -> 教师确认 -> 批改队列”的主链路。

## Non-Goals

本轮不做：

- 不接真实 AI 批改。
- 不解析 PDF、Word 或文件夹。
- 不接扫描仪、摄像头或希沃展台。
- 不做 OCR 坐标、版面结构、表格结构或原卷图片区域高亮。
- 不做原卷批注联动。
- 不做任务队列、数据库、账号系统或复杂权限。
- 不做云服务器部署。
- 不把任何 OCR provider 的返回结构写进 `UploadPage`。
- 不在浏览器端保存或读取任何 OCR API key。

## Security Boundary

这是本轮最重要的边界。

前端只能知道非密钥配置：

```env
VITE_OCR_MODE=mock | real
VITE_OCR_API_BASE=http://localhost:xxxx
```

说明：

- Vite 只有 `VITE_` 前缀变量会暴露给浏览器，所以前端配置必须只放非敏感值。
- 前端可以知道“当前使用 mock 还是 real”。
- 前端可以知道“OCR Gateway 的 base URL”。
- 前端不能知道任何 provider 名称、provider key、secret id、secret key、OpenAI key、百度 key、腾讯 key 或其他云服务密钥。

Gateway 才能知道 provider 与密钥。v0.1 代码优先支持 `mock` 与 `mock_failure`，真实 provider 值只作为后续扩展方向：

```env
OCR_PROVIDER=mock | mock_failure
OCR_SECRET_ID=xxx
OCR_SECRET_KEY=xxx
OCR_API_KEY=xxx
OCR_ENDPOINT=xxx
OCR_TIMEOUT_MS=30000
```

前端严禁出现：

- `OCR_SECRET`
- `OCR_SECRET_ID`
- `OCR_SECRET_KEY`
- `OCR_API_KEY`
- `TENCENT_SECRET`
- `BAIDU_SECRET`
- `OPENAI_API_KEY`
- `OCR_PROVIDER=tencent | baidu | paddle | vision_llm`
- provider SDK import
- provider-specific request or response mapping

前端只表达一件事：我要识别这组作文图片。Gateway 才决定这次到底由哪个 OCR provider 完成识别。

## Architecture

本轮新增两层。

### Frontend OCR Client

建议目录：

```text
app/src/services/ocr/
  types.ts
  mockOcrClient.ts
  remoteOcrClient.ts
  normalizeOcrResult.ts
  ocrClient.ts
```

职责：

- 定义统一 OCR 输入与输出类型。
- 保留 mock OCR 能力。
- 新增 remote OCR 调用能力。
- 将 OCR Gateway 返回值 normalize 成页面可用的统一结构。
- 向 `UploadPage` 暴露稳定接口。

`UploadPage` 不关心底层 provider，只关心：

- 当前 OCR mode。
- 当前 OCR status。
- 当前作文组 OCR 结果。
- 成功后如何生成 OCR 草稿。
- 失败后如何回退。

### OCR Gateway

建议新增最小目录：

```text
ocr-gateway/
  package.json
  src/
    server.ts
    types.ts
    normalizeOcrResult.ts
    providers/
      index.ts
      providerTypes.ts
      mockOcrProvider.ts
      failureOcrProvider.ts
```

职责：

- 接收前端上传的图片组。
- 根据服务端环境变量选择 provider。
- v0.1 先调用 Gateway mock provider 或受控失败 provider。
- 将 provider 原始结果转换为统一 OCR JSON。
- 返回 success、partial 或 failed。
- 捕获 provider 错误，返回可展示错误，不让 Gateway 崩溃。
- 对上传输入做基础限制。

Gateway 是最小代理，不承担：

- 用户认证。
- 数据持久化。
- 队列调度。
- 文件长期存储。
- 对象存储上传。
- AI 批改。
- PDF / Word 解析。

如果使用 `multer` 或同类 multipart 解析库，v0.1 优先使用 memory storage。图片只用于本次识别，不写数据库，不保存历史文件，不上传对象存储。

## Gateway Input Limits

Gateway v0.1 必须限制输入，避免把最小代理变成无限制文件入口。

允许的图片类型：

- `image/png`
- `image/jpeg`
- `image/webp`

必须拒绝：

- PDF、Word、文件夹、压缩包。
- 非图片 MIME type。
- 超过单张大小限制的图片。
- 超过单次 OCR 页数限制的请求。

建议默认限制：

```ts
const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024
const MAX_PAGES_PER_REQUEST = 10
```

超限时 Gateway 返回统一 `failed` 结构和可展示错误，不返回 provider 原始异常，也不进入 provider 调用。

## Unified Types

前端与 Gateway 共享语义，但不要求共享同一个包。v0.1 可以先在两侧各自定义同名类型，保持字段一致。

```ts
export type OcrProviderName = 'mock' | 'remote'

export type OcrStatus = 'success' | 'partial' | 'failed'

export type OcrPageResult = {
  pageId: string
  text: string
  confidence?: number
  warnings?: string[]
}

export type OcrEssayResult = {
  essayGroupId: string
  text: string
  pages: OcrPageResult[]
  provider: OcrProviderName
  status: OcrStatus
  error?: string
}
```

前端请求建议使用 `FormData`，因为当前上传整理页持有的是浏览器 `File` 与本地预览 URL。v0.1 只提交图片文件，不提交 PDF、Word 或文件夹。

```ts
type OcrEssayRequest = {
  essayGroupId: string
  pages: Array<{
    pageId: string
    file: File
  }>
}
```

Gateway HTTP API 建议：

```text
POST /ocr/recognize
GET /health
```

`POST /ocr/recognize` 返回：

```ts
type OcrGatewayResponse = {
  results: OcrEssayResult[]
}
```

## OCR Modes

前端提供两个模式：

```ts
type OcrMode = 'mock' | 'real'
```

模式来源：

- 默认从 `import.meta.env.VITE_OCR_MODE` 读取。
- 缺省值为 `mock`，避免没有 Gateway 时阻断开发。
- 页面上可以提供轻量选择，便于开发和验收时在 mock / real 之间切换。

模式行为：

- `mock`：调用 `mockOcrClient`，完全复用现有 mock 草稿体验。
- `real`：调用 `remoteOcrClient`，向 `VITE_OCR_API_BASE` 指向的 Gateway 发起请求。

如果 `real` 模式下没有配置 `VITE_OCR_API_BASE`，前端应显示配置错误，并提供 mock 回退或手动编辑入口。

## UploadPage UX Flow

现有上传整理主流程保持不变。

新增 OCR 状态：

```ts
type OcrRunStatus =
  | 'idle'
  | 'running'
  | 'success'
  | 'failed'
```

交互流程：

```text
上传图片
-> 作文组整理
-> 选择 OCR 模式 mock / real
-> 点击开始 OCR 识别
-> running
-> success: 生成可编辑 OCR 草稿
-> failed: 显示错误，允许回退 mock 草稿或手动输入
-> 教师编辑 OCR 草稿
-> 确认 OCR
-> 进入现有批改队列
```

成功状态：

- 按作文组生成 OCR 草稿。
- 多页作文必须严格按照前端请求中当前作文组的页面顺序合并文本。
- 单页结果保留在 `pages` 中，便于后续 OCR 坐标或逐页诊断扩展。
- OCR 文本为空时不直接静默通过，应显示“识别结果为空，请检查图片或手动输入”。

失败状态：

- 显示 Gateway 返回的错误摘要。
- 不清空已存在的图片、分组和已编辑草稿。
- 提供“使用 mock 草稿”入口。
- 保留手动输入 OCR 文本的路径。
- 如果实现成本低，可以提供“重试 OCR”入口；但 v0.1 的最低要求是 mock 回退与手动输入两条路径都可用。

## Normalization Rules

`normalizeOcrResult` 负责把不同来源压成统一结果。

规则：

- 去掉明显的 `undefined`、`null` 文本字段。
- 保留换行，但避免每个 provider 的碎片结构泄漏到页面。
- 多页作文严格按当前作文组页面顺序合并，不按文件上传顺序、provider 返回顺序或 `pageId` 字符串排序。
- 某页失败但其他页成功时，返回 `partial`，并在失败页或总结果中写入 warning。
- 全部失败时返回 `failed`。
- 全部成功但文本为空时返回 `success` 加 warning，前端仍提示教师核对。

## Provider Adapter Boundary

Gateway 内每个 provider 适配器都实现同一个接口：

```ts
type OcrProvider = {
  recognizePages(input: GatewayOcrRequest): Promise<GatewayOcrProviderResult>
}
```

provider adapter 内部可以处理：

- SDK 或 HTTP 调用。
- provider 鉴权。
- provider 原始响应结构。
- provider 错误码转换。

provider adapter 之外不允许出现 provider 原始结构。`UploadPage`、frontend OCR Client 和 Gateway router 都不应该知道腾讯、百度、PaddleOCR 或 vision LLM 的字段细节。

v0.1 不创建一堆假的真实 provider 实现。代码里优先实现：

- `providerTypes`
- `mockOcrProvider`
- `failureOcrProvider`
- Gateway router

真实 provider adapter 只在文档和接口层预留。后续明确选择具体 OCR provider 后，再接对应 adapter。

## Error Handling

Gateway 错误返回建议：

```ts
type OcrGatewayError = {
  status: 'failed'
  error: string
  provider?: 'remote'
}
```

前端错误展示规则：

- 网络错误：提示无法连接 OCR Gateway，并展示 Gateway base URL。
- 配置错误：提示当前 real OCR 未配置 Gateway。
- provider 错误：展示“识别服务暂时不可用，请稍后重试或使用 mock 草稿 / 手动输入”。
- 空结果：提示教师检查图片清晰度或手动补全文本。

错误文案不展示密钥、请求签名、provider 原始错误堆栈或完整服务端环境变量。

## Testing

### Frontend Unit Tests

新增或更新：

- `app/src/services/ocr/mockOcrClient.test.ts`
- `app/src/services/ocr/remoteOcrClient.test.ts`
- `app/src/services/ocr/normalizeOcrResult.test.ts`
- `app/src/pages/UploadPage.test.tsx`

覆盖：

1. mock OCR 成功返回统一结构。
2. remote OCR 成功返回统一结构。
3. remote OCR 失败返回可展示错误。
4. 空文本结果不会破坏草稿区。
5. 多页作文按页面顺序合并。
6. UploadPage real OCR 成功后进入 OCR 草稿区。
7. UploadPage real OCR 失败后显示回退入口。
8. mock OCR 回归通过。
9. 确认 OCR 后仍进入现有批改队列。

### Gateway Tests

新增：

- Gateway health check。
- Gateway mock provider 成功。
- Gateway failure provider 返回统一 failed 结构。
- Gateway 拒绝非图片 MIME type。
- Gateway 拒绝超出单张图片大小限制。
- Gateway 拒绝超出单次 OCR 页数限制。
- Gateway normalize 多页结果。
- Gateway 不返回 provider secret 或环境变量。

### Security Scans

实现阶段必须增加范围扫描，确认前端源码没有泄露密钥或 provider 细节。建议扫描：

```powershell
cd D:\wenjie-writewise-ai
rg "OCR_SECRET|OCR_SECRET_ID|OCR_SECRET_KEY|OCR_API_KEY|OPENAI_API_KEY|TENCENT|BAIDU|OCR_PROVIDER" app/src --glob "!**/*.test.*"
```

期望结果：

- `app/src` 生产代码中不出现 secret、provider key 或 provider SDK。
- 测试文件可以包含禁用词断言，但不能把真实密钥写入 fixtures。

## Verification Commands

前端局部验证：

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/services/ocr
npm.cmd test -- src/pages/UploadPage.test.tsx
npm.cmd run lint
```

Gateway 验证命令将在 implementation plan 中根据选定运行时确定。优先保持最小 Node/TypeScript 服务，避免引入重型后端框架。

最终验证：

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

如 implementation plan 新增 `ocr-gateway`，还需要补充 Gateway 自身 test、lint 或 typecheck 命令。

## Acceptance Criteria

- 老师上传图片并完成作文组整理后，可以选择 mock OCR 或 real OCR。
- 点击“开始 OCR 识别”后页面进入识别中状态。
- mock OCR 继续保持现有可编辑草稿体验。
- real OCR 即使先走 Gateway mock provider，也能成功生成可编辑 OCR 草稿。
- Gateway 提供受控失败 provider，前端可以稳定测试错误展示、mock 回退和手动输入路径。
- 多页作文 OCR 文本严格按当前作文组页面顺序合并。
- OCR 文本为空时前端提示“识别结果为空，请检查图片或手动输入”。
- OCR 失败后显示错误，并提供 mock 回退或手动输入路径。
- Gateway 只接受 `image/png`、`image/jpeg`、`image/webp`，并限制单张图片大小和单次 OCR 页数。
- Gateway 不长期保存图片，不写数据库，不上传对象存储。
- 确认 OCR 后继续进入现有批改队列。
- `UploadPage` 不包含 provider-specific 逻辑。
- 前端不包含任何 OCR 密钥、provider key、secret key 或 provider SDK。
- Gateway 使用服务端环境变量保存 provider 与密钥。
- Gateway 返回统一 OCR JSON。
- 现有上传整理、OCR mock、批改队列、单篇详情页和班级总览流程不被破坏。

## Implementation Recommendation

v0.1 默认采用最小 Node/Express Gateway。理由是当前项目主体是 Vite/React，Node 服务便于本地启动、测试和与前端一起开发；Express 足够承载 `POST /ocr/recognize` 与 `GET /health`，不需要引入完整后端框架。

实现顺序建议：

1. 先完成 Gateway contract、remote client、UploadPage OCR 状态流和失败回退闭环。
2. Gateway 内保留统一 provider adapter 接口，并提供 mock provider 与受控失败 provider 用于本地测试。
3. 只有在用户明确选择 OCR provider 并提供本地服务端密钥后，才接入对应真实 provider 的最小 adapter。

这样可以确保阶段三第一步先把安全边界和产品主链路打稳，不会把厂商 SDK、密钥策略和上传整理页面搅在一起。
