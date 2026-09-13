import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AccountApiError, getSession, login as loginRequest, logout as logoutRequest } from './client'
import { AuthContext, type AuthContextValue, type AuthStatus } from './authContext'
import type { PublicUser } from './types'

const AUTH_CHANNEL = 'writewise-auth'
const AUTH_STORAGE_EVENT = 'writewise-auth-event'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('checking')
  const [user, setUser] = useState<PublicUser | null>(null)
  const [csrfToken, setCsrfToken] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const generation = useRef(0)
  const controllers = useRef(new Set<AbortController>())
  const channel = useRef<BroadcastChannel | null>(null)
  const logoutController = useRef<AbortController | null>(null)
  const logoutToken = useRef<string | null>(null)

  const abortPending = useCallback(() => {
    controllers.current.forEach((controller) => controller.abort())
    controllers.current.clear()
  }, [])

  const clearPrivateState = useCallback((nextMessage: string | null = null) => {
    generation.current += 1
    abortPending()
    setUser(null)
    setCsrfToken(null)
    setMessage(nextMessage)
    setStatus('anonymous')
  }, [abortPending])

  const receiveRemoteLogout = useCallback(() => {
    generation.current += 1
    abortPending()
    logoutController.current?.abort()
    logoutController.current = null
    logoutToken.current = null
    setUser(null)
    setCsrfToken(null)
    setMessage(null)
    setStatus('anonymous')
  }, [abortPending])

  const broadcastLogout = useCallback(() => {
    if (channel.current) {
      channel.current.postMessage({ type: 'logout' })
      return
    }
    try {
      const value = JSON.stringify({ type: 'logout', nonce: `${Date.now()}-${Math.random()}` })
      localStorage.setItem(AUTH_STORAGE_EVENT, value)
      localStorage.removeItem(AUTH_STORAGE_EVENT)
    } catch {
      // Cross-tab signaling is best effort; the server session is already revoked.
    }
  }, [])

  const runSessionCheck = useCallback(async () => {
    if (logoutToken.current !== null) return
    const requestGeneration = generation.current + 1
    generation.current = requestGeneration
    abortPending()
    const controller = new AbortController()
    controllers.current.add(controller)
    setStatus((current) => current === 'authenticated' ? current : 'checking')
    setMessage(null)

    try {
      const payload = await getSession(controller.signal)
      if (generation.current !== requestGeneration || controller.signal.aborted) return
      setUser(payload.user)
      setCsrfToken(payload.csrfToken)
      setStatus('authenticated')
    } catch (error) {
      if (generation.current !== requestGeneration || controller.signal.aborted) return
      setUser(null)
      setCsrfToken(null)
      if (error instanceof AccountApiError && error.status === 401) {
        setStatus('anonymous')
        setMessage(null)
      } else {
        setStatus('unavailable')
        setMessage('请检查网络连接，稍后重新尝试。')
      }
    } finally {
      controllers.current.delete(controller)
    }
  }, [abortPending])

  useEffect(() => {
    const authChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(AUTH_CHANNEL)
    channel.current = authChannel
    if (authChannel) {
      authChannel.onmessage = (event) => {
        if ((event.data as { type?: string } | null)?.type === 'logout') receiveRemoteLogout()
      }
    }
    const handleStorage = (event: StorageEvent) => {
      if (authChannel || event.key !== AUTH_STORAGE_EVENT || !event.newValue) return
      try {
        if ((JSON.parse(event.newValue) as { type?: string }).type === 'logout') receiveRemoteLogout()
      } catch {
        // Ignore unrelated or malformed local storage values.
      }
    }
    const handleFocus = () => void runSessionCheck()
    window.addEventListener('focus', handleFocus)
    window.addEventListener('storage', handleStorage)
    void runSessionCheck()
    return () => {
      generation.current += 1
      abortPending()
      logoutController.current?.abort()
      logoutController.current = null
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('storage', handleStorage)
      authChannel?.close()
      channel.current = null
    }
  }, [abortPending, receiveRemoteLogout, runSessionCheck])

  const login = useCallback(async (username: string, password: string) => {
    if (logoutToken.current !== null) return false
    const requestGeneration = generation.current + 1
    generation.current = requestGeneration
    abortPending()
    const controller = new AbortController()
    controllers.current.add(controller)
    setMessage(null)
    try {
      const payload = await loginRequest(username, password, controller.signal)
      if (generation.current !== requestGeneration || controller.signal.aborted) return false
      setUser(payload.user)
      setCsrfToken(payload.csrfToken)
      setStatus('authenticated')
      return true
    } catch (error) {
      if (generation.current !== requestGeneration || controller.signal.aborted) return false
      const text = error instanceof AccountApiError && error.status !== 503
        ? error.message
        : '账号服务暂不可用，请稍后重试'
      setMessage(text)
      setStatus(error instanceof AccountApiError && error.status < 500 ? 'anonymous' : 'unavailable')
      return false
    } finally {
      controllers.current.delete(controller)
    }
  }, [abortPending])

  const attemptLogout = useCallback(async () => {
    const token = logoutToken.current
    if (!token) {
      setStatus('anonymous')
      return
    }
    logoutController.current?.abort()
    const controller = new AbortController()
    logoutController.current = controller
    setUser(null)
    setCsrfToken(null)
    setMessage(null)
    setStatus('logout-pending')
    try {
      await logoutRequest(token, controller.signal)
      if (logoutController.current !== controller || controller.signal.aborted) return
      logoutToken.current = null
      setStatus('anonymous')
      broadcastLogout()
    } catch (error) {
      if (logoutController.current !== controller || controller.signal.aborted) return
      setMessage(error instanceof Error ? error.message : '退出失败，请重试')
      setStatus('logout-failed')
    } finally {
      if (logoutController.current === controller) logoutController.current = null
    }
  }, [broadcastLogout])

  const logout = useCallback(async () => {
    generation.current += 1
    abortPending()
    if (!csrfToken) {
      receiveRemoteLogout()
      return
    }
    logoutToken.current = csrfToken
    await attemptLogout()
  }, [abortPending, attemptLogout, csrfToken, receiveRemoteLogout])

  const value = useMemo<AuthContextValue>(() => ({
    status,
    user,
    csrfToken,
    message,
    login,
    logout,
    retry: () => void runSessionCheck(),
    retryLogout: () => void attemptLogout(),
    expire: () => clearPrivateState('登录已失效，请重新登录'),
  }), [attemptLogout, clearPrivateState, csrfToken, login, logout, message, runSessionCheck, status, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
