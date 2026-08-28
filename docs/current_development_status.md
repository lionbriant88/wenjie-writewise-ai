# 当前开发状态

最后更新：2026-08-28

## 2026-08-28：AI 调用成本、延迟与全班吞吐优化设计已批准（尚未实施）

- 已完成对创建材料理解、AI 评分标准生成、逐篇多模态批改、Prompt/Schema、前端调度、Gateway 超时与 Kimi 官方能力的只读审计。当前实现仍是 AI rubric 两次顺序 completion、全局单篇串行、无自动全班队列、无 Gateway 幂等复用，且 transport 丢弃 Provider usage；这些是待优化基线，不得误述为已完成。
- 用户选择“全班尽快完成”，并批准“最大吞吐目标 + 稳健有界并发”：教师一次启动全班，系统在显式硬上限内根据成功率、耗时、`429` 和可选 TPM 预算自适应升降；不得无上限并发，不使用 K3 Batch，也不把多名学生合并进一个模型请求。
- AI 辅助评分标准的正常路径将从“生成 + 携带材料复核”两次 completion 合并为一次；材料只发送一次，严格 Schema 和本地业务校验负责确定性验证，教师创建任务继续承担最终人工确认。
- 对外 v2 合同和 `POST /grading/grade-images` 保持不变。Gateway 将向 Provider 投影一份 canonical 任务上下文，删除顶层/rubric 重复、逐篇不消费的溯源元数据和学生姓名；同任务稳定前缀使用 `prompt_cache_key`，但缓存不作为正确性前提。
- 第一阶段输出压缩只删除无损重复：Provider 不再生成最终已由 Gateway 根据正文和 `sentencePairs` 重建的原始 `correctedText` / `improvedText`，外部 `grading-result-v2` 和教师页面保持完整。其他反馈字段须等真实 A/B 证明质量不退化后再合并。
- Gateway 将记录脱敏的阶段耗时、`prompt_tokens`、`completion_tokens`、`total_tokens`、可选 `cached_tokens` 和 `finish_reason`；不记录正文、图片、Base64、学生姓名、完整 Prompt、Key 或 Provider 原始响应。
- 同一任务、作文版本和 rubric 版本建立逻辑幂等；重复传输或结果未知时复用 in-flight/成功结果。`429` 退避降并发，鉴权/配置错误暂停全班队列，不可重试错误不自动重试，单篇失败不阻断其他作文。
- 质量目标包括：单篇总 token 中位数至少降低 25%；结构化结果成功率不低于当前且目标不低于 99%；正文字符错误率退化不超过 0.5 个百分点；教师参考评分归一化误差退化不超过满分 1%；账户支持有效并发至少 4 时，30 篇总耗时较当前串行至少降低 60%。所有目标必须用合成或明确授权的匿名样本验证。
- 图片压缩暂不直接启用；先测尺寸、token、耗时、正文识别和重要字迹风险，达标后才通过独立开关上线。真实 Key 仅允许置于 ignored 本地环境或进程环境，真实基线与 A/B 前仍需单独确认样本、调用数和费用。
- 已批准设计：`docs/superpowers/specs/2026-08-28-ai-pipeline-cost-latency-optimization-design.md`。用户已确认该规格，TDD 实施计划已写入 `docs/superpowers/plans/2026-08-28-ai-pipeline-cost-latency-optimization.md`，覆盖 usage/耗时观测、单次 rubric、canonical Prompt、Provider 输出去重、Gateway 逻辑幂等与双截止、全局硬准入、前端任务队列、质量 benchmark 和分轮真实授权闸门。计划尚未执行，真实 Kimi 基线、A/B、100 次 soak、30 篇吞吐与图片实验均未获本轮授权、也未运行。

## 2026-08-28：创建任务页可选材料与统一评分标准已实施

- 创建任务页现已收口为一个单页、单一路径：原题材料与 AI 辅助生成均为可选能力，页面没有“教师模式 / AI 模式”、评分标准来源选择或两套流程分支。进入学生作文上传阶段的唯一业务门槛是当前结构化评分标准可用。
- 原题材料区明确为“建议上传作文原材料（选填）”，支持 JPEG、PNG、WebP、PDF 和 DOCX；PDF 在浏览器逐页规范化为有序图片，DOCX 只提取正文文本并提示复杂排版局限。无材料时可直接按教师填写内容创建任务。
- 页面默认提供可编辑的内容与任务完成 40%、语言质量 40%、结构与连贯 15%、卷面与可读性 5% 四个维度。名称、说明和权重均可调整，普通维度可增删；卷面与可读性维度不可删除但权重可调。满分、写作要求、维度字段、唯一卷面维度及权重总和 100% 共同构成确定性校验，材料、AI 调用或内部来源字段不增加门槛。
- 最终“创建任务并上传作文”同时完成教师确认并保存一份 `confirmed` 任务包。教师确认的写作要求保持最高权威，位于任务包及批改请求 `writingRequirements[0]`；后续材料推断要求只能追加，不能覆盖或排到教师要求之前。
- 原题材料只在创建阶段理解一次：已有同一材料签名的 AI 结果会复用上下文，否则提交时提炼一次。材料解析失败不会使合法评分标准失效，页面会明确提示并仅按教师填写的写作要求继续创建；原题图片、PDF、DOCX 二进制或提取文本不会随每篇作文重复发送。
- 学生作文主链路保持不变：继续通过 `POST /grading/grade-images` 使用 `multimodal-grading-request-v2` / `grading-result-v2`，由 `kimi-k3` 在同一次多模态请求中完成正文识别、评分与反馈；没有恢复 OCR Client、OCR Gateway、批改前 OCR 状态或确认步骤。
- 最终整分支审查已统一写作要求的 10,000 Unicode 码点边界，覆盖表单、确认任务包、批改请求和 Gateway 契约。材料 add、retry、remove、reorder 现在会在用户操作时立即使在途或已应用的 AI 材料上下文过期；迟到结果不会覆盖教师字段，已应用评分标准仍可创建任务，并显示精确的非阻断重新生成提示，直到新快照生成成功。
- Gateway 的 `textMaterials` multipart 单字段上限现由 10 个材料单元、每个 30,000 文本码点、256 显示名码点、每码点最坏 6 字节 JSON 编码及固定 JSON 开销推导为 1,815,651 字节，仍保持有限；`POST /grading/grade-images` 与任务材料路由共用硬截止竞态，Provider 即使忽略 `AbortSignal` 并晚成功或晚拒绝，也会先返回稳定超时失败且不会二次响应。
- 最终修复复审第 1 轮又补齐两个 Unicode 边界：`grade-images` 元数据中的任务摘要改按码点计数，无材料任务由 10,000 个非 BMP 码点写作要求形成的 10,010 码点摘要可穿过真实 Gateway 路由到达 fake Provider，10,001 个要求码点仍在 Provider 前被严格合同拒绝；DOCX 规范化后的 30,000 码点正文可完整保留，30,001 码点稳定返回 `docx_too_long`。
- 最终修复复审第 2 轮把 `grade-images` 元数据的 Unicode 码点校验改为常量内存的早停计数：任何超限语义字符串最多迭代 `maxLength + 1` 个码点。一个仍低于 32 MiB multipart transport 上限、超过 1 MiB 的非法 `requestId` 现在只迭代 129 次，安全返回内容无关的 HTTP 400、不会调用 Provider；已知无效 metadata 的错误响应也不再重复解析同一字段。既有 10,000 非 BMP 写作要求成功与 10,001 拒绝边界保持通过。

### 本轮精确自动化验证

| 范围 | 最终结果 |
| --- | --- |
| 新增创建任务纵向流程 | 1 个测试文件、9 个用例通过 |
| Grading Prompt 教师权威指令 | 1 个测试文件、12 个用例通过 |
| 网站创建 / 批改请求 / 状态聚焦组 | 5 个测试文件、84 个用例通过 |
| 网站上传 / 进度聚焦组 | 3 个测试文件、18 个用例通过 |
| 复审加固后的创建 / 上传 / 多模态 / 进度相邻组 | 5 个测试文件、53 个用例通过 |
| Grading Gateway prompt / server / multipart 聚焦组 | 3 个测试文件、45 个用例通过 |
| 最终审查网站写作要求契约聚焦组 | 6 个测试文件、113 个用例通过 |
| 最终审查网站材料新鲜度相邻组 | 5 个测试文件、74 个用例通过 |
| 最终审查 Gateway multipart / 硬超时聚焦组 | 2 个测试文件、94 个用例通过 |
| 最终修复复审第 1 轮网站 DOCX 相邻组 | 2 个测试文件、29 个用例通过 |
| 最终修复复审第 1 轮 Gateway 路由组 | 1 个测试文件、31 个用例通过 |
| 最终修复复审第 2 轮 Gateway 元数据早停组 | 1 个测试文件、32 个用例通过 |
| 网站全量 | 59 个测试文件、598 个用例通过 |
| Grading Gateway 全量 | 24 个测试文件、713 个用例通过 |
| 网站质量门 | Typecheck、lint、生产构建均通过；构建转换 409 个模块 |
| Gateway 质量门 | Typecheck 与共享评分运行时验证均通过；输出 `shared scoring runtime ok` |

