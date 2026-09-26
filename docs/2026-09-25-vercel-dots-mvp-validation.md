# Vercel + Dots3 MVP 验证记录

结论：Supabase 和公网认证已恢复，OpenRouter 后端挂载已部署；Dots3 尚未返回通过产品核心评分校验的结果，当前不具备教师可用的批改 MVP。

## 部署与恢复

- Supabase 原项目暂停，恢复后控制台显示 Healthy；没有重置数据库、账号、密码或连接配置。
- 实际部署源为 `.worktrees/codex-teacher-pilot-accounts` / `codex/teacher-pilot-accounts`。
- 当前应用提交 `3c59692`，Production `dpl_85rkJ2Y9BoYTD3D4XMQHWz2TQZEB`，Ready，构建 57 秒。
- 正式地址：https://wenjie-writewise-pilot.vercel.app 。账号站点正常；生产前端仍未开放批改入口。

## 受控模型调用记录

全部使用合成材料，免费模型 `dots-studio/dots-3-note-preview:free`，无付费回退，无独立 OCR，不增加隐藏式模型修复。表中未知预留也计入本轮 5 次预算。

| 次序 | 日期 | 路径 | 结果 |
| --- | --- | --- | --- |
| 1 | 09-23 | 本地 rubric | 约 154 秒，provider_invalid_response；没有可用 rubric |
| 2 | 09-23 | 本地双图批改 | 账本存在预留但无终态；按结果未知处理，不重发 |
| 3 | 09-24 | 公网单图批改 | 78.6 秒，HTTP 503 / provider_invalid_response；当时未配置阶段诊断 |
| 4 | 09-24 | 本地单图诊断 | 158.7 秒，HTTP 200 上游响应，finish_reason=length；16,384 completion tokens，其中 9,159 reasoning tokens；JSON 被截断，费用 0 |
| 5 | 09-25 | 调整后的公网单图 | 16.8 秒，HTTP 503 / provider_invalid_response；日志为 normalization / dimension_scores |

第 4 次诊断开始时曾遇到沙箱出站拒绝；网关将其判定为 confirmed、0 attempt observation，确认没有请求发出后才以联网许可执行。该本地拒绝不增加模型调用数。

第 5 次公网请求于 2026-09-25 10:13 UTC 完成。登录和 session 均 200；无效批改请求为 400 invalid_request；退出 204，退出后原会话 401。该流程测试脚本以 exit 1 结束，准确反映批改失败。

## 本次调整与证据边界

- Dots3 请求单独加入 `reasoning.enabled=false`，将输出额度用于最终结果；保留 16,384 上限。其他可替换免费模型不会继承此参数。
- Vercel 增加现有安全诊断输出，只记录固定阶段与静态错误码，不输出密钥、正文、图片、提示词或上游原始响应。
- 第 5 次调用进入评分结果归一化阶段，因此本次没有在截断/JSON 解析阶段失败。`dimension_scores` 表示核心维度数据不可用；没有原始数据证据判断究竟是缺项、重复/错误维度身份还是分数越界。
- 没有把非法分数自动截到范围内、把 100 分制猜测换算到当前满分、补造缺失维度，或追加模型请求修补结果。
- 本轮预算已全部使用或预留。再次调用模型需明确新的测试范围与调用预算；旧结果未知记录不能因换日期而清除。

## 自动验证

- OpenRouter 针对性测试 23 项通过，先见证缺少 Dots 推理参数的测试失败，再修复并通过。
- 平台 API 全量 10 文件 / 39 项通过。
- 平台类型检查发现已有测试把 RequestHandler 直接传入 supertest 的类型问题；改为挂载到 Express 应用后，相关 2 项测试和平台类型检查通过。
- Gateway 类型检查、根目录部署类型检查和生产构建通过；`git diff --check` 通过。
- 以上不能替代真实评分质量、并发吞吐和教师设备验收。

## 下一步

建议更换免费多模态模型，再执行小批量合成验收。OpenRouter 官方模型页在 2026-09-24 标注当前 Dots3 免费端点将于 2026-09-30 下线：https://openrouter.ai/dots-studio/dots-3-note-preview%3Afree 。

任务、图片、结果持久化、后台执行、跨实例幂等和共享并发仍未完成；当前单实例并发 1 不能表述为全站共享并发 1。没有执行 30 账号、每班 50 人的吞吐验证，也没有使用真实学生材料。

密钥轮换尚未收到用户完成确认。所有私密凭据和一次性调用账本保留在 Git ignored 目录，不写入本文。
