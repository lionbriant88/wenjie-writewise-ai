import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { TaskDto, EssayDto } from '../../../shared/pilotContracts'
import { createPilotClient } from './client'
import { CloudWorkspace } from './workspace'
import { CloudAppStateProvider } from './CloudAppStateProvider'
import { useAppState } from '../context/useAppState'
import { useCloudReview } from './useCloudReview'
import type { GradingResult } from '../types'
import { getProgressEssayPhase } from '../utils/progressQueue'
const task: TaskDto = {
  id: 'task',
  state: 'confirmed',
  revision: 2,
  rubricRevision: 1,
  confirmedPackage: null,
  draft: {
    taskName: 'Synthetic',
    fullScore: 15,
    writingRequirement: 'Write.',
    dimensions: [],
    source: 'teacher',
    materialContext: null,
    materialProcessingStatus: 'none',
    materialRefs: [],
  },
  counts: { total: 1, completed: 0, exceptions: 1 },
  createdAt: '2026-09-28T00:00:00Z',
  updatedAt: '2026-09-28T00:00:00Z',
}
const essay: EssayDto = {
  id: 'essay',
  taskId: 'task',
  revision: 1,
  sourceRevision: 1,
  studentName: '学生1',
  essayNumber: 1,
  pages: [],
  confirmedTranscript: null,
  currentResult: null,
  teacherReviewed: false,
  manualReviewRequired: false,
  currentJob: {
    id: 'job',
    kind: 'grade',
    state: 'result_unknown',
    errorCode: 'provider_result_unknown',
    retryable: false,
    revision: 2,
    retryAt: null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  },
}
it('loads persisted unknown work and checks with GET without launching another completion', async () => {
  const requests: { path: string; method: string }[] = []
  const client = createPilotClient({
    getCsrfToken: () => 'synthetic',
    onSessionExpired: () => {},
    fetchImpl: vi.fn(async (url, options) => {
      const path = String(url),
        method = options?.method ?? 'GET'
      requests.push({ path, method })
      if (path.includes('/capabilities'))
        return Response.json({
          teacherMvp: true,
          aiAvailable: true,
          queueState: 'waiting',
        })
      if (path.includes('/essays?'))
        return Response.json({ items: [essay], nextCursor: null })
      if (path.includes('/tasks?'))
        return Response.json({ items: [task], nextCursor: null })
      if (path.includes('/jobs/')) return Response.json(essay.currentJob)
      if (path.endsWith('/grade')) return Response.json({ accepted: 0 })
      throw Error('unexpected')
    }),
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <CloudAppStateProvider userId="teacher" client={client}>
      {children}
    </CloudAppStateProvider>
  )
  const view = renderHook(() => useAppState(), { wrapper })
  await waitFor(() => expect(view.result.current?.essays).toHaveLength(1))
  expect(view.result.current.taskGradingQueues.task.items.essay.phase).toBe(
    'result_unknown',
  )
  expect(
    getProgressEssayPhase(
      view.result.current.essays[0],
      view.result.current.taskGradingQueues.task,
      1,
    ),
  ).toBe('result_unknown')
  await act(async () => {
    await view.result.current.checkUnknownTaskEssay('essay')
  })
  expect(requests.filter((r) => r.method !== 'GET')).toHaveLength(0)
  await act(async () => {
    await Promise.all([
      view.result.current.startTaskGrading('task'),
      view.result.current.startTaskGrading('task'),
    ])
  })
  expect(requests.filter((r) => r.path.endsWith('/grade'))).toHaveLength(1)
  view.unmount()
})
it('preserves unsaved feedback and the original CAS revision across a failed save and another tab update', async () => {
  const requests: unknown[] = [],
    client = createPilotClient({
      getCsrfToken: () => 'synthetic',
      onSessionExpired: () => {},
      fetchImpl: vi.fn(async (_url, options) => {
        requests.push(JSON.parse(options?.body as string))
        return Response.json(
          { error: { code: 'revision_conflict', message: '冲突' } },
          { status: 409 },
        )
      }),
    }),
    pilot = new CloudWorkspace(client)
  pilot.essays = [
    {
      ...essay,
      currentResult: {
        resultRevision: 1,
        sourceRevision: 1,
        rubricRevision: 1,
        ai: {} as never,
        review: null,
        updatedAt: task.updatedAt,
      },
    },
  ]
  const result: GradingResult = {
    id: 'result',
    essayId: 'essay',
    totalScore: 5,
    dimensionScores: [],
    errorAnnotations: [],
    sentenceRevisions: [],
    upgradedExpressions: [],
    overallComment: 'Original',
    teacherAdjusted: false,
    recognitionWarnings: [],
    legibilityIssues: [],
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
  const view = renderHook(
    ({ value }) => useCloudReview(pilot, 'essay', value),
    { initialProps: { value: result } },
  )
  act(() => view.result.current.edit({ overallComment: 'My unsaved feedback' }))
  expect(requests).toHaveLength(0)
  pilot.essays = [
    {
      ...pilot.essays[0],
      revision: 2,
      currentResult: { ...pilot.essays[0].currentResult!, resultRevision: 2 },
    },
  ]
  view.rerender({ value: { ...result, overallComment: 'Other tab' } })
  expect(view.result.current.result?.overallComment).toBe('My unsaved feedback')
  await act(async () => view.result.current.save())
  expect(requests[0]).toMatchObject({
    expectedRevision: 1,
    value: { overallComment: 'My unsaved feedback' },
  })
  expect(view.result.current.error).toContain('当前修改仍保留')
  expect(view.result.current.result?.overallComment).toBe('My unsaved feedback')
  expect(view.result.current.saved).toBe(false)
  view.unmount()
  pilot.dispose()
})
