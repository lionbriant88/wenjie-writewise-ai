# AI 班级总览生成与共性问题沉淀设计

## 状态

- 日期：2026-08-29
- 设计状态：核心产品决策与本文件书面转录均已获用户确认；三份独立 TDD 实施计划已编写，全部审查缺口已修正，当前冻结版本通过最终独立语义与机械终审（Critical / Important / Minor 均为 0）
- 实施状态：尚未实施
- 范围：班级级共性问题聚合、明确拼写清单、AI 班级总结、教师编辑与排序、生成幂等、持久化与权限发布门槛
- 前置设计：`2026-08-28-ai-pipeline-cost-latency-optimization-design.md`
- 实施计划：`2026-08-29-ai-class-review-local-prototype.md`、`2026-08-29-ai-class-review-commercial-infrastructure.md`、`2026-08-29-ai-class-review-integration-release.md`

## 摘要

学生作文继续逐篇使用 `kimi-k3` 直接多模态识别与批改。本设计不改变 `multimodal-grading-request-v2`、`grading-result-v2` 或 `POST /grading/grade-images`，也不新增 OCR、逐篇班级标签或多学生联合评分。

新增的班级级能力分为两部分：

1. 分数、维度、频次和明确拼写由服务端确定性聚合，不产生模型调用。
2. 批改队列结束后，教师显式点击一次“生成班级总结”；系统把当前所有有效成功结果投影成一份去身份化、有界的班级快照，使用一次 `kimi-k3` completion 生成总体评价、主要优点、共性问题归纳与教学建议、学习建议。

模型不负责统计人数、比例、例句或排序元数据。权威任务服务根据模型引用的受控问题组重新计算证据和频次，并执行用户批准的门槛。明确且唯一的拼写错误不受共性门槛限制，但进入独立、紧凑的“明确拼写清单”，不冒充共性问题，也不挤占主要讲评问题。

正常成功任务新增的班级级 completion 数为 1。查看页面、本地统计、明确拼写更新、重复提交和断线重挂均不增加 completion；教师明确重新生成、来源删除后重新生成，或一次可能已计费的终态失败后明确重试，才会创建新的 generation 并可能各增加一次新调用。

## 背景与现状审计

当前班级总览仍读取静态 `mockClassInsights`，高频问题与改写练习不是来自真实批改结果。现有页面把概览、教师精选素材、高频问题和改写练习拆为四个一级 Tab，问题内容分散且无法共同排序。单篇问题卡片还存在可点击卡片包裹真实按钮的嵌套交互，重复点击“加入班级总览”只会静默去重。

更重要的是，任务、批改结果和教师素材仍只保存在 React 内存中。整页导航、刷新或应用重启后，动态任务可能丢失。班级报告、教师编辑和排序如果沿用该状态模型，只能形成会话内演示，不能形成商品化功能。

本设计因此同时定义最终产品合同和商业发布门槛。若实施阶段只接入内存适配器，必须明确标为非生产原型；在服务端持久化、任务归属和教师权限完成前，不得宣称该能力可以正式保存真实班级数据。

## 已批准的产品决策

1. 普通共性问题必须同时满足比例和人数门槛：占本次问题通道完整的有效成功作文至少 20%，且 10 人及以上至少涉及 3 名学生，不足 10 人至少涉及 2 名学生；成绩通道有效但问题通道不完整的 `partial` 结果另行披露，不得进入问题分母。
2. 明确、唯一、无需教师复核的低级拼写错误不受频次限制，自动进入班级总览。为兼容用户给出的 `filling → feeling` 真实词混淆示例，当前逐篇策略若把它安全归为 `word_choice`，班级聚合仍可按下述严格词形规则纳入明确拼写清单，不要求修改逐篇 v2 标签。
3. 教师可从单篇批改结果手动加入未达共性门槛但值得讲解的问题。
4. 所有主要讲评问题允许教师手动排序；“置顶”不建立第二套状态，而是排序的自然结果。独立明确拼写清单保持确定性紧凑排序，教师将某条提升为主要讲评问题后即可参与手动排序；这是用户已批准的单页收口，不为每条低频拼写增加常驻排序控件。
5. 班级总结只在批改队列结束后由教师显式触发，不自动调用模型。
6. 生成使用当前所有有效成功批改结果；已被教师修改的结果使用修改后的当前版本，未确认但有效的成功结果也可以纳入。
7. AI 总体评价、主要优点和学习建议允许教师编辑并保存。
8. 教师后来修改单篇结果时，原班级总结默认保留，不自动重算、不阻断使用，也不显示强制性“已过期”警告。报告始终显示生成时间和当时纳入数量，作为明确的快照说明。
9. 教师明确重新生成时，原子替换 AI 生成内容，保留教师手动添加的问题和排序；只有 `topic-key-v1` 完全相同的 AI 问题保留原位置，新问题按系统优先级追加。
10. 每次显式生成或重新生成正常只执行一次 completion，不做隐藏式第二次复核或模型修复。

## 商品化复核后的收口

此前讨论中的以下内容不进入首版：

- 不默认生成改写练习。
- 不单独生成“主要不足”；共性问题本身就是可验证的主要不足。
- 不单独生成“教学重点”；教师排序后的前列问题就是教学重点。
- 不保留四个一级内容 Tab，也不建立 AI 问题与教师问题两套列表。
- 不做自动或持续重新生成、Embedding、Map-Reduce、模型二次复核、隐藏修复、复杂版本树或实时多人协作。
- 不把现有静态 mock 洞察混入真实报告。

这一收口减少了重复判断、冗余按钮、输出字段和 token，同时让教师的最终动作更明确。

## 不可改变的架构边界

1. 学生作文继续逐篇独立发送给 `kimi-k3`，同一次多模态请求完成正文识别、评分和反馈。
2. 不得把多名学生合并进一个模型请求进行识别或逐篇评分。
3. 本设计允许在全部逐篇结果形成后，把去身份化的结构化结果做一次班级级综合；这不是多学生联合评分。
4. 不新增独立 OCR、批改前 OCR 文本确认、OCR 降级或 OCR 故障绕行。
5. 对外逐篇合同继续使用 `multimodal-grading-request-v2`、`grading-result-v2` 和 `POST /grading/grade-images`。
6. 班级生成使用独立版本合同和独立路由，不向现有 v2 结果塞入班级标签。
7. Provider 保持 Kimi，中国区 API Base 保持 `https://api.moonshot.cn/v1`，模型保持 `kimi-k3`，reasoning effort 保持 `low`。
8. 原题材料、学生图片、作文全文和学生姓名不得进入班级级 Provider Prompt。

## 目标

### 产品目标

- 教师无需逐篇手工挑选真正的共性问题。
- 低频但明确的低级拼写错误不会被遗漏。
- 零散、典型或教学价值较高的小问题仍由教师决定是否加入。
- 班级总览形成可编辑、可排序、可追溯的讲评工作页，而不是只读报告。
- 单篇失败不阻断对其他成功作文生成班级总结。

### 成本与延迟目标

- 查看班级页、成绩统计、明确拼写聚合和教师排序均为 0 次模型调用。
- 正常任务首次班级总结为 1 次 completion。
- 同一生成批次的双击、HTTP 重放、刷新重挂和结果检查为 0 次新增 completion。
- 每次教师明确重新生成为最多 1 次新的可能计费 completion。
- 不向每篇批改结果增加班级标签或额外输出 token。
- 班级 Prompt 的实际目标为约 8,000–12,000 tokens；初始 completion 上限为 3,072，后续只依据真实 p99 usage 调整。

### 质量目标

- 共性人数和比例必须由服务端按不同作文身份重新计算，不能信任模型自报。
- 模型只能归并已投影的证据组，不能创造不存在的来源。
- 普通共性问题必须通过本地门槛；明确拼写必须通过保守确定性条件。
- 当语义投影因安全预算被裁剪时，页面必须披露覆盖量，不得把有界投影视为全量召回。
- 重新生成失败或响应非法时，已有成功报告和教师内容零变化。

## 非目标

- 不生成学生端或家长端报告。
- 不做跨任务、跨班级趋势分析。
- 不做导出、课堂演示模式或自动课件。
- 不做自动练习生成。
- 不自动修改单篇评分或学生反馈。
- 不根据班级结果再次调用模型复核单篇作文。
- 不承诺“班级人数无限、Prompt 固定、语义共性一个不漏”三个互相冲突的目标同时成立。
- 不在本设计中完整设计账号、租户、数据库、图片对象存储和备份系统；它们作为商业发布的独立基础设施门槛。

## 核心定义

### 有效成功作文与字段覆盖

班级生成快照只纳入同时满足以下条件的作文：

- 属于当前任务；
- 当前存在结构合法、可展示的成功 `GradingResult`；
- 结果与当前作文源版本和当前评分标准版本匹配；
- 未被转为纯人工且没有可用结构化结果；
- 没有被删除或作废。

教师是否已经点击最终确认不构成纳入门槛。若教师已经修改分数、反馈或结构化问题，则使用生成点击时的当前版本。为避免 `partial` 缺失的问题字段被误当成“没有问题”，快照必须区分：

- `N_success`：分数与基本结果通道完整的有效成功作文数，用于生成资格、成绩统计、维度优点和页面“纳入作文”数量；
- `N_issue`：`N_success` 中问题通道完整、可证明没有因安全降级丢失问题数组的作文数，用于共性问题分母和明确拼写。

`partial` 结果可以进入 `N_success`，但只有持久化的字段级归一化审计明确标记 `issueChannelCompleteness=complete` 时才能进入 `N_issue`。当前 v2 若没有这份内部审计，只能保守地把 `status=success` 视为问题通道完整；不能仅因现有 `issues=[]` 就推断该作文没有问题。页面显示 `N_issue / N_success` 的问题分析覆盖量。

