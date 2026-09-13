import type { ApiErrorPayload, PublicUser, SessionPayload } from './types'

export class AccountApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(
    message: string,
    status: number,
    code: string,
  ) {
    super(message)
    this.name = 'AccountApiError'
    this.status = status
    this.code = code
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })

  if (!response.ok) {
    let payload: ApiErrorPayload = {}
    try {
      payload = (await response.json()) as ApiErrorPayload
    } catch {
      // Keep opaque server and proxy failures out of the UI.
    }
    throw new AccountApiError(
      payload.error?.message ?? (response.status === 401 ? '登录已失效，请重新登录' : '账号服务暂不可用'),
      response.status,
      payload.error?.code ?? 'account_request_failed',
    )
  }

  return response.json() as Promise<T>
}

export function getSession(signal?: AbortSignal) {
  return requestJson<SessionPayload>('/api/auth/session', { signal })
}

export function login(username: string, password: string, signal?: AbortSignal) {
  return requestJson<SessionPayload>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
    signal,
  })
}

export async function logout(csrfToken: string, signal?: AbortSignal) {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': csrfToken },
    signal,
  })
  if (!response.ok && response.status !== 401) {
    throw new AccountApiError('退出失败，请稍后重试', response.status, 'logout_failed')
  }
}

export async function listAccounts(signal?: AbortSignal) {
  return requestJson<{ accounts: PublicUser[] }>('/api/admin/accounts', { signal })
}

export async function updateAccount(
  accountId: string,
  update: { displayName?: string; status?: 'active' | 'disabled' },
  csrfToken: string,
  signal?: AbortSignal,
) {
  return requestJson<{ account: PublicUser }>(`/api/admin/accounts/${encodeURIComponent(accountId)}`, {
    method: 'PATCH',
    headers: { 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(update),
    signal,
  })
}
