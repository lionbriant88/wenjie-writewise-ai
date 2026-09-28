import { useContext, useEffect, useState, type ImgHTMLAttributes } from 'react'
import { AppStateContext } from '../context/appStateContextValue'
export function PrivateImage({
  uploadId,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & { uploadId: string }) {
  const client = useContext(AppStateContext)?.pilot?.client
  const [url, setUrl] = useState<string>(),
    [error, setError] = useState(false),
    [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    setUrl(undefined)
    setError(false)
    async function load() {
      try {
        const signed = await client?.readUrl(uploadId, controller.signal)
        if (!signed || controller.signal.aborted) return
        setUrl(signed.url)
        setError(false)
        timer = setTimeout(
          () => void load(),
          Math.max(1000, Date.parse(signed.expiresAt) - Date.now() - 10000),
        )
      } catch {
        if (!controller.signal.aborted) setError(true)
      }
    }
    void load()
    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [client, uploadId, retry])
  if (error)
    return (
      <div role="alert">
        原图加载失败。
        <button type="button" onClick={() => setRetry((v) => v + 1)}>
          重新读取原图
        </button>
      </div>
    )
  if (!url) return <span role="status">正在读取原图…</span>
  return <img {...props} src={url} onError={() => setError(true)} />
}