只有 `N_success >= 2` 时才允许调用班级总结模型；不足 2 篇时仍可展示确定性单篇统计和已有的明确拼写清单，但不生成“班级”评价。若 `N_success >= 2` 而 `N_issue < 2`，仍可基于完整成绩维度生成总体评价和主要优点，但共性问题区必须明确显示“问题数据覆盖不足，未形成共性判断”。

### 普通共性门槛

```text
minimumStudents = N_issue < 10 ? 2 : 3
requiredSupport = max(minimumStudents, ceil(N_issue × 0.20))
```

同一作文在同一问题模式中无论出现多少次，只计 1 名学生；总出现次数单独累计。作文显示名或学生姓名不得承担去重身份。

### 明确拼写条件

只有同时满足以下条件的错误才直接进入明确拼写清单：

- `type === "spelling"`；或者 `type === "word_choice"` 且原词/修正词满足确定性的近形真实词混淆规则：两者均为单一英语词元，最大词长至少 4，规范化 Damerau–Levenshtein 距离不超过 `min(2, floor(maxLength / 3))`；
- `evidenceCertainty === "certain"`；
- 服务端 v2 字段 `requiresTeacherReview !== true`（网站适配后的同义字段为 `needsTeacherReview`）；
- 原词和建议词均为非空、有限长度的单一英语词元；首版只允许字母以及词内撇号/连字符，不把整句改写、标点变化或多词替换自动归为明确拼写；
- 不来自字迹不清、多种读法或卷面可读性问题；
- 当前结果版本仍然有效。

“修正唯一”不能只依据模型给了一个 suggestion。服务端还必须从现有 v2 结构机械验证同一证据位置：

1. 只关联一个符合上述条件的 lexical issue；`spelling` 路径不得重叠 `grammar`/`word_choice`，近形 `word_choice` 路径不得重叠 `grammar`/`spelling`，两条路径都不得重叠逻辑、卷面或识别警告；
2. 该 issue 只关联一个合法的 sentence revision/pair，revision 与 issue 给出的单词级修正完全一致；
3. 同一原词位置没有第二个不同的修正词，也没有多词、整句、标点或大小写以外的附带改写；
4. 任一引用缺失、冲突、重复或无法定位时，不进入免频次清单，只保留在普通问题/教师复核路径。

拼写身份使用服务端规范化后的“原词 + 建议词 + source subtype”确定性指纹。规范化只处理首尾空白、Unicode 规范形式和不影响词义的大小写比较，不做自动断词、模糊距离合并或语义猜测。上述编辑距离只用于决定一个已被模型确定标为 `word_choice` 的单词级问题能否作为近形混淆进入清单，不能用来跨问题自动合并或发明修正词。

明确拼写清单是当前有效结果的派生视图，不是 append-only 素材池。作文重批、教师修正问题或结果作废后必须重新计算，避免旧错误永久残留。低频明确拼写不宣称为“共性问题”。

## 最终教师流程

### 批改过程中

- 学生作文按现有队列逐篇直接多模态批改。
- 每篇成功后，分数统计和明确拼写派生视图可以在本地更新，0 次模型调用。
- 教师仍可在单篇问题卡片上点击“加入班级总览”，把未达门槛但值得讲解的问题创建为 `origin=teacher` 的主要问题项；该动作不同时创建“教师精选素材”。
- 已自动进入主要讲评问题或已被教师加入的项，按钮显示明确的切换状态，不允许静默重复添加。

### 队列结束

生成资格依据任务调度队列 `settled`，不是“所有作文都已由教师确认”。单篇最终失败、转人工或尚未确认不阻断生成；页面显示本次纳入 `N_success / 任务作文总数`，并单列问题分析覆盖 `N_issue / N_success`。

进度页唯一主操作：

- 尚无已应用的 AI generation 且符合资格：`生成班级总结`
- 正在生成：`正在生成班级总结`，禁用重复触发
- 已有已应用的 AI generation：`查看班级总览`
- 有待应用候选：`查看待处理的生成结果`。进入后只提供一个与冲突原因匹配的应用主动作和“放弃”：普通安全合并冲突显示“应用已生成内容”；若生成期间 AI 文本已被另一标签页编辑，必须明确说明会替换当前教师编辑，并把主动作写成“替换当前 AI 文本并应用”
- 队列未结束：显示剩余处理中数量，不提供生成按钮
- 有效成功作文不足 2 篇：显示不能形成班级总结的原因

这些状态不能用互不排他的布尔条件平铺。唯一主操作的判定优先级固定为：`succeeded_unapplied` 待处理候选 > `queued | running | result_unknown` active generation > 已应用 AI generation > 首次生成资格 > 队列未结束/样本不足。重新生成期间旧报告仍可阅读，但不能以另一个“查看班级总览”主按钮盖过当前 generation 状态；候选未处置时也不能显示新的生成主按钮。

教师首次从单篇加入问题、保存精选素材或进入班级页时，权威任务服务可以惰性创建一个 task-scoped 的 draft report workspace；这个 workspace 只承载教师内容、当前确定性派生视图和排序，不代表 AI 已生成。CTA 必须依据是否存在“已成功应用的 AI generation”，不得依据 report 行是否存在。点击“生成班级总结”创建一个持久生成批次并进入班级总览页。班级页在尚无已应用 AI generation 但符合资格时也提供同一个生成动作，便于教师从导航直接进入；同一页面不会同时出现两个等价主按钮。

生成开始、成功、失败和 `result_unknown` 必须通过可见状态与礼貌级 `aria-live` 同步播报；状态变化后焦点不自动跳走。触控操作不能依赖 hover，所有主要按钮、排序菜单和撤销操作的可触区域至少约 `44 × 44 CSS px`。

### 生成完成后

班级总览采用一个纵向工作页，不使用四个一级 Tab：

1. 当前成绩统计
2. AI 班级总结
3. 共性问题与建议
4. 明确拼写清单
5. 教师精选素材

页面保持软件工作台风格，避免报告门户和营销式模块堆叠。

### 后续单篇修改

旧报告继续作为生成时快照显示：

- 不自动调用模型；
- 当前成绩统计和明确拼写清单按最新有效结果确定性更新，但不改写旧 AI 总结与 AI 共性问题；
- 不阻止教师继续编辑、排序或使用；
- 不显示强制性的红色“已过期”状态；
- 始终显示生成时间、当时纳入作文数和任务总数；
- 可以使用中性快照说明告知“生成后有结果发生变化”，但不得把重新生成变成门槛。

### 重新生成

“重新生成 AI 内容”是次要操作，并明确说明会产生一次新的 AI 调用。

- AI 总结处于编辑态时只显示“保存”和“取消”，不渲染重新生成入口；有未保存 draft 时必须先保存或取消，不能靠尚未更新的 `aiTextEditedAt` 绕过覆盖确认，也不能发起 generation。
- 若教师没有编辑 AI 文本，使用清晰的按钮文案完成一次显式触发，不再增加确认弹窗。
- 若教师编辑过 AI 文本，必须确认“将替换 AI 内容；教师添加的问题和排序会保留”。
- 显式确认后创建新的 generation ID。
- 新结果只有在完整验证和持久化成功后才原子替换旧 AI 内容。
- 失败、截断、结果未知或非法引用均保留旧报告。

覆盖确认使用具备可访问名称/描述的模态对话框，打开后把焦点放到标题或安全的取消操作，Tab 不得逃出，Escape 关闭，关闭或提交后把焦点返回触发按钮。未编辑 AI 文本时不出现该对话框。

## 单页交互设计

### 当前成绩统计

当前成绩统计始终按最新有效结果确定性重算，0 次模型调用；AI 总结仍绑定生成时不可变快照。两者使用相同的 `N_success` / `N_issue` 字段完整性定义，但页面必须分别标注“当前统计”和“AI 生成时纳入”，避免把最新统计伪装成旧 AI 文本的输入。当前区显示：

- 任务作文总数；
- 有效成功作文数；
- 问题通道完整作文数及覆盖率；
- 未纳入数；
- 平均分、最高分、最低分；
- 分数分布；
- 各评分维度均值或归一化表现。

### AI 班级总结

只展示三类 AI 文本：

- 总体评价；
- 主要优点；
- 学习建议。

共性问题卡片中的诊断和教学建议承担“主要不足”和“教学重点”，不再生成同义段落。

总结区只有一个“编辑”入口。进入编辑后统一显示“保存”和“取消”，不为每个段落增加独立编辑按钮。保存必须持久化并使用 revision 防止并发覆盖。

### 共性问题与建议

同一列表包含：

- `系统归纳`：达到普通共性门槛的 AI 语义模式；
- `教师添加`：教师从单篇问题卡片主动加入的问题。

每项显示：

- 来源标签；
- 标题、诊断和教学建议；
- 系统归纳项显示生成快照的 `X / N_issue 名学生`；纯教师添加项只显示“已选 X 名学生来源”；教师项若同时吸收当前 generation 的系统证据，显示“教师已选 X 名学生 · 系统证据 Y / N_issue”，不把人工选择伪装成达到共性比例；
- 总出现次数；
- 最多 3 个匿名例句；
- 可核对的来源入口。

列表初始按严重程度、涉及比例和出现次数排序。教师可直接拖拽；移动端、键盘和屏幕阅读器通过卡片菜单中的“上移/下移”完成同一操作。顺序修改自动保存，不增加“进入排序模式”或“完成排序”按钮，并使用 `aria-live` 宣告移动结果。

删除自动项只作用于当前生成批次；教师明确重新生成后，该问题若再次满足门槛可以重新出现。教师添加项跨重新生成保留；教师主动移除、最后一个教师来源被删除、任务删除或另行批准的数据保留政策除外。

