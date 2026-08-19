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
    'overallComment 不得出现任何数字评分，包括总分、分项分或 x/y 写法；overallComment 不得重复 reportedTotalScore。',
    'overallComment 的反馈顺序必须为任务完成度、逻辑和语法优先于拼写；明确拼写仅在末尾简要提醒。存在这些高优先级问题时，不得推荐专项拼写训练或专项拼写练习。',
    '同一明确拼写错误不得出现在多个 issue 记录中。若 spelling quote 与 grammar quote 重叠，省略 spelling 记录并保留 grammar 记录；spelling issue 的 suggestion 和 explanation 只能处理该拼写错误，不得顺带修改语法或逻辑。',
  ]
  return mode === 'images'
    ? [
        ...shared,
        '视觉保守例子：遇到 wark / work 或 hepe / hope 这类字形时，只要字形与上下文可合理读成正确单词，transcript 直接采用正确读法 work 或 hope，并保持静默：不输出 issue、warning 或扣分；不得把疑似拼写改标为 grammar 或 word_choice 来规避策略。',
        '清晰错误对照：若字母形态清楚写成 becaus、adrice 或 frends，transcript 必须原样保留；不得静默改写为 because、advice 或 friends。此类无合理正确读法的明确错误可作为低优先级 spelling 报告，但不得重复归类或挤占语法、逻辑反馈。filling 本身是合法单词，不得仅凭词形把它当作 feeling 的拼写错误；若上下文确有明确用词问题，只能按证据充分的 word_choice 处理。',
        '会改变含义或评分的重要字迹歧义只记为 legibility issue，并继续完成整篇批改。',
      ]
    : [...shared, '教师确认文本是唯一正文来源，不重新识别图片。']
}
