# 教师云端 MVP 验收记录

截至 2026-09-29：教师云端 MVP 已部署到正式域名，私有上传、后台批改、结果/教师修订保存、刷新及重新登录恢复已完成合成验收。本地验收、独立整分支复核修复、真实 PostgreSQL 双连接验证均通过。当前适合受控的小范围试用；真实手写评分质量、30×50 吞吐及真机拍照没有验收。

## 实现范围

- 保留 30 教师和 1 管理员的固定密码账号体系。教师入口使用服务端会话、Origin/CSRF 校验及逐对象所有权校验。
- PostgreSQL 保存草稿、确认评分标准、学生多页图片引用、批改作业、结果和教师修订；命令持久幂等，版本冲突返回 409。
- Supabase 私有原图直传，上传完成及模型使用前均校验字节。读取签名有效 60 秒，不将服务端 key 发给浏览器。
- Vercel Queues 后台执行；作文、材料理解和评分标准辅助生成共享数据库并发 1。官方 DeepSeek 直连、一次 completion、v2 合同，无独立 OCR。
- 结果未知保持占位；截止时间不会自动解锁。只允许原执行凭据提交迟到结果。已知配置/鉴权暂停通过受控维护命令恢复，不提供未知强制解锁。
- 草稿自动保存并更新到可恢复地址；任务、原卷、教师评语及确认状态可在重新读取后恢复。教师修改识别文本后须显式重新批改，重新批改不再发送图片。

## 本地证据

| 验证 | 结果 |
| --- | --- |
| 平台 API 全量 | 26 文件 / 100 项通过；后追加的清理结果断言 2 项通过 |
| Grading Gateway 全量 | 56 文件 / 1390 项通过 |
| 前端全量 | 94 文件 / 1369 项通过（限制 2 个测试 worker） |
| 新建草稿地址恢复、创建页及结果页复验 | 2 文件 / 56 项通过，新增地址恢复先红后绿 |
| 独立复核修复后前端全量 | 94 文件 / 1377 项通过；类型、lint、生产构建复验通过 |
| 类型、lint、共享计分运行时、生产构建 | 通过；最后补丁后的复验另记录 |
| 本地真实浏览器 | 合成教师会话、评语保存后刷新、确认完成、草稿刷新恢复、创建后进入上传；1440×900 和 390×844 检查 |

合成集成测试覆盖两教师隔离、单页及多页 attach、重复 enqueue、两个 worker 的竞争、队列发布失败后 durable 202、退出后后台执行、队列重投不新增模型调用、重登、教师修订版本冲突、零图片文本重批及删除清理。故障测试覆盖上传凭证重放、结果未知、迟到结果和会话失效。

浏览器预览使用本地 PGlite、MemoryStorage 和 fake Provider；原图是仓库合成 PNG。它不能证明 Supabase 上传、真实队列、真实多连接 PostgreSQL 争用、模型质量或公网稳定性。测试文件选择不代表真机拍照验收。

全量并行测试曾因资源竞争触发前端计时超时。改为限制前端 worker 后通过；网关迟到响应测试改成由测试显式释放 Promise，保留严格截止断言。另修复本地演示的已选问题移除按钮判断和两个异步测试等待。

## 独立复核及云端准备证据

独立 `gpt-6-astra` 只读复核范围 `3422c11..80a780f`；没有 Critical，三个 Important 均先红后绿修复，提交 `3fa8dcc`：

- Supabase 重复对象可返回 HTTP 400；仅接受明确的 Duplicate/ResourceAlreadyExists + 409 正文状态，再由服务端校验字节。其他 400 仍拒绝。
- 刷新后对 reserved 上传执行归属保护的原记录完成核验；保留原 uploadId，不重传图片。不存在或无效的对象保持未完成状态，教师可重新检查；页面归属仍须教师手动指定。
- 每次草稿编辑固定所读 TaskDto/revision，恢复材料期间的后台轮询不更新表单 CAS 基线；409 保留本地修改并明确提示另一页面已更改。

唯一延后 Minor 是发布顺序第 1 项的历史迁移文件名笔误；实际执行器使用 `platform-api/src/migrations/002_pilot_grading.sql`。复核未访问云端，真实 PG/队列/Storage/公网边界继续作为发布门槛。真实教学质量、30×50 吞吐与真机拍照保持未验收；未知全站占位符合已批准策略。

