# 当前开发状态

## 2026-09-26：用户取消本轮验证费用上限，继续 Vercel 切换

- 在代理明确提出将已保存 DeepSeek key 写入 Vercel Production、部署和线上合成复验后，用户回复“无费用限制”。据此继续该具体部署和验证任务，不再沿用此前 0.10 / 0.04 美元的费用上限；不因金额重复要求确认。
- 该授权限于当前 DeepSeek 官方直连接入与必要的合成验证，不代表更换其他模型、无限循环请求、真实学生材料使用或充值/订阅授权。先完成一次受控线上测试，必要诊断按证据推进；不盲目重发结果未知请求。
- 旧 3 次测试账本保留为历史证据，本轮使用独立部署验证记录，保留请求数、用量和脱敏结果。Provider 并发仍为 1，外部 v2 合同与无 OCR 主流程保持不变。
- DeepSeek 密钥可保存到目标 Vercel 项目 `wenjie-writewise-pilot` 的 Production 服务端 Secret；不得回显、写入源码/日志或前端。



## 2026-09-26：DeepSeek 本地图片批改已接通，线上切换待确认

- 已确认本地专用密钥有效；官方 `/models` 返回 `deepseek-flash` 可用且支持 image，账户余额可用。密钥保持 Git ignored，不写入日志或前端。
- 已完成 DeepSeek 官方直连适配：固定 `https://api.deepseek.com/chat/completions`、`thinking.type=disabled`、`response_format.type=json_object`，把 JSON Schema 放入系统提示并保留本地严格业务校验。单次 rubric、多页单篇一次 completion、确认文本零图片重批、无路由回退及现有 v2 合同不变。
- 2026-09-25 的 3 次合成图片额度已全部使用。前两次 HTTP 503 / dimension_scores；第 2 次脱敏诊断确认卷面权重 5% 被模型错误当成 5 分，而任务满分 15 分时卷面上限应为 0.75。修复在 canonical 任务上下文显式提供确定性 maxScore（内部 model-task-context-v2），并明确百分比与绝对分数，不放宽评分校验。
- 第 3 次真实合成请求 HTTP 200、grading-result-v2、partial，4.664 秒；正文匹配合成图片且排除页眉，两个维度 7.12/14.25 和 0.75/0.75，总分 8/15。partial 表示仍需教师复核，不能称为所有反馈完整或真实教学质量验收。
- 测试前后余额显示 9.73 → 9.71 元；按已知 token 使用量和高峰无缓存价格保守估算累计上限 0.049682 元，低于授权预算。账本在 ignored `grading-gateway/local-private-results/deepseek-20260925/`，保留全部 3 次预留及脱敏结果；未知结果保持完整预留。禁止再用该授权追加调用或删除账本重跑。
- 已通过网关 55 文件 / 1385 项、平台 API 10 文件 / 41 项、两端类型检查、共享评分运行时和根目录生产构建。独立复核提出的预算账本与日志类型问题已修复并通过回归，复核闭环无剩余问题，不将自动化测试当作教师端云端闭环验收。
- Vercel 适配代码已支持显式 `GRADING_PROVIDER=deepseek` 与独立 `DEEPSEEK_API_KEY`；没有 DeepSeek key 时不会回退 OpenRouter。本轮尚未保存新 Production Secret、推送或切换生产，线上仍是原部署且前端只开放账号。
- 下一步是确认将该 DeepSeek key 保存到 Vercel Production、部署直连代码，以及另行授权最多 1 次合成图片线上复验（建议上限 0.04 美元）。教师批改 UI、任务/图片/结果持久化、后台队列和共享并发未完成，不能宣称支持 30 个账号同时处理整班。详见实际工作树 `docs/2026-09-26-deepseek-direct-validation.md`。



## 2026-09-25：用户确认切换 DeepSeek 官方 API 直连

- 用户明确要求不经过 OpenRouter，改用 DeepSeek 官方 API；目标模型为官方 `deepseek-flash`（本次官方文档对应 DeepSeek V4.1 Flash），接口固定为 `https://api.deepseek.com`。本决定替代此前仅限 OpenRouter 免费端点的选型，但不授权其他付费模型或自动回退。
- 用户确认先做最多 3 次合成图片测试，累计费用上限 0.10 美元；直连使用 DeepSeek 官方账户余额，不能使用 OpenRouter 余额。运行前应按官方实际计费币种和上限做保守预算预留；未确认完成的调用仍占预算，不因网络错误盲目重试。
- 专用密钥由用户写入实际账号工作树的 `grading-gateway/.env.deepseek.local`；该文件受 `.gitignore` 的 `.env.*` 规则保护。不要让用户把密钥粘贴到聊天；不输出密钥、不写入普通文档/日志/测试，不添加前端 `VITE_` 密钥变量。
- 本轮先准备本地密钥文件；DeepSeek 直连适配、真实调用和线上切换尚未完成，不得将文件就绪当作模型接通。直接多模态 v2、一次 completion、教师复核、有界并发及已确认的 MVP 范围保持不变。


## 2026-09-25：Supabase 已恢复，Vercel 复验完成但 Dots3 批改仍未通过

