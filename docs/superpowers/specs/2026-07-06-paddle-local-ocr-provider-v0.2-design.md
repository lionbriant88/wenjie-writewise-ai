# PaddleOCR 本地真实 OCR Provider 接入 v0.2 设计规格

日期：2026-07-06

## Goal

阶段三 v0.2 在已经完成的“真实 OCR Gateway 接入 v0.1”之上，接入第一个真实 OCR provider：本地 PaddleOCR。

本轮目标不是建设完整 OCR 平台，也不是把 PaddleOCR 定为最终唯一方案，而是用免费、本地、无云端密钥的方式验证真实链路：

```text
真实作文图片 -> OCR Gateway -> PaddleOCR runner -> 统一 OcrEssayResult -> OCR 草稿区 -> 教师编辑确认 -> 批改队列
```

PaddleOCR 只存在于 OCR Gateway 内部。前端继续只知道 `mock` / `real` 两种 OCR mode，不出现 PaddleOCR、Python runner、`paddle_local` 或 provider-specific 逻辑。

## Current Baseline

当前项目已经完成 v0.1 OCR Gateway 链路：

- `UploadPage` 可以选择 mock OCR / real OCR。
- real OCR 通过 frontend OCR Client 调用本地 OCR Gateway。
- Gateway 已有 `mock` provider 和 `mock_failure` provider。
- OCR 成功后回填现有可编辑 OCR 草稿区。
- OCR 失败后支持使用 mock 草稿或手动输入。
- 教师确认 OCR 后继续进入现有批改队列。

因此 v0.2 不改上传整理页主流程，只在 Gateway 内部新增 `paddle_local` provider。

## Non-Goals

本轮明确不做：

- 不接腾讯、百度、OpenAI 或其他云 OCR。
- 不接真实 AI 批改。
- 不做 OCR 坐标、bbox、版面结构或原卷图片区域高亮。
- 不做图片批注联动。
- 不解析 PDF、Word 或文件夹。
- 不接扫描仪、摄像头或希沃展台。
- 不做云服务器部署。
- 不做账号系统、数据库或任务队列。
- 不删除 `mock` OCR。
- 不删除 `mock_failure` provider。
- 不把临时图片长期保存。
- 不在教师端 UI 暴露 PaddleOCR 配置、Python 环境检测或模型下载管理。

## Recommended Approach

采用 Gateway 内部 provider adapter + 可注入 Python runner 的方案：

```text
UploadPage
-> frontend OCR Client
-> remoteOcrClient
-> OCR Gateway
-> paddleLocalOcrProvider
-> PaddleRunner
-> scripts/paddle_ocr_runner.py
-> PaddleOCR
-> unified OcrEssayResult
```

自动化测试以 fake runner 为主，不强依赖当前开发机或 CI 已安装 PaddleOCR。真实 PaddleOCR 运行只作为本地 smoke test 和样本评测，不作为必须自动跑通的测试门槛。

不采用 Node 直接 import PaddleOCR，也不在前端增加 OCR 引擎选择 UI。

## Provider Naming

Gateway provider 增加：

```env
OCR_PROVIDER=paddle_local
```

保留：

```env
OCR_PROVIDER=mock
OCR_PROVIDER=mock_failure
```

`mock` 用于日常开发和 fallback；`mock_failure` 用于稳定验证失败路径。

## Environment

Gateway 侧新增非密钥配置：

```env
PORT=8787
OCR_PROVIDER=mock
OCR_TIMEOUT_MS=30000

# PaddleOCR local provider
# OCR_PROVIDER=paddle_local
# PADDLE_OCR_PYTHON=python
# PADDLE_OCR_LANG=en
# PADDLE_OCR_TIMEOUT_MS=60000
```

规则：

- `OCR_PROVIDER=paddle_local` 时启用 PaddleOCR provider。
- `PADDLE_OCR_PYTHON` 指向 Python 命令或虚拟环境里的 Python 路径。
- `PADDLE_OCR_LANG` 默认 `en`，优先识别高中英语作文。
- `PADDLE_OCR_TIMEOUT_MS` 默认 60000，避免 OCR 进程卡死。
- 这些变量只能存在于 `ocr-gateway` 环境中。
- `app/src` 仍然只允许读取 `VITE_OCR_MODE` 和 `VITE_OCR_API_BASE`。

## Gateway Design

新增文件：

- `ocr-gateway/src/providers/paddleLocalOcrProvider.ts`
- `ocr-gateway/src/providers/paddleRunner.ts`
- `ocr-gateway/src/providers/paddleLocalOcrProvider.test.ts`
- `ocr-gateway/scripts/paddle_ocr_runner.py`
- `ocr-gateway/requirements.txt`
- `docs/ocr_provider_evaluation_paddle_v02.md`

`paddleLocalOcrProvider` 职责：

