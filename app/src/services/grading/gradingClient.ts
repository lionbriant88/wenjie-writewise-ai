import { createMockGradingClient } from './mockGradingClient'
import { createRemoteGradingClient } from './remoteGradingClient'
import { parseGradingRuntimeConfig, type GradingRuntimeEnvironment } from './gradingRuntimeConfig'
import type { GradingClient } from './types'

function createUnconfiguredGradingClient(): GradingClient {
  return {
    async gradeImages(request) {
      return {
        requestId: request.requestId, status: 'failed',
        error: { code: 'provider_not_configured', message: '批改服务尚未配置。', retryable: false },
      }
    },
  }
}

export function createConfiguredGradingClient(
  env: GradingRuntimeEnvironment = {
    VITE_GRADING_MODE: import.meta.env.VITE_GRADING_MODE,
    VITE_GRADING_API_BASE: import.meta.env.VITE_GRADING_API_BASE,
    VITE_GRADING_QUEUE_MODE: import.meta.env.VITE_GRADING_QUEUE_MODE,
    VITE_GRADING_MAX_IN_FLIGHT: import.meta.env.VITE_GRADING_MAX_IN_FLIGHT,
  },
): GradingClient {
  const config = parseGradingRuntimeConfig(env)
  if (!config.ok) return createUnconfiguredGradingClient()
  return config.value.mode === 'real'
    ? createRemoteGradingClient({ apiBase: config.value.apiBase })
    : createMockGradingClient()
}
