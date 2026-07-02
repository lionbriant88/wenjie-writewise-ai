# OCR 原文可点击问题句 v0.1 设计规格

## Goal

在现有“右侧问题卡片 -> 左侧 OCR 原文高亮”的基础上，补充“左侧 OCR 原文 -> 右侧问题卡片”的反向联动。老师阅读左侧作文原文时，可以点击被轻量标记的问题句，右侧自动切到“问题批改”Tab 并选中对应问题卡片。

本轮是文本层问题句联动能力，不是原卷图片批注，也不是最终旁批模式。

## Current Baseline

当前单篇作文详情页已经具备：

- 右侧点击问题卡片后，左侧 OCR 原文会高亮对应句子。
- 问题卡片会显示“已定位 / 未精确定位”。
- OCR 编辑后，定位会根据新文本重新判断。
- 详情页右侧已经拆分为“评分诊断 / 问题批改 / 全文优化 / 教师反馈”。
- 问题卡片已经支持语言问题、逻辑问题、加入班级总览。
- 全文优化稿已经支持纠错版、提升版、逐句对照和逻辑优化说明。

因此，本轮不重做现有定位链路，只补齐反向联动。

## Product Decision

采用“原文可点击问题句”的轻量方案：

1. 左侧 OCR 原文阅读模式中，对可定位的问题句做轻量行内标记。
2. 不显示 `①②③` 编号。
3. 点击左侧标记句后：
   - 设置 `activeIssueId`。
   - 右侧自动切到“问题批改”Tab。
   - 对应问题卡片进入选中状态。
4. 保留右侧问题卡片点击后左侧高亮的现有能力。
5. OCR 编辑模式下隐藏所有问题句标记。
6. 回到阅读模式后，按最新 OCR 文本重新计算定位。
7. 未匹配问题不在左侧强行标记，继续在右侧显示“未精确定位”。

核心体验：

```text
老师阅读左侧原文
-> 看到轻微标记的问题句
-> 点击该句
-> 右侧切到问题批改并显示对应解释
```

## Non-Goals

本轮明确不做：

- 不做编号 `①②③`。
- 不做原卷图片批注。
- 不做图片坐标级标注。
- 不在学生原卷图片上画框。
- 不做红笔手写轨迹。
- 不做拖拽批注。
- 不做自由绘图。
- 不做复杂旁注气泡。
- 不做 OCR 坐标结构。
- 不做真实 OCR 坐标映射。
- 不做全文优化稿逐句对照联动。
- 不把表达升级点纳入左侧原文标记。
- 不把班级总览素材状态带入左侧原文标记。
- 不改上传页、批改进度页、班级总览页核心逻辑。
- 不破坏加入班级总览素材池闭环。

## Why No Numbering

本轮不做编号，原因：

- 右侧已经有问题卡片列表。
- 编号会增加视觉噪音。
- 编号会破坏学生原文自然阅读感。
- 老师更需要“看到问题句 -> 点击 -> 右侧解释”，而不是记住编号。
- 真实作文问题较多时，编号会让原文显得杂乱。

## Left Source Marking

只在 `EssaySourcePanel` 的“阅读定位”模式中显示标记。

视觉原则：

- 保持原文可读，不插入额外文字。
- 不改变段落换行。
- 标记是提示“这句话有问题，可点击查看右侧解释”。
- 不做左侧大面积边框或复杂旁注。

推荐视觉：

- 语言问题：浅蓝或浅青底色，hover 时稍微加深。
- 逻辑问题：浅琥珀底色，hover 时稍微加深。
- 当前选中问题句：底色更明确，文字仍可读。
- `needsTeacherReview` 不在左侧额外加重，只在右侧问题卡片继续显示。

左侧标记应使用按钮语义或可访问的交互元素，具备可点击和键盘触发能力。

## Interaction Flow

### Left To Right

点击左侧已标记问题句：

1. 调用页面层回调。
2. `EssayResultPage` 设置 `activeIssueId`。
3. `EssayResultPage` 设置 `activeDetailTab = 'issues'`。
4. 右侧 `IssueCorrectionList` 根据现有 `activeIssueId` 展示选中态。
5. 若实现成本可控，右侧滚动到对应问题卡片；该项为增强项，不阻塞 v0.1。

不在左侧弹出解释气泡，因为解释内容已经由右侧问题卡片承载。

### Right To Left

保留现有能力：

1. 点击右侧问题卡片后设置 `activeIssueId`。
2. 左侧原文对应句子高亮。
3. 右侧问题卡片显示“已定位 / 未精确定位”。
4. 无法定位时左侧显示当前已有的手动核对提示。

## OCR Edit Mode

编辑 OCR 时：

