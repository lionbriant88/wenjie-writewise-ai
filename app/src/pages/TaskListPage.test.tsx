import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppStateProvider } from '../context/AppStateContext'
import { TaskListPage } from './TaskListPage'

function renderTaskListPage() {
  render(
    <AppStateProvider>
      <MemoryRouter>
        <TaskListPage />
      </MemoryRouter>
    </AppStateProvider>,
  )
}

describe('TaskListPage', () => {
  it('renders a compact teacher workspace instead of prototype-style task cards', () => {
    renderTaskListPage()

    expect(screen.getByText('今日工作台')).toBeInTheDocument()
    expect(screen.getByText('任务队列')).toBeInTheDocument()
    expect(screen.getAllByText('立即处理')).toHaveLength(3)
    expect(screen.queryByText('后台批改队列模拟')).not.toBeInTheDocument()
  })
})
import {CloudAppStateProvider} from '../pilot/CloudAppStateProvider'
import {createPilotClient} from '../pilot/client'
import type {TaskDto} from '../../../shared/pilotContracts'
it('keeps a task visible after deletion fails and removes it only after an acknowledged retry',async()=>{
 let deleted=false,attempts=0
 const row:TaskDto={id:'synthetic-task',revision:1,rubricRevision:0,state:'draft',confirmedPackage:null,draft:{taskName:'云端测试任务',fullScore:15,writingRequirement:'Write.',dimensions:[],source:'teacher',materialContext:null,materialProcessingStatus:'none',materialRefs:[]},counts:{total:0,completed:0,exceptions:0},createdAt:'2026-09-28T00:00:00Z',updatedAt:'2026-09-28T00:00:00Z'}
 const client=createPilotClient({getCsrfToken:()=> 'synthetic',onSessionExpired:()=>{},fetchImpl:async(url,options)=>{
  if(options?.method==='DELETE'){attempts++;if(attempts===1)return Response.json({error:{code:'service_unavailable',message:'删除未完成'}},{status:503});deleted=true;return Response.json({deleted:true})}
  if(String(url).includes('/capabilities'))return Response.json({teacherMvp:true,aiAvailable:true,queueState:'ready'})
  return Response.json({items:deleted?[]:[row],nextCursor:null})
 }})
 const user=(await import('@testing-library/user-event')).default.setup()
 render(<CloudAppStateProvider userId="teacher" client={client}><MemoryRouter><TaskListPage/></MemoryRouter></CloudAppStateProvider>)
 await user.click(await screen.findByRole('button',{name:'删除云端测试任务'}));expect(screen.getByRole('dialog')).toHaveTextContent('作文图片、批改结果和教师修订')
 await user.click(screen.getByText('确认删除任务及内容'));expect(await screen.findByText('删除未完成')).toBeVisible();expect(screen.getByText('云端测试任务')).toBeVisible()
 await user.click(screen.getByText('确认删除任务及内容'));expect(await screen.findByText('还没有批改任务')).toBeVisible()
})
