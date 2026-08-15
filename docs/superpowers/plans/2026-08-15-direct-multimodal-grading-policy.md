# Direct Multimodal Grading Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让图片首批和教师确认文本重批执行同一套保守拼写、重要字迹默认判错、结构化语法与逻辑规则，并把安全结果完整投影到现有网站。

**Architecture:** 在 Grading Gateway 内建立唯一的版本化策略常量和严格输出结构，模型输出先经过引用定位、拼写确定性过滤、重要字迹隔离和分数边界校验，再进入前端契约。现有网站页面布局不变，只补充逻辑问题和卷面可读性问题的数据贯通与卡片呈现。

**Tech Stack:** TypeScript 6、Vitest 4、Express、Kimi OpenAI-compatible structured output、React 19、Testing Library。

## Global Constraints

- 第一批作文只发送有序图片；教师修改学生原文后的重批只发送教师确认文本。
- 可合理理解为正确单词的字形歧义默认正确，不创建问题、不扣分、不生成识图警告。
- 只有字母清楚、错误明确且正确写法唯一时，才允许报告拼写错误。
- 会改变语义、语法或分数的重要字迹歧义默认计入“卷面与可读性”，不得伪装成拼写、语法或逻辑错误。
- 语法、逻辑、任务完成度和表达问题优先展示。
- 所有问题、逻辑诊断和评分证据必须能在学生原文中定位。
- 所有评分标准包含 `legibility` 维度；生成时默认权重为 5%，教师可修改，但总权重必须保持 100%。
- 不引入词级 OCR 置信度，不把无害拼写歧义转成教师复核工作。
- 不改变现有网站侧边栏、路由、详情页左右结构和四个结果 Tab。
- 自动化测试只使用合成内容；真实模型评测不得记录学生身份、作文全文或 Provider 原始响应。

---

## File Structure

### Grading Gateway

- Create `grading-gateway/src/multimodal/gradingPolicy.ts`: 唯一的 `GRADING_POLICY_V1`、可读性维度常量和两种输入模式共用规则。
- Create `grading-gateway/src/multimodal/resultPolicy.ts`: 拼写过滤、重要字迹隔离、引用关系和全文纠错稿重建。
- Create `grading-gateway/src/multimodal/resultPolicy.test.ts`: 纯函数安全护栏测试。
- Modify `grading-gateway/src/multimodal/gradingPrompt.ts`: 严格 schema 和统一策略注入。
- Modify `grading-gateway/src/multimodal/gradingPrompt.test.ts`: 图片与确认文本提示词契约。
- Modify `grading-gateway/src/multimodal/types.ts`: Provider 原始结构和共享枚举。
- Modify `grading-gateway/src/multimodal/rubricPrompts.ts`: 默认 5% 可读性维度。
- Modify `grading-gateway/src/multimodal/rubricPrompts.test.ts`: rubric 提示词契约。
- Modify `grading-gateway/src/multimodal/validateRubric.ts`: 强制唯一 `legibility` 维度。
- Modify `grading-gateway/src/multimodal/validateRubric.test.ts`: 默认和教师修改权重测试。
- Modify `grading-gateway/src/multimodal/normalizeMultimodalResult.ts`: 安全归一化与结构化逻辑输出。
- Modify `grading-gateway/src/multimodal/normalizeMultimodalResult.test.ts`: 端到端归一化测试。
- Modify `grading-gateway/src/types.ts`: 网关公开结果契约。

### Website projection

- Modify `app/src/services/grading/types.ts`: 与网关一致的公开结果字段。
- Modify `app/src/services/grading/projectGradingClientResponse.ts`: 严格投影新字段。
- Modify `app/src/services/grading/projectGradingClientResponse.test.ts`: 非法枚举和缺字段拒绝测试。
- Modify `app/src/services/grading/adaptAiGradingResult.ts`: 贯通 `logicIssues`、`legibilityIssues` 和修改关联。
- Modify `app/src/services/grading/adaptAiGradingResult.test.ts`: 真实适配测试。
- Modify `app/src/types/index.ts`: 网站领域模型。
- Modify `app/src/utils/reviewIssueItems.ts`: 将结构化逻辑和可读性问题转成现有问题卡片。
- Modify `app/src/utils/reviewIssueItems.test.ts`: 优先级与展示文案测试。
- Modify `app/src/pages/EssayResultPage.test.tsx`: 保持布局的页面回归。

