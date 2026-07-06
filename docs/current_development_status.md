# 当前开发状态

最后更新：2026-07-07

## 本次新增进展：PaddleOCR 本地真实 OCR Provider 接入 v0.2

- OCR Gateway 已新增 `paddle_local` provider。
- real OCR 现在可走本地 PaddleOCR runner，不再只有 Gateway `mock` provider 可用。
- PaddleOCR provider 只存在于 Gateway；前端仍然只认 `mock OCR` / `real OCR`，`app/src` 不得出现 PaddleOCR / `paddle_local` / `PADDLE_OCR` / Python runner 逻辑。
- Node 侧通过 `child_process.spawn` 启动 `scripts/paddle_ocr_runner.py --manifest <manifestPath> --output <outputPath> --lang <lang>`，不使用 `exec`、字符串 shell 或 `shell: true`。
- 临时文件使用 `fs.mkdtemp(os.tmpdir())` 创建在 `wenjie-paddle-ocr-*` 目录下，并在 `finally` 中清理。
- 超时会杀掉 Python 进程；环境失败返回脱敏后的 environment message，不暴露 traceback、path、args 或 env。
- 结果会统一归一化为 `OcrEssayResult`；单页局部失败保留 `paddle_page_failed`；成功页回填 OCR draft；失败时仍保留 mock / manual / retry 路径。
- 本次只新增样本评估文档，不新增页面、dashboard、chart 或产品功能。
- 非目标仍包括：真实 AI、OCR 坐标、原图高亮、PDF / Word / 文件夹解析、扫描仪 / 摄像头 / 希沃。
- 本轮验证结果：
  - `ocr-gateway`：`npm.cmd test` 5 个测试文件、32 个用例通过；`npm.cmd run typecheck` 通过。
  - 前端 OCR service：`npm.cmd test -- src/services/ocr` 3 个测试文件、7 个用例通过。
  - 上传整理页回归：`npm.cmd test -- src/pages/UploadPage.test.tsx` 1 个测试文件、17 个用例通过。
  - 前端全量：`npm.cmd test` 26 个测试文件、125 个用例通过；`npm.cmd run lint` 通过；`npm.cmd run build` 通过。
  - 安全扫描：`app/src` 生产代码未出现 PaddleOCR / `paddle_local` / `PADDLE_OCR` / Python runner / 云 OCR 密钥相关逻辑；`ocr-gateway/src` 未出现 `exec(` 或 `shell: true`，`node:child_process` 只出现在 `paddleRunner.ts`。
  - 当前 shell 下 `python` / `py` 不可用，因此未运行 `py_compile` 或真实 PaddleOCR smoke test；自动化测试仍不依赖真实 PaddleOCR 安装。

## 本次新增进展：真实 OCR Gateway 接入 v0.1

- 阶段三第一刀已启动：新增最小 `ocr-gateway`，前端不直接调用云 OCR，也不保存任何 OCR provider key。
- Gateway v0.1 使用 `mock` provider 跑通 real OCR 形态链路，并提供 `mock_failure` 受控失败能力；当前仍未接入腾讯、百度、OpenAI、PaddleOCR 或其他真实 OCR 厂商。
- Gateway 使用 multer memory storage，本轮不做图片长期存储、不写数据库、不上传对象存储；输入限制为 PNG / JPEG / WebP、单张 8MB、单次最多 10 页。
- 前端新增统一 OCR Client，支持 `mock OCR` 与 `real OCR 链路测试`；前端只读取 `VITE_OCR_MODE` 和 `VITE_OCR_API_BASE` 两个非敏感配置。
- 上传整理页 real OCR 链路测试成功后回填现有 OCR 草稿区；失败后提供“使用 mock 草稿”“手动输入 OCR 文本”“重试 OCR”。
- OCR 识别中会锁定图片删除、排序、分组模式切换、合并 / 拆分等整理操作，避免 OCR 返回结果和当前分组错位。
- OCR 成功但文本为空时会提示“识别结果为空，请检查图片或手动输入。”，不会静默进入批改队列。
- 新增 `app/.env.example` 与 `ocr-gateway/.env.example`；真实 provider secret 只允许放在 Gateway 环境变量中，不能写入前端 `VITE_*`。
- 当前仍不接真实 AI 批改、不解析 PDF / Word / 文件夹、不接扫描仪 / 摄像头 / 希沃展台、不做 OCR 坐标或原卷图片区域高亮。
- 本轮验证结果：
  - `npm.cmd test -- src/pages/UploadPage.test.tsx`：1 个测试文件，17 个用例通过。
  - `npm.cmd test`：26 个测试文件，125 个用例通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。
  - `ocr-gateway`：`npm.cmd test` 2 个测试文件，10 个用例通过；`npm.cmd run typecheck` 通过。
  - 安全扫描：`app/src` 与 `ocr-gateway/src` 生产代码未出现真实密钥、厂商 key 或 provider-specific SDK 逻辑。