- 用户已完成 Supabase 登录；控制台确认原项目处于暂停状态，已通过 Resume 恢复且显示 Healthy。没有重置账号、密码或数据库连接。公网登录/session 200、退出 204、退出后旧会话 401；受保护批改入口的无效请求返回 400 invalid_request。
- 首次公网单张合成图片批改约 78.6 秒后返回 503 provider_invalid_response，未得到可用批改结果。随后一次本地脱敏诊断确认 Dots 输出被截断：finish_reason=length，16384 completion tokens 中 9159 为 reasoning tokens，JSON 未闭合，费用为 0。不得将该诊断等同于评分质量验收。
- 针对 Dots 免费模型发送 reasoning.enabled=false，保留 16384 上限、严格结构化结果校验和无付费回退；其他替换模型不继承该推理设置。新增 Vercel 安全诊断，仅记录固定阶段和静态错误码。
- 修复提交 3c59692 已推送，Production dpl_85rkJ2Y9BoYTD3D4XMQHWz2TQZEB 已 Ready（57 秒）。OpenRouter 23 项针对性测试、平台 API 39 项、两端类型检查和根目录生产构建通过；平台测试挂载方式的类型问题已修正并复验。
- 最后一次公网单图复验已于 2026-09-25 完成：登录/session 200，约 16.8 秒后批改 503 provider_invalid_response；Vercel 安全诊断明确为 normalization / dimension_scores。本次通过 JSON 解析且未触发截断，但核心评分维度数据仍不合法，具体属于缺失、维度身份或分数范围问题尚无证据区分，不得猜测或放宽校验。
- 独立一次性账本为 vercel-mvp-dots-fix-grade.json；本轮 5 次调用预算已全部使用或预留（含此前 1 次结果未知），停止追加 completion。退出 204、旧会话 401，清理完成。结果未知的旧请求不得重发，不得宣称公网批改已可用。
- 生产前端仍只有登录与账号管理，未开放教师批改页面；持久化、后台队列、跨实例幂等/共享并发、30 账号批量和真机验证未完成。保持直接多模态 v2，不恢复 OCR。
- OpenRouter 官方模型页于 2026-09-24 显示 Dots3 免费端点将在 2026-09-30 下线：https://openrouter.ai/dots-studio/dots-3-note-preview%3Afree 。密钥轮换尚未收到用户完成确认，禁止复述任何密钥值。


## 2026-09-23：Vercel MVP 部署与当前阻塞

- 已获用户明确授权保存 OpenRouter Production Secret 和部署。后端接入提交 `c5017c3` 与脱敏启动诊断提交 `e3a69a3` 均已推送；最新 Production `dpl_974k398rowS1DDHa3wto85i5zCWx` 为 Ready（56 秒）。
- Vercel 已保存 OpenRouter 密钥、Dots3 免费模型 ID 和 16384 输出上限；导入密钥时浏览器工具曾回显该值，需要更换密钥，文档不记录值。
- 公开验证登录阶段 503，尚无线上模型请求。Vercel 诊断为数据库 `XX000`；原本地数据库配置同样返回 `tenant/user not found`。原因待从 Supabase 控制台核实，不能据此推定数据库被删除或重置密码。
- Supabase 通过 GitHub 登录时被强制 2FA 设置页阻断，需要用户完成验证器绑定和恢复码保存。恢复控制台后先确认项目状态和官方连接参数，再测登录与一次合成图片批改。
- 生产前端仍为账号就绪页，尚未开放可操作的批改流程。任务、图片、结果持久化及共享并发、后台队列仍未完成；单实例并发 1 不等于全站跨实例并发 1。
- 已通过 Gateway 53 文件 / 1359 项、平台 API 10 文件 / 39 项、部署类型检查和根目录构建；最新诊断补丁另通过部署类型检查。

## 2026-09-23：开始接入 OpenRouter Dots3 免费模型

- 用户要求先接入 `dots-studio/dots-3-note-preview:free` 测试，保留后续换模型能力；免费接口且无付费回退。
- 专用密钥已由用户保存到本工作树 ignored 本地配置；只读鉴权成功，免费日额度为 50 次；一次受控真实合成请求已发出并由网关安全归类为 `provider_invalid_response`（约 154 秒），没有自动重试。
- 已完成现有网关 Provider 适配、配置模板和最多 5 次合成 completion 的一次性账本保护（并发 1），不使用真实学生材料、不发布生产。云端持久化和后台队列仍未完成；模型列表元数据确认 Dots 支持图像输入、`response_format` 和 `structured_outputs`，但本次完整 rubric 返回未通过产品 rubric 校验。
- 已完成 Vercel MVP 挂载：`/api/grading` 与 `/api/tasks` 复用现有教师会话和 Origin 校验，服务端读取 `OPENROUTER_API_KEY`，函数最大执行时间为 300 秒，默认模型为 Dots3 免费版，Provider 并发固定为 1。代码已通过平台 API、部署类型和生产构建检查，待生产环境保存变量、部署并做一次公开单图测试。
- 本次公开测试边界是“已确认评分标准 + 单张合成或已授权图片 → 一次多模态批改”；没有任务/图片/结果持久化、后台队列、跨实例幂等或 30 账号批量验收。

最后更新：2026-09-23

## 2026-09-13 收工保存：下一次继续 OpenRouter 与云端保存

