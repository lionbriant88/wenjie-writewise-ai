import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import type { RubricDimension, WritingGenre } from '../types'

type CreateTaskStep = 'basic' | 'prompt' | 'rubric'
type RubricStatus = 'idle' | 'draft' | 'confirmed'

const practicalWritingTypes = [
  '建议信',
  '邀请信',
  '申请信',
  '感谢信',
  '通知',
  '演讲稿',
  '报道',
  '咨询信',
  '倡议书',
  'For and Against essay',
]

const continuationWritingTypes = ['故事续写']

const stepLabels: Record<CreateTaskStep, string> = {
  basic: '基础信息',
  prompt: '题目信息',
  rubric: '评分标准确认',
}

const practicalDimensions: RubricDimension[] = [
  {
    id: 'handwriting',
    name: '卷面/字迹',
    weight: 10,
    description: '书写清晰，卷面整洁，便于识别。',
    deductionFocus: ['字迹潦草影响识别', '卷面涂改过多'],
  },
  {
    id: 'content',
    name: '内容完成度',
    weight: 25,
    description: '紧扣题目任务，覆盖主要信息点。',
    deductionFocus: ['要点遗漏', '内容空泛'],
  },
  {
    id: 'accuracy',
    name: '语言准确性',
    weight: 25,
    description: '语法、拼写、搭配和时态基本准确。',
    deductionFocus: ['基础语法错误', '拼写错误影响理解'],
  },
  {
    id: 'clarity',
    name: '表达清晰度',
    weight: 15,
    description: '结构清楚，句意明确，读者容易理解。',
    deductionFocus: ['句意不清', '段落组织松散'],
  },
  {
    id: 'vocabulary',
    name: '词汇句式',
    weight: 15,
    description: '词汇和句式适合应用文场景。',
    deductionFocus: ['表达重复', '语体不够得体'],
  },
  {
    id: 'intention',
    name: '意图表达清晰度',
    weight: 10,
    description: '写作目的明确，语气符合任务对象。',
    deductionFocus: ['意图不明确', '语气不符合应用文情境'],
  },
]

const continuationDimensions: RubricDimension[] = [
  {
    id: 'plot',
    name: '情节衔接与合理性',
    weight: 25,
    description: '续写情节自然承接原文，发展合理。',
    deductionFocus: ['情节突兀', '与原文冲突'],
  },
  {
    id: 'content',
    name: '内容完整度',
    weight: 20,
    description: '两段续写完整，回应开头句和核心情境。',
    deductionFocus: ['段落发展不足', '结尾不完整'],
  },
  {
    id: 'accuracy',
    name: '语言准确性',
    weight: 20,
    description: '语言基本准确，错误不影响故事理解。',
    deductionFocus: ['语法错误较多', '时态混乱'],
  },
  {
    id: 'coherence',
    name: '语篇连贯性',
    weight: 15,
    description: '段落之间、句子之间衔接自然。',
    deductionFocus: ['衔接词使用不足', '叙事顺序混乱'],
  },
  {
    id: 'theme',
    name: '人物情感与主题升华',
    weight: 10,
    description: '人物反应可信，主题表达自然。',
    deductionFocus: ['人物情感突变', '主题升华生硬'],
  },
  {
    id: 'handwriting',
    name: '卷面/字迹',
    weight: 10,
    description: '书写清晰，卷面整洁，便于识别。',
    deductionFocus: ['字迹潦草影响识别', '卷面涂改过多'],
  },
]

function getDimensions(writingGenre: WritingGenre) {
  return writingGenre === 'practical_writing' ? practicalDimensions : continuationDimensions
}

function getRubricGoal(writingGenre: WritingGenre) {
  return writingGenre === 'practical_writing'
    ? '本题写作目标：围绕题目要求完成应用文任务，内容完整、表达得体、语言准确。'
    : '本题续写目标：在理解原文情境的基础上完成两段续写，保持情节合理、人物情感自然、主题表达清晰。'
}

function getOffTopicTitle(writingGenre: WritingGenre) {
  return writingGenre === 'practical_writing' ? '是否跑题判断依据' : '是否脱离原文判断依据'
}

function getExcellentTitle(writingGenre: WritingGenre) {
  return writingGenre === 'practical_writing' ? '优秀作文特征' : '优秀续写特征'
}

function stepButtonClass(active: boolean) {
  return active
    ? 'rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800'
    : 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600'
}

