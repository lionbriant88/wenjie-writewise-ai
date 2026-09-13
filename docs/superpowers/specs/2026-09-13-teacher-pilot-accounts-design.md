# 教师试用账号与登录管理

2026-09-13 修订：用户已要求先完成可部署代码和初始化工具；云项目尚未创建。本版取代随机初始密码、首次改密和腾讯云草案。

## 本轮交付

30 名教师和 1 名独立账号管理员的幂等初始化工具；登录、退出、跨实例持久会话、管理员查看/备注/启停账号；Vercel 部署配置、Supabase PostgreSQL 迁移、本地验收和使用说明。

所有账号初始密码为用户指定的 `888888`，不得修改。不建设注册、改密、找回密码、密码重置 API 或页面。初始化从环境输入约定密码，保存逐账号独立盐的 scrypt 哈希，不在生产代码硬编码明文。数据库触发器拒绝更新已有密码哈希。

统一固定密码意味着账号名泄露后，别人即可登录该账号。因此账号名采用 `wj_` 加 24 位随机十六进制字符；管理员也是独立随机账号名，不公开目录。显示名默认为“教师01”至“教师30”，管理员为“账号管理员”。分发清单为 ignored 私密文件，管理员行单独保存。这不能把统一密码变成强认证。

## 托管与身份

Vercel 部署 React 与 Node API；Supabase PostgreSQL 保存本站账号和会话。服务端使用受限数据库角色及 transaction pooler，不把数据库凭据或 service key 交给浏览器。

使用本站 opaque HttpOnly session，不创建 Supabase Auth 用户或发出其 token。Supabase 默认允许已登录用户更新密码，隐藏按钮不能满足禁改密。表位于不暴露给 Data API 的 `pilot_auth` schema，撤销 PUBLIC 权限；运行角色只能读账号、更新 display_name/status/session_version/last_login_at，以及操作会话/限速/审计表，不得插入账号或更新 password_hash。迁移和种子使用单独管理连接。

Node 异步 scrypt：N=32768、r=8、p=3、64字节结果、独立16字节盐、maxmem至少64MiB；并发校验最多2个，超额429。未知账号做同成本比较；登录失败不区分账号不存在、停用或密码错误。

生产缺少 DATABASE_URL、APP_ORIGIN 或 AUTH_RATE_LIMIT_SECRET 时 fail closed；不自动建表/种子，不降级内存。本地用 PGlite 执行真实 PostgreSQL 迁移与查询；显式 local 模式可提供演示服务，生产禁止它。PGlite 验收不等于 Supabase 联机验收。

## API 合同

前缀 `/api`，错误 `{error:{code:string,message:string}}`。敏感响应 no-store，不输出 hash、token、数据库原始错误或环境值。

`PublicUser = {id:string, username:string, displayName:string, role:'teacher'|'admin', status:'active'|'disabled', lastLoginAt:string|null}`。

- `POST /api/auth/login`：输入 `{username,password}`；成功 `{user,csrfToken}`，设置 cookie。
- `GET /api/auth/session`：成功 `{user,csrfToken}`；未登录/停用/过期401。
- `POST /api/auth/logout`：CSRF + Origin，撤销会话、清cookie，204。
- `GET /api/admin/accounts`：仅有效管理员，`{accounts:PublicUser[]}`。
- `PATCH /api/admin/accounts/:id`：仅有效管理员，CSRF + Origin，输入 `{status?,displayName?}`，`{account:PublicUser}`；拒绝额外字段，包括password/passwordHash/role。
- 对 `/api/auth/change-password`、`/api/auth/reset-password`、`/api/auth/register` 写请求返回403 `operation_not_allowed`；未知API为JSON404。
- `/api/grading/*`、`/api/tasks/*` 固定503 `pilot_grading_not_configured`，本版本不转发匿名Gateway或发起Provider调用。