- 边界回归证明：新建任务经真实 `AppStateProvider`、真实学生上传页和真实入队转换后直接进入 `pending_grading`，未出现 `pending_ocr` 或 `ocr_running`。在覆盖的两页学生作文回归用例中，multipart 的完整字段集合恰为一个 `metadata` 和两个 `pages`；真实的可变页数不变量是每篇作文 multipart 只包含一个 `metadata` 以及该学生当前作文的全部有序 `pages`，不含任何原题材料字段、二进制或 DOCX 文本。
- 桌面端 `1440 × 900` 与移动端 `390 × 844` 浏览器验收均通过，覆盖无材料、图片、两页 PDF、DOCX、混合材料、默认及编辑后权重、AI 失败保留教师输入、材料上下文失败继续创建、进入现有学生卡片，以及移动端无横向溢出。浏览器控制台在验收后没有 warning/error。
- 本次实现、自动化验证与浏览器验收仅使用 fake 客户端、合成或仓库内 fixture、本地 mock Gateway 和受控失败服务，没有发起真实 Kimi 或其他外部 Provider 调用，也没有使用或传输个人材料。真实 Provider、真实材料理解和模型质量 smoke 本轮均未运行，仍须另行取得授权后单独执行；上述结果不代表真实材料理解或模型质量已验收。

## 历史快照：截至 2026-08-27 的创建任务页可选材料与统一评分标准（当时尚未实施；已由 2026-08-28 记录取代）

- 用户已批准重构创建任务流程：原题材料和 AI 生成评分标准都从必选项改为可选项；满分与一份当前有效的结构化评分标准才是进入学生作文上传阶段的业务门槛。
- 页面不得显示“教师模式 / AI 模式”或要求教师选择评分标准来源。页面只展示一套评分标准编辑器；教师可以直接填写，也可以点击材料辅助生成按钮让 AI 回填，二者最终都以当前字段是否通过校验决定能否继续。
- 任务名称选填，留空使用“作文批改任务”。教师主要填写“写作要求”；默认维度为内容与任务完成 40%、语言质量 40%、结构与连贯 15%、卷面与可读性 5%，并允许调整。卷面与可读性维度不可删除，总权重必须为 100%。
- 原题材料区域标注“建议上传作文原材料（选填）”，首版支持 JPEG、PNG、WebP、PDF、DOCX。PDF 客户端逐页转 PNG；DOCX 只提取正文文本；旧 `.doc` 不支持，复杂排版、表格和嵌入图片重要时建议转 PDF。
- 没有材料时，任务上下文直接来自教师确认的写作要求；有材料时只在创建阶段理解一次，并与教师输入合并，冲突时教师输入优先。材料解析失败不阻断合法教师评分标准的创建，原材料也不会随每篇作文重复发送。
- 最终“创建任务并上传作文”同时完成评分标准确认，不再设置独立确认门槛。内部可保留评分标准来源和材料处理状态，但这些状态不应在界面形成两条流程。
- 学生作文主链路不变：仍走 `multimodal-grading-request-v2`、`grading-result-v2` 与 `POST /grading/grade-images`，由 `kimi-k3` 在同一次多模态请求中完成正文识别和批改；不恢复 OCR。
- 本节记录的是截至 2026-08-27 的实施前状态：当时创建页仍要求图片材料、AI 生成和单独确认，随后按测试先行完成了改造。当前状态以顶部 2026-08-28 已实施记录为准，本节已由该记录取代。

## 本次新增进展：多模态批改策略 Phase 1 验证与交接

- 已完成 `grading-policy-v1` 的首轮策略收口：图片首批与教师确认文本后的重批使用同一份保守策略。可合理读成正确单词的字迹歧义按正确处理并保持静默；只有影响语义、语法或评分的重要歧义才作为可读性问题进入复核。
- 评分继续优先覆盖语法、逻辑、任务完成度和表达；逻辑诊断必须有结构化上下文依据，问题引用必须能在 transcript 中精确定位。全文纠错稿、问题关系和前后端数据线协议均采用严格校验，拒绝不安全或无法重建的结果。
- 合成 golden fixtures 与离线 evaluator 已完成并纳入 Gateway 自动化验证。该轮离线 evaluator 的状态为 `not_run_missing_local_credentials`：当时本地缺少 `KIMI_API_KEY`，未发生任何外部 Provider 调用；这一历史结果不能表述为模型已经通过评测。2026-08-20 的真实 Kimi 人工验收见文末最新记录。
- 权威合成 fixture 已采用仓库提交的 canonical PNG；校验固定 PNG 签名、`1200×700` 尺寸、字节长度和 SHA-256，不依赖环境字体。SVG 只保留为非权威设计源，不再声明渲染器跨机器字节确定性。
- evaluator 的 CLI 子进程验证已直接捕获 stdout、stderr 和退出码。无本地凭证时会输出四条白名单化的 `not_run_missing_local_credentials`，退出码为 2，且外部 Provider 调用数为零。
- 本轮不记录 API key、Provider 原始响应、作文全文、图片内容或学生身份；未修改归档历史规格。

### 本轮精确验证矩阵

| 范围 | 命令 | 最终结果 |
| --- | --- | --- |
| Grading Gateway | `Set-Location grading-gateway; npm.cmd test` | 20 个测试文件、373 个用例通过 |
| Grading Gateway | `Set-Location grading-gateway; npm.cmd run typecheck` | 通过 |
| Grading Gateway | `Set-Location grading-gateway; npm.cmd run verify:shared-scoring-runtime` | 通过（`shared scoring runtime ok`） |
| 网站 | `Set-Location app; npm.cmd test` | 45 个测试文件、289 个用例通过 |
| 网站 | `Set-Location app; npm.cmd run typecheck` | 通过 |
| 网站 | `Set-Location app; npm.cmd run lint` | 通过 |
| 网站 | `Set-Location app; npm.cmd run build` | 通过 |
| 仓库 | `rg -n -e 'Preserve student spelling and grammar exactly' -e 'all spelling errors' -e '逐字保留所有拼写' -e 'transcriptionWarnings' -e 'transcription_uncertain' grading-gateway/src app/src`、`git diff --check` | 见下述分类；diff 检查通过 |

### 策略冲突扫描分类

- 生产代码仅有 `EssaySourcePanel` 的本地显示参数名 `transcriptionWarnings`；其唯一运行时传入值是当前契约的 `recognitionWarnings`，不属于 Gateway 输入/输出线协议，也不会把旧字段传给 Provider。
- `transcriptionWarnings` 其余命中均位于测试：一部分验证 schema 明确拒绝旧字段，另一部分是兼容性/负向夹具；这些安全回归保留，不得误删。
- 旧拼写指令只在断言“不得出现”的测试中命中；`transcription_uncertain` 没有命中。活跃生产策略未发现与 `grading-policy-v1` 冲突的指令。

### 下一阶段

下一阶段执行 `2026-08-15-remove-ocr-web-migration.md`：保持网站现有布局不变；小程序完整功能仍属于后续计划。

## 历史记录：真实 AI 批改 Gateway、DeepSeek Provider 与教师确认闭环 v0.1（已由多模态 v2/Kimi 主流程取代）

> 本节仅保留 2026 年 7 月阶段性实现记录，不再代表当前运行方式。当前合同、路由和 Provider 以文末的多模态 v2/Kimi 说明为准；旧 `GradingRequestV1`、`POST /grading/grade` 与 DeepSeek 配置不得用于现网部署。