已通过严格 TLS 只读备份 schema/权限元数据到 ignored `local-private-accounts/teacher-cloud-mvp/schema-before.json`，不备份或输出账号密码哈希。核对 PostgreSQL 17.6、30 active teacher + 1 active admin，原运行账号权限保护通过；迁移前无 `pilot_grading` schema。随后仅执行新增业务迁移，确认 16 张业务表，账号数量和状态不变，记录为同目录 `migration.json`。

Supabase Dashboard 已创建 `pilot-originals`，Public 开关关闭、0 个访问策略、单文件限制 8,388,608 bytes，允许 `image/jpeg,image/png,image/webp`。用户随后确认创建专用 `writewise_pilot_storage` 服务端 API key，并保存到 Vercel 项目 `wenjie-writewise-pilot` Production。五项新增变量已按 Secret 类型保存，`PILOT_MVP_ENABLED=1`，独立随机 `CRON_SECRET` 已生成；密钥不进入聊天、源码或前端。SDK 只读 `getBucket` 确认新 key 有效、桶仍私有且大小/MIME 限制准确。首次本地网络隔离失败后获联网许可复验通过，未上传对象或调用模型。

已推送 `a5467cb` 触发 Production `dpl_5x5o6tJdgAKxejGF1R2DgCwE3qSF`，约 1 分钟后 Ready，正式域名 `https://wenjie-writewise-pilot.vercel.app` 已指向该部署。配置截图与恢复配置只保存在 ignored `local-private-accounts/teacher-cloud-mvp/`。公网脚本实际 npm 命令为 `npm.cmd --prefix platform-api run verify:pilot:public -- --run-authorized-once single`，依次使用独立 `single`、`multi`、`rubric` 账本；未知时改用 `--inspect <case>`，不重新 dispatch。

## 公网合成验收

三个脚本 case 均 exit 0，逐个完成后才开始下一个。另在正式浏览器以独立一次性预留验证完整教师页面，共 4 次 completion；数据库中每项均只有 1 次已开始执行、1 条 Provider 观测，全部 finished/stop，无自动重发或未知占位。

| case | 模型结果 | Provider 耗时 | prompt tokens | completion tokens | cached tokens |
| --- | --- | --- | --- | --- | --- |
| 单图 | partial，需教师复核 | 5128 ms | 4440 | 1256 | 2816 |
| 两页单篇 | partial，需教师复核 | 6844 ms | 4953 | 1591 | 4352 |
| AI 辅助评分标准 | succeeded，教师确认保存通过 | 4260 ms | 838 | 976 | 0 |
| 浏览器手填标准单图 | partial，需教师复核 | 6400 ms | 4481 | 1346 | 2944 |

token 总量为 19,881；这里只记录真实安全用量，不把 token 数当账单金额。作文合成正文匹配、印刷页眉排除；部分结果出现总分重算、维度问题关联/证据定位修正，以及辅助内容不完整的提示，不能声称全部 AI 反馈完整或教学质量已通过。

脚本验证：未登录业务接口 401、私有 worker 公网直接请求 404、无维护凭据 401、旧同步 Gateway 409；两教师对象隔离、私有原图签名读取、重复 enqueue 不新增作业、退出后后台继续、重登读取结果、教师反馈保存/确认和旧 revision 409 均通过。授权维护请求额外返回 204。实际 Queue 消费已成功，沿用 Hobby，未升级套餐。

正式浏览器验证：手填评分标准的草稿自动保存到固定地址，刷新恢复全部字段；创建任务、学生卡片选图、提交后启动批改、原图实际加载 1200×700、保存教师评语后刷新恢复、教师确认后完成计数 1/1。此浏览器用例只使用仓库合成 PNG，不是手写或设备摄像头验证。截图在 ignored `grading-gateway/local-private-results/teacher-cloud-mvp-production-{result,complete}.png`。

一次性预留、验证、usage 和清理报告位于 ignored `grading-gateway/local-private-results/teacher-cloud-mvp/`。最终严格 TLS 只读审计确认 4 个合成任务均逻辑删除且内容已清理、活跃会话 0、共享 gate 空闲且无暂停。4 张合成原图仍等待原 2 小时上传签名失效后的维护清理，不能把任务不可见写成对象已经立即删除。

真实 PostgreSQL 两个 session pooler 连接验收成功：`independentConnections=true`、`peakProviderCalls=1`、`modelCalls=2`（全部 fake Provider）、`unknownRetained=true`、`cleanupComplete=true`。重复 enqueue 合计仅接受一个 job，重复 worker 投递未新增调用，测试业务行已清理；既有账号未修改。私密结果记录为 `local-private-accounts/teacher-cloud-mvp/postgres-verification.json`。这不是 30×50 负载验收，也未验证 Vercel 消息实际投递。