### Evaluation

- Create `test-fixtures/kimi-policy/ambiguous-work.svg`: 可合理读为 `work` 的合成字迹。
- Create `test-fixtures/kimi-policy/clear-enviroment.svg`: 明确拼写错误。
- Create `test-fixtures/kimi-policy/ambiguous-cant.svg`: 会改变含义的重要歧义。
- Create `test-fixtures/kimi-policy/grammar-and-logic.svg`: 明确语法和逻辑错误。
- Create `grading-gateway/scripts/runPolicyGoldenEval.ts`: 真实 Kimi 策略评测入口。
- Create `docs/evaluations/multimodal-grading-policy.md`: 仅记录匿名用例、模型/策略版本和通过状态。
- Modify `grading-gateway/package.json`: 添加 `eval:grading-policy`。

---

### Task 1: Establish one versioned grading policy and legibility rubric contract

**Files:**
- Create: `grading-gateway/src/multimodal/gradingPolicy.ts`
- Modify: `grading-gateway/src/multimodal/gradingPrompt.ts`
- Modify: `grading-gateway/src/multimodal/gradingPrompt.test.ts`
- Modify: `grading-gateway/src/multimodal/rubricPrompts.ts`
- Modify: `grading-gateway/src/multimodal/rubricPrompts.test.ts`
- Modify: `grading-gateway/src/multimodal/validateRubric.ts`
- Modify: `grading-gateway/src/multimodal/validateRubric.test.ts`

**Interfaces:**
- Produces: `GRADING_POLICY_VERSION = 'grading-policy-v1'`.
- Produces: `LEGIBILITY_DIMENSION_ID = 'legibility'` and `DEFAULT_LEGIBILITY_WEIGHT = 5`.
- Produces: `gradingPolicyInstructions(mode: 'images' | 'confirmed_transcript'): string[]`.
- Consumes: `buildEssayGradingMessages` in both request modes.

- [ ] **Step 1: Write failing policy prompt tests**

Add exact assertions for both modes:

```ts
const imagePrompt = String(buildEssayGradingMessages(imageInput)[0].content)
const textPrompt = String(buildEssayGradingMessages(textInput)[0].content)

for (const prompt of [imagePrompt, textPrompt]) {
  expect(prompt).toContain('grading-policy-v1')
  expect(prompt).toContain('可合理读成正确单词时按正确处理')
  expect(prompt).toContain('不得作为 spelling、word_choice 或 grammar 变相报告')
  expect(prompt).toContain('优先检查语法、逻辑、任务完成度和表达')
}
expect(imagePrompt).toContain('重要字迹歧义只记为 legibility issue')
expect(textPrompt).not.toContain('重新识别图片')
```

Also assert the old conflicting sentence `Preserve student spelling and grammar exactly` is absent from image mode.

- [ ] **Step 2: Write failing rubric tests**

```ts
expect(buildRubricGenerationMessages(input)[0].content).toContain('legibility')
expect(buildRubricGenerationMessages(input)[0].content).toContain('默认权重 5')

const result = validateGeneratedRubric(validRubricWithLegibility({ weight: 8 }))
expect(result.ok).toBe(true)
expect(validateGeneratedRubric(validRubricWithoutLegibility()).ok).toBe(false)
expect(validateGeneratedRubric(validRubricWithTwoLegibilityDimensions()).ok).toBe(false)
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run from `grading-gateway`:

```powershell
npm.cmd test -- src/multimodal/gradingPrompt.test.ts src/multimodal/rubricPrompts.test.ts src/multimodal/validateRubric.test.ts
```

Expected: FAIL because the policy constant and legibility contract do not exist.

- [ ] **Step 4: Implement the policy module and inject it into both prompt modes**

Use this public shape:

```ts
export const GRADING_POLICY_VERSION = 'grading-policy-v1' as const
export const LEGIBILITY_DIMENSION_ID = 'legibility' as const
export const DEFAULT_LEGIBILITY_WEIGHT = 5 as const

