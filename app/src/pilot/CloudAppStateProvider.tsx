import { useEffect, useState, type ReactNode } from 'react'
import {
  AppStateContext,
  type AppState,
  type ClassReviewAppCommands,
} from '../context/appStateContextValue'
import { startOwnedPolling } from './polling'
import type { PilotClient } from './client'
import { CloudWorkspace } from './workspace'
import {
  draftFromInput,
  projectTask,
  projectEssay,
  projectResult,
  projectQueue,
} from './projection'
import type { PilotCapabilities } from '../../../shared/pilotContracts'
const unavailable = (): never => {
  throw Error('此功能尚未开放。')
}
const classReview: ClassReviewAppCommands = {
  getSnapshot: unavailable,
  peekSnapshot: () => null,
  generate: async () => unavailable(),
  checkGeneration: unavailable,
  applyCandidate: unavailable,
  discardCandidate: unavailable,
  beginAiTextEdit: unavailable,
  saveAiTextEdit: unavailable,
  cancelAiTextEdit: unavailable,
  addIssue: unavailable,
  promoteSpelling: unavailable,
  removeIssue: unavailable,
  undoIssueRemoval: unavailable,
  moveIssue: unavailable,
  deleteSource: unavailable,
}
export function CloudAppStateProvider({
  children,
  userId,
  client,
  capabilities,
}: {
  children: ReactNode
  userId: string
  client: PilotClient
  capabilities?: PilotCapabilities
}) {
  const [liveCapabilities, setLiveCapabilities] = useState(capabilities)
  const [workspace, setWorkspace] = useState<CloudWorkspace | null>(null)
  const [, setVersion] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('')
  useEffect(() => {
    const store = new CloudWorkspace(client)
    setWorkspace(store)
    setLoading(true)
    setError('')
    const unsubscribe = store.subscribe(() => setVersion((v) => v + 1))
    const stop = startOwnedPolling({
      signal: store.controller.signal,
      load: async () => {
        await store.refresh()
        return client.capabilities(store.controller.signal)
      },
      onSnapshot: (cap) => {
        setLiveCapabilities(cap)
        setLoading(false)
        setError('')
      },
      onExpired: () => {},
      onError: () => {
        setError('云端内容加载失败，请重试。')
        setLoading(false)
      },
    })
    return () => {
      stop()
      unsubscribe()
      store.dispose()
    }
  }, [client, userId])
  if (!workspace || loading)
    return (
      <p role="status" className="p-6">
        正在读取云端任务…
      </p>
    )
  const store = workspace,
    signal = store.controller.signal
  const refresh = async () => {
    try {
      await store.refresh()
      setError('')
    } catch (e) {
      if (!signal.aborted) setError('云端内容加载失败，请重试。')
      throw e
    }
  }
  const findEssay = (id: string) => {
    const e = store.essays.find((e) => e.id === id)
    if (!e) throw Error('作文不存在，请刷新。')
    return e
  }
  const start = async (id: string) => {
    const versions = store.essays
      .filter((e) => e.taskId === id)
      .map((e) => [e.id, e.sourceRevision])
      .sort()
    await store.command(
      'grade:' + id + JSON.stringify(versions),
      {},
      undefined,
      (c) => client.enqueueTask(id, c, signal),
    )
    await refresh()
  }
  const retry = async (id: string) => {
    const e = findEssay(id),
      j = e.currentJob
    if (!j || j.state !== 'failed' || !j.retryable)
      throw Error('该批改不能重试，请检查原结果。')
    await store.command('retry:' + j.id, {}, j.revision, (c) =>
      client.retryKnown(j.id, c, signal),
    )
    await refresh()
  }
  const check = async (id: string) => {
    const e = findEssay(id)
    if (e.currentJob) await client.getJob(e.currentJob.id, signal)
    await refresh()
  }
  const results = store.essays.flatMap((e) => {
    const r = projectResult(e)
    return r ? [r] : []
  })
  const saveReview = async (
    id: string,
    patch: Partial<import('../types').GradingResult>,
    confirm: boolean,
  ) => {
    const e = findEssay(id),
      result = projectResult(e)
    if (!result) throw Error('请先获得批改结果。')
    const next = { ...result, ...patch },
      value = {
        dimensionScores: next.dimensionScores.map((d) => ({
          dimensionId: d.id,
          score: d.score,
        })),
        overallComment: next.overallComment,
        teacherSuggestion: next.teacherSuggestion ?? '',
        confirm,
      }
    store.acceptEssay(
      await store.command('review:' + id, value, e.revision, (c) =>
        client.saveReview(id, c, signal),
      ),
    )
  }
  const value: AppState = {
    pilot: store,
    capabilities: liveCapabilities,
    loading,
    error,
    refresh,
    saveState: 'saved',
    tasks: store.tasks.map(projectTask),
    essays: store.essays.map(projectEssay),
    gradingResults: results,
    taskGradingQueues: Object.fromEntries(
      store.tasks.map((t) => [
        t.id,
        projectQueue(
          t,
          store.essays.filter((e) => e.taskId === t.id),
          liveCapabilities,
        ),
      ]),
    ),
    isGradingInFlight: store.essays.some(
      (e) => e.currentJob?.state === 'running',
    ),
    classInsights: [],
    classReviewMaterials: [],
    classReview,
    async createTask(input, key = crypto.randomUUID()) {
      const draft = draftFromInput(input)
      draft.materialRefs = store.getDraft(key)?.draft.materialRefs ?? []
      const saved = await store.saveDraft(key, draft),
        confirmed = await store.command(
          'confirm:' + saved.id,
          {},
          saved.revision,
          (c) => client.confirmTask(saved.id, c, signal),
        )
      store.acceptTask(confirmed)
      return confirmed.id
    },
    async enqueueImageEssays(input) {
      const groups = []
      const failures: string[] = []
      for (const group of input.essayGroups) {
        const uploadIds: string[] = []
        for (const page of group.pages) {
          try {
            uploadIds.push(await store.uploadPage(input.taskId, page, 'essay'))
          } catch (e) {
            if (signal.aborted) throw e
            failures.push(page.label)
          }
        }
        groups.push({ studentName: group.studentName ?? '', uploadIds })
      }
      if (failures.length)
        throw Error('以下页面未能保存，请重试：' + failures.join('、'))
      const attached = await store.command(
        'attach:' + input.submissionId,
        { groups },
        undefined,
        (c) => client.attachEssays(input.taskId, c, signal),
      )
      attached.items.forEach((e) => store.acceptEssay(e))
      await refresh()
    },
    async updateEssayOcrText(id, text) {
      const e = findEssay(id)
      store.acceptEssay(
        await store.command('transcript:' + id, { text }, e.revision, (c) =>
          client.saveTranscript(id, c, signal),
        ),
      )
    },
    async markEssayManual(id) {
      const e = findEssay(id)
      store.acceptEssay(
        await store.command(
          'manual:' + id,
          { manualReviewRequired: true as const },
          e.revision,
          (c) => client.markManual(id, c, signal),
        ),
      )
    },
    startTaskGrading: start,
    retryTaskEssay: retry,
    checkUnknownTaskEssay: check,
    resumeTaskGrading: refresh,
    gradeEssay: async (id) => start(findEssay(id).taskId),
    retryGradeEssay: retry,
    confirmGradingResult: async (id) => saveReview(id, {}, true),
    updateGradingResult: async (id, patch) => saveReview(id, patch, false),
    assignTaskClass: unavailable,
    confirmMockOcrEssay: unavailable,
    addClassReviewMaterial: unavailable,
    removeClassReviewMaterial: unavailable,
    isClassReviewMaterialAdded: () => false,
  }
  return (
    <AppStateContext.Provider value={value}>
      {error ? (
        <div role="alert" className="p-4 text-rose-700">
          {error}
          <button onClick={() => void refresh().catch(() => undefined)}>
            重新加载
          </button>
        </div>
      ) : null}
      {children}
    </AppStateContext.Provider>
  )
}
