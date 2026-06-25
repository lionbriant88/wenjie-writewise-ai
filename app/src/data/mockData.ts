import type {
  ClassInsight,
  Essay,
  EssayPage,
  EssayStatus,
  GradingResult,
  Task,
} from '../types'

const baseDate = '2026-06-25T09:00:00.000Z'

const page = (
  essayId: string,
  pageNumber: number,
  quality: EssayPage['quality'] = 'clear',
): EssayPage => ({
  id: `${essayId}-p${pageNumber}`,
  label: `Page ${pageNumber}`,
  pageNumber,
  quality,
  accent:
    quality === 'clear'
      ? '#4f7cff'
      : quality === 'blurred'
        ? '#e89131'
        : quality === 'messy'
          ? '#d44b5f'
          : '#64748b',
})

const essay = (
  taskId: string,
  index: number,
  status: EssayStatus,
  ocrConfidence: number,
  pageCount = 1,
  quality: EssayPage['quality'] = 'clear',
): Essay => {
  const id = `${taskId}-essay-${index}`
  const pages = Array.from({ length: pageCount }, (_, pageIndex) =>
    page(id, pageIndex + 1, quality),
  )

  return {
    id,
    taskId,
    essayNumber: `作文 ${index}`,
    pages,
    pageCount,
    pageOrder: pages.map((essayPage) => essayPage.id),
    ocrText:
      'Dear Peter, I am glad to hear that you are interested in our reading festival. I think you can join the English corner and share your favorite book with classmates. It will help you learn more words and make friends.',
    ocrConfidence,
    status,
    exceptionReasons:
      status === 'needs_review'
        ? ocrConfidence < 0.72
          ? ['low_ocr_confidence']
          : quality === 'blurred'
            ? ['blurry_image']
            : ['messy_handwriting']
        : [],
    aiResultId: status === 'completed' ? `${id}-result` : undefined,
    teacherReviewed: status === 'completed',
    createdAt: baseDate,
    updatedAt: baseDate,
  }
}

const dimensions = (seed: number) => [
  {
    id: 'content',
    name: '内容完成度',
    score: 3.4 + (seed % 2) * 0.2,
    maxScore: 3.75,
    weight: 25,
    reason: '覆盖主要信息点，个别细节展开不足。',
    evidence: 'The student explains the activity and gives one clear reason.',
  },
  {
    id: 'accuracy',
    name: '语言准确性',
    score: 3,
    maxScore: 3.75,
    weight: 25,
    reason: '有少量时态、冠词和主谓一致错误。',
    evidence: 'I suggest you joins the club.',
  },
  {
    id: 'clarity',
    name: '表达清晰度',
    score: 2.1,
    maxScore: 2.25,
    weight: 15,
    reason: '句意基本清楚，衔接还可以更自然。',
    evidence: 'The paragraph order is easy to follow.',
  },
  {
    id: 'vocabulary',
    name: '词汇句式',
    score: 2,
    maxScore: 2.25,
    weight: 15,
    reason: '词汇准确，但高级表达较少。',
    evidence: 'Uses good, nice, important repeatedly.',
  },
  {
    id: 'intention',
    name: '意图表达清晰度',
    score: 1.4,
    maxScore: 1.5,
    weight: 10,
    reason: '读者能理解学生的建议意图。',
    evidence: 'The recommendation is direct and understandable.',
  },
  {
    id: 'handwriting',
    name: '卷面/字迹',
    score: 1.2,
    maxScore: 1.5,
    weight: 10,
    reason: '卷面较整洁，个别单词连写影响识别。',
    evidence: 'Several words need manual OCR confirmation.',
  },
]