export function gradingPolicyInstructions(
  mode: 'images' | 'confirmed_transcript',
): string[] {
  const shared = [
    `Apply ${GRADING_POLICY_VERSION}.`,
    '拼写是低优先级：只有字母形态清楚、上下文无合理正确读法且正确写法唯一时才能报告。',
    '可合理读成正确单词时按正确处理，不扣分、不警告，也不得作为 spelling、word_choice 或 grammar 变相报告。',
    '优先检查语法、逻辑、任务完成度和表达。',
  ]
  return mode === 'images'
    ? [...shared, '会改变含义或评分的重要字迹歧义只记为 legibility issue，并继续完成整篇批改。']
    : [...shared, '教师确认文本是唯一正文来源，不重新识别图片。']
}
```

Require exactly one rubric dimension with `id === 'legibility'`; permit teacher-edited weight values greater than zero as long as all dimensions total 100.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the Task 1 command again. Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```powershell
git add grading-gateway/src/multimodal/gradingPolicy.ts grading-gateway/src/multimodal/gradingPrompt.ts grading-gateway/src/multimodal/gradingPrompt.test.ts grading-gateway/src/multimodal/rubricPrompts.ts grading-gateway/src/multimodal/rubricPrompts.test.ts grading-gateway/src/multimodal/validateRubric.ts grading-gateway/src/multimodal/validateRubric.test.ts
git commit -m "feat: define conservative multimodal grading policy"
```

### Task 2: Expand the strict multimodal result schema

**Files:**
- Modify: `grading-gateway/src/multimodal/types.ts`
- Modify: `grading-gateway/src/multimodal/gradingPrompt.ts`
- Modify: `grading-gateway/src/multimodal/gradingPrompt.test.ts`
- Modify: `grading-gateway/src/types.ts`

**Interfaces:**
- Produces: `EvidenceCertainty = 'certain' | 'uncertain'`.
- Produces: Provider issue keys and revision relationships.
- Produces: public `LogicIssueV1` and `LegibilityIssueV1`.
- Produces: public `recognitionWarnings` field and `recognition_uncertain` review reason, replacing the old transcription-named compatibility fields.
- Consumes: `GRADING_POLICY_VERSION` and `LEGIBILITY_DIMENSION_ID` from Task 1.

- [ ] **Step 1: Write a failing schema-shape test**

```ts
expect(essayGradingSchema.required).toContain('legibilityIssues')
expect(essayGradingSchema.required).toContain('recognitionWarnings')
expect(essayGradingSchema.properties.issues.items.properties.evidenceCertainty.enum)
  .toEqual(['certain', 'uncertain'])
expect(essayGradingSchema.properties.fullTextRevision.properties.logicIssues.items.required)
  .toEqual([
    'issueKey', 'originalText', 'contextBefore', 'contextAfter', 'subType',
    'severity', 'diagnosis', 'suggestedAction', 'conservativeSuggestion',
    'polishedSuggestion', 'requiresTeacherReview',
  ])
```

- [ ] **Step 2: Run the schema test and verify RED**

```powershell
npm.cmd test -- src/multimodal/gradingPrompt.test.ts
```

Expected: FAIL because certainty, structured logic and legibility are absent.

- [ ] **Step 3: Add exact public types**

```ts
export type EvidenceCertainty = 'certain' | 'uncertain'

