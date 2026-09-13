import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountApp } from './AccountApp'

const teacher = {
  id: 'teacher-1',
  username: 'wj_teacher',
  displayName: '王老师',
  role: 'teacher' as const,
  status: 'active' as const,
  lastLoginAt: '2026-09-13T01:00:00.000Z',
}

const admin = {
  id: 'admin-1',
  username: 'wj_admin',
  displayName: '账号管理员',
  role: 'admin' as const,
  status: 'active' as const,
  lastLoginAt: '2026-09-13T02:00:00.000Z',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

class TestBroadcastChannel {
  static instances: TestBroadcastChannel[] = []
  readonly name: string
  onmessage: ((event: MessageEvent) => void) | null = null
  close = vi.fn()
  postMessage = vi.fn()

  constructor(name: string) {
    this.name = name
    TestBroadcastChannel.instances.push(this)
  }

  emit(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data }))
  }
}

describe('AccountApp', () => {
  beforeEach(() => {
    TestBroadcastChannel.instances = []
    vi.stubGlobal('BroadcastChannel', TestBroadcastChannel)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps private account content behind the login gate and leaves the password blank', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'unauthorized', message: '未登录' } }, 401)))

    render(<AccountApp />)

    expect(await screen.findByRole('button', { name: '登录' })).toBeEnabled()
    expect(screen.getByLabelText('密码')).toHaveValue('')
    expect(screen.queryByText('账号已就绪')).not.toBeInTheDocument()
    expect(screen.queryByText('账号管理')).not.toBeInTheDocument()
    expect(screen.queryByText(/注册|找回密码|修改密码|重置密码/)).not.toBeInTheDocument()
  })

  it('shows the signed-in teacher and never requests the admin account list', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'unauthorized', message: '未登录' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ user: teacher, csrfToken: 'csrf-teacher' }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<AccountApp />)
    await user.type(await screen.findByLabelText('账号'), teacher.username)
    await user.type(screen.getByLabelText('密码'), 'synthetic-password')
    await user.click(screen.getByRole('button', { name: '登录' }))

    expect(await screen.findByText('账号已就绪')).toBeVisible()
    expect(screen.getByText('王老师')).toBeVisible()
    expect(screen.queryByText('账号管理')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/admin/accounts')).toBe(false)
    expect(screen.queryByDisplayValue('synthetic-password')).not.toBeInTheDocument()
  })

  it('lists, searches, edits, and disables accounts with the CSRF header', async () => {
    let currentTeacher = teacher
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/session') return jsonResponse({ user: admin, csrfToken: 'csrf-admin' })
      if (url === '/api/admin/accounts' && !init?.method) return jsonResponse({ accounts: [admin, teacher] })
      if (url === '/api/admin/accounts/teacher-1') {
        const update = JSON.parse(String(init?.body)) as Partial<typeof teacher>
        currentTeacher = { ...currentTeacher, ...update }
        return jsonResponse({ account: currentTeacher })
      }
      throw new Error(`Unexpected request ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<AccountApp />)
    expect(await screen.findByText('账号管理')).toBeVisible()
    await user.type(screen.getByLabelText('搜索账号'), 'wj_teacher')
    expect(screen.queryByText('wj_admin')).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('显示名称'))
    await user.type(screen.getByLabelText('显示名称'), '高一英语组')
    await user.click(screen.getByRole('button', { name: '保存备注' }))
    await user.click(screen.getByRole('button', { name: '停用账号' }))

    await waitFor(() => expect(screen.getByText('已停用')).toBeVisible())
    const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')
    expect(patchCalls).toHaveLength(2)
    expect(patchCalls[0]?.[1]?.headers).toEqual(expect.objectContaining({ 'X-CSRF-Token': 'csrf-admin' }))
    expect(JSON.parse(String(patchCalls[0]?.[1]?.body))).toEqual({ displayName: '高一英语组' })
    expect(JSON.parse(String(patchCalls[1]?.[1]?.body))).toEqual({ status: 'disabled' })
  })

  it('keeps the account row unchanged and shows feedback when an admin update fails', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/session') return jsonResponse({ user: admin, csrfToken: 'csrf-admin' })
      if (url === '/api/admin/accounts' && !init?.method) return jsonResponse({ accounts: [teacher] })
      return jsonResponse({ error: { code: 'last_admin', message: '暂时无法完成此操作' } }, 409)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<AccountApp />)
    await user.click(await screen.findByRole('button', { name: '停用账号' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法完成此操作')
    expect(screen.getByText('使用中')).toBeVisible()
  })

  it('clears private content when a focus session check expires', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ user: teacher, csrfToken: 'csrf-teacher' }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'unauthorized', message: '登录已失效' } }, 401))
    vi.stubGlobal('fetch', fetchMock)

    render(<AccountApp />)
    expect(await screen.findByText('账号已就绪')).toBeVisible()
    await act(async () => window.dispatchEvent(new Event('focus')))

    expect(await screen.findByRole('button', { name: '登录' })).toBeVisible()
    expect(screen.queryByText('王老师')).not.toBeInTheDocument()
  })

  it('ignores an older session response that arrives after a newer focus check', async () => {
    const oldRequest = deferred<Response>()
    const fetchMock = vi.fn()
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce(jsonResponse({ user: teacher, csrfToken: 'csrf-new' }))
    vi.stubGlobal('fetch', fetchMock)

    render(<AccountApp />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(await screen.findByText('王老师')).toBeVisible()
    oldRequest.resolve(jsonResponse({ user: admin, csrfToken: 'csrf-old' }))
    await act(async () => undefined)

    expect(screen.getByText('王老师')).toBeVisible()
    expect(screen.queryByText('账号管理员')).not.toBeInTheDocument()
  })

  it('ignores a pending login response after another tab broadcasts logout', async () => {
    const loginRequest = deferred<Response>()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'unauthorized', message: '未登录' } }, 401))
      .mockReturnValueOnce(loginRequest.promise)
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<AccountApp />)
    await user.type(await screen.findByLabelText('账号'), teacher.username)
    await user.type(screen.getByLabelText('密码'), 'synthetic-password')
    await user.click(screen.getByRole('button', { name: '登录' }))
    act(() => TestBroadcastChannel.instances[0]?.emit({ type: 'logout' }))
    loginRequest.resolve(jsonResponse({ user: teacher, csrfToken: 'stale-token' }))
    await act(async () => undefined)

    expect(screen.getByRole('button', { name: '登录' })).toBeVisible()
    expect(screen.queryByText('账号已就绪')).not.toBeInTheDocument()
  })

  it('shows a closed unavailable state and retries the session check', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'unauthorized', message: '未登录' } }, 401))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<AccountApp />)
    expect(await screen.findByText('账号服务暂不可用')).toBeVisible()
    expect(screen.queryByText('账号已就绪')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新尝试' }))

    expect(await screen.findByRole('button', { name: '登录' })).toBeVisible()
  })

  it('does not revalidate or restore private content while logout revocation is unresolved', async () => {
    const logoutRequest = deferred<Response>()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ user: teacher, csrfToken: 'csrf-teacher' }))
      .mockReturnValueOnce(logoutRequest.promise)
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<AccountApp />)
    await user.click(await screen.findByRole('button', { name: '退出登录' }))
    expect(screen.getByText('正在安全退出…')).toBeVisible()
    expect(screen.queryByText('王老师')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument()

    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(fetchMock).toHaveBeenCalledTimes(2)

    logoutRequest.resolve(new Response(null, { status: 204 }))
    expect(await screen.findByRole('button', { name: '登录' })).toBeVisible()
  })

  it('keeps login closed after an ambiguous logout failure and retries the same revocation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ user: teacher, csrfToken: 'csrf-teacher' }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'server_error', message: '失败' } }, 500))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<AccountApp />)
    await user.click(await screen.findByRole('button', { name: '退出登录' }))

    expect(await screen.findByText('无法确认已安全退出')).toBeVisible()
    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新退出' }))

    expect(await screen.findByRole('button', { name: '登录' })).toBeVisible()
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual({ 'X-CSRF-Token': 'csrf-teacher' })
    expect(fetchMock.mock.calls[2]?.[1]?.headers).toEqual({ 'X-CSRF-Token': 'csrf-teacher' })
  })

  it('uses a non-sensitive storage event to receive logout when BroadcastChannel is unavailable', async () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ user: teacher, csrfToken: 'csrf-teacher' }))
    vi.stubGlobal('fetch', fetchMock)

    const { unmount } = render(<AccountApp />)
    expect(await screen.findByText('账号已就绪')).toBeVisible()
    act(() => window.dispatchEvent(new StorageEvent('storage', {
      key: 'writewise-auth-event',
      newValue: JSON.stringify({ type: 'logout', nonce: 'other-tab' }),
    })))

    expect(await screen.findByRole('button', { name: '登录' })).toBeVisible()
    expect(screen.queryByText('王老师')).not.toBeInTheDocument()
    unmount()
    act(() => window.dispatchEvent(new StorageEvent('storage', {
      key: 'writewise-auth-event',
      newValue: JSON.stringify({ type: 'logout', nonce: 'after-unmount' }),
    })))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('closes the cross-tab channel on unmount', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'unauthorized', message: '未登录' } }, 401)))
    const { unmount } = render(<AccountApp />)
    expect(await screen.findByRole('button', { name: '登录' })).toBeVisible()

    const authChannel = TestBroadcastChannel.instances[0]
    unmount()

    expect(authChannel?.close).toHaveBeenCalledOnce()
  })
})