## 本次收尾：阶段二验收与阶段三入口清单

- PR #5“创建任务页题目信息与任务评分标准确认 v0.2”已合并回 `main`，远端功能分支和本地功能分支均已清理。
- 当前仓库只保留 `main`，本地 `main` 与 `origin/main` 一致。
- 新增阶段二验收与阶段三入口清单：`docs/phase_2_acceptance_and_phase_3_entry.md`。
- 阶段二核心 mock 闭环完成度判断为 90% - 95%，可以进入阶段三准备。
- 建议阶段三第一刀优先选择“真实 OCR 接入 v0.1”，并保留现有 OCR 草稿编辑与 mock 回退路径。
- 本轮收尾不新增产品功能，不接真实 OCR / AI / 后端 / 硬件，只做阶段状态校准、验收清单和全量验证。
- 本轮收尾验证结果：
  - `npm.cmd test -- src/pages/CreateTaskPage.test.tsx`：1 个测试文件，5 个用例通过。
  - `npm.cmd test`：23 个测试文件，114 个用例通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。

## 本次新增进展：创建任务页题目信息与任务评分标准确认 v0.2

- 创建任务页已从单页基础表单升级为三步式流程：基础信息、题目信息、评分标准确认。
- 基础信息中新增写作大类：应用文 / 读后续写；应用文保留建议信、邀请信、申请信、感谢信、通知、演讲稿、报道、咨询信、倡议书、For and Against essay，读后续写当前预留“故事续写”。
- 题目信息按写作大类切换：
  - 应用文必填“题目要求 / 写作任务”。
  - 读后续写必填“读后续写原文”“Paragraph 1 开头句”“Paragraph 2 开头句”。
  - 教师补充要求、特别扣分点、优秀作文关注点均为选填。
- 原题材料上传仅保留阶段三轻占位，文案说明后续将支持原题图片 / PDF / 文档；本轮没有提供上传解析按钮，也没有出现“上传并识别”“解析题目”“提取题目要求”等误导性入口。
- 评分标准确认区新增 mock 生成流程：必填题目信息完整后可生成应用文 / 读后续写对应 mock rubric；教师补充要求为空也允许生成，填写后会显示“已参考教师补充要求”。
- 教师确认评分标准后才允许进入上传整理页，继续复用现有上传、OCR mock、批改队列、单篇详情和班级总览流程。
- 切换写作大类后，已生成评分标准会重置为“待生成”，并提示“写作大类已切换，请重新生成本任务评分标准。”。
- 任务数据结构轻量预留 `writingGenre`、`promptInfo` 和 `rubricDraft`，不接真实 AI、不解析原题文件、不做权重编辑器、不做读后续写真情节推理或复杂 rubric 后台。
- 本轮验证结果：
  - `npm.cmd test -- src/pages/CreateTaskPage.test.tsx`：1 个测试文件，5 个用例通过。
  - `npm.cmd test`：23 个测试文件，114 个用例通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。
- GitHub：功能分支 `codex/task-writing-rubric-setup-v02` 已通过 PR #5 合并回 `main`，远端功能分支已删除。

## 本次新增进展：上传整理页多来源导入入口占位 v0.2