export function CreateTaskPage() {
  const navigate = useNavigate()
  const { createTask } = useAppState()
  const [currentStep, setCurrentStep] = useState<CreateTaskStep>('basic')
  const [writingGenre, setWritingGenre] = useState<WritingGenre>('practical_writing')
  const [essayType, setEssayType] = useState(practicalWritingTypes[0])
  const [taskName, setTaskName] = useState('九年级建议信课堂训练')
  const [className, setClassName] = useState('九年级 2 班')
  const [fullScore, setFullScore] = useState(15)
  const [generateClassReview, setGenerateClassReview] = useState(true)
  const [practicalPrompt, setPracticalPrompt] = useState('')
  const [continuationSourceText, setContinuationSourceText] = useState('')
  const [paragraph1Opening, setParagraph1Opening] = useState('')
  const [paragraph2Opening, setParagraph2Opening] = useState('')
  const [teacherRequirements, setTeacherRequirements] = useState('')
  const [deductionFocus, setDeductionFocus] = useState('')
  const [excellentFocus, setExcellentFocus] = useState('')
  const [rubricStatus, setRubricStatus] = useState<RubricStatus>('idle')
  const [promptError, setPromptError] = useState('')
  const [genreSwitchNotice, setGenreSwitchNotice] = useState('')
  const [rubricReferencedTeacherRequirements, setRubricReferencedTeacherRequirements] = useState(false)

  const dimensions = getDimensions(writingGenre)
  const essayTypeOptions = writingGenre === 'practical_writing' ? practicalWritingTypes : continuationWritingTypes

  const resetRubric = (notice?: string) => {
    setRubricStatus('idle')
    setRubricReferencedTeacherRequirements(false)
    setPromptError('')
    if (notice) setGenreSwitchNotice(notice)
  }

  const changeWritingGenre = (nextGenre: WritingGenre) => {
    setWritingGenre(nextGenre)
    setEssayType(nextGenre === 'practical_writing' ? practicalWritingTypes[0] : continuationWritingTypes[0])
    resetRubric('写作大类已切换，请重新生成本任务评分标准。')
  }

  const validatePromptInfo = () => {
    if (writingGenre === 'practical_writing') {
      if (!practicalPrompt.trim()) {
        setPromptError('请填写题目要求 / 写作任务。')
        return false
      }
      setPromptError('')
      return true
    }

    if (!continuationSourceText.trim() || !paragraph1Opening.trim() || !paragraph2Opening.trim()) {
      setPromptError('请填写原文材料和两段开头句。')
      return false
    }
    setPromptError('')
    return true
  }

  const generateRubric = () => {
    if (!validatePromptInfo()) return
    setRubricStatus('draft')
    setRubricReferencedTeacherRequirements(Boolean(teacherRequirements.trim()))
  }

  const submitConfirmedTask = () => {
    if (rubricStatus !== 'confirmed') return

    const taskId = createTask({
      taskName,
      className,
      essayType,
      fullScore,
      scoringTemplateId: writingGenre === 'practical_writing' ? 'practical-writing-v02' : 'continuation-writing-v02',
      generateClassReview,
      writingGenre,
      promptInfo: {
        writingGenre,
        practicalWritingType: writingGenre === 'practical_writing' ? essayType : undefined,
        manualPromptText: writingGenre === 'practical_writing' ? practicalPrompt : continuationSourceText,
        teacherRequirements: teacherRequirements.trim() || undefined,
        deductionFocus: deductionFocus.trim() || undefined,
        excellentFocus: excellentFocus.trim() || undefined,
        continuationPrompt:
          writingGenre === 'continuation_writing'
            ? {
                sourceText: continuationSourceText,
                paragraph1Opening,
                paragraph2Opening,
              }
            : undefined,
      },
      rubricDraft: {
        source: 'mock_ai',
        writingGoal: getRubricGoal(writingGenre),
        offTopicCriteria:
          writingGenre === 'practical_writing'
            ? ['未回应题目要求', '主要内容要点明显缺失', '应用文对象或目的错误']
            : ['续写情节脱离原文', '两段开头句没有得到回应', '人物行为与原文设定冲突'],
        dimensions,
        excellentFeatures:
          writingGenre === 'practical_writing'
            ? ['要点完整，语气得体', '建议具体，结构清楚', '语言准确且有一定句式变化']
            : ['情节自然推进', '人物情感可信', '主题表达自然不突兀'],
        reviewTriggers:
          writingGenre === 'practical_writing'
            ? ['疑似跑题', '题目要求理解有争议', '卷面严重影响识别']
            : ['情节明显脱离原文', '人物动机不清', '续写结尾与原文主题冲突'],
        teacherEditableNotes: teacherRequirements,
        status: 'confirmed',
      },
    })
    navigate(`/tasks/${taskId}/upload`)
  }

  return (
    <AppLayout
      title="创建批改任务"
      description="先确认题目信息和本任务评分标准，再进入上传整理、OCR mock 与批改队列。"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault()
            submitConfirmedTask()
          }}
        >
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap gap-2" aria-label="创建任务步骤">
              {(['basic', 'prompt', 'rubric'] as CreateTaskStep[]).map((step) => (
                <button
                  key={step}
                  type="button"
                  onClick={() => setCurrentStep(step)}
                  className={stepButtonClass(currentStep === step)}
                >
                  {stepLabels[step]}
                </button>
              ))}
            </div>
          </section>

          {genreSwitchNotice ? (
            <p className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              {genreSwitchNotice}
            </p>
          ) : null}

          {currentStep === 'basic' ? (
            <section className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold text-slate-950">基础信息</h3>
                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                  第 1 步
                </span>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium text-slate-700 md:col-span-2">
                  任务名称
                  <input
                    name="taskName"
                    required
                    value={taskName}
                    onChange={(event) => setTaskName(event.target.value)}
                    className="rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium text-slate-700">
                  班级名称
                  <input
                    name="className"
                    required
                    value={className}
                    onChange={(event) => setClassName(event.target.value)}
                    className="rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </label>
                <fieldset className="grid gap-2 text-sm font-medium text-slate-700">
                  <legend>写作大类</legend>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <input
                        type="radio"
                        name="writingGenre"
                        checked={writingGenre === 'practical_writing'}
                        onChange={() => changeWritingGenre('practical_writing')}
                      />
                      应用文
                    </label>
                    <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <input
                        type="radio"
                        name="writingGenre"
                        checked={writingGenre === 'continuation_writing'}
                        onChange={() => changeWritingGenre('continuation_writing')}
                      />
                      读后续写
                    </label>
                  </div>
                </fieldset>
                <label className="grid gap-2 text-sm font-medium text-slate-700">
                  具体题型
                  <select
                    name="essayType"
                    value={essayType}
                    onChange={(event) => setEssayType(event.target.value)}
                    className="rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  >
                    {essayTypeOptions.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-medium text-slate-700">
                  满分
                  <input
                    name="fullScore"
                    type="number"
                    min={1}
                    value={fullScore}
                    onChange={(event) => setFullScore(Number(event.target.value) || 15)}
                    className="rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </label>
                <div className="grid gap-2 text-sm font-medium text-slate-700">
                  <span>评分模板</span>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
                    {writingGenre === 'practical_writing' ? '应用文 mock 标准' : '读后续写 mock 标准'}
                  </div>
                </div>
              </div>

              <label className="mt-5 flex items-center gap-3 rounded-lg bg-blue-50 p-4 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={generateClassReview}
                  onChange={(event) => setGenerateClassReview(event.target.checked)}
                  className="h-4 w-4"
                />
                自动生成班级讲评材料
              </label>

              <button
                type="button"
                onClick={() => setCurrentStep('prompt')}
                className="mt-6 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
              >
                下一步：题目信息
              </button>
            </section>
          ) : null}

          {currentStep === 'prompt' ? (
            <section className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold text-slate-950">题目信息</h3>
                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                  第 2 步
                </span>
              </div>

              <div className="mt-5 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-800">原题材料上传占位</p>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  阶段三将支持上传原题图片 / PDF / 文档，并从材料中提取题目要求。当前版本请先手动输入题目信息。
                </p>
              </div>

              <div className="mt-5 rounded-lg border border-blue-100 bg-blue-50/60 p-4">
                <div className="flex items-center gap-2">
                  <h4 className="font-semibold text-slate-950">题目信息</h4>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-blue-700">必填</span>
                </div>
                {writingGenre === 'practical_writing' ? (
                  <label className="mt-4 grid gap-2 text-sm font-medium text-slate-700">
                    题目要求 / 写作任务
                    <textarea
                      value={practicalPrompt}
                      onChange={(event) => {
                        setPracticalPrompt(event.target.value)
                        resetRubric()
                      }}
                      className="min-h-28 rounded-lg border border-slate-200 bg-white px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      placeholder="填写本次应用文写作任务，例如写作对象、任务要求和主要内容。"
                    />
                  </label>
                ) : (
                  <div className="mt-4 grid gap-4">
                    <label className="grid gap-2 text-sm font-medium text-slate-700">
                      读后续写原文
                      <textarea
                        value={continuationSourceText}
                        onChange={(event) => {
                          setContinuationSourceText(event.target.value)
                          resetRubric()
                        }}
                        className="min-h-28 rounded-lg border border-slate-200 bg-white px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        placeholder="粘贴读后续写原文。"
                      />
                    </label>
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="grid gap-2 text-sm font-medium text-slate-700">
                        Paragraph 1 开头句
                        <input
                          value={paragraph1Opening}
                          onChange={(event) => {
                            setParagraph1Opening(event.target.value)
                            resetRubric()
                          }}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                          placeholder="填写第一段开头句"
                        />
                      </label>
                      <label className="grid gap-2 text-sm font-medium text-slate-700">
                        Paragraph 2 开头句
                        <input
                          value={paragraph2Opening}
                          onChange={(event) => {
                            setParagraph2Opening(event.target.value)
                            resetRubric()
                          }}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                          placeholder="填写第二段开头句"
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2">
                  <h4 className="font-semibold text-slate-950">教师补充要求</h4>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">选填</span>
                </div>
                <div className="mt-4 grid gap-4">
                  <label className="grid gap-2 text-sm font-medium text-slate-700">
                    教师补充要求
                    <textarea
                      value={teacherRequirements}
                      onChange={(event) => {
                        setTeacherRequirements(event.target.value)
                        resetRubric()
                      }}
                      className="min-h-24 rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      placeholder="可补充本次批改特别关注的要求。"
                    />
                  </label>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2 text-sm font-medium text-slate-700">
                      特别扣分点
                      <input
                        value={deductionFocus}
                        onChange={(event) => {
                          setDeductionFocus(event.target.value)
                          resetRubric()
                        }}
                        className="rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        placeholder="例如遗漏关键要点、格式错误等"
                      />
                    </label>
                    <label className="grid gap-2 text-sm font-medium text-slate-700">
                      优秀作文关注点
                      <input
                        value={excellentFocus}
                        onChange={(event) => {
                          setExcellentFocus(event.target.value)
                          resetRubric()
                        }}
                        className="rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        placeholder="例如表达自然、结构清楚等"
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentStep('basic')}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  返回基础信息
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentStep('rubric')}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                >
                  下一步：评分标准确认
                </button>
              </div>
            </section>
          ) : null}

          {currentStep === 'rubric' ? (
            <section
              role="region"
              aria-label="AI mock 评分标准"
              className="rounded-lg border border-slate-200 bg-white p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-950">评分标准确认</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    AI 将根据题目信息生成本任务评分标准。教师补充要求为选填项，填写后将作为评分标准生成的参考。
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {rubricStatus === 'idle' ? '待生成' : rubricStatus === 'draft' ? '待教师确认' : '已确认'}
                </span>
              </div>

              {promptError ? (
                <p className="mt-4 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
                  {promptError}
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={generateRubric}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                >
                  生成评分标准
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentStep('prompt')}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  返回题目信息
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentStep('basic')}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  返回基础信息
                </button>
              </div>

              <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                {rubricStatus === 'idle' ? (
                  <p className="text-sm leading-6 text-slate-500">
                    评分标准待生成。请先补全必填题目信息，再生成本任务 mock 评分标准。
                  </p>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-blue-700">
                        {writingGenre === 'practical_writing' ? '本题写作目标' : '本题续写目标'}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-slate-700">{getRubricGoal(writingGenre)}</p>
                    </div>
                    {rubricReferencedTeacherRequirements ? (
                      <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                        已参考教师补充要求
                      </span>
                    ) : null}
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{getOffTopicTitle(writingGenre)}</p>
                      <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-600">
                        {(writingGenre === 'practical_writing'
                          ? ['未回应题目要求', '主要内容要点明显缺失', '应用文对象或目的错误']
                          : ['续写情节脱离原文', '两段开头句没有得到回应', '人物行为与原文设定冲突']
                        ).map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">评分维度</p>
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        {dimensions.map((dimension) => (
                          <div key={dimension.id} className="rounded-lg border border-slate-200 bg-white p-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-slate-900">{dimension.name}</span>
                              <span className="text-sm font-semibold text-blue-700">{dimension.weight}%</span>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-slate-500">{dimension.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{getExcellentTitle(writingGenre)}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-600">
                        {writingGenre === 'practical_writing'
                          ? '要点完整、语气得体、建议具体，语言准确且有一定句式变化。'
                          : '情节自然推进，人物情感可信，主题表达自然不突兀。'}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-5 flex flex-wrap justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setRubricStatus('confirmed')}
                  disabled={rubricStatus !== 'draft'}
                  className="rounded-lg border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                >
                  确认采用该标准
                </button>
                <button
                  type="submit"
                  disabled={rubricStatus !== 'confirmed'}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                >
                  确认标准并进入上传
                </button>
              </div>
            </section>
          ) : null}
        </form>

        <aside className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="font-semibold text-slate-950">本任务评分标准预览</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            一个任务一套评分标准，确认后当前任务下所有作文沿用同一套标准。
          </p>
          <div className="mt-4 space-y-3">
            {dimensions.map((dimension) => (
              <div key={dimension.id} className="rounded-lg bg-slate-50 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-700">{dimension.name}</span>
                  <span className="text-sm font-semibold text-blue-700">{dimension.weight}%</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">{dimension.description}</p>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </AppLayout>
  )
}
