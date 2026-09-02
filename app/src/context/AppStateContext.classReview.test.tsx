import { act, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createFakeClassReviewSynthesisClient, type ClassReviewSynthesisClient } from '../services/classReview/fakeClassReviewSynthesisClient'
import type { ClassReviewSynthesisRequestV1, ClassReviewSynthesisResultV1 } from '../services/classReview/types'
import { AppStateProvider } from './AppStateContext'
import type { AppState } from './appStateContextValue'
import { useAppState } from './useAppState'

let latestState: AppState

function StateProbe() {
  latestState = useAppState()
  return null
}

function renderClassReviewState(client: ClassReviewSynthesisClient) {
  return render(<AppStateProvider classReviewSynthesisClient={client}><StateProbe /></AppStateProvider>)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function editedSummary() {
  return {
    overallComment: '教师保留并微调后的班级总体评价。',
    strengths: [{ title: '表达完整', detail: '多数学生能够完成写作任务。', dimensionIds: [] }],
    learningRecommendations: [{ title: '下一步', action: '围绕共性问题做一次短句改写。' }],
  }
}

describe('AppStateContext class review prototype workspace', () => {
  it('connects report lifecycle commands without using legacy mock insights or extra completions', async () => {
    const release = deferred<void>()
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'success' })
    const synthesize = vi.fn(async (request: ClassReviewSynthesisRequestV1): Promise<ClassReviewSynthesisResultV1> => {
      await release.promise
      return fake.synthesize(request)
    })
    renderClassReviewState({ synthesize })

    expect(latestState.classInsights).toEqual([])
    expect(latestState.classReview.peekSnapshot('task-3')).toBeNull()
    let snapshot = latestState.classReview.getSnapshot('task-3')
    expect(latestState.classReview.peekSnapshot('task-3')?.report.workspaceState).toBe('draft')
    expect(snapshot.report.workspaceState).toBe('draft')
    expect(snapshot.canGenerate).toBe(true)
    expect(snapshot.report.statistics.includedEssayCount).toBe(12)
    expect(snapshot.report.clearSpellingItems.every((item) =>
      item.studentCount > 0 && item.occurrenceCount >= item.studentCount,
    )).toBe(true)

    act(() => {
      latestState.classReview.addIssue({
        taskId: 'task-3',
        essayId: 'task-3-essay-1',
        sourceLocator: 'loc.task-3-essay-1.err-low',
        sourceResultRevision: 0,
        title: '低频但需要讲评的问题',
        diagnosis: '学生把活动目的写得过于笼统。',
        teachingAction: '让学生补充一个具体活动细节。',
        severity: 'low',
        anonymousExample: 'It is very good.',
      })
    })
    snapshot = latestState.classReview.getSnapshot('task-3')
    expect(snapshot.report.workspaceState).toBe('draft')
    expect(snapshot.report.issueBlocks).toHaveLength(1)
    expect(snapshot.report.issueBlocks[0]).toMatchObject({
      origin: 'teacher',
      teacherStudentCount: 1,
      systemStudentCount: 0,
    })
    expect(latestState.classReviewMaterials).toHaveLength(0)

    let generation!: Promise<unknown>
    act(() => {
      generation = latestState.classReview.generate('task-3')
    })
    await waitFor(() => expect(synthesize).toHaveBeenCalledTimes(1))
    expect(latestState.classReview.getSnapshot('task-3').generation?.state).toBe('running')
    expect(() => latestState.classReview.beginAiTextEdit('task-3')).toThrow('ai_text_edit_locked')
    expect(() =>
      latestState.classReview.moveIssue('task-3', snapshot.report.issueBlocks[0].blockId, 0),
    ).not.toThrow()

    await act(async () => {
      release.resolve()
      await generation
    })

    snapshot = latestState.classReview.getSnapshot('task-3')
    expect(snapshot.report.workspaceState).toBe('ai_available')
    expect(fake.getCallCountForTest()).toBe(1)

    act(() => {
      latestState.classReview.beginAiTextEdit('task-3')
      latestState.classReview.saveAiTextEdit('task-3', editedSummary())
    })
    const edited = latestState.classReview.getSnapshot('task-3')
    expect(edited.report.workspaceState).toBe('ai_available')
    if (edited.report.workspaceState !== 'ai_available') throw new Error('Expected AI report')
    expect(edited.report.aiSummary.overallComment).toBe('教师保留并微调后的班级总体评价。')

    await act(async () => { await latestState.classReview.generate('task-3', 'regenerate') })
    expect(fake.getCallCountForTest()).toBe(2)
  })

  it('increments result revisions and separates ordinary source sync from source deletion', async () => {
    const fake = createFakeClassReviewSynthesisClient({ scenario: 'success' })
    renderClassReviewState(fake)
    const result = latestState.gradingResults.find((item) => item.essayId === 'task-3-essay-1')
    if (!result) throw new Error('Missing synthetic result')

    expect(result.resultRevision).toBe(0)
    expect(() => {
      act(() =>
        latestState.classReview.addIssue({
          taskId: 'task-3',
          essayId: 'task-3-essay-1',
          sourceLocator: 'loc.task-3-essay-1.err-before-edit',
          sourceResultRevision: 1,
          title: '旧来源版本不应可加入',
          diagnosis: '这条证据版本还不存在。',
          teachingAction: '忽略。',
          severity: 'low',
          anonymousExample: null,
        }),
      )
    }).toThrow('class_review_source_invalidated')

    act(() => latestState.updateGradingResult('task-3-essay-1', { overallComment: 'Teacher revision 1.' }))
    expect(latestState.gradingResults.find((item) => item.essayId === 'task-3-essay-1')).toMatchObject({
      resultRevision: 1,
      teacherAdjusted: true,
      overallComment: 'Teacher revision 1.',
    })

    act(() => {
      latestState.classReview.addIssue({
        taskId: 'task-3',
        essayId: 'task-3-essay-1',
        sourceLocator: 'loc.task-3-essay-1.err-after-edit',
        sourceResultRevision: 1,
        title: '教师手动加入的问题',
        diagnosis: '教师确认该问题值得进入班级总览。',
        teachingAction: '用同类句子做一次归纳讲评。',
        severity: 'medium',
        anonymousExample: 'I suggest you joins the club.',
      })
    })
    const teacherBlock = latestState.classReview.getSnapshot('task-3').report.issueBlocks[0]
    expect(teacherBlock.evidenceRefs[0]).toMatchObject({
      selectionOrigin: 'teacher_selected',
      sourceResultRevision: 1,
    })

    await act(async () => { await latestState.classReview.generate('task-3') })
    expect(fake.getCallCountForTest()).toBe(1)
    expect(latestState.classReview.getSnapshot('task-3').report.workspaceState).toBe('ai_available')

    act(() => latestState.updateGradingResult('task-3-essay-1', { overallComment: 'Teacher revision 2.' }))
    expect(latestState.gradingResults.find((item) => item.essayId === 'task-3-essay-1')?.resultRevision).toBe(2)
    expect(latestState.classReview.getSnapshot('task-3').report.workspaceState).toBe('ai_available')
    expect(fake.getCallCountForTest()).toBe(1)

    act(() => latestState.classReview.deleteSource('task-3'))
    expect(latestState.classReview.getSnapshot('task-3').report.workspaceState).toBe('ai_removed')
    expect(fake.getCallCountForTest()).toBe(1)
  })
})
