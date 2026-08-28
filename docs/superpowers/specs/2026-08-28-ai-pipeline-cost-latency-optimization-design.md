# AI 调用成本、延迟与全班吞吐优化设计

## 状态

- 日期：2026-08-28
- 设计状态：用户已批准
- 实施状态：尚未实施
- 范围：评分标准辅助生成、原材料上下文提炼、逐篇多模态批改、任务级调度、Provider 调用观测、幂等与重试
- 前置设计：`2026-08-27-optional-material-unified-rubric-design.md`

## 背景

当前网站主流程已经跑通，但一次任务的模型费用和全班完成时间仍明显高于产品预期。问题不只来自模型速度，而是来自调用编排、重复上下文、冗余输出合同和缺乏真实 usage 观测。

本轮只读审计确认：

1. 点击一次“根据材料生成评分标准”，Gateway 会顺序调用 Kimi 两次：第一次生成草案，第二次携带完整草案和同一份原材料复核。
2. 每篇作文批改虽然只调用一次 Kimi，但发送给模型的已确认任务包存在一组顶层上下文与嵌套 rubric 上下文重复。
3. 评分结果要求同时输出正文、订正全文、提升全文、逐句对照和多组问题列表；其中原始 `correctedText` 与 `improvedText` 最终会被 Gateway 根据 `sentencePairs` 重建，模型生成的两个全文没有成为最终权威值。
4. 当前评分 strict JSON Schema 序列化约 7,083 个字符；合同的数组数量和通用 50,000 字符字段上限组合后，理论可表达输出远大于 16,384 completion tokens，存在不必要的输出诱导和截断风险。
5. 前端以全局锁把批改限制为一次只运行一篇，且教师需要逐篇启动。N 篇作文的关键路径接近 N 次单篇延迟之和。
6. Gateway 当前丢弃 Kimi 响应中的 `prompt_tokens`、`completion_tokens`、`cached_tokens` 和 `finish_reason` 观测信息，无法按阶段解释费用与耗时。
7. `requestId` 只用于追踪和忽略迟到结果，没有 Gateway 级幂等复用。超时、断连或重复提交可能形成重复计费窗口。
8. 实际入口在缺少 `GRADING_PROVIDER` 时默认使用 mock；真实环境若配置遗漏，可能在不明显的情况下偏离 Kimi 运行基线。

以上问题都可以在保留“每篇作文一次直接多模态识别加批改”的前提下优化，不需要也不得恢复独立 OCR。

## 用户批准的产品取向

用户选择“全班尽快完成”，并接受以下安全边界：

- 目标是尽量跑满账户实际可用吞吐，而不是无上限并发。
- 并发必须有显式硬上限，并根据 `429`、耗时和成功率自适应升降。
- 任何吞吐优化都必须有幂等、退避、失败隔离和质量非退化保护。
- 正常并发本身不应增加单篇 token；因失败或不确定状态造成的重复调用必须被重点消除。

因此采用“最大吞吐目标 + 稳健有界并发”的分层方案。

## 不可改变的架构边界

1. 原题材料只在创建任务阶段理解一次，不在每篇学生作文批改时重复发送。
2. 学生图片、PDF 转换页或设备照片按顺序直接发送给 `kimi-k3`。
3. 同一次多模态请求完成学生正文识别、评分和反馈。
4. 不新增批改前 OCR、独立 OCR 文本确认、OCR 降级或 OCR 故障绕行。
5. 教师修改模型生成的正文后，可以通过现有 Grading Gateway 以确认文本重新批改；这是作文新版本，不是 OCR 阶段。
6. 对外继续使用 `multimodal-grading-request-v2`、`grading-result-v2` 和 `POST /grading/grade-images`。
7. Provider 保持 Kimi，中国区 API Base 保持 `https://api.moonshot.cn/v1`，模型保持 `kimi-k3`，`reasoning_effort` 保持 `low`。
8. 教师可见的正文、维度评分、问题分析、修改建议和教师确认闭环不得因为内部压缩而消失。

## 目标

### 成本目标

- 正常 AI 评分标准辅助生成从两次 completion 降为一次。
- 在同一 Gateway 进程连续可用、没有有效内容变更和明确终止后受控重试的正常路径中，N 篇学生作文的首次批改严格对应 N 次 completion，不产生隐藏式额外调用。
- 删除逐篇任务上下文的确定性重复。
- 删除 Provider 输出中由 Gateway 已能确定性重建的全文重复。
- 在真实代表性样本中，单篇总 token 中位数较当前基线至少降低 25%。
- 记录缓存命中 token，但不把缓存命中视为正确性或成本目标的必然前提。

### 延迟目标

- 教师一次启动全部待批改作文，不再逐篇触发。
- 首篇完成时间不劣于当前单篇基线。
- 账户实际支持并发不低于 4 时，30 篇作文的全班完成时间较当前全局串行至少降低 60%。
- 单篇失败不阻断其他作文继续完成。

