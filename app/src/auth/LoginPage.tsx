import { LockKeyhole, Sparkles } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useAuth } from './useAuth'

export function LoginPage() {
  const { login, message } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!username.trim() || !password) return
    setSubmitting(true)
    await login(username.trim(), password)
    setPassword('')
    setSubmitting(false)
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-brand"><Sparkles aria-hidden="true" /> 文阶 · WriteWise AI</div>
        <div className="auth-icon"><LockKeyhole aria-hidden="true" /></div>
        <p className="auth-kicker">教师试用入口</p>
        <h1 id="login-title">登录账号</h1>
        <p className="auth-lead">使用分发给你的试用账号登录。账号信息仅用于本次教师试用。</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="account-username">账号</label>
          <input
            id="account-username"
            name="username"
            autoComplete="off"
            spellCheck={false}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <label htmlFor="account-password">密码</label>
          <input
            id="account-password"
            name="password"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {message ? <p className="auth-alert" role="alert">{message}</p> : null}
          <button type="submit" className="auth-primary" disabled={submitting}>
            {submitting ? '正在登录…' : '登录'}
          </button>
        </form>
        <p className="auth-footnote">如无法登录，请联系账号管理员核对账号状态。</p>
      </section>
    </main>
  )
}
