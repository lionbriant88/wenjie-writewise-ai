# 腾讯云迁移前备份与隔离恢复验证（2026-09-29）

用户回复“进行吧”，授权先完整备份现有数据、验证恢复，再推进迁移。本次已完成一次可恢复快照的验证；业务尚未迁移腾讯云，旧站保留，ICP备案仍在腾讯云审核中。

## 备份结果

| 范围 | 已核实结果 |
| --- | --- |
| 数据库 | `pilot_auth`、`pilot_grading`，22表、99行 |
| 账号 | 31个，30教师及1独立管理员；保留现有身份和数据 |
| 数据归档 | custom格式 `application.dump`，71,037 bytes |
| 私有原图 | 6个对象，合计8,789,177 bytes |
| 完整性 | 缺少必需对象0、上传记录/对象摘要不符0、备份前后对象清单不变 |
| 模型调用 | 0次 |

通过严格TLS只读连接取得数据库snapshot；custom dump、22表行数/规范摘要、权限元数据和对象关联来自同一snapshot。表摘要按SQL `to_jsonb(t)::text` 以C排序逐行追加换行计算SHA-256，固定UTC、ISO DateStyle、浮点及bytea输出格式，避免JavaScript数值或时间转换改变证据。Storage原图按清单下载，保存原字节、大小、类型和SHA-256；没有压缩或重编码。

PostgreSQL17.11客户端采用PostgreSQL官方推荐的EDB HTTPS便携包，仅解压到ignored私密工具目录，未作系统安装。首次沙箱EACCES发生在连接前、0表；失败目录保留。取得联网许可后使用独立目录完成成功备份，没有删除失败证据或调用模型。

## 恢复验证

在本机独立PostgreSQL17.11、严格TLS `127.0.0.1:56439` 上新建随机空数据库恢复。两个wj角色保持NOLOGIN，不复制源数据库密码；未启动API、worker或维护任务，queued/unknown状态没有被消费，也没有模型调用。

`restore-verification.json` 已确认：

- 22表、99行的规范摘要与源snapshot逐表一致。
- 6个本地原图文件的大小与SHA-256一致，10条upload记录及关联分类复验通过。
- 31账号数量及身份数据随表摘要验证保留；受限运行权限、禁改密触发器的回滚探针及外键验证通过。
- 恢复操作未修改源数据，应用进程未启动，恢复完成。

验证后已运行 `pg_ctl stop`，并通过 `pg_ctl status` 的“no server running”状态断言确认恢复实例停止。恢复目录和全部证据保留，没有删除数据库或重建线上账号。

## 证据与限制

成功备份目录位于实际工作树Git ignored路径：

`local-private-accounts/tencent-migration/backups/2026-09-29T10-28-54.404Z-1db7e2a5-3ecb-4356-9fd2-a41a76b0d318/`

其中 `summary.json`、`manifest.json`、`metadata.json`、`application.dump`、原图文件及 `restore-verification.json` 保留原始证据。凭据、个人资料和学生正文不进入本文或普通日志；运维脚本为ignored的 `backup-source.mjs`、`restore-drill.mjs`，不是产品代码改动。

源服务在线且未停写，本次是已验证可恢复的快照，不是最终切换备份。最终切换仍须冻结写入与清理、处理在途状态，再创建新备份并核验；未知模型结果不得盲目重发。尚未建立长期自动备份调度。后续继续准备Vercel平台依赖、国内私有存储、反向代理和服务启动的适配方案，保持DeepSeek官方直连、v2、无OCR和全站并发1。本轮产品代码未改，未提交或推送。