自动项和教师项移出后都必须提供即时“撤销”；撤销在当前 report revision 内恢复原位置并自动保存，不要求教师重新生成或重新寻找来源。若操作使当前聚焦的卡片节点从 DOM 消失，页面礼貌播报移出结果并把焦点移到可见“撤销”按钮；撤销后把焦点恢复到原卡片标题或首个可用操作。撤销通知至少保留到教师执行下一个明确操作，不能用短时自动消失让键盘/读屏用户丢失恢复路径。

若教师添加项与新 AI 项拥有同一稳定 topic key，保留教师项并抑制重复 AI 项。

### 明确拼写清单

明确拼写不进入主要讲评问题卡片海洋。它以紧凑、可展开的列表展示：

- `错误词 → 正确词`；
- 涉及学生数；
- 出现次数；
- 最多 1 个短例句。

默认按涉及学生数、出现次数和规范词序排序。教师若认为某项应成为讲评重点，可把它加入主要讲评问题；否则无需逐项排序。列表的生成、展开和更新均为 0 次模型调用。

### 教师精选素材

教师精选素材继续作为具体课堂案例池，和抽象的共性问题分离。它使用现有的独立素材入口保存典型原句、优秀表达或教师备注；“加入班级总览”问题按钮不会同时写入素材池。精选素材不自动混入 AI 报告正文，也不发送给班级级 Provider。

首版不在班级页增加无来源的自由文本“新增问题”入口。教师主要问题只能从可追溯的单篇问题加入；若未来确需自由添加，必须另行定义标题、诊断、建议、人数展示、无证据标识和权限合同，不能用一个模糊加号直接放开。

### 单篇问题卡片

问题卡片的定位操作和“加入班级总览”必须是独立交互元素，不得使用可点击父卡片包裹按钮。加入按钮是可逆切换：

- 未加入：`加入班级总览`
- 已加入：`已加入，点击移出`
- 已由系统归纳：显示非交互状态标签 `已自动归纳`，不渲染成无动作按钮

从单篇加入时创建一个带该 evidence ref 的教师问题项，初始 `studentCount=1`、`occurrenceCount=1`；同一稳定 topic 后续从其他作文加入时按不同作文身份合并计数，不重复创建卡片。移出只撤销该教师来源：仍有其他教师来源时继续显示教师版本并重算；最后一个教师来源被主动移出且仍有当前 generation 的合法系统 variant/evidence 时，原子恢复为 `origin=ai` 的系统文案、系统标签和“已自动归纳”状态并保留当前位置；没有合法系统 variant 时才删除卡片。若单篇页的已加入按钮因此被非交互“已自动归纳”标签替换，焦点移到当前问题标题并播报状态变化，不能落到 document body。

来源跳转应携带受控 issue 定位信息；返回班级页时恢复原滚动位置，并把键盘焦点恢复到原来源按钮或对应问题标题，不要求教师重新寻找。

## 数据模型

商业目标模型把统计、报告、生成批次和教师素材分开。

### `ClassReviewReport`

`ClassReviewReport` 是每个任务至多一个的 report workspace，不等同于“已有 AI 报告”。它可在首次 AI generation 前由教师加入问题、保存精选素材或打开班级页时惰性创建，并以 `state=draft` 持久保存教师内容和唯一排序。只有 AI 候选成功原子应用后才进入 `ai_available`；来源删除移除 AI 派生内容后进入 `ai_removed`。因此 AI 快照字段必须可空，页面不得通过 report 记录是否存在推断 AI 是否已生成。

```text
id                    opaque
taskId                server-internal relation
state                 draft | ai_available | ai_removed
revision              optimistic concurrency revision
appliedGenerationId?
generatedAt?
snapshotDigest?
includedEssayCount?
issueEligibleEssayCount?
totalEssayCount?
semanticCoverage?
overallComment?
strengths[]
learningRecommendations[]
aiContentBaselineDigest?
aiTextEditedAt?
aiTextEditRevision
issueOrder[]
createdAt / updatedAt
```

`strengths[]`、`learningRecommendations[]` 在 `draft` / `ai_removed` 中为空，`aiTextEditRevision` 从 0 开始。`ai_removed` 同时清空 applied generation 与全部 AI 快照字段，但保留仍合法的教师内容；它和 `draft` 一样没有已应用的 AI generation。active run 只由 generation registry 表示，不在 report 中建立第二个 active 真源。初次生成失败或候选被放弃时，draft workspace、教师问题、教师证据、精选素材和排序全部保留。

### `ClassReviewGenerationRun`

```text
id                    opaque generation ID
taskId
revision              optimistic concurrency revision
state                 queued | running | result_unknown | succeeded | succeeded_unapplied | discarded | invalidated | failed
requestIdentity
snapshotDigest
rubricRevision
resultRevisions[]     server-side only
policyVersion
schemaVersion
projectionVersion
included / excluded counts
provider usage summary
safe failure code
safe unapplied reason? ai_text_changed | merge_conflict
invalidationReason?
createdAt / completedAt / appliedAt? / invalidatedAt?
```

不得把学生姓名、任务名称、作文正文或普通业务 ID 写入 Provider 关联身份、日志关联 ID或 `prompt_cache_key`。

`succeeded` 表示合法候选已经原子应用到 report；`succeeded_unapplied` 表示 Provider 已成功且候选已验证，但因并发 AI 文本编辑或无法安全合并而尚未应用；`discarded` 表示教师明确放弃该候选；`invalidated` 表示任务/来源删除或可信运维结算使一个尚未应用的批次永久不可应用。这四种状态和 `failed` 都不会再次进入 Provider。任务级 actionable-generation 唯一约束覆盖 `queued | running | result_unknown | succeeded_unapplied`，同时封住“待调度/运行批次 + 未处置候选”的交叉竞态。Platform `queued` 表示尚未 claim；worker 必须先在 Platform 事务中持久化 claim、execution identity/hash 并转为 `running`，再调用 Gateway。Platform `running` 表示已 claim 且处于 dispatch/attach/等待准入或 Provider 执行生命周期，不能用来推断是否占槽；唯一 Provider 容量真源是 Gateway 的 `active | unknown` lease。`result_unknown` 表示业务侧只能检查原 execution，通常对应 Gateway `unknown` lease；`succeeded_unapplied` 只占任务级 actionable 位置、不占 Provider 槽。

### `ClassReviewIssueBlock`

```text
id                    opaque
reportId
topicKey              deterministic bounded key, not raw text ID
origin                ai | teacher
generationId?
title
diagnosis
teachingAction
severity
suppressedSystemVariant?  current generation AI title/diagnosis/action/severity
teacherEvidenceRefs[]
systemEvidenceRefs[]
studentCount
occurrenceCount
supportDenominator?   only for system-evaluated support
createdAt / updatedAt
```

`ClassReviewReport.issueOrder[]` 是主要问题顺序的唯一真源；`ClassReviewIssueBlock` 不再保存第二个 `displayOrder`。读取时按 `issueOrder` 投影位置，意外缺失的合法新项按确定性系统顺序追加并在同一事务中修复。Provider 不能决定数据库 ID、`origin`、最终统计、排序或教师所有权。

### `ClassReviewEvidenceRef`

证据引用绑定当时的任务、作文、评分结果和评分标准 revision。每条引用至少保存 `selectionOrigin=teacher_selected | system_generation`、精确 `sourceResultRevision`、源 issue/sentence revision 标识、可选 `generationId` 和删除状态；`system_generation` 必须绑定 generation，`teacher_selected` 不得伪装成系统支持。Provider 只看到每次生成内临时的 `groupId`；真实关系保留在权威任务服务端。

同一教师问题可同时拥有两类证据，但两类数组不能混写：教师显式选择进入 `teacherEvidenceRefs[]`，每次 AI generation 匹配到的证据进入 `systemEvidenceRefs[]`。AI topic 被教师项抑制时，还要把当前 generation 的受控 AI 文案保存为 `suppressedSystemVariant`，只供撤销最后一个教师来源时恢复，不能覆盖可见教师文案。重生成时只替换当前 topic 的系统证据和 suppressed variant，教师证据保持不变；统计取两类有效作文引用的去重并集。

教师主动移出与来源删除采用不同且明确的降级规则：主动移出最后一个教师引用时，若当前 generation 的 system variant/evidence 仍合法，则转换为 AI 项并保持原位置；否则删除。来源/隐私删除只先移除对应引用，但任一被删作文会使包含它的整批 AI 派生内容失效，因此不能借 suppressed variant 恢复该批 AI 内容；教师项仍有其他教师证据时保留并重算，最后一个教师证据被删除时移除。已经应用过的 run 仍保留 `succeeded` 作为无内容安全审计终态，只把 report 置为 `ai_removed` 并清理其内容关系；`invalidated` 专用于尚未应用、原本仍可能写入的 run。

来源入口必须打开 evidence ref 绑定的精确历史 result revision。若该 revision 已按批准的保留政策清理、当前实现尚不能保留历史 revision，或定位信息已失效，页面显示“该来源版本已更新或不可用”，不得把 locator 静默套到当前结果上冒充原证据。历史来源的保存期限受数据保留政策约束；本地原型若没有版本仓库，只能走明确的不可用状态。

`topicKey` 使用服务端 `topic-key-v1` 确定性派生，且只在同一任务内比较：

- 原子组 key 由版本、任务作用域、问题 type/subtype/changeTypes、规范化的单词级修正或精确问题签名形成 canonical fingerprint，再以服务端 HMAC-SHA-256 生成不含原文的 opaque key；文本规范化只允许 Unicode NFKC、首尾/连续空白和英语大小写统一，不做词义替换或模糊距离归并；
- AI 组合模式 key 对单成员集合直接复用该 atomic key；只有两个及以上成员时，才由去重、排序后的 atomic keys 形成组合 canonical fingerprint 并派生 composite key。成员集合完全相同才视为同一 topic，不做标题相似度或模糊语义猜测；
- 教师从单篇加入的项使用对应原子组 key，因此可与同 topic 的 AI 项确定性去重；
- 数据库同时保存受限的 canonical fingerprint digest 和 key version；若检测到 key 相同但 fingerprint 不同，必须拒绝自动合并并生成独立 opaque key，不能只信任截短 hash。

