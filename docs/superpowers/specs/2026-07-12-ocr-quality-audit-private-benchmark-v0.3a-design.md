# OCR 质量最小审计数据层与本地私有基准评测 v0.3a 设计规格

日期：2026-07-12

状态：已确认设计，待实施计划

## 1. 目标

v0.3a 在现有 OCR Gateway、统一 `OcrEssayResult`、`paddle_local` Provider 和教师 OCR 确认流程之上，建立两项最小能力：

1. 在当前应用状态生命周期内，区分 OCR 来源文本与教师忠实确认文本，并保留可审计的篇级修改结果。
2. 使用本地私有样本，通过生产 OCR 调用路径获得可信、无偏的 PaddleOCR 质量数据。

本轮的首要成功标准是获得可用于方向决策的质量证据，不是减少教师确认步骤，也不是制定生产级自动放行阈值。

目标链路：

```text
作文图片
-> 现有 Gateway Provider
-> NodePaddleRunner
-> PaddleOCR Python runner
-> normalizeProviderResult
-> unified OcrEssayResult
-> 最小审计数据层
-> 当前教师确认流程
-> 篇级修改指标
```

本地私有基准链路：

```text
local-private-samples/ 中的匿名样本与忠实人工基准转写
-> 单次本地评测命令
-> PaddleLocalOcrProvider + NodePaddleRunner
-> normalizeProviderResult
-> CER / WER / 结构化状态指标
-> 不含全文和身份信息的匿名汇总
-> 进程退出并清理临时文件
```

## 2. 当前基线

当前项目已经具备：

- 上传、排序、作文分组与可编辑 OCR 草稿。
- `mock` / `real` 两种前端 OCR mode。
- Gateway `mock`、`mock_failure`、`paddle_local` Provider。
- `PaddleLocalOcrProvider`、`NodePaddleRunner` 和 Python runner。
- `normalizeProviderResult` 统一页面顺序、页面状态和篇级状态。
- 教师确认 OCR 文本后进入现有批改队列。
- OCR 失败时使用 mock 草稿、手动输入或重试的回退路径。

当前 `Essay` 只保存一个 `ocrText`。上传页的 OCR 结果和编辑草稿只存在组件状态中；`AppStateContext` 使用 React 内存状态，没有数据库或跨会话持久化。因此，本设计中的“保留”只指当前应用状态生命周期内不被覆盖，不得描述成永久存储。

真实样本已经证明链路可以运行，同时暴露了单词误识别、大小写和标点误差、`a/o`、`f/t` 字符混淆以及行尾断词等问题。单个真实样本不足以校准 confidence、质量分数或自动放行阈值。

## 3. 核心决策

采用“最小审计数据层 + 本地私有基准评测”，不采用原候选方案中的完整可见影子模式。

核心取舍：

- 保存来源文本与教师确认文本，但不新增 `normalizedText`。
- 记录篇级修改结果，但不生成字符级 `correctionEvents`。
- 计算结构化影子评估，但不显示在教师 UI。
- 记录可解释信号，但不生成 0-100 质量分和高/中/低等级。
- 不自动合并断词，不自动修改空格、大小写、标点、拼写或语法。
- 使用 20-40 篇真实样本做方向决策，不据此制定生产级自动放行阈值。
- 本地评测不启动长期 `8787` 服务，直接复用现有生产 Provider 调用路径。

## 4. 非目标

v0.3a 明确不做：

- 不新增 `normalizedText`。
- 不自动合并行尾断词。
- 不自动修正空格、拼写、语法、大小写或标点。
- 不生成字符级 `correctionEvents`。
- 不新增可见质量卡片、影子建议或质量 Dashboard。
- 不自动跳过教师确认。
- 不实现自动放行或异常队列。
- 不接 AI OCR 或视觉大模型 OCR。
- 不更换或新增 OCR Provider。
- 不微调 PaddleOCR，不训练模型。
- 不接真实 AI 批改。
- 不做 bbox、坐标、局部截图或字符候选 UI。
- 不做数据库、对象存储或跨会话持久化。
- 不把真实学生样本用于自动化测试。
- 不把真实图片、忠实转写全文或 OCR 全文提交到 Git。