export interface LogicIssueV1 {
  id: string
  originalText: string
  contextBefore: string
  contextAfter: string
  subType: 'weak_connection' | 'unclear_logic' | 'missing_cause_effect' | 'unclear_transition' | 'topic_drift' | 'irrelevant_sentence' | 'unclear_reference' | 'missing_motivation' | 'plot_gap'
  severity: 'low' | 'medium' | 'high'
  diagnosis: string
  suggestedAction: 'add_connector' | 'add_bridge_sentence' | 'delete_sentence' | 'replace_sentence' | 'clarify_reference' | 'ask_student_to_explain'
  conservativeSuggestion: string
  polishedSuggestion: string
  requiresTeacherReview: boolean
}

export interface LegibilityIssueV1 {
  id: string
  transcriptText: string
  possibleReadings: string[]
  pageNumber: number
  regionDescription: string
  explanation: string
  defaultOutcome: 'count_as_legibility_error'
}
```

Name the Provider-only types `RawMultimodalIssueV1`, `RawSentenceRevisionV1`, `RawSentencePairV1`, `RawLogicIssueV1` and `RawLegibilityIssueV1`. Raw `issues` must require `issueKey` and `evidenceCertainty`. Raw `sentenceRevisions` and `sentencePairs` must require `relatedIssueKeys` and `changeTypes`. `fullTextRevision` must require `logicIssues`; the top-level result must require `recognitionWarnings` and `legibilityIssues`. Remove `transcriptionWarnings` from the schema and public Gateway type in this task.

- [ ] **Step 4: Add schema limits and enums**

Set `maxItems: 100` for issues/revisions/pairs, `maxItems: 50` for logic and legibility issues, `minItems: 2, maxItems: 4` for `possibleReadings`, and `minimum: 1` for `pageNumber`. Keep `additionalProperties: false` at every object level.

- [ ] **Step 5: Run tests and typecheck**

```powershell
npm.cmd test -- src/multimodal/gradingPrompt.test.ts
npm.cmd run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```powershell
git add grading-gateway/src/multimodal/types.ts grading-gateway/src/multimodal/gradingPrompt.ts grading-gateway/src/multimodal/gradingPrompt.test.ts grading-gateway/src/types.ts
git commit -m "feat: structure grading certainty logic and legibility"
```

### Task 3: Enforce spelling certainty and rebuild the corrected text safely

**Files:**
- Create: `grading-gateway/src/multimodal/resultPolicy.ts`
- Create: `grading-gateway/src/multimodal/resultPolicy.test.ts`
- Modify: `grading-gateway/src/multimodal/normalizeMultimodalResult.ts`
- Modify: `grading-gateway/src/multimodal/normalizeMultimodalResult.test.ts`

**Interfaces:**
- Produces: `applyResultPolicy(raw, transcript): ResultPolicyOutcome | null`.
- Produces: `rebuildCorrectedText(transcript, edits): string | null`.
- Consumes: raw issue keys, certainty, revision links, logic issues and legibility issues from Task 2.

- [ ] **Step 1: Write failing pure-policy tests**

Cover these exact outcomes:

```ts
expect(applyResultPolicy(payloadWithUncertainSpelling(), transcript)).toMatchObject({
  issues: [],
  sentenceRevisions: [],
  reviewReasons: [],
})

expect(applyResultPolicy(payloadWithCertainSpelling(), transcript)?.issues[0]).toMatchObject({
  type: 'spelling',
  evidenceCertainty: 'certain',
})

expect(applyResultPolicy(payloadWithGrammarIssue(), transcript)?.issues[0].type).toBe('grammar')
expect(applyResultPolicy(payloadWithLegibilityOverlap(), transcript)?.issues).toHaveLength(0)
```

Add cases for duplicate issue keys, unknown revision keys, mixed spelling/grammar revisions, duplicate source quotes and overlapping edits. Unsafe relationships must return `null`, not guess.

Define local test builders `payloadWithUncertainSpelling`, `payloadWithCertainSpelling`, `payloadWithGrammarIssue` and `payloadWithLegibilityOverlap` in `resultPolicy.test.ts`; each returns a complete `ResultPolicyInput` so tests do not depend on partial casts.

