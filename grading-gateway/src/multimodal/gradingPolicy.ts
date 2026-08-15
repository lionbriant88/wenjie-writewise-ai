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
