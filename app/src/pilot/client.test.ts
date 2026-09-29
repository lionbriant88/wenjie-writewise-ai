import { expect, it, vi } from 'vitest'
import { createPilotClient, PilotApiError } from './client'
const localFileUrl = () =>
  window.location.origin +
  '/api/pilot/files/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002?expires=2000000000&signature=' +
  'a'.repeat(64)
it('same-origin PUT carries session and CSRF, GET carries session without CSRF', async () => {
  const calls: { url: string; options: RequestInit | undefined }[] = []
  const client = createPilotClient({
    getCsrfToken: () => 'csrf-secret',
    onSessionExpired: () => {},
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options })
      return String(url).endsWith('/read-url')
        ? Response.json({ url: localFileUrl() })
        : options?.method === 'PUT'
          ? new Response(null, { status: 409 })
          : new Response('image', { headers: { 'Content-Type': 'image/png' } })
    },
  })
  await client.putUpload(
    localFileUrl(),
    new File(['a'], 'a.png', { type: 'image/png' }),
  )
  expect(calls[0].options).toMatchObject({
    method: 'PUT',
    credentials: 'same-origin',
    redirect: 'error',
    headers: { 'X-CSRF-Token': 'csrf-secret', 'Content-Type': 'image/png' },
  })
  expect(await client.readImage('id', 'a.png')).toMatchObject({
    name: 'a.png',
    type: 'image/png',
    size: 5,
  })
  expect(calls[2].options).toMatchObject({
    credentials: 'same-origin',
    redirect: 'error',
  })
  expect(JSON.stringify(calls[2].options)).not.toContain('csrf-secret')
})
it.each([
  'https://evil.supabase.co/storage/v1/object/upload/sign/pilot-originals/a',
  'https://wudbhdyqgnbnuorebhnu.supabase.co.evil.test/storage/v1/object/upload/sign/pilot-originals/a',
  'https://u:p@wudbhdyqgnbnuorebhnu.supabase.co/storage/v1/object/upload/sign/pilot-originals/a',
  'http://wudbhdyqgnbnuorebhnu.supabase.co/storage/v1/object/upload/sign/pilot-originals/a',
  'https://wudbhdyqgnbnuorebhnu.supabase.co:444/storage/v1/object/upload/sign/pilot-originals/a',
])('rejects untrusted upload URL %s before making a request', async (url) => {
  const fetchImpl = vi.fn<typeof fetch>()
  const client = createPilotClient({
    getCsrfToken: () => 'secret',
    onSessionExpired: () => {},
    fetchImpl,
  })
  await expect(client.putUpload(url, new File(['a'], 'a.png'))).rejects.toThrow(
    '上传地址无效',
  )
  expect(fetchImpl).not.toHaveBeenCalled()
})
it('rejects lookalike same-origin routes and read URLs before fetching image bytes', async () => {
  for (const url of [
    localFileUrl().replace('/files/', '/files-other/'),
    localFileUrl() + '&signature=b',
    localFileUrl() + '#fragment',
    localFileUrl().replace('/api/pilot/', '/wrong/../api/pilot/'),
    localFileUrl().replace('/files/', '/files/%2e%2e/files/'),
  ]) {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ url }))
    const client = createPilotClient({
      getCsrfToken: () => '',
      onSessionExpired: () => {},
      fetchImpl,
    })
    await expect(
      client.putUpload(url, new File(['a'], 'a.png')),
    ).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
    await expect(client.readImage('id', 'a.png')).rejects.toThrow(
      '原图地址无效',
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  }
})
it('keeps legacy Supabase reads credential-free and expires denied same-origin file sessions', async () => {
  const expired = vi.fn(),
    calls: RequestInit[] = []
  const legacy =
    'https://wudbhdyqgnbnuorebhnu.supabase.co/storage/v1/object/sign/pilot-originals/a?token=synthetic'
  let target = legacy
  const client = createPilotClient({
    getCsrfToken: () => 'private-csrf',
    onSessionExpired: expired,
    fetchImpl: async (url, options) => {
      calls.push(options ?? {})
      return String(url).endsWith('/read-url')
        ? Response.json({ url: target })
        : target === legacy
          ? new Response('a', { headers: { 'Content-Type': 'image/png' } })
          : new Response(null, { status: 401 })
    },
  })
  expect((await client.readImage('id', 'a.png')).size).toBe(1)
  expect(calls[1]).toMatchObject({ credentials: 'omit', redirect: 'error' })
  expect(JSON.stringify(calls[1])).not.toContain('private-csrf')
  target = localFileUrl()
  await expect(client.readImage('id', 'a.png')).rejects.toThrow()
  await expect(
    client.putUpload(target, new File(['a'], 'a.png')),
  ).rejects.toThrow()
  expect(expired).toHaveBeenCalledTimes(2)
})
it.each([
  {
    statusCode: '409',
    error: 'Duplicate',
    message: 'The resource already exists',
  },
  {
    statusCode: '409',
    code: 'ResourceAlreadyExists',
    error: 'ResourceAlreadyExists',
  },
])(
  'allows a recognized Supabase HTTP 400 duplicate to reach server completion validation',
  async (body) => {
    const client = createPilotClient({
      getCsrfToken: () => '',
      onSessionExpired: () => {},
      fetchImpl: async () => Response.json(body, { status: 400 }),
    })
    await expect(
      client.putUpload(
        'https://wudbhdyqgnbnuorebhnu.supabase.co/storage/v1/object/upload/sign/pilot-originals/a',
        new File(['a'], 'a.png', { type: 'image/png' }),
      ),
    ).resolves.toBeUndefined()
  },
)
it.each([
  { statusCode: '400', error: 'InvalidJWT' },
  { statusCode: '409', error: 'UnrelatedFailure' },
])('rejects other Supabase HTTP 400 failures', async (body) => {
  const client = createPilotClient({
    getCsrfToken: () => '',
    onSessionExpired: () => {},
    fetchImpl: async () => Response.json(body, { status: 400 }),
  })
  await expect(
    client.putUpload(
      'https://wudbhdyqgnbnuorebhnu.supabase.co/storage/v1/object/upload/sign/pilot-originals/a',
      new File(['a'], 'a.png', { type: 'image/png' }),
    ),
  ).rejects.toThrow('图片上传失败')
})
it('sends CSRF only to owned API and expires an invalid session', async () => {
  const expired = vi.fn(),
    fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
  const client = createPilotClient({
    getCsrfToken: () => 'synthetic',
    onSessionExpired: expired,
    fetchImpl,
  })
  const controller = new AbortController()
  await client.createDraft(
    { commandId: 'synthetic-command', value: {} as never },
    controller.signal,
  )
  expect(fetchImpl.mock.calls[0][0]).toBe('/api/pilot/tasks')
  expect(fetchImpl.mock.calls[0][1]).toMatchObject({
    credentials: 'same-origin',
    signal: controller.signal,
    headers: { 'X-CSRF-Token': 'synthetic' },
  })
  await expect(client.listTasks({}, controller.signal)).rejects.toBeInstanceOf(
    PilotApiError,
  )
  expect(expired).toHaveBeenCalledOnce()
})
it('signed upload never carries session credentials and checks abort after late response', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}')),
    controller = new AbortController()
  const client = createPilotClient({
    getCsrfToken: () => 'synthetic',
    onSessionExpired: () => {},
    fetchImpl,
  })
  await client.putUpload(
    'https://wudbhdyqgnbnuorebhnu.supabase.co/storage/v1/object/upload/sign/pilot-originals/a',
    new File(['a'], 'a.png', { type: 'image/png' }),
    controller.signal,
  )
  expect(fetchImpl.mock.calls[0][1]).toMatchObject({
    credentials: 'omit',
    method: 'PUT',
  })
  expect(JSON.stringify(fetchImpl.mock.calls[0][1])).not.toContain('synthetic')
  controller.abort()
  await expect(client.listTasks({}, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  })
})