- 接收 `GatewayRecognizeInput`。
- 使用 `fs.mkdtemp` + `os.tmpdir()` 为本次请求创建 `wenjie-paddle-ocr-*` 临时目录。
- 将每页图片 buffer 写入临时图片文件。
- 将图片、manifest、output JSON 都放在该临时目录。
- 生成 manifest，包含 `essayGroupId`、`pageId`、临时图片路径、原始文件名。
- 调用可注入 `PaddleRunner`。
- 读取 runner 输出 JSON。
- 转换为 `OcrPageResult[]`。
- 调用现有 `normalizeProviderResult` 生成统一 `OcrEssayResult`。
- 必须在 `finally` 中清理整个临时目录。
- Python 环境缺失、PaddleOCR 未安装、runner 超时、输出非法 JSON 或 provider 抛异常时，返回统一 failed result，不让 Gateway 崩溃。

临时文件规则：

- 只用于本次 OCR 调用。
- 目录名使用 `wenjie-paddle-ocr-*` 前缀。
- 不写数据库。
- 不上传对象存储。
- 不长期保存原图。
- 不把本地路径返回给前端。
- 成功、部分失败、整体失败、runner 抛异常、runner 超时都必须触发目录清理。

## Runner Boundary

TypeScript runner 使用可注入边界：

```ts
export interface PaddleRunner {
  run(manifestPath: string, outputPath: string, timeoutMs: number): Promise<void>
}
```

生产 runner 调用协议固定为：

```powershell
python scripts/paddle_ocr_runner.py --manifest <manifestPath> --output <outputPath> --lang <lang>
```

Node 侧调用 Python 时必须使用 `child_process.spawn`：

- 不使用 `exec`。
- 不拼接 shell 字符串。
- 不使用 `shell: true`。
- Python 命令、脚本路径和参数都通过数组传递，保证 Windows 路径安全。
- runner 超时后必须 kill Python 子进程，并返回统一 failed `OcrEssayResult`。
- 不允许 Python 子进程在超时后残留。

生产 runner 调用 Python 脚本。测试 runner 不调用真实 Python，而是模拟：

- 成功输出 JSON。
- 输出非法 JSON。
- 抛异常。
- 超时。
- 某页空文本。
- 多页结果乱序。

这样可以验证 Gateway provider 行为，而不把自动化测试绑定到 PaddleOCR 安装状态。

## Python Runner Design

`paddle_ocr_runner.py` 职责：

- 通过 `--manifest <manifestPath>` 读取 manifest JSON。
- 通过 `--output <outputPath>` 写入结构化 JSON。
- 通过 `--lang <lang>` 接收 OCR language。
- 初始化 PaddleOCR。
- 按 manifest 中页面顺序逐页识别。
- 提取每页文本，尽量保留行顺序。
- 输出结构化 JSON 到 output file。
- 普通日志写 stderr，不写 stdout，避免 stdout 被 PaddleOCR 日志污染。
- 出错时输出结构化错误到 output file，不让 Node 解析混乱日志。

成功输出：

```json
{
  "pages": [
    {
      "pageId": "page-1",
      "text": "recognized text",
      "confidence": 0.82,
      "warnings": []
    }
  ]
}
```

整体失败输出：

```json
{
  "error": "PaddleOCR failed or not installed"
}
```

部分页失败输出：

```json
{
  "pages": [
    {
      "pageId": "page-1",
      "text": "",
      "warnings": ["paddle_page_failed"]
    },
    {
      "pageId": "page-2",
      "text": "recognized text"
    }
  ]
}
```

某页失败时该页 `text` 为空，`warnings` 包含 `paddle_page_failed`。不要因为一页失败就必然让整篇 failed；最终 `success` / `partial` / `failed` 交给 `normalizeProviderResult` 按页面结果判断。

`confidence` 轻量处理：

- 如果能从 PaddleOCR 拿到行级置信度，取平均值作为页面 `confidence`。
- 如果拿不到，省略 `confidence`。
- 不要因为 `confidence` 缺失或解析失败阻断 `text` 返回。

v0.2 不返回 bbox、line coordinates、word coordinates 或版面结构。

## Normalization Rules

继续复用现有 `normalizeProviderResult`：

- 多页作文必须按 `GatewayRecognizeInput.pages` 顺序合并。
- 不按文件上传顺序。
- 不按 provider 返回顺序。
- 不按 `pageId` 字符串排序。
- 某页失败但其他页成功，返回 `partial`。
- 全部失败，返回 `failed`。
- 全部成功但文本为空，返回 `success` 并带 `empty_text` warning。
- 前端看到 `empty_text` 时，继续提示“识别结果为空，请检查图片或手动输入。”

如果 PaddleOCR 整体失败，返回统一 failed result：

```json
{
  "essayGroupId": "group-id",
  "text": "",
  "pages": [],
  "provider": "remote",
  "status": "failed",
  "error": "PaddleOCR 识别失败，请使用 mock 草稿或手动输入。"
}
```

如果 Python 命令不存在、PaddleOCR 未安装或模型加载失败，返回统一环境错误：

```json
{
  "essayGroupId": "group-id",
  "text": "",
  "pages": [],
  "provider": "remote",
  "status": "failed",
  "error": "PaddleOCR 本地环境未就绪，请检查 Python 依赖，或使用 mock 草稿 / 手动输入。"
}
```

