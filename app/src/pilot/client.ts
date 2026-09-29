import type {
  Command,
  TaskDraftInput,
  TaskDto,
  EssayDto,
  UploadInput,
  UploadTicket,
  UploadDto,
  Page,
  ListQuery,
  JobDto,
  TeacherReviewInput,
  PilotCapabilities,
} from '../../../shared/pilotContracts'
export class PilotApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}
function fileTarget(value: string, method: 'GET' | 'PUT') {
  const invalid = () => {
    throw Error(method === 'PUT' ? '上传地址无效。' : '原图地址无效。')
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return invalid()
  }
  const rawPath = /^https?:\/\/[^/]+(\/[^?#]*)/.exec(value)?.[1]
  if (
    url.username ||
    url.password ||
    url.hash ||
    rawPath !== url.pathname ||
    /[%\\]/.test(url.pathname)
  )
    return invalid()
  const sameOrigin = url.origin === window.location.origin
  if (sameOrigin) {
    const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    if (
      !(
        url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(url.hostname))
      ) ||
      !new RegExp(`^/api/pilot/files/${uuid}/${uuid}$`).test(url.pathname) ||
      [...url.searchParams.keys()].sort().join(',') !== 'expires,signature' ||
      !/^[1-9][0-9]*$/.test(url.searchParams.get('expires') ?? '') ||
      !/^[a-f0-9]{64}$/.test(url.searchParams.get('signature') ?? '')
    )
      return invalid()
  } else {
    const prefix =
      method === 'PUT'
        ? '/storage/v1/object/upload/sign/pilot-originals/'
        : '/storage/v1/object/sign/pilot-originals/'
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'wudbhdyqgnbnuorebhnu.supabase.co' ||
      url.port ||
      !url.pathname.startsWith(prefix) ||
      !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(
        url.pathname.slice(prefix.length),
      )
    )
      return invalid()
  }
  return { url: url.href, sameOrigin }
}
export function createPilotClient({
  getCsrfToken,
  onSessionExpired,
  fetchImpl = fetch,
}: {
  getCsrfToken: () => string | null
  onSessionExpired: () => void
  fetchImpl?: typeof fetch
}) {
  async function request<T>(
    path: string,
    method: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted()
    const response = await fetchImpl('/api/pilot' + path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(method === 'GET' ? {} : { 'X-CSRF-Token': getCsrfToken() ?? '' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    signal?.throwIfAborted()
    const value = await response.json().catch(() => null)
    signal?.throwIfAborted()
    if (!response.ok) {
      if (response.status === 401) onSessionExpired()
      throw new PilotApiError(
        response.status,
        value?.error?.code ?? 'service_unavailable',
        value?.error?.message ?? '暂时无法保存，请重试。',
      )
    }
    if (value === null)
      throw new PilotApiError(
        503,
        'invalid_response',
        '服务响应无法读取，请重试。',
      )
    return value as T
  }
  const routeId = (id: string) => encodeURIComponent(id)
  const query = (q: ListQuery) =>
    '?' +
    new URLSearchParams({
      ...(q.cursor ? { cursor: q.cursor } : {}),
      limit: String(q.limit ?? 50),
    })
  return {
    capabilities: (signal?: AbortSignal) =>
      request<PilotCapabilities>('/capabilities', 'GET', undefined, signal),
    listTasks: (q: ListQuery = {}, signal?: AbortSignal) =>
      request<Page<TaskDto>>('/tasks' + query(q), 'GET', undefined, signal),
    getTask: (id: string, signal?: AbortSignal) =>
      request<TaskDto>('/tasks/' + routeId(id), 'GET', undefined, signal),
    createDraft: (command: Command<TaskDraftInput>, signal?: AbortSignal) =>
      request<TaskDto>('/tasks', 'POST', command, signal),
    saveDraft: (
      id: string,
      command: Command<TaskDraftInput>,
      signal?: AbortSignal,
    ) => request<TaskDto>('/tasks/' + routeId(id), 'PATCH', command, signal),
    confirmTask: (
      id: string,
      command: Command<Record<string, never>>,
      signal?: AbortSignal,
    ) =>
      request<TaskDto>(
        `/tasks/${routeId(id)}/confirm`,
        'POST',
        command,
        signal,
      ),
    deleteTask: (
      id: string,
      command: Command<Record<string, never>>,
      signal?: AbortSignal,
    ) =>
      request<{ deleted: true }>(
        `/tasks/${routeId(id)}`,
        'DELETE',
        command,
        signal,
      ),
    reserveUpload: (
      id: string,
      command: Command<UploadInput>,
      signal?: AbortSignal,
    ) =>
      request<UploadTicket>(
        `/tasks/${routeId(id)}/uploads`,
        'POST',
        command,
        signal,
      ),
    listUploads: (id: string, q: ListQuery = {}, signal?: AbortSignal) =>
      request<Page<UploadDto>>(
        `/tasks/${routeId(id)}/uploads` + query(q),
        'GET',
        undefined,
        signal,
      ),
    completeUpload: (
      id: string,
      command: Command<Record<string, never>>,
      signal?: AbortSignal,
    ) =>
      request<UploadDto>(
        `/uploads/${routeId(id)}/complete`,
        'POST',
        command,
        signal,
      ),
    readUrl: (id: string, signal?: AbortSignal) =>
      request<{ url: string; expiresAt: string }>(
        `/uploads/${routeId(id)}/read-url`,
        'GET',
        undefined,
        signal,
      ),
    async putUpload(url: string, file: File, signal?: AbortSignal) {
      const target = fileTarget(url, 'PUT')
      signal?.throwIfAborted()
      const res = await fetchImpl(target.url, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type,
          ...(target.sameOrigin
            ? { 'X-CSRF-Token': getCsrfToken() ?? '' }
            : { 'x-upsert': 'false' }),
        },
        credentials: target.sameOrigin ? 'same-origin' : 'omit',
        redirect: 'error',
        signal,
      })
      signal?.throwIfAborted()
      if (target.sameOrigin && res.status === 401) onSessionExpired()
      // An existing immutable object can mean the first upload response was lost. Completion verifies actual bytes.
      const error =
        res.status === 400 ? await res.json().catch(() => null) : null
      signal?.throwIfAborted()
      const duplicate =
        res.status === 409 ||
        (res.status === 400 &&
          String(error?.statusCode) === '409' &&
          ['Duplicate', 'ResourceAlreadyExists'].includes(
            error?.code ?? error?.error,
          ))
      if (!res.ok && !duplicate) throw new Error('图片上传失败，请重试。')
    },
    async readImage(
      id: string,
      label: string,
      signal?: AbortSignal,
    ): Promise<File> {
      const signed = await request<{ url: string }>(
        `/uploads/${routeId(id)}/read-url`,
        'GET',
        undefined,
        signal,
      )
      const target = fileTarget(signed.url, 'GET')
      const response = await fetchImpl(target.url, {
        credentials: target.sameOrigin ? 'same-origin' : 'omit',
        redirect: 'error',
        signal,
      })
      if (target.sameOrigin && response.status === 401) onSessionExpired()
      const type = response.headers.get('content-type')?.split(';')[0]
      if (
        !response.ok ||
        !type ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(type) ||
        !response.body
      )
        throw Error('材料图片无法读取。')
      const reader = response.body.getReader(),
        chunks: Uint8Array<ArrayBuffer>[] = []
      let size = 0
      try {
        while (true) {
          signal?.throwIfAborted()
          const part = await reader.read()
          if (part.done) break
          size += part.value.byteLength
          if (size > 8 * 1024 * 1024) throw Error('材料图片超过上限。')
          chunks.push(new Uint8Array(part.value))
        }
      } finally {
        await reader.cancel().catch(() => undefined)
      }
      signal?.throwIfAborted()
      return new File(chunks, label, { type, lastModified: 0 })
    },
    attachEssays: (
      id: string,
      command: Command<{
        groups: { studentName: string; uploadIds: string[] }[]
      }>,
      signal?: AbortSignal,
    ) =>
      request<Page<EssayDto>>(
        `/tasks/${routeId(id)}/essays`,
        'POST',
        command,
        signal,
      ),
    listEssays: (id: string, q: ListQuery = {}, signal?: AbortSignal) =>
      request<Page<EssayDto>>(
        `/tasks/${routeId(id)}/essays` + query(q),
        'GET',
        undefined,
        signal,
      ),
    getEssay: (id: string, signal?: AbortSignal) =>
      request<EssayDto>(`/essays/${routeId(id)}`, 'GET', undefined, signal),
    saveTranscript: (
      id: string,
      command: Command<{ text: string }>,
      signal?: AbortSignal,
    ) =>
      request<EssayDto>(
        `/essays/${routeId(id)}/transcript`,
        'PATCH',
        command,
        signal,
      ),
    saveReview: (
      id: string,
      command: Command<TeacherReviewInput>,
      signal?: AbortSignal,
    ) =>
      request<EssayDto>(
        `/essays/${routeId(id)}/review`,
        'PUT',
        command,
        signal,
      ),
    markManual: (
      id: string,
      command: Command<{ manualReviewRequired: true }>,
      signal?: AbortSignal,
    ) =>
      request<EssayDto>(
        `/essays/${routeId(id)}/manual`,
        'PUT',
        command,
        signal,
      ),
    enqueueTask: (
      id: string,
      command: Command<Record<string, never>>,
      signal?: AbortSignal,
    ) =>
      request<{ accepted: number }>(
        `/tasks/${routeId(id)}/grade`,
        'POST',
        command,
        signal,
      ),
    listAssistance: (id: string, signal?: AbortSignal) =>
      request<JobDto[]>(
        `/tasks/${routeId(id)}/assist`,
        'GET',
        undefined,
        signal,
      ),
    enqueueMaterial: (
      id: string,
      command: Command<{ kind: 'rubric' | 'material_context' }>,
      signal?: AbortSignal,
    ) =>
      request<JobDto>(`/tasks/${routeId(id)}/assist`, 'POST', command, signal),
    getJob: (id: string, signal?: AbortSignal) =>
      request<JobDto>(`/jobs/${routeId(id)}`, 'GET', undefined, signal),
    retryKnown: (
      id: string,
      command: Command<Record<string, never>>,
      signal?: AbortSignal,
    ) => request<JobDto>(`/jobs/${routeId(id)}/retry`, 'POST', command, signal),
  }
}
export type PilotClient = ReturnType<typeof createPilotClient>
