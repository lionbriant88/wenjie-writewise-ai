# 腾讯云私人浏览器验证

用户要求现在验证，并选择经已有受限SSH通道完成一次合成作文的真实批改。此记录针对独立私人测试环境；正式生产、域名和原冻结恢复库未切换。

## 环境与范围

- 版本：`20260929-migration-reviewed-03`；实际工作树分支 `codex/tencent-migration`。
- 独立数据库：`writewise_private_preview_58f2d47ca236`。新建1个合成教师，不复制或重建原31个账号。
- 入口：`http://127.0.0.1:18793`。本机原版静态前端和同源代理，经SSH本地18794转发到服务器127.0.0.1:8793；没有新开放公网端口。loopback开发Cookie与专用Origin仅供本次私人测试，数据库继续严格TLS。
- 旧Vercel/Supabase继续保留；`writewise_staging_8a95e70b675c` 与 `writewise_restore_22ec86b2614c` 保持冻结，原 `/etc/writewise/runtime.env` 不作私人测试配置。
- 脚本、测试账号、截图和安全报告均在ignored `local-private-accounts/tencent-migration/private-preview/`。真实key不写入普通文档、命令参数、TAT或日志。

## 已完成浏览器验证

人工确认评分标准，满分15分，内容40%、语言40%、结构15%、可读性5%；不调用AI生成评分标准。唯一输入为仓库合成图 `test-fixtures/kimi-policy/grammar-and-logic.png`，44,739字节，1200×700，SHA256 `f5efcdb5ff50e91537df5fc6732568f07eda9787651020a263331707409d4011`。

真实DeepSeek返回9/15、`partial`。三句正文与合成输入匹配，CASE页眉被排除。界面保留总分重算、证据定位和维度依据不足三项复核提示；这证明技术闭环可用，不证明真实手写质量或反馈完整性。

已验证真实私有原图读取、保存教师补充反馈、刷新恢复、退出重登恢复，以及教师确认。合成任务与作文保留供用户查看：

- 任务：`c5e16f4c-e6a6-4b9d-a668-0330bc668286`。
- 作文：`ceb77ccd-1dab-4f96-b283-0e50fa0b4428`。

## 调用边界与最终实机审计

一次性worker仅允许第一个新建单图grade任务，在实际官方HTTP POST前以排他创建、文件及目录同步持久预留最多1次completion，阻止重启、并发和未知结果重发。API使用无效占位key并禁用外部fetch；真实key仅由独立worker读取服务器私密文件。正式长驻worker和维护任务未为此次测试启用。

2026-09-30 10:14:41北京时间最终审计通过：

- 唯一任务作业 `d39fe603-ad72-4234-931d-1cd416700d3a` 为 `partial`，任务attempts为1、执行尝试记录1；执行已finished，10:09:40.693开始、10:09:46.667结束，约5.974秒。
- Worker报告reservedCalls=1、externalFetchInvocations=1、blockedFetchInvocations=0、HTTP200、cleanupPassed=true，结束原因为first_delivery_completed。systemd状态inactive、Result=success、Exit0；没有后台worker继续等待新作业，provider gate空闲。
- 一次性ledger永久保留 `reserved_outcome_unknown` 是不退回额度的预留状态；实际模型任务已得到确定的partial结果，不能将该ledger字段误称为任务结果未知，也不能删除预留再次调用。
- 新库1个账号、1个任务作业、1张原图；保留1个浏览器会话供用户查看。教师修订版本4，teacher_reviewed=true。新原图44,739字节，SHA256与上方合成fixture完全一致。
- 两个旧恢复库仍冻结，各25表100行，规范表摘要集合仍为 `2311a5504b57b1cf2469779396ba2807973aeb9b986d9312e9c6d90c094b2cde`；各6张原图、8,789,177字节未变。旧生产继续保留。

安全审计报告已取回ignored私人测试目录，文件名为 `private-preview-audit-58f2d47ca236-6c986bc0-dc3b-46d7-8d34-a692332c0339.json`，另保留对应worker报告；浏览器恢复截图为 `local-private-accounts/tencent-migration/private-preview/preview-restored.png`。本轮真实调用数为1；前阶段0次真实调用的记录仅适用于先前恢复预演。

离线运维边界检查通过：本机代理3项、一次性worker6项及脚本语法检查。独立复核未发现阻断问题；以上真实调用和清理结论另有本次服务器审计支持。

## 临时入口与下一步

临时服务 `wj-private-preview-api` 于北京时间2026-09-30 10:07:31启动，`RuntimeMaxSec=7200`，预计约12:07停止。本机代理与SSH通道暂留，当前保留登录后的已确认结果页供用户查看；入口不是长期服务。一次性worker已退出，不能继续提交第二次批改。测试账号保存在ignored私密access文件，不放入本文。

原SSH授权到北京时间2026-10-02 21:01:47，不自动延长。保留合成记录、一次性预留和成功/失败证据；不得通过删除预留再发请求。

正式迁移仍待备案、源端共同冻结与排空、旧上传窗口确认、最新完整备份及恢复验证、显式队列衔接、HTTPS和单写者切换。私人隧道验证不能替代国内手机流量/Wi-Fi关闭VPN、公网域名或批量吞吐验收。