- 已建立 Provider 无关的 `GradingRequestV1`、`AiGradingResultV1` 与 `GradingFailureV1`；前端只投影允许字段，并完整校验嵌套结构、HTTP 成功/失败类型、`requestId` 和 `essayId` 绑定。
- 新结果通过唯一适配器进入现有 `GradingResult`，没有建立第二套页面状态模型。Gateway mock、Gateway mock_failure、浏览器本地 mock 回退和真实 Provider 共用同一结果契约。
- Grading Gateway 已提供 `POST /grading/grade`，包含 256 KB JSON 限制、统一 400/413 安全错误、CORS、超时、Prompt、结构化结果归一化和失败映射；错误不会回显作文、原始 body、上游响应或 stack。
- 已实现 DeepSeek Provider 代码，默认模型 `deepseek-v4-flash`，显式 thinking mode、temperature 和 max_tokens；本轮所有自动化测试只使用 fake transport，没有使用真实 API key、网络请求或模型额度。
- JSON Prompt 包含 `json` 指令和最小完整示例；Provider 测试覆盖空 content、空 choices、content filter、资源不足、tool calls、400、422，以及 `finish_reason` 缺失、null 和未知值。
- MVP 进度页改为逐篇批改，不做批量并发或后台队列；处理中禁用重复点击，不自动重试。失败后保留显式重试、浏览器本地 mock 回退和转人工路径。
- `requestId` 只用于追踪和忽略旧成功、旧失败及转人工后的迟到响应，不提供严格幂等；显式重试仍可能产生第二次真实调用费用。
- 真实 AI 或 mock 结果返回后进入 `grading_ready` 且 `teacherReviewed=false`；编辑评分或评语不会确认，只有教师点击“确认本篇批改”后才进入 `completed` 且 `teacherReviewed=true`。
- 详情页使用 Provider 中立的“真实 AI”或“mock 回退”来源标签，展示教师复核原因；模型自报 confidence 不进入教师 UI，也不驱动正确率或复核建议。
- 分数档次由任务满分动态计算；班级统计只纳入教师已确认结果。教师精选素材继续进入现有流程，现有高频问题和改写练习仍明确标记为 mock 洞察，不宣称已实现真实 AI 班级洞察。
- AI 批改与教师确认结果仍只保存在当前 React 状态生命周期，刷新或重启不保证恢复。读后续写真实批改仍不在本轮范围内。
- 隐私边界：真实验收仅允许教师自建合成作文或彻底去身份化的测试作文；真实未成年学生数据投入使用前，仍需另行补充并评审数据处理、授权、去标识化和删除规则。
- 自动化验证结果：
  - 前端全量：38 个测试文件、219 个用例通过；`npm.cmd run lint` 与 `npm.cmd run build` 通过。
  - Grading Gateway：9 个测试文件、85 个用例通过；`npm.cmd run typecheck` 通过；跨目录导入共享计分规则的真实 `tsx` 运行验证通过。
  - OCR Gateway 回归：7 个测试文件、45 个用例通过；`npm.cmd run typecheck` 通过。
  - Provider 边界扫描：`app/src` 非测试生产文件没有 DeepSeek、Provider 配置或 Authorization 命中。
  - 密钥边界扫描：仅扫描 Git tracked 文件与 Git 判断可提交的 untracked 文件，未读取 ignored `.env`，未发现疑似密钥。
  - ignore 方向验证：`grading-gateway/.env` 被忽略；`grading-gateway/.env.example` 与 `app/.env.example` 均未被忽略。
- 已新增无密钥运行与隐私说明：`docs/real_ai_grading_gateway_deepseek_v01.md`。
- 尚未完成：真实 DeepSeek API 与完整 UI 纵向 smoke。Task 12 保持在人工授权闸门前，未经用户明确授权不得发起真实请求。

## 本次新增进展：OCR 质量评估影子模式与选择性复核基础 v0.3a

- 已新增版本化审计数据：`OcrTranscriptAudit.auditVersion = ocr-audit-v1`，`OcrShadowAssessment.assessmentVersion = ocr-shadow-v1`。
- `sourceText` 固定表示现有前端 OCR Client 最终交给 UploadPage、且尚未经过教师编辑的统一来源文本；它不是 PaddleOCR 原始文本或 Python 原始输出。
- 教师确认后的忠实转写保存为 `confirmedTranscript`；兼容字段 `ocrText` 与最新确认转写同步，后续忠实修订不会覆盖 `sourceText`。
- mock、remote、manual、fallback、partial 和多次重试均按最终已应用来源替换审计记录，不保留或静默恢复更早尝试。
- 影子评估接收显式 `expectedPageIds`，使用 `pageId` 集合差集判断页面结果缺失；文本长度异常不被称为漏行，漏行只能由人工基准转写对比确认。
- `assessedAt` 和 `confirmedAt` 由调用边界注入，Provider 无关的纯函数不读取系统时间。
- 编辑距离、变更字符数、CER 和 WER 集中在 `ocr-text-metrics-v1` 纯函数 service 中，UploadPage 与 benchmark 不重复实现指标算法。
- 影子评估保持不可见，不显示质量卡片、建议、徽标或自动放行结果，不改变教师确认和进入批改队列的现有行为。
- 已新增一次性本地私有 benchmark：直接构造现有 `NodePaddleRunner` 与 `PaddleLocalOcrProvider`，并通过 Provider 内部复用 `normalizeProviderResult`；脚本不启动 Express，不监听 8787。
- benchmark TypeScript 已进入 Gateway `tsconfig`、typecheck 和 Vitest 范围；固定退出码为 `0 = 全部完成`、`1 = 命令级致命失败`、`2 = 完成但存在样本失败`，`partial` 本身仍属于已完成样本。
- 私有输入只允许位于 ignored 的 `ocr-gateway/local-private-samples/`，匿名结果只允许写入 ignored 的 `ocr-gateway/local-private-results/`；日志和结果不包含作文全文、确认转写全文、本机绝对路径或学生身份信息。
- 当前应用状态仍仅保存在 React 内存中，刷新后不会持久化审计记录。
- 本轮自动化测试只使用合成 fixture 与 fake runner，没有读取或运行任何真实私有样本，也没有声明真实样本 CER/WER 指标。
- 本轮验证结果：
  - 前端审计 service：3 个测试文件、14 个用例通过。
  - AppState 审计生命周期：1 个测试文件、1 个用例通过。
  - UploadPage：1 个测试文件、23 个用例通过，覆盖 mock、remote、manual、fallback、partial、成功重试、失败重试、不可见性和原有入队行为。
  - 前端全量：30 个测试文件、146 个用例通过；`npm.cmd run lint` 与 `npm.cmd run build` 通过。
  - 私有 benchmark：2 个测试文件、10 个用例通过。
  - OCR Gateway 全量：7 个测试文件、45 个用例通过；`npm.cmd run typecheck` 通过。
  - 边界扫描：`app/src` 生产代码 Provider-specific 命中 0，可见影子提示命中 0；benchmark 服务监听命中 0；纯审计 service 内部系统时间调用命中 0。
- 未新增 `normalizedText`、自动断词合并、字符级 `correctionEvents`、可见质量卡片、自动放行、AI OCR、Provider 更换或真实 AI 批改。
- 下一步建议：由用户准备匿名且不入 Git 的 20-40 篇私有样本并显式运行一次性 benchmark，仅用于决定后续优化方向，不用于制定生产级自动放行阈值。

## 本次新增进展：PaddleOCR 本地真实识别 smoke test v0.2.1

- 已在 `ocr-gateway/.venv` 创建项目本地 Python 环境，使用 Codex bundled Python 3.12.13。
- 已安装 PaddleOCR 本地依赖：PaddleOCR 2.10.0、PaddlePaddle 2.6.2；并补充 `setuptools>=70` 到 `ocr-gateway/requirements.txt`，避免 PaddlePaddle import 时缺少 setuptools。
- 已将 `.venv/`、Python 缓存、Paddle 模型缓存、local smoke 样本和 OCR 输出加入 `.gitignore`，避免本地环境、真实样本或临时产物进入 Git。
- 受限 Windows 环境下，Paddle 默认会尝试写 `C:\Users\lionb\.cache\paddle`；本轮 smoke 将 `USERPROFILE` / `HOME` / `XDG_CACHE_HOME` 重定向到 `ocr-gateway/.paddle-home` / `ocr-gateway/.paddle-cache`。
- runner 级合成图 smoke 已跑通：`scripts/paddle_ocr_runner.py --manifest local-samples/manifest.json --output local-samples/output.json --lang en` 返回结构化 JSON，识别出 3 行英文文本，confidence 约 0.984。
- Gateway 合成图 smoke 已跑通：Express app -> `paddle_local` provider -> Python runner -> PaddleOCR -> unified `OcrEssayResult` 返回 `status: success`。
- Dev server `/health` 临时 smoke 已通过：`http://127.0.0.1:8791/health` 返回 200；curl multipart OCR 因 PowerShell/curl 的 `pageIds` 引号传递问题被服务正确拒绝，未作为产品问题处理。
- 本轮没有提供真实学生作文图片，因此未执行真实学生样本 UploadPage 手工 smoke test；下一步应准备不入 Git 的 1-3 张真实样本后再做浏览器上传验证。
- 本轮没有新增产品 UI、没有改 UploadPage 主流程、没有让前端知道 PaddleOCR、没有接真实 AI、没有做 OCR 坐标 / PDF / Word / 硬件能力。

## 本次新增进展：PaddleOCR 本地真实 OCR Provider 接入 v0.2

