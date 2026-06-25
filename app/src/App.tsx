import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppStateProvider } from './context/AppStateContext'
import { ClassReviewPage } from './pages/ClassReviewPage'
import { CreateTaskPage } from './pages/CreateTaskPage'
import { EssayResultPage } from './pages/EssayResultPage'
import { ExceptionsPage } from './pages/ExceptionsPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ProgressPage } from './pages/ProgressPage'
import { TaskListPage } from './pages/TaskListPage'
import { UploadPage } from './pages/UploadPage'

function App() {
  return (
    <AppStateProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<TaskListPage />} />
          <Route path="/tasks/new" element={<CreateTaskPage />} />
          <Route path="/tasks/:taskId/upload" element={<UploadPage />} />
          <Route path="/tasks/:taskId/progress" element={<ProgressPage />} />
          <Route path="/tasks/:taskId/exceptions" element={<ExceptionsPage />} />
          <Route path="/tasks/:taskId/essays/:essayId" element={<EssayResultPage />} />
          <Route path="/tasks/:taskId/class-review" element={<ClassReviewPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </AppStateProvider>
  )
}

export default App