- 用户要求今天保存后停止，计划 2026-09-14 继续。本轮只保存交接文件，没有新增业务代码、云端迁移、部署或模型调用。
- 已部署基线：`codex/teacher-pilot-accounts` / `f4ada12` 已推送；最后一次文档提交自动部署 `dpl_D2bk16FMbnnMe8MszxKjUQgdaXn2` 在本会话显示 Production Ready（32 秒）。应用代码与已通过公网验收的 `868f3a6` 相同。正式网址 `https://wenjie-writewise-pilot.vercel.app` 只开放登录和账号管理。
- 30 个教师和 1 个管理员沿用现有 Supabase 账号与 ignored 私密批次；不重新生成账号、不重置数据库或运行凭据。已有 Vercel/Supabase 项目和授权继续使用。
- OpenRouter 首页已打开；登录、专用 API 密钥创建与保存均未确认，模型与 Provider 数据政策仍未验证。下一轮先检查真实状态，不能把“好的/明天继续”记为已登录或密钥授权。
- 后续工程范围：教师归属与数据隔离；任务和当前评分标准；学生多页作文私有存储；识别正文、评分、反馈及教师修订的持久化；刷新/重新登录恢复；后台执行、持久幂等、共享有界并发与免费额度控制。具体实现设计尚未开始，本次没有声称这些能力完成。
- 前期联调使用合成材料；真实验收前再明确一份原题、少量已授权去身份化作文及可选参考分数、请求数与费用范围。数据保留期限和删除规则由代理拟出简明方案，用户确认后落实；尚未约定自动删除期限。
- 验收闭环：创建任务、上传作文、AI 批改、保存结果、刷新或重新登录仍可查看；通过后建议先邀请 3–5 位教师。免费模型不可用时不自动转付费，不恢复独立 OCR。


- 云端界面核对：Data API 保持启用，公开 schema 为 `public`/`graphql_public`，新表自动公开关闭；Supabase Auth 公开注册已关闭并重载验证，匿名登录保持关闭。迁移后界面显示 3 个 schema 中仅 2 个公开，6 张表中 0 张公开、2 个函数中 0 个公开；`pilot_auth` 六表 RLS 为 false，以私有 schema、不授予 anon/authenticated USAGE 及受限服务端数据库角色隔离访问。

## 2026-09-13：固定密码账号与 Vercel + Supabase + OpenRouter

