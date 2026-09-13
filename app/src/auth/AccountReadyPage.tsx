import { CheckCircle2, Clock3, LogOut, UserRound } from 'lucide-react'
import { useAuth } from './useAuth'
import { AdminAccounts } from './AdminAccounts'

export function AccountReadyPage() {
  const { user, logout } = useAuth()
  if (!user) return null

  return (
    <main className="account-shell">
      <header className="account-header">
        <div className="account-brand"><span><CheckCircle2 aria-hidden="true" /> 文阶</span><strong>WriteWise AI 教师试用</strong></div>
        <div className="signed-in-user"><UserRound aria-hidden="true" /><span><small>当前账号</small><strong>{user.displayName}</strong></span><button type="button" className="auth-secondary" onClick={() => void logout()}><LogOut aria-hidden="true" />退出登录</button></div>
      </header>
      <div className="account-content">
        <section className="ready-card" aria-labelledby="ready-title">
          <div className="ready-mark"><CheckCircle2 aria-hidden="true" /></div>
          <div>
            <p className="auth-kicker">登录成功</p>
            <h1 id="ready-title">账号已就绪</h1>
            <p>欢迎，{user.displayName}。你的教师试用账号已经可以正常使用。</p>
          </div>
          <div className="pilot-wait"><Clock3 aria-hidden="true" /><span><strong>作文批改暂未开放</strong><small>作文批改功能正在准备中，开放后会统一通知。</small></span></div>
        </section>
        {user.role === 'admin' ? <AdminAccounts /> : null}
      </div>
    </main>
  )
}