### 质量目标

- 正文识别、评分依据、维度得分、重要字迹风险和教师复核语义保持完整。
- 结构化结果成功率不低于当前版本，目标不低于 99%。
- 经授权测试集上，正文字符错误率相对当前基线的退化不超过 0.5 个百分点。
- 相对教师参考评分的归一化误差不得比当前基线增加超过满分的 1%。
- 不允许出现学生间内容串联、任务上下文错配或旧作文结果覆盖新版本。

## 非目标

- 不将多名学生作文合并进同一个模型请求。
- 不接入 Kimi Batch API；当前官方资料明确 K3 暂不支持 Batch，且教师实时审阅不适合 12 小时以上的批处理窗口。
- 不切换模型或增加 Provider 路由器。
- 不通过第二次模型请求延迟生成某些反馈模块。
- 不将 streaming 当成 token 或总计算时间优化；本轮继续使用非流式严格结构化响应。
- 不在缺少质量数据时直接启用有损图片压缩。
- 不在本轮建设跨 Gateway 重启的持久任务数据库；幂等首先覆盖同一 Gateway 进程和可配置 TTL。进程重启、滚动部署或多实例不能宣称严格复用，正式公网部署前必须改用持久或共享 registry 与结果存储。
- 不保证总 token 与学生人数无关。每篇作文至少必须读取一次，因此最低总成本仍近似随 N 线性增长。

## 调用预算模型

令：

- `N`：首次批改的学生作文数。
- `T`：教师确认正文后发生的有效重批次数。
- `F`：明确终止后由策略允许的真实重试次数。
- `R`：教师实际点击并完成的 AI 评分标准生成次数。
- `C`：创建提交时是否需要单独材料上下文提炼，取 0 或 1。

当前 Provider completion 数为：

```text
2R + C + N + T + F
```

目标正常路径为：

```text
R + C + N + T
```

其中 AI 生成成功且材料签名未变化时，响应中的材料上下文继续复用，`C = 0`。同一逻辑请求的传输重发、双击或超时后重新挂接不得增加 completion 数。

单篇串行时，全班关键路径近似：

```text
Σ L_grade(i)
```

有效并发为 `C_effective` 时，目标关键路径接近：

```text
ceil(N / C_effective) × 代表性单篇耗时 + 有界调度开销
```

该公式只用于容量规划，不承诺每篇图片规模和上游排队完全相同。

## 总体数据流

```text
创建任务
  ├─ 无材料 + 教师合法评分标准：0 次模型调用
  ├─ 有材料 + 教师合法评分标准：材料上下文 1 次
  └─ AI 辅助生成：材料只发送一次，评分标准 + 材料上下文 1 次
        ↓
唯一、精简、稳定的任务级模型上下文
        ↓
教师一次启动全班批改
        ↓
前端任务队列 + Gateway 硬准入与幂等注册表
        ↓
每篇作文一次 Kimi 多模态 completion
        ↓
Gateway 校验、策略归一化与确定性重建
        ↓
现有 grading-result-v2 + 教师审阅确认
```

## 设计一：真实 usage 与阶段耗时观测

### Transport 返回值

Kimi transport 不再只返回解析后的 `message.content`，而是返回一个内部受控结果：

```text
content
finishReason
usage.promptTokens?
usage.completionTokens?
usage.totalTokens?
usage.cachedTokens?
providerElapsedMs
```

所有 usage 字段都必须执行非负有限整数和内部一致性校验；缺失、非法或相互矛盾时记录 `unknown` 和安全诊断，不得伪造为 0。`cachedTokens` 必须按可选字段处理，且不得大于有效 `promptTokens`。不得依赖官方合同没有稳定声明的嵌套 reasoning token 字段，也不得用 `reasoning_content` 文本长度自行估算账单。

### 阶段标签

每次 Provider 调用必须显式标记：

- `material_context`
- `rubric_generation`
- `essay_grading_images`
- `essay_regrading_text`

### 安全指标

每次调用只允许记录：

- 阶段、模型、reasoning effort。
- 匿名任务哈希、匿名作文哈希和逻辑请求 ID 哈希。
- 队列等待、Provider、解析、归一化与总耗时。
- `prompt_tokens`、`completion_tokens`、`total_tokens`、可选 `cached_tokens`。
- `finish_reason`、尝试序号、最终状态和安全错误码。
- 作文页数、每页尺寸、总字节数和确认文本字符数。

禁止记录：

- 学生姓名、文件名中的身份信息。
- 图片、base64、作文正文、确认全文。
- 完整 Prompt、完整任务材料、Provider 原始响应。
- API Key、Authorization header、完整本机路径或 stack。