## 发布顺序及凭据

目标保持 Vercel `wenjie-writewise-pilot`、Supabase `wudbhdyqgnbnuorebhnu`（新加坡），沿用现有 DeepSeek Secret。新增 Production 服务端配置：

| 名称 | 用途 |
| --- | --- |
| `SUPABASE_URL` | `https://wudbhdyqgnbnuorebhnu.supabase.co` |
| `SUPABASE_STORAGE_BUCKET` | 私有 `pilot-originals` |
| `SUPABASE_STORAGE_SERVICE_KEY` | 服务端访问私有 Storage，仅保存到指定 Vercel 项目 |
| `CRON_SECRET` | 独立随机维护入口凭据，至少 24 字符 |
| `PILOT_MVP_ENABLED` | 准备期间为 `0`，依赖验收后为 `1` |

1. 独立复核完成；备份 schema/权限元数据并核实数据库版本、账号数量与权限。仅应用 `002_teacher_mvp.sql`，不重建账号。
2. 创建私有 bucket、配置上述凭据。现有账户 Queue beta 可用性和实际部署仍需验证，不授权升级套餐。
3. 在业务表为空且入口关闭时运行 `npm.cmd --prefix platform-api run pilot:verify-postgres`；显式 `PILOT_VERIFY_EMPTY_DATABASE=1`，两个真实 PG 连接竞争，fake Provider，验证完成后清理合成业务行。
4. 发布并核实 Ready/Current、私有 worker、维护鉴权和旧同步 Gateway 无旁路。缺依赖时教师入口保持关闭，账号可用。
5. `pilot:verify-public -- --run-authorized-once single|multi|rubric` 各有独立原子账本。运行失败先 `--inspect` 查询原 job，禁止删除账本重跑。通过还必须满足测试任务删除和会话退出；实际 completion/usage 从对应执行记录安全汇总，不能以 enqueue 次数代替。

只使用仓库合成材料。未确认真实学生处理与保留规则前，不上传真实学生材料。脚本和日志不得输出凭据、账号清单、作文正文或 Provider 原始响应。

## 删除与恢复边界

删除立即隐藏任务并取消未执行作业；已签发的原图读取地址仍可能在余下 60 秒内有效。上传签名有效 2 小时，因此物理删除要等待旧上传凭证失效，未附着上传按 24 小时过期清理。Hobby 每日维护仅为兜底，活跃请求也进行有界恢复；浏览器关闭不取消作业。

未知调用保留必要执行墓碑并阻止新模型调用；人工不能仅凭过期时间解除。回滚关闭新入口/消费者并保留作业、结果和未知墓碑，不能恢复旧同步付费入口来绕过共享准入。

## 执行裁定与保留限制

- Windows 计划脚本使用 Git Bash `-lc` 获取 coreutils PATH；无产品行为变化。
- SQL 表随所属任务及测试引入，最终迁移完整包含 16 张表；没有预先加入未测试的未来字段。
- `resumeKnownPause` 增加可选环境参数，默认 `process.env`，以便恢复已知暂停前校验 DeepSeek 配置；不提供未知强制解锁。
- 新增受教师归属保护、数量有界的 `GET /tasks/:id/assist`，用于恢复当前草稿已有辅助作业；不会额外调用模型。
- 唯一最终整分支复核在本地验收后、云写入前完成；3 个 Important 已先红后绿修复，配置及证据更新不重复发起代码复核。
- Storage、Queue、Deployment 和真实 PostgreSQL 双连接为独立发布门槛，现均有实际证据；PGlite 从未被用作真实多连接证明。
- 未知执行会占住全站唯一槽位，不能仅按 TTL 解锁；极端情况下须等待原调用结果证据。
- 本轮无真实学生材料授权或套餐升级。真实手写质量、30×50 吞吐、真机拍照仍未验收，后续正式课堂范围及保留规则需另定。
- 唯一延后 Minor：历史发布顺序中的迁移文件名笔误；实际迁移是 `002_pilot_grading.sql`，上方新验收记录给出了实际执行路径及命令。手工操作应以实际文件和 package script 为准。
- 收尾沿用用户已明确的现有生产分支推送部署决定，保留工作树、私密配置和一次性调用账本；不额外发起合并/PR 或删除生产分支。