- OCR Gateway 已新增 `paddle_local` provider。
- real OCR 现在可走本地 PaddleOCR runner，不再只有 Gateway `mock` provider 可用。
- PaddleOCR provider 只存在于 Gateway；前端仍然只认 `mock OCR` / `real OCR`，`app/src` 不得出现 PaddleOCR / `paddle_local` / `PADDLE_OCR` / Python runner 逻辑。
- Node 侧通过 `child_process.spawn` 启动 `scripts/paddle_ocr_runner.py --manifest <manifestPath> --output <outputPath> --lang <lang>`，不使用 `exec`、字符串 shell 或 `shell: true`。
- 临时文件使用 `fs.mkdtemp(os.tmpdir())` 创建在 `wenjie-paddle-ocr-*` 目录下，并在 `finally` 中清理。
- 超时会杀掉 Python 进程；`PADDLE_OCR_TIMEOUT_MS` 优先，其次回退 `OCR_TIMEOUT_MS`，无效或缺失时默认 60000ms。
- 环境失败返回脱敏后的 environment message，不暴露 traceback、path、args 或 env。
- 结果会统一归一化为 `OcrEssayResult`；单页局部失败保留 `paddle_page_failed`；成功页回填 OCR draft；失败时仍保留 mock / manual / retry 路径。
- Python runner 会过滤 NaN / Infinity 等非有限 confidence，confidence 缺失或异常不阻断文本返回。
- 本次只新增样本评估文档，不新增页面、dashboard、chart 或产品功能。
- 非目标仍包括：真实 AI、OCR 坐标、原图高亮、PDF / Word / 文件夹解析、扫描仪 / 摄像头 / 希沃。
- 本轮验证结果：
  - `ocr-gateway`：final verification `npm.cmd test` 5 个测试文件、35 个用例通过；`npm.cmd run typecheck` 通过。
  - 前端 OCR service：`npm.cmd test -- src/services/ocr` 3 个测试文件、7 个用例通过。
  - 上传整理页回归：`npm.cmd test -- src/pages/UploadPage.test.tsx` 1 个测试文件、17 个用例通过。
  - 前端全量：`npm.cmd test` 26 个测试文件、125 个用例通过；`npm.cmd run lint` 通过；`npm.cmd run build` 通过。
  - 安全扫描：`app/src` 生产代码未出现 PaddleOCR / `paddle_local` / `PADDLE_OCR` / Python runner / 云 OCR 密钥相关逻辑；`ocr-gateway/src` 未出现 `exec(` 或 `shell: true`，`node:child_process` 只出现在 `paddleRunner.ts`。
  - 当前 shell 下 `python` / `py` 不可用，因此未运行 `py_compile` 或真实 PaddleOCR smoke test；自动化测试仍不依赖真实 PaddleOCR 安装。

## 本次新增进展：真实 OCR Gateway 接入 v0.1

- 阶段三第一刀已启动：新增最小 `ocr-gateway`，前端不直接调用云 OCR，也不保存任何 OCR provider key。
- Gateway v0.1 当时使用 `mock` provider 跑通 real OCR 形态链路，并提供 `mock_failure` 受控失败能力；该历史阶段尚未接入腾讯、百度、OpenAI、PaddleOCR 或其他真实 OCR 厂商。
- Gateway 使用 multer memory storage，本轮不做图片长期存储、不写数据库、不上传对象存储；输入限制为 PNG / JPEG / WebP、单张 8MB、单次最多 10 页。
- 前端新增统一 OCR Client，支持 `mock OCR` 与 `real OCR 链路测试`；前端只读取 `VITE_OCR_MODE` 和 `VITE_OCR_API_BASE` 两个非敏感配置。
- 上传整理页 real OCR 链路测试成功后回填现有 OCR 草稿区；失败后提供“使用 mock 草稿”“手动输入 OCR 文本”“重试 OCR”。
- OCR 识别中会锁定图片删除、排序、分组模式切换、合并 / 拆分等整理操作，避免 OCR 返回结果和当前分组错位。
- OCR 成功但文本为空时会提示“识别结果为空，请检查图片或手动输入。”，不会静默进入批改队列。
- 新增 `app/.env.example` 与 `ocr-gateway/.env.example`；真实 provider secret 只允许放在 Gateway 环境变量中，不能写入前端 `VITE_*`。
- 当前仍不接真实 AI 批改、不解析 PDF / Word / 文件夹、不接扫描仪 / 摄像头 / 希沃展台、不做 OCR 坐标或原卷图片区域高亮。
- 本轮验证结果：
  - `npm.cmd test -- src/pages/UploadPage.test.tsx`：1 个测试文件，17 个用例通过。
  - `npm.cmd test`：26 个测试文件，125 个用例通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。
  - `ocr-gateway`：`npm.cmd test` 2 个测试文件，10 个用例通过；`npm.cmd run typecheck` 通过。
  - 安全扫描：`app/src` 与 `ocr-gateway/src` 生产代码未出现真实密钥、厂商 key 或 provider-specific SDK 逻辑。

## 本次收尾：阶段二验收与阶段三入口清单

- PR #5“创建任务页题目信息与任务评分标准确认 v0.2”已合并回 `main`，远端功能分支和本地功能分支均已清理。
- 当前仓库只保留 `main`，本地 `main` 与 `origin/main` 一致。
- 新增阶段二验收与阶段三入口清单：`docs/phase_2_acceptance_and_phase_3_entry.md`。
- 阶段二核心 mock 闭环完成度判断为 90% - 95%，可以进入阶段三准备。
- 建议阶段三第一刀优先选择“真实 OCR 接入 v0.1”，并保留现有 OCR 草稿编辑与 mock 回退路径。
- 本轮收尾不新增产品功能，不接真实 OCR / AI / 后端 / 硬件，只做阶段状态校准、验收清单和全量验证。
- 本轮收尾验证结果：
  - `npm.cmd test -- src/pages/CreateTaskPage.test.tsx`：1 个测试文件，5 个用例通过。
  - `npm.cmd test`：23 个测试文件，114 个用例通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。

## 本次新增进展：创建任务页题目信息与任务评分标准确认 v0.2

- 创建任务页已从单页基础表单升级为三步式流程：基础信息、题目信息、评分标准确认。
- 基础信息中新增写作大类：应用文 / 读后续写；应用文保留建议信、邀请信、申请信、感谢信、通知、演讲稿、报道、咨询信、倡议书、For and Against essay，读后续写当前预留“故事续写”。
- 题目信息按写作大类切换：
  - 应用文必填“题目要求 / 写作任务”。
  - 读后续写必填“读后续写原文”“Paragraph 1 开头句”“Paragraph 2 开头句”。
  - 教师补充要求、特别扣分点、优秀作文关注点均为选填。
- 原题材料上传仅保留阶段三轻占位，文案说明后续将支持原题图片 / PDF / 文档；本轮没有提供上传解析按钮，也没有出现“上传并识别”“解析题目”“提取题目要求”等误导性入口。
- 评分标准确认区新增 mock 生成流程：必填题目信息完整后可生成应用文 / 读后续写对应 mock rubric；教师补充要求为空也允许生成，填写后会显示“已参考教师补充要求”。
- 教师确认评分标准后才允许进入上传整理页，继续复用现有上传、OCR mock、批改队列、单篇详情和班级总览流程。
- 切换写作大类后，已生成评分标准会重置为“待生成”，并提示“写作大类已切换，请重新生成本任务评分标准。”。
- 任务数据结构轻量预留 `writingGenre`、`promptInfo` 和 `rubricDraft`，不接真实 AI、不解析原题文件、不做权重编辑器、不做读后续写真情节推理或复杂 rubric 后台。
- 本轮验证结果：
  - `npm.cmd test -- src/pages/CreateTaskPage.test.tsx`：1 个测试文件，5 个用例通过。
  - `npm.cmd test`：23 个测试文件，114 个用例通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。
- GitHub：对应功能分支已通过 PR #5 合并回 `main`，远端功能分支已删除。

## 本次新增进展：上传整理页多来源导入入口占位 v0.2

- 在上传整理页顶部新增“选择导入方式”区域，作为阶段三多来源导入能力的入口占位。
- 当前可用入口统一命名为“图片 / 文件导入”，但当前实际按钮只提供“选择图片”和“添加模拟图片”，不暗示已支持 PDF、文件夹或通用文件解析。
- 新增三个阶段三入口占位：
  - “拍照采集”：未来用于软件内调用手机、平板或电脑摄像头现场拍摄作文。
  - “扫描件导入”：未来用于学校扫描仪或阅卷系统已经生成的图片、PDF 或文件夹导入，本轮不提供“选择扫描件”按钮。
  - “希沃展台采集”：未来作为采集来源，明确展示“课堂即时批改”和“批量采集上传”两种模式。
- 新增 `UploadSourceSelector` 展示组件，只通过 props 接收 `onSelectImages` 和 `onAddMockImage`，不直接读写 AppState，也不拥有上传状态、OCR 草稿、分组或队列逻辑。
- 保留现有图片上传、真实缩略图预览、排序、删除、一张一篇 / 每 2 张一篇 / 混合页数整理、OCR mock 和批改队列流程。
- 当前版本不接入真实摄像头、扫描仪、希沃视频流、PDF 解析、即时 OCR 或即时 AI 批改，也不显示“打开摄像头”“连接扫描仪”“开始展台采集”“展台截图”等假硬件 UI。
- 本轮验证结果：
  - `npm.cmd test -- src/pages/UploadPage.test.tsx`：1 个测试文件，13 个用例通过。
  - `npm.cmd test`：22 个测试文件，109 个用例通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。
  - 范围扫描确认生产代码未出现假硬件按钮、摄像头 API、扫描仪 API 或 PDF 解析实现。
- 浏览器预览状态：已打开 `http://127.0.0.1:5173/tasks/task-1/upload`，确认“选择导入方式”、图片 / 文件导入、拍照采集、扫描件导入、希沃展台采集均可见。

## 本次新增进展：原卷视图修正为页面级卷面批阅画布 v0.2

