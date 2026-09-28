import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { AccountReadyPage } from '../auth/AccountReadyPage'
import { createPilotClient } from './client'
import { CloudAppStateProvider } from './CloudAppStateProvider'
import type { PilotCapabilities } from '../../../shared/pilotContracts'
import { TaskListPage } from '../pages/TaskListPage'
import { CreateTaskPage } from '../pages/CreateTaskPage'
import { UploadPage } from '../pages/UploadPage'
import { ProgressPage } from '../pages/ProgressPage'
import { EssayResultPage } from '../pages/EssayResultPage'
import { ExceptionsPage } from '../pages/ExceptionsPage'
import { NotFoundPage } from '../pages/NotFoundPage'
export function TeacherApp() {
  const auth = useAuth(),
    latest = useRef(auth)
  latest.current = auth
  const [client] = useState(() =>
    createPilotClient({
      getCsrfToken: () => latest.current.csrfToken,
      onSessionExpired: () => latest.current.expire(),
    }),
  )
  const [capabilities, setCapabilities] = useState<PilotCapabilities | null>(
      null,
    ),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void client
      .capabilities(controller.signal)
      .then((v) => {
        if (!controller.signal.aborted) {
          setCapabilities(v)
          setFailed(false)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [client, retry])
  if (failed)
    return (
      <>
        <AccountReadyPage />
        <p role="alert">
          教师工作台暂时无法加载。
          <button onClick={() => setRetry((v) => v + 1)}>重新加载</button>
        </p>
      </>
    )
  if (!capabilities)
    return (
      <p role="status" className="p-6">
        正在加载教师工作台…
      </p>
    )
  if (!capabilities.teacherMvp || !auth.user) return <AccountReadyPage />
  return (
    <CloudAppStateProvider
      key={auth.user.id}
      userId={auth.user.id}
      client={client}
      capabilities={capabilities}
    >
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<TaskListPage />} />
          <Route path="/tasks/new" element={<CreateTaskPage />} />
          <Route path="/tasks/:taskId/edit" element={<CreateTaskPage />} />
          <Route path="/tasks/:taskId/upload" element={<UploadPage />} />
          <Route path="/tasks/:taskId/progress" element={<ProgressPage />} />
          <Route
            path="/tasks/:taskId/exceptions"
            element={<ExceptionsPage />}
          />
          <Route
            path="/tasks/:taskId/essays/:essayId"
            element={<EssayResultPage />}
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </CloudAppStateProvider>
  )
}