- [ ] **Step 2: Write failing corrected-text tests**

```ts
expect(rebuildCorrectedText(
  'I suggest you joins the club.',
  [{ originalText: 'you joins', correctedText: 'you join' }],
)).toBe('I suggest you join the club.')

expect(rebuildCorrectedText(
  'work and work',
  [{ originalText: 'work', correctedText: 'walk' }],
)).toBeNull()
```

- [ ] **Step 3: Run the pure-policy tests and verify RED**

```powershell
npm.cmd test -- src/multimodal/resultPolicy.test.ts
```

Expected: FAIL because the module is absent.

- [ ] **Step 4: Implement filtering and relationship checks**

Use these rules in order:

```ts
const keptIssues = raw.issues.filter((issue) => (
  issue.type !== 'spelling'
  || (issue.evidenceCertainty === 'certain' && issue.requiresTeacherReview === false)
))
const keptKeys = new Set(keptIssues.map((issue) => issue.issueKey))

const revisionIsAllowed = (revision: RawSentenceRevisionV1) => (
  revision.relatedIssueKeys.every((key) => keptKeys.has(key))
  && (!revision.changeTypes.includes('spelling')
    || revision.relatedIssueKeys.some((key) => keptCertainSpellingKeys.has(key)))
)
```

Export these policy result types from `resultPolicy.ts`:

```ts
export interface ResultPolicyInput {
  issues: RawMultimodalIssueV1[]
  sentenceRevisions: RawSentenceRevisionV1[]
  sentencePairs: RawSentencePairV1[]
  logicIssues: RawLogicIssueV1[]
  legibilityIssues: RawLegibilityIssueV1[]
  dimensionReasons: string[]
  overallComment: string
  logicNotes: string[]
}

export interface ResultPolicyOutcome extends ResultPolicyInput {
  correctedText: string
  reviewReasons: string[]
}
```

Drop uncertain spelling and its linked revisions silently. Drop any grammar, word-choice or logic item whose quote equals a `legibilityIssue.transcriptText`. Reject unknown keys, duplicate keys, ungrounded quotes, ambiguous replacements or overlapping edits.

- [ ] **Step 5: Prevent filtered spelling from leaking into narrative fields**

For every filtered spelling item, reject the Provider result when its exact `suggestion` appears together with its exact `originalText` in any dimension reason, overall comment or logic note. Construct `fullTextRevision.correctedText` only with `rebuildCorrectedText(transcript, keptSentencePairs)`; do not trust the Provider aggregate corrected text.

- [ ] **Step 6: Integrate the policy before existing score normalization**

Call `applyResultPolicy` before `normalizeGradingResult`. An unsafe policy outcome returns the existing safe `provider_invalid_response`; filtered spelling alone does not add `reviewReasons`, does not change success to partial and does not create a transcription warning.

- [ ] **Step 7: Run focused normalization tests and typecheck**