因此“保留原位置”是可测试的精确规则：topic key 相同才保留；成员变化形成新 topic 并按系统顺序追加。

### 教师编辑与重新生成合并

重新生成采用确定性、原子合并：

1. 教师添加项永远保留，且相对顺序不变。
2. 新旧 AI 项拥有同一 `topicKey` 时，保留现有位置并更新 AI 内容及 `systemEvidenceRefs[]`。
3. 旧 AI 项在新结果中消失时移除。
4. 新 AI 项按系统优先级追加到现有列表末端。
5. 教师项与新 AI 项 topic 重复时，只显示教师项的标题/诊断/建议并保留位置与 `teacherEvidenceRefs[]`；用新 generation 的合法 evidence 替换 `systemEvidenceRefs[]`，把新 AI 文案保存为 `suppressedSystemVariant`，再按两类引用的去重并集重算人数与次数，不渲染重复 AI 卡片。新 generation 没有该 topic 时清空旧 system evidence 与 suppressed variant。
6. AI 总结文本即使曾被教师编辑，也会在教师确认重新生成后被替换；确认文案必须明确这一点。
7. 任一验证或持久化步骤失败时，旧报告保持完整，不允许旧新批次拼接。

AI 文本编辑只包括总体评价、主要优点和学习建议。保存这些字段时更新 `aiTextEditedAt` / `aiTextEditRevision`，并比较 `aiContentBaselineDigest`；问题排序、移出/撤销和教师问题变化只更新普通 report revision，不得误标为 AI 文本已编辑。新 generation 成功应用后写入新的 baseline digest 并清除编辑标记。

生成期间不锁死教师的主要问题添加、移出、撤销和排序，但暂时禁用同一页面的 AI 总结文本编辑。完成时权威任务服务在事务内加载最新 report revision，按上述 topic/order 规则合并教师变化，再执行 CAS：

- 教师问题与最新 `issueOrder` 始终保留；
- 若另一个标签页在生成期间修改了 AI 文本基线，或连续 CAS 冲突无法安全合并，生成批次记为 `succeeded_unapplied`，旧报告零变化；
- `succeeded_unapplied` 保存已验证、已脱敏的候选结果，教师随后可显式“应用已生成内容”或放弃，应用不调用 Provider；
- `safeUnappliedReason=ai_text_changed` 时，候选页必须提示该候选产生后教师 AI 文本已变化，并在执行“替换当前 AI 文本并应用”前做一次覆盖确认；确认只授权提交时的 `expectedAiTextEditRevision`，不能授权覆盖确认后又出现的新编辑；
- 候选未应用或放弃前不允许再创建 generation，避免已经付费的合法结果被另一调用覆盖；
- 不能为了处理合并冲突再次调用模型，也不能让迟到结果静默覆盖教师刚完成的编辑。

## 服务端权威快照

商品化路径不允许客户端自行声明班级人数、比例或证据归属，也不能把当前 Grading Gateway 误当成用户/租户安全边界。职责固定为：

- **权威任务服务**：拥有登录教师/租户授权、任务与结果 repository、report transaction、generation registry、任务级 actionable-generation 唯一约束、证据关系、全量统计和最终报告合并；
- **Grading Gateway**：拥有跨实例共享的全局 Provider admission、Kimi Prompt/Schema、一次 completion、输出结构校验、安全 usage，以及按 opaque execution identity 与 canonical payload hash 绑定的持久 Provider 执行/结果 registry；它只接受权威任务服务通过服务间认证发送的去身份化有界投影；
- **浏览器**：只发送用户命令和期望 revision，不发送班级人数、结果数组、证据或 Provider Prompt。

浏览器到权威任务服务使用独立业务合同：

```text
class-review-generation-command-v1
class-review-generation-status-v1
class-review-report-v1
```

推荐路由：

```text
POST /tasks/:taskId/class-review-generations
GET  /tasks/:taskId/class-review-generations/:generationId
GET  /tasks/:taskId/class-review-report
PATCH /tasks/:taskId/class-review-report
```

业务合同使用 exact keys：

```text
class-review-generation-command-v1 =
  | {
      contractVersion
      intent                 initial
      generationId           client-proposed opaque ID for the new run
      expectedTaskRevision
      expectedReportRevision integer | null
    }
  | {
      contractVersion
      intent                 regenerate
      generationId           client-proposed opaque ID for the new run
      expectedTaskRevision
      expectedReportRevision integer
    }
  | {
      contractVersion
      intent                 apply_candidate
      generationId           existing succeeded_unapplied run ID
      expectedTaskRevision
      expectedReportRevision integer
      expectedGenerationRevision
      expectedAiTextEditRevision
    }
  | {
      contractVersion
      intent                 discard_candidate
      generationId           existing succeeded_unapplied run ID
      expectedGenerationRevision
    }

class-review-generation-status-base-v1 {
  contractVersion
  generationId
  generationRevision
  includedEssayCount
  issueEligibleEssayCount
  totalEssayCount
  createdAt
}

class-review-generation-status-v1 =
  | base & { state queued | running }
  | base & { state result_unknown; safeFailureCode }
  | base & { state succeeded; semanticCoverage; completedAt }
  | base & { state succeeded_unapplied; semanticCoverage; safeUnappliedReason; completedAt }
  | base & { state failed; safeFailureCode; completedAt }
  | base & { state discarded; completedAt }
  | base & { state invalidated; safeFailureCode; completedAt }

class-review-actionable-generation-summary-v1 =
  | {
      generationId
      generationRevision
      state                  queued | running
      createdAt
    }
  | {
      generationId
      generationRevision
      state                  result_unknown
      safeFailureCode
      createdAt
    }
  | {
      generationId
      generationRevision
      state                  succeeded_unapplied
      safeUnappliedReason
      createdAt
      completedAt
    }

class-review-report-v1 =
  | {
      contractVersion
      taskRevision
      workspaceState        none
      reportRevision         null
      aiTextEditRevision     0
      currentGeneration      class-review-actionable-generation-summary-v1 | null
      statistics
      issueBlocks[]          empty
      issueOrder[]           empty
      clearSpellingItems[]
      selectedMaterials[]    empty
    }
  | {
      contractVersion
      taskRevision
      workspaceState        draft | ai_removed
      reportRevision         integer
      aiTextEditRevision     integer
      currentGeneration      class-review-actionable-generation-summary-v1 | null
      statistics
      issueBlocks[]          teacher blocks only
      issueOrder[]
      clearSpellingItems[]
      selectedMaterials[]
    }
  | {
      contractVersion
      taskRevision
      workspaceState        ai_available
      reportRevision         integer
      aiTextEditRevision     integer
      currentGeneration      class-review-actionable-generation-summary-v1 | null
      appliedGenerationId
      generatedAt
      snapshotMetadata
      statistics
      aiSummary
      issueBlocks[]
      issueOrder[]
      clearSpellingItems[]
      selectedMaterials[]
    }
```

`GET /tasks/:taskId/class-review-report` 即使尚无持久 workspace，也返回 `workspaceState=none` 的只读变体和当前 `taskRevision`，使首个 `initial` 请求可以提交明确的 CAS 基线；这不要求提前创建数据库 report 行。`none`、`draft`、`ai_removed` 变体不得出现 `appliedGenerationId`、`generatedAt`、`snapshotMetadata` 或 `aiSummary`；`ai_available` 必须完整拥有这些字段。

同一读取事务还必须按“未处置候选优先，其次 active run”返回每个任务至多一个 `currentGeneration`；只有 `queued | running | result_unknown | succeeded_unapplied` 可以出现在该字段。由此刷新、新标签页或新设备无需事先知道 generation ID 就能落实 CTA 优先级，再使用现有按 ID 状态路由轮询或提交 apply/discard。没有 actionable run 时字段显式为 `null`；已经 applied、failed、discarded 或 invalidated 的 run 不返回。generation status 与 actionable summary 都必须返回 `generationRevision`，每个 report 变体同时返回该读取快照的 `aiTextEditRevision`（无 workspace 时固定为 0），二者共同提供待应用候选命令的完整 CAS 基线；不能从普通 `reportRevision` 推导 AI 编辑 revision。

浏览器身份来自受保护会话，body 不允许提交 teacher/tenant ID、作文结果、人数或证据。PATCH 只接受明确的编辑命令与 expected revision，不能让客户端整对象覆盖服务端报告。

`intent` 是唯一动作判别字段，不再另设“重新生成标志”。`initial` 表示当前没有已应用的 AI generation，包括完全没有 report workspace、已有 `draft` / `ai_removed` workspace 或此前初次批次失败/失效的情况；`regenerate` 只允许在 `state=ai_available` 时使用。`expectedReportRevision=null` 只允许 `initial` 且服务端当前确实没有 workspace；若教师问题已先创建 draft，则必须提交其整数 revision。不存在 report 的 `initial` 必须在创建 run 的同一事务中创建 draft workspace，避免生成前教师写入和生成快照分叉。

`apply_candidate` 和 `discard_candidate` 的 `generationId` 都引用已有的 `succeeded_unapplied` run，不创建新 run、不调用 Provider。应用时必须再次校验任务仍获授权、候选未失效、候选绑定的历史 source revisions 仍可用且未删除，并校验 generation revision、当前 task/report revision 与 `aiTextEditRevision`，再按最新教师项和顺序执行一次 CAS。这里不要求历史 source revision 仍是每篇作文的当前 revision；普通单篇修改仍允许教师明确应用旧快照。成功后 run 转为 `succeeded`，report 写入 `appliedGenerationId`，候选正文从临时存储移除。若任一当前 revision 又发生变化，候选继续停留在 `succeeded_unapplied`，刷新冲突说明，绝不能覆盖更新后的教师 AI 文本。放弃只对 generation revision 做 CAS，成功后转为 `discarded` 并删除候选正文/证据；它不覆盖 report，也不要求 report revision 停留在候选产生时。任一前置条件冲突都返回安全冲突状态，不得隐式新建 generation。