日志中的任务、作文和调用关联 ID 必须使用服务端随机诊断 ID，或使用仅供日志的轮换 keyed HMAC。不得记录普通可预测 ID 的裸哈希，也不得把正文、确认文本或图片内容摘要当作日志关联 ID。幂等所需 payload digest 只保留在受控内存 registry 中，不写日志。

一次 Provider completion 只有一个计费事件。多个 HTTP 调用挂接同一个 in-flight 或成功结果时，Provider usage 只汇总一次；每个调用方的等待时间可以分别记录，但不得重复累计 token 或费用。

首轮实现可以使用结构化脱敏日志和测试聚合器；正式任务级成本面板不是本轮必需 UI。

### 成本换算

真实优化以 token 数为权威指标。人民币成本只能通过可配置价格表在内部报告中计算，不得把可能变化的官方价格硬编码为业务合同。

## 设计二：评分标准辅助生成合并为一次调用

### 正常路径

`POST /tasks/rubric` 对 Kimi 只执行一次 completion。请求包含：

- 教师填写的满分。
- 教师当前写作要求；非空时具有最高权威。
- 当前有序原材料，且只出现一次。
- 评分维度和卷面规则的生成约束。

响应同时返回：

- 材料摘要。
- 合并后的写作要求和约束。
- 可编辑评分维度。
- 安全材料警告。

模型在内部推理中自行检查后只提交最终结构化对象。Gateway 使用严格 Schema 和本地业务校验验证维度数量、字段、唯一卷面维度、合法权重及总和 100%。

### 失败语义

- 结构或业务校验失败时，不自动发起第二次“复核”或“修复”模型调用。
- 调用前的教师写作要求和评分维度保持不变。
- 教师可以继续直接使用当前合法评分标准，或显式再次点击 AI 生成。
- 允许本地生成非语义 ID 或执行无损字符串规范化；不得静默改变 AI 给出的评分含义或权重。

### 人工质量保障

删除第二次模型复核不会删除教师确认。最终“创建任务并上传作文”仍表示教师接受当前结构化评分标准，教师可以在提交前编辑所有可见字段。

## 设计三：逐篇 Provider 输入投影

### 外部合同保持不变

前端和 Gateway 继续按 `multimodal-grading-request-v2` 交换完整已确认任务包。Gateway 先执行现有严格合同验证，再投影为只供模型使用的内部对象。

### 内部模型上下文

内部 `ModelTaskContextV1` 只包含一份：

```text
fullScore
materialSummary
writingRequirements
constraints
reviewWarnings
dimensions[]:
  id
  name
  description
  weight
```

逐篇 Provider Prompt 不包含：

- 顶层上下文与 rubric 内同名上下文的第二份副本。
- 任务确认时间、内部来源、页面状态或 UI 元数据。
- 不参与逐篇评分的 `sourceEvidence`。
- 学生姓名。
- 原始题目图片、PDF、DOCX 或提取全文。

维度 ID 必须保留，用于把模型得分安全映射回当前评分标准。教师写作要求仍保持最高权威；材料摘要与非冲突约束只出现一次。

`reviewWarnings` 必须保留为经过规范化、去重和长度限制的教师复核触发条件；不得因为上下文瘦身静默删除。它与普通材料溯源元数据不同，会影响模型是否要求教师重点复核。

### 稳定前缀

消息顺序固定为：

1. 全局稳定评分政策。
2. 当前任务稳定模型上下文。
3. 当前作文特有指令。
4. 当前作文的有序图片，或教师确认文本。

同一 canonical 任务上下文使用稳定的 `prompt_cache_key`。出站值必须是服务端生成或确定性派生的 opaque、非 PII 值，并绑定 `taskId + rubricRevision + gradingPolicyVersion + providerSchemaVersion`；只有在 `taskId` 合同已保证其为内部生成且不含教师输入时才能参与派生，禁止直接发送教师命名或其他普通业务标识。它只用于帮助自动前缀缓存，不是幂等键，也不保证缓存命中。

同一任务内不得改变 `reasoning_effort=low`，避免主动破坏稳定前缀。

## 设计四：Provider 输出去重与上限收紧

### 第一阶段无损删除

Provider 内部评分结果不再要求模型输出：

- `fullTextRevision.correctedText`
- `fullTextRevision.improvedText`

模型仍输出正文和安全的 `sentencePairs`。Gateway 继续使用现有策略从正文和句对编辑确定性重建订正全文与提升全文，再投影为完整 `grading-result-v2`。因此页面、导出和教师确认合同保持不变。

### 暂不合并的字段

第一阶段继续保留：

- `issues`
- `sentenceRevisions`
- `expressionUpgrades`
- `sentencePairs`
- `logicNotes`
- `logicIssues`
- `legibilityIssues`

