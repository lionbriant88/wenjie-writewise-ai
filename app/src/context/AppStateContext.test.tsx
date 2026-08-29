import { act, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { confirmOcrAudit, createPendingOcrAudit } from '../services/ocr/audit/transcriptAudit'
import type { Essay } from '../types'
import type { GradingClient, MultimodalGradingRequestV2 } from '../services/grading/types'
import { AppStateProvider } from './AppStateContext'
import type { AppState } from './appStateContextValue'
import { useAppState } from './useAppState'

const pendingAudit = createPendingOcrAudit({
  sourceKind: 'remote',
  result: {
    essayGroupId: 'group-1',
    text: 'Client final source',
    pages: [{ pageId: 'page-1', text: 'Client final source' }],
    provider: 'remote',
    status: 'success',
  },
  expectedPageIds: ['page-1'],
  assessedAt: '2026-07-12T02:55:00.000Z',
})

const generatedDimensions = [
  { id: 'content', name: 'Content', weight: 95, description: 'Relevant.', deductionFocus: [], sourceEvidence: ['Material.'] },
  { id: 'legibility', name: 'Legibility', weight: 5, description: 'Readable.', deductionFocus: [], sourceEvidence: [] },
]

function StateHarness() {
  const { essays, confirmMockOcrEssay, updateEssayOcrText } = useAppState()
  const createdEssay = essays.find((essay) => essay.id.includes('-uploaded-'))

  const createEssay = () => {
    confirmMockOcrEssay({
      taskId: 'task-1',
      essayGroups: [
        {
          pages: [{ id: 'page-1', label: 'Synthetic page', pageNumber: 1, quality: 'clear', accent: '#000000' }],
          ocrText: 'Teacher faithful text',
          ocrAudit: confirmOcrAudit(pendingAudit, 'Teacher faithful text', '2026-07-12T03:00:00.000Z'),
        },
      ],
    })
  }

  const correctEssay = () => {
    if (!createdEssay) return
    updateEssayOcrText(createdEssay.id, 'Later faithful correction', '2026-07-12T03:05:00.000Z')
  }

  return (
    <>
      <button type="button" onClick={createEssay}>Create essay</button>
      <button type="button" onClick={correctEssay}>Correct essay</button>
      <pre data-testid="created-essay">{JSON.stringify(createdEssay ?? null)}</pre>
    </>
  )
}

function readCreatedEssay(): Essay {
  return JSON.parse(screen.getByTestId('created-essay').textContent ?? 'null') as Essay
}

describe('AppStateContext OCR audit lifecycle', () => {
  it('persists confirmed audit data and preserves source text on later correction', async () => {
    const user = userEvent.setup()
    render(
      <AppStateProvider>
        <StateHarness />
      </AppStateProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Create essay' }))
    const createdEssay = readCreatedEssay()

    expect(createdEssay.ocrText).toBe('Teacher faithful text')
    expect(createdEssay.ocrAudit?.sourceText).toBe('Client final source')
    expect(createdEssay.ocrAudit?.confirmedTranscript).toBe('Teacher faithful text')
    expect(createdEssay.ocrAudit?.reviewOutcome.confirmedAt).toBe('2026-07-12T03:00:00.000Z')

    await user.click(screen.getByRole('button', { name: 'Correct essay' }))
    const updatedEssay = readCreatedEssay()

    expect(updatedEssay.ocrText).toBe('Later faithful correction')
    expect(updatedEssay.ocrAudit?.sourceText).toBe('Client final source')
    expect(updatedEssay.ocrAudit?.confirmedTranscript).toBe('Later faithful correction')
    expect(updatedEssay.ocrAudit?.reviewOutcome.confirmedAt).toBe('2026-07-12T03:05:00.000Z')
  })
})

describe('AppStateContext material-based task creation', () => {
  it('accepts a transcript edit while grading and rejects the late old-version result', async () => {
    let resolve!: (value: Awaited<ReturnType<NonNullable<GradingClient['gradeImages']>>>) => void
    const deferred = new Promise<Awaited<ReturnType<NonNullable<GradingClient['gradeImages']>>>>((done) => { resolve = done })
    const gradeImages = vi.fn<NonNullable<GradingClient['gradeImages']>>((_request) => deferred)
    render(<AppStateProvider gradingClient={{ gradeImages }}><StateProbe /></AppStateProvider>)
    let taskId = ''
    act(() => {
      taskId = latestState.createTask({
        taskName: 'Deferred image task', fullScore: 15,
        materialContext: { materialSummary: 'Material.', writingRequirements: ['Write.'], constraints: [], reviewWarnings: [] },
        rubricDraft: { source: 'ai', status: 'confirmed', writingGoal: 'Write.', offTopicCriteria: [], excellentFeatures: [], reviewTriggers: [], dimensions: generatedDimensions },
      })
      latestState.enqueueImageEssays({
        submissionId: 'deferred-image-1', taskId, className: 'Class',
        essayGroups: [{ pages: [{ id: 'page-1', label: 'essay.png', pageNumber: 1, quality: 'clear', accent: '#000', sourceFile: new File(['image'], 'essay.png', { type: 'image/png' }) }] }],
      })
    })
    const essay = latestState.essays.find((item) => item.taskId === taskId)
    if (!essay) throw new Error('Queued essay missing')
    let grading!: Promise<void>
    act(() => { grading = latestState.gradeEssay(essay.id) })
    act(() => latestState.updateEssayOcrText(essay.id, 'Teacher edit during grading.'))
    expect(latestState.essays.find((item) => item.id === essay.id)).toMatchObject({
      ocrText: 'Teacher edit during grading.', sourceGeneration: 1,
      status: 'pending_grading', gradingRun: { status: 'idle' },
    })
    expect(gradeImages).toHaveBeenCalledTimes(1)

    const request = gradeImages.mock.calls[0][0]
    resolve({
      resultVersion: 'grading-result-v2', requestId: request.requestId, essayId: request.essayId, provider: 'mock', status: 'success', totalScore: 12, maxScore: 15,
      dimensionScores: [], issues: [], sentenceRevisions: [], expressionUpgrades: [], legibilityIssues: [], overallComment: 'Done.', reviewReasons: [], createdAt: '2026-08-02T00:00:00.000Z',
      transcript: 'Kimi settled transcript.', recognitionWarnings: [], printedTextExcluded: true,
      fullTextRevision: { originalText: 'Kimi settled transcript.', correctedText: 'Kimi settled transcript.', improvedText: 'Kimi settled transcript.', sentencePairs: [], logicNotes: [], logicIssues: [] },
    })
    await act(async () => { await grading })
    expect(latestState.essays.find((item) => item.id === essay.id)).toMatchObject({
      ocrText: 'Teacher edit during grading.', transcriptSource: 'teacher_confirmed', status: 'pending_grading',
    })
    expect(latestState.gradingResults.find((item) => item.essayId === essay.id)).toBeUndefined()
  })

  it('queues a material task with original files and grades it through the image client once', async () => {
    const gradingClient: GradingClient = {
      gradeImages: async (request) => ({
        resultVersion: 'grading-result-v2', requestId: request.requestId, essayId: request.essayId, provider: 'mock', status: 'success',
        totalScore: 12, maxScore: 15,
        dimensionScores: [{ dimensionId: 'content', name: 'Content', score: 12, maxScore: 15, weight: 100, reason: 'Dimension reason.', evidence: 'Dimension evidence.', requiresTeacherReview: false }],
        issues: [{ id: 'issue-1', type: 'grammar', severity: 'medium', originalText: 'bad', suggestion: 'better', explanation: 'Issue explanation.', evidenceCertainty: 'certain' as const, requiresTeacherReview: true }],
        sentenceRevisions: [{ id: 'revision-1', relatedIssueIds: ['issue-1'], originalText: 'bad', revisedText: 'better', note: 'Revision note.', changeTypes: ['grammar'] as const, requiresTeacherReview: false }],
        expressionUpgrades: [{ id: 'upgrade-1', originalText: 'plain', upgradedText: 'polished', note: 'Upgrade note.', requiresTeacherReview: true }],
        fullTextRevision: { originalText: 'Faithful image transcript.', correctedText: 'better', improvedText: 'polished', sentencePairs: [{ id: 'pair-1', originalText: 'bad', correctedText: 'better', improvedText: 'polished', relatedIssueIds: ['issue-1'], changeTypes: ['grammar'] as const, explanation: 'Pair explanation.', requiresTeacherReview: false }], logicNotes: [], logicIssues: [] },
        overallComment: 'Detailed image result.', reviewReasons: [], createdAt: '2026-08-02T00:00:00.000Z',
        transcript: 'Faithful image transcript.', recognitionWarnings: ['Low contrast on final line.'], legibilityIssues: [], printedTextExcluded: true,
      }),
    }
    render(<AppStateProvider gradingClient={gradingClient}><StateProbe /></AppStateProvider>)
    let taskId = ''
    act(() => { taskId = latestState.createTask({ taskName: 'Image task', fullScore: 15, materialContext: { materialSummary: 'Material.', writingRequirements: ['Write.'], constraints: [], reviewWarnings: [] }, rubricDraft: { source: 'ai', status: 'confirmed', writingGoal: 'Write.', offTopicCriteria: [], excellentFeatures: [], reviewTriggers: [], dimensions: generatedDimensions } }) })
    const file = new File(['image'], 'handwriting.png', { type: 'image/png' })
    const submission = { submissionId: 'image-submission-1', taskId, className: '九年级 3 班', essayGroups: [{ pages: [{ id: 'page-1', label: file.name, pageNumber: 1, quality: 'clear' as const, accent: '#000', sourceFile: file }] }] }
    act(() => latestState.enqueueImageEssays(submission))
    act(() => latestState.enqueueImageEssays(submission))
    expect(latestState.essays.filter((item) => item.taskId === taskId)).toHaveLength(1)
    act(() => latestState.enqueueImageEssays({ ...submission, submissionId: 'image-submission-2' }))
    expect(latestState.essays.filter((item) => item.taskId === taskId)).toHaveLength(2)
    const queued = latestState.essays.filter((item) => item.taskId === taskId)
    expect(new Set(queued.map((item) => item.id)).size).toBe(2)
    expect(new Set(queued.flatMap((item) => item.pages.map((page) => page.id))).size).toBe(2)
    const essay = latestState.essays.find((item) => item.taskId === taskId)
    expect(essay).toMatchObject({ status: 'pending_grading', pages: [{ sourceFile: file }] })
    await act(async () => { await latestState.gradeEssay(essay!.id) })
    expect(latestState.essays.find((item) => item.id === essay!.id)).toMatchObject({ status: 'grading_ready' })
    const gradingResult = latestState.gradingResults.find((result) => result.essayId === essay!.id)
    expect(gradingResult).toMatchObject({
      source: 'mock', transcript: 'Faithful image transcript.', recognitionWarnings: ['Low contrast on final line.'], printedTextExcluded: true,
      dimensionScores: [{ needsTeacherReview: false }],
      errorAnnotations: [{ needsTeacherReview: true }],
      sentenceRevisions: [{ needsTeacherReview: false }],
      upgradedExpressions: [{ needsTeacherReview: true }],
      fullTextRevision: { sentencePairs: [{ needsTeacherReview: false }] },
    })
    expect(latestState.essays.find((item) => item.id === essay!.id)).toMatchObject({
      ocrText: 'Faithful image transcript.', transcriptSource: 'kimi_vision',
    })
    expect(latestState.essays.find((item) => item.id === essay!.id)?.ocrAudit).toBeUndefined()
  })

  it('removes a stale Kimi result only when the teacher saves a changed transcript and never grades automatically', async () => {
    const gradeImages = vi.fn(async (request: Parameters<NonNullable<GradingClient['gradeImages']>>[0]) => ({
      resultVersion: 'grading-result-v2' as const, requestId: request.requestId, essayId: request.essayId, provider: 'mock' as const, status: 'success' as const,
      totalScore: 12, maxScore: 15,
      dimensionScores: [{ dimensionId: 'content', name: 'Content', score: 12, maxScore: 15, weight: 100, reason: 'Reason.', evidence: 'Evidence.', requiresTeacherReview: false }],
      issues: [], sentenceRevisions: [], expressionUpgrades: [], legibilityIssues: [], overallComment: 'Comment.', reviewReasons: [], createdAt: '2026-08-02T00:00:00.000Z',
      transcript: request.confirmedTranscript ?? 'Kimi transcript.', recognitionWarnings: [], printedTextExcluded: true,
      fullTextRevision: { originalText: request.confirmedTranscript ?? 'Kimi transcript.', correctedText: request.confirmedTranscript ?? 'Kimi transcript.', improvedText: request.confirmedTranscript ?? 'Kimi transcript.', sentencePairs: [], logicNotes: [], logicIssues: [] },
    }))
    render(<AppStateProvider gradingClient={{ gradeImages }}><StateProbe /></AppStateProvider>)
    let taskId = ''
    act(() => {
      taskId = latestState.createTask({
        taskName: 'Image task', fullScore: 15,
        materialContext: { materialSummary: 'Material.', writingRequirements: ['Write.'], constraints: [], reviewWarnings: [] },
        rubricDraft: { source: 'ai', status: 'confirmed', writingGoal: 'Write.', offTopicCriteria: [], excellentFeatures: [], reviewTriggers: [], dimensions: generatedDimensions },
      })
      latestState.enqueueImageEssays({
        submissionId: 'invalidate-1', taskId, className: 'Class',
        essayGroups: [
          { pages: [{ id: 'page-1', label: 'essay.png', pageNumber: 1, quality: 'clear', accent: '#000', sourceFile: new File(['image'], 'essay.png', { type: 'image/png' }) }] },
          { pages: [{ id: 'page-2', label: 'other.png', pageNumber: 1, quality: 'clear', accent: '#000', sourceFile: new File(['image'], 'other.png', { type: 'image/png' }) }] },
        ],
      })
    })
    const essay = latestState.essays.find((item) => item.taskId === taskId)
    if (!essay) throw new Error('Queued essay missing')
    const otherEssay = latestState.essays.find((item) => item.taskId === taskId && item.id !== essay.id)
    if (!otherEssay) throw new Error('Second queued essay missing')
    await act(async () => { await latestState.gradeEssay(essay.id) })
    expect(gradeImages).toHaveBeenCalledTimes(1)
    expect(gradeImages.mock.calls[0][0].confirmedTranscript).toBeUndefined()
    expect(latestState.gradingResults.some((item) => item.essayId === essay.id)).toBe(true)
    await act(async () => { await latestState.gradeEssay(otherEssay.id) })
    expect(gradeImages).toHaveBeenCalledTimes(2)
    expect(latestState.gradingResults.some((item) => item.essayId === otherEssay.id)).toBe(true)
    act(() => latestState.confirmGradingResult(essay.id))
    expect(latestState.tasks.find((item) => item.id === taskId)?.completedEssayCount).toBe(1)

    act(() => latestState.updateEssayOcrText(essay.id, 'Teacher corrected transcript.', '2026-08-02T00:01:00.000Z'))

    expect(latestState.essays.find((item) => item.id === essay.id)).toMatchObject({
      ocrText: 'Teacher corrected transcript.', status: 'pending_grading', teacherReviewed: false, gradingRun: { status: 'idle' },
    })
    expect(latestState.essays.find((item) => item.id === essay.id)?.aiResultId).toBeUndefined()
    expect(latestState.gradingResults.some((item) => item.essayId === essay.id)).toBe(false)
    expect(latestState.gradingResults.some((item) => item.essayId === otherEssay.id)).toBe(true)
    expect(latestState.tasks.find((item) => item.id === taskId)?.completedEssayCount).toBe(0)
    expect(gradeImages).toHaveBeenCalledTimes(2)

    act(() => latestState.updateEssayOcrText(essay.id, 'Teacher corrected transcript.', '2026-08-02T00:02:00.000Z'))
    expect(gradeImages).toHaveBeenCalledTimes(2)

    await act(async () => { await latestState.gradeEssay(essay.id) })
    expect(gradeImages).toHaveBeenCalledTimes(3)
    expect(gradeImages.mock.calls[2][0].confirmedTranscript).toBe('Teacher corrected transcript.')
    expect(latestState.essays.find((item) => item.id === essay.id)).toMatchObject({
      ocrText: 'Teacher corrected transcript.', transcriptSource: 'teacher_confirmed',
    })
    expect(latestState.essays.find((item) => item.id === essay.id)?.ocrText).not.toBe('Kimi transcript.')
    act(() => latestState.confirmGradingResult(essay.id))
    expect(latestState.tasks.find((item) => item.id === taskId)?.completedEssayCount).toBe(1)
  })

  it('creates a unified rubric task with generic defaults and assigns its class later', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-02T00:00:00.000Z'))
    render(<AppStateProvider><StateProbe /></AppStateProvider>)
    const rubricDraft = {
      source: 'ai' as const,
      writingGoal: 'Respond to the source material.',
      offTopicCriteria: [],
      dimensions: [{ id: 'content', name: 'Content', weight: 100, description: 'Address the material.', deductionFocus: [] }],
      excellentFeatures: [],
      reviewTriggers: [],
      status: 'confirmed' as const,
    }
    let taskId = ''
    act(() => {
      taskId = latestState.createTask({
        taskName: 'AI generated task',
        fullScore: 15,
        materialProcessingStatus: 'ready',
        materialContext: {
          materialSummary: 'A source material summary.',
          writingRequirements: ['Respond clearly.'],
          constraints: [],
          reviewWarnings: [],
        },
        rubricDraft,
      })
    })

    expect(latestState.tasks.find((task) => task.id === taskId)).toMatchObject({
      taskName: 'AI generated task', className: '待选择班级', essayType: '英语作文',
      scoringTemplateId: 'confirmed-rubric-v1', fullScore: 15, generateClassReview: true,
      materialProcessingStatus: 'ready',
      materialContext: { materialSummary: 'A source material summary.' },
    })
    expect(latestState.tasks.find((task) => task.id === taskId)?.writingGenre).toBeUndefined()

    const createdTask = latestState.tasks.find((task) => task.id === taskId)
    const unchangedTask = latestState.tasks.find((task) => task.id === 'task-1')
    vi.setSystemTime(new Date('2026-08-02T00:01:00.000Z'))
    act(() => latestState.assignTaskClass(taskId, '九年级 3 班'))
    expect(latestState.tasks.find((task) => task.id === taskId)).toMatchObject({
      className: '九年级 3 班', updatedAt: '2026-08-02T00:01:00.000Z',
    })
    expect(latestState.tasks.find((task) => task.id === 'task-1')).toEqual(unchangedTask)

    const stateBeforeUnknownClass = structuredClone(latestState.tasks)
    act(() => latestState.assignTaskClass('unknown-task', '不应写入'))
    expect(latestState.tasks).toEqual(stateBeforeUnknownClass)
    expect(latestState.tasks.find((task) => task.id === taskId)?.updatedAt).not.toBe(createdTask?.updatedAt)
    vi.useRealTimers()
  })

  it.each(['none', 'ready', 'failed'] as const)(
    'persists %s material status without labeling a teacher-only task as material writing or Kimi-generated',
    (materialProcessingStatus) => {
      render(<AppStateProvider><StateProbe /></AppStateProvider>)
      let taskId = ''
      act(() => {
        taskId = latestState.createTask({
          taskName: 'Teacher-only task',
          fullScore: 15,
          materialProcessingStatus,
          materialContext: {
            materialSummary: '教师确认的写作要求：Write clearly.',
            writingRequirements: ['Write clearly.'],
            constraints: [],
            reviewWarnings: [],
          },
          rubricDraft: {
            source: 'teacher',
            writingGoal: 'Write clearly.',
            offTopicCriteria: [],
            dimensions: generatedDimensions,
            excellentFeatures: [],
            reviewTriggers: [],
            status: 'confirmed',
          },
        })
      })

      expect(latestState.tasks.find((task) => task.id === taskId)).toMatchObject({
        className: '待选择班级',
        essayType: '英语作文',
        scoringTemplateId: 'confirmed-rubric-v1',
        materialProcessingStatus,
      })
      expect(latestState.tasks.find((task) => task.id === taskId)?.essayType).not.toBe('材料写作')
      expect(latestState.tasks.find((task) => task.id === taskId)?.scoringTemplateId).not.toBe('kimi-generated-v1')
    },
  )
})

let latestState: AppState

function StateProbe() {
  latestState = useAppState()
  return null
}

function resultForImages(request: MultimodalGradingRequestV2, provider: 'mock' | 'remote' = 'remote') {
  const transcript = request.confirmedTranscript ?? 'Synthetic image transcript.'
  const dimensionScores = request.task.rubric.dimensions.map((dimension) => ({
    dimensionId: dimension.id,
    name: dimension.name,
    score: dimension.weight * request.task.fullScore / 100,
    maxScore: dimension.weight * request.task.fullScore / 100,
    weight: dimension.weight,
    reason: 'Synthetic reason.',
    evidence: transcript,
  }))
  return {
    resultVersion: 'grading-result-v2' as const,
    requestId: request.requestId,
    essayId: request.essayId,
    provider,
    status: 'success' as const,
    totalScore: request.task.fullScore,
    maxScore: request.task.fullScore,
    dimensionScores,
    issues: [], sentenceRevisions: [], expressionUpgrades: [], recognitionWarnings: [], legibilityIssues: [],
    fullTextRevision: { originalText: transcript, correctedText: transcript, improvedText: transcript, sentencePairs: [], logicNotes: [], logicIssues: [] },
    overallComment: 'Synthetic result.', reviewReasons: [], createdAt: '2026-08-16T00:00:00.000Z',
    transcript, printedTextExcluded: true,
  }
}

function createConfirmedEssay() {
  let taskId = ''
  act(() => {
    taskId = latestState.createTask({
      taskName: 'Synthetic grading task',
      className: 'Synthetic class',
      essayType: 'letter',
      fullScore: 15,
      scoringTemplateId: 'synthetic',
      writingGenre: 'practical_writing',
      promptInfo: {
        writingGenre: 'practical_writing',
        manualPromptText: 'Write a synthetic letter.',
      },
      rubricDraft: {
        source: 'teacher',
        writingGoal: 'Complete the task.',
        offTopicCriteria: [],
        dimensions: [{ id: 'all', name: 'All', weight: 100, description: 'All', deductionFocus: [] }],
        excellentFeatures: [],
        reviewTriggers: [],
        status: 'confirmed',
      },
      generateClassReview: true,
    })
  })
  act(() => {
    latestState.confirmMockOcrEssay({
      taskId,
      essayGroups: [{
        pages: [{ id: 'synthetic-page', label: 'Synthetic page', pageNumber: 1, quality: 'clear', accent: '#000' }],
        ocrText: 'Teacher-confirmed synthetic transcript.',
        ocrAudit: confirmOcrAudit(
          createPendingOcrAudit({
            sourceKind: 'remote',
            result: {
              essayGroupId: 'synthetic-group', text: 'Synthetic OCR source.',
              pages: [{ pageId: 'synthetic-page', text: 'Synthetic OCR source.' }],
              provider: 'mock', status: 'success',
            },
            expectedPageIds: ['synthetic-page'],
            assessedAt: '2026-07-20T00:00:00.000Z',
          }),
          'Teacher-confirmed synthetic transcript.',
          '2026-07-20T00:01:00.000Z',
        ),
      }],
    })
  })
  const created = latestState.essays.find((essay) => essay.taskId === taskId)
  if (!created) throw new Error('Synthetic essay was not created')
  return { taskId, essayId: created.id }
}

function createInvalidRequestEssay() {
  let taskId = ''
  act(() => {
    taskId = latestState.createTask({
      taskName: 'Incomplete synthetic grading task',
      className: 'Synthetic class',
      essayType: 'letter',
      fullScore: 15,
      scoringTemplateId: 'synthetic',
      generateClassReview: true,
    })
    latestState.confirmMockOcrEssay({
      taskId,
      essayGroups: [{
        pages: [{ id: 'invalid-page', label: 'Synthetic page', pageNumber: 1, quality: 'clear', accent: '#000' }],
        ocrText: 'Teacher-confirmed synthetic transcript.',
        ocrAudit: confirmOcrAudit(
          createPendingOcrAudit({
            sourceKind: 'mock',
            result: {
              essayGroupId: 'invalid-group', text: 'Synthetic source.',
              pages: [{ pageId: 'invalid-page', text: 'Synthetic source.' }],
              provider: 'mock', status: 'success',
            },
            expectedPageIds: ['invalid-page'],
            assessedAt: '2026-07-20T00:00:00.000Z',
          }),
          'Teacher-confirmed synthetic transcript.',
          '2026-07-20T00:01:00.000Z',
        ),
      }],
    })
  })
  const created = latestState.essays.find((essay) => essay.taskId === taskId)
  if (!created) throw new Error('Invalid-request essay was not created')
  return created.id
}

function renderGradingState(gradingClient: GradingClient) {
  return render(<AppStateProvider gradingClient={gradingClient}><StateProbe /></AppStateProvider>)
}

function createQueuedImageEssays(count: number) {
  let taskId = ''
  act(() => {
    taskId = latestState.createTask({
      taskName: 'Bounded queue task', fullScore: 15,
      materialContext: { materialSummary: 'Material.', writingRequirements: ['Write.'], constraints: [], reviewWarnings: [] },
      rubricDraft: {
        source: 'teacher', status: 'confirmed', writingGoal: 'Write.', offTopicCriteria: [],
        excellentFeatures: [], reviewTriggers: [], dimensions: generatedDimensions,
      },
    })
    latestState.enqueueImageEssays({
      submissionId: `bounded-${taskId}`,
      taskId,
      className: 'Synthetic class',
      essayGroups: Array.from({ length: count }, (_, index) => ({
        studentName: `Synthetic ${index + 1}`,
        pages: [{
          id: `queue-source-page-${index + 1}`,
          label: `synthetic-${index + 1}.png`,
          pageNumber: 1,
          quality: 'clear' as const,
          accent: '#000',
          sourceFile: new File([`image-${index + 1}`], `synthetic-${index + 1}.png`, { type: 'image/png' }),
        }],
      })),
    })
  })
  return {
    taskId,
    essayIds: latestState.essays.filter((essay) => essay.taskId === taskId).map((essay) => essay.id),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('AppStateContext grading lifecycle', () => {
  it('uses gradeImages exclusively for initial images and legacy teacher-confirmed regrades', async () => {
    let syntheticNow = 1_786_929_411_787
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => syntheticNow++)
    const grade = vi.fn(async () => { throw new Error('generic grading path must remain inactive') })
    const gradeImages = vi.fn(async (request: MultimodalGradingRequestV2) => resultForImages(request))
    const client: GradingClient & { grade: typeof grade } = { grade, gradeImages }
    renderGradingState(client)

    let materialTaskId = ''
    act(() => {
      materialTaskId = latestState.createTask({
        taskName: 'Image-only task', fullScore: 15,
        materialContext: { materialSummary: 'Material.', writingRequirements: ['Write.'], constraints: [], reviewWarnings: [] },
        rubricDraft: { source: 'teacher', status: 'confirmed', writingGoal: 'Write.', offTopicCriteria: [], excellentFeatures: [], reviewTriggers: [], dimensions: [
          { id: 'content', name: 'Content', weight: 95, description: 'Relevant.', deductionFocus: [], sourceEvidence: ['Material.'] },
          { id: 'legibility', name: 'Legibility', weight: 5, description: 'Readable.', deductionFocus: [], sourceEvidence: [] },
        ] },
      })
      latestState.enqueueImageEssays({
        submissionId: 'single-path-image', taskId: materialTaskId, className: 'Class',
        essayGroups: [{ pages: [{ id: 'page-1', label: 'essay.png', pageNumber: 1, quality: 'clear', accent: '#000', sourceFile: new File(['image'], 'essay.png', { type: 'image/png' }) }] }],
      })
    })
    const imageEssay = latestState.essays.find((essay) => essay.taskId === materialTaskId)
    if (!imageEssay) throw new Error('Image essay missing')
    await act(async () => { await latestState.gradeEssay(imageEssay.id) })

    const legacy = createConfirmedEssay()
    await act(async () => { await latestState.gradeEssay(legacy.essayId) })
    nowSpy.mockRestore()

    expect(grade).not.toHaveBeenCalled()
    expect(gradeImages).toHaveBeenCalledTimes(2)
    expect(gradeImages.mock.calls[0][0]).toMatchObject({ pageIds: [imageEssay.pageOrder[0]], pages: [{ pageId: imageEssay.pageOrder[0] }] })
    expect(gradeImages.mock.calls[1][0]).toMatchObject({
      essayId: legacy.essayId,
      confirmedTranscript: 'Teacher-confirmed synthetic transcript.',
      pageIds: [],
      pages: [],
    })
  })

  it('does not treat an unexpected legacy transcript as Kimi recognition data', async () => {
    const client: GradingClient = {
      async gradeImages(request) {
        return { ...resultForImages(request), transcript: 'Unexpected legacy transcript.', recognitionWarnings: [], printedTextExcluded: true }
      },
    }
    renderGradingState(client)
    const { essayId } = createConfirmedEssay()
    await act(async () => { await latestState.gradeEssay(essayId) })
    expect(latestState.essays.find((essay) => essay.id === essayId)).toMatchObject({
      ocrText: 'Teacher-confirmed synthetic transcript.',
    })
    expect(latestState.essays.find((essay) => essay.id === essayId)?.transcriptSource).toBe('teacher_confirmed')
  })

  it('keeps a real AI result unreviewed until explicit confirmation', async () => {
    const client: GradingClient = { async gradeImages(request) { return resultForImages(request) } }
    renderGradingState(client)
    const { taskId, essayId } = createConfirmedEssay()

    await act(async () => { await latestState.gradeEssay(essayId) })
    expect(latestState.essays.find((essay) => essay.id === essayId)).toMatchObject({
      status: 'grading_ready', teacherReviewed: false,
    })
    expect(latestState.gradingResults.find((result) => result.essayId === essayId)?.source).toBe('remote')
    expect(latestState.tasks.find((task) => task.id === taskId)?.completedEssayCount).toBe(0)

    act(() => latestState.confirmGradingResult(essayId))
    expect(latestState.essays.find((essay) => essay.id === essayId)).toMatchObject({
      status: 'completed', teacherReviewed: true,
    })
    expect(latestState.tasks.find((task) => task.id === taskId)?.completedEssayCount).toBe(1)
  })

  it('returns a failed attempt to pending without automatic retry', async () => {
    const grade = vi.fn(async (request: MultimodalGradingRequestV2) => ({
      requestId: request.requestId, status: 'failed' as const,
      error: { code: 'provider_timeout' as const, message: 'Timed out.', retryable: true },
    }))
    renderGradingState({ gradeImages: grade })
    const { essayId } = createConfirmedEssay()
    await act(async () => { await latestState.gradeEssay(essayId) })
    expect(latestState.essays.find((essay) => essay.id === essayId)).toMatchObject({
      status: 'pending_grading', teacherReviewed: false,
      gradingRun: { status: 'failed', errorCode: 'provider_timeout', retryable: true },
    })
    expect(grade).toHaveBeenCalledTimes(1)
  })

  it('prevents duplicate clicks and reuses the stable request id for an explicit retry', async () => {
    let resolveFirst!: (value: ReturnType<typeof resultForImages>) => void
    const firstResponse = new Promise<ReturnType<typeof resultForImages>>((resolve) => { resolveFirst = resolve })
    const requestIds: string[] = []
    const grade = vi.fn((request: MultimodalGradingRequestV2) => {
      requestIds.push(request.requestId)
      if (requestIds.length === 1) return firstResponse
      return Promise.resolve({
        requestId: request.requestId, status: 'failed' as const,
        error: { code: 'provider_timeout' as const, message: 'Timed out.', retryable: true },
      })
    })
    renderGradingState({ gradeImages: grade })
    const { essayId } = createConfirmedEssay()
    let first!: Promise<void>
    let duplicate!: Promise<void>
    act(() => {
      first = latestState.gradeEssay(essayId)
      duplicate = latestState.gradeEssay(essayId)
    })
    expect(grade).toHaveBeenCalledTimes(1)
    const request = grade.mock.calls[0][0]
    resolveFirst(resultForImages(request))
    await act(async () => { await Promise.all([first, duplicate]) })

    act(() => latestState.markEssayManual(essayId))
    expect(grade).toHaveBeenCalledTimes(1)

    const failingGrade = vi.fn(async (nextRequest: MultimodalGradingRequestV2) => ({
      requestId: nextRequest.requestId, status: 'failed' as const,
      error: { code: 'provider_timeout' as const, message: 'Timed out.', retryable: true },
    }))
    const secondView = renderGradingState({ gradeImages: failingGrade })
    const second = createConfirmedEssay()
    await act(async () => { await latestState.gradeEssay(second.essayId) })
    await act(async () => { await latestState.retryGradeEssay(second.essayId) })
    expect(failingGrade).toHaveBeenCalledTimes(2)
    expect(failingGrade.mock.calls[0][0].requestId).toBe(failingGrade.mock.calls[1][0].requestId)
    secondView.unmount()
  })

  it('queues a second essay and starts it when the bounded slot becomes free', async () => {
    let resolveFirst!: (value: ReturnType<typeof resultForImages>) => void
    const firstResponse = new Promise<ReturnType<typeof resultForImages>>((resolve) => { resolveFirst = resolve })
    const grade = vi.fn((request: MultimodalGradingRequestV2) => firstResponse.then(() => resultForImages(request)))
    renderGradingState({ gradeImages: grade })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-02T01:00:00.000Z'))
    const first = createConfirmedEssay()
    vi.setSystemTime(new Date('2026-08-02T01:00:01.000Z'))
    const second = createConfirmedEssay()
    vi.useRealTimers()
    let firstRun!: Promise<void>
    let blockedRun!: Promise<void>

    act(() => {
      firstRun = latestState.gradeEssay(first.essayId)
      blockedRun = latestState.gradeEssay(second.essayId)
    })

    expect(grade).toHaveBeenCalledTimes(1)
    resolveFirst(resultForImages(grade.mock.calls[0][0]))
    await act(async () => { await Promise.all([firstRun, blockedRun]) })
    await waitFor(() => expect(grade).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(latestState.essays.find((essay) => essay.id === second.essayId)?.status).toBe('grading_ready'))
  })

  it('does not call the client for an invalid request and never falls back to local mock', async () => {
    const grade = vi.fn(async () => { throw new Error('gateway unavailable') })
    renderGradingState({ gradeImages: grade })
    const invalidEssayId = createInvalidRequestEssay()
    await act(async () => { await latestState.gradeEssay(invalidEssayId) })
    expect(grade).not.toHaveBeenCalled()

    const { essayId } = createConfirmedEssay()
    await act(async () => { await latestState.gradeEssay(essayId) })
    expect(grade).toHaveBeenCalledTimes(1)
    expect(latestState.gradingResults.find((result) => result.essayId === essayId)).toBeUndefined()
    expect(latestState.essays.find((essay) => essay.id === essayId)?.gradingRun).toMatchObject({
      status: 'failed', errorCode: 'gateway_unavailable', retryable: true,
    })
  })

  it('settles an unusable success payload instead of leaving the essay stuck in grading', async () => {
    renderGradingState({
      async gradeImages(request) {
        return {
          ...resultForImages(request),
          dimensionScores: undefined,
        } as unknown as Awaited<ReturnType<GradingClient['gradeImages']>>
      },
    })
    const { essayId } = createConfirmedEssay()

    await act(async () => { await latestState.gradeEssay(essayId) })

    expect(latestState.essays.find((essay) => essay.id === essayId)).toMatchObject({
      status: 'pending_grading',
      gradingRun: { status: 'failed', errorCode: 'gateway_invalid_response', retryable: true },
    })
    expect(latestState.gradingResults.find((result) => result.essayId === essayId)).toBeUndefined()
  })

  it('editing does not confirm and confirmation is ignored outside grading_ready', async () => {
    renderGradingState({ async gradeImages(request) { return resultForImages(request) } })
    const { essayId } = createConfirmedEssay()
    act(() => latestState.confirmGradingResult(essayId))
    expect(latestState.essays.find((essay) => essay.id === essayId)?.status).toBe('pending_grading')

    await act(async () => { await latestState.gradeEssay(essayId) })
    act(() => latestState.updateGradingResult(essayId, { overallComment: 'Teacher edit.' }))
    expect(latestState.essays.find((essay) => essay.id === essayId)).toMatchObject({
      status: 'grading_ready', teacherReviewed: false,
    })
  })

  it.each(['success', 'failure'] as const)('ignores a late %s after manual handling', async (kind) => {
    let resolve!: (value: Awaited<ReturnType<GradingClient['gradeImages']>>) => void
    const deferred = new Promise<Awaited<ReturnType<GradingClient['gradeImages']>>>((done) => { resolve = done })
    const grade = vi.fn((_request: MultimodalGradingRequestV2) => deferred)
    renderGradingState({ gradeImages: grade })
    const { taskId, essayId } = createConfirmedEssay()
    let pending!: Promise<void>
    act(() => { pending = latestState.gradeEssay(essayId) })
    act(() => latestState.markEssayManual(essayId))
    const countsAfterManual = latestState.tasks.find((task) => task.id === taskId)?.completedEssayCount
    const request = grade.mock.calls[0][0]
    resolve(kind === 'success'
      ? resultForImages(request)
      : {
          requestId: request.requestId, status: 'failed',
          error: { code: 'provider_timeout', message: 'Timed out.', retryable: true },
        })
    await act(async () => { await pending })
    expect(latestState.essays.find((essay) => essay.id === essayId)).toMatchObject({
      status: 'manual', teacherReviewed: true,
    })
    expect(latestState.gradingResults.find((result) => result.essayId === essayId)).toBeUndefined()
    expect(latestState.tasks.find((task) => task.id === taskId)?.completedEssayCount).toBe(countsAfterManual)
  })

  it('resets added in-memory grading data on provider remount', () => {
    const view = renderGradingState({ async gradeImages(request) { return resultForImages(request) } })
    const { taskId } = createConfirmedEssay()
    expect(latestState.tasks.some((task) => task.id === taskId)).toBe(true)
    view.unmount()
    renderGradingState({ async gradeImages(request) { return resultForImages(request) } })
    expect(latestState.tasks.some((task) => task.id === taskId)).toBe(false)
  })
})

describe('AppStateContext bounded whole-task grading queue', () => {
  it('recreates its scheduler after the StrictMode effect probe', async () => {
    const gradeImages = vi.fn(async (request: MultimodalGradingRequestV2) => resultForImages(request))
    render(
      <StrictMode>
        <AppStateProvider
          gradingClient={{ gradeImages }}
          gradingSchedulerOptions={{ mode: 'single-legacy', hardLimit: 1, stableSuccessWindow: 2 }}
        >
          <StateProbe />
        </AppStateProvider>
      </StrictMode>,
    )
    const { taskId, essayIds } = createQueuedImageEssays(1)

    act(() => latestState.startTaskGrading(taskId))

    await waitFor(() => expect(gradeImages).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(latestState.essays.find((essay) => essay.id === essayIds[0])?.status).toBe('grading_ready'))
  })

  it('starts every actionable essay once, never exceeds the configured hard limit, and fills freed slots', async () => {
    const pending: Array<ReturnType<typeof deferred<ReturnType<typeof resultForImages>>>> = []
    let active = 0
    let maximumActive = 0
    const gradeImages = vi.fn((_request: MultimodalGradingRequestV2) => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      const response = deferred<ReturnType<typeof resultForImages>>()
      pending.push(response)
      return response.promise.finally(() => { active -= 1 })
    })
    render(
      <AppStateProvider
        gradingClient={{ gradeImages }}
        gradingSchedulerOptions={{ mode: 'adaptive-v1', hardLimit: 2, stableSuccessWindow: 1 }}
      >
        <StateProbe />
      </AppStateProvider>,
    )
    const { taskId, essayIds } = createQueuedImageEssays(3)

    act(() => latestState.startTaskGrading(taskId))
    expect(gradeImages).toHaveBeenCalledTimes(1)
    act(() => latestState.startTaskGrading(taskId))
    expect(gradeImages).toHaveBeenCalledTimes(1)

    pending[0].resolve(resultForImages(gradeImages.mock.calls[0][0]))
    await waitFor(() => expect(gradeImages).toHaveBeenCalledTimes(3))
    expect(maximumActive).toBe(2)
    expect(latestState.taskGradingQueues[taskId]).toMatchObject({ targetConcurrency: 2, activeCount: 2 })

    pending[1].resolve(resultForImages(gradeImages.mock.calls[1][0]))
    pending[2].resolve(resultForImages(gradeImages.mock.calls[2][0]))
    await waitFor(() => {
      expect(essayIds.map((essayId) => latestState.essays.find((essay) => essay.id === essayId)?.status))
        .toEqual(['grading_ready', 'grading_ready', 'grading_ready'])
    })
    expect(latestState.taskGradingQueues[taskId]).toMatchObject({ status: 'settled', activeCount: 0, queuedCount: 0 })
  })

  it('isolates a retryable essay failure and reuses its stable caller ID on retry', async () => {
    const attempts = new Map<string, number>()
    const requests: MultimodalGradingRequestV2[] = []
    const gradeImages = vi.fn(async (request: MultimodalGradingRequestV2) => {
      requests.push(request)
      const attempt = (attempts.get(request.essayId) ?? 0) + 1
      attempts.set(request.essayId, attempt)
      if (requests.length === 1 && attempt === 1) {
        return {
          requestId: request.requestId,
          status: 'failed' as const,
          error: { code: 'provider_timeout' as const, message: 'Timed out.', retryable: true },
        }
      }
      return resultForImages(request)
    })
    render(
      <AppStateProvider
        gradingClient={{ gradeImages }}
        gradingSchedulerOptions={{ mode: 'adaptive-v1', hardLimit: 2, stableSuccessWindow: 1 }}
      >
        <StateProbe />
      </AppStateProvider>,
    )
    const { taskId, essayIds } = createQueuedImageEssays(2)
    act(() => latestState.startTaskGrading(taskId))

    await waitFor(() => expect(gradeImages).toHaveBeenCalledTimes(2))
    expect(latestState.essays.find((essay) => essay.id === essayIds[0])?.status).toBe('pending_grading')
    expect(latestState.essays.find((essay) => essay.id === essayIds[1])?.status).toBe('grading_ready')
    const firstRequestId = requests.find((request) => request.essayId === essayIds[0])?.requestId

    act(() => latestState.retryTaskEssay(essayIds[0]))
    await waitFor(() => expect(gradeImages).toHaveBeenCalledTimes(3))
    const retryIds = requests.filter((request) => request.essayId === essayIds[0]).map((request) => request.requestId)
    expect(retryIds).toEqual([firstRequestId, firstRequestId])
    expect(latestState.essays.find((essay) => essay.id === essayIds[0])?.status).toBe('grading_ready')
  })

  it('reattaches an unknown result with the same caller ID and never turns it into a fresh job', async () => {
    const requestIds: string[] = []
    const gradeImages = vi.fn(async (request: MultimodalGradingRequestV2) => {
      requestIds.push(request.requestId)
      if (requestIds.length === 1) {
        return {
          requestId: request.requestId,
          status: 'failed' as const,
          error: { code: 'provider_result_unknown' as const, message: 'Unknown.', retryable: false },
          clientMeta: { reattachOnly: true as const },
        }
      }
      return resultForImages(request)
    })
    render(
      <AppStateProvider gradingClient={{ gradeImages }} gradingSchedulerOptions={{ mode: 'single-legacy', hardLimit: 1, stableSuccessWindow: 2 }}>
        <StateProbe />
      </AppStateProvider>,
    )
    const { taskId, essayIds } = createQueuedImageEssays(1)
    act(() => latestState.startTaskGrading(taskId))
    await waitFor(() => expect(latestState.taskGradingQueues[taskId]?.items[essayIds[0]]?.phase).toBe('result_unknown'))

    act(() => latestState.checkUnknownTaskEssay(essayIds[0]))
    await waitFor(() => expect(gradeImages).toHaveBeenCalledTimes(2))
    expect(requestIds[1]).toBe(requestIds[0])
    expect(latestState.essays.find((essay) => essay.id === essayIds[0])?.status).toBe('grading_ready')
  })

  it('pauses queued work after an auth failure and resumes only on explicit teacher action', async () => {
    const requests: MultimodalGradingRequestV2[] = []
    const gradeImages = vi.fn(async (request: MultimodalGradingRequestV2) => {
      requests.push(request)
      if (requests.length === 1) {
        return {
          requestId: request.requestId,
          status: 'failed' as const,
          error: { code: 'provider_auth_failed' as const, message: 'Auth failed.', retryable: false },
        }
      }
      return resultForImages(request)
    })
    render(
      <AppStateProvider gradingClient={{ gradeImages }} gradingSchedulerOptions={{ mode: 'adaptive-v1', hardLimit: 3, stableSuccessWindow: 1 }}>
        <StateProbe />
      </AppStateProvider>,
    )
    const { taskId } = createQueuedImageEssays(3)
    act(() => latestState.startTaskGrading(taskId))
    await waitFor(() => expect(latestState.taskGradingQueues[taskId]?.pauseReason).toBe('auth'))
    expect(gradeImages).toHaveBeenCalledTimes(1)

    await act(async () => { await Promise.resolve() })
    expect(gradeImages).toHaveBeenCalledTimes(1)
    act(() => latestState.resumeTaskGrading(taskId))
    await waitFor(() => expect(gradeImages).toHaveBeenCalledTimes(3))
    expect(latestState.taskGradingQueues[taskId]?.status).toBe('settled')
  })

  it('increments the source generation, creates a new identity, and rejects the old late response', async () => {
    const calls: Array<{ request: MultimodalGradingRequestV2; response: ReturnType<typeof deferred<ReturnType<typeof resultForImages>>> }> = []
    const gradeImages = vi.fn((request: MultimodalGradingRequestV2) => {
      const response = deferred<ReturnType<typeof resultForImages>>()
      calls.push({ request, response })
      return response.promise
    })
    render(
      <AppStateProvider gradingClient={{ gradeImages }} gradingSchedulerOptions={{ mode: 'single-legacy', hardLimit: 1, stableSuccessWindow: 2 }}>
        <StateProbe />
      </AppStateProvider>,
    )
    const { taskId, essayIds } = createQueuedImageEssays(1)
    const essayId = essayIds[0]
    act(() => latestState.startTaskGrading(taskId))
    expect(calls).toHaveLength(1)

    act(() => latestState.updateEssayOcrText(essayId, 'Teacher corrected exact text.', '2026-08-28T00:00:00.000Z'))
    expect(latestState.essays.find((essay) => essay.id === essayId)).toMatchObject({
      sourceGeneration: 1,
      ocrText: 'Teacher corrected exact text.',
      status: 'pending_grading',
      gradingRun: { status: 'idle' },
    })
    act(() => latestState.retryTaskEssay(essayId))

    calls[0].response.resolve(resultForImages(calls[0].request))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1].request.requestId).not.toBe(calls[0].request.requestId)
    expect(calls[1].request).toMatchObject({ confirmedTranscript: 'Teacher corrected exact text.', pageIds: [], pages: [] })
    expect(latestState.gradingResults.find((result) => result.essayId === essayId)).toBeUndefined()

    calls[1].response.resolve(resultForImages(calls[1].request))
    await waitFor(() => expect(latestState.essays.find((essay) => essay.id === essayId)?.status).toBe('grading_ready'))
    expect(latestState.essays.find((essay) => essay.id === essayId)).toMatchObject({
      sourceGeneration: 1,
      ocrText: 'Teacher corrected exact text.',
      transcriptSource: 'teacher_confirmed',
    })
  })
})