客户端 generation ID 不是并发锁。服务端创建批次时必须在同一事务内锁定稳定 task 行，校验 task/report revision、固定 snapshot digest、结果 revisions 和服务端计算的 canonical payload hash，并通过一个覆盖 `queued | running | result_unknown | succeeded_unapplied` 的数据库 actionable 唯一约束保证每个任务至多一个当前动作真源。另一个标签页即使提交不同 generation ID 或 request identity，只要已有 active run 的 snapshot、全部固定 revisions 与 canonical payload hash 完全相同，就返回该既有 generation ID；snapshot、任一固定 revision 或 payload hash 不同则返回安全的 `active_generation_conflict`。若已有 `succeeded_unapplied`，只返回待处理候选状态，不把它重挂成新批次。不得先产生第二次 Provider 调用再依赖报告写入 CAS 决胜。

服务端必须：

1. 验证登录教师、租户和任务归属；
2. 从持久任务仓库加载当前 rubric 和有效成功结果；
3. 固定 result/rubric revisions，形成不可变快照；
4. 计算全量统计、明确拼写和问题原子组；
5. 构造去身份化 Gateway 投影；
6. 通过内部服务认证调用 Grading Gateway 一次；
7. 校验 Gateway 返回的受控引用，按隐藏证据集合重算统计并事务合并报告。

权威任务服务到 Grading Gateway 使用内部合同 `class-review-synthesis-request-v1` / `class-review-synthesis-result-v1` 和仅服务间可达的 `POST /grading/class-review-syntheses`。Gateway 到 Kimi 的 exact-key JSON Schema 命名为 `kimi-class-review-output-v1`，只约束 Provider 输出，不是浏览器 API。

内部 synthesis request 只包含 contract/request version、opaque service request ID、opaque prompt cache key、安全统计、generation-local dimension/group aliases、已脱敏有界片段和输出边界；result 只包含绑定的 opaque request ID、严格 Provider 输出、finish reason、usage、阶段耗时或安全失败状态。内部路由必须使用服务间认证、禁止浏览器 CORS、拒绝普通 task/essay/result ID，并由 Gateway 再次执行 exact-key、大小和去身份字段校验。

当前仓库尚无上述权威任务服务。若实施时暂用客户端严格快照调用 Gateway，只能作为显式标注的本地原型适配器；它不得开放为公网生产路由，也不得宣称具备认证、租户隔离、持久幂等或商业数据安全边界。

## 权威任务服务到 Provider 边界的输入投影

### 全量确定性统计

以下信息在权威任务服务中精确计算：成绩与维度使用全部 `N_success`，问题类别、明确拼写和问题原子组只使用 `N_issue`：

- 纳入/排除数量；
- 分数分布；
- 各维度均值、中位数和归一化表现；
- 问题大类、逻辑 subtype 和严重度计数；
- 明确拼写分组；
- 每个问题原子组的隐藏作文集合。

班额增大时必须使用数据库聚合、游标流式扫描或可落盘的有界聚合器；不得把全部逐篇 `grading-result-v2` 同时载入浏览器或一个无上限进程数组。班级人数可以增加计算行数，但不能让 Provider Prompt 随人数无界增长。

明确拼写本身不需要模型。只有达到普通共性门槛的拼写聚合统计可以作为班级总体倾向输入；一次性明确拼写不会被模型夸大成班级弱点。

### 问题原子组

非拼写问题先用精确、可审计的签名分组。每组保留：

- 每次生成内的短 `groupId`；
- 问题类型或逻辑 subtype；
- 严重度；
- 有界代表原句；
- 有界建议改法或诊断；
- 服务端隐藏的不同作文集合和出现次数。

原子组若自身已经达到普通共性门槛，标记为 `mustCover`。这类组即使因投影预算未发送、或模型合法结果未引用，也必须由权威任务服务用已脱敏的规范化标题、解释和建议创建确定性 `系统归纳` fallback 问题项；它不增加模型调用。若可见文本无法安全脱敏，fallback 只使用固定 type/subtype 教学模板且不显示例句，不能回填原文。AI 的价值是把多个未单独达标但语义一致的已投影组归并为共性模式，而不是决定已明确达标的问题是否消失。

不使用未经验证的模糊语义算法在本地自动合并。

### 内容级去身份化

移除姓名字段并不等于原句匿名。任何代表片段、建议或诊断进入 Gateway 投影或班级页“匿名例句”前，权威任务服务必须执行版本化的 `class-review-redaction-v1`：

1. 用任务仓库中的学生姓名、默认学生标签、教师、班级、学校和任务名称词典做 Unicode 规范化后的精确/大小写无关替换；
2. 用本地确定性检测器清除邮箱、手机号、学号/证件号、社交账号、URL 和连续身份数字；不得为脱敏再调用外部模型；
3. 对剩余文本运行本地版本化人名/实体检测，命中项替换成固定占位符；检测不确定、上下文不足或替换后破坏问题证据时，整条可见片段从投影与匿名例句中省略，只保留服务端 evidence ref 和结构化类别；
4. 同一 scrubbed 文本用于 Gateway 与教师可见匿名例句，不能让 Provider 看脱敏版、页面却回填原句；查看完整来源只能通过已授权的单篇页面完成；
5. redaction 只记录数量和版本，不记录被替换内容。因脱敏被省略的合格组仍计入 `eligibleGroupCount`，但不计入 `projectedGroupCount`，因此覆盖说明会真实下降。

任何片段只要包含测试植入的姓名、邮箱、手机号、学号、任务名、类似指令文本或未清除标识符，就必须在 Provider 前 fail closed。脱敏器不能证明安全时优先省略例句，而不是以“匿名”名义发送原文。

### 有界语义投影

如果所有原子组不能在安全预算内完整进入 Prompt，投影必须：

- 优先保留已有重复支持的组；
- 按问题类型和严重度分层；
- 在不同作文之间轮转，避免只选择最长、最高分或最严重的少数作文；
- 为每类保留有限代表文本；
- 记录 `projectedSignalCount / eligibleSignalCount`。

页面只有在覆盖不足 100% 时显示中性的覆盖说明。返回模式的支持人数对已投影组仍按服务端真实隐藏集合精确计算，但系统不得宣称未投影信号已被完整分析。

`class-review-projection-v1` 使用以下版本化默认硬边界；调整任何边界都必须提升 projection version 并重新跑质量与成本验收：

- 全量统计最多包含 10 个评分维度、20 个分数区间和 32 个固定问题/严重度计数项；字面量 `other` 也占用这 32 个槽位中的 1 个。统计 JSON 不超过 8 KiB UTF-8；超出固定枚举的长尾只合并到 `other`，不发送动态标签。
- 语义投影最多 64 个原子组。每组最多 1 个代表片段，原句、建议/诊断分别最多 160 个 Unicode 码点，标题或类型标签最多 48 个码点，组内可见字符串总计最多 360 个码点。
- 代表片段只截取包含证据核心的原文连续子串，并在服务端保留完整 evidence ref；不得让模型把截断片段当作完整作文。码点截断必须确定性执行，不能切断 surrogate pair。
- 投影 evidence JSON 不超过 32 KiB UTF-8；固定 system、policy、Schema 与统计前缀合计不得超过 16 KiB；最终发送给 Provider 的全部文本不超过 48 KiB UTF-8。任一固定前缀自身超限时部署测试直接失败。
- `class-review-prompt-budget-v1` 另设 16,384 个 Provider prompt tokens 的硬上限，其中我们可控的完整 system/policy/Schema/statistics/evidence/wire text 最多占 15,872 tokens，至少预留 512 tokens 给 Provider framing。48 KiB 只是独立的传输/安全字节上限，不能代替 token 上限；两者同时生效且取先到者。
- 选择器按“已有重复支持 → 问题类型与严重度分层 → 不同作文轮转 → 稳定 group key”确定性装包，在到达组数、字节或 token 上限前停止；不得随机裁剪，也不得为了塞入更多组而继续压缩已经入选的文本。
- `mustCover` 组拥有最高投影优先级；若它们本身超过投影边界，超出部分仍走确定性 fallback，并计入未投影覆盖量，不能把 Prompt 硬撑大。
- 当 `eligibleGroupCount=0` 时，纯统计请求合法。只有存在合格组却连一个组都无法与合法统计共同装入边界时，权威任务服务才在 Gateway 前返回 `class_review_projection_too_large`；Gateway 还要对内部请求重复执行字节、组数和 token 防御校验。两种拒绝的 completion 数都为 0，不得发送超限请求后依赖模型截断。

Gateway 必须在 Provider 准入前对最终序列化请求执行版本化 token 预检。`class-review-prompt-budget-v1` 不允许单独信任“兼容”或经验校准的 tokenizer：对我们可控的完整 system/policy/Schema/statistics/evidence/wire payload，准入计数固定取 `max(modelTokenizerCount, utf8ByteCount)`；tokenizer 不可用或版本未知时，`modelTokenizerCount` 视为不可用，但完整 UTF-8 字节上界仍强制执行，绝不能跳过。因为每个内容 token 至少承载一个输入字节，这个 byte 分支是不会低估的保守上界；未来只有获得可证明精确且覆盖完整 chat template 的权威 tokenizer 后，才能通过提升 budget version 移除该分支。

