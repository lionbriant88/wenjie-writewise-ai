import { expect, it, vi } from 'vitest'
import { createPilotClient } from './client'
import { createPilotMaterialClients } from './materialClients'
import type { JobDto, TaskDto } from '../../../shared/pilotContracts'

const context = {
  materialSummary: 'Synthetic material.',
  writingRequirements: ['Write.'],
  constraints: [],
  reviewWarnings: ['Review.'],
}
const rubric = { ...context, taskName: 'Synthetic', dimensions: [] }
const task = {
  id: 'task',
  revision: 4,
  draft: { materialContext: null },
} as TaskDto
const job = (state: JobDto['state'], result?: JobDto['result']): JobDto => ({
  id: 'job',
  kind: 'rubric',
  state,
  result,
  errorCode: null,
  retryable: false,
  revision: 1,
  retryAt: null,
  createdAt: '',
  updatedAt: '',
})
const request = {
  requestId: 'request',
  fullScore: 15,
  writingRequirement: 'Write.',
  materials: [],
}

it('resumes the saved rubric job on a fresh client and reuses its material context without another POST', async () => {
  const writes: unknown[] = []
  const client = createPilotClient({
    getCsrfToken: () => 'csrf',
    onSessionExpired: () => {},
    fetchImpl: vi.fn(async (url, opts) => {
      if (opts?.method !== 'GET') writes.push(opts?.body)
      return Response.json(
        String(url).endsWith('/assist')
          ? [job('running')]
          : job('succeeded', rubric),
      )
    }),
  })
  const taskDraft = vi.fn(async () => task)
  const first = createPilotMaterialClients({ client, taskDraft, pollMs: 0 })
  expect(await first.rubricClient.generate(request)).toEqual({
    requestId: 'request',
    status: 'success',
    rubric,
  })
  const refreshed = createPilotMaterialClients({ client, taskDraft, pollMs: 0 })
  expect(await refreshed.materialClient.analyze(request)).toEqual({
    requestId: 'request',
    status: 'success',
    materialContext: context,
  })
  expect(writes).toHaveLength(0)
})
it('enqueues only the rubric once after saving the latest draft and reports unknown as non retryable', async () => {
  const events: string[] = []
  const client = createPilotClient({
    getCsrfToken: () => 'csrf',
    onSessionExpired: () => {},
    fetchImpl: vi.fn(async (url, opts) => {
      events.push(opts?.method + ' ' + String(url))
      if (opts?.method === 'POST') {
        expect(JSON.parse(String(opts.body))).toMatchObject({
          expectedRevision: 4,
          value: { kind: 'rubric' },
        })
        return Response.json(job('result_unknown'))
      }
      return Response.json([])
    }),
  })
  const clients = createPilotMaterialClients({
    client,
    taskDraft: async () => {
      events.push('save')
      return task
    },
    pollMs: 0,
  })
  expect(await clients.rubricClient.generate(request)).toMatchObject({
    status: 'failed',
    error: { code: 'provider_result_unknown', retryable: false },
  })
  expect(events).toEqual([
    'save',
    'GET /api/pilot/tasks/task/assist',
    'POST /api/pilot/tasks/task/assist',
  ])
})
it('aborting page polling does not cancel or retry the persistent job', async () => {
  const controller = new AbortController()
  const fetchImpl = vi.fn(async () => Response.json([job('running')]))
  const client = createPilotClient({
    getCsrfToken: () => 'csrf',
    onSessionExpired: () => {},
    fetchImpl,
  })
  const clients = createPilotMaterialClients({
    client,
    taskDraft: async () => task,
    pollMs: 50,
  })
  const pending = clients.rubricClient.generate({
    ...request,
    signal: controller.signal,
  })
  await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce())
  controller.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetchImpl).toHaveBeenCalledOnce()
})