这些字段虽有语义重叠，但当前 UI 和结果策略各有消费者。只有在真实 A/B 证明统一编辑合同不会降低信息质量或定位稳定性后，才允许进入第二阶段合并；不得先删除后补第二次模型调用。

### 字段级有限边界

通用 50,000 字符和 50–100 条数组上限不再直接复用于所有辅助字段。实施步骤为：

1. 先用当前版本采集授权测试集的真实输出分布。
2. 按字段统计最大值和高分位数。
3. 对正文保留现有安全上限；对问题、建议、解释和辅助数组采用“观测高分位 + 明确余量”的字段级有限上限。
4. Prompt 明确要求优先输出最影响得分、最有教学价值的问题，不以填满数组为目标。
5. 每项最终上限必须进入合同测试，禁止恢复近乎无界的组合。

在完成真实基线前，不凭空确定可能损害长作文反馈的过小数字。

## 设计五：分阶段 completion 预算

当前所有调用共用 `max_completion_tokens=16384`。目标改为每个阶段独立配置：

- `material_context`
- `rubric_generation`
- `essay_grading_images`
- `essay_regrading_text`

第一轮观测期间保持当前安全上限，记录每类实际 completion token 分布和 `finish_reason`。随后按该阶段高分位数加安全余量设定默认上限，Gateway 仍允许环境变量覆盖。

所有阶段的默认值和环境覆盖值都必须位于 `1..16384`；未经用户另行改变当前 Kimi 运行基线，任何阶段不得超过 16,384 completion tokens。非法配置必须启动失败，不得静默扩大或回落。

若 `finish_reason=length`：

- 不把截断或半截 JSON 当作成功结果。
- 记录作文规模和实际 token。
- 不在结果状态不明时立即发起第二笔调用。
- 用观测数据调整后续同规模请求的预算。

本轮不以降低 `max_completion_tokens` 参数本身冒充费用节省；真正目标是减少模型需要生成的内容。

## 设计六：全班自动队列与自适应有界并发

### 用户动作

进度页提供一次任务级“开始批改”动作。点击后，所有当前 `pending_grading` 作文进入队列；教师不再逐篇启动。

列表继续按学生顺序展示，但调度器可以根据页数、历史 token 和当前在途负载做资源感知排序。调度不得改变学生与结果绑定。

### 双层控制

前端任务调度器负责：

- 只为当前任务维护有限数量的在途 HTTP 请求。
- 自动补充空闲槽位。
- 显示等待限流、处理中、待复核、失败和完成状态。
- 一个作文失败后继续其他作文。

Gateway 负责：

- 全进程硬并发准入。
- 逻辑请求幂等注册。
- 根据 Provider 反馈给出稳定、可分类的限流与失败语义。
- 防止多个浏览器或任务绕过前端并发限制。

### 自适应算法

- 真实 Kimi 环境必须配置显式硬上限，不从可能变化的官方充值等级表硬编码额度。
- 初始并发使用最近一次已验证安全值；没有历史时从 1 开始。
- 连续稳定成功后以小步增加并发，最大不超过硬上限。
- 遇到 `429` 或明确拥塞时乘性降低并发，最低为 1，并遵守 `Retry-After`。
- 若配置了账户 TPM 预算，则同时限制估算在途 token；没有预算时使用页数、历史 usage 和 `429` 反馈渐进学习。
- 并发学习值只按同一 Provider、模型和账户运行配置复用，不把 API Key 或其哈希写入日志。

此策略以最大吞吐为目标，但任何时候都保持有限、可退避、可解释。

## 设计七：幂等、超时与重试

### 规范化 revision 与逻辑幂等键

逻辑请求由以下稳定内容身份共同决定：

```text
taskId + essayId + essaySourceRevisionDigest + rubricRevisionDigest
       + gradingPolicyVersion + providerSchemaVersion
```

revision 生成必须跨前端重放保持确定性：

- `rubricRevisionDigest`：对 `fullScore`、`materialSummary`、有序 `writingRequirements`、有序 `constraints`、规范化 `reviewWarnings` 和按稳定顺序排列的维度字段执行 canonical JSON 序列化，再对 UTF-8 字节计算 SHA-256。对象键固定排序、数组保留业务顺序、数字使用唯一有限表示；字符串只使用现有合同已经执行的 trim，不额外做可能改变正文的 Unicode 归一化。
- 图片模式的 `essaySourceRevisionDigest`：按页面顺序包含来源模式、页序、MIME、字节长度及每页精确字节 SHA-256。页面顺序、MIME 或任一字节变化都改变 digest；文件名不参与。
- 确认文本模式的 `essaySourceRevisionDigest`：包含来源模式及经过现有合同验证后的精确 UTF-8 文本字节 SHA-256；不得额外纠错、大小写转换或 Unicode 归一化。
- 前端另维护单调递增的 `sourceGeneration` 与 `rubricGeneration`，只用于原子作废迟到 UI 响应。内容或顺序提交成功时先递增 generation、再重算 digest、最后使旧结果失效；Provider 幂等身份使用 digest，从而相同内容的传输重放仍可复用。