```powershell
npm.cmd test -- src/multimodal/resultPolicy.test.ts src/multimodal/normalizeMultimodalResult.test.ts
npm.cmd run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```powershell
git add grading-gateway/src/multimodal/resultPolicy.ts grading-gateway/src/multimodal/resultPolicy.test.ts grading-gateway/src/multimodal/normalizeMultimodalResult.ts grading-gateway/src/multimodal/normalizeMultimodalResult.test.ts
git commit -m "feat: enforce high-certainty spelling corrections"
```

### Task 4: Normalize structured logic and important handwriting ambiguity

**Files:**
- Modify: `grading-gateway/src/multimodal/normalizeMultimodalResult.ts`
- Modify: `grading-gateway/src/multimodal/normalizeMultimodalResult.test.ts`
- Modify: `grading-gateway/src/server.test.ts`

**Interfaces:**
- Produces: normalized `fullTextRevision.logicIssues: LogicIssueV1[]`.
- Produces: normalized top-level `legibilityIssues: LegibilityIssueV1[]` and `recognitionWarnings: string[]`.
- Preserves: one completed result for a local ambiguity; only globally unreadable images fail.

- [ ] **Step 1: Add failing logic grounding tests**

```ts
const normalized = normalizeMultimodalResult(payloadWithLogicIssue(), context)
expect(normalized.ok && normalized.result.fullTextRevision?.logicIssues[0]).toMatchObject({
  subType: 'irrelevant_sentence',
  originalText: 'My cat is blue.',
  suggestedAction: 'delete_sentence',
})
```

Reject a logic issue when `originalText`, non-empty `contextBefore` or non-empty `contextAfter` cannot be matched in the transcript.

- [ ] **Step 2: Add failing legibility tests**

```ts
const normalized = normalizeMultimodalResult(payloadWithCantAmbiguity(), context)
expect(normalized.ok && normalized.result.status).toBe('success')
expect(normalized.ok && normalized.result.legibilityIssues[0]).toMatchObject({
  possibleReadings: ['can', "can't"],
  defaultOutcome: 'count_as_legibility_error',
})
expect(normalized.ok && normalized.result.reviewReasons).not.toContain('recognition_uncertain')
```

Also assert that a local `legibilityIssue` does not create grammar, spelling or logic output for the same quote, and that only the `legibility` dimension may cite it as a deduction.

- [ ] **Step 3: Run tests and verify RED**

```powershell
npm.cmd test -- src/multimodal/normalizeMultimodalResult.test.ts src/server.test.ts
```

Expected: FAIL while the fields are not normalized.

- [ ] **Step 4: Implement exact grounding and page validation**

Validate `pageNumber` against the request page count in image mode. In confirmed-text mode require `legibilityIssues` to be empty. Give normalized IDs the stable forms `${essayId}-logic-${index + 1}` and `${essayId}-legibility-${index + 1}`.

- [ ] **Step 5: Separate local ambiguity from global recognition warnings**

`recognitionWarnings` remains reserved for a globally meaningful uncertainty that cannot be represented as a local legibility item or for an unreliable printed/student boundary. Local `legibilityIssues` alone must leave the result `success`; global warnings keep the existing `partial` behavior.

- [ ] **Step 6: Run Gateway tests and typecheck**

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run verify:shared-scoring-runtime
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit Task 4**

```powershell
git add grading-gateway/src/multimodal/normalizeMultimodalResult.ts grading-gateway/src/multimodal/normalizeMultimodalResult.test.ts grading-gateway/src/server.test.ts
git commit -m "feat: normalize logic and legibility findings"
```

### Task 5: Project the new result through the website without changing layout

**Files:**
- Modify: `app/src/services/grading/types.ts`
- Modify: `app/src/services/grading/projectGradingClientResponse.ts`
- Modify: `app/src/services/grading/projectGradingClientResponse.test.ts`
- Modify: `app/src/services/grading/adaptAiGradingResult.ts`
- Modify: `app/src/services/grading/adaptAiGradingResult.test.ts`
- Modify: `app/src/types/index.ts`
- Modify: `app/src/utils/reviewIssueItems.ts`
- Modify: `app/src/utils/reviewIssueItems.test.ts`
- Modify: `app/src/pages/EssayResultPage.test.tsx`

**Interfaces:**
- Consumes: `EvidenceCertainty`, `LogicIssueV1`, `LegibilityIssueV1` and `recognitionWarnings` from the Gateway response.
- Produces: `GradingResult.fullTextRevision.logicIssues` with real AI values.
- Produces: `GradingResult.legibilityIssues` and existing review-card inputs.

- [ ] **Step 1: Write failing response projection tests**

Require every spelling issue to include `evidenceCertainty`, every revision to include `relatedIssueIds` and `changeTypes`, every success result to include `recognitionWarnings` and `legibilityIssues`, and every full-text revision to include `logicIssues`. Reject unknown enum values with the existing safe gateway failure and reject the removed `transcriptionWarnings` field.

```ts
expect(projectGradingClientResponse(validResponse, expected)).toMatchObject({
  status: 'success',
  legibilityIssues: [],
  fullTextRevision: { logicIssues: expect.any(Array) },
})
```

- [ ] **Step 2: Write failing adapter tests**

```ts
const adapted = adaptAiGradingResult(aiResultWithLogicAndLegibility(), request)
expect(adapted.fullTextRevision?.logicIssues).toHaveLength(1)
expect(adapted.legibilityIssues[0].defaultOutcome).toBe('count_as_legibility_error')
expect(adapted.errorAnnotations[0].evidenceCertainty).toBe('certain')
```

Keep the existing assertion that `modelSelfConfidence` is not mapped to `aiConfidence`.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm.cmd test -- src/services/grading/projectGradingClientResponse.test.ts src/services/grading/adaptAiGradingResult.test.ts src/utils/reviewIssueItems.test.ts
```

