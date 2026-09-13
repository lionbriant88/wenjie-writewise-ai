export type AccountRole = 'teacher' | 'admin'
export type AccountStatus = 'active' | 'disabled'

export interface PublicUser {
  id: string
  username: string
  displayName: string
  role: AccountRole
  status: AccountStatus
  lastLoginAt: string | null
}

export interface SessionPayload {
  user: PublicUser
  csrfToken: string
}

export interface ApiErrorPayload {
  error?: {
    code?: string
    message?: string
  }
}
