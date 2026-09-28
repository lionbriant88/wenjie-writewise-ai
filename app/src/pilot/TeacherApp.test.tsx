import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../auth/authContext'
import { TeacherApp } from './TeacherApp'
const auth: AuthContextValue = {
  status: 'authenticated',
  user: {
    id: 'synthetic-teacher',
    username: 'wj_synthetic',
    displayName: '测试教师',
    role: 'teacher',
    status: 'active',
    lastLoginAt: null,
  },
  csrfToken: 'synthetic',
  message: null,
  login: async () => true,
  logout: async () => {},
  retry: () => {},
  retryLogout: () => {},
  expire: () => {},
}
afterEach(() => vi.unstubAllGlobals())
it('opens an empty cloud workbench with account controls and no examples', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) =>
      Response.json(
        String(url).includes('/capabilities')
          ? { teacherMvp: true, aiAvailable: true, queueState: 'ready' }
          : { items: [], nextCursor: null },
      ),
    ),
  )
  render(
    <AuthContext.Provider value={auth}>
      <TeacherApp />
    </AuthContext.Provider>,
  )
  expect(await screen.findByText('还没有批改任务')).toBeVisible()
  expect(screen.getByText('测试教师')).toBeVisible()
  expect(screen.getByRole('button', { name: '退出登录' })).toBeVisible()
  expect(screen.queryByText('班级讲评')).not.toBeInTheDocument()
})