- 用户已创建 Supabase Free 项目 `wenjie-writewise-pilot`，ref 为 `wudbhdyqgnbnuorebhnu`，地域为新加坡 `ap-southeast-1`，Dashboard 状态 Healthy。云端 migration、apply（30 教师 + 1 独立管理员）及同 manifest replay 已通过；最终 31 个账号身份与原私密 manifest 一致，状态均为 active。Vercel 账号站点首个 Production 部署现为 Ready。
- Vercel 实际进度：`codex/teacher-pilot-accounts` 的 `868f3a6` 已推送 GitHub。用户已完成 Vercel 登录与 GitHub App 安装；安装 ID `161362709` 已核实仅授权 `lionbriant88/wenjie-writewise-ai`。Hobby 项目 `wenjie-writewise-pilot`（project ID `prj_q5UwSa3JPak99V4aewaLWG8vDeSo`）已连接该仓库，Production Branch Tracking 为 `codex/teacher-pilot-accounts`。首个 Production 部署 `dpl_7keMWVgjkNfw9bM6xa8JPmaDQC8f` 使用提交 `868f3a6`，33 秒完成并为 Ready；正式账号地址为 `https://wenjie-writewise-pilot.vercel.app`，原 `project-6tamb.vercel.app` 保留 307 跳转。四项 Production Secret 已保存验证，框架 Vite、Node 24、仓库根目录；项目数据用于模型训练选项已关闭。账号站点上线不代表 OpenRouter 云端批改已接通。
- 正式域名 HTTPS 验证脚本 exit 0：教师和管理员各 1 个账号完成登录/session/退出/撤销（各 2 次），4 次 CSRF 拒绝、教师访问管理员接口 403、管理员 31 人名单与 manifest 一致、最后管理员停用 409、改密/重置/注册共 6 次 403、未知 API 共 2 次 JSON 404、批改接口 503，`cleanupComplete: true`。首次沙箱网络失败发生于 public_routing、0 次登录；获联网许可后通过。公网浏览器已验证教师登录、刷新保持账号就绪、退出回登录页；管理员显示 31 张账号卡片，搜索“教师01”仅 1 张，刷新恢复账号管理后正常退出。两个浏览器会话均已退出；未在公网 UI 修改显示名或启停账号，也未逐一测试 31 个公网账号。详见账号工作树 `docs/2026-09-13-vercel-account-validation.md`。
- Dashboard 确认的 session pooler 为 `aws-0-ap-southeast-1.pooler.supabase.com:5432`。用户已亲自重设数据库密码，重设后短暂出现认证失败，后续连接已恢复；现已使用 Dashboard 官方 CA 严格验证 TLS 并连接 PostgreSQL 17.6。受限运行用户 `wj_auth_server` 权限检查通过，无 SUPERUSER/BYPASSRLS/CREATEROLE/CREATEDB，statement timeout 为 10 秒。
- 云数据库支撑的本地 loopback API 验收分两段完成：首次达到 6 分钟硬截止时，已完成 28 个账号的登录/session/退出/撤销循环，并进入下一次登录；随后确认数据库会话数为 0，再从 skip 28 续跑余下 3 个并通过。累计全部 31 个账号均通过，教师越权请求 30 次返回 403，改密/重置/注册写请求累计 93 次被拒绝；管理员名单为 31，最后管理员停用返回 409。不能表述为单次 6 分钟全量成功，也不是 Vercel 网站或真实多连接饱和验收。
- 云端独立回滚验证已通过（exit 0）：教师停用与重新启用、旧会话撤销、运行角色密码写入权限拒绝、数据库不可变密码触发器均验证成功；账号不变，所有探针写入均已回滚；最终只读会话检查为 0/0。完整证据与限制见账号工作树 `docs/2026-09-13-supabase-account-validation.md`。
- Vercel 运行专用环境 JSON 已保存于工作树 ignored `local-private-accounts/supabase-setup/`，仅包含 `DATABASE_URL`、`AUTH_RATE_LIMIT_SECRET`、`DATABASE_CA_CERT`，不含管理连接或教师密码。`vercel.json` 已设置 `regions: ["sin1"]`、`maxDuration: 30`，根目录部署类型检查通过；`DATABASE_URL`、`AUTH_RATE_LIMIT_SECRET`、`DATABASE_CA_CERT`、`APP_ORIGIN` 四项已获用户授权保存为 Production Secret 并在界面确认，`APP_ORIGIN=https://wenjie-writewise-pilot.vercel.app`；框架为 Vite、Node 24、仓库根目录，首个 Production 部署已 Ready。
- 用户明确要求 30 个教师账号，所有账号初始密码使用统一固定值，且不允许修改；不实施首次改密或密码重置。用户名采用随机编号，单独保留管理员，管理员可查看和停用账号。
- 用户已改选 Vercel + Supabase + OpenRouter 免费多模态模型，取代腾讯云集中部署和本轮 Kimi 验证方向。用户要求先完成的可部署代码与账号初始化工具已通过本地验收，并已完成 Supabase 云端账号初始化与联机验证；Vercel Production 环境已配置且首个账号站点部署为 Ready。
- 账号模块已在 `codex/teacher-pilot-accounts`（基于最新批改实现 `5c8352f`）完成代码与本地验收：Supabase PostgreSQL 适配器保存账号/会话，Vercel 同源 API 执行认证，浏览器不取得 Supabase Auth 身份令牌；接口和数据库均禁止改密。管理员可搜索、修改显示名、启用/停用账号，停用立即撤销已有会话；退出支持跨标签同步及失败重试。
- 已生成 `local-private-accounts/pilot-batch/` 私密批次，包含 30 教师和 1 独立管理员的随机账号。统一密码仅由初始化环境输入；分发 TSV 与 manifest 均受 Git 忽略。已在本地持久 PGlite 应用并重放该清单，31 个账号逐一通过 HTTP 登录/退出；角色隔离、CSRF、停用及旧会话撤销、改密拒绝和最后管理员保护通过。
- 最终验证：网站 85 文件 / 1345 项、账号 API 9 文件 / 36 项测试通过；类型检查、网站 lint、根目录部署入口类型检查与生产构建通过。生产即使配置 `VITE_AUTH_MODE=local-demo` 也不包含旧演示业务；独立前端与整体复审均为 Ready。浏览器验证教师/管理员操作、刷新、跨标签退出、旧路径登录保护，以及 390/834/1280 像素布局；这是桌面浏览器视口验收，不是真机教师网络验收。
- 部署说明为 `docs/teacher-pilot-accounts-setup.md`，已提供 Supabase 受限运行用户、管理端迁移/导入、Vercel 根目录配置和环境步骤。本地账号预览为 `http://127.0.0.1:5177/`，API 为 `127.0.0.1:8793`，未启动或接入 OCR/Gateway。
- 具体 OpenRouter 免费图像模型尚未选择或验证。直接多模态、v2 合同、单次 rubric completion、有界并发和未知结果不盲目重试保持不变；Kimi 特有参数/缓存能力不可无验证移植。
- 云端账号已初始化，账号网站已部署公网并完成上述 HTTPS 验证；没有发起真实模型调用；OpenRouter 尚未接入。账号模块完成不代表教师真实材料流程已具备持久化、队列与共享准入，后续需分别验证。
- 生产登录后显示账号已就绪、作文批改暂未开放；任务/图片/结果按教师归属持久化、后台执行与共享准入、真实多连接饱和与教师真机网络体验仍待后续完成与验收。原业务代码只可在显式本地开发演示模式使用，不得将本轮记为 OpenRouter 真实批改已接通。

## 2026-09-06：验收质量修复与三篇真实复测完成

- 用户已批准修复本轮识别边界、图片裁切遗漏和可合理辨正确字迹误扣分，并询问免费小范围教师试用所需条件。本轮保持 Kimi K3 直接多模态、一次 completion、外部 v2 合同和教师复核流程。
- 已加入内部逐页完整性检查与结构化字迹扣分校验，保留依据已辨清文字成立的独立语法/用词反馈，并修复 PDF 转换期间继续上传/删除卡片的异步竞态。未知扣分归属与真实复核标记继续保留；Provider 内部 Schema 为 v3，对外仍为 v2。
- 此前真实验收使用 21 次 completion、18 次 token 估算、估算 8.388968 元；18 篇初批 3 success、15 partial。修复后只用剩余 3 次 completion 复测 a04/b04/b05，0 新 tokenizer/rubric：分类标签排除、裁切补拍提示和原字迹误扣三项改善已对照原图确认；结果 1 success、2 partial。仍有评分依据复核和个别语法过度纠正，不能宣称全部质量通过。
- 两轮累计 24 completion、18 tokenizer，估算 9.999592 元；未知预留 0，调用数额度已用完。本次 3 次同身份重放均 0 新调用，最大并发 1，全部 finish_reason stop。重建教师 rubric 的这三篇仅是定向视觉复测，不是同标准评分 A/B。
- 最终回归：前端 84 文件/1333 项、Gateway 52 文件/1336 项通过；两端类型检查、网站 lint/build、共享计分运行时、策略 fixtures 与 diff 检查通过。没有测试真实摄像头；仅验证 capture 文件输入及上传流程。
- 免费试用仍需身份与任务归属校验、持久化和恢复、持久幂等、限额、HTTPS、私有图片与备份；付款和小程序可后置。详见 `docs/2026-09-06-quality-fixes-and-teacher-pilot.md`。未合并主目录、未部署公网。

