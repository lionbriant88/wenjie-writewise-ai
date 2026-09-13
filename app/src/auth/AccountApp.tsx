import { RefreshCw, WifiOff } from 'lucide-react'
import { AuthProvider } from './AuthProvider'
import { useAuth } from './useAuth'
import { AccountReadyPage } from './AccountReadyPage'
import { LoginPage } from './LoginPage'
import './account.css'

function AccountGate() {
  const { status, retry, retryLogout } = useAuth()
  if (status === 'checking' || status === 'logout-pending') {
    return <main className="auth-shell"><div className="auth-loading" role="status"><span />{status === 'logout-pending' ? '正在安全退出…' : '正在检查登录状态…'}</div></main>
  }
  if (status === 'logout-failed') {
    return (
      <main className="auth-shell">
        <section className="auth-card auth-unavailable">
          <div className="auth-icon"><WifiOff aria-hidden="true" /></div>
          <h1>无法确认已安全退出</h1>
          <p className="auth-lead">账号内容已经从此页面清除。请重新退出，确认服务端会话已撤销。</p>
          <button type="button" className="auth-primary" onClick={retryLogout}><RefreshCw aria-hidden="true" />重新退出</button>
        </section>
      </main>
    )
  }
  if (status === 'unavailable') {
    return (
      <main className="auth-shell">
        <section className="auth-card auth-unavailable">
          <div className="auth-icon"><WifiOff aria-hidden="true" /></div>
          <h1>账号服务暂不可用</h1>
          <p className="auth-lead">暂时无法安全确认登录状态。请检查网络后重试。</p>
          <button type="button" className="auth-primary" onClick={retry}><RefreshCw aria-hidden="true" />重新尝试</button>
        </section>
      </main>
    )
  }
  return status === 'authenticated' ? <AccountReadyPage /> : <LoginPage />
}

export function AccountApp() {
  return <AuthProvider><AccountGate /></AuthProvider>
}