## 5. 架构边界

### 5.1 Gateway 边界

Gateway 的生产 OCR 行为保持不变：

```text
PaddleLocalOcrProvider
-> NodePaddleRunner
-> scripts/paddle_ocr_runner.py
-> normalizeProviderResult
-> OcrEssayResult
```

本地评测工具必须调用 `PaddleLocalOcrProvider.recognize()`，并显式使用现有 `NodePaddleRunner`。`PaddleLocalOcrProvider` 内部继续调用 `normalizeProviderResult`。评测工具不得：

- 直接调用 Python runner 绕过 Provider。
- 复制 Paddle runner 参数协议。
- 重新实现 Paddle 输出解析。
- 重新实现页面排序、状态判断或篇级文本合并。
- 在 Provider 返回后再做一套不同的 OCR 归一化。

这样可以保证本地评测与产品运行使用同一条生产识别路径。

### 5.2 前端边界

`app/src` 继续只认识 `mock` / `real` 和统一 `OcrEssayResult`。前端生产代码不得出现：

- `PaddleOCR`
- `paddle_local`
- `PADDLE_OCR_*`
- Python runner 路径或命令
- Provider-specific 质量规则

前端审计层只处理 Provider 无关的统一结果、教师确认文本和篇级修改指标。

### 5.3 教师流程边界

现有教师流程保持不变：

```text
OCR 返回
-> 显示可编辑 OCR 草稿
-> 教师编辑或不编辑
-> 教师确认
-> 进入现有批改队列
```

影子评估不得：

- 显示在教师 UI。
- 改变按钮状态或文案。
- 自动确认 OCR。
- 阻止教师确认。
- 改变入队条件或作文状态。
- 影响教师对 OCR 文本的独立判断。

## 6. 数据模型

建议的领域类型如下；实现时可根据现有文件边界拆分，但语义不得改变。

```ts
type OcrAuditVersion = 'ocr-audit-v1'
type OcrShadowAssessmentVersion = 'ocr-shadow-v1'
type OcrTextMetricsVersion = 'ocr-text-metrics-v1'

type OcrAuditSourceKind = 'mock' | 'remote' | 'manual'

type OcrShadowOutcome =
  | 'no_obvious_risk'
  | 'review_recommended'
  | 'insufficient_evidence'

type OcrShadowReasonCode =
  | 'empty_text'
  | 'page_result_missing'
  | 'partial_page_failure'
  | 'failed_result'
  | 'confidence_observed'
  | 'confidence_unavailable'
  | 'suspected_hyphen_break_observed'

interface OcrShadowReason {
  code: OcrShadowReasonCode
  severity: 'info' | 'warning' | 'critical'
  value?: number
}

interface OcrShadowAssessment {
  assessmentVersion: OcrShadowAssessmentVersion
  outcome: OcrShadowOutcome
  reasons: OcrShadowReason[]
  assessedAt: string
}

interface OcrReviewOutcome {
  metricsVersion: OcrTextMetricsVersion
  actualTeacherAction: 'confirmed_without_edit' | 'confirmed_after_edit'
  editDistance: number
  changedCharacterCount: number
  confirmedAt: string
}

interface OcrTranscriptAudit {
  auditVersion: OcrAuditVersion
  sourceKind: OcrAuditSourceKind
  sourceText: string
  confirmedTranscript?: string
  shadowAssessment: OcrShadowAssessment
  reviewOutcome?: OcrReviewOutcome
}
```

`OcrTranscriptAudit` 和 `OcrShadowAssessment` 必须分别包含 `auditVersion` 与 `assessmentVersion`。文本指标必须包含 `metricsVersion`。任何计算口径或评估规则变化都必须提升对应版本，不得在同一版本下静默改变含义。