- 在上传整理页顶部新增“选择导入方式”区域，作为阶段三多来源导入能力的入口占位。
- 当前可用入口统一命名为“图片 / 文件导入”，但当前实际按钮只提供“选择图片”和“添加模拟图片”，不暗示已支持 PDF、文件夹或通用文件解析。
- 新增三个阶段三入口占位：
  - “拍照采集”：未来用于软件内调用手机、平板或电脑摄像头现场拍摄作文。
  - “扫描件导入”：未来用于学校扫描仪或阅卷系统已经生成的图片、PDF 或文件夹导入，本轮不提供“选择扫描件”按钮。
  - “希沃展台采集”：未来作为采集来源，明确展示“课堂即时批改”和“批量采集上传”两种模式。
- 新增 `UploadSourceSelector` 展示组件，只通过 props 接收 `onSelectImages` 和 `onAddMockImage`，不直接读写 AppState，也不拥有上传状态、OCR 草稿、分组或队列逻辑。
- 保留现有图片上传、真实缩略图预览、排序、删除、一张一篇 / 每 2 张一篇 / 混合页数整理、OCR mock 和批改队列流程。
- 当前版本不接入真实摄像头、扫描仪、希沃视频流、PDF 解析、即时 OCR 或即时 AI 批改，也不显示“打开摄像头”“连接扫描仪”“开始展台采集”“展台截图”等假硬件 UI。
- 本轮验证结果：
  - `npm.cmd test -- src/pages/UploadPage.test.tsx`：1 个测试文件，13 个用例通过。
  - `npm.cmd test`：22 个测试文件，109 个用例通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。
  - 范围扫描确认生产代码未出现假硬件按钮、摄像头 API、扫描仪 API 或 PDF 解析实现。
- 浏览器预览状态：已打开 `http://127.0.0.1:5173/tasks/task-1/upload`，确认“选择导入方式”、图片 / 文件导入、拍照采集、扫描件导入、希沃展台采集均可见。

## 本次新增进展：原卷视图修正为页面级卷面批阅画布 v0.2

- `原卷视图` 已从左侧 OCR 原文卡片的小 Tab 调整为单篇详情页页面级 workspace。
- 单篇详情页现在默认进入 `批改工作台`，并可切换到 `原卷视图`。
- `EssaySourcePanel` 内部恢复为 `阅读定位 / 编辑 OCR`，不再承载原卷视图。
- `原卷视图` 当前为阶段三预留卷面批阅画布：原卷区域为视觉中心，左侧、右侧、底部预留未来批注空间。
- 当前不实现 OCR 坐标、图片框选、图片区域高亮、真实批注、假坐标或 AppState 数据结构变更。
- 本轮验证结果：
  - `npm.cmd test -- src/pages/EssayResultPage.test.tsx`：通过。
  - `npm.cmd run lint`：通过。
- GitHub：当前分支 `codex/original-paper-view-roadmap-v02` 已推送，并已创建 PR #4：`https://github.com/lionbriant88/wenjie-writewise-ai/pull/4`。
- 收尾状态：PR #4 已合并回 `main`，GitHub 远端功能分支已删除；本地 `main` 已 fast-forward 同步到合并后的提交。

## 本次新增进展：原卷视图入口与原卷批阅路线占位 v0.2

- 单篇作文详情页左侧模式从 `阅读定位 / 编辑 OCR` 扩展为 `阅读定位 / 原卷视图 / 编辑 OCR`，默认仍进入 `阅读定位`。
- `原卷视图` 当前只展示阶段三预留说明和原卷图片预览，明确后续方向为卷面定位、图片区域高亮和批注卡片联动。
- 当前占位视图不展示 OCR 文本层 marker，不生成图片问题框，不接 OCR 坐标，不新增 AppState 数据结构。
- 保留 `查看原图` 弹窗、OCR 文本编辑、左右问题定位、加入班级总览素材池、全文优化稿和进度页最新完成入口。
- 本轮验证结果：
  - `npm.cmd test -- src/pages/EssayResultPage.test.tsx`：通过，15 个用例通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。

## 本次新增进展：OCR 原文可点击问题句 v0.1

