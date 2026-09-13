import { Search, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AccountApiError, listAccounts, updateAccount } from './client'
import { useAuth } from './useAuth'
import type { PublicUser } from './types'

export function AdminAccounts() {
  const { csrfToken, expire } = useAuth()
  const [accounts, setAccounts] = useState<PublicUser[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<string | null>(null)
  const mounted = useRef(true)
  const updateControllers = useRef(new Set<AbortController>())

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    const pendingUpdates = updateControllers.current
    listAccounts(controller.signal)
      .then(({ accounts: nextAccounts }) => {
        if (!controller.signal.aborted && mounted.current) setAccounts(nextAccounts)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof AccountApiError && error.status === 401) expire()
        else setFeedback(error instanceof Error ? error.message : '账号列表加载失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => {
      mounted.current = false
      controller.abort()
      pendingUpdates.forEach((pending) => pending.abort())
      pendingUpdates.clear()
    }
  }, [expire])

  const visibleAccounts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return accounts
    return accounts.filter((account) =>
      account.username.toLocaleLowerCase().includes(normalized)
      || account.displayName.toLocaleLowerCase().includes(normalized),
    )
  }, [accounts, query])

  async function applyUpdate(account: PublicUser, update: { displayName?: string; status?: 'active' | 'disabled' }) {
    if (!csrfToken) return
    const controller = new AbortController()
    updateControllers.current.add(controller)
    setFeedback(null)
    try {
      const { account: updated } = await updateAccount(account.id, update, csrfToken, controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      setAccounts((current) => current.map((item) => item.id === updated.id ? updated : item))
      setFeedback('账号信息已更新')
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return
      if (error instanceof AccountApiError && error.status === 401) {
        expire()
        return
      }
      setFeedback(error instanceof Error ? error.message : '更新失败，请重试')
    } finally {
      updateControllers.current.delete(controller)
    }
  }

  return (
    <section className="admin-panel" aria-labelledby="admin-title">
      <div className="admin-heading">
        <div>
          <p className="auth-kicker"><ShieldCheck aria-hidden="true" /> 管理员</p>
          <h2 id="admin-title">账号管理</h2>
          <p>查看教师账号、修改显示备注，并控制账号是否可以登录。</p>
        </div>
        <label className="account-search">
          <span>搜索账号</span>
          <span className="search-input"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} /></span>
        </label>
      </div>
      {feedback ? <p className="admin-feedback" role="alert">{feedback}</p> : null}
      {loading ? <p className="admin-empty">正在加载账号…</p> : null}
      {!loading && visibleAccounts.length === 0 ? <p className="admin-empty">没有找到匹配的账号。</p> : null}
      <div className="account-list">
        {visibleAccounts.map((account) => (
          <AccountRow key={account.id} account={account} onUpdate={applyUpdate} />
        ))}
      </div>
    </section>
  )
}

function AccountRow({ account, onUpdate }: {
  account: PublicUser
  onUpdate: (account: PublicUser, update: { displayName?: string; status?: 'active' | 'disabled' }) => Promise<void>
}) {
  const [displayName, setDisplayName] = useState(account.displayName)
  const [saving, setSaving] = useState(false)

  useEffect(() => setDisplayName(account.displayName), [account.displayName])

  async function submit(update: { displayName?: string; status?: 'active' | 'disabled' }) {
    setSaving(true)
    await onUpdate(account, update)
    setSaving(false)
  }

  return (
    <article className="account-row">
      <div className="account-identity">
        <div className="account-title-line">
          <strong>{account.username}</strong>
          <span className={`account-badge ${account.status}`}>{account.status === 'active' ? '使用中' : '已停用'}</span>
          <span className="role-badge">{account.role === 'admin' ? '管理员' : '教师'}</span>
        </div>
        <p>{account.lastLoginAt ? `最近登录：${new Date(account.lastLoginAt).toLocaleString('zh-CN')}` : '尚未登录'}</p>
      </div>
      <div className="account-actions">
        <label>
          <span>显示名称</span>
          <input value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <button type="button" className="auth-secondary" disabled={saving || !displayName.trim() || displayName.trim() === account.displayName} onClick={() => void submit({ displayName: displayName.trim() })}>保存备注</button>
        <button type="button" className={account.status === 'active' ? 'auth-danger' : 'auth-secondary'} disabled={saving} onClick={() => void submit({ status: account.status === 'active' ? 'disabled' : 'active' })}>
          {account.status === 'active' ? '停用账号' : '启用账号'}
        </button>
      </div>
    </article>
  )
}
