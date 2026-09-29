# 腾讯云独立运行包

本目录提供可重复构建与安装模板；未执行生产迁移、DNS切换或真实模型测试。

## 构建

从仓库运行 `npm --prefix platform-api run build:standalone -- <版本>`。版本只允许字母、数字、下划线和连字符；已存在的版本目录拒绝覆盖。离线缓存齐备时加 `--offline`。

产物在 `build/tencent/<版本>/` 和同名 `.tgz`。编译保留 platform-api、grading-gateway 和共享 app 源码的相对模块路径；两服务各自执行锁文件 `npm ci --omit=dev --ignore-scripts`，分别保留 Express 5/4 依赖边界。SQL位于 emitted migrate 模块相邻 migrations 目录。产物仅包含编译后的依赖闭包、前端静态资源、SQL、生产依赖、部署模板和 SHA-256 清单；不复制本机 node_modules、私密目录或环境文件。环境示例含占位符，不能直接上线。

## 私下预演

1. 本机先对 `.tgz` 计算SHA-256，单独保存可信摘要。通过已核验主机身份的SSH通道，以无sudo的传输账号上传到 `/home/wj-deploy/incoming/<版本>.tgz`。不要把生产密码、key或管理员连接串放入TAT命令、日志或聊天。
2. root通过既有受控管理通道创建 root:root、0700 的 `/srv/writewise/staging`，先把上传归档复制到该目录并置为root所有、0600，再对这份root副本校验本机保存的可信SHA-256。不要从incoming执行任何脚本，也不要用同目录可修改的checksum/manifest作为信任来源。摘要不符即停止并保留证据。摘要通过后才在root staging内解包（无group/world写权限），执行 `sh /srv/writewise/staging/<版本>/deploy/tencent/install.sh /srv/writewise/staging/<版本>`。安装器额外核验root目录及文件权限、完整文件摘要，创建无登录权限的 `wj-app`、私有目录及systemd单元。它不创建/迁移数据库、不改防火墙、不启动服务、不切换current链接。先复制进root目录再验摘要，可防止传输账号在校验后替换代码。
3. 备份后将数据恢复到独立目标库；PG仅监听127.0.0.1，开启严格TLS、SCRAM和本机受限pg_hba。创建新LOGIN运行角色并仅继承 `wj_auth_runtime`，不复制源密码，不将管理员角色写入运行环境。用管理员会话应用002、003、004 migration；重复执行为幂等，但仍需先备份。迁移脚本不会启动worker。
4. 通过核验加密通道保存 `/etc/writewise/runtime.env`（root:wj-app，0640）。CA可使用EnvironmentFile支持的引号多行PEM，应用禁止跳过TLS校验。原图在 `/var/lib/writewise/originals`，目录0700、文件0600。保持 `PILOT_WORKER_ENABLED=0`、`PILOT_MAINTENANCE_ENABLED=0`，恢复快照的queued/unknown任务禁止消费。
5. 核对版本后由root设置 `/srv/writewise/current` 指向该release，再启动API。已授权SSH转发8793时仅测试API；Nginx的127.0.0.1:8080模板可在服务器本地检查，8080浏览器隧道须有相应转发授权后再使用。`/api/health/ready`在worker未启动、冻结、PG权限/存储不满足、10GiB余量不足时返回503，不能把登录成功当完整就绪。检查只读且不调用Provider。API仍仅监听127.0.0.1:8793。systemd使用专用standalone入口，丢失mode配置也不会回落到账号站点。
6. 合成预演使用独立空库/新建合成数据和测试注入的fake provider；不要把生产DeepSeek配置用于恢复数据试跑。正式worker严格使用既有DeepSeek单次多模态流程，不提供环境开关绕到假provider。调用真实合成模型前另行明确范围。

## 正式切换前

必须完成源码侧共同冻结、排空所有实际异步效果、旧2小时上传签名窗口及未知结果检查、新冻结备份、目标表/文件摘要与关联验证、备案和HTTPS。此部署包不代替该流程。

源Vercel可显式开启 `PILOT_MIGRATION_GATE_ENABLED=1`（先应用004并使用支持session advisory lock的直接或session连接，禁止transaction pooler）。默认Supabase/Vercel不变；API认证、session GET、管理员、业务接口、队列回调、维护及存储效果共享冻结门。管理员冻结/解冻权限不授予运行角色。

确认旧worker仍冻结，目标数据/域名条件满足后，显式将目标 `PILOT_WORKER_ENABLED=1` 并 `systemctl start writewise-worker`；worker服务刻意没有Install目标。另行开启maintenance环境开关及timer。安装不会自动启用两者。模型并发仍为1，队列一次租一个投递；重复/失败使用原身份，有界30秒延期。SIGTERM先停止新claim并等候实际执行；强制杀进程会留下准入标记，必须人工调查，不能自动清理或盲目重发。

最终将Nginx监听切到已验证证书的443（80仅重定向）并检查 `nginx -t`。forwarding头始终覆盖，API只信任显式loopback代理。无访问日志，错误日志模板关闭，避免query签名和正文泄露。秘密轮换与新版本发布前保存机外备份；本包不建立备份调度。

健康检查成功仅说明进程/权限/私有磁盘/近期活跃worker就绪；真实质量、国内关闭VPN的手机/Wi-Fi流程和吞吐须另验。新站写入后回退必须先冻结并反向同步新数据，禁止直接切回旧快照。
