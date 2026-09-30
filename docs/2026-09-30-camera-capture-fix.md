# 2026-09-30：网页摄像头拍照修复与腾讯云私测部署

用户反馈点击“拍照上传”只打开相册。旧实现依赖文件选择器的 `capture` 提示，不能保证 Windows Edge/Chrome 调起摄像头。本次新增网页拍照窗口，保留相册上传入口；修改已完成本地验证、GitHub 推送、腾讯云私测部署及浏览器复验。

浏览器行为参考 MDN 的 [capture 属性说明](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture) 与 [getUserMedia 安全上下文及授权要求](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)。

用户随后明确反馈“已看到实时画面，可以拍照”，确认本次电脑端人工复测可以打开实时画面并拍照。该反馈尚未覆盖照片确认加入、上传或再次批改；Windows 希沃设备和 vivo 手机仍需各自实机验收。

## 最终行为

- “拍照上传”直接打开 `CameraCaptureDialog`，使用 `getUserMedia` 请求视频，不请求麦克风。未指定设备时优先请求后置摄像头；授权后可从浏览器识别的摄像头列表选择设备，包括系统已识别的 USB 展台。
- 画面实际就绪后才能拍照。以当前视频帧的宽高生成 PNG，不额外缩放、裁切或有损压缩；单张超过 8 MiB 时不加入作文，也不偷偷压缩。该分辨率是浏览器协商后的视频分辨率，不宣称传感器的最高原始分辨率。
- 拍摄后先预览，可重拍；仅点击“使用这张照片”才加入当前学生，随后沿用已有图片校验、整理和上传流程。打开拍照窗口期间不能提交批改。
- 权限拒绝、无摄像头、设备占用、设备断开、浏览器不支持或不安全页面均提供对应提示与重试路径。关闭、切换、重拍、摄像头启动失败和组件卸载会释放相关摄像头流或图片预览资源；过期异步返回不重新占用摄像头。
- 页面使用原生模态对话框，支持 Escape 关闭及关闭后恢复焦点。普通服务器 HTTP 地址不具备本功能所需的安全上下文；当前本机入口为 `http://127.0.0.1:18793`，正式公网入口仍待备案和 HTTPS。

本次只修改前端。DeepSeek 官方直连、v2、无独立 OCR、全站模型并发 1、教师隔离和未知结果不盲重试均保持；代理没有为拍照修复新增模型请求。

## 本地与 GitHub 验证

- 前端全量：95 个文件、1402 项通过。
- 摄像头专项：16 项通过；相关集成复验为 2 个文件、14 项通过。
- 类型检查、lint、构建通过；独立代码及运维复核未留下 Critical 或 Important 问题。
- 产品提交 `b7d890ee46968cd2c96964a636098da87d830ccf` 已推送 `codex/tencent-migration`。该分支仍禁用自动 Vercel 部署，旧 Production 分支及服务未切换。

上述自动化验证覆盖设备 API 的受控行为，不能替代真实摄像头、希沃硬件或手机验收。

## 包、部署和数据保护

| 项目 | 已核验值 |
| --- | --- |
| 私测 release | `20260930-camera-preview-02` |
| 构建对应提交 | `b7d890ee46968cd2c96964a636098da87d830ccf` |
| 归档 SHA-256 | `274cb9a80f70f8d2293ce1f91c82728df765b6f840625a00bf95dd77fb3ce187` |
| 归档大小 | 13,639,784 bytes |
| 清单文件 | 3797 项；3790 个非 public 文件与 reviewed-03 一致 |
| 本机 HTTP 页面资源 | 7 项逐字节匹配新包 |
| 最终运维入口 SHA-256 | `f91758029ad00d7a0ec0213286c7ec71246c819d99040782675b3bb23ea39948` |
| 切换前 preview dump SHA-256 | `5ac4cfaa732e3e36033f1f6ff32a80f3a8db094d68c4bf5941cd0310a5b452cf` |

首次安装在截止时间检查处因 `CST` 时区缩写歧义而保护退出。当时该次 STATE、staging 和 release 均不存在，服务尚未停止。为运维命令的干净环境显式增加 `TZ: 'UTC'` 后重新安装成功；保留首次失败证据，没有忽略截止检查。

北京时间 12:26:12 开始排空，仅停止独立私测 API 和 worker。确认两项临时 unit 均为 inactive/not-found、全库 provider gate 空闲、没有运行中或未知执行及遗留准入后，先保存当前 preview 的 25 张表和 2 张原图私密快照，数据库摘要前后一致；未恢复覆盖、重建账号或重新 bootstrap。

12:27:34 新版 `wj-private-preview-manual-api` 与 `wj-private-preview-continuous` 启动，readiness 为 true。实际 ExecStart 和 WorkingDirectory 都指向新版本，检查时 NRestarts 均为 0。使用原 preview 数据库、账号、会话及图片目录，单次验证 ledger 保持原样。

本机代理已切为 `local-preview-camera.mjs`，读取新 release 的 public 目录；原 SSH 转发保持。`/srv/writewise/current` 仍指向 reviewed-03，私测使用绝对版本路径，不依赖该全局链接。`preview-config.release` 仍记录旧 bootstrap 身份，未为改变运行版本而改写历史证据。

22:00 北京时间的绝对停止定时器和 worker 截止时间不变；SSH 仍于 2026-10-02 21:01:47 北京时间到期。没有开放公网、改 DNS 或停止旧 Vercel/Supabase 服务。

## 部署后验收与边界

12:30:39 只读审计确认：两个历史恢复库仍冻结，表和原图摘要未变；原两个批改作业仍各一次模型执行，provider gate 空闲，教师修订与确认记录保留。代理本轮新增模型调用为 0。

Codex 内置浏览器刷新后保持登录，原任务仍显示 2/2 完成；“拍照上传”打开网页模态窗口，已不再调用相册文件选择器。该内置浏览器停留在摄像头权限等待状态，没有取得实时画面。用户随后在自己的电脑浏览器中确认“已看到实时画面，可以拍照”；这是独立的用户人工证据，不能与内置浏览器画面混为一项验收。复验结束后已关闭上传页的拍照窗口并释放相机，页面保留供用户继续测试。

目前可确认电脑端实时画面与拍照已通过用户复测。新照片是否点击确认加入、上传、完成批改，以及希沃和 vivo 的实际兼容性，尚无本轮证据；不扩张为这些流程已通过。正式域名、国内手机与 Wi-Fi 无 VPN 的完整流程及正式迁移仍另行验收。

证据保存在实际工作树 ignored `local-private-accounts/tencent-migration/private-preview/`：`camera-artifact-receipt.json`、`camera-proxy-verification.json`、`camera-deployment-ui-evidence.txt`、`camera-preview-dialog.png`、`camera-post-deploy-audit.json`。秘密、账号清单、原始图片和数据库快照不进入普通文档或 Git。
