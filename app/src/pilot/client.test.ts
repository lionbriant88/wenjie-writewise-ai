import { expect, it, vi } from 'vitest'
import { createPilotClient, PilotApiError } from './client'
it.each([
  {statusCode:'409',error:'Duplicate',message:'The resource already exists'},
  {statusCode:'409',code:'ResourceAlreadyExists',error:'ResourceAlreadyExists'},
])('allows a recognized Supabase HTTP 400 duplicate to reach server completion validation',async(body)=>{
  const client=createPilotClient({getCsrfToken:()=>'',onSessionExpired:()=>{},fetchImpl:async()=>Response.json(body,{status:400})})
  await expect(client.putUpload('https://synthetic.supabase.co/storage/v1/object/upload/sign/pilot-originals/a',new File(['a'],'a.png',{type:'image/png'}))).resolves.toBeUndefined()
})
it.each([{statusCode:'400',error:'InvalidJWT'},{statusCode:'409',error:'UnrelatedFailure'}])('rejects other Supabase HTTP 400 failures',async(body)=>{
  const client=createPilotClient({getCsrfToken:()=>'',onSessionExpired:()=>{},fetchImpl:async()=>Response.json(body,{status:400})})
  await expect(client.putUpload('https://synthetic.supabase.co/storage/v1/object/upload/sign/pilot-originals/a',new File(['a'],'a.png',{type:'image/png'}))).rejects.toThrow('图片上传失败')
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
    'https://synthetic.supabase.co/storage/v1/object/upload/sign/pilot-originals/a',
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