### 6.1 与现有 Essay 的关系

建议为 `Essay` 增加可选审计字段，同时保留现有兼容字段：

```ts
interface Essay {
  // existing fields...
  ocrText: string
  ocrAudit?: OcrTranscriptAudit
}
```

`ocrText` 在 v0.3a 仍是所有现有批改、阅读定位和异常复核代码使用的兼容字段。本轮不要求下游模块改读新字段。

## 7. 文本生命周期

### 7.1 sourceText

`sourceText` 表示统一 Gateway 结果进入前端后的来源文本：

- real OCR：取 `normalizeProviderResult` 产生的统一 `OcrEssayResult.text`，在任何前端 trim、教师编辑或兼容字段写入之前捕获。
- mock OCR：取 mock `OcrEssayResult.text`。
- 手动输入：`sourceKind` 为 `manual`，`sourceText` 固定为空字符串；手动输入内容只进入 `confirmedTranscript`。

重要限制：

- `sourceText` 不是 PaddleOCR Python 原始 stdout，也不是 Provider 未处理的逐行原始结构。
- `sourceText` 一旦随作文确认写入 `Essay.ocrAudit`，后续不得覆盖。
- 教师编辑、详情页 OCR 修正和兼容字段更新不得改变 `sourceText`。
- 上传页确认前重试 OCR 时，只保留最终被教师确认的那次来源结果；v0.3a 不保存 OCR 运行历史。
- real OCR 失败后改用 mock 草稿时，最终审计来源是 `mock`；失败的 real OCR 全文不写入最终作文审计对象。

### 7.2 confirmedTranscript

`confirmedTranscript` 表示教师确认的忠实转写：

- OCR 刚返回时不存在。
- 教师点击现有“确认 OCR 文本”时，取当前 textarea 内容写入。
- 教师未编辑时，通常与 `sourceText` 相同。
- 教师编辑后，必须仍然忠实于学生图片，不是作文语言纠错版本。
- 后续通过现有“编辑 OCR”能力修改时，只更新 `confirmedTranscript` 和兼容字段 `ocrText`，不修改 `sourceText`。
- v0.3a 不保存每一次中间编辑事件，只保存当前确认文本与最新篇级修改结果。

### 7.3 ocrText 兼容字段

`ocrText` 的生命周期固定如下：

- 作文确认入队时，`ocrText = confirmedTranscript`。
- 后续忠实 OCR 修正时，`ocrText` 与 `confirmedTranscript` 同步更新。
- `ocrText` 不得单独写入一个与 `confirmedTranscript` 不一致的值。
- 现有批改与展示代码继续读取 `ocrText`。
- 作文语言纠错结果继续放在独立的 `GradingResult` / `FullTextRevision` 数据中，不得回写 `ocrText`、`sourceText` 或 `confirmedTranscript`。

### 7.4 状态生命周期限制

当前项目没有持久化后端。`sourceText`、`confirmedTranscript`、`ocrText` 和审计指标只在当前 React 应用状态生命周期内存在。刷新页面或重新启动应用后是否保留，不属于 v0.3a 保证范围。

文档、UI 和代码注释不得使用“永久保存”“长期积累训练数据”等表述。未来如需跨会话保存，必须另行设计数据存储、访问控制、脱敏、保留期限与删除机制。

## 8. 影子评估

### 8.1 评估语义

影子评估只根据统一 `OcrEssayResult` 计算，不读取 Provider-specific 内部状态。

第一版 outcome 规则：

- `review_recommended`：空文本、请求页面缺少结果、篇级 `failed`、存在页面失败或篇级 `partial`。
- `no_obvious_risk`：来源为 `remote`，统一结果结构完整，所有请求页有结果，篇级为 `success`，且没有确定性结构失败信号。
- `insufficient_evidence`：mock、手动输入、无法形成有效评估输入，或未来未识别的来源类型。

