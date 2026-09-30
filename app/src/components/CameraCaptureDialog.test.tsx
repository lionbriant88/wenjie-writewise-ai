import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CameraCaptureDialog } from './CameraCaptureDialog'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function cameraStream(deviceId = 'front') {
  const stop = vi.fn()
  const track = { stop, getSettings: () => ({ deviceId }), onended: null as (() => void) | null }
  return { stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream, stop, track }
}

let getUserMedia: ReturnType<typeof vi.fn>
let drawImage: ReturnType<typeof vi.fn>
let toBlob: ReturnType<typeof vi.fn<(callback: BlobCallback, type?: string, quality?: number) => void>>
let revokeObjectURL: ReturnType<typeof vi.fn>

beforeEach(() => {
  getUserMedia = vi.fn().mockResolvedValue(cameraStream().stream)
  vi.stubGlobal('isSecureContext', true)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia,
    enumerateDevices: vi.fn().mockResolvedValue([
      { kind: 'videoinput', deviceId: 'front', label: '内置摄像头' },
      { kind: 'videoinput', deviceId: 'usb', label: 'USB 展台' },
      { kind: 'audioinput', deviceId: 'microphone', label: '麦克风' },
    ]),
  } })
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false } })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  drawImage = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
  toBlob = vi.fn().mockImplementation((callback: BlobCallback) => callback(new Blob(['photo'], { type: 'image/png' })))
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(toBlob)
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn().mockReturnValue('blob:camera-photo'), revokeObjectURL: vi.fn() }))
  revokeObjectURL = vi.mocked(URL.revokeObjectURL)
})

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function videoReady() {
  const video = screen.getByLabelText('摄像头实时画面') as HTMLVideoElement
  await waitFor(() => expect(video.srcObject).toBeTruthy())
  Object.defineProperties(video, {
    videoWidth: { configurable: true, value: 2048 },
    videoHeight: { configurable: true, value: 1536 },
    readyState: { configurable: true, value: 2 },
  })
  fireEvent.loadedData(video)
  return video
}

