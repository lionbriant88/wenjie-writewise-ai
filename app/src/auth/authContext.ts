import { createContext } from 'react'
import type { PublicUser } from './types'

export type AuthStatus = 'checking' | 'anonymous' | 'authenticated' | 'unavailable' | 'logout-pending' | 'logout-failed'

export interface AuthContextValue {
  status: AuthStatus
  user: PublicUser | null
  csrfToken: string | null
  message: string | null
  login: (username: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  retry: () => void
  retryLogout: () => void
  expire: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
