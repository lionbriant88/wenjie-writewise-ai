import { createMockGradingClient } from './mockGradingClient'
import { createRemoteGradingClient } from './remoteGradingClient'
import type { GradingClient } from './types'

export function createConfiguredGradingClient(
  env: { VITE_GRADING_MODE?: string; VITE_GRADING_API_BASE?: string } = {
    VITE_GRADING_MODE: import.meta.env.VITE_GRADING_MODE,
    VITE_GRADING_API_BASE: import.meta.env.VITE_GRADING_API_BASE,
  },
): GradingClient {
  return env.VITE_GRADING_MODE === 'real'
    ? createRemoteGradingClient({ apiBase: env.VITE_GRADING_API_BASE })
    : createMockGradingClient()
}