describe('CameraCaptureDialog', () => {
  it('opens the camera without audio and only hands over a full-size photo after confirmation', async () => {
    const camera = cameraStream()
    getUserMedia.mockResolvedValue(camera.stream)
    const onCapture = vi.fn(), onClose = vi.fn()
    render(<CameraCaptureDialog studentName="学生1" onCapture={onCapture} onClose={onClose} />)
    expect(screen.getByRole('dialog', { name: /学生1/ })).toBeInTheDocument()
    expect(getUserMedia).toHaveBeenCalledWith({ audio: false, video: {
      facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 },
    } })
    expect(screen.getByRole('button', { name: '拍照' })).toBeDisabled()
    const video = await videoReady()
    await userEvent.click(screen.getByRole('button', { name: '拍照' }))
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 2048, 1536)
    expect(screen.getByRole('img', { name: '拍摄照片预览' })).toHaveAttribute('src', 'blob:camera-photo')
    expect(camera.stop).toHaveBeenCalledTimes(1)
    expect(onCapture).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '使用这张照片' }))
    expect(onCapture).toHaveBeenCalledTimes(1)
    const file = onCapture.mock.calls[0][0] as File
    expect(file.type).toBe('image/png')
    expect(file.size).toBe(5)
    expect(file.name).toMatch(/\.png$/)
    expect(toBlob.mock.calls[0].slice(1)).toEqual(['image/png'])
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:camera-photo')
  })

  it('switches to the selected USB camera after stopping the old stream', async () => {
    const front = cameraStream(), usb = cameraStream('usb')
    getUserMedia.mockResolvedValueOnce(front.stream).mockImplementationOnce(() => {
      expect(front.stop).toHaveBeenCalledTimes(1)
      return Promise.resolve(usb.stream)
    })
    const view = render(<CameraCaptureDialog studentName="学生1" onCapture={vi.fn()} onClose={vi.fn()} />)
    await videoReady()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '摄像头' }), 'usb')
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: false, video: {
      deviceId: { exact: 'usb' }, width: { ideal: 2560 }, height: { ideal: 1920 },
    } })
    expect(screen.getByRole('button', { name: '拍照' })).toBeDisabled()
    await videoReady()
    view.unmount()
    expect(usb.stop).toHaveBeenCalledTimes(1)
  })

  it('stops a permission result that arrives after close without reopening or capturing', async () => {
    const pending = deferred<MediaStream>(), camera = cameraStream()
    getUserMedia.mockReturnValue(pending.promise)
    const onCapture = vi.fn(), onClose = vi.fn()
    render(<CameraCaptureDialog studentName="学生1" onCapture={onCapture} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: '关闭拍照' }))
    await act(async () => { pending.resolve(camera.stream) })
    expect(camera.stop).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onCapture).not.toHaveBeenCalled()
  })

  it('ignores a stale StrictMode request and cleans up both streams', async () => {
    const old = deferred<MediaStream>(), current = deferred<MediaStream>()
    const oldCamera = cameraStream(), newCamera = cameraStream('usb')
    getUserMedia.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const view = render(<StrictMode><CameraCaptureDialog studentName="学生1" onCapture={vi.fn()} onClose={vi.fn()} /></StrictMode>)
    await act(async () => { current.resolve(newCamera.stream) })
    await videoReady()
    await act(async () => { old.resolve(oldCamera.stream) })
    expect(oldCamera.stop).toHaveBeenCalledTimes(1)
    expect((screen.getByLabelText('摄像头实时画面') as HTMLVideoElement).srcObject).toBe(newCamera.stream)
    expect(screen.getByRole('button', { name: '拍照' })).toBeEnabled()
    view.unmount()
    expect(newCamera.stop).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['NotAllowedError', /权限/], ['NotFoundError', /未检测到/], ['NotReadableError', /占用/],
  ])('explains %s and permits a deliberate retry', async (name, message) => {
    getUserMedia.mockRejectedValueOnce(new DOMException('private browser detail', name))
    render(<CameraCaptureDialog studentName="学生1" onCapture={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('alert')).not.toHaveTextContent('private browser detail')
    expect(document.querySelector('input[type=file]')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '重试摄像头' }))
    await videoReady()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('requires a secure page instead of opening a file chooser', () => {
    vi.stubGlobal('isSecureContext', false)
    render(<CameraCaptureDialog studentName="学生1" onCapture={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/HTTPS/)
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('restarts the same camera for a retake and releases the old preview', async () => {
    render(<CameraCaptureDialog studentName="学生1" onCapture={vi.fn()} onClose={vi.fn()} />)
    await videoReady()
    await userEvent.click(screen.getByRole('button', { name: '拍照' }))
    await userEvent.click(screen.getByRole('button', { name: '重拍' }))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:camera-photo')
    expect(screen.queryByRole('img', { name: '拍摄照片预览' })).not.toBeInTheDocument()
    await videoReady()
    expect(screen.getByRole('button', { name: '拍照' })).toBeEnabled()
  })

  it.each(['null', 'oversized'])('rejects %s encoding output without adding a photo', async (outcome) => {
    toBlob.mockImplementation((callback: BlobCallback) => callback(outcome === 'null' ? null : new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], { type: 'image/png' })))
    const onCapture = vi.fn()
    render(<CameraCaptureDialog studentName="学生1" onCapture={onCapture} onClose={vi.fn()} />)
    await videoReady()
    await userEvent.click(screen.getByRole('button', { name: '拍照' }))
    expect(screen.getByRole('alert')).toHaveTextContent(outcome === 'null' ? /生成/ : /8 MiB/)
    expect(onCapture).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '使用这张照片' })).not.toBeInTheDocument()
  })

  it('ignores duplicate captures and a late encoding result after closing', async () => {
    let complete!: BlobCallback
    toBlob.mockImplementation((callback: BlobCallback) => { complete = callback })
    const onCapture = vi.fn()
    render(<CameraCaptureDialog studentName="学生1" onCapture={onCapture} onClose={vi.fn()} />)
    await videoReady()
    fireEvent.click(screen.getByRole('button', { name: '拍照' }))
    fireEvent.click(screen.getByRole('button', { name: /^生成照片|^拍照$/ }))
    expect(toBlob).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: '关闭拍照' }))
    act(() => { complete(new Blob(['photo'], { type: 'image/png' })) })
    expect(onCapture).not.toHaveBeenCalled()
    expect(screen.queryByRole('img', { name: '拍摄照片预览' })).not.toBeInTheDocument()
  })

  it('retains a captured photo when stopping the camera rejects its pending play promise', async () => {
    const playing = deferred<void>()
    vi.mocked(HTMLMediaElement.prototype.play).mockReturnValueOnce(playing.promise)
    render(<CameraCaptureDialog studentName="学生1" onCapture={vi.fn()} onClose={vi.fn()} />)
    await videoReady()
    await userEvent.click(screen.getByRole('button', { name: '拍照' }))
    await act(async () => { playing.reject(new DOMException('interrupted', 'AbortError')) })
    expect(screen.getByRole('button', { name: '使用这张照片' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps an unsupported dialog browser usable without requesting its camera', async () => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: undefined })
    const onClose = vi.fn()
    render(<CameraCaptureDialog studentName="学生1" onCapture={vi.fn()} onClose={onClose} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/浏览器/)
    expect(getUserMedia).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '关闭拍照' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('reports asynchronous preview creation failure and releases canvas pixels', async () => {
    let complete!: BlobCallback
    toBlob.mockImplementation((callback: BlobCallback) => { complete = callback })
    vi.mocked(URL.createObjectURL).mockImplementationOnce(() => { throw new Error('allocation failed') })
    render(<CameraCaptureDialog studentName="学生1" onCapture={vi.fn()} onClose={vi.fn()} />)
    await videoReady()
    await userEvent.click(screen.getByRole('button', { name: '拍照' }))
    const canvas = vi.mocked(HTMLCanvasElement.prototype.toBlob).mock.contexts[0] as HTMLCanvasElement
    expect(canvas.width).toBe(2048)
    expect(canvas.height).toBe(1536)
    act(() => { complete(new Blob(['photo'], { type: 'image/png' })) })
    expect(screen.getByRole('alert')).toHaveTextContent(/生成失败/)
    expect(canvas.width).toBe(0)
    expect(canvas.height).toBe(0)
    expect(screen.queryByRole('button', { name: '使用这张照片' })).not.toBeInTheDocument()
  })

  it('releases encoding pixels even when the dialog closes before encoding finishes', async () => {
    let complete!: BlobCallback
    toBlob.mockImplementation((callback: BlobCallback) => { complete = callback })
    render(<CameraCaptureDialog studentName="学生1" onCapture={vi.fn()} onClose={vi.fn()} />)
    await videoReady()
    await userEvent.click(screen.getByRole('button', { name: '拍照' }))
    const canvas = vi.mocked(HTMLCanvasElement.prototype.toBlob).mock.contexts[0] as HTMLCanvasElement
    await userEvent.click(screen.getByRole('button', { name: '关闭拍照' }))
    act(() => { complete(new Blob(['photo'], { type: 'image/png' })) })
    expect(canvas.width).toBe(0)
    expect(canvas.height).toBe(0)
  })
})