## 2026-09-04：真实环境批改排队卡住与等待闪烁已修复

- 本轮只修复用户确认的两个问题：本地连接被禁止后调度槽位被长期占用，以及自动续跑时等待状态闪烁并被误表达为 Kimi 限流。没有修改 `result_unknown` 交互、教师修订原文后的重批逻辑或任何班级总览功能。
- 实际故障根因是 Gateway 进程的本地出站连接在连接建立前被操作系统以 `EACCES/connect` 拒绝，不是 Kimi 返回 `429`。旧映射将该本地、可确定未连出的错误当成了 `termination: unknown`，registry 因而保留 lease；后续重挂收到本地 `target_busy`，前端遂长时间循环等待。
- Kimi transport 现在只对“直接 `cause`、严格 `code === EACCES`、严格 `syscall === connect`”的错误标记 `termination: confirmed`，且不生成 Provider attempt observation，使 registry 可释放该本地失败的槽位。超时/Abort 优先级不变，其他网络拒绝仍保持 `unknown`，不会为了解卡而破坏结果未知时的单次调用安全约束。
- 前端调度器在自动重挂时继续公布稳定的 `rate_limit_wait` 展示态；如果实际请求持续超过 250ms，才显示“批改中”。快速再次等待时不再发布 `queued → running → wait` 的瞬时状态序列，实际请求与调度槽位不会因展示延迟而延后。用户文案改为“等待批改资源”和“系统将在资源可用后自动继续批改”，不再把所有准入等待误报为 Provider 限流。
- 修复与自动验证未发起新的真实 Kimi 请求，也没有启动、恢复或建议 OCR 主流程。真实 Provider 仍使用 `kimi-k3` 直接多模态识别与批改，密钥只保留在 Git 忽略的本地环境中。

### 本轮验证

- 前端新增回归覆盖快速重挂不发布闪烁状态、持续请求 250ms 后正常显示运行中、活动/等待计数不重复、替换与 dispose 清理计时器、以及订阅回调内重入 dispose 不再留下计时器。聚焦组 3 个文件 / 60 项通过，前端全量 84 个文件 / 1329 项通过；typecheck、lint 和生产构建通过，构建仅保留既有大 chunk 提示。
- Gateway 新增的精确 `EACCES/connect` 回归与相邻 transport 组 34 项通过；Gateway 全量 50 个文件 / 1291 项通过，typecheck 和共享计分运行时验证通过。为使 benchmark CLI 的“缺少凭据”隔离用例得到真实的无 Key 环境，全量验证期间只在 Gateway 目录内暂时移动 ignored `.env`，并在 `finally` 中恢复；验证输出已确认文件恢复，未读取或输出密钥内容。
- 前端等待修复与 Gateway 槽位修复均经独立复审，最终 Critical / Important / Minor 均为 0。已用新代码重启 `127.0.0.1:8790` Gateway，健康检查确认 `kimi-k3` / `low` / `single-pass-v1` / `optimized-v1` / `memory-v1`、准入未暂停且活动请求为 0；`127.0.0.1:5173/tasks/new` 返回 HTTP 200。本次健康检查没有发起批改 completion。

## 2026-09-02：AI 班级总览本地功能原型已完成并通过 fake 验收

- 已按 `docs/superpowers/plans/2026-08-29-ai-class-review-local-prototype.md` 完成本地功能原型阶段；本轮只在 React 内存状态与 Grading Gateway fake acceptance/loopback 范围内实施，没有接入真实 Kimi、没有启动或恢复 OCR Gateway，也没有补齐商业级后端持久化、认证、租户、对象存储或跨实例 registry。
- 班级总览页已收口为一个纵向工作页，并明确显示“本地功能原型；刷新、重启、多设备和真实班级长期保存不受保证。”；页面依次呈现当前统计、AI 班级总体评价、共性问题与讲评建议、明确拼写错误和教师精选讲评素材，不恢复旧四个一级 Tab，也不展示“教师模式 / AI 模式”。
- 班级统计与生成门槛现在遵循当前决策：纳入本任务全部有效成功作文，教师最终确认不是纳入门槛；单篇 final failed 不阻断其余成功作文进入班级总览；班级总结 CTA 只在队列 settled 且 `N_success >= 2` 时出现。页面 settled 判断已复用进度页队列口径，`grading_ready`、人工复核和 final failed 视为 settled，等待、运行、限流等待、结果未知和可重试失败仍会阻止生成。
- 普通共性问题、频次、人数、比例、分数统计和明确拼写清单均由本地确定性聚合计算。明确、唯一、无需教师复核且无字迹歧义的低级拼写错误会不受频次门槛进入独立紧凑清单；普通共性问题继续使用 `requiredSupport = max(N_issue < 10 ? 2 : 3, ceil(N_issue × 20%))`。统计与清单查看、排序、拼写提升、教师从单篇加入问题和材料操作均不增加模型 completion。
- 教师可在首次 AI 班级总结前从单篇结果加入未达门槛但有教学价值的问题；AI 问题与教师问题共用同一个可排序列表，“置顶”已落实为上移/下移的展示顺序调整，不建立额外 pinned 状态。教师精选素材仍与共性问题列表分离。
- 本地 AI 班级总结由教师显式点击生成；浏览器业务侧默认使用 in-process fake synthesis client，首次成功生成时可应用总体评价、主要优点、学习建议和 Common issue。重新生成前会明确提示“这会消耗 1 次新的 AI 调用”；若 fake 重新生成失败，页面显示“班级总结生成失败，请稍后重试。”并保留老师已编辑的 AI 总评、教师加入的问题与排序。
- Grading Gateway fake acceptance 现覆盖班级总结服务端 loopback：只允许服务端 Bearer 调用，拒绝浏览器 Origin；与逐篇批改共享 hard provider cap；非法请求与 prompt budget 超限在 Provider 前 0 调用失败；`empty`、`rate-limit`、`pause-auth`、`result-unknown`、`invalid-schema` 等场景返回脱敏、安全的固定结果；并通过 Gateway loopback 输出 + `app/classReviewMerge` materialization 验证多个低频组被模型合并后由确定性 merge 达到共性门槛、低于门槛 pattern 被丢弃、未被模型引用的 `mustCover` 零调用兜底、重复跨 pattern group 归属整体拒绝。该 loopback 仅用于 fake/本地验收，不能作为浏览器生产调用路径。
- 修复了班级总结生成边界的一个安全一致性 bug：Provider 可见问题标题/例句/建议会按投影预算裁剪，隐藏安全源保留完整文本；冻结快照校验现在按同一可见化规则重建并比对，合法裁剪不再误报 `class_review_candidate_conflict`，替换成其他可见文本仍 fail closed。