最终逻辑 ID 对上述非秘密字段再次做带版本前缀的 SHA-256 并采用 base64url 编码，不在日志中记录原始组成或 payload digest。Gateway 仍对规范化 metadata 与页面字节计算独立 payload hash，用于检测逻辑 ID 冲突，但不记录作文内容、图片或摘要输入。

同一逻辑 ID：

- payload hash 相同且 `in_flight`：挂接原 Provider promise，不启动第二次 Kimi 调用。
- payload hash 相同且 `succeeded`：在 TTL 内返回已校验缓存结果。
- payload hash 不同：拒绝为幂等冲突，防止旧 ID 绑定新内容。
- 教师修改正文或评分标准：版本变化，形成合法新请求。

### Registry 状态机

每个逻辑 ID 只能在原子临界区内执行以下状态转换：

```text
absent
  → in_flight(attempt=1, providerDeadline)
in_flight
  → succeeded(result, usage, completedAt)
  | failed_retryable(attempt, retryAt, safeError)
  | failed_final(safeError)
  | orphaned_unknown(providerDeadline, quarantineUntil)
failed_retryable
  → in_flight(attempt+1)
orphaned_unknown
  → succeeded(result, usage, completedAt)
  | failed_final(safeError)
```

- `failed_retryable` 只有在已经确定前一 Provider 尝试终止时才允许进入；到达 `retryAt` 后由同一 registry 原子增加 attempt，不能另建并行 entry。
- `failed_final`、`succeeded` 和 `orphaned_unknown` 都是可重挂接状态；`orphaned_unknown` 禁止自动重试同一逻辑版本。
- in-flight 和仍持有底层 promise 的 orphan entry 绝不能被普通 TTL 或容量 LRU 淘汰。若容量已满且没有可淘汰的终态记录，Gateway 拒绝新准入，不得删除活跃记录后重新调用 Provider。
- 终态 TTL 从终态产生时开始，默认 24 小时且必须长于 Provider 最终截止与重挂接窗口；容量淘汰只允许移除已过最短保留期的 `succeeded`、`failed_final` 或已解除 promise 的 orphan tombstone。
- 首版 registry 是有 TTL 和容量上限的 Gateway 单进程内存结构。它只保证同一进程连续可用期间的双击、传输重发和迟到结果复用；跨重启、滚动部署或多实例必须在产品文案和验收中明确不受首版保证，并在公网部署前替换为持久或共享 registry。

状态边的触发和槽位语义固定如下：

| 状态边 | 唯一触发条件 | Provider 槽位 | 重挂接结果 / TTL |
| --- | --- | --- | --- |
| `absent → in_flight` | 原子校验 payload 后成功准入 | 获取 1 个槽位 | 挂接同一 promise；不启动 TTL |
| `in_flight → succeeded` | Provider 已结算且结果通过严格归一化 | 释放槽位 | 返回缓存成功；终态 TTL 开始 |
| `in_flight → failed_retryable` | Provider 已明确终止，错误可重试且 attempt 未耗尽 | 释放槽位 | 返回安全失败/等待至 `retryAt`；不并行重发 |
| `failed_retryable → in_flight` | 到达 `retryAt` 且原子取得槽位 | 重新获取 1 个槽位 | attempt 加 1，挂接唯一新 promise |
| `in_flight → failed_final` | Provider 已明确终止且不可重试，或 attempt 耗尽 | 释放槽位 | 返回缓存安全失败；终态 TTL 开始 |
| `in_flight → orphaned_unknown` | 最终截止、abort 与结算宽限后仍未结算 | **继续占用原槽位** | 返回结果未知；不启动 TTL，不自动重试 |
| `orphaned_unknown → succeeded/failed_final` | 迟到 promise 明确结算，或运维从可信上游状态确认终止 | 释放槽位 | 返回对应缓存结果；此时才开始终态 TTL |

任何定时器、LRU 或普通管理操作都不得释放 `orphaned_unknown` 的 Provider 槽位。只有底层 promise 结算，或运维依据可信的 Provider 状态明确确认该调用已经终止，才能原子释放。若 orphan 数达到硬并发上限，整个新调用准入必须暂停并显示安全诊断；宁可等待人工恢复，也不得用租约到期继续放行从而突破真实上游硬上限。

### 超时

当前 `Promise.race` 返回超时后不应立即丢弃底层 Provider promise。优化后：

- Provider 支持取消时传播 `AbortSignal`。
- Provider 忽略取消时，注册表继续追踪迟到完成或失败。
- 同一逻辑请求再次到达时复用仍在运行的 promise，或返回已缓存成功。
- 队列等待时间与 Provider 执行超时分开计算，不能让排队消耗模型执行预算。

