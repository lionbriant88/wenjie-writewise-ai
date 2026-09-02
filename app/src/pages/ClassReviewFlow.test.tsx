import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useRef } from 'react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import type { AppState } from '../context/appStateContextValue'
import { useAppState } from '../context/useAppState'
import { createFakeClassReviewSynthesisClient } from '../services/classReview/fakeClassReviewSynthesisClient'
import type {
  AiGradingResultV1,
  GradingClient,
  GradingClientResponse,
  MultimodalGradingRequestV2,
} from '../services/grading/types'
import type { EssayPage } from '../types'
import { ClassReviewPage } from './ClassReviewPage'
import { EssayResultPage } from './EssayResultPage'
import { ProgressPage } from './ProgressPage'

const FLOW_TASK_NAME = '班级总览纵向测试任务'
const CREATED_AT = '2026-08-29T12:00:00.000Z'

let latestState: AppState

function StateProbe() {
  latestState = useAppState()
  return null
}

function flowPage(index: number): EssayPage {
  return {
    id: `flow-page-${index}`,
    label: `学生${index}作文图`,
    pageNumber: 1,
    quality: 'clear',
    accent: '#2563eb',
    previewUrl: `blob:flow-page-${index}`,
    sourceFile: new File([`synthetic essay page ${index}`], `student-${index}.png`, { type: 'image/png' }),
  }
}

function FlowSetup() {
  const initialized = useRef(false)
  const navigate = useNavigate()
  const state = useAppState()

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    const taskId = state.createTask({
      taskName: FLOW_TASK_NAME,
      className: '高一测试班',
      essayType: '英语应用文',
      fullScore: 15,
      materialContext: {
        materialSummary: 'Write a short letter about joining a school reading activity.',
        writingRequirements: ['Give clear advice, reasons and a polite closing.'],
        constraints: ['Use English.'],
        reviewWarnings: [],
      },
      rubricDraft: {
        source: 'teacher',
        status: 'confirmed',
        writingGoal: 'Give clear advice, reasons and a polite closing.',
        offTopicCriteria: [],
        dimensions: [
          {
            id: 'content',
            name: '内容与任务完成',
            weight: 40,
            description: '完成主要写作任务。',
            deductionFocus: [],
            sourceEvidence: [],
          },
          {
            id: 'language',
            name: '语言质量',
            weight: 40,
            description: '语言准确、表达自然。',
            deductionFocus: [],
            sourceEvidence: [],
          },
          {
            id: 'structure',
            name: '结构与连贯',
            weight: 15,
            description: '结构清楚，衔接自然。',
            deductionFocus: [],
            sourceEvidence: [],
          },
          {
            id: 'legibility',
            name: '卷面与可读性',
            weight: 5,
            description: '书写清晰可读。',
            deductionFocus: [],
            sourceEvidence: [],
          },
        ],
        excellentFeatures: [],
        reviewTriggers: [],
      },
      generateClassReview: true,
    })
    state.enqueueImageEssays({
      submissionId: 'flow-submission',
      taskId,
      className: '高一测试班',
      essayGroups: Array.from({ length: 6 }, (_, index) => ({
        studentName: `学生${index + 1}`,
        pages: [flowPage(index + 1)],
      })),
    })
    navigate(`/tasks/${taskId}/progress`)
  }, [navigate, state])

  return <p>正在初始化班级纵向测试任务</p>
}

function FlowControls() {
  const navigate = useNavigate()
  const state = useAppState()
  const task = state.tasks.find((item) => item.taskName === FLOW_TASK_NAME)
  const essays = task ? state.essays.filter((essay) => essay.taskId === task.id) : []
  const lowFrequencyEssay = essays.find((essay) => essay.essayNumber === '学生3')

  if (!task) return null
  return (
    <div aria-label="班级总览纵向测试导航">
      <button
        type="button"
        disabled={!lowFrequencyEssay}
        onClick={() => {
          if (lowFrequencyEssay) navigate(`/tasks/${task.id}/essays/${lowFrequencyEssay.id}`)
        }}
      >
        打开低频问题作文
      </button>
      <button type="button" onClick={() => navigate(`/tasks/${task.id}/class-review`)}>
        返回班级总览
      </button>
    </div>
  )
}

function essayOrdinal(request: MultimodalGradingRequestV2): number {
  const match = /-([1-9][0-9]*)$/.exec(request.essayId)
  if (!match) throw new Error(`Unexpected essay id ${request.essayId}`)
  return Number(match[1])
}

function dimensionScores(request: MultimodalGradingRequestV2) {
  const scoresById = new Map([
    ['content', 5],
    ['language', 5],
    ['structure', 2],
    ['legibility', 0.7],
  ])
  const maxScoresById = new Map([
    ['content', 6],
    ['language', 6],
    ['structure', 2.25],
    ['legibility', 0.75],
  ])
  return request.task.rubric.dimensions.map((dimension) => ({
    dimensionId: dimension.id,
    name: dimension.name,
    score: scoresById.get(dimension.id) ?? 1,
    maxScore: maxScoresById.get(dimension.id) ?? 1,
    weight: dimension.weight,
    reason: 'Synthetic class-flow score.',
    evidence: 'Synthetic evidence.',
  }))
}