- `原卷视图` 已从左侧 OCR 原文卡片的小 Tab 调整为单篇详情页页面级 workspace。
- 单篇详情页现在默认进入 `批改工作台`，并可切换到 `原卷视图`。
- `EssaySourcePanel` 内部恢复为 `阅读定位 / 编辑 OCR`，不再承载原卷视图。
- `原卷视图` 当前为阶段三预留卷面批阅画布：原卷区域为视觉中心，左侧、右侧、底部预留未来批注空间。
- 当前不实现 OCR 坐标、图片框选、图片区域高亮、真实批注、假坐标或 AppState 数据结构变更。
- 本轮验证结果：
  - `npm.cmd test -- src/pages/EssayResultPage.test.tsx`：通过。
  - `npm.cmd run lint`：通过。
- GitHub：当前分支 `codex/original-paper-view-roadmap-v02` 已推送，并已创建 PR #4：`https://github.com/lionbriant88/wenjie-writewise-ai/pull/4`。
- 收尾状态：PR #4 已合并回 `main`，GitHub 远端功能分支已删除；本地 `main` 已 fast-forward 同步到合并后的提交。

## 本次新增进展：原卷视图入口与原卷批阅路线占位 v0.2

- 单篇作文详情页左侧模式从 `阅读定位 / 编辑 OCR` 扩展为 `阅读定位 / 原卷视图 / 编辑 OCR`，默认仍进入 `阅读定位`。
- `原卷视图` 当前只展示阶段三预留说明和原卷图片预览，明确后续方向为卷面定位、图片区域高亮和批注卡片联动。
- 当前占位视图不展示 OCR 文本层 marker，不生成图片问题框，不接 OCR 坐标，不新增 AppState 数据结构。
- 保留 `查看原图` 弹窗、OCR 文本编辑、左右问题定位、加入班级总览素材池、全文优化稿和进度页最新完成入口。
- 本轮验证结果：
  - `npm.cmd test -- src/pages/EssayResultPage.test.tsx`：通过，15 个用例通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。

## 本次新增进展：OCR 原文可点击问题句 v0.1

- 在单篇详情页左侧“学生作文原文”的阅读定位模式中，新增轻量问题句 marker，不显示编号，不插入额外文字。
- marker 只来自当前 `reviewIssueItems` 中的语言问题和逻辑问题，不从全文优化稿、表达提升点或班级总览素材池反推。
- 点击左侧可定位问题句后，会设置 `activeIssueId`，右侧自动切换到“问题批改”Tab，并让对应问题卡片进入选中状态。
- 保留原有右侧问题卡片点击后左侧原文定位/高亮能力；未匹配问题仍显示“未精确定位”，不在左侧强行标记。
- OCR 编辑模式下隐藏 marker；保存或回到阅读模式后，会根据最新 OCR 文本重新计算可点击问题句。
- 新增 `sourceIssueMarkers` 工具函数，复用 `findTextMatch`，并用 `data-issue-source` / `data-active` 稳定属性覆盖测试。
- 多个问题命中同一位置时，左侧 marker 只绑定一个主问题；右侧问题列表保持完整。
- 本轮未做编号、原卷图片批注、图片坐标映射、全文优化稿联动、班级总览素材反向联动或复杂旁批模式。
- 本轮验证结果：
  - `npm.cmd test -- src/utils/sourceIssueMarkers.test.ts`：1 个测试文件，4 个用例通过。
  - `npm.cmd test -- src/pages/EssayResultPage.test.tsx`：1 个测试文件，13 个用例通过。
  - `npm.cmd test -- src/pages/DetailNavigation.test.tsx`：1 个测试文件，9 个用例通过。
  - `npm.cmd test -- src/pages/ProgressPage.test.tsx`：1 个测试文件，8 个用例通过。
  - `npm.cmd test -- src/pages/ClassReviewPage.test.tsx`：1 个测试文件，2 个用例通过。
  - `npm.cmd test`：22 个测试文件，106 个用例通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。
- 浏览器预览状态：用户已在本机预览并确认没有问题。

## 本次新增进展：核心批改工作台信息架构优化

- 班级总览删除冗余黑色横幅，改为页内 Tabs：概览、教师精选素材、高频问题、改写练习。
- 班级总览默认进入“概览”，只展示分数统计和分数分布；教师精选素材、高频问题、改写练习分别进入独立内容区。
- 高频语法错误、高频拼写错误、典型问题句和可上课改写练习改为更紧凑的列表展示，原有 `classInsights` 数据不丢失。
- 单篇详情页保留左侧学生作文原文常驻，右侧改为 Tabs：评分诊断、问题批改、全文优化、教师反馈。
- 评分编辑、问题定位、加入班级总览、素材查看来源、素材移除、全文优化稿、教师反馈保存和进度页最新完成入口保持可用。
- 本轮未新增路由，未改变 `classReviewMaterials` 数据结构，未接真实 AI / OCR / 后端 / 导出能力。
- 本轮验证结果：
  - `npm.cmd test -- src/pages/ClassReviewPage.test.tsx`：1 个测试文件、2 个用例通过。
  - `npm.cmd test -- src/pages/EssayResultPage.test.tsx`：1 个测试文件、11 个用例通过。
  - `npm.cmd test -- src/pages/ProgressPage.test.tsx`：1 个测试文件、8 个用例通过。
  - `npm.cmd test -- src/pages/DetailNavigation.test.tsx`：1 个测试文件、9 个用例通过。
  - `npm.cmd test`：21 个测试文件、100 个用例通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。
- GitHub：`codex/class-review-materials-v0` 已 fast-forward 合并进 `main`，并已推送到 `origin/main`。

## 本次新增进展：班级总览讲评素材池闭环 v0.1

- 单篇详情页“问题与修改建议”中的“加入班级总览”已从组件内 mock 反馈升级为真实写入当前任务的 `classReviewMaterials`。
- 本轮支持两类素材沉淀：
  - 语言问题 -> `typical_error`，保留原句、推荐改法、讲解、扣分影响、来源作文。
  - 逻辑问题 -> `logic_issue`，保留原句、逻辑诊断、讲评建议、是否建议教师复核、来源作文。
- 素材按任务隔离，并按 `taskId + essayId + sourceIssueId` 优先去重；没有 `sourceIssueId` 时用 `taskId + essayId + type + original` 兜底。
- `IssueCorrectionList` 已保持为受控组件，不直接读写 `AppStateContext`；详情页负责将 issue 映射成素材并判断按钮状态。
- 班级总览页新增“教师精选讲评素材”模块，位于分数分布之后、高频问题模块之前：
  - 显示素材总数。
  - 支持“全部 / 典型错误 / 逻辑问题”筛选。
  - `expression_upgrade` 类型已在数据层预留，但没有真实表达提升素材时不显示空的“表达提升”Tab。
  - 每条素材支持“查看来源”和“移除”。
- 从班级总览移除素材后，回到对应单篇详情页，按钮会恢复为“加入班级总览”。
- “查看来源”本轮只跳转到 `/tasks/:taskId/essays/:essayId`，不做 query param 自动定位。
- 本轮未接入真实 AI / OCR、后端数据库、导出、学生端/家长端、复杂课堂播放模式，也未重构上传整理页、批改进度页或详情页整体布局。
- 本轮验证结果：
  - `npm.cmd test -- src/utils/classReviewMaterials.test.ts`：1 个测试文件、4 个用例通过。
  - `npm.cmd test -- src/pages/EssayResultPage.test.tsx`：1 个测试文件、11 个用例通过。
  - `npm.cmd test -- src/pages/ClassReviewPage.test.tsx`：1 个测试文件、2 个用例通过。
  - `npm.cmd test -- src/pages/ProgressPage.test.tsx`：1 个测试文件、8 个用例通过。
  - `npm.cmd test`：21 个测试文件、100 个用例通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。

## 本次收尾：批改进度页队列体验 PR 已合并

- PR #3 “优化批改进度页队列体验”已创建并合并回 `main`。
- 合并提交：`a8eb68a Merge pull request #3 from lionbriant88/codex/progress-queue-workbench-plan`
- 本地已切回 `main` 并执行 `git pull`，当前本地 `main` 与 `origin/main` 一致。
- 合并后已在 `main` 上重新验证：
  - `npm.cmd test`：20 个测试文件、94 个用例通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。
- 远端功能分支已在后续仓库清理中删除；代码已经完整进入 `main`，不会影响后续从 `main` 新建分支继续开发。

## 本次新增进展：批改进度页队列体验优化 v2

- 批改进度页保留原有顶部统计卡片，不新增重复统计区域。
- 中部提示条已升级为队列操作条，显示当前处理中作文数和需人工复核作文数。
- 新增状态筛选 Tabs：全部、处理中、需复核、已完成，并按当前状态过滤桌面表格和移动端作文卡片。
- 新增“最新完成作文”入口：
  - 点击“模拟完成下一篇”后，显示最新完成作文并可直接进入详情页。
  - 点击“模拟完成全部可处理”后，显示批量完成数量，并可进入最后完成作文详情页。