const resultFor = (essayId: string, seed: number): GradingResult => ({
  id: `${essayId}-result`,
  essayId,
  totalScore: 12.6 + (seed % 3) * 0.2,
  dimensionScores: dimensions(seed),
  errorAnnotations: [
    {
      id: `${essayId}-err-1`,
      type: 'grammar',
      original: 'I suggest you joins the club.',
      suggestion: 'I suggest you join the club.',
      explanation: 'suggest 后的宾语从句用动词原形。',
      severity: 'high',
    },
    {
      id: `${essayId}-err-2`,
      type: 'spelling',
      original: 'enviroment',
      suggestion: 'environment',
      explanation: 'environment 拼写遗漏了 n。',
      severity: 'medium',
    },
    {
      id: `${essayId}-err-3`,
      type: 'word_choice',
      original: 'It can make you know many knowledge.',
      suggestion: 'It can help you gain a lot of knowledge.',
      explanation: 'knowledge 是不可数名词，搭配 gain 更自然。',
      severity: 'medium',
    },
  ],
  sentenceRevisions: [
    {
      id: `${essayId}-rev-1`,
      original: 'It is very good for you.',
      revised: 'It will give you a valuable chance to practice English.',
      note: '把笼统评价改成具体收益。',
    },
    {
      id: `${essayId}-rev-2`,
      original: 'You can make more friends and learn more things.',
      revised:
        'You can make new friends while learning practical expressions from them.',
      note: '用 while 连接两个相关动作，表达更紧凑。',
    },
  ],
  upgradedExpressions: [
    {
      id: `${essayId}-up-1`,
      original: 'I think',
      upgraded: 'From my point of view',
      note: '适合建议信开头，语气更正式。',
    },
    {
      id: `${essayId}-up-2`,
      original: 'very important',
      upgraded: 'of great importance',
      note: '可用于强调活动意义。',
    },
  ],
  overallComment:
    '文章结构完整，能回应题目要求。下一步重点是减少基础语法错误，并把笼统表达改成更具体的建议。',
  aiConfidence: 0.86,
  teacherAdjusted: false,
  createdAt: baseDate,
  updatedAt: baseDate,
})

export const mockTasks: Task[] = [
  {
    id: 'task-1',
    taskName: '九年级建议信单元测',
    className: '九年级 3 班',
    essayType: '建议信',
    fullScore: 15,
    scoringTemplateId: 'default-15',
    status: 'needs_review',
    totalEssayCount: 10,
    completedEssayCount: 7,
    exceptionEssayCount: 2,
    createdAt: '2026-06-24T08:30:00.000Z',
    updatedAt: baseDate,
    generateClassReview: true,
  },
  {
    id: 'task-2',
    taskName: '高一邀请信课堂练习',
    className: '高一 6 班',
    essayType: '邀请信',
    fullScore: 15,
    scoringTemplateId: 'default-15',
    status: 'processing',
    totalEssayCount: 8,
    completedEssayCount: 4,
    exceptionEssayCount: 1,
    createdAt: '2026-06-23T13:20:00.000Z',
    updatedAt: baseDate,
    generateClassReview: true,
  },
  {
    id: 'task-3',
    taskName: '八年级通知写作作业',
    className: '八年级 1 班',
    essayType: '通知',
    fullScore: 15,
    scoringTemplateId: 'default-15',
    status: 'ready',
    totalEssayCount: 12,
    completedEssayCount: 12,
    exceptionEssayCount: 0,
    createdAt: '2026-06-21T10:10:00.000Z',
    updatedAt: baseDate,
    generateClassReview: true,
  },
]

export const mockEssays: Essay[] = [
  ...Array.from({ length: 10 }, (_, index) => {
    const number = index + 1
    if (number === 3) return essay('task-1', number, 'needs_review', 0.61, 2, 'messy')
    if (number === 7) return essay('task-1', number, 'needs_review', 0.74, 1, 'blurred')
    if (number === 9) return essay('task-1', number, 'grading', 0.88, 2)
    return essay('task-1', number, 'completed', 0.89, number === 5 ? 2 : 1)
  }),
  ...Array.from({ length: 8 }, (_, index) => {
    const number = index + 1
    if (number === 2) return essay('task-2', number, 'needs_review', 0.68, 1, 'messy')
    if (number <= 4) return essay('task-2', number, 'completed', 0.9, number === 4 ? 2 : 1)
    return essay('task-2', number, number === 5 ? 'ocr_running' : 'pending_grading', 0.83)
  }),
  ...Array.from({ length: 12 }, (_, index) =>
    essay('task-3', index + 1, 'completed', 0.92, index === 1 ? 2 : 1),
  ),
]

export const mockGradingResults: GradingResult[] = mockEssays
  .filter((item) => item.status === 'completed')
  .map((item, index) => resultFor(item.id, index))

