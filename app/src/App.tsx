import { lazy, Suspense } from 'react'
import { AccountApp } from './auth/AccountApp'

const LocalDemoApp = import.meta.env.DEV
  ? lazy(() => import('./LocalDemoApp'))
  : null

function App() {
  if (LocalDemoApp && import.meta.env.VITE_AUTH_MODE === 'local-demo') {
    return <Suspense fallback={null}><LocalDemoApp /></Suspense>
  }
  return <AccountApp />
}

export default App