### 本轮精确自动化与浏览器验证

| 范围 | 最终结果 |
| --- | --- |
| 新增班级总览纵向流程 | 1 个测试文件、1 个用例通过，覆盖 6 篇一键批改、5 篇成功纳入、1 篇 final failed 隔离、明确拼写自动进入清单、低频问题从单篇加入、问题排序、教师编辑总评、重新生成失败保留现有内容 |
| 班级总览与相邻前端聚焦组 | 7 个测试文件、91 个用例通过 |
| Grading Gateway fake acceptance 聚焦组 | 1 个测试文件、23 个用例通过 |
| 网站全量 | 84 个测试文件、1325 个用例通过 |
| Grading Gateway 全量 | 50 个测试文件、1290 个用例通过 |
| 网站质量门 | Typecheck、lint、生产构建均通过；Vite 构建转换 429 个模块，仅保留已有大 chunk 提示 |
| Gateway 质量门 | Typecheck、共享评分运行时和 grading policy fixtures 均通过；共享评分运行时输出 `shared scoring runtime ok` |
| 范围与安全扫描 | 班级总览页面与问题卡片未命中旧 `mockClassInsights`/旧 mock 洞察/冗余 `role="button"`；班级总览与 Gateway class-review synthesis 生产路径未命中 OCR Gateway、`POST /ocr`、`VITE_OCR`；Gateway class-review synthesis 生产路径未命中学生姓名、班级名、任务名、材料上下文、sourceFile、Base64 或 Authorization 泄漏关键词；`git diff --check` 无空白错误，仅有 Windows CRLF 提示 |
| 浏览器验收 | 本地 worktree Vite `127.0.0.1:5176` 验证 `task-1` 未 settled 时不显示生成按钮，`task-3` settled 时显示生成按钮、原型披露和明确拼写清单；点击 fake 生成后出现 `Class summary`、`Common issue` 与“重新生成”；移动端 `390×844` 下 `scrollWidth/bodyScrollWidth = 375`，无横向溢出 |

- 本轮没有读取、写入或提交真实 API Key，没有发起真实 Kimi 或其他外部 Provider 调用，没有启动 OCR Gateway，也没有把学生姓名、图片、作文全文、原题材料或普通业务 ID 发送进班级总结 Prompt。
- 当前仍只是本地原型：任务、报告 workspace、AI 文本编辑、教师问题、排序和精选素材都仍依赖 React 内存；刷新、重启、多标签长期恢复、新设备同步、租户权限、删除栅栏、跨实例唯一 generation 和生产数据保留规则仍须在后续“商业基础设施”计划中单独实施和评审。不得把本节 fake/浏览器证据表述为商品化发布完成或真实 Kimi 质量/成本验收通过。

## 2026-08-29：AI 班级总览生成与共性问题沉淀设计已批准（尚未实施）