function successResult(request: MultimodalGradingRequestV2): AiGradingResultV1 {
  const ordinal = essayOrdinal(request)
  const prefix = `flow-${ordinal}`
  const issues: AiGradingResultV1['issues'] = []
  const sentenceRevisions: AiGradingResultV1['sentenceRevisions'] = []
  const sentencePairs: AiGradingResultV1['fullTextRevision']['sentencePairs'] = []
  const textParts = [
    'Dear Peter,',
    `This is synthetic essay ${ordinal}.`,
    'I hope you can enjoy the school reading activity.',
  ]

  if (ordinal === 1 || ordinal === 2) {
    textParts.push('I suggest you joins the reading club.')
    issues.push({
      id: `${prefix}-grammar`,
      type: 'grammar',
      severity: 'medium',
      originalText: 'I suggest you joins the reading club.',
      suggestion: 'I suggest you join the reading club.',
      explanation: 'Verb form after suggest should stay consistent.',
      evidenceCertainty: 'certain',
      requiresTeacherReview: false,
    })
    sentenceRevisions.push({
      id: `${prefix}-grammar-revision`,
      relatedIssueIds: [`${prefix}-grammar`],
      originalText: 'I suggest you joins the reading club.',
      revisedText: 'I suggest you join the reading club.',
      note: 'Use the base form join.',
      changeTypes: ['grammar'],
      requiresTeacherReview: false,
    })
  }

  if (ordinal === 3) {
    textParts.push('The activity is very good.')
    issues.push({
      id: `${prefix}-structure`,
      type: 'structure',
      severity: 'low',
      originalText: 'The activity is very good.',
      suggestion: 'Explain one concrete benefit of the activity.',
      explanation: 'The reason is too general for classroom discussion.',
      evidenceCertainty: 'certain',
      requiresTeacherReview: false,
    })
  }

  if (ordinal === 4) {
    textParts.push('We should protect the enviroment.')
    issues.push({
      id: `${prefix}-spelling`,
      type: 'spelling',
      severity: 'low',
      originalText: 'enviroment',
      suggestion: 'environment',
      explanation: 'Clear low-level spelling error.',
      evidenceCertainty: 'certain',
      requiresTeacherReview: false,
    })
    sentenceRevisions.push({
      id: `${prefix}-spelling-revision`,
      relatedIssueIds: [`${prefix}-spelling`],
      originalText: 'enviroment',
      revisedText: 'environment',
      note: 'Correct the spelling.',
      changeTypes: ['spelling'],
      requiresTeacherReview: false,
    })
  }

  const transcript = `${textParts.join(' ')} Best wishes.`
  return {
    resultVersion: 'grading-result-v2',
    requestId: request.requestId,
    essayId: request.essayId,
    provider: 'mock',
    status: 'success',
    totalScore: 13,
    maxScore: request.task.fullScore,
    dimensionScores: dimensionScores(request),
    issues,
    sentenceRevisions,
    expressionUpgrades: [],
    fullTextRevision: {
      originalText: transcript,
      correctedText: transcript.replace('joins the reading club', 'join the reading club').replace('enviroment', 'environment'),
      improvedText: transcript.replace('The activity is very good.', 'The activity is helpful because it gives students a clear reason to read.'),
      sentencePairs,
      logicNotes: [],
      logicIssues: [],
    },
    legibilityIssues: [],
    overallComment: 'Synthetic class flow grading result.',
    modelSelfConfidence: 0.9,
    reviewReasons: [],
    createdAt: CREATED_AT,
    transcript,
    recognitionWarnings: [],
    printedTextExcluded: true,
  }
}

function createClassFlowGradingClient(): GradingClient & {
  getCallCountForTest(): number
  getRequestsForTest(): readonly MultimodalGradingRequestV2[]
} {
  const requests: MultimodalGradingRequestV2[] = []
  return {
    getCallCountForTest: () => requests.length,
    getRequestsForTest: () => requests,
    async gradeImages(request): Promise<GradingClientResponse> {
      requests.push(request)
      if (essayOrdinal(request) === 6) {
        return {
          requestId: request.requestId,
          status: 'failed',
          error: {
            code: 'provider_content_filtered',
            message: '该作文无法自动处理。',
            retryable: false,
          },
        }
      }
      return successResult(request)
    },
  }
}

type ClassFlowGradingClient = ReturnType<typeof createClassFlowGradingClient>

function flowTask() {
  const task = latestState.tasks.find((item) => item.taskName === FLOW_TASK_NAME)
  if (!task) throw new Error('Missing flow task')
  return task
}