- 新增“模拟完成全部可处理”，只处理 `pending_ocr`、`ocr_running`、`pending_grading`、`grading`，不处理需复核或已完成作文。
- 需复核作文在桌面表格和移动端卡片中增加轻微 rose 背景，更容易被教师扫到。
- 本轮未改上传整理页、单篇详情页、异常复核页核心逻辑、班级总览核心逻辑，也未接入真实 AI / OCR 或后端队列。
- 本轮验证结果：
  - `npm.cmd test -- src/utils/progressQueue.test.ts src/pages/ProgressPage.test.tsx`：2 个测试文件、12 个测试通过。
  - `npm.cmd test`：20 个测试文件、94 个测试通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。
  - 浏览器验证：已打开 `/tasks/task-1/progress`，确认顶部统计卡片、队列操作条、状态 Tabs、需复核行强调、最新完成入口、详情页跳转均可用。
  - 浏览器交互验证：`task-1` 中只有 1 篇可处理作文时不显示批量按钮；点击“模拟完成下一篇”后处理中从 1 变 0，已完成从 7 变 8，并可进入作文 9 详情页；`task-2` 中点击“模拟完成全部可处理”后处理中归零，需复核仍保留 1 篇。

## 本次新增进展：单篇详情页全文优化稿与逻辑连贯性诊断

- 单篇作文详情页新增“全文优化稿”模块，默认展示“提升版”，并支持切换：
  - 纠错版：只做必要语言修正。
  - 提升版：在保留学生原文思路的前提下优化表达与衔接。
  - 逐句对照：展示原句、纠错版、提升版、修改类型、说明、是否保留原意和教师复核提示。
- 逻辑连贯性问题已进入“问题与修改建议”卡片：
  - 支持上下文关联度差、人物动机缺失、情节衔接断裂等后续可扩展类型。
  - 对不确定学生原意的内容显示“建议教师复核”，避免 AI 擅自编造原因或情节。
  - 逻辑问题卡片保留“加入班级总览”和原文定位反馈。
- 原来的“表达升级建议”不再作为独立主模块展示，已整合到“全文优化稿”中的“本文重点提升点”，并保留加入班级总览反馈。
- 动态上传 / OCR 后通过“模拟完成下一篇”生成的 mock 批改结果，也会带全文优化稿数据，进入详情页后保持同一套信息架构。
- 本轮未实现原卷批注视图、图片坐标级批注、真实 AI、真实 OCR 或导出功能。
- 本轮验证结果：
  - `npm.cmd test -- src/data/mockData.test.ts src/utils/reviewIssueItems.test.ts src/components/FullTextRevisionPanel.test.tsx src/pages/EssayResultPage.test.tsx src/pages/DetailNavigation.test.tsx`：5 个测试文件、25 个测试通过。
  - `npm.cmd test -- src/pages/ProgressPage.test.tsx`：1 个测试文件、1 个测试通过。
  - `npm.cmd test`：19 个测试文件、83 个测试通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。
  - 浏览器验证：已打开 `/tasks/task-1/essays/task-1-essay-1`，确认诊断摘要、学生原文、问题卡片、逻辑问题、全文优化稿、纠错版 / 提升版 / 逐句对照、逻辑优化说明、本文重点提升点、AI 总评 / 教师补充建议、返回进度和上一篇 / 下一篇均可见；“表达升级建议”独立模块和“原卷批注视图”未出现。
  - 浏览器交互验证：切换“逐句对照”后可见是否保留原意与教师复核提示；点击 `My mother was angry.` 逻辑问题卡片后显示“已定位”。

## 本次新增进展：上传整理批量分组重构

- 上传整理页已从旧的“先手动分组，再 OCR”改为批量图片整理流程。
- 默认模式为“一张一篇”，未合并图片会直接作为单页作文进入 OCR 队列。
- 新增“每 2 张一篇”模式，系统会按当前上传/显示顺序自动生成作文组；如果最后剩 1 张图片，会保留为单页作文。
- 新增“混合页数”模式，老师可点击图片进行多选，选择 2 张以上后合并为一篇作文；多页作文卡片内可拆分回单页作文。
- 上传整理区明确显示提示：“当前按上传顺序排列，自动分组将按此顺序生成作文。”
- 混合页数模式新增操作引导，支持“知道了”“不再提醒”和“查看操作提示”，其中“不再提醒”写入 `localStorage`。
- 模拟 OCR 已改为按作文组生成草稿：每个作文组一个 OCR 文本框，确认后按组进入批改队列。
- 已新增/更新上传页测试，覆盖模式切换、上传顺序提示、固定两页分组、混合页数引导、合并、拆分、按组 OCR 提交。
- 本次验证结果：
  - `npm.cmd test -- src/utils/essayGrouping.test.ts`：3 个用例通过。
  - `npm.cmd test -- src/pages/UploadPage.test.tsx`：12 个用例通过。
  - `npm.cmd test -- src/pages/ProgressPage.test.tsx`：1 个用例通过。
  - `npm.cmd test`：17 个测试文件、77 个用例通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。
  - 浏览器预览已验证 `/tasks/task-1/upload`：三种分组模式、上传顺序提示、混合页数引导、合并、拆分均可用。

## 仓库状态

- 项目根目录：`D:\wenjie-writewise-ai`
- 前端应用：`D:\wenjie-writewise-ai\app`
- 远程仓库：`https://github.com/lionbriant88/wenjie-writewise-ai.git`
- 当前本地开发分支：`codex/real-ai-grading-deepseek-mvp-v01`
- 当前远端主线：`origin/main`
- 当前功能分支基于 `main` 开发，包含真实 AI 批改 Gateway v0.1 的 Tasks 1–11 自动化实现；Task 12 真实 API smoke 尚未获授权。
- 当前本地 `main` 提交：`166cf98`；功能分支自动化实现最新提交会随本轮文档提交更新。
- `main` 已包含创建任务页题目信息与任务评分标准确认 v0.2。
- `main` 已包含班级总览讲评素材池闭环 v0.1 和 OCR 原文可点击问题句 v0.1。
- `main` 已包含 PR #2：阶段一信息架构与界面打磨。
- `main` 已包含 PR #3：批改进度页队列体验优化 v2。
- `main` 已包含 PR #4：原卷视图修正为页面级卷面批阅画布 v0.2。
- `main` 已包含 PR #5：创建任务页题目信息与任务评分标准确认 v0.2。
- 已合并的历史功能分支状态属于此前主工作区记录；本轮实现位于独立功能工作树，不改写或自动推送远端分支。

## 已完成工作

- 已初始化项目并推送到 GitHub。
- 已建立产品文档、阶段一实现计划和信息架构设计文档。
- 已完成阶段一静态 React 原型，并持续向阶段二 mock 闭环演进。
- 当前主要路由：
  - `/`
  - `/tasks/new`
  - `/tasks/:taskId/upload`
  - `/tasks/:taskId/progress`
  - `/tasks/:taskId/exceptions`
  - `/tasks/:taskId/essays/:essayId`
  - `/tasks/:taskId/class-review`
- 已加入任务、作文、批改结果、异常作文和班级总览洞察的 mock 数据。
- 已覆盖工作流导航、上传预览、OCR 草稿、OCR 分组、手动作文分组、进度页完成、详情页导航、评分诊断、问题卡片、原文定位高亮、教师评语调整等测试。

## 阶段一与阶段二进展

### 阶段一：原型与信息架构

- 任务列表、任务内导航、上传整理、批改进度、班级总览、单篇详情页已形成可演示闭环。
- 视觉风格已调整为简洁、专业、轻科技感，避免营销页式表达。
- 二级页面返回统一为明确返回路径。
- 班级总览保留分数分布轻量 CSS 条形图，并整合作文总数、平均分、最高分、最低分。
- 班级总览分数档按高考 15 分制拆分为 `1-3`、`4-6`、`7-9`、`10-12`、`13-15`。
- 进度页状态标签支持轻量状态反馈，强化“AI 正在处理”的感知。

### 阶段二：上传 / OCR / 进度 mock 闭环

- 上传页支持选择本地图片，并以真实缩略图进入页面整理器。
- 图片可排序、删除，本地预览 URL 会被释放。
- 上传页支持模拟 OCR，生成可编辑 OCR 文本草稿。
- OCR 确认后可进入批改队列。
- OCR 分组已支持三种基础模式：
  - 合并为一篇多页作文。
  - 按图片拆分为多篇作文。
  - 手动分组为多篇作文。
- 手动分组模式已支持：
  - 新增作文组。
  - 将图片移动到上一篇或下一篇。
  - 空组作为临时接收区。
  - 顶部实时显示确认 OCR 后将提交的作文篇数。
  - OCR 完成后每个作文组有独立可编辑文本草稿。
  - 确认 OCR 后按作文组分别进入批改队列。
- 进度页支持“模拟完成下一篇”，可把队列中的作文推进到已完成并生成 mock 批改结果。
- 新上传 / OCR 确认的作文可以完成批改，并进入详情页查看 mock 结果。
- OCR 和 AI 批改仍为 mock；本地上传预览仍只保存在浏览器会话内。

### 阶段二：单篇作文批改结果详情页

- 已把详情页从“报告页”升级为更偏教师决策的工作台。
- 左侧仍保留“学生作文原文”和“查看原图”入口。
- 右侧新增紧凑的“诊断摘要”：
  - 总分改为整数展示，例如 `13 / 15`。
  - 保留 AI 置信度。
  - 显示档次判断，例如“优秀”“良好”。
  - 标出主要扣分项和讲评建议。
