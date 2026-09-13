# Supabase 账号联机验收记录

日期：2026-09-13。代码分支：`codex/teacher-pilot-accounts`。本次仅配置账号数据库，不调用模型或传输学生材料。

## 已建立的云端配置

- Free 项目 `wenjie-writewise-pilot`，ref `wudbhdyqgnbnuorebhnu`，新加坡 `ap-southeast-1`，PostgreSQL 17.6。
- 管理端使用 Dashboard 给出的 shared session pooler；网站使用 shared transaction pooler。客户端使用 Dashboard 官方 CA 严格校验证书，不关闭 TLS 验证。
- 私有 `pilot_auth` schema 包含 6 张表。Supabase Auth 公开注册关闭，匿名登录关闭，新表自动公开关闭；Data API 显示 0/6 张表及 0/2 个函数公开。
- `wj_auth_runtime` 为 NOLOGIN 权限组；`wj_auth_server` 为独立受限 LOGIN。实际核对无超级用户、创建数据库、创建角色或绕过 RLS 权限，不能新增/删除账号、修改密码或角色；运行连接实际 `statement_timeout` 为 10 秒。
- 私有表采用服务端 SQL 权限和应用鉴权，未启用行策略；`anon`/`authenticated` 对该 schema 无 USAGE。不能将这组私有账号表直接开放给浏览器访问。
- 已复用原私密 manifest 导入 30 名教师和 1 名管理员，全部 active；相同批次再次 apply 返回 replayed，不新增账号或重置密码。

## 实际验证证据

| 验证 | 结果 |
| --- | --- |
| 原 manifest 与云端账号身份、角色、密码哈希一致 | 31/31 |
| 真实数据库支持的 HTTP 登录、会话读取、退出、旧会话拒绝 | 每项 31/31 |
| 教师访问管理员名单 | 30 次均返回 403 |
| 改密、重置、注册写接口 | 93 次均拒绝 |
| 管理员名单 | 恰好 30 名教师和 1 名管理员 |
| 停用最后一个管理员 | 409，未停用 |
| 停用教师、重新启用、旧会话保持失效 | 通过；整个探针强制回滚 |
| 受限数据库角色尝试修改密码 | SQL 权限拒绝 |
| 数据库管理角色尝试修改密码 | `immutable_password` 触发器拒绝 |
| 探针后的账号字段 | 完全不变，全部 active |
| 最终剩余测试会话 | 0 |

HTTP 验证通过本机明确绑定 `127.0.0.1` 的 Express 服务和真实 Supabase 数据库完成，HTTPS origin 仅用于请求策略验证。第一段在完成 28 个完整账号循环后达到验证工具的 6 分钟总上限，停在下一账号登录阶段；随后实际确认数据库无残留会话。第二段按同一固定账号顺序跳过已验证的 28 个账号，完成最后 3 个，最终对全部 31 个账号再次核对身份和不可变字段。不能把这两段合并描述为一次未中断的完整通过；单个请求未改变其超时和鉴权规则。

首次重设数据库密码后曾出现连接池凭据更新延迟，后续 session/transaction 连接均恢复。未通过连续重设、关闭证书校验或更改教师密码绕过问题。参见 [Supabase 密码更新后的连接池行为](https://supabase.com/docs/guides/troubleshooting/supavisor-error-password-authentication-failed-after-password-rotation)。

## 私密文件和下一步

`local-private-accounts/pilot-batch/teachers.tsv` 是教师分发清单；`administrator.tsv` 单独保管。原 manifest 应继续保存，不能重新 prepare 一份不同批次替换。

`local-private-accounts/supabase-setup/vercel-runtime-env.json` 已准备数据库运行连接、CA 和稳定限流秘密值，不包含数据库管理连接或教师初始密码；目录受 Git 忽略。Vercel 的 `APP_ORIGIN` 待实际网站域名确定后填写。

Vercel 账号函数已配置单一 `sin1` 区域及 30 秒执行上限，根目录部署类型检查通过。地域应靠近数据库，配置方法见 [Vercel Function 区域](https://vercel.com/docs/functions/configuring-functions/region)。

Vercel 项目尚未创建或部署，公网 HTTPS 登录、Cookie、依赖打包、真实教师网络/设备和多连接容量尚未验收。登录后仍仅开放账号功能，作文持久化、后台任务、共享并发与 OpenRouter 免费多模态模型尚未接通。