function renderClassReviewFlow({
  gradingClient = createClassFlowGradingClient(),
  classReviewClient = createFakeClassReviewSynthesisClient({ scenario: 'regeneration_failed' }),
}: {
  gradingClient?: ClassFlowGradingClient
  classReviewClient?: ReturnType<typeof createFakeClassReviewSynthesisClient>
} = {}) {
  render(
    <AppStateProvider
      gradingClient={gradingClient}
      gradingSchedulerOptions={{ mode: 'adaptive-v1', hardLimit: 2, stableSuccessWindow: 2 }}
      classReviewSynthesisClient={classReviewClient}
    >
      <MemoryRouter initialEntries={['/setup']}>
        <StateProbe />
        <FlowControls />
        <Routes>
          <Route path="/setup" element={<FlowSetup />} />
          <Route path="/tasks/:taskId/progress" element={<ProgressPage />} />
          <Route path="/tasks/:taskId/essays/:essayId" element={<EssayResultPage />} />
          <Route path="/tasks/:taskId/class-review" element={<ClassReviewPage />} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  )
  return { gradingClient, classReviewClient }
}

describe('Class review application flow', () => {
  it('keeps the local prototype flow usable after partial class completion and failed regeneration', async () => {
    const user = userEvent.setup()
    const { gradingClient, classReviewClient } = renderClassReviewFlow()

    expect(await screen.findByRole('heading', { name: '批改进度' })).toBeInTheDocument()
    await waitFor(() => {
      const task = flowTask()
      const flowEssays = latestState.essays.filter((essay) => essay.taskId === task.id)
      expect(flowEssays).toHaveLength(6)
      expect(flowEssays.some((essay) => essay.status === 'pending_ocr' || essay.status === 'ocr_running')).toBe(false)
    })

    await user.click(screen.getByRole('button', { name: '开始批改全部待处理作文' }))
    await waitFor(() => expect(gradingClient.getCallCountForTest()).toBe(6))
    expect(gradingClient.getRequestsForTest().every((request) => request.requestVersion === 'multimodal-grading-request-v2')).toBe(true)
    expect(screen.queryByRole('button', { name: '生成班级总结' })).not.toBeInTheDocument()

    await user.click(await screen.findByRole('link', { name: /进入班级总览/ }))
    expect(await screen.findByRole('heading', { name: '班级总览' })).toBeInTheDocument()
    expect(screen.getByText('本地功能原型；刷新、重启、多设备和真实班级长期保存不受保证。')).toBeInTheDocument()

    const statistics = screen.getByRole('heading', { name: '当前统计' }).closest('section')
    if (!statistics) throw new Error('Missing statistics panel')
    expect(statistics).toHaveTextContent(/作文总数\s*6/)
    expect(statistics).toHaveTextContent(/纳入统计\s*5/)
    expect(statistics).toHaveTextContent(/问题通道\s*5\s*\/\s*5/)
    expect(screen.getByText(/enviroment\s*→\s*environment/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '生成班级总结' }))
    expect(await screen.findByText('Class summary')).toBeInTheDocument()
    expect(classReviewClient.getCallCountForTest()).toBe(1)
    expect(screen.getByRole('heading', { name: 'Common issue' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '打开低频问题作文' }))
    await user.click(await screen.findByRole('tab', { name: '问题批改' }))
    const structureIssue = await screen.findByRole('article', { name: /structure The activity is very good\./ })
    await user.click(within(structureIssue).getByRole('button', { name: '加入班级总览' }))
    expect(within(structureIssue).getByRole('button', { name: '移出班级总览' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '返回班级总览' }))
    const issues = await screen.findByRole('region', { name: '共性问题与讲评建议' })
    expect(within(issues).getByRole('heading', { name: 'Common issue' })).toBeInTheDocument()
    expect(within(issues).getByRole('heading', { name: 'structure' })).toBeInTheDocument()

    await user.click(within(issues).getByRole('button', { name: '上移：structure' }))
    expect(within(issues).getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)).toEqual([
      'structure',
      'Common issue',
    ])

    await user.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByLabelText('班级总体评价'), {
      target: { value: 'Teacher edited class summary.' },
    })
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(screen.getByText('Teacher edited class summary.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重新生成' }))
    await user.click(screen.getByRole('button', { name: '确认重新生成' }))
    await waitFor(() => expect(classReviewClient.getCallCountForTest()).toBe(2))
    expect(await screen.findByText('班级总结生成失败，请稍后重试。')).toBeInTheDocument()
    expect(screen.getByText('Teacher edited class summary.')).toBeInTheDocument()
    const preservedIssues = screen.getByRole('region', { name: '共性问题与讲评建议' })
    expect(within(preservedIssues).getByRole('heading', { name: 'structure' })).toBeInTheDocument()
  })
})
