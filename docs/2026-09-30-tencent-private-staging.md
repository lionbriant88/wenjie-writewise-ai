# 腾讯云服务器私下预演（已通过）

用户已明确授权建立72小时受限SSH迁移通道并继续部署。此记录不是正式上线或备案通过证明；旧Vercel/Supabase源站仍保留，未切DNS，未调用真实模型。

## 已验证

- 2026-09-29 21:01:48北京时间，TAT创建无sudo的wj-deploy。公钥过期时间2026-10-02 21:01:47北京时间；仅允许转发127.0.0.1:8793。home/.ssh/authorized_keys由root拥有，传输账号不能替换过期限制。主机密钥使用此前TAT读取的指纹固定校验。
- 受限SSH实际登录成功；Node24.21.0、PG17.11、根盘约51GiB可用。没有设置或回显服务器登录密码。
- reviewed-02包上传、root受保护副本SHA校验及完整manifest验证成功。umask077暴露安装器cp后代码目录0700问题；修复为仅对无秘密release代码`a+rX,go-w`，服务账号读取程序、私有目录写入、代码不可写探针通过。业务服务均inactive，公网未开80/443。
- PG仅监听127.0.0.1:5432、SCRAM、严格TLS、未加密连接拒绝。迁移管理员凭据在服务器内生成，只存root0600；运行角色单独生成，不复制源密码。
- 初版证书SAN只有IP127.0.0.1：psql verify-full通过，但Node pg回报ERR_TLS_CERT_ALTNAME_INVALID/localhost。保留原证书/脚本，重签同CA证书加入DNSlocalhost，IP与名称校验和Node实际严格TLS均通过，没有关闭校验。第一次恢复失败在数据库连接前，新库数量为0，报告保留。
- 新源只读备份目录2026-09-29T13-09-29.957Z-3e9ff7db-adb2-4471-ad6b-4f9d5a6acb8f：22表，6对象，缺图/摘要与关联差异0，清单稳定。该备份来自可写在线源，不能作为正式切换最终冻结备份。
- 2026-09-29 21:55:41，目标隔离库writewise_staging_8a95e70b675c恢复通过：原22表99行规范摘要不变，31账号和密码哈希保留，迁移后25表，6对象8,789,177字节，10上传关联；权限、禁改密触发器和约束验证通过。数据库保持冻结；0队列消费、0真实模型调用、API/worker/maintenance尚未启动。

## 当前制品与证据

- reviewed-02历史包：SHA256 e05439b5f6793d10bc6fe6238f67783fcb7d75570e1f20f4f3ca6aa77ea195be。
- reviewed-03重新构建及实机安装通过，包含安装权限修复；13,640,659字节，SHA256 f5172f9e3a2d6a7610c95e8d9e237b1e92588c29ce3af81610c46567592b8a90。
- 服务器源恢复报告：`/srv/writewise/reports/restore-8a95e70b675c/`。配置及运行连接均为服务器私密文件，勿输出。
- 本地私密操作脚本/截图：`local-private-accounts/tencent-migration/server-staging/`及`ssh-transfer/`；源备份和失败报告均保留。

## 2026-09-30新增实机验证

- 06:21:50，reviewed-03安装和umask077权限探针通过。目标完整备份`/var/backups/writewise/staging-22ec86b2614c`成功，第二个新库`writewise_restore_22ec86b2614c`及独立原图目录恢复成功：25表100行、31账号、6对象、10关联均一致；没有重跑SQL迁移，两库保持冻结、第一库摘要未变、0模型调用。
- 06:25:25，独立合成库`writewise_standalone_d521e643b803`完成Linux实机PG/HTTP验收：严格TLS双受限连接、冻结排空、中断与后端死亡、租约及进程重启、并发峰值1、重投不新增调用、未知结果不重发、上传原字节与结果保存/重登恢复、教师隔离、配额竞态和PUT/删除锁等待均通过。真实模型调用0；测试数据与报告保留。首次runner因固定`/usr/bin/node`不存在而exit127（测试未启动），改用实际`/usr/local/bin/node`完成；失败空输出及stderr仍保留。
- 备案控制台刷新后仍为腾讯云审核中，尚未提交管局。没有将私下演练视为正式上线。

## 尚未完成

正式冻结/切换、备案、HTTPS及国内无VPN验收仍待完成。备案控制台当前仍为腾讯云审核中。不要解冻复制的历史业务库，也不要重新询问已批准的迁移设计。

## 最终私下预演状态

- 目标备份7,642,778字节已通过受限SSH取回本机，归档SHA256 f4e1a5e9fe71dec2b4bf16b6af9904a285da9471b9dbc0cbd03066aa051d49e5与服务器一致；解包后再次验证dump、6原图及关联，全部通过。机外证据在ignored server-evidence/offsite-verification.json。
- 07:43:36，真实systemd API首次启动及重启均通过：只监听127.0.0.1:8793，登录/session/readiness均返回503 migration_frozen且不设置会话；25表100行摘要集合前后均为2311a5504b57b1cf2469779396ba2807973aeb9b986d9312e9c6d90c094b2cde。Nginx离线语法通过、日志未发现凭据或SQL语句，测试结束API已停止，后台服务及Nginx仍停止，公网只保留SSH。
- current指向reviewed-03；runtime.env为root:wj-app0640，包含新受限DB连接、CA与独立签名配置，但DeepSeek key明确为无效合成占位值。不能直接解冻上线；真实key尚未传入腾讯云。
- 该阶段验证的是数据恢复和服务器运行机制，不是正式生产切换。未向真实模型发送请求，未消费迁移来的作业，未改变源站写入或域名。实际断电硬件耐久性和新写入反向同步未验收。