`no_obvious_risk` 只表示没有发现第一版规则能够识别的明显结构风险，不表示 OCR 字符准确，也不表示允许自动放行。

### 8.2 观察值

confidence 和疑似断词可以作为观察值记录，但不得直接决定生产放行：

- confidence 缺失不得阻断文本返回或教师确认。
- confidence 阈值在 v0.3a 中不得声称已经校准。
- confidence 观察值只对 `remote` 结果计算：收集所有有限的页面 confidence，忽略缺失值并取算术平均；没有任何有限值时记录 `confidence_unavailable`。该平均值不影响 outcome。
- 疑似断词观察固定匹配统一篇级文本中的 `-\n` 后接小写英文字母；记录匹配次数，但不判断它是排版断词还是应保留的连字符词。
- 疑似 `pur-\npose` 只能记录为 `suspected_hyphen_break_observed`，不得自动合并。
- 不使用英语词典把非词典 token 当成 OCR 错误，因为它可能是学生真实拼写错误、姓名或专有名词。

### 8.3 文本长度与漏行

文本长度异常不得命名为“漏行”，也不得自动产生 `missing_line` 结论。

- 运行时只能把长度视为未经校准的观察值；v0.3a 默认不把它用于 outcome。
- “漏行”只能在本地私有基准评测中，通过 OCR 输出与人工忠实基准转写逐行对照后人工确认。
- 匿名评测结果可以记录 `confirmedMissingLineCount`，但必须注明其来源为人工基准对照。

### 8.4 不可见性

影子评估不显示在 UploadPage、ProgressPage、ExceptionsPage 或 EssayResultPage。v0.3a 不新增质量卡片、徽章、Tooltip、筛选项或教师提示。

这保证教师确认行为不受系统建议影响，得到的修改结果更接近无偏基准。

## 9. 文本指标计算口径

所有文本指标使用固定 `ocr-text-metrics-v1` 口径。

### 9.1 指标比较投影

指标计算可以创建临时比较投影，但不得写回任何产品文本字段。比较投影按以下顺序处理：

1. Unicode 规范化为 NFC。
2. `CRLF` 和单独 `CR` 转为 `LF`。
3. 制表符和不换行空格转为普通空格。
4. 每行连续水平空白折叠为一个普通空格。
5. 删除每行首尾水平空白。
6. 连续三个及以上换行折叠为两个换行。
7. 删除整段文本首尾空白。

比较投影必须保留：

- 大小写。
- 标点。
- 连字符。
- 单换行和双换行。
- 学生真实拼写与语法错误。

该投影只为稳定计算指标，不构成 `normalizedText`，也不改变教师看到或下游使用的文本。

### 9.2 editDistance

`editDistance` 比较：

```text
sourceText 的指标比较投影
vs
confirmedTranscript 的指标比较投影
```

算法固定为 Unicode code point 序列上的 Levenshtein distance：

- 插入成本 1。
- 删除成本 1。
- 替换成本 1。
- 相同 code point 成本 0。

不得按 UTF-16 code unit 计算，以避免非 BMP 字符被拆成两个字符。

### 9.3 changedCharacterCount

`changedCharacterCount` 使用同一 Levenshtein 最短编辑脚本：

```text
插入数 + 删除数 + 替换数
```

每个替换计 1 个修改字符。若存在多个等长最短路径，回溯优先级固定为：

1. 相同字符。
2. 替换。
3. 删除。
4. 插入。

在 `ocr-text-metrics-v1` 中，`changedCharacterCount` 数值与单位成本 `editDistance` 相同。两个字段同时保留，是为了区分算法指标与产品报告语义；未来如改变统计口径，必须提升 `metricsVersion`。

### 9.4 CER

CER 只用于本地私有基准评测，比较 OCR 来源文本与人工忠实基准转写：

```text
CER = LevenshteinDistance(ocrProjection, referenceProjection)
      / referenceProjectionCodePointCount
```

规则：

