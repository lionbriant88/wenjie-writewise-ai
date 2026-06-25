# 如何在 Codex 中创建“文阶 WriteWise AI”项目

## 1. 先在 D 盘创建项目文件夹

在 Windows 文件资源管理器中进入 D 盘，新建文件夹：

```text
D:\wenjie-writewise-ai
```

建议再创建这些子文件夹：

```text
D:\wenjie-writewise-ai\docs
D:\wenjie-writewise-ai\app
D:\wenjie-writewise-ai\server
D:\wenjie-writewise-ai\assets
D:\wenjie-writewise-ai\data
D:\wenjie-writewise-ai\exports
```

各目录用途：

- `docs`：产品需求文档、开发任务清单、设计说明。
- `app`：第一阶段网页原型和后续前端代码。
- `server`：后续后端服务代码。
- `assets`：图片、图标、演示素材。
- `data`：mock 数据、测试作文样本。
- `exports`：导出的 PDF、PPTX、演示文件。

## 2. 把当前文档放进 docs 文件夹

当前已经生成的两个关键文档是：

```text
wenjie_writewise_ai_prd_v0.3.md
phase_1_static_prototype_task_list.md
```

建议把它们复制到：

```text
D:\wenjie-writewise-ai\docs
```

如果你愿意，也可以稍后让我帮你迁移。但因为当前 Codex 聊天工作区不一定直接拥有 D 盘写入权限，最稳妥的方式是你先在文件资源管理器里创建项目，然后在 Codex 中打开它。

## 3. 在 Codex 中打开项目

在 Codex 桌面应用中：

1. 回到左侧项目区域。
2. 点击添加项目或打开项目。
3. 选择文件夹：

```text
D:\wenjie-writewise-ai
```

4. 确认后，Codex 会把这个目录作为项目根目录。

以后你在这个项目里发给 Codex 的任务，都会默认围绕这个目录进行。

## 4. 新建项目后的第一句话

打开项目后，建议你在新项目线程里发送：

```text
这是“文阶 WriteWise AI”项目。请先阅读 docs 文件夹里的产品需求文档和第一阶段静态原型开发任务清单，然后总结你对项目目标、MVP 边界、目录结构和第一阶段开发任务的理解。暂时不要写代码。
```

这样做的目的，是让 Codex 先吃透项目背景，不要一上来就乱写代码。

## 5. 确认理解后再开始开发

等 Codex 总结完，你可以继续发：

```text
理解正确。现在开始开发第一阶段静态网页原型。

要求：
1. 前端项目放在 D:\wenjie-writewise-ai\app。
2. 使用 React + TypeScript + Vite + Tailwind CSS。
3. 不接真实后端、不接真实 OCR、不接真实 AI，全部使用 mock 数据。
4. 实现任务列表、创建任务、上传作文、多页整理、批改进度、异常复核、单篇作文结果、班级讲评页。
5. 页面面向初高中英语教师，清晰、专业、实用。
6. 白板讲评页适合横屏大屏展示。
7. 完成后运行项目，检查页面是否正常，并告诉我本地预览地址。
```

## 6. 推荐使用 Local 模式

第一阶段建议使用 Codex 的 Local 模式。

原因：

- 代码会直接写在你的 D 盘项目目录里。
- 你可以立刻看到文件变化。
- 可以本地运行网页。
- 适合你这种从 0 到 1 慢慢打磨产品的过程。

等后续项目变大，或者你想让 Codex 同时尝试多个方案，再考虑 Worktree。

## 7. 不建议一开始做的事

第一阶段先不要急着做：

- 真实 OCR 接口
- 真实 AI 批改接口
- 希沃深度集成
- 账号登录
- 数据库
- 学生端
- 手机原生 App

先把网页原型跑通，能让老师看到完整流程。

## 8. 创建项目后的判断标准

当你看到这些文件出现在 D 盘时，说明项目已经进入真正开发阶段：

```text
D:\wenjie-writewise-ai\app\package.json
D:\wenjie-writewise-ai\app\src
D:\wenjie-writewise-ai\app\index.html
```

当 Codex 启动本地服务并给你类似这样的地址时，说明第一版网页已经能预览：

```text
http://localhost:5173
```

## 9. 后续工作方式

以后每次你都可以这样推进：

1. 先说你想改哪里。
2. 让 Codex 先读相关文件。
3. 让 Codex 修改。
4. 让 Codex 运行项目检查。
5. 你看页面后继续提反馈。

你不需要一次把所有需求都讲完。这个项目可以像搭积木一样，一块一块长出来。