- 在单篇详情页左侧“学生作文原文”的阅读定位模式中，新增轻量问题句 marker，不显示编号，不插入额外文字。
- marker 只来自当前 `reviewIssueItems` 中的语言问题和逻辑问题，不从全文优化稿、表达提升点或班级总览素材池反推。
- 点击左侧可定位问题句后，会设置 `activeIssueId`，右侧自动切换到“问题批改”Tab，并让对应问题卡片进入选中状态。
- 保留原有右侧问题卡片点击后左侧原文定位/高亮能力；未匹配问题仍显示“未精确定位”，不在左侧强行标记。
- OCR 编辑模式下隐藏 marker；保存或回到阅读模式后，会根据最新 OCR 文本重新计算可点击问题句。
- 新增 `sourceIssueMarkers` 工具函数，复用 `findTextMatch`，并用 `data-issue-source` / `data-active` 稳定属性覆盖测试。
- 多个问题命中同一位置时，左侧 marker 只绑定一个主问题；右侧问题列表保持完整。
- 本轮未做编号、原卷图片批注、图片坐标映射、全文优化稿联动、班级总览素材反向联动或复杂旁批模式。
- 本轮验证结果：
  - `npm.cmd test -- src/utils/sourceIssueMarkers.test.ts`：1 个测试文件，4 个用例通过。
  - `npm.cmd test -- src/pages/EssayResultPage.test.tsx`：1 个测试文件，13 个用例通过。
  - `npm.cmd test -- src/pages/DetailNavigation.test.tsx`：1 个测试文件，9 个用例通过。
  - `npm.cmd test -- src/pages/ProgressPage.test.tsx`：1 个测试文件，8 个用例通过。
  - `npm.cmd test -- src/pages/ClassReviewPage.test.tsx`：1 个测试文件，2 个用例通过。
  - `npm.cmd test`：22 个测试文件，106 个用例通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。
- 浏览器预览状态：用户已在本机预览并确认没有问题。

## 本次新增进展：核心批改工作台信息架构优化

- 班级总览删除冗余黑色横幅，改为页内 Tabs：概览、教师精选素材、高频问题、改写练习。
- 班级总览默认进入“概览”，只展示分数统计和分数分布；教师精选素材、高频问题、改写练习分别进入独立内容区。
- 高频语法错误、高频拼写错误、典型问题句和可上课改写练习改为更紧凑的列表展示，原有 `classInsights` 数据不丢失。
- 单篇详情页保留左侧学生作文原文常驻，右侧改为 Tabs：评分诊断、问题批改、全文优化、教师反馈。
- 评分编辑、问题定位、加入班级总览、素材查看来源、素材移除、全文优化稿、教师反馈保存和进度页最新完成入口保持可用。
- 本轮未新增路由，未改变 `classReviewMaterials` 数据结构，未接真实 AI / OCR / 后端 / 导出能力。
- 本轮验证结果：
  - `npm.cmd test -- src/pages/ClassReviewPage.test.tsx`：1 个测试文件、2 个用例通过。
  - `npm.cmd test -- src/pages/EssayResultPage.test.tsx`：1 个测试文件、11 个用例通过。
  - `npm.cmd test -- src/pages/ProgressPage.test.tsx`：1 个测试文件、8 个用例通过。
  - `npm.cmd test -- src/pages/DetailNavigation.test.tsx`：1 个测试文件、9 个用例通过。
  - `npm.cmd test`：21 个测试文件、100 个用例通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。
- GitHub：`codex/class-review-materials-v0` 已 fast-forward 合并进 `main`，并已推送到 `origin/main`。

## 本次新增进展：班级总览讲评素材池闭环 v0.1

- 单篇详情页“问题与修改建议”中的“加入班级总览”已从组件内 mock 反馈升级为真实写入当前任务的 `classReviewMaterials`。
- 本轮支持两类素材沉淀：
  - 语言问题 -> `typical_error`，保留原句、推荐改法、讲解、扣分影响、来源作文。
  - 逻辑问题 -> `logic_issue`，保留原句、逻辑诊断、讲评建议、是否建议教师复核、来源作文。
- 素材按任务隔离，并按 `taskId + essayId + sourceIssueId` 优先去重；没有 `sourceIssueId` 时用 `taskId + essayId + type + original` 兜底。
- `IssueCorrectionList` 已保持为受控组件，不直接读写 `AppStateContext`；详情页负责将 issue 映射成素材并判断按钮状态。
- 班级总览页新增“教师精选讲评素材”模块，位于分数分布之后、高频问题模块之前：
  - 显示素材总数。
  - 支持“全部 / 典型错误 / 逻辑问题”筛选。
  - `expression_upgrade` 类型已在数据层预留，但没有真实表达提升素材时不显示空的“表达提升”Tab。
  - 每条素材支持“查看来源”和“移除”。
