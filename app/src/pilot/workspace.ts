import type {
  Command,
  TaskDraftInput,
  TaskDto,
  EssayDto,
  Page,
  UploadDto,
  UploadTicket,
  UploadInput,
} from '../../../shared/pilotContracts'
import type { EssayPage } from '../types'
import { PilotApiError, type PilotClient } from './client'
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  )
}
export class CloudWorkspace {
  readonly controller = new AbortController()
  tasks: TaskDto[] = []
  essays: EssayDto[] = []
  private listeners = new Set<() => void>()
  private commands = new Map<string, string>()
  private inflight = new Map<string, Promise<unknown>>()
  private editors = new Map<string, TaskDto>()
  private editorTails = new Map<string, Promise<unknown>>()
  private uploads = new Map<string, { ticket?: UploadTicket; done?: string }>()
  private loadSequence = 0
  private refreshPromise: Promise<void> | undefined
  readonly client: PilotClient
  constructor(client: PilotClient) {
    this.client = client
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private check() {
    this.controller.signal.throwIfAborted()
  }
  private emit() {
    this.check()
    this.listeners.forEach((fn) => fn())
  }
  dispose() {
    this.controller.abort()
    this.tasks = []
    this.essays = []
    this.commands.clear()
    this.inflight.clear()
    this.editors.clear()
    this.uploads.clear()
    this.listeners.clear()
  }
  async all<T>(load: (cursor?: string) => Promise<Page<T>>): Promise<T[]> {
    const items: T[] = [],
      seen = new Set<string>()
    let cursor: string | undefined
    do {
      this.check()
      const page = await load(cursor)
      this.check()
      items.push(...page.items)
      cursor = page.nextCursor ?? undefined
      if (cursor) {
        if (seen.has(cursor)) throw Error('分页响应无效。')
        seen.add(cursor)
      }
    } while (cursor)
    return items
  }
  refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise
    const pending = this.readSnapshot()
    this.refreshPromise = pending
    void pending
      .finally(() => {
        if (this.refreshPromise === pending) this.refreshPromise = undefined
      })
      .catch(() => undefined)
    return pending
  }
  private async readSnapshot() {
    const sequence = ++this.loadSequence,
      signal = this.controller.signal
    const tasks = await this.all((cursor) =>
        this.client.listTasks({ cursor }, signal),
      ),
      essays: EssayDto[] = []
    for (const task of tasks)
      if (task.state === 'confirmed')
        essays.push(
          ...(await this.all((cursor) =>
            this.client.listEssays(task.id, { cursor }, signal),
          )),
        )
    this.check()
    if (sequence !== this.loadSequence) return
    this.tasks = tasks
    this.essays = essays
    this.emit()
  }
  async command<T, V>(
    key: string,
    value: V,
    revision: number | undefined,
    apply: (command: Command<V>) => Promise<T>,
  ): Promise<T> {
    this.check()
    const identity = JSON.stringify([key, revision, value]),
      existing = this.inflight.get(identity)
    if (existing) return existing as Promise<T>
    const commandId = this.commands.get(identity) ?? crypto.randomUUID()
    this.commands.set(identity, commandId)
    const operation = (async () => {
      try {
        const result = await apply({
          commandId,
          ...(revision === undefined ? {} : { expectedRevision: revision }),
          value,
        })
        this.check()
        return result
      } catch (error) {
        if (error instanceof PilotApiError && error.status < 500)
          this.commands.delete(identity)
        throw error
      }
    })()
    this.inflight.set(identity, operation)
    try {
      return await operation
    } finally {
      this.inflight.delete(identity)
    }
  }
  getDraft(key: string) {
    return this.editors.get(key)
  }
  bindDraft(key: string, opened: TaskDto) {
    this.check()
    if (!this.editors.has(key)) this.editors.set(key, structuredClone(opened))
  }
  saveDraft(
    key: string,
    value: TaskDraftInput,
    existingId?: string,
  ): Promise<TaskDto> {
    const snapshot = structuredClone(value),
      identity = JSON.stringify(['editor', key, value]),
      running = this.inflight.get(identity)
    if (running) return running as Promise<TaskDto>
    const tail = this.editorTails.get(key) ?? Promise.resolve()
    const operation = tail
      .catch(() => undefined)
      .then(async () => {
        this.check()
        let current =
          this.editors.get(key) ?? this.tasks.find((t) => t.id === existingId)
        if (current && stableJson(current.draft) === stableJson(snapshot)) {
          this.editors.set(key, current)
          return current
        }
        current = await this.command(
          'draft:' + key,
          snapshot,
          current?.revision,
          (c) =>
            current
              ? this.client.saveDraft(current.id, c, this.controller.signal)
              : this.client.createDraft(c, this.controller.signal),
        )
        this.check()
        this.editors.set(key, current)
        this.acceptTask(current)
        return current
      })
    this.inflight.set(identity, operation)
    this.editorTails.set(key, operation)
    void operation
      .finally(() => this.inflight.delete(identity))
      .catch(() => undefined)
    return operation
  }
  acceptTask(task: TaskDto) {
    this.check()
    ++this.loadSequence
    this.tasks = [...this.tasks.filter((t) => t.id !== task.id), task]
    this.emit()
  }
  acceptEssay(essay: EssayDto) {
    this.check()
    ++this.loadSequence
    this.essays = [...this.essays.filter((e) => e.id !== essay.id), essay]
    this.emit()
  }
  forgetTask(id: string) {
    this.check()
    ++this.loadSequence
    const identities = [
      id,
      ...this.essays
        .filter((e) => e.taskId === id)
        .flatMap((e) => [
          e.id,
          ...e.pages.map((p) => p.uploadId),
          ...(e.currentJob ? [e.currentJob.id] : []),
        ]),
    ]
    for (const [key, draft] of this.editors)
      if (draft.id === id) {
        identities.push(key)
        this.editors.delete(key)
        this.editorTails.delete(key)
      }
    for (const key of this.uploads.keys())
      if (key.startsWith(id + ':')) this.uploads.delete(key)
    for (const key of this.commands.keys())
      if (identities.some((identity) => key.includes(identity)))
        this.commands.delete(key)
    this.tasks = this.tasks.filter((t) => t.id !== id)
    this.essays = this.essays.filter((e) => e.taskId !== id)
    this.emit()
  }
  async unattachedUploads(task: string): Promise<UploadDto[]> {
    const list = () => this.all((cursor) =>
      this.client.listUploads(task, { cursor }, this.controller.signal),
    )
    const uploads = await list()
    let completed = false
    for (const upload of uploads) {
      this.check()
      if (upload.purpose !== 'essay' || upload.state !== 'reserved') continue
      try {
        await this.command('complete:' + upload.id, {}, undefined, c =>
          this.client.completeUpload(upload.id, c, this.controller.signal))
        completed = true
      } catch (error) {
        this.check()
        if (error instanceof PilotApiError && [401,403].includes(error.status)) throw error
        // Missing or invalid bytes remain incomplete; never synthesize a verified page.
      }
    }
    const current = completed ? await list() : uploads
    this.check()
    return current.filter(u => u.purpose === 'essay' && u.state !== 'attached')
  }
  async uploadPage(
    task: string,
    page: EssayPage,
    purpose: UploadInput['purpose'],
  ): Promise<string> {
    this.check()
    if (page.uploadId) return page.uploadId
    const key = task + ':' + purpose + ':' + page.id,
      record = this.uploads.get(key) ?? {}
    this.uploads.set(key, record)
    if (record.done) return record.done
    if (!page.sourceFile) throw Error('原图尚未保存，请重新选择文件。')
    const file = page.sourceFile,
      value: UploadInput = {
        purpose,
        mimeType: file.type as UploadInput['mimeType'],
        size: file.size,
        label: page.label,
      }
    if (!record.ticket || Date.parse(record.ticket.expiresAt) < Date.now())
      record.ticket = await this.command(
        'upload:' + key,
        value,
        undefined,
        (c) => this.client.reserveUpload(task, c, this.controller.signal),
      )
    this.check()
    await this.client.putUpload(record.ticket.url, file, this.controller.signal)
    await this.command(
      'complete:' + record.ticket.uploadId,
      {},
      undefined,
      (c) =>
        this.client.completeUpload(
          record.ticket!.uploadId,
          c,
          this.controller.signal,
        ),
    )
    this.check()
    record.done = record.ticket.uploadId
    return record.done
  }
}