超时分为两个时钟：

- HTTP 调用方响应截止默认保持 360,000ms；到达后仍使用现有安全失败合同返回超时/结果未知语义，registry 保持原调用状态，不新增第二套成功响应合同，也不新开 Provider 请求。
- Provider 最终追踪截止默认 420,000ms，必须至少比 HTTP 响应截止多 30,000ms。到达后发送 abort，并等待默认 30,000ms 的结算宽限。

若宽限后底层 promise 仍未结算，entry 进入 `orphaned_unknown`。同一逻辑版本不得自动重试，原 Provider 槽位持续保留且不得按时间自动释放；若 promise 后续结算，必须原子更新为成功或最终失败并释放槽位。HTTP 截止、Provider 最终截止和结算宽限均可配置，但必须满足顺序关系并有边界测试。未知 orphan 没有自动 TTL；它只受硬并发上限约束，因此最多占用硬上限数量的活跃记录。

### 重试矩阵

| 场景 | 自动行为 |
| --- | --- |
| `429` | 退避并降低并发；不并行重发 |
| 鉴权、余额或配置错误 | 暂停整个队列，避免 N 篇连续失败 |
| 请求合同、Schema 或不可重试业务错误 | 不自动重试 |
| 原 Provider 请求仍在运行或结果未知 | 复用原逻辑请求，不创建第二笔调用 |
| 明确终止的瞬时失败 | 在限次和退避策略内重试 |
| 教师确认文本或修改 rubric | 新版本、新调用，属于有效重批 |

默认重试边界为：实际 Provider 尝试最多 2 次（首次加一次明确终止后的重试）；`429` 未进入 completion 时最多重新排队 5 次；指数退避从 2 秒开始并使用 full jitter，普通上限 60 秒。存在合法 `Retry-After` 时等待时间不得短于它；若其超过 15 分钟，则暂停任务并要求显式恢复，而不是提前重试。鉴权、余额或配置错误暂停整个队列，只有配置修复后的显式恢复或健康检查通过才能继续。

这些值必须作为有界配置进入测试；不得无限重试，也不得仅因为前端连接断开就自动生成新 request ID。任何网络错误只要无法证明原 Provider 尝试已经终止，都进入结果未知路径，不自动重发。

## 设计八：图片输入优化

图片 token 与分辨率相关，但官方没有给出适用于中文手写作文的固定压缩质量或 token 公式。因此分两步处理：

### 无损阶段

- 保留页面顺序和方向语义。
- 清除不需要的文件元数据。
- 不把动图作为普通作文页输入。

本阶段不得重采样、缩放或重新编码图片。任何改变像素或编码质量的处理，即使输入超过官方建议分辨率，也必须进入下述实验阶段并先通过质量门。

### 实验阶段

对相同授权样本测试多个长边尺寸与编码方案，记录：

- 图片字节数。
- Provider prompt tokens。
- 识别字符错误率。
- 关键字迹风险召回。
- 单篇耗时与结构化成功率。

只有质量门槛全部通过后，才把某一档设为默认。图片优化不得改成 OCR 预处理或独立识别阶段。

## 设计九：运行配置必须显式

生产或真实 Kimi 运行不得因缺少 `GRADING_PROVIDER` 而静默回退 mock。

- 测试必须显式注入 fake/mock Provider。
- 本地 mock 开发必须显式设置 `GRADING_PROVIDER=mock`。
- 真实运行必须显式设置 `GRADING_PROVIDER=kimi`、模型、reasoning effort、阶段 token 预算和并发硬上限。
- `/health` 或等价安全状态必须显示 Provider、模型、reasoning effort、超时和并发上限，但绝不显示 Key。
- 真实配置缺失或非法时应启动失败或明确标记不可用，不得生成看似真实的 mock 批改。

## 设计十：错误隔离与教师界面

进度页至少区分：

- 等待批改。
- 排队中。
- 批改中。
- 因限流等待。
- 待教师复核。
- 可重试失败。
- 不可重试失败。
- 已完成。

任务级鉴权或账户配置错误暂停新请求；已经成功的作文保留。单篇非法结果只影响当前作文。只有 `retryable=true` 的失败才显示重试动作。

教师无需理解 RPM、TPM 或缓存细节；普通 UI 只显示可行动状态。token、缓存和并发详情进入开发诊断或内部报告。

## 质量验证设计

### 数据集

只使用教师自建合成作文或得到明确授权且彻底去身份化的样本，覆盖：

- 清晰、模糊、倾斜、低光照片。
- 多种中文手写风格。
- 单页、多页和 PDF 转换页。
- 涂改、边注、印刷题干与学生正文混合。
- 不同长度和不同分数段。

禁止把真实未授权未成年学生材料用于调优。

