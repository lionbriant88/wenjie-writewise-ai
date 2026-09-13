# Vercel 账号站点部署与公网验证

2026-09-13。正式账号地址：[文阶教师试用](https://wenjie-writewise-pilot.vercel.app)。本记录仅涵盖账号登录与管理；作文批改暂未开放。

## 实际部署

- Vercel Hobby 项目：`wenjie-writewise-pilot`，project ID `prj_q5UwSa3JPak99V4aewaLWG8vDeSo`。
- 仓库：`lionbriant88/wenjie-writewise-ai`。GitHub App 安装 ID `161362709` 已核实只授权该仓库。
- Production Branch Tracking：`codex/teacher-pilot-accounts`；部署提交 `868f3a6` 已推送 GitHub。
- 首个 Production 部署：`dpl_7keMWVgjkNfw9bM6xa8JPmaDQC8f`，33 秒完成，状态 Ready。
- 正式域名：`wenjie-writewise-pilot.vercel.app`；原 `project-6tamb.vercel.app` 保留 307 跳转。
- 框架 Vite、Node 24、Root Directory 使用仓库根目录；仓库配置为 `regions: ["sin1"]`、`maxDuration: 30`。
- 项目数据用于模型训练的选项已关闭，界面保存成功。

用户已明确授权保存运行配置。`DATABASE_URL`、`AUTH_RATE_LIMIT_SECRET`、`DATABASE_CA_CERT`、`APP_ORIGIN` 四项均作为 Production Secret 保存并在界面核实；`APP_ORIGIN` 为 `https://wenjie-writewise-pilot.vercel.app`。本文不保存数据库连接串、密码、会话 cookie 或其他秘密值。

## 正式 HTTPS 验证

验证脚本只访问指定正式 HTTPS origin，不跟随重定向，最多登录一名教师和一名管理员；日志仅记录计数和结果。初次受沙箱网络限制，在 `public_routing` 阶段失败，登录次数为 0；取得联网许可后执行通过，退出码为 0。

| 验证项 | 实际结果 |
| --- | --- |
| 教师、管理员登录 | 共 2 次通过 |
| 读取当前 session | 共 2 次通过 |
| 退出及旧 session 撤销 | 各 2 次通过 |
| 缺 CSRF 或错误 Origin | 共 4 次拒绝 |
| 教师访问管理员目录 | HTTP 403 |
| 管理员目录 | 31 个账号，身份与原 manifest 一致 |
| 停用最后一名有效管理员 | HTTP 409 |
| 修改密码、重置密码、注册 | 两账号共 6 次 HTTP 403 |
| 未知 API | 共 2 次 JSON HTTP 404 |
| 批改入口 | HTTP 503，批改暂未开放 |
| 脚本会话清理 | `cleanupComplete: true` |

脚本在登录请求发出前记录未确认状态；断连或无可用 cookie 不会误报清理成功，也不会自动重登。已获得的会话 cookie 会在响应状态检查前登记，失败路径仍尝试撤销；存在未知登录或未确认撤销时必须报告需要会话检查。本次成功执行报告清理完成。

## 浏览器与验证范围

正式站点已完成以下浏览器验证：教师登录成功，刷新后仍显示账号已就绪和退出按钮，退出后返回登录页；管理员登录后显示 31 张账号卡片，搜索“教师01”仅显示 1 张，刷新后账号管理标题恢复，随后退出并确认返回登录页。两个浏览器测试会话均正常退出。本轮未在公网 UI 修改显示名或启停账号。

这次公网脚本验证了 2 个代表账号。此前全部 31 个账号通过的是连接真实 Supabase 数据库的本地 loopback API 分段验证，详见 [Supabase 账号验证](2026-09-13-supabase-account-validation.md)；两类证据不能互换，也不能声称 31 个账号已在公网逐一验收或单次 6 分钟运行全部成功。

账号站点部署不包含以下尚未完成的能力或结论：

- OpenRouter 免费多模态模型选定、接入、结构化输出及真实评分质量验收；本轮未发起真实模型调用。
- 按教师归属持久保存任务、原图、结果及删除/保留规则。
- 适配平台时限的后台执行、持久幂等、共享有界并发与真实多连接饱和验证。
- 教师所在地网络、手机摄像头及真实设备体验验收。

生产页面只开放账号登录和管理，并明确作文批改暂未开放。后续保持一次直接多模态识别/评分/反馈、外部 v2 合同与教师确认；不恢复独立 OCR，不自动转付费模型，真实材料与调用范围仍需另行确认。