- 从班级总览移除素材后，回到对应单篇详情页，按钮会恢复为“加入班级总览”。
- “查看来源”本轮只跳转到 `/tasks/:taskId/essays/:essayId`，不做 query param 自动定位。
- 本轮未接入真实 AI / OCR、后端数据库、导出、学生端/家长端、复杂课堂播放模式，也未重构上传整理页、批改进度页或详情页整体布局。
- 本轮验证结果：
  - `npm.cmd test -- src/utils/classReviewMaterials.test.ts`：1 个测试文件、4 个用例通过。
  - `npm.cmd test -- src/pages/EssayResultPage.test.tsx`：1 个测试文件、11 个用例通过。
  - `npm.cmd test -- src/pages/ClassReviewPage.test.tsx`：1 个测试文件、2 个用例通过。
  - `npm.cmd test -- src/pages/ProgressPage.test.tsx`：1 个测试文件、8 个用例通过。
  - `npm.cmd test`：21 个测试文件、100 个用例通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。

## 本次收尾：批改进度页队列体验 PR 已合并

- PR #3 “优化批改进度页队列体验”已创建并合并回 `main`。
- 合并提交：`a8eb68a Merge pull request #3 from lionbriant88/codex/progress-queue-workbench-plan`
- 本地已切回 `main` 并执行 `git pull`，当前本地 `main` 与 `origin/main` 一致。
- 合并后已在 `main` 上重新验证：
  - `npm.cmd test`：20 个测试文件、94 个用例通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。
- 远端功能分支已在后续仓库清理中删除；代码已经完整进入 `main`，不会影响后续从 `main` 新建分支继续开发。

## 本次新增进展：批改进度页队列体验优化 v2

- 批改进度页保留原有顶部统计卡片，不新增重复统计区域。
- 中部提示条已升级为队列操作条，显示当前处理中作文数和需人工复核作文数。
- 新增状态筛选 Tabs：全部、处理中、需复核、已完成，并按当前状态过滤桌面表格和移动端作文卡片。
- 新增“最新完成作文”入口：
  - 点击“模拟完成下一篇”后，显示最新完成作文并可直接进入详情页。
  - 点击“模拟完成全部可处理”后，显示批量完成数量，并可进入最后完成作文详情页。
- 新增“模拟完成全部可处理”，只处理 `pending_ocr`、`ocr_running`、`pending_grading`、`grading`，不处理需复核或已完成作文。
- 需复核作文在桌面表格和移动端卡片中增加轻微 rose 背景，更容易被教师扫到。
- 本轮未改上传整理页、单篇详情页、异常复核页核心逻辑、班级总览核心逻辑，也未接入真实 AI / OCR 或后端队列。
- 本轮验证结果：
  - `npm.cmd test -- src/utils/progressQueue.test.ts src/pages/ProgressPage.test.tsx`：2 个测试文件、12 个测试通过。
  - `npm.cmd test`：20 个测试文件、94 个测试通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。
  - 浏览器验证：已打开 `/tasks/task-1/progress`，确认顶部统计卡片、队列操作条、状态 Tabs、需复核行强调、最新完成入口、详情页跳转均可用。
  - 浏览器交互验证：`task-1` 中只有 1 篇可处理作文时不显示批量按钮；点击“模拟完成下一篇”后处理中从 1 变 0，已完成从 7 变 8，并可进入作文 9 详情页；`task-2` 中点击“模拟完成全部可处理”后处理中归零，需复核仍保留 1 篇。

## 本次新增进展：单篇详情页全文优化稿与逻辑连贯性诊断

- 单篇作文详情页新增“全文优化稿”模块，默认展示“提升版”，并支持切换：
  - 纠错版：只做必要语言修正。
  - 提升版：在保留学生原文思路的前提下优化表达与衔接。
  - 逐句对照：展示原句、纠错版、提升版、修改类型、说明、是否保留原意和教师复核提示。