- 分项分数输入支持教师调整：
  - 合法范围内保留小数。
  - 超出范围会被夹到维度满分或 0。
  - 总分实时联动为整数。
  - 调整后显示轻量反馈，如“分数已更新”“已由教师调整”。
- “问题与修改建议”已改为教师更容易扫读的问题卡片：
  - 问题类型。
  - 扣分影响。
  - 原句。
  - 推荐改法。
  - 原因。
  - 可加入班级总览。
- “表达升级建议”保持独立，不与错误修改混在一起。
- “总评”升级为“AI 总评 / 教师补充建议”：
  - AI 总评可编辑。
  - 教师可补充最终反馈。
  - 保存后显示“已保存教师调整”和“已由教师调整”。
- 已完成问题卡片到原文定位的轻量闭环：
  - 右侧“问题与修改建议”卡片可点击选中。
  - 选中卡片根据真实匹配结果显示“已定位”或“未精确定位”。
  - 左侧“学生作文原文”默认进入“阅读定位”模式，直接在原文中高亮匹配句。
  - 左侧可切换到“编辑 OCR”模式，保留 OCR textarea 编辑能力。
  - 已移除独立“定位预览”卡片，避免左侧原文重复展示。
  - 匹配失败时显示“未在原文中精确定位，请手动核对”。
  - “加入班级总览”、查看原图、分数编辑、教师评语保存和上下篇导航保持可用。
- 已完成详情页专注批改模式第一轮打磨：
  - 桌面端侧边流程导航默认折叠，保留“展开导航 / 折叠导航”。
  - 顶部和底部仍保留返回批改进度、上一篇、下一篇。
  - “问题与修改建议”卡片压缩为更适合扫读的状态/操作行 + 字段行布局。
  - “表达升级建议”同步压缩为同类信息密度，避免示例卡片过高。
  - mock 学生原文已覆盖问题句和表达升级原表达，便于演示左侧定位对应关系。

## 历史验证：真实 OCR Gateway v0.1 阶段

执行目录：

```powershell
cd D:\wenjie-writewise-ai\app
```

最新验证命令：

```powershell
npm.cmd test -- src/pages/UploadPage.test.tsx
npm.cmd test
npm.cmd run lint
npm.cmd run build
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd test
npm.cmd run typecheck
```

最新结果：

- 上传整理页聚焦测试：1 个测试文件，17 个用例通过。
- 前端全量测试：26 个测试文件，125 个用例通过。
- Lint：通过。
- Build：通过。
- OCR Gateway 测试：2 个测试文件，10 个用例通过。
- OCR Gateway Typecheck：通过。
- 安全扫描：生产代码未发现真实密钥、厂商 key 或 provider-specific SDK 逻辑。
- 范围确认：
  - 本轮只打通最小 OCR Gateway 与统一 OCR Client 链路，Gateway 当时使用 mock provider。
  - 未接真实 AI、真实 OCR 厂商、数据库、扫描仪、摄像头、希沃展台、PDF / Word / 文件夹解析或 OCR 坐标。

`app\dist` 是 `npm.cmd run build` 生成目录，通常不应提交。

## 本地预览

启动方式：

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd run dev
```

常用预览地址：

```text
http://localhost:5173/
http://localhost:5173/tasks/task-1/upload
http://localhost:5173/tasks/task-1/progress
http://localhost:5173/tasks/task-1/essays/task-1-essay-1
http://localhost:5173/tasks/task-1/class-review
```

如果 `5173` 端口被占用，Vite 可能会自动选择下一个可用端口。

## 下一步最合理开发内容

此前的 DeepSeek smoke 入口已经被本轮 Kimi 多模态主流程取代。当前下一步是取得可访问 K3 托管接口的 API key，先复测教师确认文本后的纯文本重批，再使用用户后续提供的真实手写作文和写作材料做人工验收。

该历史阶段对“不得扩大批量并发”的限制现由 2026-08-28 已批准优化设计取代：允许先使用 fake Provider 实现并验证队列、幂等和自适应有界并发；在 K3 权限、确认文本重批和账户限额校准完成前，不得把并发扩大到真实 Kimi 流量。持久化、其他 Provider、OCR 坐标或文档解析仍不因本设计自动扩展；真实学生数据仍需单独的数据与隐私授权。

## 后续工作注意事项

- 保持产品像软件工作台，而不是营销落地页。
- 所有视觉优化都要用右侧浏览器验证。
- 保持简洁、专业、轻科技感。
- 不要为了“丰富”而堆信息，优先减少教师判断成本。
- 当前真实 AI MVP 仍应坚持逐篇、人工确认、可回退和最小数据范围；Task 12 以前不得把自动化通过误写为真实 API 验收通过。

## 2026-08-02：Kimi 多模态主流程与创建任务精简

- 创建任务页已精简为“上传原题材料图片、填写满分、生成并确认评分标准”，移除写作大类、文体模板、班级等本阶段非必要输入。
- 评分标准继续采用教师易读的模糊百分比权重；Kimi 先生成草案，再独立复核并返回可确认版本，权重总和必须为 100%。
- 原题材料识别、手写作文转写和批改统一进入 Kimi 多模态 Gateway；OCR Gateway 已退出主流程，仅保留独立服务和健康检查，是否删除或转为备用能力待后续决定。
- 教师可核对并编辑模型转写文本；保存修改会使旧批改结果失效，必须显式重新批改。确认文本重批时只发送教师确认后的文字，不重复上传图片。
- 当前 ignored `grading-gateway/.env` 只保留 Kimi 运行配置，ignored `app/.env` 只保留批改网关地址和 real 模式；二者均未被 Git 跟踪，DeepSeek 环境变量已清除。
- 仓库默认 K3 配置已按官方约定改为 `https://api.kimi.com/coding/v1`、模型标识 `k3`、reasoning effort `max`；实际模型仍由本地环境变量覆盖，后续换模型无需改业务代码。
- 当前用户提供的 key 在 K3 托管接口返回未授权；其可访问的中国区模型目录仅包含 `kimi-k2.6` 和 `kimi-k2.7-code`。本轮真实合成验证因此使用 `https://api.moonshot.cn/v1` + `kimi-k2.7-code` fallback，不能记为 K3 验收通过。
- 类人工合成端到端验证已覆盖：材料图片识别、两轮评分标准生成、任务创建、两页作文分组、OCR 服务关闭情况下的作文图片转写和首次批改、试卷印刷提示排除、教师修改转写后旧结果失效。
- 首次图片批改成功得到结构化结果；教师确认文本后的显式重批即使已优化为纯文本请求，仍连续触发 180 秒 Gateway 超时。这是当前可用 fallback 模型的剩余性能风险，不能写成全流程完全通过。
- 为诊断模型目录、评分标准超时和重批超时，本轮真实合成调用次数超过最初预计；所有调用均使用自建合成材料，没有使用真实学生数据，也没有在文档或日志中保存密钥和完整作文内容。
- 最新自动化验证：前端 44 个测试文件、264 个用例通过；Grading Gateway 16 个测试文件、141 个用例通过；OCR Gateway 7 个测试文件、45 个用例通过；三端类型检查、前端生产构建、前端 lint、共享评分运行时和 `git diff --check` 通过。
- 三个本地预览服务保持运行：前端 `127.0.0.1:5173`、Grading Gateway `127.0.0.1:8790`、OCR Gateway `127.0.0.1:8787`。OCR Gateway 本轮只做健康检查，没有参与材料或作文识别。
- 下一步：取得可访问 K3 的 API key 后复测“教师确认文本后重批”，再使用用户后续提供的真实手写作文和写作材料做人工验收；在此之前不扩展其他页面或功能。

### 本轮精确命令矩阵

| 范围 | 命令 | 预期结果 |
| --- | --- | --- |
| 前端 | 设置 `VITE_OCR_MODE=mock`、`VITE_GRADING_MODE=mock` 后执行 `npm.cmd test` | 44 文件、264 用例通过 |
| 前端 | `npm.cmd run typecheck`、`npm.cmd run build`、`npm.cmd run lint` | 全部通过 |
| Grading Gateway | `npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run verify:shared-scoring-runtime` | 16 文件、141 用例通过；类型和共享评分运行时通过 |
| OCR Gateway | `npm.cmd test`、`npm.cmd run typecheck` | 7 文件、45 用例通过；类型检查通过 |
| 仓库 | `git diff --check`、tracked `.env` 检查、tracked secret pattern 检查 | 通过；本地 `.env` 未跟踪，未发现形如真实 key 的已跟踪内容 |

### 合成真实调用审计台账

本表只记录请求数量、模型/接口和状态，不保存密钥、材料图片或作文正文。

