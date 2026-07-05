import { mockOcrClient } from './mockOcrClient'
import { createRemoteOcrClient } from './remoteOcrClient'
import type { OcrClient, OcrMode } from './types'

export function getDefaultOcrMode(): OcrMode {
  return import.meta.env.VITE_OCR_MODE === 'real' ? 'real' : 'mock'
}

export function createOcrClient(mode: OcrMode): OcrClient {
  if (mode === 'real') {
    return createRemoteOcrClient(import.meta.env.VITE_OCR_API_BASE ?? '')
  }

  return mockOcrClient
}