- 逻辑连贯性问题已进入“问题与修改建议”卡片：
  - 支持上下文关联度差、人物动机缺失、情节衔接断裂等后续可扩展类型。
  - 对不确定学生原意的内容显示“建议教师复核”，避免 AI 擅自编造原因或情节。
  - 逻辑问题卡片保留“加入班级总览”和原文定位反馈。
- 原来的“表达升级建议”不再作为独立主模块展示，已整合到“全文优化稿”中的“本文重点提升点”，并保留加入班级总览反馈。
- 动态上传 / OCR 后通过“模拟完成下一篇”生成的 mock 批改结果，也会带全文优化稿数据，进入详情页后保持同一套信息架构。
- 本轮未实现原卷批注视图、图片坐标级批注、真实 AI、真实 OCR 或导出功能。
- 本轮验证结果：
  - `npm.cmd test -- src/data/mockData.test.ts src/utils/reviewIssueItems.test.ts src/components/FullTextRevisionPanel.test.tsx src/pages/EssayResultPage.test.tsx src/pages/DetailNavigation.test.tsx`：5 个测试文件、25 个测试通过。
  - `npm.cmd test -- src/pages/ProgressPage.test.tsx`：1 个测试文件、1 个测试通过。
  - `npm.cmd test`：19 个测试文件、83 个测试通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。
  - 浏览器验证：已打开 `/tasks/task-1/essays/task-1-essay-1`，确认诊断摘要、学生原文、问题卡片、逻辑问题、全文优化稿、纠错版 / 提升版 / 逐句对照、逻辑优化说明、本文重点提升点、AI 总评 / 教师补充建议、返回进度和上一篇 / 下一篇均可见；“表达升级建议”独立模块和“原卷批注视图”未出现。
  - 浏览器交互验证：切换“逐句对照”后可见是否保留原意与教师复核提示；点击 `My mother was angry.` 逻辑问题卡片后显示“已定位”。

## 本次新增进展：上传整理批量分组重构

- 上传整理页已从旧的“先手动分组，再 OCR”改为批量图片整理流程。
- 默认模式为“一张一篇”，未合并图片会直接作为单页作文进入 OCR 队列。
- 新增“每 2 张一篇”模式，系统会按当前上传/显示顺序自动生成作文组；如果最后剩 1 张图片，会保留为单页作文。
- 新增“混合页数”模式，老师可点击图片进行多选，选择 2 张以上后合并为一篇作文；多页作文卡片内可拆分回单页作文。
- 上传整理区明确显示提示：“当前按上传顺序排列，自动分组将按此顺序生成作文。”
- 混合页数模式新增操作引导，支持“知道了”“不再提醒”和“查看操作提示”，其中“不再提醒”写入 `localStorage`。
- 模拟 OCR 已改为按作文组生成草稿：每个作文组一个 OCR 文本框，确认后按组进入批改队列。
- 已新增/更新上传页测试，覆盖模式切换、上传顺序提示、固定两页分组、混合页数引导、合并、拆分、按组 OCR 提交。
- 本次验证结果：
  - `npm.cmd test -- src/utils/essayGrouping.test.ts`：3 个用例通过。
  - `npm.cmd test -- src/pages/UploadPage.test.tsx`：12 个用例通过。
  - `npm.cmd test -- src/pages/ProgressPage.test.tsx`：1 个用例通过。
  - `npm.cmd test`：17 个测试文件、77 个用例通过。
  - `npm.cmd run lint`：通过。
  - `npm.cmd run build`：通过。
  - 浏览器预览已验证 `/tasks/task-1/upload`：三种分组模式、上传顺序提示、混合页数引导、合并、拆分均可用。

## 仓库状态