512-token framing 上限本身必须由当前固定模型版本的受控空载/边界基线证明确实覆盖 Provider 额外 framing；尚未证明时，真实 Kimi 班级生成 fail closed，本地 fake 才可继续。固定前缀与合法统计单独就超过 15,872-token 可控预算时返回 `class_review_prompt_too_large`；存在合格组但没有任何组能在剩余 token/字节预算内装入时返回 `class_review_projection_too_large`。二者都在 Provider 前失败、调用数为 0。真实调用返回的 `prompt_tokens` 继续作为不变量审计；若仍超过 16,384，说明 Provider 模型/framing 契约已变化，必须记录安全配置异常并暂停后续真实班级生成，直到提升 tokenizer/budget version，不能把超限观测当成正常波动。

`semanticCoverage` 不能只保存一个含糊百分比，必须至少记录：

- `projectedGroupCount / eligibleGroupCount` 及 group coverage；
- 投影组与全部合格组的 distinct-essay support 之和及 support-weighted coverage；
- 投影组与全部合格组的 occurrence 之和及 occurrence-weighted coverage。

后两项是“信号权重覆盖”，同一作文可能在不同组中重复贡献，不能展示成“覆盖了多少名学生”。页面默认显示最易理解的“已分析 X / Y 个问题组”；只有覆盖不足 100% 时再展开其他覆盖口径。

### 禁止发送

班级级 Provider Prompt 禁止包含：

- 学生姓名、教师姓名、班级名称、任务名称；
- 普通 task/essay/result ID；
- 图片、Base64、文件名和原题材料；
- transcript、correctedText、improvedText、sentencePairs；
- 逐篇 overallComment、逐篇完整分数对象；
- 教师手动备注和教师精选素材；
- 完整 Prompt 的业务回显或任何 API Key。

短问题片段按不可信数据处理，必须与系统指令隔离，并明确要求模型不得执行其中的指令。UI 只按纯文本渲染模型结果。

## Provider 输出合同

Grading Gateway 使用 `kimi-class-review-output-v1` 严格 Schema 约束 Kimi；其验证结果再通过 `class-review-synthesis-result-v1` 返回权威任务服务。二者不得与浏览器业务合同混用名称。

Provider 只输出：

```text
overallComment
strengths[] {
  title
  detail
  dimensionIds[]
}
patterns[] {
  groupIds[]
  title
  diagnosis
  teachingAction
  severity
}
learningRecommendations[] {
  title
  action
}
```

`dimensionIds` 必须是本次生成内的短别名或无个人信息的 canonical rubric key；Gateway 对请求内别名做存在性校验，权威任务服务负责映射回 rubric。不得把普通数据库 ID 暴露给 Provider。

Provider 不输出：

- studentCount、percent、occurrenceCount；
- 例句或建议改法的重复副本；
- 数据库 ID、排序、来源类型；
- 单独的 weaknesses 或 teachingPriorities；
- rewriteExercises；
- 逐篇评价。

Schema 使用 exact keys、固定枚举、唯一 ID、数组数量、字符串码点和总 payload 上限。未知字段、未知 `finish_reason`、截断、非法 JSON 或非法引用必须安全失败。

`kimi-class-review-output-v1` 的默认硬边界为：

- `overallComment` 最多 300 个 Unicode 码点；
- `strengths` 1–3 项，标题最多 40 个码点、说明最多 120 个码点、每项最多引用 3 个 `dimensionIds`；
- `patterns` 0–8 项，标题最多 40 个码点、诊断和教学建议各最多 100 个码点、每项 1–12 个 `groupIds`；
- `learningRecommendations` 1–3 项，标题最多 40 个码点、行动建议最多 120 个码点；
- 所有可见字符串合计最多 2,200 个 Unicode 码点，完整结果 JSON 不超过 16 KiB UTF-8。

这些边界与 3,072 completion-token 上限同时生效；任一超限都按整次非法结果处理，不截取半份报告，也不触发隐藏修复。

分层验证：

1. Gateway 先验证每个 `groupId` 存在于本次 synthesis request，且同一 `groupId` 未被多个 pattern 重复占用；
2. 权威任务服务再按 generation 和不可变快照验证这些临时 ID，任何未知、跨批次或重复所有权引用都使整次生成失败；
3. 权威任务服务对每个 pattern 合并隐藏作文集合并重新计算人数、比例和次数；
4. 低于普通共性门槛的 pattern 确定性丢弃，不进入报告；
5. Provider 或 Gateway 传回的自报统计、数据库 ID、排序和来源字段一律不被接受；
6. 合法但没有共性 pattern 的结果仍可成功，页面显示“本次未识别到达到门槛的共性问题”；
7. 权威任务服务从原子组回填最多 3 个已脱敏匿名例句，不要求模型重复生成。
8. 每个未被合法 pattern 消费的 `mustCover` 组确定性生成 fallback 项；fallback 仍按真实 `N_issue` 统计，并与教师项/topic key 去重。

## 调用预算与 token 预算

沿用前置优化设计中的变量，并新增：

- `G`：所有获教师明确授权、会进入或可能已经进入 Provider 的班级 generation 数，包括首次生成、重新生成、来源删除后重新生成和可能已计费终态失败后的显式重试；本地准入前失败不计入 Provider completion。

目标正常路径：

```text
R + C + N + T + G
```

其中正常任务 `G = 1`。下列动作不改变 `G`：

- 查看班级总览；
- 本地统计和明确拼写更新；
- 同一生成批次双击；
- HTTP 重发；
- 刷新后重新挂接；
- 读取成功缓存；
- 单篇结果发生变化但教师未重新生成。

初始阶段预算：

- 目标 Prompt：8k–12k 实际 tokens；
- Prompt 硬上限：16,384 tokens（可控 payload 最多 15,872，Provider framing 预留至少 512）；
- 最大 completion tokens：3,072；
- Provider reasoning effort：`low`；
- 正常可计费 completion：每 generation 最多 1 次。

上限不是成本达标证据。实现必须记录真实 prompt、completion、total、cached tokens 和阶段耗时，再按真实分位数收紧或放宽。

## 幂等、缓存与并发

### 逻辑身份

生成身份绑定：

```text
task relation
snapshotDigest
generationId
rubric revision
policy version
schema version
projection version
```

同一 generation 的双击、重发、断线重挂和结果检查必须 attach 到同一 in-flight 或成功记录。显式重新生成创建新的 generation ID，即使输入快照未变化也视为教师授权的新调用。

任务级 actionable-generation 唯一约束先于 generation 级幂等：同一任务已有 `queued`、`running`、`result_unknown` 或 `succeeded_unapplied` 时，不得接受另一个 generation。前三态只有在可信结束，或由受控运维流程把无法结算的批次解析为明确终态后，才释放该位置；`succeeded_unapplied` 只有在应用、明确放弃或删除失效后释放。

`queued` 只表示业务批次等待 worker claim，占任务级 actionable 位置；worker 在发起任何 Gateway submit/attach 前先以 Platform 事务把它转为 `running`。`running` 可以处于 Gateway 准入前、等待准入、`active` Provider 调用、原 execution attach 或成功结果提交阶段，因此本身不等于一个 Provider 槽；只有 Gateway `active | unknown` lease 计入共享容量。`result_unknown` 只能检查原 execution，不能重发。`succeeded_unapplied` 已是 Provider 终态，不占运行槽位，但仍占上述任务级 actionable 位置；教师应用或明确放弃候选均为 0 次模型调用。

run 的合法状态转换固定如下：

- `queued → running → succeeded | succeeded_unapplied | failed | result_unknown | invalidated`；
- `running → queued` 只允许同一 generation/execution identity/hash 在 Provider 明确确认 0 completion 的有界 `429` / 准入失败后发生；该转换前必须结算并释放对应 lease，不得用于 timeout、连接丢失或任何结果未知状态；
- `queued → failed | invalidated`；
- `result_unknown → succeeded | succeeded_unapplied | failed | invalidated`，只能由可信 Provider 对账或受控运维结算触发；
- `succeeded_unapplied → succeeded | discarded | invalidated`，分别对应应用、放弃或来源/任务删除；
- `succeeded`、`discarded`、`invalidated`、`failed` 不得再进入 Provider 或恢复候选。

任务或任一快照来源删除时，权威任务服务必须在删除事务中把相关 `queued | running | result_unknown | succeeded_unapplied` run 标为 `invalidated`、递增 generation revision/失效 epoch、清除候选正文与证据，并释放任务级 actionable-generation 唯一约束。已经发出的 Provider 请求可能无法撤销，但继续占用全局 admission 槽直到返回；返回处理必须以未变化的失效 epoch、原 execution identity/payload hash、lease fence 和来源仍存在为联合写入栅栏。任一条件不成立时只允许结算不含内容的安全 usage，不持久化响应正文、不修改 report，也绝不能恢复已删除来源。新 generation 即使随后获得教师授权，也仍须等待全局 admission 有空闲槽位。

若来源删除发生在 run 已 `succeeded` 之后，不回写历史状态为 `invalidated`：该 run 保留为去内容、去业务关系的成功审计终态，report 与 AI 派生内容按删除规则清理并进入 `ai_removed`。这样 run 状态只描述当时 Provider/应用结果，不被误用为内容当前仍可展示的标志。

### 持久 registry

商品化实现必须有两个互补的持久层：权威任务服务持久化业务 generation run、候选和最终报告；Grading Gateway 为 `material_context | rubric_generation | essay_grading_images | essay_regrading_text | class_review_generation` 五个计费阶段持久化 opaque、payload-hash-bound 的 Provider execution。Gateway 必须在返回 HTTP 成功前原子写入严格归一化结果、usage 和终态；丢失响应、进程重启或另一 Gateway 实例只能 lookup/attach 原 execution，不能重新 submit。权威任务服务提交业务结果后再 acknowledge 并清除 Gateway 的加密结果 envelope；删除通过独立 purge/fence 流程处理。当前 `OneShotProviderExecutionTracker` 没有成功缓存或跨请求 attach，不能单独承担这些保证；单进程 memory registry 只能用于本地开发。

