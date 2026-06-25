# 文阶 WriteWise AI

文阶 WriteWise AI 是一款面向初高中英语教师的 AI 作文批改与反馈生成产品。

产品核心目标：

- 减少教师批改英语应用文作文的时间压力。
- 让每篇作文获得分项评分、错误标注、修改建议和总评。
- 自动汇总班级共性问题，辅助教师课堂讲评。
- 未来支持手机、电脑、白板三端共用同一套数据。

## 当前阶段

当前处于产品 0 到 1 的第一阶段：静态网页原型。

第一阶段目标不是接入真实 OCR 或真实 AI，而是先跑通完整教师工作流：

创建批改任务 -> 上传作文 -> 多页作文整理 -> 后台批改进度 -> 异常复核 -> 单篇作文结果 -> 班级讲评页

## 推荐目录结构

```text
D:\wenjie-writewise-ai
  docs\        产品文档、需求文档、开发计划
  app\         前端网页原型和后续正式应用代码
  server\      后续后端服务代码
  assets\      图片、图标、演示素材
  data\        mock 数据、测试作文样本
  exports\     导出的 PDF、PPTX、演示文件
```

## 第一阶段技术建议

- React
- TypeScript
- Vite
- Tailwind CSS
- 本地 mock 数据

第一阶段暂不做：

- 真实 OCR
- 真实 AI 批改
- 数据库
- 账号登录
- 学生端
- 希沃深度集成

## 关键文档

请优先阅读：

- `docs\wenjie_writewise_ai_prd_v0.3.md`
- `docs\phase_1_static_prototype_task_list.md`
- `docs\how_to_create_codex_project_wenjie.md`