Expected: FAIL because the adapter currently hardcodes `logicIssues: []` and has no legibility output.

- [ ] **Step 4: Implement strict projection and domain mapping**

Use the same literal unions as Task 2. Map `relatedIssueIds` to `relatedErrorIds`; preserve `changeTypes`; copy logic context and suggested actions exactly; do not derive `aiConfidence`.

- [ ] **Step 5: Add a legibility card to the existing issue list**

Map each legibility item to the existing review card pipeline with:

```ts
{
  source: 'legibility',
  categoryLabel: '卷面与可读性',
  title: '字迹不清导致语义无法确认',
  original: issue.transcriptText,
  diagnosis: issue.explanation,
  suggestion: `系统默认按错误处理；可能读法：${issue.possibleReadings.join(' / ')}`,
  severity: 'medium',
}
```

Order cards as grammar/logic/task-expression findings first, legibility next, high-certainty spelling last. Keep the same page columns and result Tabs.

- [ ] **Step 6: Run focused UI tests, full frontend tests and build**

```powershell
npm.cmd test -- src/services/grading/projectGradingClientResponse.test.ts src/services/grading/adaptAiGradingResult.test.ts src/utils/reviewIssueItems.test.ts src/pages/EssayResultPage.test.tsx
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit Task 5**

```powershell
git add app/src/services/grading app/src/types/index.ts app/src/utils/reviewIssueItems.ts app/src/utils/reviewIssueItems.test.ts app/src/pages/EssayResultPage.test.tsx
git commit -m "feat: surface structured logic and legibility results"
```

### Task 6: Add deterministic synthetic fixtures and a real-model golden evaluation

**Files:**
- Create: `test-fixtures/kimi-policy/ambiguous-work.svg`
- Create: `test-fixtures/kimi-policy/clear-enviroment.svg`
- Create: `test-fixtures/kimi-policy/ambiguous-cant.svg`
- Create: `test-fixtures/kimi-policy/grammar-and-logic.svg`
- Create: `grading-gateway/scripts/runPolicyGoldenEval.ts`
- Create: `docs/evaluations/multimodal-grading-policy.md`
- Modify: `grading-gateway/package.json`

**Interfaces:**
- Produces: `npm.cmd run eval:grading-policy`.
- Consumes: ignored `KIMI_API_KEY` and the production Kimi transport.
- Produces: no tracked raw transcript or Provider response.

- [ ] **Step 1: Create the four synthetic SVG fixtures**

Use only fictional content. Give each file a visible case ID rather than a student name. The grammar/logic fixture must include `I suggest you joins the club.` and an unrelated sentence. The ambiguous fixtures must visually merge the distinguishing strokes without printing the expected answer on the image.

- [ ] **Step 2: Visually inspect every fixture**

Open each SVG and confirm it contains no identity data, secret, copied student work or expected-label text. Record only the four case IDs in the evaluation document.

- [ ] **Step 3: Implement the evaluator with exact assertions**

```ts
const checks = {
  ambiguousWork: result.issues.every((issue) => issue.type !== 'spelling')
    && result.legibilityIssues.length === 0
    && !result.reviewReasons.includes('recognition_uncertain'),
  clearEnviroment: result.issues.some((issue) => (
    issue.type === 'spelling' && issue.evidenceCertainty === 'certain'
  )),
  ambiguousCant: result.legibilityIssues.some((issue) => (
    issue.defaultOutcome === 'count_as_legibility_error'
  )),
  grammarAndLogic: result.issues.some((issue) => issue.type === 'grammar')
    && Boolean(result.fullTextRevision?.logicIssues.length),
}
```

The script must print case ID, pass/fail, model name and policy version only. It must not print transcript, comments, image data or raw response.

- [ ] **Step 4: Add the package command and run offline checks**

```json
{
  "scripts": {
    "eval:grading-policy": "tsx scripts/runPolicyGoldenEval.ts"
  }
}
```

Run `npm.cmd test` and `npm.cmd run typecheck`; both must pass before any paid call.

- [ ] **Step 5: Run one bounded real evaluation when credentials are available**

```powershell
npm.cmd run eval:grading-policy
```

Expected: four case IDs and their boolean outcomes. Do not retry automatically. If credentials are absent, record `not_run_missing_local_credentials` without weakening automated tests.

- [ ] **Step 6: Record anonymized evaluation status**

The document table contains `case_id`, `policy_version`, `model`, `run_date`, `pass` and a short failure category. It contains no complete essay text or image embedding.

- [ ] **Step 7: Commit Task 6**

```powershell
git add test-fixtures/kimi-policy grading-gateway/scripts/runPolicyGoldenEval.ts grading-gateway/package.json grading-gateway/package-lock.json docs/evaluations/multimodal-grading-policy.md
git commit -m "test: add multimodal grading policy evaluation"
```

### Task 7: Run phase verification and update active status documentation

**Files:**
- Modify: `docs/current_development_status.md`

**Interfaces:**
- Consumes: all prior tasks in this plan.
- Produces: a clean, documented Phase 1 handoff for the OCR-removal plan.

- [ ] **Step 1: Run the complete Gateway matrix**

```powershell
Set-Location grading-gateway
npm.cmd test
npm.cmd run typecheck
npm.cmd run verify:shared-scoring-runtime
```

Expected: all commands exit 0.

- [ ] **Step 2: Run the complete website matrix**

```powershell
Set-Location ..\app
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Scan for policy conflicts and leaked private data**