删除采用两阶段收口：仍有未结 Provider 调用时，Gateway 只保留随机 lease/fence 和不可展示的临时 tombstone 来拒绝迟到内容，未知 lease 继续占用共享准入且不能因 TTL 自动释放；调用被可信结算后，安全 usage 迁移为不含 execution key、payload hash、request/snapshot/task 关系的去关联聚合，随后物理删除 execution identity、payload digest、结果 envelope 与 tombstone。租户/任务删除完成条件必须等待该 final purge outbox 清空；不得为保留 admission 槽而永久保留可关联 identity。

### Prompt 缓存

`prompt_cache_key` 使用服务端 HMAC，绑定 rubric、班级讲评 policy/schema/projection revision，且不含个人信息。Prompt 缓存只优化稳定前缀，不承担幂等或正确性。

### Provider 准入

班级生成复用同一个全局 Provider admission controller，占用一个槽位，不建立独立并发池。商品化多实例中，hard/target limit、稳定成功窗口、429 deadline、鉴权/余额/配置暂停、token-contract-drift 暂停和 active/unknown leases 必须由 Gateway 专用持久 store 事务共享；单实例内存计数不能作为生产保证。队列正常已 settled，因此不应与大批逐篇请求竞争；若仍有受控恢复请求，沿用同一硬上限和准入策略。

每 generation 的 Provider 正常 completion 尝试为 1：

- 只有 Gateway 本地准入尚未触达 Provider，或 Provider 明确返回且可证明未产生 completion 的 `429`，才可以沿用同一 generation；`429` 必须继承全局准入控制器既有的最大重挂次数、累计等待上限和 `Retry-After` 上限，不能在班级阶段另开无限重试；
- 其他终态失败后的教师显式重试一律创建新 generation，并计入 `G`；即使失败原因是 Schema、截断、内容过滤或非法引用，也不得在已经可能产生 completion 的旧 generation 内再次调用；
- `result_unknown` 在可信结算前既不得自动重发，也不得创建新 generation，只允许检查和重挂原 run；
- 鉴权、余额、权限和配置错误暂停准入；
- Schema、截断、内容过滤和非法引用不做隐藏模型修复。

## 失败与恢复

### 初次生成失败

- 保留 draft report workspace、教师问题及其顺序、成绩统计、明确拼写和教师精选素材；
- 显示安全错误文案；
- 不产生半份 AI 报告；
- 除已确认零 completion 的本地准入/有界 `429` 重挂外，只有教师显式重试才继续；该操作创建新 generation、计入 `G`，并以明确文案提示会产生一次新的 AI 调用。

### 重新生成失败

- 旧成功报告继续显示；
- 教师编辑和排序保持不变；
- 新批次记录安全失败，不覆盖 active generation。

### 结果未知

- 显示“结果状态暂时未知，检查结果”；
- 检查操作重挂同一 generation，不产生第二次 completion；
- 不提供会立即创建新 generation 的模糊“重试”按钮；在 Provider 或受控运维流程给出可信终态前，任务级 active-generation 唯一约束继续阻止新批次。

若 `result_unknown` 绑定的任务或任一来源随后被删除，该 run 直接进入 `invalidated`，删除关系和候选数据，不能再通过“检查结果”恢复；迟到结果服从前述写入栅栏。

### 部分作文失败

部分作文失败不阻断。报告显示纳入数和排除数，不把缺失作文当作没有问题或零分。

### 生成期间输入变化

生成操作绑定点击时的不可变快照。教师随后修改单篇结果不会取消已授权调用；成功结果仍可以作为该快照的报告保存，并显示生成时间与覆盖范围。系统不自动追加第二次调用。

## 持久化、权限与商业发布门槛

### 持久化

正式发布前必须持久化：

- 任务和当前 rubric revision；
- 作文结果及其 source/result revision；
- generation run 和安全状态；
- 成功报告；
- AI 文本的教师编辑；
- 教师问题、精选素材和排序；
- 必要的证据关系和删除状态。

`localStorage` 不足以承担多设备、权限和未成年人数据。完整持久任务仓库属于独立基础设施项目，但本功能的生产实现必须通过 repository 接口接入它；若仓库尚不存在，只能交付明确标注的本地原型。

### 权限

生成、查看、编辑、删除、排序、查看来源和重新生成都必须校验：

- 已认证教师身份；
- 租户或学校边界；
- 任务归属；
- 可写或只读角色；
- 防止通过可预测 ID 跨任务枚举。

当前应用尚无完整账号/租户授权，这是商业发布阻断项，不在界面上用隐藏按钮代替服务端授权。

### 数据保留

先采用以下 fail-closed 删除语义，且其优先级高于“普通修改后保留旧快照”的产品规则：

- 删除整个任务时，级联删除 report、issue blocks、evidence refs、generation candidates、教师编辑、精选素材和排序；只允许按另行批准的审计政策保留不含内容、execution identity、payload/snapshot digest 与业务 ID 的聚合 usage。
- 删除单篇作文或执行学生数据删除请求时，立即删除关联 evidence ref、匿名摘录和待应用候选，并按前述状态机使所有包含该作文快照的未结 generation 失效；明确拼写与确定性统计零调用重算。
- 任何 AI generation 的输入快照只要包含被删除作文，其 AI 总评、优点、建议和 AI 问题块全部从 active report 移除，report 进入 `ai_removed`，不继续展示由已删除数据派生的文本；教师问题/素材先删除该作文的来源引用，仍有其他合法教师来源时保留并重算，最后一个来源消失时才删除该教师内容。
- 系统不自动重新生成。若剩余数据仍符合资格，教师可以再次显式生成并产生一次新调用；页面只显示内容无关的“来源数据已删除，原 AI 内容已移除”。
- 作文删除后，generation run 仅可保留安全状态、时间和 usage 计数；snapshot/result 关系、投影文本和候选输出必须随删除清理。整个任务删除后若审计政策允许保留 usage，只能先通过 final-purge outbox 转为不含 `taskId`、request identity、Gateway execution key、canonical payload hash、snapshot digest 或其他可回连业务关系的去关联聚合记录；随后删除 Gateway execution/tombstone 行。未结 lease 可临时保留随机 fence 直至可信结算，但不得恢复内容或因 TTL 静默释放；删除回执保持可见的 `pending_provider_settlement`，直到 Provider 返回或受控运维以可信证据结算并完成 final purge，不能无观测地永久悬挂。

正式上线前还需由产品、学校和法律责任方另行确定：

- 学生摘录、精确历史 result revision 和来源证据的保留期限；
- 已级联删除内容在备份中的清除 SLA，以及不含内容的聚合审计/usage 保留边界；
- 未成年人数据授权、去标识化和删除流程。

这些保留期限与授权政策未确认前不得把真实学生数据的长期保存视为已获授权；上述 fail-closed 行为只是工程安全默认，不替代合规审批。

## 安全日志与观测

新增 telemetry stage：

```text
class_review_generation
```

只允许记录：

- 安全诊断 ID；
- generation 状态；
- 纳入/排除数量；
- 原子组数和投影覆盖计数；
- 队列等待、Provider、验证、持久化和总耗时；
- prompt/completion/total/cached tokens；
- finish reason；
- 安全错误码。

禁止记录：

- 学生姓名、班级名、任务名；
- 问题原句、例句、作文全文；
- 图片、Base64、文件名和原题材料；
- 完整 Prompt；
- Provider 原始响应；
- API Key、Authorization header、普通业务 ID。

usage 只在真正发生一次 Provider completion 时累计一次。多个调用方 attach 同一 generation 不得重复计费统计。

## 迁移与兼容

- 真实任务页面停止读取 `mockClassInsights`；mock 只保留在明确的测试或演示 fixture 中。
- 现有 `generateClassReview` 布尔字段不得继续由是否存在材料上下文决定；班级总结资格来自队列 settled 和有效成功作文数。
- 现有 `ClassReviewMaterial` 可作为教师精选素材的迁移来源，但不得继续用包含原句的 key 作为生产 ID。
- 现有四 Tab 页面收口为单页；静态“mock 洞察”提示从真实页面删除。
- 单篇 `grading-result-v2`、多模态请求、教师确认文本重批和原卷视图保持不变。
- 不启动、接入或修改 OCR Gateway。

## 测试策略

### 确定性聚合

- 20% 使用向上取整；
- `N_issue=2/9/10` 的人数门槛边界；
- 同一作文重复问题只计 1 名学生；
- 出现次数独立累计；
- `N_success` 与 `N_issue` 分离，问题通道不完整的 partial 不压低问题比例；
- 明确拼写直入与模糊拼写拒绝；
- `filling → feeling` 这类 certain 近形 `word_choice` 通过，语义改写、远距离词替换和不确定近形词拒绝；
- 同一位置缺失/多个 revision、不同修正词、重叠 grammar/word_choice、整句或多词改写均不得通过“修正唯一”；
- 拼写规范化和不同修正对不误合并；
- 结果重批、教师修正或作废后明确拼写重算；
- 无共性问题的合法空结果。

### Provider 投影与合同

