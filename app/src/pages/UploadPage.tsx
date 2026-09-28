import { useEffect, useRef, useState } from 'react'
import { Camera, FileImage, FileText, Plus, Trash2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { EssayImagePreview } from '../components/EssayImagePreview'
import { useAppState } from '../context/useAppState'
import { AppLayout } from '../layout/AppLayout'
import type { EssayPage } from '../types'
import { convertPdfToImages } from '../utils/pdfToImages'
import { findTask } from '../utils/taskLookup'

const allowedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
const imageAccept = 'image/png,image/jpeg,image/webp'
const maxImageBytes = 8 * 1024 * 1024
const maxPagesPerStudent = 10

interface StudentUpload {
  id: string
  name: string
  pages: EssayPage[]
  menuOpen: boolean
  editingName: boolean
  processingPdf: boolean
}

function createStudent(index: number): StudentUpload {
  return {
    id: `student-upload-${Date.now()}-${index}`,
    name: '',
    pages: [],
    menuOpen: false,
    editingName: false,
    processingPdf: false,
  }
}

function defaultStudentName(index: number) {
  return `学生${index + 1}`
}

export function UploadPage() {
  const { taskId = '' } = useParams()
  const navigate = useNavigate()
  const { tasks, enqueueImageEssays, pilot } = useAppState()
  const task = findTask(tasks, taskId)
  const [students, setStudentsState] = useState<StudentUpload[]>(() => [createStudent(0)])
  const studentsRef = useRef(students)
  const mountedRef = useRef(false)
  const [uploadError, setUploadError] = useState('')
  const [recoveredPages, setRecoveredPages] = useState<EssayPage[]>([])
  const [incompleteUploads, setIncompleteUploads] = useState<string[]>([])
  const [recoveryAttempt, setRecoveryAttempt] = useState(0)
  const [recovering, setRecovering] = useState(false)
  const [recoveryTarget, setRecoveryTarget] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const submissionIdRef = useRef(`upload-${crypto.randomUUID?.() ?? Date.now()}`)
  const localPreviewUrlsRef = useRef<string[]>([])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      localPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
      localPreviewUrlsRef.current = []
    }
  }, [])

  useEffect(()=>{
    if(!pilot)return
    let active=true
    setRecovering(true)
    void pilot.unattachedUploads(taskId).then(uploads=>{
      if(!active)return
      const assigned = new Set(studentsRef.current.flatMap(s=>s.pages.map(p=>p.uploadId)))
      setRecoveredPages(uploads.filter(u=>u.state==='verified'&&!assigned.has(u.id)).map(u=>({id:u.id,uploadId:u.id,label:u.label,pageNumber:1,quality:'clear',accent:'#0891b2'})))
      setIncompleteUploads(uploads.filter(u=>u.state==='reserved').map(u=>u.label))
    }).catch(()=>{if(active)setUploadError('已上传页面读取失败，请刷新后重试。')}).finally(()=>{if(active)setRecovering(false)})
    return()=>{active=false}
  },[pilot,taskId,recoveryAttempt])

  // Publish each upload edit synchronously so delayed PDF callbacks see the latest card.
  // Keep URL allocation/release outside React's replayable state updater callbacks.
  const setStudents = (update: (current: StudentUpload[]) => StudentUpload[]) => {
    if (!mountedRef.current) return
    const next = update(studentsRef.current)
    studentsRef.current = next
    setStudentsState(next)
  }

  const isStudentActive = (studentId: string) => mountedRef.current
    && studentsRef.current.some((student) => student.id === studentId)

  if (!task) {
    return <EmptyState title="找不到任务" description="请返回任务列表重新选择一个批改任务。" />
  }

  const displayName = (student: StudentUpload, index: number) => student.name.trim() || defaultStudentName(index)

  const addImageFiles = (studentId: string, files: File[]) => {
    if (!mountedRef.current || !files.length) return
    const target = studentsRef.current.find((student) => student.id === studentId)
    if (!target) return
    const invalid = files.find((file) => !allowedImageTypes.has(file.type) || file.size > maxImageBytes)
    if (invalid) {
      setUploadError('仅支持 PNG、JPEG、WebP 图片，且单张不超过 8 MiB。')
      return
    }

    if (target.pages.length + files.length > maxPagesPerStudent) {
      setUploadError(`每位学生最多上传 ${maxPagesPerStudent} 页作文。`)
      return
    }

    setUploadError('')
    const nextPages = files.map((file, fileIndex): EssayPage => {
      const previewUrl = URL.createObjectURL(file)
      localPreviewUrlsRef.current.push(previewUrl)
      return {
        id: `local-page-${Date.now()}-${fileIndex}-${Math.random().toString(36).slice(2)}`,
        label: file.name,
        pageNumber: target.pages.length + fileIndex + 1,
        quality: 'clear',
        accent: '#0891b2',
        previewUrl,
        sourceFile: file,
      }
    })
    setStudents((current) => current.map((student) => student.id === studentId
      ? { ...student, pages: [...student.pages, ...nextPages] }
      : student))
  }

  const addPdfFile = async (studentId: string, file?: File) => {
    if (!mountedRef.current || !file) return
    const target = studentsRef.current.find((student) => student.id === studentId)
    if (!target || target.processingPdf) return
    const remainingPages = maxPagesPerStudent - target.pages.length
    if (remainingPages < 1) {
      setUploadError(`每位学生最多上传 ${maxPagesPerStudent} 页作文。`)
      return
    }

    setUploadError('')
    setStudents((current) => current.map((student) => student.id === studentId
      ? { ...student, processingPdf: true }
      : student))
    try {
      const pageFiles = await convertPdfToImages(file, { maxPages: remainingPages })
      addImageFiles(studentId, pageFiles)
    } catch (error) {
      if (isStudentActive(studentId)) {
        setUploadError(error instanceof Error ? error.message : 'PDF 解析失败，请检查文件后重试。')
      }
    } finally {
      setStudents((current) => current.map((student) => student.id === studentId
        ? { ...student, processingPdf: false }
        : student))
    }
  }

  const removePage = (studentId: string, pageId: string) => {
    setStudents((current) => current.map((student) => {
      if (student.id !== studentId) return student
      const removed = student.pages.find((page) => page.id === pageId)
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl)
        localPreviewUrlsRef.current = localPreviewUrlsRef.current.filter((url) => url !== removed.previewUrl)
      }
      return {
        ...student,
        pages: student.pages
          .filter((page) => page.id !== pageId)
          .map((page, index) => ({ ...page, pageNumber: index + 1 })),
      }
    }))
  }

  const removeStudent = (studentId: string) => {
    setStudents((current) => {
      const removed = current.find((student) => student.id === studentId)
      removed?.pages.forEach((page) => {
        if (!page.previewUrl) return
        URL.revokeObjectURL(page.previewUrl)
        localPreviewUrlsRef.current = localPreviewUrlsRef.current.filter((url) => url !== page.previewUrl)
      })
      return current.filter((student) => student.id !== studentId)
    })
  }

  const enqueueStudents = async () => {
    if (submittingRef.current) return
    const readyStudents = students
      .map((student, index) => ({ ...student, resolvedName: displayName(student, index) }))
      .filter((student) => student.pages.length > 0)
    if (!readyStudents.length) {
      setUploadError('请先为至少一位学生上传作文。')
      return
    }
    if (readyStudents.some((student) => student.pages.length > maxPagesPerStudent)) {
      setUploadError(`每位学生最多上传 ${maxPagesPerStudent} 页作文。`)
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    const storedClassName = task.className.trim() && task.className !== '待选择班级' ? task.className.trim() : '未分班'
    try {
    await enqueueImageEssays({
      submissionId: submissionIdRef.current,
      taskId: task.id,
      className: storedClassName,
      essayGroups: readyStudents.map((student) => ({ studentName: student.resolvedName, pages: student.pages })),
    })
    if(mountedRef.current) navigate(`/tasks/${task.id}/progress`)
    } catch(error) {if(mountedRef.current){setUploadError(error instanceof Error?error.message:"作文保存失败，请重试。");submittingRef.current=false;setSubmitting(false)}}
  }

  const hasPages = students.some((student) => student.pages.length > 0)
  const processingPdf = students.some((student) => student.processingPdf)

  return (
    <AppLayout
      task={task}
      title="上传学生作文"
      currentStep="upload"
      description="按学生依次上传作文图片、PDF 或现场拍照；每位学生可包含多页。"
    >
      <>
        {task.materialProcessingStatus === 'failed' ? (
          <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            材料暂时无法读取，本任务将仅按已填写的写作要求评分。
          </p>
        ) : null}
        <div className="space-y-5">
        {uploadError ? (
          <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {uploadError}
          </p>
        ) : null}

        {incompleteUploads.length ? <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <p>以下页面尚未完成上传确认，请重新检查；若原图仍未上传成功，请重新选择文件。</p>
          <ul>{incompleteUploads.map((label,index)=><li key={index}>{label}</li>)}</ul>
          <button type="button" disabled={recovering||submitting} onClick={()=>setRecoveryAttempt(value=>value+1)}>{recovering?'正在检查…':'重新检查未完成上传'}</button>
        </section>:null}
        {recoveredPages.length ? <section className="rounded-xl border border-blue-200 bg-white p-4">
          <p>以下页面已上传，请确认它们属于哪位学生。</p>
          <select aria-label="恢复页面所属学生" value={recoveryTarget} onChange={e=>setRecoveryTarget(e.target.value)}>
            <option value="">请选择学生</option>
            {students.map((s,i)=><option key={s.id} value={s.id}>{displayName(s,i)}</option>)}
          </select>
          <div className="grid gap-3 sm:grid-cols-3">{recoveredPages.map(page=><div key={page.id}><EssayImagePreview page={page}/><button type="button" disabled={!recoveryTarget || submitting} onClick={()=>{
            const target=studentsRef.current.find(s=>s.id===recoveryTarget)
            if(!target||target.pages.length>=maxPagesPerStudent){setUploadError('每位学生最多上传 10 页作文。');return}
            setStudents(current=>current.map(s=>s.id===target.id?{...s,pages:[...s.pages,{...page,pageNumber:s.pages.length+1}]}:s));setRecoveredPages(current=>current.filter(p=>p.id!==page.id))
          }}>加入所选学生</button></div>)}</div>
        </section>:null}
        <div className="grid gap-4 xl:grid-cols-2">
          {students.map((student, studentIndex) => {
            const resolvedName = displayName(student, studentIndex)
            return (
              <section key={student.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                  {student.editingName ? (
                    <input
                      autoFocus
                      aria-label={`${defaultStudentName(studentIndex)}姓名`}
                      value={student.name}
                      placeholder={defaultStudentName(studentIndex)}
                      maxLength={40}
                      onChange={(event) => setStudents((current) => current.map((item) => item.id === student.id
                        ? { ...item, name: event.target.value }
                        : item))}
                      onBlur={() => setStudents((current) => current.map((item) => item.id === student.id
                        ? { ...item, editingName: false }
                        : item))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                        if (event.key === 'Escape') {
                          event.currentTarget.value = student.name
                          event.currentTarget.blur()
                        }
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setStudents((current) => current.map((item) => item.id === student.id
                        ? { ...item, editingName: true }
                        : item))}
                      className="rounded-lg px-2 py-1 text-left text-base font-semibold text-slate-950 hover:bg-blue-50 hover:text-blue-700"
                    >
                      {resolvedName}
                    </button>
                  )}
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>{student.pages.length} 页</span>
                    {students.length > 1 ? (
                      <button
                        type="button"
                        aria-label={`删除${resolvedName}`}
                        onClick={() => removeStudent(student.id)}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="p-4">
                  {student.pages.length ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {student.pages.map((page) => (
                        <div key={page.id} className="relative">
                          <EssayImagePreview page={page} />
                          <button
                            type="button"
                            aria-label={`删除 ${page.label}`}
                            onClick={() => removePage(student.id, page.id)}
                            className="absolute right-2 top-2 rounded-full bg-white/95 p-1.5 text-slate-500 shadow hover:text-rose-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="py-4 text-center text-sm text-slate-500">尚未上传作文</p>
                  )}

                  <button
                    type="button"
                    aria-label={`为${resolvedName}添加作文`}
                    aria-expanded={student.menuOpen}
                    onClick={() => setStudents((current) => current.map((item) => item.id === student.id
                      ? { ...item, menuOpen: !item.menuOpen }
                      : item))}
                    className="mt-4 flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-blue-200 bg-blue-50/40 px-4 py-6 text-blue-700 transition hover:border-blue-400 hover:bg-blue-50"
                  >
                    <Plus className="h-8 w-8" />
                    <span className="mt-1 text-sm font-semibold">添加作文</span>
                  </button>

                  {student.menuOpen ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-3" aria-label={`${resolvedName}上传方式`}>
                      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                        <FileImage className="h-4 w-4" />
                        上传相册图片
                        <input
                          type="file"
                          aria-label="上传相册图片"
                          accept={imageAccept}
                          multiple
                          className="sr-only"
                          onChange={(event) => {
                            addImageFiles(student.id, Array.from(event.target.files ?? []))
                            event.target.value = ''
                          }}
                        />
                      </label>
                      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                        <FileText className="h-4 w-4" />
                        上传 PDF 文件
                        <input
                          type="file"
                          aria-label="上传PDF文件"
                          accept="application/pdf"
                          disabled={student.processingPdf}
                          className="sr-only"
                          onChange={async (event) => {
                            const input = event.currentTarget
                            await addPdfFile(student.id, input.files?.[0])
                            input.value = ''
                          }}
                        />
                      </label>
                      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                        <Camera className="h-4 w-4" />
                        拍照上传
                        <input
                          type="file"
                          aria-label="拍照上传"
                          accept={imageAccept}
                          capture="environment"
                          className="sr-only"
                          onChange={(event) => {
                            addImageFiles(student.id, Array.from(event.target.files ?? []))
                            event.target.value = ''
                          }}
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              </section>
            )
          })}
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => setStudents((current) => [...current, createStudent(current.length)])}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50"
          >
            <Plus className="h-4 w-4" />
            添加下一位学生
          </button>
          <button
            type="button"
            onClick={()=>void enqueueStudents()}
            disabled={submitting || processingPdf || !hasPages}
            className="rounded-lg bg-blue-700 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {processingPdf ? '正在解析 PDF…' : '提交作文并进入批改'}
          </button>
        </div>

        <Link to={`/tasks/${task.id}/progress`} className="inline-flex text-sm font-semibold text-blue-700">
          查看批改进度
        </Link>
        </div>
      </>
    </AppLayout>
  )
}