- 用户已批准班级总览的核心商品化决策，并在写入规格前完成最后一轮交互、操作逻辑、非必要按钮、token 成本、持久化与权限审计；随后已明确确认正式规格的书面转录。正式规格为 `docs/superpowers/specs/2026-08-29-ai-class-review-generation-design.md`；本节只记录设计与计划状态，不表示功能已经实现。
- 普通共性问题按问题通道完整的有效成功作文 `N_issue` 计算，门槛为 `max(N_issue < 10 ? 2 : 3, ceil(N_issue × 20%))`；成绩有效但问题通道不完整的 partial 只进入 `N_success` 和成绩统计，页面另行披露 `N_issue / N_success`，不能把缺失问题当成零问题。同一作文在同一模式中只计一名学生。明确、唯一、无需教师复核且无字迹歧义的低级拼写错误不受频次门槛限制，但进入独立紧凑的“明确拼写清单”，不冒充共性问题；用户所举 `filling → feeling` 若在逐篇结果中为 certain `word_choice`，只有通过严格的单词级近形与唯一 revision 规则才纳入。
- 教师仍可从单篇结果手动加入未达门槛但有教学价值的问题；AI 问题和教师问题共用一个可排序列表。“置顶”已收口为普通显示顺序调整，不建立额外 pinned 状态；桌面拖拽与移动端/键盘上移下移都应自动保存。
- 首次 AI 生成前的教师问题、教师证据、精选素材和顺序由 task-scoped draft report workspace 承载；workspace 是否存在不能作为“已有 AI 报告”的判断，页面 CTA 必须依据是否已有成功应用的 AI generation。初次生成失败或候选放弃不得清空这些教师内容；report 读取须原子返回唯一 `currentGeneration` 摘要，支持刷新、新标签页和新设备恢复 active/result-unknown/unapplied。
- 班级总结只有在队列 settled 且 `N_success >= 2` 时，才由教师显式触发。正常首次生成只允许一次 Kimi completion；统计、明确拼写、查看页面、双击、重放、刷新重挂和结果检查不得增加调用。任务级持久唯一约束保证即使不同标签页使用不同 generation ID，也最多只有一个 active run 进入 Provider；教师明确重新生成、来源删除后重新生成或可能已计费的终态失败后明确重试才创建新 generation，并各最多增加一次 completion。并发教师编辑产生的待应用候选只能以 0 次调用应用/放弃；替换当前教师 AI 文本必须使用明确覆盖文案、确认和 `aiTextEditRevision` CAS。
- 班级级调用是逐篇评分完成后的去身份化综合，不改变“每篇作文独立多模态识别与评分”的主流程。逐篇 `multimodal-grading-request-v2`、`grading-result-v2` 和 `POST /grading/grade-images` 保持不变；浏览器业务合同使用 `class-review-generation-command-v1` / `class-review-generation-status-v1` / `class-review-report-v1`，权威任务服务到 Grading Gateway 使用内部 `class-review-synthesis-request-v1` / `class-review-synthesis-result-v1`，Kimi 输出 Schema 为 `kimi-class-review-output-v1`，也不引入 OCR。
- 服务端必须精确计算全量成绩、维度、频次、拼写和证据归属；Kimi 只接收受控问题原子组及有界、分层、跨作文轮转的语义投影，并只生成总体评价、主要优点、问题诊断/教学建议和学习建议。班级 Prompt 硬上限为 16,384 tokens（可控 payload 15,872 + 至少 512 framing reserve），v1 始终取 tokenizer 计数与完整 UTF-8 字节上界中的更保守值；framing 预算未由当前模型基线证明时真实 Kimi fail closed，超限在 Provider 前 0 调用失败。姓名、任务/班级名、普通业务 ID、图片、原题材料、作文全文、完整逐篇结果、教师备注与精选素材不得进入 Prompt；人数、比例、次数和例句不得由模型生成。
- 批准的页面方案已收口为一个纵向工作页：当前成绩统计、AI 班级总结、共性问题与建议、明确拼写清单、教师精选素材。实施时不保留当前四个一级 Tab，不默认生成改写练习，也不重复生成“主要不足”或“教学重点”；这些信息分别由共性问题和教师排序表达。
- 教师修改单篇结果后，原报告默认保留为生成时快照，不自动调用模型、不阻断使用、也不显示强制性过期警告；报告始终显示生成时间和当时纳入数量。明确重新生成成功后原子替换 AI 内容，教师添加的问题和排序继续保留；旧报告在失败、截断、非法引用或结果未知时保持不变。AI 总结处于编辑态或有未保存草稿时不得触发重新生成，必须先保存或取消。
- 教师选择证据和 system-generation 证据必须逐条区分、绑定精确历史 result revision；重新生成只替换系统证据，旧 revision 不存在时来源入口明确显示不可用，不能跳到当前结果冒充旧证据。同 topic 教师项须保留被抑制的当前 system variant；主动撤销最后一个教师来源且该 variant 仍合法时原位恢复为 AI 项，来源删除使整批 AI 失效时不得恢复。来源/任务删除会把相关 queued、running、result-unknown 和待应用候选 generation 永久置为 invalidated，并用写入栅栏阻止迟到 Provider 结果恢复已删除内容。
- 商品化发布前必须补齐拥有认证、租户/任务授权、任务与结果 repository、report transaction 和 generation registry 的权威任务服务；Grading Gateway 只承担全局 Provider 准入和内部 synthesis，不得充当公网用户安全边界。还必须完成内容级去身份化、未成年人数据保留/删除政策和刷新恢复。当前班级页仍依赖静态 `mockClassInsights`、四 Tab 和 React 内存素材，当前 Gateway registry 也只在单进程内有效；它们只能支持原型，不能满足上述商业发布保证。
- 书面确认后已按规格要求拆出三份独立 TDD 计划：`docs/superpowers/plans/2026-08-29-ai-class-review-local-prototype.md`（本地功能原型）、`docs/superpowers/plans/2026-08-29-ai-class-review-commercial-infrastructure.md`（认证、租户、持久化与多实例基础设施）和 `docs/superpowers/plans/2026-08-29-ai-class-review-integration-release.md`（权威接口替换、端到端与发布）。独立严格计划审查提出的缺口已逐项修正，重点补齐 Provider 输出权威重建、跨实例持久执行结果 registry、共享准入、唯一 actionable generation 约束、两阶段删除、跨服务崩溃恢复和创建任务阶段的材料/评分标准 AI 调用迁移；当前冻结版本的最终独立语义终审与机械终审均通过，Critical / Important / Minor 均为 0。商业基础设施计划仍包含必须单独批准的数据库、认证、租户、对象存储、反向代理和数据保留架构闸门；功能规格确认不能替代这些决定。
- 本轮只完成规格确认状态与实施计划文件，没有修改页面、Gateway 或合同实现，没有启动新的服务，也没有发起真实 Kimi 调用。下一步应先执行本地功能原型计划；在用户另行批准基础设施架构前，不得开始商业基础设施代码，也不能把计划文件当作实施完成记录。