### A/B 方式

- A：当前实现和当前 Prompt/Schema。
- B：候选优化实现。
- 使用同一任务、同一页面顺序和同一模型基线。
- 教师盲审识别文本、维度分、总分、证据、修改建议和复核风险。
- 单独统计结构化失败、截断、429、超时和重试次数。

基线必须冻结并记录代码 commit、模型、reasoning effort、Prompt/Schema 版本、阶段 token 上限和匿名数据集 manifest hash。质量集至少包含 40 篇不同作文，按单页/多页、清晰/困难字迹、低/中/高分段分层，每个主要分层至少 8 篇；所有样本都必须有教师确认正文和参考评分。结构化稳定性另执行至少 100 次真实调用 soak，只有不超过 1 次合同失败时才可声称达到 99% 目标；调用前必须单独取得费用授权。

教师盲审采用随机 A/B 顺序。至少 20% 样本由第二名合格教师独立复核；若当前只有一名教师，则对这部分样本在打乱顺序和至少 7 天间隔后重复盲审。两次结论跨越质量门时必须仲裁，不允许挑选有利一次。

指标定义：

- CER 同时报告逐篇宏平均和全字符微平均；使用配对 bootstrap 95% 置信区间，候选相对基线退化的上界不得超过 0.5 个百分点。
- 评分误差为 `abs(modelScore - teacherReferenceScore) / fullScore`；使用逐篇配对差值的 95% 置信区间，上界不得超过 0.01，即满分尺度的 1 个百分点，而不是“1 分”。
- “重要问题”指教师标为会影响任务完成、语法逻辑、维度得分或必须复核的标注。候选重要问题召回率不得比基线降低超过 5 个百分点，且学生串联、错误任务上下文和高风险字迹漏标均为零容忍事件。
- 证据定位成功率以引用能否在最终 transcript 中唯一定位为分母；Gateway 接受的结果必须为 100%。
- token 只按唯一 Provider completion 聚合；重挂 HTTP 调用不得重复计数。

### 放行门槛

1. 同一 Gateway 进程连续可用期间，正常调用数符合预算模型。
2. 单篇总 token 中位数至少降低 25%。
3. 结构化成功率不降低，目标不低于 99%。
4. 正文字符错误率退化不超过 0.5 个百分点。
5. 教师参考评分归一化误差退化不超过满分的 1%。
6. 重要问题召回和证据定位满足上述明确阈值，且建议盲审不出现系统性退化。
7. 同一作文版本的重复传输不产生第二次 Provider completion。
8. 账户支持有效并发不低于 4 时，30 篇全班完成时间至少降低 60%。

任一质量门槛不满足，对应优化不得默认启用。

## 实施与上线顺序

### 阶段 0：观测与基线

- 保留当前行为，仅接入 usage、finish reason 和阶段耗时。
- 使用 fake transport 完成合同测试。
- 获得用户明确授权后，使用本地忽略环境中的真实 Key 和授权样本建立基线。

### 阶段 1：低风险单次调用优化

- 逐篇 Provider 任务上下文投影去重。
- `prompt_cache_key` 与稳定前缀。
- 移除 Provider 原始订正全文和提升全文，继续由 Gateway 重建。
- AI 评分标准从两次 completion 合并为一次。
- 分阶段 completion token 配置入口。

### 阶段 2：幂等和最大吞吐

- Gateway 在途/成功注册表与 payload 冲突保护。
- 超时后继续追踪底层调用。
- 一次启动全班的前端队列。
- Gateway 硬准入和自适应并发。
- 429 退避、任务级暂停和单篇失败隔离。

### 阶段 3：图片实验

- 仅在授权测试集中评估尺寸和编码。
- 达到质量门槛后通过独立开关上线。

每一阶段必须有独立开关和明确回退路径；不得把所有变化一次性不可逆地发布。

## 测试策略

### Transport 与 Provider

- 普通响应以及任一 usage 字段缺失、非法、相互矛盾时的 `unknown` 解析；缺失值不得伪造为 0。
- 同一 Provider completion 被多个重挂 HTTP 请求复用时 token 只汇总一次。
- `finish_reason=stop/length/content_filter`。
- Kimi body 包含稳定 `prompt_cache_key`，且不包含学生姓名。
- cache key 随 rubric/policy/schema revision 改变，且出站值不是教师命名或普通业务 ID。
- 各阶段独立 token budget。
- 非流式严格 JSON Schema 保持启用。
- 评分标准路由每次正常请求只调用 transport 一次，材料只出现一次。

### Prompt 与合同

- 外部 v2 任务包仍被严格验证。
- Provider 投影只包含 canonical 单份上下文。
- `sourceEvidence` 和重复上下文不进入逐篇 Prompt。
- 规范化 `reviewWarnings` 保留且只出现一次。
- Provider schema 不再要求原始 `correctedText` 与 `improvedText`。
- Gateway 重建后的外部 `grading-result-v2` 与现有 UI fixture 兼容。
- 字段级数组和字符串上限均有边界测试。

