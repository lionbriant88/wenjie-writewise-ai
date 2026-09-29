# 独立部署目标端完整备份及恢复

此工具覆盖腾讯云部署后的 PostgreSQL 应用 schema 和私有磁盘原图；不连接旧 Supabase/Vercel，不启动 API/worker/maintenance，不调用模型。它是手动冻结备份工具，不建立周期任务。本地离线测试不代表目标服务器备份或恢复已经执行。

## 目标备份配置

把以下结构保存在服务器私密文件 `/etc/writewise/backup.json`，owner root，mode0600。实际密码由已授权加密通道写入文件，不放命令行、聊天或源码。服务端运行环境仍不得使用管理员连接。

```json
{
  "format": "writewise-target-backup-config-v1",
  "databaseUrl": "postgresql://BACKUP_ADMIN:PRIVATE_PASSWORD@127.0.0.1:5432/writewise_pilot",
  "expected": {
    "host": "127.0.0.1",
    "port": 5432,
    "database": "writewise_pilot",
    "user": "BACKUP_ADMIN"
  },
  "caFile": "/etc/writewise/postgres-ca.pem",
  "originalsRoot": "/var/lib/writewise/originals",
  "pgBin": "/usr/lib/postgresql/17/bin"
}
```

URL禁止query覆盖TLS，host必须为字面127.0.0.1，dbname必须以writewise_开头；expected各字段必须与连接及实际PG身份一致。CA必须验证通过，PG必须17系列。目录均为绝对规范路径，不接受符号链接。备份root由操作者预先建立，私有且与原图目录分离；每轮输出目录必须全新。

## 执行备份

先通过独立管理员冻结命令冻结目标；停止新写入后等待所有admissions归零。存在calling/preparing/result_unknown、running/unknown任务或占用的provider gate时，本工具拒绝备份，不能清理这些状态来让备份通过。冻结命令报告blocked时必须先调查实际操作，不重发未知模型调用。

API可保留在线返回维护状态；worker/maintenance必须保持冻结和停止。源Supabase切换冻结还须独立等待旧上传签名窗口及确认远端PUT结束，目标磁盘备份工具的排空判断不能替代源端窗口。

在已校验release内执行（替换目录时间戳，每轮一个新目录）：

```sh
node /srv/writewise/current/deploy/tencent/backup-target.mjs \
  --config /etc/writewise/backup.json \
  --output /var/backups/writewise/2026-09-29T120000Z
```

成功exit0且输出complete=true；其他结果视为失败，保留该目录和manifest/summary。输出仅固定状态和计数；管理员URL不回显。pg_dump日志只写新备份目录的0600文件。脚本始终只读数据库/原图；它不会自动解冻。完成后操作者仍须按既定切换或恢复流程显式决定解冻。

- 两应用schema必须精确含25张表，包括deliveries、migration_control、migration_admissions；缺表/多表/重复表不接受。
- REPEATABLE READ READ ONLY事务导出快照，pg_dump使用同一snapshot；逐表规范行摘要与archive SHA-256保存在manifest。
- 原图只接受双层UUID、普通单硬链接文件、单张不超过8MiB、总计不超过20GiB、最多200000对象；临时文件、符号链接、额外目录和无法关联upload的对象均阻断。
- 原图不重编码。所有对象与uploads的size/MIME/hash和材料/作文/job关联核对；保留逻辑删除但未purge对象。仅无引用reserved且原本缺文件允许缺失。
- 再扫描磁盘并重算全库摘要；冻结状态变化、任一表变化或文件清单/hash变化均失败。pg_dump最长5分钟、归档最大2GiB，失败保留产物不宣称完整。

私密备份应通过核验主机身份的加密通道复制到独立存储，再验证archive及每对象摘要；只把同一磁盘上的目录视为临时备份，不声称具备灾难恢复保障。

## 恢复演练与回退约束

1. 校验新备份summary.complete、两个完成标记、零missing/mismatch、manifest精确25表及所有文件SHA-256。不得接受只有pg_dump而没有原图的目录。历史Supabase22表备份仍由原工具验证，不能改写其原manifest来伪造25表。
2. 在独立空PG17库创建/核验NOLOGIN受限wj角色，pg_restore使用严格TLS、`--no-owner --single-transaction --exit-on-error`。不要把源管理员或源运行密码复制成目标服务凭据。恢复导出的冻结行保持冻结，worker/maintenance禁用；不得消费复制的queued/unknown任务。
3. 原图在独立空私密目录恢复，按manifest对象path恢复双层UUID，并使用独占创建拒绝覆盖；每文件0600、目录0700、owner为目标服务账号。Linux上先同步每个文件内容，再同步对象目录和存储根目录，不能只依靠writeFile返回判断断电持久性。对恢复后磁盘重新扫描，按manifest重新核对完整清单、原字节摘要和uploads关联后，才可以配置为运行目录。临时/失败恢复目录保留，不能与现有运行原图混合。
4. 重新计算两个schema全部表的规范行摘要和行数，核验教师30+管理员1、账号状态、禁改密触发器、外键、运行角色权限以及migration gate函数权限。privileges检查应包含`assertPilotRuntimePrivileges`和`assertMigrationRuntimePrivileges(db,true)`。禁止通过重建账号代替恢复。
5. 本机既有`local-private-accounts/tencent-migration/restore-drill.mjs --backup-dir <私密备份目录>`已支持历史22表和迁移25表、按backend精确清单及两类权限检查，保留31账号要求。它创建独立随机库、不启动服务，并使用独占新证据文件；不修改历史恢复证据。该工具用于本机演练，不能直接复制其本机连接配置到服务器。它验证备份对象字节/关联，**不自动发布到运行原图目录**。
6. 目标已经接收新写入后的回退，必须先冻结目标、使用此完整工具生成新备份并验证，再把新库数据及图片反向同步到旧后端并复核。不得只切DNS或恢复旧快照。仅恢复成功而没有双端写入栅栏/反向图片同步，不能解除冻结。

本机已用独立严格TLS的PG17.11和纯合成数据执行真实pg_dump及完整数据库+图片恢复：25表44行、30教师+1管理员、1张PNG、零摘要或关联差异，恢复库保持冻结，未启动应用或worker，0次模型调用。证据保存在任务私密验收目录。这不等于腾讯云服务器验收；Linux/systemd及腾讯云目标的完整恢复演练仍属于Task7，必须有独立执行证据后才能声称完成。此轮未连接旧云源或腾讯云目标。

## 离线自测

```sh
node deploy/tencent/backup-target.test.mjs
```

测试不联网。包括配置/身份/TLS覆盖拒绝、22/25表清单、冻结/未知状态拒绝、真实临时目录的原字节复制、文件缺失/摘要不符/多余对象、限额/临时文件/符号链接/硬链接、目录不覆盖，以及fake SQL+dump的快照传播和失败产物保留。fake结果不构成服务器备份验收。
