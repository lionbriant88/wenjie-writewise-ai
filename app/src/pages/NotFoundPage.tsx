import { Link } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { AppLayout } from '../layout/AppLayout'

export function NotFoundPage() {
  return (
    <AppLayout title="页面不存在">
      <EmptyState
        title="没有找到这个页面"
        description="当前路由不在第一阶段原型范围内。"
        action={
          <Link to="/" className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white">
            返回任务列表
          </Link>
        }
      />
    </AppLayout>
  )
}