不要把 Python traceback、系统路径、完整环境变量、命令行参数或内部堆栈返回给前端。

## Frontend Boundary

`UploadPage` 不需要知道 PaddleOCR。

继续支持：

- mock OCR。
- real OCR。
- OCR running。
- OCR success。
- OCR failed。
- 使用 mock 草稿。
- 手动输入 OCR 文本。
- 重试 OCR。
- 教师编辑 OCR 草稿。
- 确认 OCR 后进入批改队列。

本轮不新增：

- PaddleOCR 配置 UI。
- OCR 引擎选择 UI。
- Python 环境检测 UI。
- 模型下载 UI。
- 真实 provider 名称展示 UI。

`app/src` 生产代码仍然不能出现 PaddleOCR、`paddle_local`、`PADDLE_OCR`、Python runner 或其他 provider-specific 逻辑。PaddleOCR 只允许存在于 `ocr-gateway` 内部和文档中。

## Testing

Gateway 测试重点：

- `OCR_PROVIDER=mock` 时原有 mock provider 仍可用。
- `OCR_PROVIDER=mock_failure` 时失败路径仍可用。
- `OCR_PROVIDER=paddle_local` 可选择 PaddleOCR provider。
- fake runner 成功输出时返回统一 `OcrEssayResult`。
- fake runner 某页空文本时返回 `empty_text` warning。
- fake runner 某页失败时保留 `paddle_page_failed` warning，并由 normalize 生成正确状态。
- fake runner 多页乱序输出时，最终文本仍按输入页顺序合并。
- fake runner 输出非法 JSON 时返回统一 failed result。
- fake runner 抛异常或超时时返回统一 failed result。
- runner 超时后会 kill Python 子进程。
- 临时文件成功后清理。
- 临时文件失败后清理。
- provider 异常不会让 Gateway 崩溃。
- 自动化测试继续以 fake runner 为主，不要求当前机器安装 PaddleOCR，不要求 `npm test` 真实调用 PaddleOCR。

前端测试以回归为主：

- real OCR 成功后仍进入 OCR 草稿。
- real OCR 失败后仍显示 mock 草稿和手动输入。
- mock OCR 回归通过。
- 确认 OCR 后仍进入现有批改队列。
- `app/src` 生产代码不出现 PaddleOCR、`paddle_local`、`PADDLE_OCR` 或 Python runner 细节。

## Sample Evaluation Document

新增 `docs/ocr_provider_evaluation_paddle_v02.md`，用于记录真实学生作文图片评测，不把评测结果硬编码进产品逻辑。

该文档只做评测记录，不做评测页面、dashboard、图表或产品功能。

文档包含：

- 评测目的。
- 样本数量。
- 样本分类：清晰字迹、一般字迹、潦草字迹、拍照歪斜、光线较暗、有涂改、多页作文。
- 评测维度：漏行、乱序、错词、段落保留、标点和大小写、潦草字迹表现、涂改表现、教师修改量、是否适合进入后续 AI 批改。
- 记录表格：图片编号、字迹类型、OCR 输出是否完整、漏行情况、乱序情况、明显错词数量、是否需要大量人工修改、是否可进入 AI 批改、备注。
- 结论占位：PaddleOCR 是否足以作为开发期 provider，是否需要引入云 OCR 或视觉大模型对比，是否需要图片预处理。

## Verification Commands

Gateway：

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd test
npm.cmd run typecheck
```

Frontend：

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/services/ocr
npm.cmd test -- src/pages/UploadPage.test.tsx
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

安全扫描：

```powershell
cd D:\wenjie-writewise-ai
rg "PaddleOCR|paddle_local|PADDLE_OCR|OCR_SECRET|OCR_API_KEY|OPENAI_API_KEY|TENCENT|BAIDU" app/src --glob "!**/*.test.*"
```

期望：`app/src` 生产代码没有 provider-specific 匹配。

本地 smoke test 可选执行，不作为自动化测试门槛：

```powershell
cd D:\wenjie-writewise-ai\ocr-gateway
$env:OCR_PROVIDER='paddle_local'
$env:PADDLE_OCR_PYTHON='python'
$env:PADDLE_OCR_LANG='en'
npm.cmd run dev
```

## Acceptance Criteria

- `OCR_PROVIDER=mock` 时，原有 Gateway mock OCR 正常。
- `OCR_PROVIDER=mock_failure` 时，失败回退正常。
- `OCR_PROVIDER=paddle_local` 时，Gateway 会走 PaddleOCR provider。
- PaddleOCR provider 通过 runner 输出生成统一 `OcrEssayResult`。
- 成功结果能回填现有 OCR 草稿区。
- 老师可以编辑 OCR 草稿。
- 确认 OCR 后仍进入现有批改队列。
- PaddleOCR 环境缺失或执行失败时，返回统一 failed result，不让 Gateway 崩溃。
- OCR 失败后仍可使用 mock 草稿或手动输入。
- 前端 `app/src` 不出现 PaddleOCR 或 provider-specific 逻辑。
- `mock` 和 `mock_failure` provider 保持可用。
- 新增 PaddleOCR 样本评测文档。
