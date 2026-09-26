# DeepSeek 官方直连：本地验证与 Vercel 切换准备

## 当前结论

官方 `deepseek-flash` 已通过本地 Gateway 单张合成图片验证：HTTP 200、`grading-result-v2`，正文识别与分数可用，结果为 `partial`、仍需教师复核。当前没有发布线上变更，Vercel 生产前端仍仅开放登录和账号管理。

此证据只说明一个合成样本的接口闭环可用，不证明真实手写质量、评分合理性、30 位教师的批量吞吐或云端持久化已经验收。

## 适配行为

- 仅调用 `https://api.deepseek.com/chat/completions`，固定允许 `deepseek-flash`，拒绝重定向；密钥不进入浏览器。
- 官方 Chat Completions 使用 `thinking: { type: "disabled" }`、`max_tokens` 和 `response_format: { type: "json_object" }`。现有输出 Schema 放入系统提示，模型返回仍必须通过 Gateway 原有校验。
- 一篇作文的所有图片保序进入一次请求；教师确认文本重批发送零图片；评分标准正常生成只一次请求。没有 OCR 或隐式修复 completion。
- 配置不合法或 DeepSeek 密钥缺失时停止，不使用 OpenRouter/Kimi/mock 回退。OpenRouter 历史适配保留供回归。
- 本地与 Vercel 模板的单进程 Provider 并发为 1；Vercel 多实例的全站共享准入尚未实现。

## 2026-09-25 受控测试

用户授权最多 3 次合成图片 completion、累计不超过 USD 0.10。仅使用仓库合成 fixture `grammar-and-logic.png`，没有真实学生材料。全部调用账本保存在 ignored 私密目录，不提交原始 Provider 响应、正文或密钥。

| 次数 | 耗时 | 结果 | 输入 / 输出 token |
| --- | --- | --- | --- |
| 1 | 4.101 秒 | HTTP 503 / normalization `dimension_scores` | 4252 / 984 |
| 2 | 3.754 秒 | 同样失败；脱敏数值诊断确认卷面返回 5，超过 0.75 | 4252 / 868 |
| 3 | 4.664 秒 | HTTP 200 / `partial`，正文匹配且页眉排除，分数 8/15 | 4357 / 1143 |

修复在 canonical 上下文中加入由共享评分函数算出的每维 `maxScore`，明确 `weight` 是百分比、`score` 是实际分数。内部上下文版本升级到 `model-task-context-v2`，缓存/幂等摘要因此随上下文变更；外部 v2 合同不变。没有夹取超限分数或放宽有效维度集合。

第三次维度值为内容 7.12/14.25、卷面 0.75/0.75，合计按现有整数规则显示 8/15。只保留这些合成测试数值和静态诊断，不保存 Provider 原始内容。

余额显示 9.73 → 9.71 元（余额精度只支持此差额结论）。按高峰、完全不命中缓存的人民币单价估算，三次已知 token 的总费用上限为 0.049682 元；实际有缓存及非高峰折扣。该上限是价格计算，不是精确账单。

一次性程序会在发请求前原子预留次数和保守 token 费用，累计同时限制 USD 0.10、CNY 0.60。只有已知且有界的实际 token 使用量可结算预留，未知请求继续占满预留；同一 case 和第 4 次调用均被拒绝。现有授权已耗尽，不能换日期、删账本或改 case 绕过。

## 自动化验证

- Gateway 全量：55 文件，1385 项通过。
- 平台 API 全量：10 文件，41 项通过。
- Gateway、平台 API 类型检查与根目录生产构建通过。
- 新回归覆盖官方请求形状、图片顺序、单次调用、密钥隔离、错误/未知结果处理、健康状态、权重与实际分值、次数及费用预留。
- 独立复核提出的预算账本一致性、已知用量越界和日志类型问题均已修复，并有修复前失败、修复后通过的回归证据；复核闭环无剩余问题。全量测试中另定位并消除了旧延迟结算测试的固定计时竞态，改用显式完成信号，产品逻辑未变。

## 已授权的 Vercel 切换

目标项目 `wenjie-writewise-pilot`，Production 分支 `codex/teacher-pilot-accounts`，正式域名 `https://wenjie-writewise-pilot.vercel.app`。

| Production 服务端变量 | 值或来源 |
| --- | --- |
| `GRADING_PROVIDER` | `deepseek` |
| `DEEPSEEK_API_KEY` | 用户已保存的 ignored `.env.deepseek.local`，以 Secret 保存，不回显 |
| `DEEPSEEK_API_BASE` | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | `deepseek-flash` |
| `DEEPSEEK_MAX_COMPLETION_TOKENS` | `16384` |

数据库和账号变量保持原值。新代码要求明确设置 Provider，缺失时批改接口保持未配置，即使保留旧 OpenRouter key 也不会被默认选用；部署前确认密钥、Provider 与代码在同次新部署中生效。不要通过浏览器查看已填密钥值来验证保存。

2026-09-26 用户在明确的 Secret 保存、部署及线上合成测试请求后回复“无费用限制”。本轮继续该项切换和必要合成验证，不再使用旧金额上限，不扩大到真实学生材料、其他模型或充值/订阅。旧三次账本保持历史原样，本次使用独立一次性验证记录。

五项变量已在 Vercel 界面确认保存为 Production Secret。准备推送已验收代码，再验证登录、Origin/会话保护、无效请求、一次合成图片批改及退出；失败或结果未知均不盲目重发。

尚未完成的教师端页面、Supabase 任务/图片/结果保存、后台队列、跨实例幂等和共享并发仍须后续实现；本次后端切换不会自动开放完整教师测试流程。

## 官方依据（2026-09-25 核对）

- [图像输入](https://api-docs.deepseek.com/guides/vision/)
- [Chat Completions 参数](https://api-docs.deepseek.com/api/create-chat-completion/)
- [JSON Output](https://api-docs.deepseek.com/guides/json_mode/)
- [思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)
- [人民币价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)、[美元价格](https://api-docs.deepseek.com/quick_start/pricing/)
- [只读余额](https://api-docs.deepseek.com/api/get-user-balance/)