- reference 必须忠实保留学生真实拼写、语法、大小写和标点。
- 分子使用与 `editDistance` 相同的 code point Levenshtein 算法。
- reference code point 数为 0 时，CER 为 `null`，并记录 `empty_reference`；不得除以 1 伪造有效指标。
- CER 不裁剪到 0-1，插入错误较多时允许大于 1。

### 9.5 WER

WER 只用于本地私有基准评测：

1. 对指标比较投影按一个或多个空白字符切分 token。
2. 保留 token 的大小写、标点和连字符。
3. 在 token 序列上计算单位成本 Levenshtein distance。

```text
WER = TokenLevenshteinDistance(ocrTokens, referenceTokens)
      / referenceTokenCount
```

reference token 数为 0 时，WER 为 `null` 并记录 `empty_reference`。WER 不裁剪到 0-1。

### 9.6 指标用途边界

- `editDistance` 和 `changedCharacterCount` 描述教师确认前后的篇级差异。
- CER 和 WER 描述 OCR 与人工忠实基准转写的差异。
- 教师确认文本不得自动视为模型训练标签。
- 20-40 篇样本的指标只用于选择后续方向，不用于生产自动放行。

## 10. 本地私有基准评测工具

### 10.1 运行方式

评测工具是单次命令行流程：

- 不启动 Express 长期监听。
- 不监听 `8787` 或其他端口。
- 不创建 Windows 服务、计划任务或长期后台进程。
- 不写系统级或用户级环境变量。
- 只读取当前进程已有配置或显式命令参数。
- 执行结束后退出。

工具在进程内构造 `NodePaddleRunner` 和 `PaddleLocalOcrProvider`，调用 `PaddleLocalOcrProvider.recognize()`。临时图片、manifest 与 runner output 继续由现有 Provider 使用 `mkdtemp` 创建，并由现有 `finally` 清理。

建议生产路径：

```ts
const runner = new NodePaddleRunner(/* process-local options */)
const provider = new PaddleLocalOcrProvider({ runner })
const result = await provider.recognize(input)
```

`normalizeProviderResult` 由 `PaddleLocalOcrProvider` 内部调用。评测工具不得再次归一化或改写结果。

### 10.2 私有目录

私有样本根目录固定为：

```text
ocr-gateway/local-private-samples/
```

要求：

- `.gitignore` 必须明确覆盖 `local-private-samples/`。
- 每个样本只使用匿名 `sampleId`，例如 `sample-001`。
- 文件名、manifest 和输出不得包含姓名、班级、学号或联系方式。
- 样本目录可以在本地保存图片与忠实人工基准转写，但不得复制到测试 fixture、文档、日志或 Git。
- Codex 只有在用户明确指定并授权读取时才能访问真实样本内容。

建议本地 manifest 只使用相对路径：

```json
{
  "sampleId": "sample-001",
  "category": "general_handwriting",
  "pages": ["page-1.jpg"],
  "reference": "reference.txt"
}
```

manifest 中不得包含身份字段。评测工具不得把相对路径展开后写入输出或日志。

### 10.3 匿名输出

单样本输出只允许包含：

- `sampleId`。
- 匿名样本类别。
- 页数。
- OCR `status`。
- warning code 数量或集合。
- confidence 的匿名汇总值（如可用）。
- CER、WER。
- 人工确认的漏行数量（如已完成基准对照）。
- 运行耗时。
- 评测工具版本和指标版本。

输出和日志不得包含：

- 作文全文或片段。
- 忠实人工基准转写全文或片段。
- OCR 来源全文或片段。
- 本机绝对路径。
- 原始文件名中可能存在的身份信息。
- 姓名、班级、学号、联系方式或其他学生身份信息。
- Python traceback、环境变量值或完整命令行参数。

日志只允许输出匿名状态，例如：

```text
sampleId=sample-001 status=success cer=0.083 wer=0.121
```

不得在异常日志中附加输入文本、reference 文本或图片路径。

### 10.4 汇总用途