- 项目根目录：`D:\wenjie-writewise-ai`
- 前端应用：`D:\wenjie-writewise-ai\app`
- 远程仓库：`https://github.com/lionbriant88/wenjie-writewise-ai.git`
- 当前本地开发分支：`codex/real-ocr-gateway-v01`
- 当前远端主线：`origin/main`
- 当前分支基于最新阶段二收尾后的 `main` 开发，包含真实 OCR Gateway 接入 v0.1 的阶段三第一刀改动。
- 当前最新主线提交：`b46c759 docs: add phase 2 acceptance checklist`
- `main` 已包含创建任务页题目信息与任务评分标准确认 v0.2。
- `main` 已包含班级总览讲评素材池闭环 v0.1 和 OCR 原文可点击问题句 v0.1。
- `main` 已包含 PR #2：阶段一信息架构与界面打磨。
- `main` 已包含 PR #3：批改进度页队列体验优化 v2。
- `main` 已包含 PR #4：原卷视图修正为页面级卷面批阅画布 v0.2。
- `main` 已包含 PR #5：创建任务页题目信息与任务评分标准确认 v0.2。
- 已合并的历史功能分支已清理；远端当前只保留 `origin/main`，本地当前在 `main` 上，可直接从最新主线新建后续开发分支。

## 已完成工作

- 已初始化项目并推送到 GitHub。
- 已建立产品文档、阶段一实现计划和信息架构设计文档。
- 已完成阶段一静态 React 原型，并持续向阶段二 mock 闭环演进。
- 当前主要路由：
  - `/`
  - `/tasks/new`
  - `/tasks/:taskId/upload`
  - `/tasks/:taskId/progress`
  - `/tasks/:taskId/exceptions`
  - `/tasks/:taskId/essays/:essayId`
  - `/tasks/:taskId/class-review`
- 已加入任务、作文、批改结果、异常作文和班级总览洞察的 mock 数据。
- 已覆盖工作流导航、上传预览、OCR 草稿、OCR 分组、手动作文分组、进度页完成、详情页导航、评分诊断、问题卡片、原文定位高亮、教师评语调整等测试。

## 阶段一与阶段二进展

### 阶段一：原型与信息架构

- 任务列表、任务内导航、上传整理、批改进度、班级总览、单篇详情页已形成可演示闭环。
- 视觉风格已调整为简洁、专业、轻科技感，避免营销页式表达。
- 二级页面返回统一为明确返回路径。
- 班级总览保留分数分布轻量 CSS 条形图，并整合作文总数、平均分、最高分、最低分。
- 班级总览分数档按高考 15 分制拆分为 `1-3`、`4-6`、`7-9`、`10-12`、`13-15`。
- 进度页状态标签支持轻量状态反馈，强化“AI 正在处理”的感知。

### 阶段二：上传 / OCR / 进度 mock 闭环

- 上传页支持选择本地图片，并以真实缩略图进入页面整理器。
- 图片可排序、删除，本地预览 URL 会被释放。
- 上传页支持模拟 OCR，生成可编辑 OCR 文本草稿。
- OCR 确认后可进入批改队列。
- OCR 分组已支持三种基础模式：
  - 合并为一篇多页作文。
  - 按图片拆分为多篇作文。
  - 手动分组为多篇作文。
- 手动分组模式已支持：
  - 新增作文组。
  - 将图片移动到上一篇或下一篇。
  - 空组作为临时接收区。
  - 顶部实时显示确认 OCR 后将提交的作文篇数。
  - OCR 完成后每个作文组有独立可编辑文本草稿。
  - 确认 OCR 后按作文组分别进入批改队列。
- 进度页支持“模拟完成下一篇”，可把队列中的作文推进到已完成并生成 mock 批改结果。
- 新上传 / OCR 确认的作文可以完成批改，并进入详情页查看 mock 结果。
- OCR 和 AI 批改仍为 mock；本地上传预览仍只保存在浏览器会话内。

### 阶段二：单篇作文批改结果详情页

- 已把详情页从“报告页”升级为更偏教师决策的工作台。
- 左侧仍保留“学生作文原文”和“查看原图”入口。
- 右侧新增紧凑的“诊断摘要”：
  - 总分改为整数展示，例如 `13 / 15`。
  - 保留 AI 置信度。
  - 显示档次判断，例如“优秀”“良好”。
  - 标出主要扣分项和讲评建议。
- 分项分数输入支持教师调整：
  - 合法范围内保留小数。
  - 超出范围会被夹到维度满分或 0。
  - 总分实时联动为整数。
  - 调整后显示轻量反馈，如“分数已更新”“已由教师调整”。
- “问题与修改建议”已改为教师更容易扫读的问题卡片：
  - 问题类型。
  - 扣分影响。
  - 原句。
  - 推荐改法。
  - 原因。
  - 可加入班级总览。
