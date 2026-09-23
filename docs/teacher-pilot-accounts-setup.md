# 教师试用账号：部署与初始化

本版本提供账号登录和管理，并已加入受保护的 OpenRouter Dots3 免费模型 MVP 批改入口。当前只支持一份已确认评分标准和单张合成或已授权图片的受控测试；任务、图片、结果持久化和后台队列尚未完成。项目尚未创建时，本地验证不代表 Supabase 账号已创建。

本次账号站点已部署为 [文阶教师试用](https://wenjie-writewise-pilot.vercel.app)，实际范围和公网验证见 [Vercel 账号验证记录](2026-09-13-vercel-account-validation.md)。以下初始化步骤用于维护与复现，现有账号无需重新生成。

## 使用约定

- 30 名教师，另有 1 名账号管理员。账号名随机生成，不采用可连续猜测的编号。
- 初始密码按用户要求统一为 `888888`，禁止修改；没有注册、改密、找回或重置密码功能。
- 管理员可查看账号、修改显示名和启用/停用账号，不能读取已有密码哈希或修改密码。
- 教师清单和管理员凭据分开保管，不向老师发送管理员文件。统一密码下，知道账号名就可以登录，请逐人分发账号名。

## 工程位置和安装

使用 `codex/teacher-pilot-accounts` 分支的仓库根目录，不要把旧 `main` 或单独的 `app` 目录当作这次完整部署来源。

```powershell
npm.cmd ci --prefix platform-api
npm.cmd ci --prefix grading-gateway
npm.cmd ci --prefix app
npm.cmd run build
```

Node 使用 24.x。前端没有数据库凭据，不需要 Supabase anon key 或 service-role key。本站身份保存在 Supabase PostgreSQL 的私有 schema；浏览器通过 Vercel 同源 API 使用 HttpOnly cookie，不直接使用 Supabase Auth。

## 先在本地验证

在仓库根目录的当前 PowerShell 窗口显式配置本地存储：

```powershell
$env:AUTH_STORAGE = 'local'
$env:AUTH_LOCAL_PATH = (Join-Path (Get-Location) 'local-private-accounts/local-db')
$env:APP_ORIGIN = 'http://127.0.0.1:5177'
$env:PORT = '8793'
$env:PILOT_INITIAL_PASSWORD = '888888'
$pilotBytes = New-Object byte[] 32
$pilotRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$pilotRng.GetBytes($pilotBytes)
$env:AUTH_RATE_LIMIT_SECRET = [Convert]::ToBase64String($pilotBytes)
$pilotRng.Dispose()
```

此代码块将秘密值放在当前进程环境中。若需跨服务重启保持会话，请把生成的 `AUTH_RATE_LIMIT_SECRET` 保存到 ignored 本地环境，并在启动时复用；不要输出到日志或提交 Git。初始化完毕可移除 `PILOT_INITIAL_PASSWORD` 环境变量，运行服务无需它。

```powershell
npm.cmd run db:migrate
npm.cmd run accounts:prepare -- --out local-private-accounts/pilot-batch
npm.cmd run accounts:apply -- --manifest local-private-accounts/pilot-batch/manifest.json
```

`prepare` 只准备文件；`apply` 才将清单写入所选数据库。相同清单可重复应用，不增加账号、不重置密码；已经存在的输出目录不可覆盖。切勿重新 prepare 一份不同清单替代已经分发的批次。

平台开发服务使用 `npm.cmd --prefix platform-api run dev`，网页使用 `npm.cmd --prefix app run dev -- --host 127.0.0.1 --port 5177`。Vite 的 `/api` 代理指向 `127.0.0.1:8793`，网页端口必须与 `APP_ORIGIN` 完全相同，不能混用 localhost 和 127.0.0.1。

本地数据库持久化在 ignored 路径；删除它会删除本地账号和会话。PGlite 仅用于开发/测试，不能部署到 Vercel 充当在线数据库。

## 创建 Supabase 后

1. 创建项目，记录项目地域和实际数据库连接配置。账号模块不要求开启 Supabase Auth 的公开注册，也不会在 `auth.users` 创建教师。
2. 从 Dashboard 的 Connect 获取管理连接。迁移使用 direct/session pooler；Vercel 运行使用 transaction pooler。不要根据地域拼接 pooler 域名。
3. 将管理连接放入本地 `DATABASE_ADMIN_URL`，移除 `AUTH_STORAGE=local` 和 `AUTH_LOCAL_PATH`，运行迁移；不要将管理连接配置成网页 `VITE_*` 变量。

```powershell
Remove-Item Env:AUTH_STORAGE -ErrorAction SilentlyContinue
Remove-Item Env:AUTH_LOCAL_PATH -ErrorAction SilentlyContinue
npm.cmd run db:migrate
```

4. 迁移创建 `pilot_auth` schema 和 NOLOGIN 权限角色 `wj_auth_runtime`。通过 Supabase SQL Editor 创建单独的 LOGIN 用户，授予 `wj_auth_runtime`，密码从私密配置中设置。此用户不能是 postgres、表所有者或具有 SUPERUSER/BYPASSRLS 的角色，不授予管理权限。运行用户不得更新密码字段或创建账号。

```sql
-- 仅在私密 SQL Editor 中替换数据库密码占位符；这不是教师登录密码。
CREATE ROLE wj_auth_server LOGIN INHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '<独立随机数据库密码>';
GRANT wj_auth_runtime TO wj_auth_server;
GRANT CONNECT ON DATABASE postgres TO wj_auth_server;
ALTER ROLE wj_auth_server SET statement_timeout = '10s';
```

运行服务会检查数据库用户权限；误用管理连接或额外授予账号创建/改密权限时，会拒绝启动。

数据库密码建议使用至少 32 字节随机值的十六进制编码，便于安全粘贴。若使用其他字符集，SQL 字符串里的单引号必须写为两个单引号；连接 URI 中的密码必须 percent-encode，不能把原始特殊字符直接拼入 URI。
5. 将已有 `manifest.json` 应用到 Supabase；迁移和 apply 都使用管理连接，Vercel 不需要管理连接。

```powershell
npm.cmd run accounts:apply -- --manifest local-private-accounts/pilot-batch/manifest.json
```

6. 保存整个私密批次目录，它用于可重复应用和分发；教师文件含明文初始密码，manifest 只含哈希仍应保密，不上传到公共存储或代码仓库。

批次目录内的 `teachers.tsv` 是 30 名教师分发清单，`administrator.tsv` 只交给账号管理员，`manifest.json` 用于导入数据库，`README.txt` 说明当前生成状态。

数据库运行连接使用受限 LOGIN 用户；Supabase shared transaction pooler 的用户名为 `wj_auth_server.[PROJECT_REF]`，主机与端口从 Dashboard Connect 获取。客户端始终启用 TLS 证书验证。准备 Dashboard 提供的数据库 CA PEM，将它配置为 `DATABASE_CA_CERT`；首次云端连接需实际验证证书链，不要把验证改为 `rejectUnauthorized:false`。

官方：[选择数据库连接方式](https://supabase.com/docs/guides/database/connecting-to-postgres)、[自定义 PostgreSQL 角色](https://supabase.com/docs/guides/database/postgres/roles)。

## 部署到 Vercel

从包含本次分支的仓库导入项目，Root Directory 选择仓库根目录。根目录 `vercel.json` 已指定安装两个 package、构建 `app/dist`，并将 `/api/*` 路由到账号函数，其余网页路径交给 SPA。

账号函数固定在单一 `sin1` 区域，与新加坡 Supabase 项目对齐；Hobby 只使用这一处函数区域。当前函数 `maxDuration` 为 300 秒，用于容纳免费多模态模型的单次受控请求；Gateway 自身仍设置更短的 HTTP 和 Provider 截止时间。配置和本地构建通过不等于 Vercel 云端构建或函数依赖打包已经验证；部署后仍需确认构建成功、函数包包含 PostgreSQL 和 Gateway 运行依赖，并执行下方接口验收。

配置服务端环境：

| 变量 | 设置 |
| --- | --- |
| `DATABASE_URL` | Supabase transaction pooler 的受限运行用户连接 |
| `APP_ORIGIN` | 该部署实际的 HTTPS 域名，精确匹配，不带路径 |
| `AUTH_RATE_LIMIT_SECRET` | 稳定、独立的随机秘密值，多实例一致 |
| `DATABASE_CA_CERT` | Supabase Dashboard 提供的数据库 CA PEM，保留真实换行 |
| `OPENROUTER_API_KEY` | OpenRouter 专用密钥，只设置在 Vercel Production 服务端环境，不写入前端或仓库 |
| `OPENROUTER_MODEL` | 固定为 `dots-studio/dots-3-note-preview:free`；后续只替换为已验证的 `:free` 模型 |
| `OPENROUTER_MAX_COMPLETION_TOKENS` | MVP 建议 `16384`，按免费模型实际限制调整 |

不要给 Vercel 设置 `DATABASE_ADMIN_URL`、`PILOT_INITIAL_PASSWORD`、`AUTH_STORAGE=local` 或 `AUTH_LOCAL_PATH`。初始化只在受控管理端运行。前端不应设置任何 Supabase 密钥、连接串或 OpenRouter key。

首次导入后按实际域名补齐 `APP_ORIGIN` 并重新部署；未配置时接口会安全返回服务不可用。Preview 和 Production 如果共用数据库，必须各自配置准确 origin；建议真实分发只使用稳定正式域名。

登录限流在数据库中按账号和来源共享计数。只在 Vercel 环境信任平台的 `x-vercel-forwarded-for`，本地忽略浏览器自填的转发 IP；不要通过自行设置 `VERCEL=1` 模拟其他代理部署。[Vercel 请求头](https://vercel.com/docs/headers/request-headers)

部署后验证：教师登录、刷新仍登录、退出后返回登录页；管理员名单恰好 30 教师和 1 管理员；停用教师后旧会话失效；改密和注册写请求返回拒绝；`/api/unknown` 返回 JSON 404。通过后再把稳定登录地址和各自账号分发给老师。

官方：[Vite 与 API 路由](https://vercel.com/docs/frameworks/frontend/vite)、[Vercel rewrite](https://vercel.com/docs/routing/rewrites)。

## OpenRouter MVP 接入与限制

Vercel API 已将 `/api/grading` 和 `/api/tasks` 挂载到现有 Gateway，并要求同源、已登录教师会话。模型调用只在服务端执行，固定使用 `dots-studio/dots-3-note-preview:free`，不自动切换付费模型；Provider 并发固定为 1。MVP 只验证手工确认的 rubric 和单张图片，页面任务上传与结果持久化仍待后续实现。

公开测试建议只使用仓库合成图片或已取得授权的去身份化样本。一次请求可能接近几分钟，失败时不得盲目重试；先保存状态码、阶段和固定错误码，再决定是否更换模型。Vercel 函数请求体和响应体上限仍为 4.5MB，因此多页原图、长期任务和班级批量处理必须在后续改为私有 Storage + 后台队列，不能直接把当前 MVP 当作 30 个账号的批量服务。

截至核对时，Vercel Hobby 在默认启用 Fluid Compute 时最长函数执行 300 秒，关闭时最长 60 秒；函数请求体和响应体上限均为 4.5MB，不能直接承载目前 360 秒超时和多页大图 multipart。原图应直传私有 Storage，由小元数据任务驱动后台处理。不能通过恢复 OCR、未验证压缩、忽略未知结果或自动转付费模型绕过限制。[函数限制](https://vercel.com/docs/functions/limitations)

OpenRouter 免费模型额度按 API 账号共享；截至核对时，累计购买积分不足 10 美元时为每天 50 次，达到 10 美元后为每天 1000 次。这些是账号合计额度，不是每位老师独立获得；本项目未因此购买积分。选定模型后还需验证手写识别、评分和 Schema 质量，核实上游数据处理政策；具体学生样本与真实请求范围另行确认。[免费额度](https://openrouter.ai/docs/faq)