创建session原子核对active与session_version，防止校验密码期间被停用仍能创建会话。cookie随机32字节，数据库仅SHA-256；CSRF可由session token的HMAC确定性派生。教师7天绝对/24小时闲置；管理员12小时绝对/30分钟闲置。生产cookie为 `__Host-wj_session; Secure; HttpOnly; SameSite=Lax; Path=/`；loopback HTTP用独立开发cookie。

写请求精确检查APP_ORIGIN，已认证写操作另查CSRF；登录查Origin。仅明确Vercel运行环境采用可信代理来源头，本地忽略X-Forwarded-For。持久限速按账号摘要8次/15分钟、来源摘要60次/15分钟；实例共享限速桶，过期清理有界。管理操作写审计；停用事务撤销会话并递增版本，不能停用最后一个有效管理员。

## 网页

默认必须认证，API不可达时给出服务暂不可用和重试，不放行。只在 `import.meta.env.DEV` 且显式 `VITE_AUTH_MODE=local-demo` 时保留原本演示；生产忽略旁路。

新增登录页、账号状态页、管理员账号页；不预填密码。管理员可搜索、备注、启用/停用，不提供改密/重置。教师看不到账号目录或管理员凭据。

本轮登录后显示“账号已就绪，作文批改暂未开放”；云端账号不挂载现有含演示任务的AppState，不进入尚无持久化的作文上传。旧业务只在明确本地演示模式保留。账号模块可以部署验证，但不声称OpenRouter和云端作文功能已接通。

退出/401/切换账号清除私有视图、缓存和迟到回调；标签页用BroadcastChannel或无敏感storage事件同步失效，恢复焦点时重新验证会话。CSRF不写localStorage。桌面、移动端和键盘操作需浏览器验收。

## 初始化

CLI分prepare/apply：prepare生成随机账号manifest与逐账号哈希；apply用管理连接在一事务应用固定批次。恰好30教师+1管理员，批次绑定manifest摘要；相同文件重放不改行，摘要不同拒绝，不能重复重置密码。

prepare检查输出为repo ignored `local-private-accounts/` 内路径，不覆盖现有文件；从环境读约定初始密码，输出manifest、教师TSV和单独管理员文件。manifest不含明文密码，TSV属于私密凭据。apply失败回滚，日志仅报告数量；文件标明待云端应用。工具不自动读取历史Kimi环境、学生材料或创建云项目。

支持显式local PGlite演示，线上必须用Supabase PostgreSQL。对实际本地31账号逐一验证登录、退出和禁改密，重放行数不变，重启后账号/session/停用可恢复。云项目创建后再迁移、apply和逐一验收，届时才称云端有效账号。

## 后续真实试用边界

已选Vercel + Supabase + OpenRouter免费多模态；模型尚未选择和验收，本轮不发completion。Kimi保留为历史本地实现。保留一次多模态识别/评分/反馈、无独立OCR、外部v2、教师确认、单次rubric、有界并发和未知结果不盲目重试。

以后固定支持image和strict JSON Schema的免费模型，保留本地Schema校验，不随机轮换模型、不自动付费降级。免费额度是OpenRouter账户共享，不能按教师数复制。

当前Vercel Hobby最长300秒/请求体4.5MB，与既有360秒/多图multipart不一致。后续原图直传Supabase私有Storage、小元数据入持久任务，另行完成时限适配、后台执行、持久幂等/共享准入、教师资源归属和数据保存/删除规则。账号交付不包含这些尚未实施的保证。

官方来源（2026-09-13）：[Supabase连接](https://supabase.com/docs/guides/database/connecting-to-postgres)、[Supabase密码更新](https://supabase.com/docs/guides/auth/password-security)、[Vercel限制](https://vercel.com/docs/functions/limitations)、[OpenRouter免费额度](https://openrouter.ai/docs/faq)、[结构化输出](https://openrouter.ai/docs/guides/features/structured-outputs)。