20-40 篇样本应覆盖清晰、一般、潦草、倾斜、偏暗、带涂改和多页作文。汇总用于回答：

- PaddleOCR 是否足以继续作为开发期默认 Provider。
- 错误主要来自字符混淆、标点大小写、版面、图片质量还是页面失败。
- 下一阶段应优先做图像预处理、Provider 横向比较还是视觉 AI 忠实转写对照。

样本量不足以支撑生产级放行阈值、模型训练或学校级准确率承诺。

## 11. 隐私与安全

- 自动化测试只使用合成文本、假图片和人工 fixture。
- 不把真实学生作文用于 Vitest、快照测试或 CI。
- 不提交真实作文图片、OCR 全文、reference 全文、局部截图、评测原始 JSON、模型缓存或 Python venv。
- 不读取或打印真实 `.env` 内容。
- 不在日志、错误、文档、测试快照或提交信息中记录真实文本和身份信息。
- 评测文档只记录匿名样本类别与汇总数值，不粘贴学生原句。
- 本轮数据不得宣称可用于 PaddleOCR 微调或其他模型训练。
- 任何未来训练用途都需要独立的授权、脱敏、保留期限、删除机制和访问控制设计。

## 12. 计划文件边界

实施阶段预计涉及以下边界，最终路径以实施计划和现有结构为准：

```text
app/src/services/ocr/audit/
  types.ts
  assessOcrShadow.ts
  textMetrics.ts
  *.test.ts

app/src/types/index.ts
app/src/context/appStateContextValue.ts
app/src/context/AppStateContext.tsx
app/src/pages/UploadPage.tsx
app/src/pages/UploadPage.test.tsx

ocr-gateway/scripts/
  private_ocr_benchmark.ts
  private_ocr_benchmark.test.ts

docs/ocr_provider_evaluation_paddle_v02.md
docs/current_development_status.md
```

实现时不得把所有逻辑继续堆进 `UploadPage`。UploadPage 只负责捕获最终 OCR 来源结果、接收教师编辑并提交确认；评估和指标计算放在独立、Provider 无关的 service 中。

本设计不要求创建可见评测页面、Dashboard 或图表。

## 13. 错误处理

- Provider 环境错误继续使用现有脱敏文案。
- 本地评测某个样本失败时记录匿名失败状态并继续其余样本，不输出 traceback 或路径。
- manifest 缺失、reference 为空、图片不可读或结果结构异常时，输出匿名 reason code。
- reference 为空时 CER/WER 为 `null`，不得把失败样本计算为 0。
- 评测工具最终退出码应区分“命令执行失败”和“存在 OCR 失败样本”；具体映射在实施计划中固定。
- 任何清理错误不得覆盖主要 OCR 结果，也不得泄露临时路径。

## 14. 自动化测试

自动化测试继续只使用合成 fixture，不要求当前机器安装 PaddleOCR，也不要求 `npm test` 调用真实 Python OCR。

前端测试至少覆盖：

- real OCR 结果在教师编辑前写入 `sourceText`。
- 教师确认写入 `confirmedTranscript`，并同步兼容字段 `ocrText`。
- 教师编辑不覆盖 `sourceText`。
- 后续 OCR 修正同步更新 `confirmedTranscript` 与 `ocrText`。
- mock 与手动输入 lifecycle 符合设计。
- `OcrTranscriptAudit`、`OcrShadowAssessment` 和指标结果包含固定版本。
- 影子结果不渲染到教师 UI。
- 影子结果不改变确认按钮和入队流程。

指标测试至少覆盖：

- CRLF、CR 与 LF 的固定处理。
- Unicode code point 而非 UTF-16 code unit 计数。
- 大小写和标点差异会计入指标。
- 连字符和换行不会被自动改写。
- 替换、插入、删除的 edit distance 与 changed character count。
- 空 reference 返回 `null` CER/WER。
- CER/WER 可以大于 1。
- token 化只按空白切分并保留大小写、标点和连字符。