| 调用类别 | 请求数 | 结果 |
| --- | ---: | --- |
| 模型目录只读查询 | 3 | `api.kimi.com` 401、`api.moonshot.ai` 401、`api.moonshot.cn` 200 |
| `kimi-k2.6` 兼容性诊断 | 4 | 最小文本和最小图片各 1 次成功；复杂 rubric low/high 各 1 次 180 秒超时 |
| `kimi-k2.7-code` 兼容性诊断 | 3 | 最小图片 1 次成功；rubric draft/review 各 1 次成功 |
| UI 评分标准生成 | 2 | draft/review 各 1 次成功 |
| UI 首次作文图片批改 | 1 | 成功，返回结构化转写和评分 |
| UI 教师确认文本重批 | 3 | 3 次均为 180 秒 `provider_timeout`；最后两次已是 Gateway 到模型的纯文本请求 |
| **合计** | **16 个外部 HTTP 请求** | **其中 13 个 completion 请求：8 成功、5 超时；另有 3 个模型目录查询** |

该台账说明本轮没有完成“教师确认文本重批成功”的完整 happy path。最新代码已进一步把浏览器到 Gateway 也改为零图片重批，但为控制费用，本轮不再追加真实调用；须在 K3 权限可用后重新验证。

## 2026-08-17：多模态批改 v2 原子部署要求

网站与 Grading Gateway 现共享唯一的 `multimodal-grading-request-v2` / `grading-result-v2` 合同。该版本为破坏性升级，发布时必须原子部署网站和 Gateway，不支持新旧版本混跑；旧的 `POST /grading/grade` 已停用，首次图片批改与教师确认文本重批都使用 `POST /grading/grade-images`。

可达的旧任务统一按确定性规则转换为 v2：题目正文、文体/续写原文与段首、`writingGoal` 进入 `materialSummary`；非空教师要求（空白时回退题目正文）、`excellentFocus` 与 `excellentFeatures` 进入 `writingRequirements`；`deductionFocus` 与 `offTopicCriteria` 进入 `constraints`；`reviewTriggers` 与教师备注进入 `reviewWarnings`。各组按原顺序去空白、去重；`excellentFocus` 不作为硬约束。兼容转换只保留既有的 95% 原评分维度加 5% 卷面可读性维度，不作其他权重变更。

## 2026-08-17：多模态策略 golden 证据加固

- 四个合成用例改为逐用例独立断言；单个读取、Provider、规范化或断言失败不再污染其他成功用例。
- 缺少本地 `KIMI_API_KEY` 时，CLI 输出四行匿名 `not_run_missing_local_credentials`、退出码为 2 且不调用 Provider；本次实际结果为 `not_run`，不是通过。
- CLI 子进程测试直接捕获 stdout、stderr 和退出码，并验证缺密钥零外部调用及失败响应不泄露上游私有标记。
- 已增加真实垂直契约测试：Provider 原始载荷经过 Gateway 规范化/策略、网站投影、领域适配器和问题卡片/原文标记消费者，覆盖语法、逻辑、局部字迹、复数关联、教师复核元数据、v2 全文修订及教师确认零图片重批。
- 权威 fixture 为仓库内提交的 PNG；验证固定签名、尺寸、长度和 SHA-256，不加载系统字体，也不再宣称 SVG 跨机器重渲染字节一致。fixture 唯一可见标识符为合成 case ID，正文内容全部为合成内容。

## 2026-08-19：Kimi K3 中国区默认运行配置

- 当前真实图片批改已使用中国区 Kimi K3 组合验证成功：`https://api.moonshot.cn/v1`、模型 `kimi-k3`、reasoning effort `low`、最大 completion tokens `16384`。
- Gateway 的代码默认值和 `grading-gateway/.env.example` 已与上述组合对齐；显式环境变量仍可覆盖这些默认值。
- `GRADING_TIMEOUT_MS` 的默认值更新为 `360000`（6 分钟），覆盖真实多模态请求已经观察到的约 115 秒响应时间；调用方仍可通过正整数环境变量显式调整。
- 示例配置继续只保留空的 `KIMI_API_KEY`，真实密钥不得写入仓库、日志、测试 fixture 或文档。

## 2026-08-20：真实手写图片全流程人工验收

- 使用一套本地去身份化题目材料和 6 张真实手写作文图片完成网站端人工验收：6 张图片正确整理为 5 份作文，其中包含一份双页作文、普通单页、横线与轻微透视页面，以及一张超长纵图。
- 5 份作文均通过“创建任务 → Kimi 生成并确认评分标准 → 图片上传与分组 → 直接识图批改 → 教师查看并确认 → 完成结果”的主流程，最终进度为 5/5 完成、0 篇待复核。另验证了教师修订转写后以零图片方式重新批改。
- 保守拼写策略在真实图片上符合预期：可合理辨认为正确单词的字迹不进入拼写或可读性扣分；清晰的拼写错误保留在转写中并以低优先级提示；语法错误和逻辑/内容缺口仍正常识别。
- 针对真实调用中暴露的问题，已补齐前端安全降级原因合同、Kimi 截断与 JSON 响应诊断、全局问题键命名空间、逐字唯一引用约束、明确拼写错误保留规则，以及无静态 mock 洞察时的班级总览素材渲染。安全诊断只记录固定阶段与静态错误码，不记录学生正文、图片、文件名、Provider 原始响应或凭证。
- 最终收紧 Provider 结束状态、评分关联和重复反馈规则后，再用一张真实手写图片执行 Gateway smoke：HTTP 200、`grading-result-v2` success、14/15、0 个字迹误报、0 个复核原因，证明最终严格策略仍可通过真实 Kimi 响应。
- 最终自动化验证：Grading Gateway 20 个测试文件、423 个用例通过；网站 46 个测试文件、322 个用例通过；两端类型检查、共享计分运行时、策略 fixtures、网站 lint、生产构建和 `git diff --check` 均通过。
- 本补丁新增安全降级复核原因，网站、Gateway 与未来微信小程序端必须共享同一结果合同并原子发布；旧标签页应在切换后刷新，不能与新版 Gateway 长期混跑。
- 当前任务、批改结果和班级总览素材仍只保存在 React 内存状态中，整页刷新、前端热更新或服务重启后不保证恢复。这是进入正式生产前需要补齐的持久化能力，不影响本次同一页面会话内的端到端验收结论。
- 当前真实验收仍是本机逐篇模式。公网部署前必须增加任务队列、并发准入或等价的资源保护；现有图片 multipart 使用内存缓存且 Provider 超时上限为 6 分钟，不应直接暴露为无限并发服务。

## 2026-08-20：直接出分容错与真实原卷视图完成

- 多模态评分结果已按“核心分数必须可用、辅助内容允许安全降级”收口：转写文本、评分维度身份集合以及有限且有界的维度分数仍是硬门槛；不稳定的辅助问题、修改建议、逻辑说明、引用关系和叙述字段会逐项净化或省略，并以 `partial` 和“建议教师复核”提示教师，不再轻易把整篇结果变成“批改服务返回了无法使用的结果”。
- 保守拼写策略保持不变：可合理辨认为正确单词的模糊字形按正确处理，不扣分、不纠正、不触发复核；只有明确且唯一的拼写错误才允许作为低优先级问题。真实字迹无法确认时仍按字迹错误处理，并保证展示总分实际低于满分。
- 原卷视图已从占位骨架升级为可用工作台，同时保持结果页原有入口和外层布局：
  - 按 `pageOrder` 展示真实多页原图、缩略图和上一页/下一页导航。
  - 支持 50%–200% 缩放、四向 90° 旋转、拖动、滚动和一键重置；切页、旋转及字迹问题跳页都会清理旧滚动偏移。
  - 上传页释放旧预览 URL 后，原卷组件会从仍受控的 `sourceFile` 重建并自行回收 object URL；持久远程 URL 不会被误回收。
  - 只有字迹问题使用 Gateway 提供的可信 `pageNumber + regionDescription` 按页展示；语言和逻辑问题明确标为“未精确定位”，不根据文本猜页，也不绘制虚构框线或坐标。
  - 桌面端为左侧页缩略图、中间原卷画布、右侧批注三栏；移动端和未来小程序采用图片优先、横向缩略图和底部批注抽屉。抽屉支持 Escape、完整 Tab 循环、焦点恢复和桌面断点语义切换。
- 真实浏览器验证覆盖 1440×900 和 390×844：100%/200% 下 0°、90°、180°、270° 的图片边界与旋转载体一致且无负向不可达区域；10 页缩略图栏可独立滚动且三栏等高；移动端无横向溢出，批注抽屉最大高度为 70dvh，键盘焦点不会逃到模态层背后。
- 独立代码复审结论为 Ready，无 Critical 或 Important；上一轮发现的旋转边界、10 页高度、缩略图失败降级和移动抽屉无障碍问题均已关闭。
- 最终自动化验证：网站 48 个测试文件、396 个用例通过；Grading Gateway 20 个测试文件、587 个用例通过；两端类型检查、网站 lint、生产构建和 `git diff --check` 均通过。
- 原卷视图提交为 `bba2527 feat: build responsive original paper review`。本地前端 `127.0.0.1:5173` 与 Grading Gateway `127.0.0.1:8790` 在本轮结束时均保持健康运行。
- 下一次继续开发时，优先补齐网站与完整功能微信小程序共享的持久化后端、任务队列与并发准入；随后用新上传的真实图片人工复验原卷视图。当前 React 内存状态仍不保证整页刷新后的动态任务和图片恢复。
