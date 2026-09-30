import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Camera, RotateCcw, X } from 'lucide-react'

interface CameraCaptureDialogProps {
  studentName: string
  onCapture: (file: File) => void
  onClose: () => void
}

const maximumPhotoBytes = 8 * 1024 * 1024
const buttonClass = 'tech-focus min-h-11 rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40'

function cameraError(error: unknown) {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return '摄像头权限未开放。请在浏览器的网站权限中允许摄像头，并检查手机或电脑的系统相机权限；Windows 设备还需允许桌面应用访问相机，再重试。'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return '未检测到可用摄像头。请连接或开启摄像头、USB 展台，并确认 Windows 能识别该设备，再重试。'
    case 'NotReadableError':
    case 'TrackStartError':
      return '摄像头可能被其他程序占用或无法启动。请关闭希沃展台、视频会议等正在使用摄像头的程序后重试。'
    case 'OverconstrainedError':
      return '所选摄像头当前不可用。请重新连接设备，选择其他摄像头后重试。'
    default:
      return '摄像头启动失败。请检查设备连接和浏览器相机权限，再重试。'
  }
}

export function CameraCaptureDialog({ studentName, onCapture, onClose }: CameraCaptureDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const mountedRef = useRef(false)
  const generationRef = useRef(0)
  const capturePendingRef = useRef(false)
  const photoRef = useRef<File | null>(null)
  const previewUrlRef = useRef('')
  const [phase, setPhase] = useState<'opening' | 'live' | 'preview' | 'error'>('opening')
  const [ready, setReady] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState('')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')

  const stopStream = useCallback(() => {
    const stream = streamRef.current
    streamRef.current = null
    stream?.getTracks().forEach((track) => { track.onended = null; track.stop() })
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const releasePhoto = useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = ''
    photoRef.current = null
  }, [])

  const stopSession = useCallback(() => {
    mountedRef.current = false
    ++generationRef.current
    stopStream()
    releasePhoto()
  }, [releasePhoto, stopStream])

  const startCamera = useCallback(async (selectedDevice = '') => {
    const generation = ++generationRef.current
    const current = () => mountedRef.current && generationRef.current === generation
    stopStream()
    releasePhoto()
    capturePendingRef.current = false
    setPreviewUrl('')
    setCapturing(false)
    setReady(false)
    setPhase('opening')
    setError('')
    if (window.isSecureContext === false) {
      setPhase('error')
      setError('当前页面无法使用摄像头。请通过 HTTPS 网站或本机测试入口打开，普通 HTTP 的服务器地址不支持拍照。')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof dialogRef.current?.showModal !== 'function') {
      setPhase('error')
      setError('当前浏览器不支持网页拍照。请使用新版 Edge / Chrome 打开网站；也可关闭此窗口，使用“上传相册图片”上传已有照片。')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          ...(selectedDevice ? { deviceId: { exact: selectedDevice } } : { facingMode: { ideal: 'environment' } }),
          width: { ideal: 2560 }, height: { ideal: 1920 },
        },
      })
      if (!current()) { stream.getTracks().forEach((track) => track.stop()); return }
      streamRef.current = stream
      const video = videoRef.current
      if (!video) { stopStream(); return }
      video.srcObject = stream
      setDeviceId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? selectedDevice)
      setPhase('live')
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          if (!current()) return
          ++generationRef.current
          stopStream()
          setReady(false)
          setCapturing(false)
          capturePendingRef.current = false
          setPhase('error')
          setError('摄像头已断开或权限已收回。请检查设备后重试。')
        }
      })
      await video.play()
      if (!current()) return
      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices()
        if (current()) setDevices(allDevices.filter((device) => device.kind === 'videoinput' && device.deviceId))
      } catch { /* Camera capture remains available when device enumeration is restricted. */ }
    } catch (cause) {
      if (!current()) return
      stopStream()
      setReady(false)
      setPhase('error')
      setError(cameraError(cause))
    }
  }, [releasePhoto, stopStream])

  useEffect(() => {
    mountedRef.current = true
    const dialog = dialogRef.current
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.open = true
    }
    void startCamera()
    return () => {
      stopSession()
      dialog?.close?.()
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [startCamera, stopSession])

  function closeCamera() {
    if (!mountedRef.current) return
    stopSession()
    dialogRef.current?.close?.()
    onClose()
  }

  function updateReady() {
    const video = videoRef.current
    if (mountedRef.current && streamRef.current && video?.srcObject === streamRef.current) {
      setReady(video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0)
    }
  }

  function takePhoto() {
    const video = videoRef.current
    if (!mountedRef.current || capturePendingRef.current || !ready || !streamRef.current || !video || video.srcObject !== streamRef.current || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return
    const generation = generationRef.current
    capturePendingRef.current = true
    setCapturing(true)
    setError('')
    const canvas = document.createElement('canvas')
    try {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('canvas_unavailable')
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        try {
          if (!mountedRef.current || generation !== generationRef.current) return
          capturePendingRef.current = false
          setCapturing(false)
          if (!blob || blob.size === 0) { setError('照片生成失败，请重新拍照。'); return }
          if (blob.size > maximumPhotoBytes) { setError('照片超过 8 MiB，未添加。请换用其他摄像头，或关闭拍照窗口后使用“上传相册图片”添加符合大小要求的图片。'); return }
          const file = new File([blob], `camera-${Date.now()}.png`, { type: 'image/png' })
          const url = URL.createObjectURL(file)
          photoRef.current = file
          previewUrlRef.current = url
          setPreviewUrl(url)
          ++generationRef.current
          stopStream()
          setReady(false)
          setPhase('preview')
        } catch {
          if (mountedRef.current && generation === generationRef.current) setError('照片生成失败，请重新拍照。')
        } finally {
          canvas.width = 0
          canvas.height = 0
        }
      }, 'image/png')
    } catch {
      canvas.width = 0
      canvas.height = 0
      capturePendingRef.current = false
      setCapturing(false)
      setError('照片生成失败，请重新拍照。')
    }
  }

  function usePhoto() {
    const file = photoRef.current
    if (!mountedRef.current || !file) return
    photoRef.current = null
    onCapture(file)
    closeCamera()
  }

  return (
    <dialog ref={dialogRef} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={(event) => { event.preventDefault(); closeCamera() }} className="m-auto max-h-[94dvh] w-[min(94vw,56rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl backdrop:bg-slate-950/60 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 id={titleId} className="text-lg font-bold text-slate-900">为{studentName}拍照</h2>
        <button type="button" aria-label="关闭拍照" onClick={closeCamera} className={`${buttonClass} px-3`}><X className="h-5 w-5" /></button>
      </div>
      <p id={descriptionId} className="mt-2 text-sm text-slate-600">将作文完整放入画面，确认文字清晰后拍照。可选择摄像头或 USB 展台。</p>
      {phase !== 'preview' && devices.length > 0 && (
        <label className="mt-4 flex flex-wrap items-center gap-2 text-sm font-medium text-slate-700">摄像头
          <select aria-label="摄像头" value={deviceId} disabled={capturing} onChange={(event) => { setDeviceId(event.target.value); void startCamera(event.target.value) }} className="tech-focus min-h-11 max-w-full flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2">
            {!devices.some((device) => device.deviceId === deviceId) && <option value={deviceId}>当前摄像头</option>}
            {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `摄像头 ${index + 1}`}</option>)}
          </select>
        </label>
      )}
      <div className="relative mt-4 flex min-h-48 items-center justify-center overflow-hidden rounded-xl bg-slate-950">
        <video ref={videoRef} aria-label="摄像头实时画面" autoPlay muted playsInline onLoadedData={updateReady} onCanPlay={updateReady} className={`${phase === 'preview' ? 'hidden' : 'block'} max-h-[58dvh] w-full object-contain`} />
        {previewUrl && <img src={previewUrl} alt="拍摄照片预览" className="max-h-[58dvh] w-full object-contain" />}
        {phase === 'opening' && <p role="status" className="absolute px-4 text-center text-sm text-white">正在打开摄像头，请在浏览器提示中允许使用…</p>}
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-3">
        {phase === 'preview' ? <>
          <button type="button" onClick={() => { void startCamera(deviceId) }} className={`${buttonClass} inline-flex items-center gap-2`}><RotateCcw className="h-4 w-4" />重拍</button>
          <button type="button" onClick={usePhoto} className="tech-focus min-h-11 rounded-xl bg-blue-600 px-5 py-2 font-semibold text-white">使用这张照片</button>
        </> : <>
          {phase === 'error' && <button type="button" onClick={() => { void startCamera(deviceId) }} className={buttonClass}>重试摄像头</button>}
          <button type="button" disabled={!ready || capturing || phase !== 'live'} onClick={takePhoto} className="tech-focus inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"><Camera className="h-4 w-4" />{capturing ? '生成照片…' : '拍照'}</button>
        </>}
      </div>
      <p className="mt-3 text-xs text-slate-500">只使用摄像头，不录音。关闭窗口后释放摄像头；照片在点击“使用这张照片”后加入当前学生。</p>
    </dialog>
  )
}