影子评估测试至少覆盖：

- 空文本建议复核。
- 缺页结果建议复核。
- partial / failed 建议复核。
- 完整 success 只能得到 `no_obvious_risk`，不能得到自动放行结论。
- 手动输入得到 `insufficient_evidence`。
- 文本长度异常不生成“漏行”结论。

本地评测工具测试至少覆盖：

- 使用 fake runner 或合成 Provider 输入，不调用真实 PaddleOCR。
- 编排路径复用 `PaddleLocalOcrProvider` 和 `NodePaddleRunner`。
- Provider 内部继续使用 `normalizeProviderResult`。
- 不启动 HTTP 监听端口。
- 输出只包含匿名指标。
- 输出和日志不包含全文、reference、绝对路径或身份字段。
- 单个样本失败不阻止其他样本生成匿名结果。

回归验证继续覆盖：

- mock、real 和失败回退流程。
- OCR 确认后进入现有批改队列。
- Gateway 测试与 typecheck。
- 前端测试、lint 和 build。
- `app/src` Provider 泄漏扫描。

## 15. 文档要求

实施完成后更新：

- `docs/current_development_status.md`
- `docs/ocr_provider_evaluation_paddle_v02.md`

文档必须明确：

- v0.3a 是不可见影子评估，不影响教师流程。
- `sourceText` 是统一 Gateway 来源文本，不是 Python 原始 stdout。
- 当前审计数据只在应用内存状态生命周期内保留。
- 没有 `normalizedText`，没有自动断词合并。
- 没有质量分、高中低等级或自动放行。
- 20-40 篇样本只用于方向决策。
- 真实图片、人工基准转写和 OCR 全文不进入 Git。

## 16. 验收标准

v0.3a 实施完成后必须满足：

1. `sourceText`、`confirmedTranscript` 和 `ocrText` 的生命周期符合本设计。
2. `sourceText` 不会被教师编辑或后续 OCR 修正覆盖。
3. `ocrText` 继续兼容现有批改和展示流程。
4. `OcrTranscriptAudit`、`OcrShadowAssessment` 和文本指标具有固定版本。
5. edit distance、changed character count、CER 和 WER 使用本设计固定口径。
6. 文本长度异常不会被自动称为漏行。
7. 漏行只通过人工基准转写对照确认。
8. 本地评测不启动长期 `8787` 服务。
9. 本地评测直接复用 `PaddleLocalOcrProvider`、`NodePaddleRunner` 和 Provider 内部的 `normalizeProviderResult`。
10. 私有样本只位于 ignored 的 `ocr-gateway/local-private-samples/`。
11. 样本只使用匿名 `sampleId`，不保存姓名、班级或学号。
12. 评测输出和日志不包含全文、绝对路径或身份信息。
13. 自动化测试只使用合成 fixture。
14. 影子评估不显示在教师 UI，也不影响确认和入队。
15. 本轮没有 `normalizedText`、自动断词合并或字符级 correction events。
16. 本轮没有质量卡片、自动放行、AI OCR、Provider 更换或真实 AI 批改。
17. 20-40 篇评测结果只用于方向决策，不形成生产级自动放行阈值。
18. 现有 mock、real、失败回退和确认入队流程保持可用。
19. 前端 Provider 泄漏扫描通过。
20. 工作区不包含意外生成或提交的真实样本、OCR 全文、环境文件、缓存或构建产物。

## 17. 后续决策门

完成 v0.3a 实现并积累 20-40 篇匿名评测结果后，才进入下一次设计决策。候选方向包括：

- PaddleOCR 图像预处理或参数优化。
- 一个替代 OCR Provider 的同样本横向对照。
- 视觉 AI 忠实转写的离线对照。
- 可见的选择性复核提示试点。
- 在更大样本和明确风险容忍度基础上讨论自动放行。

任何方向都必须单独设计，不得把本轮影子结果直接升级为生产自动决策。