- 禁止字段不进入 Prompt；
- 有界投影的分层和作文轮转；
- 覆盖计数准确；
- strict exact-key Schema；
- `initial` / `regenerate` / apply / discard 判别联合拒绝非法 key 组合，尤其拒绝 `regenerate + expectedReportRevision=null`；generation status 的每个 state 拒绝其他 state 专属 reason/completion 字段；report 的 `none` / `draft` / `ai_removed` 变体拒绝 AI 快照字段，`ai_available` 缺任一必需 AI 字段时拒绝；
- Unicode 码点、数组和总 payload 边界；
- 64 组、8/32/48 KiB 输入边界、15,872 可控/16,384 总 Prompt token 边界，以及 2,200 码点/16 KiB 输出边界的等于上限与上限加一；
- v1 始终使用 `max(modelTokenizerCount, utf8ByteCount)`，验证一个会低估的 tokenizer 也不能绕过 byte 上界；固定前缀超限为 `class_review_prompt_too_large`，无组可装入为 `class_review_projection_too_large`，均为 0 completion；
- 当前模型版本缺少 tokenizer/framing 校准证据时，真实 Provider 准入 fail closed，fake/loopback 不伪造真实 token 合规结论；
- 未知、重复和跨 generation 引用拒绝；
- 权威任务服务重算人数、比例、次数和例句；
- 低于门槛的 pattern 被过滤；
- 未投影或未被模型引用的 `mustCover` 组确定性进入 fallback，且不增加 completion；
- 截断、未知 finish reason 和非法 JSON 安全失败。

### 幂等与调度

- 首次生成正常恰好 1 次 completion；
- 无 workspace、已有教师问题的 draft workspace、初次失败后的 draft 三种 `initial` 均能正确校验 nullable/integer report revision，且 report 行存在不被误判为已生成；
- report 在同一读取事务返回唯一 actionable generation；刷新、新标签页和新设备无需预知 ID 即可恢复 queued/running/result-unknown/unapplied，终态 run 不进入该摘要；
- 刷新后 report 同时提供 generation revision 与独立 `aiTextEditRevision`，可以构造合法 apply；确认后另一标签页再次编辑 AI 文本时 CAS 拒绝且候选保持未应用；
- 双击、重放、断线重挂和检查结果不新增 completion；
- 两个标签页使用不同 generation ID 竞争时，相同 snapshot、固定 revisions 与 canonical payload hash 必须 attach 到同一 generation；任一成员不同必须安全冲突，任务级唯一约束只允许一个批次进入 Provider；
- `queued` 只占任务级 actionable 位置；`running` 是已 claim 的业务生命周期而非槽位计数。无论 Platform 状态为何，只有 Gateway `active | unknown` lease 才占共享 Provider 槽；覆盖 running-before-submit、active-call、跨事务崩溃恢复和 confirmed-zero `running → queued`；
- 显式重新生成增加 1 次；
- 已确认 429 同 generation 有界重挂；
- result unknown 不自动重发；
- result unknown 阻止新 generation；除本地准入/可证明零 completion 的 429 外，终态失败重试必须使用新 generation 并计入 `G`；
- `succeeded_unapplied` 的应用/放弃均为 0 次 completion，使用现有 generation ID 和 generation revision，状态分别进入 `succeeded` / `discarded`；
- AI 文本冲突候选展示“替换当前 AI 文本并应用”及覆盖说明；确认后 `aiTextEditRevision` 再变化时 CAS 拒绝、候选保持未应用且教师文本不丢失；
- 来源删除把 queued/running/result-unknown/unapplied run 置为 `invalidated`，释放任务锁但不释放尚在执行的全局 Provider 槽；迟到返回无法写回、复活候选或恢复删除内容；
- 已应用 `succeeded` run 遇来源删除仍保留安全审计终态，report 进入 `ai_removed`；它不得被误转为可重新应用的 `invalidated` 候选；
- 鉴权/余额/权限错误暂停；
- 与逐篇队列共享硬并发上限。

### 报告生命周期

- 生成前从单篇加入教师问题会创建/复用 draft workspace；CTA 按已应用 AI generation 而不是 report 行存在判断；
- 初次失败不产生半份 AI 内容，但保留 draft、教师问题、教师证据、精选素材和顺序；
- 重新生成失败保留旧报告；
- 教师内容跨重新生成保留，但教师主动移除、最后一个教师来源删除、任务删除或另行批准的数据保留政策除外；
- 幸存 AI topic 保持位置；
- 新 AI topic 追加；
- AI/教师 topic 重复时教师优先；
- `topic-key-v1` 精确成员稳定、单成员组合直接等于 atomic key、成员变化、hash 碰撞和跨 generation 位置规则；
- 教师项吸收系统 topic 后，两类 evidence 仍能独立替换、保留和删除，人数按合法引用并集去重；
- 主动移出最后一个教师来源且系统 variant 仍合法时，卡片在原位置恢复为 AI 文案/标签/按钮状态；系统 variant 不合法或已因来源删除失效时删除卡片；
- 来源入口只能显示绑定的精确历史 result revision；revision 不存在时明确显示不可用，绝不跳到当前结果冒充旧证据；
- 教师编辑 AI 文本后的重新生成确认和覆盖；
- AI 总结处于编辑态或存在未保存 draft 时不能触发重新生成，保存/取消后才按已持久化编辑状态决定是否确认；
- AI 文本编辑标记不被排序/移出误触发；生成期间教师排序/添加可事务合并，跨标签 AI 文本冲突落入 `succeeded_unapplied` 且零新增调用；
- `issueOrder` 是唯一顺序真源，不存在 block order 分叉；
- 排序 revision 冲突安全处理；
- 刷新后重挂生成状态和恢复报告。

### 页面与无障碍

- 队列 settled 与最终失败不阻断；
- 有效成功作文不足 2 篇；
- 单页信息架构无 mock 内容；
- 单篇加入/移出切换；
- draft workspace 已存在但尚无已应用 AI generation 时，仍展示唯一“生成班级总结”主操作；
- 待应用候选只展示应用/放弃路径，不出现新的生成按钮；
- `待应用候选 > active generation > 已应用报告 > 首次生成资格 > 等待/不足` 的主操作优先级在旧报告与重新生成并存时仍唯一；
- 从无本地 generation ID 的全新页面加载也能通过 `currentGeneration` 恢复轮询或 apply/discard；
- AI 文本冲突候选的应用文案、确认对话框、revision 再冲突和教师文本保留；
- 来源精确定位和返回位置恢复；
- 拖拽、移动端菜单和键盘上移/下移；
- `aria-live` 排序反馈；
- 移出导致卡片消失时焦点进入可见撤销，撤销后恢复原卡片；mixed→AI 使按钮消失时焦点进入问题标题，并分别播报状态；
- 生成中/成功/失败/result-unknown 状态播报；
- 重新生成确认对话框的命名、焦点圈、Escape 和焦点返回；
- 来源往返后的键盘焦点恢复、无 hover-only 操作和约 44×44 px 触控目标；
- 重新生成成本提示；
- 桌面 `1440×900` 与移动端 `390×844` 无横向溢出和不可达操作。

### 安全与权限

- 未授权、只读角色和跨租户访问拒绝；
- opaque ID，不含原句或姓名；
- Prompt、日志和错误响应不含个人信息、全文、图片、材料和原始 Provider 响应；
- 内容级脱敏覆盖植入的学生/教师/班级/任务名称、邮箱、手机号、学号、URL、人名实体和提示注入文本；无法安全清除时省略片段并降低覆盖计数；
- 来源删除后的级联或脱敏；
- 单篇删除清除相关 AI 派生内容且不自动重生成；
- 删除期间在途/结果未知/待应用候选全部失效，迟到 Provider 结果不能恢复内容；
- 任务删除级联；未结 lease 使删除回执保持 `pending_provider_settlement`，可信结算后的 final purge 才删除 execution key/payload hash 并完成回执。

### 回归

- N 篇首次批改仍对应 N 次独立多模态 completion；
- 不改变 `multimodal-grading-request-v2`、`grading-result-v2` 或 `POST /grading/grade-images`；
- 不新增 OCR 状态、OCR 请求或 OCR 降级；
- 评分标准单次 completion 和既有有界并发、幂等、usage 观测保持通过。

## 验收标准

功能实现只有同时满足以下条件才能宣称本地功能完成：

1. 所有用户批准的门槛、明确拼写、快照、编辑、排序和重新生成规则都有自动化测试。
2. 首次班级总结的正常 Provider 调用数为 1，重复提交为 0 次新增调用。
3. Provider 输入不含禁止字段，输出不重复服务端可回填内容；任何已发送的班级请求都通过 16,384 prompt-token 硬门槛，超限输入在 Provider 前 0 调用失败。
4. 真实页面不再展示静态 mock 班级洞察。
5. 单篇主流程和 v2 合同无回归，OCR 仍不参与。
6. fake/loopback 验收覆盖成功、空共性、部分失败、429、鉴权暂停、result unknown 和重新生成失败。
7. 真实 Kimi 验收在单独确认样本、调用数和费用后进行，不能由 fake 结果代替。

只有在持久任务仓库、教师身份/租户权限、数据保留政策和刷新恢复全部落地后，才允许宣称该功能达到商业发布条件。在此之前，应准确表述为“已实现并验证的本地功能原型”。

## 后续实施顺序

不得把班级页面改造与完整账号/租户/数据库基础设施塞进一个不可审查的大实施计划。后续拆成三个有独立验收门的工作包：

1. **本地功能原型计划**：纯函数聚合、字段覆盖、严格三层合同、fake synthesis、单进程原型 registry、单页班级总览、单篇加入切换、编辑/排序、脱敏器、telemetry 与 fake/loopback 验收；不改逐篇合同，并在界面/文档明确“本地原型，不用于真实班级长期保存”。
2. **商业基础设施独立计划**：认证教师/租户/任务授权、权威任务服务、持久 repository、事务 generation registry、Gateway 持久执行/结果 registry、任务级 actionable 唯一约束、删除级联/final purge、保留政策和多实例共享准入。该计划需要单独架构评审，不能作为原型计划中的附带任务。
3. **集成与发布计划**：把原型接口替换为权威任务服务，完成跨刷新/多设备/权限/删除/并发恢复验收；随后在用户另行确认样本、调用数和费用后执行真实 Kimi 班级总结 smoke，记录 usage、延迟和结构化成功证据，再进行商业发布评审。