### 幂等与超时

- 同 ID、同 payload 的并发请求只调用 Provider 一次。
- 同 ID、不同 payload 返回安全冲突。
- 超时后的迟到成功可被相同逻辑请求复用。
- Registry TTL 和容量淘汰不会错配结果。
- 活跃 in-flight/orphan promise 不会被 TTL 或容量淘汰；容量满时拒绝新准入。
- HTTP 响应截止、Provider 最终截止、结算宽限和终态 tombstone TTL 的顺序与边界。
- `orphaned_unknown` 始终占用 Provider 槽位且不受 TTL/LRU 淘汰；占满硬上限后拒绝新准入。
- `failed_retryable`、`failed_final`、`orphaned_unknown` 的原子转换、最大 attempt 和退避上限。
- 鉴权错误暂停队列；429 降低并发；不可重试错误不显示重试。

### 调度

- 一次动作将全部待批改作文入队。
- 在途数永远不超过动态目标和硬上限。
- 成功后补槽、429 后退避、单篇失败后其他作文继续。
- 教师修改正文或 rubric 后使用新版本，旧迟到结果不会覆盖。
- 多任务同时运行仍受 Gateway 全局硬上限保护。

### 隐私与配置

- 指标日志不含正文、图片、base64、文件名、姓名、Key 或原始响应。
- 真实运行缺少显式 Provider 时不会静默 mock。
- health 仅返回非敏感运行基线。
- ignored `.env` 继续被 Git 忽略，示例环境文件不含真实值。

### 纵向验收

1. 无材料、教师直接评分标准：创建阶段 0 次模型调用，随后一键批改全班。
2. 有材料、教师直接评分标准：材料上下文 1 次，逐篇不重复材料。
3. AI 评分标准：材料只发送一次且 transport 只调用一次。
4. 多页作文：每篇一次 completion，页面顺序保持。
5. 429：队列自动等待降速，不产生并行重复调用。
6. 超时后教师重试：单进程连续可用期间复用原 in-flight、orphan tombstone 或已完成结果。
7. 教师修改正文：新版本以确认文本重批，不发送图片。
8. 结果页面、班级总览和教师确认功能保持现有可见内容。

## 真实 API 验证与 Key 边界

设计、实现和 fake 测试阶段不需要真实 Key。进入真实基线和 A/B 时：

- 用户将 Key 写入被 Git 忽略的 Gateway 本地环境文件或进程环境，不直接粘贴到聊天、代码或日志。
- 只使用合成或明确授权的匿名样本。
- 首先验证账户 K3 权限、实际并发和限流，再逐步增加请求量。
- 真实调用前再次向用户确认本轮预计请求数、样本范围和可能费用。
- 验证报告只保留匿名聚合指标，不保存 Provider 原始响应或作文全文。

## 官方能力边界

- Kimi K3 支持中国区 Chat Completions、多模态图片、`reasoning_effort`、strict JSON Schema、usage 和 `prompt_cache_key`。
- 自动上下文缓存只会尝试复用重复初始前缀，不保证命中；`cached_tokens` 应按可选字段处理。
- K3 当前不支持 Batch API，因此本轮不以 Batch 作为主流程或降级。
- 图片 token 动态计算，分辨率越高通常消耗越多，但中文手写作文的具体压缩质量必须实测。
- 账户并发、RPM、TPM 和 TPD 随账户等级与平台规则变化，不得硬编码官方展示表。

官方参考：

- https://platform.kimi.com/docs/api/chat
- https://platform.kimi.com/docs/guide/kimi-k3-quickstart
- https://platform.kimi.com/docs/guide/use-context-caching-feature-of-kimi-api
- https://platform.kimi.com/docs/guide/use-kimi-vision-model
- https://platform.kimi.com/docs/guide/use-batch-api
- https://platform.kimi.com/docs/pricing/limits

## 与既有设计的关系

`2026-08-27-optional-material-unified-rubric-design.md` 继续描述已经实施的创建任务产品结构和材料合同。本设计只覆盖后续 AI 成本、延迟、调用次数和调度优化，并明确取代旧设计中的以下实现基线：

- “评分标准继续生成与复核两阶段”改为正常路径一次 completion。
- “不扩展批量并发或后台队列”改为一次启动全班、前端自动队列和 Gateway 有界准入。
- “显式重试使用新 request ID”改为先按逻辑版本幂等复用；只有内容或 rubric 版本真实变化，或明确终止后的受控新尝试，才允许产生新调用。

旧 OCR 规格、旧文本批改合同和历史 Provider 计划仍只用于追溯，不得覆盖本设计和项目记忆中的当前决策。
