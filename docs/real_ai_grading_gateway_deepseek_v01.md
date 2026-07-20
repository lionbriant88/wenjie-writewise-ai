# 真实 AI 批改 Gateway 与 DeepSeek Provider v0.1

## 当前能力与边界

本版本打通单篇应用文批改链路：浏览器根据教师已确认的 OCR 文本构造 Provider 无关请求，经 `POST /grading/grade` 发送到 Grading Gateway；Gateway 选择 Provider、生成 JSON Prompt、校验并归一化结果；浏览器再次投影响应，转换为现有 `GradingResult`，由教师编辑并显式确认。

MVP 当前只支持逐篇应用文批改，不包含批量并发、后台队列、数据库、刷新恢复、多模型投票、模型选择 UI、读后续写真实批改或真实 AI 班级洞察。批改结果只存在于当前 React 状态生命周期，刷新页面或重启应用后不保证恢复。

当前真实 Provider 为 DeepSeek，默认模型为 `deepseek-v4-flash`。浏览器只知道 `remote`，不包含 Provider 名称、模型名或 API key。后续可通过实现统一 `GradingProvider` 接口并在 Gateway 注册新 Provider 来扩展其他模型，无需建立第二套页面状态模型。

## 数据与隐私边界

- 真实 API 验收只使用教师自建合成作文或彻底去身份化的测试作文，不默认发送真实未成年学生作文。
- 真实学生数据投入使用前，必须另行评审数据处理说明、授权、去标识化和删除规则。
- 请求契约不包含学生姓名、班级名称、学号、图片二进制或本地文件路径；但作文正文仍可能包含身份线索，教师必须先完成去标识化。
- API key 只允许存在于本地 `grading-gateway/.env` 或 Gateway 进程环境变量中，不进入前端、日志、测试 fixture、文档或 Git。
- Gateway 的解析错误、Provider 错误和失败响应只返回统一安全信息，不回显作文、原始 body、上游响应、stack 或密钥。

## Provider、mock 与结果契约

- Gateway `mock` Provider 用于验证浏览器到 Gateway 的完整 HTTP、Prompt、校验、归一化和适配链路。
- Gateway `mock_failure` Provider 用于稳定验证服务端失败映射和前端恢复操作。
- 浏览器本地 mock fallback 只在远程调用失败后由教师显式选择，用于保持人工可恢复路径；它不证明 Gateway 或真实模型可用。
- 两类 mock 与真实 Provider 都产生同一个 `AiGradingResultV1`，并统一经适配器进入现有 `GradingResult`。
- 模型自报的 `modelSelfConfidence` 不作为可信正确率，不进入教师 UI，也不驱动 partial 或复核建议。
- “修改稿不改变原意”仅是 Prompt 约束和教师复核事项，普通 JSON 校验器不宣称已经验证语义不变。

真实 AI 返回后，作文进入 `grading_ready`，`teacherReviewed=false`。教师编辑评分、评语或 OCR 文本只会记录教师调整，不会自动确认；只有点击“确认本篇批改”后才进入 `completed` 且 `teacherReviewed=true`。班级分数统计只纳入已完成且教师已确认的结果，教师精选素材继续复用现有流程；现有高频问题和改写练习仍明确属于 mock 洞察。

## 请求追踪、重试与失败恢复

`requestId` 只用于追踪和忽略迟到响应，不提供严格幂等。界面在一次请求处理中禁用重复点击，系统不做自动重试。教师显式点击重试仍可能产生第二次真实 Provider 调用和费用。

超时、网络失败、上游非 JSON、空 content、空 choices、未知或不完整 `finish_reason`、content filter、资源不足、意外 tool call、缺字段、结构或分数校验失败都会结束当前运行，不会让作文永久停留在处理中。教师可选择显式重试、浏览器本地 mock 回退或转人工处理；旧成功、旧失败和转人工后的迟到响应会被忽略。

## 本地配置

仓库中的 `grading-gateway/.env.example` 与 `app/.env.example` 只能包含非秘密默认值和空 key。可在本地复制 Gateway 示例为 `grading-gateway/.env`，然后只在自己的编辑器中填写 key；不要把 key 粘贴到聊天、终端输出、截图或文档中，也不要提交该文件。

Grading Gateway 环境变量：

```dotenv
HOST=127.0.0.1
PORT=8790
GRADING_ALLOWED_ORIGIN=http://127.0.0.1:5173
GRADING_PROVIDER=mock
GRADING_TIMEOUT_MS=60000
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_THINKING_MODE=disabled
DEEPSEEK_TEMPERATURE=0
DEEPSEEK_MAX_TOKENS=8192
DEEPSEEK_API_KEY=
```

MVP 必须显式设置 `DEEPSEEK_THINKING_MODE=disabled|enabled`，默认和验收使用 `disabled`。disabled 模式显式发送 `temperature=0` 和 `max_tokens=8192`；enabled 模式仍解析并校验温度配置，但请求中省略 temperature，避免依赖模型默认思考参数。切换真实 Provider 时只将本地 Gateway 的 `GRADING_PROVIDER` 改为 `deepseek`。

前端环境变量均为非敏感配置：

```dotenv
VITE_OCR_MODE=mock
VITE_OCR_API_BASE=http://localhost:8787
VITE_GRADING_MODE=real
VITE_GRADING_API_BASE=http://127.0.0.1:8790
```

任何 `VITE_*` 值都会进入浏览器包，禁止放入 API key、Bearer token 或其他秘密。

## 本地启动

分别在三个终端启动服务：

```powershell
cd ocr-gateway
npm.cmd run dev
```

```powershell
cd grading-gateway
npm.cmd run dev
```

```powershell
cd app
npm.cmd run dev -- --host 127.0.0.1 --port 5173
```

Grading Gateway 健康检查为 `GET http://127.0.0.1:8790/health`，批改端点为 `POST http://127.0.0.1:8790/grading/grade`。

## 自动化验证与真实 smoke 闸门

自动化测试使用 fake transport、结构化合成响应和 mock Provider，不依赖真实 API key、网络或模型额度。无 key 时，前端 test/lint/build、Grading Gateway test/typecheck 和 OCR Gateway test/typecheck 必须全部通过。

真实 DeepSeek UI smoke 是单独的人工授权步骤。未经用户明确授权，不启动能发起真实请求的配置，不读取本地 `.env`，也不调用真实 API。授权后也只允许一篇教师自建合成或彻底去身份化的应用文完成纵向验收，并只记录通过/失败、状态流转和安全错误码，不记录作文正文、上游原始响应、账户信息或密钥。

本轮只创建计划内的本地里程碑提交，不会自动推送分支或创建 PR；任何 GitHub 推送都必须由用户另行明确授权。