```powershell
Set-Location ..
rg -n "Preserve student spelling and grammar exactly|all spelling errors|逐字保留所有拼写" grading-gateway/src app/src
git diff --check
git status --short
```

Expected: no conflicting policy phrase; only intentional files are modified; diff check is clean.

- [ ] **Step 4: Update the active status document**

Add the policy version, exact automated commands, real-eval status, known model failures and the next phase. Do not alter archived historical specs or paste raw model output.

- [ ] **Step 5: Commit Task 7**

```powershell
git add docs/current_development_status.md
git commit -m "docs: record multimodal grading policy verification"
```

---

## Plan Self-Review

- Spec coverage: 保守拼写、无害歧义默认正确、重要歧义默认计入可读性、结构化逻辑、引用定位、全文纠错稿防泄漏、真实视觉评测均有独立任务。
- Placeholder scan: 计划不含空白实现、泛化“补测试”步骤或未定义接口。
- Type consistency: `EvidenceCertainty`、`LogicIssueV1`、`LegibilityIssueV1`、`relatedIssueIds`、`changeTypes` 在 Gateway、客户端投影和领域模型中保持同名同枚举。
- Layout constraint: 只扩展现有问题卡片的数据来源，不新增路由、不移动左右栏、不改变四个结果 Tab。
- Failure behavior: 不确定拼写静默过滤；局部重要字迹继续出结果；不安全关系或无法重建的纠错稿拒绝为安全失败。
- Handoff: 本计划完成后再执行 `2026-08-15-remove-ocr-web-migration.md`。
