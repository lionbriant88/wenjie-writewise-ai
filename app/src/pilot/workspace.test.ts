import { expect, it, vi } from 'vitest'
import type { TaskDraftInput, TaskDto } from '../../../shared/pilotContracts'
import { createPilotClient } from './client'
import { CloudWorkspace } from './workspace'
const draft: TaskDraftInput = {
  taskName: 'Synthetic',
  fullScore: 15,
  writingRequirement: 'Write a note.',
  dimensions: [],
  source: 'teacher',
  materialContext: null,
  materialProcessingStatus: 'none',
  materialRefs: [],
}
const row = (value = draft): TaskDto => ({
  id: 'task-1',
  revision: 1,
  rubricRevision: 0,
  state: 'draft',
  draft: value,
  confirmedPackage: null,
  counts: { total: 0, completed: 0, exceptions: 0 },
  createdAt: '2026-09-28T00:00:00Z',
  updatedAt: '2026-09-28T00:00:00Z',
})
function setup(fetchImpl: typeof fetch) {
  const client = createPilotClient({
    getCsrfToken: () => 'synthetic',
    onSessionExpired: () => {},
    fetchImpl,
  })
  return new CloudWorkspace(client)
}
it('deduplicates draft double-clicks and reuses the original command after a lost response', async () => {
  let calls = 0
  const commands: string[] = []
  const workspace = setup(async (_url, options) => {
    calls++
    commands.push(JSON.parse(options?.body as string).commandId)
    if (calls === 1) throw Error('lost')
    return Response.json(row())
  })
  await expect(
    Promise.all([
      workspace.saveDraft('editor', draft),
      workspace.saveDraft('editor', draft),
    ]),
  ).rejects.toThrow()
  expect(calls).toBe(1)
  await workspace.saveDraft('editor', draft)
  expect(commands[0]).toBe(commands[1])
  workspace.dispose()
})
it('clears private state and rejects a late list response on account switch', async () => {
  let finish!: (r: Response) => void
  const workspace = setup(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    ),
    listener = vi.fn()
  workspace.subscribe(listener)
  const load = workspace.refresh()
  workspace.dispose()
  finish(Response.json({ items: [row()], nextCursor: null }))
  await expect(load).rejects.toMatchObject({ name: 'AbortError' })
  expect(workspace.tasks).toEqual([])
})
it('empty account contains no example tasks', async () => {
  const workspace = setup(async () =>
    Response.json({ items: [], nextCursor: null }),
  )
  await workspace.refresh()
  expect(workspace.tasks).toEqual([])
  expect(workspace.essays).toEqual([])
  workspace.dispose()
})
it('retains successful page registration when another upload fails and restores verified uploads on reload', async () => {
  let number = 0,
    failed = false
  const puts: string[] = [],
    completed: string[] = [],
    tickets: string[] = []
  const workspace = setup(async (url, options) => {
    const path = String(url)
    if (path.endsWith('/uploads') && options?.method === 'POST') {
      const uploadId = 'u' + ++number
      tickets.push(uploadId)
      return Response.json({
        uploadId,
        url:
          'https://synthetic.supabase.co/storage/v1/object/upload/sign/' +
          uploadId,
        expiresAt: 'later',
      })
    }
    if (options?.method === 'PUT') {
      puts.push(path)
      if (path.endsWith('/u2') && !failed) {
        failed = true
        throw Error('page failed')
      }
      return Response.json({})
    }
    if (path.endsWith('/complete')) {
      completed.push(path)
      return Response.json({})
    }
    if (path.includes('/uploads?'))
      return Response.json({
        items: [
          {
            id: 'u1',
            state: 'verified',
            purpose: 'essay',
            label: 'a.png',
            mimeType: 'image/png',
            size: 1,
          },
        ],
        nextCursor: null,
      })
    throw Error('unexpected request')
  })
  const a = {
      id: 'a',
      label: 'a.png',
      pageNumber: 1,
      quality: 'clear' as const,
      accent: '#000',
      sourceFile: new File(['a'], 'a.png', { type: 'image/png' }),
    },
    b = { ...a, id: 'b' }
  expect(await workspace.uploadPage('task', a, 'essay')).toBe('u1')
  await expect(workspace.uploadPage('task', b, 'essay')).rejects.toThrow()
  expect(await workspace.uploadPage('task', a, 'essay')).toBe('u1')
  expect(await workspace.uploadPage('task', b, 'essay')).toBe('u2')
  expect(tickets).toHaveLength(2)
  expect(puts).toHaveLength(3)
  expect(completed).toHaveLength(2)
  expect((await workspace.unattachedUploads('task'))[0].id).toBe('u1')
  workspace.dispose()
})
it('reuses an acknowledged command if the following screen refresh fails', async () => {
  const workspace = setup(async () => Response.json({})),
    ids: string[] = []
  const apply = async (command: { commandId: string }) => {
    ids.push(command.commandId)
    return { accepted: 1 }
  }
  await workspace.command('attach:submission', { groups: [] }, undefined, apply)
  await workspace.command('attach:submission', { groups: [] }, undefined, apply)
  expect(ids[1]).toBe(ids[0])
  workspace.dispose()
})
