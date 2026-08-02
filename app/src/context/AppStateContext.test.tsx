import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { confirmOcrAudit, createPendingOcrAudit } from '../services/ocr/audit/transcriptAudit'
import type { Essay } from '../types'
import type { GradingClient, GradingRequestV1 } from '../services/grading/types'
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
  it('rejects a transcript edit while an image grading request is running, then settles only the Kimi transcript', async () => {
    let resolve!: (value: Awaited<ReturnType<NonNullable<GradingClient['gradeImages']>>>) => void
    const deferred = new Promise<Awaited<ReturnType<NonNullable<GradingClient['gradeImages']>>>>((done) => { resolve = done })
    const gradeImages = vi.fn<NonNullable<GradingClient['gradeImages']>>((_request) => deferred)
    render(<AppStateProvider gradingClient={{ grade: async (request) => resultFor(request), gradeImages }}><StateProbe /></AppStateProvider>)
    let taskId = ''
    act(() => {
      taskId = latestState.createTask({
        taskName: 'Deferred image task', fullScore: 15,
        materialContext: { materialSummary: 'Material.', writingRequirements: ['Write.'], constraints: [], reviewWarnings: [] },
        rubricDraft: { source: 'ai', status: 'confirmed', writingGoal: 'Write.', offTopicCriteria: [], excellentFeatures: [], reviewTriggers: [], dimensions: [{ id: 'content', name: 'Content', weight: 100, description: 'Relevant.', deductionFocus: [], sourceEvidence: ['Material.'] }] },
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
    const runningEssays = latestState.essays
    act(() => latestState.updateEssayOcrText(essay.id, 'Teacher edit during grading.'))
    expect(latestState.essays).toBe(runningEssays)
    expect(latestState.essays.find((item) => item.id === essay.id)).toMatchObject({ ocrText: '', status: 'grading' })
    expect(gradeImages).toHaveBeenCalledTimes(1)

    const request = gradeImages.mock.calls[0][0]
    resolve({
      resultVersion: 'grading-result-v1', requestId: request.requestId, essayId: request.essayId, provider: 'mock', status: 'success', totalScore: 12, maxScore: 15,
      dimensionScores: [], issues: [], sentenceRevisions: [], expressionUpgrades: [], overallComment: 'Done.', reviewReasons: [], createdAt: '2026-08-02T00:00:00.000Z',
      transcript: 'Kimi settled transcript.', transcriptionWarnings: [], printedTextExcluded: true,
    })
    await act(async () => { await grading })
    expect(latestState.essays.find((item) => item.id === essay.id)).toMatchObject({
      ocrText: 'Kimi settled transcript.', transcriptSource: 'kimi_vision', status: 'grading_ready',
    })
  })

  it('queues a material task with original files and grades it through the image client once', async () => {
    const gradingClient: GradingClient = {
      grade: async (request) => resultFor(request, 'mock'),
      gradeImages: async (request) => ({
        resultVersion: 'grading-result-v1', requestId: request.requestId, essayId: request.essayId, provider: 'mock', status: 'success',
        totalScore: 12, maxScore: 15,
        dimensionScores: [{ dimensionId: 'content', name: 'Content', score: 12, maxScore: 15, weight: 100, reason: 'Dimension reason.', evidence: 'Dimension evidence.', requiresTeacherReview: false }],
        issues: [{ id: 'issue-1', type: 'grammar', severity: 'medium', originalText: 'bad', suggestion: 'better', explanation: 'Issue explanation.', requiresTeacherReview: true }],
        sentenceRevisions: [{ id: 'revision-1', relatedIssueId: 'issue-1', originalText: 'bad', revisedText: 'better', note: 'Revision note.', requiresTeacherReview: false }],
        expressionUpgrades: [{ id: 'upgrade-1', originalText: 'plain', upgradedText: 'polished', note: 'Upgrade note.', requiresTeacherReview: true }],
        fullTextRevision: { originalText: 'bad', correctedText: 'better', improvedText: 'polished', sentencePairs: [{ id: 'pair-1', originalText: 'bad', correctedText: 'better', improvedText: 'polished', changeTypes: ['grammar'], explanation: 'Pair explanation.', requiresTeacherReview: false }], logicNotes: [] },
        overallComment: 'Detailed image result.', reviewReasons: [], createdAt: '2026-08-02T00:00:00.000Z',
        transcript: 'Faithful image transcript.', transcriptionWarnings: ['Low contrast on final line.'], printedTextExcluded: true,
      }),
    }
    render(<AppStateProvider gradingClient={gradingClient}><StateProbe /></AppStateProvider>)
    let taskId = ''
    act(() => { taskId = latestState.createTask({ taskName: 'Image task', fullScore: 15, materialContext: { materialSummary: 'Material.', writingRequirements: ['Write.'], constraints: [], reviewWarnings: [] }, rubricDraft: { source: 'ai', status: 'confirmed', writingGoal: 'Write.', offTopicCriteria: [], excellentFeatures: [], reviewTriggers: [], dimensions: [{ id: 'content', name: 'Content', weight: 100, description: 'Relevant.', deductionFocus: [], sourceEvidence: ['Material.'] }] } }) })
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
      source: 'mock', transcript: 'Faithful image transcript.', transcriptionWarnings: ['Low contrast on final line.'], printedTextExcluded: true,
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
      resultVersion: 'grading-result-v1' as const, requestId: request.requestId, essayId: request.essayId, provider: 'mock' as const, status: 'success' as const,
      totalScore: 12, maxScore: 15,
      dimensionScores: [{ dimensionId: 'content', name: 'Content', score: 12, maxScore: 15, weight: 100, reason: 'Reason.', evidence: 'Evidence.', requiresTeacherReview: false }],
      issues: [], sentenceRevisions: [], expressionUpgrades: [], overallComment: 'Comment.', reviewReasons: [], createdAt: '2026-08-02T00:00:00.000Z',
      transcript: request.confirmedTranscript ?? 'Kimi transcript.', transcriptionWarnings: [], printedTextExcluded: true,
    }))
    render(<AppStateProvider gradingClient={{ grade: async (request) => resultFor(request), gradeImages }}><StateProbe /></AppStateProvider>)
    let taskId = ''
    act(() => {
      taskId = latestState.createTask({
        taskName: 'Image task', fullScore: 15,
        materialContext: { materialSummary: 'Material.', writingRequirements: ['Write.'], constraints: [], reviewWarnings: [] },
        rubricDraft: { source: 'ai', status: 'confirmed', writingGoal: 'Write.', offTopicCriteria: [], excellentFeatures: [], reviewTriggers: [], dimensions: [{ id: 'content', name: 'Content', weight: 100, description: 'Relevant.', deductionFocus: [], sourceEvidence: ['Material.'] }] },
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

  it('creates a genre-free Kimi task with compatibility defaults and assigns its class later', () => {
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
      taskName: 'AI generated task', className: '待选择班级', essayType: '材料写作',
      scoringTemplateId: 'kimi-generated-v1', fullScore: 15, generateClassReview: true,
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
})

let latestState: AppState

function StateProbe() {
  latestState = useAppState()
  return null
}

function resultFor(request: GradingRequestV1, provider: 'mock' | 'remote' = 'remote') {
  const dimensionScores = request.task.rubric.dimensions.map((dimension) => ({
    dimensionId: dimension.id,
    name: dimension.name,
    score: request.task.fullScore,
    maxScore: request.task.fullScore,
    weight: dimension.weight,
    reason: 'Synthetic reason.',
    evidence: request.essay.confirmedTranscript,
  }))
  return {
    resultVersion: 'grading-result-v1' as const,
    requestId: request.requestId,
    essayId: request.essay.essayId,
    provider,
    status: 'success' as const,
    totalScore: request.task.fullScore,
    maxScore: request.task.fullScore,
    dimensionScores,
    issues: [],
    sentenceRevisions: [],
    expressionUpgrades: [],
    overallComment: 'Synthetic result.',
    reviewReasons: [],
    createdAt: '2026-07-20T01:00:00.000Z',
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

describe('AppStateContext grading lifecycle', () => {
  it('does not treat an unexpected legacy transcript as Kimi recognition data', async () => {
    const client: GradingClient = {
      async grade(request) {
        return { ...resultFor(request), transcript: 'Unexpected legacy transcript.', transcriptionWarnings: [], printedTextExcluded: true }
      },
    }
    renderGradingState(client)
    const { essayId } = createConfirmedEssay()
    await act(async () => { await latestState.gradeEssay(essayId) })
    expect(latestState.essays.find((essay) => essay.id === essayId)).toMatchObject({
      ocrText: 'Teacher-confirmed synthetic transcript.',
    })
    expect(latestState.essays.find((essay) => essay.id === essayId)?.transcriptSource).toBeUndefined()
  })

  it('keeps a real AI result unreviewed until explicit confirmation', async () => {
    const client: GradingClient = { async grade(request) { return resultFor(request) } }
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
    const grade = vi.fn(async (request: GradingRequestV1) => ({
      requestId: request.requestId, status: 'failed' as const,
      error: { code: 'provider_timeout' as const, message: 'Timed out.', retryable: true },
    }))
    renderGradingState({ grade })
    const { essayId } = createConfirmedEssay()
    await act(async () => { await latestState.gradeEssay(essayId) })
    expect(latestState.essays.find((essay) => essay.id === essayId)).toMatchObject({
      status: 'pending_grading', teacherReviewed: false,
      gradingRun: { status: 'failed', errorCode: 'provider_timeout', retryable: true },
    })
    expect(grade).toHaveBeenCalledTimes(1)
  })

  it('prevents duplicate clicks and gives an explicit retry a fresh request id', async () => {
    let resolveFirst!: (value: ReturnType<typeof resultFor>) => void
    const firstResponse = new Promise<ReturnType<typeof resultFor>>((resolve) => { resolveFirst = resolve })
    const requestIds: string[] = []
    const grade = vi.fn((request: GradingRequestV1) => {
      requestIds.push(request.requestId)
      if (requestIds.length === 1) return firstResponse
      return Promise.resolve({
        requestId: request.requestId, status: 'failed' as const,
        error: { code: 'provider_timeout' as const, message: 'Timed out.', retryable: true },
      })
    })
    renderGradingState({ grade })
    const { essayId } = createConfirmedEssay()
    let first!: Promise<void>
    let duplicate!: Promise<void>
    act(() => {
      first = latestState.gradeEssay(essayId)
      duplicate = latestState.gradeEssay(essayId)
    })
    expect(grade).toHaveBeenCalledTimes(1)
    const request = grade.mock.calls[0][0]
    resolveFirst(resultFor(request))
    await act(async () => { await Promise.all([first, duplicate]) })

    act(() => latestState.markEssayManual(essayId))
    expect(grade).toHaveBeenCalledTimes(1)

    const failingGrade = vi.fn(async (nextRequest: GradingRequestV1) => ({
      requestId: nextRequest.requestId, status: 'failed' as const,
      error: { code: 'provider_timeout' as const, message: 'Timed out.', retryable: true },
    }))
    const secondView = renderGradingState({ grade: failingGrade })
    const second = createConfirmedEssay()
    await act(async () => { await latestState.gradeEssay(second.essayId) })
    await act(async () => { await latestState.retryGradeEssay(second.essayId) })
    expect(failingGrade).toHaveBeenCalledTimes(2)
    expect(failingGrade.mock.calls[0][0].requestId).not.toBe(failingGrade.mock.calls[1][0].requestId)
    secondView.unmount()
  })

  it('prevents a second essay from starting while any grading request is in flight', async () => {
    let resolveFirst!: (value: ReturnType<typeof resultFor>) => void
    const firstResponse = new Promise<ReturnType<typeof resultFor>>((resolve) => { resolveFirst = resolve })
    const grade = vi.fn((request: GradingRequestV1) => firstResponse.then(() => resultFor(request)))
    renderGradingState({ grade })
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
    resolveFirst(resultFor(grade.mock.calls[0][0]))
    await act(async () => { await Promise.all([firstRun, blockedRun]) })
    expect(latestState.essays.find((essay) => essay.id === second.essayId)?.status).toBe('pending_grading')
  })

  it('does not call the client for an invalid request and uses local mock only on fallback', async () => {
    const grade = vi.fn()
    renderGradingState({ grade })
    const invalidEssayId = createInvalidRequestEssay()
    await act(async () => { await latestState.gradeEssay(invalidEssayId) })
    expect(grade).not.toHaveBeenCalled()

    const { essayId } = createConfirmedEssay()
    await act(async () => { await latestState.fallbackToMockGrading(essayId) })
    expect(grade).not.toHaveBeenCalled()
    expect(latestState.gradingResults.find((result) => result.essayId === essayId)?.source).toBe('mock')
  })

  it('editing does not confirm and confirmation is ignored outside grading_ready', async () => {
    renderGradingState({ async grade(request) { return resultFor(request) } })
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
    let resolve!: (value: Awaited<ReturnType<GradingClient['grade']>>) => void
    const deferred = new Promise<Awaited<ReturnType<GradingClient['grade']>>>((done) => { resolve = done })
    const grade = vi.fn((_request: GradingRequestV1) => deferred)
    renderGradingState({ grade })
    const { taskId, essayId } = createConfirmedEssay()
    let pending!: Promise<void>
    act(() => { pending = latestState.gradeEssay(essayId) })
    act(() => latestState.markEssayManual(essayId))
    const countsAfterManual = latestState.tasks.find((task) => task.id === taskId)?.completedEssayCount
    const request = grade.mock.calls[0][0]
    resolve(kind === 'success'
      ? resultFor(request)
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
    const view = renderGradingState({ async grade(request) { return resultFor(request) } })
    const { taskId } = createConfirmedEssay()
    expect(latestState.tasks.some((task) => task.id === taskId)).toBe(true)
    view.unmount()
    renderGradingState({ async grade(request) { return resultFor(request) } })
    expect(latestState.tasks.some((task) => task.id === taskId)).toBe(false)
  })
})