## 2026-08-29：AI 调用成本、延迟与全班吞吐优化已完成本地实现与 fake 验收

- 已按批准设计实现“最大吞吐目标 + 稳健有界并发”，没有无上限并发、Batch API 或多学生合并请求。教师一次启动全部待批改作文；网站与 Gateway 使用一致的稳定成功窗口，在显式硬上限内补槽，`429` / 已知瞬时失败按标准 `Retry-After` 以同一请求身份有界重挂，单篇最终失败不阻断其他作文。
- AI 辅助评分标准正常路径现在只执行一次 completion，材料只发送一次；严格 Schema、本地确定性校验和教师最终创建确认取代默认第二次模型复核。真实回滚开关仍保留，但 legacy Prompt 也使用 canonical 脱敏任务上下文，不发送作文/任务身份、教师任务名、材料溯源或学生信息。
- 对外继续使用 `multimodal-grading-request-v2`、`grading-result-v2` 和 `POST /grading/grade-images`。逐篇 Provider Prompt 只收到一份 canonical 任务上下文；`prompt_cache_key` 为服务端 opaque HMAC。optimized Provider 输出省略可由 transcript 与 `sentencePairs` 无损重建的 `correctedText` / `improvedText`，Gateway 仍返回完整 v2 结果，教师页面合同未改变。
- Gateway 已安全记录和汇总阶段耗时、`prompt_tokens`、`completion_tokens`、`total_tokens`、可选 `cached_tokens` 与 `finish_reason`；不安全整数或累加溢出降级为 partial/unknown。日志、health 与 benchmark 报告不包含正文、图片、Base64、学生姓名、完整 Prompt、Key 或 Provider 原始响应。
- memory registry 已实现同一逻辑作文版本/rubric/profile 的 in-flight 与成功复用、payload 冲突保护、双截止与 result-unknown 重附着。成功与可重试状态会释放捕获原图的 executor 闭包，避免作文页随缓存常驻。该 registry 仍仅限单进程内存；重启或多实例没有共享幂等保证。
- 鉴权、余额、Kimi 403 权限或配置错误会暂停全局准入。生产没有匿名 resume 路由；修复配置/权限并重启 Gateway 后，教师在页面显式恢复，触发暂停的作文会用原 generation/request ID 重挂。`/health` 只返回实时、脱敏的 admission 聚合状态。
- 私有 benchmark/CLI、严格 manifest、匿名 aggregate、质量门槛、100-call soak、30-essay throughput、原图隔离和 loopback fake Gateway 已实现。所有真实入口要求 shell 中精确授权，且在 dotenv、私有样本、Provider 和 HTTP 之前 fail closed；缺人工审计时也在读取私有 bundle 前停止。
- 本地最终验证：Gateway 39 个测试文件 / 1144 项测试通过，App 63 个测试文件 / 739 项测试通过；两端 typecheck、App lint/build、共享评分运行时、策略 fixture、secret/env/active-OCR safety check 与 `git diff --check` 均通过。全分支此前积欠的 Prompt、并发、幂等和前端队列审查已完成，最终 Critical 0 / Important 0。
- 浏览器 loopback 验收使用 6 名合成学生和原始匿名测试图片：一键启动、限流自动续跑、单篇最终失败隔离、鉴权暂停、fake 内存执行层重启后显式恢复、result-unknown“检查结果”、正常结果页均通过；Provider 最大同时活动 1，配置硬上限 3，桌面 `1440×900` 与移动端 `390×844` 无 console warning/error 或横向溢出。验收后 `8792` / `5174` 均无监听。
- 以上只证明 fake/loopback 行为和离线契约，不证明真实 Kimi 的节省幅度或质量。真实 40+40 A/B、100 次 soak、30 篇吞吐和图片变体均未运行；25% token、99% 结构化成功率、CER/评分不退化与 60% 吞吐目标仍是未测门槛。图片仍使用原始有序字节，没有 resize/re-encode，也没有引入 OCR。
- 完整 Round A 仍缺同一受控 A+B 人工盲评协调器。本地 JSON 或普通 adapter 即使自洽也只能得到 `inconclusive / external_candidate_evidence_unverified`，不能 release pass。Task 16 每一轮仍需用户单独确认样本、调用数和费用；在用户决定人工评审协调方案前不得开始真实轮次。
- 批准设计仍为 `docs/superpowers/specs/2026-08-28-ai-pipeline-cost-latency-optimization-design.md`，实施计划为 `docs/superpowers/plans/2026-08-28-ai-pipeline-cost-latency-optimization.md`。历史“尚未实施”记录已由本节取代，但历史真实 Kimi 运行记录不视为本轮优化基线或质量证据。

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

## 历史快照：当时的下一步开发内容（已由 2026-08-29 顶部记录取代）

此前的 DeepSeek smoke 入口已经被该阶段的 Kimi 多模态主流程取代。当时记录的下一步是取得可访问 K3 托管接口的 API key，先复测教师确认文本后的纯文本重批，再使用用户后续提供的真实手写作文和写作材料做人工验收；这不是当前执行指令，当前顺序以文档顶部 2026-08-29 的班级总览计划与真实 Kimi 独立授权闸门为准。

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