- 隐藏所有问题句标记。
- 保持当前 textarea 编辑体验。
- 不显示 hover、底色和点击行为。
- 回到阅读模式后，根据最新 `essay.ocrText` 重新计算可定位问题句。
- 如果修改后无法匹配，右侧继续显示“未精确定位”。

## Matching Rules

数据来源只使用现有 `reviewIssueItems`：

- 语言问题。
- 逻辑问题。

匹配继续复用现有 `findTextMatch()`，避免另起一套模糊匹配逻辑。

未匹配时：

- 不报错。
- 左侧不显示标记。
- 不做错误高亮。
- 右侧继续显示“未精确定位，请手动核对”。
- 不为了显示标记而模糊匹配到错误句子。

多个问题命中同一句时，v0.1 不做复杂重叠处理。绑定规则：

1. 优先 severity 更高的问题：`high > medium > low`。
2. severity 相同时，使用问题列表中更靠前的问题。

后续如有需要，再做“一句多问题选择”。

## Architecture

### EssayResultPage

继续作为详情页联动中枢：

- 持有 `activeIssueId`。
- 持有 `activeDetailTab`。
- 基于 `reviewIssueItems` 和 `essay.ocrText` 计算左侧可点击问题句 markers。
- 将 markers 和点击回调传给 `EssaySourcePanel`。
- 点击左侧 marker 时：
  - `setActiveIssueId(issueId)`。
  - `setActiveDetailTab('issues')`。

`EssayResultPage` 不新增全局状态，不改变 URL，不改 `AppStateContext`。

### EssaySourcePanel

保持展示组件职责：

- 仍接收 `essay`、`activeHighlightText`、`onOcrTextChange`、`onViewOriginalImage`。
- 新增可选 props：
  - `issueMarkers`：可定位问题句标记数据。
  - `activeIssueId`：当前选中问题。
  - `onIssueMarkerSelect`：点击左侧问题句回调。
- 阅读模式根据 markers 渲染可点击问题句。
- 编辑模式忽略 markers。
- 不直接读写 `AppStateContext`。

### Utility

可以新增轻量工具函数用于生成 marker 渲染片段，但不强制新增过重抽象。

如果 `EssaySourcePanel` 中切分文本逻辑变复杂，可以新增：

```ts
buildIssueMarkerParts(sourceText, markers)
```

职责只限于把 OCR 文本切分为普通文本和可点击问题句片段。

## Data Shape

页面层可使用如下轻量结构：

```ts
type SourceIssueMarker = {
  issueId: string
  source: 'language' | 'logic'
  severity: 'low' | 'medium' | 'high'
  original: string
  matchedText: string
  start: number
  end: number
}
```

其中 `start/end/matchedText` 来自 `findTextMatch()`。

## Testing Requirements

### EssaySourcePanel / EssayResultPage

需要覆盖：

- 默认评分诊断 Tab 下，左侧原文仍显示。
- 点击右侧“问题批改”Tab 后，问题卡片仍显示。
- 左侧阅读模式中，可定位问题句有可点击标记。
- 点击左侧可定位问题句后，右侧自动切到“问题批改”Tab。
- 点击左侧可定位问题句后，对应问题卡片进入选中状态。
- 点击右侧问题卡片后，左侧对应句子仍高亮。
- OCR 编辑模式下不显示问题句标记。
- 修改 OCR 后回到阅读模式，无法匹配的问题不显示左侧标记，右侧显示“未精确定位”。
- 加入班级总览按钮和已加入状态不受影响。
- 全文优化稿、教师反馈、进度页最新完成入口不受影响。

## Verification

Focused verification:

```powershell
cd D:\wenjie-writewise-ai\app
npm.cmd test -- src/pages/EssayResultPage.test.tsx
npm.cmd test -- src/pages/DetailNavigation.test.tsx
npm.cmd test -- src/pages/ProgressPage.test.tsx
```

Final verification:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Browser verification:

- `/tasks/task-1/essays/task-1-essay-1`
  - 左侧原文阅读模式显示轻量问题句标记。
  - 点击左侧标记句后，右侧切到“问题批改”Tab。
  - 对应问题卡片选中。
  - 右侧点击问题卡片后，左侧仍能高亮。
  - 编辑 OCR 时标记隐藏。

## Acceptance Criteria

- 老师可以从左侧 OCR 原文直接点击问题句，跳到右侧对应问题解释。
- 不显示编号，不打断原文阅读。
- 现有右侧问题卡片到左侧原文高亮能力保留。
- 未匹配问题不在左侧强行显示。
- OCR 编辑体验不被标记干扰。
- 素材池闭环、全文优化稿、教师反馈和进度页入口不被破坏。
