import { afterEach, expect, it, vi } from 'vitest'
import { startOwnedPolling } from './polling'
import { PilotApiError } from './client'
afterEach(() => vi.useRealTimers())
it('keeps one read in flight and discards a late result after stop', async () => {
  vi.useFakeTimers()
  let finish!: (v: string) => void
  const load = vi.fn(
      () =>
        new Promise<string>((r) => {
          finish = r
        }),
    ),
    onSnapshot = vi.fn(),
    controller = new AbortController()
  const stop = startOwnedPolling({
    load,
    onSnapshot,
    onExpired: vi.fn(),
    signal: controller.signal,
  })
  await vi.advanceTimersByTimeAsync(20000)
  expect(load).toHaveBeenCalledOnce()
  stop()
  finish('private')
  await vi.advanceTimersByTimeAsync(2000)
  expect(onSnapshot).not.toHaveBeenCalled()
  expect(load).toHaveBeenCalledOnce()
})
it('polls successful snapshots at two seconds, backs off failures, and stops on expired session', async () => {
  vi.useFakeTimers()
  const load = vi
      .fn()
      .mockResolvedValueOnce('running')
      .mockRejectedValueOnce(Error('offline'))
      .mockResolvedValueOnce('succeeded')
      .mockRejectedValueOnce(
        new PilotApiError(401, 'unauthenticated', 'expired'),
      ),
    onSnapshot = vi.fn(),
    onExpired = vi.fn()
  const stop = startOwnedPolling({
    load,
    onSnapshot,
    onExpired,
    signal: new AbortController().signal,
  })
  await vi.advanceTimersByTimeAsync(0)
  expect(onSnapshot).toHaveBeenCalledWith('running')
  await vi.advanceTimersByTimeAsync(2000)
  expect(load).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(3999)
  expect(load).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1)
  expect(onSnapshot).toHaveBeenCalledWith('succeeded')
  await vi.advanceTimersByTimeAsync(2000)
  expect(onExpired).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(30000)
  expect(load).toHaveBeenCalledTimes(4)
  stop()
})
