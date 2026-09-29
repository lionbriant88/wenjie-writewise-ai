# 2026-09-29 手机拍照及 JPEG 上传修复

## 故障与证据

- 用户设备：安卓、vivo 自带浏览器。拍照入口打开相册；约 2.85 MB JPEG 上传后持续显示未完成确认。
- 只读检查确认，两次原图对象均已存在，字节数及 MIME 与预约记录一致；失败不是 8 MiB 限制或原图丢失。没有修改用户任务、保存或展示图片、调用模型。
- 该 JPEG 的 SOF 位于字节 312232，尺寸 1836×4080。前部有 APP1、APP2 和多段 APP4；旧尺寸解析器将整个文件偏移限制在 64 KiB，因此返回 unknown，并触发上传确认的 invalid_image。
- 拍照 input 原先复用相册的具体 MIME 列表。部分 Chromium 实现要求唯一 `image/*` 才进入 captureImage 分支。依据：[Chromium 官方实现](https://chromium.googlesource.com/chromium/src/+/2248f9ed5016f30876f93b4b34e250bc24af2c62/ui/android/java/src/org/chromium/ui/base/SelectFileDialog.java)、[W3C capture 规范](https://www.w3.org/TR/html-media-capture/)。vivo 的实际唤起行为仍需真机验证。

## 修复

- 拍照入口使用 `accept="image/*"`，保留 `capture="environment"` 和单文件选择。处理阶段继续只接收 JPEG/PNG/WebP，单张上限 8 MiB。
- JPEG 解析按已校验的段长跳过元数据，64 KiB 限制用于实际头部解析工作量，不再限制 SOF 的绝对偏移。保留截断、非法段长、SOS/EOI 终止、尺寸边界与解析工作上限。
- 原图字节不压缩、不重编码；既有上传恢复逻辑可重新确认云端 reserved 对象。没有数据库迁移、密钥变更、模型调用或评分合同变更。

## 本地验证

- 新增 JPEG 尺寸与上传 service 回归先分别复现 unknown / invalid_image，再通过修复转绿。
- 相机参数用例先红后绿；通过相机和相册入口验证 GIF、HEIC、超过 8 MiB 的图片仍被拒绝。
- 前端 94 文件 / 1381 项、Gateway 56 / 1393、Platform API 26 / 102 全部通过。
- 前端 lint/typecheck、Gateway 和 Platform typecheck、共享评分运行时检查、根目录 production build、diff check 通过。
- 独立只读复核无 Critical/Important/Minor；额外内存探针覆盖 SOF 类型、混合 APP 长度、截断、非法长度、SOS/EOI、填充及大量短段，无越界或无界工作发现。

## 上线与公网验证

- 产品修复 `f1be54a` 已推送。Production `dpl_7gCHcBjDzNWMFqNbfeYTQHb6Fcnc` 于 2026-09-29 显示 Ready，构建 1m 11s，正式域名已分配该部署。
- 一次性合成验证通过：有效 32×32 JPEG 加 5 段最大 APP4，共 328328 bytes；Storage PUT 200、complete 200、list verified、短签名读取 200 且 SHA-256 与原图一致、退出重登仍 verified。
- 本次模型调用为 0。只创建专属合成任务，成功后逻辑删除并确认读取 404；两次会话均退出并验证旧会话 401。合成对象保留到上传签名失效后按现有维护规则清理，未声称物理对象立即删除。
- 对用户原图只做诊断：新解析器已能只读识别相同字节的 1836×4080 尺寸。没有替用户确认、删除、附加或批改真实作文。用户可刷新后重新检查并恢复原有上传；两次同名预约需按实际需要选一份。
- vivo 真机唤起相机仍需用户复验；capture 属性及桌面测试不能保证浏览器实现。
- ignored `local-private-accounts/mobile-upload-diagnosis/` 保存 `metadata.json`、一次性 `public-verification-reservation.json`、`public-verification.json` 和 `deployment-ready.png`。不得删除预约盲目重跑。