- “表达升级建议”保持独立，不与错误修改混在一起。
- “总评”升级为“AI 总评 / 教师补充建议”：
  - AI 总评可编辑。
  - 教师可补充最终反馈。
  - 保存后显示“已保存教师调整”和“已由教师调整”。
- 已完成问题卡片到原文定位的轻量闭环：
  - 右侧“问题与修改建议”卡片可点击选中。
  - 选中卡片根据真实匹配结果显示“已定位”或“未精确定位”。
  - 左侧“学生作文原文”默认进入“阅读定位”模式，直接在原文中高亮匹配句。
  - 左侧可切换到“编辑 OCR”模式，保留 OCR textarea 编辑能力。
  - 已移除独立“定位预览”卡片，避免左侧原文重复展示。
  - 匹配失败时显示“未在原文中精确定位，请手动核对”。
  - “加入班级总览”、查看原图、分数编辑、教师评语保存和上下篇导航保持可用。
- 已完成详情页专注批改模式第一轮打磨：
  - 桌面端侧边流程导航默认折叠，保留“展开导航 / 折叠导航”。
  - 顶部和底部仍保留返回批改进度、上一篇、下一篇。
  - “问题与修改建议”卡片压缩为更适合扫读的状态/操作行 + 字段行布局。
  - “表达升级建议”同步压缩为同类信息密度，避免示例卡片过高。
  - mock 学生原文已覆盖问题句和表达升级原表达，便于演示左侧定位对应关系。

## 最新验证

执行目录：

```powershell
cd D:\wenjie-writewise-ai\app
```

最新验证命令：

```powershell
npm.cmd test -- src/pages/UploadPage.test.tsx
npm.cmd test
npm.cmd run lint
npm.cmd run build
cd D:\wenjie-writewise-ai\ocr-gateway
npm.cmd test
npm.cmd run typecheck
```

最新结果：

- 上传整理页聚焦测试：1 个测试文件，17 个用例通过。
- 前端全量测试：26 个测试文件，125 个用例通过。
- Lint：通过。
- Build：通过。
- OCR Gateway 测试：2 个测试文件，10 个用例通过。
- OCR Gateway Typecheck：通过。
- 安全扫描：生产代码未发现真实密钥、厂商 key 或 provider-specific SDK 逻辑。
- 范围确认：
  - 本轮只打通最小 OCR Gateway 与统一 OCR Client 链路，Gateway 当前使用 mock provider。
  - 未接真实 AI、真实 OCR 厂商、数据库、扫描仪、摄像头、希沃展台、PDF / Word / 文件夹解析或 OCR 坐标。

`app\dist` 是 `npm.cmd run build` 生成目录，通常不应提交。

## 本地预览

启动方式：

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd run dev
```

常用预览地址：

```text
http://localhost:5173/
http://localhost:5173/tasks/task-1/upload
http://localhost:5173/tasks/task-1/progress
http://localhost:5173/tasks/task-1/essays/task-1-essay-1
http://localhost:5173/tasks/task-1/class-review
```

如果 `5173` 端口被占用，Vite 可能会自动选择下一个可用端口。

## 下一步最合理开发内容

阶段三第一刀“真实 OCR Gateway 接入 v0.1”已在 `codex/real-ocr-gateway-v01` 分支完成最小链路。当前 real OCR 链路仍由 Gateway mock provider 支撑，尚未接真实 OCR 厂商。

优先方向：

1. 选择具体 OCR provider，新增一个真实 provider adapter，并继续保持 mock / mock_failure 回退能力。
2. 在选择 provider 前，可以先做 Gateway 启动脚本、健康检查提示和本地联调说明，让老师/开发者更容易跑通预览。
3. 下一轮不要同时接真实 AI、OCR 坐标、扫描仪、摄像头或希沃展台；每次只打通一个真实能力边界。

## 后续工作注意事项

- 保持产品像软件工作台，而不是营销落地页。
- 所有视觉优化都要用右侧浏览器验证。
- 保持简洁、专业、轻科技感。
- 不要为了“丰富”而堆信息，优先减少教师判断成本。
- 阶段二仍以 mock 闭环为主，真实 OCR / AI 接口接入可放到后续阶段。
