# PaddleOCR 本地 Provider 评估记录 v0.2

> 本文档仅用于评估记录与样本观察，不是页面、dashboard、chart 或产品功能说明。

## v0.3a 影子审计与本地私有基准

- 产品已具备不可见的 OCR 转写审计和影子评估基础，但不会在教师 UI 显示质量卡片、建议、徽标或自动放行结果，也不改变确认和入队流程。
- `sourceText` 指现有前端 OCR Client 最终交给 UploadPage、且尚未经过教师编辑的统一来源文本；它不是 PaddleOCR 原始文本、Python stdout 或 Provider 未归一化输出。
- 教师确认后的忠实转写保存在 `confirmedTranscript`，兼容字段 `ocrText` 始终与最新确认转写同步；后续修订不会覆盖 `sourceText`。
- 文本比较统一使用 `ocr-text-metrics-v1`，CER、WER、编辑距离和变更字符数由 Provider 无关的纯函数计算。
- 影子评估使用显式 `expectedPageIds` 与结果 `pageId` 集合差集确认页面结果缺失；文本长度异常不会被直接称为漏行，漏行只能由人工基准转写对比确认。
- 私有评测命令 `npm.cmd run benchmark:private` 是一次性本地命令，不启动 Express，也不监听 8787；它直接复用现有 `NodePaddleRunner`、`PaddleLocalOcrProvider` 和 Provider 内部归一化链路。
- 私有输入仅允许位于 ignored 的 `ocr-gateway/local-private-samples/`，结果仅允许写入 ignored 的 `ocr-gateway/local-private-results/`；样本只使用匿名 `sampleId`。
- 结果和日志只记录匿名 ID、状态、warning code、置信度与指标，不记录作文全文、确认转写全文、本机绝对路径或学生身份信息。
- 20-40 篇样本仅用于决定后续优化方向，不用于制定生产级自动放行阈值。
- 自动化实现和验证只使用合成 fixture 与 fake runner；本轮没有运行真实私有样本 benchmark，因此不声明任何真实样本指标。

## 评估目的

- 验证 PaddleOCR 本地真实 OCR Provider 在作文场景中的可用性。
- 评估其是否适合作为后续 AI 批改前的 OCR 输入来源。
- 识别典型失败模式，为后续 provider 调整、降级策略和人工复核流程提供依据。

## 评估范围

- 计划样本数：20-40 张图片。
- 样本类别：
  - 清晰字迹
  - 一般字迹
  - 潦草字迹
  - 拍照歪斜
  - 光线较暗
  - 有涂改
  - 多页作文

## 评估维度

- 漏行
- 乱序
- 单词识别可用性
- 段落保留
- 标点和大小写
- 潦草字迹
- 涂改
- 教师修改量
- 是否适合后续 AI 批改

## 记录表

| 图片编号 | 字迹类型 | OCR 输出是否完整 | 漏行情况 | 乱序情况 | 明显错词数量 | 是否需要大量人工修改 | 是否可进入 AI 批改 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 示例-01 | 清晰字迹 | 待评估 | 待评估 | 待评估 | 待评估 | 待评估 | 待评估 |  |
| 示例-02 | 潦草字迹 | 待评估 | 待评估 | 待评估 | 待评估 | 待评估 | 待评估 |  |

## 初步结论占位

- 总体可用性：待补充。
- 主要优势：待补充。
- 主要问题：待补充。
- 是否建议进入下一轮接入优化：待补充。

## v0.2.1 本地 smoke test 记录

测试日期：2026-07-09

测试环境：

- OS：Microsoft Windows NT 10.0.26200.0
- Node：v24.16.0
- Python：3.12.13，位于 `ocr-gateway/.venv`
- setuptools：83.0.0
- PaddlePaddle：2.6.2
- PaddleOCR：2.10.0
- OCR_PROVIDER：`paddle_local`
- PADDLE_OCR_LANG：`en`
- PADDLE_OCR_TIMEOUT_MS：`120000`
- Paddle 模型缓存：重定向到 `ocr-gateway/.paddle-home` / `ocr-gateway/.paddle-cache`，不提交 Git

本轮取舍：

- 已创建 `ocr-gateway/.venv` 并安装 `requirements.txt` 依赖。
- 已补充 `setuptools>=70`，原因是当前 Python 3.12 venv 中 PaddlePaddle import 需要 setuptools。
- 已确认 `python` / `py` 不在当前 PATH 中；本轮使用 Codex bundled Python 创建项目本地 venv。
- 已确认不把 `.venv`、Paddle 模型缓存、合成图片、OCR 原始输出提交到 Git。
- 当前没有提供真实学生作文图片；本轮未执行真实学生样本 UploadPage 手工 smoke test。

合成图 runner smoke：

| 样本 | 字迹情况 | 是否成功返回文本 | 是否漏行 | 是否乱序 | 明显错词 | 教师修改量 | 是否可进入 AI 批改 | 备注 |
|---|---|---|---|---|---|---|---|---|
| synthetic-1 | 机器生成英文打印体 | 是 | 否 | 否 | 轻微：`school.` 识别为 `school..` | 很低 | 是，仅用于链路验证 | 通过 `scripts/paddle_ocr_runner.py --manifest local-samples/manifest.json --output local-samples/output.json --lang en` |

合成图 Gateway smoke：

| 链路 | 结果 | 备注 |
|---|---|---|
| Express app -> `paddle_local` provider -> Python runner -> PaddleOCR -> unified `OcrEssayResult` | 成功 | 使用 ignored 临时脚本 `local-samples/gateway-smoke.ts` 与合成图片；返回 `status: success`、`provider: remote`、页面 confidence 约 0.984 |
| Dev server `/health` | 成功 | `Start-Job` 临时启动 Gateway，`http://127.0.0.1:8791/health` 返回 200 |
| Dev server multipart OCR via curl | 未作为结论 | Gateway 启动正常，但 PowerShell/curl 的 `pageIds` 引号传递导致请求被正确拒绝为“图片数量与页面 ID 数量不一致”；不据此修改产品代码 |

初步结论：

- PaddleOCR 本地环境是否跑通：部分跑通。Python venv、依赖安装、Paddle/PaddleOCR import、模型下载、runner 合成图识别均已跑通。
- Gateway 链路是否跑通：合成图层面跑通。通过 Express app 直接请求 `paddle_local` provider，可返回统一 `OcrEssayResult`。
- UploadPage OCR 草稿是否正常回填：本轮未验证真实浏览器上传，因为没有真实学生作文图片；现有自动化回归仍覆盖 real OCR 客户端回填行为。
- 是否需要继续做 20-50 张样本评测：是，但前置条件是准备不入 Git 的真实学生作文图片样本，并在本地设置 Python / Paddle cache 环境变量。
- 是否需要考虑腾讯 / 百度 / 视觉大模型对比：暂不进入。本轮先确认 PaddleOCR 本地链路，下一轮再用真实样本决定是否横向对比。

注意：

- 不要提交真实学生作文图片、合成 smoke 图片、OCR 原始输出、`.venv`、Paddle 模型缓存或临时文件。
- 在受限 Windows 环境下运行 PaddleOCR 时，需要将 `USERPROFILE` / `HOME` / `XDG_CACHE_HOME` 指向项目内 ignored 缓存目录，否则 Paddle 可能尝试写入用户目录并失败。