export const mockClassInsights: ClassInsight[] = mockTasks.map((task) => ({
  id: `${task.id}-insight`,
  taskId: task.id,
  grammarErrors: [
    {
      id: `${task.id}-grammar-1`,
      title: 'suggest 后动词形式错误',
      detail: '学生常把 suggest you do 写成 suggest you does / joins。',
      count: 8,
      examples: ['I suggest you joins the club.', 'I suggest he goes there.'],
    },
    {
      id: `${task.id}-grammar-2`,
      title: '时态前后不一致',
      detail: '介绍活动安排时现在时和将来时混用。',
      count: 6,
      examples: ['The meeting is begin at 3 p.m.', 'We will visited the museum.'],
    },
    {
      id: `${task.id}-grammar-3`,
      title: '冠词遗漏',
      detail: '可数名词单数前缺少 a 或 the。',
      count: 5,
      examples: ['It is useful activity.', 'You can join club.'],
    },
    {
      id: `${task.id}-grammar-4`,
      title: '主谓一致',
      detail: '第三人称单数和复数主语对应不稳定。',
      count: 5,
      examples: ['The activity help us.', 'Many student likes it.'],
    },
    {
      id: `${task.id}-grammar-5`,
      title: '介词搭配',
      detail: 'be interested in、take part in 等固定搭配出错。',
      count: 4,
      examples: ['I am interested on it.', 'You can take part the game.'],
    },
  ],
  spellingErrors: [
    {
      id: `${task.id}-spell-1`,
      title: 'environment',
      detail: '常误写为 enviroment。',
      count: 7,
      examples: ['We should protect the enviroment.'],
    },
    {
      id: `${task.id}-spell-2`,
      title: 'necessary',
      detail: '常误写为 neccessary。',
      count: 5,
      examples: ['It is neccessary to read more.'],
    },
    {
      id: `${task.id}-spell-3`,
      title: 'activity',
      detail: '常误写为 activety。',
      count: 4,
      examples: ['This activety is meaningful.'],
    },
    {
      id: `${task.id}-spell-4`,
      title: 'because',
      detail: '常误写为 becuase。',
      count: 4,
      examples: ['Becuase it is helpful.'],
    },
    {
      id: `${task.id}-spell-5`,
      title: 'favorite',
      detail: '常误写为 favourite/favorate 混用。',
      count: 3,
      examples: ['My favorate book is The Old Man and the Sea.'],
    },
  ],
  typicalSentences: [
    {
      id: `${task.id}-sentence-1`,
      title: '笼统表达',
      detail: 'good / nice / important 使用过多，缺少具体意义。',
      examples: ['It is very good for you.'],
    },
    {
      id: `${task.id}-sentence-2`,
      title: '中式表达',
      detail: '逐词翻译导致搭配不自然。',
      examples: ['It can make you know many knowledge.'],
    },
    {
      id: `${task.id}-sentence-3`,
      title: '建议不够可执行',
      detail: '只说 should join，没有解释如何参与。',
      examples: ['You should join it because it is useful.'],
    },
    {
      id: `${task.id}-sentence-4`,
      title: '缺少连接',
      detail: '句子之间并列堆叠，逻辑关系不清。',
      examples: ['You can go there. You can read books. You can talk.'],
    },
    {
      id: `${task.id}-sentence-5`,
      title: '结尾模板化',
      detail: '结尾没有回扣写作目的。',
      examples: ['I hope you can come.'],
    },
  ],
  rewriteExercises: [
    {
      id: `${task.id}-rewrite-1`,
      title: '把笼统评价改具体',
      detail: 'It is very good for you.',
      examples: ['It will give you a valuable chance to practice English.'],
    },
    {
      id: `${task.id}-rewrite-2`,
      title: '用连接词整合信息',
      detail: 'You can make friends. You can practice speaking.',
      examples: ['You can make friends while practicing spoken English.'],
    },
    {
      id: `${task.id}-rewrite-3`,
      title: '改写 suggest 句型',
      detail: 'I suggest you joins the club.',
      examples: ['I suggest you join the club.'],
    },
    {
      id: `${task.id}-rewrite-4`,
      title: '升级 important',
      detail: 'Reading is very important.',
      examples: ['Reading is of great importance to language learning.'],
    },
    {
      id: `${task.id}-rewrite-5`,
      title: '补充行动细节',
      detail: 'You should take part in it.',
      examples: ['You can sign up before Friday and prepare a three-minute speech.'],
    },
  ],
}))
