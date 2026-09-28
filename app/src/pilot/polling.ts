import { PilotApiError } from './client'
export function startOwnedPolling<T>({
  load,
  onSnapshot,
  onExpired,
  onError,
  signal,
}: {
  load: () => Promise<T>
  onSnapshot: (value: T) => void
  onExpired: () => void
  onError?: (error: unknown) => void
  signal: AbortSignal
}): () => void {
  let stopped = false,
    timer: ReturnType<typeof setTimeout> | undefined,
    failures = 0
  const stop = () => {
    stopped = true
    if (timer) clearTimeout(timer)
    signal.removeEventListener('abort', stop)
  }
  async function tick() {
    if (stopped || signal.aborted) return
    try {
      const snapshot = await load()
      if (stopped || signal.aborted) return
      failures = 0
      onSnapshot(snapshot)
    } catch (error) {
      if (stopped || signal.aborted) return
      if (error instanceof PilotApiError && error.status === 401) {
        stop()
        onExpired()
        return
      }
      failures++
      onError?.(error)
    }
    if (!stopped && !signal.aborted)
      timer = setTimeout(
        () => void tick(),
        Math.min(15000, 2000 * 2 ** Math.min(failures, 3)),
      )
  }
  signal.addEventListener('abort', stop, { once: true })
  void tick()
  return stop
}
